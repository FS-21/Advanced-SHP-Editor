import { state, generateId, TRANSPARENT_COLOR } from './state.js';
import { elements } from './constants.js';
import { ShpFormat80 } from './shp_format.js';
import { renderCanvas, renderFramesList, updateLayersList, updateCanvasSize, renderPalette, showEditorInterface, resetFramesList, renderFrameManager, getActiveLayer, showChoice, showConfirm, renderOverlay, showPasteNotification } from './ui.js';
import { pushHistory } from './history.js';
import { findNearestPaletteIndex } from './utils.js';
import { PcxLoader } from './pcx_loader.js';
import { exportFrameList } from './export_helper.js';

export function loadShpData(shp) {
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
    state.useShadows = false;
    
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

    const palette = new Array(256).fill(null);

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
    if (elements.txtExpShpName) elements.txtExpShpName.value = "output";
}

export async function handleSaveShp() {
    if (window._lastShpFileHandle && window.showSaveFilePicker) {
        // Quick save over existing file
        const filename = window._lastShpFileHandle.name;
        // Fetch compression from state, defaulting to 3
        const compression = state.compression !== undefined ? state.compression : 3;
        const newHandle = await exportFrameList(filename, state.frames, compression, window._lastShpFileHandle);
        if (newHandle) {
            window._lastShpFileHandle = newHandle;
            // Provide a quick feedback?
        }
    } else {
        // No handle yet, act like Save As
        showExportDialog();
    }
}

export async function handleExportShp() {
    let filename = elements.txtExpShpName.value.trim() || "output";
    // Ensure the filename has an extension for the fallback download method
    if (!filename.includes('.')) filename += '.shp';
    const compression = parseInt(elements.selExpShpType.value) || 3;

    if (elements.exportShpDialog) elements.exportShpDialog.close();

    const newHandle = await exportFrameList(filename, state.frames, compression);
    if (newHandle) {
        window._lastShpFileHandle = newHandle;
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

                const idx = findNearestPaletteIndex(color.r, color.g, color.b, state.palette);
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
            indices[y * sw + x] = findNearestPaletteIndex(color.r, color.g, color.b, state.palette);
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
    } else {
        // Current Layer
        const layer = getActiveLayer();
        if (layer && layer.data) {
            for (let i = 0; i < indices.length; i++) {
                if (indices[i] !== TRANSPARENT_COLOR) {
                    layer.data[i] = indices[i];
                }
            }
        } else {
            // Fallback to new layer if no active layer
            const frame = state.frames[state.currentFrameIdx];
            frame.layers.unshift({
                type: 'layer',
                id: generateId(),
                name: "Pasted Layer",
                data: indices,
                visible: true,
                width: sw, height: sh
            });
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
