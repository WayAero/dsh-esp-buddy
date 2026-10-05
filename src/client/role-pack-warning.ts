const WARNING_KEY = 'dsh-esp-buddy.role-pack.skip-spec-warning'

/** 只记住当前页面环境的提醒偏好，不修改 Host 配置或设备状态。 */
export function readSkipRolePackWarning(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(WARNING_KEY) === 'true'
}

export function saveSkipRolePackWarning(storage: Pick<Storage, 'setItem'>, skip: boolean): void {
  storage.setItem(WARNING_KEY, String(skip))
}
