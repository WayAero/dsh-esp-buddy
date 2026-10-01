# dsh-esp-buddy

`dsh-esp-buddy` 是 DeepSeek Harness 的 Cordis 插件。它把会话数量、Token 与上下文（Context）
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

在项目目录执行 `npm pack`，生成 `dsh-esp-buddy-0.5.0-rc.1.tgz`。在 Windows x64 的 Desktop 或 Web
profile 中打开官方“插件（Plugins）”页面，用“添加插件”填写该压缩包的绝对路径；同一压缩包可分别安装到两个
profile。安装后在该页面启用组合包及 `esp-buddy` 行，之后也在该页面管理或卸载，无需插件自行执行卸载命令。

安装时 pnpm 可能报告缺少 `@deepseek-ai/cordis` 和 DSH 包的 peer 依赖：rc.2 的 profile 默认关闭自动补装，Harness 在运行时提供这些包。若只是这组缺失提示且插件显示“运行中”，无需在 profile 手动补装；版本不兼容或组件加载失败应检查具体错误。

从 Git 源安装时，需要让包管理器执行 `prepare` 来构建 `dist`。若安装环境禁止依赖包的构建脚本，
可先在本仓库执行 `npm pack`，再安装生成的 tgz。

`esp-buddy` 行的配置默认启用；在插件管理页启用组合包和该行后，会自动连接名称以 `Claude` 开头、且提供
Nordic UART Service（NUS）的 Buddy。
首次连接使用固件的安全连接（Secure Connections）与中间人保护（MITM）配置；Windows 需要先在系统蓝牙界面完成配对。

## 设置与状态

在“插件（Plugins）”页面打开 `dsh-esp-buddy` 组合包的 `esp-buddy` 行，再打开其“配置”页面。Desktop
和 Web profile 各自管理自己的安装与配置。配置页提供：

- 启用/停用插件，以及自动连接开关；
- BLE 连接状态、设备名、MTU、蓝牙辅助程序状态和最近收发时间；
- 当前会话数、运行数、待审批数和 Token 聚合值；
- 重新连接与复制诊断信息；
- BLE 设备名前缀、审批超时和状态发送间隔。

编辑字段后点击“保存”，配置编辑器（ConfigEditor）会写入当前 profile 的 `cordis.patch.yml` 并交由
Loader 应用；离开页面时，未保存的草稿会丢弃。修改设备名前缀、状态发送间隔或角色包写入间隔会重启
蓝牙辅助程序；修改审批超时只影响之后收到的新请求。配置页每 2 秒读取一次状态。

连接圆点按以下规则显示：已连接为绿色；从未连接成功且没有连接错误时为白色；连接失败，或曾连接成功后
断开时为红色。诊断信息提供版本、连接与蓝牙辅助程序状态、最近错误、角色包进度、配置和针对性排查建议，
不包含会话内容、审批内容或角色包文件数据。

## 审批

会话审批使用 Harness 官方卡片，插件不提供替代卡片。

Buddy 在线时，请求同时进入设备队列和 Harness 后续应答链。官方页面先答时清除设备请求；设备先答时，客户端
通过会话状态读取对应的官方 `PendingApproval`，使用公开 `answer()` 完成卡片。客户端每 250 ms 同步已有卡片；
页面清除还取决于请求传输和应答处理时间。没有 `callId` 且会话、工具名、原因相同的请求按顺序转发到页面，避免误匹配。

设备离线、辅助程序失败、审批超时或插件停用时，未决定的请求继续已经开始的 Harness 应答链，不重复调用
后续应答者，也不自动拒绝。Desktop 与 Web 双端提示同步、Web 允许 / 拒绝的实际操作结果，以及断线后页面审批和重连清理已获用户实测确认。安装新版候选包后刷新或重启客户端。

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
帧率超限的 GIF，单文件字节数硬上限为 `224 KiB`。背景统一填充 Buddy 角色卡背景色 `#17181C`，平坦背景
不使用抖动。此前 84×84、120 帧、472,276 字节的 GIF 曾在 ESP32 实机上伴随 LVGL lock 超时和屏幕卡死，
因此不作为制作规格。
当前随包四个 GIF 为 84×84、80 帧、约 8 FPS、64 色，单文件约 193–203 KiB。配套 ESP32 固件按 Buddy 状态选择固定文件名对应的动画；插件不发送 `animation` 字段。

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
        deviceNamePrefix: Claude
        rolePackWriteDelayMs: 0
```

状态快照使用 V2，`usage`、`context` 与 `context_breakdown` 在有数据时加入消息。
`context.projected` 是下一次请求上下文的估算值，`context.window` 是路由提供的上限；字段缺失表示没有可用值。
`tokens_today` 为兼容旧解析保留；没有精确日统计时写入 `0`，不能将其当作真实日用量。

## 通信内容与处理范围

- 上位机（Host）→ ESP：UTF-8 JSONL 状态快照固定使用 Buddy V2，并保留 V1 既有字段。
- ESP → 上位机：仅接受仍待处理的审批请求 ID 的 `once` 或 `deny`；页面决定由 Remote 发往同一 Host。
- 多个会话的状态由 Harness 汇总；多个审批请求按收到顺序排队，屏幕一次只显示一个，会话页面只显示所属会话的请求。
- 蓝牙辅助程序只负责扫描、连接、NUS 收发、分片和重连，不处理会话、Token 或审批。

历史实机记录（2026-09-12）：当时的 Windows 版本覆盖设置页、自动连接、状态显示、默认每 3 秒发送状态
以及 Buddy 的 Allow Once 与 Deny 回传。此记录不覆盖当前 rc.2 的 Desktop/Web 配置页或会话审批卡片。
本仓库的无硬件测试覆盖多个会话、Token 与上下文汇总、官方卡片与 Buddy 的决定同步、会话隔离和取消清理；
模拟设备回复不能代替实机结果。
