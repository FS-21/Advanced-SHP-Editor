import { state, generateId, TRANSPARENT_COLOR } from './state.js';
import { elements } from './constants.js';
import { ShpFormat80 } from './shp_format.js';
import { TmpTsFile } from './tmp_format.js';
import { renderCanvas, renderFramesList, renderTmpComponentsList, updateLayersList, updateCanvasSize, renderPalette, showEditorInterface, resetFramesList, renderFrameManager, getActiveLayer, showChoice, showConfirm, renderOverlay, showPasteNotification, commitSelection } from './ui.js';
import { pushHistory } from './history.js';
import { findNearestPaletteIndex, getActivePalette } from './utils.js';
import { PcxLoader } from './pcx_loader.js';
import { exportFrameList } from './export_helper.js';

export function loadShpData(shp) {
    // Reset TMP mode when loading a regular SHP
    state.isTmpMode = false;
    state.tmpHeader = null;
    state.originalTmpTiles = null;
    state.tmpFilename = null;
    state.tmpFullZPreviewActive = false;
    document.body.classList.remove('tmp-mode');
    
    // Reset Game Grid state and sync controls
    state.isoGrid = 'none';
    const cbIsoGrid = document.getElementById('cbIsoGrid');
    if (cbIsoGrid) cbIsoGrid.checked = false;
    const selIsoGrid = document.getElementById('selIsoGrid');
    if (selIsoGrid) selIsoGrid.value = 'none';

    // Reset Shadows & Alpha Image Modes
    state.useShadows = false;
    state.showShadowOverlay = false;
    state.isAlphaImageMode = false;

    // Reset Replace Feature settings
    state.replacePairs = [];
    state.replaceSelection = new Set();
    state.isPickingForReplace = null;
    state.isPreviewingReplacement = false;
    state.isReplacePreviewActive = false;
    if (elements.btnPickReplaceSrc) elements.btnPickReplaceSrc.classList.remove('picker-active');
    if (elements.btnPickReplaceTgt) elements.btnPickReplaceTgt.classList.remove('picker-active');
    document.body.classList.remove('picking-mode');

    console.time("SHP Initialization");
    resetFramesList();

    // Optimization: Pre-calculate constants to avoid property access in loops
    const sw = shp.width;
    const sh = shp.height;
    const totalPixels = sw * sh;

    state.frames = shp.frames.map(f => {
        let fullData;

        // Optimization: If frame matches canvas size exactly and is at (0,0), skip re-mapping
        if (f.width === sw && f.height === sh && f.x === 0 && f.y === 0) {
            fullData = f.originalIndices;
        } else {
            fullData = new Uint16Array(totalPixels);
            fullData.fill(0); // Native SHP background is Index 0

            const fx = f.x;
            const fy = f.y;
            const fw = f.width;
            const fh = f.height;
            const src = f.originalIndices;

            for (let y = 0; y < fh; y++) {
                const destYOffset = (fy + y) * sw;
                const srcYOffset = y * fw;
                for (let x = 0; x < fw; x++) {
                    const val = src[srcYOffset + x];
                    if (val !== TRANSPARENT_COLOR) {
                        const dx = fx + x;
                        if (dx >= 0 && dx < sw && (fy + y) >= 0 && (fy + y) < sh) {
                            fullData[destYOffset + dx] = val;
                        }
                    }
                }
            }
        }

        return {
            width: sw, height: sh, duration: 100,
            _v: 0, // Frame version for thumbnail caching
            layers: [{
                type: 'layer',
                id: generateId(),
                name: "Base",
                data: fullData,
                visible: true,
                width: sw,
                height: sh
            }],
            compression: f.compression
        };
    });

    // Set Compression Default
    if (state.frames.length > 0) {
        const comp = state.frames[0].compression;
        const normalizedComp = (comp === 1 || comp === 0) ? 1 : 3;
        state.compression = normalizedComp;
        if (elements.selExpShpType) elements.selExpShpType.value = normalizedComp.toString();
    }

    state.canvasW = sw;
    state.canvasH = sh;
    state.currentFrameIdx = 0;

    if (state.frames.length > 0 && state.frames[0].layers.length > 0) {
        state.activeLayerId = state.frames[0].layers[0].id;
    }

    state.history = [];
    state.historyPtr = -1;
    // pushHistory(); // Deferred: Don't snapshot immediately to save 57MB*N RAM

    // Reset UI and Frame Manager State completely
    state.selection = null;
    state.floatingSelection = null;
    
    // Frame Manager Interface Reset
    state.fmSplitActive = false;
    state.fmNewFrames = [];
    state.fmActiveSection = 'original';
    state.fmNewFilename = "NewFile";
    state.fmViewMode = 'mosaic';
    state.fmRelIndex = false;
    state.fmSplitRatio = 0.5;

    // Force UI to sync if dialog is open
    renderFrameManager();

    updateCanvasSize();

    // UI Updates: renderFramesList is the MAJOR bottleneck. 
    // We will optimize it in ui.js to use virtualization.
    renderFramesList();
    updateLayersList();
    renderCanvas();
    showEditorInterface();
    if (typeof window.updateUIState === 'function') window.updateUIState();


    console.timeEnd("SHP Initialization");
}

export function parsePaletteBuffer(buffer) {
    console.log("TRACE: parsePaletteBuffer called with buffer size:", buffer.byteLength);

    const palette = Array.from({ length: 256 }, () => ({r:0, g:0, b:0}));

    // Try to decode as text first to check for JASC
    const txt = new TextDecoder().decode(buffer);

    if (txt.startsWith("JASC-PAL")) {
        console.log("TRACE: Format detected -> JASC-PAL");
        // JASC-PAL Format
        const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        let pIdx = 0;
        // JASC-PAL header is 3 lines: Signature, Version, Count. Data starts at line 3 (0-based)
        for (let i = 3; i < lines.length && pIdx < 256; i++) {
            const parts = lines[i].split(/\s+/);
            if (parts.length >= 3) {
                const r = parseInt(parts[0]);
                const g = parseInt(parts[1]);
                const b = parseInt(parts[2]);
                if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
                    palette[pIdx] = { r, g, b };
                    pIdx++;
                }
            }
        }
        console.log("TRACE: JASC-PAL parsed colors count:", pIdx);
    } else if (buffer.byteLength === 768) {
        console.log("TRACE: Format detected -> BINARY GAME (768 bytes)");
        // Binary GAME Format (768 bytes = 256 * 3)
        // Values are 0-63 (VGA), need to shift left by 2 to get 0-255
        const view = new Uint8Array(buffer);
        for (let i = 0; i < 256; i++) {
            // Correct scaling for VGA 6-bit colors (0-63) to 8-bit (0-255)
            // (x << 2) | (x >> 4) maps 63 to 255 and 0 to 0 correctly.
            const r6 = view[i * 3];
            const g6 = view[i * 3 + 1];
            const b6 = view[i * 3 + 2];
            palette[i] = {
                r: (r6 << 2) | (r6 >> 4),
                g: (g6 << 2) | (g6 >> 4),
                b: (b6 << 2) | (b6 >> 4)
            };
        }
        console.log("TRACE: Binary parsing complete.");
    } else {
        console.error("TRACE: Unknown format. Buffer size:", buffer.byteLength);
        throw new Error("Unknown palette format. Expected JASC-PAL or 768-byte binary.");
    }
    return palette;
}

export function parsePaletteData(buffer) {
    const pal = parsePaletteBuffer(buffer);
    for (let i = 0; i < 256; i++) {
        if (pal[i]) state.palette[i] = pal[i];
    }
}

// --- EXPORT SHP ---
export function showExportDialog() {
    const dlg = elements.exportShpDialog;
    if (dlg) {
        if (typeof dlg.showModal === 'function') dlg.showModal();
        else dlg.setAttribute('open', '');

        // Default compression to project setting
        if (elements.selExpShpType) {
            elements.selExpShpType.value = state.compression !== undefined ? String(state.compression) : "3";

            if (state.isAlphaImageMode) {
                elements.selExpShpType.value = "1";
                elements.selExpShpType.disabled = true;
                elements.selExpShpType.title = "Alpha Image Mode requires Compression 1";
            } else {
                elements.selExpShpType.disabled = false;
                elements.selExpShpType.title = "";
            }
        }
    }
    if (elements.txtExpShpName) {
        let defaultName = "output.shp";
        if (window._lastShpFileHandle && window._lastShpFileHandle.name) {
            defaultName = window._lastShpFileHandle.name;
        } else if (window._lastShpFilename) {
            defaultName = window._lastShpFilename;
        }
        if (!defaultName.includes('.')) defaultName += '.shp';
        elements.txtExpShpName.value = defaultName;
    }

    // --- Composite Preview ---
    let previewFrameIdx = state.currentFrameIdx;

    function renderExportPreview(idx) {
        const canvas = document.getElementById('expPreviewCanvas');
        const label = document.getElementById('expPreviewLabel');
        if (!canvas || !state.frames || state.frames.length === 0) return;

        const frame = state.frames[idx];
        if (!frame) return;

        // Build composite exactly as the exporter does: index 0 = solid palette color
        const w = frame.width, h = frame.height;
        const composite = new Uint8Array(w * h).fill(0);

        function compositeNode(node) {
            if (!node.visible || node.type === 'external_shp') return;
            if (node.children) {
                for (let i = node.children.length - 1; i >= 0; i--) compositeNode(node.children[i]);
            } else if (node.data) {
                for (let k = 0; k < composite.length; k++) {
                    if (node.mask && node.mask[k] === 0) continue;
                    const val = node.data[k];
                    if (val !== 65535) composite[k] = val; // 65535 = TRANSPARENT_COLOR
                }
            }
        }
        for (let i = frame.layers.length - 1; i >= 0; i--) compositeNode(frame.layers[i]);

        // Determine display scale (max 260x200)
        const scale = Math.min(Math.floor(260 / w), Math.floor(200 / h), 8) || 1;
        canvas.width = w * scale;
        canvas.height = h * scale;

        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(w * scale, h * scale);

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const palIdx = composite[y * w + x];
                const color = state.palette[palIdx] || { r: 0, g: 0, b: 0 };
                for (let sy = 0; sy < scale; sy++) {
                    for (let sx = 0; sx < scale; sx++) {
                        const px = ((y * scale + sy) * (w * scale) + (x * scale + sx)) * 4;
                        imgData.data[px] = color.r;
                        imgData.data[px + 1] = color.g;
                        imgData.data[px + 2] = color.b;
                        imgData.data[px + 3] = 255; // always opaque — index 0 is solid
                    }
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);

        if (label) label.textContent = `Frame ${idx + 1} / ${state.frames.length} (${w}×${h})`;
    }

    renderExportPreview(previewFrameIdx);

    const btnPrev = document.getElementById('btnExpPreviewPrev');
    const btnNext = document.getElementById('btnExpPreviewNext');
    if (btnPrev) {
        btnPrev.onclick = () => {
            if (state.frames.length === 0) return;
            previewFrameIdx = (previewFrameIdx - 1 + state.frames.length) % state.frames.length;
            renderExportPreview(previewFrameIdx);
        };
    }
    if (btnNext) {
        btnNext.onclick = () => {
            if (state.frames.length === 0) return;
            previewFrameIdx = (previewFrameIdx + 1) % state.frames.length;
            renderExportPreview(previewFrameIdx);
        };
    }
    // --- End Composite Preview ---
}


export async function handleSaveShp() {
    commitSelection();

    // Route to TMP encoder when in TMP mode
    if (state.isTmpMode) {
        await saveTmpData(false);
        return;
    }

    if (window._lastShpFileHandle && window.showSaveFilePicker) {
        // Quick save over existing file
        const filename = window._lastShpFileHandle.name;
        // Fetch compression from state, defaulting to 3
        const compression = state.compression !== undefined ? state.compression : 3;
        const newHandle = await exportFrameList(filename, state.frames, compression, window._lastShpFileHandle);
        if (newHandle) {
            window._lastShpFileHandle = newHandle;
            showPasteNotification(`✅ Saved: ${filename}`, 'success', 2500);
        }
    } else {
        // No handle yet, act like Save As
        showExportDialog();
    }
}

export async function handleExportShp() {
    commitSelection();
    if (state.isTmpMode) {
        await saveTmpData(true);
        return;
    }
    let filename = elements.txtExpShpName.value.trim() || "output";
    // Ensure the filename has an extension for the fallback download method
    if (!filename.includes('.')) filename += '.shp';
    const compression = parseInt(elements.selExpShpType.value) || 3;

    if (elements.exportShpDialog) elements.exportShpDialog.close();

    const newHandle = await exportFrameList(filename, state.frames, compression);
    if (newHandle) {
        window._lastShpFileHandle = newHandle;
        showPasteNotification(`✅ Saved as: ${newHandle.name}`, 'success', 2500);
    }
}


export async function handleFrameDrop(files) {
    if (!files || files.length === 0) return;

    const filesArray = Array.from(files).filter(f => {
        const ext = f.name.split('.').pop().toLowerCase();
        return ext === 'pcx' || ext === 'png';
    });

    if (filesArray.length === 0) return;

    // Load all images first to check dimensions
    const loadedImages = [];
    let maxW = state.canvasW;
    let maxH = state.canvasH;

    for (const file of filesArray) {
        try {
            const data = await processImageFile(file);
            if (data) {
                loadedImages.push(data);
                if (data.width > maxW) maxW = data.width;
                if (data.height > maxH) maxH = data.height;
            }
        } catch (err) {
            console.error(`Failed to process ${file.name}:`, err);
        }
    }

    if (loadedImages.length === 0) return;

    let shouldResize = false;
    if (maxW > state.canvasW || maxH > state.canvasH) {
        const msg = `Some imported images are larger than the current SHP.\n\n` +
            `SHP Dimensions: ${state.canvasW}x${state.canvasH}\n` +
            `Maximum dimensions found: ${maxW}x${maxH}\n\n` +
            `Do you want to RESIZE the SHP to ${maxW}x${maxH} to show all images?\n` +
            `(If you cancel, images will be cropped)`;
        shouldResize = await showConfirm("RESIZE SHP", msg);
    } else {
        const msg = `Do you want to import ${loadedImages.length} image(s) as new frames?`;
        if (!await showConfirm("IMPORT IMAGES", msg)) return;
    }

    pushHistory();

    if (shouldResize) {
        resizeEntireShp(maxW, maxH);
    }

    const sw = state.canvasW;
    const sh = state.canvasH;

    const newFrames = loadedImages.map(d => {
        const indices = new Uint16Array(sw * sh).fill(TRANSPARENT_COLOR);

        // Copy pixels with clipping if necessary (Top-Left aligned)
        const dw = Math.min(d.width, sw);
        const dh = Math.min(d.height, sh);

        for (let y = 0; y < dh; y++) {
            for (let x = 0; x < dw; x++) {
                const color = d.pixels[y * d.width + x];
                if (color.a < 128) continue;

                const idx = findNearestPaletteIndex(color.r, color.g, color.b, getActivePalette());
                indices[y * sw + x] = idx;
            }
        }

        return {
            width: sw, height: sh, duration: 100, _v: 0,
            layers: [{
                type: 'layer',
                id: generateId(),
                name: "Imported",
                data: indices,
                visible: true,
                width: sw,
                height: sh
            }]
        };
    });

    // Inset logic: insert before shadows if they exist
    let insertIdx = state.frames.length;
    if (state.useShadows && state.frames.length > 0) {
        insertIdx = Math.ceil(state.frames.length / 2);
    }

    state.frames.splice(insertIdx, 0, ...newFrames);

    if (state.useShadows) {
        const shadowFrames = newFrames.map(() => ({
            width: sw, height: sh, duration: 100, _v: 0,
            layers: [{
                type: 'layer',
                id: generateId(),
                name: "Shadow",
                data: new Uint16Array(sw * sh).fill(TRANSPARENT_COLOR),
                visible: true,
                width: sw,
                height: sh
            }]
        }));
        state.frames.splice(state.frames.length, 0, ...shadowFrames);
    }

    renderFramesList();
    renderFrameManager();
    renderCanvas();
    updateLayersList();
    updateCanvasSize();
}

/**
 * Resizes the entire SHP canvas and all existing frames.
 */
export function resizeEntireShp(newW, newH) {
    if (state.isTmpMode) return;
    const oldW = state.canvasW;
    const oldH = state.canvasH;

    state.frames.forEach(f => {
        f.width = newW;
        f.height = newH;
        f.layers.forEach(l => {
            const newData = new Uint16Array(newW * newH).fill(TRANSPARENT_COLOR);
            for (let y = 0; y < oldH; y++) {
                for (let x = 0; x < oldW; x++) {
                    newData[y * newW + x] = l.data[y * oldW + x];
                }
            }
            l.data = newData;
            l.width = newW;
            l.height = newH;
        });
    });

    state.canvasW = newW;
    state.canvasH = newH;

    updateCanvasSize();
    renderCanvas();
    renderFramesList();
    updateLayersList();
}

export async function processImageFile(file) {
    // Clipboard Blobs have no .name — fall back to MIME type or default to 'png'
    let ext;
    if (file.name) {
        ext = file.name.split('.').pop().toLowerCase();
    } else if (file.type) {
        ext = file.type.split('/').pop().toLowerCase(); // e.g. 'image/png' → 'png'
    } else {
        ext = 'png';
    }

    if (ext === 'pcx') {
        const buffer = await file.arrayBuffer();
        const loader = new PcxLoader(buffer);
        const res = loader.decode(); // { width, height, indices, palette }

        const pixels = new Array(res.width * res.height);
        for (let i = 0; i < res.indices.length; i++) {
            const idx = res.indices[i];
            const c = res.palette[idx];
            // Treat specific Magic Pink (253,0,253) as transparent for engine compatibility (Ares/Phobos)
            const isMagicPink = (c.r === 253 && c.g === 0 && c.b === 253);
            pixels[i] = { r: c.r, g: c.g, b: c.b, a: (isMagicPink ? 0 : 255) };
        }
        return { width: res.width, height: res.height, pixels };
    } else {
        // PNG
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const imageData = ctx.getImageData(0, 0, img.width, img.height).data;

                    const pixels = new Array(img.width * img.height);
                    for (let i = 0; i < pixels.length; i++) {
                        const off = i * 4;
                        pixels[i] = {
                            r: imageData[off],
                            g: imageData[off + 1],
                            b: imageData[off + 2],
                            a: imageData[off + 3]
                        };
                    }
                    resolve({ width: img.width, height: img.height, pixels });
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }
}

/**
 * Robust entry point for system image pasting (Ctrl+V interceptor).
 * Supports ImageData (Direct API) or Blob/File (Paste Event).
 */
export async function processSystemImagePaste(input) {
    try {
        if (!input) return;
        
        // Let the existing handler do the heavy lifting
        await handleClipboardPaste(input);

    } catch (err) {
        console.error("Paste processing failed:", err);
        showPasteNotification("Failed to process the pasted image.", "error");
    }
}

function _convertImageDataToPixels(imgData) {
    const pixels = new Array(imgData.width * imgData.height);
    for (let i = 0; i < pixels.length; i++) {
        const off = i * 4;
        pixels[i] = {
            r: imgData.data[off],
            g: imgData.data[off + 1],
            b: imgData.data[off + 2],
            a: imgData.data[off + 3]
        };
    }
    return pixels;
}

/**
 * Handles pasting an image from the clipboard.
 * Now supports both File/Blob objects and raw ImageData.
 */
export async function handleClipboardPaste(input) {
    if (!input) return;

    let data;
    if (input instanceof ImageData) {
        data = {
            width: input.width,
            height: input.height,
            pixels: _convertImageDataToPixels(input)
        };
    } else {
        data = await processImageFile(input);
    }

    if (!data) return;

    // --- TMP FULL PREVIEW PASTE HANDLER ---
    if (state.isTmpMode && state.currentFrameIdx === -1) {
        const tiles = getCurrentEditedTiles();
        if (!tiles || !state.tmpHeader) {
            showPasteNotification("No hay tiles cargados para pegar en Full Preview.", "error");
            return;
        }
        const bounds = TmpTsFile.computeBounds({ header: state.tmpHeader, tiles, numTiles: tiles.length });
        if (!bounds.hasTiles) {
            showPasteNotification("No hay tiles válidos en el Full Preview.", "error");
            return;
        }

        const cw = Math.ceil(bounds.width);
        const ch = Math.ceil(bounds.height);

        if (data.width === cw && data.height === ch) {
            pushHistory();

            const cx = state.tmpHeader.cx;
            const cy = state.tmpHeader.cy;
            const halfCy = cy / 2;
            const mult = halfCy;

            for (const frame of state.frames) {
                if (!frame.tmpMeta) continue;
                const { tileSlot, component } = frame.tmpMeta;
                const tile = state.originalTmpTiles[tileSlot];
                if (!tile) continue;

                const h = tile.tileHeader || tile.header;
                if (!h) continue;

                const isZDataView = state.tmpFullZPreviewActive;
                let shouldUpdate = false;
                if (isZDataView) {
                    shouldUpdate = (component === 'zdata' || component === 'extrazdata');
                } else {
                    shouldUpdate = (component === 'main' || component === 'extra');
                }

                if (!shouldUpdate) continue;

                const layer = frame.layers[0];
                if (!layer || !layer.data) continue;

                if (component === 'main' || component === 'zdata') {
                    const lx = h.x - bounds.minX;
                    const ly = (h.y - h.height * mult) - bounds.minY;

                    for (let y_tile = 0; y_tile < cy; y_tile++) {
                        for (let x_tile = 0; x_tile < cx; x_tile++) {
                            if (TmpTsFile.isInsideWestwoodDiamond(x_tile, y_tile, cx, cy)) {
                                const px = Math.floor(lx + x_tile);
                                const py = Math.floor(ly + y_tile);
                                if (px >= 0 && px < cw && py >= 0 && py < ch) {
                                    const color = data.pixels[py * cw + px];
                                    const targetIdx = y_tile * cx + x_tile;

                                    if (isZDataView) {
                                        if (color.a < 128) {
                                            layer.data[targetIdx] = 255;
                                        } else {
                                            const grayValue = Math.round((color.r + color.g + color.b) / 3);
                                            const zVal = Math.max(0, Math.min(31, Math.round((grayValue * 31) / 255)));
                                            layer.data[targetIdx] = zVal;
                                        }
                                    } else {
                                        if (color.a < 128) {
                                            layer.data[targetIdx] = 0;
                                        } else {
                                            layer.data[targetIdx] = findNearestPaletteIndex(color.r, color.g, color.b, getActivePalette());
                                        }
                                    }
                                }
                            }
                        }
                    }
                    layer._v = (layer._v || 0) + 1;
                    frame._v = (frame._v || 0) + 1;

                } else if (component === 'extra' || component === 'extrazdata') {
                    const ew = h.cx_extra;
                    const eh = h.cy_extra;
                    if (ew > 0 && eh > 0) {
                        const elx = h.x_extra - bounds.minX;
                        const ely = (h.y_extra - h.height * mult) - bounds.minY;

                        for (let ey = 0; ey < eh; ey++) {
                            for (let ex = 0; ex < ew; ex++) {
                                const px = Math.floor(elx + ex);
                                const py = Math.floor(ely + ey);
                                if (px >= 0 && px < cw && py >= 0 && py < ch) {
                                    const color = data.pixels[py * cw + px];
                                    const targetIdx = ey * ew + ex;
                                    const originalVal = layer.data[targetIdx];

                                    if (isZDataView) {
                                        if (originalVal === 0 || originalVal === 255) {
                                            continue; // Skip transparent pixel (keep original transparency mask)
                                        }
                                        if (color.a < 128) {
                                            layer.data[targetIdx] = 255;
                                        } else {
                                            const grayValue = Math.round((color.r + color.g + color.b) / 3);
                                            if (grayValue < 5) {
                                                layer.data[targetIdx] = 255;
                                            } else {
                                                const zVal = Math.max(1, Math.min(31, Math.round((grayValue * 31) / 255)));
                                                layer.data[targetIdx] = zVal;
                                            }
                                        }
                                    } else {
                                        if (originalVal === 0) {
                                            continue; // Skip transparent pixel (keep original transparency mask)
                                        }
                                        if (color.a < 128) {
                                            layer.data[targetIdx] = 0;
                                        } else {
                                            layer.data[targetIdx] = findNearestPaletteIndex(color.r, color.g, color.b, getActivePalette());
                                        }
                                    }
                                }
                            }
                        }
                        layer._v = (layer._v || 0) + 1;
                        frame._v = (frame._v || 0) + 1;
                    }
                }
            }

            renderCanvas();
            renderTmpComponentsList();
            updateLayersList();
            showPasteNotification("✅ Imagen de Full Preview pegada y procesada correctamente.", "success", 3000);
            return;
        } else {
            showPasteNotification(`⚠️ Las dimensiones de la imagen pegada (${data.width}x${data.height}) no coinciden con las del Full Preview (${cw}x${ch}).`, "error", 4000);
            return;
        }
    }

    // Prompt 1: New Layer vs Current Layer
    const choice = await showChoice(
        "PASTE IMAGE",
        "How do you want to paste this image?",
        "NEW LAYER",
        "CURRENT LAYER"
    );

    if (choice === 'cancel') return;

    // Check if image is larger than canvas and prompt for resize
    let shouldResize = false;
    if (data.width > state.canvasW || data.height > state.canvasH) {
        const maxW = Math.max(data.width, state.canvasW);
        const maxH = Math.max(data.height, state.canvasH);
        const msg = `The pasted image is larger than the current SHP.\n\n` +
            `SHP Dimensions: ${state.canvasW}x${state.canvasH}\n` +
            `Image Dimensions: ${data.width}x${data.height}\n\n` +
            `Do you want to RESIZE the SHP to ${maxW}x${maxH} to show the whole image?\n` +
            `(If you cancel, the image will be cropped)`;
        shouldResize = await showConfirm("RESIZE SHP", msg);

        if (shouldResize) {
            pushHistory();
            resizeEntireShp(maxW, maxH);
        }
    }

    pushHistory();

    const sw = state.canvasW;
    const sh = state.canvasH;
    const indices = new Uint16Array(sw * sh).fill(TRANSPARENT_COLOR);

    const dw = Math.min(data.width, sw);
    const dh = Math.min(data.height, sh);

    for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) {
            const color = data.pixels[y * data.width + x];
            if (color.a < 128) continue;
            indices[y * sw + x] = findNearestPaletteIndex(color.r, color.g, color.b, getActivePalette());
        }
    }

    if (choice === 'opt1') {
        // New Layer
        const frame = state.frames[state.currentFrameIdx];
        const newLayer = {
            type: 'layer',
            id: generateId(),
            name: "Pasted Layer",
            data: indices,
            visible: true,
            width: sw, height: sh,
            mask: null,
            editMask: false
        };
        frame.layers.unshift(newLayer);
        state.activeLayerId = newLayer.id;
        frame._v = (frame._v || 0) + 1;
    } else {
        // Current Layer
        const layer = getActiveLayer();
        if (layer && layer.data) {
            for (let i = 0; i < indices.length; i++) {
                if (indices[i] !== TRANSPARENT_COLOR) {
                    layer.data[i] = indices[i];
                }
            }
            layer._v = (layer._v || 0) + 1;
            const frame = state.frames[state.currentFrameIdx];
            if (frame) frame._v = (frame._v || 0) + 1;
        } else {
            // Fallback to new layer if no active layer
            const frame = state.frames[state.currentFrameIdx];
            const newLayer = {
                type: 'layer',
                id: generateId(),
                name: "Pasted Layer",
                data: indices,
                visible: true,
                width: sw, height: sh
            };
            frame.layers.unshift(newLayer);
            frame._v = (frame._v || 0) + 1;
        }
    }

    updateLayersList();
    renderCanvas();
    renderFramesList();

    // Create selection around pasted content
    state.selection = {
        x: 0,
        y: 0,
        w: dw,
        h: dh
    };
    renderOverlay();
}

// ─────────────────────────────────────────────────────────────────
// TMP FILE SUPPORT
// ─────────────────────────────────────────────────────────────────

/** TMP extension list */
export const TMP_EXTENSIONS = ['tem', 'sno', 'urb', 'des', 'lun', 'ubn'];

/**
 * Load a TS/RA2 TMP file into the editor.
 * Populates state.frames with one entry per editable tile component.
 * @param {ArrayBuffer} buffer - raw file bytes
 * @param {string} filename - original filename (for Save)
 */
export function loadTmpData(buffer, filename) {
    console.time('TMP Initialization');
    resetFramesList();

    let parsed;
    try {
        parsed = TmpTsFile.parse(buffer);
    } catch (err) {
        alert('Error parsing TMP file: ' + err.message);
        console.error(err);
        return;
    }

    const { header, tiles } = parsed;
    const { cx, cy } = header;

    // Activate TMP mode
    state.isTmpMode = true;
    state.tmpHeader = header;
    state.originalTmpTiles = tiles.map(t => t ? { ...t } : null); // shallow clone per tile
    state.tmpFilename = filename;
    document.body.classList.add('tmp-mode');

    // Build frames[] from tile components
    const frames = [];
    for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        if (!tile) continue;
        const th = tile.tileHeader;

        // --- Main tile image (diamond → rect) ---
        const mainRect = TmpTsFile.decodeTileDiamond(tile.data, cx, cy, 0);
        const mainData = new Uint16Array(cx * cy);
        for (let k = 0; k < mainRect.length; k++) mainData[k] = mainRect[k];
        frames.push({
            id: generateId(),
            width: cx, height: cy, duration: 100, _v: 0,
            tmpMeta: { tileSlot: i, component: 'main' },
            layers: [{ type: 'layer', id: generateId(), name: 'Base', data: mainData, visible: true, width: cx, height: cy }]
        });

        // --- Z-data (diamond → rect) ---
        if (th.has_z_data && tile.zData) {
            const zRect = TmpTsFile.decodeTileDiamond(tile.zData, cx, cy, 0);
            const zData = new Uint16Array(cx * cy);
            for (let k = 0; k < zRect.length; k++) zData[k] = zRect[k];
            frames.push({
                id: generateId(),
                width: cx, height: cy, duration: 100, _v: 0,
                tmpMeta: { tileSlot: i, component: 'zdata' },
                layers: [{ type: 'layer', id: generateId(), name: 'Z-Data', data: zData, visible: true, width: cx, height: cy }]
            });
        }

        // --- Damaged data (diamond → rect) ---
        if (th.has_damaged_data && tile.damagedData) {
            const damagedRect = TmpTsFile.decodeTileDiamond(tile.damagedData, cx, cy, 0);
            const damagedData = new Uint16Array(cx * cy);
            for (let k = 0; k < damagedRect.length; k++) damagedData[k] = damagedRect[k];
            frames.push({
                id: generateId(),
                width: cx, height: cy, duration: 100, _v: 0,
                tmpMeta: { tileSlot: i, component: 'damaged' },
                layers: [{ type: 'layer', id: generateId(), name: 'Damaged', data: damagedData, visible: true, width: cx, height: cy }]
            });
        }

        // --- Extra image (already rectangular) ---
        if (th.has_extra_data && tile.extraImageData && th.cx_extra > 0 && th.cy_extra > 0) {
            const ew = th.cx_extra, eh = th.cy_extra;
            const extraData = new Uint16Array(ew * eh);
            for (let k = 0; k < tile.extraImageData.length; k++) extraData[k] = tile.extraImageData[k];
            frames.push({
                id: generateId(),
                width: ew, height: eh, duration: 100, _v: 0,
                tmpMeta: { tileSlot: i, component: 'extra' },
                layers: [{ type: 'layer', id: generateId(), name: 'Extra', data: extraData, visible: true, width: ew, height: eh }]
            });

            // --- Extra Z-data ---
            if (th.has_z_data && tile.extraZData) {
                const extraZData = new Uint16Array(ew * eh);
                for (let k = 0; k < tile.extraZData.length; k++) extraZData[k] = tile.extraZData[k];
                frames.push({
                    id: generateId(),
                    width: ew, height: eh, duration: 100, _v: 0,
                    tmpMeta: { tileSlot: i, component: 'extrazdata' },
                    layers: [{ type: 'layer', id: generateId(), name: 'Extra Z', data: extraZData, visible: true, width: ew, height: eh }]
                });
            }
        }
    }

    state.frames = frames;
    state.currentFrameIdx = 0;

    // Canvas size = first frame's dimensions
    if (frames.length > 0) {
        state.canvasW = frames[0].width;
        state.canvasH = frames[0].height;
        state.activeLayerId = frames[0].layers[0].id;
    } else {
        state.canvasW = cx;
        state.canvasH = cy;
    }

    // Reset editor history and selection
    state.history = [];
    state.historyPtr = -1;
    state.selection = null;
    state.floatingSelection = null;
    state.useShadows = false;
    state.showShadowOverlay = false;
    state.isAlphaImageMode = false;
    state.tmpFullZPreviewActive = false;
    state.fmSplitActive = false;
    state.fmNewFrames = [];
    state.fmActiveSection = 'original';
    state.fmRelIndex = false;

    // Reset Replace Feature settings
    state.replacePairs = [];
    state.replaceSelection = new Set();
    state.isPickingForReplace = null;
    state.isPreviewingReplacement = false;
    state.isReplacePreviewActive = false;
    if (elements.btnPickReplaceSrc) elements.btnPickReplaceSrc.classList.remove('picker-active');
    if (elements.btnPickReplaceTgt) elements.btnPickReplaceTgt.classList.remove('picker-active');
    document.body.classList.remove('picking-mode');

    // Grid is OFF by default; user toggles via the checkbox in the toolbar
    state.isoGrid = 'none';
    const cbIsoGrid = document.getElementById('cbIsoGrid');
    if (cbIsoGrid) cbIsoGrid.checked = false;
    // Keep selIsoGrid value consistent (even though it's hidden in TMP mode)
    const selIsoGrid = document.getElementById('selIsoGrid');
    if (selIsoGrid) selIsoGrid.value = 'none';

    updateCanvasSize();
    renderTmpComponentsList();
    updateLayersList();
    renderCanvas();
    showEditorInterface();
    if (typeof window.updateUIState === 'function') window.updateUIState();

    const t = state.translations;
    const msg = (t && t.msg_tmp_loaded)
        ? t.msg_tmp_loaded.replace('{n}', frames.length).replace('{tiles}', tiles.filter(Boolean).length)
        : `TMP loaded: ${frames.length} components from ${tiles.filter(Boolean).length} tiles`;
    showPasteNotification('✅ ' + msg, 'success', 3000);
    console.timeEnd('TMP Initialization');
}

/**
 * Save the current TMP data back to a file.
 * Flattens all layer edits and re-encodes, preserving unedited tile structure.
 */
export function getCurrentEditedTiles() {
    if (!state.isTmpMode || !state.originalTmpTiles || !state.tmpHeader) return null;
    const { cx, cy } = state.tmpHeader;

    // Deep clone the original tile array so we don't mutate state
    const tiles = state.originalTmpTiles.map(t => {
        if (!t) return null;
        return {
            ...t,
            tileHeader: { ...t.tileHeader },
            data: t.data ? new Uint8Array(t.data) : null,
            zData: t.zData ? new Uint8Array(t.zData) : null,
            extraImageData: t.extraImageData ? new Uint8Array(t.extraImageData) : null,
            extraZData: t.extraZData ? new Uint8Array(t.extraZData) : null,
            damagedData: t.damagedData ? new Uint8Array(t.damagedData) : null,
        };
    });

    // Patch each edited frame back into the tile array
    for (const frame of state.frames) {
        if (!frame.tmpMeta) continue;
        const { tileSlot, component } = frame.tmpMeta;
        const tile = tiles[tileSlot];
        if (!tile) continue;

        const fw = frame.width;
        const fh = frame.height;

        // Flatten all visible layers into one Uint8Array
        const composite = new Uint8Array(fw * fh);
        for (let li = frame.layers.length - 1; li >= 0; li--) {
            const layer = frame.layers[li];
            if (!layer.visible || layer.type === 'external_shp') continue;
            if (layer.data) {
                for (let k = 0; k < composite.length; k++) {
                    const val = layer.data[k];
                    if (val !== undefined && val !== TRANSPARENT_COLOR) {
                        composite[k] = val & 0xFF;
                    }
                }
            }
        }

        if (component === 'main') {
            tile.data = TmpTsFile.encodeTileRectangle(composite, cx, cy);
        } else if (component === 'zdata') {
            tile.zData = TmpTsFile.encodeTileRectangle(composite, cx, cy);
        } else if (component === 'damaged') {
            tile.damagedData = TmpTsFile.encodeTileRectangle(composite, cx, cy);
        } else if (component === 'extra') {
            tile.extraImageData = composite;
        } else if (component === 'extrazdata') {
            tile.extraZData = composite;
        }
    }
    return tiles;
}

/**
 * Save the current TMP data back to a file.
 * Flattens all layer edits and re-encodes, preserving unedited tile structure.
 */
export async function saveTmpData(forceSaveAs = false) {
    if (!state.isTmpMode || !state.originalTmpTiles || !state.tmpHeader) return;

    const tiles = getCurrentEditedTiles();
    if (!tiles) return;

    // Re-encode
    let encoded;
    try {
        encoded = TmpTsFile.encode({ header: state.tmpHeader, tiles });
    } catch (err) {
        alert('Error encoding TMP: ' + err.message);
        console.error(err);
        return;
    }

    const filename = state.tmpFilename || 'output.tem';
    const blob = new Blob([encoded], { type: 'application/octet-stream' });

    // Try to write to the file handle if we have one and we aren't doing a "Save As"
    if (window._lastShpFileHandle && !forceSaveAs && window.showSaveFilePicker) {
        try {
            const writable = await window._lastShpFileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            
            const t = state.translations;
            const msg = (t && t.msg_tmp_saved)
                ? t.msg_tmp_saved.replace('{filename}', window._lastShpFileHandle.name)
                : `TMP saved: ${window._lastShpFileHandle.name}`;
            showPasteNotification('✅ ' + msg, 'success', 2500);
            return;
        } catch (err) {
            console.error("Handle save failed, falling back to download:", err);
        }
    }

    // "Save As" or fallback download
    if (!forceSaveAs) {
        // Simple download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        const t = state.translations;
        const msg = (t && t.msg_tmp_saved)
            ? t.msg_tmp_saved.replace('{filename}', filename)
            : `TMP saved: ${filename}`;
        showPasteNotification('✅ ' + msg, 'success', 2500);
    } else {
        // Show Save File Picker
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: 'Westwood TMP Files',
                        accept: { 'application/x-wwn-tmp-all': ['.tem', '.sno', '.urb', '.des', '.lun', '.ubn'] }
                    }]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                window._lastShpFileHandle = handle;
                state.tmpFilename = handle.name;
                
                showPasteNotification(`✅ Saved as: ${handle.name}`, 'success', 2500);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error("Save file picker failed:", err);
                    alert("Error saving TMP: " + err.message);
                }
            }
        } else {
            // Fallback download if no Save File Picker support
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            showPasteNotification(`✅ Saved as: ${filename}`, 'success', 2500);
        }
    }
}
