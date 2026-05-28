import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'
import { save as tauriSave } from '@tauri-apps/plugin-dialog'

const tauriInternals = () => {
  const runtime = (globalThis as { __TAURI_INTERNALS__?: { invoke?: unknown; transformCallback?: unknown } }).__TAURI_INTERNALS__
  return runtime ?? null
}

export const isTauriRuntimeAvailable = () => Boolean(tauriInternals() && typeof tauriInternals()?.invoke === 'function')

export const getTauriUnavailableMessage = (feature: string) =>
  `${feature} is only available inside the Tauri desktop runtime.`

export const invokeTauri = async <T>(command: string, args?: Record<string, unknown>) => {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(getTauriUnavailableMessage('This action'))
  }

  return tauriInvoke<T>(command, args)
}

export const listenTauri = async (...args: Parameters<typeof tauriListen>) => {
  const runtime = tauriInternals()

  if (!runtime || typeof runtime.transformCallback !== 'function') {
    return () => {}
  }

  return tauriListen(...args)
}

export const saveWithTauriDialog = async (...args: Parameters<typeof tauriSave>) => {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(getTauriUnavailableMessage('Save dialog'))
  }

  return tauriSave(...args)
}