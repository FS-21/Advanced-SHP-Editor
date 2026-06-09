export const TRANSPARENT_COLOR = 65535; // Value beyond 0-255 palette indices

export class Tab {
    constructor(id, fileName = null, initialState = null) {
        this.id = id;
        this.fileName = fileName;
        this.idName = fileName || '';
        this.isNewProject = false;
        this.fileHandle = null;

        this.palette = initialState ? JSON.parse(JSON.stringify(initialState.palette)) : Array.from({ length: 256 }, () => null);
        this.frames = [];
        this.currentFrameIdx = 0;
        this.activeLayerIdx = 0;
        this.activeLayerId = null;
        this.preferredLayerIdx = 0;
        this.primaryColorIdx = 0;
        this.replacePairs = [];
        this.replaceSelection = new Set();
        this.isPickingForReplace = null;
        this.isPreviewingReplacement = false;
        this.isReplacePreviewActive = false;
        this.multiPickCounter = 0;
        this.paletteSelection = new Set([0]);
        this.lastPaletteIdx = 0;
        this.dragSourceType = null;
        this.dragSourceCount = 0;
        this.lastReplaceIdx = null;
        this.replaceClipboard = [];
        this.isCtrlPressed = false;
        this.zoom = initialState ? initialState.zoom : 1;
        this.isPlaying = false;
        this.playTimer = null;
        this.canvasW = 60;
        this.canvasH = 48;
        this.compression = 3;
        this.copyClipboard = null;
        this.showBackground = true;
        this.showCenter = false;
        this.isoGrid = 'none';
        this.useShadows = false;
        this.fmViewMode = 'mosaic';
        this.fmRelIndex = false;
        this.showShadowOverlay = false;
        this.toolSettings = {
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
            colorShiftScope: 'layer',
            ignoreColor0: false
        };
        this.isPickingSquareFill = false;
        this.selection = null;
        this.selectionMode = 'new';
        this.isSelecting = false;
        this.floatingSelection = null;
        this.dragStart = null;
        this.dragStartFloating = null;
        this.isMovingSelection = false;
        this.isMovingSelectionArea = false;
        this.isScalingSelection = false;
        this.isRotatingSelection = false;
        this.rotationStartAngle = 0;
        this.rotationBaseAngle = 0;
        this.scaleHandleIdx = null;
        this.history = [];
        this.historyPtr = -1;
        this.showGrid = false;
        this.gridColor = 'light';
        this.showSidePanel = false;
        this.paletteVersion = 0;
        this.currentX = undefined;
        this.currentY = undefined;
        this.hasChanges = false;
        this.savedHistoryPtr = -1;
        this._isRestoringHistory = false;
        this.isTmpMode = false;
        this.tmpHeader = null;
        this.originalTmpTiles = null;
        this.tmpFilename = null;
        this.tmpFullZPreviewActive = false;
        this.gameType = 'ra2';
        this.paletteSelectedManually = false;
        this.appliedPaletteId = null;
    }
}

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

    // TMP Mode (TS/RA2 terrain templates)
    isTmpMode: false,         // true when a TMP file is loaded instead of SHP
    tmpHeader: null,          // { cblocks_x, cblocks_y, cx, cy } global tile dimensions
    originalTmpTiles: null,   // raw tiles[] array preserved for lossless re-encoding on save
    tmpFilename: null,        // original filename used for Save
    tmpFullZPreviewActive: false, // New: true when viewing composed Z-data full preview
    paletteSelectedManually: false, // Tracks if user clicked/applied a palette manually in this session
    appliedPaletteId: null, // ID of the palette currently displayed in the SELECT PALETTE selector

    // Tab Management
    tabs: [],
    activeTabIndex: -1,
    newFileCounter: 0,

    saveToTab(tab) {
        if (!tab) return;
        const dummy = new Tab('dummy');
        const keys = Object.keys(dummy);
        keys.forEach(k => {
            if (['id', 'fileName', 'idName', 'fileHandle', 'internalClipboard'].includes(k)) return;
            tab[k] = this[k];
        });
    },

    loadFromTab(tab) {
        if (!tab) return;
        const dummy = new Tab('dummy');
        const keys = Object.keys(dummy);
        keys.forEach(k => {
            if (['id', 'fileName', 'idName', 'fileHandle', 'internalClipboard'].includes(k)) return;
            this[k] = tab[k];
        });
    }
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
