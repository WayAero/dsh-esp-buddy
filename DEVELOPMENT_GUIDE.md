# ESP Buddy 开发指南

本文说明 `dsh-esp-buddy` 的当前实现、修改入口与构建方法。安装和用户操作见 [README](README.md)，AI 编程工具的项目约束见 [AGENTS.md](AGENTS.md)。

## 目录

- [环境与构建](#环境与构建)
- [架构与模块职责](#架构与模块职责)
- [状态与异步操作](#状态与异步操作)
- [审批处理](#审批处理)
- [配置与客户端](#配置与客户端)
- [蓝牙辅助程序](#蓝牙辅助程序)
- [设备通信协议](#设备通信协议)
- [角色包与素材制作](#角色包与素材制作)
- [打包与本地加载](#打包与本地加载)

## 环境与构建

- Node.js `>=22`、npm、Git。
- TypeScript、React 和 esbuild 由 `package-lock.json` 固定，使用 `npm ci` 安装。
- 宿主接口面向 DeepSeek Harness `0.2.0-rc.2`、Cordis `~4.0.4`；版本要求以 `package.json` 的 `peerDependencies` 为准。
- Windows x64 使用随仓库提供的 `bin/win32-x64/buddy-ble.exe`。只有修改蓝牙程序或改用 Python 启动时才需要 Python 环境。

```powershell
git clone https://github.com/WayAero/dsh-esp-buddy.git
Set-Location dsh-esp-buddy
npm ci
npm run build
```

`prepare` 调用 `build`，因此正常的 `npm ci` 已会生成产物。源码修改后重新执行 `npm run build`。`build.mjs` 构建两个入口：

| 入口 | 输出 | 加载方式 |
| --- | --- | --- |
| `src/index.ts` | `dist/index.js` | Node.js ES 模块，由 Cordis 加载 |
| `src/client/index.tsx` | `dist/client.js` | 浏览器 CommonJS 包装，通过 Harness `window.__ModuleLoader__` 注册 |

输出均带 source map，版本由 `package.json` 注入。`@deepseek-ai/cordis` 和 `@deepseek-ai/dsh-*` 由宿主提供；客户端 React 等共享库也由宿主提供。不要把宿主服务打包成第二份实例。

## 架构与模块职责

```text
Harness 会话 / Agent / 投影视图 / 审批事件
                  ↓
SessionManager + ProjectionManager + ApprovalManager
                  ↓
            BuddyStateStore
                  ↓
       Buddy JSONL 编码与发送调度
                  ↓ stdin/stdout JSONL
        Python/Bleak 辅助程序
                  ↓ BLE NUS
             ESP32-S3 Buddy

Harness 插件详情页 ← Remote → EspBuddyRuntime
Harness 官方会话卡片 ← OfficialApprovalSync → 设备决定镜像
```

| 模块 | 职责与修改入口 |
| --- | --- |
| `src/index.ts` | 注入宿主服务，组合管理器，安排心跳、配置更新和停止清理 |
| `src/session/` | 按会话维护 Agent 运行状态；任一 Agent 运行即计为运行会话 |
| `src/projection/` | 读取 `tokenUsage`、`contextPressure`、`contextBreakdown`，处理未知或非法数值 |
| `src/approval/` | 请求排队、超时、取消、设备决定和官方应答链 |
| `src/state/` | 保存聚合值，向监听者提供复制的快照 |
| `src/protocol/` | 状态编码、UTF-8 长度约束和审批回复解析 |
| `src/transport/` | 辅助程序选择、进程管理、IPC 编解码及校时安排 |
| `src/role-pack/` | 角色包解析、制作建议、命令 ACK 匹配和单次传输控制 |
| `src/config.ts`、`src/settings.ts` | 动态配置 schema、读取和更新通知 |
| `src/contract.ts`、`src/runtime.ts`、`src/typert.ts` | 共用数据类型、Remote 方法和 Typert 注册 |
| `src/client/` | 详情页、目录读取、规格提醒、诊断信息及官方卡片同步 |
| `locale/` | 插件管理器的中英文名称与介绍；页面文案在 `src/client/locales.ts` |
| `helper/buddy_ble.py` | BLE 扫描、连接、收发、分片和断线重连 |

## 状态与异步操作

`SessionManager` 启动时读取已有会话与 Agent，之后订阅创建、状态变化和释放事件。会话摘要最多八项，运行会话优先，再按更新顺序排列。

`ProjectionManager` 按会话保存公开投影视图。Token 汇总各会话的非缓存输入、输出、缓存读取和缓存写入；上下文取最近更新且有上下文数据的会话，不将不同会话的窗口相加。`context.projected` 是下一次请求的估算量，`context.window` 是路由提供的上限。未知值保持缺失，不伪造日用量。

`BuddyStateStore` 保存聚合状态，对数组及嵌套对象复制后返回快照。监听回调由更新同步触发，不应在监听回调中反复更新同一状态。

Node.js 内部状态由事件循环维护；Python 是独立进程，两端通过进程间通信（IPC）交换消息，不共享内存。异步操作仍会交错，因此：

- 连接启动、停止与重启通过 `transportTail` 串行执行，不能同时重建多个辅助程序。
- 角色包同一时刻只允许一次传输；发送期间禁止手动重连。
- 卸载时撤销配置监听、心跳与状态监听，停止辅助程序，交接未决定的审批，再释放投影和会话监听。
- 辅助程序断线清除未发送队列；ACK 路由器结束旧连接的等待，旧消息不能用于新连接。

会话聚合、待审批请求和最近安装包名称保存在进程内，重启不恢复这些缓存。profile 配置由 Harness 持久化；蓝牙绑定由操作系统维护；角色包存储和选择由固件维护。

## 审批处理

`approval/request` 的处理顺序为：

1. 插件停用或设备离线时调用 `next()`，由 Harness 后续应答者处理。
2. 在线请求分配随机本地 ID，进入设备队列，并转发到官方应答链。屏幕只显示队首，页面按所属会话显示官方请求。
3. 正文依次采用 `displayReason.zh`、`displayReason.en`、`reason`，都为空时提示查看官方卡片。设备正文不包含完整命令参数。
4. 官方先答时结算本地请求；设备先答时返回 `allowed-once` 或 `rejected`，保留决定镜像供客户端同步。
5. `OfficialApprovalSync` 读取官方 `PendingApproval`，调用公开的 `answer()`；订阅状态变化，并每 250 ms 处理已有卡片，不创建替代卡片。
6. 断线、辅助程序失败、超时或停用时清除设备请求，沿用已经转发的官方应答链。每个请求的 `next()` 只启动一次。

设备回复只接受仍待处理 ID 的 `once` 或 `deny`。过期、重复或格式错误的回复不改变结果。取消信号结束对应请求并释放定时器与监听。同会话、工具、原因一致且没有 `callId` 的请求依次转发，避免匹配到另一张卡片。

审批错误应报告具体原因；设备不可用不应被转换为拒绝。

## 配置与客户端

`Config` 的字段为 Cordis 动态值（`Volatile`）。`readConfig()` 一次读取完整配置；`installEspBuddySettings()` 在 `loader/volatile-update` 后通知监听者。客户端通过 `configForms.get('esp-buddy')` 编辑配置，持久化交给 Harness 的配置编辑器（`ConfigEditor`），主机端不另写设置文件。

客户端在 `plugins.bundle.config` 槽位注册详情页，挂载 `espBuddy` Remote。公开方法为 `status`、`reconnect`、`installRolePack`、`cancelRolePack` 和 `officialApprovals`；参数与返回值 schema 集中在 `src/contract.ts`，变更时同步主机端及客户端。

默认值和范围见 [README 设置表](README.md#日常使用与设置)。设备地址、心跳间隔及角色包写入间隔变化会重启连接；审批超时更新仅用于新请求。页面每 2 秒刷新设备状态；不能保存时显示配置不可用或只读原因。

## 蓝牙辅助程序

### 运行与重新构建

`resolveHelperLaunch()` 优先选择平台二进制程序；Windows x64 路径为 `bin/win32-x64/buddy-ble.exe`。支持的 Linux x64、macOS arm64 路径不存在时改用 `helper/buddy_ble.py`；其他平台在路径选择时直接报错。

从 Python 源码运行需要安装 `helper/requirements.txt` 中固定的 Bleak 版本。可在虚拟环境中安装，并将 `DSH_ESP_BUDDY_PYTHON` 设置为解释器绝对路径；该环境变量仅在没有平台二进制时生效。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r helper/requirements.txt
$env:DSH_ESP_BUDDY_PYTHON = (Resolve-Path .\.venv\Scripts\python.exe).Path
```

上例为 Windows PowerShell 路径，Linux/macOS 使用 `.venv/bin/python` 并按所用 shell 设置环境变量。

重新生成 Windows 程序时，使用 Windows x64 Python，安装 Bleak 与 PyInstaller，在对应 Python 环境激活后执行：

```powershell
python -m pip install -r helper/requirements.txt
python -m pip install pyinstaller
npm run build:helper:windows
```

脚本输出 `bin/win32-x64/buddy-ble.exe`，中间文件放在 `.pyinstaller/`。只修改 TypeScript 时无需重新生成该程序。

### 扫描、连接与队列

辅助程序主动扫描 NUS 广播，默认等待完整的 10 秒窗口，按 `BLEDevice.address` 选择目标。Windows/Linux 使用蓝牙地址，macOS 使用系统 UUID。多个候选且未指定地址时报错；名称用于显示，不用于筛选。

连接时检查 RX/TX 特征并订阅通知，随后报告就绪。Windows 首次配对由系统界面完成。BLE 断线逐步增加重试等待时间，最大 30 秒；成功连接后记住地址，目标离线时不换连其他候选。

标准输出只包含 JSONL 事件，日志写标准错误。Node 向标准输入发送 `tx`、`time-sync`、`stop`；辅助程序返回 `status`、`rx`、`error`。IPC 单行上限为 16 KiB，格式见 `src/transport/helper-protocol.ts`。

发送缓冲包含 `control` 和 `bulk` 两个先进先出队列、一个只保留最新值的 `snapshot` 槽及独立校时请求。取出优先级为控制命令、状态快照、数据块、校时。Python 的异步条件变量协调入队和等待；BLE 写入由单一发送任务执行，不能并行写不同消息的分片。

## 设备通信协议

BLE 传输为 UTF-8 JSONL，以换行区分消息。一个消息可拆成多个 ATT 写入，接收端需累积直到完整一行。

| NUS 项目 | UUID |
| --- | --- |
| 服务 | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` |
| RX：电脑写入 | `6e400002-b5a3-f393-e0a9-e50e24dcca9e` |
| TX：设备通知 | `6e400003-b5a3-f393-e0a9-e50e24dcca9e` |

### 状态与审批

主机端（Host）固定发送 Buddy V2 状态，包含 `protocol: 2`、`source: 'deepseek-harness'`，保留 `total`、`running`、`waiting`、`msg`、`entries`、`tokens`、`tokens_today` 和可选 `prompt`，按数据加入 `usage`、`context`、`context_breakdown`。`tokens_today` 的 `0` 是缺少精确日统计时的兼容值。

状态消息的 JSON 内容限制为 4096 个 UTF-8 字节。`prompt.hint` 最多 1024 字节；JSON 转义后超限时先减少会话摘要，再缩短正文，并保留截断标记。不能以 JavaScript 字符数代替字节数，截断必须保留完整 UTF-8 字符。

设备审批回复示例：

```json
{ "cmd": "permission", "id": "请求ID", "decision": "once" }
```

`decision` 仅允许 `once`、`deny`。字段与限制见 `src/protocol/types.ts`、`src/protocol/buddy.ts`。

### 校时

Node 只安排校时请求，Python 在实际写入前读取电脑 UTC 秒时间戳与当地 UTC 偏移秒，生成 `{"time":[时间戳,偏移秒]}`，避免排队使时间值过期。校时使用带响应写入，但没有应用层 ACK，不能据此报告设备已应用时间。

每次连接就绪及持续连接每 10 分钟安排校时；心跳检测到至少 5 秒的墙上时间与单调时间差或时区变化时补发。角色包传输期间延后校时，重复请求合并；断线与停用清理旧请求，IPC 背压最多重试三次。

### 角色包传输

角色包只发送 V2：`char_begin` 携带 `v:2`，请求窗口大小 `4`，后续采用设备 ACK 返回的窗口值。`char_begin`、`file`、`file_end`、`char_end`、`char_abort` 按顺序逐条发送，使用带响应写入（Write With Response）并等待应用层 ACK；`chunk` 使用无响应写入（Write Without Response），每块最多 512 个原始字节，按窗口等待累计 ACK。

传输期间暂停普通状态发送；收到窗口 ACK 后、下一个窗口开始前允许发送当时最新状态，旧快照不逐条补发。失败时报告具体 ACK、超时或连接原因；仍连接且已开始传输时尝试 `char_abort`。取消在当前命令完成后处理。V2 返回 `ok:true,n:0` 时提示固件升级，不改用 V1。

无响应 ATT 载荷取 `min(244, max(20, max_write_without_response_size))`；带响应载荷取 MTU 减 3，至少 20。`rolePackWriteDelayMs` 是完整无响应 JSONL 写完后的间隔，不是每个 ATT 分片的间隔。页面速度按最近 5 秒已确认的原始文件字节计算，不使用 Base64 或 ATT 字节数。

## 角色包与素材制作

角色包目录格式见 [README](README.md#角色包)。后端重新校验客户端提交的文件：文件名最多 64 个 UTF-8 字节，不得包含路径分隔符或 `..`；禁止重复文件名；`manifest.json` 最多 8192 字节，`name` 最多 64 字节，需可规范化为最多 32 字符的 ASCII `pack_id`；`mode` 为 `gif` 或 `text`。GIF 模式至少含 `idle.gif`，GIF 文件名只允许 `idle.gif`、`busy.gif`、`attention.gif`、`sleep.gif`。

制作规格是提醒条件，格式与协议范围是拒绝条件，设备存储和解码限制由固件决定。总量超过 uint32 范围无法编码。`NOTICE.txt` 作为普通文件随角色包传输。

`scripts/build-dsh-pet-role-pack.py` 针对 `dsh-pet` 原始 220×124 绿幕 GIF，不是任意图片的通用转换器。源素材从 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 获取，来源文件与提交见 [NOTICE.txt](role-packs/dsh-pet-maid/NOTICE.txt)。安装 Pillow 后执行：

```powershell
python -m pip install pillow
python scripts/build-dsh-pet-role-pack.py source.gif output.gif
```

脚本裁切角色、缩放为 84×84，均匀选取 80 帧并保留总时长，量化为含透明索引的 64 色，不使用抖动。透明边缘二值化，使用 `disposal=2` 清理上一帧。其他尺寸或人物布局需调整裁切参数。配套固件必须保留透明度，否则透明区域显示为 GIF 背景色。

## 打包与本地加载

```powershell
npm run build
npm pack
```

`npm pack` 按 `package.json` 的 `files` 收集 `dist`、图标、语言元信息、Python 运行文件、平台二进制、示例角色包、默认 patch、三份入口文档和许可证。开发文档与 Agent 指南随包保留，使 README 的本地链接在安装包中也可使用。

将 tgz 按 [README 安装方法](README.md#方式三从本仓库构建并安装)加载到所用 profile。修改主机端后重新构建并重新加载插件；修改客户端后还需刷新页面或重启 Desktop。Web 和 Desktop 使用各自配置，不应同时连接同一设备。

`cordis.patch.yml` 插入 `id: esp-buddy`、`name: dsh-esp-buddy` 的默认节点。修改共享宿主接口时维护 `peerDependencies` 与 `devDependencies` 的对应要求，避免依赖解析到不同宿主实例。构建失败时检查首个错误、Node.js 版本及锁定依赖；辅助程序退出时检查标准错误和系统蓝牙状态。

固件协议与存储实现见 [ESP32-S3 Buddy 开发指南](https://github.com/WayAero/esp32s3-buddy/blob/main/DEVELOPMENT_GUIDE.md)。插件与固件是独立项目，协议变更需同时考虑两端兼容条件。
