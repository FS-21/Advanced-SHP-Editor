import { state, generateId, TRANSPARENT_COLOR } from './state.js';
import { elements } from './constants.js';
import { ShpFormat80 } from './shp_format.js';
import { TmpTsFile } from './tmp_format.js';
import { renderCanvas, renderFramesList, renderTmpComponentsList, updateLayersList, updateCanvasSize, renderPalette, showEditorInterface, resetFramesList, renderFrameManager, getActiveLayer, showChoice, showConfirm, renderOverlay, showPasteNotification, commitSelection, syncStatusCompressionUI } from './ui.js';
import { pushHistory } from './history.js';
import { findNearestPaletteIndex, getActivePalette } from './utils.js';
import { PcxLoader } from './pcx_loader.js';
import { exportFrameList, encodeFramesToShpBuffer, downloadFileAsBlob } from './export_helper.js';

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

    // Set SHP Format and Compression Default
    state.shpFormat = shp.formatType || 'ts_ra2';
    if (state.activeTabIndex >= 0 && state.tabs[state.activeTabIndex]) {
        state.tabs[state.activeTabIndex].shpFormat = state.shpFormat;
    }

    if (state.frames.length > 0) {
        const comp = state.frames[0].compression;
        const normalizedComp = (comp === 1 || comp === 0) ? 1 : 3;
        state.compression = normalizedComp;
        if (elements.selExpShpType) elements.selExpShpType.value = normalizedComp.toString();
        if (state.activeTabIndex >= 0 && state.tabs[state.activeTabIndex]) {
            state.tabs[state.activeTabIndex].compression = normalizedComp;
        }
        syncStatusCompressionUI();
    }

    state.canvasW = sw;
    state.canvasH = sh;
    state.currentFrameIdx = 0;

    if (state.frames.length > 0 && state.frames[0].layers.length > 0) {
        state.activeLayerId = state.frames[0].layers[0].id;
    }

    // Note: state.history and state.historyPtr are managed by the caller
    // (e.g. openRecentFile, import dialog handlers) so that per-tab history
    // is preserved when loading into a new tab.

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
            let optTd = elements.selExpShpType.querySelector('option[value="td_ra"]');
            if (state.shpFormat === 'td_ra') {
                if (!optTd) {
                    optTd = document.createElement('option');
                    optTd.value = "td_ra";
                    optTd.textContent = "TD / RA1 (Format 80)";
                    elements.selExpShpType.appendChild(optTd);
                }
                elements.selExpShpType.value = "td_ra";
                elements.selExpShpType.disabled = true;
                elements.selExpShpType.title = "TD/RA1 uses native Westwood compression (Format 80)";
            } else {
                if (optTd) optTd.remove();
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
        return !state.hasChanges;
    }

    const curTab = (state.activeTabIndex >= 0 && state.tabs[state.activeTabIndex])
        ? state.tabs[state.activeTabIndex]
        : null;
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
            const compression = tab.compression !== undefined ? tab.compression : (state.compression || 3);
            return encodeFramesToShpBuffer(tab.frames, compression, tab.isAlphaImageMode);
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
            if (!tab.hasChanges && tab.fileHandle) continue;
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
        const isModified = Boolean(tab.hasChanges || (!tab.fileHandle && (tab.isTmpMode ? tab.originalTmpTiles : (tab.frames && tab.frames.length > 0))));
        if (isModified) modifiedIndices.push(i);

        let badgeClass = 'badge-clean';
        let badgeText = t.lbl_file_status_clean || 'Up to date';

        if (!tab.fileHandle) {
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

            // 1. Silent Fast Pass: direct save any tab that ALREADY has 'granted' permission
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

            // 2. Interactive Loop: Request permission and save remaining files
            for (let k = 0; k < modifiedIndices.length; k++) {
                const idx = modifiedIndices[k];
                const tab = state.tabs[idx];
                if (!tab.hasChanges && tab.fileHandle) continue; // already saved!

                const badge = document.getElementById(`saveAllBadge_${idx}`);
                const actionSlot = document.getElementById(`saveAllActionSlot_${idx}`);

                if (tab.fileHandle) {
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
                        // Transient user activation expired in Chrome!
                        // PAUSE CLEANLY AND TRANSFORM BUTTON TO CONTINUATION
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
                        return; // Halt and wait for user's click to resume with fresh activation!
                    }
                } else {
                    // New file without handle: Provide Save As button
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

            // 3. All saved or processed!
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
    const compression = parseInt(elements.selExpShpType.value) || 3;

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
export function loadTmpData(buffer, filename, skipPaletteAutoselect = false) {
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

    // Autoselect palette if not manually selected by the user
    if (!state.paletteSelectedManually && !skipPaletteAutoselect) {
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

    // Note: state.history and state.historyPtr are managed by the caller
    // (e.g. openRecentFile, import dialog handlers) so that per-tab history
    // is preserved when loading into a new tab.
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

    // 1. Direct write to existing handle (if !forceSaveAs and handle exists)
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

    // 2. Native File Picker in Chrome (if forceSaveAs or no handle yet)
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

    // 3. Fallback simple download for browsers without File System Access API (e.g. Firefox)
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
