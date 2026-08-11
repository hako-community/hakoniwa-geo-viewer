export const LAYOUT_MODES_VERSION = 1;

export const LAYOUT_MODES = Object.freeze({
  operations: Object.freeze({ mapRatio: 0.72, threeRatio: 0.28, mapVisible: true }),
  inspection: Object.freeze({ mapRatio: 0.30, threeRatio: 0.70, mapVisible: true }),
  incident: Object.freeze({ mapRatio: 0.55, threeRatio: 0.45, mapVisible: true }),
  offline: Object.freeze({ mapRatio: 0.0, threeRatio: 1.0, mapVisible: false }),
});

export function normalizeLayoutMode(value, fallback = 'operations') {
  return Object.hasOwn(LAYOUT_MODES, value) ? value : fallback;
}

export function computeLayoutPixels(totalHeight, mode, {
  splitterHeight = 6,
  minimumPaneHeight = 80,
} = {}) {
  const height = Math.max(0, Number(totalHeight) || 0);
  const selectedMode = normalizeLayoutMode(mode);
  const definition = LAYOUT_MODES[selectedMode];
  if (!definition.mapVisible) {
    return { mode: selectedMode, mapHeight: 0, threeHeight: height, splitterVisible: false };
  }
  const available = Math.max(0, height - splitterHeight);
  const maximumMapHeight = Math.max(minimumPaneHeight, available - minimumPaneHeight);
  const mapHeight = Math.min(
    maximumMapHeight,
    Math.max(minimumPaneHeight, Math.round(available * definition.mapRatio)),
  );
  return {
    mode: selectedMode,
    mapHeight,
    threeHeight: Math.max(minimumPaneHeight, available - mapHeight),
    splitterVisible: true,
  };
}

export function computeDraggedLayout(totalHeight, offsetY, {
  splitterHeight = 6,
  minimumPaneHeight = 80,
} = {}) {
  const height = Math.max(0, Number(totalHeight) || 0);
  const available = Math.max(0, height - splitterHeight);
  const mapHeight = Math.min(
    Math.max(minimumPaneHeight, available - minimumPaneHeight),
    Math.max(minimumPaneHeight, Number(offsetY) || 0),
  );
  return {
    mode: 'custom',
    mapHeight,
    threeHeight: Math.max(minimumPaneHeight, available - mapHeight),
    splitterVisible: true,
  };
}
