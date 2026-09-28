# dsh-esp-buddy

`dsh-esp-buddy` 是 DeepSeek Harness 的 Cordis 插件。它把会话数量、Token 与上下文（Context）
汇总值、审批请求发送到 ESP32-S3 Buddy，并将设备上的审批结果交回 Harness。Windows x64 安装包内置
蓝牙辅助程序，运行时不需要 Python 环境。

## 运行环境

- `package.json` 声明支持 Node.js `>=20`，并依赖 DeepSeek Harness `^0.1.1-rc.2` 系列和 Cordis `^4.0.1`。
- Windows x64 安装包包含 `bin/win32-x64/buddy-ble.exe`；Linux x64 与 macOS arm64 有启动路径，包内尚无对应的辅助程序。
- ESP 固件：[WayAero/esp32s3_buddy](https://github.com/WayAero/esp32s3_buddy)

本地 `npm test` 和 `npm run test:hardware` 使用 `--experimental-strip-types`，因此需要 Node.js 22.6.0 或更新版本。
本轮无硬件检查使用 Node.js 24.19.0；`engines.node` 声明的 Node.js 20 运行兼容性未在本轮验证。
2026-09-12 的发布记录使用 DeepSeek Harness `0.1.1-rc.2`；它不代表后续版本或不同平台已经过实机验收。

## 本地构建与验证

```powershell
npm test
npm run test:python
npm run build
npm run build:helper:windows
npm pack
```

从源码运行蓝牙辅助程序需要 Python 和 Bleak；重新打包还需要 PyInstaller。安装后的 Windows x64 插件
直接运行 `bin/win32-x64/buddy-ble.exe`。`npm run test:hardware` 需要已配对的设备，并要求依次在设备上
选择 Allow Once 和 Deny；普通测试不连接硬件。

## 安装

在项目目录执行 `npm pack`，然后将生成的 tgz 安装到所需 DSH profile：

```powershell
dsh plugin --profile web add .\dsh-esp-buddy-0.4.1.tgz
dsh web
```

从 Git 源安装时，需要让包管理器执行 `prepare` 来构建 `dist`。若安装环境禁止依赖包的构建脚本，
可先在本仓库执行 `npm pack`，再安装生成的 tgz。

插件默认启用，自动连接名称以 `Claude` 开头、且提供 Nordic UART Service（NUS）的 Buddy。
首次连接使用固件的安全连接（Secure Connections）与中间人保护（MITM）配置；Windows 需要先在系统蓝牙界面完成配对。

## 设置与状态

安装到 Web profile 后，从 DSH 设置左侧的“ESP Buddy”进入完整设置页，其中提供：

- 启用/停用插件，以及自动连接开关；
- BLE 连接状态、设备名、MTU、蓝牙辅助程序状态和最近收发时间；
- 当前会话数、运行数、待审批数和 Token 聚合值；
- 重新连接与复制诊断信息；
- BLE 设备名前缀、审批超时和状态发送间隔。

“设置 → 插件 → 插件配置”中的 ESP Buddy 项仅显示当前版本和移除操作，避免与外部设置页重复。

配置写入 `%USERPROFILE%\.dsh\settings.yaml` 的 `esp-buddy` 配置段。修改设备名前缀或状态发送间隔会
重启蓝牙辅助程序；修改审批超时只影响之后收到的新请求。页面每 2 秒读取一次状态。

连接圆点按以下规则显示：已连接为绿色；从未连接成功且没有连接错误时为白色；连接失败，或曾连接成功后
断开时为红色。诊断信息提供版本、连接与蓝牙辅助程序状态、最近错误、角色包进度、配置和针对性排查建议，
不包含会话内容、审批内容或角色包文件数据。

## 角色包发送

在 ESP Buddy 设置页的“角色包”区域选择或拖入一个角色包目录。目录不能包含子目录；`manifest.json` 的
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

设备离线、蓝牙辅助程序启动失败或 BLE 断线时，插件把尚未决定的审批请求交给 Harness 后续处理链，
不会自行拒绝。状态快照使用 V2，`usage`、`context` 与 `context_breakdown` 在有数据时加入消息。
`context.projected` 是下一次请求上下文的估算值，`context.window` 是路由提供的上限；字段缺失表示没有可用值。
`tokens_today` 为兼容旧解析保留；没有精确日统计时写入 `0`，不能将其当作真实日用量。

## 通信内容与处理范围

- 上位机（Host）→ ESP：UTF-8 JSONL 状态快照固定使用 Buddy V2，并保留 V1 既有字段。
- ESP → 上位机：仅接受当前审批请求 ID 的 `once` 或 `deny`。
- 多个会话的状态由 Harness 汇总；多个审批请求按收到顺序排队，屏幕一次只显示一个。
- 蓝牙辅助程序只负责扫描、连接、NUS 收发、分片和重连，不处理会话、Token 或审批。

2026-09-12 的 Windows 实机记录覆盖设置页、自动连接、状态显示、默认每 3 秒发送状态以及 Allow Once 与
Deny 回传。本仓库的无硬件测试覆盖多个会话、Token 与上下文汇总及审批排队；这些测试不能代替当前固件和
设备上的验收。
