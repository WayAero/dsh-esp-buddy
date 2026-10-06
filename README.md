# ESP Buddy

把 AI Agent 的工作状态放到桌面上的 ESP32-S3 小屏幕，并在需要授权时通过触摸作出决定。

**ESP Buddy**（包名 `dsh-esp-buddy`）是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Cordis 插件。它汇总会话、Token 用量和上下文信息，通过蓝牙低功耗（BLE）发送给设备。审批请求同时出现在设备与 Harness 官方会话卡片中，任一端作出决定后同步结束另一端的提示。

Windows x64 包内置蓝牙辅助程序，日常使用无需安装 Python。硬件选择、接线与烧录请阅读配套的 [ESP32-S3 Buddy 固件仓库](https://github.com/WayAero/esp32s3-buddy)。

## 目录

- [功能与运行条件](#功能与运行条件)
- [安装](#安装)
- [首次连接](#首次连接)
- [日常使用与设置](#日常使用与设置)
- [角色包](#角色包)
- [切换到 Claude Code](#切换到-claude-code)
- [注意事项与故障排查](#注意事项与故障排查)
- [仓库结构与开发入口](#仓库结构与开发入口)
- [参考项目、鸣谢与许可](#参考项目鸣谢与许可)
- [AI 使用声明与维护说明](#ai-使用声明与维护说明)

## 功能与运行条件

| 功能 | 行为与条件 |
| --- | --- |
| 工作状态 | 显示会话总数、运行数、待审批数和会话摘要；状态变化时发送，默认每 3 秒补发 |
| Token 与上下文 | 汇总会话的 Token 用量；上下文显示最近更新会话提供的估算数据，取决于 Harness 数据是否可用 |
| 触摸审批 | 设备可选择 `Allow Once` 或 `Deny`；官方卡片保留完整操作信息和审批入口 |
| 电脑校时 | 连接与重连后发送时间，持续连接每 10 分钟同步，并在检测到系统时间或时区变化时补发 |
| 角色包发送 | 从插件详情页选择目录，通过 Folder Push V2 安装到设备，无需重新烧录固件 |
| 连接管理 | 自动连接、断线重连、指定设备地址、查看状态和复制诊断信息 |

当前源码面向 DeepSeek Harness **`0.2.0-rc.2`**、Cordis **`~4.0.4`**，要求 Node.js **`>=22`**。其他 Harness 版本的接口可能不同，请按插件版本的依赖要求选择宿主。

推荐 Windows 11 x64，电脑需具备可用蓝牙。Desktop 和 Web 均通过**运行 Harness 的电脑**连接蓝牙；在其他电脑或手机上打开 Web 页面，不会使用浏览器所在设备的蓝牙。两个 profile 各自管理安装与配置。

设备应运行配套固件并广播 Nordic UART 服务（Nordic UART Service，NUS）。状态、审批、校时与角色包分别需要固件支持相应消息；仅能建立 BLE 连接不代表全部功能兼容。Linux x64 与 macOS arm64 有 Python 启动路径，本包未提供对应二进制程序，部署方法见[开发文档](DEVELOPMENT_GUIDE.md#蓝牙辅助程序)。

## 安装

### 方式一：Harness 官方插件页

1. 打开 Harness 的**插件（Plugins）→ 添加插件**。
2. 输入 `dsh-esp-buddy`，安装 npm 发布版；需要指定版本时输入 `dsh-esp-buddy@版本号`。
3. 启用 ESP Buddy 组合包及其中的 `esp-buddy` 行，打开插件详情页配置设备。

这里指 Harness 内置的插件管理页。插件能否安装取决于所用源是否已有该版本；npm 发布版与仓库源码可能不同。源码安装见方式三。

升级可在插件页卸载后安装目标版本，再刷新 Web 页面或重启 Desktop。安装、启用和卸载均由 Harness 管理。

### 方式二：终端安装 npm 包

使用与当前 Harness 安装对应的 `dsh` 命令，将包安装到实际使用的 profile：

```powershell
# 桌面端
dsh plugin --profile desktop add dsh-esp-buddy

# Web；如使用自定义 profile，请替换 web
dsh plugin --profile web add dsh-esp-buddy
```

命令格式与 profile 的作用见 [Harness 官方打包与安装说明](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish.html)。Desktop 若使用独立的 Harness 数据目录，应使用桌面随附的 CLI 及其环境；安装到另一份 CLI 的同名 profile 不会改变桌面端配置。

在自行管理的 Cordis 工程中也可执行 `npm install dsh-esp-buddy`，但这只安装 npm 包，还需配置组合包加载及所需的 Harness 服务。普通 Harness 用户使用插件页或 `dsh plugin` 即可。

### 方式三：从本仓库构建并安装

安装 Git 和 Node.js 22 或更新的兼容版本，在 PowerShell 中执行：

```powershell
git clone https://github.com/WayAero/dsh-esp-buddy.git
Set-Location dsh-esp-buddy
npm ci
npm run build
npm pack
```

`npm ci` 的 `prepare` 会构建 `dist/`；修改源码后执行 `npm run build` 重新生成产物。`npm pack` 输出 `dsh-esp-buddy-<版本号>.tgz`。Windows x64 源码仓库已携带蓝牙程序，无需额外构建 Python。

将 tgz 的**绝对路径**填入官方插件页的“添加插件”，或用 CLI 安装。下面的路径和文件名请替换为实际输出：

```powershell
dsh plugin --profile desktop add "C:/path/to/dsh-esp-buddy-<版本号>.tgz"
```

从 Git URL 直接安装需要包管理器允许执行 `prepare`；若构建脚本被禁用，使用上述本地构建的 tgz。

## 首次连接

1. 按[固件 README](https://github.com/WayAero/esp32s3-buddy#readme)准备硬件、烧录并启动设备。默认蓝牙名称为 `DeepSeek-XXXX`。
2. 在 Windows **设置 → 蓝牙和设备 → 添加设备 → 蓝牙**中选择 Buddy，按设备屏幕提示完成配对。首次中间人保护（MITM）配对由系统完成，插件不会在每次重连时重复配对。
3. 在 Harness 插件页启用 ESP Buddy，打开详情页。默认自动连接；一次扫描约需 10 秒，请等待状态变化。
4. 若只有一台广播 NUS 的候选设备，插件自动连接。若有多台，在“最近错误”中查看名称与地址，将目标地址填入 **BLE 设备地址**并保存。
5. 连接后启动 Harness 会话，设备随会话活动更新状态；校时消息发送后可在设备上查看时间。

插件**按 NUS 服务 UUID 发现设备，不按名称前缀筛选**。`DeepSeek-XXXX`、`Claude-XXXX` 和自定义名称均可作为候选，但其他产品也可能使用 NUS，请核对地址。即使指定地址，设备仍须广播该服务。

成功连接后，辅助程序在本次进程内记住地址，断线只重连这台设备。需要在 Harness 重启后固定目标时，请保存设备地址。

## 日常使用与设置

在**插件 → ESP Buddy**详情页查看连接状态、设备名称、MTU、蓝牙程序状态、最近收发时间和聚合数据。编辑设置后点击**保存**；离开页面会放弃未保存的草稿。

| 配置键 | 默认值 | 用途 |
| --- | --- | --- |
| `enabled` | `true` | 启用插件 |
| `autoConnect` | `true` | 自动启动连接；关闭后可点击“重新连接”手动连接 |
| `deviceAddress` | 空字符串 | 自动选择唯一候选；填写后固定目标地址 |
| `approvalTimeoutMs` | `300000` | 设备审批等待时间，单位毫秒；超时交给 Harness 后续应答链 |
| `heartbeatIntervalMs` | `3000` | 状态补发间隔，允许 `1000–29000` 毫秒 |
| `rolePackWriteDelayMs` | `0` | 无响应 JSONL 消息写完后的等待时间，允许 `0–4` 毫秒 |

修改设备地址或两项发送间隔会重启蓝牙辅助程序。审批超时仅影响之后收到的请求。恢复默认设置会移除当前 profile 的设置覆盖；存在继承配置时采用继承值。

配置由 Harness 保存到当前 profile。只读或远程 `memory` 模式页面无法保存时，请在主机本地 Web 页面或 Desktop 中设置。

### 审批与数据含义

- Buddy 一次显示一个请求，按收到顺序排队。正文优先使用官方中文说明，缺失时使用英文说明或原始原因；最多 1024 个 UTF-8 字节，截断时显示“【说明未完整显示】”。完整命令与参数请在官方卡片查看。
- 页面先决定时清除设备请求；设备先决定时通过官方卡片的公开接口同步结果。客户端应保持运行，以便卡片同步。
- 设备离线、蓝牙程序失败、超时或插件停用时，未决定的请求交给 Harness 后续应答链，**不会因断线自动拒绝**。
- Token 是当前纳入汇总的会话数据，不能当作账户账单或精确日用量。上下文是估算值，不是设备测量值。
- 校时消息没有专用确认（ACK）；发出消息不等于固件已应用时间，以设备显示为准。

## 角色包

从插件详情页的“角色包”区域选择或拖入一个目录，确认文件后发送。目录不能包含子目录。最小 GIF 角色包为：

```text
my-buddy/
├── manifest.json
├── idle.gif          必需：空闲
├── busy.gif          可选：工作
├── attention.gif     可选：等待审批
├── sleep.gif         可选：断线或休息
└── NOTICE.txt        素材来源及许可（使用第三方素材时保留）
```

```json
{ "name": "my-buddy", "mode": "gif" }
```

建议每个 GIF 使用 **84×84、最多 80 帧、约 8 FPS、最多 210 KiB、最多 64 色**；透明色占一个颜色索引，不使用抖动。建议角色包总量不超过约 1.8 MB。超过制作建议时页面提醒，可继续发送或关闭提醒；非法目录、文件名或损坏格式会阻止发送。设备的存储空间、文件大小与解码能力仍会限制实际安装和播放。

传输需要支持 **Folder Push V2** 的固件，发送时保持连接。可在页面取消；失败时查看连接、超时或固件 ACK 返回的原因。安装成功后在设备 Settings → 角色包中选择。透明背景还需固件保留 GIF 透明度。

仓库及 npm 包附带 [dsh-pet-maid](role-packs/dsh-pet-maid) 示例。npm 用户可在已安装包的同名目录找到它；也可从本仓库获取。素材来自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，**允许开源使用、禁止商用**，请保留 [NOTICE.txt](role-packs/dsh-pet-maid/NOTICE.txt)。制作与协议细节见[开发文档](DEVELOPMENT_GUIDE.md#角色包与素材制作)。

## 切换到 Claude Code

本插件接入 DeepSeek Harness。Claude Code 使用独立的 [cc-buddy-bridge](https://github.com/SnowWarri0r/cc-buddy-bridge)。

设备一次连接一个 BLE 客户端。切换时先停用本插件，再将设备蓝牙名称改为以 `Claude` 开头，保存并重启；按[桥接工具中文说明](https://github.com/SnowWarri0r/cc-buddy-bridge/blob/main/README.zh-CN.md)安装，在对应 Python 环境运行 `cc-buddy-bridge install` 注册钩子（hooks），再运行 `cc-buddy-bridge daemon`。切回 Harness 前退出桥接服务，再启用插件；本插件不要求改回名称。主题选择不改变蓝牙名称。

桥接的基础状态与审批取决于其配置；校时和角色包传输还需对应协议支持，不能将桥接工具面向其他固件的功能全部视为本固件支持。配套固件使用 UTF-8 文本，不启用桥接工具针对其他固件的 `CC_BUDDY_CJK_TARGET` 编码选项。更多条件见[固件接入说明](https://github.com/WayAero/esp32s3-buddy#连接-claude-code)。

## 注意事项与故障排查

| 现象 | 处理方法 |
| --- | --- |
| 安装版本不符合预期 | 核对 npm 发布版本与宿主依赖；镜像尚未同步时使用 npm 官方源，或安装明确版本的 tgz |
| 插件没有运行 | 检查组合包和 `esp-buddy` 行是否启用，查看 Harness 加载错误及依赖版本 |
| 找不到设备 | 确认设备已启动、电脑蓝牙可用、系统已配对、固件广播 NUS，且未被其他工具连接 |
| 提示多个 NUS 设备 | 核对候选列表，将目标地址写入 `deviceAddress` 并保存 |
| 能发现但无法连接 | 检查配对与加密状态、是否被另一 profile 或桥接服务占用；绑定不一致时按固件说明重新配对 |
| Web 显示配置只读 | 在运行 Harness 的主机本地页面或 Desktop 修改 |
| 审批说明不完整 | 在官方会话卡片查看完整操作；固件也需支持当前正文容量 |
| 角色包发送失败 | 查看最近错误；确认支持 V2、文件格式和剩余存储空间，重连后再发送 |
| 动画底色或显示异常 | 确认 GIF 透明索引、尺寸与固件解码格式；缩小动画以减少内存和绘制开销 |
| 时间未更新 | 核对电脑时间与时区、BLE 连接及固件校时支持；连接状态不能证明校时已应用 |

BLE 会把审批摘要和状态发送到设备，旁人可从屏幕看到这些信息。插件不转发完整命令参数；“复制诊断信息”不包含会话正文、审批正文或角色包文件数据，但含设备地址和配置，分享前按需遮盖。

若安装出现 peer 依赖缺失提示，应结合插件运行状态判断：Harness 在运行时提供其共享包，缺失提示与版本不兼容、加载失败是不同问题，不要仅凭提示向 profile 随意补装宿主组件。

提交 [Issue](https://github.com/WayAero/dsh-esp-buddy/issues) 时请提供插件版本、Harness 版本、Windows 版本、固件版本、复现步骤、最近错误和必要诊断信息。不要上传配对码、凭据或敏感审批内容。硬件与固件问题请到[固件仓库](https://github.com/WayAero/esp32s3-buddy/issues)反馈。

## 仓库结构与开发入口

```text
src/                     Harness 事件、状态聚合、审批、协议和设置页
helper/                  Python/Bleak 蓝牙辅助程序
bin/win32-x64/           随包提供的 Windows 蓝牙程序
role-packs/dsh-pet-maid/  示例角色包与版权声明
assets/plugin-icon.svg   插件图标
locale/                  插件名称与说明的中英文元信息
scripts/                 蓝牙程序构建与 GIF 制作工具
build.mjs                主机端和客户端构建入口
cordis.patch.yml         Harness 组合包默认配置
```

用户从本 README 开始；修改插件请阅读 [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md)；使用 AI 编程工具请同时阅读 [AGENTS.md](AGENTS.md)。固件的接线、烧录和实现由其独立仓库维护。

## 参考项目、鸣谢与许可

感谢以下项目与作者：

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：插件、会话与审批服务及客户端接口。
- [ESP32-S3 Buddy](https://github.com/WayAero/esp32s3-buddy)：配套固件与设备界面。
- [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)：示例角色动画的来源。
- [Bleak](https://github.com/hbldh/bleak)：跨平台 BLE 接口；[PyInstaller](https://github.com/pyinstaller/pyinstaller)：蓝牙程序打包工具。
- [esbuild](https://github.com/evanw/esbuild)、[React](https://github.com/facebook/react)、[Zod](https://github.com/colinhacks/zod) 等工具与依赖。

自有且未另行标注的代码采用 [MIT](LICENSE)。依赖保持各自许可。`dsh-pet` 的动画及相关素材适用来源项目的素材条款，不适用本仓库代码的 MIT：允许开源使用、禁止商用；介绍、展示或分发衍生作品时需附原作者 GitHub 地址。具体来源、处理方式与声明见随角色包保留的 [NOTICE.txt](role-packs/dsh-pet-maid/NOTICE.txt) 和[来源项目许可说明](https://github.com/PC2005-cloud/dsh-pet#许可)。

## AI 使用声明与维护说明

本项目使用 AI 辅助编写代码、排查问题和整理文档。AI 生成内容可能存在错误，使用和修改时请结合源码、工具输出及设备实际表现判断。

欢迎复刻、学习、提出问题、提交改进或自行维护分支。本人精力有限，后续可能无法持续维护，也无法保证问题响应和更新时限。建议保存使用的插件与固件版本，并遵守源码及第三方素材的许可。
