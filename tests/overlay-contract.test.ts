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
} from '../src/overlay-contract.js'

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

test('capture frames accept valid png payloads', () => {
  const frames = assertCaptureFrames([
    {
      displayId: 1,
      width: 1920,
      height: 1080,
      scaleFactor: 1.25,
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9WlWQAAAAASUVORK5CYII=',
    },
  ])

  expect(frames.length === 1, 'expected one validated capture frame')
  expect(frames[0] && frames[0].displayId === 1, 'expected the display id to remain intact')
})

test('capture frames reject invalid payloads', () => {
  let error: Error | null = null

  try {
    assertCaptureFrames([
      {
        displayId: 1,
        width: 1920,
        height: 1080,
        scaleFactor: 1,
        dataUrl: 'not-a-png',
      },
    ])
  } catch (caught) {
    error = caught as Error
  }

  expect(Boolean(error), 'expected invalid capture payloads to throw')
  expect(error && error.message.includes('PNG data URL'), 'expected the validation failure to describe the payload issue')
})

test('capture frames reject empty native results', () => {
  let error: Error | null = null

  try {
    assertCaptureFrames([])
  } catch (caught) {
    error = caught as Error
  }

  expect(Boolean(error), 'expected empty native capture results to throw')
  expect(error && error.message.includes('no display frames'), 'expected the empty capture failure to describe the missing displays')
})

test('escape hides the overlay only when shortcuts are not blocked', () => {
  expect(
    shouldHideOverlayOnKeydown({ key: 'Escape', textEditorActive: false, keyboardShortcutBlocked: false }),
    'expected Escape to hide the overlay when the overlay owns keyboard focus',
  )
  expect(
    !shouldHideOverlayOnKeydown({ key: 'Escape', textEditorActive: false, keyboardShortcutBlocked: true }),
    'expected Escape to stay local when another input control owns the shortcut',
  )
  expect(
    !shouldHideOverlayOnKeydown({ key: 'Escape', textEditorActive: true, keyboardShortcutBlocked: false }),
    'expected Escape not to hide the overlay while inline text editing is active',
  )
})

test('escape cancels the inline text editor', () => {
  expect(shouldCancelTextEditorOnKeydown('Escape'), 'expected Escape to cancel inline text editing')
  expect(!shouldCancelTextEditorOnKeydown('Enter'), 'expected only Escape to cancel inline text editing')
})

test('selection helpers expose text editing and duplication availability', () => {
  expect(canEditSelectedTextAnnotation('text'), 'expected selected text annotations to be editable')
  expect(!canEditSelectedTextAnnotation('rectangle'), 'expected non-text annotations not to expose text editing')
  expect(canDuplicateSelectedAnnotation(3, 'annotation-2'), 'expected selected annotations to be duplicable')
  expect(!canDuplicateSelectedAnnotation(0, null), 'expected duplication to be unavailable without a selected annotation')
})

test('stacking helpers detect when an annotation can move backward or forward', () => {
  expect(canSendAnnotationBackward(['a', 'b', 'c'], 'b'), 'expected a middle annotation to move backward')
  expect(!canSendAnnotationBackward(['a', 'b', 'c'], 'a'), 'expected the back-most annotation to stay put')
  expect(canBringAnnotationToFront(['a', 'b', 'c'], 'b'), 'expected a middle annotation to move forward')
  expect(!canBringAnnotationToFront(['a', 'b', 'c'], 'c'), 'expected the front-most annotation to stay put')
})

test('stacking helpers reorder annotations predictably', () => {
  const sentBackward = reorderAnnotationBackward(['a', 'b', 'c'], 'c')
  const broughtForward = reorderAnnotationToFront(['a', 'b', 'c'], 'a')

  expect(Boolean(sentBackward), 'expected send-backward to return a new order')
  expect(Boolean(broughtForward), 'expected bring-to-front to return a new order')
  expect(sentBackward && sentBackward.join(',') === 'a,c,b', 'expected send-backward to shift the annotation by one layer')
  expect(broughtForward && broughtForward.join(',') === 'b,c,a', 'expected bring-to-front to move the annotation to the top')
})

test('stacking helpers return null when no reorder is needed', () => {
  expect(reorderAnnotationBackward(['a', 'b', 'c'], 'a') === null, 'expected no-op backward reorder to return null')
  expect(reorderAnnotationToFront(['a', 'b', 'c'], 'c') === null, 'expected no-op forward reorder to return null')
  expect(reorderAnnotationToFront(['a', 'b', 'c'], 'missing') === null, 'expected unknown ids to be ignored safely')
})