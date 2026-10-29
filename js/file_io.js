import { state, generateId, TRANSPARENT_COLOR } from './state.js';
import { elements } from './constants.js';
import { ShpFormat80 } from './shp_format.js';
import { TmpTsFile } from './tmp_format.js';
import { renderCanvas, renderFramesList, renderTmpComponentsList, updateLayersList, updateCanvasSize, renderPalette, renderPaletteSimple, createNewProject, showEditorInterface, resetFramesList, renderFrameManager, getActiveLayer, showChoice, showConfirm, renderOverlay, showPasteNotification, commitSelection, syncStatusCompressionUI } from './ui.js';
import { pushHistory } from './history.js';
import { findNearestPaletteIndex, quantizeInfurium, getActivePalette } from './utils.js';
import { PcxLoader } from './pcx_loader.js';
import { exportFrameList, encodeFramesToShpBuffer, downloadFileAsBlob } from './export_helper.js';
import { t } from './translations.js';
import { isNativeApp, nativeReadFile, nativeWriteFile, nativeOpenFileDialog, nativeSaveFileDialog, nativeGetFileModifiedTime, nativeResolveDroppedFiles } from './native_bridge.js';
import { getRecentFilePathByName } from './menu_handlers.js';
import { createNewTab, updateCurrentTabName, renderTabs } from './tabs.js';
import { getDefaultDialogPaletteNode, updatePaletteSelectorUI, setActivePaletteId, recordUsage, syncPaletteSelector, closeAllPaletteMenus, base64ToBuffer, registerCustomPaletteNode } from './palette_menu.js';
import { updateUIState } from './main.js';

export function populateTabWithShpData(tab, shp) {
    if (!tab || !shp) return;
    tab.isTmpMode = false;
    tab.tmpHeader = null;
    tab.originalTmpTiles = null;
    tab.tmpFilename = null;
    tab.tmpFullZPreviewActive = false;
    tab.isoGrid = 'none';
    tab.useShadows = false;
    tab.showShadowOverlay = false;
    tab.isAlphaImageMode = false;
    tab.selection = null;
    tab.floatingSelection = null;
    tab.fmSplitActive = false;
    tab.fmNewFrames = [];
    tab.fmActiveSection = 'original';

    const sw = shp.width;
    const sh = shp.height;
    const totalPixels = sw * sh;

    tab.frames = shp.frames.map(f => {
        let fullData;
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

    tab.shpFormat = shp.formatType || 'ts_ra2';
    if (tab.frames.length > 0) {
        const comp = tab.frames[0].compression;
        let normalizedComp;
        if (tab.shpFormat === 'td_ra') {
            normalizedComp = (comp === 0) ? 0 : ((comp === 4 || comp === 40 || comp === 2) ? 40 : 80);
        } else {
            normalizedComp = (comp === 1 || comp === 0) ? 1 : 3;
        }
        tab.compression = normalizedComp;
    }

    tab.canvasW = sw;
    tab.canvasH = sh;
    tab.currentFrameIdx = 0;

    if (tab.frames.length > 0 && tab.frames[0].layers.length > 0) {
        tab.activeLayerId = tab.frames[0].layers[0].id;
    }
}

export function loadShpData(shp) {
    document.body.classList.remove('tmp-mode');
    document.body.classList.remove('picking-mode');
    
    // Reset Game Grid state and sync controls
    const cbIsoGrid = document.getElementById('cbIsoGrid');
    if (cbIsoGrid) cbIsoGrid.checked = false;
    const selIsoGrid = document.getElementById('selIsoGrid');
    if (selIsoGrid) selIsoGrid.value = 'none';

    // Reset Replace Feature settings
    state.replacePairs = [];
    state.replaceSelection = new Set();
    state.isPickingForReplace = null;
    state.isPreviewingReplacement = false;
    state.isReplacePreviewActive = false;
    if (elements.btnPickReplaceSrc) elements.btnPickReplaceSrc.classList.remove('picker-active');
    if (elements.btnPickReplaceTgt) elements.btnPickReplaceTgt.classList.remove('picker-active');

    console.time("SHP Initialization");
    resetFramesList();

    const activeTab = (state.activeTabIndex >= 0 && state.tabs[state.activeTabIndex]) ? state.tabs[state.activeTabIndex] : null;
    populateTabWithShpData(state, shp);
    if (activeTab) {
        populateTabWithShpData(activeTab, shp);
    }

    if (elements.selExpShpType) elements.selExpShpType.value = (state.compression !== undefined ? state.compression : 3).toString();
    syncStatusCompressionUI();

    renderFrameManager();
    updateCanvasSize();
    renderFramesList();
    updateLayersList();
    renderCanvas();
    showEditorInterface();
    if (typeof window.updateUIState === 'function') window.updateUIState();

    console.timeEnd("SHP Initialization");
}

export function parsePaletteBuffer(buffer) {
    const palette = Array.from({ length: 256 }, () => ({r:0, g:0, b:0}));

    // Try to decode as text first to check for JASC
    const txt = new TextDecoder().decode(buffer);

    if (txt.startsWith("JASC-PAL")) {
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
    } else if (buffer.byteLength === 768) {
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
    } else {
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
            if (state.shpFormat === 'td_ra') {
                const hasDelta = state.frames.some(f => f.compression === 4 || f.compression === 2 || f.formatCode === 4 || f.formatCode === 2 || f.classicFormat === 4 || f.classicFormat === 2);
                elements.selExpShpType.innerHTML = `
                    <option value="80">${t('opt_compression_80') || 'Format 80 (LCW)'}</option>
                    ${hasDelta ? `<option value="40">${t('opt_compression_40') || 'Format 40 (XOR Delta)'}</option>` : ''}
                    <option value="0">${t('opt_compression_0') || 'Format 0 (Uncompressed)'}</option>
                `;
                const cur = (state.compression === 0) ? "0" : ((hasDelta && (state.compression === 4 || state.compression === 40 || state.compression === 2)) ? "40" : "80");
                elements.selExpShpType.value = cur;
                elements.selExpShpType.disabled = false;
                elements.selExpShpType.title = t('tooltip_compression_td_ra') || "Compression: Tiberian Dawn / Red Alert 1 Format";
            } else {
                elements.selExpShpType.innerHTML = `
                    <option value="1">${t('opt_compression_1') || 'Type 1 (Uncompressed)'}</option>
                    <option value="3">${t('opt_compression_3') || 'Type 3 (RLE)'}</option>
                `;
                if (state.isAlphaImageMode) {
                    elements.selExpShpType.value = "1";
                    elements.selExpShpType.disabled = true;
                    elements.selExpShpType.title = t('tooltip_compression_alpha_locked') || "Alpha Image Mode requires Compression 1";
                } else {
                    elements.selExpShpType.value = (state.compression === 1 || state.compression === 0) ? "1" : "3";
                    elements.selExpShpType.disabled = false;
                    elements.selExpShpType.title = "";
                }
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

        // Determine display scale (max 260x200 CSS px in physical pixels)
        const dpr = window.devicePixelRatio || 1;
        const maxPhysW = Math.round(260 * dpr);
        const maxPhysH = Math.round(200 * dpr);
        const scale = Math.min(Math.floor(maxPhysW / w), Math.floor(maxPhysH / h), 8) || 1;
        canvas.width = w * scale;
        canvas.height = h * scale;
        canvas.style.width = ((w * scale) / dpr) + 'px';
        canvas.style.height = ((h * scale) / dpr) + 'px';
        canvas.style.boxSizing = 'content-box';

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
        return !state.hasChanges;
    }

    const curTab = (state.activeTabIndex >= 0 && state.tabs[state.activeTabIndex])
        ? state.tabs[state.activeTabIndex]
        : null;
    const compression = state.compression !== undefined ? state.compression : 3;

    // Native Desktop mode (Tauri - zero permission alerts)
    if (isNativeApp()) {
        let filePath = (curTab && curTab.filePath) || state.filePath || window._lastShpFilePath;
        if (!filePath && curTab && curTab.fileName && !curTab.isNewProject) {
            try {
                const resolved = await nativeResolveDroppedFiles([{
                    name: curTab.fileName,
                    size: curTab.fileSize || 0,
                    lastModified: curTab.fileLastModified || 0
                }]);
                if (resolved && resolved[0]) {
                    filePath = resolved[0];
                    curTab.filePath = filePath;
                    state.filePath = filePath;
                    window._lastShpFilePath = filePath;
                }
            } catch (e) {}
            if (!filePath) {
                const recentPath = await getRecentFilePathByName(curTab.fileName);
                if (recentPath) {
                    try {
                        const mtime = await nativeGetFileModifiedTime(recentPath);
                        if (mtime !== null && mtime !== undefined) {
                            filePath = recentPath;
                            curTab.filePath = filePath;
                            state.filePath = filePath;
                            window._lastShpFilePath = filePath;
                        }
                    } catch (e) {}
                }
            }
            if (!filePath) {
                const lastDir = window._lastNativeDirectory || localStorage.getItem('last_native_directory');
                if (lastDir) {
                    const candidate = lastDir.replace(/[/\\]+$/, '') + '\\' + curTab.fileName;
                    try {
                        const mtime = await nativeGetFileModifiedTime(candidate);
                        if (mtime !== null && mtime !== undefined) {
                            filePath = candidate;
                            curTab.filePath = filePath;
                            state.filePath = filePath;
                            window._lastShpFilePath = filePath;
                        }
                    } catch (e) {}
                }
            }
        }
        if (filePath) {
            const buf = encodeFramesToShpBuffer(state.frames, compression, state.isAlphaImageMode, state.shpFormat);
            try {
                await nativeWriteFile(filePath, buf);
                const mtime = await nativeGetFileModifiedTime(filePath);
                if (curTab) {
                    curTab.filePath = filePath;
                    curTab.hasChanges = false;
                    curTab.savedHistoryPtr = state.historyPtr;
                    curTab.fileLastModified = mtime;
                    curTab.isNewProject = false;
                }
                state.filePath = filePath;
                state.savedHistoryPtr = state.historyPtr;
                state.hasChanges = false;
                state.fileLastModified = mtime;
                window._lastShpFilePath = filePath;
                const dir = filePath.substring(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
                if (dir) {
                    window._lastNativeDirectory = dir;
                    try { localStorage.setItem('last_native_directory', dir); } catch (e) {}
                }
                if (window.renderTabs) window.renderTabs();
                const filename = filePath.split(/[/\\]/).pop();
                showPasteNotification(`✅ Saved: ${filename}`, 'success', 2500);
                return true;
            } catch (err) {
                console.error('[Native Save] Error writing file:', err);
                alert(`Error saving file: ${err}`);
                return false;
            }
        } else {
            return await handleSaveAsShp();
        }
    }

    // Web browser mode (File System Access API)
    const activeHandle = (curTab && curTab.fileHandle) ? curTab.fileHandle : (state.fileHandle || window._lastShpFileHandle);

    if (activeHandle && window.showSaveFilePicker) {
        // Quick save over existing file
        const filename = activeHandle.name;
        // Fetch compression from state, defaulting to 3
        const compression = state.compression !== undefined ? state.compression : 3;
        const newHandle = await exportFrameList(filename, state.frames, compression, activeHandle);
        if (newHandle) {
            if (curTab) {
                curTab.fileHandle = newHandle;
                curTab.hasChanges = false;
                curTab.savedHistoryPtr = state.historyPtr;
            }
            state.fileHandle = newHandle;
            window._lastShpFileHandle = newHandle;
            window._lastShpFilename = filename;
            state.savedHistoryPtr = state.historyPtr;
            state.hasChanges = false;
            if (window.renderTabs) window.renderTabs();
            showPasteNotification(`✅ Saved: ${filename}`, 'success', 2500);
            return true;
        }
        return false;
    } else if (window.showSaveFilePicker) {
        // In Chrome with no existing handle: directly open native OS save file picker!
        return await handleSaveAsShp();
    } else {
        // Fallback for browsers without File System Access API (e.g. Firefox)
        showExportDialog();
        return false;
    }
}

export async function handleSaveAsShp() {
    commitSelection();
    if (state.isTmpMode) {
        await saveTmpData(true);
        return !state.hasChanges;
    }

    const curTab = (state.activeTabIndex >= 0 && state.tabs[state.activeTabIndex])
        ? state.tabs[state.activeTabIndex]
        : null;

    let defaultName = (curTab && curTab.fileName) || (curTab && curTab.idName) || window._lastShpFilename || "output.shp";
    if (!defaultName.includes('.')) defaultName += '.shp';
    const compression = state.compression !== undefined ? state.compression : 3;

    // Native Desktop mode (Tauri)
    if (isNativeApp()) {
        const ext = defaultName.split('.').pop().toLowerCase();
        const filters = (ext === 'sha')
            ? [
                { name: 'Red Alert 2 Cursor SHP (*.sha)', extensions: ['sha'] },
                { name: 'Westwood SHP (*.shp)', extensions: ['shp'] }
            ]
            : [
                { name: 'Command & Conquer SHP (*.shp, *.sha)', extensions: ['shp', 'sha'] }
            ];

        const chosenPath = await nativeSaveFileDialog({
            defaultName,
            title: 'Save SHP File',
            filters
        });
        if (!chosenPath) return false;

        const buf = encodeFramesToShpBuffer(state.frames, compression, state.isAlphaImageMode, state.shpFormat);
        try {
            await nativeWriteFile(chosenPath, buf);
            const mtime = await nativeGetFileModifiedTime(chosenPath);
            const filename = chosenPath.split(/[/\\]/).pop();
            if (curTab) {
                curTab.filePath = chosenPath;
                curTab.fileName = filename;
                curTab.hasChanges = false;
                curTab.savedHistoryPtr = state.historyPtr;
                curTab.fileLastModified = mtime;
            }
            state.filePath = chosenPath;
            state.fileHandle = null;
            state.savedHistoryPtr = state.historyPtr;
            state.hasChanges = false;
            state.fileLastModified = mtime;
            window._lastShpFilePath = chosenPath;
            window._lastShpFilename = filename;
            if (typeof updateCurrentTabName === 'function') updateCurrentTabName(filename);
            if (typeof window.saveRecentFile === 'function') window.saveRecentFile(filename, chosenPath);
            if (window.renderTabs) window.renderTabs();
            showPasteNotification(`✅ Saved as: ${filename}`, 'success', 2500);
            return true;
        } catch (err) {
            console.error('[Native Save As] Error:', err);
            alert(`Error saving file: ${err}`);
            return false;
        }
    }

    // Web browser mode (File System Access API)
    const newHandle = await exportFrameList(defaultName, state.frames, compression, null);
    if (newHandle) {
        if (curTab) {
            curTab.fileHandle = newHandle;
            curTab.fileName = newHandle.name;
            curTab.hasChanges = false;
            curTab.savedHistoryPtr = state.historyPtr;
        }
        state.fileHandle = newHandle;
        window._lastShpFileHandle = newHandle;
        window._lastShpFilename = newHandle.name;
        state.savedHistoryPtr = state.historyPtr;
        state.hasChanges = false;
        if (typeof updateCurrentTabName === 'function') updateCurrentTabName(newHandle.name);
        if (typeof window.saveRecentFile === 'function') window.saveRecentFile(newHandle.name, newHandle);
        if (window.renderTabs) window.renderTabs();
        showPasteNotification(`✅ Saved as: ${newHandle.name}`, 'success', 2500);
        return true;
    }
    return false;
}

export async function handleSaveAll() {
    commitSelection();
    if (!state.tabs || state.tabs.length === 0) return;

    // Persist active tab before iterating
    const originalActive = state.activeTabIndex;
    if (originalActive >= 0 && state.tabs[originalActive]) {
        state.saveToTab(state.tabs[originalActive]);
    }

    const dialog = document.getElementById('saveAllDialog');
    const fileListEl = document.getElementById('saveAllFileList');
    const btnCancel = document.getElementById('btnCancelSaveAll');
    const btnConfirm = document.getElementById('btnConfirmSaveAll');
    const btnSaveAllZip = document.getElementById('btnSaveAllZip');
    const btnSaveAllToFolder = document.getElementById('btnSaveAllToFolder');
    const progressContainer = document.getElementById('saveAllProgressContainer');
    const progressFill = document.getElementById('saveAllProgressFill');
    const progressText = document.getElementById('saveAllProgressText');
    const progressPercent = document.getElementById('saveAllProgressPercent');
    const t = state.translations || {};

    // Helper to encode a tab (SHP or TMP) into a Uint8Array
    function encodeTabToBuffer(tab, index) {
        if (tab.isTmpMode) {
            state.activeTabIndex = index;
            state.loadFromTab(tab);
            const tiles = getCurrentEditedTiles();
            if (!tiles || !state.tmpHeader) return null;
            return TmpTsFile.encode({ header: state.tmpHeader, tiles });
        } else {
            const compression = tab.compression !== undefined ? tab.compression : (state.compression !== undefined ? state.compression : (tab.shpFormat === 'td_ra' ? 80 : 3));
            return encodeFramesToShpBuffer(tab.frames, compression, tab.isAlphaImageMode, tab.shpFormat);
        }
    }

    function updateProgress(current, total) {
        if (!progressContainer || !progressFill || !progressText || !progressPercent) return;
        progressContainer.style.display = 'block';
        const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 100;
        progressFill.style.width = pct + '%';
        progressText.textContent = (t.lbl_save_all_progress || 'Saving {current} of {total}...')
            .replace('{current}', String(current))
            .replace('{total}', String(total));
        progressPercent.textContent = pct + '%';
    }

    // Fallback if DOM dialog is missing
    if (!dialog || !fileListEl || !btnConfirm || !btnCancel) {
        let savedCount = 0;
        for (let i = 0; i < state.tabs.length; i++) {
            const tab = state.tabs[i];
            const hasBacking = Boolean(tab.fileHandle || tab.filePath);
            if (!tab.hasChanges && hasBacking) continue;
            state.activeTabIndex = i;
            state.loadFromTab(tab);
            let ok = tab.isTmpMode ? (await saveTmpData(false), !state.hasChanges) : await handleSaveShp();
            state.saveToTab(tab);
            if (ok) savedCount++;
        }
        if (originalActive >= 0 && originalActive < state.tabs.length) {
            state.activeTabIndex = originalActive;
            state.loadFromTab(state.tabs[originalActive]);
        }
        if (window.renderTabs) window.renderTabs();
        return;
    }

    // Reset progress UI
    if (progressContainer) progressContainer.style.display = 'none';
    if (progressFill) progressFill.style.width = '0%';

    // Build the list of open files
    fileListEl.innerHTML = '';
    const modifiedIndices = [];

    state.tabs.forEach((tab, i) => {
        const filename = tab.fileName || tab.idName || (tab.isTmpMode ? 'Untitled.tem' : 'Untitled.shp');
        const hasBacking = Boolean(tab.fileHandle || tab.filePath);
        const isModified = Boolean(tab.hasChanges || (!hasBacking && (tab.isTmpMode ? tab.originalTmpTiles : (tab.frames && tab.frames.length > 0))));
        if (isModified) modifiedIndices.push(i);

        let badgeClass = 'badge-clean';
        let badgeText = t.lbl_file_status_clean || 'Up to date';

        if (!hasBacking) {
            badgeClass = 'badge-new';
            badgeText = t.lbl_file_status_new || 'New (Unsaved)';
        } else if (isModified) {
            badgeClass = 'badge-modified';
            badgeText = t.lbl_file_status_modified || 'Modified';
        }

        const row = document.createElement('div');
        row.className = 'save-all-item';
        row.id = `saveAllItem_${i}`;
        row.innerHTML = `
            <div class="save-all-item-left">
                <span class="save-all-type-tag ${tab.isTmpMode ? 'tmp-tag' : ''}">${tab.isTmpMode ? 'TMP' : 'SHP'}</span>
                <span class="save-all-filename" title="${filename}">${filename}</span>
            </div>
            <div class="save-all-item-right">
                <span class="save-all-badge ${badgeClass}" id="saveAllBadge_${i}">${badgeText}</span>
                <span class="save-all-action-slot" id="saveAllActionSlot_${i}"></span>
            </div>
        `;
        fileListEl.appendChild(row);
    });

    btnConfirm.disabled = false;
    btnCancel.disabled = false;
    btnConfirm.classList.remove('btn-continue-pulse');
    btnConfirm.textContent = t.btn_save_all || 'SAVE ALL';

    if (btnSaveAllZip) {
        btnSaveAllZip.disabled = false;
        btnSaveAllZip.textContent = t.btn_save_all_zip || '📦 ZIP';
    }

    if (btnSaveAllToFolder) {
        btnSaveAllToFolder.disabled = false;
        btnSaveAllToFolder.textContent = t.btn_save_all_folder || '📁 Save to Folder...';
        btnSaveAllToFolder.style.display = window.showDirectoryPicker ? 'inline-flex' : 'none';
    }

    // Show dialog
    if (typeof dialog.showModal === 'function') {
        if (!dialog.open) dialog.showModal();
    } else {
        dialog.setAttribute('open', '');
    }

    return new Promise((resolve) => {
        const cleanup = () => {
            btnCancel.onclick = null;
            btnConfirm.onclick = null;
            btnConfirm.classList.remove('btn-continue-pulse');
            if (btnSaveAllZip) btnSaveAllZip.onclick = null;
            if (btnSaveAllToFolder) btnSaveAllToFolder.onclick = null;

            if (typeof dialog.close === 'function') dialog.close();
            else dialog.removeAttribute('open');

            // Restore original active tab
            if (originalActive >= 0 && originalActive < state.tabs.length) {
                state.activeTabIndex = originalActive;
                state.loadFromTab(state.tabs[originalActive]);
                state.fileHandle = state.tabs[originalActive].fileHandle || null;
                window._lastShpFileHandle = state.tabs[originalActive].fileHandle || null;
                window._lastShpFilename = state.tabs[originalActive].fileName || null;
            }
            if (window.renderTabs) window.renderTabs();
            if (typeof updateUIState === 'function') updateUIState();
            if (typeof renderCanvas === 'function') renderCanvas();
        };

        btnCancel.onclick = () => {
            cleanup();
            resolve(false);
        };

        // --- Option 1: Save All to a Single Selected Folder ---
        if (btnSaveAllToFolder) {
            btnSaveAllToFolder.onclick = async () => {
                try {
                    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                    if (!dirHandle) return;

                    btnConfirm.disabled = true;
                    btnCancel.disabled = true;
                    btnSaveAllZip.disabled = true;
                    btnSaveAllToFolder.disabled = true;
                    btnSaveAllToFolder.textContent = '⏳ ...';

                    const tabsToSave = modifiedIndices.length > 0 ? modifiedIndices : state.tabs.map((_, idx) => idx);
                    let folderSaved = 0;

                    for (const idx of tabsToSave) {
                        const tab = state.tabs[idx];
                        const filename = tab.fileName || tab.idName || (tab.isTmpMode ? `file_${idx + 1}.tem` : `file_${idx + 1}.shp`);
                        const badge = document.getElementById(`saveAllBadge_${idx}`);

                        if (badge) {
                            badge.className = 'save-all-badge badge-saving';
                            badge.textContent = '⏳ ...';
                        }

                        const u8 = encodeTabToBuffer(tab, idx);
                        if (u8) {
                            const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
                            const writable = await fileHandle.createWritable();
                            const blob = new Blob([u8], { type: 'application/octet-stream' });
                            await writable.write(blob);
                            await writable.close();

                            tab.fileHandle = fileHandle;
                            tab.fileName = filename;
                            tab.hasChanges = false;
                            folderSaved++;
                        }

                        if (badge) {
                            badge.className = 'save-all-badge badge-saved';
                            badge.textContent = '✅ ' + (t.lbl_save_status_saved || 'Saved');
                        }
                        updateProgress(folderSaved, tabsToSave.length);
                    }

                    setTimeout(() => {
                        cleanup();
                        const msg = (t.msg_save_all_folder_success || '✅ Saved {count} file(s) to folder successfully').replace('{count}', String(folderSaved));
                        showPasteNotification(msg, 'success', 3000);
                        resolve(true);
                    }, 500);
                } catch (dErr) {
                    if (dErr.name !== 'AbortError') {
                        console.error('Save to folder error:', dErr);
                        showPasteNotification('Folder save error: ' + dErr.message, 'error', 3000);
                    }
                    btnConfirm.disabled = false;
                    btnCancel.disabled = false;
                    if (btnSaveAllZip) btnSaveAllZip.disabled = false;
                    btnSaveAllToFolder.disabled = false;
                    btnSaveAllToFolder.textContent = t.btn_save_all_folder || '📁 Save to Folder...';
                }
            };
        }

        // --- Option 2: Download All Modified Files as a single ZIP ---
        if (btnSaveAllZip) {
            btnSaveAllZip.onclick = async () => {
                try {
                    const ZipClass = (typeof MiniZip !== 'undefined') ? MiniZip : (window.MiniZip || null);
                    if (!ZipClass) {
                        showPasteNotification('ZIP utility unavailable', 'error', 2500);
                        return;
                    }

                    btnConfirm.disabled = true;
                    btnCancel.disabled = true;
                    btnSaveAllZip.disabled = true;
                    if (btnSaveAllToFolder) btnSaveAllToFolder.disabled = true;
                    btnSaveAllZip.textContent = '⏳ ...';

                    const tabsToSave = modifiedIndices.length > 0 ? modifiedIndices : state.tabs.map((_, idx) => idx);
                    const zip = new ZipClass();

                    for (const idx of tabsToSave) {
                        const tab = state.tabs[idx];
                        const filename = tab.fileName || tab.idName || (tab.isTmpMode ? `file_${idx + 1}.tem` : `file_${idx + 1}.shp`);
                        const u8 = encodeTabToBuffer(tab, idx);
                        if (u8) zip.add(filename, u8);

                        tab.hasChanges = false;
                        const badge = document.getElementById(`saveAllBadge_${idx}`);
                        if (badge) {
                            badge.className = 'save-all-badge badge-saved';
                            badge.textContent = '📦 ' + (t.lbl_save_status_saved || 'Saved');
                        }
                    }

                    const dateStr = new Date().toISOString().slice(0, 10);
                    const zipBlob = zip.generate();
                    const zipU8 = new Uint8Array(await zipBlob.arrayBuffer());
                    downloadFileAsBlob(`shp_backup_${dateStr}.zip`, zipU8);

                    setTimeout(() => {
                        cleanup();
                        const msg = (t.msg_save_all_zip_success || '📦 Packaged and downloaded {count} file(s) in ZIP').replace('{count}', String(tabsToSave.length));
                        showPasteNotification(msg, 'success', 3000);
                        resolve(true);
                    }, 600);
                } catch (zErr) {
                    console.error('ZIP packaging failed:', zErr);
                    showPasteNotification('ZIP failed: ' + zErr.message, 'error', 3000);
                    btnConfirm.disabled = false;
                    btnCancel.disabled = false;
                    btnSaveAllZip.disabled = false;
                    if (btnSaveAllToFolder) btnSaveAllToFolder.disabled = false;
                    btnSaveAllZip.textContent = t.btn_save_all_zip || '📦 ZIP';
                }
            };
        }

        // --- Option 3: Continuous Overwrite to Original Disk Files ---
        let savedCount = 0;
        const totalToSave = modifiedIndices.length;

        async function runContinuousSave() {
            btnConfirm.disabled = true;
            btnCancel.disabled = true;
            btnConfirm.classList.remove('btn-continue-pulse');
            btnConfirm.textContent = '⏳ ...';
            if (btnSaveAllZip) btnSaveAllZip.disabled = true;
            if (btnSaveAllToFolder) btnSaveAllToFolder.disabled = true;

            if (totalToSave > 0) {
                updateProgress(savedCount, totalToSave);
            }

            // Native Fast Pass: direct save any tab that has a filePath (or can resolve one)
            if (isNativeApp()) {
                for (const idx of modifiedIndices) {
                    const tab = state.tabs[idx];
                    let filePath = tab.filePath;
                    if (!filePath && tab.fileName && !tab.isNewProject) {
                        try {
                            const resolved = await nativeResolveDroppedFiles([{
                                name: tab.fileName,
                                size: tab.fileSize || 0,
                                lastModified: tab.fileLastModified || 0
                            }]);
                            if (resolved && resolved[0]) {
                                filePath = resolved[0];
                                tab.filePath = filePath;
                                tab.isNewProject = false;
                            }
                        } catch (e) {}
                        if (!filePath) {
                            const recentPath = await getRecentFilePathByName(tab.fileName);
                            if (recentPath) {
                                try {
                                    const mtime = await nativeGetFileModifiedTime(recentPath);
                                    if (mtime !== null && mtime !== undefined) {
                                        filePath = recentPath;
                                        tab.filePath = filePath;
                                        tab.isNewProject = false;
                                    }
                                } catch (e) {}
                            }
                        }
                    }

                    if (filePath) {
                        tab.filePath = filePath;
                        if (!tab.hasChanges) continue;
                        const u8 = encodeTabToBuffer(tab, idx);
                        if (u8) {
                            try {
                                await nativeWriteFile(filePath, u8);
                                const mtime = await nativeGetFileModifiedTime(filePath);
                                tab.fileLastModified = mtime;
                                tab.hasChanges = false;
                                tab.isNewProject = false;
                                tab.savedHistoryPtr = (tab.historyPtr !== undefined) ? tab.historyPtr : -1;
                                if (idx === originalActive) {
                                    state.savedHistoryPtr = state.historyPtr;
                                    state.hasChanges = false;
                                    state.fileLastModified = mtime;
                                    state.filePath = filePath;
                                    if (tab.isTmpMode) window._lastTmpFilePath = filePath;
                                    else window._lastShpFilePath = filePath;
                                }
                                savedCount++;
                                const badge = document.getElementById(`saveAllBadge_${idx}`);
                                if (badge) {
                                    badge.className = 'save-all-badge badge-saved';
                                    badge.textContent = '✅ ' + (t.lbl_save_status_saved || 'Saved');
                                }
                                updateProgress(savedCount, totalToSave);
                            } catch (err) {
                                console.error('[Native Save All] Error on tab', idx, err);
                            }
                        }
                    }
                }
            }

            // Silent Fast Pass (Web mode): direct save any tab that already has granted permission
            if (!isNativeApp()) {
                for (const idx of modifiedIndices) {
                    const tab = state.tabs[idx];
                    if (!tab.hasChanges && tab.fileHandle) continue; // already saved in this session

                    if (tab.fileHandle && typeof tab.fileHandle.queryPermission === 'function') {
                        try {
                            const qPerm = await tab.fileHandle.queryPermission({ mode: 'readwrite' });
                            if (qPerm === 'granted') {
                                const u8 = encodeTabToBuffer(tab, idx);
                                if (u8) {
                                    const writable = await tab.fileHandle.createWritable();
                                    const blob = new Blob([u8], { type: 'application/octet-stream' });
                                    await writable.write(blob);
                                    await writable.close();

                                    tab.hasChanges = false;
                                    tab.savedHistoryPtr = (tab.historyPtr !== undefined) ? tab.historyPtr : -1;
                                    savedCount++;
                                    const badge = document.getElementById(`saveAllBadge_${idx}`);
                                    if (badge) {
                                        badge.className = 'save-all-badge badge-saved';
                                        badge.textContent = '✅ ' + (t.lbl_save_status_saved || 'Saved');
                                    }
                                    updateProgress(savedCount, totalToSave);
                                }
                            }
                        } catch (qErr) {
                            console.warn('[handleSaveAll] Silent pass query error on tab', idx, qErr);
                        }
                    }
                }
            }

            // Interactive Loop: Request permission (Web) or show Save As for truly new tabs
            for (let k = 0; k < modifiedIndices.length; k++) {
                const idx = modifiedIndices[k];
                const tab = state.tabs[idx];
                const hasBacking = Boolean(tab.fileHandle || tab.filePath);
                if (!tab.hasChanges && hasBacking) continue; // already saved!

                const badge = document.getElementById(`saveAllBadge_${idx}`);
                const actionSlot = document.getElementById(`saveAllActionSlot_${idx}`);

                if (tab.fileHandle && !isNativeApp()) {
                    if (badge) {
                        badge.className = 'save-all-badge badge-saving';
                        badge.textContent = '⏳ ...';
                    }

                    try {
                        const perm = await tab.fileHandle.requestPermission({ mode: 'readwrite' });
                        if (perm === 'granted') {
                            const u8 = encodeTabToBuffer(tab, idx);
                            if (u8) {
                                const writable = await tab.fileHandle.createWritable();
                                const blob = new Blob([u8], { type: 'application/octet-stream' });
                                await writable.write(blob);
                                await writable.close();

                                tab.hasChanges = false;
                                tab.savedHistoryPtr = (tab.historyPtr !== undefined) ? tab.historyPtr : -1;
                                savedCount++;
                                if (badge) {
                                    badge.className = 'save-all-badge badge-saved';
                                    badge.textContent = '✅ ' + (t.lbl_save_status_saved || 'Saved');
                                }
                                if (actionSlot) actionSlot.innerHTML = '';
                                updateProgress(savedCount, totalToSave);
                            }
                        } else {
                            // User cancelled native prompt
                            if (badge) {
                                badge.className = 'save-all-badge badge-modified';
                                badge.textContent = '⚠️ ' + (t.lbl_file_status_modified || 'Modified');
                            }
                        }
                    } catch (reqErr) {
                        console.warn(`[handleSaveAll] Chrome activation expired at tab ${idx}:`, reqErr.message);
                        if (badge) {
                            badge.className = 'save-all-badge badge-modified';
                            badge.textContent = '⚠️ ' + (t.lbl_file_status_modified || 'Modified');
                        }

                        const remaining = totalToSave - savedCount;
                        btnConfirm.disabled = false;
                        btnCancel.disabled = false;
                        if (btnSaveAllZip) btnSaveAllZip.disabled = false;
                        if (btnSaveAllToFolder) btnSaveAllToFolder.disabled = false;

                        btnConfirm.classList.add('btn-continue-pulse');
                        btnConfirm.textContent = (t.btn_continue_saving || '▶️ Continue Saving ({count} left)').replace('{count}', String(remaining));
                        btnConfirm.onclick = () => runContinuousSave();
                        return;
                    }
                } else if (!hasBacking) {
                    if (isNativeApp()) {
                        let resolvedPath = null;
                        if (tab.fileName && !tab.isNewProject) {
                            resolvedPath = await getRecentFilePathByName(tab.fileName);
                        }
                        if (resolvedPath) {
                            try {
                                const mtime = await nativeGetFileModifiedTime(resolvedPath);
                                if (mtime !== null && mtime !== undefined) {
                                    tab.filePath = resolvedPath;
                                    tab.isNewProject = false;
                                    const u8 = encodeTabToBuffer(tab, idx);
                                    if (u8) {
                                        await nativeWriteFile(resolvedPath, u8);
                                        tab.fileLastModified = await nativeGetFileModifiedTime(resolvedPath);
                                        tab.hasChanges = false;
                                        tab.savedHistoryPtr = (tab.historyPtr !== undefined) ? tab.historyPtr : -1;
                                        if (idx === originalActive) {
                                            state.savedHistoryPtr = state.historyPtr;
                                            state.hasChanges = false;
                                            state.fileLastModified = tab.fileLastModified;
                                            state.filePath = resolvedPath;
                                            if (tab.isTmpMode) window._lastTmpFilePath = resolvedPath;
                                            else window._lastShpFilePath = resolvedPath;
                                        }
                                        savedCount++;
                                        if (badge) {
                                            badge.className = 'save-all-badge badge-saved';
                                            badge.textContent = '✅ ' + (t.lbl_save_status_saved || 'Saved');
                                        }
                                        if (actionSlot) actionSlot.innerHTML = '';
                                        updateProgress(savedCount, totalToSave);
                                        continue;
                                    }
                                }
                            } catch (e) {}
                        }

                        // In native desktop app, prompt Save As sequentially for any new unsaved file
                        state.activeTabIndex = idx;
                        state.loadFromTab(tab);
                        let ok = false;
                        if (tab.isTmpMode) {
                            await saveTmpData(true);
                            ok = !state.hasChanges;
                        } else {
                            ok = await handleSaveAsShp();
                        }
                        state.saveToTab(tab);
                        if (ok) {
                            savedCount++;
                            if (badge) {
                                badge.className = 'save-all-badge badge-saved';
                                badge.textContent = '✅ ' + (t.lbl_save_status_saved || 'Saved');
                            }
                            if (actionSlot) actionSlot.innerHTML = '';
                            updateProgress(savedCount, totalToSave);
                        } else {
                            // User cancelled Save As for this new file
                            if (badge) {
                                badge.className = 'save-all-badge badge-new';
                                badge.textContent = '✚ ' + (t.lbl_file_status_new || 'New');
                            }
                        }
                    } else {
                        // Web browser mode: Provide Save As button
                        if (badge) {
                            badge.className = 'save-all-badge badge-new';
                            badge.textContent = '✚ ' + (t.lbl_file_status_new || 'New');
                        }
                        if (actionSlot && !actionSlot.hasChildNodes()) {
                            const btnSaveAs = document.createElement('button');
                            btnSaveAs.className = 'save-all-btn-action';
                            btnSaveAs.textContent = t.btn_save_as || 'Save As...';
                            btnSaveAs.onclick = async () => {
                                btnSaveAs.disabled = true;
                                btnSaveAs.textContent = '⏳ ...';
                                state.activeTabIndex = idx;
                                state.loadFromTab(tab);
                                let ok = false;
                                if (tab.isTmpMode) {
                                    await saveTmpData(true);
                                    ok = !state.hasChanges;
                                } else {
                                    ok = await handleSaveAsShp();
                                }
                                state.saveToTab(tab);
                                if (ok) {
                                    savedCount++;
                                    if (badge) {
                                        badge.className = 'save-all-badge badge-saved';
                                        badge.textContent = '✅ ' + (t.lbl_save_status_saved || 'Saved');
                                    }
                                    actionSlot.innerHTML = '';
                                    updateProgress(savedCount, totalToSave);
                                } else {
                                    btnSaveAs.disabled = false;
                                    btnSaveAs.textContent = t.btn_save_as || 'Save As...';
                                }
                            };
                            actionSlot.appendChild(btnSaveAs);
                        }
                    }
                }
            }

            // Verify if all modified tabs have been successfully saved
            const remainingUnsaved = modifiedIndices.filter(i => {
                const tb = state.tabs[i];
                return tb.hasChanges || (!Boolean(tb.filePath || tb.fileHandle));
            });

            if (remainingUnsaved.length > 0 && !isNativeApp()) {
                // In web mode, keep dialog open so user can click individual Save As buttons
                btnConfirm.classList.remove('btn-continue-pulse');
                btnConfirm.disabled = false;
                btnConfirm.textContent = t.btn_save_all || 'SAVE ALL';
                btnCancel.disabled = false;
                return;
            }

            btnConfirm.classList.remove('btn-continue-pulse');
            btnConfirm.disabled = true;
            btnConfirm.textContent = '✅ ' + (t.lbl_save_status_saved || 'Saved');

            setTimeout(() => {
                cleanup();
                if (savedCount > 0) {
                    const msg = (t.msg_save_all_success || '✅ Saved {count} tab(s) successfully').replace('{count}', String(savedCount));
                    showPasteNotification(msg, 'success', 2500);
                } else {
                    const msg = t.msg_save_all_no_changes || 'ℹ️ All tabs are already up to date';
                    showPasteNotification(msg, 'info', 2000);
                }
                resolve(true);
            }, 500);
        }

        btnConfirm.onclick = () => runContinuousSave();
    });
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
    const parsedComp = parseInt(elements.selExpShpType.value, 10);
    const compression = Number.isFinite(parsedComp) ? parsedComp : (state.shpFormat === 'td_ra' ? 80 : 3);

    if (elements.exportShpDialog) elements.exportShpDialog.close();

    const newHandle = await exportFrameList(filename, state.frames, compression);
    if (newHandle) {
        const curTab = (state.activeTabIndex >= 0 && state.tabs[state.activeTabIndex])
            ? state.tabs[state.activeTabIndex]
            : null;
        if (curTab) {
            curTab.fileHandle = newHandle;
            curTab.fileName = newHandle.name;
            curTab.hasChanges = false;
            curTab.savedHistoryPtr = state.historyPtr;
            curTab.compression = compression;
        }
        state.compression = compression;
        syncStatusCompressionUI();
        window._lastShpFileHandle = newHandle;
        window._lastShpFilename = newHandle.name;
        state.fileHandle = newHandle;
        state.savedHistoryPtr = state.historyPtr;
        state.hasChanges = false;
        if (typeof updateCurrentTabName === 'function') updateCurrentTabName(newHandle.name);
        if (typeof window.saveRecentFile === 'function') window.saveRecentFile(newHandle.name, newHandle);
        if (window.renderTabs) window.renderTabs();
        showPasteNotification(`✅ Saved as: ${newHandle.name}`, 'success', 2500);
    }
}

export async function handleFrameDrop(files) {
    if (!files || files.length === 0) return;

    const validImgExts = ['pcx', 'png', 'bmp', 'jpg', 'jpeg', 'jfif', 'pjpeg', 'pjp', 'webp', 'gif', 'avif', 'ico', 'svg', 'tif', 'tiff'];
    const filesArray = Array.from(files).filter(f => {
        if (!f) return false;
        if (f.type && f.type.startsWith('image/')) return true;
        if (!f.name) return false;
        const ext = f.name.split('.').pop().toLowerCase();
        return validImgExts.includes(ext);
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

        const activePal = getActivePalette();
        for (let y = 0; y < dh; y++) {
            for (let x = 0; x < dw; x++) {
                const color = d.pixels[y * d.width + x];
                if (color.a < 128) continue;

                const idx = quantizeInfurium(d.pixels, d.width, d.height, x, y, activePal);
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

    if (ext === 'pdn') {
        const buffer = await file.arrayBuffer();
        return await parsePdnFile(buffer);
    } else if (ext === 'psd' || ext === 'psb') {
        const buffer = await file.arrayBuffer();
        return await parsePsdFile(buffer);
    } else if (ext === 'pcx') {
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
        // Standard browser-decodable image (PNG, BMP, JPG, WEBP, GIF)
        const blob = (file instanceof Blob) ? file : new Blob([await file.arrayBuffer()]);
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onerror = () => resolve(null);
            reader.onload = (e) => {
                const img = new Image();
                img.onerror = () => resolve(null);
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
            reader.readAsDataURL(blob);
        });
    }
}

async function gzipDecompressPdnBytes(compressedU8) {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(compressedU8);
    writer.close();
    const resp = new Response(ds.readable);
    const ab = await resp.arrayBuffer();
    return new Uint8Array(ab);
}

function read7BitPdnInt(data, pos) {
    let res = 0, shift = 0;
    while (pos < data.length) {
        const b = data[pos++];
        res |= (b & 0x7F) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
    }
    return [res, pos];
}

function readNrbfPdnStr(data, pos, textDec) {
    const [len, nextPos] = read7BitPdnInt(data, pos);
    const str = textDec.decode(data.subarray(nextPos, nextPos + len));
    return [str, nextPos + len];
}

function findPdnSubarray(haystack, needle, fromIndex = 0) {
    const end = haystack.length - needle.length;
    outer: for (let i = fromIndex; i <= end; i++) {
        for (let j = 0; j < needle.length; j++) {
            if (haystack[i + j] !== needle[j]) continue outer;
        }
        return i;
    }
    return -1;
}

export async function parsePdnFile(buffer) {
    const u8 = new Uint8Array(buffer);
    if (u8.length < 16 || u8[0] !== 0x50 || u8[1] !== 0x44 || u8[2] !== 0x4E || u8[3] !== 0x33) {
        throw new Error('Invalid PDN3 header');
    }
    const textDec = new TextDecoder('utf-8');
    const xmlLen = u8[4] | (u8[5] << 8) | (u8[6] << 16);
    const xmlStr = textDec.decode(u8.subarray(7, 7 + xmlLen));
    const wMatch = xmlStr.match(/width="(\d+)"/i);
    const hMatch = xmlStr.match(/height="(\d+)"/i);
    const lMatch = xmlStr.match(/layers="(\d+)"/i);
    if (!wMatch || !hMatch || !lMatch) {
        throw new Error('Missing PDN XML dimensions');
    }
    const width = parseInt(wMatch[1], 10);
    const height = parseInt(hMatch[1], 10);
    const numLayers = parseInt(lMatch[1], 10);
    if (width <= 0 || height <= 0 || numLayers <= 0) {
        throw new Error('Invalid PDN dimensions');
    }

    let pos = 7 + xmlLen;
    const flags = u8[pos] | (u8[pos + 1] << 8);
    pos += 2;
    let data = u8;
    if (flags === 0x0000) {
        data = await gzipDecompressPdnBytes(u8.subarray(pos));
        pos = 0;
    }
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const markerStr = 'PaintDotNet.Layer+LayerProperties';
    const markerBytes = new Uint8Array(1 + markerStr.length);
    markerBytes[0] = markerStr.length;
    for (let i = 0; i < markerStr.length; i++) markerBytes[i + 1] = markerStr.charCodeAt(i);

    let searchPos = pos;
    let lyrPropsClassId = null;
    let firstPropsPos = -1;
    while (true) {
        const idx = findPdnSubarray(data, markerBytes, searchPos);
        if (idx === -1) break;
        if (idx >= 5 && data[idx - 5] === 0x05) {
            lyrPropsClassId = dv.getInt32(idx - 4, true);
            firstPropsPos = idx - 5;
            break;
        }
        searchPos = idx + 1;
    }

    const layersMeta = [];
    if (firstPropsPos !== -1) {
        let p = firstPropsPos + 5;
        [, p] = readNrbfPdnStr(data, p, textDec);
        const memberCount = dv.getInt32(p, true); p += 4;
        const memberNames = [];
        for (let m = 0; m < memberCount; m++) {
            let mn;
            [mn, p] = readNrbfPdnStr(data, p, textDec);
            memberNames.push(mn);
        }
        const btypes = [];
        for (let m = 0; m < memberCount; m++) btypes.push(data[p++]);
        for (const bt of btypes) {
            if (bt === 0 || bt === 7) p += 1;
            else if (bt === 3) [, p] = readNrbfPdnStr(data, p, textDec);
            else if (bt === 4) { [, p] = readNrbfPdnStr(data, p, textDec); p += 4; }
        }
        p += 4; // libraryId

        const strTable = new Map();
        const readLayerPropsValues = (curP, idxNum) => {
            const vals = { name: `Layer ${idxNum + 1}`, visible: true, isBackground: false, opacity: 255 };
            for (const mn of memberNames) {
                if (mn === 'name') {
                    const rt = data[curP++];
                    if (rt === 0x06) {
                        const sid = dv.getInt32(curP, true); curP += 4;
                        let sval;
                        [sval, curP] = readNrbfPdnStr(data, curP, textDec);
                        strTable.set(sid, sval);
                        vals.name = sval;
                    } else if (rt === 0x09) {
                        const refId = dv.getInt32(curP, true); curP += 4;
                        if (strTable.has(refId)) vals.name = strTable.get(refId);
                    }
                } else if (mn === 'userMetadataItems') {
                    const rt = data[curP++];
                    if (rt === 0x09) curP += 4;
                } else if (mn === 'visible') {
                    vals.visible = (data[curP++] !== 0);
                } else if (mn === 'isBackground') {
                    vals.isBackground = (data[curP++] !== 0);
                } else if (mn === 'opacity') {
                    vals.opacity = data[curP++];
                } else if (mn === 'blendMode') {
                    const rt = data[curP++];
                    if (rt === 0x05) {
                        curP += 4;
                        [, curP] = readNrbfPdnStr(data, curP, textDec);
                        const mc = dv.getInt32(curP, true); curP += 4;
                        for (let k = 0; k < mc; k++) [, curP] = readNrbfPdnStr(data, curP, textDec);
                        curP += mc * 2 + 4;
                        vals.blendMode = dv.getInt32(curP, true); curP += 4;
                    } else if (rt === 0x01) {
                        curP += 8;
                        vals.blendMode = dv.getInt32(curP, true); curP += 4;
                    } else if (rt === 0x04) {
                        curP += 4;
                        [, curP] = readNrbfPdnStr(data, curP, textDec);
                        const mc = dv.getInt32(curP, true); curP += 4;
                        for (let k = 0; k < mc; k++) [, curP] = readNrbfPdnStr(data, curP, textDec);
                        curP += mc * 2;
                        vals.blendMode = dv.getInt32(curP, true); curP += 4;
                    }
                }
            }
            return [vals, curP];
        };

        let v0;
        [v0, p] = readLayerPropsValues(p, 0);
        layersMeta.push(v0);

        const metaSig = new Uint8Array(4);
        new DataView(metaSig.buffer).setInt32(0, lyrPropsClassId, true);
        while (layersMeta.length < numLayers) {
            const idx = findPdnSubarray(data, metaSig, p);
            if (idx === -1) break;
            if (idx >= 5 && data[idx - 5] === 0x01 && (data[idx + 4] === 0x06 || data[idx + 4] === 0x09 || data[idx + 4] === 0x0A)) {
                let vi;
                [vi, p] = readLayerPropsValues(idx + 4, layersMeta.length);
                layersMeta.push(vi);
            } else {
                p = idx + 1;
            }
        }
    }

    while (layersMeta.length < numLayers) {
        layersMeta.push({ name: `Layer ${layersMeta.length + 1}`, visible: true, isBackground: false, opacity: 255 });
    }

    const totalLayerBytes = width * height * 4;
    const len64Sig = new Uint8Array(10);
    const ldv = new DataView(len64Sig.buffer);
    ldv.setUint32(0, totalLayerBytes >>> 0, true);
    ldv.setUint32(4, Math.floor(totalLayerBytes / 0x100000000) >>> 0, true);
    len64Sig[8] = 0x00;
    len64Sig[9] = 0x01;

    let cur = pos;
    for (let i = 0; i < numLayers; i++) {
        const idx = findPdnSubarray(data, len64Sig, cur);
        if (idx === -1) throw new Error('PDN MemoryBlock signature not found');
        cur = idx + len64Sig.length;
    }

    while (cur < data.length) {
        const bIdx = data.indexOf(0x0B, cur);
        if (bIdx === -1) throw new Error('PDN NRBF MessageEnd not found');
        const sPos = bIdx + 1;
        const fmt = data[sPos];
        if (fmt === 0 && sPos + 15 <= data.length && data[sPos + 13] === 0x1F && data[sPos + 14] === 0x8B) {
            cur = sPos;
            break;
        } else if (fmt === 1) {
            cur = sPos;
            break;
        }
        cur = bIdx + 1;
    }

    const totalPixels = width * height;
    const layers = [];
    for (let i = 0; i < numLayers; i++) {
        const fmt = data[cur++];
        const bgra = new Uint8Array(totalLayerBytes);
        if (fmt === 0) {
            const chunkSize = dv.getUint32(cur, false); cur += 4;
            const numChunks = Math.ceil(totalLayerBytes / chunkSize);
            for (let c = 0; c < numChunks; c++) {
                const chunkNum = dv.getUint32(cur, false); cur += 4;
                const compLen = dv.getUint32(cur, false); cur += 4;
                const compSlice = data.subarray(cur, cur + compLen); cur += compLen;
                const rawChunk = await gzipDecompressPdnBytes(compSlice);
                bgra.set(rawChunk, chunkNum * chunkSize);
            }
        } else if (fmt === 1) {
            bgra.set(data.subarray(cur, cur + totalLayerBytes));
            cur += totalLayerBytes;
        } else {
            throw new Error(`Unsupported PDN surface formatVersion: ${fmt}`);
        }

        const lyrPixels = new Array(totalPixels);
        for (let pIdx = 0; pIdx < totalPixels; pIdx++) {
            const off = pIdx * 4;
            lyrPixels[pIdx] = {
                r: bgra[off + 2],
                g: bgra[off + 1],
                b: bgra[off],
                a: bgra[off + 3]
            };
        }
        layers.push({
            name: layersMeta[i].name || `Layer ${i + 1}`,
            visible: Boolean(layersMeta[i].visible),
            isBackground: Boolean(layersMeta[i].isBackground || i === 0),
            pixels: lyrPixels
        });
    }

    const compositePixels = new Array(totalPixels);
    for (let pIdx = 0; pIdx < totalPixels; pIdx++) {
        compositePixels[pIdx] = { r: 0, g: 0, b: 0, a: 0 };
    }
    for (let i = 0; i < layers.length; i++) {
        if (!layers[i].visible) continue;
        const lyrPixels = layers[i].pixels;
        for (let pIdx = 0; pIdx < totalPixels; pIdx++) {
            const px = lyrPixels[pIdx];
            if (px && px.a >= 128) {
                compositePixels[pIdx] = { r: px.r, g: px.g, b: px.b, a: 255 };
            }
        }
    }

    return { width, height, pixels: compositePixels, pdnLayers: layers };
}

async function deflateDecompressPsdBytes(compressedU8) {
    for (const fmt of ['deflate', 'deflate-raw']) {
        try {
            const ds = new DecompressionStream(fmt);
            const writer = ds.writable.getWriter();
            writer.write(compressedU8);
            writer.close();
            const resp = new Response(ds.readable);
            const ab = await resp.arrayBuffer();
            return new Uint8Array(ab);
        } catch (e) {}
    }
    throw new Error('Failed to decompress PSD ZIP channel');
}

export async function parsePsdFile(buffer) {
    const u8 = new Uint8Array(buffer);
    if (u8.length < 26 || u8[0] !== 0x38 || u8[1] !== 0x42 || u8[2] !== 0x50 || u8[3] !== 0x53) {
        throw new Error('Invalid PSD header');
    }
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const version = dv.getUint16(4, false);
    if (version !== 1 && version !== 2) {
        throw new Error(`Unsupported PSD version: ${version}`);
    }
    const isPsb = (version === 2);
    const docChannels = dv.getUint16(12, false);
    const height = dv.getUint32(14, false);
    const width = dv.getUint32(18, false);
    const depth = dv.getUint16(22, false);
    const colorMode = dv.getUint16(24, false);
    if (width <= 0 || height <= 0) {
        throw new Error('Invalid PSD dimensions');
    }

    let pos = 26;
    const colorModeLen = dv.getUint32(pos, false); pos += 4;
    let indexedLut = null;
    if (colorMode === 2 && colorModeLen >= 768) {
        indexedLut = new Uint8Array(768);
        for (let i = 0; i < 256; i++) {
            indexedLut[i * 3] = u8[pos + i];
            indexedLut[i * 3 + 1] = u8[pos + 256 + i];
            indexedLut[i * 3 + 2] = u8[pos + 512 + i];
        }
    }
    pos += colorModeLen;

    const imgResLen = dv.getUint32(pos, false);
    pos += 4 + imgResLen;

    const layerMaskLen = isPsb ? Number(dv.getBigUint64(pos, false)) : dv.getUint32(pos, false);
    pos += isPsb ? 8 : 4;
    const layerMaskEnd = pos + layerMaskLen;

    let layerInfoStart = -1;
    if (layerMaskLen > 0 && pos < layerMaskEnd) {
        const layerInfoLen = isPsb ? Number(dv.getBigUint64(pos, false)) : dv.getUint32(pos, false);
        const afterLenPos = pos + (isPsb ? 8 : 4);
        if (layerInfoLen > 0) {
            layerInfoStart = afterLenPos;
        } else if (afterLenPos + 4 <= layerMaskEnd) {
            const globalMaskLen = dv.getUint32(afterLenPos, false);
            let addPos = afterLenPos + 4 + globalMaskLen;
            while (addPos + 12 <= layerMaskEnd) {
                const sigOk = (u8[addPos] === 0x38 && u8[addPos + 1] === 0x42 &&
                    ((u8[addPos + 2] === 0x49 && u8[addPos + 3] === 0x4D) || (u8[addPos + 2] === 0x36 && u8[addPos + 3] === 0x34)));
                if (!sigOk) break;
                const key = String.fromCharCode(u8[addPos + 4], u8[addPos + 5], u8[addPos + 6], u8[addPos + 7]);
                addPos += 8;
                const use8 = isPsb && ['LMsk', 'Lr16', 'Lr32', 'Layr', 'Mt16', 'Mt32', 'Mtrn', 'Alph', 'FMsk', 'lnk2', 'FEid', 'FXid', 'PxSD'].includes(key);
                const bLen = use8 ? Number(dv.getBigUint64(addPos, false)) : dv.getUint32(addPos, false);
                addPos += use8 ? 8 : 4;
                if (key === 'Lr16' || key === 'Lr32' || key === 'Layr') {
                    layerInfoStart = addPos;
                    break;
                }
                addPos += (bLen + 3) & ~3;
            }
        }
    }

    const decodeChannelBytes = async (chStart, chEnd, cw, ch, comp) => {
        const out = new Uint8Array(cw * ch);
        if (cw <= 0 || ch <= 0 || chStart >= chEnd) return out;
        if (comp === 0) {
            const rawStart = chStart;
            if (depth === 8) {
                const avail = Math.min(out.length, chEnd - rawStart);
                out.set(u8.subarray(rawStart, rawStart + avail));
            } else if (depth === 16) {
                for (let k = 0; k < out.length && rawStart + k * 2 < chEnd; k++) {
                    out[k] = u8[rawStart + k * 2];
                }
            }
        } else if (comp === 1) {
            let rlePos = chStart + ch * (isPsb ? 4 : 2);
            const bytesPerSample = depth === 16 ? 2 : 1;
            const rawBuf = bytesPerSample === 1 ? out : new Uint8Array(cw * ch * bytesPerSample);
            let outOff = 0;
            while (outOff < rawBuf.length && rlePos < chEnd) {
                const n = (u8[rlePos++] << 24) >> 24;
                if (n >= 0) {
                    const count = n + 1;
                    for (let k = 0; k < count && outOff < rawBuf.length && rlePos < chEnd; k++) {
                        rawBuf[outOff++] = u8[rlePos++];
                    }
                } else if (n !== -128) {
                    const count = 1 - n;
                    const val = u8[rlePos++];
                    for (let k = 0; k < count && outOff < rawBuf.length; k++) {
                        rawBuf[outOff++] = val;
                    }
                }
            }
            if (bytesPerSample === 2) {
                for (let k = 0; k < out.length; k++) out[k] = rawBuf[k * 2];
            }
        } else if (comp === 2 || comp === 3) {
            const raw = await deflateDecompressPsdBytes(u8.subarray(chStart, chEnd));
            if (depth === 8) {
                out.set(raw.subarray(0, out.length));
                if (comp === 3) {
                    for (let y = 0; y < ch; y++) {
                        const rowOff = y * cw;
                        for (let x = 1; x < cw; x++) {
                            out[rowOff + x] = (out[rowOff + x] + out[rowOff + x - 1]) & 0xFF;
                        }
                    }
                }
            }
        }
        return out;
    };

    const latin1Dec = new TextDecoder('latin1');
    const utf16BeDec = new TextDecoder('utf-16be');
    const layerRecords = [];
    const totalPixels = width * height;

    if (layerInfoStart !== -1 && layerInfoStart + 2 <= layerMaskEnd) {
        let p = layerInfoStart;
        const rawLayerCount = dv.getInt16(p, false); p += 2;
        const numLayers = Math.abs(rawLayerCount);

        for (let i = 0; i < numLayers; i++) {
            const top = dv.getInt32(p, false); p += 4;
            const left = dv.getInt32(p, false); p += 4;
            const bottom = dv.getInt32(p, false); p += 4;
            const right = dv.getInt32(p, false); p += 4;
            const numChan = dv.getUint16(p, false); p += 2;
            const chanSpecs = [];
            for (let c = 0; c < numChan; c++) {
                const chanId = dv.getInt16(p, false); p += 2;
                const chanLen = isPsb ? Number(dv.getBigUint64(p, false)) : dv.getUint32(p, false);
                p += isPsb ? 8 : 4;
                chanSpecs.push({ id: chanId, len: chanLen });
            }
            p += 8; // 8BIM + blendKey
            const opacity = u8[p++];
            const clipping = u8[p++];
            const flags = u8[p++];
            p += 1; // filler
            const visible = ((flags & 0x02) === 0);

            const extraLen = dv.getUint32(p, false); p += 4;
            const extraEnd = p + extraLen;

            const maskDataLen = dv.getUint32(p, false); p += 4;
            let maskMeta = null;
            if (maskDataLen >= 20) {
                maskMeta = {
                    top: dv.getInt32(p, false),
                    left: dv.getInt32(p + 4, false),
                    bottom: dv.getInt32(p + 8, false),
                    right: dv.getInt32(p + 12, false),
                    defaultColor: u8[p + 16],
                    flags: u8[p + 17]
                };
            }
            p += maskDataLen;

            const blendRangesLen = dv.getUint32(p, false);
            p += 4 + blendRangesLen;

            const pasLen = u8[p];
            let layerName = latin1Dec.decode(u8.subarray(p + 1, p + 1 + pasLen));
            p += ((1 + pasLen + 3) & ~3);

            let dividerType = 0;
            while (p + 12 <= extraEnd) {
                const is8Bim = (u8[p] === 0x38 && u8[p + 1] === 0x42 &&
                    ((u8[p + 2] === 0x49 && u8[p + 3] === 0x4D) || (u8[p + 2] === 0x36 && u8[p + 3] === 0x34)));
                if (!is8Bim) break;
                const key = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
                p += 8;
                const use8 = isPsb && ['LMsk', 'Lr16', 'Lr32', 'Layr', 'Mt16', 'Mt32', 'Mtrn', 'Alph', 'FMsk', 'lnk2', 'FEid', 'FXid', 'PxSD'].includes(key);
                const bLen = use8 ? Number(dv.getBigUint64(p, false)) : dv.getUint32(p, false);
                p += use8 ? 8 : 4;
                const bStart = p;

                if (key === 'luni' && bLen >= 4) {
                    const uChars = dv.getUint32(bStart, false);
                    if (uChars > 0 && bStart + 4 + uChars * 2 <= extraEnd) {
                        layerName = utf16BeDec.decode(u8.subarray(bStart + 4, bStart + 4 + uChars * 2)).replace(/\0+$/, '');
                    }
                } else if ((key === 'lsct' || key === 'lsdk') && bLen >= 4) {
                    dividerType = dv.getUint32(bStart, false);
                }

                p = bStart + ((bLen + 1) & ~1);
                if (p + 4 <= extraEnd && u8[p] === 0 && u8[p + 1] === 0 && u8[p + 2] === 0x38 && u8[p + 3] === 0x42) {
                    p += 2;
                }
            }
            p = extraEnd;

            layerRecords.push({
                name: layerName || `Layer ${i + 1}`,
                top, left, bottom, right,
                visible, opacity, dividerType,
                chanSpecs, maskMeta,
                pixels: null
            });
        }

        for (let i = 0; i < numLayers; i++) {
            const rec = layerRecords[i];
            const lw = Math.max(0, rec.right - rec.left);
            const lh = Math.max(0, rec.bottom - rec.top);
            const decodedChans = new Map();

            for (const chSpec of rec.chanSpecs) {
                const chStart = p;
                const chEnd = chStart + chSpec.len;
                let cw = lw, ch = lh;
                if (chSpec.id === -2 && rec.maskMeta) {
                    cw = Math.max(0, rec.maskMeta.right - rec.maskMeta.left);
                    ch = Math.max(0, rec.maskMeta.bottom - rec.maskMeta.top);
                }
                if (rec.dividerType === 0 && chSpec.len >= 2 && cw > 0 && ch > 0 && chSpec.id >= -2 && chSpec.id <= 3) {
                    const comp = dv.getUint16(chStart, false);
                    const plane = await decodeChannelBytes(chStart + 2, chEnd, cw, ch, comp);
                    decodedChans.set(chSpec.id, plane);
                }
                p = chEnd;
            }

            if (rec.dividerType === 0) {
                const lyrPixels = new Array(totalPixels);
                for (let k = 0; k < totalPixels; k++) {
                    lyrPixels[k] = { r: 0, g: 0, b: 0, a: 0 };
                }
                if (lw > 0 && lh > 0) {
                    const chR = decodedChans.get(0);
                    const chG = decodedChans.get(1) || chR;
                    const chB = decodedChans.get(2) || chR;
                    const chA = decodedChans.get(-1);
                    const chMask = (rec.maskMeta && ((rec.maskMeta.flags & 0x02) === 0)) ? decodedChans.get(-2) : null;
                    const mw = chMask ? Math.max(0, rec.maskMeta.right - rec.maskMeta.left) : 0;

                    for (let ly = 0; ly < lh; ly++) {
                        const gy = rec.top + ly;
                        if (gy < 0 || gy >= height) continue;
                        for (let lx = 0; lx < lw; lx++) {
                            const gx = rec.left + lx;
                            if (gx < 0 || gx >= width) continue;
                            const si = ly * lw + lx;
                            let a = chA ? chA[si] : 255;
                            if (chMask) {
                                const mx = gx - rec.maskMeta.left;
                                const my = gy - rec.maskMeta.top;
                                const mVal = (mx >= 0 && mx < mw && my >= 0 && my < (rec.maskMeta.bottom - rec.maskMeta.top))
                                    ? chMask[my * mw + mx]
                                    : (rec.maskMeta.defaultColor || 0);
                                a = Math.round((a * mVal) / 255);
                            }
                            let r = 0, g = 0, b = 0;
                            if (colorMode === 2 && indexedLut && chR) {
                                const pi = chR[si] * 3;
                                r = indexedLut[pi];
                                g = indexedLut[pi + 1];
                                b = indexedLut[pi + 2];
                            } else {
                                r = chR ? chR[si] : 0;
                                g = chG ? chG[si] : 0;
                                b = chB ? chB[si] : 0;
                            }
                            lyrPixels[gy * width + gx] = { r, g, b, a };
                        }
                    }
                }
                rec.pixels = lyrPixels;
            }
        }
    }

    // Fallback for flattened PSDs with 0 layer records (read Merged Image Data section)
    if (layerRecords.length === 0 && layerMaskEnd + 2 <= u8.length) {
        const mPos = layerMaskEnd;
        const comp = dv.getUint16(mPos, false);
        const numCh = Math.min(docChannels, 4);
        const planes = [];
        if (comp === 0) {
            let cur = mPos + 2;
            const planeLen = totalPixels * (depth === 16 ? 2 : 1);
            for (let c = 0; c < numCh; c++) {
                planes.push(await decodeChannelBytes(cur, cur + planeLen, width, height, 0));
                cur += planeLen;
            }
        } else if (comp === 1) {
            const countBytesPerRow = isPsb ? 4 : 2;
            let countPos = mPos + 2;
            let dataPos = countPos + docChannels * height * countBytesPerRow;
            for (let c = 0; c < numCh; c++) {
                let chByteLen = 0;
                for (let y = 0; y < height; y++) {
                    chByteLen += isPsb ? dv.getUint32(countPos, false) : dv.getUint16(countPos, false);
                    countPos += countBytesPerRow;
                }
                const fakeStart = dataPos - height * countBytesPerRow;
                planes.push(await decodeChannelBytes(fakeStart, dataPos + chByteLen, width, height, 1));
                dataPos += chByteLen;
            }
        }
        if (planes.length > 0) {
            const lyrPixels = new Array(totalPixels);
            const chR = planes[0];
            const chG = planes[1] || chR;
            const chB = planes[2] || chR;
            const chA = planes[3] || null;
            for (let k = 0; k < totalPixels; k++) {
                if (colorMode === 2 && indexedLut) {
                    const pi = chR[k] * 3;
                    lyrPixels[k] = { r: indexedLut[pi], g: indexedLut[pi + 1], b: indexedLut[pi + 2], a: chA ? chA[k] : 255 };
                } else {
                    lyrPixels[k] = { r: chR[k], g: chG[k], b: chB[k], a: chA ? chA[k] : 255 };
                }
            }
            layerRecords.push({
                name: 'Background',
                top: 0, left: 0, bottom: height, right: width,
                visible: true, opacity: 255, dividerType: 0,
                chanSpecs: [], maskMeta: null,
                pixels: lyrPixels
            });
        }
    }

    const rootChildren = [];
    const containerStack = [{ children: rootChildren, effectiveVisible: true }];
    const leafLayersTopToBottom = [];

    for (let i = layerRecords.length - 1; i >= 0; i--) {
        const rec = layerRecords[i];
        const curContainer = containerStack[containerStack.length - 1];
        if (rec.dividerType === 1 || rec.dividerType === 2) {
            const grpNode = {
                type: 'group',
                name: rec.name || 'Group',
                visible: Boolean(rec.visible),
                expanded: rec.dividerType === 1,
                children: []
            };
            curContainer.children.push(grpNode);
            containerStack.push({
                children: grpNode.children,
                effectiveVisible: curContainer.effectiveVisible && Boolean(rec.visible)
            });
        } else if (rec.dividerType === 3) {
            if (containerStack.length > 1) {
                containerStack.pop();
            }
        } else if (rec.pixels) {
            const leafObj = {
                type: 'layer',
                name: rec.name || 'Layer',
                visible: Boolean(rec.visible),
                effectiveVisible: curContainer.effectiveVisible && Boolean(rec.visible),
                isBackground: (i === 0),
                pixels: rec.pixels,
                leafIndex: -1
            };
            curContainer.children.push(leafObj);
            leafLayersTopToBottom.push(leafObj);
        }
    }

    const pdnLayers = leafLayersTopToBottom.slice().reverse().map((leaf, idx) => {
        leaf.leafIndex = idx;
        return {
            name: leaf.name,
            visible: leaf.effectiveVisible,
            ownVisible: leaf.visible,
            isBackground: (idx === 0),
            pixels: leaf.pixels
        };
    });

    const compositePixels = new Array(totalPixels);
    for (let pIdx = 0; pIdx < totalPixels; pIdx++) {
        compositePixels[pIdx] = { r: 0, g: 0, b: 0, a: 0 };
    }
    for (let i = 0; i < pdnLayers.length; i++) {
        if (!pdnLayers[i].visible) continue;
        const lyrPixels = pdnLayers[i].pixels;
        for (let pIdx = 0; pIdx < totalPixels; pIdx++) {
            const px = lyrPixels[pIdx];
            if (px && px.a >= 128) {
                compositePixels[pIdx] = { r: px.r, g: px.g, b: px.b, a: 255 };
            }
        }
    }

    return { width, height, pixels: compositePixels, pdnLayers, psdTree: rootChildren };
}

function buildAdaptive256PaletteForImage(pixels, w, h, pdnLayers = null) {
    const pal = new Array(256);
    pal[0] = { r: 0, g: 0, b: 0 };

    const refCornerPixels = (pdnLayers && pdnLayers.length > 0 && pdnLayers[0].pixels) ? pdnLayers[0].pixels : pixels;
    if (refCornerPixels && w > 0 && h > 0) {
        const corners = [refCornerPixels[0], refCornerPixels[w - 1], refCornerPixels[(h - 1) * w], refCornerPixels[h * w - 1]];
        const hasChromaBlue = corners.some(c => c && c.a >= 128 && c.r <= 8 && c.g <= 8 && c.b >= 248);
        const hasChromaMagenta = corners.some(c => c && c.a >= 128 && c.r >= 248 && c.g <= 8 && c.b >= 248);
        if (hasChromaBlue) {
            pal[0] = { r: 0, g: 0, b: 252 };
        } else if (hasChromaMagenta) {
            pal[0] = { r: 252, g: 0, b: 252 };
        }
    }
    const skipKey0 = (pal[0].r !== 0 || pal[0].g !== 0 || pal[0].b !== 0)
        ? ((pal[0].r << 16) | (pal[0].g << 8) | pal[0].b)
        : -1;

    const freq = new Map();
    const total = w * h;
    const addPixelsToFreq = (pxArr, weight = 1) => {
        if (!pxArr) return;
        for (let i = 0; i < total; i++) {
            const c = pxArr[i];
            if (!c || c.a < 128) continue;
            const r6 = (c.r & 255) >> 2;
            const g6 = (c.g & 255) >> 2;
            const b6 = (c.b & 255) >> 2;
            const r8 = (r6 << 2) | (r6 >> 4);
            const g8 = (g6 << 2) | (g6 >> 4);
            const b8 = (b6 << 2) | (b6 >> 4);
            const key = (r8 << 16) | (g8 << 8) | b8;
            if (key === skipKey0) continue;
            freq.set(key, (freq.get(key) || 0) + weight);
        }
    };
    addPixelsToFreq(pixels, pdnLayers ? 2 : 1);
    if (pdnLayers && pdnLayers.length > 0) {
        for (const lyr of pdnLayers) {
            addPixelsToFreq(lyr.pixels, 1);
        }
    }

    let idx = 1;
    if (freq.has(0)) {
        pal[idx++] = { r: 0, g: 0, b: 0 };
        freq.delete(0);
    }

    const sorted = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
    const maxColors = 256 - idx;

    if (sorted.length <= maxColors) {
        for (let i = 0; i < sorted.length; i++) {
            const key = sorted[i][0];
            pal[idx++] = {
                r: (key >> 16) & 255,
                g: (key >> 8) & 255,
                b: key & 255
            };
        }
    } else {
        const nCand = sorted.length;
        const cR = new Int32Array(nCand);
        const cG = new Int32Array(nCand);
        const cB = new Int32Array(nCand);
        const cCount = new Int32Array(nCand);
        const cW = new Float32Array(nCand);
        const minDistSq = new Int32Array(nCand);
        const chosen = new Uint8Array(nCand);

        for (let i = 0; i < nCand; i++) {
            const key = sorted[i][0];
            const count = sorted[i][1];
            const r = (key >> 16) & 255;
            const g = (key >> 8) & 255;
            const b = key & 255;
            cR[i] = r;
            cG[i] = g;
            cB[i] = b;
            cCount[i] = count;
            cW[i] = Math.pow(Math.max(1, count), 0.28);
            let bestD = 0x7fffffff;
            for (let pi = 1; pi < idx; pi++) {
                const dr = r - pal[pi].r;
                const dg = g - pal[pi].g;
                const db = b - pal[pi].b;
                const d = dr * dr + dg * dg + db * db;
                if (d < bestD) bestD = d;
            }
            minDistSq[i] = bestD;
        }

        const selectCandidate = (ci) => {
            chosen[ci] = 1;
            minDistSq[ci] = 0;
            const nr = cR[ci], ng = cG[ci], nb = cB[ci];
            pal[idx++] = { r: nr, g: ng, b: nb };
            for (let j = 0; j < nCand; j++) {
                if (chosen[j]) continue;
                const dr = cR[j] - nr;
                const dg = cG[j] - ng;
                const db = cB[j] - nb;
                const d = dr * dr + dg * dg + db * db;
                if (d < minDistSq[j]) minDistSq[j] = d;
            }
        };

        // Seed with the #1 most frequent color, then up to 24 diverse popular colors (at least ~14 RGB units apart)
        selectCandidate(0);
        let seeded = 1;
        for (let i = 1; i < nCand && seeded < 24 && idx < 256; i++) {
            if (!chosen[i] && minDistSq[i] >= 192) {
                selectCandidate(i);
                seeded++;
            }
        }

        while (idx < 256) {
            let bestJ = -1;
            let bestScore = -1;
            for (let j = 0; j < nCand; j++) {
                if (chosen[j]) continue;
                const score = minDistSq[j] * cW[j];
                if (score > bestScore) {
                    bestScore = score;
                    bestJ = j;
                }
            }
            if (bestJ === -1) break;
            selectCandidate(bestJ);
        }

        // 1 weighted Lloyd/K-Means centroid refinement pass (snapped to 6-bit Westwood VGA precision)
        const sumR = new Float64Array(256);
        const sumG = new Float64Array(256);
        const sumB = new Float64Array(256);
        const sumW = new Float64Array(256);
        for (let j = 0; j < nCand; j++) {
            const r = cR[j], g = cG[j], b = cB[j], wgt = cCount[j];
            let bestPi = 1;
            let bestD = 0x7fffffff;
            for (let pi = 1; pi < idx; pi++) {
                const dr = r - pal[pi].r;
                const dg = g - pal[pi].g;
                const db = b - pal[pi].b;
                const d = dr * dr + dg * dg + db * db;
                if (d < bestD) {
                    bestD = d;
                    bestPi = pi;
                    if (d === 0) break;
                }
            }
            sumR[bestPi] += r * wgt;
            sumG[bestPi] += g * wgt;
            sumB[bestPi] += b * wgt;
            sumW[bestPi] += wgt;
        }
        for (let pi = 1; pi < idx; pi++) {
            if (sumW[pi] > 0) {
                const r6 = Math.min(63, Math.max(0, Math.round(sumR[pi] / sumW[pi]) >> 2));
                const g6 = Math.min(63, Math.max(0, Math.round(sumG[pi] / sumW[pi]) >> 2));
                const b6 = Math.min(63, Math.max(0, Math.round(sumB[pi] / sumW[pi]) >> 2));
                pal[pi] = {
                    r: (r6 << 2) | (r6 >> 4),
                    g: (g6 << 2) | (g6 >> 4),
                    b: (b6 << 2) | (b6 >> 4)
                };
            }
        }
    }

    while (idx < 256) {
        pal[idx++] = { r: 0, g: 0, b: 0 };
    }
    return pal;
}

function quantizeImageWithRgbCache(pixels, w, h, pal, opts = {}) {
    const indices = new Uint16Array(w * h).fill(TRANSPARENT_COLOR);
    const singleIdxCache = new Int16Array(1 << 18).fill(-1);

    let hasAlpha = false;
    for (let i = 0; i < w * h; i++) {
        if (!pixels[i] || pixels[i].a < 128) {
            hasAlpha = true;
            break;
        }
    }
    const skipCol = pal[0];
    const isChroma0 = Boolean(skipCol && (
        (skipCol.r <= 8 && skipCol.g <= 8 && skipCol.b >= 248) ||
        (skipCol.r >= 248 && skipCol.g <= 8 && skipCol.b >= 248)
    ));
    const matchesSkipCol = (c) => Boolean(c && c.a >= 128 && skipCol &&
        ((c.r >> 2) === (skipCol.r >> 2)) &&
        ((c.g >> 2) === (skipCol.g >> 2)) &&
        ((c.b >> 2) === (skipCol.b >> 2)));
    const hasCornerMatch0 = Boolean(w > 0 && h > 0 && (
        matchesSkipCol(pixels[0]) ||
        matchesSkipCol(pixels[w - 1]) ||
        matchesSkipCol(pixels[(h - 1) * w]) ||
        matchesSkipCol(pixels[h * w - 1])
    ));
    const useColorKey0 = opts.isPdnLayer
        ? Boolean((isChroma0 && hasCornerMatch0) || (opts.isBackgroundLayer && hasCornerMatch0))
        : Boolean(!hasAlpha && isChroma0 && hasCornerMatch0);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const pIdx = y * w + x;
            const color = pixels[pIdx];
            if (!color || color.a < 128) continue;
            const r6 = (color.r & 255) >> 2;
            const g6 = (color.g & 255) >> 2;
            const b6 = (color.b & 255) >> 2;
            const key6 = (r6 << 12) | (g6 << 6) | b6;
            let idx = singleIdxCache[key6];
            if (idx === -1) {
                const r = (r6 << 2) | (r6 >> 4);
                const g = (g6 << 2) | (g6 >> 4);
                const b = (b6 << 2) | (b6 >> 4);
                const isExact0 = useColorKey0 && skipCol &&
                    ((skipCol.r >> 2) === r6 && (skipCol.g >> 2) === g6 && (skipCol.b >> 2) === b6);
                if (isExact0) {
                    idx = 0;
                    singleIdxCache[key6] = 0;
                } else {
                    let exactIdx = -1;
                    let bestDist = Infinity;
                    let tieCount = 0;
                    let bestSingle = 1;
                    for (let i = 1; i < 256; i++) {
                        const c = pal[i];
                        if (!c) continue;
                        if ((c.r >> 2) === r6 && (c.g >> 2) === g6 && (c.b >> 2) === b6) {
                            exactIdx = i;
                            break;
                        }
                        const dr = r - c.r;
                        const dg = g - c.g;
                        const db = b - c.b;
                        const d = dr * dr + dg * dg + db * db;
                        if (d < bestDist) {
                            bestDist = d;
                            bestSingle = i;
                            tieCount = 1;
                        } else if (d === bestDist) {
                            tieCount++;
                        }
                    }
                    if (exactIdx !== -1) {
                        idx = exactIdx;
                        singleIdxCache[key6] = idx;
                    } else if (tieCount <= 1) {
                        idx = bestSingle;
                        singleIdxCache[key6] = idx;
                    } else {
                        singleIdxCache[key6] = -2; // Needs 3x3 neighborhood tie-breaker
                        idx = quantizeInfurium(pixels, w, h, x, y, pal, !useColorKey0);
                        if (idx === 0 && !useColorKey0) idx = bestSingle;
                    }
                }
            } else if (idx === -2) {
                idx = quantizeInfurium(pixels, w, h, x, y, pal, !useColorKey0);
                if (idx === 0 && !useColorKey0) idx = 1;
            }
            indices[pIdx] = idx;
        }
    }
    return indices;
}

function quantizePdnLayers(pdnLayers, w, h, pal) {
    const layerDataList = pdnLayers.map((pLyr, lIdx) =>
        quantizeImageWithRgbCache(pLyr.pixels, w, h, pal, {
            isPdnLayer: true,
            isBackgroundLayer: Boolean(pLyr.isBackground || lIdx === 0)
        })
    );
    const compIndices = new Uint16Array(w * h).fill(TRANSPARENT_COLOR);
    for (let lIdx = 0; lIdx < pdnLayers.length; lIdx++) {
        if (!pdnLayers[lIdx].visible) continue;
        const lData = layerDataList[lIdx];
        for (let p = 0; p < w * h; p++) {
            if (lData[p] !== TRANSPARENT_COLOR) {
                compIndices[p] = lData[p];
            }
        }
    }
    return { layerDataList, compIndices };
}

export async function openDropImagePaletteDialog(files) {
    if (!files || files.length === 0) return;

    const validExts = ['png', 'pcx', 'bmp', 'jpg', 'jpeg', 'jfif', 'pjpeg', 'pjp', 'webp', 'gif', 'avif', 'ico', 'svg', 'tif', 'tiff', 'pdn', 'psd', 'psb'];
    const filesArray = Array.from(files).filter(f => {
        if (!f) return false;
        if (f.type && f.type.startsWith('image/')) return true;
        if (!f.name) return false;
        const ext = f.name.split('.').pop().toLowerCase();
        return validExts.includes(ext);
    });

    if (filesArray.length === 0) return;

    const loadedImages = [];
    for (const file of filesArray) {
        try {
            const data = await processImageFile(file);
            if (data && data.width > 0 && data.height > 0) {
                loadedImages.push({
                    name: file.name,
                    width: data.width,
                    height: data.height,
                    pixels: data.pixels,
                    pdnLayers: data.pdnLayers || null,
                    psdTree: data.psdTree || null,
                    chosenPal: null,
                    chosenNode: null,
                    _previewCache: new Map(),
                    _indexCache: new Map(),
                    _layerIndexCache: new Map()
                });
            }
        } catch (err) {
            console.error(`Failed to process ${file.name}:`, err);
        }
    }

    if (loadedImages.length === 0) return;

    const dialog = document.getElementById('dropImagePaletteDialog');
    const previewCanvas = document.getElementById('dropImgPreviewCanvas');
    const palGrid = document.getElementById('dropImgPalGrid');
    const fileInfo = document.getElementById('dropImgFileInfo');
    const samePalRow = document.getElementById('dropImgSamePaletteRow');
    const chkSamePal = document.getElementById('chkDropImgSamePalette');
    const btnNoPal = document.getElementById('btnDropImgNoPalette');
    const btnCreatePal = document.getElementById('btnDropImgCreatePalette');
    const btnCancel = document.getElementById('btnCancelDropImg');
    const btnPrev = document.getElementById('btnPrevDropImg');
    const btnConfirm = document.getElementById('btnConfirmDropImg');

    if (!dialog || !previewCanvas) return;

    let currentIndex = 0;
    let currentPalNode = null;
    let currentPalArray = null;

    if (chkSamePal) {
        chkSamePal.checked = false;
    }
    if (samePalRow) {
        samePalRow.style.display = loadedImages.length > 1 ? 'flex' : 'none';
    }

    const updateButtonsUI = () => {
        if (btnPrev) {
            if (loadedImages.length > 1) {
                btnPrev.style.display = 'inline-flex';
                const canGoPrev = currentIndex > 0;
                btnPrev.disabled = !canGoPrev;
                btnPrev.style.opacity = canGoPrev ? '1' : '0.45';
                btnPrev.style.cursor = canGoPrev ? 'pointer' : 'not-allowed';
            } else {
                btnPrev.style.display = 'none';
            }
        }
        if (btnConfirm) {
            const useSame = !!(chkSamePal && chkSamePal.checked);
            const isLast = (currentIndex >= loadedImages.length - 1);
            if (!isLast && !useSame) {
                btnConfirm.textContent = t('btn_next') || 'NEXT';
                btnConfirm.setAttribute('data-i18n', 'btn_next');
            } else if (loadedImages.length > 1) {
                btnConfirm.textContent = t('btn_convert_images_tabs') || 'CONVERT IMAGES IN NEW TABS';
                btnConfirm.setAttribute('data-i18n', 'btn_convert_images_tabs');
            } else {
                btnConfirm.textContent = t('btn_convert_image_tab') || 'CONVERT IMAGE IN NEW TAB';
                btnConfirm.setAttribute('data-i18n', 'btn_convert_image_tab');
            }
            const hasPal = Boolean(currentPalArray && currentPalArray.length === 256);
            btnConfirm.disabled = !hasPal;
            btnConfirm.style.opacity = hasPal ? '1' : '0.45';
            btnConfirm.style.cursor = hasPal ? 'pointer' : 'not-allowed';
            btnConfirm.style.pointerEvents = hasPal ? 'auto' : 'none';
        }
        if (btnNoPal) {
            const isOriginal = !currentPalArray;
            btnNoPal.style.borderColor = isOriginal ? 'var(--accent)' : 'var(--border)';
            btnNoPal.style.color = isOriginal ? 'var(--accent)' : '#cbd5e1';
            btnNoPal.style.background = isOriginal ? 'rgba(0, 255, 170, 0.1)' : '#1a202c';
        }
    };

    const renderCurrentImagePreview = () => {
        const entry = loadedImages[currentIndex];
        if (!entry) return;

        if (fileInfo) {
            const prefix = loadedImages.length > 1 ? `(${currentIndex + 1}/${loadedImages.length}) ` : '';
            fileInfo.textContent = `${prefix}${entry.name} [${entry.width}x${entry.height}]`;
        }

        const w = entry.width;
        const h = entry.height;
        const dpr = window.devicePixelRatio || 1;
        previewCanvas.width = w;
        previewCanvas.height = h;
        previewCanvas.style.width = (w / dpr) + 'px';
        previewCanvas.style.height = (h / dpr) + 'px';
        const ctx = previewCanvas.getContext('2d');

        if (!currentPalArray) {
            // No palette selected yet: show empty palette grid and original Full Color image
            if (typeof renderPaletteSimple === 'function' && palGrid) {
                renderPaletteSimple([], palGrid);
            }
            const imgData = ctx.createImageData(w, h);
            const dst = imgData.data;
            for (let i = 0; i < w * h; i++) {
                const color = entry.pixels[i];
                const off = i * 4;
                if (!color || color.a < 128) {
                    dst[off] = 0;
                    dst[off + 1] = 0;
                    dst[off + 2] = 0;
                    dst[off + 3] = 0;
                } else {
                    dst[off] = color.r;
                    dst[off + 1] = color.g;
                    dst[off + 2] = color.b;
                    dst[off + 3] = color.a;
                }
            }
            ctx.putImageData(imgData, 0, 0);
            return;
        }

        if (typeof renderPaletteSimple === 'function' && palGrid) {
            renderPaletteSimple(currentPalArray, palGrid);
        }

        const cacheKey = currentPalNode ? currentPalNode.id : null;
        if (cacheKey && entry._previewCache.has(cacheKey)) {
            ctx.putImageData(entry._previewCache.get(cacheKey), 0, 0);
            return;
        }

        let indices;
        let pdnLayerDataList = null;
        if (entry.pdnLayers && entry.pdnLayers.length > 0) {
            const qRes = quantizePdnLayers(entry.pdnLayers, w, h, currentPalArray);
            indices = qRes.compIndices;
            pdnLayerDataList = qRes.layerDataList;
        } else {
            indices = quantizeImageWithRgbCache(entry.pixels, w, h, currentPalArray);
        }
        const imgData = ctx.createImageData(w, h);
        const dst = imgData.data;

        for (let i = 0; i < w * h; i++) {
            const idx = indices[i];
            const off = i * 4;
            if (idx === TRANSPARENT_COLOR) {
                dst[off] = 0;
                dst[off + 1] = 0;
                dst[off + 2] = 0;
                dst[off + 3] = 0;
            } else {
                const c = currentPalArray[idx] || { r: 0, g: 0, b: 0 };
                dst[off] = c.r;
                dst[off + 1] = c.g;
                dst[off + 2] = c.b;
                dst[off + 3] = 255;
            }
        }

        if (cacheKey) {
            entry._previewCache.set(cacheKey, imgData);
            entry._indexCache.set(cacheKey, indices);
            if (pdnLayerDataList && entry._layerIndexCache) {
                entry._layerIndexCache.set(cacheKey, pdnLayerDataList);
            }
        }
        ctx.putImageData(imgData, 0, 0);
    };

    const syncCurrentStepState = () => {
        const entry = loadedImages[currentIndex];
        currentPalArray = entry && entry.chosenPal ? entry.chosenPal.map(c => c ? { ...c } : { r: 0, g: 0, b: 0 }) : null;
        currentPalNode = entry && entry.chosenNode ? entry.chosenNode : null;
        if (typeof updatePaletteSelectorUI === 'function') {
            updatePaletteSelectorUI('menuItemDropImgPalettes', currentPalNode);
        }
        updateButtonsUI();
        renderCurrentImagePreview();
    };

    window.onDropImgPaletteSelected = (palArray, node) => {
        currentPalArray = palArray.map(c => c ? { ...c } : { r: 0, g: 0, b: 0 });
        currentPalNode = node;
        if (loadedImages[currentIndex]) {
            loadedImages[currentIndex].chosenPal = currentPalArray.map(c => c ? { ...c } : { r: 0, g: 0, b: 0 });
            loadedImages[currentIndex].chosenNode = currentPalNode;
        }
        if (typeof updatePaletteSelectorUI === 'function') {
            updatePaletteSelectorUI('menuItemDropImgPalettes', node);
        }
        updateButtonsUI();
        renderCurrentImagePreview();
    };

    if (chkSamePal) {
        chkSamePal.onchange = () => {
            updateButtonsUI();
        };
    }

    const cleanupDialog = () => {
        window.onDropImgPaletteSelected = null;
        if (typeof closeAllPaletteMenus === 'function') closeAllPaletteMenus();
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
    };

    if (btnNoPal) {
        btnNoPal.onclick = () => {
            currentPalArray = null;
            currentPalNode = null;
            if (loadedImages[currentIndex]) {
                loadedImages[currentIndex].chosenPal = null;
                loadedImages[currentIndex].chosenNode = null;
            }
            if (typeof updatePaletteSelectorUI === 'function') {
                updatePaletteSelectorUI('menuItemDropImgPalettes', null);
            }
            updateButtonsUI();
            renderCurrentImagePreview();
        };
    }

    if (btnCreatePal) {
        btnCreatePal.onclick = () => {
            const entry = loadedImages[currentIndex];
            if (!entry) return;
            const newPal = buildAdaptive256PaletteForImage(entry.pixels, entry.width, entry.height, entry.pdnLayers);
            const palBaseName = (entry.name || 'custom_palette').replace(/\.[^/.]+$/, '').trim() || 'custom_palette';
            const node = (typeof registerCustomPaletteNode === 'function')
                ? registerCustomPaletteNode(palBaseName, newPal)
                : { id: 'custom_' + Date.now(), name: palBaseName, type: 'palette' };
            if (node && node.id) {
                entry._previewCache.delete(node.id);
                entry._indexCache.delete(node.id);
                if (entry._layerIndexCache) entry._layerIndexCache.delete(node.id);
            }
            if (typeof window.onDropImgPaletteSelected === 'function') {
                window.onDropImgPaletteSelected(newPal, node);
            }
            if (typeof showPasteNotification === 'function') {
                showPasteNotification(t('msg_custom_pal_created', { name: node ? node.name : palBaseName }) || `Custom palette "${palBaseName}" created`, 'info', 2500);
            }
        };
    }

    if (btnCancel) {
        btnCancel.onclick = () => {
            cleanupDialog();
        };
    }

    if (btnPrev) {
        btnPrev.onclick = () => {
            if (currentIndex > 0) {
                currentIndex--;
                syncCurrentStepState();
            }
        };
    }

    if (btnConfirm) {
        btnConfirm.onclick = () => {
            if (!currentPalArray) return;
            loadedImages[currentIndex].chosenPal = currentPalArray.map(c => c ? { ...c } : { r: 0, g: 0, b: 0 });
            loadedImages[currentIndex].chosenNode = currentPalNode;

            const useSame = !!(chkSamePal && chkSamePal.checked);
            if (useSame) {
                for (let i = 0; i < loadedImages.length; i++) {
                    if (!loadedImages[i].chosenPal || i >= currentIndex) {
                        loadedImages[i].chosenPal = currentPalArray.map(c => c ? { ...c } : { r: 0, g: 0, b: 0 });
                        loadedImages[i].chosenNode = currentPalNode;
                    }
                }
            } else if (currentIndex < loadedImages.length - 1) {
                currentIndex++;
                syncCurrentStepState();
                return;
            }

            cleanupDialog();

            for (let i = 0; i < loadedImages.length; i++) {
                const imgEntry = loadedImages[i];
                const w = imgEntry.width;
                const h = imgEntry.height;
                const pal = imgEntry.chosenPal || currentPalArray;
                const node = imgEntry.chosenNode || currentPalNode;
                const baseName = imgEntry.name.replace(/\.[^/.]+$/, '') + '.shp';

                const cacheKey = node ? node.id : null;

                if (i === 0) {
                    const curTab = (state.activeTabIndex >= 0 && state.tabs[state.activeTabIndex]) ? state.tabs[state.activeTabIndex] : null;
                    const isCurrentTabEmpty = curTab && state.frames.length === 0 && !state.hasChanges && !curTab.fileName;
                    if (!isCurrentTabEmpty && typeof createNewTab === 'function') {
                        createNewTab(baseName, false);
                    }
                } else if (typeof createNewTab === 'function') {
                    createNewTab(baseName, false);
                }

                const clonedPal = pal.map(c => c ? { r: c.r, g: c.g, b: c.b, locked: false } : { r: 0, g: 0, b: 0, locked: false });
                const isTdRaPal = Boolean(node && node.id && (node.id.startsWith('game_td_') || node.id.startsWith('game_ra1_')));
                const targetShpFormat = isTdRaPal ? 'td_ra' : 'ts_ra2';
                const rawPrefComp = parseInt(localStorage.getItem(isTdRaPal ? 'ase_pref_default_comp_td_ra' : 'ase_pref_default_comp'), 10);
                const targetComp = Number.isFinite(rawPrefComp) ? rawPrefComp : (isTdRaPal ? 80 : 3);
                createNewProject(w, h, 1, false, clonedPal, targetComp, false, targetShpFormat);

                if (state.frames.length > 0 && state.frames[0]) {
                    if (imgEntry.pdnLayers && imgEntry.pdnLayers.length > 0) {
                        const cachedLayerData = (cacheKey && imgEntry._layerIndexCache && imgEntry._layerIndexCache.has(cacheKey))
                            ? imgEntry._layerIndexCache.get(cacheKey)
                            : quantizePdnLayers(imgEntry.pdnLayers, w, h, pal).layerDataList;
                        let builtLayers;
                        let firstVisibleLeaf = null;
                        let firstAnyLeaf = null;
                        if (imgEntry.psdTree && imgEntry.psdTree.length > 0) {
                            const buildFromPsdTree = (nodes) => nodes.map(n => {
                                if (n.type === 'group') {
                                    return {
                                        type: 'group',
                                        id: generateId(),
                                        name: n.name || 'Group',
                                        visible: Boolean(n.visible),
                                        expanded: n.expanded !== false,
                                        children: buildFromPsdTree(n.children || [])
                                    };
                                } else {
                                    const lNode = {
                                        type: 'layer',
                                        id: generateId(),
                                        name: n.name || 'Layer',
                                        data: new Uint16Array(cachedLayerData[n.leafIndex]),
                                        visible: Boolean(n.visible),
                                        width: w,
                                        height: h,
                                        mask: null,
                                        editMask: false
                                    };
                                    if (!firstAnyLeaf) firstAnyLeaf = lNode;
                                    if (!firstVisibleLeaf && n.effectiveVisible && !n.isBackground) {
                                        firstVisibleLeaf = lNode;
                                    }
                                    return lNode;
                                }
                            });
                            builtLayers = buildFromPsdTree(imgEntry.psdTree);
                        } else {
                            builtLayers = imgEntry.pdnLayers.map((pLyr, lIdx) => ({
                                type: 'layer',
                                id: generateId(),
                                name: pLyr.name || `Layer ${lIdx + 1}`,
                                data: new Uint16Array(cachedLayerData[lIdx]),
                                visible: Boolean(pLyr.visible),
                                width: w,
                                height: h,
                                mask: null,
                                editMask: false
                            })).reverse(); // Reverse so index 0 is TOP layer and index length-1 is BOTTOM layer
                        }
                        state.frames[0].layers = builtLayers;
                        state.frames[0]._v = (state.frames[0]._v || 0) + 1;
                        const activeCand = firstVisibleLeaf
                            || builtLayers.find((l, idx) => l.type === 'layer' && l.visible && idx < builtLayers.length - 1)
                            || builtLayers.find(l => l.type === 'layer' && l.visible)
                            || firstAnyLeaf
                            || builtLayers[0];
                        if (activeCand) {
                            state.activeLayerId = activeCand.id;
                            state.selectedLayerIds = [state.activeLayerId];
                        }
                    } else if (state.frames[0].layers && state.frames[0].layers.length > 0) {
                        const indices = (cacheKey && imgEntry._indexCache && imgEntry._indexCache.has(cacheKey))
                            ? new Uint16Array(imgEntry._indexCache.get(cacheKey))
                            : quantizeImageWithRgbCache(imgEntry.pixels, w, h, pal);
                        state.frames[0].layers[0].data = indices;
                        state.frames[0].layers[0].name = 'Layer 1';
                        state.frames[0]._v = (state.frames[0]._v || 0) + 1;
                    }
                }

                if (node && node.id) {
                    if (typeof setActivePaletteId === 'function') setActivePaletteId(node.id);
                    if (state.activeTabIndex >= 0 && state.tabs[state.activeTabIndex]) {
                        state.tabs[state.activeTabIndex].appliedPaletteId = node.id;
                        state.tabs[state.activeTabIndex].palette = JSON.parse(JSON.stringify(state.palette));
                    }
                    if (typeof recordUsage === 'function') {
                        recordUsage({ id: node.id, name: node.name, path: [node.name] });
                    }
                }

                if (typeof updateCurrentTabName === 'function') {
                    updateCurrentTabName(baseName, true);
                }
                state.hasChanges = true;
                if (state.activeTabIndex >= 0 && state.tabs[state.activeTabIndex]) {
                    state.tabs[state.activeTabIndex].hasChanges = true;
                }

                state.history = [];
                state.historyPtr = -1;
                pushHistory();

                if (state.activeTabIndex >= 0 && state.tabs[state.activeTabIndex]) {
                    state.saveToTab(state.tabs[state.activeTabIndex]);
                }
            }

            showEditorInterface();
            updateCanvasSize();
            renderCanvas();
            renderFramesList();
            updateLayersList();
            renderPalette();
            if (typeof syncPaletteSelector === 'function') syncPaletteSelector();
            if (typeof renderTabs === 'function') renderTabs();
            if (typeof updateUIState === 'function') updateUIState();
        };
    }

    syncCurrentStepState();

    if (typeof dialog.showModal === 'function') {
        if (!dialog.open) dialog.showModal();
    } else {
        dialog.setAttribute('open', '');
    }
}
window.openDropImagePaletteDialog = openDropImagePaletteDialog;

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
            showPasteNotification(t('msg_full_preview_no_tiles'), "error", 6000);
            return;
        }
        const bounds = TmpTsFile.computeBounds({ header: state.tmpHeader, tiles, numTiles: tiles.length });
        if (!bounds.hasTiles) {
            showPasteNotification(t('msg_full_preview_no_valid_tiles'), "error", 6000);
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
            showPasteNotification(t('msg_full_preview_paste_success'), "success", 3000);
            return;
        } else {
            showPasteNotification(t('msg_full_preview_paste_size_mismatch', {
                width: data.width,
                height: data.height,
                previewWidth: cw,
                previewHeight: ch
            }), "error", 8000);
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

    const activePal = getActivePalette();
    for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) {
            const color = data.pixels[y * data.width + x];
            if (color.a < 128) continue;
            indices[y * sw + x] = quantizeInfurium(data.pixels, data.width, data.height, x, y, activePal);
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

export function populateTabWithTmpData(tab, buffer, filename) {
    if (!tab || !buffer) return false;
    if (buffer && ArrayBuffer.isView(buffer)) {
        buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }

    let parsed;
    try {
        parsed = TmpTsFile.parse(buffer);
    } catch (err) {
        console.error('Error parsing TMP file:', err);
        return false;
    }

    const { header, tiles } = parsed;
    const { cx, cy } = header;

    tab.isTmpMode = true;
    tab.tmpHeader = header;
    tab.originalTmpTiles = tiles.map(t => t ? { ...t } : null); // shallow clone per tile
    tab.tmpFilename = filename;

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

    tab.frames = frames;
    tab.currentFrameIdx = 0;

    // Canvas size = first frame's dimensions
    if (frames.length > 0) {
        tab.canvasW = frames[0].width;
        tab.canvasH = frames[0].height;
        tab.activeLayerId = frames[0].layers[0].id;
    } else {
        tab.canvasW = cx;
        tab.canvasH = cy;
    }

    tab.selection = null;
    tab.floatingSelection = null;
    tab.useShadows = false;
    tab.showShadowOverlay = false;
    tab.isAlphaImageMode = false;
    tab.tmpFullZPreviewActive = false;
    return true;
}

/**
 * Load a TS/RA2 TMP file into the editor.
 * Populates state.frames with one entry per editable tile component.
 * @param {ArrayBuffer} buffer - raw file bytes
 * @param {string} filename - original filename (for Save)
 */
export function loadTmpData(buffer, filename, skipPaletteAutoselect = false) {
    console.time('TMP Initialization');
    resetFramesList();

    const ok = populateTabWithTmpData(state, buffer, filename);
    if (!ok) {
        alert('Error parsing TMP file.');
        return;
    }

    const activeTab = (state.activeTabIndex >= 0 && state.tabs[state.activeTabIndex]) ? state.tabs[state.activeTabIndex] : null;
    if (activeTab) {
        populateTabWithTmpData(activeTab, buffer, filename);
    }

    document.body.classList.add('tmp-mode');

    const cx = state.tmpHeader?.cx || 60;
    // Autoselect palette if not manually selected by the user
    if (!state.paletteSelectedManually && !skipPaletteAutoselect && filename) {
        const ext = filename.split('.').pop().toLowerCase();
        let autoPaletteId = null;

        if (cx === 48) {
            if (ext === 'sno') {
                autoPaletteId = 'game_ts_isosno';
            } else {
                autoPaletteId = 'game_ts_isotem';
            }
        } else if (cx === 60) {
            if (ext === 'sno') {
                autoPaletteId = 'game_ra2_isosno';
            } else if (ext === 'urb') {
                autoPaletteId = 'game_ra2_isourb';
            } else if (ext === 'des') {
                autoPaletteId = 'game_yr_isodes';
            } else if (ext === 'ubn') {
                autoPaletteId = 'game_yr_isoubn';
            } else if (ext === 'lun') {
                autoPaletteId = 'game_yr_isolun';
            } else {
                autoPaletteId = 'game_ra2_isotem';
            }
        }

        if (autoPaletteId) {
            if (typeof applyPaletteById === 'function') {
                applyPaletteById(autoPaletteId, false);
            } else if (window.applyPaletteById) {
                window.applyPaletteById(autoPaletteId, false);
            }
        }
    }
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
            extraZData: t.extraZData ? new Uint8Array(t.extraZData) : null
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

    const curTab = (state.activeTabIndex >= 0 && state.tabs[state.activeTabIndex])
        ? state.tabs[state.activeTabIndex]
        : null;
    const activeHandle = (curTab && curTab.fileHandle) ? curTab.fileHandle : (state.fileHandle || window._lastShpFileHandle);

    const filename = (curTab && curTab.fileName) || state.tmpFilename || 'output.tem';
    const blob = new Blob([encoded], { type: 'application/octet-stream' });

    // Native Desktop mode (Tauri)
    if (isNativeApp()) {
        let filePath = (curTab && curTab.filePath) || state.filePath || window._lastTmpFilePath;
        if (!filePath && curTab && curTab.fileName && !curTab.isNewProject && !forceSaveAs) {
            try {
                const resolved = await nativeResolveDroppedFiles([{
                    name: curTab.fileName,
                    size: curTab.fileSize || 0,
                    lastModified: curTab.fileLastModified || 0
                }]);
                if (resolved && resolved[0]) {
                    filePath = resolved[0];
                    curTab.filePath = filePath;
                    state.filePath = filePath;
                    window._lastTmpFilePath = filePath;
                }
            } catch (e) {}
            if (!filePath) {
                const recentPath = await getRecentFilePathByName(curTab.fileName);
                if (recentPath) {
                    try {
                        const mtime = await nativeGetFileModifiedTime(recentPath);
                        if (mtime !== null && mtime !== undefined) {
                            filePath = recentPath;
                            curTab.filePath = filePath;
                            state.filePath = filePath;
                            window._lastTmpFilePath = filePath;
                        }
                    } catch (e) {}
                }
            }
            if (!filePath) {
                const lastDir = window._lastNativeDirectory || localStorage.getItem('last_native_directory');
                if (lastDir) {
                    const candidate = lastDir.replace(/[/\\]+$/, '') + '\\' + curTab.fileName;
                    try {
                        const mtime = await nativeGetFileModifiedTime(candidate);
                        if (mtime !== null && mtime !== undefined) {
                            filePath = candidate;
                            curTab.filePath = filePath;
                            state.filePath = filePath;
                            window._lastTmpFilePath = filePath;
                        }
                    } catch (e) {}
                }
            }
        }
        if (filePath && !forceSaveAs) {
            try {
                await nativeWriteFile(filePath, encoded);
                const mtime = await nativeGetFileModifiedTime(filePath);
                if (curTab) {
                    curTab.filePath = filePath;
                    curTab.hasChanges = false;
                    curTab.savedHistoryPtr = state.historyPtr;
                    curTab.fileLastModified = mtime;
                    curTab.isNewProject = false;
                }
                state.filePath = filePath;
                state.savedHistoryPtr = state.historyPtr;
                state.hasChanges = false;
                state.fileLastModified = mtime;
                window._lastTmpFilePath = filePath;
                const dir = filePath.substring(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
                if (dir) {
                    window._lastNativeDirectory = dir;
                    try { localStorage.setItem('last_native_directory', dir); } catch (e) {}
                }
                if (window.renderTabs) window.renderTabs();
                const fn = filePath.split(/[/\\]/).pop();
                const msg = (state.translations && state.translations.msg_tmp_saved)
                    ? state.translations.msg_tmp_saved.replace('{filename}', fn)
                    : `TMP saved: ${fn}`;
                showPasteNotification('✅ ' + msg, 'success', 2500);
                return;
            } catch (err) {
                console.error('[Native Save TMP] Error writing file:', err);
                alert(`Error saving TMP: ${err}`);
                return;
            }
        } else {
            // Native Save As
            const currentExt = filename.split('.').pop().toLowerCase();
            const filters = [
                { name: 'Temperate TMP (*.tem)', extensions: ['tem'] },
                { name: 'Snow TMP (*.sno)', extensions: ['sno'] },
                { name: 'Urban TMP (*.urb)', extensions: ['urb'] },
                { name: 'Desert TMP (*.des)', extensions: ['des'] },
                { name: 'Lunar TMP (*.lun)', extensions: ['lun'] },
                { name: 'New Urban TMP (*.ubn)', extensions: ['ubn'] },
                { name: 'All Westwood TMP Files (*.tem, *.sno, *.urb, *.des, *.lun, *.ubn)', extensions: ['tem', 'sno', 'urb', 'des', 'lun', 'ubn'] },
                { name: 'All Files (*.*)', extensions: ['*'] }
            ];

            const matchIdx = filters.findIndex(f => f.extensions.length === 1 && f.extensions.includes(currentExt));
            if (matchIdx > 0) {
                const [matched] = filters.splice(matchIdx, 1);
                filters.unshift(matched);
            }

            let chosenPath = await nativeSaveFileDialog({
                defaultName: filename,
                title: 'Save TMP File',
                filters
            });
            if (!chosenPath) return;

            if (!/\.(tem|sno|urb|des|lun|ubn)$/i.test(chosenPath)) {
                chosenPath = `${chosenPath}.${currentExt || 'tem'}`;
            }

            try {
                await nativeWriteFile(chosenPath, encoded);
                const mtime = await nativeGetFileModifiedTime(chosenPath);
                const fn = chosenPath.split(/[/\\]/).pop();
                if (curTab) {
                    curTab.filePath = chosenPath;
                    curTab.fileName = fn;
                    curTab.hasChanges = false;
                    curTab.savedHistoryPtr = state.historyPtr;
                    curTab.fileLastModified = mtime;
                    curTab.isNewProject = false;
                }
                state.filePath = chosenPath;
                state.fileHandle = null;
                state.tmpFilename = fn;
                state.savedHistoryPtr = state.historyPtr;
                state.hasChanges = false;
                state.fileLastModified = mtime;
                window._lastTmpFilePath = chosenPath;
                window._lastTmpFilename = fn;
                if (typeof updateCurrentTabName === 'function') updateCurrentTabName(fn, false);
                if (typeof window.saveRecentFile === 'function') window.saveRecentFile(fn, chosenPath);
                if (window.renderTabs) window.renderTabs();
                const msg = (state.translations && state.translations.msg_tmp_saved)
                    ? state.translations.msg_tmp_saved.replace('{filename}', fn)
                    : `TMP saved: ${fn}`;
                showPasteNotification('✅ ' + msg, 'success', 2500);
                return;
            } catch (err) {
                console.error('[Native Save As TMP] Error:', err);
                alert(`Error saving TMP: ${err}`);
                return;
            }
        }
    }

    // Direct write to existing handle (if !forceSaveAs and handle exists)
    if (activeHandle && !forceSaveAs && window.showSaveFilePicker) {
        try {
            if (typeof activeHandle.queryPermission === 'function') {
                const status = await activeHandle.queryPermission({ mode: 'readwrite' });
                if (status !== 'granted') {
                    const req = await activeHandle.requestPermission({ mode: 'readwrite' });
                    if (req !== 'granted') {
                        throw new Error("Permission to write not granted");
                    }
                }
            }
            const writable = await activeHandle.createWritable();
            await writable.write(blob);
            await writable.close();

            if (curTab) {
                curTab.fileHandle = activeHandle;
                curTab.hasChanges = false;
                curTab.savedHistoryPtr = state.historyPtr;
            }
            state.fileHandle = activeHandle;
            window._lastShpFileHandle = activeHandle;
            window._lastTmpFileHandle = activeHandle;
            state.savedHistoryPtr = state.historyPtr;
            state.hasChanges = false;
            if (window.renderTabs) window.renderTabs();
            
            const t = state.translations;
            const msg = (t && t.msg_tmp_saved)
                ? t.msg_tmp_saved.replace('{filename}', activeHandle.name)
                : `TMP saved: ${activeHandle.name}`;
            showPasteNotification('✅ ' + msg, 'success', 2500);
            return;
        } catch (err) {
            console.error("Handle save failed, falling back:", err);
            if (err.name === 'AbortError') return;
        }
    }

    // File picker dialog in browser (if forceSaveAs or no handle yet)
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

            if (curTab) {
                curTab.fileHandle = handle;
                curTab.fileName = handle.name;
                curTab.hasChanges = false;
                curTab.savedHistoryPtr = state.historyPtr;
            }
            state.fileHandle = handle;
            window._lastShpFileHandle = handle;
            window._lastTmpFileHandle = handle;
            state.tmpFilename = handle.name;
            state.savedHistoryPtr = state.historyPtr;
            state.hasChanges = false;
            if (typeof updateCurrentTabName === 'function') updateCurrentTabName(handle.name);
            if (typeof window.saveRecentFile === 'function') window.saveRecentFile(handle.name, handle);
            if (window.renderTabs) window.renderTabs();
            
            showPasteNotification(`✅ Saved as: ${handle.name}`, 'success', 2500);
            return;
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error("Save file picker failed:", err);
            showPasteNotification("Save failed: " + (err.message || err), "error", 3000);
            return;
        }
    }

    // Fallback simple download for browsers without File System Access API
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    state.savedHistoryPtr = state.historyPtr;
    state.hasChanges = false;
    if (curTab) {
        curTab.hasChanges = false;
        curTab.savedHistoryPtr = state.historyPtr;
    }
    if (window.renderTabs) window.renderTabs();

    const t = state.translations;
    const msg = (t && t.msg_tmp_saved)
        ? t.msg_tmp_saved.replace('{filename}', filename)
        : `TMP saved: ${filename}`;
    showPasteNotification('✅ ' + msg, 'success', 2500);
}
