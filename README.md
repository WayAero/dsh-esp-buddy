# dsh-esp-buddy

`dsh-esp-buddy` 是 DeepSeek Harness 的 Cordis 插件，将 Session、Token/Context 和
Approval 状态桥接到 ESP32-S3 Buddy。Windows x64 发布包内置 BLE helper，运行时不需要
Python 环境。

## 当前兼容基线

- DeepSeek Harness：`0.1.1-rc.2`
- Cordis：`4.0.1`
- Node.js：`>=20`
- Windows：x64（内置 helper）
- ESP 固件：[WayAero/esp32s3_buddy](https://github.com/WayAero/esp32s3_buddy)

Linux x64 与 macOS arm64 已保留启动路径，但当前包尚未提供对应 helper binary。

## 本地构建与验证

```powershell
npm test
npm run test:python
npm run build
npm run build:helper:windows
npm pack
```

Python helper 的源码运行和重新打包需要 Python、Bleak 与 PyInstaller；安装后的 Windows
x64 插件直接使用 `bin/win32-x64/buddy-ble.exe`。

## 安装

在项目目录执行 `npm pack`，然后将生成的 tgz 安装到所需 DSH profile：

```powershell
dsh plugin --profile web add .\dsh-esp-buddy-0.3.4.tgz
dsh web
```

插件默认启用并自动连接名称以 `Claude` 开头、且提供 Nordic UART Service 的 Buddy。
首次连接使用固件的 Secure Connections + MITM 配置；Windows 需要先在系统蓝牙界面完成配对。

## 设置与状态

安装到 Web profile 后，打开 DSH 的“设置 → 插件 → 插件配置”，找到“ESP Buddy”卡片。卡片提供：

- 启用/停用插件，以及自动连接开关；
- BLE 连接状态、设备名、MTU、Helper 状态和最近收发时间；
- 当前会话数、运行数、待审批数和 Token 聚合值；
- 重新连接与复制诊断信息；
- BLE 设备名前缀、审批超时和状态心跳配置。

配置写入 `%USERPROFILE%\.dsh\settings.yaml` 的 `esp-buddy` namespace，并实时生效。修改设备名前缀
或心跳周期会重启 BLE helper；修改审批超时只影响之后收到的新请求。页面每 2 秒刷新一次状态。

连接圆点使用三态语义：已连接为绿色；从未连接成功且没有连接错误时为白色；连接失败，或曾连接成功后
断开时为红色。复制的诊断信息可发送给 DeepSeek Harness、Codex 等 Agent 协助排查。

![ESP Buddy 设置页](docs/esp-buddy-settings-0.2.5.png)

![角色包发送完成](docs/esp-buddy-settings-0.3.0.png)

## 角色包发送

在 ESP Buddy 卡片的“角色包”区域选择或拖入一个角色包目录。当前固件只接受扁平目录，目录必须至少包含
`manifest.json` 与 `idle.gif`（或 `idle_0.gif`）；文件名最长 64 字节、总大小不超过 1,800,000 字节。
传输以 ESP 的 ACK 为边界逐命令推进，断线或负 ACK 会明确报错，不会在重连后继续发送陈旧命令。

发布包附带 `role-packs/dsh-pet-maid` 示例包。其动画素材来自
[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，按作者说明仅可开源使用、禁止商用；
详情见包内 `NOTICE.txt` 与 [归属说明](docs/dsh-pet-role-pack-attribution.md)。插件代码采用 MIT，
不改变该第三方素材的限制。

示例包含 `idle.gif`、`attention.gif`、`busy.gif` 和 `sleep.gif`。四个动画均针对小屏压缩为 84×84、
60 帧、64 色，合计约 598 KB。当前 ESP 固件只按固定优先级选择一个 GIF，存在 `idle.gif` 时不会自动切换
到其他状态动画；其余文件先作为完整角色包资源保留，状态驱动切换需要固件后续支持。

角色包命令使用固件允许的 512 原始字节块，以减少 ACK 往返次数。BLE 写入仍遵守实际特征值上限和 4 ms
分片间隔，避免用不可靠的激进参数换取表面速度。发送期间页面会提示保持连接并耐心等待。

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

设备离线、helper 启动失败或 BLE 断线不会自动拒绝工具调用；插件将 Approval 交回 Harness
的后续处理链。`tokens_today` 在 Harness 没有精确日统计时发送 `0`，不能视为真实零用量。

## 协议与安全边界

- Host → ESP：UTF-8 JSONL，兼容 Buddy V1，并附带可选 V2 usage/context 字段。
- ESP → Host：仅接受当前 Prompt ID 的 `once` 或 `deny`。
- 多 Session 由 Harness Agent 状态聚合；多个 Approval 使用 FIFO，一次只在屏幕显示一个。
- BLE helper 只负责 scan/connect/NUS/分片/重连，不理解 Harness 业务。

Windows 实机已验证设置页、自动连接、状态显示、3 秒 heartbeat、Allow Once 与 Deny 回传。多 Session、
Token/Context 聚合及 Approval FIFO 由无硬件测试覆盖；当前发布包尚未覆盖 Linux/macOS helper binary。
