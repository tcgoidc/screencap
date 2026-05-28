import {
  assertCaptureFrames,
  canBringAnnotationToFront,
  canDuplicateSelectedAnnotation,
  canEditSelectedTextAnnotation,
  canSendAnnotationBackward,
  reorderAnnotationBackward,
  reorderAnnotationToFront,
  shouldCancelTextEditorOnKeydown,
  shouldHideOverlayOnKeydown,
  type CaptureFrame,
} from './overlay-contract.js'
import {
  supportedTextFonts,
  type AppSettings,
  type TextFontFamily,
} from './settings-contract.js'
import {
  APP_CREDITS_LABEL,
  APP_RELEASE_DATE_LABEL,
  APP_REPOSITORY_URL,
  APP_VERSION_LABEL,
} from './app-meta.js'
import {
  getTauriUnavailableMessage,
  invokeTauri,
  isTauriRuntimeAvailable,
  listenTauri,
  openExternalUrl,
  saveWithTauriDialog,
} from './tauri-runtime.js'
import './styles.css'

const HOTKEY_EVENT = 'hotkey://capture'

type SelectionBounds = {
  left: number
  top: number
  width: number
  height: number
}

type PointerPoint = {
  x: number
  y: number
}

type FriendlyArrowGeometry = {
  shaftEnd: PointerPoint
  leftWing: PointerPoint
  rightWing: PointerPoint
  tailRadius: number
}

type TextBadgeLayout = {
  left: number
  top: number
  width: number
  height: number
  textX: number
  textY: number
  radius: number
}

type PanelPosition = {
  left: number
  top: number
}

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

type AnnotationTool = 'select' | 'rectangle' | 'arrow' | 'text' | 'blur'

type AnnotationShape =
  | {
      id: string
      type: 'rectangle' | 'arrow' | 'blur'
      start: PointerPoint
      end: PointerPoint
      color: string
      strokeWidth: number
    }
  | {
      id: string
      type: 'text'
      start: PointerPoint
      text: string
      color: string
      fontSize: number
      fontFamily: TextFontFamily
      backgroundColor: string
      borderColor: string
      borderSize: number
    }

type DraftAnnotation = Extract<AnnotationShape, { type: 'rectangle' | 'arrow' | 'blur' }>
type TextAnnotation = Extract<AnnotationShape, { type: 'text' }>

type ViewportBounds = {
  left: number
  top: number
  width: number
  height: number
}

const overlayRoot = document.querySelector<HTMLDivElement>('#overlay-app')

if (!overlayRoot) {
  throw new Error('Overlay app root was not found')
}

const textFontOptionsMarkup = supportedTextFonts
  .map((fontFamily) => `<option value="${fontFamily}">${fontFamily}</option>`)
  .join('')

overlayRoot.innerHTML = `
  <main class="overlay-frame">
    <div class="capture-preview capture-preview-fullscreen" id="capture-stage">
      <div class="capture-empty" id="capture-empty">
        <strong>No capture loaded</strong>
        <span>Press the hotkey to fetch monitor buffers.</span>
      </div>
      <img class="capture-image" id="capture-image" alt="Captured display" />
      <div class="selection-layer" id="selection-layer">
        <svg class="annotation-layer" id="annotation-layer" aria-hidden="true"></svg>
        <div class="text-editor-shell" id="text-editor-shell" hidden>
          <input class="text-editor-input" id="text-editor-input" type="text" maxlength="120" placeholder="Type annotation and press Enter" />
        </div>
        <div class="selection-box" id="selection-box">
          <span class="selection-dimensions" id="selection-dimensions">0 x 0</span>
          <span class="selection-handle selection-handle-nw" aria-hidden="true"></span>
          <span class="selection-handle selection-handle-n" aria-hidden="true"></span>
          <span class="selection-handle selection-handle-ne" aria-hidden="true"></span>
          <span class="selection-handle selection-handle-e" aria-hidden="true"></span>
          <span class="selection-handle selection-handle-se" aria-hidden="true"></span>
          <span class="selection-handle selection-handle-s" aria-hidden="true"></span>
          <span class="selection-handle selection-handle-sw" aria-hidden="true"></span>
          <span class="selection-handle selection-handle-w" aria-hidden="true"></span>
        </div>
        <div class="crosshair crosshair-vertical" id="crosshair-vertical"></div>
        <div class="crosshair crosshair-horizontal" id="crosshair-horizontal"></div>
        <div class="selection-hint" id="selection-hint">Click and drag to select an area. Press Enter to copy, Ctrl/Cmd+S to save, or Delete to clear.</div>
      </div>
    </div>
    <section class="overlay-card overlay-card-floating" id="overlay-card">
      <div class="overlay-panel-handle" id="overlay-panel-handle" title="Drag to move the overlay controls">ScreenCap</div>
      <div class="display-picker" id="display-picker"></div>
      <div class="annotation-toolbar">
        <button class="tool-pill is-active" id="tool-select" type="button">Select</button>
        <button class="tool-pill" id="tool-rectangle" type="button">Rectangle</button>
        <button class="tool-pill" id="tool-arrow" type="button">Arrow</button>
        <button class="tool-pill" id="tool-text" type="button">Text</button>
        <button class="tool-pill" id="tool-blur" type="button">Blur</button>
        <button class="tool-pill tool-pill-secondary" id="edit-text-annotation" type="button" disabled>Edit text</button>
        <button class="tool-pill tool-pill-secondary" id="send-annotation-backward" type="button" disabled>Send backward</button>
        <button class="tool-pill tool-pill-secondary" id="bring-annotation-front" type="button" disabled>Bring to front</button>
        <button class="tool-pill tool-pill-secondary" id="undo-annotation" type="button" disabled>Undo</button>
        <button class="tool-pill tool-pill-secondary" id="clear-selection" type="button" disabled>Clear</button>
      </div>
      <div class="annotation-properties">
        <label class="property-field">
          <span>Ink</span>
          <input class="property-color" id="annotation-color" type="color" value="#5ce1a6" />
        </label>
        <label class="property-field">
          <span>Line</span>
          <input class="property-range" id="annotation-stroke-width" type="range" min="2" max="10" step="1" value="4" />
          <strong class="property-value" id="annotation-stroke-value">4px</strong>
        </label>
        <label class="property-field">
          <span>Text</span>
          <input class="property-range" id="annotation-font-size" type="range" min="16" max="48" step="2" value="24" />
          <strong class="property-value" id="annotation-font-value">24px</strong>
        </label>
        <label class="property-field property-field-wide">
          <span>Font</span>
          <select class="property-select" id="annotation-font-family">${textFontOptionsMarkup}</select>
        </label>
        <label class="property-field">
          <span>Fill</span>
          <input class="property-color" id="text-background-color" type="color" value="#0f1726" />
        </label>
        <label class="property-field">
          <span>Border</span>
          <input class="property-range" id="text-border-size" type="range" min="0" max="8" step="1" value="0" />
          <strong class="property-value" id="text-border-size-value">0px</strong>
        </label>
        <label class="property-field">
          <span>Edge</span>
          <input class="property-color" id="text-border-color" type="color" value="#f8fafc" />
        </label>
      </div>
      <div class="overlay-toolbar">
        <div>
          <p class="overlay-meta">Drag to define the capture area. Use V, R, A, T, and B to switch tools. Press Esc to close the overlay.</p>
        </div>
        <div class="overlay-actions">
          <button class="button button-primary" id="confirm-selection" disabled>To Clipboard</button>
          <button class="button button-secondary" id="save-selection" disabled>Save</button>
          <button class="button button-primary" id="refresh-capture">Capture now</button>
          <button class="button button-secondary" id="dismiss-overlay">Close</button>
        </div>
      </div>
      <p class="overlay-meta" id="capture-status">Overlay initialized.</p>
      <footer class="overlay-version-footer" style="display: none;">
        <div class="app-version-meta">
          <span class="app-version-badge">${APP_VERSION_LABEL}</span>
          <span class="app-version-credit">${APP_CREDITS_LABEL}</span>
        </div>
        <div class="app-version-details">
          <span>${APP_RELEASE_DATE_LABEL}</span>
          <a class="app-version-link" href="${APP_REPOSITORY_URL}" target="_blank" rel="noreferrer">${APP_REPOSITORY_URL}</a>
        </div>
      </footer>
    </section>
  </main>
`

const displayPicker = document.querySelector<HTMLDivElement>('#display-picker')
const captureStage = document.querySelector<HTMLDivElement>('#capture-stage')
const overlayCard = document.querySelector<HTMLElement>('#overlay-card')
const overlayPanelHandle = document.querySelector<HTMLDivElement>('#overlay-panel-handle')
const captureEmpty = document.querySelector<HTMLDivElement>('#capture-empty')
const captureImage = document.querySelector<HTMLImageElement>('#capture-image')
const selectionLayer = document.querySelector<HTMLDivElement>('#selection-layer')
const annotationLayer = document.querySelector<SVGElement>('#annotation-layer')
const textEditorShell = document.querySelector<HTMLDivElement>('#text-editor-shell')
const textEditorInput = document.querySelector<HTMLInputElement>('#text-editor-input')
const selectionBox = document.querySelector<HTMLDivElement>('#selection-box')
const selectionDimensions = document.querySelector<HTMLSpanElement>('#selection-dimensions')
const crosshairVertical = document.querySelector<HTMLDivElement>('#crosshair-vertical')
const crosshairHorizontal = document.querySelector<HTMLDivElement>('#crosshair-horizontal')
const selectionHint = document.querySelector<HTMLDivElement>('#selection-hint')
const captureStatus = document.querySelector<HTMLParagraphElement>('#capture-status')
const selectToolButton = document.querySelector<HTMLButtonElement>('#tool-select')
const rectangleToolButton = document.querySelector<HTMLButtonElement>('#tool-rectangle')
const arrowToolButton = document.querySelector<HTMLButtonElement>('#tool-arrow')
const textToolButton = document.querySelector<HTMLButtonElement>('#tool-text')
const blurToolButton = document.querySelector<HTMLButtonElement>('#tool-blur')
const editTextAnnotationButton = document.querySelector<HTMLButtonElement>('#edit-text-annotation')
const sendAnnotationBackwardButton = document.querySelector<HTMLButtonElement>('#send-annotation-backward')
const bringAnnotationFrontButton = document.querySelector<HTMLButtonElement>('#bring-annotation-front')
const undoAnnotationButton = document.querySelector<HTMLButtonElement>('#undo-annotation')
const clearSelectionButton = document.querySelector<HTMLButtonElement>('#clear-selection')
const annotationColorInput = document.querySelector<HTMLInputElement>('#annotation-color')
const annotationStrokeInput = document.querySelector<HTMLInputElement>('#annotation-stroke-width')
const annotationStrokeValue = document.querySelector<HTMLElement>('#annotation-stroke-value')
const annotationFontInput = document.querySelector<HTMLInputElement>('#annotation-font-size')
const annotationFontValue = document.querySelector<HTMLElement>('#annotation-font-value')
const annotationFontFamilyInput = document.querySelector<HTMLSelectElement>('#annotation-font-family')
const textBackgroundColorInput = document.querySelector<HTMLInputElement>('#text-background-color')
const textBorderSizeInput = document.querySelector<HTMLInputElement>('#text-border-size')
const textBorderSizeValue = document.querySelector<HTMLElement>('#text-border-size-value')
const textBorderColorInput = document.querySelector<HTMLInputElement>('#text-border-color')
const confirmButton = document.querySelector<HTMLButtonElement>('#confirm-selection')
const saveButton = document.querySelector<HTMLButtonElement>('#save-selection')
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh-capture')
const dismissButton = document.querySelector<HTMLButtonElement>('#dismiss-overlay')
const repositoryLink = document.querySelector<HTMLAnchorElement>('.app-version-link')

if (
  !displayPicker ||
  !captureStage ||
  !overlayCard ||
  !overlayPanelHandle ||
  !captureEmpty ||
  !captureImage ||
  !selectionLayer ||
  !annotationLayer ||
  !textEditorShell ||
  !textEditorInput ||
  !selectionBox ||
  !selectionDimensions ||
  !crosshairVertical ||
  !crosshairHorizontal ||
  !selectionHint ||
  !captureStatus ||
  !selectToolButton ||
  !rectangleToolButton ||
  !arrowToolButton ||
  !textToolButton ||
  !blurToolButton ||
  !editTextAnnotationButton ||
  !sendAnnotationBackwardButton ||
  !bringAnnotationFrontButton ||
  !undoAnnotationButton ||
  !clearSelectionButton ||
  !annotationColorInput ||
  !annotationStrokeInput ||
  !annotationStrokeValue ||
  !annotationFontInput ||
  !annotationFontValue ||
  !annotationFontFamilyInput ||
  !textBackgroundColorInput ||
  !textBorderSizeInput ||
  !textBorderSizeValue ||
  !textBorderColorInput ||
  !confirmButton ||
  !saveButton ||
  !refreshButton ||
  !dismissButton ||
  !repositoryLink
) {
  throw new Error('Overlay controls are incomplete')
}

let framesState: CaptureFrame[] = []
let activeFrame: CaptureFrame | null = null
let dragStart: PointerPoint | null = null
let currentSelection: SelectionBounds | null = null
let activeResizeHandle: ResizeHandle | null = null
let activeTool: AnnotationTool = 'select'
let annotations: AnnotationShape[] = []
let activeAnnotationId: string | null = null
let activeAnnotationDragId: string | null = null
let activeAnnotationResizeHandle: ResizeHandle | null = null
let draftAnnotation: DraftAnnotation | null = null
let currentAnnotationColor = '#5ce1a6'
let currentStrokeWidth = 4
let currentFontSize = 24
let currentTextFontFamily: TextFontFamily = 'Segoe UI'
let currentTextBackgroundColor = '#0f1726'
let currentTextBorderColor = '#f8fafc'
let currentTextBorderSize = 0
let textEditorAnchor: PointerPoint | null = null
let textEditingAnnotationId: string | null = null
let overlayPanelPosition: PanelPosition | null = null
let overlayPanelDragOffset: PointerPoint | null = null
let overlayPanelDragPointerId: number | null = null
let overlayPanelMovedByUser = false

const updatePropertyLabels = () => {
  annotationStrokeValue.textContent = `${currentStrokeWidth}px`
  annotationFontValue.textContent = `${currentFontSize}px`
  textBorderSizeValue.textContent = `${currentTextBorderSize}px`
}

const getTextFontStack = (fontFamily: TextFontFamily) =>
  fontFamily === 'Segoe UI'
    ? '"Segoe UI", "Inter", sans-serif'
    : fontFamily === 'Georgia'
      ? 'Georgia, "Times New Roman", serif'
      : fontFamily === 'Consolas'
        ? 'Consolas, "Courier New", monospace'
        : '"Trebuchet MS", "Segoe UI", sans-serif'

const getTextBadgeLayout = (annotation: TextAnnotation): TextBadgeLayout => {
  const width = Math.max(annotation.text.length * (annotation.fontSize * 0.62) + 20 + annotation.borderSize * 2, 64)
  const height = annotation.fontSize + 14 + annotation.borderSize * 2

  return {
    left: annotation.start.x - 10 - annotation.borderSize,
    top: annotation.start.y - (annotation.fontSize + 16) - annotation.borderSize,
    width,
    height,
    textX: annotation.start.x,
    textY: annotation.start.y - 10,
    radius: 10 + Math.min(annotation.borderSize, 4),
  }
}

const applyTextEditorStyles = (style?: Partial<Pick<TextAnnotation, 'color' | 'fontSize' | 'fontFamily' | 'backgroundColor' | 'borderColor' | 'borderSize'>>) => {
  const color = style?.color ?? currentAnnotationColor
  const fontSize = style?.fontSize ?? currentFontSize
  const fontFamily = style?.fontFamily ?? currentTextFontFamily
  const backgroundColor = style?.backgroundColor ?? currentTextBackgroundColor
  const borderColor = style?.borderColor ?? currentTextBorderColor
  const borderSize = style?.borderSize ?? currentTextBorderSize

  textEditorShell.style.backgroundColor = backgroundColor
  textEditorShell.style.borderColor = borderSize > 0 ? borderColor : 'transparent'
  textEditorShell.style.borderWidth = `${borderSize}px`
  textEditorInput.style.color = color
  textEditorInput.style.fontSize = `${fontSize}px`
  textEditorInput.style.fontFamily = getTextFontStack(fontFamily)
}

const drawRoundedRectPath = (context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) => {
  const clampedRadius = Math.min(radius, width / 2, height / 2)

  context.beginPath()
  context.moveTo(x + clampedRadius, y)
  context.lineTo(x + width - clampedRadius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + clampedRadius)
  context.lineTo(x + width, y + height - clampedRadius)
  context.quadraticCurveTo(x + width, y + height, x + width - clampedRadius, y + height)
  context.lineTo(x + clampedRadius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - clampedRadius)
  context.lineTo(x, y + clampedRadius)
  context.quadraticCurveTo(x, y, x + clampedRadius, y)
  context.closePath()
}

const getFriendlyArrowGeometry = (start: PointerPoint, end: PointerPoint, strokeWidth: number): FriendlyArrowGeometry => {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const length = Math.hypot(deltaX, deltaY)

  if (length === 0) {
    return {
      shaftEnd: end,
      leftWing: end,
      rightWing: end,
      tailRadius: Math.max(strokeWidth * 0.8, 3),
    }
  }

  const unitX = deltaX / length
  const unitY = deltaY / length
  const perpendicularX = -unitY
  const perpendicularY = unitX
  const headLength = Math.min(Math.max(strokeWidth * 4.4, 16), 28)
  const headWidth = Math.min(Math.max(strokeWidth * 2.8, 12), 22)
  const shaftInset = Math.min(headLength * 0.72, Math.max(length * 0.42, strokeWidth * 1.5))
  const shaftEnd = {
    x: end.x - unitX * shaftInset,
    y: end.y - unitY * shaftInset,
  }
  const wingCenter = {
    x: end.x - unitX * headLength,
    y: end.y - unitY * headLength,
  }

  return {
    shaftEnd,
    leftWing: {
      x: wingCenter.x + perpendicularX * (headWidth / 2),
      y: wingCenter.y + perpendicularY * (headWidth / 2),
    },
    rightWing: {
      x: wingCenter.x - perpendicularX * (headWidth / 2),
      y: wingCenter.y - perpendicularY * (headWidth / 2),
    },
    tailRadius: Math.max(strokeWidth * 0.82, 3),
  }
}

const clampOverlayPanelPosition = (position: PanelPosition): PanelPosition => {
  const margin = 24
  const panelWidth = overlayCard.offsetWidth || 380
  const panelHeight = overlayCard.offsetHeight || 272

  return {
    left: Math.min(Math.max(position.left, margin), Math.max(window.innerWidth - panelWidth - margin, margin)),
    top: Math.min(Math.max(position.top, margin), Math.max(window.innerHeight - panelHeight - margin, margin)),
  }
}

const applyOverlayPanelPosition = (position: PanelPosition) => {
  const clamped = clampOverlayPanelPosition(position)
  overlayPanelPosition = clamped
  overlayCard.style.left = `${clamped.left}px`
  overlayCard.style.top = `${clamped.top}px`
}

const selectionOverlapsOverlayPanel = (selection: SelectionBounds, panel: PanelPosition) => {
  const panelWidth = overlayCard.offsetWidth || 380
  const panelHeight = overlayCard.offsetHeight || 272

  return !(
    selection.left + selection.width < panel.left ||
    selection.left > panel.left + panelWidth ||
    selection.top + selection.height < panel.top ||
    selection.top > panel.top + panelHeight
  )
}

const autoPlaceOverlayPanel = (avoidBounds?: SelectionBounds | null) => {
  if (overlayPanelMovedByUser) {
    return
  }

  const margin = 24
  const panelWidth = overlayCard.offsetWidth || 380
  const panelHeight = overlayCard.offsetHeight || 272
  const candidates: PanelPosition[] = [
    { left: margin, top: margin },
    { left: window.innerWidth - panelWidth - margin, top: margin },
    { left: margin, top: window.innerHeight - panelHeight - margin },
    { left: window.innerWidth - panelWidth - margin, top: window.innerHeight - panelHeight - margin },
  ].map(clampOverlayPanelPosition)

  if (!avoidBounds) {
    applyOverlayPanelPosition(candidates[1] ?? candidates[0] ?? { left: margin, top: margin })
    return
  }

  const nonOverlapping = candidates.find((candidate) => !selectionOverlapsOverlayPanel(avoidBounds, candidate))

  if (nonOverlapping) {
    applyOverlayPanelPosition(nonOverlapping)
    return
  }

  const selectionCenter = {
    x: avoidBounds.left + avoidBounds.width / 2,
    y: avoidBounds.top + avoidBounds.height / 2,
  }

  const farthestCandidate = [...candidates].sort((leftCandidate, rightCandidate) => {
    const leftCenterX = leftCandidate.left + panelWidth / 2
    const leftCenterY = leftCandidate.top + panelHeight / 2
    const rightCenterX = rightCandidate.left + panelWidth / 2
    const rightCenterY = rightCandidate.top + panelHeight / 2
    const leftDistance = Math.hypot(leftCenterX - selectionCenter.x, leftCenterY - selectionCenter.y)
    const rightDistance = Math.hypot(rightCenterX - selectionCenter.x, rightCenterY - selectionCenter.y)

    return rightDistance - leftDistance
  })[0]

  if (farthestCandidate) {
    applyOverlayPanelPosition(farthestCandidate)
  }
}

const getActiveAnnotation = () => annotations.find((annotation) => annotation.id === activeAnnotationId) ?? null

const getActiveTextAnnotation = () => {
  const activeAnnotation = getActiveAnnotation()
  return activeAnnotation && activeAnnotation.type === 'text' ? activeAnnotation : null
}

const getActiveResizableAnnotation = () => {
  const activeAnnotation = getActiveAnnotation()
  return activeAnnotation && activeAnnotation.type !== 'text' ? activeAnnotation : null
}

const syncPropertyControls = () => {
  const activeAnnotation = getActiveAnnotation()

  if (activeAnnotation) {
    currentAnnotationColor = activeAnnotation.color
    annotationColorInput.value = currentAnnotationColor

    if (activeAnnotation.type === 'text') {
      currentFontSize = activeAnnotation.fontSize
      currentTextFontFamily = activeAnnotation.fontFamily
      currentTextBackgroundColor = activeAnnotation.backgroundColor
      currentTextBorderColor = activeAnnotation.borderColor
      currentTextBorderSize = activeAnnotation.borderSize
      annotationFontInput.value = String(currentFontSize)
      annotationFontFamilyInput.value = currentTextFontFamily
      textBackgroundColorInput.value = currentTextBackgroundColor
      textBorderColorInput.value = currentTextBorderColor
      textBorderSizeInput.value = String(currentTextBorderSize)
    } else {
      currentStrokeWidth = activeAnnotation.strokeWidth
      annotationStrokeInput.value = String(currentStrokeWidth)
    }
  } else {
    annotationColorInput.value = currentAnnotationColor
    annotationStrokeInput.value = String(currentStrokeWidth)
    annotationFontInput.value = String(currentFontSize)
    annotationFontFamilyInput.value = currentTextFontFamily
    textBackgroundColorInput.value = currentTextBackgroundColor
    textBorderColorInput.value = currentTextBorderColor
    textBorderSizeInput.value = String(currentTextBorderSize)
  }

  applyTextEditorStyles()
  updatePropertyLabels()
}

const setActiveAnnotation = (annotationId: string | null) => {
  activeAnnotationId = annotationId
  syncPropertyControls()
  renderOverlayState()
  renderAnnotations()
}

const applySettings = (settings: AppSettings) => {
  currentAnnotationColor = settings.annotationColor
  currentStrokeWidth = settings.strokeWidth
  currentFontSize = settings.fontSize
  currentTextFontFamily = settings.textFontFamily
  currentTextBackgroundColor = settings.textBackgroundColor
  currentTextBorderColor = settings.textBorderColor
  currentTextBorderSize = settings.textBorderSize
  annotationColorInput.value = currentAnnotationColor
  annotationStrokeInput.value = String(currentStrokeWidth)
  annotationFontInput.value = String(currentFontSize)
  annotationFontFamilyInput.value = currentTextFontFamily
  textBackgroundColorInput.value = currentTextBackgroundColor
  textBorderColorInput.value = currentTextBorderColor
  textBorderSizeInput.value = String(currentTextBorderSize)
  applyTextEditorStyles()
  updatePropertyLabels()

  if (annotations.length === 0 && !draftAnnotation) {
    setActiveTool(settings.defaultTool)
  }
}

const loadSettings = async () => {
  try {
    const settings = await invokeTauri<AppSettings>('get_settings')
    applySettings(settings)
  } catch {
    updatePropertyLabels()
  }
}

const setActiveTool = (tool: AnnotationTool) => {
  activeTool = tool
  selectToolButton.classList.toggle('is-active', tool === 'select')
  rectangleToolButton.classList.toggle('is-active', tool === 'rectangle')
  arrowToolButton.classList.toggle('is-active', tool === 'arrow')
  textToolButton.classList.toggle('is-active', tool === 'text')
  blurToolButton.classList.toggle('is-active', tool === 'blur')
  selectionBox.classList.toggle('is-annotation-mode', tool !== 'select')
  selectionBox.classList.toggle('is-selection-mode', tool === 'select')
  renderOverlayState()
}

const getSelectionHintMessage = () => {
  if (!activeFrame) {
    return 'Press the hotkey or Capture now to fetch monitor buffers.'
  }

  if (isTextEditorActive()) {
    return 'Typing text annotation. Press Enter to place it or Esc to cancel.'
  }

  if (!currentSelection) {
    return 'Click and drag to select an area. Press Enter to copy, Ctrl/Cmd+S to save, or Delete to clear.'
  }

  if (activeAnnotationId) {
    return 'Annotation selected. Drag to move it, use the handles to resize it, press Ctrl/Cmd+D to duplicate it, Ctrl/Cmd+[ or Ctrl/Cmd+] to change stacking, Ctrl/Cmd+E to edit selected text, adjust color or size controls to edit it, or press Delete to remove it.'
  }

  switch (activeTool) {
    case 'select':
      return 'Selection ready. Drag to redraw, use arrow keys to nudge, Enter to copy, or Delete to clear.'
    case 'rectangle':
      return 'Rectangle mode active. Drag inside the selection to draw a callout.'
    case 'arrow':
      return 'Arrow mode active. Drag inside the selection to point at a target.'
    case 'text':
      return 'Text mode active. Click inside the selection to place a text annotation.'
    case 'blur':
      return 'Blur mode active. Drag inside the selection to apply mosaic redaction.'
  }
}

const renderOverlayState = () => {
  const hasSelection = Boolean(currentSelection)
  const activeAnnotationType = getActiveAnnotation()?.type ?? null
  const hasActiveTextAnnotation = canEditSelectedTextAnnotation(activeAnnotationType)
  const annotationIds = annotations.map((annotation) => annotation.id)
  const canSendActiveAnnotationBackward = canSendAnnotationBackward(annotationIds, activeAnnotationId)
  const canBringActiveAnnotationFront = canBringAnnotationToFront(annotationIds, activeAnnotationId)
  const canDuplicateActiveAnnotation = canDuplicateSelectedAnnotation(annotations.length, activeAnnotationId)

  selectionHint.hidden = false
  selectionHint.textContent = getSelectionHintMessage()
  selectionHint.classList.toggle('is-selection-ready', hasSelection)
  selectionHint.classList.toggle('is-annotation-mode', hasSelection && activeTool !== 'select')
  selectionBox.classList.toggle('has-selection', hasSelection)
  editTextAnnotationButton.disabled = !hasSelection || !hasActiveTextAnnotation
  sendAnnotationBackwardButton.disabled = !hasSelection || !canDuplicateActiveAnnotation || !canSendActiveAnnotationBackward
  bringAnnotationFrontButton.disabled = !hasSelection || !canDuplicateActiveAnnotation || !canBringActiveAnnotationFront
}

const activateTool = (tool: AnnotationTool) => {
  setActiveTool(tool)

  switch (tool) {
    case 'select':
      captureStatus.textContent = 'Selection mode active.'
      break
    case 'rectangle':
      captureStatus.textContent = 'Rectangle annotation mode active.'
      break
    case 'arrow':
      captureStatus.textContent = 'Arrow annotation mode active.'
      break
    case 'text':
      captureStatus.textContent = 'Text annotation mode active. Click inside the selection to place text.'
      break
    case 'blur':
      captureStatus.textContent = 'Blur annotation mode active.'
      break
  }
}

const hideTextEditor = () => {
  textEditorAnchor = null
  textEditingAnnotationId = null
  textEditorInput.value = ''
  textEditorShell.hidden = true
  renderOverlayState()
}

const isTextEditorActive = () => !textEditorShell.hidden

const isKeyboardShortcutBlocked = () => {
  const activeElement = document.activeElement

  if (!activeElement || activeElement === document.body) {
    return false
  }

  if (activeElement === textEditorInput) {
    return true
  }

  return activeElement.matches('input, button, select, textarea')
}

const showTextEditor = (point: PointerPoint, annotation?: Extract<AnnotationShape, { type: 'text' }>) => {
  textEditorAnchor = annotation?.start ?? stagePointToImagePoint(point)
  textEditingAnnotationId = annotation?.id ?? null
  textEditorShell.hidden = false
  textEditorShell.style.left = `${point.x}px`
  textEditorShell.style.top = `${point.y}px`
  textEditorInput.value = annotation?.text ?? ''
  applyTextEditorStyles(annotation)
  textEditorInput.setSelectionRange(textEditorInput.value.length, textEditorInput.value.length)
  textEditorInput.focus()
  renderOverlayState()
}

const commitTextEditor = () => {
  const text = textEditorInput.value.trim()
  const editingAnnotationId = textEditingAnnotationId

  if (!text || !textEditorAnchor) {
    if (editingAnnotationId) {
      captureStatus.textContent = 'Text edit cancelled.'
    }
    hideTextEditor()
    return
  }

  const editorAnchor = textEditorAnchor

  if (editingAnnotationId) {
    annotations = annotations.map((annotation) =>
      annotation.id === editingAnnotationId && annotation.type === 'text'
        ? {
            ...annotation,
            start: editorAnchor,
            text,
            color: currentAnnotationColor,
            fontSize: currentFontSize,
            fontFamily: currentTextFontFamily,
            backgroundColor: currentTextBackgroundColor,
            borderColor: currentTextBorderColor,
            borderSize: currentTextBorderSize,
          }
        : annotation,
    )
    activeAnnotationId = editingAnnotationId
    captureStatus.textContent = 'Text annotation updated.'
  } else {
    annotations = [
      ...annotations,
      {
        id: `text-${Date.now()}`,
        type: 'text',
        start: editorAnchor,
        text,
        color: currentAnnotationColor,
        fontSize: currentFontSize,
        fontFamily: currentTextFontFamily,
        backgroundColor: currentTextBackgroundColor,
        borderColor: currentTextBorderColor,
        borderSize: currentTextBorderSize,
      },
    ]
    activeAnnotationId = annotations[annotations.length - 1]?.id ?? null
    captureStatus.textContent = 'Text annotation added.'
  }

  updateUndoState()
  syncPropertyControls()
  renderAnnotations()
  hideTextEditor()
}

const editActiveTextAnnotation = () => {
  const activeTextAnnotation = getActiveTextAnnotation()

  if (!activeTextAnnotation) {
    return false
  }

  currentAnnotationColor = activeTextAnnotation.color
  currentFontSize = activeTextAnnotation.fontSize
  currentTextFontFamily = activeTextAnnotation.fontFamily
  currentTextBackgroundColor = activeTextAnnotation.backgroundColor
  currentTextBorderColor = activeTextAnnotation.borderColor
  currentTextBorderSize = activeTextAnnotation.borderSize
  syncPropertyControls()
  showTextEditor(imagePointToStagePoint(activeTextAnnotation.start), activeTextAnnotation)
  captureStatus.textContent = 'Editing text annotation. Update the text and press Enter to apply it.'
  return true
}

const updateUndoState = () => {
  undoAnnotationButton.disabled = !currentSelection || annotations.length === 0
}

const setAnnotationEditingEnabled = (enabled: boolean) => {
  rectangleToolButton.disabled = !enabled
  arrowToolButton.disabled = !enabled
  textToolButton.disabled = !enabled
  blurToolButton.disabled = !enabled
  annotationColorInput.disabled = !enabled
  annotationStrokeInput.disabled = !enabled
  annotationFontInput.disabled = !enabled
  annotationFontFamilyInput.disabled = !enabled
  textBackgroundColorInput.disabled = !enabled
  textBorderSizeInput.disabled = !enabled
  textBorderColorInput.disabled = !enabled

  if (!enabled && activeTool !== 'select') {
    setActiveTool('select')
  }

  updateUndoState()
}

const clearAnnotations = () => {
  annotations = []
  activeAnnotationId = null
  draftAnnotation = null
  hideTextEditor()
  syncPropertyControls()
  annotationLayer.innerHTML = ''
  updateUndoState()
}

const setExportActionsEnabled = (enabled: boolean) => {
  confirmButton.disabled = !enabled
  saveButton.disabled = !enabled
  clearSelectionButton.disabled = !enabled
  setAnnotationEditingEnabled(enabled)
}

const getImageViewport = (): ViewportBounds => {
  const containerWidth = selectionLayer.clientWidth
  const containerHeight = selectionLayer.clientHeight

  if (!activeFrame || containerWidth === 0 || containerHeight === 0) {
    return { left: 0, top: 0, width: containerWidth, height: containerHeight }
  }

  const scale = Math.min(containerWidth / activeFrame.width, containerHeight / activeFrame.height)
  const width = activeFrame.width * scale
  const height = activeFrame.height * scale

  return {
    left: (containerWidth - width) / 2,
    top: (containerHeight - height) / 2,
    width,
    height,
  }
}

const stagePointToImagePoint = (point: PointerPoint): PointerPoint => {
  if (!activeFrame) {
    return point
  }

  const viewport = getImageViewport()
  return {
    x: ((point.x - viewport.left) / Math.max(viewport.width, 1)) * activeFrame.width,
    y: ((point.y - viewport.top) / Math.max(viewport.height, 1)) * activeFrame.height,
  }
}

const imagePointToStagePoint = (point: PointerPoint): PointerPoint => {
  if (!activeFrame) {
    return point
  }

  const viewport = getImageViewport()
  return {
    x: viewport.left + (point.x / Math.max(activeFrame.width, 1)) * viewport.width,
    y: viewport.top + (point.y / Math.max(activeFrame.height, 1)) * viewport.height,
  }
}

const pointInsideSelection = (point: PointerPoint) => {
  if (!currentSelection) {
    return false
  }

  return (
    point.x >= currentSelection.left &&
    point.x <= currentSelection.left + currentSelection.width &&
    point.y >= currentSelection.top &&
    point.y <= currentSelection.top + currentSelection.height
  )
}

const getSelectionImageBounds = (): SelectionBounds | null => {
  if (!currentSelection) {
    return null
  }

  const start = stagePointToImagePoint({ x: currentSelection.left, y: currentSelection.top })
  const end = stagePointToImagePoint({ x: currentSelection.left + currentSelection.width, y: currentSelection.top + currentSelection.height })

  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

const getResizeHandleForBounds = (bounds: SelectionBounds, point: PointerPoint, threshold: number) => {
  const right = bounds.left + bounds.width
  const bottom = bounds.top + bounds.height
  const nearLeft = Math.abs(point.x - bounds.left) <= threshold
  const nearRight = Math.abs(point.x - right) <= threshold
  const nearTop = Math.abs(point.y - bounds.top) <= threshold
  const nearBottom = Math.abs(point.y - bottom) <= threshold
  const betweenHorizontally = point.x >= bounds.left - threshold && point.x <= right + threshold
  const betweenVertically = point.y >= bounds.top - threshold && point.y <= bottom + threshold

  if (nearLeft && nearTop) {
    return 'nw'
  }

  if (nearRight && nearTop) {
    return 'ne'
  }

  if (nearRight && nearBottom) {
    return 'se'
  }

  if (nearLeft && nearBottom) {
    return 'sw'
  }

  if (nearTop && betweenHorizontally) {
    return 'n'
  }

  if (nearBottom && betweenHorizontally) {
    return 's'
  }

  if (nearRight && betweenVertically) {
    return 'e'
  }

  if (nearLeft && betweenVertically) {
    return 'w'
  }

  return null
}

const getResizeCursor = (handle: ResizeHandle) =>
  handle === 'n' || handle === 's'
    ? 'ns-resize'
    : handle === 'e' || handle === 'w'
      ? 'ew-resize'
      : handle === 'ne' || handle === 'sw'
        ? 'nesw-resize'
        : 'nwse-resize'

const getAnnotationBounds = (annotation: Extract<AnnotationShape, { type: 'rectangle' | 'arrow' | 'blur' }>): SelectionBounds => ({
  left: Math.min(annotation.start.x, annotation.end.x),
  top: Math.min(annotation.start.y, annotation.end.y),
  width: Math.abs(annotation.end.x - annotation.start.x),
  height: Math.abs(annotation.end.y - annotation.start.y),
})

const getAnnotationStageBounds = (annotation: Extract<AnnotationShape, { type: 'rectangle' | 'arrow' | 'blur' }>): SelectionBounds => {
  const start = imagePointToStagePoint(annotation.start)
  const end = imagePointToStagePoint(annotation.end)

  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

const getActiveAnnotationResizeHandle = (point: PointerPoint) => {
  if (activeTool !== 'select' || !pointInsideSelection(point)) {
    return null
  }

  const activeAnnotation = getActiveResizableAnnotation()

  if (!activeAnnotation) {
    return null
  }

  return getResizeHandleForBounds(getAnnotationStageBounds(activeAnnotation), point, 8)
}

const getAnnotationHitTolerance = () => {
  if (!activeFrame) {
    return 8
  }

  const viewport = getImageViewport()
  return Math.max((10 / Math.max(viewport.width, 1)) * activeFrame.width, 8)
}

const pointToSegmentDistance = (point: PointerPoint, start: PointerPoint, end: PointerPoint) => {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const lengthSquared = deltaX * deltaX + deltaY * deltaY

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }

  const projection = ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared
  const clampedProjection = Math.min(Math.max(projection, 0), 1)
  const projectedX = start.x + deltaX * clampedProjection
  const projectedY = start.y + deltaY * clampedProjection

  return Math.hypot(point.x - projectedX, point.y - projectedY)
}

const getAnnotationAtPoint = (point: PointerPoint) => {
  const imagePoint = stagePointToImagePoint(point)
  const tolerance = getAnnotationHitTolerance()

  return [...annotations].reverse().find((annotation) => {
    if (annotation.type === 'text') {
      const layout = getTextBadgeLayout(annotation)

      return (
        imagePoint.x >= layout.left - tolerance &&
        imagePoint.x <= layout.left + layout.width + tolerance &&
        imagePoint.y >= layout.top - tolerance &&
        imagePoint.y <= layout.top + layout.height + tolerance
      )
    }

    if (annotation.type === 'arrow') {
      return pointToSegmentDistance(imagePoint, annotation.start, annotation.end) <= Math.max(annotation.strokeWidth * 1.5, tolerance)
    }

    const left = Math.min(annotation.start.x, annotation.end.x)
    const top = Math.min(annotation.start.y, annotation.end.y)
    const width = Math.abs(annotation.end.x - annotation.start.x)
    const height = Math.abs(annotation.end.y - annotation.start.y)

    return (
      imagePoint.x >= left - tolerance &&
      imagePoint.x <= left + width + tolerance &&
      imagePoint.y >= top - tolerance &&
      imagePoint.y <= top + height + tolerance
    )
  }) ?? null
}

const moveAnnotationBy = (annotationId: string, delta: PointerPoint) => {
  const selectionBounds = getSelectionImageBounds()

  if (!selectionBounds) {
    return
  }

  annotations = annotations.map((annotation) => {
    if (annotation.id !== annotationId) {
      return annotation
    }

    if (annotation.type === 'text') {
      const nextX = Math.min(
        Math.max(annotation.start.x + delta.x, selectionBounds.left),
        selectionBounds.left + selectionBounds.width,
      )
      const nextY = Math.min(
        Math.max(annotation.start.y + delta.y, selectionBounds.top),
        selectionBounds.top + selectionBounds.height,
      )

      return {
        ...annotation,
        start: {
          x: nextX,
          y: nextY,
        },
      }
    }

    const bounds = getAnnotationBounds(annotation)
    const maxDeltaX = selectionBounds.left + selectionBounds.width - (bounds.left + bounds.width)
    const minDeltaX = selectionBounds.left - bounds.left
    const maxDeltaY = selectionBounds.top + selectionBounds.height - (bounds.top + bounds.height)
    const minDeltaY = selectionBounds.top - bounds.top
    const clampedDeltaX = Math.min(Math.max(delta.x, minDeltaX), maxDeltaX)
    const clampedDeltaY = Math.min(Math.max(delta.y, minDeltaY), maxDeltaY)

    return {
      ...annotation,
      start: {
        x: annotation.start.x + clampedDeltaX,
        y: annotation.start.y + clampedDeltaY,
      },
      end: {
        x: annotation.end.x + clampedDeltaX,
        y: annotation.end.y + clampedDeltaY,
      },
    }
  })
}

const nudgeActiveAnnotation = (deltaX: number, deltaY: number) => {
  if (!activeAnnotationId) {
    return
  }

  moveAnnotationBy(activeAnnotationId, { x: deltaX, y: deltaY })
  renderAnnotations()
  captureStatus.textContent = 'Selected annotation nudged.'
}

const duplicateActiveAnnotation = () => {
  const activeAnnotation = getActiveAnnotation()

  if (!activeAnnotation) {
    return false
  }

  const duplicatedAnnotation: AnnotationShape =
    activeAnnotation.type === 'text'
      ? {
          ...activeAnnotation,
          id: `text-${Date.now()}`,
        }
      : {
          ...activeAnnotation,
          id: `${activeAnnotation.type}-${Date.now()}`,
        }

  annotations = [...annotations, duplicatedAnnotation]
  setActiveAnnotation(duplicatedAnnotation.id)
  moveAnnotationBy(duplicatedAnnotation.id, { x: 24, y: 24 })
  updateUndoState()
  renderAnnotations()
  captureStatus.textContent = 'Selected annotation duplicated.'
  return true
}

const bringActiveAnnotationToFront = () => {
  const reorderedIds = reorderAnnotationToFront(
    annotations.map((annotation) => annotation.id),
    activeAnnotationId,
  )

  if (!reorderedIds) {
    return false
  }

  annotations = reorderedIds
    .map((annotationId) => annotations.find((annotation) => annotation.id === annotationId) ?? null)
    .filter((annotation): annotation is AnnotationShape => annotation !== null)
  renderOverlayState()
  renderAnnotations()
  captureStatus.textContent = 'Selected annotation brought to front.'
  return true
}

const sendActiveAnnotationBackward = () => {
  const reorderedIds = reorderAnnotationBackward(
    annotations.map((annotation) => annotation.id),
    activeAnnotationId,
  )

  if (!reorderedIds) {
    return false
  }

  annotations = reorderedIds
    .map((annotationId) => annotations.find((annotation) => annotation.id === annotationId) ?? null)
    .filter((annotation): annotation is AnnotationShape => annotation !== null)
  renderOverlayState()
  renderAnnotations()
  captureStatus.textContent = 'Selected annotation sent backward.'
  return true
}

const resizeAnnotationByHandle = (annotationId: string, handle: ResizeHandle, point: PointerPoint) => {
  const selectionBounds = getSelectionImageBounds()

  if (!selectionBounds) {
    return
  }

  const pointInImage = stagePointToImagePoint(point)
  const minimumSize = getAnnotationHitTolerance()

  annotations = annotations.map((annotation) => {
    if (annotation.id !== annotationId || annotation.type === 'text') {
      return annotation
    }

    const bounds = getAnnotationBounds(annotation)
    const right = bounds.left + bounds.width
    const bottom = bounds.top + bounds.height
    let left = bounds.left
    let top = bounds.top
    let nextRight = right
    let nextBottom = bottom

    if (handle.includes('w')) {
      left = Math.min(Math.max(pointInImage.x, selectionBounds.left), right - minimumSize)
    }

    if (handle.includes('e')) {
      nextRight = Math.max(
        Math.min(pointInImage.x, selectionBounds.left + selectionBounds.width),
        left + minimumSize,
      )
    }

    if (handle.includes('n')) {
      top = Math.min(Math.max(pointInImage.y, selectionBounds.top), bottom - minimumSize)
    }

    if (handle.includes('s')) {
      nextBottom = Math.max(
        Math.min(pointInImage.y, selectionBounds.top + selectionBounds.height),
        top + minimumSize,
      )
    }

    const widthRatio = bounds.width === 0 ? 0 : (nextRight - left) / bounds.width
    const heightRatio = bounds.height === 0 ? 0 : (nextBottom - top) / bounds.height
    const scalePoint = (annotationPoint: PointerPoint): PointerPoint => ({
      x: bounds.width === 0 ? left : left + (annotationPoint.x - bounds.left) * widthRatio,
      y: bounds.height === 0 ? top : top + (annotationPoint.y - bounds.top) * heightRatio,
    })

    return {
      ...annotation,
      start: scalePoint(annotation.start),
      end: scalePoint(annotation.end),
    }
  })
}

const renderAnnotations = () => {
  if (!currentSelection || !activeFrame) {
    annotationLayer.innerHTML = ''
    return
  }

  const clipId = 'selection-clip'
  const activeResizableAnnotation = getActiveResizableAnnotation()
  const shapes = [...annotations, ...(draftAnnotation ? [draftAnnotation] : [])]
    .map((shape) => {
      const start = imagePointToStagePoint(shape.start)
      const selectedClass = shape.id === activeAnnotationId ? ' is-selected' : ''

      if (shape.type === 'text') {
        const layout = getTextBadgeLayout(shape)
        const editChipLeft = layout.left + layout.width - 36
        const editChipLabelX = editChipLeft + 18
        const editChip =
          shape.id === activeAnnotationId
            ? `
              <g class="annotation-text-edit-chip" aria-hidden="true">
                <rect x="${editChipLeft}" y="${layout.top - 18}" width="36" height="16" rx="8" class="annotation-text-edit-chip-badge" />
                <text x="${editChipLabelX}" y="${layout.top - 6}" class="annotation-text-edit-chip-label">Edit</text>
              </g>
            `
            : ''

        return `
          <g class="annotation-text-group${selectedClass}">
            <rect x="${layout.left}" y="${layout.top}" width="${layout.width}" height="${layout.height}" rx="${layout.radius}" class="annotation-text-badge" style="fill: ${shape.backgroundColor}; stroke: ${shape.borderColor}; stroke-width: ${shape.borderSize};" />
            ${editChip}
            <text x="${layout.textX}" y="${layout.textY}" class="annotation-text" style="fill: ${shape.color}; font-size: ${shape.fontSize}px; font-family: ${getTextFontStack(shape.fontFamily)};">${shape.text
              .replaceAll('&', '&amp;')
              .replaceAll('<', '&lt;')
              .replaceAll('>', '&gt;')}</text>
          </g>
        `
      }

      const end = imagePointToStagePoint(shape.end)

      if (shape.type === 'rectangle') {
        const left = Math.min(start.x, end.x)
        const top = Math.min(start.y, end.y)
        const width = Math.abs(end.x - start.x)
        const height = Math.abs(end.y - start.y)

        return `<rect x="${left}" y="${top}" width="${width}" height="${height}" class="annotation-shape annotation-rectangle${selectedClass}" style="stroke: ${shape.color}; stroke-width: ${shape.strokeWidth};" />`
      }

      if (shape.type === 'blur') {
        const left = Math.min(start.x, end.x)
        const top = Math.min(start.y, end.y)
        const width = Math.abs(end.x - start.x)
        const height = Math.abs(end.y - start.y)

        return `
          <g>
            <rect x="${left}" y="${top}" width="${width}" height="${height}" class="annotation-shape annotation-blur${selectedClass}" style="stroke: ${shape.color}; stroke-width: ${Math.max(2, shape.strokeWidth - 1)}; fill: ${shape.color}33;" />
            <text x="${left + 12}" y="${top + 22}" class="annotation-blur-label" style="fill: ${shape.color};">Mosaic</text>
          </g>
        `
      }

      const arrow = getFriendlyArrowGeometry(start, end, shape.strokeWidth)

      return `
        <g class="annotation-arrow-group${selectedClass}">
          <line x1="${start.x}" y1="${start.y}" x2="${arrow.shaftEnd.x}" y2="${arrow.shaftEnd.y}" class="annotation-shape annotation-arrow-shaft" style="stroke: ${shape.color}; stroke-width: ${shape.strokeWidth};" />
          <path d="M ${arrow.leftWing.x} ${arrow.leftWing.y} L ${end.x} ${end.y} L ${arrow.rightWing.x} ${arrow.rightWing.y} Q ${arrow.shaftEnd.x} ${arrow.shaftEnd.y} ${arrow.leftWing.x} ${arrow.leftWing.y} Z" class="annotation-arrow-head" style="fill: ${shape.color};" />
          <circle cx="${start.x}" cy="${start.y}" r="${arrow.tailRadius}" class="annotation-arrow-tail" style="fill: ${shape.color};" />
        </g>
      `
    })
    .join('')

  const activeAnnotationControls = activeResizableAnnotation
    ? (() => {
        const bounds = getAnnotationStageBounds(activeResizableAnnotation)
        const left = bounds.left
        const top = bounds.top
        const right = bounds.left + bounds.width
        const bottom = bounds.top + bounds.height
        const handleRadius = 6
        const handles = [
          { handle: 'nw', x: left, y: top },
          { handle: 'n', x: left + bounds.width / 2, y: top },
          { handle: 'ne', x: right, y: top },
          { handle: 'e', x: right, y: top + bounds.height / 2 },
          { handle: 'se', x: right, y: bottom },
          { handle: 's', x: left + bounds.width / 2, y: bottom },
          { handle: 'sw', x: left, y: bottom },
          { handle: 'w', x: left, y: top + bounds.height / 2 },
        ]
          .map(
            ({ handle, x, y }) =>
              `<circle cx="${x}" cy="${y}" r="${handleRadius}" class="annotation-resize-handle${handle === activeAnnotationResizeHandle ? ' is-active' : ''}" data-handle="${handle}" />`,
          )
          .join('')

        return `
          <g class="annotation-controls" aria-hidden="true">
            <rect x="${left}" y="${top}" width="${bounds.width}" height="${bounds.height}" class="annotation-selection-outline" />
            ${handles}
          </g>
        `
      })()
    : ''

  annotationLayer.setAttribute('viewBox', `0 0 ${selectionLayer.clientWidth} ${selectionLayer.clientHeight}`)
  annotationLayer.innerHTML = `
    <defs>
      <clipPath id="${clipId}">
        <rect x="${currentSelection.left}" y="${currentSelection.top}" width="${currentSelection.width}" height="${currentSelection.height}" />
      </clipPath>
    </defs>
    <g clip-path="url(#${clipId})">${shapes}${activeAnnotationControls}</g>
  `
}

const resetSelection = () => {
  dragStart = null
  activeResizeHandle = null
  activeAnnotationDragId = null
  activeAnnotationResizeHandle = null
  currentSelection = null
  selectionBox.style.display = 'none'
  selectionDimensions.textContent = '0 x 0'
  setExportActionsEnabled(false)
  clearAnnotations()
  renderOverlayState()
}

const clearSelection = () => {
  if (!currentSelection) {
    return
  }

  resetSelection()
  captureStatus.textContent = 'Selection cleared.'
}

const renderDisplayPicker = () => {
  if (framesState.length <= 1) {
    displayPicker.innerHTML = ''
    return
  }

  displayPicker.innerHTML = framesState
    .map(
      (frame) => `
        <button class="display-pill${frame.displayId === activeFrame?.displayId ? ' is-active' : ''}" data-display-id="${frame.displayId}" type="button">
          <strong>Display ${frame.displayId}</strong>
          <span>${frame.width} x ${frame.height} @ ${frame.scaleFactor.toFixed(2)}x</span>
        </button>
      `,
    )
    .join('')
}

const getResizeHandle = (point: PointerPoint): ResizeHandle | null => {
  if (!currentSelection || activeTool !== 'select') {
    return null
  }

  return getResizeHandleForBounds(currentSelection, point, 10)
}

const updateSelectionCursor = (point?: PointerPoint) => {
  const annotationResizeHandle = point ? getActiveAnnotationResizeHandle(point) : null

  if (annotationResizeHandle) {
    captureStage.style.cursor = getResizeCursor(annotationResizeHandle)
    return
  }

  const resizeHandle = point ? getResizeHandle(point) : null

  if (resizeHandle) {
    captureStage.style.cursor = getResizeCursor(resizeHandle)
    return
  }

  const hitAnnotation = point && pointInsideSelection(point) ? getAnnotationAtPoint(point) : null

  if (hitAnnotation && activeTool === 'select') {
    captureStage.style.cursor = activeAnnotationDragId === hitAnnotation.id ? 'grabbing' : 'grab'
    return
  }

  captureStage.style.cursor = activeTool === 'select' ? 'crosshair' : currentSelection ? 'default' : 'not-allowed'
}

const updateCrosshair = (point: PointerPoint) => {
  crosshairVertical.style.transform = `translateX(${point.x}px)`
  crosshairHorizontal.style.transform = `translateY(${point.y}px)`
}

const getStagePoint = (event: MouseEvent | PointerEvent): PointerPoint => {
  const rect = selectionLayer.getBoundingClientRect()
  const viewport = getImageViewport()

  return {
    x: Math.min(Math.max(event.clientX - rect.left, viewport.left), viewport.left + viewport.width),
    y: Math.min(Math.max(event.clientY - rect.top, viewport.top), viewport.top + viewport.height),
  }
}

const scaleSelection = (bounds: SelectionBounds) => {
  if (!activeFrame) {
    return bounds
  }

  const viewport = getImageViewport()
  const widthRatio = activeFrame.width / Math.max(viewport.width, 1)
  const heightRatio = activeFrame.height / Math.max(viewport.height, 1)

  return {
    left: Math.round((bounds.left - viewport.left) * widthRatio),
    top: Math.round((bounds.top - viewport.top) * heightRatio),
    width: Math.round(bounds.width * widthRatio),
    height: Math.round(bounds.height * heightRatio),
  }
}

const renderSelection = (bounds: SelectionBounds) => {
  currentSelection = bounds
  selectionBox.style.display = bounds.width > 0 && bounds.height > 0 ? 'block' : 'none'
  selectionBox.style.left = `${bounds.left}px`
  selectionBox.style.top = `${bounds.top}px`
  selectionBox.style.width = `${bounds.width}px`
  selectionBox.style.height = `${bounds.height}px`

  const scaled = scaleSelection(bounds)
  selectionDimensions.textContent = `${scaled.width} x ${scaled.height}`
  setExportActionsEnabled(bounds.width > 0 && bounds.height > 0)
  autoPlaceOverlayPanel(bounds)
  renderOverlayState()
  renderAnnotations()
}

const drawSelection = (start: PointerPoint, end: PointerPoint) => {
  renderSelection({
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  })
}

const resizeSelection = (handle: ResizeHandle, point: PointerPoint) => {
  if (!currentSelection) {
    return
  }

  const viewport = getImageViewport()
  const minimumSize = 12
  const right = currentSelection.left + currentSelection.width
  const bottom = currentSelection.top + currentSelection.height
  let left = currentSelection.left
  let top = currentSelection.top
  let nextRight = right
  let nextBottom = bottom

  if (handle.includes('w')) {
    left = Math.min(Math.max(point.x, viewport.left), right - minimumSize)
  }

  if (handle.includes('e')) {
    nextRight = Math.max(Math.min(point.x, viewport.left + viewport.width), left + minimumSize)
  }

  if (handle.includes('n')) {
    top = Math.min(Math.max(point.y, viewport.top), bottom - minimumSize)
  }

  if (handle.includes('s')) {
    nextBottom = Math.max(Math.min(point.y, viewport.top + viewport.height), top + minimumSize)
  }

  renderSelection({
    left,
    top,
    width: nextRight - left,
    height: nextBottom - top,
  })
}

const nudgeSelection = (deltaX: number, deltaY: number) => {
  if (!currentSelection) {
    return
  }

  const viewport = getImageViewport()
  const maxLeft = Math.max(viewport.left + viewport.width - currentSelection.width, viewport.left)
  const maxTop = Math.max(viewport.top + viewport.height - currentSelection.height, viewport.top)

  renderSelection({
    left: Math.min(Math.max(currentSelection.left + deltaX, viewport.left), maxLeft),
    top: Math.min(Math.max(currentSelection.top + deltaY, viewport.top), maxTop),
    width: currentSelection.width,
    height: currentSelection.height,
  })

  const scaled = scaleSelection(currentSelection)
  captureStatus.textContent = `Selection moved to ${scaled.left}, ${scaled.top} with size ${scaled.width} x ${scaled.height}.`
}

const buildSelectionDataUrl = async () => {
  if (!activeFrame || !currentSelection) {
    throw new Error('No active selection is available to export')
  }

  const frame = activeFrame
  const scaled = scaleSelection(currentSelection)
  const sourceImage = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to decode the captured image'))
    image.src = frame.dataUrl
  })

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(scaled.width, 1)
  canvas.height = Math.max(scaled.height, 1)

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Failed to create an export canvas context')
  }

  context.drawImage(
    sourceImage,
    scaled.left,
    scaled.top,
    scaled.width,
    scaled.height,
    0,
    0,
    scaled.width,
    scaled.height,
  )

  const widthRatio = scaled.width / Math.max(currentSelection.width, 1)
  const heightRatio = scaled.height / Math.max(currentSelection.height, 1)
  context.lineCap = 'round'
  context.lineJoin = 'round'

  const applyMosaic = (x: number, y: number, width: number, height: number) => {
    const clampedWidth = Math.max(Math.round(width), 1)
    const clampedHeight = Math.max(Math.round(height), 1)
    const sampleCanvas = document.createElement('canvas')
    const sampleContext = sampleCanvas.getContext('2d')

    if (!sampleContext) {
      return
    }

    const scaledWidth = Math.max(Math.round(clampedWidth / 10), 1)
    const scaledHeight = Math.max(Math.round(clampedHeight / 10), 1)

    sampleCanvas.width = scaledWidth
    sampleCanvas.height = scaledHeight
    sampleContext.imageSmoothingEnabled = false
    sampleContext.drawImage(canvas, x, y, clampedWidth, clampedHeight, 0, 0, scaledWidth, scaledHeight)

    context.save()
    context.imageSmoothingEnabled = false
    context.drawImage(sampleCanvas, 0, 0, scaledWidth, scaledHeight, x, y, clampedWidth, clampedHeight)
    context.restore()
  }

  for (const shape of annotations) {
    if (shape.type === 'text') {
      const layout = getTextBadgeLayout(shape)
      const x = (layout.textX - currentSelection.left) * widthRatio
      const y = (layout.textY - currentSelection.top) * heightRatio
      const badgeLeft = (layout.left - currentSelection.left) * widthRatio
      const badgeTop = (layout.top - currentSelection.top) * heightRatio
      const badgeWidth = layout.width * widthRatio
      const badgeHeight = layout.height * heightRatio
      const badgeRadius = layout.radius * heightRatio
      const borderSize = shape.borderSize * heightRatio

      context.fillStyle = shape.backgroundColor
      drawRoundedRectPath(context, badgeLeft, badgeTop, badgeWidth, badgeHeight, badgeRadius)
      context.fill()

      if (borderSize > 0) {
        context.strokeStyle = shape.borderColor
        context.lineWidth = Math.max(borderSize, 1)
        drawRoundedRectPath(context, badgeLeft, badgeTop, badgeWidth, badgeHeight, badgeRadius)
        context.stroke()
      }

      context.fillStyle = shape.color
      context.font = `600 ${shape.fontSize * heightRatio}px ${getTextFontStack(shape.fontFamily)}`
      context.textBaseline = 'bottom'
      context.strokeStyle = 'rgba(7, 12, 20, 0.85)'
      context.lineWidth = Math.max(3, shape.fontSize * 0.18 * heightRatio)
      context.strokeText(shape.text, x, y)
      context.fillText(shape.text, x, y)
      continue
    }

    const start = imagePointToStagePoint(shape.start)
    const end = imagePointToStagePoint(shape.end)
    const x1 = (start.x - currentSelection.left) * widthRatio
    const y1 = (start.y - currentSelection.top) * heightRatio
    const x2 = (end.x - currentSelection.left) * widthRatio
    const y2 = (end.y - currentSelection.top) * heightRatio

    if (shape.type === 'rectangle') {
      context.strokeStyle = shape.color
      context.lineWidth = shape.strokeWidth
      context.strokeRect(x1, y1, x2 - x1, y2 - y1)
      continue
    }

    if (shape.type === 'blur') {
      applyMosaic(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
      continue
    }

    const arrow = getFriendlyArrowGeometry({ x: x1, y: y1 }, { x: x2, y: y2 }, shape.strokeWidth)

    context.strokeStyle = shape.color
    context.fillStyle = shape.color
    context.lineWidth = shape.strokeWidth
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    context.moveTo(x1, y1)
    context.lineTo(arrow.shaftEnd.x, arrow.shaftEnd.y)
    context.stroke()

    context.beginPath()
    context.arc(x1, y1, arrow.tailRadius, 0, Math.PI * 2)
    context.fill()

    context.beginPath()
    context.moveTo(arrow.leftWing.x, arrow.leftWing.y)
    context.lineTo(x2, y2)
    context.lineTo(arrow.rightWing.x, arrow.rightWing.y)
    context.quadraticCurveTo(arrow.shaftEnd.x, arrow.shaftEnd.y, arrow.leftWing.x, arrow.leftWing.y)
    context.closePath()
    context.fill()
  }

  return canvas.toDataURL('image/png')
}

const exportToClipboard = async () => {
  try {
    const dataUrl = await buildSelectionDataUrl()
    await invokeTauri('copy_image_to_clipboard', { dataUrl })
    captureStatus.textContent = 'Selection copied to the system clipboard.'
    return true
  } catch (error) {
    captureStatus.textContent = String(error)
    return false
  }
}

const saveSelectionToFile = async () => {
  try {
    const dataUrl = await buildSelectionDataUrl()
    const filePath = await saveWithTauriDialog({
      defaultPath: `screencap-${Date.now()}.png`,
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    })

    if (!filePath) {
      captureStatus.textContent = 'Save cancelled.'
      return
    }

    await invokeTauri('save_image_file', { dataUrl, path: filePath })
    captureStatus.textContent = `Selection saved to ${filePath}.`
  } catch (error) {
    captureStatus.textContent = String(error)
  }
}

const renderFrames = (frames: CaptureFrame[]) => {
  framesState = frames
  overlayPanelMovedByUser = false

  if (frames.length === 0) {
    activeFrame = null
    displayPicker.innerHTML = ''
    captureImage.removeAttribute('src')
    captureImage.hidden = true
    captureEmpty.hidden = false
    resetSelection()
    captureStatus.textContent = 'No displays detected.'
    return
  }

  activeFrame = frames.find((frame) => frame.displayId === activeFrame?.displayId) ?? frames[0]
  captureImage.src = activeFrame.dataUrl
  captureImage.hidden = false
  captureEmpty.hidden = true
  resetSelection()
  renderDisplayPicker()
  autoPlaceOverlayPanel(null)

  captureStatus.textContent = `Display ${activeFrame.displayId} loaded at ${activeFrame.width} x ${activeFrame.height} (${activeFrame.scaleFactor.toFixed(2)}x).`
  renderOverlayState()
}

const hideOverlay = async () => {
  resetSelection()
  activeFrame = null
  framesState = []
  displayPicker.innerHTML = ''
  captureImage.removeAttribute('src')
  captureImage.hidden = true
  captureEmpty.hidden = false
  captureStatus.textContent = 'Overlay dismissed and capture state cleared.'
  overlayPanelMovedByUser = false

  if (!isTauriRuntimeAvailable()) {
    return
  }

  await invokeTauri('hide_overlay')
}

captureStage.addEventListener('pointerdown', (event) => {
  if (!activeFrame || event.button !== 0) {
    return
  }

  const point = getStagePoint(event)
  updateCrosshair(point)

  if (activeTool === 'select') {
    const annotationResizeHandle = getActiveAnnotationResizeHandle(point)

    if (annotationResizeHandle && activeAnnotationId) {
      dragStart = point
      activeAnnotationResizeHandle = annotationResizeHandle
      captureStatus.textContent = 'Resizing selected annotation.'
      captureStage.setPointerCapture(event.pointerId)
      renderAnnotations()
      return
    }

    const resizeHandle = getResizeHandle(point)

    if (resizeHandle) {
      dragStart = point
      activeResizeHandle = resizeHandle
      captureStatus.textContent = 'Resizing selection.'
      captureStage.setPointerCapture(event.pointerId)
      return
    }

    const hitAnnotation = pointInsideSelection(point) ? getAnnotationAtPoint(point) : null

    if (hitAnnotation) {
      setActiveAnnotation(hitAnnotation.id)
      dragStart = point
      activeAnnotationDragId = hitAnnotation.id
      captureStatus.textContent = `${hitAnnotation.type === 'text' ? 'Text' : hitAnnotation.type === 'rectangle' ? 'Rectangle' : hitAnnotation.type === 'arrow' ? 'Arrow' : 'Blur'} annotation selected.`
      captureStage.setPointerCapture(event.pointerId)
      return
    }

    dragStart = point
    activeResizeHandle = null
    clearAnnotations()
    drawSelection(point, point)
  } else {
    if (!currentSelection || !pointInsideSelection(point)) {
      return
    }

    if (activeTool === 'text') {
      return
    }

    dragStart = point
    draftAnnotation = {
      id: `${activeTool}-${Date.now()}`,
      type: activeTool,
      start: stagePointToImagePoint(point),
      end: stagePointToImagePoint(point),
      color: currentAnnotationColor,
      strokeWidth: currentStrokeWidth,
    }
    renderAnnotations()
  }

  captureStage.setPointerCapture(event.pointerId)
})

captureStage.addEventListener('click', (event) => {
  if (activeTool !== 'text' || !currentSelection || isTextEditorActive()) {
    return
  }

  const point = getStagePoint(event)

  if (!pointInsideSelection(point)) {
    return
  }

  showTextEditor(point)
  captureStatus.textContent = 'Type text and press Enter to place the annotation.'
})

captureStage.addEventListener('pointermove', (event) => {
  const point = getStagePoint(event)
  updateCrosshair(point)
  updateSelectionCursor(point)

  if (!dragStart) {
    return
  }

  if (activeTool === 'select') {
    if (activeAnnotationResizeHandle && activeAnnotationId) {
      resizeAnnotationByHandle(activeAnnotationId, activeAnnotationResizeHandle, point)
      renderAnnotations()
      captureStatus.textContent = 'Resizing selected annotation.'
      return
    }

    if (activeResizeHandle) {
      resizeSelection(activeResizeHandle, point)
      return
    }

    if (activeAnnotationDragId && dragStart) {
      const startPoint = stagePointToImagePoint(dragStart)
      const endPoint = stagePointToImagePoint(point)

      moveAnnotationBy(activeAnnotationDragId, {
        x: endPoint.x - startPoint.x,
        y: endPoint.y - startPoint.y,
      })
      dragStart = point
      renderAnnotations()
      captureStatus.textContent = 'Moving selected annotation.'
      return
    }

    drawSelection(dragStart, point)
    return
  }

  if (!draftAnnotation) {
    return
  }

  draftAnnotation = {
    ...draftAnnotation,
    end: stagePointToImagePoint(point),
  }
  renderAnnotations()
})

const clearDrag = (pointerId?: number) => {
  dragStart = null
  activeResizeHandle = null
  activeAnnotationDragId = null
  activeAnnotationResizeHandle = null

  if (pointerId !== undefined && captureStage.hasPointerCapture(pointerId)) {
    captureStage.releasePointerCapture(pointerId)
  }
}

captureStage.addEventListener('pointerup', (event) => {
  if (activeAnnotationResizeHandle) {
    captureStatus.textContent = 'Selected annotation resized.'
  }

  if (activeAnnotationDragId) {
    captureStatus.textContent = 'Selected annotation moved.'
  }

  if (activeTool !== 'select' && activeTool !== 'text' && draftAnnotation) {
    const start = imagePointToStagePoint(draftAnnotation.start)
    const end = imagePointToStagePoint(draftAnnotation.end)
    const width = Math.abs(end.x - start.x)
    const height = Math.abs(end.y - start.y)

    if (width >= 4 || height >= 4) {
      annotations = [...annotations, draftAnnotation]
      updateUndoState()
      captureStatus.textContent = `${draftAnnotation.type === 'rectangle' ? 'Rectangle' : draftAnnotation.type === 'arrow' ? 'Arrow' : 'Blur'} annotation added.`
    }

    draftAnnotation = null
    renderAnnotations()
  }

  clearDrag(event.pointerId)
})

captureStage.addEventListener('dblclick', (event) => {
  if (!currentSelection) {
    return
  }

  const point = getStagePoint(event)
  const hitAnnotation = pointInsideSelection(point) ? getAnnotationAtPoint(point) : null

  if (activeTool === 'select' && hitAnnotation?.type === 'text') {
    setActiveAnnotation(hitAnnotation.id)
    showTextEditor(imagePointToStagePoint(hitAnnotation.start), hitAnnotation)
    captureStatus.textContent = 'Editing text annotation. Update the text and press Enter to apply it.'
    return
  }

  void exportToClipboard()
})

captureStage.addEventListener('pointerleave', () => {
  crosshairVertical.style.transform = 'translateX(-200vw)'
  crosshairHorizontal.style.transform = 'translateY(-200vh)'
  updateSelectionCursor()
})

captureStage.addEventListener('pointercancel', (event) => {
  clearDrag(event.pointerId)
})

const refreshCapture = async () => {
  captureStatus.textContent = 'Capturing monitor buffers...'

  try {
    const canCapture = await invokeTauri<boolean>('ensure_screen_capture_access', { prompt: true })

    if (!canCapture) {
      captureStatus.textContent =
        'Screen capture permission is required. System Settings was opened to Screen Recording so you can allow Screencap.'
      return
    }

    await loadSettings()
    const frames = assertCaptureFrames(await invokeTauri<unknown>('capture_screen'))
    renderFrames(frames)
    captureStatus.textContent = `Loaded ${frames.length} display capture(s).`
  } catch (error) {
    captureStatus.textContent = isTauriRuntimeAvailable()
      ? `Capture failed: ${String(error)}`
      : getTauriUnavailableMessage('Capture commands')
  }
}

refreshButton.addEventListener('click', () => {
  void refreshCapture()
})

annotationColorInput.addEventListener('input', (event) => {
  currentAnnotationColor = (event.target as HTMLInputElement).value
  applyTextEditorStyles()

  if (activeAnnotationId) {
    annotations = annotations.map((annotation) =>
      annotation.id === activeAnnotationId ? { ...annotation, color: currentAnnotationColor } : annotation,
    )
    renderAnnotations()
  }
})

annotationStrokeInput.addEventListener('input', (event) => {
  currentStrokeWidth = Number((event.target as HTMLInputElement).value)
  updatePropertyLabels()

  if (activeAnnotationId) {
    annotations = annotations.map((annotation) =>
      annotation.id === activeAnnotationId && annotation.type !== 'text'
        ? { ...annotation, strokeWidth: currentStrokeWidth }
        : annotation,
    )
    renderAnnotations()
  }
})

annotationFontInput.addEventListener('input', (event) => {
  currentFontSize = Number((event.target as HTMLInputElement).value)
  applyTextEditorStyles()
  updatePropertyLabels()

  if (activeAnnotationId) {
    annotations = annotations.map((annotation) =>
      annotation.id === activeAnnotationId && annotation.type === 'text'
        ? { ...annotation, fontSize: currentFontSize }
        : annotation,
    )
    renderAnnotations()
  }
})

annotationFontFamilyInput.addEventListener('input', (event) => {
  currentTextFontFamily = (event.target as HTMLSelectElement).value as TextFontFamily
  applyTextEditorStyles()

  if (activeAnnotationId) {
    annotations = annotations.map((annotation) =>
      annotation.id === activeAnnotationId && annotation.type === 'text'
        ? { ...annotation, fontFamily: currentTextFontFamily }
        : annotation,
    )
    renderAnnotations()
  }
})

textBackgroundColorInput.addEventListener('input', (event) => {
  currentTextBackgroundColor = (event.target as HTMLInputElement).value
  applyTextEditorStyles()

  if (activeAnnotationId) {
    annotations = annotations.map((annotation) =>
      annotation.id === activeAnnotationId && annotation.type === 'text'
        ? { ...annotation, backgroundColor: currentTextBackgroundColor }
        : annotation,
    )
    renderAnnotations()
  }
})

textBorderSizeInput.addEventListener('input', (event) => {
  currentTextBorderSize = Number((event.target as HTMLInputElement).value)
  applyTextEditorStyles()
  updatePropertyLabels()

  if (activeAnnotationId) {
    annotations = annotations.map((annotation) =>
      annotation.id === activeAnnotationId && annotation.type === 'text'
        ? { ...annotation, borderSize: currentTextBorderSize }
        : annotation,
    )
    renderAnnotations()
  }
})

textBorderColorInput.addEventListener('input', (event) => {
  currentTextBorderColor = (event.target as HTMLInputElement).value
  applyTextEditorStyles()

  if (activeAnnotationId) {
    annotations = annotations.map((annotation) =>
      annotation.id === activeAnnotationId && annotation.type === 'text'
        ? { ...annotation, borderColor: currentTextBorderColor }
        : annotation,
    )
    renderAnnotations()
  }
})

selectToolButton.addEventListener('click', () => {
  activateTool('select')
})

rectangleToolButton.addEventListener('click', () => {
  activateTool('rectangle')
})

arrowToolButton.addEventListener('click', () => {
  activateTool('arrow')
})

textToolButton.addEventListener('click', () => {
  activateTool('text')
})

blurToolButton.addEventListener('click', () => {
  activateTool('blur')
})

editTextAnnotationButton.addEventListener('click', () => {
  editActiveTextAnnotation()
})

sendAnnotationBackwardButton.addEventListener('click', () => {
  sendActiveAnnotationBackward()
})

bringAnnotationFrontButton.addEventListener('click', () => {
  bringActiveAnnotationToFront()
})

undoAnnotationButton.addEventListener('click', () => {
  const removedAnnotationId = annotations[annotations.length - 1]?.id ?? null
  annotations = annotations.slice(0, -1)

  if (removedAnnotationId && activeAnnotationId === removedAnnotationId) {
    activeAnnotationId = null
    syncPropertyControls()
    renderOverlayState()
  }

  updateUndoState()
  renderAnnotations()
  captureStatus.textContent = 'Last annotation removed.'
})

clearSelectionButton.addEventListener('click', () => {
  clearSelection()
})

confirmButton.addEventListener('click', () => {
  void (async () => {
    const exported = await exportToClipboard()

    if (exported) {
      await hideOverlay()
    }
  })()
})

saveButton.addEventListener('click', () => {
  void saveSelectionToFile()
})

displayPicker.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-display-id]')

  if (!target) {
    return
  }

  const displayId = Number(target.dataset.displayId)
  const nextFrame = framesState.find((frame) => frame.displayId === displayId)

  if (!nextFrame) {
    return
  }

  activeFrame = nextFrame
  renderFrames(framesState)
})

dismissButton.addEventListener('click', () => {
  void hideOverlay()
})

repositoryLink.addEventListener('click', (event) => {
  event.preventDefault()
  void openExternalUrl(APP_REPOSITORY_URL)
})

overlayPanelHandle.addEventListener('pointerdown', (event) => {
  overlayPanelMovedByUser = true
  overlayPanelDragPointerId = event.pointerId
  const rect = overlayCard.getBoundingClientRect()
  overlayPanelDragOffset = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  }
  overlayPanelHandle.setPointerCapture(event.pointerId)
  event.preventDefault()
})

overlayPanelHandle.addEventListener('pointermove', (event) => {
  if (overlayPanelDragPointerId !== event.pointerId || !overlayPanelDragOffset) {
    return
  }

  applyOverlayPanelPosition({
    left: event.clientX - overlayPanelDragOffset.x,
    top: event.clientY - overlayPanelDragOffset.y,
  })
})

const stopOverlayPanelDrag = (pointerId?: number) => {
  if (pointerId !== undefined && overlayPanelHandle.hasPointerCapture(pointerId)) {
    overlayPanelHandle.releasePointerCapture(pointerId)
  }

  overlayPanelDragPointerId = null
  overlayPanelDragOffset = null
}

overlayPanelHandle.addEventListener('pointerup', (event) => {
  stopOverlayPanelDrag(event.pointerId)
})

overlayPanelHandle.addEventListener('pointercancel', (event) => {
  stopOverlayPanelDrag(event.pointerId)
})

window.addEventListener('resize', () => {
  if (overlayPanelPosition) {
    applyOverlayPanelPosition(overlayPanelPosition)
    return
  }

  autoPlaceOverlayPanel(currentSelection)
})

textEditorInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    commitTextEditor()
  }

  if (shouldCancelTextEditorOnKeydown(event.key)) {
    event.preventDefault()
    event.stopPropagation()
    hideTextEditor()
    captureStatus.textContent = 'Text annotation cancelled.'
  }
})

textEditorInput.addEventListener('blur', () => {
  if (!textEditorShell.hidden) {
    commitTextEditor()
  }
})

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase()
  const textEditorActive = isTextEditorActive()
  const keyboardShortcutBlocked = isKeyboardShortcutBlocked()

  if (shouldHideOverlayOnKeydown({ key: event.key, textEditorActive, keyboardShortcutBlocked })) {
    hideTextEditor()
    void hideOverlay()
    return
  }

  if (textEditorActive || keyboardShortcutBlocked) {
    return
  }

  if (!event.ctrlKey && !event.metaKey && !event.altKey) {
    switch (key) {
      case 'v':
        activateTool('select')
        return
      case 'r':
        activateTool('rectangle')
        return
      case 'a':
        activateTool('arrow')
        return
      case 't':
        activateTool('text')
        return
      case 'b':
        activateTool('blur')
        return
    }
  }

  if ((event.ctrlKey || event.metaKey) && key === 'z') {
    if (annotations.length > 0) {
      event.preventDefault()
      const removedAnnotationId = annotations[annotations.length - 1]?.id ?? null
      annotations = annotations.slice(0, -1)

      if (removedAnnotationId && activeAnnotationId === removedAnnotationId) {
        activeAnnotationId = null
        syncPropertyControls()
        renderOverlayState()
      }

      updateUndoState()
      renderAnnotations()
      captureStatus.textContent = 'Last annotation removed.'
    }
    return
  }

  if (!currentSelection) {
    return
  }

  if ((event.ctrlKey || event.metaKey) && key === 'e') {
    if (editActiveTextAnnotation()) {
      event.preventDefault()
    }
    return
  }

  if ((event.ctrlKey || event.metaKey) && key === 'd') {
    if (duplicateActiveAnnotation()) {
      event.preventDefault()
    }
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key === '[') {
    if (sendActiveAnnotationBackward()) {
      event.preventDefault()
    }
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key === ']') {
    if (bringActiveAnnotationToFront()) {
      event.preventDefault()
    }
    return
  }

  if ((event.key === 'Delete' || event.key === 'Backspace') && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault()

    if (activeAnnotationId) {
      annotations = annotations.filter((annotation) => annotation.id !== activeAnnotationId)
      activeAnnotationId = null
      syncPropertyControls()
      updateUndoState()
      renderOverlayState()
      renderAnnotations()
      captureStatus.textContent = 'Selected annotation removed.'
      return
    }

    clearSelection()
    return
  }

  if ((event.ctrlKey || event.metaKey) && key === 's') {
    event.preventDefault()
    void saveSelectionToFile()
    return
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void exportToClipboard()
    return
  }

  const step = event.shiftKey ? 10 : 1
  const nudgeTarget = (deltaX: number, deltaY: number) => {
    if (activeAnnotationId) {
      nudgeActiveAnnotation(deltaX, deltaY)
      return
    }

    nudgeSelection(deltaX, deltaY)
  }

  switch (event.key) {
    case 'ArrowUp':
      event.preventDefault()
      nudgeTarget(0, -step)
      break
    case 'ArrowDown':
      event.preventDefault()
      nudgeTarget(0, step)
      break
    case 'ArrowLeft':
      event.preventDefault()
      nudgeTarget(-step, 0)
      break
    case 'ArrowRight':
      event.preventDefault()
      nudgeTarget(step, 0)
      break
  }
})

void listenTauri(HOTKEY_EVENT, () => {
  void refreshCapture()
})

updatePropertyLabels()
renderOverlayState()
void loadSettings()