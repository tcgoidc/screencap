const isPositiveInteger = (value) => Number.isInteger(value) && Number(value) > 0;
const isPositiveNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const isPngDataUrl = (value) => typeof value === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value);
export const assertCaptureFrames = (frames) => {
    if (!Array.isArray(frames)) {
        throw new Error('Capture response was not an array of display frames.');
    }
    if (frames.length === 0) {
        throw new Error('Native screen capture returned no display frames.');
    }
    return frames.map((frame, index) => {
        if (!frame || typeof frame !== 'object') {
            throw new Error(`Capture frame ${index + 1} was not an object.`);
        }
        const candidate = frame;
        if (!Number.isInteger(candidate.displayId)) {
            throw new Error(`Capture frame ${index + 1} had an invalid display id.`);
        }
        if (!isPositiveInteger(candidate.width) || !isPositiveInteger(candidate.height)) {
            throw new Error(`Capture frame ${index + 1} had invalid dimensions.`);
        }
        if (!isPositiveNumber(candidate.scaleFactor)) {
            throw new Error(`Capture frame ${index + 1} had an invalid scale factor.`);
        }
        if (!isPngDataUrl(candidate.dataUrl)) {
            throw new Error(`Capture frame ${index + 1} did not contain a PNG data URL.`);
        }
        return candidate;
    });
};
export const shouldCancelTextEditorOnKeydown = (key) => key === 'Escape';
export const shouldHideOverlayOnKeydown = ({ key, textEditorActive, keyboardShortcutBlocked, }) => key === 'Escape' && !textEditorActive && !keyboardShortcutBlocked;
export const canDuplicateSelectedAnnotation = (annotationCount, activeAnnotationId) => annotationCount > 0 && activeAnnotationId !== null;
export const canEditSelectedTextAnnotation = (activeAnnotationType) => activeAnnotationType === 'text';
export const canSendAnnotationBackward = (annotationIds, activeAnnotationId) => Boolean(activeAnnotationId && annotationIds[0] !== activeAnnotationId);
export const canBringAnnotationToFront = (annotationIds, activeAnnotationId) => Boolean(activeAnnotationId && annotationIds[annotationIds.length - 1] !== activeAnnotationId);
export const reorderAnnotationToFront = (annotationIds, activeAnnotationId) => {
    if (!activeAnnotationId || annotationIds[annotationIds.length - 1] === activeAnnotationId) {
        return null;
    }
    if (!annotationIds.includes(activeAnnotationId)) {
        return null;
    }
    return [...annotationIds.filter((annotationId) => annotationId !== activeAnnotationId), activeAnnotationId];
};
export const reorderAnnotationBackward = (annotationIds, activeAnnotationId) => {
    if (!activeAnnotationId || annotationIds[0] === activeAnnotationId) {
        return null;
    }
    const activeIndex = annotationIds.indexOf(activeAnnotationId);
    if (activeIndex <= 0) {
        return null;
    }
    const reordered = [...annotationIds];
    const [annotationId] = reordered.splice(activeIndex, 1);
    reordered.splice(activeIndex - 1, 0, annotationId);
    return reordered;
};
