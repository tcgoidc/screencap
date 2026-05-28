export type CaptureFrame = {
  displayId: number
  width: number
  height: number
  scaleFactor: number
  dataUrl: string
}

type AnnotationOrderId = string
type AnnotationKind = 'rectangle' | 'arrow' | 'text' | 'blur'

type OverlayKeydownState = {
  key: string
  textEditorActive: boolean
  keyboardShortcutBlocked: boolean
}

const isPositiveInteger = (value: unknown) => Number.isInteger(value) && Number(value) > 0

const isPositiveNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0

const isPngDataUrl = (value: unknown) =>
  typeof value === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)

export const assertCaptureFrames = (frames: unknown): CaptureFrame[] => {
  if (!Array.isArray(frames)) {
    throw new Error('Capture response was not an array of display frames.')
  }

  if (frames.length === 0) {
    throw new Error('Native screen capture returned no display frames.')
  }

  return frames.map((frame, index) => {
    if (!frame || typeof frame !== 'object') {
      throw new Error(`Capture frame ${index + 1} was not an object.`)
    }

    const candidate = frame as Partial<CaptureFrame>

    if (!Number.isInteger(candidate.displayId)) {
      throw new Error(`Capture frame ${index + 1} had an invalid display id.`)
    }

    if (!isPositiveInteger(candidate.width) || !isPositiveInteger(candidate.height)) {
      throw new Error(`Capture frame ${index + 1} had invalid dimensions.`)
    }

    if (!isPositiveNumber(candidate.scaleFactor)) {
      throw new Error(`Capture frame ${index + 1} had an invalid scale factor.`)
    }

    if (!isPngDataUrl(candidate.dataUrl)) {
      throw new Error(`Capture frame ${index + 1} did not contain a PNG data URL.`)
    }

    return candidate as CaptureFrame
  })
}

export const shouldCancelTextEditorOnKeydown = (key: string) => key === 'Escape'

export const shouldHideOverlayOnKeydown = ({
  key,
  textEditorActive,
  keyboardShortcutBlocked,
}: OverlayKeydownState) => key === 'Escape' && !textEditorActive && !keyboardShortcutBlocked

export const canDuplicateSelectedAnnotation = (annotationCount: number, activeAnnotationId: string | null) =>
  annotationCount > 0 && activeAnnotationId !== null

export const canEditSelectedTextAnnotation = (activeAnnotationType: AnnotationKind | null) => activeAnnotationType === 'text'

export const canSendAnnotationBackward = (annotationIds: AnnotationOrderId[], activeAnnotationId: string | null) =>
  Boolean(activeAnnotationId && annotationIds[0] !== activeAnnotationId)

export const canBringAnnotationToFront = (annotationIds: AnnotationOrderId[], activeAnnotationId: string | null) =>
  Boolean(activeAnnotationId && annotationIds[annotationIds.length - 1] !== activeAnnotationId)

export const reorderAnnotationToFront = (annotationIds: AnnotationOrderId[], activeAnnotationId: string | null) => {
  if (!activeAnnotationId || annotationIds[annotationIds.length - 1] === activeAnnotationId) {
    return null
  }

  if (!annotationIds.includes(activeAnnotationId)) {
    return null
  }

  return [...annotationIds.filter((annotationId) => annotationId !== activeAnnotationId), activeAnnotationId]
}

export const reorderAnnotationBackward = (annotationIds: AnnotationOrderId[], activeAnnotationId: string | null) => {
  if (!activeAnnotationId || annotationIds[0] === activeAnnotationId) {
    return null
  }

  const activeIndex = annotationIds.indexOf(activeAnnotationId)

  if (activeIndex <= 0) {
    return null
  }

  const reordered = [...annotationIds]
  const [annotationId] = reordered.splice(activeIndex, 1)
  reordered.splice(activeIndex - 1, 0, annotationId)
  return reordered
}