import type { EspBuddySettings, EspBuddyStatus } from '../contract.ts'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

/** 不可写的页面仍能显示状态；区分加载过程、远程限制与配置来源不可用。 */
export function configNotice(state: Pick<ConfigFormSnapshot<unknown>, 'status' | 'mode' | 'writable'>):
  'config.loading' | 'config.memory' | 'config.unavailable' | 'config.readonly' | undefined {
  if (state.mode === 'memory') return 'config.memory'
  if (state.status === 'loading') return 'config.loading'
  if (state.status === 'unavailable') return 'config.unavailable'
  if (!state.writable) return 'config.readonly'
  return undefined
}

/** 按字段存在性清除覆盖，保留未知字段；覆盖值等于继承值时也须移除。 */
export function inheritedConfigOps(user: unknown) {
  if (user === null || typeof user !== 'object' || Array.isArray(user)) return []
  const fields: (keyof EspBuddySettings)[] = ['enabled', 'autoConnect', 'deviceAddress', 'approvalTimeoutMs', 'heartbeatIntervalMs', 'rolePackWriteDelayMs']
  return fields.filter(field => Object.hasOwn(user, field))
    .map(field => ({ op: 'unset' as const, path: [field] }))
}

export type ConnectionTone = 'idle' | 'connected' | 'error'

export function connectionTone(status: EspBuddyStatus | undefined, statusUnavailable = false): ConnectionTone {
  if (statusUnavailable) return 'error'
  if (status?.connected) return 'connected'
  if (status?.everConnected || status?.lastError !== undefined || status?.helperState === 'blocked') return 'error'
  return 'idle'
}

export function formatDiagnostics(
  status: EspBuddyStatus,
  settings: EspBuddySettings,
  generatedAt = new Date().toISOString(),
  pluginVersion = 'unknown',
): string {
  const rolePack = status.rolePack ?? { phase: 'idle', sentBytes: 0, totalBytes: 0 }
  const connection = status.connected
    ? '已连接'
    : status.everConnected
      ? '已断开（此前曾连接成功）'
      : '未连接（尚未连接成功）'
  const value = (input: string | number | undefined, fallback: string | number = '未记录') => input ?? fallback
  const recommendations: string[] = []

  if (!settings.enabled) {
    recommendations.push('插件当前已关闭；启用后才会启动 BLE 连接和硬件审批转发。')
  } else if (!status.connected) {
    if (status.helperState === 'stopped') recommendations.push('连接进程未运行；检查插件是否已启用，然后点击“重新连接”。')
    if (status.helperState === 'blocked') recommendations.push('连接进程因连续失败被阻止重启；记录最近错误后重启 DSH，再重新连接。')
    if (status.helperState === 'backoff') recommendations.push('连接进程正在退避重试；等待下一次扫描，并保留最近错误用于定位。')
    if (settings.autoConnect) recommendations.push('确认 ESP32 已上电并广播 NUS 服务；多台设备时填写目标 BLE 设备地址。')
    else recommendations.push('自动连接已关闭；开启后等待扫描，或使用“重新连接”手动发起一次连接。')
  }
  if (status.lastError !== undefined) recommendations.push('优先结合“最近错误”检查 Windows 蓝牙配对、设备广播和 BLE 服务状态。')
  if (rolePack.phase === 'failed') recommendations.push('角色包发送失败；检查角色包错误、BLE 连接是否保持，以及文件规格限制。')
  if (recommendations.length === 0) recommendations.push('未发现需要立即处理的异常；如问题仍可复现，请补充复现步骤和 ESP32 串口日志。')

  return [
    'ESP Buddy 诊断信息',
    `生成时间 (UTC): ${generatedAt}`,
    `插件版本: ${pluginVersion}`,
    '',
    '## 连接与 Helper',
    `连接状态: ${connection}`,
    `连接进程: ${status.helperState}`,
    `设备: ${value(status.device, '未发现')}`,
    `BLE MTU: ${value(status.mtu, '未协商')}`,
    `最近状态帧: ${value(status.lastStatusAt)}`,
    `最近接收: ${value(status.lastRxAt)}`,
    `最近发送: ${value(status.lastTxAt)}`,
    `最近错误: ${value(status.lastError, '无')}`,
    '',
    '## DSH 会话',
    `会话数: ${status.sessions}`,
    `运行中: ${status.running}`,
    `待审批: ${status.waiting}`,
    `Token: ${status.tokens}`,
    '',
    '## 角色包',
    `阶段: ${rolePack.phase}`,
    `角色包: ${value(rolePack.packName)}`,
    `当前文件: ${value(rolePack.file)}`,
    `进度: ${rolePack.sentBytes}/${rolePack.totalBytes} 字节`,
    `协议: V${value(rolePack.protocolVersion, 2)}`,
    `窗口: ${value(rolePack.windowSize)}`,
    `速度: ${value(rolePack.bytesPerSecond === undefined ? undefined : `${Math.round(rolePack.bytesPerSecond)} B/s`)}`,
    `预计剩余: ${value(rolePack.remainingMs === undefined ? undefined : `${Math.ceil(rolePack.remainingMs / 1_000)} 秒`)}`,
    `错误: ${value(rolePack.error, '无')}`,
    `最近安装角色包: ${value(status.lastInstalledRolePack, '无')}`,
    '',
    '## 配置',
    `插件启用: ${settings.enabled ? '是' : '否'}`,
    `自动连接: ${settings.autoConnect ? '是' : '否'}`,
    `设备地址: ${settings.deviceAddress || '自动选择唯一 NUS 设备'}`,
    `审批超时: ${settings.approvalTimeoutMs / 1_000} 秒`,
    `状态心跳: ${settings.heartbeatIntervalMs / 1_000} 秒`,
    '',
    '## 建议',
    ...recommendations.map((item, index) => `${index + 1}. ${item}`),
    '',
    '未包含会话内容、审批内容或角色包文件数据。',
  ].join('\n')
}
