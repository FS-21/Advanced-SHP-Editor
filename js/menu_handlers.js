import { state, TRANSPARENT_COLOR, generateId } from './state.js';
import { elements } from './constants.js';
import {
    showConfirm, renderCanvas,
    renderFramesList, updateLayersList, showEditorInterface,
    updateCanvasSize, addFrame, createNewProject, openFrameManager,
    selectAll, invertSelection, copySelection, cutSelection, pasteClipboard, pasteAsNewFrame, zoomToSelection,
    updatePixelGrid, renderLayerThumbnail, setupTooltips
} from './ui.js';
import { openNewShpDialog, updateUIState } from './main.js';
import { processImageFile, showExportDialog, resizeEntireShp, loadShpData, handleSaveShp } from './file_io.js';
import { resetImportState, syncImporterPalette } from './import_shp.js';
import { ShpFormat80 } from './shp_format.js';
import { PcxLoader } from './pcx_loader.js';
import { findNearestPaletteIndex, setupAutoRepeat, compositeFrame } from './utils.js';
import { t } from './translations.js';
import { closeAllPaletteMenus, getActivePaletteId, applyPaletteById, getMostRecentPaletteId, getPaletteName, findNodeById, applyPaletteFromEntry } from './palette_menu.js';
import { undo, redo, pushHistory } from './history.js';
import { deselect, deleteSelection, fillSelection } from './tools.js';
import { renderPaletteSimple } from './ui.js';
import {
    flipImage, rotateImage, flattenLayers,
    resizeImage, resizeCanvas, resizeCanvasOffsets, resampleLayerData
} from './image_ops.js';
import { openSequenceEditor, initSequenceEditor } from './infantry_sequence.js';
import { openVehicleSequenceEditor, initVehicleSequenceEditor } from './vehicle_sequence.js';


let spriteSheetFile = null;
let otherShpFile = null;
let savedAlphaSettings = null;

export function updateMenuState(hasProject) {
    const actions = [
        'menuSave', 'menuSaveAs', 'menuExpSpriteSheet', 'menuExpRange', 'menuExpCurrent',
        'menuFrameMgr', 'menuCloseShp'
    ];
    actions.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (hasProject) el.classList.remove('disabled');
            else el.classList.add('disabled');
        }
    });

    // Edit Menu items
    const editActions = {
        'menuUndo': state.historyPtr > 0,
        'menuRedo': state.historyPtr < state.history.length - 1,
        'menuCut': !!state.selection,
        'menuCopy': !!state.selection,
        'menuPasteActive': !!state.clipboard,
        'menuPasteNewLayer': !!state.clipboard,
        'menuPasteNewFrame': !!state.clipboard,
        'triggerPaste': !!state.clipboard,
        'menuFill': !!state.selection,
        'menuDelete': !!state.selection,
        'menuSelectAll': hasProject,
        'menuDeselect': !!state.selection,
        'menuInvertSelection': hasProject
    };

    // Update Image Menu items state
    const imageActions = [
        'menuCropSelection', 'menuResizeImage', 'menuResizeCanvasUnified',
        'triggerFlipH', 'triggerFlipV', 'triggerRot90CW', 'triggerRot90CCW',
        'triggerFlatten'
    ];
    imageActions.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (hasProject) el.classList.remove('disabled');
            else el.classList.add('disabled');
        }
    });

    // Sub-actions depend on specific states (e.g. Selection)
    const subActions = {
        // Flip/Rot Selection
        'menuFlipHSel': !!state.selection,
        'menuFlipVSel': !!state.selection,
        'menuRot90CWSel': !!state.selection,
        'menuRot90CCWSel': !!state.selection,
        'menuCropSelection': !!state.selection
    };
    Object.entries(subActions).forEach(([id, enabled]) => {
        const el = document.getElementById(id);
        if (el) {
            if (enabled) el.classList.remove('disabled');
            else el.classList.add('disabled');
        }
    });

    Object.entries(editActions).forEach(([id, enabled]) => {
        const el = document.getElementById(id);
        if (el) {
            if (enabled) el.classList.remove('disabled');
            else el.classList.add('disabled');
        }
    });

    // View Menu items
    const viewActions = [
        'menuZoomIn', 'menuZoomOut', 'menuZoomToSelection', 'menuZoom100', 'menuShowCenter',
        'menuToggleGrid', 'menuToggleBg', 'triggerGridOptions', 'triggerGameGrid', 'menuToggleShadows', 'menuPreview',
        'menuToggleShadowOverlay', 'menuAlphaImageMode'
    ];
    viewActions.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            let enabled = hasProject;
            if (id === 'menuToggleShadowOverlay') enabled = hasProject && state.useShadows;
            if (id === 'menuToggleShadows' && state.isAlphaImageMode) enabled = false;

            if (enabled) el.classList.remove('disabled');
            else el.classList.add('disabled');
        }
    });

    // Palette Menu item - disable if in Alpha Image Mode
    const palMenuItem = document.getElementById('menuItemPalettes');
    if (palMenuItem) {
        if (state.isAlphaImageMode) {
            palMenuItem.classList.add('disabled-ui');
            palMenuItem.style.pointerEvents = 'none';
            palMenuItem.style.opacity = '0.5';
        } else {
            palMenuItem.classList.remove('disabled-ui');
            palMenuItem.style.pointerEvents = 'auto';
            palMenuItem.style.opacity = '1';
        }
    }

    // Tools Menu items — only enabled when a project is open AND useShadows is true
    const shadowToolActions = ['menuFixShadows', 'menuRemoveUselessShadowPixels', 'menuConvertTStoRA2'];
    shadowToolActions.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (hasProject && state.useShadows) el.classList.remove('disabled');
            else el.classList.add('disabled');
        }
    });

    // Tools enabled just with a project
    const projectToolActions = ['menuConvertRA2toTS', 'menuInfantrySequence', 'menuVehicleSequence'];
    projectToolActions.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (hasProject) el.classList.remove('disabled');
            else el.classList.add('disabled');
        }
    });

    // Import gating: Enabled only if a palette is loaded
    const hasPalette = state.palette.some(c => c !== null);
    ['menuImpSpriteSheet', 'menuImpOtherShp', 'menuImpFromImage'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (hasPalette) el.classList.remove('disabled');
            else el.classList.add('disabled');
        }
    });

    const controls = [
        'btnUndo', 'btnRedo', 'btnToggleGrid', 'btnToggleBg',
        'selIsoGrid', 'cbUseShadows', 'cbShowShadowOverlay'
    ];
    controls.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            let enabled = hasProject;
            if (id === 'btnUndo') enabled = state.historyPtr > 0;
            if (id === 'btnRedo') enabled = state.historyPtr < state.history.length - 1;
            if (id === 'cbShowShadowOverlay') enabled = hasProject && state.useShadows;
            if (id === 'cbUseShadows' && state.isAlphaImageMode) enabled = false;

            if (enabled) {
                el.classList.remove('disabled-ui');
                if ('disabled' in el) el.disabled = false;
            } else {
                el.classList.add('disabled-ui');
                if ('disabled' in el) el.disabled = true;
            }
            // Handle wrappers to block label clicks and dim text
            if (id === 'cbShowShadowOverlay' || id === 'cbUseShadows') {
                const wrapperId = id === 'cbShowShadowOverlay' ? 'wrapperShowShadowOverlay' : 'wrapperUseShadows';
                const wrapper = document.getElementById(wrapperId);
                if (wrapper) {
                    if (enabled) wrapper.classList.remove('disabled-ui');
                    else wrapper.classList.add('disabled-ui');
                }
            }
        }
    });


    // Export trigger depends on project
    ['menuExpSpriteSheet', 'menuExpRange', 'menuExpCurrent'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (hasProject) el.classList.remove('disabled');
            else el.classList.add('disabled');
        }
    });

    // Export trigger depends on project
    const trigExp = document.getElementById('triggerExport');
    if (trigExp) {
        if (hasProject) trigExp.classList.remove('disabled');
        else trigExp.classList.add('disabled');
    }

    // Import trigger depends on Palette
    const trigImp = document.getElementById('triggerImport');
    if (trigImp) {
        if (hasPalette) trigImp.classList.remove('disabled');
        else trigImp.classList.add('disabled');
    }

    syncMenuToggles();
}

export function syncMenuToggles() {
    const toggles = {
        'menuGridShowNone': !state.showGrid,
        'menuGridShowLight': state.showGrid && state.gridColor === 'light',
        'menuGridShowDark': state.showGrid && state.gridColor === 'dark',
        'menuToggleBg': !!state.showBackground,
        'menuToggleShadows': !!state.useShadows,
        'menuGridNone': state.isoGrid === 'none',
        'menuGridTS': state.isoGrid === 'ts',
        'menuGridRA2': state.isoGrid === 'ra2',
        'menuShowCenter': !!state.showCenter,
        'menuToggleShadowOverlay': !!state.showShadowOverlay,
        'menuAlphaImageMode': !!state.isAlphaImageMode
    };

    Object.entries(toggles).forEach(([id, active]) => {
        const el = document.getElementById(id);
        if (el) {
            if (active) el.classList.add('menu-checked');
            else el.classList.remove('menu-checked');
        }
    });

    // Update toolbar button state
    if (elements.btnToggleGrid) {
        elements.btnToggleGrid.classList.toggle('active', state.showGrid);
    }

    const cbShadows = document.getElementById('cbUseShadows');
    if (cbShadows) cbShadows.checked = !!state.useShadows;

    const cbOverlay = document.getElementById('cbShowShadowOverlay');
    if (cbOverlay) cbOverlay.checked = !!state.showShadowOverlay;
}


export function initMenu() {
    setupMenuInteractions();
    setupFileMenu();
    setupEditMenu();
    setupViewMenu();
    setupToolsMenu();
    setupExportHandlers();
    setupImportHandlers();
    setupImportFromImageHandlers();
    setupSteppers();
    setupModalButtons();
}

function setupMenuInteractions() {
    const menuItems = document.querySelectorAll('#mainMenu .menu-item');

    menuItems.forEach(item => {
        const btn = item.querySelector('.menu-btn');
        if (!btn) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isActive = item.classList.contains('active');

            // Close all first
            closeAllMenus();

            if (!isActive) {
                item.classList.add('active');
            }
        });

        btn.addEventListener('mouseenter', () => {
            const anyActive = Array.from(menuItems).some(i => i.classList.contains('active'));
            if (anyActive) {
                closeAllMenus();
                item.classList.add('active');
            }
        });
    });

    window.addEventListener('click', () => closeAllMenus());
}

function closeAllMenus() {
    closeAllPaletteMenus();
    document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
}

function setupFileMenu() {
    // New
    const menuNew = document.getElementById('menuNew');
    if (menuNew) {
        menuNew.onclick = () => {
            closeAllMenus();
            openNewShpDialog();
        };
    }

    // Open
    const menuOpen = document.getElementById('menuOpen');
    if (menuOpen) {
        menuOpen.onclick = () => {
            closeAllMenus();
            resetImportState();
            syncImporterPalette(state.palette);
            if (elements.importShpDialog) elements.importShpDialog.showModal();
        };
    }
    // Save
    const menuSave = document.getElementById('menuSave');
    if (menuSave) {
        menuSave.onclick = () => {
            closeAllMenus();
            handleSaveShp();
        };
    }

    // Save As
    const menuSaveAs = document.getElementById('menuSaveAs');
    if (menuSaveAs) {
        menuSaveAs.onclick = () => {
            closeAllMenus();
            showExportDialog();
        };
    }

    // Frame Manager
    const menuFrameMgr = document.getElementById('menuFrameMgr');
    if (menuFrameMgr) {
        menuFrameMgr.onclick = () => {
            closeAllMenus();
            openFrameManager();
        };
    }


    // Close SHP
    const menuCloseShp = document.getElementById('menuCloseShp');
    if (menuCloseShp) {
        menuCloseShp.onclick = async () => {
            closeAllMenus();
            if (!state.frames || state.frames.length === 0) return;

            const confirmed = await showConfirm(t('dlg_confirm_title'), t('msg_confirm_close_shp') || "Are you sure? Any unsaved changes will be lost.");
            if (confirmed) {
                state.frames = [];
                state.currentFrameIdx = 0;
                state.selection = null;
                state.floatingSelection = null;

                showEditorInterface();
                updateCanvasSize();
                renderCanvas();
                renderFramesList();
                updateLayersList();
                updateUIState();
            }

        };
    }
}

function setupExportHandlers() {
    // Initial placeholders
    const menuExpSpriteSheet = document.getElementById('menuExpSpriteSheet');
    if (menuExpSpriteSheet) {
        menuExpSpriteSheet.onclick = () => {
            closeAllMenus();
            if (typeof showExportSpriteSheetDialog === 'function') showExportSpriteSheetDialog();
        };
    }

    const menuExpRange = document.getElementById('menuExpRange');
    if (menuExpRange) {
        menuExpRange.onclick = () => {
            closeAllMenus();
            if (typeof showExportRangeDialog === 'function') showExportRangeDialog(false);
        };
    }

    const menuExpCurrent = document.getElementById('menuExpCurrent');
    if (menuExpCurrent) {
        menuExpCurrent.onclick = () => {
            closeAllMenus();
            if (typeof showExportRangeDialog === 'function') showExportRangeDialog(true);
        };
    }
}

function setupImportHandlers() {
    const menuImpSpriteSheet = document.getElementById('menuImpSpriteSheet');
    if (menuImpSpriteSheet) {
        menuImpSpriteSheet.onclick = () => {
            closeAllMenus();
            if (typeof showImportSpriteSheetDialog === 'function') showImportSpriteSheetDialog();
        };
    }

    const menuImpOtherShp = document.getElementById('menuImpOtherShp');
    if (menuImpOtherShp) {
        menuImpOtherShp.onclick = () => {
            closeAllMenus();
            showImportOtherShpDialog();
        };
    }

    const menuImpFromImage = document.getElementById('menuImpFromImage');
    if (menuImpFromImage) {
        menuImpFromImage.onclick = () => {
            closeAllMenus();
            showImportFromImageDialog();
        };
    }
}

function showExportSpriteSheetDialog() {
    const dlg = elements.exportSpriteSheetDialog;
    if (!dlg) return;

    // Initialize values
    if (elements.inpExpSheetStart) {
        elements.inpExpSheetStart.value = 0;
        elements.inpExpSheetStart.max = state.frames.length > 0 ? state.frames.length - 1 : 0;
    }
    if (elements.inpExpSheetEnd) {
        elements.inpExpSheetEnd.value = state.frames.length > 0 ? state.frames.length - 1 : 0;
        elements.inpExpSheetEnd.max = state.frames.length > 0 ? state.frames.length - 1 : 0;
    }
    if (elements.inpExpSheetDiv) elements.inpExpSheetDiv.value = 1;
    if (elements.txtExpSheetName) elements.txtExpSheetName.value = "spritesheet";

    updateExportSheetPreview();
    if (typeof dlg.showModal === 'function') dlg.showModal();
}

function updateExportSheetPreview() {
    if (!elements.lblExpSheetFinalDim) return;

    const start = parseInt(elements.inpExpSheetStart.value) || 0;
    const end = parseInt(elements.inpExpSheetEnd.value) || 0;
    const framesPerLine = parseInt(elements.inpExpSheetDiv.value) || 1;
    const orderBy = elements.selExpSheetOrder.value;

    const numFrames = Math.abs(end - start) + 1;
    const frameW = state.canvasW;
    const frameH = state.canvasH;

    let cols, rows;
    if (orderBy === 'horizontal') {
        cols = framesPerLine;
        rows = Math.ceil(numFrames / cols);
    } else {
        rows = framesPerLine;
        cols = Math.ceil(numFrames / rows);
    }

    const totalW = cols * frameW;
    const totalH = rows * frameH;

    elements.lblExpSheetFinalDim.innerText = `${totalW} x ${totalH}`;
}

function showExportRangeDialog(isSingleFrame = false) {
    const dlg = elements.exportFrameRangeDialog;
    if (!dlg) return;

    const titleEl = document.getElementById('exportRangeTitle');
    const fieldsEl = document.getElementById('exportRangeFields');

    if (isSingleFrame) {
        if (titleEl) titleEl.innerText = "EXPORT CURRENT FRAME";
        if (fieldsEl) fieldsEl.style.display = 'none';
        if (elements.txtExpRangePrefix) elements.txtExpRangePrefix.value = "image";
    } else {
        if (titleEl) titleEl.innerText = "EXPORT FRAME RANGE";
        if (fieldsEl) fieldsEl.style.display = 'block';
        if (elements.txtExpRangePrefix) elements.txtExpRangePrefix.value = "frame";
        if (elements.inpExpRangeStart) {
            elements.inpExpRangeStart.value = 0;
            elements.inpExpRangeStart.max = state.frames.length > 0 ? state.frames.length - 1 : 0;
        }
        if (elements.inpExpRangeEnd) {
            elements.inpExpRangeEnd.value = state.frames.length > 0 ? state.frames.length - 1 : 0;
            elements.inpExpRangeEnd.max = state.frames.length > 0 ? state.frames.length - 1 : 0;
        }
    }

    updateExportRangePreview();
    if (typeof dlg.showModal === 'function') dlg.showModal();
}

function updateExportRangePreview() {
    const prefix = elements.txtExpRangePrefix.value || "frame";
    const format = elements.selExpRangeFormat.value || "png";
    const start = parseInt(elements.inpExpRangeStart.value) || 0;
    const end = parseInt(elements.inpExpRangeEnd.value) || 0;

    const container = elements.previewRangeList;
    if (!container) return;

    container.innerHTML = '';
    const titleEl = document.getElementById('exportRangeTitle');
    const isSingle = titleEl && titleEl.innerText.includes("CURRENT");

    if (isSingle) {
        const line = document.createElement('div');
        const num = String(state.currentFrameIdx).padStart(4, '0');
        line.innerText = `${prefix} ${num}.${format}`;
        container.appendChild(line);
    } else {
        const s = Math.min(start, end);
        const e = Math.max(start, end);
        for (let i = s; i <= e; i++) {
            if (i - s > 50) {
                const line = document.createElement('div');
                line.innerText = "...";
                container.appendChild(line);
                break;
            }
            const num = String(i).padStart(4, '0');
            const line = document.createElement('div');
            line.innerText = `${prefix} ${num}.${format}`;
            container.appendChild(line);
        }
    }
}

function showImportSpriteSheetDialog() {
    const dlg = elements.importSpriteSheetDialog;
    if (!dlg) return;

    if (elements.spriteSheetFileInfo) {
        elements.spriteSheetFileInfo.style.display = 'none';
        elements.spriteSheetFileInfo.innerText = '';
    }
    const ctrl = elements.impSpriteSheetControls;
    if (ctrl) ctrl.style.display = 'none';

    if (elements.inpImpSheetW) elements.inpImpSheetW.value = state.canvasW;
    if (elements.inpImpSheetH) elements.inpImpSheetH.value = state.canvasH;
    if (elements.inpImpSheetDiv) elements.inpImpSheetDiv.value = 1;
    if (elements.inpImpSheetStart) elements.inpImpSheetStart.value = 0;
    if (elements.inpImpSheetEnd) elements.inpImpSheetEnd.value = 0;

    const rangeFields = document.getElementById('impSheetRangeFields');
    if (rangeFields) rangeFields.style.display = 'none';
    const radios = document.getElementsByName('impRangeMode');
    if (radios.length > 0) radios[0].checked = true;

    if (elements.btnClearSpriteSheet) elements.btnClearSpriteSheet.style.display = 'none';
    if (elements.btnImpSheetOk) elements.btnImpSheetOk.disabled = true;

    // Show compression only if no project is open
    if (elements.rowImpSheetComp) {
        elements.rowImpSheetComp.style.display = (state.frames.length === 0) ? 'flex' : 'none';
        if (elements.selImpSheetComp) elements.selImpSheetComp.value = "3";
    }

    if (typeof dlg.showModal === 'function') dlg.showModal();
}

function showImportOtherShpDialog() {
    const dlg = elements.importOtherShpDialog;
    if (!dlg) return;

    if (elements.otherShpFileInfo) {
        elements.otherShpFileInfo.style.display = 'none';
        elements.otherShpFileInfo.innerText = '';
    }
    const ctrl = document.getElementById('impOtherShpControls');
    if (ctrl) ctrl.style.display = 'none';

    if (elements.btnClearOtherShp) elements.btnClearOtherShp.style.display = 'none';
    if (elements.btnImpOtherOk) elements.btnImpOtherOk.disabled = true;

    // Show compression only if no project is open
    if (elements.rowImpOtherComp) {
        elements.rowImpOtherComp.style.display = (state.frames.length === 0) ? 'flex' : 'none';
        if (elements.selImpOtherComp) elements.selImpOtherComp.value = "3";
    }

    if (typeof dlg.showModal === 'function') dlg.showModal();
}

function setupSteppers() {
    document.querySelectorAll('.stepper-ui, .input-stepper').forEach(stepper => {
        const input = stepper.querySelector('input');
        const btnDec = stepper.querySelector('button:first-of-type');
        const btnInc = stepper.querySelector('button:last-of-type');

        const updateValue = (delta, ev) => {
            const stepMod = (ev && ev.ctrlKey) ? 5 : 1;
            const isPct = input.id === 'inpResizePct';

            if (isPct) {
                const currentVal = parseFloat(input.value) || 0;
                const decimals = currentVal - Math.floor(currentVal);
                let val = Math.floor(currentVal) + (delta * stepMod) + decimals;
                const min = input.hasAttribute('min') ? parseFloat(input.getAttribute('min')) : -Infinity;
                const max = input.hasAttribute('max') ? parseFloat(input.getAttribute('max')) : Infinity;
                input.value = Math.max(min, Math.min(max, val)).toFixed(2);
            } else {
                let val = parseInt(input.value) || 0;
                const min = input.hasAttribute('min') ? parseInt(input.getAttribute('min')) : -Infinity;
                const max = input.hasAttribute('max') ? parseInt(input.getAttribute('max')) : Infinity;
                input.value = Math.max(min, Math.min(max, val + (delta * stepMod)));
            }
            input.dispatchEvent(new Event('input'));
            input.dispatchEvent(new Event('change'));
        };

        if (btnDec && input) setupAutoRepeat(btnDec, (ev) => updateValue(-1, ev));
        if (btnInc && input) setupAutoRepeat(btnInc, (ev) => updateValue(1, ev));

        if (input) {
            input.onchange = () => {
                let val = parseFloat(input.value) || 0;
                const min = input.hasAttribute('min') ? parseFloat(input.getAttribute('min')) : -Infinity;
                const max = input.hasAttribute('max') ? parseFloat(input.getAttribute('max')) : Infinity;
                if (val < min) input.value = min;
                if (val > max) input.value = max;
                if (input.id !== 'inpResizePct') input.value = Math.round(val);
                input.dispatchEvent(new Event('input'));
            };
        }
    });
}

/**
 * Composites all layers of a frame into a single index array.
 */
function getFlatFrameIndices(frameIdx) {
    const f = state.frames[frameIdx];
    if (!f) return null;

    const composite = new Uint8Array(f.width * f.height).fill(TRANSPARENT_COLOR);

    function compositeNode(node) {
        if (!node.visible) return;

        if (node.children) {
            for (let i = node.children.length - 1; i >= 0; i--) {
                compositeNode(node.children[i]);
            }
        } else if (node.data) {
            for (let k = 0; k < composite.length; k++) {
                if (node.mask && node.mask[k] === 0) continue;
                const val = node.data[k];
                if (val !== TRANSPARENT_COLOR) composite[k] = val;
            }
        }
    }

    for (let i = f.layers.length - 1; i >= 0; i--) {
        compositeNode(f.layers[i]);
    }

    return composite;
}



function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}


async function toggleAlphaImageMode() {
    state.isAlphaImageMode = !state.isAlphaImageMode;

    if (state.isAlphaImageMode) {
        // Save current settings
        savedAlphaSettings = {
            paletteId: getActivePaletteId(),
            useShadows: state.useShadows,
            compression: state.compression
        };

        // Switch to alpha_image palette
        applyPaletteById('game_ra2_alpha_image');

        // Disable shadows
        state.useShadows = false;
        const cbShadows = document.getElementById('cbUseShadows');
        if (cbShadows) cbShadows.checked = false;

        // Force compression 1
        state.compression = 1;

    } else {
        // Restore settings
        if (savedAlphaSettings) {
            if (savedAlphaSettings.paletteId) {
                applyPaletteById(savedAlphaSettings.paletteId);
            }
            state.useShadows = savedAlphaSettings.useShadows;
            const cbShadows = document.getElementById('cbUseShadows');
            if (cbShadows) cbShadows.checked = state.useShadows;

            state.compression = savedAlphaSettings.compression;
        }
    }

    syncMenuToggles();
    updateMenuState(state.frames.length > 0);
    renderCanvas();
    if (typeof renderFramesList === 'function') renderFramesList();
}

function setupModalButtons() {
    // Export Sprite Sheet
    if (elements.btnExpSheetCancel) elements.btnExpSheetCancel.onclick = () => elements.exportSpriteSheetDialog.close();
    if (elements.btnExpSheetOk) elements.btnExpSheetOk.onclick = handleExportSpriteSheet;
    if (elements.inpExpSheetStart) elements.inpExpSheetStart.oninput = updateExportSheetPreview;
    if (elements.inpExpSheetEnd) elements.inpExpSheetEnd.oninput = updateExportSheetPreview;
    if (elements.inpExpSheetDiv) elements.inpExpSheetDiv.oninput = updateExportSheetPreview;
    if (elements.selExpSheetOrder) elements.selExpSheetOrder.onchange = updateExportSheetPreview;

    // Export Frame Range
    if (elements.btnExpRangeCancel) elements.btnExpRangeCancel.onclick = () => elements.exportFrameRangeDialog.close();
    if (elements.btnExpRangeOk) elements.btnExpRangeOk.onclick = handleExportRange;
    if (elements.txtExpRangePrefix) elements.txtExpRangePrefix.oninput = updateExportRangePreview;
    if (elements.inpExpRangeStart) elements.inpExpRangeStart.oninput = updateExportRangePreview;
    if (elements.inpExpRangeEnd) elements.inpExpRangeEnd.oninput = updateExportRangePreview;
    if (elements.selExpRangeFormat) elements.selExpRangeFormat.onchange = updateExportRangePreview;

    // Import Sprite Sheet
    if (elements.btnImpSheetCancel) elements.btnImpSheetCancel.onclick = () => elements.importSpriteSheetDialog.close();
    if (elements.btnImpSheetOk) elements.btnImpSheetOk.onclick = handleImportSpriteSheet;
    if (elements.btnClearSpriteSheet) elements.btnClearSpriteSheet.onclick = clearSpriteSheetSelection;
    setupDragAndDrop(elements.dropZoneSpriteSheet, elements.fileImpSpriteSheet, handleSpriteSheetFileSelect);

    const impRangeRadios = document.getElementsByName('impRangeMode');
    impRangeRadios.forEach(radio => {
        radio.onchange = () => {
            const rangeFields = document.getElementById('impSheetRangeFields');
            if (rangeFields) rangeFields.style.display = (radio.value === 'custom') ? 'block' : 'none';
        };
    });

    // Import another SHP
    if (elements.btnImpOtherCancel) elements.btnImpOtherCancel.onclick = () => elements.importOtherShpDialog.close();
    if (elements.btnImpOtherOk) elements.btnImpOtherOk.onclick = handleImportOtherShp;
    if (elements.btnClearOtherShp) elements.btnClearOtherShp.onclick = clearOtherShpSelection;
    setupDragAndDrop(elements.dropZoneOtherShp, elements.fileImpOtherShp, handleOtherShpFileSelect);
}

function setupDragAndDrop(zone, input, callback) {
    if (!zone || !input) return;

    zone.onclick = () => input.click();
    zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('dragover'); };
    zone.ondragleave = () => zone.classList.remove('dragover');
    zone.ondrop = (e) => {
        e.preventDefault(); zone.classList.remove('dragover');
        if (e.dataTransfer.files.length) callback(e.dataTransfer.files[0]);
    };
    input.onchange = (e) => {
        if (e.target.files.length) { callback(e.target.files[0]); input.value = ''; }
    };
}

async function handleSpriteSheetFileSelect(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'png' && ext !== 'pcx') {
        alert("Invalid file type. Please select a PNG or PCX image.");
        return;
    }
    spriteSheetFile = file;
    if (elements.spriteSheetFileInfo) {
        elements.spriteSheetFileInfo.innerText = `Selected: ${file.name}`;
        elements.spriteSheetFileInfo.style.display = 'block';
    }
    const ctrl = document.getElementById('impSpriteSheetControls');
    if (ctrl) ctrl.style.display = 'block';

    if (elements.btnClearSpriteSheet) elements.btnClearSpriteSheet.style.display = 'inline-block';
    if (elements.btnImpSheetOk) elements.btnImpSheetOk.disabled = false;
}

function clearSpriteSheetSelection() {
    spriteSheetFile = null;
    if (elements.spriteSheetFileInfo) {
        elements.spriteSheetFileInfo.innerText = '';
        elements.spriteSheetFileInfo.style.display = 'none';
    }
    const ctrl = document.getElementById('impSpriteSheetControls');
    if (ctrl) ctrl.style.display = 'none';

    if (elements.btnClearSpriteSheet) elements.btnClearSpriteSheet.style.display = 'none';
    if (elements.btnImpSheetOk) elements.btnImpSheetOk.disabled = true;
}

async function handleImportSpriteSheet() {
    if (!spriteSheetFile) return;
    const data = await processImageFile(spriteSheetFile);
    if (!data) return;

    const frameW = parseInt(elements.inpImpSheetW.value) || state.canvasW;
    const frameH = parseInt(elements.inpImpSheetH.value) || state.canvasH;
    const framesPerLine = parseInt(elements.inpImpSheetDiv.value) || 1;

    const isCustom = document.querySelector('input[name="impRangeMode"]:checked')?.value === 'custom';
    let startIdx = 0;
    let endIdx = Math.floor(data.width / frameW) * Math.floor(data.height / frameH) - 1;

    if (isCustom) {
        startIdx = parseInt(elements.inpImpSheetStart.value) || 0;
        endIdx = parseInt(elements.inpImpSheetEnd.value) || 0;
    }

    const cols = Math.floor(data.width / frameW);
    const rows = Math.floor(data.height / frameH);
    const totalAvailable = cols * rows;

    const s = Math.min(startIdx, endIdx);
    const e = Math.max(startIdx, endIdx);
    const numToImport = e - s + 1;
    if (numToImport <= 0) return;

    // Auto-create project if none open
    if (state.frames.length === 0) {
        const comp = elements.selImpSheetComp ? parseInt(elements.selImpSheetComp.value) : 3;
        createNewProject(frameW, frameH, 0, false, null, comp); // Create with 0 frames, we will add them
    }

    // Check for dimension changes and prompt
    let pendingResize = null;
    if (frameW > state.canvasW || frameH > state.canvasH) {
        const maxW = Math.max(frameW, state.canvasW);
        const maxH = Math.max(frameH, state.canvasH);
        const msg = `The frames to import (${frameW}x${frameH}) are larger than the current SHP (${state.canvasW}x${state.canvasH}).\n\n` +
            `Do you want to RESIZE the SHP to ${maxW}x${maxH} to show these images?\n` +
            `(If you cancel, images will be cropped)`;
        const shouldResize = await showConfirm("RESIZE SHP", msg);
        if (shouldResize) {
            pendingResize = { w: maxW, h: maxH };
        }
    }

    const hasProject = state.frames.length > 0;
    const confirmed = await showConfirm(
        hasProject ? "IMPORT SPRITE SHEET?" : "CREATE NEW SHP FROM SPRITE SHEET?",
        hasProject
            ? `This will add ${numToImport} frames to the current SHP. Continue?`
            : `There is no SHP open. This will create a NEW SHP and add ${numToImport} frames to its. Continue?`
    );

    const oldLength = state.frames.length;
    if (confirmed) {
        if (pendingResize) {
            resizeEntireShp(pendingResize.w, pendingResize.h);
        }
        for (let i = s; i <= e; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const ox = col * frameW;
            const oy = row * frameH;

            const frameData = new Uint16Array(frameW * frameH).fill(TRANSPARENT_COLOR);
            for (let y = 0; y < frameH; y++) {
                if (oy + y >= data.height) break;
                for (let x = 0; x < frameW; x++) {
                    if (ox + x >= data.width) break;
                    const p = data.pixels[(oy + y) * data.width + (ox + x)];
                    if (p.a < 128) {
                        frameData[y * frameW + x] = TRANSPARENT_COLOR;
                    } else {
                        frameData[y * frameW + x] = findNearestPaletteIndex(p.r, p.g, p.b, state.palette);
                    }
                }
            }
            addFrame(frameW, frameH, frameData);
        }
        if (elements.importSpriteSheetDialog) elements.importSpriteSheetDialog.close();

        // Fix: Select the first of the newly added frames
        if (state.frames.length > oldLength) {
            state.currentFrameIdx = oldLength;
            state.activeLayerId = state.frames[oldLength].layers[0].id;
        }

        pushHistory('all');
        updateCanvasSize();
        renderCanvas();
        renderFramesList();
        updateLayersList();
        updateUIState();
        if (typeof showEditorInterface === 'function') showEditorInterface();
    }
}

async function handleOtherShpFileSelect(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'shp' && ext !== 'sha') {
        alert("Invalid file type. Please select an SHP file.");
        return;
    }
    try {
        const buf = await file.arrayBuffer();
        const shp = ShpFormat80.parse(buf);
        otherShpFile = { file, shp };
        if (elements.otherShpFileInfo) {
            elements.otherShpFileInfo.innerText = `Selected: ${file.name} (${shp.numImages} frames)`;
            elements.otherShpFileInfo.style.display = 'block';
        }
        const ctrl = document.getElementById('impOtherShpControls');
        if (ctrl) ctrl.style.display = 'block';

        if (elements.inpImpOtherStart) {
            elements.inpImpOtherStart.value = 0;
            elements.inpImpOtherStart.max = shp.numImages - 1;
        }
        if (elements.inpImpOtherEnd) {
            elements.inpImpOtherEnd.value = shp.numImages - 1;
            elements.inpImpOtherEnd.max = shp.numImages - 1;
        }

        if (elements.btnClearOtherShp) elements.btnClearOtherShp.style.display = 'inline-block';
        if (elements.btnImpOtherOk) elements.btnImpOtherOk.disabled = false;
    } catch (err) {
        alert("Error reading SHP: " + err.message);
    }
}

function clearOtherShpSelection() {
    otherShpFile = null;
    if (elements.otherShpFileInfo) {
        elements.otherShpFileInfo.innerText = '';
        elements.otherShpFileInfo.style.display = 'none';
    }
    const ctrl = document.getElementById('impOtherShpControls');
    if (ctrl) ctrl.style.display = 'none';

    if (elements.btnClearOtherShp) elements.btnClearOtherShp.style.display = 'none';
    if (elements.btnImpOtherOk) elements.btnImpOtherOk.disabled = true;
}

async function handleImportOtherShp() {
    if (!otherShpFile) return;
    const start = parseInt(elements.inpImpOtherStart.value) || 0;
    const end = parseInt(elements.inpImpOtherEnd.value) || 0;
    const s = Math.min(start, end);
    const e = Math.max(start, end);
    const numFrames = e - s + 1;
    if (numFrames <= 0) return;

    // Auto-create project if none open
    const otherShp = otherShpFile.shp;
    if (state.frames.length === 0) {
        const comp = elements.selImpOtherComp ? parseInt(elements.selImpOtherComp.value) : 3;
        createNewProject(otherShp.width, otherShp.height, 0, false, null, comp);
    }

    // Check for dimension changes and prompt
    let pendingResize = null;
    if (otherShp.width > state.canvasW || otherShp.height > state.canvasH) {
        const maxW = Math.max(otherShp.width, state.canvasW);
        const maxH = Math.max(otherShp.height, state.canvasH);
        const msg = `The SHP to import (${otherShp.width}x${otherShp.height}) is larger than the current SHP (${state.canvasW}x${state.canvasH}).\n\n` +
            `Do you want to RESIZE the SHP to ${maxW}x${maxH} to show these images?\n` +
            `(If you cancel, images will be cropped)`;
        const shouldResize = await showConfirm("RESIZE SHP", msg);
        if (shouldResize) {
            pendingResize = { w: maxW, h: maxH };
        }
    }

    const hasProject = state.frames.length > 0;
    const confirmed = await showConfirm(
        hasProject ? "IMPORT FROM ANOTHER SHP?" : "CREATE NEW SHP FROM ANOTHER SHP?",
        hasProject
            ? `This will add ${numFrames} frames to the current SHP. Continue?`
            : `There is no SHP open. This will create a NEW SHP and add ${numFrames} frames to its. Continue?`
    );

    const oldLength = state.frames.length;
    if (!confirmed) return;

    if (pendingResize) {
        resizeEntireShp(pendingResize.w, pendingResize.h);
    }

    for (let i = s; i <= e; i++) {
        const shpFrame = otherShpFile.shp.images[i];
        if (!shpFrame) continue;
        const frameData = new Uint16Array(state.canvasW * state.canvasH).fill(TRANSPARENT_COLOR);
        const copyW = Math.min(state.canvasW, shpFrame.width);
        const copyH = Math.min(state.canvasH, shpFrame.height);
        for (let y = 0; y < copyH; y++) {
            for (let x = 0; x < copyW; x++) {
                frameData[y * state.canvasW + x] = shpFrame.indices[y * shpFrame.width + x];
            }
        }
        addFrame(state.canvasW, state.canvasH, frameData);
    }
    if (elements.importOtherShpDialog) elements.importOtherShpDialog.close();

    // Fix: Select the first of the newly added frames
    if (state.frames.length > oldLength) {
        state.currentFrameIdx = oldLength;
        state.activeLayerId = state.frames[oldLength].layers[0].id;
    }

    pushHistory('all');
    updateCanvasSize();
    renderCanvas();
    renderFramesList();
    updateLayersList();
    updateUIState();
    if (typeof showEditorInterface === 'function') showEditorInterface();
}

async function handleExportSpriteSheet() {
    const start = parseInt(elements.inpExpSheetStart.value) || 0;
    const end = parseInt(elements.inpExpSheetEnd.value) || 0;
    const framesPerLine = parseInt(elements.inpExpSheetDiv.value) || 1;
    const orderBy = elements.selExpSheetOrder.value;
    const format = elements.selExpSheetFormat.value;
    const filename = elements.txtExpSheetName.value || "spritesheet";

    const s = Math.min(start, end);
    const e = Math.max(start, end);
    const numFrames = e - s + 1;
    if (numFrames <= 0) return;

    const frameW = state.canvasW;
    const frameH = state.canvasH;

    let cols, rows;
    if (orderBy === 'horizontal') {
        cols = framesPerLine;
        rows = Math.ceil(numFrames / cols);
    } else {
        rows = framesPerLine;
        cols = Math.ceil(numFrames / rows);
    }

    const totalW = cols * frameW;
    const totalH = rows * frameH;

    const indices = new Uint8Array(totalW * totalH).fill(TRANSPARENT_COLOR);

    for (let i = 0; i < numFrames; i++) {
        const frameIdx = s + i;
        const frameData = getFlatFrameIndices(frameIdx);
        if (!frameData) continue;

        let col, row;
        if (orderBy === 'horizontal') {
            col = i % cols;
            row = Math.floor(i / cols);
        } else {
            row = i % rows;
            col = Math.floor(i / rows);
        }

        const ox = col * frameW;
        const oy = row * frameH;

        for (let y = 0; y < frameH; y++) {
            for (let x = 0; x < frameW; x++) {
                const val = frameData[y * frameW + x];
                indices[(oy + y) * totalW + (ox + x)] = val;
            }
        }
    }

    if (format === 'png') {
        const canvas = document.createElement('canvas');
        canvas.width = totalW; canvas.height = totalH;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(totalW, totalH);
        for (let i = 0; i < indices.length; i++) {
            const idx = indices[i];
            const c = state.palette[idx] || { r: 0, g: 0, b: 0 };
            const off = i * 4;
            imgData.data[off] = c.r;
            imgData.data[off + 1] = c.g;
            imgData.data[off + 2] = c.b;
            imgData.data[off + 3] = (idx === TRANSPARENT_COLOR) ? 0 : 255;
        }
        ctx.putImageData(imgData, 0, 0);
        canvas.toBlob(blob => downloadBlob(blob, `${filename}.png`));
    } else {
        const pcxData = PcxLoader.encode(totalW, totalH, indices, state.palette);
        const blob = new Blob([pcxData], { type: 'application/octet-stream' });
        downloadBlob(blob, `${filename}.pcx`);
    }

    if (elements.exportSpriteSheetDialog) elements.exportSpriteSheetDialog.close();
}

async function handleExportRange() {
    const titleEl = document.getElementById('exportRangeTitle');
    const isSingle = titleEl && titleEl.innerText.includes("CURRENT");

    const prefix = elements.txtExpRangePrefix.value || "frame";
    const format = elements.selExpRangeFormat.value || "png";
    const start = isSingle ? state.currentFrameIdx : (parseInt(elements.inpExpRangeStart.value) || 0);
    const end = isSingle ? state.currentFrameIdx : (parseInt(elements.inpExpRangeEnd.value) || 0);

    const s = Math.min(start, end);
    const e = Math.max(start, end);
    const numFrames = e - s + 1;
    if (numFrames <= 0) return;

    if (numFrames === 1) {
        const data = await getFrameAsBlob(s, format);
        const num = String(s).padStart(4, '0');
        const ext = format === 'png' ? 'png' : 'pcx';
        downloadBlob(data, `${prefix} ${num}.${ext}`);
    } else {
        const zip = new MiniZip();
        for (let i = s; i <= e; i++) {
            const blob = await getFrameAsBlob(i, format);
            const buf = new Uint8Array(await blob.arrayBuffer());
            const num = String(i).padStart(4, '0');
            const ext = format === 'png' ? 'png' : 'pcx';
            zip.add(`${prefix} ${num}.${ext}`, buf);
        }
        const zipFilename = isSingle ? `${prefix} ${String(s).padStart(4, '0')}.zip` : `${prefix}_frames.zip`;
        const content = zip.generate();
        downloadBlob(content, zipFilename);
    }

    if (elements.exportFrameRangeDialog) elements.exportFrameRangeDialog.close();
}

async function getFrameAsBlob(frameIdx, format) {
    const indices = getFlatFrameIndices(frameIdx);
    const w = state.canvasW;
    const h = state.canvasH;

    if (format === 'png') {
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(w, h);
        for (let i = 0; i < indices.length; i++) {
            const idx = indices[i];
            const c = state.palette[idx] || { r: 0, g: 0, b: 0 };
            const off = i * 4;
            imgData.data[off] = c.r;
            imgData.data[off + 1] = c.g;
            imgData.data[off + 2] = c.b;
            imgData.data[off + 3] = (idx === TRANSPARENT_COLOR) ? 0 : 255;
        }
        ctx.putImageData(imgData, 0, 0);
        return new Promise(resolve => canvas.toBlob(resolve));
    } else {
        const pcxData = PcxLoader.encode(w, h, indices, state.palette);
        return new Blob([pcxData], { type: 'application/octet-stream' });
    }
}

function setupEditMenu() {
    const handlers = {
        'menuUndo': () => undo(),
        'menuRedo': () => redo(),
        'menuCut': () => { cutSelection(); },
        'menuCopy': () => copySelection(),
        'menuPasteActive': () => pasteClipboard(false),
        'menuPasteNewLayer': () => pasteClipboard(true),
        'menuPasteNewFrame': () => pasteAsNewFrame(),
        'menuFill': () => fillSelection(),
        'menuDelete': () => deleteSelection(),
        'menuSelectAll': () => selectAll(),
        'menuDeselect': () => deselect(),
        'menuInvertSelection': () => invertSelection()
    };

    Object.entries(handlers).forEach(([id, fn]) => {
        const el = document.getElementById(id);
        if (el) {
            el.onclick = (e) => {
                e.stopPropagation();
                closeAllMenus();
                fn();
            };
        }
    });
}

function setupViewMenu() {
    const handlers = {
        'menuZoomIn': () => {
            let val = parseInt(elements.inpZoom.value);
            elements.inpZoom.value = Math.min(5000, val < 100 ? 100 : Math.floor(val / 100) * 100 + 100);
            elements.inpZoom.dispatchEvent(new Event('input'));
        },
        'menuZoomOut': () => {
            let val = parseInt(elements.inpZoom.value);
            elements.inpZoom.value = Math.max(50, val <= 100 ? 50 : Math.ceil(val / 100) * 100 - 100);
            elements.inpZoom.dispatchEvent(new Event('input'));
        },
        'menuZoomToSelection': () => zoomToSelection(),
        'menuZoom100': () => {
            elements.inpZoom.value = 100;
            elements.inpZoom.dispatchEvent(new Event('input'));
        },
        'menuShowCenter': () => {
            state.showCenter = !state.showCenter;
            syncMenuToggles();
            renderOverlay();
        },
        'menuGridShowNone': () => {
            state.showGrid = false;
            updatePixelGrid();
            syncMenuToggles();
            if (elements.canvasResizeUnifiedDialog?.open) updateUnifiedResizePreview();
        },
        'menuGridShowLight': () => {
            state.showGrid = true;
            state.gridColor = 'light';
            updatePixelGrid();
            syncMenuToggles();
            if (elements.canvasResizeUnifiedDialog?.open) updateUnifiedResizePreview();
        },
        'menuGridShowDark': () => {
            state.showGrid = true;
            state.gridColor = 'dark';
            updatePixelGrid();
            syncMenuToggles();
            if (elements.canvasResizeUnifiedDialog?.open) updateUnifiedResizePreview();
        },
        'menuToggleBg': () => {
            state.showBackground = !state.showBackground;
            const btn = document.getElementById('btnToggleBg');
            if (btn) btn.classList.toggle('active', state.showBackground);
            renderCanvas();
            syncMenuToggles();
        },
        'menuGridNone': () => {
            state.isoGrid = 'none';
            const sel = document.getElementById('selIsoGrid');
            if (sel) sel.value = 'none';
            const prevSel = document.getElementById('prevSelIsoGrid');
            if (prevSel) prevSel.value = 'none';
            renderCanvas();
            syncMenuToggles();
            if (typeof window.renderPreview === 'function') window.renderPreview();
        },
        'menuGridTS': () => {
            state.isoGrid = 'ts';
            const sel = document.getElementById('selIsoGrid');
            if (sel) sel.value = 'ts';
            const prevSel = document.getElementById('prevSelIsoGrid');
            if (prevSel) prevSel.value = 'ts';
            renderCanvas();
            syncMenuToggles();
            if (typeof window.renderPreview === 'function') window.renderPreview();
        },
        'menuGridRA2': () => {
            state.isoGrid = 'ra2';
            const sel = document.getElementById('selIsoGrid');
            if (sel) sel.value = 'ra2';
            const prevSel = document.getElementById('prevSelIsoGrid');
            if (prevSel) prevSel.value = 'ra2';
            renderCanvas();
            syncMenuToggles();
            if (typeof window.renderPreview === 'function') window.renderPreview();
        },
        'menuPreview': () => {
            closeAllMenus();
            openPreview();
        },
        'menuToggleShadows': () => {
            state.useShadows = !state.useShadows;
            const cb = document.getElementById('cbUseShadows');
            if (cb) cb.checked = state.useShadows;
            if (state.useShadows && state.primaryColorIdx > 1) {
                state.primaryColorIdx = 1;
                state.paletteSelection.clear();
                state.paletteSelection.add(1);
            }
            if (typeof renderPalette === 'function') renderPalette();
            renderCanvas();
            if (typeof renderFramesList === 'function') renderFramesList();
            syncMenuToggles();
        },
        'menuShowCenter': () => {
            state.showCenter = !state.showCenter;
            renderCanvas();
            syncMenuToggles();
        },
        'menuToggleShadowOverlay': () => {
            const cb = document.getElementById('cbShowShadowOverlay');
            if (cb) cb.click();
        },
        'menuAlphaImageMode': () => {
            toggleAlphaImageMode();
        }
    };

    Object.entries(handlers).forEach(([id, fn]) => {
        const el = document.getElementById(id);
        if (el) {
            el.onclick = (e) => {
                e.stopPropagation();
                closeAllMenus();
                fn();
            };
        }
    });
}



function updateAspectRatio(changedSide) {
    const w = state.canvasW;
    const h = state.canvasH;
    if (changedSide === 'w') {
        const val = parseInt(elements.inpResizeW.value) || 1;
        elements.inpResizeH.value = Math.round(val / w * h);
    } else {
        const val = parseInt(elements.inpResizeH.value) || 1;
        elements.inpResizeW.value = Math.round(val / h * w);
    }
}

function updateResizePreview() {
    const cvs = elements.canvasResizePreview;
    const lblFinal = elements.lblResizeFinalSize;

    if (!cvs || !lblFinal) return;

    const method = elements.selResizeMethod.value;
    const isPct = document.querySelector('input[name="resizeMode"]:checked')?.value === 'percent';
    let tw, th;


    const isFixed = ['xbr', 'hq4x', 'scale2x', 'rotsprite', 'omniscale', 'superxbr'].includes(method);
    let usePostProcess = elements.chkResizePostProcess?.checked;
    let postProcessMethod = usePostProcess ? elements.valResizePostProcessMethod : false;

    if (method === 'reloaded_ra2') {
        postProcessMethod = 'smart'; // Force smart downscale
        tw = Math.round(state.canvasW * 1.25);
        th = Math.round(state.canvasH * 1.25);
    } else if (isFixed && !usePostProcess) {
        // Locked to algorithm multiplier
        const multi = (method === 'scale2x') ? 2 : (method === 'rotsprite' ? 8 : 4); // xbr, hq4x, omniscale, superxbr
        tw = state.canvasW * multi;
        th = state.canvasH * multi;
    } else if (isPct) {
        const pct = (parseFloat(elements.inpResizePct.value) || 100) / 100;
        tw = Math.round(state.canvasW * pct);
        th = Math.round(state.canvasH * pct);
    } else {
        const wVal = parseInt(elements.inpResizeW.value);
        tw = !isNaN(wVal) ? wVal : 1;
        const hVal = parseInt(elements.inpResizeH.value);
        th = !isNaN(hVal) ? hVal : 1;
    }


    // Safety fallback and clamping
    const MAX_DIM = 5000;
    if (isNaN(tw) || !isFinite(tw) || tw <= 0) tw = 1;
    if (isNaN(th) || !isFinite(th) || th <= 0) th = 1;

    tw = Math.min(tw, MAX_DIM);
    th = Math.min(th, MAX_DIM);

    lblFinal.innerText = `${tw} x ${th}`;

    // Use the new slider zoom if available, fallback to legacy dropdown
    let zoomVal = 100;
    if (elements.inpResizeZoom) {
        zoomVal = parseFloat(elements.inpResizeZoom.value) || 100;
    } else if (elements.selResizeZoom) {
        zoomVal = (parseFloat(elements.selResizeZoom.value) || 1) * 100;
    }
    const zoom = zoomVal / 100;

    cvs.width = tw;
    cvs.height = th;
    cvs.style.width = Math.round(tw * zoom) + 'px';
    cvs.style.height = Math.round(th * zoom) + 'px';
    cvs.style.imageRendering = 'pixelated'; // Force sharp pixels

    // Pixel Grid Logic (Zoom >= 400%)
    const scene = document.getElementById('resizePreviewScene');
    if (scene) {
        scene.style.setProperty('--grid-size', `${zoom}px`);
        if (zoom >= 4) scene.classList.add('pixel-grid');
        else scene.classList.remove('pixel-grid');
    }

    // Algorithm Specific Visibility
    const rowForce = elements.rowResizePostProcess;
    if (rowForce) {
        rowForce.style.display = (isFixed && method !== 'reloaded_ra2') ? 'flex' : 'none';
    }

    const ctx = cvs.getContext('2d');
    ctx.imageSmoothingEnabled = false;


    // --- Resample Preview Logic ---

    // Cancel any pending update
    if (cvs._debounceTimer) clearTimeout(cvs._debounceTimer);

    // Debounce to prevent UI lag on heavy ops
    cvs._debounceTimer = setTimeout(() => {
        const frame = state.frames[state.currentFrameIdx];
        if (!frame) return;

        // Clear canvas
        ctx.clearRect(0, 0, tw, th);

        // Get flattened composite frame data using unified compositor
        const compositeData = compositeFrame(frame, {
            transparentIdx: TRANSPARENT_COLOR,
            floatingSelection: state.floatingSelection,
            showIndex0: true,
            backgroundIdx: 0
        });

        // Resample the full composite data
        const finalData = resampleLayerData(compositeData, frame.width, frame.height, tw, th, method, postProcessMethod);

        // Convert indices to ImageData
        const imgData = ctx.createImageData(tw, th);
        const data32 = new Uint32Array(imgData.data.buffer);
        const palette = state.palette;

        for (let i = 0; i < finalData.length; i++) {
            const idx = finalData[i];
            if (idx === TRANSPARENT_COLOR) {
                data32[i] = 0; // Alpha 0
            } else {
                const c = palette[idx];
                if (c) {
                    imgData.data[i * 4] = c.r;
                    imgData.data[i * 4 + 1] = c.g;
                    imgData.data[i * 4 + 2] = c.b;
                    imgData.data[i * 4 + 3] = 255;
                }
            }
        }

        ctx.putImageData(imgData, 0, 0);
    }, 100); // 100ms debounce
}

// Global for tracking zoom state if needed across calls
let lastZoom = 1;

function updateResizeZoomUI() {
    if (!elements.inpResizeZoom) return;
    const val = parseInt(elements.inpResizeZoom.value);
    const min = parseInt(elements.inpResizeZoom.min) || 50;
    const max = parseInt(elements.inpResizeZoom.max) || 5000;
    const percent = ((val - min) / (max - min)) * 100;

    if (elements.resizeZoomBar) elements.resizeZoomBar.style.width = percent + '%';
    if (elements.resizeZoomVal) elements.resizeZoomVal.innerText = val + '%';
}

function setupResizeImageDialog() {
    setupTooltips(); // Initialize custom tooltips
    const updateResize = () => updateResizePreview();

    // Input Sync Logic
    const syncFromPercent = () => {
        const pct = (parseFloat(elements.inpResizePct.value) || 100) / 100;
        elements.inpResizeW.value = Math.max(1, Math.round(state.canvasW * pct));
        elements.inpResizeH.value = Math.max(1, Math.round(state.canvasH * pct));
        updateResize();
    };

    const syncFromAbsolute = (side) => {
        const w = state.canvasW, h = state.canvasH;
        const MAX_DIM = 5000;
        if (elements.chkResizeAspectRatio.checked) {
            if (side === 'w') {
                let val = parseInt(elements.inpResizeW.value) || 1;
                val = Math.min(MAX_DIM, Math.max(1, val));
                elements.inpResizeW.value = val;
                elements.inpResizeH.value = Math.max(1, Math.min(MAX_DIM, Math.round(val / w * h)));
            } else {
                let val = parseInt(elements.inpResizeH.value) || 1;
                val = Math.min(MAX_DIM, Math.max(1, val));
                elements.inpResizeH.value = val;
                elements.inpResizeW.value = Math.max(1, Math.min(MAX_DIM, Math.round(val / h * w)));
            }
            // Only update % when aspect ratio is locked — W and H move together so % is meaningful
            const currentW = parseInt(elements.inpResizeW.value) || w;
            if (w > 0) {
                elements.inpResizePct.value = (currentW / w * 100).toFixed(2);
            }
        }
        updateResize();
    };

    if (elements.inpResizePct) {
        elements.inpResizePct.oninput = syncFromPercent;
        elements.inpResizePct.onblur = () => {
            let val = parseFloat(elements.inpResizePct.value);
            if (isNaN(val)) val = 100;
            elements.inpResizePct.value = val.toFixed(2);
        };
    }

    if (elements.inpResizeW) elements.inpResizeW.oninput = () => syncFromAbsolute('w');
    if (elements.inpResizeH) elements.inpResizeH.oninput = () => syncFromAbsolute('h');

    // UI State & Locking
    const updateLockState = () => {
        const method = elements.selResizeMethod.value;
        const isReloaded = method === 'reloaded_ra2';
        const isFixed = ['xbr', 'hq4x', 'scale2x', 'omniscale', 'xbrz', 'scalefx', 'superxbr', 'lanczos3'].includes(method);
        const forceNN = elements.chkResizePostProcess?.checked;
        const radios = document.getElementsByName('resizeMode');
        const rowForce = elements.rowResizePostProcess;

        // Visibility of "Post Processing Options"
        if (rowForce) rowForce.style.display = (isFixed && !isReloaded) ? 'flex' : 'none';

        // UI Lockdown logic
        const shouldLock = isReloaded || (isFixed && !forceNN);

        radios.forEach(r => {
            r.disabled = shouldLock;
            if (r.parentElement) r.parentElement.classList.toggle('disabled-ui', shouldLock);
        });
        elements.inpResizePct.disabled = shouldLock;
        if (document.getElementById('btnResizePctMinus')) document.getElementById('btnResizePctMinus').disabled = shouldLock;
        if (document.getElementById('btnResizePctPlus')) document.getElementById('btnResizePctPlus').disabled = shouldLock;
        elements.inpResizeW.disabled = shouldLock;
        if (document.getElementById('btnResizeWMinus')) document.getElementById('btnResizeWMinus').disabled = shouldLock;
        if (document.getElementById('btnResizeWPlus')) document.getElementById('btnResizeWPlus').disabled = shouldLock;
        elements.inpResizeH.disabled = shouldLock;
        if (document.getElementById('btnResizeHMinus')) document.getElementById('btnResizeHMinus').disabled = shouldLock;
        if (document.getElementById('btnResizeHPlus')) document.getElementById('btnResizeHPlus').disabled = shouldLock;

        const isPctMode = document.querySelector('input[name="resizeMode"]:checked')?.value === 'percent';
        elements.chkResizeAspectRatio.disabled = shouldLock || isPctMode;
        if (elements.chkResizeAspectRatio.parentElement) elements.chkResizeAspectRatio.parentElement.classList.toggle('disabled-ui', shouldLock || isPctMode);

        if (shouldLock) {
            let pct = 100;
            if (isReloaded) pct = 125;
            else if (method === 'scale2x') pct = 200;
            else pct = 400; // xbr, hq4x, omniscale, xbrz, scalefx
            elements.inpResizePct.value = pct.toFixed(2);
            elements.inpResizeW.value = Math.round(state.canvasW * pct / 100);
            elements.inpResizeH.value = Math.round(state.canvasH * pct / 100);
        }

        updateResize();
    };

    if (elements.selResizeMethod) elements.selResizeMethod.onchange = updateLockState;
    if (elements.chkResizePostProcess) elements.chkResizePostProcess.onchange = updateLockState;
    document.getElementsByName('radResizePostProcess').forEach(rad => {
        rad.onchange = updateLockState;
    });

    // --- Zoom Controls (New Slider System) ---
    if (elements.inpResizeZoom) {
        elements.inpResizeZoom.oninput = () => {
            let val = parseInt(elements.inpResizeZoom.value);
            // Snap logic: 50 is special, then 100, 200, 300...
            if (val > 50 && val < 100) {
                // If dragging between 50 and 100, snap to closest
                elements.inpResizeZoom.value = (val > 75) ? 100 : 50;
            } else if (val > 100) {
                // Snap to 100s
                elements.inpResizeZoom.value = Math.round(val / 100) * 100;
            }
            updateResizeZoomUI();
            updateResizePreview();
        };

        // Centering logic for zoom slider
        elements.inpResizeZoom.onchange = () => {
            const newZoom = parseFloat(elements.inpResizeZoom.value) / 100;
            const container = elements.resizePreviewScrollContainer;
            const scene = elements.resizePreviewScene;
            if (container && scene) {
                const sx = (container.scrollLeft + container.clientWidth / 2 - scene.offsetLeft) / lastZoom;
                const sy = (container.scrollTop + container.clientHeight / 2 - scene.offsetTop) / lastZoom;

                updateResize();

                setTimeout(() => {
                    container.scrollLeft = sx * newZoom - container.clientWidth / 2 + scene.offsetLeft;
                    container.scrollTop = sy * newZoom - container.clientHeight / 2 + scene.offsetTop;
                }, 0);
            } else {
                updateResize();
            }
            lastZoom = newZoom;
        };
    }

    if (elements.btnResizeZoomMinus) {
        elements.btnResizeZoomMinus.onclick = () => {
            let val = parseInt(elements.inpResizeZoom.value);
            let next;
            if (val <= 100) next = 50;
            else next = Math.max(100, val - 100);

            elements.inpResizeZoom.value = next;
            elements.inpResizeZoom.dispatchEvent(new Event('input'));
            elements.inpResizeZoom.dispatchEvent(new Event('change'));
        };
    }

    if (elements.btnResizeZoomPlus) {
        elements.btnResizeZoomPlus.onclick = () => {
            let val = parseInt(elements.inpResizeZoom.value);
            let next;
            if (val < 100) next = 100;
            else next = Math.min(5000, val + 100);

            elements.inpResizeZoom.value = next;
            elements.inpResizeZoom.dispatchEvent(new Event('input'));
            elements.inpResizeZoom.dispatchEvent(new Event('change'));
        };
    }

    if (elements.btnResizeZoomReset) {
        elements.btnResizeZoomReset.onclick = () => {
            elements.inpResizeZoom.value = 100;
            elements.inpResizeZoom.dispatchEvent(new Event('input'));
            elements.inpResizeZoom.dispatchEvent(new Event('change'));
        };
    }

    // Wheel Zoom Support
    if (elements.resizePreviewScrollContainer) {
        elements.resizePreviewScrollContainer.onwheel = (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                let val = parseInt(elements.inpResizeZoom.value);
                let next;
                if (e.deltaY < 0) { // Zoom In
                    if (val < 100) next = 100;
                    else next = Math.min(5000, val + 100);
                } else { // Zoom Out
                    if (val <= 100) next = 50;
                    else next = Math.max(100, val - 100);
                }
                elements.inpResizeZoom.value = next;
                elements.inpResizeZoom.dispatchEvent(new Event('input'));
                elements.inpResizeZoom.dispatchEvent(new Event('change'));
            }
        };
    }

    if (elements.chkResizeAspectRatio) elements.chkResizeAspectRatio.onchange = () => syncFromAbsolute('w');

    // --- Stepper Controls (Percentage/Dimensions) handled generically by setupSteppers() ---



    const radios = document.getElementsByName('resizeMode');
    radios.forEach(r => r.onchange = () => {
        const isPct = r.value === 'percent';
        const grpPct = document.getElementById('resizePercentGroup');
        const grpAbs = document.getElementById('resizeAbsGroup');
        if (grpPct && grpAbs) {
            if (isPct) {
                grpPct.classList.remove('disabled-ui');
                grpAbs.classList.add('disabled-ui');
                elements.chkResizeAspectRatio.disabled = true;
                elements.chkResizeAspectRatio.parentElement.classList.add('disabled-ui');
            } else {
                grpPct.classList.add('disabled-ui');
                grpAbs.classList.remove('disabled-ui');
                elements.chkResizeAspectRatio.disabled = false;
                elements.chkResizeAspectRatio.parentElement.classList.remove('disabled-ui');
                // Keep the W/H values already calculated from percent — do NOT reset to canvas original size
            }
        }
        updateResize();
    });

    if (elements.chkResizeProtectRemap) {
        elements.chkResizeProtectRemap.onchange = () => updateResizePreview();
    }

    if (elements.btnResizeCancel) elements.btnResizeCancel.onclick = () => elements.resizeImageDialog.close();
    if (elements.btnResizeApply) {
        elements.btnResizeApply.onclick = async () => {
            const nw = parseInt(elements.inpResizeW.value) || state.canvasW;
            const nh = parseInt(elements.inpResizeH.value) || state.canvasH;

            if (nw > 5000 || nh > 5000) {
                alert("ERROR: Maximum allowed dimensions are 5000x5000px.");
                return;
            }

            const method = elements.selResizeMethod.value;
            let usePostProcess = elements.chkResizePostProcess?.checked;
            let postProcessMethod = usePostProcess ? elements.valResizePostProcessMethod : false;

            if (method === 'reloaded_ra2') {
                postProcessMethod = 'smart';
            }

            await resizeImage(nw, nh, method, postProcessMethod);
            elements.resizeImageDialog.close();
        };
    }

    // Re-initialize preview when shown
    window.showResizeImageDialog = () => {
        if (elements.resizeImageDialog) {
            elements.inpResizeW.value = state.canvasW;
            elements.inpResizeH.value = state.canvasH;
            elements.inpResizePct.value = "100.00";
            if (elements.inpResizeZoom) elements.inpResizeZoom.value = 100;
            updateResizeZoomUI();
            lastZoom = 1;
            elements.selResizeMethod.value = "smart";
            if (elements.selResizeMethod.onchange) elements.selResizeMethod.onchange(); // Apply initial lock state

            if (elements.lblResizeOriginalSize) {
                elements.lblResizeOriginalSize.innerText = `${state.canvasW} x ${state.canvasH}`;
            }

            // Trigger mode reset
            const defaultRadio = document.querySelector('input[name="resizeMode"][value="percent"]');
            if (defaultRadio) {
                defaultRadio.checked = true;
                defaultRadio.dispatchEvent(new Event('change'));
            }

            elements.resizeImageDialog.showModal();
            setTimeout(() => updateResizePreview(), 10);
        }
    };
}
function setupUnifiedCanvasResizeDialog() {
    const update = updateUnifiedResizePreview;



    // --- Mode Switching ---
    if (elements.radioResizeModeClassic) elements.radioResizeModeClassic.onchange = () => {
        elements.panelResizeClassic.classList.remove('disabled-ui');
        elements.panelResizeAdvanced.classList.add('disabled-ui');
        update();
    };
    if (elements.radioResizeModeAdvanced) elements.radioResizeModeAdvanced.onchange = () => {
        elements.panelResizeClassic.classList.add('disabled-ui');
        elements.panelResizeAdvanced.classList.remove('disabled-ui');
        update();
    };

    // --- Classic Mode Logic ---
    if (elements.inpCanvasW) elements.inpCanvasW.oninput = () => {
        if (elements.chkResizeAspectRatio.checked) elements.inpCanvasH.value = Math.round(elements.inpCanvasW.value / state.canvasW * state.canvasH);
        update();
    };
    if (elements.inpCanvasH) elements.inpCanvasH.oninput = () => {
        if (elements.radioResizeModeClassic.checked) {
            if (elements.chkResizeAspectRatio.checked) elements.inpCanvasW.value = Math.round(elements.inpCanvasH.value / state.canvasH * state.canvasW);
        }
        update();
    };


    // Wheel Zoom Support (New)
    const unifiedScrollContainer = document.getElementById('unifiedResizePreviewContainer');
    if (unifiedScrollContainer && elements.selUnifiedResizeZoom) {
        unifiedScrollContainer.onwheel = (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const direction = e.deltaY < 0 ? 1 : -1;
                const options = Array.from(elements.selUnifiedResizeZoom.options).map(o => parseFloat(o.value));
                let current = parseFloat(elements.selUnifiedResizeZoom.value);

                // Find nearest step
                let idx = options.findIndex(v => v === current);
                if (idx === -1) idx = 0; // Fallback

                let nextIdx = idx + direction;
                if (nextIdx >= 0 && nextIdx < options.length) {
                    elements.selUnifiedResizeZoom.value = options[nextIdx];
                    elements.selUnifiedResizeZoom.dispatchEvent(new Event('change'));
                }
            }
        };
    }

    if (elements.selCanvasAnchor) elements.selCanvasAnchor.onchange = update;
    document.querySelectorAll('.anchor-btn').forEach(btn => {
        btn.onclick = () => {
            if (elements.radioResizeModeClassic.checked) {
                if (elements.selCanvasAnchor) elements.selCanvasAnchor.value = btn.dataset.anchor;
                update();
            }
        };
    });

    // --- Advanced Mode Logic ---
    ['Top', 'Bot', 'Left', 'Right'].forEach(side => {
        const inp = elements[`inpAdvOff${side}`];
        if (inp) inp.oninput = update;
    });
    // Old reset button handler removed

    // --- Common Controls ---
    if (elements.chkAdvAutoFit) elements.chkAdvAutoFit.onchange = update;
    if (elements.selUnifiedResizeZoom) elements.selUnifiedResizeZoom.onchange = update;
    if (elements.btnUnifiedResizeApply) {
        elements.btnUnifiedResizeApply.onclick = () => {
            if (elements.radioResizeModeClassic.checked) {
                const newW = parseInt(elements.inpCanvasW.value) || state.canvasW;
                const newH = parseInt(elements.inpCanvasH.value) || state.canvasH;
                if (newW > 5000 || newH > 5000) {
                    alert("ERROR: Maximum allowed dimensions are 5000x5000px.");
                    return;
                }
                const anchor = elements.selCanvasAnchor.value || 'c';
                if (newW > 0 && newH > 0) resizeCanvas(newW, newH, anchor);
            } else {
                const t = parseInt(elements.inpAdvOffTop.value) || 0, b = parseInt(elements.inpAdvOffBot.value) || 0;
                const l = parseInt(elements.inpAdvOffLeft.value) || 0, r = parseInt(elements.inpAdvOffRight.value) || 0;
                const finalW = state.canvasW + l + r;
                const finalH = state.canvasH + t + b;

                if (finalW > 5000 || finalH > 5000) {
                    alert("ERROR: Maximum allowed dimensions are 5000x5000px.");
                    return;
                }
                resizeCanvasOffsets(t, b, l, r);
            }
            elements.canvasResizeUnifiedDialog.close();
        };
    }
    if (elements.btnUnifiedResizeCancel) elements.btnUnifiedResizeCancel.onclick = () => elements.canvasResizeUnifiedDialog.close();

    // New Global Reset Button
    const btnReset = document.getElementById('btnUnifiedResizeReset');
    if (btnReset) {
        btnReset.onclick = () => {
            // Reset Classic
            elements.inpCanvasW.value = state.canvasW;
            elements.inpCanvasH.value = state.canvasH;
            if (elements.selCanvasAnchor) elements.selCanvasAnchor.value = 'c';

            // Reset Advanced
            ['Top', 'Bot', 'Left', 'Right'].forEach(s => elements[`inpAdvOff${s}`].value = 0);

            update();
        };
    }

    // --- Window Entry Point ---
    window.showUnifiedCanvasResizeDialog = () => {
        if (elements.canvasResizeUnifiedDialog) {
            elements.inpCanvasW.value = state.canvasW;
            elements.inpCanvasH.value = state.canvasH;
            ['Top', 'Bot', 'Left', 'Right'].forEach(s => elements[`inpAdvOff${s}`].value = 0);

            if (elements.chkAdvAutoFit) elements.chkAdvAutoFit.checked = true;
            if (elements.selUnifiedResizeZoom) elements.selUnifiedResizeZoom.value = '1';

            // Set initial mode
            elements.radioResizeModeClassic.checked = true;
            elements.panelResizeClassic.classList.remove('disabled-ui');
            elements.panelResizeAdvanced.classList.add('disabled-ui');

            elements.canvasResizeUnifiedDialog.showModal();
            setTimeout(update, 10);
        }
    };

    // --- Interactive Preview (Offsets) ---
    const scene = elements.unifiedResizeScene;
    if (scene) {
        let isDragging = false, dragType = null, startX, startY, startOffsets = {};

        scene.onmousedown = (e) => {
            if (!elements.radioResizeModeAdvanced.checked) return;

            const rect = scene.getBoundingClientRect();
            const mouseX = e.clientX - rect.left, mouseY = e.clientY - rect.top;

            startOffsets = {
                t: parseInt(elements.inpAdvOffTop.value) || 0,
                b: parseInt(elements.inpAdvOffBot.value) || 0,
                l: parseInt(elements.inpAdvOffLeft.value) || 0,
                r: parseInt(elements.inpAdvOffRight.value) || 0
            };

            const overlay = elements.unifiedResizeOverlay;
            const ox = parseFloat(overlay.style.left) || 0;
            const oy = parseFloat(overlay.style.top) || 0;
            const ow = parseFloat(overlay.style.width) || 0;
            const oh = parseFloat(overlay.style.height) || 0;

            const threshold = 15;

            if (Math.abs(mouseX - ox) <= threshold) dragType = 'edge-left';
            else if (Math.abs(mouseX - (ox + ow)) <= threshold) dragType = 'edge-right';
            else if (Math.abs(mouseY - oy) <= threshold) dragType = 'edge-top';
            else if (Math.abs(mouseY - (oy + oh)) <= threshold) dragType = 'edge-bot';
            else {
                // Check if inside Overlay (Pan) - overlay should be draggable
                if (mouseX >= ox && mouseX <= ox + ow && mouseY >= oy && mouseY <= oy + oh) {
                    dragType = 'pan-overlay';
                }
            }

            if (dragType) {
                isDragging = true; startX = e.clientX; startY = e.clientY;
                e.preventDefault();
            }
        };

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) {
                if (!elements.radioResizeModeAdvanced.checked || !elements.canvasResizeUnifiedDialog?.open) return;

                const rect = scene.getBoundingClientRect();
                const mx = e.clientX - rect.left, my = e.clientY - rect.top;

                const ox = parseFloat(elements.unifiedResizeOverlay.style.left) || 0;
                const oy = parseFloat(elements.unifiedResizeOverlay.style.top) || 0;
                const ow = parseFloat(elements.unifiedResizeOverlay.style.width) || 0;
                const oh = parseFloat(elements.unifiedResizeOverlay.style.height) || 0;

                const threshold = 15;
                let cursor = 'default';

                if (Math.abs(mx - ox) <= threshold || Math.abs(mx - (ox + ow)) <= threshold) cursor = 'ew-resize';
                else if (Math.abs(my - oy) <= threshold || Math.abs(my - (oy + oh)) <= threshold) cursor = 'ns-resize';
                else if (mx >= ox && mx <= ox + ow && my >= oy && my <= oy + oh) cursor = 'move';

                scene.style.cursor = cursor;
                return;
            }

            const scale = getUnifiedScale();
            const dx = (e.clientX - startX) / scale, dy = (e.clientY - startY) / scale;

            if (dragType === 'edge-left') elements.inpAdvOffLeft.value = startOffsets.l - Math.round(dx);
            else if (dragType === 'edge-right') elements.inpAdvOffRight.value = startOffsets.r + Math.round(dx);
            else if (dragType === 'edge-top') elements.inpAdvOffTop.value = startOffsets.t - Math.round(dy);
            else if (dragType === 'edge-bot') elements.inpAdvOffBot.value = startOffsets.b + Math.round(dy);
            else if (dragType === 'pan-overlay') {
                elements.inpAdvOffLeft.value = startOffsets.l - Math.round(dx);
                elements.inpAdvOffRight.value = startOffsets.r + Math.round(dx);
                elements.inpAdvOffTop.value = startOffsets.t - Math.round(dy);
                elements.inpAdvOffBot.value = startOffsets.b + Math.round(dy);
            }
            update();
        });

        window.addEventListener('mouseup', () => { isDragging = false; dragType = null; });
    }

    // Keyboard support
    if (elements.canvasResizeUnifiedDialog) {
        elements.canvasResizeUnifiedDialog.onkeydown = (e) => {
            if (!elements.radioResizeModeAdvanced.checked) return;
            if (!e.key) return;
            const k = e.key.toLowerCase();
            if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) {
                if (e.target.tagName !== 'INPUT') e.preventDefault();
                const step = e.shiftKey ? 10 : 1;
                const inpT = elements.inpAdvOffTop, inpB = elements.inpAdvOffBot, inpL = elements.inpAdvOffLeft, inpR = elements.inpAdvOffRight;
                if (k === 'arrowup') { inpT.value = (parseInt(inpT.value) || 0) + step; inpB.value = (parseInt(inpB.value) || 0) - step; }
                else if (k === 'arrowdown') { inpT.value = (parseInt(inpT.value) || 0) - step; inpB.value = (parseInt(inpB.value) || 0) + step; }
                else if (k === 'arrowleft') { inpL.value = (parseInt(inpL.value) || 0) + step; inpR.value = (parseInt(inpR.value) || 0) - step; }
                else if (k === 'arrowright') { inpL.value = (parseInt(inpL.value) || 0) - step; inpR.value = (parseInt(inpR.value) || 0) + step; }
                update();
            }
        };
    }
}

function getUnifiedScale() {
    const isClassic = elements.radioResizeModeClassic.checked;
    const container = elements.unifiedResizePreviewContainer;
    const chkAutoFit = elements.chkAdvAutoFit;
    if (!container) return 1.0;

    const W = state.canvasW, H = state.canvasH;
    let sceneW, sceneH;

    if (isClassic) {
        const fw = parseInt(elements.inpCanvasW.value) || W;
        const fh = parseInt(elements.inpCanvasH.value) || H;
        sceneW = Math.max(W, fw);
        sceneH = Math.max(H, fh);
    } else {
        const t = parseInt(elements.inpAdvOffTop.value) || 0, b = parseInt(elements.inpAdvOffBot.value) || 0;
        const l = parseInt(elements.inpAdvOffLeft.value) || 0, r = parseInt(elements.inpAdvOffRight.value) || 0;
        const x1 = Math.min(0, -l);
        const y1 = Math.min(0, -t);
        const x2 = Math.max(W, W + r);
        const y2 = Math.max(H, H + b);
        sceneW = x2 - x1;
        sceneH = y2 - y1;
    }

    if (chkAutoFit && chkAutoFit.checked) {
        // Use container size minus padding
        const cw = container.clientWidth - 40;
        const ch = container.clientHeight - 40;
        let s = Math.min(cw / sceneW, ch / sceneH);
        return s > 1.0 ? 1.0 : s; // NEVER upscale (1:1 max)
    }
    return elements.selUnifiedResizeZoom ? parseFloat(elements.selUnifiedResizeZoom.value) : 1.0;
}

function updateUnifiedResizePreview() {
    const cvs = elements.canvasUnifiedResizePreview, overlay = elements.unifiedResizeOverlay, scene = elements.unifiedResizeScene;
    const container = elements.unifiedResizePreviewContainer;
    if (!cvs || !overlay || !scene || !container) return;

    const isClassic = elements.radioResizeModeClassic?.checked, W = state.canvasW, H = state.canvasH, scale = getUnifiedScale();
    let fw, fh, ox, oy, ow, oh;

    const parseVal = (id) => parseInt(elements[id]?.value) || 0;

    let l = 0, r = 0, t = 0, b = 0;

    if (isClassic) {
        fw = parseInt(elements.inpCanvasW.value) || W; fh = parseInt(elements.inpCanvasH.value) || H;
        const anchor = elements.selCanvasAnchor?.value || 'c';

        const dw = fw - W, dh = fh - H;
        if (anchor.includes('w')) { l = 0; r = dw; }
        else if (anchor.includes('e')) { l = dw; r = 0; }
        else { l = dw / 2; r = dw / 2; }

        if (anchor.includes('n')) { t = 0; b = dh; }
        else if (anchor.includes('s')) { t = dh; b = 0; }
        else { t = dh / 2; b = dh / 2; }

        ow = fw; oh = fh;

        if (elements.selCanvasAnchor) {
            document.querySelectorAll('.anchor-btn').forEach(btn => {
                const a = btn.dataset.anchor;
                btn.classList.toggle('active', a === anchor);
                btn.classList.toggle('image-ref', a === anchor);
                const dir = getAnchorExpansionDirection(anchor, a);
                btn.innerHTML = (a === anchor) ? '' : (dir ? `<i>${dir}</i>` : '<i></i>');
            });
        }
    } else {
        t = parseVal('inpAdvOffTop'); b = parseVal('inpAdvOffBot');
        l = parseVal('inpAdvOffLeft'); r = parseVal('inpAdvOffRight');
        fw = W + l + r; fh = H + t + b;
        ow = fw; oh = fh;
    }

    if (elements.lblUnifiedFinalSize) elements.lblUnifiedFinalSize.innerText = `${Math.round(fw)} x ${Math.round(fh)}`;

    // ABSOLUTE CENTERING LOGIC
    // Calculate the bounding box of the entire composition (Image + Overlay) relative to the Image.
    // Image is at (0,0). Overlay is at (-l, -t).
    // Bounding Box minX = min(0, -l), minY = min(0, -t).
    // Bounding Box maxX = max(W, W+r), maxY = max(H, H+b).
    // BB Width = maxX - minX. BB Height = maxY - minY.

    // To ensure the Image stays "visual center" relative to the container is tricky if using auto-fit, 
    // because auto-fit scales based on the BB. If BB grows to right, center shifts.
    // But if we use Zoom 100%, we can center the Image.
    // Use the Scene to wrap both. Scene Size = BB Size * Scale.

    const minX = Math.min(0, -l), minY = Math.min(0, -t);
    const maxX = Math.max(W, W + r), maxY = Math.max(H, H + b);
    const sceneW = maxX - minX, sceneH = maxY - minY;

    scene.style.width = (sceneW * scale) + 'px';
    scene.style.height = (sceneH * scale) + 'px';

    // Image Position relative to Scene:
    // Image is at (0,0) in local space. Scene starts at (minX, minY).
    // So Image offset = 0 - minX = -minX.
    const imgX = -minX * scale;
    const imgY = -minY * scale;

    // Overlay Position relative to Scene:
    // Overlay is at (-l, -t). Scene starts at (minX, minY).
    // Overlay offset = -l - minX.
    ox = (-l - minX) * scale;
    oy = (-t - minY) * scale;

    cvs.width = Math.floor(W * scale); cvs.height = Math.floor(H * scale);
    cvs.style.width = (W * scale) + 'px'; cvs.style.height = (H * scale) + 'px';
    cvs.style.position = 'absolute';
    cvs.style.left = imgX + 'px'; cvs.style.top = imgY + 'px';

    overlay.style.left = ox + 'px'; overlay.style.top = oy + 'px';
    overlay.style.width = (ow * scale) + 'px'; overlay.style.height = (oh * scale) + 'px';

    // Render Image
    const ctx = cvs.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    const frame = state.frames[state.currentFrameIdx];
    if (frame) {
        // Use unified compositor to correctly process visibility, groups, clipping masks, and floating selection
        const compositeData = compositeFrame(frame, {
            transparentIdx: TRANSPARENT_COLOR,
            floatingSelection: state.floatingSelection,
            showIndex0: true,
            backgroundIdx: 0
        });

        // Convert to ImageData
        const tempCvs = document.createElement('canvas');
        tempCvs.width = W;
        tempCvs.height = H;
        const tempCtx = tempCvs.getContext('2d');
        const imgData = tempCtx.createImageData(W, H);
        const data32 = new Uint32Array(imgData.data.buffer);
        const palette = state.palette;

        for (let i = 0; i < compositeData.length; i++) {
            const idx = compositeData[i];
            if (idx === TRANSPARENT_COLOR) {
                data32[i] = 0;
            } else {
                const c = palette[idx];
                if (c) {
                    imgData.data[i * 4] = c.r;
                    imgData.data[i * 4 + 1] = c.g;
                    imgData.data[i * 4 + 2] = c.b;
                    imgData.data[i * 4 + 3] = 255;
                }
            }
        }
        tempCtx.putImageData(imgData, 0, 0);

        // Draw to scaled context
        ctx.drawImage(tempCvs, 0, 0, W * scale, H * scale);

        if (scale >= 4) {
            ctx.beginPath(); ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
            for (let x = 0; x <= W; x++) { ctx.moveTo(x * scale, 0); ctx.lineTo(x * scale, cvs.height); }
            for (let y = 0; y <= H; y++) { ctx.moveTo(0, y * scale); ctx.lineTo(cvs.width, y * scale); }
            ctx.stroke();
        }
    }

    if (elements.unifiedResizeZoomGrp) elements.unifiedResizeZoomGrp.style.display = elements.chkAdvAutoFit?.checked ? 'none' : 'flex';

    const isValid = fw > 0 && fh > 0;
    if (elements.btnUnifiedResizeApply) {
        elements.btnUnifiedResizeApply.disabled = !isValid;
        elements.btnUnifiedResizeApply.style.opacity = isValid ? '1' : '0.4';
    }

    overlay.innerHTML = '';
    overlay.style.border = isValid ? '2px dashed #48bb78' : '2px dashed #f56565';
}

function getAnchorExpansionDirection(anchor, btnAnchor) {
    if (anchor === btnAnchor) return null;
    const coords = { 'nw': [0, 0], 'n': [1, 0], 'ne': [2, 0], 'w': [0, 1], 'c': [1, 1], 'e': [2, 1], 'sw': [0, 2], 's': [1, 2], 'se': [2, 2] };
    const [ax, ay] = coords[anchor], [bx, by] = coords[btnAnchor], dx = bx - ax, dy = by - ay;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return null;
    if (dx > 0) return dy > 0 ? '↘' : (dy < 0 ? '↗' : '→');
    if (dx < 0) return dy > 0 ? '↙' : (dy < 0 ? '↖' : '←');
    return dy > 0 ? '↓' : (dy < 0 ? '↑' : null);
}

export function setupImageMenuHandlers() {
    setupResizeImageDialog();
    setupUnifiedCanvasResizeDialog();
    const menuResizeCanvas = document.getElementById('menuResizeCanvasUnified');
    if (menuResizeCanvas) menuResizeCanvas.onclick = () => { if (window.showUnifiedCanvasResizeDialog) window.showUnifiedCanvasResizeDialog(); };
    const menuResizeImage = document.getElementById('menuResizeImage');
    if (menuResizeImage) menuResizeImage.onclick = () => { if (window.showResizeImageDialog) window.showResizeImageDialog(); };
    const menuCrop = document.getElementById('menuCropSelection');
    if (menuCrop) menuCrop.onclick = () => { const btn = document.getElementById('btnToolCrop'); if (btn) btn.click(); };
    const ops = [
        { prefix: 'menuFlipH', func: (arg, scope) => flipImage(arg, scope), arg1: 'h' },
        { prefix: 'menuFlipV', func: (arg, scope) => flipImage(arg, scope), arg1: 'v' },
        { prefix: 'menuRot90CW', func: (arg, scope) => rotateImage(arg, scope), arg1: 90 },
        { prefix: 'menuRot90CCW', func: (arg, scope) => rotateImage(arg, scope), arg1: -90 },
    ];
    ops.forEach(op => {
        ['Sel', 'Frame', 'Layer', 'All'].forEach(scope => {
            const el = document.getElementById(`${op.prefix}${scope}`);
            if (el) el.onclick = () => op.func(op.arg1, scope.toLowerCase());
        });
    });
    const flats = [{ id: 'menuMergeDown', mode: 'down' }, { id: 'menuMergeAll', mode: 'all' }, { id: 'menuMergeNewLayer', mode: 'new' }];
    flats.forEach(f => { const el = document.getElementById(f.id); if (el) el.onclick = () => flattenLayers(f.mode); });
}

// ─── SHADOW TOOLS ─────────────────────────────────────────────────────────────

/**
 * Returns the index of the first frame considered a shadow.
 * Shadows are the second half of all frames when useShadows is true.
 */
function getShadowFrameStart() {
    return Math.floor(state.frames.length / 2);
}

/**
 * Fix Shadows (Alt+I):
 * For every shadow frame, replace all pixel indices 2-255 with index 1.
 * After this, shadow pixels are either 0 (transparent) or 1 (shadow colour).
 */
function fixShadows() {
    if (!state.useShadows || state.frames.length === 0) return;

    const shadowStart = getShadowFrameStart();

    for (let fi = shadowStart; fi < state.frames.length; fi++) {
        const frame = state.frames[fi];
        if (!frame) continue;
        for (const layer of frame.layers) {
            if (!layer || !layer.data) continue;
            const data = layer.data;
            for (let i = 0; i < data.length; i++) {
                const v = data[i];
                // Map any colour index 2-255 to 1. Keep 0 and TRANSPARENT_COLOR unchanged.
                if (v >= 2 && v <= 255) {
                    data[i] = 1;
                }
            }
        }
    }

    // Save history AFTER mutating (entire state since it affects multiple frames)
    pushHistory('all');

    renderCanvas();
    try { renderFramesList(); } catch (e) { }
}

/**
 * Remove Useless Shadow Pixels:
 * For each shadow frame, use the corresponding normal frame as a mask.
 * Any pixel in the shadow frame that overlaps an opaque pixel (colour != 0 and != TRANSPARENT_COLOR)
 * in the normal frame's composite is removed (set to TRANSPARENT_COLOR for multi-layer, or 0 for single-layer).
 * Colour 0 is treated as transparent and never participates in the mask.
 */
function removeUselessShadowPixels() {
    if (!state.useShadows || state.frames.length === 0) return;

    const shadowStart = getShadowFrameStart();
    const normalCount = shadowStart;

    for (let si = shadowStart; si < state.frames.length; si++) {
        const normalIdx = si - shadowStart;
        if (normalIdx >= normalCount) break;

        const normalFrame = state.frames[normalIdx];
        const shadowFrame = state.frames[si];
        if (!normalFrame || !shadowFrame) continue;

        // Build a flat mask from the normal frame: true = opaque pixel
        const w = state.canvasW;
        const h = state.canvasH;
        const maskSize = w * h;
        const opaqueMask = new Uint8Array(maskSize); // 1 = opaque in normal frame

        for (const layer of normalFrame.layers) {
            if (!layer || !layer.data || !layer.visible) continue;
            const lw = layer.width || w;
            const lh = layer.height || h;
            const lx = layer.x || 0;
            const ly = layer.y || 0;
            for (let py = 0; py < lh; py++) {
                for (let px = 0; px < lw; px++) {
                    const v = layer.data[py * lw + px];
                    // Colour 0 is transparent in the game for normal frames as well – treat like transparent
                    if (v !== TRANSPARENT_COLOR && v !== 0) {
                        const gx = lx + px;
                        const gy = ly + py;
                        if (gx >= 0 && gx < w && gy >= 0 && gy < h) {
                            opaqueMask[gy * w + gx] = 1;
                        }
                    }
                }
            }
        }

        const isMultiLayer = shadowFrame.layers.length > 1;

        // Remove shadow pixels that are covered by the normal frame
        for (const layer of shadowFrame.layers) {
            if (!layer || !layer.data) continue;
            const lw = layer.width || w;
            const lh = layer.height || h;
            const lx = layer.x || 0;
            const ly = layer.y || 0;
            for (let py = 0; py < lh; py++) {
                for (let px = 0; px < lw; px++) {
                    const gx = lx + px;
                    const gy = ly + py;
                    if (gx < 0 || gx >= w || gy < 0 || gy >= h) continue;
                    if (opaqueMask[gy * w + gx]) {
                        // This pixel is covered by the normal frame – erase it
                        layer.data[py * lw + px] = isMultiLayer ? TRANSPARENT_COLOR : 0;
                    }
                }
            }
        }
    }

    // Save history AFTER mutating (entire state since it affects multiple frames)
    pushHistory('all');

    renderCanvas();
    try { renderFramesList(); } catch (e) { }
}


/**
 * Convert Shadows: RA2 -> TS
 * Moves pixels with index 12 (and 1) from normal frames to shadow frames.
 * If shadows are not active, it expands the project by cloning frames as shadows.
 */
/**
 * Convert Shadows: RA2 -> TS
 * Extracts pixels with index 12 or 1 from ALL layers of a normal frame,
 * moves them to a NEW layer in the corresponding shadow frame.
 * If shadows are not active, expands the project by cloning frames as shadow containers.
 */
function convertRA2toTS() {
    if (state.frames.length === 0) return;

    const w = state.canvasW;
    const h = state.canvasH;

    // Check if we are currently in shadow mode (project partitioned)
    const isShadowsOn = !!state.useShadows;

    let normalCount;
    let shadowStart;

    if (!isShadowsOn) {
        // Expand project if it's in single-frame (non-TS) format
        normalCount = state.frames.length;
        shadowStart = normalCount;

        for (let i = 0; i < normalCount; i++) {
            // FIX: Ensure the frame object HAS width and height for compositeFrame to work!
            state.frames.push({
                width: w,
                height: h,
                lastSelectedIdx: -1,
                layers: [{
                    id: generateId(),
                    name: "Shadow Base",
                    visible: true,
                    locked: false,
                    width: w,
                    height: h,
                    x: 0,
                    y: 0,
                    data: new Uint8Array(w * h).fill(0) // Background color 0
                }]
            });
        }
        state.useShadows = true;
    } else {
        shadowStart = Math.floor(state.frames.length / 2);
        normalCount = shadowStart;
    }

    // Process each animation frame
    for (let i = 0; i < normalCount; i++) {
        const frameN = state.frames[i];
        const frameS = state.frames[i + shadowStart];
        if (!frameN || !frameS) continue;

        // 1. Composition: get a flattened view to find all target shadow pixels
        const flatBuffer = compositeFrame(frameN, { backgroundIdx: 0 });

        // Create shadow layer data with transparency instead of background color 0
        const shadowBuffer = new Uint16Array(w * h).fill(TRANSPARENT_COLOR);
        let pixelsFound = false;

        for (let j = 0; j < flatBuffer.length; j++) {
            const v = flatBuffer[j];
            if (v === 12 || v === 1) {
                shadowBuffer[j] = 1; // Map to TS shadow color 1
                pixelsFound = true;
            }
        }

        if (pixelsFound) {
            // 2. Erase shadow pixels from ALL existing layers in normal frame
            for (const layerN of frameN.layers) {
                if (!layerN.data) continue;
                const isMulti = frameN.layers.length > 1;
                const trans = isMulti ? TRANSPARENT_COLOR : 0;

                // We must handle layers with different sizes/offsets
                const lw = layerN.width || w;
                const lh = layerN.height || h;
                const lx = layerN.x || 0;
                const ly = layerN.y || 0;

                for (let j = 0; j < layerN.data.length; j++) {
                    const color = layerN.data[j];
                    if (color === 12 || color === 1) {
                        layerN.data[j] = trans;
                    }
                }
            }

            // 3. Create a NEW layer at index 0 (Topmost)
            // This ensures it is visible above any Shadow Base layer
            frameS.layers.unshift({
                id: generateId(),
                name: "Converted Shadows",
                visible: true,
                locked: false,
                width: w,
                height: h,
                x: 0,
                y: 0,
                data: shadowBuffer
            });
        }
    }

    pushHistory('all');
    renderCanvas();
    syncMenuToggles();
    if (typeof renderFramesList === 'function') renderFramesList();
    if (typeof updateMenuState === 'function') updateMenuState(true);
}



/**
 * Convert Shadows: TS -> RA2
 * Moves pixels from shadow frames back to normal frames (using index 1)
 * and truncates the SHP to remove the now-redundant shadow frames.
 */
function convertTStoRA2() {
    if (!state.useShadows || state.frames.length < 2) return;

    const shadowStart = getShadowFrameStart();
    const normalCount = shadowStart;

    const w = state.canvasW;
    const h = state.canvasH;

    for (let i = 0; i < normalCount; i++) {
        const si = i + shadowStart;
        const normalFrame = state.frames[i];
        const shadowFrame = state.frames[si];
        if (!normalFrame || !shadowFrame) continue;

        // 1. Opaque mask from normal frame
        const flatNormal = compositeFrame(normalFrame, { backgroundIdx: 0 });
        const opaqueMask = new Uint8Array(w * h);
        for (let k = 0; k < flatNormal.length; k++) {
            if (flatNormal[k] !== 0) opaqueMask[k] = 1;
        }

        // 2. Flat composite of the shadow frame
        const flatShadow = compositeFrame(shadowFrame, { backgroundIdx: 0 });

        // 3. Prepare a new layer buffer for integration
        const integratedBuffer = new Uint16Array(w * h).fill(TRANSPARENT_COLOR);
        let pixelsAdded = false;

        for (let k = 0; k < flatShadow.length; k++) {
            const sv = flatShadow[k];
            // If shadow exists and is not blocked by normal pixels
            if (sv !== 0 && !opaqueMask[k]) {
                integratedBuffer[k] = 12; // Integrated shadow color (RA2 index 12)
                pixelsAdded = true;
            }
        }

        if (pixelsAdded) {
            // Add a new layer at the top of the normal frame
            normalFrame.layers.unshift({
                id: generateId(),
                name: "Integrated Shadows",
                visible: true,
                locked: false,
                width: w,
                height: h,
                x: 0,
                y: 0,
                data: integratedBuffer
            });
        }
    }

    // Truncate frames as they are now integrated
    state.frames = state.frames.slice(0, shadowStart);
    state.useShadows = false;

    // Fix current frame index if it's pointing to the removed shadow part
    if (state.currentFrameIdx >= shadowStart) {
        state.currentFrameIdx -= shadowStart;
    }

    // Save history AFTER mutating
    pushHistory('all');

    renderCanvas();
    syncMenuToggles();
    if (typeof renderFramesList === 'function') renderFramesList();
    if (typeof updateMenuState === 'function') updateMenuState(true);
}


// ============================================================
// IMPORT FROM IMAGES
// ============================================================

let importFromImageFiles = [];

export function setupImportFromImageHandlers() {
    const dialog = elements.importFromImageDialog;
    if (!dialog) return;

    // Drag & Drop
    const dropZone = elements.dropZoneFromImage;
    if (dropZone) {
        dropZone.onclick = () => elements.fileImpFromImage.click();
        dropZone.ondragover = (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        };
        dropZone.ondragleave = () => dropZone.classList.remove('dragover');
        dropZone.ondrop = (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                addImportFiles(Array.from(e.dataTransfer.files));
            }
        };
    }

    // File Input
    if (elements.fileImpFromImage) {
        elements.fileImpFromImage.onchange = (e) => {
            if (e.target.files.length > 0) {
                addImportFiles(Array.from(e.target.files));
                e.target.value = ''; // Reset for same file selection
            }
        };
    }

    // Resolution Inputs
    if (elements.inpImpFromImageW) {
        elements.inpImpFromImageW.onchange = () => renderImportFromImageList();
        elements.inpImpFromImageW.oninput = () => renderImportFromImageList();
    }
    if (elements.inpImpFromImageH) {
        elements.inpImpFromImageH.onchange = () => renderImportFromImageList();
        elements.inpImpFromImageH.oninput = () => renderImportFromImageList();
    }

    // Buttons
    if (elements.btnImpFromImageWDec) elements.btnImpFromImageWDec.onclick = () => {
        elements.inpImpFromImageW.value = Math.max(1, (parseInt(elements.inpImpFromImageW.value) || 0) - 1);
        renderImportFromImageList();
    };
    if (elements.btnImpFromImageWInc) elements.btnImpFromImageWInc.onclick = () => {
        elements.inpImpFromImageW.value = (parseInt(elements.inpImpFromImageW.value) || 0) + 1;
        renderImportFromImageList();
    };
    if (elements.btnImpFromImageHDec) elements.btnImpFromImageHDec.onclick = () => {
        elements.inpImpFromImageH.value = Math.max(1, (parseInt(elements.inpImpFromImageH.value) || 0) - 1);
        renderImportFromImageList();
    };
    if (elements.btnImpFromImageHInc) elements.btnImpFromImageHInc.onclick = () => {
        elements.inpImpFromImageH.value = (parseInt(elements.inpImpFromImageH.value) || 0) + 1;
        renderImportFromImageList();
    };

    if (elements.btnClearFromImage) {
        elements.btnClearFromImage.onclick = () => {
            importFromImageFiles = [];
            renderImportFromImageList();
        };
    }

    if (elements.btnImpFromImageCancel) {
        elements.btnImpFromImageCancel.onclick = () => dialog.close();
    }

    if (elements.btnImpFromImageOk) {
        elements.btnImpFromImageOk.onclick = handleImportFromImage;
    }
}

async function addImportFiles(files) {
    const validExts = ['png', 'pcx'];
    const newFiles = files.filter(f => {
        const ext = f.name.split('.').pop().toLowerCase();
        return validExts.includes(ext);
    });

    if (newFiles.length === 0) return;

    // If it's the first batch and no project is open, use the first image's size
    const isFirstBatch = importFromImageFiles.length === 0;
    const noProject = state.frames.length === 0;

    for (const file of newFiles) {
        // Get dimensions
        const size = await getImageDimensions(file);
        file._width = size.width;
        file._height = size.height;
        importFromImageFiles.push(file);
    }

    if (isFirstBatch && noProject) {
        const first = importFromImageFiles[0];
        elements.inpImpFromImageW.value = first._width;
        elements.inpImpFromImageH.value = first._height;
    }

    renderImportFromImageList();
}

async function getImageDimensions(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'pcx') {
        try {
            const buf = await file.arrayBuffer();
            return PcxLoader.getDimensions(buf);
        } catch (e) {
            console.error("PCX dimension error:", e);
            return { width: 0, height: 0 };
        }
    }
    
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve({ width: img.width, height: img.height });
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve({ width: 0, height: 0 });
        };
        img.src = url;
    });
}

function renderImportFromImageList() {
    const list = elements.impFromImageList;
    if (!list) return;

    if (importFromImageFiles.length === 0) {
        list.innerHTML = `<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 20px;" data-i18n="msg_no_files_selected">${t("msg_no_files_selected")}</div>`;
        if (elements.btnImpFromImageOk) elements.btnImpFromImageOk.disabled = true;
        return;
    }

    if (elements.btnImpFromImageOk) elements.btnImpFromImageOk.disabled = false;

    const targetW = parseInt(elements.inpImpFromImageW.value) || 0;
    const targetH = parseInt(elements.inpImpFromImageH.value) || 0;

    list.innerHTML = '';
    importFromImageFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-list-item'; // Assumes professional styling exists or we use inline
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.padding = '4px 8px';
        item.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        item.style.gap = '8px';

        const isTooLarge = file._width > targetW || file._height > targetH;

        item.innerHTML = `
            <span class="menu-icon icon-shp-file" style="width: 14px; height: 14px;"></span>
            <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px;" title="${file.name}">${file.name}</span>
            <span style="font-size: 10px; color: var(--text-muted);">${file._width}x${file._height}</span>
            ${isTooLarge ? `<span style="color: #ffcc00; font-weight: bold; cursor: help;" title="${t('lbl_res_warning')}">⚠</span>` : ''}
            <button class="btn-icon-sec" title="Remove">✕</button>
        `;

        item.querySelector('button').onclick = () => {
            importFromImageFiles.splice(index, 1);
            renderImportFromImageList();
        };

        list.appendChild(item);
    });
}

export function showImportFromImageDialog() {
    const dlg = elements.importFromImageDialog;
    if (!dlg) return;

    importFromImageFiles = [];
    
    // Set initial dimensions
    if (state.frames.length > 0) {
        elements.inpImpFromImageW.value = state.canvasW;
        elements.inpImpFromImageH.value = state.canvasH;
        // If project exists, lock resolution inputs? The user said "dimensions can be adjusted manually"
        // but it's usually for when there is NO project.
        // Actually, for consistency, if project exists, these dimensions should match.
        // But the user might want to import and RESIZE later? 
        // No, typically in this editor, if project exists, we append to it WITH project resolution.
    } else {
        elements.inpImpFromImageW.value = 60; // Default
        elements.inpImpFromImageH.value = 48;
    }

    // Show compression only if no project is open
    if (elements.rowImpFromImageComp) {
        elements.rowImpFromImageComp.style.display = (state.frames.length === 0) ? 'flex' : 'none';
        if (elements.selImpFromImageComp) elements.selImpFromImageComp.value = "3";
    }

    renderImportFromImageList();
    if (typeof dlg.showModal === 'function') dlg.showModal();
}

async function handleImportFromImage() {
    if (importFromImageFiles.length === 0) return;

    const oldLength = state.frames.length;

    const targetW = parseInt(elements.inpImpFromImageW.value) || 1;
    const targetH = parseInt(elements.inpImpFromImageH.value) || 1;

    // 1. If no project, create one with 0 initial frames
    const isNewProject = state.frames.length === 0;
    if (isNewProject) {
        const comp = elements.selImpFromImageComp ? parseInt(elements.selImpFromImageComp.value) : 3;
        createNewProject(targetW, targetH, 0, false, null, comp);
    }

    const startIdx = state.currentFrameIdx;
    
    // 2. Process each file
    for (const file of importFromImageFiles) {
        try {
            const data = await processImageFile(file);
            if (!data) continue;

            const indices = new Uint16Array(targetW * targetH).fill(TRANSPARENT_COLOR);

            // Copy pixels with clipping if necessary (Top-Left aligned)
            const dw = Math.min(data.width, targetW);
            const dh = Math.min(data.height, targetH);

            for (let y = 0; y < dh; y++) {
                for (let x = 0; x < dw; x++) {
                    const color = data.pixels[y * data.width + x];
                    if (color.a < 128) continue;
                    indices[y * targetW + x] = findNearestPaletteIndex(color.r, color.g, color.b, state.palette);
                }
            }

            const newFrame = {
                width: targetW, height: targetH, duration: 100, _v: 0,
                lastSelectedIdx: -1,
                layers: [{
                    type: 'layer',
                    id: generateId(),
                    name: "Imported",
                    data: indices,
                    visible: true,
                    width: targetW,
                    height: targetH,
                    mask: null,
                    editMask: false
                }]
            };

            // Handle extra shadow frames when editor is in Shadow mode.
            if (state.useShadows) {
                const shadowStart = getShadowFrameStart();
                // Insert normal frame at end of normal section
                const newFrameIdx = shadowStart;
                state.frames.splice(newFrameIdx, 0, newFrame);
                
                // Insert shadow frame at end of shadow section
                const shadowLayer = {
                    type: 'layer',
                    id: generateId(),
                    name: "Shadow",
                    data: new Uint16Array(targetW * targetH).fill(TRANSPARENT_COLOR),
                    visible: true,
                    width: targetW,
                    height: targetH,
                    x: 0,
                    y: 0
                };
                const shadowFrame = {
                    width: targetW, height: targetH, duration: 100, _v: 0,
                    lastSelectedIdx: -1,
                    layers: [shadowLayer]
                };
                state.frames.push(shadowFrame);
            } else {
                // Append at the end normally
                state.frames.push(newFrame);
            }

            // Set active layer if none selected
            if (!state.activeLayerId && state.frames.length > 0) {
                state.activeLayerId = state.frames[0].layers[0].id;
            }
        } catch (err) {
            console.error(`Error processing ${file.name}:`, err);
        }
    }

    elements.importFromImageDialog.close();
    
    // Fix: Select the first of the newly added frames
    if (state.frames.length > oldLength) {
        state.currentFrameIdx = oldLength;
        state.activeLayerId = state.frames[oldLength].layers[0].id;
    }

    pushHistory('all');
    updateCanvasSize();
    renderCanvas();
    renderFramesList();
    updateLayersList();
    updateUIState();
    
    if (typeof showEditorInterface === 'function') showEditorInterface();
}


export function setupToolsMenu() {
    const fixEl = document.getElementById('menuFixShadows');
    if (fixEl) {
        fixEl.onclick = (e) => {
            e.stopPropagation();
            closeAllMenus();
            fixShadows();
        };
    }

    const removeEl = document.getElementById('menuRemoveUselessShadowPixels');
    if (removeEl) {
        removeEl.onclick = (e) => {
            e.stopPropagation();
            closeAllMenus();
            removeUselessShadowPixels();
        };
    }

    const ra2tsEl = document.getElementById('menuConvertRA2toTS');
    if (ra2tsEl) {
        ra2tsEl.onclick = (e) => {
            e.stopPropagation();
            closeAllMenus();
            convertRA2toTS();
        };
    }

    const tsra2El = document.getElementById('menuConvertTStoRA2');
    if (tsra2El) {
        tsra2El.onclick = (e) => {
            e.stopPropagation();
            closeAllMenus();
            convertTStoRA2();
        };
    }

    const seqEl = document.getElementById('menuInfantrySequence');
    if (seqEl) {
        seqEl.onclick = (e) => {
            e.stopPropagation();
            closeAllMenus();
            openSequenceEditor();
        };
    }

    const vseqEl = document.getElementById('menuVehicleSequence');
    if (vseqEl) {
        vseqEl.onclick = (e) => {
            e.stopPropagation();
            closeAllMenus();
            openVehicleSequenceEditor();
        };
    }

    // Init sequence editor events (once)
    initSequenceEditor();
    initVehicleSequenceEditor();
}

// ============================================================
// RECENT FILES (File System Access API + IndexedDB)
// ============================================================

const RECENT_DB_NAME = 'shp_editor_recent';
const RECENT_STORE = 'files';
const MAX_RECENT = 10;

function openRecentDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(RECENT_DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(RECENT_STORE)) {
                db.createObjectStore(RECENT_STORE, { keyPath: 'id', autoIncrement: true });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function getRecentFiles() {
    try {
        const db = await openRecentDB();
        return new Promise((resolve) => {
            const tx = db.transaction(RECENT_STORE, 'readonly');
            const store = tx.objectStore(RECENT_STORE);
            const req = store.getAll();
            req.onsuccess = () => {
                const items = req.result || [];
                // Sort newest first
                items.sort((a, b) => b.timestamp - a.timestamp);
                resolve(items.slice(0, MAX_RECENT));
            };
            req.onerror = () => resolve([]);
        });
    } catch {
        return [];
    }
}

export async function saveRecentFile(name, handle) {
    if (!handle) return;
    try {
        const db = await openRecentDB();

        // First, remove any existing entry with the same name
        const existing = await new Promise((resolve) => {
            const tx = db.transaction(RECENT_STORE, 'readonly');
            const store = tx.objectStore(RECENT_STORE);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });

        const tx = db.transaction(RECENT_STORE, 'readwrite');
        const store = tx.objectStore(RECENT_STORE);

        // Remove duplicates by name
        for (const item of existing) {
            if (item.name === name) {
                store.delete(item.id);
            }
        }

        // Add new entry with palette reference
        const paletteId = getActivePaletteId() || null;
        store.add({ name, handle, paletteId, timestamp: Date.now() });

        // Trim old entries (keep only MAX_RECENT)
        const sorted = existing.filter(i => i.name !== name);
        sorted.sort((a, b) => b.timestamp - a.timestamp);
        const toRemove = sorted.slice(MAX_RECENT - 1); // -1 because we just added one
        for (const item of toRemove) {
            store.delete(item.id);
        }

        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = reject;
        });

        // Refresh menu
        renderRecentFilesMenu();
    } catch (err) {
        console.warn('[Recent Files] Save failed:', err);
    }
}

async function clearRecentFiles() {
    try {
        const db = await openRecentDB();
        const tx = db.transaction(RECENT_STORE, 'readwrite');
        tx.objectStore(RECENT_STORE).clear();
        await new Promise((resolve) => { tx.oncomplete = resolve; });
        renderRecentFilesMenu();
    } catch (err) {
        console.warn('[Recent Files] Clear failed:', err);
    }
}

async function openRecentFile(handle, paletteId) {
    try {
        // Request permission
        const perm = await handle.requestPermission({ mode: 'read' });
        if (perm !== 'granted') {
            console.warn('[Recent Files] Permission denied');
            return;
        }

        const file = await handle.getFile();
        const buf = await file.arrayBuffer();

        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'shp' || ext === 'sha') {
            // Restore palette: try saved palette first, fallback to most recent
            let paletteRestored = false;
            if (paletteId) {
                paletteRestored = applyPaletteById(paletteId);
            }
            if (!paletteRestored) {
                const fallbackId = getMostRecentPaletteId();
                if (fallbackId) {
                    applyPaletteById(fallbackId);
                }
            }

            const shp = ShpFormat80.parse(buf);
            loadShpData(shp);

            // Store handle for Save functionality
            window._lastShpFileHandle = handle;

            // Save updated timestamp
            saveRecentFile(file.name, handle);

            if (typeof window.updateUIState === 'function') window.updateUIState();
            closeAllMenus();
        }
    } catch (err) {
        console.error('[Recent Files] Failed to open:', err);
        alert('Failed to open recent file: ' + err.message);
    }
}

async function renderRecentFilesMenu() {
    const container = document.getElementById('menuRecentContainer');
    const submenu = document.getElementById('menuRecentSubmenu');
    if (!container || !submenu) return;

    const items = await getRecentFiles();

    if (items.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = '';
    submenu.innerHTML = '';

    for (const item of items) {
        const div = document.createElement('div');
        div.className = 'menu-action';
        div.style.height = 'auto';
        div.style.padding = '6px 10px';

        const palName = getPaletteName(item.paletteId) || t('lbl_default');
        const dateStr = new Date(item.timestamp).toLocaleString();

        div.title = `${t('lbl_file')}: ${item.name}\n${t('lbl_date')}: ${dateStr}\n${t('lbl_palette')}: ${palName}`;

        div.innerHTML = `
            <span class="menu-icon icon-shp-file" style="align-self: flex-start; margin-top: 4px;"></span>
            <div style="display:flex; flex-direction:column; line-height:1.2; overflow:hidden;">
                <span style="font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.name}</span>
                <span style="font-size: 10px; color: #718096; font-style: italic;">${dateStr} \u00b7 ${palName}</span>
            </div>
        `;
        div.onclick = (e) => {
            e.stopPropagation();
            openRecentFile(item.handle, item.paletteId);
        };
        submenu.appendChild(div);
    }

    // Add separator + Clear Recent
    const sep = document.createElement('div');
    sep.className = 'menu-divider';
    submenu.appendChild(sep);

    const clearBtn = document.createElement('div');
    clearBtn.className = 'menu-action';
    clearBtn.innerHTML = `<span style="color:#a0aec0; font-style:italic;">${t("btn_clear_recent")}</span>`;
    clearBtn.onclick = (e) => {
        e.stopPropagation();
        clearRecentFiles();
        closeAllMenus();
    };
    submenu.appendChild(clearBtn);
}

export function initRecentFiles() {
    // Only initialize if File System Access API is available
    if (!window.showOpenFilePicker) {
        console.log('[Recent Files] File System Access API not available — feature hidden.');
        return;
    }

    renderRecentFilesMenu();
}
