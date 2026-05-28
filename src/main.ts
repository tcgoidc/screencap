import {
  assertAppSettings,
  defaultSettings,
  defaultShortcutHint,
  supportedTextFonts,
  validateShortcut,
  type AppSettings,
} from './settings-contract.js'
import { APP_CREDITS_LABEL, APP_VERSION_LABEL } from './app-meta.js'
import { getTauriUnavailableMessage, invokeTauri, isTauriRuntimeAvailable } from './tauri-runtime.js'
import './styles.css'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Main app root was not found')
}

const textFontOptions = supportedTextFonts
  .map((fontFamily) => `<option value="${fontFamily}">${fontFamily}</option>`)
  .join('')

app.innerHTML = `
  <main class="main-panel">
    <h1>Screencap Settings</h1>
    <p>Configure the global hotkey and default editor behavior used when the overlay opens.</p>
    <div class="status-row">
      <span class="status-chip">Tray and hotkey active</span>
      <span class="status-chip">Overlay export ready</span>
      <span class="status-chip">Annotation defaults persisted</span>
    </div>
    <form class="settings-form" id="settings-form">
      <label class="settings-field">
        <span>Global shortcut</span>
        <input class="settings-input" id="shortcut" type="text" placeholder="CmdOrCtrl+Shift+A" />
        <small class="settings-hint" id="shortcut-hint">Use a Tauri shortcut string such as CmdOrCtrl+Shift+A.</small>
      </label>
      <label class="settings-field">
        <span>Default tool</span>
        <select class="settings-input" id="default-tool">
          <option value="select">Select</option>
          <option value="rectangle">Rectangle</option>
          <option value="arrow">Arrow</option>
          <option value="text">Text</option>
          <option value="blur">Blur</option>
        </select>
      </label>
      <label class="settings-field settings-field-inline">
        <span>Default color</span>
        <input class="settings-color" id="annotation-color" type="color" value="#5ce1a6" />
      </label>
      <label class="settings-field">
        <span>Stroke width</span>
        <input class="settings-range" id="stroke-width" type="range" min="2" max="10" step="1" value="4" />
        <strong class="settings-value" id="stroke-width-value">4px</strong>
      </label>
      <label class="settings-field">
        <span>Text size</span>
        <input class="settings-range" id="font-size" type="range" min="16" max="48" step="2" value="24" />
        <strong class="settings-value" id="font-size-value">24px</strong>
      </label>
      <label class="settings-field">
        <span>Text font</span>
        <select class="settings-input" id="text-font-family">${textFontOptions}</select>
      </label>
      <label class="settings-field settings-field-inline">
        <span>Text background</span>
        <input class="settings-color" id="text-background-color" type="color" value="#0f1726" />
      </label>
      <label class="settings-field settings-field-inline">
        <span>Text border color</span>
        <input class="settings-color" id="text-border-color" type="color" value="#f8fafc" />
      </label>
      <label class="settings-field">
        <span>Text border size</span>
        <input class="settings-range" id="text-border-size" type="range" min="0" max="8" step="1" value="0" />
        <strong class="settings-value" id="text-border-size-value">0px</strong>
      </label>
      <div class="settings-actions">
        <button class="button button-primary" id="save-settings" type="submit">Save settings</button>
        <button class="button button-secondary" id="reset-settings" type="button">Reset to defaults</button>
      </div>
      <p class="settings-status" id="settings-status">Loading settings...</p>
    </form>
    <footer class="app-version-footer">
      <span class="app-version-badge">${APP_VERSION_LABEL}</span>
      <span class="app-version-credit">${APP_CREDITS_LABEL}</span>
    </footer>
  </main>
`

const settingsForm = document.querySelector<HTMLFormElement>('#settings-form')
const shortcutInput = document.querySelector<HTMLInputElement>('#shortcut')
const defaultToolInput = document.querySelector<HTMLSelectElement>('#default-tool')
const annotationColorInput = document.querySelector<HTMLInputElement>('#annotation-color')
const strokeWidthInput = document.querySelector<HTMLInputElement>('#stroke-width')
const strokeWidthValue = document.querySelector<HTMLElement>('#stroke-width-value')
const fontSizeInput = document.querySelector<HTMLInputElement>('#font-size')
const fontSizeValue = document.querySelector<HTMLElement>('#font-size-value')
const textFontFamilyInput = document.querySelector<HTMLSelectElement>('#text-font-family')
const textBackgroundColorInput = document.querySelector<HTMLInputElement>('#text-background-color')
const textBorderColorInput = document.querySelector<HTMLInputElement>('#text-border-color')
const textBorderSizeInput = document.querySelector<HTMLInputElement>('#text-border-size')
const textBorderSizeValue = document.querySelector<HTMLElement>('#text-border-size-value')
const resetSettingsButton = document.querySelector<HTMLButtonElement>('#reset-settings')
const settingsStatus = document.querySelector<HTMLParagraphElement>('#settings-status')
const shortcutHint = document.querySelector<HTMLElement>('#shortcut-hint')

if (
  !settingsForm ||
  !shortcutInput ||
  !defaultToolInput ||
  !annotationColorInput ||
  !strokeWidthInput ||
  !strokeWidthValue ||
  !fontSizeInput ||
  !fontSizeValue ||
  !textFontFamilyInput ||
  !textBackgroundColorInput ||
  !textBorderColorInput ||
  !textBorderSizeInput ||
  !textBorderSizeValue ||
  !resetSettingsButton ||
  !settingsStatus ||
  !shortcutHint
) {
  throw new Error('Settings controls are incomplete')
}


const renderShortcutValidation = (shortcut: string) => {
  const validationMessage = validateShortcut(shortcut.trim())

  shortcutInput.setAttribute('aria-invalid', validationMessage ? 'true' : 'false')
  shortcutInput.classList.toggle('settings-input-invalid', Boolean(validationMessage))
  shortcutHint.textContent = validationMessage ?? defaultShortcutHint
  shortcutHint.classList.toggle('settings-hint-error', Boolean(validationMessage))

  return validationMessage
}

const applySettingsToForm = (settings: AppSettings) => {
  shortcutInput.value = settings.shortcut
  defaultToolInput.value = settings.defaultTool
  annotationColorInput.value = settings.annotationColor
  strokeWidthInput.value = String(settings.strokeWidth)
  fontSizeInput.value = String(settings.fontSize)
  textFontFamilyInput.value = settings.textFontFamily
  textBackgroundColorInput.value = settings.textBackgroundColor
  textBorderColorInput.value = settings.textBorderColor
  textBorderSizeInput.value = String(settings.textBorderSize)
  strokeWidthValue.textContent = `${settings.strokeWidth}px`
  fontSizeValue.textContent = `${settings.fontSize}px`
  textBorderSizeValue.textContent = `${settings.textBorderSize}px`
  renderShortcutValidation(settings.shortcut)
}

const readSettingsFromForm = (): AppSettings => ({
  shortcut: shortcutInput.value.trim() || defaultSettings.shortcut,
  defaultTool: defaultToolInput.value as AppSettings['defaultTool'],
  annotationColor: annotationColorInput.value,
  strokeWidth: Number(strokeWidthInput.value),
  fontSize: Number(fontSizeInput.value),
  textFontFamily: textFontFamilyInput.value as AppSettings['textFontFamily'],
  textBackgroundColor: textBackgroundColorInput.value,
  textBorderColor: textBorderColorInput.value,
  textBorderSize: Number(textBorderSizeInput.value),
})

const loadSettings = async () => {
  settingsStatus.textContent = 'Loading settings...'

  try {
    const settings = assertAppSettings(await invokeTauri<unknown>('get_settings'))
    applySettingsToForm(settings)
    settingsStatus.textContent = 'Settings loaded.'
  } catch (error) {
    applySettingsToForm(defaultSettings)
    settingsStatus.textContent = isTauriRuntimeAvailable()
      ? `Failed to load settings: ${String(error)}`
      : getTauriUnavailableMessage('Settings commands')
  }
}

strokeWidthInput.addEventListener('input', () => {
  strokeWidthValue.textContent = `${strokeWidthInput.value}px`
})

fontSizeInput.addEventListener('input', () => {
  fontSizeValue.textContent = `${fontSizeInput.value}px`
})

textBorderSizeInput.addEventListener('input', () => {
  textBorderSizeValue.textContent = `${textBorderSizeInput.value}px`
})

shortcutInput.addEventListener('input', () => {
  renderShortcutValidation(shortcutInput.value)
})

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const nextSettings = readSettingsFromForm()
  const shortcutError = renderShortcutValidation(nextSettings.shortcut)

  if (shortcutError) {
    settingsStatus.textContent = shortcutError
    return
  }

  settingsStatus.textContent = 'Saving settings...'

  try {
    const savedSettings = assertAppSettings(await invokeTauri<unknown>('save_settings', {
      settings: nextSettings,
    }))
    applySettingsToForm(savedSettings)
    settingsStatus.textContent = 'Settings saved.'
  } catch (error) {
    settingsStatus.textContent = `Failed to save settings: ${String(error)}`
  }
})

resetSettingsButton.addEventListener('click', async () => {
  settingsStatus.textContent = 'Resetting settings...'

  try {
    const resetSettings = assertAppSettings(await invokeTauri<unknown>('reset_settings'))
    applySettingsToForm(resetSettings)
    settingsStatus.textContent = 'Settings reset to defaults.'
  } catch (error) {
    settingsStatus.textContent = `Failed to reset settings: ${String(error)}`
  }
})

void loadSettings()