import { state } from './state.js';
import {
    compositeFrame,
    findNearestPaletteIndex,
    SVG_PLAY_MODERN,
    SVG_PAUSE_MODERN,
    SVG_STEP_BACK_MODERN,
    SVG_STEP_FWD_MODERN
} from './utils.js';
import { parsePaletteBuffer } from './file_io.js';
import {
    renderPaletteSimple,
    commitSelection,
    getFlatLayers,
    renderPalette,
    renderCanvas,
    renderFramesList,
    updateUIState
} from './ui.js';
import { pushHistory } from './history.js';
import {
    base64ToBuffer,
    updatePaletteSelectorUI,
    getLib,
    findNodeById,
    getActivePaletteId,
    setActivePaletteId,
    syncPaletteSelectorWithActiveTab,
    refreshPalettesMenuDynamic,
    recordUsage
} from './palette_menu.js';

let convDialog = null;
let targetPalette = null;
let targetPaletteNode = null;
let remapTable = null;
let previewFrameIdx = 0;
let playTimer = null;
let isInitialized = false;

function initConvertPaletteDialog() {
    if (isInitialized && convDialog) return;

    convDialog = document.getElementById('convertPaletteDialog');
    if (!convDialog) return;

    const btnPlay = document.getElementById('btnConvPlay');
    const btnPrev = document.getElementById('btnConvPrev');
    const btnNext = document.getElementById('btnConvNext');
    const slider = document.getElementById('convSlider');
    const chkNoShadow = document.getElementById('chkConvNoShadow');
    const btnConfirm = document.getElementById('btnConfirmConvPalette');
    const btnCancel = document.getElementById('btnCancelConvPalette');
    const btnLoadCustom = document.getElementById('btnConvLoadCustomPal');
    const inpPalFile = document.getElementById('inpConvPalFile');

    if (btnPlay) btnPlay.innerHTML = SVG_PLAY_MODERN;
    if (btnPrev) btnPrev.innerHTML = SVG_STEP_BACK_MODERN;
    if (btnNext) btnNext.innerHTML = SVG_STEP_FWD_MODERN;

    if (btnPlay) btnPlay.onclick = togglePlay;
    if (btnPrev) btnPrev.onclick = stepPrev;
    if (btnNext) btnNext.onclick = stepNext;

    if (slider) {
        slider.oninput = () => {
            previewFrameIdx = parseInt(slider.value) || 0;
            renderRemapPreview();
        };
    }

    if (chkNoShadow) {
        chkNoShadow.onchange = () => {
            updateFrameLimits();
            renderRemapPreview();
        };
    }

    if (btnConfirm) btnConfirm.onclick = onConfirm;
    if (btnCancel) btnCancel.onclick = closeDialog;

    if (btnLoadCustom && inpPalFile) {
        btnLoadCustom.onclick = () => {
            inpPalFile.value = '';
            inpPalFile.click();
        };
        inpPalFile.onchange = async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            try {
                const buf = await file.arrayBuffer();
                const pal = parsePaletteBuffer(buf);
                if (pal && pal.length === 256) {
                    setConvertTargetPalette(pal, { id: 'custom_file_' + Date.now(), name: file.name });
                } else {
                    alert(state.translations['msg_invalid_palette'] || "Invalid palette format");
                }
            } catch (err) {
                console.error("Error loading custom palette:", err);
                alert("Error loading palette: " + err.message);
            }
        };
    }

    convDialog.addEventListener('close', stopAnimation);
    convDialog.addEventListener('cancel', stopAnimation);

    isInitialized = true;
}

export function openConvertPaletteDialog() {
    if (!state.frames || state.frames.length === 0) return;
    if (state.floatingSelection && typeof commitSelection === 'function') {
        commitSelection();
    }

    initConvertPaletteDialog();
    stopAnimation();

    // 1. Current Palette (Left column)
    const srcGrid = document.getElementById('convPalSrcGrid');
    if (srcGrid) renderPaletteSimple(state.palette, srcGrid);

    const srcInfo = document.getElementById('convPalSrcInfo');
    if (srcInfo) {
        let name = state.translations['lbl_current_palette'] || 'Current Palette';
        const activeId = getActivePaletteId ? getActivePaletteId() : null;
        if (activeId) {
            const lib = getLib();
            const node = findNodeById(lib.custom, activeId);
            if (node) name = node.name;
        }
        srcInfo.innerText = name;
    }

    // 2. Target Palette (Center column)
    targetPalette = null;
    targetPaletteNode = null;
    remapTable = null;

    const tgtGrid = document.getElementById('convPalTgtGrid');
    if (tgtGrid) renderPaletteSimple(new Array(256).fill(null), tgtGrid);

    const tgtInfo = document.getElementById('convPalTgtInfo');
    if (tgtInfo) {
        tgtInfo.innerText = state.translations['msg_default_pal_loaded'] || "Select a palette";
    }

    // Reset selector button title
    const selMenu = document.getElementById('menuItemConvPalettes');
    if (selMenu) {
        const btn = selMenu.querySelector('.menu-btn');
        if (btn) {
            const nameSpan = btn.querySelector('span:not(.arrow)');
            if (nameSpan) {
                nameSpan.innerText = '🎨 ' + (state.translations['btn_select_palette'] || 'SELECT PALETTE');
            }
        }
    }

    const btnConfirm = document.getElementById('btnConfirmConvPalette');
    if (btnConfirm) btnConfirm.disabled = true;

    // 3. Playback limits & preview (Right column)
    previewFrameIdx = Math.max(0, Math.min(state.currentFrameIdx, state.frames.length - 1));

    const chkNoShadow = document.getElementById('chkConvNoShadow');
    if (chkNoShadow) {
        const canShadow = state.frames.length > 0 && (state.frames.length % 2 === 0);
        chkNoShadow.disabled = !canShadow;
        chkNoShadow.parentElement.style.opacity = canShadow ? "1" : "0.5";
        chkNoShadow.checked = false;
    }

    updateFrameLimits();
    renderRemapPreview();

    if (convDialog) {
        if (typeof convDialog.showModal === 'function') convDialog.showModal();
        else convDialog.setAttribute('open', '');
    }
}

export function setConvertTargetPalette(palArray, node) {
    if (!palArray || palArray.length < 256) return;
    targetPalette = palArray.map(c => c ? { ...c } : null);
    targetPaletteNode = node;

    // Update center column UI
    updatePaletteSelectorUI('menuItemConvPalettes', node);
    const tgtGrid = document.getElementById('convPalTgtGrid');
    if (tgtGrid) renderPaletteSimple(targetPalette, tgtGrid);

    const tgtInfo = document.getElementById('convPalTgtInfo');
    if (tgtInfo && node) tgtInfo.innerText = node.name;

    // Build remap table: map each index of state.palette to closest index in targetPalette
    remapTable = new Uint8Array(256);
    const skipIdx = state.isAlphaImageMode ? 127 : 0;
    remapTable[skipIdx] = skipIdx;

    for (let i = 0; i < 256; i++) {
        if (i === skipIdx) continue;
        const c = state.palette[i];
        if (!c) {
            remapTable[i] = 0;
        } else {
            remapTable[i] = findNearestPaletteIndex(c.r, c.g, c.b, targetPalette);
        }
    }

    // Enable confirm button
    const btnConfirm = document.getElementById('btnConfirmConvPalette');
    if (btnConfirm) btnConfirm.disabled = false;

    // Re-render preview with remapped palette
    renderRemapPreview();
}

function updateFrameLimits() {
    const slider = document.getElementById('convSlider');
    const counter = document.getElementById('convCounter');
    const chkNoShadow = document.getElementById('chkConvNoShadow');
    if (!slider) return;

    const total = state.frames.length;
    const hideShadow = chkNoShadow && chkNoShadow.checked && (total % 2 === 0);
    const max = hideShadow ? Math.floor(total / 2) - 1 : total - 1;
    slider.max = Math.max(0, max);

    if (previewFrameIdx > max) previewFrameIdx = 0;
    slider.value = previewFrameIdx;

    if (counter) {
        counter.innerText = `${previewFrameIdx + 1} / ${max + 1}`;
    }
}

function renderRemapPreview() {
    const frame = state.frames[previewFrameIdx];
    if (!frame) return;

    const canvas = document.getElementById('convPreviewCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
    }

    const res = compositeFrame(frame, {
        transparentIdx: 65535,
        backgroundIdx: 65535,
        showIndex0: false,
        includeExternalShp: false
    });

    const imgData = ctx.createImageData(frame.width, frame.height);
    const d = imgData.data;
    const pal = targetPalette || state.palette;
    const isAlpha = state.isAlphaImageMode;

    for (let i = 0; i < res.length; i++) {
        const idx = res[i];
        const off = i * 4;
        if (idx === 65535 || (idx === 0 && !isAlpha) || (idx === 127 && isAlpha)) {
            d[off + 3] = 0; // Transparent
        } else {
            const mappedIdx = (remapTable && targetPalette) ? remapTable[idx] : idx;
            const c = pal[mappedIdx] || { r: 0, g: 0, b: 0 };
            d[off] = c.r;
            d[off + 1] = c.g;
            d[off + 2] = c.b;
            d[off + 3] = 255;
        }
    }

    ctx.putImageData(imgData, 0, 0);

    const slider = document.getElementById('convSlider');
    const counter = document.getElementById('convCounter');
    if (slider) slider.value = previewFrameIdx;
    if (counter) {
        const max = slider ? parseInt(slider.max) : 0;
        counter.innerText = `${previewFrameIdx + 1} / ${max + 1}`;
    }
}

function stepNext() {
    const slider = document.getElementById('convSlider');
    if (!slider) return;
    const max = parseInt(slider.max) || 0;
    previewFrameIdx = (previewFrameIdx + 1) > max ? 0 : previewFrameIdx + 1;
    renderRemapPreview();
}

function stepPrev() {
    const slider = document.getElementById('convSlider');
    if (!slider) return;
    const max = parseInt(slider.max) || 0;
    previewFrameIdx = (previewFrameIdx - 1) < 0 ? max : previewFrameIdx - 1;
    renderRemapPreview();
}

function togglePlay() {
    const btnPlay = document.getElementById('btnConvPlay');
    if (playTimer) {
        stopAnimation();
    } else {
        playTimer = setInterval(stepNext, 100);
        if (btnPlay) btnPlay.innerHTML = SVG_PAUSE_MODERN;
    }
}

function stopAnimation() {
    if (playTimer) {
        clearInterval(playTimer);
        playTimer = null;
    }
    const btnPlay = document.getElementById('btnConvPlay');
    if (btnPlay) btnPlay.innerHTML = SVG_PLAY_MODERN;
}

function onConfirm() {
    if (!targetPalette || !remapTable) return;
    stopAnimation();
    pushHistory();

    // Remap all layer pixels across all frames
    for (let fi = 0; fi < state.frames.length; fi++) {
        const frame = state.frames[fi];
        if (state.isTmpMode && frame.tmpMeta) {
            const comp = frame.tmpMeta.component;
            if (comp === 'zdata' || comp === 'extrazdata') continue;
        }
        const flatLayers = getFlatLayers(frame.layers);
        for (let li = 0; li < flatLayers.length; li++) {
            const layer = flatLayers[li];
            if (layer && layer.data) {
                let layerAffected = false;
                for (let k = 0; k < layer.data.length; k++) {
                    const old = layer.data[k];
                    if (old !== undefined && old < 256) {
                        layer.data[k] = remapTable[old];
                        layerAffected = true;
                    }
                }
                if (layerAffected) {
                    layer._v = (layer._v || 0) + 1;
                }
            }
        }
    }

    // Assign new palette
    state.palette = targetPalette.map(c => c ? { ...c } : null);
    state.paletteVersion = (state.paletteVersion || 0) + 1;

    const newPalId = targetPaletteNode && targetPaletteNode.id ? targetPaletteNode.id : null;
    state.appliedPaletteId = newPalId;
    state.paletteSelectedManually = true;
    if (typeof setActivePaletteId === 'function') {
        setActivePaletteId(newPalId);
    }

    // Sync active tab
    if (state.activeTabIndex >= 0 && state.tabs[state.activeTabIndex]) {
        const curTab = state.tabs[state.activeTabIndex];
        curTab.palette = state.palette.map(c => c ? { ...c } : null);
        curTab.appliedPaletteId = newPalId;
        curTab.paletteSelectedManually = true;
    }

    if (targetPaletteNode && typeof recordUsage === 'function' && targetPaletteNode.id && !targetPaletteNode.id.startsWith('custom_file_')) {
        recordUsage(targetPaletteNode);
    }

    if (typeof syncPaletteSelectorWithActiveTab === 'function') {
        syncPaletteSelectorWithActiveTab();
    }
    if (typeof refreshPalettesMenuDynamic === 'function') {
        refreshPalettesMenuDynamic();
    }

    pushHistory('all');
    renderPalette();
    renderCanvas();
    renderFramesList();
    updateUIState();

    closeDialog();
}

function closeDialog() {
    stopAnimation();
    if (convDialog) {
        if (typeof convDialog.close === 'function') convDialog.close();
        else convDialog.removeAttribute('open');
    }
}

// Global hooks
window.onConvertPaletteSelected = setConvertTargetPalette;
window.openConvertPaletteDialog = openConvertPaletteDialog;
