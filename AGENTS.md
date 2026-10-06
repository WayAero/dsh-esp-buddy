# Agent 开发指南

本仓库是 DeepSeek Harness 的 `dsh-esp-buddy` Cordis 插件。用户上手见 [README.md](README.md)，架构、协议与构建见 [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md)。

## 环境与入口

- Node.js `>=22`，宿主接口面向 DeepSeek Harness `0.2.0-rc.2`、Cordis `~4.0.4`；依赖以 `package.json` 与 `package-lock.json` 为准。
- `npm ci` 安装依赖并通过 `prepare` 构建；`npm run build` 生成主机端和客户端；`npm pack` 生成安装包。
- Windows x64 包内置 `bin/win32-x64/buddy-ble.exe`。修改 `helper/buddy_ble.py` 后，在安装 Bleak 和 PyInstaller 的 Windows x64 Python 环境执行 `npm run build:helper:windows`。

## 修改入口

| 任务 | 入口 |
| --- | --- |
| 宿主事件与连接安排 | `src/index.ts`、`src/transport/` |
| 会话、Token 与上下文 | `src/session/`、`src/projection/`、`src/state/` |
| 审批 | `src/approval/`、`src/client/official-approval.ts` |
| 配置与页面 | `src/config.ts`、`src/settings.ts`、`src/client/` |
| 主机与客户端接口 | `src/contract.ts`、`src/runtime.ts`、`src/typert.ts` |
| 设备消息与角色包 | `src/protocol/`、`src/role-pack/` |
| BLE 收发与分片 | `helper/buddy_ble.py` |
| 构建与包内容 | `build.mjs`、`scripts/build-helper-windows.ps1`、`package.json` |

## 实现约束

- 蓝牙辅助程序只负责扫描、连接、NUS 收发、分片与重连，不解释会话、Token 或审批内容。
- 按 NUS UUID 发现设备，名称只用于显示；多台候选必须指定地址，成功连接后不得因目标离线而换连其他设备。首次 Windows 配对由系统完成。
- 配置持久化使用 Harness `ConfigEditor`；共享字段与 Remote schema 集中维护，不另存第二份配置或接口定义。
- 连接启动、停止与重启串行执行。卸载时撤销定时器和监听，停止辅助程序并交接未决定的审批；旧连接的队列、ACK 与校时请求不能用于新连接。
- 设备离线、辅助程序失败、超时或停用不能自动拒绝审批。每个请求的 `next()` 只启动一次；设备回复必须匹配当前未结算的 ID；卡片同步使用官方公开 `answer()`。
- 状态发送只保留最新快照。角色包同一时刻只允许一次传输：控制命令逐条带响应写入并等待 ACK，数据块按窗口无响应写入并等待累计 ACK；窗口之间才发送最新状态。
- UTF-8 限制按字节计算，截断保留完整字符；未知统计保持缺失，不伪造日用量。校时发送成功不等于固件已应用时间。
- 制作建议只触发提醒；格式、文件名与协议范围错误应明确报错。第三方角色素材保留 `NOTICE.txt` 及来源限制。
- 修改用户操作时同步 README；修改机制时同步开发指南。API、字段、类型与配置键保留英文标识符，解释和非直观代码注释使用自然中文。

配套固件公开仓库为 [WayAero/esp32s3-buddy](https://github.com/WayAero/esp32s3-buddy)。涉及设备接收、存储或界面行为时核对该端实现，不在插件任务中默认修改另一仓库。
