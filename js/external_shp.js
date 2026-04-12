import { ShpFormat80 } from './shp_format.js';
import { state, TRANSPARENT_COLOR } from './state.js';
import { elements } from './constants.js';
import { renderCustomSubmenuNodes, getLib } from './palette_menu.js';
import { GAME_PALETTES } from './game_palettes.js';
import { parsePaletteBuffer } from './file_io.js';

let extShpPalette = new Array(256).fill(null);
let extShpData = null; // { width, height, frames: [] }
let extShpFrameIdx = 0;
let currentLayerId = null;

// Cache to satisfy "re-open with precargado" without bloating individual layers
const shpCache = new Map(); // filename -> shpData

let tempOnConfirm = null;
let globalOnConfirm = null;

export function initExternalShpDialog(onConfirm) {
    globalOnConfirm = onConfirm;
    initExternalGrid();

    // Palette Selector is now handled by the shared palette_menu.js
    // We just need to define a hook for when a palette is selected there
    window.syncExternalPalette = (node) => {
        loadPalette(node);
    };

    elements.inpExtShpPal.onchange = (e) => {
        if (!e.target.files.length) return;
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const colors = parsePaletteBuffer(ev.target.result);
                extShpPalette = colors;
                renderExternalPalette();
                if (extShpData) renderExternalFrame(extShpFrameIdx);
                updateExternalUI();
            } catch (err) {
                alert("Error loading palette: " + err.message);
            }
            elements.inpExtShpPal.value = '';
        };
        reader.readAsArrayBuffer(file);
    };

    // SHP Loading
    elements.btnExtShpLoadFile.onclick = () => {
        elements.inpExtShpFile.click();
    };

    elements.inpExtShpFile.onchange = (e) => {
        if (!e.target.files.length) return;
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const buf = ev.target.result;
                extShpData = ShpFormat80.parse(buf);
                extShpData.filename = file.name;
                shpCache.set(file.name, extShpData);
                extShpFrameIdx = 0;
                updateFrameControls();
                renderExternalFrame(0);
                updateExternalUI();
            } catch (err) {
                alert("Error parsing SHP: " + err.message);
            }
            elements.inpExtShpFile.value = '';
        };
        reader.readAsArrayBuffer(file);
    };

    // Navigation
    elements.btnExtShpPrev.onclick = () => {
        if (!extShpData) return;
        extShpFrameIdx = Math.max(0, extShpFrameIdx - 1);
        syncFrameUI();
    };

    elements.btnExtShpNext.onclick = () => {
        if (!extShpData) return;
        extShpFrameIdx = Math.min(extShpData.frames.length - 1, extShpFrameIdx + 1);
        syncFrameUI();
    };

    elements.extShpSlider.oninput = () => {
        if (!extShpData) return;
        extShpFrameIdx = parseInt(elements.extShpSlider.value);
        syncFrameUI(true);
    };

    elements.extShpFrameInput.onchange = () => {
        if (!extShpData) return;
        let val = parseInt(elements.extShpFrameInput.value) || 0;
        val = Math.max(0, Math.min(extShpData.frames.length - 1, val));
        extShpFrameIdx = val;
        syncFrameUI();
    };

    // Confirm / Cancel
    elements.btnCancelExtShp.onclick = () => {
        tempOnConfirm = null;
        elements.externalShpDialog.close();
    };

    elements.btnConfirmExtShp.onclick = () => {
        if (!extShpData || !extShpPalette) return;
        const cb = tempOnConfirm || globalOnConfirm;
        if (cb) {
            cb({
                layerId: currentLayerId,
                shpData: extShpData,
                frameIdx: extShpFrameIdx,
                palette: extShpPalette
            });
        }
        tempOnConfirm = null;
        elements.externalShpDialog.close();
    };
}

function syncFrameUI(fromSlider = false) {
    if (!extShpData) return;
    if (!fromSlider) elements.extShpSlider.value = extShpFrameIdx;
    elements.extShpFrameInput.value = extShpFrameIdx;
    renderExternalFrame(extShpFrameIdx);
}

function updateFrameControls() {
    if (!extShpData) return;
    const max = extShpData.frames.length - 1;
    elements.extShpSlider.max = max;
    elements.extShpSlider.value = extShpFrameIdx;
    elements.extShpFrameInput.value = extShpFrameIdx;
    elements.extShpCounter.innerText = `/ ${max}`;
}

export function openExternalShpDialog(layerId, existingData = null, onConfirmOverride = null) {
    tempOnConfirm = onConfirmOverride;
    currentLayerId = layerId;
    if (existingData) {
        // Try to recover shpData from cache if we only have the filename
        if (!existingData.shpData && existingData.extFilename) {
            existingData.shpData = shpCache.get(existingData.extFilename);
        }

        extShpData = existingData.shpData || null;
        extShpFrameIdx = existingData.frameIdx || 0;
        extShpPalette = existingData.palette || new Array(256).fill(null);
    } else {
        // Load project palette as default for new external layers
        if (state.palette) {
            extShpPalette = state.palette.map(c => c ? { ...c } : null);
        } else {
            extShpPalette = new Array(256).fill(null);
        }
    }

    renderExternalPalette();
    if (extShpData) {
        updateFrameControls();
        renderExternalFrame(extShpFrameIdx);
    } else {
        resetCanvas();
    }
    updateExternalUI();
    elements.externalShpDialog.showModal();
}

function loadPalette(node) {
    if (!node || !node.b64) {
        // For game palettes
        if (node && node.data) {
            extShpPalette = node.data.map(c => ({ ...c }));
        } else {
            return;
        }
    } else {
        const buf = base64ToBuffer(node.b64);
        extShpPalette = parsePaletteBuffer(buf);
    }
    renderExternalPalette();
    if (extShpData) renderExternalFrame(extShpFrameIdx);
    updateExternalUI();
}

function initExternalGrid() {
    const grid = elements.extShpPalGrid;
    grid.innerHTML = '';
    for (let i = 0; i < 256; i++) {
        const d = document.createElement('div');
        d.className = 'pal-cell ' + (i % 2 === 0 ? 'empty-p1' : 'empty-p2');
        grid.appendChild(d);
    }
}

function renderExternalPalette() {
    const cells = elements.extShpPalGrid.children;
    for (let i = 0; i < 256; i++) {
        const c = extShpPalette[i];
        if (c) {
            cells[i].style.backgroundColor = `rgb(${c.r},${c.g},${c.b})`;
            cells[i].className = 'pal-cell used';
        } else {
            cells[i].style.backgroundColor = '';
            cells[i].className = 'pal-cell ' + (i % 2 === 0 ? 'empty-p1' : 'empty-p2');
        }
    }
}

function renderExternalFrame(idx) {
    if (!extShpData) return;
    const f = extShpData.frames[idx];
    if (!f) return;

    const canvas = elements.extShpCanvas;
    const ctx = canvas.getContext('2d');

    if (canvas.width !== extShpData.width || canvas.height !== extShpData.height) {
        canvas.width = extShpData.width;
        canvas.height = extShpData.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const imgData = ctx.createImageData(canvas.width, canvas.height);
    const d = imgData.data;
    const indices = f.originalIndices;

    // Fill with background color (Index 0) for preview inside dialog
    const bgCol = extShpPalette[0] || { r: 0, g: 0, b: 0 };
    for (let k = 0; k < d.length; k += 4) {
        d[k] = bgCol.r; d[k + 1] = bgCol.g; d[k + 2] = bgCol.b; d[k + 3] = 255;
    }

    const fw = f.width, fh = f.height, fx = f.x, fy = f.y;
    const gw = extShpData.width, gh = extShpData.height;

    for (let y = 0; y < fh; y++) {
        if (fy + y < 0 || fy + y >= gh) continue;
        const lineOffset = y * fw;
        const canvasLineOffset = (fy + y) * gw;

        for (let x = 0; x < fw; x++) {
            if (fx + x < 0 || fx + x >= gw) continue;
            const i = lineOffset + x;
            if (i >= indices.length) break;

            const colorIdx = indices[i];
            // Color 0 is transparent for External SHP
            if (colorIdx === 0 || colorIdx === TRANSPARENT_COLOR) continue;

            const canvasIdx = (canvasLineOffset + fx + x) * 4;

            const c = extShpPalette[colorIdx];
            if (c) {
                d[canvasIdx] = c.r; d[canvasIdx + 1] = c.g; d[canvasIdx + 2] = c.b; d[canvasIdx + 3] = 255;
            } else {
                d[canvasIdx] = 255; d[canvasIdx + 1] = 0; d[canvasIdx + 2] = 255; d[canvasIdx + 3] = 255;
            }
        }
    }

    ctx.putImageData(imgData, 0, 0);
    elements.extShpInfo.innerText = `${extShpData.filename} (${extShpData.width}x${extShpData.height}, ${extShpData.frames.length} frames)`;
}

function resetCanvas() {
    const ctx = elements.extShpCanvas.getContext('2d');
    ctx.clearRect(0, 0, elements.extShpCanvas.width, elements.extShpCanvas.height);
    elements.extShpInfo.innerText = "No file loaded";
    elements.extShpCounter.innerText = "/0";
}

function updateExternalUI() {
    const hasPal = extShpPalette && extShpPalette.some(c => c !== null);
    const hasData = !!extShpData;
    elements.btnConfirmExtShp.disabled = !(hasPal && hasData);
}

// Helpers duplicated/imported from logic
// Centralized palette parsing is now imported from file_io.js

function base64ToBuffer(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}
