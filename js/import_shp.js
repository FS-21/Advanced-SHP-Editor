import { ShpFormat80 } from './shp_format.js';
import { state, TRANSPARENT_COLOR } from './state.js';
import { SVG_PLAY_MODERN as SVG_PLAY, SVG_PAUSE_MODERN as SVG_PAUSE, SVG_STEP_FWD_MODERN as SVG_STEP_FORWARD } from './utils.js';
import { loadTmpData } from './file_io.js';
import { saveRecentFile } from './menu_handlers.js';
import { getActivePaletteId, getLib, findNodeById, updatePaletteSelectorUI } from './palette_menu.js';

let impShpPalette = new Array(256).fill(null);
let impShpData = null; // { width, height, frames: [] }
let impShpFrameIdx = 0;
let impShpTimer = null;
let _lastImpShpPaletteNodeId = null;

export function setLastImpShpPaletteNodeId(id) {
    _lastImpShpPaletteNodeId = id;
}

export function initImportShp(onConfirm) {
    // Initialize Grid
    shp_initImportGrid();

    // Initialize Icons
    if (elements.btnImpShpPlay) elements.btnImpShpPlay.innerHTML = SVG_PLAY;
    if (elements.btnImpShpStep) elements.btnImpShpStep.innerHTML = SVG_STEP_FORWARD;

    // Event Listeners (Palette loading removed in favor of selector menu)


    elements.btnImpShpLoadFile.onclick = async () => {
        if (window.showOpenFilePicker) {
            // Use File System Access API for handles (Recent Files support)
            try {
                const [handle] = await window.showOpenFilePicker({
                    types: [{
                        description: 'Westwood SHP Files (.shp, .sha)',
                        accept: { 'application/octet-stream': ['.shp', '.sha'] }
                    }],
                    excludeAcceptAllOption: true
                });
                const file = await handle.getFile();
                const buf = await file.arrayBuffer();
                try {
                    impShpData = ShpFormat80.parse(buf);
                    window.curImportShpData = impShpData;
                    impShpData.filename = file.name;
                    // Store handle for Recent Files
                    window._lastShpFileHandle = handle;

                    impShpFrameIdx = 0;
                    shp_updateFrameLimits();
                    elements.impShpSlider.value = 0;
                    shp_renderImportFrame(0);
                    shp_updateImportUI();
                } catch (err) {
                    alert("Error parsing SHP: " + err.message);
                }
            } catch (err) {
                // User cancelled the picker
                if (err.name !== 'AbortError') console.error(err);
            }
        } else {
            elements.inpImpShpFile.click();
        }
    };
    elements.inpImpShpFile.onchange = (e) => {
        if (!e.target.files.length) return;
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = async ev => {
            try {
                const buf = ev.target.result;
                impShpData = ShpFormat80.parse(buf);
                window.curImportShpData = impShpData;
                impShpData.filename = file.name;

                impShpFrameIdx = 0;
                shp_updateFrameLimits();
                elements.impShpSlider.value = 0;

                shp_renderImportFrame(0);
                shp_updateImportUI();
            } catch (err) {
                alert("Error parsing file: " + err.message);
            }
            elements.inpImpShpFile.value = '';
        };
        reader.readAsArrayBuffer(file);
    };

    const stepFrame = () => {
        if (!impShpData) return;
        const maxIdx = parseInt(elements.impShpSlider.max);
        impShpFrameIdx = (impShpFrameIdx + 1) > maxIdx ? 0 : impShpFrameIdx + 1;
        elements.impShpSlider.value = impShpFrameIdx;
        shp_renderImportFrame(impShpFrameIdx);
    };

    elements.btnImpShpStep.onclick = stepFrame;

    elements.impShpSlider.oninput = () => {
        if (!impShpData) return;
        impShpFrameIdx = parseInt(elements.impShpSlider.value);
        shp_renderImportFrame(impShpFrameIdx);
    };

    elements.btnImpShpPlay.onclick = () => {
        if (impShpTimer) {
            clearInterval(impShpTimer);
            impShpTimer = null;
            elements.btnImpShpPlay.innerHTML = SVG_PLAY;
        } else {
            impShpTimer = setInterval(stepFrame, 100);
            elements.btnImpShpPlay.innerHTML = SVG_PAUSE;
        }
    };

    elements.btnCancelImpShp.onclick = () => {
        shp_stopAnimation();
        elements.importShpDialog.close();
    };

    elements.btnConfirmImpShp.onclick = () => {
        if (onConfirm) onConfirm(impShpData, impShpPalette, _lastImpShpPaletteNodeId);
        shp_stopAnimation();
        elements.importShpDialog.close();
    };

    elements.chkImpShpNoShadow.onchange = () => {
        if (!impShpData) return;
        shp_updateFrameLimits();
        if (impShpFrameIdx > elements.impShpSlider.max) {
            impShpFrameIdx = 0;
            elements.impShpSlider.value = 0;
            shp_renderImportFrame(0);
        }
        shp_updateImportUI();
    };
}

export function syncImporterPalette(palette) {
    if (!palette) return;
    // Clone palette to avoid reference issues
    impShpPalette = palette.map(c => c ? { ...c } : null);
    shp_renderImportPalette();
    if (impShpData) shp_renderImportFrame(impShpFrameIdx);
    shp_updateImportUI();
}

export function resetImportState() {
    impShpData = null;
    impShpFrameIdx = 0;
    _lastImpShpPaletteNodeId = null;

    // Update button text/icon: restore active palette if one is loaded
    const el = document.getElementById('menuItemImpPalettes');
    if (el) {
        const activeId = getActivePaletteId();
        if (activeId) {
            const lib = getLib();
            const node = findNodeById(lib.custom, activeId);
            if (node) {
                updatePaletteSelectorUI('menuItemImpPalettes', node);
            }
        } else {
            const btn = el.querySelector('.menu-btn');
            if (btn) {
                let iconContainer = btn.querySelector('.menu-icon');
                if (iconContainer) iconContainer.innerText = '🎨';
                const nameSpan = btn.querySelector('span:not(.menu-icon):not(.arrow)');
                if (nameSpan) {
                    nameSpan.innerText = 'SELECT PALETTE';
                    nameSpan.setAttribute('data-i18n', 'btn_select_palette');
                }
            }
        }
    }

    // Clear Canvas
    if (elements.impShpCanvas) {
        const ctx = elements.impShpCanvas.getContext('2d');
        ctx.clearRect(0, 0, elements.impShpCanvas.width, elements.impShpCanvas.height);
    }
    if (elements.impShpCounter) elements.impShpCounter.innerText = "-/-";
    if (elements.impShpInfo) elements.impShpInfo.innerText = state.translations['lbl_no_file_loaded'] || "No file loaded";

    shp_updateImportUI();
}

function shp_updateFrameLimits() {
    if (!impShpData) return;
    const hideShadows = elements.chkImpShpNoShadow.checked;
    const total = impShpData.frames.length;
    const max = hideShadows ? Math.floor(total / 2) - 1 : total - 1;
    elements.impShpSlider.max = Math.max(0, max);
    // Update counter to reflect new max immediately
    const maxIdx = Math.max(0, max);
    elements.impShpCounter.innerText = `${impShpFrameIdx}/${maxIdx}`;
}

function shp_initImportGrid() {
    const grid = elements.impShpPalGrid;
    grid.innerHTML = '';
    for (let i = 0; i < 256; i++) {
        const d = document.createElement('div');
        d.className = 'pal-cell ' + (i % 2 === 0 ? 'empty-p1' : 'empty-p2');
        grid.appendChild(d);
    }
}

function shp_renderImportPalette() {
    const cells = elements.impShpPalGrid.children;
    for (let i = 0; i < 256; i++) {
        const c = impShpPalette[i];
        if (c) {
            cells[i].style.backgroundColor = `rgb(${c.r},${c.g},${c.b})`;
            cells[i].className = 'pal-cell used';
        } else {
            cells[i].style.backgroundColor = '';
            cells[i].className = 'pal-cell ' + (i % 2 === 0 ? 'empty-p1' : 'empty-p2');
        }
    }
}

function shp_clearImportPalette() {
    impShpPalette = new Array(256).fill(null);
    shp_renderImportPalette();
    if (impShpData) shp_renderImportFrame(impShpFrameIdx);
    shp_updateImportUI();
}

function shp_renderImportFrame(idx) {
    if (!impShpData) return;
    const f = impShpData.frames[idx];
    if (!f) return;

    const canvas = elements.impShpCanvas;
    const ctx = canvas.getContext('2d');

    if (canvas.width !== impShpData.width || canvas.height !== impShpData.height) {
        canvas.width = impShpData.width;
        canvas.height = impShpData.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const imgData = ctx.createImageData(canvas.width, canvas.height);
    const d = imgData.data;
    const indices = f.originalIndices;

    // Treat Index 0 as opaque background color from the palette for preview
    const bgCol = impShpPalette[0] || { r: 0, g: 0, b: 0 };
    for (let k = 0; k < d.length; k += 4) {
        d[k] = bgCol.r; d[k + 1] = bgCol.g; d[k + 2] = bgCol.b; d[k + 3] = 255;
    }

    const fw = f.width, fh = f.height, fx = f.x, fy = f.y;
    const gw = impShpData.width, gh = impShpData.height;

    for (let y = 0; y < fh; y++) {
        if (fy + y < 0 || fy + y >= gh) continue;
        const lineOffset = y * fw;
        const canvasLineOffset = (fy + y) * gw;

        for (let x = 0; x < fw; x++) {
            if (fx + x < 0 || fx + x >= gw) continue;
            const i = lineOffset + x;
            if (i >= indices.length) break;

            const colorIdx = indices[i];
            if (colorIdx === TRANSPARENT_COLOR) continue; // Skip transparent pixels

            const canvasIdx = (canvasLineOffset + fx + x) * 4;

            const c = impShpPalette[colorIdx];
            if (c) {
                d[canvasIdx] = c.r; d[canvasIdx + 1] = c.g; d[canvasIdx + 2] = c.b; d[canvasIdx + 3] = 255;
            } else {
                // Magenta for missing
                d[canvasIdx] = 255; d[canvasIdx + 1] = 0; d[canvasIdx + 2] = 255; d[canvasIdx + 3] = 255;
            }
        }
    }

    ctx.putImageData(imgData, 0, 0);

    const maxIdx = parseInt(elements.impShpSlider.max);
    elements.impShpCounter.innerText = `${idx}/${maxIdx}`;
    const compressionLbl = state.translations['lbl_compression'] || "Compression:";
    elements.impShpInfo.innerText = `${impShpData.filename} (${impShpData.width}x${impShpData.height}, ${impShpData.frames.length} frames, ${compressionLbl} ${f.compression})`;
}

function shp_updateImportUI() {
    // A palette is considered loaded if at least ONE color is not null
    const hasPal = impShpPalette && impShpPalette.some(c => c !== null);
    const hasData = !!impShpData;

    const btn = elements.btnConfirmImpShp;
    if (btn) {
        const canProceed = hasPal && hasData;

        if (canProceed) {
            btn.disabled = false;
            btn.removeAttribute('disabled');
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.style.pointerEvents = 'auto';
        } else {
            btn.disabled = true;
            btn.setAttribute('disabled', 'true');
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
            btn.style.pointerEvents = 'none';
        }
    }
}

function shp_stopAnimation() {
    if (impShpTimer) {
        clearInterval(impShpTimer);
        impShpTimer = null;
        elements.btnImpShpPlay.innerHTML = SVG_PLAY;
    }
}
