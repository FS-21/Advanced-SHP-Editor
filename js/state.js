export const TRANSPARENT_COLOR = 65535; // Value beyond 0-255 palette indices

export const state = {
    palette: Array.from({ length: 256 }, () => null),
    frames: [],
    currentFrameIdx: 0,
    activeLayerIdx: 0, // Keeping for compat
    activeLayerId: null, // New ID based selection
    preferredLayerIdx: 0, // Global Intent for "Memory" Across Frames

    primaryColorIdx: 0,

    // Replace Feature
    replacePairs: [], // {src: {r,g,b,idx}|null, tgt: {r,g,b,idx}|null}
    replaceSelection: new Set(), // Set of row indices
    isPickingForReplace: null, // {row: number, side: 'src'|'tgt'} when picking
    isPreviewingReplacement: false,
    isReplacePreviewActive: false,
    multiPickCounter: 0,
    paletteSelection: new Set([0]),
    lastPaletteIdx: 0,
    dragSourceType: null,
    dragSourceCount: 0,
    lastReplaceIdx: null,
    replaceClipboard: [],

    isCtrlPressed: false, // Track Ctrl modifier state globaly for repeaters

    zoom: 1, // Default 100%
    isPlaying: false,
    playTimer: null,
    canvasW: 60,
    canvasH: 48,
    compression: 3, // Default compression (3=RLE)
    copyClipboard: null,

    // View Options
    showBackground: true, // true=Solid (Index 0), false=Checkerboard
    showCenter: false,    // Center lines overlay
    isoGrid: 'none',      // 'none', 'ts', 'ra2'
    useShadows: false,    // SHP Shadow Mode
    fmViewMode: 'mosaic', // 'mosaic' | 'strip'
    fmRelIndex: false,    // Relative indexing for shadow frames
    showShadowOverlay: false, // Visual aid: normal frame overlaid on shadow

    // Tools & Settings
    toolSettings: {
        brushSize: 1,
        brushShape: 'square',
        tolerance: 0,
        contiguous: true,
        sampleAllLayers: false,
        squareFill: false,
        squareFillColor: '#ffffff',
        sprayDensity: 20,
        fillTolerance: 0,
        fillContiguous: true,
        colorShiftAmount: 1,
        colorShiftScope: 'layer', // 'layer', 'frame', 'all'
        ignoreColor0: false
    },
    isPickingSquareFill: false, // New mode flag,

    // Selection
    selection: null, // {type: 'rect'|'mask', x, y, w, h, maskData?}
    selectionMode: 'new', // 'new', 'add', 'sub', 'int', 'xor'
    isSelecting: false,
    floatingSelection: null, // {x, y, w, h, data, maskData?} - pixels extracted from layer, floating above
    dragStart: null, // {x, y} - where the mouse was when drag started
    dragStartFloating: null, // {x, y} - where the floating selection was when drag started
    isMovingSelection: false, // flag for dragging active selection
    isMovingSelectionArea: false, // flag for dragging the selection area only
    isScalingSelection: false, // flag for scaling selection pixels
    isRotatingSelection: false, // flag for rotating selection pixels
    rotationStartAngle: 0,      // angle when drag started
    rotationBaseAngle: 0,       // current rotation angle
    scaleHandleIdx: null,      // index of handle being dragged (0-7)

    // History
    history: [],
    historyPtr: -1,

    // UI
    showGrid: false,
    gridColor: 'light', // 'light' or 'dark'
    selectionFlash: 0,
    selectionDashOffset: 0,
    antsTimer: null,
    showSidePanel: false,
    paletteVersion: 0,
    currentX: undefined,
    currentY: undefined,

    // Frame Manager Split Mode
    fmSplitActive: false,
    fmNewFrames: [],
    fmNewFilename: "NewFile",
    fmActiveSection: 'original', // 'original' or 'new'
    fmSplitRatio: 0.5,           // Ratio for split view (0.25 to 0.75)

    isAlphaImageMode: false,
};

export function generateId() {
    return Math.random().toString(36).substr(2, 9);
}


export let activeTool = 'pencil';
export function setActiveTool(t) { activeTool = t; }

export let isDrawing = false;
export function setIsDrawing(v) { isDrawing = v; }

export let lastPos = null;
export function setLastPos(v) { lastPos = v; }
