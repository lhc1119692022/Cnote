/** Shared helpers for the Electron SafeStorage bridge.
 *
 * The Web Preview has no desktop bridge, so all helpers are intentionally
 * no-ops there. Callers still keep the current credential in memory and pass
 * it through the normal request headers for browser-based previewing.
 */

function desktopApi() {
  return typeof window !== 'undefined' ? window.cnoteDesktop : undefined
}

export function isDesktopRuntime() {
  return Boolean(desktopApi())
}

export function desktopSecretRef(header: string, name?: string) {
  if (!name || !desktopApi()) return undefined
  return { [header]: name }
}

/** Persist a credential before a request that may be used by the native path. */
export async function syncDesktopSecret(name: string | undefined, value: string | undefined) {
  const normalizedName = name?.trim()
  const normalizedValue = value?.trim()
  const desktop = desktopApi()
  if (!normalizedName || !normalizedValue || !desktop?.secrets) return false
  await desktop.secrets.set(normalizedName, normalizedValue)
  return true
}

/** Best-effort persistence for synchronous store actions. */
export function syncDesktopSecretInBackground(name: string | undefined, value: string | undefined) {
  void syncDesktopSecret(name, value).catch(() => undefined)
}

export async function ensureDesktopSecret(name: string | undefined, value?: string) {
  const normalizedName = name?.trim()
  const desktop = desktopApi()
  if (!normalizedName || !desktop?.secrets) return false
  if (value?.trim()) {
    await desktop.secrets.set(normalizedName, value.trim())
    return true
  }
  return desktop.secrets.has(normalizedName)
}

export async function deleteDesktopSecret(name: string | undefined) {
  const normalizedName = name?.trim()
  const desktop = desktopApi()
  if (!normalizedName || !desktop?.secrets) return
  await desktop.secrets.delete(normalizedName)
}
