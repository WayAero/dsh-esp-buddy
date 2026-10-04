# ESP Buddy

ESP Buddy（包名与仓库名：`dsh-esp-buddy`）是 DeepSeek Harness 的 Cordis 插件。它把会话数量、Token 与上下文（Context）
汇总值、审批请求发送到 ESP32-S3 Buddy。审批同时交给设备和官方会话卡片，任一端决定后另一端提示结束。
Windows x64 安装包内置蓝牙辅助程序，运行时不需要 Python 环境。

## 运行环境

- 仅支持 DeepSeek Harness `0.2.0-rc.2`、Cordis `~4.0.4` 和 Node.js `>=22`，不兼容旧版 Harness。
- 当前安装包面向 Windows x64 的 Desktop 和 Web profile，包含 `bin/win32-x64/buddy-ble.exe`。Linux x64 与 macOS arm64 有启动路径，但包内没有对应的辅助程序。
- ESP 固件：[WayAero/esp32s3_buddy](https://github.com/WayAero/esp32s3_buddy)

本地 `npm test` 和 `npm run test:hardware` 使用 `--experimental-strip-types`，运行这些命令需要 Node.js 22.6.0 或更新版本。
下文的 2026-09-12 实机记录是历史结果，不能证明当前 rc.2、Desktop 或其他环境已经过实机验收。

## 本地构建与验证

```powershell
npm test
npm run test:python
npm run typecheck
npm run build
npm run build:helper:windows
npm pack
```

从源码运行蓝牙辅助程序需要 Python 和 Bleak；重新打包还需要 PyInstaller。安装后的 Windows x64 插件
直接运行 `bin/win32-x64/buddy-ble.exe`。`npm run test:hardware` 需要已配对的设备，并要求依次在设备上
选择 Allow Once 和 Deny；普通测试不连接硬件。

## 安装

### npm 包与官方入口

npm 包名为 `dsh-esp-buddy`，插件显示名称为 **ESP Buddy**。首次发布到 npm 后，可在 Harness 的
“插件（Plugins）→ 添加插件”中输入 `dsh-esp-buddy` 并安装；指定版本时输入 `dsh-esp-buddy@版本号`。
中国大陆镜像源若尚未同步新版本，可切换至 npm 官方源。

也可以用 Harness 命令行安装到指定 profile：

```powershell
dsh plugin add dsh-esp-buddy --profile desktop
# Web profile 名称由自己的 Harness 环境决定
dsh plugin add dsh-esp-buddy --profile <Web-profile名称>
```

在自行管理的 Cordis 工程中可执行 `npm install dsh-esp-buddy`；该命令只安装包，仍需配置
Cordis 加载器。Harness 用户优先使用官方插件入口或 `dsh plugin add`，由 Harness 管理配置与加载。

rc.2 暂不提供插件自动更新；升级时在官方插件页先卸载，再安装新版本。

### 本地安装包

在项目目录执行 `npm pack`，生成 `dsh-esp-buddy-0.5.1.tgz`。在 Windows x64 的 Desktop 或 Web
profile 中打开官方“插件（Plugins）”页面，用“添加插件”填写该压缩包的绝对路径；同一压缩包可分别安装到两个
profile。安装后在该页面启用组合包及 `esp-buddy` 行，之后也在该页面管理或卸载，无需插件自行执行卸载命令。

安装时 pnpm 可能报告缺少 `@deepseek-ai/cordis` 和 DSH 包的 peer 依赖：rc.2 的 profile 默认关闭自动补装，Harness 在运行时提供这些包。若只是这组缺失提示且插件显示“运行中”，无需在 profile 手动补装；版本不兼容或组件加载失败应检查具体错误。

从 Git 源安装时，需要让包管理器执行 `prepare` 来构建 `dist`。若安装环境禁止依赖包的构建脚本，
可先在本仓库执行 `npm pack`，再安装生成的 tgz。

### 维护者发布

发布前运行 `npm test`、`npm run test:python`、`npm run typecheck` 和 `npm pack --dry-run`。
`prepare` 会构建 `dist`；发布包内置 Windows x64 蓝牙程序，使用者不需要编译代码或安装 Python。
检查包内保留图标、语言元信息和第三方素材的 `NOTICE.txt`，并且不含本机配置、开发过程文档或凭据。

使用 npm 官方源登录后发布；首次发布需先确认版本号和发布标签：

```powershell
npm login --registry=https://registry.npmjs.org/
# 正式版本使用 latest；预发布版本改用 next
npm publish --dry-run --tag latest
npm publish --tag latest
```

不带版本的安装默认使用 `latest` 标签；仅发布到 `next` 的候选版本需使用 `dsh-esp-buddy@next`
或完整版本号。同一包名与版本号发布后不能重复使用。发布后用 `npm view dsh-esp-buddy dist-tags`
核对版本，再从官方插件入口安装验证。

`esp-buddy` 行的配置默认启用；启用组合包和该行后，按广播中的 Nordic UART Service（NUS）UUID
`6e400001-b5a3-f393-e0a9-e50e24dcca9e` 识别候选设备，不按名称筛选。RX 写入特征为
`6e400002-b5a3-f393-e0a9-e50e24dcca9e`，TX 通知特征为 `6e400003-b5a3-f393-e0a9-e50e24dcca9e`；
连接后仍检查两项特征。默认 `DeepSeek-XXXX`、旧版 `Claude-XXXX` 和不带品牌前缀的自定义名称均可使用。

辅助程序使用 Bleak 3.0.2 主动扫描，按服务 UUID 筛选并等待完整扫描窗口（默认 10 秒）。
[扫描 API](https://bleak.readthedocs.io/en/latest/api/scanner.html) 只返回广播中包含指定服务的候选；
[Windows 后端](https://bleak.readthedocs.io/en/latest/backends/windows.html) 按地址合并主广播与扫描响应。
主广播名称最多 8 字节，扫描响应携带完整名称；页面优先显示扫描返回的名称及设备地址，
若只收到短名就显示短名，名称为空就显示地址，不推算名称或 MAC 后缀。
扫描窗口内未收到完整名称时，须下次重连扫描才能刷新。

`deviceAddress` 留空时，仅在扫描到一个 NUS 候选时自动连接；多个候选时停止选择，并在最近错误中
列出名称与地址。在设置页填写目标地址并保存即可选择设备。NUS 不是 Buddy 专用服务，其他 NUS 设备
也可能成为候选；请核对目标设备，不能用名称或 UUID 判断厂商。若系统未报告服务 UUID，
即使名称看似 Buddy 或已填写地址也不会连接；不会退回扫描所有蓝牙设备。

设备身份沿用 Bleak 的 `BLEDevice.address`（Windows/Linux 为蓝牙地址，macOS 为系统 UUID）。
辅助程序成功连接后记住地址，断线后重新扫描同一地址并刷新显示名称；该地址离线时不会换连另一台。
插件原先没有持久化设备或配对记录；需要跨进程重启固定目标时，在设置中保存 `deviceAddress`，
设备改名后仍按该地址重连。旧配置 `deviceNamePrefix` 已不参与筛选；升级默认按 UUID 自动发现，
有多台设备时应配置地址。系统配对记录仍由操作系统维护。

名称由固件“设置 → 设备”编辑：BLE 名称为 1–29 个可打印 ASCII 字节；Wi-Fi 主机名默认
`ESP32-S3 Buddy`，最多 32 字节，两项保存后重启生效。插件不发送改名命令。
Wi-Fi 仍为 STA 客户端，这里没有热点、mDNS、网络发现或 Wi-Fi 通信接口。
首次连接使用固件的安全连接（Secure Connections）与中间人保护（MITM）配置；Windows 需要先在系统蓝牙界面完成配对。

## 设置与状态

在“插件（Plugins）”页面打开 ESP Buddy，即可在插件详情页直接设置。Desktop
和 Web profile 各自管理自己的安装与配置。配置页提供：

- 启用/停用插件，以及自动连接开关；
- BLE 连接状态、设备名、MTU、蓝牙辅助程序状态和最近收发时间；
- 当前会话数、运行数、待审批数和 Token 聚合值；
- 重新连接与复制诊断信息；
- BLE 设备地址、审批超时和状态发送间隔。

编辑字段后点击“保存”，配置编辑器（ConfigEditor）会写入当前 profile 的 `cordis.patch.yml` 并交由
Loader 应用；离开页面时，未保存的草稿会丢弃。修改设备地址、状态发送间隔或角色包写入间隔会重启
蓝牙辅助程序；修改审批超时只影响之后收到的新请求。配置页每 2 秒读取一次状态。

“恢复默认设置”移除当前 profile 对页面六项设置的覆盖，并放弃未保存的修改。Harness 重新取继承配置；
没有继承值时使用默认值。该操作可能根据生效的设置启停或重启蓝牙连接。

配置加载期间显示“正在加载配置”；配置不可用或只读时，页面说明原因并禁用保存。远程页面若处于官方
`memory` 模式，不能写入主机配置，请在主机本地的 Web 页面或桌面端编辑。

连接圆点按以下规则显示：已连接为绿色；从未连接成功且没有连接错误时为灰色；连接失败，或曾连接成功后
断开时为红色。诊断信息提供版本、连接与蓝牙辅助程序状态、最近错误、角色包进度、配置和针对性排查建议，
不包含会话内容、审批内容或角色包文件数据。

## 审批

会话审批使用 Harness 官方卡片，插件不提供替代卡片。

Buddy 的审批正文优先使用官方中文说明 `displayReason.zh`；缺失或为空白时依次使用英文说明和原始
`reason`，均不可用时提示在官方会话卡片查看审批原因。不转发卡片下方的完整命令或参数。
正文最多 1024 个 UTF-8 字节，超长时在开头显示“【说明未完整显示】”，标记计入容量；JSON 转义后
整行仍限制在 4096 字节内。为容纳审批说明，必要时减少会话摘要项，再缩短正文并保留标记。
设备完整显示需要支持 1024 字节审批正文和滚动阅读的新版固件；旧固件仍会按其较小容量截断。

Buddy 在线时，请求同时进入设备队列和 Harness 后续应答链。官方页面先答时清除设备请求；设备先答时，客户端
通过会话状态读取对应的官方 `PendingApproval`，使用公开 `answer()` 完成卡片。客户端每 250 ms 同步已有卡片；
页面清除还取决于请求传输和应答处理时间。没有 `callId` 且会话、工具名、原因相同的请求按顺序转发到页面，避免误匹配。

设备离线时，新请求直接交给 Harness 后续应答链；在线请求遇到辅助程序失败、审批超时或插件停用时，
清除设备提示并沿用已转发的应答链，不重复调用后续应答者，也不自动拒绝。Desktop 与 Web 双端提示同步、Web 允许 / 拒绝的实际操作结果，以及断线后页面审批和重连清理已获用户实测确认。安装新版候选包后刷新或重启客户端。

## 角色包发送

在“插件（Plugins）”的 ESP Buddy 配置页“角色包”区域选择或拖入一个角色包目录。目录不能包含子目录；`manifest.json` 的
`mode` 为 `gif` 时，必须有 `idle.gif`，其余动画文件可用 `busy.gif`、`attention.gif`、`sleep.gif`。
单文件原始字节不得超过 229,376，所有传输文件的原始字节总和不得超过 1,800,000。`NOTICE.txt` 会作为
普通文件随角色包传输，以保留素材的授权声明。

角色包只使用 V2：`char_begin` 携带 `v:2` 并请求窗口大小 `4`，设备返回的窗口大小决定每次连续发送的块数。
每块最多包含 512 个原始字节；发送完一个窗口后，插件等待设备的累计确认（ACK）。`char_begin`、`file`、
`file_end`、`char_end`、`char_abort` 按顺序逐条发送，使用带响应写入（Write With Response）并等待 ACK；
`chunk` 按顺序发送，使用无响应写入（Write Without Response）。传输期间暂停发送状态快照；收到窗口 ACK 后、
下一窗口开始前发送当时最新的状态，旧状态不会逐条补发。设备对 V2 返回 `ok:true,n:0` 时，插件提示升级固件，
不会改用 V1。

断线、超时或设备返回失败 ACK 时，插件报告失败；仍保持连接且传输已开始时，会尝试发送 `char_abort`。
设置页可请求取消，插件在当前命令完成后处理取消。安装成功后，页面清除传输进度并显示当前 DSH 进程内
最近安装的角色包名。

发布包附带 `role-packs/dsh-pet-maid` 示例包。其动画素材来自
[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，按作者说明仅可开源使用、禁止商用；
来源提交、处理方式和使用限制见随包的 [NOTICE.txt](role-packs/dsh-pet-maid/NOTICE.txt)。插件代码采用 MIT，
不改变该第三方素材的限制。

示例包含 `idle.gif`、`attention.gif`、`busy.gif` 和 `sleep.gif`。新增或重新制作角色 GIF 时，以
`84×84、≤80 帧、约 8 FPS、≤210 KiB、≤64 色` 作为单文件制作目标；传输校验会拒绝尺寸、帧数、颜色数或
帧率超限的 GIF，单文件字节数硬上限为 `224 KiB`。随包动画使用透明背景，64 色包含一个透明色索引，
不使用抖动。透明显示要求配套固件保留 GIF 透明度（使用 `ARGB8888` 解码）；使用 `RGB565` 解码的固件
会将透明区域填成 GIF 自身的背景色，无法透出主题底色。此前 84×84、120 帧、472,276 字节的 GIF 曾在 ESP32 实机上伴随 LVGL lock 超时和屏幕卡死，
因此不作为制作规格。
当前随包四个 GIF 为 84×84、80 帧、约 8 FPS、64 色，单文件约 172–181 KiB。配套 ESP32 固件按 Buddy 状态选择固定文件名对应的动画；插件不发送 `animation` 字段。
从原始绿幕素材重制时，运行 `python scripts/build-dsh-pet-role-pack.py <source.gif> <output.gif>`；脚本保存后逐帧重新解码，核对像素和帧时长。
GIF 只支持完全透明或不透明的边缘；放大显示时建议配套固件开启 `lv_image_set_antialias(..., true)`，并检查绘制开销。
2026-10-05 用户实机确认当前随包动画的透明背景、主题切换、循环播放和动画切换正常；开启固件缩放抗锯齿后，
浅色主题下的边缘有所改善。该结果不代表其他角色包或固件配置已通过验收。

连接后，无响应写入的 ATT 载荷取 `min(244, max(20, rx_characteristic.max_write_without_response_size))`。
蓝牙辅助程序会记录原始数据量、线上字节数、ATT 写入次数、写入耗时、ACK 等待耗时和有效原始吞吐等指标。
配置文件中的 `rolePackWriteDelayMs` 默认是 `0`；设为 `1` 至 `4` 时，每写完一条无响应 JSONL 消息等待相应毫秒数，
而不是在每个 ATT 分片后等待。修改此配置会重启蓝牙辅助程序。
设置页显示百分比、当前文件、已完成文件数、速度和预计剩余时间；速度与预计时间按最近 5 秒的已确认原始字节计算，
不使用 Base64 或 ATT 字节数，也不显示协议版本或窗口值。发送期间页面会提示保持连接并耐心等待。

历史实机记录（2026-09-12）：使用当时的配套 V2 固件发送 `dsh-pet-maid` 的 814,935 原始字节后安装完成，
有效原始吞吐为 19.0 KiB/s，当次观察到 8 FPS 动画画面稳定。这项记录不能证明当前设备或其他蓝牙环境
会达到同样速度。

## 默认配置

发布包携带的默认 patch 为：

```yaml
- insert:
    - id: esp-buddy
      name: dsh-esp-buddy
      config:
        enabled: true
        autoConnect: true
        approvalTimeoutMs: 300000
        heartbeatIntervalMs: 3000
        deviceAddress: ""
        rolePackWriteDelayMs: 0
```

状态快照使用 V2，`usage`、`context` 与 `context_breakdown` 在有数据时加入消息。
`context.projected` 是下一次请求上下文的估算值，`context.window` 是路由提供的上限；字段缺失表示没有可用值。
`tokens_today` 为兼容旧解析保留；没有精确日统计时写入 `0`，不能将其当作真实日用量。

## 通信内容与处理范围

- 上位机（Host）→ ESP：UTF-8 JSONL 状态快照固定使用 Buddy V2，并保留 V1 既有字段。
- ESP → 上位机：仅接受仍待处理的审批请求 ID 的 `once` 或 `deny`；页面决定由 Harness 官方应答链返回。插件 Remote 仅向客户端提供设备审批结果，供其同步官方卡片。
- 多个会话的状态由 Harness 汇总；多个审批请求按收到顺序排队，屏幕一次只显示一个，会话页面只显示所属会话的请求。
- 蓝牙辅助程序只负责扫描、连接、NUS 收发、分片和重连，不处理会话、Token 或审批。

历史实机记录（2026-09-12）：当时的 Windows 版本覆盖设置页、自动连接、状态显示、默认每 3 秒发送状态
以及 Buddy 的 Allow Once 与 Deny 回传。此记录不覆盖当前 rc.2 的 Desktop/Web 配置页或会话审批卡片。
本仓库的无硬件测试覆盖多个会话、Token 与上下文汇总、官方卡片与 Buddy 的决定同步、会话隔离和取消清理；
模拟设备回复不能代替实机结果。
