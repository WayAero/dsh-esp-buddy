/** Marks the external settings row so bundled CSS can replace its generic gear. */
export const SETTINGS_NAV_MARKER = 'data-dsh-esp-buddy-settings-nav'

export function registerSettingsNavIcon(label: () => string): () => void {
  let disposed = false

  const sync = () => {
    if (disposed) return
    const currentLabel = label().trim()
    document.querySelectorAll<HTMLButtonElement>('[role="dialog"] nav button').forEach(button => {
      const matches = currentLabel.length > 0 && button.textContent?.trim() === currentLabel
      if (matches) button.setAttribute(SETTINGS_NAV_MARKER, '')
      else button.removeAttribute(SETTINGS_NAV_MARKER)
    })
  }

  sync()
  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  return () => {
    disposed = true
    observer.disconnect()
    document.querySelectorAll(`[${SETTINGS_NAV_MARKER}]`).forEach(element => element.removeAttribute(SETTINGS_NAV_MARKER))
  }
}
