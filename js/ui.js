import { state, generateId, TRANSPARENT_COLOR } from './state.js';
import { elements } from './constants.js';
import { pushHistory, cloneLayerNode } from './history.js';
import { bresenham, findNearestPaletteIndex, findNearestPaletteIndexInRange, setupAutoRepeat, compositeFrame } from './utils.js';
import { updateUIState } from './main.js';
import { updateMenuState } from './menu_handlers.js';
import { exportFrameList } from './export_helper.js';
import { openExternalShpDialog } from './external_shp.js';
import { t } from './translations.js';

/* Animation for Marching Ants */
export function startAnts() {
    if (state.antsTimer) return; // Already running

    function animate() {
        if (!state.selection && !state.oldSelection) {
            stopAnts();
            return;
        }
        state.selectionDashOffset -= 0.3; // Slower animation speed for selection border
        if (state.selectionDashOffset < 0) state.selectionDashOffset = 8;

        // Don't render overlay if we're actively selecting (drawing pending selection)
        // The onmousemove handler will take care of rendering
        if (!state.isSelecting) {
            renderOverlay();
        }
        state.antsTimer = requestAnimationFrame(animate);
    }
    state.antsTimer = requestAnimationFrame(animate);
}

export function stopAnts() {
    if (state.antsTimer) {
        cancelAnimationFrame(state.antsTimer);
        state.antsTimer = null;
    }
}




export function updateCanvasSize() {
    const w = state.canvasW * state.zoom;
    const h = state.canvasH * state.zoom;

    // Main and BG remain at Game Resolution (crisp scaling via CSS)
    elements.mainCanvas.width = state.canvasW;
    elements.mainCanvas.height = state.canvasH;
    if (elements.bgCanvas) {
        elements.bgCanvas.width = state.canvasW;
        elements.bgCanvas.height = state.canvasH;
    }

    // Overlay becomes High-Res (Screen Resolution) for crisp lines
    elements.overlayCanvas.width = w;
    elements.overlayCanvas.height = h;

    [elements.mainCanvas, elements.overlayCanvas].forEach(c => {
        if (!c) return;
        c.style.width = w + "px";
        c.style.height = h + "px";
    });

    // Fix centering: Set wrapper size so flexbox centers the whole box
    if (elements.canvasWrapper) {
        if (state.frames.length === 0) {
            elements.canvasWrapper.style.display = 'none';
        } else {
            elements.canvasWrapper.style.display = 'block';
            elements.canvasWrapper.style.width = w + "px";
            elements.canvasWrapper.style.height = h + "px";
        }
    }

    if (elements.resDisplay) {
        elements.resDisplay.innerText = `${state.canvasW} x ${state.canvasH}`;
    }

    if (elements.statusBar) {
        elements.statusBar.style.display = state.frames.length > 0 ? 'flex' : 'none';
    }

    if (elements.toolsBar) {
        elements.toolsBar.style.display = state.frames.length > 0 ? 'flex' : 'none';
    }

    updatePixelGrid();

    const ctx = elements.bgCtx;
    if (ctx) {
        // Clear and Fill with Background Color (Index 0)
        // Use Palette Index 0 as the default background color

        ctx.fillStyle = '#000000'; // Default black/transparent if no palette
        const bgIdx = state.isAlphaImageMode ? 127 : 0;
        if (state.palette[bgIdx]) {
            const c = state.palette[bgIdx];
            ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
        }
        ctx.fillRect(0, 0, state.canvasW, state.canvasH);
    }
}

/**
 * Shared helper to render a layer thumbnail (base + floating selection).
 */
const _layerThumbCache = new Map();

export function renderLayerThumbnail(layer, ctx, w, h, forceFS = false, skipBG = false) {
    // Optimization: Cache thumbnails to avoid expensive pixel loops
    const layerKey = `${layer.id}_${layer._v || 0}_${state.paletteVersion}_${forceFS ? 'fs' : 'nofs'}_${skipBG ? 'nobg' : 'bg'}`;
    const cachedEntry = _layerThumbCache.get(layer.id);

    if (cachedEntry && cachedEntry.key === layerKey) {
        ctx.drawImage(cachedEntry.canvas, 0, 0);
        return;
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tCtx = tempCanvas.getContext('2d');

    // Original helper implementation below (re-rendering to tempCanvas)
    _renderLayerThumbnailImmediate(layer, tCtx, w, h, forceFS, skipBG);

    // Save to cache
    _layerThumbCache.set(layer.id, { key: layerKey, canvas: tempCanvas });

    // Output to real ctx
    ctx.drawImage(tempCanvas, 0, 0);
}

function _renderLayerThumbnailImmediate(layer, ctx, w, h, forceFS = false, skipBG = false) {
    const palLUT = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        const c = state.palette[i] || { r: 0, g: 0, b: 0 };
        palLUT[i] = (255 << 24) | (c.b << 16) | (c.g << 8) | c.r;
    }
    const bgDark = (255 << 24) | (102 << 16) | (102 << 8) | 102;
    const bgLight = (255 << 24) | (153 << 16) | (153 << 8) | 153;

    // Handle external SHP layers separately
    if (layer && layer.type === 'external_shp' && layer.extShpFrameData && layer.extShpPalette) {
        const imgData = ctx.createImageData(w, h);
        const d = imgData.data;
        const extPal = layer.extShpPalette;
        const shpW = layer.extShpWidth || layer.extWidth;
        const shpH = layer.extShpHeight || layer.extHeight;
        const fw = layer.extWidth, fh = layer.extHeight;
        const fx = layer.extFrameX || 0, fy = layer.extFrameY || 0;
        const indices = layer.extShpFrameData;

        if (!skipBG) {
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = (y * w + x) * 4;
                    const isDark = ((x >> 2) + (y >> 2)) % 2 === 0;
                    const c = isDark ? 102 : 153; // Dark/Light Grey
                    d[i] = c; d[i + 1] = c; d[i + 2] = c; d[i + 3] = 255;
                }
            }
        }
        const scale = Math.min(1.0, w / shpW, h / shpH);
        const drawW = shpW * scale;
        const drawH = shpH * scale;
        const offsetX = (w - drawW) / 2;
        const offsetY = (h - drawH) / 2;

        for (let py = 0; py < h; py++) {
            for (let px = 0; px < w; px++) {
                const sx = Math.floor((px - offsetX) / scale);
                const sy = Math.floor((py - offsetY) / scale);
                if (sx < 0 || sx >= shpW || sy < 0 || sy >= shpH) continue;
                // Map to frame-local coords
                const lx = sx - fx;
                const ly = sy - fy;
                if (lx < 0 || lx >= fw || ly < 0 || ly >= fh) continue;
                const idx = indices[ly * fw + lx];
                if (idx === 0 || idx === TRANSPARENT_COLOR) continue;
                const c = extPal[idx];
                if (c) {
                    const off = (py * w + px) * 4;
                    d[off] = c.r; d[off + 1] = c.g; d[off + 2] = c.b; d[off + 3] = 255;
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);
        return;
    }

    if (!layer || !layer.data) return;

    const id = ctx.createImageData(w, h);
    const d32 = new Uint32Array(id.data.buffer);

    if (!skipBG) {
        for (let y = 0; y < h; y++) {
            const yOff = y * w;
            const yIsDark = (y >> 2) % 2 === 0;
            for (let x = 0; x < w; x++) {
                const isDark = ((x >> 2) % 2 === 0) === yIsDark;
                d32[yOff + x] = isDark ? bgDark : bgLight;
            }
        }
    }

    const layerW = layer.width;
    const layerH = layer.height;

    // Use a consolidated buffer for the active layer preview, including floating pixels
    let dataSource = layer.data;
    const isActuallyActive = (layer.id === state.activeLayerId) || forceFS;

    if (state.floatingSelection && isActuallyActive) {
        dataSource = new Uint16Array(layer.data);
        const fs = state.floatingSelection;
        const fsX = Math.floor(fs.x);
        const fsY = Math.floor(fs.y);
        for (let fy = 0; fy < fs.h; fy++) {
            const fySrc = fy * fs.w;
            for (let fx = 0; fx < fs.w; fx++) {
                if (!fs.maskData || fs.maskData[fySrc + fx]) {
                    const val = fs.data[fySrc + fx];
                    if (val !== TRANSPARENT_COLOR) {
                        const tx = fsX + fx;
                        const ty = fsY + fy;
                        if (tx >= 0 && tx < layerW && ty >= 0 && ty < layerH) {
                            dataSource[ty * layerW + tx] = val;
                        }
                    }
                }
            }
        }
    }

    // Calculate scaling to fit box while preserving aspect ratio
    const scale = Math.min(1.0, w / layerW, h / layerH);
    const invScale = 1.0 / scale;
    const drawW = layerW * scale;
    const drawH = layerH * scale;

    const offsetX = (w - drawW) / 2;
    const offsetY = (h - drawH) / 2;

    for (let py = 0; py < h; py++) {
        const ly = Math.floor((py - offsetY) * invScale);
        if (ly < 0 || ly >= layerH) continue;

        const pyOff = py * w;
        const lyOff = ly * layerW;

        for (let px = 0; px < w; px++) {
            const lx = Math.floor((px - offsetX) * invScale);
            if (lx >= 0 && lx < layerW) {
                const colorIdx = dataSource[lyOff + lx];
                if (colorIdx !== TRANSPARENT_COLOR) {
                    d32[pyOff + px] = palLUT[colorIdx & 0xFF];
                }
            }
        }
    }
    ctx.putImageData(id, 0, 0);
}


export function updatePixelGrid() {
    if (!elements.pixelGridOverlay) return;

    // Show grid if toggled ON and zoom >= 400%
    const shouldShow = state.showGrid && state.zoom >= 4;
    elements.pixelGridOverlay.style.display = shouldShow ? 'block' : 'none';

    if (shouldShow) {
        elements.pixelGridOverlay.classList.toggle('grid-dark', state.gridColor === 'dark');
        elements.pixelGridOverlay.style.backgroundSize = `${state.zoom}px ${state.zoom}px`;
    }

    if (elements.btnToggleGrid) {
        elements.btnToggleGrid.classList.toggle('grid-active', state.showGrid);
    }
}

export function handlePaletteSelect(e) {
    const cell = e.target.closest('.pal-cell');
    if (!cell) return;

    const idx = parseInt(cell.dataset.idx, 10);

    // 1. Single-purpose modal pickers (Square Fill) - keep early return as before
    if (state.isPickingSquareFill) {
        const color = state.palette[idx];
        if (color) {
            const hex = '#' +
                color.r.toString(16).padStart(2, '0') +
                color.g.toString(16).padStart(2, '0') +
                color.b.toString(16).padStart(2, '0');

            state.toolSettings.squareFillColor = hex;
            if (elements.inpSquareFillColor) elements.inpSquareFillColor.value = hex;

            const info = document.getElementById('squareFillInfo');
            if (info) {
                info.innerText = `${state.translations.tt_idx}: ${idx} (${color.r},${color.g},${color.b})`;
            }

            state.isPickingSquareFill = false;
            document.body.classList.remove('picking-mode');
            const overlay = document.getElementById('modalOverlay');
            if (overlay) overlay.classList.remove('active');
            const help = document.getElementById('pickerHelpText');
            if (help) help.style.display = 'none';
        }
        return;
    }

    // 2. Normal Palette Selection (Multi-select, etc.)
    if (e.shiftKey && state.lastPaletteIdx !== -1) {
        const [s, en] = [Math.min(state.lastPaletteIdx, idx), Math.max(state.lastPaletteIdx, idx)];
        state.paletteSelection.clear();
        for (let k = s; k <= en; k++) state.paletteSelection.add(k);
    } else if (e.ctrlKey) {
        if (state.paletteSelection.has(idx)) {
            state.paletteSelection.delete(idx);
        } else {
            state.paletteSelection.add(idx);
        }
        state.lastPaletteIdx = idx;
    } else {
        state.paletteSelection.clear();
        state.paletteSelection.add(idx);
        state.lastPaletteIdx = idx;
    }

    // Standard Color Update
    setColor(idx);

    if (state.isPickingForReplace) {
        handleReplacePickerInput(idx);
    }
}

export function setColor(idx) {
    state.primaryColorIdx = idx;
    renderPalette();

    const color = state.palette[idx];
    const p = elements.primaryColorPreview;
    if (p) {
        if (color) p.style.backgroundColor = `rgb(${color.r},${color.g},${color.b})`;
        else p.style.backgroundColor = '#000';
    }

    const txt = document.getElementById('primaryColorIdx');
    if (txt) {
        if (color) txt.innerText = `${state.translations.tt_idx}: ${idx} (${color.r},${color.g},${color.b})`;
        else txt.innerText = `${state.translations.tt_idx}: ${idx} (${state.translations.tt_empty})`;
    }


    if (typeof updateUIState === 'function') updateUIState();
}

export function handleReplacePickerInput(colorIdx) {
    if (state.isPickingForReplace) {
        if (!state.isPickingForReplace.side) return;

        const side = state.isPickingForReplace.side; // 'src' or 'tgt'
        const idxProp = side + 'Idx'; // srcIdx or tgtIdx

        const color = state.palette[colorIdx];
        if (!color) return;

        if (state.replaceSelection.size > 0) {
            // Multi-selected target rows: cycle through them for sequential fill
            const indices = Array.from(state.replaceSelection).sort((a, b) => a - b);
            const targetIndex = indices[state.multiPickCounter % indices.length];

            if (state.replacePairs[targetIndex]) {
                state.replacePairs[targetIndex][idxProp] = colorIdx;
            }
            state.multiPickCounter++;
        } else {
            // No selection: Auto-create or append new pair
            const newPair = { srcIdx: null, tgtIdx: null };
            newPair[idxProp] = colorIdx;
            state.replacePairs.push(newPair);
        }

        renderReplaceGrid();
    }
}

export function zoomToSelection() {
    if (!state.selection) return;

    const sel = state.selection;
    const scrollArea = document.getElementById('canvasScrollArea');
    if (!scrollArea) return;

    // Viewport dimensions (scrollArea minus its double padding of 20px)
    const vw = scrollArea.clientWidth - 40;
    const vh = scrollArea.clientHeight - 40;

    const zoomW = (vw / sel.w) * 100;
    const zoomH = (vh / sel.h) * 100;

    let zoom = Math.min(zoomW, zoomH);
    zoom = Math.floor(zoom / 10) * 10; // Round to nearest 10
    zoom = Math.max(100, Math.min(5000, zoom));

    elements.inpZoom.value = zoom;
    elements.inpZoom.dispatchEvent(new Event('input'));

    // Center scroll area on selection
    setTimeout(() => {
        const z = zoom / 100;
        // Selection center relative to canvas (0,0) scaled by zoom
        const selCenterX = (sel.x + sel.w / 2) * z;
        const selCenterY = (sel.y + sel.h / 2) * z;

        // Scroll area center: 
        // We want selCenterX to be at scrollArea.scrollLeft + scrollArea.clientWidth / 2
        // We also have to account for the 20px padding if we want absolute precision, 
        // but scrollLeft handles the child positioning relative to the padded box usually.

        const scrollX = selCenterX - scrollArea.clientWidth / 2 + 20;
        const scrollY = selCenterY - scrollArea.clientHeight / 2 + 20;

        scrollArea.scrollLeft = scrollX;
        scrollArea.scrollTop = scrollY;
    }, 50);
}


export function renderCanvas() {
    const frame = state.frames[state.currentFrameIdx];
    if (!frame) return;

    const ctx = elements.ctx;
    const w = state.canvasW;
    const h = state.canvasH;

    const imgData = ctx.createImageData(w, h);
    const d = imgData.data;
    const isContent = new Uint8Array(w * h);

    // Background Fill
    if (state.showBackground) {
        // Solid Color (Appropriate index for mode)
        const bgIdx = state.isAlphaImageMode ? 127 : 0;
        const bg = state.palette[bgIdx] || { r: 0, g: 0, b: 0 };
        for (let i = 0; i < d.length; i += 4) {
            d[i] = bg.r; d[i + 1] = bg.g; d[i + 2] = bg.b; d[i + 3] = 255;
        }
    } else {
        // Leave imageData alpha 0 so CSS checkerboard shows through
    }




    // PREPARE PREVIEW MAP
    let substitutionMap = null;
    let affectedIndices = null;

    if (state.isPreviewingReplacement) {
        substitutionMap = new Map();
        state.replacePairs.forEach(pair => {
            if (pair.srcIdx !== null && pair.srcIdx !== undefined &&
                pair.tgtIdx !== null && pair.tgtIdx !== undefined) {
                substitutionMap.set(pair.srcIdx, pair.tgtIdx);
            }
        });
    }

    if (state.isReplacePreviewActive) {
        affectedIndices = new Set();
        state.replacePairs.forEach(pair => {
            if (pair.srcIdx !== null && pair.srcIdx !== undefined) {
                affectedIndices.add(pair.srcIdx);
            }
        });
    }

    // Unified Compositing Pass (USING CACHE for speed)
    // We now include External SHP layers in the main pass to ensure correct Z-order
    // We pass 'd' (imageData) as visualData to perform high-fidelity sequential blending
    const cached = _getCachedComposite(frame, {
        includeExternalShp: true,
        visualData: d,
        substitutionMap,
        affectedIndices,
        remapBase: state.remapColor || null,
        palette: state.palette
    });
    const compositeResult = cached.pixels;
    const alphaBuffer = cached.alpha;
    const extNodes = compositeResult.extNodes || [];

    // Final Render Pass: We only need to set isContent for special overlays,
    // as the colors are already blended into 'd' by the compositeFrame call above.
    const actualTransparent = state.isAlphaImageMode ? 127 : 0;
    for (let k = 0; k < compositeResult.length; k++) {
        const originalIdx = compositeResult[k];
        if (originalIdx === TRANSPARENT_COLOR) continue;
        if (originalIdx !== actualTransparent) isContent[k] = 1;
    }




    // --- Special Pass: Active Mask Visualization ---
    // If the active layer is a mask, we draw it over everything with a ruby (magenta) tint
    const activeInfo = findLayerParent(frame.layers, state.activeLayerId);
    if (activeInfo) {
        const activeNode = activeInfo.parent[activeInfo.index];
        if (activeNode && activeNode.isMask && activeNode.data) {
            const maskData = activeNode.data;
            for (let k = 0; k < maskData.length; k++) {
                const val = maskData[k];
                if (val !== TRANSPARENT_COLOR) {
                    const off = k * 4;
                    // Blend based on mask type
                    if (activeNode.maskType === 'hide') {
                        // Ruby tint: Magenta (255, 0, 128)
                        d[off] = (d[off] + 255) >> 1;
                        d[off + 1] = (d[off + 1] + 0) >> 1;
                        d[off + 2] = (d[off + 2] + 128) >> 1;
                    } else {
                        // Cyan/Green tint for Opacity: (0, 255, 200)
                        d[off] = (d[off] + 0) >> 1;
                        d[off + 1] = (d[off + 1] + 255) >> 1;
                        d[off + 2] = (d[off + 2] + 200) >> 1;
                    }
                    // d[off + 3] remains 255 (solid)
                }
            }
        }
    }

    // --- Game Grid Overlay (TS/RA2) - DRAW AT THE END (Show through transparency/index 0) ---
    if (state.isoGrid !== 'none') {
        const isTS = state.isoGrid === 'ts';
        const tileW = isTS ? 48 : 60;
        const color = { r: 255, g: 255, b: 255, a: 180 };

        const cx = Math.floor(w / 2);
        const cy = h;

        const drawPixel = (px, py) => {
            if (px < 0 || px >= w || py < 0 || py >= h) return;
            const k = py * w + px;
            if (isContent[k]) return; // Skip if it's image content (indices 1-255)

            const idx = k * 4;
            const alpha = color.a / 255;
            const invAlpha = 1 - alpha;
            d[idx] = Math.min(255, d[idx] * invAlpha + color.r * alpha);
            d[idx + 1] = Math.min(255, d[idx + 1] * invAlpha + color.g * alpha);
            d[idx + 2] = Math.min(255, d[idx + 2] * invAlpha + color.b * alpha);
        };

        for (let py = 0; py < h; py++) {
            for (let px = 0; px < w; px++) {
                const dx = px - cx;
                const dy = py - cy;
                const u = dx + 2 * dy;
                const v = 2 * dy - dx;
                if (Math.abs(u % tileW) < 2 || Math.abs(v % tileW) < 2) {
                    drawPixel(px, py);
                }
            }
        }
    }

    // --- Shadow Reference Overlay ---
    if (state.useShadows && state.showShadowOverlay && state.currentFrameIdx >= Math.floor(state.frames.length / 2)) {
        const shadowStart = Math.floor(state.frames.length / 2);
        const normalIdx = state.currentFrameIdx - shadowStart;
        const normalFrame = state.frames[normalIdx];
        if (normalFrame) {
            const normalComposite = compositeFrame(normalFrame, { transparentIdx: TRANSPARENT_COLOR });

            for (let k = 0; k < normalComposite.length; k++) {
                const nIdx = normalComposite[k];
                if (nIdx === TRANSPARENT_COLOR || nIdx === actualTransparent) continue;

                const c = state.palette[nIdx] || { r: 0, g: 0, b: 0 };
                let r = c.r, g = c.g, b = c.b;

                // Grayscale
                const gray = Math.round(r * 0.3 + g * 0.59 + b * 0.11);
                r = g = b = gray;

                // Check for collision with shadow pixels (compositeResult is the shadow frame)
                const sIdx = compositeResult[k];
                if (sIdx !== TRANSPARENT_COLOR && sIdx !== actualTransparent) {
                    // Collision! Pointed out by user: reddish tint
                    r = 255;
                    g = 50;
                    b = 50;
                }

                const off = k * 4;
                // No more translucency - opaque guide
                d[off] = r;
                d[off + 1] = g;
                d[off + 2] = b;
            }
        }
    }

    // --- Show Center Overlay ---
    if (state.showCenter) {
        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);
        // Draw crosshair (Invert colors)
        // Vertical Line
        for (let y = 0; y < h; y++) {
            const idx = (y * w + cx) * 4;
            imgData.data[idx] = 255 - imgData.data[idx];
            imgData.data[idx + 1] = 255 - imgData.data[idx + 1];
            imgData.data[idx + 2] = 255 - imgData.data[idx + 2];
        }
        // Horizontal Line
        for (let x = 0; x < w; x++) {
            const idx = (cy * w + x) * 4;
            imgData.data[idx] = 255 - imgData.data[idx];
            imgData.data[idx + 1] = 255 - imgData.data[idx + 1];
            imgData.data[idx + 2] = 255 - imgData.data[idx + 2];
        }
    }

    ctx.putImageData(imgData, 0, 0);

    // --- Post-putImageData: Render Overlays & Grid ---
    // (External SHP layers are now handled inside the main pass for Z-order correctness)

    // Live Sidebar Preview: Re-render active layer thumbnail whenever canvas updates
    updateActiveLayerPreview();
    // Refresh all selection-gated menu items (Cut, Copy, Flip Sel, Rotate Sel, etc.)
    if (typeof updateMenuState === 'function') updateMenuState(state.frames.length > 0);
}

/**
 * Helper: write layer pixels into a secondary buffer.
 * Supports regular layers and external SHP layers by remapping them to the canvas coordinate system.
 */
function _drawLayerIntoBuffer(node, buffer, canvasW, canvasH, valOverride = null) {
    if (!node || !buffer) return;

    // RULE: If in Edit Mask mode, we interact with the mask, not the pixels
    const sourceData = (node.editMask && node.mask) ? node.mask : node.data;

    if (node.type === 'external_shp' && node.extShpFrameData) {
        const nw = node.extWidth;
        const nh = node.extHeight;
        const fx = node.extFrameX || 0;
        const fy = node.extFrameY || 0;

        const extShpW = node.extShpWidth || nw;
        const extShpH = node.extShpHeight || nh;
        const originX = Math.round(canvasW / 2 - extShpW / 2);
        const originY = Math.round(canvasH / 2 - extShpH / 2);

        const sx = originX + (node.x || 0) + fx;
        const sy = originY + (node.y || 0) + fy;

        const indices = node.extShpFrameData;

        for (let j = 0; j < indices.length; j++) {
            const cIdx = indices[j];
            if (cIdx === TRANSPARENT_COLOR) continue;

            const lx = j % nw;
            const ly = Math.floor(j / nw);
            const gx = sx + lx;
            const gy = sy + ly;

            if (gx >= 0 && gx < canvasW && gy >= 0 && gy < canvasH) {
                buffer[gy * canvasW + gx] = (valOverride !== null) ? valOverride : cIdx;
            }
        }
    } else if (sourceData) {
        const nw = node.width, nh = node.height, nx = node.x ?? 0, ny = node.y ?? 0;
        for (let y = 0; y < nh; y++) {
            const gy = ny + y;
            if (gy < 0 || gy >= canvasH) continue;
            for (let x = 0; x < nw; x++) {
                const gx = nx + x;
                if (gx < 0 || gx >= canvasW) continue;
                const cIdx = sourceData[y * nw + x];
                if (cIdx === TRANSPARENT_COLOR) continue;
                buffer[gy * canvasW + gx] = (valOverride !== null) ? valOverride : cIdx;
            }
        }
    }
}
/**
 * Returns a Uint16Array matching the canvas dimensions containing the rasterized content of a layer.
 * Includes floating selection if active on this layer.
 * Works for both Regular and External SHP layers.
 */
export function getLayerDataSnapshot(layer) {
    if (!layer) return null;
    const w = state.canvasW;
    const h = state.canvasH;
    const buffer = new Uint16Array(w * h).fill(TRANSPARENT_COLOR);

    // 1. Draw layer content
    _drawLayerIntoBuffer(layer, buffer, w, h);

    // 2. Overlay floating selection if it belongs to this layer
    if (state.floatingSelection && state.activeLayerId === layer.id) {
        const fs = state.floatingSelection;
        const fsX = Math.floor(fs.x);
        const fsY = Math.floor(fs.y);
        for (let fy = 0; fy < fs.h; fy++) {
            for (let fx = 0; fx < fs.w; fx++) {
                if (fs.maskData && !fs.maskData[fy * fs.w + fx]) continue;
                const val = fs.data[fy * fs.w + fx];
                if (val !== TRANSPARENT_COLOR) {
                    const tx = fsX + fx;
                    const ty = fsY + fy;
                    if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
                        buffer[ty * w + tx] = val;
                    }
                }
            }
        }
    }
    return buffer;
}


// Internal version for mask build solely
function _drawLayerIntoMaskBuffer(node, buffer, canvasW, canvasH, valToSet) {
    _drawLayerIntoBuffer(node, buffer, canvasW, canvasH, valToSet);
}

/**
 * Walk the layer tree and draw external SHP layers directly onto the main canvas ctx using their own palettes.
 * Now supports mask layers: sibling masks and clipped masks are applied when rendering.
 */
function _renderExternalShpLayersToCtx(layers, ctx, canvasW, canvasH, parentMasks = []) {
    if (!layers || !ctx) return;

    // Forward pass: build sibling mask buffers (masks affect layers below them in z-order)
    const siblingMasks = new Array(layers.length).fill(null);
    let cumulative = null;
    for (let i = 0; i < layers.length; i++) {
        siblingMasks[i] = cumulative ? new Uint8Array(cumulative) : null;
        const node = layers[i];
        if (node && node.isMask && node.visible && node.data && !node.clipped) {
            if (!cumulative) {
                cumulative = new Uint8Array(canvasW * canvasH);
                cumulative.fill(node.maskType === 'hide' ? 1 : 0);
            }
            _drawLayerIntoMaskBuffer(node, cumulative, canvasW, canvasH, node.maskType === 'hide' ? 0 : 1);
        }
    }

    // Bottom-to-top render (painter's algorithm, same as compositeFrame)
    for (let i = layers.length - 1; i >= 0; i--) {
        const node = layers[i];
        if (!node || node.visible === false) continue;
        if (node.isMask) continue;

        // Build effective mask stack for this node
        let effectiveMasks = [...parentMasks];
        if (siblingMasks[i]) effectiveMasks.push(siblingMasks[i]);

        // Collect clipped masks directly above this layer
        const clippedMaskLayers = [];
        for (let j = i - 1; j >= 0; j--) {
            const above = layers[j];
            if (above.isMask && above.clipped) {
                if (above.visible && above.data) clippedMaskLayers.push(above);
            } else if (!above.isMask) {
                break; // Hit a solid layer — stop collecting
            }
        }
        if (clippedMaskLayers.length > 0) {
            const pMask = new Uint8Array(canvasW * canvasH);
            const opMasks = clippedMaskLayers.filter(c => c.maskType !== 'hide');
            const hideMasks = clippedMaskLayers.filter(c => c.maskType === 'hide');
            pMask.fill(opMasks.length > 0 ? 0 : 1);
            for (const mL of opMasks) _drawLayerIntoMaskBuffer(mL, pMask, canvasW, canvasH, 1);
            for (const mL of hideMasks) _drawLayerIntoMaskBuffer(mL, pMask, canvasW, canvasH, 0);
            effectiveMasks.push(pMask);
        }

        // Recurse into groups
        const children = node.layers || node.children;
        if (children) {
            _renderExternalShpLayersToCtx(children, ctx, canvasW, canvasH, effectiveMasks);
        }

        if (node.type === 'external_shp' && node.extShpFrameData && node.extShpPalette) {
            const nw = node.extWidth;
            const nh = node.extHeight;
            const fx = node.extFrameX || 0;
            const fy = node.extFrameY || 0;

            // Offset (0,0) means center-aligned in the game engine
            const extShpW = node.extShpWidth || nw;
            const extShpH = node.extShpHeight || nh;
            const originX = Math.round(canvasW / 2 - extShpW / 2);
            const originY = Math.round(canvasH / 2 - extShpH / 2);

            const sx = originX + (node.x || 0) + fx;
            const sy = originY + (node.y || 0) + fy;

            const indices = node.extShpFrameData;
            const extPal = node.extShpPalette;
            const isGhosted = !!node.ghosting;
            const gAlpha = isGhosted ? (node.ghostOpacity !== undefined ? node.ghostOpacity : 50) / 100 : 1;

            const hasMasks = effectiveMasks.length > 0;

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = nw;
            tempCanvas.height = nh;
            const tCtx = tempCanvas.getContext('2d');
            const imgData = tCtx.createImageData(nw, nh);
            const pix = imgData.data;

            for (let j = 0; j < indices.length; j++) {
                const cIdx = indices[j];
                const actualTransparent = state.isAlphaImageMode ? 127 : 0;
                if (cIdx === actualTransparent || cIdx === TRANSPARENT_COLOR) continue;

                if (hasMasks) {
                    // Map local pixel to global canvas position to check masks
                    const lx = j % nw;
                    const ly = Math.floor(j / nw);
                    const gx = sx + lx;
                    const gy = sy + ly;
                    if (gx < 0 || gx >= canvasW || gy < 0 || gy >= canvasH) continue;
                    const gk = gy * canvasW + gx;
                    let ok = true;
                    for (const m of effectiveMasks) if (m && !m[gk]) { ok = false; break; }
                    if (!ok) continue;
                }

                const col = extPal[cIdx] || { r: 0, g: 0, b: 0 };
                const pi = j * 4;
                pix[pi] = col.r; pix[pi + 1] = col.g; pix[pi + 2] = col.b; pix[pi + 3] = 255;
            }
            tCtx.putImageData(imgData, 0, 0);

            ctx.save();
            ctx.globalAlpha = gAlpha;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tempCanvas, sx, sy);
            ctx.restore();
        }
    }
}


export function setupReplacePreviewListeners() {
    const btn = elements.btnPreviewReplace;
    if (!btn) return;

    const startPreview = (e) => {
        if (e.cancelable) e.preventDefault();
        state.isReplacePreviewActive = true;
        renderCanvas();
    };

    const stopPreview = (e) => {
        if (e.cancelable) e.preventDefault();
        state.isReplacePreviewActive = false;
        renderCanvas();
    };

    btn.addEventListener('mousedown', startPreview);
    btn.addEventListener('mouseup', stopPreview);
    btn.addEventListener('mouseleave', stopPreview);
    btn.addEventListener('touchstart', startPreview, { passive: false });
    btn.addEventListener('touchend', stopPreview, { passive: false });
}




export function updateSelectionUI() {
    const hasSelection = !!(state.selection || state.floatingSelection);
    if (elements.btnToolCrop) elements.btnToolCrop.disabled = !hasSelection;
    if (elements.btnToolDeselect) elements.btnToolDeselect.disabled = !hasSelection;

    // Update selection dimensions in status bar
    if (elements.statusSelectionInfo) {
        if (hasSelection) {
            const sel = state.selection || state.floatingSelection;
            const w = Math.round(sel.w);
            const h = Math.round(sel.h);

            if (elements.selectionDisplay) {
                elements.selectionDisplay.innerText = `${w} × ${h}`;
            }
            elements.statusSelectionInfo.style.display = 'flex';
        } else {
            elements.statusSelectionInfo.style.display = 'none';
        }
    }

    // Enable/disable flip & rotate Selection scope menu items via the central updateMenuState
    if (typeof updateMenuState === 'function') updateMenuState(state.frames.length > 0);
}

export function renderOverlay(x, y, tool, startPos) {
    if (arguments.length === 0) {
        x = state.currentX;
        y = state.currentY;
        tool = activeTool;
        if (state.isSelecting) {
            startPos = state.startSel;
        } else if (isDrawing && (tool === 'line' || tool === 'rect')) {
            startPos = lastPos;
        } else {
            startPos = null;
        }
    }
    const isCurrentlyDrawing = !!startPos;
    const ctx = elements.overlayCtx;
    const z = state.zoom;
    // Screen Dimensions
    const w = state.canvasW * z;
    const h = state.canvasH * z;

    ctx.clearRect(0, 0, w, h);

    // Brush Cursor
    if (x !== undefined && y !== undefined && (['pencil', 'eraser', 'line', 'rect', 'spray'].includes(tool))) {
        const size = state.toolSettings.brushSize;
        const shape = state.toolSettings.brushShape || 'square';

        ctx.lineWidth = 1;
        ctx.setLineDash([]);

        if (shape === 'circle' && size > 1) {
            const cx = (x + 0.5) * z;
            const cy = (y + 0.5) * z;
            const radius = (size / 2) * z;

            ctx.beginPath();
            ctx.arc(cx, cy, radius + 0.5, 0, Math.PI * 2);
            ctx.strokeStyle = '#fff';
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(cx, cy, radius + 1.5, 0, Math.PI * 2);
            ctx.strokeStyle = '#000';
            ctx.stroke();
        } else {
            // Square (default for 1px or explicit 'square')
            const gx = size === 1 ? x : Math.round(x - size / 2);
            const gy = size === 1 ? y : Math.round(y - size / 2);
            const sx = gx * z;
            const sy = gy * z;
            const sw = size * z;
            const sh = size * z;

            // White Inner
            ctx.strokeStyle = '#fff';
            ctx.strokeRect(sx - 0.5, sy - 0.5, sw + 1, sh + 1);

            // Black Outer
            ctx.strokeStyle = '#000';
            ctx.strokeRect(sx - 1.5, sy - 1.5, sw + 3, sh + 3);
        }
    }

    // Line Preview
    if (tool === 'line' && isCurrentlyDrawing && startPos && x !== undefined && y !== undefined) {
        const points = bresenham(startPos.x, startPos.y, x, y);
        const size = state.toolSettings.brushSize;
        const shape = state.toolSettings.brushShape || 'square';
        const color = state.palette[state.primaryColorIdx] ?
            `rgb(${state.palette[state.primaryColorIdx].r},${state.palette[state.primaryColorIdx].g},${state.palette[state.primaryColorIdx].b})`
            : '#fff';

        ctx.fillStyle = color;
        points.forEach(p => {
            if (shape === 'circle' && size > 1) {
                const cx = (p.x + 0.5) * z;
                const cy = (p.y + 0.5) * z;
                const radius = (size / 2) * z;
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.fill();
            } else {
                const sx = (size === 1 ? p.x : Math.round(p.x - size / 2)) * z;
                const sy = (size === 1 ? p.y : Math.round(p.y - size / 2)) * z;
                const sSize = size * z;
                ctx.fillRect(sx, sy, sSize, sSize);
            }
        });
    }

    // Rect Preview (Game Pixel accurate)
    if (tool === 'rect' && isCurrentlyDrawing && startPos && x !== undefined && y !== undefined) {
        const x0 = Math.min(startPos.x, x);
        const y0 = Math.min(startPos.y, y);
        const x1 = Math.max(startPos.x, x);
        const y1 = Math.max(startPos.y, y);

        const size = state.toolSettings.brushSize || 1;
        const shape = state.toolSettings.brushShape || 'square';

        ctx.fillStyle = state.palette[state.primaryColorIdx] ?
            `rgb(${state.palette[state.primaryColorIdx].r},${state.palette[state.primaryColorIdx].g},${state.palette[state.primaryColorIdx].b})`
            : '#fff';

        // Fill Interior (Visual only for preview)
        if (state.toolSettings.squareFill) {
            ctx.fillStyle = state.toolSettings.squareFillColor || '#ffffff';
            ctx.fillRect(x0 * z, y0 * z, (x1 - x0 + 1) * z, (y1 - y0 + 1) * z);

            // Reset stroke to primary color for borders
            ctx.fillStyle = state.palette[state.primaryColorIdx] ?
                `rgb(${state.palette[state.primaryColorIdx].r},${state.palette[state.primaryColorIdx].g},${state.palette[state.primaryColorIdx].b})`
                : '#fff';
        }

        const drawStamp = (px, py) => {
            if (shape === 'circle' && size > 1) {
                const cx = (px + 0.5) * z;
                const cy = (py + 0.5) * z;
                const radius = (size / 2) * z;
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.fill();
            } else {
                const sx = (size === 1 ? px : Math.round(px - size / 2)) * z;
                const sy = (size === 1 ? py : Math.round(py - size / 2)) * z;
                const sSize = size * z;
                ctx.fillRect(sx, sy, sSize, sSize);
            }
        };

        for (let px = x0; px <= x1; px++) drawStamp(px, y0);
        for (let px = x0; px <= x1; px++) drawStamp(px, y1);
        for (let py = y0 + 1; py < y1; py++) drawStamp(x0, py);
        for (let py = y0 + 1; py < y1; py++) drawStamp(x1, py);
    }

    // Selection Overlay (Restored Legacy Implementation)

    // Helper: Draw Pixel Line for Lasso Preview (High Contrast)
    const drawPixelLine = (p1, p2) => {
        const points = bresenham(p1.x, p1.y, p2.x, p2.y);
        points.forEach(p => {
            // Draw block with contrast
            const sx = p.x * z;
            const sy = p.y * z;
            const sz = z;
            ctx.fillStyle = '#fff';
            ctx.fillRect(sx, sy, sz, sz);
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#000';
            ctx.strokeRect(sx + 0.5, sy + 0.5, Math.max(1, sz - 1), Math.max(1, sz - 1));
        });
    };

    // Helper: Draw Selection Border from Mask (Sierra/Stepped)
    const drawSelectionMaskBorder = (mask, bx, by, bw, bh) => {
        // No Fill - Absolutely Transparent

        ctx.save();
        ctx.lineJoin = 'miter';
        ctx.lineWidth = 1;

        const path = new Path2D();
        const sx = bx * z;
        const sy = by * z;

        // Horizontal Segments (Top and Bottom edges)
        for (let my = 0; my < bh; my++) {
            let topStart = -1;
            let bottomStart = -1;
            for (let mx = 0; mx <= bw; mx++) {
                const isSelected = mx < bw && mask[my * bw + mx];

                // Top Edge
                const hasTop = isSelected && (my === 0 || !mask[(my - 1) * bw + mx]);
                if (hasTop && topStart === -1) topStart = mx;
                if (!hasTop && topStart !== -1) {
                    path.moveTo(sx + topStart * z, sy + my * z + 0.5);
                    path.lineTo(sx + mx * z, sy + my * z + 0.5);
                    topStart = -1;
                }

                // Bottom Edge
                const hasBottom = isSelected && (my === bh - 1 || !mask[(my + 1) * bw + mx]);
                if (hasBottom && bottomStart === -1) bottomStart = mx;
                if (!hasBottom && bottomStart !== -1) {
                    path.moveTo(sx + bottomStart * z, sy + (my + 1) * z - 0.5);
                    path.lineTo(sx + mx * z, sy + (my + 1) * z - 0.5);
                    bottomStart = -1;
                }
            }
        }

        // Vertical Segments (Left and Right edges)
        for (let mx = 0; mx < bw; mx++) {
            let leftStart = -1;
            let rightStart = -1;
            for (let my = 0; my <= bh; my++) {
                const isSelected = my < bh && mask[my * bw + mx];

                // Left Edge
                const hasLeft = isSelected && (mx === 0 || !mask[my * bw + (mx - 1)]);
                if (hasLeft && leftStart === -1) leftStart = my;
                if (!hasLeft && leftStart !== -1) {
                    path.moveTo(sx + mx * z + 0.5, sy + leftStart * z);
                    path.lineTo(sx + mx * z + 0.5, sy + my * z);
                    leftStart = -1;
                }

                // Right Edge
                const hasRight = isSelected && (mx === bw - 1 || !mask[my * bw + (mx + 1)]);
                if (hasRight && rightStart === -1) rightStart = my;
                if (!hasRight && rightStart !== -1) {
                    path.moveTo(sx + (mx + 1) * z - 0.5, sy + rightStart * z);
                    path.lineTo(sx + (mx + 1) * z - 0.5, sy + my * z);
                    rightStart = -1;
                }
            }
        }

        // 1. Black Background
        ctx.lineDashOffset = (state.selectionDashOffset || 0) - 4;
        ctx.strokeStyle = '#000';
        ctx.setLineDash([4, 4]);
        ctx.stroke(path);

        // 2. White Foreground
        ctx.lineDashOffset = state.selectionDashOffset || 0;
        ctx.strokeStyle = '#fff';
        ctx.setLineDash([4, 4]);
        ctx.stroke(path);

        ctx.restore();
    };

    // Selection Overlay (Scalable Grid Edge Style)
    const drawLegacyRect = (rx, ry, rw, rh) => {
        const sx = rx * z;
        const sy = ry * z;
        const sw = rw * z;
        const sh = rh * z;

        // Semi-transparent Fill Removed

        // Moving Black Dashes (Background for contrast)
        ctx.lineDashOffset = (state.selectionDashOffset || 0) - 4;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1; // Hairline 1px
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);

        // Moving White Dashes (Foreground)
        ctx.lineDashOffset = state.selectionDashOffset || 0;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);

        if (activeTool === 'movePixels') {
            drawSelectionHandles(rx, ry, rw, rh);
        }
    };

    const drawSelectionHandles = (rx, ry, rw, rh) => {
        const handleSize = 6;
        const hs = handleSize / 2;
        const sx = rx * z;
        const sy = ry * z;
        const sw = rw * z;
        const sh = rh * z;

        // Handles positions (screen space)
        const positions = [
            [sx, sy], [sx + sw / 2, sy], [sx + sw, sy],
            [sx, sy + sh / 2], [sx + sw, sy + sh / 2],
            [sx, sy + sh], [sx + sw / 2, sy + sh], [sx + sw, sy + sh]
        ];

        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        positions.forEach(([px, py]) => {
            ctx.beginPath();
            ctx.arc(px + 0.5, py + 0.5, handleSize / 2, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.stroke();
        });
    };

    // 2. Draw "Finished" Selection (Static/Animated)
    try {
        if (state.selection) {
            if (state.selection.type === 'rect') {
                drawLegacyRect(state.selection.x, state.selection.y, state.selection.w, state.selection.h);
            } else if (state.selection.type === 'mask') {
                // Pure Mask (Magic Wand)
                drawSelectionMaskBorder(state.selection.maskData, state.selection.x, state.selection.y, state.selection.w, state.selection.h);
                if (activeTool === 'movePixels') drawSelectionHandles(state.selection.x, state.selection.y, state.selection.w, state.selection.h);
            } else if (state.selection.type === 'lasso') {
                // Lasso (Points + Mask)
                // Prefer Mask for Sierra Edge
                if (state.selection.maskData) {
                    drawSelectionMaskBorder(state.selection.maskData, state.selection.x, state.selection.y, state.selection.w, state.selection.h);
                    if (activeTool === 'movePixels') drawSelectionHandles(state.selection.x, state.selection.y, state.selection.w, state.selection.h);
                } else if (state.selection.points) {
                    // Fallback if no mask? (Should not happen per logic)
                    // Just ignored.
                }
            }
        }
    } catch (e) {
        console.error("Error drawing selection:", e);
    }

    // 1. Draw "Drawing" State (Pending Selection)
    if (isCurrentlyDrawing) {
        if (tool === 'select' && startPos && startPos.x !== undefined) {
            const sx = startPos.x;
            const sy = startPos.y;
            // Inclusive Bounds
            const x0 = Math.min(sx, x);
            const y0 = Math.min(sy, y);
            const w = Math.abs(x - sx) + 1;
            const h = Math.abs(y - sy) + 1;

            // Manual Draw Pending Rect (Standard Visibility)
            const screenX = x0 * z;
            const screenY = y0 * z;
            const screenW = w * z;
            const screenH = h * z;

            // Black Background
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.lineDashOffset = (state.selectionDashOffset || 0) - 4;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(screenX + 0.5, screenY + 0.5, screenW - 1, screenH - 1);

            // White Foreground
            ctx.strokeStyle = '#fff';
            ctx.lineDashOffset = state.selectionDashOffset || 0;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(screenX + 0.5, screenY + 0.5, screenW - 1, screenH - 1);

        } else if (tool === 'lasso' && state.startSel && state.startSel.length > 0) {
            const pts = [...state.startSel];

            // Fill Preview Removed

            // Draw Pixelated Lines for Lasso Preview
            for (let i = 0; i < pts.length - 1; i++) {
                drawPixelLine(pts[i], pts[i + 1]);
            }
            // Line to current cursor
            if (x !== undefined && y !== undefined) {
                drawPixelLine(pts[pts.length - 1], { x, y });
            }
        }
    }

    // Center Guides
    if (state.showCenter) {
        ctx.save();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = '#00ffff'; // Cyan
        ctx.lineWidth = 1;

        // Vertical Center
        const centerX = (state.canvasW / 2) * z;
        ctx.beginPath();
        ctx.moveTo(centerX, 0);
        ctx.lineTo(centerX, h);
        ctx.stroke();

        // Horizontal Center
        const centerY = (state.canvasH / 2) * z;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(w, centerY);
        ctx.stroke();
        ctx.restore();
    }

    // Sync button states
    updateSelectionUI();
}



export function updateLayersList() {
    elements.layersList.innerHTML = '';
    const frame = state.frames[state.currentFrameIdx];
    if (!frame) return;

    function renderNode(node, depth = 0, indexInParent, parentArr, guideStack = []) {
        const isGroup = node.type === 'group';
        const div = document.createElement('div');
        div.className = isGroup ? 'layer-group-item' : 'layer-item';
        div.dataset.layerId = node.id;
        div.dataset.layerType = node.type;

        // Selection State
        const isSelected = state.activeLayerId === node.id;
        if (isSelected) div.classList.add('active');

        // 2. GROUP SCOPING (Brownish background)
        if (depth > 0) div.classList.add('layer-group-scope');
        if (state.activeLayerId === node.id) div.classList.add('selected');
        if (node.id === state.dragLayerId) div.classList.add('pm-dragging');
        if (node.type === 'external_shp') div.classList.add('external-shp');

        // 3. Indentation Guide
        const indentTrack = document.createElement('div');
        indentTrack.className = 'tree-indent-track';
        if (depth > 0) {
            for (let i = 0; i < depth; i++) {
                const segment = document.createElement('div');
                segment.className = 'tree-indent-segment';

                // Vertical line if ancestor has more siblings
                if (guideStack[i]) {
                    const vLine = document.createElement('div');
                    vLine.className = 'tree-v-line';
                    if (i === depth - 1 && indexInParent === parentArr.length - 1) {
                        vLine.classList.add('last-child-v');
                    }
                    segment.appendChild(vLine);
                }

                // Horizontal branch for the immediate parent guide level
                if (i === depth - 1) {
                    const hBranch = document.createElement('div');
                    hBranch.className = 'tree-h-branch';
                    segment.appendChild(hBranch);

                    // Mask Scope Bar
                    if (node.isMask) {
                        const scopeBar = document.createElement('div');
                        scopeBar.className = 'tree-mask-scope-bar ' + (node.maskType === 'hide' ? 'mask-hide' : 'mask-opacity');
                        segment.appendChild(scopeBar);
                    }
                }

                indentTrack.appendChild(segment);
            }
            div.appendChild(indentTrack);
        }
        // If depth == 0 and NO children, we add NOTHING (reclaims 14px + aligns to left)

        // 4. Drag & Drop (Redirect to parent if clipped)
        div.draggable = true;
        div.ondragstart = (e) => {
            let actualId = node.id;
            if (node.clipped) {
                // Find parent to move the whole unit
                const frame = state.frames[state.currentFrameIdx];
                const res = findLayerParent(frame.layers, node.id);
                if (res && res.parentObj) actualId = res.parentObj.id;
            }
            state.dragLayerId = actualId;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', actualId);

            // Highlight the actual item being dragged (parent if clipped)
            const dragEl = document.querySelector(`[data-layer-id="${actualId}"]`) || div;
            dragEl.style.opacity = '0.5';
        };
        div.ondragend = () => {
            div.style.opacity = '1';
            state.dragLayerId = null;
            document.querySelectorAll('.layer-item, .layer-group-item').forEach(el => {
                el.style.borderTop = '';
                el.style.borderBottom = '';
            });
        };
        div.ondragover = (e) => {
            e.preventDefault();
            if (state.dragLayerId === node.id) return;
            e.dataTransfer.dropEffect = 'move';

            const rect = div.getBoundingClientRect();
            const relY = e.clientY - rect.top;

            // For groups, add a center "nesting" zone
            if (isGroup && relY > rect.height * 0.25 && relY < rect.height * 0.75) {
                div.style.background = "rgba(0, 255, 170, 0.2)"; // Visual feedback for nesting
                div.style.borderTop = "";
                div.style.borderBottom = "";
                div.dataset.dropPos = 'inside';
            } else if (relY < rect.height / 2) {
                div.style.background = "";
                div.style.borderTop = "2px solid #00f";
                div.style.borderBottom = "";
                div.dataset.dropPos = 'above';
            } else {
                div.style.background = "";
                div.style.borderTop = "";
                div.style.borderBottom = "2px solid #00f";
                div.dataset.dropPos = 'below';
            }
        };
        div.ondragleave = () => {
            div.style.borderTop = "";
            div.style.borderBottom = "";
            div.style.background = "";
        };
        div.ondrop = (e) => {
            e.preventDefault();
            div.style.borderTop = "";
            div.style.borderBottom = "";
            div.style.background = "";
            const pos = div.dataset.dropPos || 'above';
            handleLayerDrop(state.dragLayerId, node.id, pos);
        };

        div.onclick = (e) => {
            e.stopPropagation();
            if (state.activeLayerId === node.id) return; // No change

            // Implicit Commit if switching layers with a floating selection
            if (state.floatingSelection) {
                commitSelection();
            }
            state.activeLayerId = node.id;

            // Update Hybrid Memory
            const currentFrame = state.frames[state.currentFrameIdx];
            if (currentFrame) {
                const flat = getFlatLayers(currentFrame.layers);
                const clickedIdx = flat.findIndex(l => l.id === node.id);
                if (clickedIdx !== -1) {
                    state.preferredLayerIdx = clickedIdx;
                    currentFrame.lastSelectedIdx = clickedIdx;
                }
            }

            // Record selection change in history (direct call)
            pushHistory([]);

            updateLayersList();
            renderCanvas();
        };

        if (node.isMask) {
            div.classList.add('layer-is-mask');
            div.classList.add(node.maskType === 'hide' ? 'mask-hide' : 'mask-opacity');
        }

        // --- ROW CONTENT ---

        // A. Expansion Triangle (Groups OR Layers with children)
        const hasChildren = node.children && node.children.length > 0;
        if (hasChildren) {
            const expandBtn = document.createElement('span');
            expandBtn.className = 'layer-expand-toggle';
            expandBtn.textContent = (node.expanded !== false) ? '▼' : '▶';
            expandBtn.onclick = (e) => {
                e.stopPropagation();
                node.expanded = (node.expanded === false);
                updateLayersList();
            };
            div.appendChild(expandBtn);
        } else if (depth > 0) {
            // Spacer only for nested layers to align with parent icons
            const spacer = document.createElement('span');
            spacer.style.width = '14px';
            spacer.style.display = 'inline-block';
            spacer.style.flexShrink = '0';
            div.appendChild(spacer);
        }

        // B. Visibility (Eye)
        const visBtn = document.createElement('span');
        visBtn.className = 'layer-vis-btn';
        visBtn.textContent = node.visible ? '👁️' : '🚫';
        visBtn.onclick = (e) => {
            e.stopPropagation();
            pushHistory();
            node.visible = !node.visible;
            renderCanvas();
            updateLayersList();
        };
        div.appendChild(visBtn);

        // B. Preview (Only for layers)
        if (!isGroup) {
            const previewCanvas = document.createElement('canvas');
            previewCanvas.className = 'layer-preview';
            previewCanvas.id = `layer-preview-${node.id}`; // CRITICAL: Added ID for live updates
            previewCanvas.width = 60;
            previewCanvas.height = 45;
            const pCtx = previewCanvas.getContext('2d');
            if (node.data || node.type === 'external_shp') {
                renderLayerThumbnail(node, pCtx, 60, 45);
            }
            div.appendChild(previewCanvas);
        }

        // C. Name Area (Toggle + Folder ICON + Name)
        const nameContainer = document.createElement('div');
        nameContainer.className = 'layer-item-name';

        if (isGroup) {
            const folderIcon = document.createElement('span');
            folderIcon.className = 'layer-folder-icon pm-icon-folder';
            if (!node.expanded) folderIcon.style.opacity = '0.7';
            nameContainer.appendChild(folderIcon);
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'layer-name-text';
        nameSpan.textContent = node.name;
        nameContainer.appendChild(nameSpan);

        nameContainer.ondblclick = (e) => {
            e.stopPropagation();
            openActiveLayerProperties(node);
        };
        div.appendChild(nameContainer);

        // D. Secondary Controls (Right Aligned via flex spacing)
        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'layer-item-controls';

        // Ghost
        if (!isGroup && !node.isMask) {
            const ghostBtn = document.createElement('span');
            ghostBtn.className = 'layer-ghost-btn';
            ghostBtn.textContent = '👻';
            ghostBtn.style.opacity = node.ghosting ? '1' : '0.3';
            ghostBtn.setAttribute('data-title', t('tt_layer_ghost'));
            ghostBtn.onclick = (e) => {
                e.stopPropagation();
                pushHistory();
                node.ghosting = !node.ghosting;
                renderCanvas();
                updateLayersList();
            };
            controlsDiv.appendChild(ghostBtn);
        }

        // Clip Button (Show if it's a mask OR already clipped)
        if (!isGroup && (node.isMask || node.clipped)) {
            const nextSibling = parentArr[indexInParent + 1];
            // RULE: Block clipping between two external SHPs (skip button if next is also external)
            const isBothExt = node.type === 'external_shp' && nextSibling && nextSibling.type === 'external_shp';

            if (node.clipped || (nextSibling && !isBothExt)) {
                const clipBtn = document.createElement('span');
                clipBtn.className = 'layer-clip-btn' + (node.clipped ? ' active' : '');
                clipBtn.textContent = node.clipped ? '🔗' : '🖇️';
                clipBtn.setAttribute('data-title', node.clipped ? t('tt_layer_unclip') : t('tt_layer_clip'));
                clipBtn.onclick = (e) => {
                    e.stopPropagation();
                    const target = parentArr[indexInParent + 1];
                    // Toggle via nestLayer handles structure
                    if (node.clipped) {
                        nestLayer(node); // Unclip
                    } else if (target) {
                        nestLayer(node, target);
                    }
                };
                controlsDiv.appendChild(clipBtn);
            }
        }

        // Mask Button (ONLY Layers)
        if (!isGroup) {
            const maskBtn = document.createElement('span');
            maskBtn.textContent = node.isMask ? (node.maskType === 'hide' ? 'H' : 'M') : 'M';
            maskBtn.className = 'btn-mask-indicator' + (node.isMask ? ' active-mask' : '');
            maskBtn.setAttribute('data-title', t('tt_layer_mask'));
            if (node.isMask) {
                maskBtn.style.background = node.maskType === 'hide' ? '#9333ea' : '#e91e63';
            }
            maskBtn.onclick = (e) => {
                e.stopPropagation();
                pushHistory();
                if (!node.isMask) {
                    node.isMask = true;
                    // Default to opacity when enabling
                    node.maskType = 'opacity';
                } else if (node.maskType !== 'hide') {
                    // Toggle to Hide
                    node.maskType = 'hide';
                } else {
                    // Hide -> ?
                    if (node.clipped) {
                        // If clipped, cycle back to Opacity (LOCKED)
                        node.maskType = 'opacity';
                    } else {
                        // If NOT clipped, disable Mask (NORMAL CYCLE)
                        node.isMask = false;
                        delete node.maskType;
                    }
                }
                updateLayersList();
                renderCanvas();
            };
            controlsDiv.appendChild(maskBtn);
        }

        div.appendChild(controlsDiv);
        elements.layersList.appendChild(div);

        // 5. Render Children
        const isExpanded = node.expanded || node.type !== 'group';
        const hasVisibleChildren = node.children && (isExpanded || node.children.some(c => c.clipped));
        if (node.children && hasVisibleChildren) {
            node.children.forEach((child, i) => {
                // Determine guides for this child's depth level
                const nextGuides = [...guideStack, i < node.children.length - 1];
                renderNode(child, depth + 1, i, node.children, nextGuides);
            });
        }
    }

    frame.layers.forEach((l, i) => renderNode(l, 0, i, frame.layers));

    // --- Update Layer Toolbar State ---
    const activeInfo = findLayerParent(frame.layers, state.activeLayerId);
    if (elements.btnDelLayer) elements.btnDelLayer.disabled = frame.layers.length <= 1 || !activeInfo;
    if (elements.btnLayerUp) elements.btnLayerUp.disabled = !activeInfo || activeInfo.index === 0;
    if (elements.btnLayerDown) elements.btnLayerDown.disabled = !activeInfo || activeInfo.index === activeInfo.parent.length - 1;
    if (elements.btnLayerMerge) elements.btnLayerMerge.disabled = !activeInfo || activeInfo.index === activeInfo.parent.length - 1;
    const activeL = getActiveLayer();
    if (elements.btnDuplicateLayer) elements.btnDuplicateLayer.disabled = !state.activeLayerId;
}

// --- Frame List Virtualization & Caching ---
export const FRAME_ITEM_HEIGHT = 68; // Standard height for frame thumbnails in the management panel (Reduced from 80)
export const thumbCache = new WeakMap();

let _framesListRenderPending = false;
export function renderFramesList() {
    if (!elements.framesList) return;
    if (_framesListRenderPending) return;
    _framesListRenderPending = true;
    requestAnimationFrame(() => {
        _framesListRenderPending = false;
        _renderFramesListImmediate();
    });
}

function _renderFramesListImmediate() {
    if (!elements.framesList) return;

    // Ensure scroll listener is attached once
    if (!elements.framesList._hasScrollListener) {
        elements.framesList.addEventListener('scroll', () => {
            requestAnimationFrame(() => _renderFramesListImmediate());
        });
        elements.framesList._hasScrollListener = true;
    }

    const totalFrames = state.frames.length;
    const containerHeight = elements.framesList.clientHeight || 500;
    const scrollTop = elements.framesList.scrollTop;

    // Calculate visible range
    const startIndex = Math.max(0, Math.floor(scrollTop / FRAME_ITEM_HEIGHT) - 5);
    const endIndex = Math.min(totalFrames - 1, Math.ceil((scrollTop + containerHeight) / FRAME_ITEM_HEIGHT) + 5);

    // Create or find the content wrapper to maintain total height
    let wrapper = elements.framesList.querySelector('.frames-v-wrapper');
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'frames-v-wrapper';
        wrapper.style.position = 'relative';
        elements.framesList.appendChild(wrapper);
    }
    wrapper.style.height = (totalFrames * FRAME_ITEM_HEIGHT) + 'px';

    // Clear and re-render only visible items
    const currentItems = Array.from(wrapper.children);
    const visibleIndices = new Set();
    for (let i = startIndex; i <= endIndex; i++) visibleIndices.add(i);

    // Remove off-screen items
    currentItems.forEach(child => {
        const idx = parseInt(child.dataset.idx);
        if (!visibleIndices.has(idx)) {
            wrapper.removeChild(child);
        }
    });

    // Add or update visible items
    for (let i = startIndex; i <= endIndex; i++) {
        let div = wrapper.querySelector(`[data-idx="${i}"]`);
        if (!div) {
            div = document.createElement('div');
            div.dataset.idx = i;
            div.className = 'frame-thumb';
            div.style.position = 'absolute';
            div.style.top = (i * FRAME_ITEM_HEIGHT) + 'px';
            div.style.left = '0';
            div.style.right = '0';
            div.style.height = FRAME_ITEM_HEIGHT + 'px'; // Exact height

            div.draggable = true;
            div.ondragstart = (e) => {
                const idx = parseInt(div.dataset.idx);
                e.dataTransfer.setData('text/plain', 'f:' + idx);
                e.dataTransfer.effectAllowed = 'move';
                div.style.opacity = '0.5';
            };
            div.ondragend = () => { div.style.opacity = '1'; };
            div.ondragover = (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';

                // Elegant logic: determine if we are in top or bottom half
                const rect = div.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                if (e.clientY < mid) {
                    div.classList.add('drag-over-top');
                    div.classList.remove('drag-over-bottom');
                } else {
                    div.classList.add('drag-over-bottom');
                    div.classList.remove('drag-over-top');
                }
            };
            div.ondragleave = () => {
                div.classList.remove('drag-over-top');
                div.classList.remove('drag-over-bottom');
            };
            div.ondrop = (e) => {
                e.preventDefault();
                const isTop = div.classList.contains('drag-over-top');
                div.classList.remove('drag-over-top');
                div.classList.remove('drag-over-bottom');

                const data = e.dataTransfer.getData('text/plain');
                if (!data.startsWith('f:')) return;
                const fromIdx = parseInt(data.substring(2));
                const toIdx = parseInt(div.dataset.idx);
                if (fromIdx === toIdx) return;

                const movedFrame = state.frames[fromIdx];
                state.frames.splice(fromIdx, 1);

                let insertAt = toIdx;
                if (!isTop) insertAt++; // Drop in bottom half means insert AFTER this item
                if (fromIdx < insertAt) insertAt--;

                state.frames.splice(insertAt, 0, movedFrame);
                state.currentFrameIdx = insertAt;

                pushHistory('reorder');
                syncLayerSelection();
                renderFramesList();
                renderCanvas();
                updateLayersList();
                renderPalette();
            };

            div.onclick = () => {
                if (state.currentFrameIdx === i) return; // No change
                const idx = parseInt(div.dataset.idx);
                if (state.floatingSelection) commitSelection();

                // Check if we're crossing a shadow boundary (need palette refresh)
                const oldIdx = state.currentFrameIdx;
                state.currentFrameIdx = idx;

                syncLayerSelection();

                // Record selection change in history (direct call)
                pushHistory([]);

                // Restore essential UI updates (they are already debounced from previous optimizations)
                renderFramesList();
                updateLayersList();
                renderCanvas();

                // Only rebuild palette DOM when crossing shadow/normal boundary
                if (state.useShadows) {
                    const half = state.frames.length / 2;
                    const wasInShadow = oldIdx >= half;
                    const nowInShadow = idx >= half;
                    if (wasInShadow !== nowInShadow) renderPalette();
                }
            };

            wrapper.appendChild(div);
        }

        // Update active state and content
        div.className = 'frame-thumb' + (i === state.currentFrameIdx ? ' active' : '');

        // Use cached thumbnail if available to avoid drawing
        const frame = state.frames[i];
        let thumbContainer = div.querySelector('.thumb-content');
        if (!thumbContainer) {
            thumbContainer = document.createElement('div');
            thumbContainer.className = 'thumb-content';
            div.innerHTML = `<span class="frame-number">${i}</span>`;
            div.appendChild(thumbContainer);
        }

        if (thumbContainer._frameId !== i || thumbContainer._frameVersion !== (frame._v || 0) || thumbContainer._palVersion !== state.paletteVersion) {
            thumbContainer.innerHTML = '';
            const c = createFrameThumbnail(frame, 105, 68); // Adjusted height from 80 to 68
            thumbContainer.appendChild(c);
            thumbContainer._frameId = i;
            thumbContainer._frameVersion = (frame._v || 0);
            thumbContainer._palVersion = state.paletteVersion;
        }
    }
}

export function resetFramesList() {
    if (elements.framesList) {
        const wrapper = elements.framesList.querySelector('.frames-v-wrapper');
        if (wrapper) wrapper.innerHTML = '';
        elements.framesList.scrollTop = 0;
    }
}

// --- PALETTE RENDERING ---
export function renderPalette() {
    console.log("TRACE: renderPalette called. elements.paletteGrid:", elements.paletteGrid);
    if (!elements.paletteGrid) {
        console.error("TRACE: elements.paletteGrid is MISSING from DOM!");
        // Force check
        const pGrid = document.getElementById('paletteGrid');
        console.log("TRACE: Manual getElementById('paletteGrid') returns:", pGrid);
        return;
    }
    elements.paletteGrid.innerHTML = '';
    console.log("TRACE: paletteGrid cleared. state.palette.length:", state.palette.length);

    // Create cells (256 normally, only 2 in Shadows mode when on a shadow frame)
    const isShadowFrame = state.useShadows && (state.currentFrameIdx >= state.frames.length / 2);
    const maxCells = isShadowFrame ? 2 : 256;
    for (let i = 0; i < maxCells; i++) {
        const div = document.createElement('div');
        div.className = 'pal-cell';
        div.dataset.idx = i;
        div.draggable = true;

        const color = state.palette[i];

        // Hover tooltips formatted professionally
        if (color) {
            div.style.backgroundColor = `rgb(${color.r},${color.g},${color.b})`;
            div.setAttribute('data-tooltip', `${state.translations.tt_idx}: ${i}\n${state.translations.tt_rgb}: ${color.r},${color.g},${color.b}`);
        } else {
            div.style.backgroundColor = '';
            div.classList.add(i % 2 === 0 ? 'empty-p1' : 'empty-p2');
            div.setAttribute('data-tooltip', `${state.translations.tt_idx}: ${i}\n${state.translations.tt_rgb}: ${state.translations.tt_empty}`);
        }

        if (state.paletteSelection.has(i)) {
            div.classList.add('selected');
        }

        // --- Drag Events ---
        div.ondragstart = (e) => {
            // Ensure the clicked index is part of selection if not already
            if (!state.paletteSelection.has(i)) {
                if (!e.ctrlKey && !e.shiftKey) state.paletteSelection.clear();
                state.paletteSelection.add(i);
                state.lastPaletteIdx = i;
                renderPalette();
            }

            state.dragSourceType = 'palette';
            const idxs = Array.from(state.paletteSelection).sort((a, b) => a - b);
            state.dragSourceCount = idxs.length;

            e.dataTransfer.setData('application/json', JSON.stringify({
                t: 'palette',
                i: idxs
            }));
            e.dataTransfer.setData('text/plain', 'palette'); // Compatibility
            e.dataTransfer.effectAllowed = 'copy';
        };

        div.ondragend = () => {
            state.dragSourceType = null;
            state.dragSourceCount = 0;
            // Clear highlights manually just in case
            document.querySelectorAll('.drop-target, .overwrite-target, .swap-target').forEach(el => {
                el.classList.remove('drop-target', 'overwrite-target', 'swap-target');
            });
        };

        div.onpointerdown = handlePaletteSelect;

        elements.paletteGrid.appendChild(div);
    }
}

export function setupZoomOptions() {
    if (!elements.inpZoom) return;

    // Sync Slider
    const syncZoomUI = () => {
        const pct = state.zoom * 100;
        elements.inpZoom.value = pct;
        if (elements.zoomVal) elements.zoomVal.innerText = Math.round(pct) + "%";
        if (elements.zoomSizeBar) {
            const range = elements.inpZoom.max - elements.inpZoom.min;
            const val = pct - elements.inpZoom.min;
            const ratio = (val / range) * 100;
            elements.zoomSizeBar.style.width = ratio + "%";
        }
    };

    elements.inpZoom.oninput = (e) => {
        let val = parseInt(e.target.value);

        if (val > 50 && val < 100) {
            val = (val > 75) ? 100 : 50;
            e.target.value = val;
        } else if (val > 100) {
            val = Math.round(val / 100) * 100;
            e.target.value = val;
        }

        const container = elements.canvasWrapper.parentElement;
        const oldZoom = state.zoom;
        const newZoom = val / 100;

        // --- Memorize visual center (Robust Version) ---
        // If canvas is smaller than container, it's centered by margin:auto (flex/block).
        // If larger, it starts at scroll position.
        const canvasW = state.canvasW * oldZoom;
        const canvasH = state.canvasH * oldZoom;

        // Centered visual offset from canvas start
        const visualX = (canvasW < container.clientWidth) ? canvasW / 2 : (container.scrollLeft + container.clientWidth / 2);
        const visualY = (canvasH < container.clientHeight) ? canvasH / 2 : (container.scrollTop + container.clientHeight / 2);

        const centerCanvasX = visualX / oldZoom;
        const centerCanvasY = visualY / oldZoom;

        state.zoom = newZoom;
        updateCanvasSize();
        renderCanvas();
        syncZoomUI();

        // --- Re-center (Synchronous) ---
        const newCanvasW = state.canvasW * newZoom;
        const newCanvasH = state.canvasH * newZoom;

        // Target scroll position to keep that same canvas-pixel in the middle
        container.scrollLeft = centerCanvasX * newZoom - container.clientWidth / 2;
        container.scrollTop = centerCanvasY * newZoom - container.clientHeight / 2;
    };

    // Wheel Zoom Support
    if (elements.canvasWrapper && elements.canvasWrapper.parentElement) {
        elements.canvasWrapper.parentElement.onwheel = (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const direction = e.deltaY < 0 ? 1 : -1;
                let current = parseInt(elements.inpZoom.value);
                let next;

                if (direction > 0) {
                    next = current < 100 ? 100 : Math.floor(current / 100) * 100 + 100;
                } else {
                    next = current <= 100 ? 50 : Math.ceil(current / 100) * 100 - 100;
                }

                // Clamp to min/max
                const min = parseInt(elements.inpZoom.min) || 50;
                const max = parseInt(elements.inpZoom.max) || 5000;
                next = Math.max(min, Math.min(max, next));

                if (next !== current) {
                    elements.inpZoom.value = next;
                    elements.inpZoom.dispatchEvent(new Event('input'));
                }
            }
        };
    }

    if (elements.btnZoomReset) {
        elements.btnZoomReset.onclick = () => {
            elements.inpZoom.value = 100;
            elements.inpZoom.dispatchEvent(new Event('input'));
        };
    }

    // Initialize UI
    syncZoomUI();
}

export function renderPaletteSimple(palette, container) {
    if (!container) return;
    container.innerHTML = '';

    // Ensure container has grid class if missing (though it should be in HTML)
    if (!container.classList.contains('palette-grid-wrapper')) {
        container.classList.add('palette-grid-wrapper');
    }

    for (let i = 0; i < 256; i++) {
        const div = document.createElement('div');
        div.className = 'pal-cell';
        const c = palette[i];
        if (c) {
            div.style.backgroundColor = `rgb(${c.r},${c.g},${c.b})`;
            div.title = `Index ${i}: ${c.r},${c.g},${c.b}`;
        } else {
            // Checkerboard pattern for empty cells
            div.style.backgroundColor = '';
            div.classList.add(((i % 32) + Math.floor(i / 32)) % 2 === 0 ? 'empty-p1' : 'empty-p2');
            div.title = `Index ${i}: Empty`;
        }
        container.appendChild(div);
    }
}

/**
 * Shows a centered custom confirmation dialog.
 * @param {string} title - The title of the dialog.
 * @param {string} message - The message to display (optional).
 * @returns {Promise<boolean>} - Resolves to true if confirmed, false otherwise.
 */
/**
 * Custom Alert Dialog
 */
export async function showAlert(title, message = "") {
    const dialog = document.getElementById('alertDialog');
    const msgEl = document.getElementById('alertMessage');
    const titleEl = document.getElementById('alertTitle');
    const btnOk = document.getElementById('btnAlertOk');

    if (!dialog || !msgEl || !btnOk) {
        alert(message ? `${title}\n\n${message}` : title);
        return;
    }

    titleEl.textContent = title;
    msgEl.innerHTML = message || "";
    msgEl.style.display = message ? 'block' : 'none';

    return new Promise((resolve) => {
        btnOk.onclick = () => {
            btnOk.onclick = null;
            if (typeof dialog.close === 'function') dialog.close();
            else dialog.removeAttribute('open');
            resolve();
        };

        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
    });
}

/**
 * Layer Properties Dialog
 * @param {object} node - The layer node to edit
 * @returns {Promise<object|null>} - Resolves to the edited properties or null if cancelled
 */
export async function showLayerPropertiesDialog(node) {
    const dialog = document.getElementById('layerPropsDialog');
    if (!dialog) return null;

    const nameInput = document.getElementById('layerPropsName');
    const visibleCb = document.getElementById('layerPropsVisible');
    const ghostingCb = document.getElementById('layerPropsGhosting');
    const ghostRow = document.getElementById('layerPropsGhostRow');
    const ghostSlider = document.getElementById('layerPropsGhostOpacity');
    const ghostValSpan = document.getElementById('layerPropsGhostOpacityVal');
    const ghostBar = document.getElementById('ghostOpBar');
    const btnGhostMinus = document.getElementById('btnGhostOpMinus');
    const btnGhostPlus = document.getElementById('btnGhostOpPlus');
    const btnGhostReset = document.getElementById('btnGhostOpReset');
    const maskSelect = document.getElementById('layerPropsMaskType');
    const btnOk = document.getElementById('btnLayerPropsOk');
    const btnCancel = document.getElementById('btnLayerPropsCancel');

    // Helper to sync bar + label
    const syncGhostUI = () => {
        const v = parseInt(ghostSlider.value);
        ghostValSpan.textContent = v + '%';
        if (ghostBar) {
            const range = parseInt(ghostSlider.max) - parseInt(ghostSlider.min);
            ghostBar.style.width = ((v - parseInt(ghostSlider.min)) / range * 100) + '%';
        }
    };

    // Populate fields
    nameInput.value = node.name || '';
    visibleCb.checked = node.visible !== false;
    ghostingCb.checked = !!node.ghosting;

    const opacity = node.ghostOpacity !== undefined ? node.ghostOpacity : 50;
    ghostSlider.value = opacity;
    syncGhostUI();

    // Initial visibility of ghost row based on checkbox state
    ghostRow.style.display = ghostingCb.checked ? 'flex' : 'none';

    // Mask type
    if (node.isMask) {
        maskSelect.value = node.maskType === 'hide' ? 'hide' : 'opacity';
    } else {
        maskSelect.value = 'none';
    }

    // If clipped, disable the "None" option since unclipping must happen separately
    const noneOption = maskSelect.querySelector('option[value="none"]');
    if (node.clipped) {
        noneOption.disabled = true;
        noneOption.title = 'Unclip the layer first to remove mask';
    } else {
        noneOption.disabled = false;
        noneOption.title = '';
    }

    // Hide ghost/mask options for groups
    const isGroup = node.type === 'group';
    const titleEl = document.getElementById('layerPropsTitle');
    if (titleEl) {
        titleEl.textContent = isGroup ? 'GROUP PROPERTIES' : 'LAYER PROPERTIES';
    }
    const formContainer = dialog.querySelector('div[style*="flex-direction:column"]');
    if (formContainer) {
        const rows = formContainer.querySelectorAll(':scope > div');
        rows.forEach((row, i) => {
            // Rows: 0=Name, 1=Visible, 2=Ghost checkbox, 3=Ghost slider, 4=Mask
            if (isGroup && i >= 2) {
                row.style.display = 'none';
            } else if (i === 3) {
                // Ghost slider row: controlled by checkbox, not by generic show
                row.style.display = ghostingCb.checked ? 'flex' : 'none';
            } else {
                row.style.display = '';
            }
        });
    }

    // Live slider feedback
    const onSliderInput = () => syncGhostUI();
    ghostSlider.addEventListener('input', onSliderInput);

    // Buttons for -/+/reset (1 step normally, 5 with CTRL)
    const onMinus = (e) => {
        const step = e && e.ctrlKey ? 5 : 1;
        ghostSlider.value = Math.max(parseInt(ghostSlider.min), parseInt(ghostSlider.value) - step);
        syncGhostUI();
    };
    const onPlus = (e) => {
        const step = e && e.ctrlKey ? 5 : 1;
        ghostSlider.value = Math.min(parseInt(ghostSlider.max), parseInt(ghostSlider.value) + step);
        syncGhostUI();
    };
    const onReset = () => {
        ghostSlider.value = 50;
        syncGhostUI();
    };
    if (btnGhostMinus) btnGhostMinus.addEventListener('click', onMinus);
    if (btnGhostPlus) btnGhostPlus.addEventListener('click', onPlus);
    if (btnGhostReset) btnGhostReset.addEventListener('click', onReset);

    // Toggle ghost row visibility
    const onGhostToggle = () => {
        ghostRow.style.display = ghostingCb.checked ? 'flex' : 'none';
    };
    ghostingCb.addEventListener('change', onGhostToggle);

    // External SHP Group
    const isExtShp = node.type === 'external_shp';
    dialog.style.minWidth = isExtShp ? '720px' : '380px';

    if (elements.layerPropsExternalShpGroup) {
        elements.layerPropsExternalShpGroup.style.display = isExtShp ? 'flex' : 'none';
        if (elements.layerPropsPreviewCol) {
            elements.layerPropsPreviewCol.style.display = isExtShp ? 'flex' : 'none';
        }

        if (isExtShp) {
            elements.layerPropsOffX.value = node.x || 0;
            elements.layerPropsOffY.value = node.y || 0;

            // Frame navigation state
            let lpCurrentFrameIdx = node.extFrameIdx || 0;
            let lpTotalFrames = node.extTotalFrames || (node.extAllFrames ? node.extAllFrames.length : 1);

            // Setup frame controls
            const lpSlider = document.getElementById('lpExtSlider');
            const lpFrameInput = document.getElementById('lpExtFrameInput');
            const lpCounter = document.getElementById('lpExtCounter');
            const lpBtnPrev = document.getElementById('btnLpExtPrev');
            const lpBtnNext = document.getElementById('btnLpExtNext');

            const lpSyncUI = () => {
                if (lpSlider) { lpSlider.max = lpTotalFrames - 1; lpSlider.value = lpCurrentFrameIdx; }
                if (lpFrameInput) lpFrameInput.value = lpCurrentFrameIdx;
                if (lpCounter) lpCounter.textContent = `/ ${lpTotalFrames - 1}`;
                renderExternalShpLayerPropsPreview(node, lpCurrentFrameIdx);
            };

            const lpSetFrame = (idx) => {
                lpCurrentFrameIdx = Math.max(0, Math.min(lpTotalFrames - 1, idx));
                lpSyncUI();
            };

            if (lpSlider) lpSlider.oninput = () => lpSetFrame(parseInt(lpSlider.value));
            if (lpFrameInput) lpFrameInput.oninput = () => lpSetFrame(parseInt(lpFrameInput.value) || 0);
            if (lpBtnPrev) lpBtnPrev.onclick = (e) => { e.stopPropagation(); lpSetFrame(lpCurrentFrameIdx - 1); };
            if (lpBtnNext) lpBtnNext.onclick = (e) => { e.stopPropagation(); lpSetFrame(lpCurrentFrameIdx + 1); };

            // Initial render
            lpSyncUI();

            elements.layerPropsOffX.oninput = () => renderExternalShpLayerPropsPreview(node, lpCurrentFrameIdx);
            elements.layerPropsOffY.oninput = () => renderExternalShpLayerPropsPreview(node, lpCurrentFrameIdx);
            const overlayCb = document.getElementById('lpExtShowOverlay');
            if (overlayCb) overlayCb.onchange = () => renderExternalShpLayerPropsPreview(node, lpCurrentFrameIdx);

            // Drag to move image (only if overlay is active)
            const previewCanvas = elements.layerPropsExternalPreview;
            let isDraggingPreview = false;
            let lastDragX, lastDragY;

            const onPreviewMouseDown = (e) => {
                const overlayActive = document.getElementById('lpExtShowOverlay')?.checked;
                if (!overlayActive) return;
                isDraggingPreview = true;
                lastDragX = e.clientX;
                lastDragY = e.clientY;
                previewCanvas.style.cursor = 'grabbing';
                e.preventDefault();
            };

            const onPreviewMouseMove = (e) => {
                if (!isDraggingPreview) return;
                const rect = previewCanvas.getBoundingClientRect();
                const scale = previewCanvas.width / rect.width;
                const dx = (e.clientX - lastDragX) * scale;
                const dy = (e.clientY - lastDragY) * scale;

                if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) {
                    const curX = parseInt(elements.layerPropsOffX.value) || 0;
                    const curY = parseInt(elements.layerPropsOffY.value) || 0;
                    elements.layerPropsOffX.value = Math.round(curX + dx);
                    elements.layerPropsOffY.value = Math.round(curY + dy);
                    lastDragX = e.clientX;
                    lastDragY = e.clientY;
                    renderExternalShpLayerPropsPreview(node, lpCurrentFrameIdx);
                }
            };

            const onPreviewMouseUp = () => {
                if (isDraggingPreview) {
                    isDraggingPreview = false;
                    previewCanvas.style.cursor = 'grab';
                }
            };

            if (previewCanvas) {
                previewCanvas.style.cursor = 'grab';
                previewCanvas.addEventListener('mousedown', onPreviewMouseDown);
                window.addEventListener('mousemove', onPreviewMouseMove);
                window.addEventListener('mouseup', onPreviewMouseUp);
            }

            elements.btnLayerChangeShp.onclick = () => {
                // Re-open selector with current cached data
                openExternalShpDialog(node.id, {
                    extFilename: node.extFilename,
                    frameIdx: lpCurrentFrameIdx,
                    palette: node.extShpPalette
                }, (data) => {
                    const { shpData, frameIdx, palette } = data;
                    const f = shpData.frames[frameIdx];

                    node.name = `Ext: ${shpData.filename} [#${frameIdx}]`;
                    nameInput.value = node.name;
                    node.extFilename = shpData.filename;
                    node.extFrameIdx = frameIdx;
                    node.extTotalFrames = shpData.frames.length;
                    node.extShpFrameData = new Uint8Array(f.originalIndices);
                    node.extShpPalette = palette.map(c => c ? { ...c } : null);
                    node.extWidth = f.width;
                    node.extHeight = f.height;
                    node.extFrameX = f.x;
                    node.extFrameY = f.y;
                    node.extShpWidth = shpData.width;
                    node.extShpHeight = shpData.height;
                    node.extAllFrames = shpData.frames;

                    lpCurrentFrameIdx = frameIdx;
                    lpTotalFrames = shpData.frames.length;

                    setTimeout(() => {
                        lpSyncUI();

                        // FIX: Instantly update the main canvas & sidebar preview behind the dialog 
                        // without waiting for the user to click OK on the Layer Properties dialog
                        updateLayersList();
                        renderCanvas();
                    }, 50);
                });
            };

            // --- Promise block needs access to lpCurrentFrameIdx ---
            return new Promise((resolve) => {
                const cleanup = (val) => {
                    btnOk.onclick = null;
                    btnCancel.onclick = null;
                    ghostSlider.removeEventListener('input', onSliderInput);
                    ghostingCb.removeEventListener('change', onGhostToggle);
                    if (btnGhostMinus) btnGhostMinus.removeEventListener('click', onMinus);
                    if (btnGhostPlus) btnGhostPlus.removeEventListener('click', onPlus);
                    if (btnGhostReset) btnGhostReset.removeEventListener('click', onReset);
                    if (lpSlider) lpSlider.oninput = null;
                    if (lpFrameInput) lpFrameInput.oninput = null;
                    if (lpBtnPrev) lpBtnPrev.onclick = null;
                    if (lpBtnNext) lpBtnNext.onclick = null;
                    if (previewCanvas) {
                        previewCanvas.removeEventListener('mousedown', onPreviewMouseDown);
                        previewCanvas.style.cursor = '';
                    }
                    window.removeEventListener('mousemove', onPreviewMouseMove);
                    window.removeEventListener('mouseup', onPreviewMouseUp);
                    if (typeof dialog.close === 'function') dialog.close();
                    else dialog.removeAttribute('open');
                    resolve(val);
                };

                btnOk.onclick = () => {
                    cleanup({
                        name: nameInput.value.trim() || node.name,
                        visible: visibleCb.checked,
                        ghosting: ghostingCb.checked,
                        ghostOpacity: parseInt(ghostSlider.value),
                        maskType: maskSelect.value,
                        x: parseInt(elements.layerPropsOffX.value),
                        y: parseInt(elements.layerPropsOffY.value),
                        extFrameIdx: lpCurrentFrameIdx
                    });
                };

                btnCancel.onclick = () => cleanup(null);

                nameInput.onkeydown = (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); btnOk.click(); }
                };

                if (typeof dialog.showModal === 'function') dialog.showModal();
                else dialog.setAttribute('open', '');

                setTimeout(() => { nameInput.focus(); nameInput.select(); }, 50);
            });
        }
    }

    return new Promise((resolve) => {
        const cleanup = (val) => {
            btnOk.onclick = null;
            btnCancel.onclick = null;
            ghostSlider.removeEventListener('input', onSliderInput);
            ghostingCb.removeEventListener('change', onGhostToggle);
            if (btnGhostMinus) btnGhostMinus.removeEventListener('click', onMinus);
            if (btnGhostPlus) btnGhostPlus.removeEventListener('click', onPlus);
            if (btnGhostReset) btnGhostReset.removeEventListener('click', onReset);
            if (typeof dialog.close === 'function') dialog.close();
            else dialog.removeAttribute('open');
            resolve(val);
        };

        btnOk.onclick = () => {
            cleanup({
                name: nameInput.value.trim() || node.name,
                visible: visibleCb.checked,
                ghosting: ghostingCb.checked,
                ghostOpacity: parseInt(ghostSlider.value),
                maskType: maskSelect.value,
                x: isExtShp ? parseInt(elements.layerPropsOffX.value) : node.x,
                y: isExtShp ? parseInt(elements.layerPropsOffY.value) : node.y
            });
        };

        btnCancel.onclick = () => cleanup(null);

        // Enter key submits
        nameInput.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); btnOk.click(); }
        };

        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');

        // Focus the name field and select all text
        setTimeout(() => { nameInput.focus(); nameInput.select(); }, 50);
    });
}

/**
 * Render External SHP preview for Layer Properties
 * @param {Object} node - The layer node
 * @param {Number} frameIdx - Frame index to render (defaults to node.extFrameIdx)
 */
function renderExternalShpLayerPropsPreview(node, frameIdx) {
    if (!node || node.type !== 'external_shp' || !node.extShpPalette) return;
    const canvas = elements.layerPropsExternalPreview;
    const info = elements.layerPropsExternalInfo;
    const bgContainer = document.getElementById('layerPropsPreviewBg');
    if (!canvas) return;

    if (frameIdx === undefined) frameIdx = node.extFrameIdx || 0;

    // Get frame data: either from extAllFrames or from stored single frame
    let fw, fh, fx, fy, indices;
    if (node.extAllFrames && node.extAllFrames[frameIdx]) {
        const f = node.extAllFrames[frameIdx];
        fw = f.width; fh = f.height; fx = f.x || 0; fy = f.y || 0;
        indices = f.originalIndices;
    } else {
        fw = node.extWidth; fh = node.extHeight;
        fx = node.extFrameX || 0; fy = node.extFrameY || 0;
        indices = node.extShpFrameData;
    }
    if (!indices) return;

    const ctx = canvas.getContext('2d');
    const shpW = node.extShpWidth || node.extWidth;
    const shpH = node.extShpHeight || node.extHeight;
    canvas.width = shpW;
    canvas.height = shpH;

    // Set background color from palette index 0
    const bg = node.extShpPalette[0] || { r: 0, g: 0, b: 0 };
    const bgColor = `rgb(${bg.r},${bg.g},${bg.b})`;
    if (bgContainer) bgContainer.style.background = bgColor;

    // Build an off-screen canvas for the external SHP
    const extCanvas = document.createElement('canvas');
    extCanvas.width = shpW;
    extCanvas.height = shpH;
    const extCtx = extCanvas.getContext('2d');
    const extD = extCtx.createImageData(shpW, shpH);
    const extData = extD.data;

    for (let y = 0; y < fh; y++) {
        const py = fy + y;
        if (py < 0 || py >= shpH) continue;
        for (let x = 0; x < fw; x++) {
            const px = fx + x;
            if (px < 0 || px >= shpW) continue;
            const idx = indices[y * fw + x];
            if (idx === 0 || idx === TRANSPARENT_COLOR) continue;
            const c = node.extShpPalette[idx];
            const target = (py * shpW + px) * 4;
            if (c) {
                extData[target] = c.r; extData[target + 1] = c.g; extData[target + 2] = c.b; extData[target + 3] = 255;
            }
        }
    }
    extCtx.putImageData(extD, 0, 0);

    const cbOverlay = document.getElementById('lpExtShowOverlay');
    const isOverlayOn = cbOverlay && cbOverlay.checked && state.frames[state.currentFrameIdx];

    const cxInput = document.getElementById('layerPropsOffX');
    const cyInput = document.getElementById('layerPropsOffY');
    const cx = cxInput ? parseInt(cxInput.value) || 0 : node.x || 0;
    const cy = cyInput ? parseInt(cyInput.value) || 0 : node.y || 0;

    if (isOverlayOn) {
        const mainFrame = state.frames[state.currentFrameIdx];
        const mainW = mainFrame.width || state.frames[0].width;
        const mainH = mainFrame.height || state.frames[0].height;

        const compositeResult = window.compositeFrame(mainFrame, {
            transparentIdx: TRANSPARENT_COLOR,
            includeExternalShp: true,
            excludeNodeId: node.id
        });

        // Compute bounding box logic so the graphic isn't cut off when moved outside main frame bounds
        const originX = Math.round(mainW / 2 - shpW / 2);
        const originY = Math.round(mainH / 2 - shpH / 2);
        const targetX = originX + cx;
        const targetY = originY + cy;

        const minX = Math.min(0, targetX);
        const minY = Math.min(0, targetY);
        const maxX = Math.max(mainW, targetX + shpW);
        const maxY = Math.max(mainH, targetY + shpH);

        // Symmetric expansion ensures the main SHP remains dead-center in the flex container
        const maxExpandX = Math.max(0, -minX, maxX - mainW);
        const maxExpandY = Math.max(0, -minY, maxY - mainH);

        const pad = 10;
        canvas.width = mainW + maxExpandX * 2 + pad * 2;
        canvas.height = mainH + maxExpandY * 2 + pad * 2;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const mainCanv = document.createElement('canvas');
        mainCanv.width = mainW;
        mainCanv.height = mainH;
        const mCtx = mainCanv.getContext('2d');
        const mData = mCtx.createImageData(mainW, mainH);

        for (let k = 0; k < compositeResult.length; k++) {
            const v = compositeResult[k];
            if (v !== TRANSPARENT_COLOR && v !== 0) {
                const c = state.palette[v];
                if (c) {
                    const off = k * 4;
                    mData.data[off] = c.r; mData.data[off + 1] = c.g; mData.data[off + 2] = c.b; mData.data[off + 3] = 255;
                }
            }
        }
        mCtx.putImageData(mData, 0, 0);

        const drawOffX = maxExpandX + pad;
        const drawOffY = maxExpandY + pad;

        ctx.drawImage(mainCanv, drawOffX, drawOffY);

        // Draw the frame limits of the main SHP
        ctx.strokeStyle = "rgba(0, 255, 170, 0.5)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(drawOffX - 0.5, drawOffY - 0.5, mainW + 1, mainH + 1);
        ctx.setLineDash([]);

        ctx.drawImage(extCanvas, drawOffX + targetX, drawOffY + targetY);

    } else {
        // Just the external SHP
        canvas.width = shpW;
        canvas.height = shpH;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.drawImage(extCanvas, 0, 0);
    }

    if (info) {
        info.innerText = `${node.extFilename || 'External SHP'}\n${shpW}x${shpH}`;
    }
}

/**
 * Custom Confirmation Dialog
 */
export async function showConfirm(title, message = "") {
    const dialog = document.getElementById('confirmDialog');
    const msgEl = document.getElementById('confirmMessage');
    const titleEl = document.getElementById('confirmTitle');
    const btnYes = document.getElementById('btnConfirmYes');
    const btnNo = document.getElementById('btnConfirmNo');

    if (!dialog || !msgEl || !btnYes || !btnNo) {
        return confirm(message ? `${title}\n\n${message}` : title);
    }

    titleEl.textContent = title;
    msgEl.innerHTML = message || "";
    msgEl.style.display = message ? 'block' : 'none';

    return new Promise((resolve) => {
        const cleanup = (val) => {
            btnYes.onclick = null;
            btnNo.onclick = null;
            if (typeof dialog.close === 'function') dialog.close();
            else dialog.removeAttribute('open');
            resolve(val);
        };

        btnYes.onclick = () => cleanup(true);
        btnNo.onclick = () => cleanup(false);

        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
    });
}

/**
 * Custom Choice Dialog (3 options: btn1, btn2, cancel)
 */
export async function showChoice(title, message, label1, label2) {
    const dialog = document.getElementById('choiceDialog');
    const msgEl = document.getElementById('choiceMessage');
    const titleEl = document.getElementById('choiceTitle');
    const btn1 = document.getElementById('btnChoice1');
    const btn2 = document.getElementById('btnChoice2');
    const btnCancel = document.getElementById('btnChoiceCancel');

    if (!dialog || !msgEl || !btn1 || !btn2 || !btnCancel) {
        // Fallback to confirm-like behavior or just fail gracefully
        const res = confirm(`${title}\n\n${message}\n\nOK for ${label1}, Cancel for ${label2}`);
        return res ? 'opt1' : 'opt2';
    }

    titleEl.textContent = title;
    msgEl.innerHTML = message || "";
    btn1.textContent = label1;
    btn2.textContent = label2;

    return new Promise((resolve) => {
        const cleanup = (val) => {
            btn1.onclick = null;
            btn2.onclick = null;
            btnCancel.onclick = null;
            if (typeof dialog.close === 'function') dialog.close();
            else dialog.removeAttribute('open');
            resolve(val);
        };

        btn1.onclick = () => cleanup('opt1');
        btn2.onclick = () => cleanup('opt2');
        btnCancel.onclick = () => cleanup('cancel');

        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');

        // Focus the first button by default
        setTimeout(() => btn1.focus(), 0);
    });
}

export function createNewProject(w, h, frames = 1, useShadows = false, palette = null, compression = 3, solidStart = true) {
    state.canvasW = w;
    state.canvasH = h;
    state.useShadows = useShadows;
    state.compression = compression;

    if (palette) {
        state.palette = palette;
    }

    state.frames = [];
    for (let i = 0; i < frames; i++) {
        addFrame(w, h);
        if (solidStart) {
            // Fill the initial layer with Index 0 (Background)
            const f = state.frames[state.frames.length - 1];
            if (f && f.layers && f.layers.length > 0) {
                const layer = f.layers[0];
                if (layer.data) layer.data.fill(0);
            }
        } else {
            // Default to Void/Transparent for empty projects
            const f = state.frames[state.frames.length - 1];
            if (f && f.layers && f.layers.length > 0) {
                const layer = f.layers[0];
                if (layer.data) layer.data.fill(TRANSPARENT_COLOR);
            }
        }
    }
    updateUIState();

    state.currentFrameIdx = 0;
    resetFramesList();
    // Initialize activeLayerId
    if (state.frames.length > 0 && state.frames[0].layers.length > 0) {
        const flat = getFlatLayers(state.frames[0].layers);
        if (flat.length > 0) state.activeLayerId = flat[0].id;
    }
    state.history = [];
    state.historyPtr = -1;
    state.selection = null;
    state.floatingSelection = null;
    state.zoom = 1;

    updateCanvasSize();
    pushHistory();
    renderCanvas();
    renderFramesList();
    renderPalette(); // Main palette UI
    updateLayersList();

    // Update UI visibility based on project state
    if (typeof updateUIState === 'function') {
        updateUIState();
    }
}

export function addFrame(w, h, data) {
    if (!w || typeof w !== 'number') w = state.canvasW;
    if (!h || typeof h !== 'number') h = state.canvasH;
    const newFrame = {
        width: w,
        height: h,
        lastSelectedIdx: -1, // -1 means "inherit global preferredLayerIdx"
        layers: [
            {
                type: 'layer',
                id: generateId(),
                name: 'Layer 1',
                data: data ? new Uint16Array(data) : new Uint16Array(w * h).fill(TRANSPARENT_COLOR),
                visible: true,
                width: w, height: h,
                mask: null,
                editMask: false
            }
        ]
    };

    // Insert after current frame index
    const insertIdx = state.currentFrameIdx + 1;
    state.frames.splice(insertIdx, 0, newFrame);
    state.currentFrameIdx = insertIdx;
    syncLayerSelection();

    renderFramesList();
    updateLayersList();
    renderCanvas();
    renderPalette();
    pushHistory();
    if (typeof updateUIState === 'function') updateUIState();
}



export function addExternalShpLayer() {
    const frame = state.frames[state.currentFrameIdx];
    if (!frame) return;

    const newLayer = {
        type: 'external_shp',
        id: generateId(),
        name: "External SHP",
        data: new Uint16Array(frame.width * frame.height).fill(TRANSPARENT_COLOR),
        visible: true,
        width: frame.width,
        height: frame.height,
        x: 0,
        y: 0,
        mask: null,
        editMask: false
    };

    const findResult = findLayerParent(frame.layers, state.activeLayerId);
    if (findResult) {
        const { parent, index } = findResult;
        const activeNode = parent[index];
        if (activeNode.type === 'group') {
            activeNode.expanded = true;
            activeNode.children.unshift(newLayer);
        } else {
            parent.splice(index, 0, newLayer);
        }
    } else {
        frame.layers.unshift(newLayer);
    }

    state.activeLayerId = newLayer.id;
    pushHistory();
    updateLayersList();
    renderCanvas();
    renderFramesList();

    // Open selection dialog immediately
    openExternalShpDialog(newLayer.id);
}

export function addLayer() {
    const frame = state.frames[state.currentFrameIdx];

    const newLayer = {
        type: 'layer',
        id: generateId(),
        name: getNextLayerName(state.frames[state.currentFrameIdx].layers),
        data: new Uint16Array(frame.width * frame.height).fill(TRANSPARENT_COLOR),
        visible: true,
        width: frame.width, height: frame.height,
        mask: null,
        editMask: false
    };

    // Add to Active Group or Root
    // Add to Active Group or Root
    const findResult = findLayerParent(frame.layers, state.activeLayerId);
    if (findResult) {
        const { parent, index } = findResult;
        // If active is group, add inside? Or below?
        // If active is group, add inside (Top).
        const activeNode = parent[index];
        if (activeNode.type === 'group') {
            activeNode.expanded = true;
            activeNode.children.unshift(newLayer);
        } else {
            // Add above active layer
            parent.splice(index, 0, newLayer);
        }
    } else {
        // No selection, add to top of root
        frame.layers.unshift(newLayer);
    }

    state.activeLayerId = newLayer.id;
    state.activeLayerIdx = -1;
    pushHistory();
    updateLayersList();
    renderCanvas();
    renderFramesList();
}

export function addGroup() {
    const frame = state.frames[state.currentFrameIdx];
    const newGroup = {
        type: 'group',
        id: generateId(),
        name: getNextGroupName(frame.layers),
        children: [],
        visible: true,
        expanded: true
    };

    const findResult = findLayerParent(frame.layers, state.activeLayerId);
    if (findResult) {
        const { parent, index } = findResult;
        parent.splice(index, 0, newGroup);
    } else {
        frame.layers.unshift(newGroup);
    }
    pushHistory();
    updateLayersList();
    renderCanvas();

}


export function setupMultiFrameOps() {
    const btn = document.getElementById('btnMultiFrame');
    if (btn) btn.onclick = openMultiFrameDialog;

    const dlg = document.getElementById('dialogMultiFrame');
    const btnCancel = document.getElementById('btnMfCancel');
    const btnProcess = document.getElementById('btnMfProcess');

    if (btnCancel) btnCancel.onclick = () => dlg.close();
    if (btnProcess) btnProcess.onclick = processMultiFrameOp;
}

export async function openMultiFrameDialog() {
    const dlg = document.getElementById('dialogMultiFrame');
    if (!state.activeLayerId) {
        await showAlert("Please select a layer first.");
        return;
    }
    const idx = state.currentFrameIdx;
    const inputs = {
        start: document.getElementById('mfStart'),
        end: document.getElementById('mfEnd')
    };
    inputs.start.value = idx;
    inputs.end.value = idx;
    inputs.start.max = state.frames.length - 1;
    inputs.end.max = state.frames.length - 1;

    dlg.showModal();
}

export async function processMultiFrameOp() {
    const action = document.getElementById('mfAction').value;
    const start = parseInt(document.getElementById('mfStart').value);
    const end = parseInt(document.getElementById('mfEnd').value);
    const dlg = document.getElementById('dialogMultiFrame');

    if (isNaN(start) || isNaN(end) || start < 0 || end >= state.frames.length || start > end) {
        await showAlert("Invalid Frame Range");
        return;
    }

    // 1. Get Source Chain
    const frame = state.frames[state.currentFrameIdx];
    const res = findLayerParent(frame.layers, state.activeLayerId);
    if (!res) return;

    if (res.parent[res.index].type === 'external_shp') {
        alert("Cannot duplicate/move External SHP layer through frames.");
        return;
    }
    const { parent, index } = res;

    // Helper to get chain (Code reused/adapted from duplicateLayer logic)
    // Extract chain logic for multi-frame operations
    const chain = [];
    chain.push(parent[index]);
    if (!parent[index].clipped) {
        let lookAhead = index + 1;
        while (lookAhead < parent.length && parent[lookAhead].clipped) {
            chain.push(parent[lookAhead]);
            lookAhead++;
        }
    }

    // 2. Perform Action
    for (let f = start; f <= end; f++) {
        if (f === state.currentFrameIdx && action === 'copy') {
            // If copying to SAME frame, duplicate in place? 
            // Normally "Multi-Frame" implies copying to OTHERS. 
            // But if range includes self, sure.
            // We use duplicateLayer logic for self?
            // Or just standard insertion.
        }

        const targetFrame = state.frames[f];
        // Where to insert? 
        // Try to match index if possible, else top.
        // If index exists, splice there. Else push.
        let insIdx = index;
        if (insIdx > targetFrame.layers.length) insIdx = targetFrame.layers.length;

        // Clone Chain
        const newChain = chain.map(n => {
            const c = cloneLayerRecursive(n); // Need helper
            return c;
        });

        targetFrame.layers.splice(insIdx, 0, ...newChain);
    }

    // 3. If Move, Delete Original
    if (action === 'move') {
        // Delete chain from CURRENT frame
        // Chain length
        parent.splice(index, chain.length);
        state.activeLayerId = null;
    }

    pushHistory();
    dlg.close();
    updateLayersList();
    renderCanvas();
    renderFramesList();
}

export function cloneLayerRecursive(n) {
    const copy = { ...n };
    copy.id = generateId();
    // Preserve the original TypedArray type (Uint16Array for layers, Uint8Array for masks)
    if (n.data) {
        if (n.data instanceof Uint16Array) copy.data = new Uint16Array(n.data);
        else if (n.data instanceof Uint8Array) copy.data = new Uint8Array(n.data);
        else copy.data = Array.isArray(n.data) ? [...n.data] : new Uint16Array(n.data);
    }
    if (n.mask) copy.mask = new Uint8Array(n.mask);
    if (n.children) copy.children = n.children.map(c => cloneLayerRecursive(c));
    return copy;
}



export function getActiveLayer() {
    const frame = state.frames[state.currentFrameIdx];
    if (!frame) return null;

    if (state.activeLayerId) {
        const res = findLayerParent(frame.layers, state.activeLayerId);
        if (res) return res.parent[res.index];
    }

    // Fallback
    if (state.activeLayerIdx >= 0 && state.activeLayerIdx < frame.layers.length) {
        return frame.layers[state.activeLayerIdx];
    }
    return null;
}

export async function openActiveLayerProperties(node = null) {
    if (!node) node = getActiveLayer();
    if (!node) return;

    const result = await showLayerPropertiesDialog(node);
    if (result) {
        node.name = result.name;
        node.visible = result.visible;
        node.ghosting = result.ghosting;
        node.ghostOpacity = result.ghostOpacity;
        if (result.x !== undefined) node.x = result.x;
        if (result.y !== undefined) node.y = result.y;

        // Handle external SHP frame change
        if (result.extFrameIdx !== undefined && node.type === 'external_shp' && node.extAllFrames) {
            const newIdx = result.extFrameIdx;
            if (newIdx !== node.extFrameIdx && node.extAllFrames[newIdx]) {
                const f = node.extAllFrames[newIdx];
                node.extFrameIdx = newIdx;
                node.extShpFrameData = new Uint8Array(f.originalIndices);
                node.extWidth = f.width;
                node.extHeight = f.height;
                node.extFrameX = f.x;
                node.extFrameY = f.y;
                node.name = `Ext: ${node.extFilename} [#${newIdx}]`;
            }
        }

        // Apply mask type changes
        if (result.maskType === 'none') {
            if (node.isMask && !node.clipped) {
                node.isMask = false;
                delete node.maskType;
            }
        } else {
            node.isMask = true;
            node.maskType = result.maskType; // 'opacity' or 'hide'
        }

        updateLayersList();
        renderCanvas();
    }
}

export async function deleteLayer(bypassConfirm = false) {
    const frame = state.frames[state.currentFrameIdx];
    if (!state.activeLayerId) return;

    if (!bypassConfirm) {
        const confirmed = await showConfirm("ARE YOU SURE YOU WANT TO DELETE THE SELECTED LAYER?");
        if (!confirmed) return;
    }

    const res = findLayerParent(frame.layers, state.activeLayerId);
    if (!res) return;

    let { parent, index, parentObj } = res;
    let nodeToDelete = parent[index];

    // Hierarchy cleanup: deletion handles children automatically
    parent.splice(index, 1);

    // Selection cleanup
    if (index < parent.length) {
        state.activeLayerId = parent[index].id;
    } else if (index > 0) {
        state.activeLayerId = parent[index - 1].id;
    } else {
        state.activeLayerId = null;
    }

    state.activeLayerIdx = -1;
    pushHistory();
    updateLayersList();
    renderCanvas();
    renderFramesList();
}

export function addMask(layer) {
    if (!layer) layer = getActiveLayer();
    if (!layer || layer.mask) return; // Works for Group or Layer
    const w = layer.width || state.canvasW;
    const h = layer.height || state.canvasH;

    layer.mask = new Uint8Array(w * h).fill(1); // Default Visible
    layer.editMask = true;
    state.activeLayerId = layer.id;
    state.activeLayerIdx = -1;
    pushHistory();
    updateLayersList();
    renderCanvas();
}

export function deleteMask(layer) {
    if (!layer) layer = getActiveLayer();
    if (!layer || !layer.mask) return;
    layer.mask = null;
    layer.editMask = false;
    pushHistory();
    updateLayersList();
    renderCanvas();
}

export function duplicateLayer(layerId = null) {
    const frame = state.frames[state.currentFrameIdx];
    const id = layerId || state.activeLayerId;
    if (!id) return;

    let res = findLayerParent(frame.layers, id);
    if (!res) return;

    const { parent, index } = res;
    const originalNode = parent[index];

    // 1. Deep clone using the robust history helper
    const newNode = cloneLayerNode(originalNode);

    // 2. Assign fresh IDs recursively to the new branch
    const assignNewIds = (n) => {
        n.id = generateId();
        if (n.children) n.children.forEach(assignNewIds);
        if (n.layers) n.layers.forEach(assignNewIds);
    };
    assignNewIds(newNode);

    // 3. Handle Naming (only for the duplicated root)
    const existingNames = [];
    const collectNames = (layers) => {
        layers.forEach(l => {
            existingNames.push(l.name);
            if (l.children) collectNames(l.children);
            if (l.layers) collectNames(l.layers);
        });
    };
    collectNames(frame.layers);
    newNode.name = getNextDuplicateName(existingNames, originalNode.name);

    // 4. Insert into parent array
    // Insert at 'index' to place ABOVE the original (since index 0 is Top)
    parent.splice(index, 0, newNode);

    state.activeLayerId = newNode.id;
    state.activeLayerIdx = -1; // Force re-find if needed

    pushHistory();
    updateLayersList();
    renderCanvas();
    renderFramesList();
}

export function moveLayerUp() {
    if (!state.activeLayerId) return;
    const frame = state.frames[state.currentFrameIdx];
    let res = findLayerParent(frame.layers, state.activeLayerId);
    if (!res) return;

    // ATOMIC UNIT: If clipped, move the parent instead
    if (res.parent[res.index].clipped && res.parentObj) {
        res = findLayerParent(frame.layers, res.parentObj.id);
        if (!res) return;
    }

    const { parent, index } = res;
    if (index > 0) {
        const tmp = parent[index];
        parent[index] = parent[index - 1];
        parent[index - 1] = tmp;
        pushHistory();
        updateLayersList();
        renderCanvas();
    }
}

export function moveLayerDown() {
    if (!state.activeLayerId) return;
    const frame = state.frames[state.currentFrameIdx];
    let res = findLayerParent(frame.layers, state.activeLayerId);
    if (!res) return;

    // ATOMIC UNIT: If clipped, move the parent instead
    if (res.parent[res.index].clipped && res.parentObj) {
        res = findLayerParent(frame.layers, res.parentObj.id);
        if (!res) return;
    }

    const { parent, index } = res;
    if (index < parent.length - 1) {
        const tmp = parent[index];
        parent[index] = parent[index + 1];
        parent[index + 1] = tmp;
        pushHistory();
        updateLayersList();
        renderCanvas();
    }
}


export function mergeLayerDown() {
    const frame = state.frames[state.currentFrameIdx];
    if (!frame) return;

    const info = findLayerParent(frame.layers, state.activeLayerId);
    if (!info) return;

    const topNode = info.parent[info.index];
    const { parent: parentArr, index } = info;

    // Helper: Flatten a node hierarchy WITH its clipped masks
    const getHighFidelityFlattened = (node) => {
        const nInfo = findLayerParent(frame.layers, node.id);
        const clipped = [];
        if (nInfo) {
            // Clipped masks are siblings ABOVE the target (indices < index)
            for (let i = nInfo.index - 1; i >= 0; i--) {
                const s = nInfo.parent[i];
                if (s.isMask && s.clipped) clipped.push(s);
                else break;
            }
        }

        const virtualFrame = {
            width: frame.width,
            height: frame.height,
            layers: [...clipped.reverse(), node]
        };

        return compositeFrame(virtualFrame, {
            backgroundIdx: TRANSPARENT_COLOR,
            includeExternalShp: true,
            flattenToPalette: state.palette
        });
    };

    // Collect IDs of nodes that will be "baked" and should be removed
    const nodesToRemove = new Set();
    let newBottomData = null;
    let targetNode = null;

    if (topNode.isMask) {
        // --- SCENARIO 1: Mask Merging Down ---
        let targetIndex = -1;
        for (let i = index + 1; i < parentArr.length; i++) {
            if (!parentArr[i].isMask && parentArr[i].type !== 'external_shp') {
                targetIndex = i;
                break;
            }
        }

        if (targetIndex === -1) {
            showAlert("Merge Down", "This mask has no valid layer below to merge into.");
            return;
        }

        targetNode = parentArr[targetIndex];
        const bottomData = getHighFidelityFlattened(targetNode);
        const maskVisual = flattenNode(topNode, frame.width, frame.height);
        const actualTransparent = state.isAlphaImageMode ? 127 : 0;

        for (let i = 0; i < bottomData.length; i++) {
            if (bottomData[i] === TRANSPARENT_COLOR) continue;
            const isMaskPresent = (maskVisual[i] !== TRANSPARENT_COLOR && maskVisual[i] !== actualTransparent);
            if (topNode.maskType === 'hide') {
                if (isMaskPresent) bottomData[i] = TRANSPARENT_COLOR;
            } else {
                if (!isMaskPresent) bottomData[i] = TRANSPARENT_COLOR;
            }
        }
        newBottomData = bottomData;
        nodesToRemove.add(topNode.id);
        // Also remove masks of the target as they are now baked
        for (let i = targetIndex - 1; i >= 0; i--) {
            if (parentArr[i].isMask && parentArr[i].clipped) nodesToRemove.add(parentArr[i].id);
            else break;
        }
    } else {
        // --- SCENARIO 2: Layer/Group Merging Down ---
        if (topNode.type === 'external_shp') return;

        let targetIndex = -1;
        for (let i = index + 1; i < parentArr.length; i++) {
            const potentialBottom = parentArr[i];
            if (potentialBottom.type !== 'external_shp' && !potentialBottom.isMask) {
                targetIndex = i;
                break;
            }
        }

        if (targetIndex !== -1) {
                targetNode = parentArr[targetIndex];
            const topData = getHighFidelityFlattened(topNode);
            const bottomData = getHighFidelityFlattened(targetNode);
            const actualTransparent = state.isAlphaImageMode ? 127 : 0;
            for (let i = 0; i < topData.length; i++) {
                if (topData[i] !== TRANSPARENT_COLOR && topData[i] !== actualTransparent) {
                    bottomData[i] = topData[i];
                }
            }
            newBottomData = bottomData;

            // Mark top and its masks for removal
            nodesToRemove.add(topNode.id);
            for (let i = index - 1; i >= 0; i--) {
                if (parentArr[i].isMask && parentArr[i].clipped) nodesToRemove.add(parentArr[i].id);
                else break;
            }
            // Mark bottom's masks for removal (they are baked)
            for (let i = targetIndex - 1; i >= 0; i--) {
                const s = parentArr[i];
                if (nodesToRemove.has(s.id)) continue;
                if (s.isMask && s.clipped) nodesToRemove.add(s.id);
                else if (!s.isMask) break;
            }
        }
    }

    if (newBottomData && targetNode) {
        // Construct the new state
        const newBottom = {
            ...targetNode,
            visible: true,
            data: newBottomData,
            type: 'layer',
            width: frame.width,
            height: frame.height,
            _v: (targetNode._v || 0) + 1
        };
        // Ensure it's no longer a group
        if (newBottom.layers) delete newBottom.layers;
        if (newBottom.children) delete newBottom.children;

        // Atomic replacement in the array
        const remaining = parentArr.filter(n => !nodesToRemove.has(n.id) || n.id === targetNode.id);
        const finalIdx = remaining.findIndex(n => n.id === targetNode.id);
        if (finalIdx !== -1) remaining[finalIdx] = newBottom;

        // Apply back to the hierarchy
        info.parent.length = 0;
        info.parent.push(...remaining);

        state.activeLayerId = newBottom.id;

        pushHistory();
        updateLayersList();
        renderCanvas();
        renderFramesList();
    }
}
export function applyColorReplace() {
    const from = parseInt(elements.repFrom.value);
    const to = parseInt(elements.repTo.value);
    if (isNaN(from) || isNaN(to)) return;

    const frame = state.frames[state.currentFrameIdx];
    const layer = frame.layers[state.activeLayerIdx];

    for (let i = 0; i < layer.data.length; i++) {
        if (layer.data[i] === from) layer.data[i] = to;
    }
    layer._v = (layer._v || 0) + 1;

    pushHistory();
    elements.replaceColorDialog.close();
    renderCanvas();
}





// --- REPLACE CONFLICT DETECTION ---
export function analyzeReplaceConflicts() {
    const conflicts = new Array(state.replacePairs.length).fill(false);
    const definedSources = new Set();
    const definedTargets = new Set();

    state.replacePairs.forEach((pair, i) => {
        if (pair.srcIdx === null || pair.srcIdx === undefined) return;

        let isConflict = false;

        // 1. Identity conflict (src === tgt)
        if (pair.srcIdx === pair.tgtIdx) {
            isConflict = true;
        }

        // 2. Duplicate Source check: Has this source been used in a previous row?
        if (definedSources.has(pair.srcIdx)) {
            isConflict = true;
        }

        // 3. Chained Replacement check: Is this source already a target in a previous row?
        if (definedTargets.has(pair.srcIdx)) {
            isConflict = true;
        }

        if (isConflict) {
            conflicts[i] = true;
        }

        // Add to tracking sets for subsequent rows
        definedSources.add(pair.srcIdx);
        if (pair.tgtIdx !== null && pair.tgtIdx !== undefined) {
            definedTargets.add(pair.tgtIdx);
        }
    });

    return conflicts;
}

// --- REPLACE GRID RENDERING ---
export function renderReplaceGrid() {
    if (!elements.replaceGrid) return;
    elements.replaceGrid.innerHTML = '';

    const conflicts = analyzeReplaceConflicts();

    state.replacePairs.forEach((pair, i) => {
        // ROW CONTAINER
        const rowLine = document.createElement('div');
        rowLine.className = 'replace-row-line';
        if (state.replaceSelection.has(i)) rowLine.classList.add('row-selected');
        rowLine.draggable = true;

        // SOURCE CELL
        const srcDiv = document.createElement('div');
        srcDiv.className = 'replace-cell';
        // Only draggable if it has a color
        if (pair.srcIdx !== null && pair.srcIdx !== undefined) {
            srcDiv.draggable = true;
        }

        if (pair.srcIdx !== null && pair.srcIdx !== undefined) {
            const color = state.palette[pair.srcIdx];
            if (color) {
                srcDiv.style.backgroundColor = `rgb(${color.r},${color.g},${color.b})`;
                const span = document.createElement('span');
                span.className = 'replace-cell-text';
                span.innerText = pair.srcIdx;
                span.style.color = getContrastYIQ(color.r, color.g, color.b);
                srcDiv.appendChild(span);
                srcDiv.title = `${state.translations.tt_idx}: ${pair.srcIdx}\n${state.translations.tt_rgb}: ${color.r},${color.g},${color.b}`;
            }
        } else {
            srcDiv.classList.add('empty-p1');
            srcDiv.title = `${state.translations.tt_idx}: ${state.translations.tt_empty}\n${state.translations.tt_rgb}: ${state.translations.tt_empty}`;
        }

        // Target Cell
        const tgtDiv = document.createElement('div');
        tgtDiv.className = 'replace-cell';
        if (pair.tgtIdx !== null && pair.tgtIdx !== undefined) {
            tgtDiv.draggable = true;
        }
        if (pair.tgtIdx !== null && pair.tgtIdx !== undefined) {
            const color = state.palette[pair.tgtIdx];
            if (color) {
                tgtDiv.style.backgroundColor = `rgb(${color.r},${color.g},${color.b})`;
                const span = document.createElement('span');
                span.className = 'replace-cell-text';
                span.innerText = pair.tgtIdx;
                span.style.color = getContrastYIQ(color.r, color.g, color.b);
                tgtDiv.appendChild(span);
                tgtDiv.title = `${state.translations.tt_idx}: ${pair.tgtIdx}\n${state.translations.tt_rgb}: ${color.r},${color.g},${color.b}`;
            } else {
                const span = document.createElement('span');
                span.className = 'replace-cell-text';
                span.innerText = pair.tgtIdx;
                tgtDiv.appendChild(span);
                tgtDiv.title = `${state.translations.tt_idx}: ${pair.tgtIdx}\n${state.translations.tt_rgb}: ${state.translations.tt_unknown}`;
            }
        } else {
            tgtDiv.classList.add('empty-p1'); // Hatch pattern
            tgtDiv.title = `${state.translations.tt_idx}: ${state.translations.tt_empty}\n${state.translations.tt_rgb}: ${state.translations.tt_empty}`;
        }

        // Arrow / X
        const arrow = document.createElement('div');
        arrow.className = 'replace-arrow';

        // Check Validity
        let isInvalid = conflicts[i];
        if (pair.srcIdx === null || pair.srcIdx === undefined ||
            pair.tgtIdx === null || pair.tgtIdx === undefined) {
            // Any incomplete pair (including fully empty) is invalid
            isInvalid = true;
        }

        if (isInvalid) {
            arrow.innerHTML = 'X';
            arrow.className = 'replace-arrow replace-conflict';
        } else {
            arrow.innerHTML = '➡';
            arrow.className = 'replace-arrow';
        }

        // Selection Styling
        if (state.replaceSelection.has(i)) {
            srcDiv.classList.add('row-selected');
            tgtDiv.classList.add('row-selected');
            arrow.classList.add('row-selected');
        }

        srcDiv.dataset.side = 'src';
        srcDiv.dataset.row = i;
        tgtDiv.dataset.side = 'tgt';
        tgtDiv.dataset.row = i;

        // --- Drag & Drop Handlers ---
        const onDragStart = (e, type, side) => {
            if (type === 'replace-cell') {
                e.stopPropagation(); // Don't trigger row drag
            }

            state.dragSourceType = type;
            if (!state.replaceSelection.has(i)) {
                state.replaceSelection.clear();
                state.replaceSelection.add(i);
                state.lastReplaceIdx = i;
                renderReplaceGrid();
            }
            state.dragSourceCount = state.replaceSelection.size;
            e.dataTransfer.setData('application/json', JSON.stringify({
                t: type,
                indices: Array.from(state.replaceSelection).sort((a, b) => a - b),
                side: side
            }));
            e.dataTransfer.setData('text/plain', type);
            e.dataTransfer.effectAllowed = 'move';
        };

        const onDragOver = (e) => {
            e.preventDefault();
            let targetSide = e.currentTarget.dataset.side;

            // If dragging over the row wrapper or arrow, calculate side based on mouse position
            if (!targetSide) {
                const rect = e.currentTarget.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                targetSide = (mouseX > (rect.width / 2)) ? 'tgt' : 'src';
            }

            if (state.dragSourceType === 'palette') {
                e.dataTransfer.dropEffect = 'copy';
            } else {
                e.dataTransfer.dropEffect = 'move';
            }

            const dragCount = state.dragSourceCount || 1;

            // Clear previous highlights
            document.querySelectorAll('.drop-target, .overwrite-target, .swap-target').forEach(el => {
                el.classList.remove('drop-target', 'overwrite-target', 'swap-target');
            });
            elements.replaceGrid.classList.remove('new-entry-active');

            let willExpand = false;
            for (let k = 0; k < dragCount; k++) {
                const targetRowIdx = i + k;
                const row = elements.replaceGrid.children[targetRowIdx];

                if (row && row.classList.contains('replace-row-line')) {
                    if (state.dragSourceType === 'replace-row') {
                        // Highlight the entire row line for reordering
                        row.classList.add('drop-target');
                    } else {
                        // Highlight specific cell within the row
                        const cell = (targetSide === 'src' ? row.children[0] : row.children[2]);
                        if (cell) {
                            if (state.dragSourceType === 'replace-cell') {
                                cell.classList.add('swap-target');
                            } else {
                                const pair = state.replacePairs[targetRowIdx];
                                const isOccupied = targetSide === 'src' ? pair.srcIdx !== null : pair.tgtIdx !== null;
                                if (isOccupied) cell.classList.add('overwrite-target');
                                else cell.classList.add('drop-target');
                            }
                        }
                    }
                } else {
                    willExpand = true;
                }
            }
            if (willExpand && state.dragSourceType === 'palette') {
                elements.replaceGrid.classList.add('new-entry-active');
            }
        };

        const onDragLeave = (e) => {
            // Highlights are cleared via DragOver of NEXT cell or via DragEnd/Drop
        };

        const onDrop = (e, targetSide) => {
            e.preventDefault();
            e.stopPropagation();
            document.querySelectorAll('.drop-target, .overwrite-target, .swap-target').forEach(el => {
                el.classList.remove('drop-target', 'overwrite-target', 'swap-target');
            });

            try {
                const raw = e.dataTransfer.getData('application/json');
                if (!raw) return;
                const data = JSON.parse(raw);

                // 1. Internal Move/Swap
                if (data.t === 'replace-cell') {
                    const srcIndices = data.indices;
                    const srcSide = data.side;
                    const count = srcIndices.length;

                    if (srcSide === targetSide) {
                        // ROW REORDER (Same side drag)
                        // Swap entire row objects
                        for (let k = 0; k < count; k++) {
                            const sIdx = srcIndices[k];
                            const tIdx = i + k;
                            if (tIdx < state.replacePairs.length) {
                                const temp = state.replacePairs[sIdx];
                                state.replacePairs[sIdx] = state.replacePairs[tIdx];
                                state.replacePairs[tIdx] = temp;
                            }
                        }
                    } else {
                        // CROSS SWAP (Side to side)
                        for (let k = 0; k < count; k++) {
                            const sIdx = srcIndices[k];
                            const tIdx = i + k;
                            if (tIdx < state.replacePairs.length) {
                                const srcVal = state.replacePairs[sIdx][srcSide + 'Idx'];
                                const srcColor = state.replacePairs[sIdx][srcSide];
                                const tgtVal = state.replacePairs[tIdx][targetSide + 'Idx'];
                                const tgtColor = state.replacePairs[tIdx][targetSide];
                                state.replacePairs[tIdx][targetSide + 'Idx'] = srcVal;
                                state.replacePairs[tIdx][targetSide] = srcColor;
                                state.replacePairs[sIdx][srcSide + 'Idx'] = tgtVal;
                                state.replacePairs[sIdx][srcSide] = tgtColor;
                            }
                        }
                    }
                    state.replaceSelection.clear();
                    for (let k = 0; k < count; k++) state.replaceSelection.add(i + k);
                    renderReplaceGrid();
                } else if (data.t === 'replace-row') {
                    // INSERTION REORDER (the "queue" behavior)
                    const srcIndices = data.indices;
                    const count = srcIndices.length;

                    const rowsMoving = srcIndices.map(idx => state.replacePairs[idx]);
                    const sortedSrc = [...srcIndices].sort((a, b) => b - a);
                    sortedSrc.forEach(idx => state.replacePairs.splice(idx, 1));

                    // After removal, the 'i' index might have shifted if 'i' was after any removed items
                    let shiftCount = 0;
                    srcIndices.forEach(idx => { if (idx < i) shiftCount++; });
                    const targetIdx = Math.max(0, i - shiftCount);

                    state.replacePairs.splice(targetIdx, 0, ...rowsMoving);

                    state.replaceSelection.clear();
                    for (let k = 0; k < count; k++) state.replaceSelection.add(targetIdx + k);
                    renderReplaceGrid();
                }
                // 2. Drop from Palette
                else if (data.t === 'palette') {
                    const newIndices = data.i;
                    const count = newIndices.length;
                    while (i + count > state.replacePairs.length) {
                        state.replacePairs.push({ srcIdx: null, tgtIdx: null });
                    }
                    for (let k = 0; k < count; k++) {
                        state.replacePairs[i + k][targetSide + 'Idx'] = newIndices[k];
                    }
                    renderReplaceGrid();
                }
            } catch (err) { console.error("Drop Error:", err); }
        };

        srcDiv.ondragstart = (e) => onDragStart(e, 'replace-cell', 'src');
        srcDiv.ondragover = onDragOver;
        srcDiv.ondragleave = onDragLeave;
        srcDiv.ondrop = (e) => onDrop(e, 'src');

        tgtDiv.ondragstart = (e) => onDragStart(e, 'replace-cell', 'tgt');
        tgtDiv.ondragover = onDragOver;
        tgtDiv.ondragleave = onDragLeave;
        tgtDiv.ondrop = (e) => onDrop(e, 'tgt');

        // ROW EVENTS
        rowLine.ondragstart = (e) => onDragStart(e, 'replace-row', 'src');
        rowLine.ondragover = onDragOver;
        rowLine.ondragleave = onDragLeave;
        rowLine.ondrop = (e) => onDrop(e, 'src');

        // CLICK EVENTS - Select row
        const handleClick = (e) => {
            e.stopPropagation();
            state.multiPickCounter = 0;

            if (e.shiftKey && typeof state.lastReplaceIdx === 'number') {
                const start = Math.min(state.lastReplaceIdx, i);
                const end = Math.max(state.lastReplaceIdx, i);
                if (!e.ctrlKey) state.replaceSelection.clear();
                for (let k = start; k <= end; k++) {
                    state.replaceSelection.add(k);
                }
            } else if (e.ctrlKey) {
                if (state.replaceSelection.has(i)) {
                    state.replaceSelection.delete(i);
                } else {
                    state.replaceSelection.add(i);
                }
                state.lastReplaceIdx = i;
            } else {
                state.replaceSelection.clear();
                state.replaceSelection.add(i);
                state.lastReplaceIdx = i;
            }
            renderReplaceGrid();
        };

        rowLine.onclick = handleClick;
        srcDiv.onclick = (e) => { e.stopPropagation(); handleClick(e); };
        tgtDiv.onclick = (e) => { e.stopPropagation(); handleClick(e); };

        rowLine.appendChild(srcDiv);
        rowLine.appendChild(arrow);
        rowLine.appendChild(tgtDiv);
        elements.replaceGrid.appendChild(rowLine);
    });

    // --- Container Drop Handlers (to append at the end) ---
    const onContainerDragOver = (e) => {
        // ALWAYS preventDefault on the container to allow dropping in gaps
        e.preventDefault();

        if (state.dragSourceType === 'palette') {
            e.dataTransfer.dropEffect = 'copy';
        } else {
            e.dataTransfer.dropEffect = 'move';
        }

        // Only show "new entry" highlight if hovering the container background OR the very bottom
        if (e.target === elements.replaceGrid) {
            elements.replaceGrid.classList.add('new-entry-active');
        } else {
            elements.replaceGrid.classList.remove('new-entry-active');
        }
    };

    const onContainerDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        elements.replaceGrid.classList.remove('new-entry-active');

        try {
            const raw = e.dataTransfer.getData('application/json');
            if (!raw) return;
            const data = JSON.parse(raw);

            const rect = elements.replaceGrid.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            let targetSide = (mouseX > (rect.width / 2)) ? 'tgt' : 'src';

            if (data.t === 'palette') {
                const newIndices = data.i;
                const count = newIndices.length;
                const startIdx = state.replacePairs.length;
                for (let k = 0; k < count; k++) {
                    state.replacePairs.push({ srcIdx: null, tgtIdx: null });
                    state.replacePairs[startIdx + k][targetSide + 'Idx'] = newIndices[k];
                }
                renderReplaceGrid();
            } else if (data.t === 'replace-cell' || data.t === 'replace-row') {
                // MOVE SELECTED ROWS TO END (equivalent to insert at end)
                const srcIndices = data.indices;
                const rowsMoving = srcIndices.map(idx => state.replacePairs[idx]);
                const sortedSrc = [...srcIndices].sort((a, b) => b - a);
                sortedSrc.forEach(idx => state.replacePairs.splice(idx, 1));

                const newStartIdx = state.replacePairs.length;
                state.replacePairs.push(...rowsMoving);

                state.replaceSelection.clear();
                for (let k = 0; k < rowsMoving.length; k++) state.replaceSelection.add(newStartIdx + k);
                renderReplaceGrid();
            }
        } catch (err) { console.error("Container Drop Error:", err); }
    };

    elements.replaceGrid.ondragover = onContainerDragOver;
    elements.replaceGrid.ondragleave = () => elements.replaceGrid.classList.remove('new-entry-active');
    elements.replaceGrid.ondrop = onContainerDrop;

    // Show/hide Remove Pair button based on selection
    if (elements.btnRemovePair) {
        if (state.replaceSelection.size > 0) {
            elements.btnRemovePair.style.display = 'block';
            elements.btnAddPair.style.display = 'block';
        } else {
            elements.btnRemovePair.style.display = 'none';
            elements.btnAddPair.style.display = 'block';
        }
    }
}

export function toggleReplacePanel() {
    if (!elements.panelReplace) return;
    elements.panelReplace.classList.toggle('visible');
}

export function detectConflicts() {
    const definedSources = new Set();
    const conflicts = new Array(state.replacePairs.length).fill(false);

    state.replacePairs.forEach((pair, i) => {
        if (!pair.src) return;
        const key = (pair.src.r << 16) | (pair.src.g << 8) | pair.src.b;
        if (definedSources.has(key)) conflicts[i] = true;
        definedSources.add(key);
    });
    return conflicts;
}

export function getContrastYIQ(r, g, b) {
    if (r === undefined || g === undefined || b === undefined) return '#000';
    var yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#ffffff';
}

export function updateToolSettingsUI(tool) {
    if (elements.propBrushSize) elements.propBrushSize.style.display = 'none';
    if (elements.propBrushShape) elements.propBrushShape.style.display = 'none';
    if (elements.propSquareOptions) elements.propSquareOptions.style.display = 'none';
    if (elements.propSelectionModes) elements.propSelectionModes.style.display = 'none';

    const propWandOptions = document.getElementById('prop-wand-options');
    if (propWandOptions) propWandOptions.style.display = 'none';

    const propSprayOptions = document.getElementById('prop-spray-options');
    if (propSprayOptions) propSprayOptions.style.display = 'none';

    const propFillOptions = document.getElementById('prop-fill-options');
    if (propFillOptions) propFillOptions.style.display = 'none';

    const propMovePixels = document.getElementById('prop-movePixels');
    if (propMovePixels) propMovePixels.style.display = 'none';

    if (['pencil', 'eraser', 'line', 'rect', 'spray'].includes(tool)) {
        if (elements.propBrushSize) elements.propBrushSize.style.display = 'block';
        if (elements.propBrushShape) elements.propBrushShape.style.display = 'block';
    }

    if (tool === 'rect') {
        if (elements.propSquareOptions) elements.propSquareOptions.style.display = 'block';
    }

    if (['select', 'lasso', 'wand'].includes(tool)) {
        if (elements.propSelectionModes) elements.propSelectionModes.style.display = 'block';
    }

    if (tool === 'wand') {
        if (propWandOptions) propWandOptions.style.display = 'block';
    }

    if (tool === 'spray') {
        if (propSprayOptions) propSprayOptions.style.display = 'block';
    }

    if (tool === 'fill') {
        if (propFillOptions) propFillOptions.style.display = 'block';
    }

    if (tool === 'movePixels') {
        if (propMovePixels) propMovePixels.style.display = 'block';
    }

    if (elements.propColorShift) elements.propColorShift.style.display = 'none';

    if (tool === 'colorShift') {
        if (elements.propColorShift) elements.propColorShift.style.display = 'block';
    }
}

export function triggerSelectionFlash() {
    const wasAnimating = state.selectionFlash > 0;
    state.selectionFlash = 0.8;
    if (wasAnimating) return;

    function animate() {
        if (state.selectionFlash > 0) {
            state.selectionFlash -= 0.05;
            if (state.selectionFlash < 0) state.selectionFlash = 0;
            renderOverlay();
            requestAnimationFrame(animate);

        }
    }
    animate();
}

export function copySelection() {
    const layer = getActiveLayer();
    if (!layer || !layer.visible) return;

    // Use snapshot helper to handle both regular and external SHP layers
    let dataSource = getLayerDataSnapshot(layer);
    if (!dataSource) return;

    let w = 0, h = 0, data = null, x = 0, y = 0;

    if (state.selection) {
        x = state.selection.x;
        y = state.selection.y;
        w = state.selection.w;
        h = state.selection.h;
        data = new Uint16Array(w * h);
        data.fill(TRANSPARENT_COLOR);



        // Helper to safely read
        const safeRead = (reqX, reqY) => {
            if (reqX >= 0 && reqX < state.canvasW && reqY >= 0 && reqY < state.canvasH) {
                return dataSource[reqY * state.canvasW + reqX];
            }
            return TRANSPARENT_COLOR;
        };

        if (state.selection.type === 'rect') {
            for (let sy = 0; sy < h; sy++) {
                for (let sx = 0; sx < w; sx++) {
                    data[sy * w + sx] = safeRead(x + sx, y + sy);
                }
            }
        } else if (state.selection.type === 'mask') {
            for (let sy = 0; sy < h; sy++) {
                for (let sx = 0; sx < w; sx++) {
                    if (state.selection.maskData[sy * w + sx]) {
                        data[sy * w + sx] = safeRead(x + sx, y + sy);
                    }
                }
            }
        } else {
            // Fallback
            for (let sy = 0; sy < h; sy++) {
                for (let sx = 0; sx < w; sx++) {
                    data[sy * w + sx] = safeRead(x + sx, y + sy);
                }
            }
        }
    } else {
        // Copy whole layer - use snapshot for consistency (esp. for external SHP)
        x = 0; y = 0;
        w = state.canvasW; h = state.canvasH;
        data = new Uint16Array(dataSource);
    }

    state.clipboard = {
        w, h, data, x, y,
        type: state.selection ? state.selection.type : 'rect',
        maskData: (state.selection && state.selection.maskData) ? new Uint8Array(state.selection.maskData) : null
    };
    console.log("Copied to clipboard", w, h);
    triggerSelectionFlash();

    // Export to system clipboard as PNG + Sentinel
    exportToSystemClipboard(data, w, h);
}

/**
 * Exports image data to the system clipboard as a PNG
 * Also includes a hidden text/plain sentinel for internal app detection
 */
export async function exportToSystemClipboard(indices, width, height) {
    try {
        // Create a temporary canvas to render the image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Create ImageData from palette indices
        const imageData = ctx.createImageData(width, height);
        for (let i = 0; i < indices.length; i++) {
            const paletteIdx = indices[i];
            const color = state.palette[paletteIdx] || { r: 0, g: 0, b: 0 };
            const offset = i * 4;
            imageData.data[offset] = color.r;
            imageData.data[offset + 1] = color.g;
            imageData.data[offset + 2] = color.b;
            imageData.data[offset + 3] = (paletteIdx === TRANSPARENT_COLOR) ? 0 : 255;
        }

        ctx.putImageData(imageData, 0, 0);

        // Convert canvas to blob and write to clipboard with sentinel
        canvas.toBlob(async (blob) => {
            if (blob && navigator.clipboard && navigator.clipboard.write) {
                const sentinelBlob = new Blob(["__SHP_DATA__"], { type: "text/plain" });
                try {
                    await navigator.clipboard.write([
                        new ClipboardItem({
                            'image/png': blob,
                            'text/plain': sentinelBlob
                        })
                    ]);
                    console.log('Image and sentinel copied to system clipboard');
                } catch (err) {
                    console.warn('Failed to write to system clipboard:', err);
                    // Fallback to just image if text/plain fails for some reason
                    await navigator.clipboard.write([
                        new ClipboardItem({ 'image/png': blob })
                    ]);
                }
            }
        }, 'image/png');
    } catch (err) {
        console.warn('Failed to export to system clipboard:', err);
    }
}

export function cutSelection() {
    copySelection();      // Save to clipboard first
    deleteSelection();    // Clear selection pixels and push history
}

export function pasteClipboard(newLayer = true) {
    if (!state.clipboard) return;
    const { w, h, data } = state.clipboard;
    let px = state.clipboard.x || 0;
    let py = state.clipboard.y || 0;

    // Commit any in-progress floating selection silently (its own pushHistory already done)
    if (state.floatingSelection) commitSelection();

    if (newLayer) {
        // Create layer directly (don't call addLayer() which would push a 2nd history entry)
        const frame = state.frames[state.currentFrameIdx];
        const newLayerObj = {
            type: 'layer',
            id: generateId(),
            name: 'Paste Layer',
            data: new Uint16Array(frame.width * frame.height).fill(TRANSPARENT_COLOR),
            visible: true,
            width: frame.width,
            height: frame.height,
            mask: null,
            editMask: false
        };
        frame.layers.unshift(newLayerObj);
        state.activeLayerId = newLayerObj.id;
    }

    const targetLayer = getActiveLayer();
    if (!targetLayer) return;

    const cType = state.clipboard.type || 'rect';
    const cMaskData = state.clipboard.maskData ? new Uint8Array(state.clipboard.maskData) : null;

    state.floatingSelection = {
        frameIdx: state.currentFrameIdx,
        x: px,
        y: py,
        w: w,
        h: h,
        data: new Uint16Array(data), // Clone to avoid mutation of clipboard
        originalData: new Uint16Array(data),
        originalW: w,
        originalH: h,
        type: cType,
        maskData: cMaskData,
        originalMaskData: cMaskData ? new Uint8Array(cMaskData) : null,
        targetLayerId: targetLayer.id
    };

    state.selection = {
        type: cType,
        x: px,
        y: py,
        w: w,
        h: h,
        maskData: cMaskData
    };

    // Save state AFTER paste to store the added floating selection
    pushHistory();

    startAnts();
    renderCanvas();
    updateLayersList();
    renderFramesList();
    renderOverlay();
    triggerSelectionFlash();
}

/**
 * Pastes clipboard content into a completely new frame
 */
export function pasteAsNewFrame() {
    if (!state.clipboard) return;

    // Add a new frame with current project dimensions
    addFrame(state.canvasW, state.canvasH);

    // Paste into the newly created frame's active layer (which is "Layer 1")
    pasteClipboard(false);
}

export function selectAll() {
    state.selection = {
        type: 'rect',
        x: 0, y: 0,
        w: state.canvasW, h: state.canvasH
    };
    startAnts();
    renderOverlay();
    triggerSelectionFlash();
    if (typeof updateUIState === 'function') updateUIState();
}

export function invertSelection() {
    if (!state.selection) {
        selectAll();
        return;
    }
    const w = state.canvasW;
    const h = state.canvasH;
    const newMask = new Uint8Array(w * h).fill(1); // Default all selected

    if (state.selection.type === 'rect') {
        const s = state.selection;
        for (let y = s.y; y < s.y + s.h; y++) {
            for (let x = s.x; x < s.x + s.w; x++) {
                if (x >= 0 && x < w && y >= 0 && y < h) newMask[y * w + x] = 0;
            }
        }
    } else if (state.selection.type === 'mask') {
        const s = state.selection;
        for (let y = 0; y < s.h; y++) {
            for (let x = 0; x < s.w; x++) {
                if (s.maskData[y * s.w + x]) {
                    const tx = s.x + x;
                    const ty = s.y + y;
                    if (tx >= 0 && tx < w && ty >= 0 && ty < h) newMask[ty * w + tx] = 0;
                }
            }
        }
    }
    // Check if the new mask is empty (all 0)
    const isEmpty = !newMask.some(v => v === 1);
    if (isEmpty) {
        deselect();
        return;
    }

    state.selection = {
        type: 'mask',
        x: 0, y: 0, w, h,
        maskData: newMask
    };
    renderOverlay();
    triggerSelectionFlash();
    if (typeof updateUIState === 'function') updateUIState();
}

export function togglePixelSelection(x, y) {
    if (!state.selection) {
        // Create a minimal 1x1 selection at the clicked pixel
        state.selection = {
            type: 'mask',
            x: x, y: y, w: 1, h: 1,
            maskData: new Uint8Array(1).fill(1)
        };
    } else {
        // Convert rect to mask if needed
        if (state.selection.type === 'rect') {
            const s = state.selection;
            const mask = new Uint8Array(s.w * s.h).fill(1);
            state.selection = {
                type: 'mask',
                x: s.x, y: s.y, w: s.w, h: s.h,
                maskData: mask
            };
        }

        // Toggle the pixel
        const s = state.selection;

        // Check if pixel is within current selection bounds
        if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) {
            // Pixel is within bounds, toggle it
            const localX = x - s.x;
            const localY = y - s.y;
            const idx = localY * s.w + localX;
            const oldValue = s.maskData[idx];
            s.maskData[idx] = oldValue ? 0 : 1;
        } else {
            // Pixel is outside bounds, need to expand the mask
            const newMinX = Math.min(s.x, x);
            const newMinY = Math.min(s.y, y);
            const newMaxX = Math.max(s.x + s.w - 1, x);
            const newMaxY = Math.max(s.y + s.h - 1, y);
            const newW = newMaxX - newMinX + 1;
            const newH = newMaxY - newMinY + 1;

            const newMask = new Uint8Array(newW * newH).fill(0);

            // Copy old mask data
            for (let sy = 0; sy < s.h; sy++) {
                for (let sx = 0; sx < s.w; sx++) {
                    if (s.maskData[sy * s.w + sx]) {
                        const newX = (s.x + sx) - newMinX;
                        const newY = (s.y + sy) - newMinY;
                        newMask[newY * newW + newX] = 1;
                    }
                }
            }

            // Set the new pixel
            const newX = x - newMinX;
            const newY = y - newMinY;
            newMask[newY * newW + newX] = 1;

            state.selection = {
                type: 'mask',
                x: newMinX, y: newMinY, w: newW, h: newH,
                maskData: newMask
            };
        }
    }
    renderOverlay();
}


export function startMovingSelectionPixels() {
    if (!state.selection) return;
    if (state.floatingSelection) return; // Already floating

    const layer = getActiveLayer();
    if (!layer || !layer.visible) return;

    pushHistory();

    const s = state.selection;
    const w = s.w;
    const h = s.h;

    // Extract pixel data from layer
    const floatingData = new Uint16Array(w * h).fill(TRANSPARENT_COLOR);

    if (s.type === 'rect') {
        // Extract rectangle
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const lx = s.x + x;
                const ly = s.y + y;
                if (lx >= 0 && lx < layer.width && ly >= 0 && ly < layer.height) {
                    const idx = ly * layer.width + lx;
                    floatingData[y * w + x] = layer.data[idx];
                    layer.data[idx] = TRANSPARENT_COLOR; // Clear original pixel (Void)
                }
            }
        }

        state.floatingSelection = {
            frameIdx: state.currentFrameIdx,
            x: s.x,
            y: s.y,
            w: w,
            h: h,
            data: floatingData,
            originalData: new Uint16Array(floatingData),
            originalW: w,
            originalH: h,
            type: 'rect',
            targetLayerId: layer.id
        };
    } else if (s.type === 'mask') {
        // Extract masked pixels
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (s.maskData[y * w + x]) {
                    const lx = s.x + x;
                    const ly = s.y + y;
                    if (lx >= 0 && lx < layer.width && ly >= 0 && ly < layer.height) {
                        const idx = ly * layer.width + lx;
                        floatingData[y * w + x] = layer.data[idx];
                        layer.data[idx] = TRANSPARENT_COLOR; // Clear original pixel (Void)
                    }
                }
            }
        }

        state.floatingSelection = {
            frameIdx: state.currentFrameIdx,
            x: s.x,
            y: s.y,
            w: w,
            h: h,
            data: floatingData,
            originalData: new Uint16Array(floatingData),
            originalW: w,
            originalH: h,
            maskData: s.maskData, // Keep mask for rendering
            originalMaskData: s.maskData ? new Uint8Array(s.maskData) : null,
            type: 'mask',
            targetLayerId: layer.id
        };
    }

    renderCanvas();
    updateLayersList();
    renderFramesList();
}

export function finishMovingSelectionPixels() {
    commitSelection();
}


export function commitSelection() {
    if (!state.floatingSelection) return;
    const layer = getActiveLayer();
    if (!layer) return;

    const f = state.floatingSelection;

    // Merge floating pixels back to layer
    for (let y = 0; y < f.h; y++) {
        for (let x = 0; x < f.w; x++) {
            // Check if pixel is in mask (if mask exists)
            if (f.maskData && !f.maskData[y * f.w + x]) {
                continue; // Skip pixels not in mask
            }

            const val = f.data[y * f.w + x];
            if (val !== TRANSPARENT_COLOR) {
                const tx = f.x + x;
                const ty = f.y + y;
                if (tx >= 0 && tx < layer.width && ty >= 0 && ty < layer.height) {
                    layer.data[ty * layer.width + tx] = val;
                }
            }
        }
    }

    state.floatingSelection = null;
    state.isMovingSelection = false;

    // Save state AFTER committing to capture the merged pixels
    pushHistory();

    renderCanvas();
    updateLayersList();
    renderFramesList();
}

export function clearSelection(commit = true) {
    if (commit) commitSelection();
    // If not committing, we discard floating pixels (Undo behavior?)
    // Typically clearSelection() implies committing unless specified.

    state.selection = null;
    state.floatingSelection = null; // Just in case
    renderCanvas();
    renderOverlay();
}

export function checkIfPixelSelected(x, y, selection) {
    if (!selection) return false;

    if (selection.type === 'rect') {
        return x >= selection.x && x < selection.x + selection.w &&
            y >= selection.y && y < selection.y + selection.h;
    } else if (selection.type === 'mask') {
        // Check if pixel is within mask bounds
        if (x < selection.x || x >= selection.x + selection.w ||
            y < selection.y || y >= selection.y + selection.h) {
            return false;
        }
        // Check mask data
        const localX = x - selection.x;
        const localY = y - selection.y;
        return selection.maskData[localY * selection.w + localX] === 1;
    }

    return false;
}

export function combineSelection(oldSel, newSel, mode) {
    const w = state.canvasW;
    const h = state.canvasH;

    // Helper to get pixel value (0 or 1) from ANY selection type
    const getVal = (s, x, y) => {
        if (!s) return 0;
        if (s.type === 'rect') {
            return (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) ? 1 : 0;
        } else if (s.type === 'mask') {
            // Handle Global vs Local mask
            if (s.maskData.length === w * h) {
                // Global Mask
                return s.maskData[y * w + x] ? 1 : 0;
            } else {
                // Local Mask (relative to s.x, s.y)
                const lx = x - s.x;
                const ly = y - s.y;
                if (lx >= 0 && lx < s.w && ly >= 0 && ly < s.h) {
                    return s.maskData[ly * s.w + lx] ? 1 : 0;
                }
            }
            return 0;
        }
        return 0;
    };

    // 1. Perform Global Operation & Find Bounds
    let minX = w, maxX = -1, minY = h, maxY = -1;
    const tempGlobal = new Uint8Array(w * h); // Temporarily store result globally because we need 2 passes (one to find bounds, one to copy)

    let pixelCount = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const v1 = getVal(oldSel, x, y);
            const v2 = getVal(newSel, x, y);



            let res = 0;
            if (mode === 'add') res = v1 | v2;
            else if (mode === 'sub') res = v1 & (!v2);
            else if (mode === 'int') res = v1 & v2;
            else if (mode === 'xor') res = v1 ^ v2;

            if (res) {
                tempGlobal[y * w + x] = 1;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                pixelCount++;
            }
        }
    }



    // 2. Create Result
    if (maxX === -1) {
        return null;
    } else {
        const nw = maxX - minX + 1;
        const nh = maxY - minY + 1;
        const localMask = new Uint8Array(nw * nh);

        // Copy cropped area
        for (let fy = 0; fy < nh; fy++) {
            for (let fx = 0; fx < nw; fx++) {
                if (tempGlobal[(minY + fy) * w + (minX + fx)]) {
                    localMask[fy * nw + fx] = 1;
                }
            }
        }

        const result = {
            type: 'mask',
            x: minX, y: minY, w: nw, h: nh,
            maskData: localMask
        };

        return result;
    }
}

export function updateModeButtons() {
    const mode = state.selectionMode || 'new';
    if (elements.btnSelNew) elements.btnSelNew.classList.toggle('active', mode === 'new');
    if (elements.btnSelAdd) elements.btnSelAdd.classList.toggle('active', mode === 'add');
    if (elements.btnSelSub) elements.btnSelSub.classList.toggle('active', mode === 'sub');
    if (elements.btnSelInt) elements.btnSelInt.classList.toggle('active', mode === 'int');
    if (elements.btnSelXor) elements.btnSelXor.classList.toggle('active', mode === 'xor');
}

// --- DRAG AND DROP HANDLER ---
export function handleLayerDrop(srcId, targetId, position = 'above') {
    if (!srcId || !targetId || srcId === targetId) return;

    const frame = state.frames[state.currentFrameIdx];

    // 1. Find Source
    const srcRes = findLayerParent(frame.layers, srcId);
    if (!srcRes) return;
    const { parent: srcParent, index: srcIndex } = srcRes;
    const srcNode = srcParent[srcIndex];

    // 2. Find Target
    const tgtRes = findLayerParent(frame.layers, targetId);
    if (!tgtRes) return;
    const { parent: tgtParent, index: tgtIndex } = tgtRes;
    const tgtNode = tgtParent[tgtIndex];

    // 3. Validation: Circular Dependency
    if (srcNode.children) {
        function isChild(parent, id) {
            if (!parent.children) return false;
            for (let c of parent.children) {
                if (c.id === id) return true;
                if (isChild(c, id)) return true;
            }
            return false;
        }
        if (isChild(srcNode, targetId)) {
            alert("Cannot move a group inside itself.");
            return;
        }
    }

    pushHistory();

    // 4. Remove Source
    srcParent.splice(srcIndex, 1);

    // 5. Calculate New Parent and Index
    let finalParent = tgtParent;
    let finalIndex = tgtIndex;

    // Recalculate target index if it was in the same parent as source
    if (srcParent === tgtParent && srcIndex < tgtIndex) {
        finalIndex--;
    }

    if (position === 'inside' && tgtNode.type === 'group') {
        finalParent = tgtNode.children;
        finalIndex = 0; // Top of group
        tgtNode.expanded = true;
    } else if (position === 'below') {
        finalIndex++;
    }

    // 6. Insert Source
    finalParent.splice(finalIndex, 0, srcNode);

    state.activeLayerId = srcNode.id;
    updateLayersList();
    renderCanvas();
}



export function findLayerParent(layers, id, parentNode = null) {
    for (let i = 0; i < layers.length; i++) {
        if (layers[i].id === id) return { parent: layers, index: i, parentObj: parentNode };
        if (layers[i].children) {
            const res = findLayerParent(layers[i].children, id, layers[i]);
            if (res) return res;
        }
    }
    return null;
}

/**
 * Returns a flat list of all layers/groups in order (Deep-first)
 */
export function getFlatLayers(layers, result = []) {
    for (const l of layers) {
        result.push(l);
        if (l.children) getFlatLayers(l.children, result);
    }
    return result;
}

/**
 * Persists the layer selection by index when switching frames.
 * Uses a Hybrid approach: per-frame memory with global inheritance fallback.
 */
export function syncLayerSelection() {
    const currentFrame = state.frames[state.currentFrameIdx];
    if (!currentFrame) return;

    const currentFlat = getFlatLayers(currentFrame.layers);
    if (currentFlat.length === 0) return;

    // Determine intended index
    let intendedIdx = state.preferredLayerIdx; // Fallback: Global Intent
    if (currentFrame.lastSelectedIdx !== undefined && currentFrame.lastSelectedIdx !== -1) {
        intendedIdx = currentFrame.lastSelectedIdx; // Preference: Per-frame Memory
    }

    // Apply index (clamped to current frame)
    const targetIdx = Math.max(0, Math.min(intendedIdx, currentFlat.length - 1));
    state.activeLayerId = currentFlat[targetIdx].id;
}

export function getNextLayerName(layers) {
    const existing = new Set();
    const collect = (list) => {
        list.forEach(l => {
            existing.add(l.name);
            if (l.children) collect(l.children);
        });
    };
    collect(layers);

    let i = 1;
    while (existing.has(`Layer ${i} `)) i++;
    return `Layer ${i} `;
}

export function getNextGroupName(layers) {
    const existing = new Set();
    const collect = (list) => {
        list.forEach(l => {
            if (l.type === 'group') existing.add(l.name);
            if (l.children) collect(l.children);
        });
    };
    collect(layers);

    let i = 1;
    while (existing.has(`Group ${i}`)) i++;
    return `Group ${i}`;
}

export function getNextDuplicateName(existingNames, originalName) {
    const match = originalName.match(/^(.*) - (\d+)$/);
    let base = originalName;
    if (match) {
        base = match[1];
    }

    const appender = " - (\\d+)$";
    const regex = new RegExp("^" + escapeRegExp(base) + appender);
    let max = 1;

    existingNames.forEach(n => {
        const m = n.match(regex);
        if (m) max = Math.max(max, parseInt(m[1]));
    });

    return base + " - " + (max + 1);
}

export function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function nestLayer(source, target) {
    if (!source) return;
    pushHistory();

    const frame = state.frames[state.currentFrameIdx];

    if (source.clipped) {
        // UNCLIP: Move out of parent back to sibling list
        const res = findLayerParent(frame.layers, source.id);
        if (res && res.parentObj) {
            const parentNode = res.parentObj;
            const parentRes = findLayerParent(frame.layers, parentNode.id);
            if (parentRes) {
                // Remove from children
                res.parent.splice(res.index, 1);
                // Insert into grandparent (parentRes.parent) above parentNode
                parentRes.parent.splice(parentRes.index, 0, source);
                source.clipped = false;
            }
        }
    } else {
        // CLIP: Move into target
        if (!target) return;
        const srcRes = findLayerParent(frame.layers, source.id);
        const tgtRes = findLayerParent(frame.layers, target.id);

        if (!srcRes || !tgtRes || srcRes.parent !== tgtRes.parent) return;

        // Remove from current parent
        srcRes.parent.splice(srcRes.index, 1);

        // Target index might have shifted if source was before it
        const newTgtRes = findLayerParent(frame.layers, target.id);
        const actualTarget = newTgtRes.parent[newTgtRes.index];

        if (!actualTarget.children) actualTarget.children = [];
        // Insert at TOP of children (index 0) so it's "above" in stack
        actualTarget.children.unshift(source);
        actualTarget.expanded = true;
        source.clipped = true;
    }

    updateLayersList();
    renderCanvas();
}

export function initPanelResizing() {
    const resizer = elements.panelRightResizer;
    const panel = elements.panelRight;
    const verticalResizer = document.getElementById('panelVerticalResizer');
    const layersContainer = document.getElementById('layersContainer');
    const framesContainer = document.getElementById('framesContainer');

    if (!resizer || !panel) return;

    let isResizing = false;
    let isResizingVertical = false;

    // Horizontal Resizer
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    // Vertical Resizer
    if (verticalResizer && layersContainer && framesContainer) {
        verticalResizer.addEventListener('mousedown', (e) => {
            isResizingVertical = true;
            verticalResizer.classList.add('dragging');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });
    }

    window.addEventListener('mousemove', (e) => {
        if (isResizing) {
            const containerWidth = document.body.clientWidth;
            const newWidth = containerWidth - e.clientX;
            const finalWidth = Math.min(600, Math.max(305, newWidth)); // Updated limits
            panel.style.width = finalWidth + 'px';
        }

        if (isResizingVertical && layersContainer && framesContainer) {
            const panelRect = panel.getBoundingClientRect();
            // Calculate height from the mouse position to the bottom of the panel
            const newLayersHeight = panelRect.bottom - e.clientY;

            // Constrain heights to respect min heights
            const minLayersHeight = 100;
            const minFramesHeight = 100;
            // Total available height inside the panel to be shared:
            const totalAvailableHeight = panelRect.height;

            let finalHeight = Math.max(minLayersHeight, newLayersHeight);
            if (totalAvailableHeight - finalHeight < minFramesHeight) {
                finalHeight = totalAvailableHeight - minFramesHeight;
            }

            layersContainer.style.height = finalHeight + 'px';
            layersContainer.style.flex = 'none'; // Ensure flex layout does not override explicit height
        }
    });

    window.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('dragging');
        }
        if (isResizingVertical) {
            isResizingVertical = false;
            if (verticalResizer) verticalResizer.classList.remove('dragging');
        }
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
}

export function showEditorInterface() {
    const panel = elements.panelRight;
    if (panel) {
        panel.style.display = 'flex';
        // Force layout update
        initPanelResizing();
    }
}

// --- FRAME MANAGER ---
export let fmSelection = new Set();
export let fmLastClickedIdx = null;
export let fmNewSelection = new Set();
export let fmLastClickedNewIdx = null;
export let fmClipboardVals = null; // Array of frame objects
export let fmClipboardIsPairs = false; // Whether the clipboard contains grouped pair objects
export let fmDragSelection = null;

// Helper to get indices, synchronized by pairs if in 'Modo parejas'
export function fmGetSelectedIndices() {
    let indices = Array.from(fmSelection);
    if (state.fmViewMode === 'pair-strip' && state.frames.length > 0) {
        const temp = new Set();
        const half = Math.ceil(state.frames.length / 2);
        indices.forEach(idx => {
            if (idx < half) {
                temp.add(idx);
                if (idx + half < state.frames.length) temp.add(idx + half);
            } else {
                temp.add(idx - half);
                temp.add(idx);
            }
        });
        indices = Array.from(temp);
    }
    return indices.sort((a, b) => a - b);
}

export function fmNewGetSelectedIndices() {
    let indices = Array.from(fmNewSelection);
    if (state.fmViewMode === 'pair-strip' && state.fmNewFrames.length > 0) {
        const temp = new Set();
        const half = Math.ceil(state.fmNewFrames.length / 2);
        indices.forEach(idx => {
            if (idx < half) {
                temp.add(idx);
                if (idx + half < state.fmNewFrames.length) temp.add(idx + half);
            } else {
                temp.add(idx - half);
                temp.add(idx);
            }
        });
        indices = Array.from(temp);
    }
    return indices.sort((a, b) => a - b);
}

export function fmGetPairs(frames = state.frames) {
    const half = Math.ceil(frames.length / 2);
    const pairs = [];
    for (let i = 0; i < half; i++) {
        pairs.push({
            normal: frames[i],
            shadow: frames[i + half] || null
        });
    }
    return pairs;
}

/**
 * Returns true when FM operations should treat frames as pairs.
 * This is the case in pair-strip mode, OR when Merge View is active
 * (shadows + relIndex enabled).
 */
export function fmIsPairLogic(frames = state.frames) {
    if (!state.useShadows || frames.length === 0 || frames.length % 2 !== 0) return false;
    if (state.fmViewMode === 'pair-strip') return true;
    const cbMergeView = document.getElementById('fmCbMergeView');
    return cbMergeView ? cbMergeView.checked : false;
}

export function fmSetPairs(pairs, sectionId = 'original') {
    const normals = pairs.map(p => p.normal);
    const shadows = pairs.map(p => p.shadow).filter(s => s !== null);
    const combined = [...normals, ...shadows];
    if (sectionId === 'original') state.frames = combined;
    else state.fmNewFrames = combined;
}

// --- Composite Data Cache for Thumbnails ---
const _compositeCache = new WeakMap();

function _getCachedComposite(frame, options = {}) {
    const isCurrentFrame = state.frames[state.currentFrameIdx] === frame;
    // Cache key must include all factors that affect the composite output
    const cacheKey = `${frame._v || 0}_${state.paletteVersion}_${options.showIndex0 !== undefined ? options.showIndex0 : true}_${options.showOnlyBackground || false}_${isCurrentFrame && state.floatingSelection ? 'fs' : 'nofs'}_${options.includeExternalShp ? 'ext' : 'noext'}`;

    let entry = _compositeCache.get(frame);
    if (!options.visualData && entry && entry.key === cacheKey) {
        return entry.data;
    }

    // Prepare an alpha buffer if we're doing a full composite (needed for renderCanvas)
    const alphaBuffer = new Uint8Array(frame.width * frame.height).fill(255);
    const compositeData = compositeFrame(frame, {
        transparentIdx: TRANSPARENT_COLOR,
        floatingSelection: isCurrentFrame ? state.floatingSelection : null,
        showIndex0: options.showIndex0 !== undefined ? options.showIndex0 : true,
        backgroundIdx: options.backgroundIdx !== undefined ? options.backgroundIdx : TRANSPARENT_COLOR,
        isShadow: options.isShadow || false,
        alphaBuffer: alphaBuffer,
        includeExternalShp: options.includeExternalShp || false,
        visualData: options.visualData || null,
        palette: options.palette || state.palette,
        substitutionMap: options.substitutionMap || null,
        affectedIndices: options.affectedIndices || null,
        remapBase: options.remapBase || null
    });

    const result = {
        pixels: compositeData,
        alpha: alphaBuffer
    };

    if (!options.visualData) {
        _compositeCache.set(frame, { key: cacheKey, data: result });
    }
    return result;
}

export function createFrameThumbnail(frame, w = 120, h = 90, options = {}) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');

    if (!frame || !frame.layers) return c;

    // Use cached composite data when possible
    const cached = _getCachedComposite(frame, options);
    const compositeData = cached.pixels;

    const frameW = frame.width;
    const frameH = frame.height;

    // Reduced padding from 20 to 8 to achieve ~4px distance from edges as requested
    const pad = 8;
    const scale = Math.min((w - pad) / frameW, (h - pad) / frameH);
    const drawW = frameW * scale;
    const drawH = frameH * scale;

    const offsetX = (w - drawW) / 2;
    const offsetY = (h - drawH) / 2;

    const id = ctx.createImageData(w, h);
    const d = id.data;
    const d32 = new Uint32Array(d.buffer); // Use 32-bit writes for speed

    const actualTransparent = state.isAlphaImageMode ? 127 : 0;
    const show0 = options.showIndex0 !== undefined ? options.showIndex0 : true;
    const showOnlyBg = !!options.showOnlyBackground;

    // Pre-build palette lookup (RGBA packed as 32-bit) — avoids per-pixel object lookups
    const palLUT = new Uint32Array(256);
    const isLE = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;
    for (let i = 0; i < 256; i++) {
        const c = state.palette[i];
        if (c) {
            if (isLE) {
                palLUT[i] = (255 << 24) | (c.b << 16) | (c.g << 8) | c.r;
            } else {
                palLUT[i] = (c.r << 24) | (c.g << 16) | (c.b << 8) | 255;
            }
        }
    }

    const bgPacked = (show0 && state.palette[actualTransparent]) ? palLUT[actualTransparent] : 0;
    const invScale = 1 / scale;

    for (let py = 0; py < h; py++) {
        const ly = Math.floor((py - offsetY) * invScale);
        if (ly < 0 || ly >= frameH) continue; // Entire row is outside frame
        const rowBase = ly * frameW;
        const outRowBase = py * w;

        for (let px = 0; px < w; px++) {
            const lx = Math.floor((px - offsetX) * invScale);
            if (lx < 0 || lx >= frameW) continue;

            const outIdx = outRowBase + px;

            // Start with background
            if (bgPacked) d32[outIdx] = bgPacked;

            if (!showOnlyBg) {
                const colorIdx = compositeData[rowBase + lx];
                if (colorIdx !== TRANSPARENT_COLOR) {
                    if (colorIdx === actualTransparent && !show0) continue;
                    if (palLUT[colorIdx]) {
                        d32[outIdx] = palLUT[colorIdx];
                    } else {
                        // Fallback for missing palette entry
                        const off = outIdx * 4;
                        d[off] = 0; d[off + 1] = 0; d[off + 2] = 0; d[off + 3] = 255;
                    }
                }
            }
        }
    }

    ctx.putImageData(id, 0, 0);
    return c;
}

/**
 * Helper to get all frame indices for history optimization.
 * Used when Frame Manager operations modify all frames (e.g., Add, Delete, Paste)
 */
export function getAllFrameIndices() {
    return Array.from({ length: state.frames.length }, (_, i) => i);
}

export function initFrameManager() {
    const dialog = document.getElementById('frameManagerDialog');
    if (!dialog) return;

    const closeBtn = document.getElementById('btnFmClose');
    if (closeBtn) closeBtn.onclick = () => dialog.close();

    const selAll = document.getElementById('btnFmSelAll');
    if (selAll) selAll.onclick = () => {
        const activeSection = state.fmActiveSection || 'original';
        if (activeSection === 'original') {
            fmSelection = new Set(state.frames.map((_, i) => i));
        } else {
            fmNewSelection = new Set(state.fmNewFrames.map((_, i) => i));
        }
        renderFrameManager();
        updateFrameManagerButtonStates();
    };

    const selNone = document.getElementById('btnFmSelNone');
    if (selNone) selNone.onclick = () => {
        const activeSection = state.fmActiveSection || 'original';
        if (activeSection === 'original') fmSelection.clear();
        else fmNewSelection.clear();
        renderFrameManager();
        updateFrameManagerButtonStates();
    };

    const selInv = document.getElementById('btnFmSelInv');
    if (selInv) selInv.onclick = () => {
        const activeSection = state.fmActiveSection || 'original';
        if (activeSection === 'original') {
            const newSel = new Set();
            state.frames.forEach((_, i) => { if (!fmSelection.has(i)) newSel.add(i); });
            fmSelection = newSel;
        } else {
            const newSel = new Set();
            state.fmNewFrames.forEach((_, i) => { if (!fmNewSelection.has(i)) newSel.add(i); });
            fmNewSelection = newSel;
        }
        renderFrameManager();
        updateFrameManagerButtonStates();
    };

    const btnDel = document.getElementById('btnFmDel');
    if (btnDel) btnDel.onclick = async () => {
        const activeSection = state.fmActiveSection || 'original';
        const frames = activeSection === 'original' ? state.frames : state.fmNewFrames;
        const selection = activeSection === 'original' ? fmSelection : fmNewSelection;

        if (selection.size === 0) return;

        let title = "";
        let message = "";
        if (selection.size === 1) {
            title = `ARE YOU SURE YOU WANT TO DELETE FRAME ${Array.from(selection)[0]}?`;
        } else {
            const sortedIndices = Array.from(selection).sort((a, b) => a - b);
            title = `ARE YOU SURE YOU WANT TO DELETE THE ${selection.size} SELECTED FRAMES?`;
            message = `Indices affected: ${sortedIndices.join(', ')}`;
        }

        const confirmed = await showConfirm(title, message);
        if (!confirmed) return;

        // Identify frames to delete for history optimization (only for original)
        if (activeSection === 'original') {
            let framesToDelete = [];
            if (fmIsPairLogic()) {
                const pairs = fmGetPairs(frames);
                const half = pairs.length;
                const pairIndicesToDelete = new Set(Array.from(fmSelection).map(i => i < half ? i : i - half));
                if (pairIndicesToDelete.size === pairs.length) { await showAlert("CANNOT DELETE", "At least one frame must remain."); return; }
                pairIndicesToDelete.forEach(pairIdx => { framesToDelete.push(pairIdx); framesToDelete.push(pairIdx + half); });
            } else {
                const indices = fmGetSelectedIndices().sort((a, b) => a - b);
                if (indices.length === state.frames.length) { await showAlert("CANNOT DELETE", "At least one frame must remain."); return; }
                framesToDelete = indices;
            }
            pushHistory(framesToDelete);
        }

        if (fmIsPairLogic(frames)) {
            const pairs = fmGetPairs(frames);
            const half = pairs.length;
            const pIdxs = new Set(Array.from(selection).map(i => i < half ? i : i - half));
            const sortedDesc = Array.from(pIdxs).sort((a, b) => b - a);
            sortedDesc.forEach(idx => pairs.splice(idx, 1));
            fmSetPairs(pairs, activeSection);
        } else {
            const indices = (activeSection === 'original' ? fmGetSelectedIndices() : fmNewGetSelectedIndices()).sort((a, b) => b - a);
            indices.forEach(idx => frames.splice(idx, 1));
        }

        if (activeSection === 'original') {
            state.currentFrameIdx = 0;
            syncLayerSelection();
            renderCanvas();
            renderFramesList();
            updateLayersList();
        }
        selection.clear();
        renderFrameManager();
    };

    const btnAdd = document.getElementById('btnFmAdd');
    if (btnAdd) btnAdd.onclick = () => {
        const w = state.canvasW;
        const h = state.canvasH;
        const createFrameObj = () => ({
            width: w,
            height: h,
            lastSelectedIdx: -1,
            layers: [
                {
                    type: 'layer',
                    id: generateId(),
                    name: "Layer 1",
                    visible: true,
                    width: w,
                    height: h,
                    data: new Uint16Array(w * h).fill(TRANSPARENT_COLOR),
                    mask: null,
                    editMask: false
                }
            ]
        });

        const activeSection = state.fmActiveSection || 'original';
        const frames = activeSection === 'original' ? state.frames : state.fmNewFrames;
        const selection = activeSection === 'original' ? fmSelection : fmNewSelection;

        const isPairMode = fmIsPairLogic(frames);
        const hadSelection = selection.size > 0;

        if (activeSection === 'original') pushHistory([]);

        if (isPairMode) {
            const pairs = fmGetPairs(frames);
            const half = pairs.length;

            const selIndices = Array.from(selection).map(i => i < half ? i : i - half);
            let insertIdx = (selIndices.length > 0) ? Math.max(...selIndices) + 1 : pairs.length;

            const newNormal = createFrameObj();
            const newShadow = createFrameObj();

            pairs.splice(insertIdx, 0, {
                normal: newNormal,
                shadow: newShadow
            });

            fmSetPairs(pairs, activeSection);

            state.currentFrameIdx = insertIdx;

            const newHalf = pairs.length;
            selection.clear();
            selection.add(insertIdx);
            selection.add(insertIdx + newHalf);
        } else {
            let insertIdx = frames.length;
            if (hadSelection) {
                insertIdx = Math.max(...selection) + 1;
            }
            frames.splice(insertIdx, 0, createFrameObj());
            state.currentFrameIdx = insertIdx;

            if (hadSelection) {
                selection.clear();
                selection.add(insertIdx);
            }
        }

        renderFrameManager();
        renderCanvas();
        renderFramesList();
        updateLayersList();
        if (typeof updateUIState === 'function') updateUIState();
    };

    const btnDup = document.getElementById('btnFmDup');
    if (btnDup) btnDup.onclick = () => {
        const activeSection = state.fmActiveSection || 'original';
        const frames = activeSection === 'original' ? state.frames : state.fmNewFrames;
        const selection = activeSection === 'original' ? fmSelection : fmNewSelection;

        if (selection.size === 0) return;
        if (activeSection === 'original') pushHistory([]);

        const regenIds = (layers) => {
            layers.forEach(l => {
                l.id = generateId();
                if (l.children) regenIds(l.children);
            });
        };

        if (fmIsPairLogic(frames)) {
            const pairs = fmGetPairs(frames);
            const half = pairs.length;
            const selPairIndices = Array.from(new Set(Array.from(selection).map(i => i < half ? i : i - half))).sort((a, b) => a - b);
            const insertIdx = selPairIndices[0];

            const dups = selPairIndices.map(i => {
                const orig = pairs[i];
                const p = {
                    normal: { ...orig.normal, layers: orig.normal.layers.map(l => cloneLayerNode(l)) }
                };
                if (orig.shadow) {
                    p.shadow = { ...orig.shadow, layers: orig.shadow.layers.map(l => cloneLayerNode(l)) };
                }

                regenIds(p.normal.layers);
                if (p.shadow) regenIds(p.shadow.layers);
                return p;
            });

            pairs.splice(insertIdx, 0, ...dups);
            if (activeSection === 'original') {
                fmSetPairs(pairs, 'original');
                const newHalf = pairs.length;
                fmSelection.clear();
                for (let i = 0; i < dups.length; i++) { fmSelection.add(insertIdx + i); fmSelection.add(insertIdx + i + newHalf); }
            } else {
                fmSetPairs(pairs, 'new');
                const newHalf = pairs.length;
                fmNewSelection.clear();
                for (let i = 0; i < dups.length; i++) { fmNewSelection.add(insertIdx + i); fmNewSelection.add(insertIdx + i + newHalf); }
            }
        } else {
            const indices = (activeSection === 'original' ? fmGetSelectedIndices() : fmNewGetSelectedIndices()).sort((a, b) => a - b);
            const targetIdx = indices[0];
            const newFrames = indices.map(idx => {
                const orig = frames[idx];
                const clone = { ...orig, layers: orig.layers.map(l => cloneLayerNode(l)) };
                regenIds(clone.layers);
                return clone;
            });
            frames.splice(targetIdx, 0, ...newFrames);
            selection.clear();
            for (let i = 0; i < newFrames.length; i++) selection.add(targetIdx + i);
        }

        renderFrameManager();
        if (activeSection === 'original') renderFramesList();
    };

    // --- FM Split Resizer Logic ---
    const fmResizer = document.getElementById('fmSplitResizer');
    const fmColOrig = document.getElementById('fmSplitColOrig');
    const fmColNew = document.getElementById('fmSplitColNew');
    let isResizingFm = false;

    if (fmResizer && fmColOrig && fmColNew) {
        fmResizer.addEventListener('mousedown', (e) => {
            isResizingFm = true;
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
            fmResizer.classList.add('dragging');
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isResizingFm) return;
            const container = document.getElementById('fmSplitPanel');
            if (!container) return;
            const rect = container.getBoundingClientRect();
            let ratio = (e.clientX - rect.left) / rect.width;
            ratio = Math.max(0.25, Math.min(0.75, ratio)); // 25% min, 75% max
            state.fmSplitRatio = ratio;

            fmColOrig.style.flex = ratio;
            fmColNew.style.flex = 1 - ratio;
        });

        window.addEventListener('mouseup', () => {
            if (isResizingFm) {
                isResizingFm = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                fmResizer.classList.remove('dragging');
            }
        });
    }

    const btnCut = document.getElementById('btnFmCut');
    if (btnCut) btnCut.onclick = async () => {
        const activeSection = state.fmActiveSection || 'original';
        const frames = activeSection === 'original' ? state.frames : state.fmNewFrames;
        const selection = activeSection === 'original' ? fmSelection : fmNewSelection;

        if (selection.size === 0) return;

        // Copy to clipboard first
        if (fmIsPairLogic(frames)) {
            const pairs = fmGetPairs(frames);
            const half = pairs.length;
            const pairIndices = new Set(Array.from(selection).map(i => i < half ? i : i - half));
            const sortedIndices = Array.from(pairIndices).sort((a, b) => a - b);
            fmClipboardVals = sortedIndices.map(i => {
                const orig = pairs[i];
                const p = { normal: { ...orig.normal, layers: orig.normal.layers.map(l => cloneLayerNode(l)) } };
                if (orig.shadow) p.shadow = { ...orig.shadow, layers: orig.shadow.layers.map(l => cloneLayerNode(l)) };
                return p;
            });
            fmClipboardIsPairs = true;
        } else {
            const indices = (activeSection === 'original' ? fmGetSelectedIndices() : fmNewGetSelectedIndices()).sort((a, b) => a - b);
            fmClipboardVals = indices.map(i => {
                const orig = frames[i];
                return { ...orig, layers: orig.layers.map(l => cloneLayerNode(l)) };
            });
            fmClipboardIsPairs = false;
        }

        // History and removal logic
        if (activeSection === 'original') {
            let framesToCut = [];
            if (fmIsPairLogic()) {
                const half = Math.ceil(state.frames.length / 2);
                const pIdxs = new Set(Array.from(fmSelection).map(i => i < half ? i : i - half));
                if (pIdxs.size === half) { await showAlert("CANNOT CUT", "One frame must remain."); return; }
                pIdxs.forEach(pi => { framesToCut.push(pi); framesToCut.push(pi + half); });
            } else {
                const idxs = fmGetSelectedIndices().sort((a, b) => a - b);
                if (idxs.length === state.frames.length) { await showAlert("CANNOT CUT", "One frame must remain."); return; }
                framesToCut = idxs;
            }
            pushHistory(framesToCut);
        }

        if (fmIsPairLogic(frames)) {
            const pairs = fmGetPairs(frames);
            const half = pairs.length;
            const pIdxs = new Set(Array.from(selection).map(i => i < half ? i : i - half));
            const sortedDesc = Array.from(pIdxs).sort((a, b) => b - a);
            sortedDesc.forEach(idx => pairs.splice(idx, 1));
            fmSetPairs(pairs, activeSection);
        } else {
            const idxs = (activeSection === 'original' ? fmGetSelectedIndices() : fmNewGetSelectedIndices()).sort((a, b) => b - a);
            idxs.forEach(i => frames.splice(i, 1));
        }

        if (activeSection === 'original') {
            state.currentFrameIdx = 0;
            syncLayerSelection();
            renderCanvas();
            renderFramesList();
            updateLayersList();
        }
        selection.clear();
        renderFrameManager();
    };

    const btnCopy = document.getElementById('btnFmCopy');
    if (btnCopy) btnCopy.onclick = () => {
        const activeSection = state.fmActiveSection || 'original';
        const frames = activeSection === 'original' ? state.frames : state.fmNewFrames;
        const selection = activeSection === 'original' ? fmSelection : fmNewSelection;

        if (selection.size === 0) return;

        if (fmIsPairLogic(frames)) {
            const pairs = fmGetPairs(frames);
            const half = pairs.length;
            const pairIndices = new Set(Array.from(selection).map(i => i < half ? i : i - half));
            const sortedIndices = Array.from(pairIndices).sort((a, b) => a - b);
            fmClipboardVals = sortedIndices.map(i => {
                const orig = pairs[i];
                const p = { normal: { ...orig.normal, layers: orig.normal.layers.map(l => cloneLayerNode(l)) } };
                if (orig.shadow) p.shadow = { ...orig.shadow, layers: orig.shadow.layers.map(l => cloneLayerNode(l)) };
                return p;
            });
            fmClipboardIsPairs = true;
        } else {
            const indices = (activeSection === 'original' ? fmGetSelectedIndices() : fmNewGetSelectedIndices()).sort((a, b) => a - b);
            fmClipboardVals = indices.map(i => {
                const orig = frames[i];
                return { ...orig, layers: orig.layers.map(l => cloneLayerNode(l)) };
            });
            fmClipboardIsPairs = false;
        }
        updateFrameManagerButtonStates();
    };

    const btnPaste = document.getElementById('btnFmPaste');
    if (btnPaste) btnPaste.onclick = () => {
        if (!fmClipboardVals || fmClipboardVals.length === 0) return;
        const activeSection = state.fmActiveSection || 'original';
        const targetList = activeSection === 'original' ? state.frames : state.fmNewFrames;
        const targetSelection = activeSection === 'original' ? fmSelection : fmNewSelection;

        if (activeSection === 'original') pushHistory([]);

        const regenIds = (layers) => {
            layers.forEach(l => {
                l.id = generateId();
                if (l.children) regenIds(l.children);
            });
        };

        const createBlankFrame = () => ({
            width: state.canvasW,
            height: state.canvasH,
            layers: [{
                type: 'layer', id: generateId(), name: "Shadow Layer", visible: true,
                width: state.canvasW, height: state.canvasH,
                data: new Uint16Array(state.canvasW * state.canvasH).fill(TRANSPARENT_COLOR),
                mask: null, editMask: false
            }]
        });

        if (fmIsPairLogic(targetList)) {
            const pairs = fmGetPairs(targetList);
            const half = pairs.length;
            let insertIdx = (targetSelection.size > 0) ? Math.min(...Array.from(targetSelection).map(i => i < half ? i : i - half)) : pairs.length;

            let pastedPairs = [];
            if (fmClipboardIsPairs) {
                pastedPairs = fmClipboardVals.map(p => {
                    const clone = { normal: { ...p.normal, layers: p.normal.layers.map(l => cloneLayerNode(l)) } };
                    if (p.shadow) clone.shadow = { ...p.shadow, layers: p.shadow.layers.map(l => cloneLayerNode(l)) };
                    regenIds(clone.normal.layers);
                    if (clone.shadow) regenIds(clone.shadow.layers);
                    return clone;
                });
            } else {
                pastedPairs = fmClipboardVals.map(f => {
                    const clone = { ...f, layers: f.layers.map(l => cloneLayerNode(l)) };
                    regenIds(clone.layers);
                    return { normal: clone, shadow: createBlankFrame() };
                });
            }

            pairs.splice(insertIdx, 0, ...pastedPairs);
            fmSetPairs(pairs, activeSection);

            const newHalf = pairs.length;
            targetSelection.clear();
            for (let i = 0; i < pastedPairs.length; i++) {
                targetSelection.add(insertIdx + i);
                targetSelection.add(insertIdx + i + newHalf);
            }
        } else {
            let targetIdx = targetSelection.size > 0 ? Math.min(...targetSelection) : targetList.length;
            let pastedFrames = [];
            if (fmClipboardIsPairs) {
                fmClipboardVals.forEach(p => {
                    const n = { ...p.normal, layers: p.normal.layers.map(l => cloneLayerNode(l)) };
                    regenIds(n.layers);
                    pastedFrames.push(n);
                    if (p.shadow) {
                        const s = { ...p.shadow, layers: p.shadow.layers.map(l => cloneLayerNode(l)) };
                        regenIds(s.layers);
                        pastedFrames.push(s);
                    }
                });
            } else {
                pastedFrames = fmClipboardVals.map(f => {
                    const clone = { ...f, layers: f.layers.map(l => cloneLayerNode(l)) };
                    regenIds(clone.layers);
                    return clone;
                });
            }
            targetList.splice(targetIdx, 0, ...pastedFrames);
            targetSelection.clear();
            for (let i = 0; i < pastedFrames.length; i++) targetSelection.add(targetIdx + i);
        }

        renderFrameManager();
        if (activeSection === 'original') {
            renderFramesList();
            renderCanvas();
            if (typeof updateUIState === 'function') updateUIState();
        }
        updateFrameManagerButtonStates();
    };

    // Move Buttons (Shift selection up/down)
    const btnMoveBack = document.getElementById('btnFmMoveBack');
    if (btnMoveBack) btnMoveBack.onclick = () => moveSelectedFrames(-1);

    const btnMoveFwd = document.getElementById('btnFmMoveFwd');
    if (btnMoveFwd) btnMoveFwd.onclick = () => moveSelectedFrames(1);

    const btnInvert = document.getElementById('btnFmInvert');
    if (btnInvert) btnInvert.onclick = () => invertSelectedFrames();

    // Open Handler
    const btnOpen = document.getElementById('btnFrameMgr');
    if (btnOpen) {
        btnOpen.onclick = () => {
            openFrameManager();
        };
    }

    // View Switchers
    const btnMosaic = document.getElementById('btnFmViewMosaic');
    const btnStrip = document.getElementById('btnFmViewStrip');
    const btnPairStrip = document.getElementById('btnFmViewPairStrip');
    if (btnMosaic) {
        btnMosaic.onclick = () => {
            state.fmViewMode = 'mosaic';
            renderFrameManager();
        };
    }
    if (btnStrip) {
        btnStrip.onclick = () => {
            state.fmViewMode = 'strip';
            renderFrameManager();
        };
    }
    if (btnPairStrip) {
        btnPairStrip.onclick = () => {
            state.fmViewMode = 'pair-strip';
            renderFrameManager();
        };
    }

    // Merge View Toggle
    const cbMergeView = document.getElementById('fmCbMergeView');
    if (cbMergeView) {
        cbMergeView.onchange = () => {
            renderFrameManager();
        };
    }

    // Relative Index Toggle
    const cbRelIndex = document.getElementById('fmCbRelIndex');
    if (cbRelIndex) {
        cbRelIndex.onchange = (e) => {
            state.fmRelIndex = e.target.checked;
            renderFrameManager();
        };
    }

    // Shadows sync
    const fmCbShadows = document.getElementById('fmCbUseShadows');
    if (fmCbShadows) {
        fmCbShadows.onchange = (e) => {
            state.useShadows = e.target.checked;
            // Sync main UI checkbox
            const mainCb = document.getElementById('cbUseShadows');
            if (mainCb) mainCb.checked = state.useShadows;

            // Trigger standard shadows logic if needed (matching main.js)
            if (state.useShadows && state.primaryColorIdx > 1) {
                state.primaryColorIdx = 1;
                if (typeof renderPalette === 'function') renderPalette();
            }

            const relContainer = document.getElementById('fmRelIndexContainer');
            if (relContainer) relContainer.style.display = state.useShadows ? 'flex' : 'none';

            renderFrameManager();
        };
    }

    // Split File Button
    const btnSplit = document.getElementById('btnFmSplit');
    if (btnSplit) {
        btnSplit.onclick = () => {
            state.fmSplitActive = !state.fmSplitActive;
            if (state.fmSplitActive && !state.fmActiveSection) {
                state.fmActiveSection = 'original';
            }
            renderFrameManager();
        };
    }

    // --- Dual Panel Focus and Drag Support ---
    const gridOrig = document.getElementById('fmGridOrig');
    const gridNew = document.getElementById('fmGridNew');

    const handleGridFocus = (sectionId) => {
        state.fmActiveSection = sectionId;
        if (sectionId === 'original') fmNewSelection.clear();
        else fmSelection.clear();
        renderFrameManager();
    };

    if (gridOrig) {
        gridOrig.onclick = (e) => { if (e.target === gridOrig) handleGridFocus('original'); };
        gridOrig.ondragover = (e) => {
            if (e.dataTransfer.types.includes('application/json')) {
                e.preventDefault();
                gridOrig.classList.add('fm-grid-dragover');
            }
        };
        gridOrig.ondragleave = () => gridOrig.classList.remove('fm-grid-dragover');
        gridOrig.ondrop = (e) => {
            gridOrig.classList.remove('fm-grid-dragover');
            try {
                const data = JSON.parse(e.dataTransfer.getData('application/json'));
                if (data && data.sourceSection !== 'original') {
                    moveFramesToCombined(data.indices, data.sourceSection, state.frames.length, 'original');
                }
            } catch (err) { }
        };
    }

    if (gridNew) {
        gridNew.onclick = (e) => { if (e.target === gridNew) handleGridFocus('new'); };
        gridNew.ondragover = (e) => {
            if (e.dataTransfer.types.includes('application/json')) {
                e.preventDefault();
                gridNew.classList.add('fm-grid-dragover');
            }
        };
        gridNew.ondragleave = () => gridNew.classList.remove('fm-grid-dragover');
        gridNew.ondrop = (e) => {
            gridNew.classList.remove('fm-grid-dragover');
            try {
                const data = JSON.parse(e.dataTransfer.getData('application/json'));
                if (data && data.sourceSection !== 'new') {
                    moveFramesToCombined(data.indices, data.sourceSection, state.fmNewFrames.length, 'new');
                }
            } catch (err) { }
        };
    }

    // New File Inputs
    const fmNewFilenameInput = document.getElementById('fmNewFilename');
    if (fmNewFilenameInput) {
        fmNewFilenameInput.value = state.fmNewFilename;
        fmNewFilenameInput.oninput = (e) => {
            state.fmNewFilename = e.target.value;
        };
    }

    const btnExportNew = document.getElementById('btnFmExportNew');
    if (btnExportNew) {
        btnExportNew.onclick = async () => {
            if (state.fmNewFrames.length === 0) return;
            let filename = state.fmNewFilename.trim() || "new_file";
            if (!filename.toLowerCase().endsWith('.shp')) filename += '.shp';

            // preserved compression type from original SHP if exists
            let comp = 3;
            if (state.frames.length > 0 && state.frames[0].compression !== undefined) {
                comp = state.frames[0].compression;
            }

            exportFrameList(filename, state.fmNewFrames, comp);
        };
    }

    // Keyboard Shortcuts for Frame Manager
    window.addEventListener('keydown', async (e) => {
        const dialog = document.getElementById('frameManagerDialog');
        if (!dialog || !dialog.open) return;
        if (!e.key) return;

        const k = e.key.toLowerCase();
        const ctrl = e.ctrlKey || e.metaKey;

        // Determine active set for shortcuts
        const activeSection = state.fmActiveSection || 'original';
        const selectionSet = activeSection === 'original' ? fmSelection : fmNewSelection;

        // DEL key for deleting frames
        if (k === 'delete') {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (selectionSet.size > 0) {
                // For now, only original supports history-safe delete
                if (activeSection === 'original') {
                    const btn = document.getElementById('btnFmDel');
                    if (btn && btn.onclick) await btn.onclick();
                } else {
                    // Manual delete for new frames list (no history yet for it)
                    const indices = fmNewGetSelectedIndices().sort((a, b) => b - a);
                    indices.forEach(idx => state.fmNewFrames.splice(idx, 1));
                    fmNewSelection.clear();
                    renderFrameManager();
                }
            }
            return;
        }

        if (ctrl) {
            if (k === 'z' && activeSection === 'original') {
                // Undo (only for original/project)
                e.preventDefault();
                e.stopImmediatePropagation();
                const btn = document.getElementById('btnUndo');
                if (btn) btn.click();
            } else if (k === 'y' && activeSection === 'original') {
                // Redo
                e.preventDefault();
                e.stopImmediatePropagation();
                const btn = document.getElementById('btnRedo');
                if (btn) btn.click();
            } else if (k === 'x') {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (selectionSet.size > 0) {
                    const btn = document.getElementById('btnFmCut');
                    if (btn && btn.onclick) await btn.onclick();
                }
            } else if (k === 'c') {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (selectionSet.size > 0) {
                    const btn = document.getElementById('btnFmCopy');
                    if (btn && btn.onclick) btn.onclick();
                }
            } else if (k === 'v') {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (fmClipboardVals && fmClipboardVals.length > 0) {
                    const btn = document.getElementById('btnFmPaste');
                    if (btn && btn.onclick) btn.onclick();
                }
            } else if (k === 'd') {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (selectionSet.size > 0) {
                    const btn = document.getElementById('btnFmDup');
                    if (btn && btn.onclick) btn.onclick();
                }
            } else if (k === 'a') {
                e.preventDefault();
                e.stopPropagation();
                if (activeSection === 'original') {
                    fmSelection = new Set(state.frames.map((_, i) => i));
                } else {
                    fmNewSelection = new Set(state.fmNewFrames.map((_, i) => i));
                }
                renderFrameManager();
                updateFrameManagerButtonStates();
            }
        }
    });

    // Drag and Drop for external files (PCX/PNG)
    const grid = document.getElementById('fmGrid');
    if (grid) {
        grid.addEventListener('dragover', (e) => {
            if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                grid.classList.add('drag-over-external');
            }
        });

        grid.addEventListener('dragleave', () => {
            grid.classList.remove('drag-over-external');
        });

        grid.addEventListener('drop', async (e) => {
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                e.preventDefault();
                grid.classList.remove('drag-over-external');
                if (typeof handleFrameDrop === 'function') {
                    handleFrameDrop(e.dataTransfer.files);
                }
            }
        });
    }

    // Set initial button states (all disabled except paste if clipboard has content)
    updateFrameManagerButtonStates();
}

/**
 * Updates the enabled/disabled state of Frame Manager buttons based on selection and clipboard
 */
export function updateFrameManagerButtonStates() {
    const activeSection = state.fmActiveSection || 'original';
    const selection = activeSection === 'original' ? fmSelection : fmNewSelection;
    const hasSelection = selection.size > 0;
    const hasClipboard = fmClipboardVals && fmClipboardVals.length > 0;

    const btnCut = document.getElementById('btnFmCut');
    const btnCopy = document.getElementById('btnFmCopy');
    const btnPaste = document.getElementById('btnFmPaste');
    const btnDup = document.getElementById('btnFmDup');
    const btnDel = document.getElementById('btnFmDel');
    const btnMoveBack = document.getElementById('btnFmMoveBack');
    const btnMoveFwd = document.getElementById('btnFmMoveFwd');
    const btnInvert = document.getElementById('btnFmInvert');

    // Cut, Copy, Duplicate, Delete, and Move require selection
    if (btnCut) btnCut.disabled = !hasSelection;
    if (btnCopy) btnCopy.disabled = !hasSelection;
    if (btnDup) btnDup.disabled = !hasSelection;
    if (btnDel) btnDel.disabled = !hasSelection;
    if (btnMoveBack) btnMoveBack.disabled = !hasSelection;
    if (btnMoveFwd) btnMoveFwd.disabled = !hasSelection;
    if (btnInvert) btnInvert.disabled = !fmSelectionIsConsecutive();

    // Paste requires clipboard content
    if (btnPaste) btnPaste.disabled = !hasClipboard;
}


/**
 * Checks if the current Frame Manager selection is consecutive.
 */
export function fmSelectionIsConsecutive() {
    const activeSection = state.fmActiveSection || 'original';
    const selection = activeSection === 'original' ? fmSelection : fmNewSelection;
    const framesList = activeSection === 'original' ? state.frames : state.fmNewFrames;

    if (selection.size <= 1) return false;

    if (fmIsPairLogic(framesList)) {
        const half = Math.ceil(framesList.length / 2);
        const selPairIndices = Array.from(new Set(Array.from(selection).map(i => i < half ? i : i - half))).sort((a, b) => a - b);
        if (selPairIndices.length <= 1) return false;
        for (let i = 0; i < selPairIndices.length - 1; i++) {
            if (selPairIndices[i + 1] !== selPairIndices[i] + 1) return false;
        }
        return true;
    } else {
        const sorted = Array.from(selection).sort((a, b) => a - b);
        for (let i = 0; i < sorted.length - 1; i++) {
            if (sorted[i + 1] !== sorted[i] + 1) return false;
        }
        return true;
    }
}

/**
 * Inverts the order of consecutive selected frames.
 * Correctly handles paired frames if shadows are enabled.
 */
export function invertSelectedFrames() {
    const activeSection = state.fmActiveSection || 'original';
    const selection = activeSection === 'original' ? fmSelection : fmNewSelection;
    const framesList = activeSection === 'original' ? state.frames : state.fmNewFrames;

    if (!fmSelectionIsConsecutive()) return;

    if (fmIsPairLogic(framesList)) {
        const pairs = fmGetPairs(framesList);
        const half = pairs.length;
        const selPairIndices = Array.from(new Set(Array.from(selection).map(i => i < half ? i : i - half))).sort((a, b) => a - b);

        const start = selPairIndices[0];
        const count = selPairIndices.length;

        // Reverse the sub-array of pairs
        const sub = pairs.splice(start, count);
        sub.reverse();
        pairs.splice(start, 0, ...sub);

        fmSetPairs(pairs, activeSection);
    } else {
        const indices = Array.from(selection).sort((a, b) => a - b);
        const start = indices[0];
        const count = indices.length;

        const newList = [...framesList];
        const sub = newList.splice(start, count);
        sub.reverse();
        newList.splice(start, 0, ...sub);

        if (activeSection === 'original') state.frames = newList;
        else state.fmNewFrames = newList;
    }

    state.currentFrameIdx = 0;
    if (activeSection === 'original') pushHistory('reorder');
    renderFrameManager();
    renderFramesList();
    renderCanvas();
    updateLayersList();
    if (typeof updateUIState === 'function') updateUIState();
}

export function openFrameManager() {
    const dialog = document.getElementById('frameManagerDialog');
    if (dialog) {
        // Sync checkboxes
        const fmCbShadows = document.getElementById('fmCbUseShadows');
        if (fmCbShadows) fmCbShadows.checked = state.useShadows;

        const fmCbRel = document.getElementById('fmCbRelIndex');
        if (fmCbRel) fmCbRel.checked = state.fmRelIndex;

        // Ensure we have a valid focus section
        if (!state.fmActiveSection) state.fmActiveSection = 'original';

        // Clear both selections for a fresh start
        fmSelection.clear();
        if (typeof fmNewSelection !== 'undefined') fmNewSelection.clear();

        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');

        // Important: render AFTER showModal to ensure containers are ready
        renderFrameManager();
        updateFrameManagerButtonStates();

        // Ensure we handle closing to reset restrictive modes
        dialog.addEventListener('close', () => {
            if (state.fmViewMode === 'pair-strip') state.fmViewMode = 'strip';
        }, { once: true });
    }
}

export function moveSelectedFrames(dir) {
    const sectionId = state.fmActiveSection || 'original';
    const selection = sectionId === 'original' ? fmSelection : fmNewSelection;
    const framesList = sectionId === 'original' ? state.frames : state.fmNewFrames;

    if (selection.size === 0) return;

    if (fmIsPairLogic(framesList)) {
        const pairs = fmGetPairs(framesList);
        const half = pairs.length;
        const selPairIndices = Array.from(new Set(Array.from(selection).map(i => i < half ? i : i - half))).sort((a, b) => a - b);

        if (dir === -1 && selPairIndices[0] === 0) return;
        if (dir === 1 && selPairIndices[selPairIndices.length - 1] === pairs.length - 1) return;

        const newSelection = new Set();
        if (dir === -1) {
            for (let idx of selPairIndices) {
                const temp = pairs[idx - 1];
                pairs[idx - 1] = pairs[idx];
                pairs[idx] = temp;
                newSelection.add(idx - 1);
            }
        } else {
            for (let i = selPairIndices.length - 1; i >= 0; i--) {
                const idx = selPairIndices[i];
                const temp = pairs[idx + 1];
                pairs[idx + 1] = pairs[idx];
                pairs[idx] = temp;
                newSelection.add(idx + 1);
            }
        }

        fmSetPairs(pairs, sectionId);
        if (sectionId === 'original') pushHistory('reorder');
        const newHalf = pairs.length;
        const finalSelection = new Set();
        newSelection.forEach(idx => {
            finalSelection.add(idx);
            finalSelection.add(idx + newHalf);
        });
        if (sectionId === 'original') fmSelection = finalSelection;
        else fmNewSelection = finalSelection;
    } else {
        const indices = (sectionId === 'original' ? fmGetSelectedIndices() : fmNewGetSelectedIndices()).sort((a, b) => a - b);
        if (dir === -1 && indices[0] === 0) return;
        if (dir === 1 && indices[indices.length - 1] === framesList.length - 1) return;

        const newList = [...framesList];
        const newSelection = new Set();
        if (dir === -1) {
            for (let idx of indices) {
                const temp = newList[idx - 1];
                newList[idx - 1] = newList[idx];
                newList[idx] = temp;
                newSelection.add(idx - 1);
            }
        } else {
            for (let i = indices.length - 1; i >= 0; i--) {
                const idx = indices[i];
                const temp = newList[idx + 1];
                newList[idx + 1] = newList[idx];
                newList[idx] = temp;
                newSelection.add(idx + 1);
            }
        }
        if (sectionId === 'original') {
            state.frames = newList;
            fmSelection = newSelection;
            pushHistory('reorder');
        } else {
            state.fmNewFrames = newList;
            fmNewSelection = newSelection;
        }
    }

    state.currentFrameIdx = 0;
    syncLayerSelection();
    renderFrameManager();
    renderFramesList();
    renderCanvas();
    updateLayersList();
}

export function moveFramesToCombined(indices, sourceSection, targetIdx, targetSection) {
    if (!indices || indices.length === 0) return;
    console.log(`Moving frames from ${sourceSection} to ${targetSection} at index ${targetIdx}`, indices);

    // Determine lists and selection sets
    const sourceList = sourceSection === 'original' ? state.frames : state.fmNewFrames;
    const targetList = targetSection === 'original' ? state.frames : state.fmNewFrames;
    const sourceSel = sourceSection === 'original' ? fmSelection : fmNewSelection;
    const targetSel = targetSection === 'original' ? fmSelection : fmNewSelection;

    const isPairMode = fmIsPairLogic(sourceList) && (targetList.length % 2 === 0);

    // History support for original section — use 'reorder' since no pixel data changes
    // History is recorded after the move below.

    const movingFrames = [];
    const sortedDesc = [...indices].sort((a, b) => b - a);

    if (isPairMode) {
        // Handle Pairs: Extract normal and potential shadows
        const sourceHalf = Math.ceil(sourceList.length / 2);
        const pairIndices = [...new Set(indices.map(idx => idx < sourceHalf ? idx : idx - sourceHalf))].sort((a, b) => a - b);

        const movingPairs = pairIndices.map(pIdx => ({
            normal: sourceList[pIdx],
            shadow: sourceList[pIdx + sourceHalf] || null
        }));

        // Remove from source (descending order to maintain indices)
        const descPairIndices = [...pairIndices].sort((a, b) => b - a);
        descPairIndices.forEach(pIdx => {
            const h = Math.ceil(sourceList.length / 2);
            if (pIdx + h < sourceList.length) sourceList.splice(pIdx + h, 1);
            sourceList.splice(pIdx, 1);
        });

        // Insert into target
        const targetHalf = Math.ceil(targetList.length / 2);
        let finalTargetPairIdx = targetIdx < targetHalf ? targetIdx : targetIdx - targetHalf;
        if (targetIdx >= targetList.length && targetList.length > 0) finalTargetPairIdx = targetHalf;

        // Adjust index if moving within same list
        if (sourceSection === targetSection) {
            let shift = 0;
            pairIndices.forEach(pIdx => { if (pIdx < finalTargetPairIdx) shift++; });
            finalTargetPairIdx = Math.max(0, finalTargetPairIdx - shift);
        }

        const bNormals = targetList.slice(0, Math.ceil(targetList.length / 2));
        const bShadows = targetList.slice(Math.ceil(targetList.length / 2));

        bNormals.splice(finalTargetPairIdx, 0, ...movingPairs.map(p => p.normal));
        bShadows.splice(finalTargetPairIdx, 0, ...movingPairs.map(p => p.shadow).filter(s => s !== null));

        const combined = [...bNormals, ...bShadows];
        if (targetSection === 'original') state.frames = combined; else state.fmNewFrames = combined;

        // Finalize selection and focus
        sourceSel.clear();
        targetSel.clear();
        state.fmActiveSection = targetSection;
        const newHalf = bNormals.length;
        for (let i = 0; i < movingPairs.length; i++) {
            targetSel.add(finalTargetPairIdx + i);
            targetSel.add(finalTargetPairIdx + i + newHalf);
        }
    } else {
        // Simple View (Mosaic/Strip)
        const extracted = sortedDesc.map(idx => sourceList[idx]).reverse(); // rev because we extracted desc
        sortedDesc.forEach(idx => sourceList.splice(idx, 1));

        let finalPos = targetIdx;
        if (sourceSection === targetSection) {
            let shift = 0;
            indices.forEach(idx => { if (idx < targetIdx) shift++; });
            finalPos = Math.max(0, targetIdx - shift);
        }

        targetList.splice(finalPos, 0, ...extracted);
        sourceSel.clear();
        targetSel.clear();
        state.fmActiveSection = targetSection;
        for (let i = 0; i < extracted.length; i++) targetSel.add(finalPos + i);
    }

    state.currentFrameIdx = 0;
    if (sourceSection === 'original' || targetSection === 'original') pushHistory('reorder');
    renderFrameManager();
    renderFramesList();
    renderCanvas();
    updateLayersList();
    if (typeof updateUIState === 'function') updateUIState();
}

export function createFmFrame(f, i, frameList, selectionSet, sectionId) {
    if (!f) return document.createElement('div');
    const div = document.createElement('div');
    div.className = 'fm-frame' + (selectionSet.has(i) ? ' selected' : '');

    const isShadow = state.useShadows && i >= frameList.length / 2;
    if (isShadow) {
        div.classList.add('shadow');
    }

    // Tooltip logic
    let tooltip = t('lbl_fm_frame_tooltip').replace('${index}', i);
    if (isShadow) {
        if (state.fmRelIndex) {
            const shadowStart = Math.ceil(frameList.length / 2);
            const relIdx = i - shadowStart;
            tooltip = t('lbl_fm_frame_shadow_tooltip').replace('${index}', relIdx);
        } else {
            tooltip = t('lbl_fm_frame_shadow_tooltip').replace('${index}', i);
        }
    }
    div.title = tooltip;

    div.onclick = (e) => {
        // Switch focus to this section
        state.fmActiveSection = sectionId;

        const lastClickedVar = sectionId === 'original' ? 'fmLastClickedIdx' : 'fmLastClickedNewIdx';
        let lastIdx = sectionId === 'original' ? fmLastClickedIdx : fmLastClickedNewIdx;

        if (e.ctrlKey) {
            if (selectionSet.has(i)) selectionSet.delete(i);
            else selectionSet.add(i);
            if (sectionId === 'original') fmLastClickedIdx = i; else fmLastClickedNewIdx = i;
        } else if (e.shiftKey && lastIdx !== null) {
            const start = Math.min(i, lastIdx);
            const end = Math.max(i, lastIdx);
            if (!e.ctrlKey) selectionSet.clear();
            for (let k = start; k <= end; k++) selectionSet.add(k);
        } else {
            // Unselect other section if not using modifiers
            if (sectionId === 'original') fmNewSelection.clear();
            else fmSelection.clear();

            selectionSet.clear();
            selectionSet.add(i);
            if (sectionId === 'original') fmLastClickedIdx = i; else fmLastClickedNewIdx = i;
        }
        renderFrameManager();
    };

    // Drag & Drop
    div.draggable = true;
    div.ondragstart = (e) => {
        if (!selectionSet.has(i)) {
            selectionSet.clear();
            selectionSet.add(i);
            if (sectionId === 'original') fmLastClickedIdx = i; else fmLastClickedNewIdx = i;
            renderFrameManager();
        }
        e.dataTransfer.setData('application/json', JSON.stringify({
            indices: Array.from(selectionSet).sort((a, b) => a - b),
            sourceSection: sectionId
        }));
        e.dataTransfer.effectAllowed = 'move';
    };

    div.ondragover = (e) => {
        e.preventDefault();
        const rect = div.getBoundingClientRect();
        const relX = e.clientX - rect.left;
        const isLeft = relX < rect.width / 2;

        div.classList.remove('drag-over-left', 'drag-over-right');
        if (isLeft) div.classList.add('drag-over-left');
        else div.classList.add('drag-over-right');
    };

    div.ondragleave = () => div.classList.remove('drag-over-left', 'drag-over-right');

    div.ondrop = (e) => {
        e.preventDefault();
        const wasLeft = div.classList.contains('drag-over-left');
        div.classList.remove('drag-over-left', 'drag-over-right');
        try {
            const data = JSON.parse(e.dataTransfer.getData('application/json'));
            if (data && Array.isArray(data.indices)) {
                const target = wasLeft ? i : i + 1;
                moveFramesToCombined(data.indices, data.sourceSection, target, sectionId);
            }
        } catch (err) {
            console.error("Drop failed", err);
        }
    };

    const wrapper = document.createElement('div');
    wrapper.className = 'fm-thumb-wrapper';
    const thumbSize = state.fmViewMode === 'strip' ? 200 : 160;
    wrapper.appendChild(createFrameThumbnail(f, thumbSize, thumbSize));
    div.appendChild(wrapper);

    const lbl = document.createElement('div');
    lbl.className = 'fm-label';
    if (isShadow && state.fmRelIndex) {
        const shadowStart = Math.ceil(frameList.length / 2);
        lbl.innerText = i - shadowStart;
    } else {
        lbl.innerText = i;
    }
    div.appendChild(lbl);

    return div;
}

/**
 * Core rendering logic for frame lists in the Frame Manager.
 * Reusable for both Original and New SHP sections.
 */
/**
 * Core rendering logic for frame lists in the Frame Manager.
 * Reusable for both Original and New SHP sections.
 */
/**
 * Creates a pair card (stacked or merged) for Frame Manager.
 */
function createFmPair(i, half, frames, selection, sectionId, isMerge) {
    const normalFrame = frames[i];
    const shadowIdx = i + half;
    const shadowFrame = frames[shadowIdx];

    const pairDiv = document.createElement('div');
    pairDiv.className = 'fm-pair' + (selection.has(i) ? ' selected' : '');

    pairDiv.onclick = (e) => {
        state.fmActiveSection = sectionId;
        if (sectionId === 'original') fmNewSelection.clear(); else fmSelection.clear();

        const sel = sectionId === 'original' ? fmSelection : fmNewSelection;

        if (e.ctrlKey) {
            if (sel.has(i)) {
                sel.delete(i);
                if (shadowFrame) sel.delete(shadowIdx);
            } else {
                sel.add(i);
                if (shadowFrame) sel.add(shadowIdx);
            }
            if (sectionId === 'original') fmLastClickedIdx = i; else fmLastClickedNewIdx = i;
        } else if (e.shiftKey) {
            let lastIdx = sectionId === 'original' ? fmLastClickedIdx : fmLastClickedNewIdx;
            if (lastIdx !== null && lastIdx < half) {
                const start = Math.min(i, lastIdx);
                const end = Math.max(i, lastIdx);
                sel.clear();
                for (let k = start; k <= end; k++) {
                    sel.add(k);
                    if (frames[k + half]) sel.add(k + half);
                }
            }
        } else {
            sel.clear();
            sel.add(i);
            if (shadowFrame) sel.add(shadowIdx);
            if (sectionId === 'original') fmLastClickedIdx = i; else fmLastClickedNewIdx = i;
        }
        renderFrameManager();
    };

    // Drag & Drop for Pairs
    pairDiv.draggable = true;
    pairDiv.ondragstart = (e) => {
        const sel = sectionId === 'original' ? fmSelection : fmNewSelection;
        if (!sel.has(i)) {
            sel.clear();
            sel.add(i);
            if (shadowFrame) sel.add(shadowIdx);
            if (sectionId === 'original') fmLastClickedIdx = i; else fmLastClickedNewIdx = i;
            renderFrameManager();
        }
        e.dataTransfer.setData('application/json', JSON.stringify({
            indices: Array.from(sel).sort((a, b) => a - b),
            sourceSection: sectionId
        }));
        e.dataTransfer.effectAllowed = 'move';
    };

    pairDiv.ondragover = (e) => {
        e.preventDefault();
        const rect = pairDiv.getBoundingClientRect();
        const relX = e.clientX - rect.left;
        const isLeft = relX < rect.width / 2;
        pairDiv.classList.remove('drag-over-left', 'drag-over-right');
        if (isLeft) pairDiv.classList.add('drag-over-left');
        else pairDiv.classList.add('drag-over-right');
    };

    pairDiv.ondragleave = () => pairDiv.classList.remove('drag-over-left', 'drag-over-right');

    pairDiv.ondrop = (e) => {
        e.preventDefault();
        const wasLeft = pairDiv.classList.contains('drag-over-left');
        pairDiv.classList.remove('drag-over-left', 'drag-over-right');
        try {
            const data = JSON.parse(e.dataTransfer.getData('application/json'));
            if (data && Array.isArray(data.indices)) {
                const target = wasLeft ? i : i + 1;
                moveFramesToCombined(data.indices, data.sourceSection, target, sectionId);
            }
        } catch (err) { console.error("Pair drop failed", err); }
    };

    if (isMerge) {
        const container = document.createElement('div');
        container.className = 'fm-pair-merged';
        const bgThumb = createFrameThumbnail(normalFrame, 160, 160, { showIndex0: true, showOnlyBackground: true });
        bgThumb.className = 'merged-backing';
        container.appendChild(bgThumb);

        if (shadowFrame) {
            const sThumb = createFrameThumbnail(shadowFrame, 160, 160, { showIndex0: false });
            sThumb.className = 'merged-shadow';
            container.appendChild(sThumb);
        }
        const nThumb = createFrameThumbnail(normalFrame, 160, 160, { showIndex0: false });
        nThumb.className = 'merged-normal';
        container.appendChild(nThumb);
        pairDiv.appendChild(container);
    } else {
        const col = document.createElement('div');
        col.className = 'fm-pair-stacked';
        const nWrap = document.createElement('div');
        nWrap.className = 'fm-thumb-wrapper';
        nWrap.appendChild(createFrameThumbnail(normalFrame, 160, 160, { showIndex0: true }));
        const sWrap = document.createElement('div');
        sWrap.className = 'fm-thumb-wrapper shadow-bg';
        if (shadowFrame) sWrap.appendChild(createFrameThumbnail(shadowFrame, 160, 160, { showIndex0: true }));
        col.appendChild(nWrap);
        col.appendChild(sWrap);
        pairDiv.appendChild(col);
    }

    const lbl = document.createElement('div');
    lbl.className = 'fm-label';
    lbl.innerText = i;
    pairDiv.appendChild(lbl);

    return pairDiv;
}

function renderGridInside(grid, frames, selection, sectionId) {
    if (!grid) return;
    grid.innerHTML = '';
    grid.classList.toggle('fm-active-focus', state.fmActiveSection === sectionId);

    const cbMergeView = document.getElementById('fmCbMergeView');
    const isMergeable = state.useShadows && state.fmRelIndex && frames.length > 0 && frames.length % 2 === 0;
    const isMerge = cbMergeView && cbMergeView.checked && isMergeable;

    if (isMerge) {
        const half = frames.length / 2;
        if (state.fmViewMode === 'mosaic') {
            grid.className = 'fm-grid-container';
            for (let i = 0; i < half; i++) {
                grid.appendChild(createFmPair(i, half, frames, selection, sectionId, true));
            }
        } else {
            grid.className = 'fm-view-strip fm-view-pair';
            const row = document.createElement('div');
            row.className = 'fm-strip-row';
            for (let i = 0; i < half; i++) {
                row.appendChild(createFmPair(i, half, frames, selection, sectionId, true));
            }
            grid.appendChild(row);
        }
    } else if (state.fmViewMode === 'mosaic') {
        grid.className = 'fm-grid-container';
        frames.forEach((f, i) => {
            grid.appendChild(createFmFrame(f, i, frames, selection, sectionId));
        });
    } else if (state.fmViewMode === 'pair-strip') {
        grid.className = 'fm-view-strip fm-view-pair';
        const half = Math.ceil(frames.length / 2);
        const row = document.createElement('div');
        row.className = 'fm-strip-row';
        for (let i = 0; i < half; i++) {
            row.appendChild(createFmPair(i, half, frames, selection, sectionId, false));
        }
        grid.appendChild(row);
    } else {
        // Strip Mode
        grid.className = 'fm-view-strip';
        if (state.useShadows && frames.length > 0 && frames.length % 2 === 0) {
            const half = frames.length / 2;
            const r1 = document.createElement('div');
            r1.className = 'fm-strip-row';
            const r2 = document.createElement('div');
            r2.className = 'fm-strip-row';
            for (let i = 0; i < half; i++) {
                r1.appendChild(createFmFrame(frames[i], i, frames, selection, sectionId));
                r2.appendChild(createFmFrame(frames[i + half], i + half, frames, selection, sectionId));
            }
            grid.appendChild(r1);
            grid.appendChild(r2);
            r1.onscroll = () => { r2.scrollLeft = r1.scrollLeft; };
            r2.onscroll = () => { r1.scrollLeft = r2.scrollLeft; };
        } else {
            const row = document.createElement('div');
            row.className = 'fm-strip-row';
            frames.forEach((f, i) => {
                row.appendChild(createFmFrame(f, i, frames, selection, sectionId));
            });
            grid.appendChild(row);
        }
    }
}

// --- Debounced Frame Manager Rendering ---
let _fmRenderPending = false;
export function renderFrameManager() {
    if (_fmRenderPending) return;
    _fmRenderPending = true;
    requestAnimationFrame(() => {
        _fmRenderPending = false;
        _renderFrameManagerImmediate();
    });
}

// Allow synchronous render when absolutely needed (e.g., dialog open)
export function renderFrameManagerSync() {
    _fmRenderPending = false;
    _renderFrameManagerImmediate();
}

function _renderFrameManagerImmediate() {
    const dialog = document.getElementById('frameManagerDialog');
    if (dialog && !dialog.open && !dialog.hasAttribute('open')) return;

    const grid = document.getElementById('fmGrid');
    const gridOrig = document.getElementById('fmGridOrig');
    const gridNew = document.getElementById('fmGridNew');
    const splitPanel = document.getElementById('fmSplitPanel');
    const stats = document.getElementById('fmStats');
    const statsOrig = document.getElementById('fmStatsOrig');
    const statsNew = document.getElementById('fmStatsNew');
    const warning = document.getElementById('fmShadowWarning');
    const btnMosaic = document.getElementById('btnFmViewMosaic');
    const btnStrip = document.getElementById('btnFmViewStrip');
    const btnPairStrip = document.getElementById('btnFmViewPairStrip');
    const btnSplit = document.getElementById('btnFmSplit');

    if (!grid) return;

    if (state.fmSplitActive) {
        grid.style.display = 'none';
        splitPanel.style.display = 'flex';
        if (btnSplit) btnSplit.classList.add('active');

        const colOrig = document.getElementById('fmSplitColOrig');
        const colNew = document.getElementById('fmSplitColNew');
        const ratio = state.fmSplitRatio || 0.5;
        if (colOrig) colOrig.style.flex = ratio;
        if (colNew) colNew.style.flex = 1 - ratio;

        if (gridOrig) gridOrig.style.display = (state.fmViewMode === 'mosaic') ? 'grid' : 'flex';
        if (gridNew) gridNew.style.display = (state.fmViewMode === 'mosaic') ? 'grid' : 'flex';

        renderGridInside(gridOrig, state.frames, fmSelection, 'original');
        renderGridInside(gridNew, state.fmNewFrames, fmNewSelection, 'new');
    } else {
        grid.style.display = (state.fmViewMode === 'mosaic') ? 'grid' : 'flex'; // Fix: only mosaic uses grid, others use flex
        splitPanel.style.display = 'none';
        if (btnSplit) btnSplit.classList.remove('active');
        renderGridInside(grid, state.frames, fmSelection, 'original');
    }

    const canPair = state.frames.length > 0 && state.frames.length % 2 === 0;
    if (btnPairStrip) {
        btnPairStrip.disabled = !canPair;
        if (!canPair && state.fmViewMode === 'pair-strip') {
            state.fmViewMode = 'strip';
        }
    }

    if (btnMosaic) btnMosaic.classList.toggle('active', state.fmViewMode === 'mosaic');
    if (btnStrip) btnStrip.classList.toggle('active', state.fmViewMode === 'strip');
    if (btnPairStrip) btnPairStrip.classList.toggle('active', state.fmViewMode === 'pair-strip');

    if (state.fmViewMode === 'pair-strip') {
        state.useShadows = true;
        state.fmRelIndex = true;
    }

    const fmCbShadows = document.getElementById('fmCbUseShadows');
    const fmCbRelIndex = document.getElementById('fmCbRelIndex');
    const relContainer = document.getElementById('fmRelIndexContainer');
    const isPairMode = state.fmViewMode === 'pair-strip';

    if (fmCbShadows) {
        fmCbShadows.checked = state.useShadows;
        if (fmCbShadows.parentElement) {
            fmCbShadows.parentElement.style.display = isPairMode ? 'none' : 'flex';
        }
    }
    if (fmCbRelIndex) fmCbRelIndex.checked = state.fmRelIndex;
    if (relContainer) relContainer.style.display = (state.useShadows && !isPairMode) ? 'flex' : 'none';

    if (stats) stats.textContent = t('lbl_fm_stats_template').replace('${count}', fmSelection.size).replace('${total}', state.frames.length);
    if (statsOrig) statsOrig.textContent = t('lbl_fm_stats_template').replace('${count}', fmSelection.size).replace('${total}', state.frames.length);
    if (statsNew) statsNew.textContent = t('lbl_fm_stats_template').replace('${count}', fmNewSelection.size).replace('${total}', state.fmNewFrames.length);

    const btnExport = document.getElementById('btnFmExportNew');
    if (btnExport) btnExport.disabled = state.fmNewFrames.length === 0;

    if (warning) {
        warning.style.display = (state.useShadows && state.frames.length % 2 !== 0) ? 'inline-block' : 'none';
    }

    const cbMergeView = document.getElementById('fmCbMergeView');
    const isMergeable = state.useShadows && state.fmRelIndex && state.frames.length > 0 && state.frames.length % 2 === 0;
    if (cbMergeView && cbMergeView.parentElement) cbMergeView.parentElement.style.display = (isPairMode || state.useShadows) ? 'flex' : 'none';

    updateFrameManagerButtonStates();
}
/**
 * Updates ONLY the active layer's preview in the DOM.
 * optimized for frequent calls during drag.
 */
export function updateActiveLayerPreview() {
    const layer = getActiveLayer();
    if (!layer || layer.type === 'group') return;

    const layerId = layer.id;
    const canvas = document.getElementById(`layer-preview-${layerId}`);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    renderLayerThumbnail(layer, ctx, w, h, true);

    // Bumping frame version here ensures the virtualized sidebar updates live
    if (state.frames[state.currentFrameIdx]) {
        state.frames[state.currentFrameIdx]._v = (state.frames[state.currentFrameIdx]._v || 0) + 1;
        renderFramesList();
    }
}
// --- SIMPLE TOOLTIP SYSTEM ---
export let tooltipEl = null;

let tooltipsInitialized = false;

export function setupTooltips() {
    if (tooltipsInitialized) return;
    tooltipsInitialized = true;

    tooltipEl = document.getElementById('uiTooltip');
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'uiTooltip';
        tooltipEl.className = 'ui-tooltip';
        document.body.appendChild(tooltipEl);
    }

    let _mouseX = 0, _mouseY = 0;
    let _activeTarget = null;
    let _activeText = null;
    let _showTimer = null;
    let _hideTimer = null;

    const _hideNow = () => {
        if (_showTimer) { clearTimeout(_showTimer); _showTimer = null; }
        if (tooltipEl) {
            tooltipEl.classList.remove('active');
            tooltipEl.style.display = 'none';
        }
        _activeTarget = null;
        _activeText = null;
    };

    const _startTimer = (target, text) => {
        if (_showTimer) clearTimeout(_showTimer);
        _activeTarget = target;
        _activeText = text;

        _showTimer = setTimeout(() => {
            _showTimer = null;
            if (!_activeTarget || !_activeText) return;

            const dialog = _activeTarget.closest('dialog[open]');
            const container = dialog || document.body;
            if (tooltipEl.parentElement !== container) container.appendChild(tooltipEl);

            tooltipEl.innerHTML = _activeText.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
            tooltipEl.classList.add('active');
            tooltipEl.style.display = 'block';
            positionTooltip({ clientX: _mouseX, clientY: _mouseY });
        }, 200); 
    };

    const _onMove = (e) => {
        _mouseX = e.clientX;
        _mouseY = e.clientY;

        if (tooltipEl && tooltipEl.classList.contains('active')) {
            positionTooltip(e);
        } else if (_activeTarget) {
            _startTimer(_activeTarget, _activeText);
        }
    };
    document.addEventListener('mousemove', _onMove, { passive: true });

    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[data-tooltip], [data-title], [title], [data-i18n-tooltip], [data-i18n-title]');
        if (!target) return;

        if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }

        let text = target.getAttribute('data-tooltip') || target.getAttribute('data-title') || target.getAttribute('title');
        if (!text || !text.trim()) {
            const i18nKey = target.getAttribute('data-i18n-tooltip') || target.getAttribute('data-i18n-title');
            if (i18nKey) text = t(i18nKey);
        }

        if (target.hasAttribute('title')) {
            const nativeTitle = target.getAttribute('title');
            if (nativeTitle) {
                target.setAttribute('data-title', nativeTitle);
                target.removeAttribute('title');
                text = nativeTitle;
            }
        }

        if (text && text.trim()) {
            if (text === _activeText && (tooltipEl.classList.contains('active') || _showTimer)) {
                _activeTarget = target;
                return;
            }

            if (tooltipEl.classList.contains('active')) {
                _activeTarget = target;
                _activeText = text;
                tooltipEl.innerHTML = text.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
                positionTooltip({ clientX: _mouseX, clientY: _mouseY });
            } else {
                _hideNow();
                _startTimer(target, text);
            }
        }
    });

    document.addEventListener('mouseout', (e) => {
        if (_hideTimer) clearTimeout(_hideTimer);
        _hideTimer = setTimeout(() => {
            _hideNow();
            _hideTimer = null;
        }, 50); 
    });
}

export function positionTooltip(e) {
    if (!tooltipEl) return;
    const offset = 15;
    let left = e.clientX + offset;
    let top = e.clientY + offset;

    // Boundary check using viewport dimensions
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Temporary layout to get dimensions
    tooltipEl.style.left = '-1000px';
    tooltipEl.style.top = '-1000px';
    tooltipEl.style.display = 'block';
    const rect = tooltipEl.getBoundingClientRect();

    // Tooltip uses 'fixed' positioning, so coordinates are relative to the viewport.
    // If a parent dialog has a CSS transform, 'fixed' would be relative to the dialog instead.
    const parentDialog = tooltipEl.closest('dialog[open]');

    if (left + rect.width > vw) {
        left -= (rect.width + offset * 2);
    }
    if (top + rect.height > vh) {
        top -= (rect.height + offset * 2);
    }

    // Ensure it doesn't go off-screen top/left
    if (left < 0) left = 0;
    if (top < 0) top = 0;

    // If it's inside a dialog, we might need to adjust for the dialog's scroll/position 
    // IF it's not actually 'fixed' relative to viewport.
    // Test: if it WAS missing, it's likely because I was subtracting dRect.left.

    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top = top + 'px';
}

/**
 * Recursively (globally) sets up hover logic for all submenu triggers.
 * Handles fixed positioning and vertical overflow to ensure submenus are never clipped.
 */
export function setupSubmenusRecursive(container = document.body) {
    if (!container) return;
    container.querySelectorAll('.submenu-trigger').forEach(trig => {
        const item = trig.parentElement;

        // Cleanup old handlers if any to avoid leaks/duplicates
        if (trig._submenuMe) trig.removeEventListener('mouseenter', trig._submenuMe);
        if (item._submenuMl) item.removeEventListener('mouseleave', item._submenuMl);

        trig._submenuMe = () => {
            const sub = trig.nextElementSibling;
            if (sub && sub.classList.contains('menu-dropdown')) {
                const rect = trig.getBoundingClientRect();
                const vh = window.innerHeight;

                sub.style.position = 'fixed';
                sub.style.zIndex = '3000000';
                sub.style.left = (rect.right - 1) + 'px';

                // Handle vertical overflow
                sub.style.top = rect.top + 'px';
                sub.style.bottom = 'auto'; // Reset bottom
                sub.style.maxHeight = (vh - rect.top - 10) + 'px';
                sub.style.overflowY = 'auto';

                // If it's still too small (< 300px) and we have space above, shift it up
                if (parseFloat(sub.style.maxHeight) < 300 && rect.top > vh / 2) {
                    const availableAbove = rect.bottom;
                    const targetHeight = Math.min(600, availableAbove - 10);
                    sub.style.top = 'auto';
                    sub.style.bottom = (vh - rect.bottom) + 'px';
                    sub.style.maxHeight = targetHeight + 'px';
                }

                sub.style.display = 'block';
                sub.style.visibility = 'visible';
                sub.style.opacity = '1';
                sub.classList.add('active');
            }
        };

        item._submenuMl = () => {
            const sub = trig.nextElementSibling;
            if (sub && sub.classList.contains('menu-dropdown')) {
                sub.classList.remove('active');
                sub.style.display = 'none';
                sub.style.visibility = 'hidden';
                sub.style.maxHeight = '';
                sub.style.top = '';
                sub.style.bottom = '';
            }
        };

        trig.addEventListener('mouseenter', trig._submenuMe);
        item.addEventListener('mouseleave', item._submenuMl);

        // Prevent click logic from conflicting
        trig.onclick = (e) => e.stopPropagation();
    });
}

export function setupToolbarOverflow() {
    const toolsBar = document.getElementById('toolsBar');
    const mainRow = document.getElementById('mainToolsRow');
    const overflowMenu = document.getElementById('toolbarOverflowMenu');
    const moreBtn = document.getElementById('btnToolbarMore');
    const overflowContainer = document.getElementById('toolbarOverflowContainer');

    if (!toolsBar || !mainRow || !moreBtn || !overflowContainer) return;

    let isPersistent = false;

    // Show on hover for quick access
    overflowContainer.onmouseenter = () => {
        if (moreBtn.style.display !== 'none') {
            overflowMenu.classList.add('visible');
        }
    };

    // Auto-hide when mouse leaves unless it was clicked to stay open
    overflowContainer.onmouseleave = () => {
        if (!isPersistent) {
            overflowMenu.classList.remove('visible');
        }
    };

    // Toggle persistent state on click
    moreBtn.onclick = (e) => {
        e.stopPropagation();
        isPersistent = !isPersistent;
        overflowMenu.classList.toggle('visible', isPersistent);
    };

    // Close on any outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#toolbarOverflowContainer')) {
            isPersistent = false;
            overflowMenu.classList.remove('visible');
        }
    });

    const updateOverflow = () => {
        const hasProject = state.frames.length > 0;
        if (!hasProject) return;

        // 1. Restore all tools back to mainRow to calculate true width
        while (overflowMenu.children.length > 0) {
            overflowMenu.firstChild.style.display = '';
            mainRow.appendChild(overflowMenu.firstChild);
        }

        // 2. Hide "more" button to see if everything fits perfectly natively
        moreBtn.style.display = 'none';

        // 3. Simple robust check: if there is no overflow, we are done!
        if (mainRow.scrollWidth <= mainRow.clientWidth) {
            isPersistent = false;
            overflowMenu.classList.remove('visible');
            return;
        }

        // 4. We definitely have overflow. Show the "more" button.
        // This will reduce mainRow.clientWidth because the "..." button takes up space.
        moreBtn.style.display = 'flex';

        // 5. Iteratively pop the last element into the overflow menu 
        // until the main row no longer overflows horizontally.
        let safety = 50;
        while (mainRow.scrollWidth > mainRow.clientWidth && mainRow.children.length > 0 && safety-- > 0) {
            overflowMenu.insertBefore(mainRow.lastElementChild, overflowMenu.firstChild);
        }

        // 6. Look-back: don't leave a separator hanging at the end of the main bar
        if (mainRow.lastElementChild && mainRow.lastElementChild.classList.contains('toolbar-sep')) {
            overflowMenu.insertBefore(mainRow.lastElementChild, overflowMenu.firstChild);
        }

        // 7. Hide leading separators in the overflow menu
        if (overflowMenu.firstElementChild && overflowMenu.firstElementChild.classList.contains('toolbar-sep')) {
            overflowMenu.firstElementChild.style.display = 'none';
        }

        // Auto-close if everything got moved back (shouldn't happen, but safe)
        if (overflowMenu.children.length === 0) {
            isPersistent = false;
            overflowMenu.classList.remove('visible');
            moreBtn.style.display = 'none';
        }
    };

    // Use ResizeObserver for high-performance responsive updates
    const resizeObserver = new ResizeObserver(() => {
        window.requestAnimationFrame(updateOverflow);
    });

    resizeObserver.observe(toolsBar);

    // Initial cycle
    setTimeout(updateOverflow, 150);
}

/**
 * Shows the dark red notification bar with a message
 * @param {string} msg 
 * @param {string} type - 'error' (default) or 'warning'
 * @param {number} duration - ms until auto-hide (default: 0 = manual)
 */
export function showPasteNotification(msg, type = 'error', duration = 0) {
    const el = document.getElementById('pasteNotification');
    const msgEl = document.getElementById('pasteNotificationMsg');
    if (el && msgEl) {
        msgEl.textContent = msg;
        el.className = 'notification-bar active';
        if (type === 'warning') el.classList.add('warning');
        
        if (duration > 0) {
            setTimeout(() => {
                el.classList.remove('active');
            }, duration);
        }
    }
}
