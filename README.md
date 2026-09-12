# dsh-esp-buddy

`dsh-esp-buddy` 是 DeepSeek Harness 的 Cordis 插件：它把会话数量、Token/Context 汇总值和
审批请求发送到 ESP32-S3 Buddy，并将设备上的审批结果送回 Harness。Windows x64 发布包内置蓝牙辅助程序，运行时不需要
Python 环境。

## 已验证版本

- DeepSeek Harness：`0.1.1-rc.2`
- Cordis：`4.0.1`
- Node.js：`>=20`
- Windows：x64（内置蓝牙辅助程序）
- ESP 固件：[WayAero/esp32s3_buddy](https://github.com/WayAero/esp32s3_buddy)

Linux x64 与 macOS arm64 已保留启动代码，但当前包尚未提供对应的辅助程序。

## 本地构建与验证

```powershell
npm test
npm run test:python
npm run build
npm run build:helper:windows
npm pack
```

蓝牙辅助程序的源码运行和重新打包需要 Python、Bleak 与 PyInstaller；安装后的 Windows
x64 插件直接使用 `bin/win32-x64/buddy-ble.exe`。

## 安装

在项目目录执行 `npm pack`，然后将生成的 tgz 安装到所需 DSH profile：

```powershell
dsh plugin --profile web add .\dsh-esp-buddy-0.4.1.tgz
dsh web
```

从 Git 源安装时，包内 `prepare` 会自动构建 `dist`。pnpm 11 如果阻止 Git 依赖执行构建，会在输出中给出
需要加入 profile `pnpm-workspace.yaml` 的精确 `allowBuilds` 键；按该提示授权后重试即可。

插件默认启用并自动连接名称以 `Claude` 开头、且提供 Nordic UART Service 的 Buddy。
首次连接使用固件的 Secure Connections + MITM 配置；Windows 需要先在系统蓝牙界面完成配对。

## 设置与状态

安装到 Web profile 后，从 DSH 设置左侧的“ESP Buddy”进入完整设置页，其中提供：

- 启用/停用插件，以及自动连接开关；
- BLE 连接状态、设备名、MTU、蓝牙辅助程序状态和最近收发时间；
- 当前会话数、运行数、待审批数和 Token 聚合值；
- 重新连接与复制诊断信息；
- BLE 设备名前缀、审批超时和状态发送间隔。

“设置 → 插件 → 插件配置”中的 ESP Buddy 项仅显示当前版本和移除操作，避免与外部设置页重复。

配置写入 `%USERPROFILE%\.dsh\settings.yaml` 的 `esp-buddy` 配置段，并实时生效。修改设备名前缀
或状态发送间隔会重启蓝牙辅助程序；修改审批超时只影响之后收到的新请求。页面每 2 秒刷新一次状态。

连接圆点按以下规则显示：已连接为绿色；从未连接成功且没有连接错误时为白色；连接失败，或曾连接成功后
断开时为红色。诊断信息提供版本、连接与蓝牙辅助程序状态、最近错误、角色包进度、配置和针对性排查建议，
不包含会话内容、审批内容或角色包文件数据。

## 角色包发送

在 ESP Buddy 设置页的“角色包”区域选择或拖入一个角色包目录。角色包必须为扁平目录，并至少包含
`manifest.json` 与 `idle.gif`；可选动画固定为 `busy.gif`、`attention.gif`、`sleep.gif`。单文件原始字节
不得超过 229,376，实际发送文件的原始字节总和不得超过 1,800,000；`NOTICE.txt` 会随角色包传输，仅用于保留授权声明。

角色包只使用 V2：`char_begin` 携带 `v:2` 和窗口请求 `4`，每个窗口最多连续发送四个 512 原始字节块，
再等待 ESP 返回累计 ACK。`char_begin`、`file`、`file_end`、`char_end`、`char_abort` 使用 FIFO 和
write-with-response；`chunk` 使用 FIFO 和 write-without-response。状态快照只保留最新一条，并在窗口 ACK
后、下一窗口开始前发送，因此审批提示和必要心跳不必等待整个角色包完成。旧固件若对 V2 返回 `ok:true,n:0`，
插件会停止并提示升级固件，不会改用 V1。
断线、超时或负 ACK 会明确失败并清理传输；设置页可取消传输，成功后清除进度并显示当前 DSH 进程内最近安装的角色包名。

发布包附带 `role-packs/dsh-pet-maid` 示例包。其动画素材来自
[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，按作者说明仅可开源使用、禁止商用；
详情见包内 `NOTICE.txt` 与 [归属说明](docs/dsh-pet-role-pack-attribution.md)。插件代码采用 MIT，
不改变该第三方素材的限制。

示例包含 `idle.gif`、`attention.gif`、`busy.gif` 和 `sleep.gif`。新增或重新制作角色 GIF 时，以
`84×84、≤80 帧、约 8 FPS、≤210 KiB、≤64 色` 作为单文件推荐上限；单文件协议硬上限为 `224 KiB`。背景统一填充 Buddy 角色卡背景色
`#17181C`，平坦背景不使用抖动。此前 84×84、120 帧、
472,276 字节的 GIF 在 ESP32 实机上会伴随 LVGL lock 超时和屏幕卡死，因此不得继续作为制作规格。
当前随包四个 GIF 为 84×84、80 帧、约 8 FPS、64 色，单文件约 193–203 KiB。配套 ESP32 固件按 Buddy 状态选择固定文件名对应的动画；插件不发送 `animation` 字段。

Write Without Response 的 ATT 载荷在连接后取 `min(244, rx_characteristic.max_write_without_response_size)`；
Helper 会输出本次传输的原始数据量、线上字节数、ATT 写次数、两种写入次数、BLE 写入耗时、行级节流耗时、
调度间隙、ACK 等待耗时、未统计时间和有效原始吞吐。无响应写入只在完整 JSONL 数据块后节流一次，避免 Windows
将每个 ATT 分片的短暂休眠放大为明显传输延迟。角色包数据块默认不额外等待，以优先保证实际吞吐。
设置页显示百分比、当前文件、已完成文件数、速度和预计剩余时间；速度与预计时间按最近 5 秒的已确认原始字节计算，
不使用 Base64 或 ATT 字节数，也不显示协议版本或窗口值。发送期间页面会提示保持连接并耐心等待。

2026-09-12 使用配套 V2 固件发送 `dsh-pet-maid` 的 814,935 原始字节已完成安装，实测有效原始吞吐为
19.0 KiB/s，8 FPS 动画画面稳定。实际速度仍受 Windows 蓝牙适配器、连接参数和环境影响。

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
```

设备离线、蓝牙辅助程序启动失败或 BLE 断线不会自动拒绝工具调用；插件将审批请求交回 Harness
继续处理。状态快照使用 V2，新增的 `usage`、`context` 与 `context_breakdown` 可供设备显示上下文占用。
其中 `context.projected` 是下一次请求上下文的估算值，`context.window` 是路由提供的上限；字段缺失时设备应显示不可用。
其中 `tokens_today` 仅为兼容旧解析保留；Harness 没有精确日统计时其值为 `0`，设备界面不得将它显示为真实日用量。

## 通信内容与处理范围

- 上位机（Host）→ ESP：UTF-8 JSONL 状态快照固定使用 Buddy V2；V1 既有字段仍保留，`tokens_today` 仅供旧解析兼容。
- ESP → 上位机：仅接受当前审批请求 ID 的 `once` 或 `deny`。
- 多个会话的状态由 Harness 汇总；多个审批请求按收到顺序排队，屏幕一次只显示一个。
- 蓝牙辅助程序只负责扫描、连接、NUS 收发、分片和重连，不处理会话、Token 或审批。

Windows 实机已验证设置页、自动连接、状态显示、每 3 秒发送状态、Allow Once 与 Deny 回传。多个会话、
Token/Context 汇总及审批排队由无硬件测试覆盖；当前发布包尚未提供 Linux/macOS 的辅助程序。
