import { assertAppSettings, defaultSettings, supportedTextFonts, validateShortcut } from '../src/settings-contract.js'

const test = (name: string, run: () => void) => {
  try {
    run()
    console.log(`ok - ${name}`)
  } catch (error) {
    console.error(`not ok - ${name}`)
    throw error
  }
}

const expect = (condition: unknown, message: string) => {
  if (!condition) {
    throw new Error(message)
  }
}

test('default settings preserve the expected starter shortcut and tool', () => {
  expect(defaultSettings.shortcut === 'CmdOrCtrl+Shift+A', 'expected the default shortcut to remain stable')
  expect(defaultSettings.defaultTool === 'select', 'expected the default tool to remain selection mode')
  expect(supportedTextFonts.includes(defaultSettings.textFontFamily), 'expected the default text font to remain supported')
})

test('shortcut validation accepts a standard accelerator', () => {
  expect(validateShortcut('CmdOrCtrl+Shift+A') === null, 'expected a standard accelerator to validate')
})

test('shortcut validation rejects repeated modifiers', () => {
  expect(
    validateShortcut('Ctrl+Ctrl+S') === 'Shortcut repeats modifier Ctrl.',
    'expected repeated modifiers to be rejected explicitly',
  )
})

test('shortcut validation requires a modifier and a single primary key', () => {
  expect(
    validateShortcut('S') === 'Shortcut should include at least one modifier like CmdOrCtrl, Alt, or Shift.',
    'expected shortcuts without modifiers to be rejected',
  )
  expect(
    validateShortcut('Ctrl+A+B') === 'Shortcut can only include one non-modifier key.',
    'expected shortcuts with multiple primary keys to be rejected',
  )
})

test('settings payload validation accepts a valid settings object', () => {
  const settings = assertAppSettings({
    shortcut: 'CmdOrCtrl+Shift+S',
    defaultTool: 'rectangle',
    annotationColor: '#ff6600',
    strokeWidth: 6,
    fontSize: 28,
    textFontFamily: 'Georgia',
    textBackgroundColor: '#102030',
    textBorderColor: '#f4f4f4',
    textBorderSize: 2,
  })

  expect(settings.defaultTool === 'rectangle', 'expected the validated settings payload to round-trip')
  expect(settings.textFontFamily === 'Georgia', 'expected the text font family to round-trip')
})

test('settings payload validation rejects malformed response payloads', () => {
  let error: Error | null = null

  try {
    assertAppSettings({
      shortcut: 'invalid shortcut',
      defaultTool: 'polygon',
      annotationColor: 'orange',
      strokeWidth: 1,
      fontSize: 12,
      textFontFamily: 'Papyrus',
      textBackgroundColor: 'black',
      textBorderColor: 'white',
      textBorderSize: 20,
    })
  } catch (caught) {
    error = caught as Error
  }

  expect(Boolean(error), 'expected invalid settings payloads to throw')
  expect(
    error !== null && error.message.includes('invalid shortcut'),
    'expected the validator to fail fast on the first malformed field',
  )
})