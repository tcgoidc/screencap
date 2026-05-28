export const supportedTextFonts = ['Segoe UI', 'Georgia', 'Consolas', 'Trebuchet MS'] as const

export type TextFontFamily = (typeof supportedTextFonts)[number]

export type AppSettings = {
  shortcut: string
  defaultTool: 'select' | 'rectangle' | 'arrow' | 'text' | 'blur'
  annotationColor: string
  strokeWidth: number
  fontSize: number
  textFontFamily: TextFontFamily
  textBackgroundColor: string
  textBorderColor: string
  textBorderSize: number
}

export const defaultSettings: AppSettings = {
  shortcut: 'CmdOrCtrl+Shift+A',
  defaultTool: 'select',
  annotationColor: '#5ce1a6',
  strokeWidth: 4,
  fontSize: 24,
  textFontFamily: 'Segoe UI',
  textBackgroundColor: '#0f1726',
  textBorderColor: '#f8fafc',
  textBorderSize: 0,
}

const shortcutModifiers = new Set([
  'cmdorctrl',
  'command',
  'cmd',
  'control',
  'ctrl',
  'alt',
  'option',
  'shift',
  'super',
])

const shortcutNamedKeys = new Set([
  'space',
  'tab',
  'enter',
  'return',
  'escape',
  'esc',
  'backspace',
  'delete',
  'insert',
  'home',
  'end',
  'pageup',
  'pagedown',
  'up',
  'down',
  'left',
  'right',
])

export const defaultShortcutHint = 'Use a Tauri shortcut string such as CmdOrCtrl+Shift+A.'

export const validateShortcut = (shortcut: string) => {
  if (shortcut.length === 0) {
    return 'Shortcut is required.'
  }

  const segments = shortcut.split('+').map((segment) => segment.trim())

  if (segments.some((segment) => segment.length === 0)) {
    return 'Shortcut cannot contain empty key segments.'
  }

  const modifiers = new Set<string>()
  let primaryKeyCount = 0

  for (const segment of segments) {
    const normalized = segment.toLowerCase()

    if (shortcutModifiers.has(normalized)) {
      if (modifiers.has(normalized)) {
        return `Shortcut repeats modifier ${segment}.`
      }

      modifiers.add(normalized)
      continue
    }

    if (/^f([1-9]|1\d|2[0-4])$/i.test(segment) || /^[A-Za-z0-9]$/i.test(segment) || shortcutNamedKeys.has(normalized)) {
      primaryKeyCount += 1
      continue
    }

    return `Shortcut key ${segment} is not supported.`
  }

  if (modifiers.size === 0) {
    return 'Shortcut should include at least one modifier like CmdOrCtrl, Alt, or Shift.'
  }

  if (primaryKeyCount === 0) {
    return 'Shortcut must include one non-modifier key.'
  }

  if (primaryKeyCount > 1) {
    return 'Shortcut can only include one non-modifier key.'
  }

  return null
}

const isHexColor = (value: unknown) =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)

const isSupportedTextFont = (value: unknown): value is TextFontFamily =>
  typeof value === 'string' && supportedTextFonts.includes(value as TextFontFamily)

export const assertAppSettings = (settings: unknown): AppSettings => {
  if (!settings || typeof settings !== 'object') {
    throw new Error('Settings payload was not an object.')
  }

  const candidate = settings as Partial<AppSettings>
  const strokeWidth = candidate.strokeWidth
  const fontSize = candidate.fontSize
  const textBorderSize = candidate.textBorderSize

  if (typeof candidate.shortcut !== 'string' || validateShortcut(candidate.shortcut) !== null) {
    throw new Error('Settings payload contained an invalid shortcut.')
  }

  if (!candidate.defaultTool || !['select', 'rectangle', 'arrow', 'text', 'blur'].includes(candidate.defaultTool)) {
    throw new Error('Settings payload contained an invalid default tool.')
  }

  if (!isHexColor(candidate.annotationColor)) {
    throw new Error('Settings payload contained an invalid annotation color.')
  }

  if (typeof strokeWidth !== 'number' || !Number.isInteger(strokeWidth) || strokeWidth < 2 || strokeWidth > 10) {
    throw new Error('Settings payload contained an invalid stroke width.')
  }

  if (typeof fontSize !== 'number' || !Number.isInteger(fontSize) || fontSize < 16 || fontSize > 48) {
    throw new Error('Settings payload contained an invalid font size.')
  }

  if (!isSupportedTextFont(candidate.textFontFamily)) {
    throw new Error('Settings payload contained an invalid text font family.')
  }

  if (!isHexColor(candidate.textBackgroundColor)) {
    throw new Error('Settings payload contained an invalid text background color.')
  }

  if (!isHexColor(candidate.textBorderColor)) {
    throw new Error('Settings payload contained an invalid text border color.')
  }

  if (typeof textBorderSize !== 'number' || !Number.isInteger(textBorderSize) || textBorderSize < 0 || textBorderSize > 8) {
    throw new Error('Settings payload contained an invalid text border size.')
  }

  return candidate as AppSettings
}