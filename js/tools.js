import { state, activeTool, setActiveTool, isDrawing, setIsDrawing, lastPos, setLastPos, TRANSPARENT_COLOR } from './state.js';
import { elements } from './constants.js';
import { renderCanvas, renderOverlay, setColor, updateToolSettingsUI, getActiveLayer, triggerSelectionFlash, commitSelection, clearSelection, combineSelection, renderReplaceGrid, updateLayersList, renderFramesList, getLayerDataSnapshot } from './ui.js';
import { pushHistory } from './history.js';
import { bresenham } from './utils.js';
import { openNewShpDialog, updateUIState } from './main.js';
export function setTool(t) {
    const selectionRelatedTools = ['select', 'lasso', 'wand', 'movePixels', 'moveSelectionArea'];
    const isNewToolSelectionRelated = selectionRelatedTools.includes(t);

    setActiveTool(t); // Always set, no toggle

    // Auto-close extra side panel when selecting any drawing tool
    if (t && state.showSidePanel) {
        state.showSidePanel = false;
        if (elements.sidePanelExtra) elements.sidePanelExtra.classList.add('collapsed');
        if (elements.btnToggleSidePanel) elements.btnToggleSidePanel.classList.remove('active');
    }

    // Commit any floating selection when changing tools (except if new tool is movePixels)
    if (state.floatingSelection && t !== 'movePixels') {
        if (isNewToolSelectionRelated) {
            commitSelection(); // Merge pixels, keep area
        } else {
            clearSelection(); // Merge pixels, clear area
        }
    } else if (!isNewToolSelectionRelated && t !== null) {
        // Selection persists even if the tool is not selection-related
        renderOverlay();
    }

    document.querySelectorAll('.tool-btn').forEach(b => {
        if (b === elements.btnToggleSidePanel) return;
        b.classList.remove('active');
    });

    updateToolSettingsUI(t);

    // update UI for new tool (if any)
    const current = activeTool; // Get the new state
    if (!current) {
        // No tool active -> Hand/Pan mode implicitly
        // Keep selection!
        renderCanvas();
        renderOverlay(undefined, undefined, null, lastPos);
        return;
    }

    const map = {
        'pencil': elements.btnToolPencil,
        'eraser': elements.btnToolEraser,
        'select': elements.btnToolSelect,
        'lasso': elements.btnToolLasso,
        'movePixels': elements.btnToolMovePixels,
        'moveSelectionArea': elements.btnToolMoveSelection,
        'line': elements.btnToolLine,
        'rect': elements.btnToolRect,
        'wand': elements.btnToolWand,
        'spray': elements.btnToolSpray,
        'fill': elements.btnToolFill,
        'picker': elements.btnToolPicker,
        'colorShift': elements.btnToolColorShift
    };
    if (map[current]) map[current].classList.add('active');

    updateCanvasCursor(false);

    // state.selection = null; // Do NOT clear selection when switching tools (allows resizing/moving later)
    // state.oldSelection = null;
    renderCanvas();
    renderOverlay(undefined, undefined, current, lastPos);

    // Feature: Auto-focus canvas so keyboard shortcuts work immediately
    if (elements.mainCanvas) elements.mainCanvas.focus();
}

/**
 * Centralized cursor management.
 * @param {boolean} isOverSelection - Whether the mouse is currently over an active selection mask.
 */
export function updateCanvasCursor(isOverSelection, forceCursor = null) {
    const current = activeTool;
    const moveTools = ['movePixels', 'moveSelectionArea'];

    let cursor = 'default';

    if (forceCursor) {
        cursor = forceCursor;
    } else if (isOverSelection && moveTools.includes(current)) {
        cursor = 'move';
    } else if (current === 'picker') {
        // Custom crosshair with hollow center for picker
        const crosshairSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='15' height='15' viewBox='0 0 15 15'><path d='M7 0v6M7 9v6M0 7h6M9 7h6' stroke='white' stroke-width='1.5'/><path d='M7 0v6M7 9v6M0 7h6M9 7h6' stroke='black' stroke-width='0.5'/></svg>`;
        cursor = `url("data:image/svg+xml,${encodeURIComponent(crosshairSvg)}") 7 7, crosshair`;
    } else if (['select', 'lasso', 'line', 'rect', 'wand', 'fill'].includes(current)) {
        cursor = 'crosshair';
    } else if (['pencil', 'eraser', 'spray'].includes(current)) {
        cursor = 'none'; // Drawing tools use custom brush previews in the overlay
    } else if (moveTools.includes(current)) {
        cursor = 'move';
    }

    if (lastCursor !== cursor) {
        elements.mainCanvas.style.cursor = cursor;
        elements.overlayCanvas.style.cursor = cursor;
        lastCursor = cursor;
    }
}

let lastCursor = '';

export function handleTool(x, y, isFirstPoint = false, renderOutput = true) {
    // console.log("Handle Tool:", x, y, activeTool);
    const frame = state.frames[state.currentFrameIdx];
    // Use getActiveLayer helper which handles ID-based selection and fallback
    const layer = getActiveLayer();
    if (!layer || !layer.visible) {
        console.warn("Layer not visible or active");
        return;
    }

    if (layer.type === 'external_shp') {
        // Selection tools are allowed but handled in mousedown/mousemove,
        // drawing tools and move tools are blocked here.
        if (!['select', 'lasso', 'wand'].includes(activeTool)) {
            console.warn("Editing/moving blocked on External SHP layer");
            return;
        }
    }


    // Selection handling is now handled inside fillCircle/spray/etc. at the pixel level
    // to allow brushes to paint into selections even if the center is slightly outside.


    const size = state.toolSettings.brushSize;
    let colorIdx = state.primaryColorIdx;

    // Shadows mode restriction: force index 1 for any non-zero index ONLY on shadow frames
    const isShadowFrame = state.useShadows && (state.currentFrameIdx >= state.frames.length / 2);
    if (isShadowFrame && colorIdx > 1) {
        colorIdx = 1;
    }

    if (activeTool === 'pencil') {
        fillCircle(layer, x, y, size, colorIdx);
        layer._v = (layer._v || 0) + 1;
        if (frame) frame._v = (frame._v || 0) + 1;
        if (renderOutput) renderCanvas();
    } else if (activeTool === 'eraser') {
        fillCircle(layer, x, y, size, TRANSPARENT_COLOR, true);
        layer._v = (layer._v || 0) + 1;
        if (frame) frame._v = (frame._v || 0) + 1;
        if (renderOutput) renderCanvas();
    } else if (activeTool === 'spray') {
        spray(layer, x, y, size, colorIdx);
        layer._v = (layer._v || 0) + 1;
        if (frame) frame._v = (frame._v || 0) + 1;
        if (renderOutput) renderCanvas();
    } else if (activeTool === 'fill' && isFirstPoint) {
        floodFill(layer, x, y, colorIdx);
        layer._v = (layer._v || 0) + 1;
        if (frame) frame._v = (frame._v || 0) + 1;
        if (renderOutput) renderCanvas();
    }
}


export function getSelectionHandleAt(x, y, sel, z) {
    if (!sel) return null;
    const handleSize = 6;
    const threshold = (handleSize / 2 + 2) / z;

    const sx = sel.x;
    const sy = sel.y;
    const sw = sel.w;
    const sh = sel.h;

    const positions = [
        [sx, sy], [sx + sw / 2, sy], [sx + sw, sy], // 0, 1, 2
        [sx, sy + sh / 2], [sx + sw, sy + sh / 2], // 3, 4
        [sx, sy + sh], [sx + sw / 2, sy + sh], [sx + sw, sy + sh] // 5, 6, 7
    ];

    for (let i = 0; i < positions.length; i++) {
        const [px, py] = positions[i];
        if (Math.abs(x - px) <= threshold && Math.abs(y - py) <= threshold) {
            return i;
        }
    }

    // New: Rotation Zone detection
    // Only allow rotation if tool is movePixels and we are near any of the 8 selection handles
    if (activeTool === 'movePixels') {
        const outThresh = 25 / z; // Outer boundary from handle (25px)

        const isInsideSelection = (x >= sx && x <= sx + sw && y >= sy && y <= sy + sh);

        if (!isInsideSelection) {
            const handleIndices = [0, 1, 2, 3, 4, 5, 6, 7]; // All 8 handles
            for (const c of handleIndices) {
                const [cx, cy] = positions[c];
                // Euclidean distance for a nice circular rotation area at the handle
                const dist = Math.sqrt(Math.pow(x - cx, 2) + Math.pow(y - cy, 2));

                // If it is close to the handle but outside the selection box
                // (It won't conflict with scaling points because scaling is checked first above)
                if (dist <= outThresh) {
                    return 8; // rotation
                }
            }
        }
    }

    return null;
}

export function handleToCursor(idx) {
    if (idx === 8) {
        // Rotation cursor: Curved double arrow (SVG)
        const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8'/><path d='M21 3v5h-5'/></svg>`;
        const b64 = btoa(svg);
        return `url("data:image/svg+xml;base64,${b64}") 12 12, auto`;
    }
    const cursors = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'ew-resize', 'nesw-resize', 'ns-resize', 'nwse-resize'];
    return cursors[idx] || 'default';
}

/**
 * Helper to check if a pixel coordinate is within the active selection.
 */
export function isPixelInSelection(x, y) {
    if (!state.selection) return true;
    const sel = state.selection;
    if (sel.type === 'rect') {
        return x >= sel.x && x < sel.x + sel.w &&
            y >= sel.y && y < sel.y + sel.h;
    } else if (sel.type === 'mask') {
        const mx = x - sel.x;
        const my = y - sel.y;
        if (mx < 0 || mx >= sel.w || my < 0 || my >= sel.h) return false;
        return !!sel.maskData[my * sel.w + mx];
    }
    return true;
}

export function fillCircle(layer, cx, cy, size, colorIdx, isEraser = false) {
    let target = layer.data;

    // Mask Editing Override
    if (layer.editMask && layer.mask) {
        target = layer.mask;
        // In Mask Mode:
        // Pencil (Normal) -> Paints 0 (Hide/Black)
        // Eraser -> Paints 1 (Show/White)
        colorIdx = isEraser ? 1 : 0;
    }

    if (size === 1 || state.toolSettings.brushShape === 'square') {
        const startX = size === 1 ? cx : Math.round(cx - size / 2);
        const startY = size === 1 ? cy : Math.round(cy - size / 2);

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const px = startX + x;
                const py = startY + y;

                if (px >= 0 && px < layer.width && py >= 0 && py < layer.height) {
                    if (isPixelInSelection(px, py)) {
                        target[py * layer.width + px] = colorIdx;
                    }
                }
            }
        }
        return;
    }

    // Circular brush logic
    const startX = Math.round(cx - size / 2);
    const startY = Math.round(cy - size / 2);
    const radiusSq = (size / 2) * (size / 2);

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const px = startX + x;
            const py = startY + y;

            if (px < 0 || px >= layer.width || py < 0 || py >= layer.height) continue;
            if (!isPixelInSelection(px, py)) continue;

            const dx = px - cx;
            const dy = py - cy;

            if (dx * dx + dy * dy <= radiusSq) {
                target[py * layer.width + px] = colorIdx;
            }
        }
    }
}



export function magicWand(minX, minY, mode = null) {
    console.log('WAND ENTRY: state.selection=', state.selection, 'mode=', mode);

    const frame = state.frames[state.currentFrameIdx];
    const layer = getActiveLayer();
    if (!layer) {
        console.log('WAND: No active layer');
        return;
    }

    // Use snapshot helper to handle both regular and external SHP layers
    const sourceData = getLayerDataSnapshot(layer);

    // Check if layer has data
    if (!sourceData) {
        console.log('WAND: Layer has no data, cannot select');
        return;
    }

    const w = state.canvasW;
    const h = state.canvasH;

    const startIdx = sourceData[minY * w + minX];
    const tolerance = state.toolSettings.tolerance || 0;
    const contiguous = state.toolSettings.contiguous;
    const startColor = state.palette[startIdx] || { r: 0, b: 0, g: 0 };

    // Convert tolerance from percentage (0-100) to RGB distance (0-765)
    // Max RGB distance = 255*3 = 765, so tolerance% * 7.65 = max distance
    const maxDistance = Math.floor((tolerance / 100) * 765);

    function colorMatch(idx) {
        if (idx === startIdx) return true;
        if (layer.editMask) return false; // Strict match for mask
        if (tolerance === 0) return false;
        if (startIdx === TRANSPARENT_COLOR || idx === TRANSPARENT_COLOR) return false; // Transparent only matches itself (checked above)
        // Treat undefined/null in palette as black for distance check
        const c1 = (state.palette && state.palette[idx]) || { r: 0, g: 0, b: 0 };
        const c2 = startColor;
        const dist = Math.abs(c1.r - c2.r) + Math.abs(c1.g - c2.g) + Math.abs(c1.b - c2.b);
        return dist <= maxDistance;
    }

    let mask;
    let minSelX = w, minSelY = h, maxSelX = 0, maxSelY = 0;
    let foundAny = false;

    if (!contiguous) {
        // Global selection - check all pixels
        mask = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                if (colorMatch(sourceData[i])) {
                    mask[i] = 1;
                    foundAny = true;
                    if (x < minSelX) minSelX = x;
                    if (x > maxSelX) maxSelX = x;
                    if (y < minSelY) minSelY = y;
                    if (y > maxSelY) maxSelY = y;
                }
            }
        }
    } else {
        // Contiguous selection - flood fill
        const visited = new Uint8Array(w * h);
        mask = new Uint8Array(w * h);
        const stack = [[minX, minY]];

        while (stack.length) {
            const [cx, cy] = stack.pop();
            if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;

            const pIdx = cy * w + cx;
            if (visited[pIdx]) continue;
            visited[pIdx] = 1;

            if (colorMatch(sourceData[pIdx])) {
                mask[pIdx] = 1;
                foundAny = true;

                // Track bounds
                if (cx < minSelX) minSelX = cx;
                if (cx > maxSelX) maxSelX = cx;
                if (cy < minSelY) minSelY = cy;
                if (cy > maxSelY) maxSelY = cy;

                // Add neighbors
                stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
            }
        }
    }

    // Use mode parameter if provided, otherwise use state.selectionMode
    const effectiveMode = mode || state.selectionMode;

    // Optimize mask into a smaller array covering only [minX, minY, selW, selH]
    const selW = maxSelX - minSelX + 1;
    const selH = maxSelY - minSelY + 1;

    // Use foundAny to check if anything was selected, regardless of size relative to canvas
    if (foundAny) {
        const optimizedMask = new Uint8Array(selW * selH);
        for (let y = 0; y < selH; y++) {
            for (let x = 0; x < selW; x++) {
                const srcIdx = (minSelY + y) * w + (minSelX + x);
                const dstIdx = y * selW + x;
                optimizedMask[dstIdx] = mask[srcIdx];
            }
        }

        const newSelection = {
            type: 'mask',
            x: minSelX,
            y: minSelY,
            w: selW,
            h: selH,
            maskData: optimizedMask
        };

        // Combine with existing selection if mode is not 'new'
        if (state.selection && effectiveMode !== 'new') {
            try {
                state.selection = combineSelection(state.selection, newSelection, effectiveMode);
            } catch (error) {
                console.error('WAND: combineSelection ERROR:', error);
                state.selection = newSelection;
            }
        } else {
            state.selection = newSelection;
        }

        // Start marching ants animation
        startAnts();
        renderOverlay();
    } else {
        // No pixels selected
        if (effectiveMode === 'new') {
            state.selection = null;
            renderOverlay();
        }
    }
}

function pointInPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i].x, yi = points[i].y;
        const xj = points[j].x, yj = points[j].y;
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

export function pickColor(x, y, isMultiSelect = false) {
    const layer = getActiveLayer();
    if (!layer || !layer.data) return -1;

    const lw = layer.width || state.canvasW;
    const lh = layer.height || state.canvasH;
    const lx = layer.x || 0;
    const ly = layer.y || 0;

    const localX = Math.floor(x - lx);
    const localY = Math.floor(y - ly);

    if (localX < 0 || localX >= lw || localY < 0 || localY >= lh) return -1;

    const idx = layer.data[localY * lw + localX];

    // Ignore void pixels (65535), keep everything else (0-255)
    if (idx === TRANSPARENT_COLOR) return -1;

    // Success
    if (!isMultiSelect) {
        state.paletteSelection.clear();
    }
    state.paletteSelection.add(idx);
    state.lastPaletteIdx = idx;

    setColor(idx);
    return idx;
}

export function finishLassoSelection() {
    const points = state.startSel;
    if (!points || points.length < 3) {
        state.selection = null; // Too small
        return;
    }
    const w = state.canvasW;
    const h = state.canvasH;

    // Use Offscreen Canvas to fill polygon
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // 1. Draw the vector path for filling
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();

    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // 2. Draw the exact pixel boundary (Bresenham) to match preview/interaction
    // This ensures the "touched" pixels are included
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        const line = bresenham(p1.x, p1.y, p2.x, p2.y);
        line.forEach(p => ctx.fillRect(p.x, p.y, 1, 1));
    }

    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;

    // Find Bounds
    let minX = w, maxX = -1, minY = h, maxY = -1;
    // Iterate to find bounds and create mask
    // We can do one pass to find bounds, then another to extract, or one pass to build full mask then crop.

    // Build full mask first to be accurate
    const fullMask = new Uint8Array(w * h);
    let hasPixels = false;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            // Check if pixel has any alpha (lowered threshold to catch antialiased pixels)
            // Also check if any RGB channel is non-zero (white fill)
            if (d[idx + 3] > 0 || d[idx] > 0 || d[idx + 1] > 0 || d[idx + 2] > 0) {
                fullMask[y * w + x] = 1;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                hasPixels = true;
            }
        }
    }

    if (!hasPixels) {
        state.selection = null;
        return;
    }

    // Crop to Bounds
    const rw = maxX - minX + 1;
    const rh = maxY - minY + 1;
    const croppedMask = new Uint8Array(rw * rh);

    for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
            croppedMask[y * rw + x] = fullMask[(minY + y) * w + (minX + x)];
        }
    }

    const sel = {
        type: 'mask',
        x: minX, y: minY, w: rw, h: rh,
        maskData: croppedMask,
        points: points
    };

    if (state.selectionMode === 'new' || !state.selection) {
        state.selection = sel;
    } else {
        state.selection = combineSelection(state.selection, sel, state.selectionMode);
    }
    return sel;
}

export function deleteSelection() {
    if (!state.selection) return;

    // If floating, "Delete" means discard the floating part (Destructive)
    // The original part underneath was already cut (transparent).
    // So discarding floating = deleting content.
    if (state.floatingSelection) {
        state.floatingSelection = null;
        state.isMovingSelection = false;
        pushHistory();
        renderCanvas();
        renderOverlay();
        return;
    }

    const layer = getActiveLayer();
    if (!layer || !layer.visible) return;
    const sel = state.selection;
    if (sel.type === 'rect') {
        for (let y = sel.y; y < sel.y + sel.h; y++) {
            for (let x = sel.x; x < sel.x + sel.w; x++) {
                if (x >= 0 && x < layer.width && y >= 0 && y < layer.height) layer.data[y * layer.width + x] = TRANSPARENT_COLOR;
            }
        }
    } else if (sel.type === 'mask') {
        for (let y = 0; y < sel.h; y++) {
            for (let x = 0; x < sel.w; x++) {
                if (sel.maskData[y * sel.w + x]) {
                    const idx = (sel.y + y) * layer.width + (sel.x + x);
                    if (idx >= 0 && idx < layer.data.length) layer.data[idx] = TRANSPARENT_COLOR;
                }
            }
        }
    }
    layer._v = (layer._v || 0) + 1;
    pushHistory();
    renderCanvas();
    updateLayersList();
    renderFramesList();
    renderOverlay();
}

export function getPos(e) {
    const rect = elements.mainCanvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / state.zoom);
    const y = Math.floor((e.clientY - rect.top) / state.zoom);
    return { x, y };
}

export function fillRectangle(layer, x0, y0, x1, y1, colorIdx, filled, hexFillColor, borderSize = 1) {
    let target = layer.data;
    if (layer.editMask && layer.mask) {
        target = layer.mask;
        colorIdx = 1; // Always paint 1 (Visible) on Mask with Rect
    }

    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;

    // Is Filled?
    let fillIdx = 0;
    if (filled && hexFillColor && !layer.editMask) { // Skip color lookup for mask
        const r = parseInt(hexFillColor.substr(1, 2), 16);
        const g = parseInt(hexFillColor.substr(3, 2), 16);
        const b = parseInt(hexFillColor.substr(5, 2), 16);

        let minDist = Infinity;
        for (let i = 0; i < state.palette.length; i++) {
            const c = state.palette[i];
            // Allow index 0 even if palette entry is "null" (meaning transparent)
            // if we are searching for a match to a hex color.
            let cr, cg, cb;
            if (!c) {
                // Assume color 0 is transparent (0,0,0,0) or some default
                cr = 0; cg = 0; cb = 0;
            } else {
                cr = c.r; cg = c.g; cb = c.b;
            }

            const dist = Math.abs(cr - r) + Math.abs(cg - g) + Math.abs(cb - b);
            if (dist < minDist) {
                minDist = dist;
                fillIdx = i;
            }
        }
    } else if (layer.editMask) {
        fillIdx = 1; // Fill White on Mask
    }

    // Fill interior
    if (filled) {
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                if (x < 0 || x >= layer.width || y < 0 || y >= layer.height) continue;
                if (isPixelInSelection(x, y)) {
                    target[y * layer.width + x] = fillIdx;
                }
            }
        }
    }

    // Stroke Borders using brush stamp
    // Top
    for (let x = minX; x <= maxX; x++) fillCircle(layer, x, minY, borderSize, colorIdx);
    // Bottom
    for (let x = minX; x <= maxX; x++) fillCircle(layer, x, maxY, borderSize, colorIdx);
    // Left
    for (let y = minY + 1; y < maxY; y++) fillCircle(layer, minX, y, borderSize, colorIdx);
    // Right
    for (let y = minY + 1; y < maxY; y++) fillCircle(layer, maxX, y, borderSize, colorIdx);
}


export function addReplacePair() {
    state.replacePairs.push({ srcIdx: null, tgtIdx: null });
    renderReplaceGrid();
}

export function removeReplacePairs() {
    const indices = Array.from(state.replaceSelection).sort((a, b) => b - a);
    indices.forEach(i => {
        if (i < state.replacePairs.length) state.replacePairs.splice(i, 1);
    });
    state.replaceSelection.clear();
    renderReplaceGrid();
}

export function swapReplaceCols() {
    state.replacePairs.forEach(p => {
        const tempIdx = p.srcIdx;
        p.srcIdx = p.tgtIdx;
        p.tgtIdx = tempIdx;

        const tempSrc = p.src;
        p.src = p.tgt;
        p.tgt = tempSrc;
    });
    renderReplaceGrid();
}

export function copyReplacePairs() {
    state.replaceClipboard = Array.from(state.replaceSelection)
        .sort((a, b) => a - b)
        .map(i => {
            const p = state.replacePairs[i];
            return { ...p };
        });
}

export function pasteReplacePairs() {
    if (!state.replaceClipboard || state.replaceClipboard.length === 0) return;
    state.replaceClipboard.forEach(p => {
        state.replacePairs.push({ ...p });
    });
    renderReplaceGrid();
}


// handleReplacePickerInput moved to ui.js to centralize with grid rendering and selection logic.


export function processReplace() {
    const startInp = document.getElementById('replaceFrameStart');
    const endInp = document.getElementById('replaceFrameEnd');

    const start = startInp ? (parseInt(startInp.value) || 0) : 0;
    const end = endInp ? (parseInt(endInp.value) || state.frames.length - 1) : state.frames.length - 1;

    // Build valid map: srcIdx -> tgtIdx
    const validMap = new Map();
    state.replacePairs.forEach(pair => {
        // Prioritize srcIdx/tgtIdx
        if (pair.srcIdx !== undefined && pair.tgtIdx !== undefined && pair.srcIdx !== null && pair.tgtIdx !== null) {
            validMap.set(pair.srcIdx, pair.tgtIdx);
        } else if (pair.src && pair.tgt && pair.src.idx !== undefined && pair.tgt.idx !== undefined) {
            // Fallback for legacy objects
            validMap.set(pair.src.idx, pair.tgt.idx);
        }
    });

    if (validMap.size === 0) return;

    const frameIndices = [];
    for (let i = Math.max(0, start); i <= Math.min(end, state.frames.length - 1); i++) {
        frameIndices.push(i);
    }

    frameIndices.forEach(fIdx => {
        const frame = state.frames[fIdx];

        function processNode(node) {
            if (node.type === 'external_shp') return; // PROTECT External SHP
            if (node.data) {
                let changed = false;
                // Determine if node.data is TypedArray or regular array
                // It's typically Uint8Array for layers
                for (let i = 0; i < node.data.length; i++) {
                    const currentIdx = node.data[i];
                    if (validMap.has(currentIdx)) {
                        node.data[i] = validMap.get(currentIdx);
                        changed = true;
                    }
                }
                if (changed) node._v = (node._v || 0) + 1;
            }
            if (node.children) {
                node.children.forEach(processNode);
            }
        }

        frame.layers.forEach(processNode);
        frame._v = (frame._v || 0) + 1;
    });

    pushHistory('all');
    renderCanvas();
    console.log("Replace processed for frames", start, "to", end);
    alert("Colors replaced successfully.");
}

export function spray(layer, cx, cy, size, colorIdx) {
    const density = state.toolSettings.sprayDensity || 20;
    const target = layer.editMask && layer.mask ? layer.mask : layer.data;
    const actualColor = layer.editMask && layer.mask ? 0 : colorIdx;
    const shape = state.toolSettings.brushShape || 'square';

    // Density is number of pixels per "stamp"
    let area = size * size;
    if (shape === 'circle' && size > 1) {
        area = Math.PI * (size / 2) * (size / 2);
    }
    const count = Math.max(1, Math.floor((area * (density / 100)) / 2));

    const startX = Math.round(cx - size / 2);
    const startY = Math.round(cy - size / 2);
    const radiusSq = (size / 2) * (size / 2);

    for (let i = 0; i < count; i++) {
        const x = startX + Math.floor(Math.random() * size);
        const y = startY + Math.floor(Math.random() * size);

        if (x >= 0 && x < layer.width && y >= 0 && y < layer.height) {
            // Respect Brush Shape
            if (shape === 'circle' && size > 1) {
                const dx = (x + 0.5) - cx;
                const dy = (y + 0.5) - cy;
                if (dx * dx + dy * dy > radiusSq) {
                    i--; // Retry to keep density consistent
                    continue;
                }
            }

            // Respect Selection
            if (!isPixelInSelection(x, y)) continue;
            target[y * layer.width + x] = actualColor;
        }
    }
}

export function floodFill(layer, startX, startY, colorIdx) {
    const w = layer.width;
    const h = layer.height;
    const sourceData = layer.editMask && layer.mask ? layer.mask : layer.data;
    const targetColorIdx = layer.editMask && layer.mask ? 0 : colorIdx;

    const startIdx = sourceData[startY * w + startX];
    if (startIdx === targetColorIdx && !layer.editMask) return; // Already that color

    const tolerance = state.toolSettings.fillTolerance || 0;
    const contiguous = state.toolSettings.fillContiguous;
    const startColor = state.palette[startIdx] || { r: 0, b: 0, g: 0 };
    const maxDistance = Math.floor((tolerance / 100) * 765);

    function colorMatch(idx) {
        if (idx === startIdx) return true;
        if (layer.editMask) return false;
        if (tolerance === 0) return false;
        if (startIdx === TRANSPARENT_COLOR || idx === TRANSPARENT_COLOR) return false; // Transparent only matches itself (checked above)
        const c = state.palette[idx];
        if (!c) return false;
        const dist = Math.abs(c.r - startColor.r) + Math.abs(c.g - startColor.g) + Math.abs(c.b - startColor.b);
        return dist <= maxDistance;
    }

    if (!contiguous) {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                if (colorMatch(sourceData[i]) && isPixelInSelection(x, y)) {
                    sourceData[i] = targetColorIdx;
                }
            }
        }
    } else {
        const queue = [[startX, startY]];
        const visited = new Uint8Array(w * h);
        visited[startY * w + startX] = 1;

        while (queue.length > 0) {
            const [x, y] = queue.shift();
            // sourceData[y * w + x] Check here
            if (isPixelInSelection(x, y)) {
                sourceData[y * w + x] = targetColorIdx;
            }

            const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
            for (const [nx, ny] of neighbors) {
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                    const nIdx = ny * w + nx;
                    if (!visited[nIdx] && colorMatch(sourceData[nIdx]) && isPixelInSelection(nx, ny)) {
                        visited[nIdx] = 1;
                        queue.push([nx, ny]);
                    }
                }
            }
        }
    }
}

export function deselect() {
    if (state.selection) {
        clearSelection();
        renderCanvas();
        renderOverlay();
        if (typeof updateUIState === 'function') updateUIState();
    }
}

export function cropToSelection() {
    if (!state.selection && !state.floatingSelection) return;

    const fs = state.floatingSelection;
    const sel = state.selection;
    const cropX = sel ? sel.x : fs.x;
    const cropY = sel ? sel.y : fs.y;
    const cropW = sel ? sel.w : fs.w;
    const cropH = sel ? sel.h : fs.h;

    // Resize state
    state.canvasW = cropW;
    state.canvasH = cropH;

    // Process all frames and layers
    state.frames.forEach((frame, fIdx) => {
        frame.width = cropW;
        frame.height = cropH;

        frame.layers.forEach(layer => {
            if (layer.type === 'group' || layer.type === 'external_shp') return;

            const oldData = layer.data;
            const newData = new Uint16Array(cropW * cropH);
            newData.fill(TRANSPARENT_COLOR);
            const oldW = layer.width;
            const oldH = layer.height;

            // Copy logic
            for (let y = 0; y < cropH; y++) {
                for (let x = 0; x < cropW; x++) {
                    const srcX = cropX + x;
                    const srcY = cropY + y;

                    if (srcX >= 0 && srcX < oldW && srcY >= 0 && srcY < oldH) {
                        const oldIdx = oldData[srcY * oldW + srcX];

                        // If this is the active layer, check if pixel was inside selection mask
                        if (layer.id === state.activeLayerId) {
                            let isInMask = true;
                            if (sel && sel.type === 'mask' && sel.maskData) {
                                if (!sel.maskData[y * cropW + x]) isInMask = false;
                            }

                            if (isInMask) {
                                newData[y * cropW + x] = oldIdx;
                            } else {
                                newData[y * cropW + x] = TRANSPARENT_COLOR;
                            }
                        } else {
                            // Other layers: Just crop (preserve content)
                            newData[y * cropW + x] = oldIdx;
                        }
                    }
                }
            }

            // If this is the active layer and we have a floating selection, merge it directly into newData!
            // This bypasses the old canvas bounds clipping from a standard commitSelection().
            if (fs && fIdx === fs.frameIdx && layer.id === fs.targetLayerId) {
                for (let fy = 0; fy < fs.h; fy++) {
                    for (let fx = 0; fx < fs.w; fx++) {
                        if (fs.maskData && !fs.maskData[fy * fs.w + fx]) continue;

                        const val = fs.data[fy * fs.w + fx];
                        if (val !== TRANSPARENT_COLOR) {
                            const nx = (fs.x + fx) - cropX;
                            const ny = (fs.y + fy) - cropY;
                            if (nx >= 0 && nx < cropW && ny >= 0 && ny < cropH) {
                                newData[ny * cropW + nx] = val;
                            }
                        }
                    }
                }
            }

            layer.data = newData;
            layer.width = cropW;
            layer.height = cropH;
            layer._v = (layer._v || 0) + 1;
        });
    });

    state.selection = null;
    state.floatingSelection = null;
    state.isSelecting = false;
    state.isMovingSelection = false;

    pushHistory('all');
    updateCanvasSize();
    updateLayersList();
    renderFramesList();
    renderCanvas();
    renderOverlay();
}

export function fillSelection() {
    if (!state.selection) return;
    const layer = getActiveLayer();
    if (!layer || !layer.visible) return;

    const sel = state.selection;
    const colorIdx = state.primaryColorIdx;
    const w = state.canvasW;
    const h = state.canvasH;

    if (sel.type === 'rect') {
        for (let y = sel.y; y < sel.y + sel.h; y++) {
            for (let x = sel.x; x < sel.x + sel.w; x++) {
                if (x >= 0 && x < w && y >= 0 && y < h) {
                    layer.data[y * w + x] = colorIdx;
                }
            }
        }
    } else if (sel.type === 'mask') {
        for (let y = 0; y < sel.h; y++) {
            for (let x = 0; x < sel.w; x++) {
                if (sel.maskData[y * sel.w + x]) {
                    const tx = sel.x + x;
                    const ty = sel.y + y;
                    if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
                        layer.data[ty * w + tx] = colorIdx;
                    }
                }
            }
        }
    }
    layer._v = (layer._v || 0) + 1;
    pushHistory();
    renderCanvas();
    renderOverlay();
}


