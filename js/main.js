/**
 * Advanced SHP Editor
 * Copyright (C) 2026 FS-21
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 * 
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { state, activeTool, isDrawing, setIsDrawing, lastPos, setLastPos } from './state.js';
import { elements } from './constants.js';
import { initImportShp, syncImporterPalette, resetImportState } from './import_shp.js';
import { ShpFormat80 } from './shp_format.js';
import { initHistoryHooks, undo, redo, pushHistory } from './history.js';
import {
    updateCanvasSize, renderCanvas, renderOverlay,
    updateLayersList, renderFramesList, renderPalette,
    setupZoomOptions, createNewProject, addFrame,
    addLayer, deleteLayer, moveLayerUp, moveLayerDown, mergeLayerDown,
    applyColorReplace, getActiveLayer, addGroup, triggerSelectionFlash,
    copySelection, cutSelection, pasteClipboard, selectAll, invertSelection,
    togglePixelSelection, startMovingSelectionPixels, finishMovingSelectionPixels, updateModeButtons, combineSelection,
    setupMultiFrameOps, commitSelection, clearSelection, checkIfPixelSelected, startAnts, stopAnts, toggleReplacePanel, renderReplaceGrid, handleReplacePickerInput, addExternalShpLayer,
    setupReplacePreviewListeners, analyzeReplaceConflicts, updatePixelGrid, initPanelResizing,
    showEditorInterface, renderPaletteSimple, initFrameManager,
    showConfirm, updateActiveLayerPreview, setupSubmenusRecursive,
    openActiveLayerProperties, setupTooltips, getLayerDataSnapshot, setupToolbarOverflow,
    showPasteNotification
} from './ui.js';
import { initPreviewWindow, openPreview } from './preview_window.js';
import {
    magicWand, finishLassoSelection, pickColor, deleteSelection,
    fillCircle, fillRectangle, addReplacePair, removeReplacePairs, swapReplaceCols, processReplace,
    copyReplacePairs, pasteReplacePairs,
    updateCanvasCursor, cropToSelection, deselect, getSelectionHandleAt, handleToCursor
} from './tools.js';

import { resampleLayerData, rotateBufferArbitrary, shiftColorIndex } from './image_ops.js';
import { bresenham, setupAutoRepeat } from './utils.js';
import { loadShpData, parsePaletteData, parsePaletteBuffer, handleSaveShp, handleClipboardPaste, processSystemImagePaste } from './file_io.js';
import { initMenu, updateMenuState, setupImageMenuHandlers, initRecentFiles, saveRecentFile } from './menu_handlers.js';
import { setupPaletteMenu } from './palette_menu.js';
import { initExternalShpDialog, openExternalShpDialog } from './external_shp.js';
import { initLanguageSelector } from './translations.js';


// Toggle UI visibility based on whether project is loaded
export function updateUIState() {

    const hasProject = state.frames.length > 0;

    // Get elements
    const topBarControls = document.getElementById('topBarControls');
    const toolProperties = document.getElementById('toolProperties');
    const headerToolProperties = document.getElementById('headerToolProperties');
    const panelRight = document.querySelector('.panel-right');
    const toolsBar = document.getElementById('toolsBar');
    const statusBar = document.querySelector('.status-bar');

    // Toggle visibility
    if (topBarControls) {
        topBarControls.style.display = hasProject ? 'flex' : 'none';
    }
    if (toolProperties) {
        toolProperties.style.display = hasProject ? 'flex' : 'none';
    }
    if (headerToolProperties) {
        headerToolProperties.style.display = hasProject ? 'block' : 'none';
    }
    if (panelRight) {
        panelRight.style.display = hasProject ? 'flex' : 'none';
    }
    if (toolsBar) {
        toolsBar.style.display = hasProject ? 'flex' : 'none';
    }
    if (statusBar) {
        statusBar.style.display = hasProject ? 'flex' : 'none';
    }

    // Update menu state (enabled/disabled actions)
    updateMenuState(hasProject);
}


function init() {
    window.updateUIState = updateUIState;
    try {

        console.log("TRACE: init started");
        
        initLanguageSelector(); // Init translations

        // Refresh UI when language changes (for dynamically rendered components)
        window.addEventListener('languagechange', () => {
             updateLayersList();
             renderFramesList();
             renderPalette();
             updateUIState();
             if (typeof renderReplaceGrid === 'function') renderReplaceGrid();
             if (typeof refreshPalettesMenuDynamic === 'function') refreshPalettesMenuDynamic();
        });

        // Initialize Circular Dependencies Hooks
        initHistoryHooks(
            () => { // onRestore callback
                renderCanvas();
                renderOverlay(); // Ensure overlay is rendered on history restore
                if (state.selection) startAnts(); // Refresh ants if selection exists
                if (typeof renderPalette === 'function') renderPalette();
                renderFramesList();
                updateLayersList();
            },
            renderFramesList, updateLayersList, startAnts, stopAnts, updateUIState
        );

        console.log("TRACE: Hooks initialized");
        renderPalette();
        console.log("TRACE: Palette rendered");
        setupZoomOptions();
        console.log("TRACE: Zoom options setup");
        setupEventListeners();
        console.log("TRACE: Event listeners setup");
        initMenu();
        setupImageMenuHandlers();
        console.log("TRACE: Menu initialized");
        setupMultiFrameOps();
        console.log("TRACE: MultiFrameOps setup");

        // createNewProject(state.canvasW || 60, state.canvasH || 48); // Removed to allow empty state
        console.log("TRACE: project created");

        updateCanvasSize(); // Ensure wrapper is hidden initially
        console.log("TRACE: Canvas size updated");

        // Initial render
        renderReplaceGrid();
        console.log("TRACE: replaceGrid rendered");
        setupReplacePreviewListeners();
        console.log("TRACE: Replace preview listeners setup");
        initPanelResizing();
        console.log("TRACE: Panel resizing initialized");

        initNewShpDialog();
        console.log("TRACE: New SHP Dialog initialized");

        initFrameManager(); // Initialize Frame Manager
        setupSubmenusRecursive(); // Initialize universal submenu hover logic
        setupTooltips(); // Initialize global tooltip system
        setupToolbarOverflow(); // Initialize dynamic toolbar overflow logic

        initImportShp(handleConfirmImport);
        console.log("TRACE: Import SHP initialized");

        initExternalShpDialog(handleConfirmExternalShp);
        console.log("TRACE: External SHP initialized");

        initPreviewWindow();
        console.log("TRACE: Preview Window initialized");

        setupPaletteMenu();
        console.log("TRACE: Palette Menu initialized");

        initRecentFiles();
        console.log("TRACE: Recent Files initialized");

        renderOverlay(); // Initialize selection button states
        updateUIState(); // Set initial state (disabled menus if no project)
        setupColorShiftUIListeners();
        console.log("TRACE: init finished");


        // Splash Screen Logic
        setTimeout(() => {
            const splash = document.getElementById('splashScreen');
            if (splash) {
                splash.classList.add('hidden');
                setTimeout(() => splash.remove(), 1000); // Remove from DOM after transition
            }
        }, 1500);

        // Initialize UI state visibility
        updateUIState();

        // Disable native right-click context menu globally
        window.addEventListener('contextmenu', (e) => e.preventDefault());



    } catch (err) {
        console.error("CRITICAL INIT ERROR:", err);
        alert("Init Error: " + err.message + "\nStack: " + err.stack);
    }
}

// Global logger to catch early errors
window.onerror = function (msg, url, lineNo, columnNo, error) {
    console.error("Window Error:", msg, "at", url, ":", lineNo);
    alert("Global Error: " + msg + "\nAt: " + url + ":" + lineNo + ":" + columnNo);
    return false;
};

window.addEventListener('keydown', (e) => {
    if (e.key === 'Control') state.isCtrlPressed = true;
});
window.addEventListener('keyup', (e) => {
    if (e.key === 'Control') state.isCtrlPressed = false;
});

function setupEventListeners() {
    // Shortcuts
    window.addEventListener('keydown', async (e) => {
        if (!e.key) return;
        const k = e.key.toLowerCase();
        const ctrl = e.ctrlKey || e.metaKey;

        if (k === 'g' && !ctrl) {
            state.showGrid = !state.showGrid;
            updatePixelGrid();
            syncMenuToggles();
            const advDialog = document.getElementById('resizeCanvasAdvDialog');
            if (advDialog && advDialog.open) updateAdvResizePreview();
        }

        if (ctrl && k === 'z') {
            e.preventDefault();
            if (e.shiftKey) redo(); else undo();
        } else if (ctrl && k === 'y') {
            e.preventDefault(); redo();
        }

        // Consolidated Shortcuts
        if (ctrl && k === 'a') {
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
            e.preventDefault();
            const replacePanel = document.getElementById('sidePanelExtra');
            if (replacePanel && !replacePanel.classList.contains('collapsed')) {
                state.replaceSelection.clear();
                for (let i = 0; i < state.replacePairs.length; i++) state.replaceSelection.add(i);
                renderReplaceGrid();
            } else {
                selectAll();
            }
        }
        if (ctrl && k === 'c') {
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
            e.preventDefault();

            const replacePanel = document.getElementById('sidePanelExtra');
            if (replacePanel && !replacePanel.classList.contains('collapsed') && state.replaceSelection.size > 0) {
                copyReplacePairs();
            } else {
                copySelection();
            }
        }
        if (ctrl && k === 'v') {
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
            e.preventDefault();

            const replacePanel = document.getElementById('sidePanelExtra');
            const isReplaceActive = replacePanel && !replacePanel.classList.contains('collapsed');

            if (isReplaceActive && state.replaceClipboard && state.replaceClipboard.length > 0) {
                pasteReplacePairs();
            } else {
                // Always try system clipboard first for external image paste (like TMP Editor).
                // If the system clipboard has an image, it takes priority over the internal clipboard.
                // If the user does not have an image in the system clipboard (or permission is denied),
                // the interceptor returns false and we fall back to the internal clipboard.
                const hadExternalPaste = await systemClipboardInterceptor();
                if (!hadExternalPaste) {
                    if (state.clipboard) {
                        if (e.altKey) {
                            pasteAsNewFrame();
                        } else if (e.shiftKey) {
                            pasteClipboard(true); // To New Layer
                        } else {
                            pasteClipboard(false); // To Active Layer
                        }
                    }
                }
            }
        }
        if (ctrl && k === 'x') {
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
            e.preventDefault();
            cutSelection();
        }
        if (ctrl && k === 'd') {
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
            e.preventDefault();
            deselect();
        }
        if (ctrl && k === 'i') {
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
            e.preventDefault();
            invertSelection();
        }
        if (k === 'delete') {
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
            e.preventDefault();

            const replacePanel = document.getElementById('sidePanelExtra');
            if (replacePanel && !replacePanel.classList.contains('collapsed') && state.replaceSelection.size > 0) {
                removeReplacePairs();
            } else {
                deleteSelection();
            }
        }
        if (k === 'backspace') {
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
            e.preventDefault();
            fillSelection();
        }
        if (ctrl && k === 'b') {
            e.preventDefault();
            zoomToSelection();
        }
        if (ctrl && k === '1') {
            e.preventDefault();
            elements.inpZoom.value = 100;
            elements.inpZoom.dispatchEvent(new Event('input'));
        }
        if (ctrl && k === '0') {
            e.preventDefault();
            const btn = document.getElementById('menuShowCenter');
            if (btn) btn.click();
        }
        if (ctrl && k === 's') {
            e.preventDefault();
            if (e.shiftKey) {
                showExportDialog();
            } else {
                handleSaveShp();
            }
        }
        if (ctrl && k === 'n') {
            e.preventDefault();
            openNewShpDialog();
        }
        if (ctrl && k === 'o') {
            e.preventDefault();
            if (elements.importShpDialog) elements.importShpDialog.showModal();
        }

        if (e.altKey && k === 'q') {
            e.preventDefault();
            openPreview();
        }

        if (e.altKey && k === 'i') {
            e.preventDefault();
            const btn = document.getElementById('menuFixShadows');
            if (btn && !btn.classList.contains('disabled')) btn.click();
        }

        if (ctrl && k === 'l') {
            e.preventDefault();
            const btn = document.getElementById('toggleGridColor');
            if (btn) btn.click();
        }

        if (k === 'f2') {
            e.preventDefault();
            // renameActiveLayer();
        }

        if (['input', 'textarea', 'select'].includes(document.activeElement.tagName.toLowerCase())) return;

        if (k === 'p') setTool('pencil');
        if (k === 'l') setTool('line');
        if (k === 'r') setTool('rect');
        if (k === 'e') setTool('eraser');
        if (k === 'm') {
            if (activeTool === 'movePixels') setTool('moveSelectionArea');
            else setTool('movePixels');
        }
        if (k === 's') setTool('select');
        if (k === 'n') setTool('lasso');
        if (k === 'w') setTool('wand');
        if (k === 'y') {
            setTool('spray');
            if (state.toolSettings.brushSize === 1) {
                if (typeof updateBrushSizeDisplay === 'function') updateBrushSizeDisplay(7);
            }
        }
        if (k === 'i') setTool('picker');
        // Removed redundant deleteSelection call here, it's handled by 'delete' key
        // if (k === 'delete' && state.selection) deleteSelection();

        // Keyboard Nudge (Arrow Keys)
        if (state.selection && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
            e.preventDefault();
            if (!state.isMovingSelection && !state.floatingSelection) {
                state.isMovingSelection = true;
                startMovingSelectionPixels();
                state.isMovingSelection = false;
            }

            if (state.floatingSelection) {
                const step = e.shiftKey ? 10 : 1;
                if (k === 'arrowleft') state.floatingSelection.x -= step;
                if (k === 'arrowright') state.floatingSelection.x += step;
                if (k === 'arrowup') state.floatingSelection.y -= step;
                if (k === 'arrowdown') state.floatingSelection.y += step;

                state.selection.x = state.floatingSelection.x;
                state.selection.y = state.floatingSelection.y;

                renderCanvas();
                renderOverlay();
                updateActiveLayerPreview();
                try { renderFramesList(); } catch (e) { }
            }
        }
    });


    // Shortcuts
    // Shortcuts
    // elements.btnNew.onclick handled by initNewShpDialog

    // Generic element guards for toolbar/topbar buttons (some might be hidden/removed)


    // Export Dialog handled via menu_handlers.js now.
    // btnSaveShp and btnOpenShp are not in the DOM anymore.

    // Save Dialog Buttons
    if (elements.btnCancelExpShp) {
        elements.btnCancelExpShp.onclick = () => {
            if (elements.exportShpDialog) elements.exportShpDialog.close();
        };
    }
    if (elements.btnConfirmExpShp) {
        elements.btnConfirmExpShp.onclick = handleExportShp;
    }


    elements.fileInShp.onchange = async (e) => {
        if (!e.target.files.length) return;
        const buf = await e.target.files[0].arrayBuffer();
        try {
            const shp = ShpFormat80.parse(buf);
            loadShpData(shp);
        } catch (err) {
            console.error(err);
            alert("Error loading SHP: " + err.message);
        } finally {
            if (elements.fileInShp) elements.fileInShp.value = '';
        }
    };




    // View Options
    // View Options
    // View Options logic updated to professional brush size control


    // --- TOOLS ---
    elements.btnToolPencil.onclick = () => setTool('pencil');
    // Tool Buttons
    const toolMap = {
        btnToolPencil: 'pencil',
        btnToolLine: 'line',
        btnToolRect: 'rect',
        btnToolEraser: 'eraser',
        btnToolMovePixels: 'movePixels',
        btnToolMoveSelection: 'moveSelectionArea',
        btnToolSelect: 'select',
        btnToolLasso: 'lasso',
        btnToolWand: 'wand',
        btnToolSpray: 'spray',
        btnToolFill: 'fill',
        btnToolPicker: 'picker',
        btnToolColorShift: 'colorShift'
    };

    Object.keys(toolMap).forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', () => {
            const t = toolMap[id];
            if (activeTool === t && (t === 'select' || t === 'movePixels' || t === 'moveSelectionArea')) {
                if (state.selection) {
                    state.selection = null;
                    if (state.floatingSelection) clearSelection();
                    renderOverlay();
                } else {
                    setTool(null); // Toggle off if nothing selected
                }
            } else {
                setTool(t);
                if (t === 'spray' && state.toolSettings.brushSize === 1) {
                    if (typeof updateBrushSizeDisplay === 'function') updateBrushSizeDisplay(7);
                }
            }
        });
    });

    const btnOpenPreview = document.getElementById('btnOpenPreview');
    if (btnOpenPreview) {
        btnOpenPreview.onclick = () => openPreview();
    }

    // Tool Properties
    // Old brushSize listener removed

    // Square Properties
    if (elements.cbSquareFill) {
        elements.cbSquareFill.addEventListener('change', (e) => {
            state.toolSettings.squareFill = e.target.checked;
            if (elements.inpSquareFillColor) {
                elements.inpSquareFillColor.disabled = !e.target.checked;
            }
        });
    }

    // Custom Picker Mode for Square Fill
    if (elements.inpSquareFillColor) {
        elements.inpSquareFillColor.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent default system picker
            if (elements.inpSquareFillColor.disabled) return;

            state.isPickingSquareFill = true;
            document.body.classList.add('picking-mode');
            const overlay = document.getElementById('modalOverlay');
            if (overlay) overlay.classList.add('active');
            const help = document.getElementById('pickerHelpText');
            if (help) help.style.display = 'block';
        });
    }

    // Overlay to Cancel Picking
    const overlay = document.getElementById('modalOverlay');
    if (overlay) {
        overlay.addEventListener('click', () => {
            if (state.isPickingSquareFill) {
                state.isPickingSquareFill = false;
                document.body.classList.remove('picking-mode');
                overlay.classList.remove('active');
                const help = document.getElementById('pickerHelpText');
                if (help) help.style.display = 'none';
            }
        });
    }

    if (elements.inpSquareFillColor) {
        // Keep change listener for manual input if needed, but primary is now click
        elements.inpSquareFillColor.addEventListener('input', (e) => {
            state.toolSettings.squareFillColor = e.target.value;
        });
    }

    // Initialize tool and default color (Background/Transparent)
    setTool('pencil');
    setColor(0);

    // Replace Tool
    if (elements.btnToggleSidePanel) {
        elements.btnToggleSidePanel.onclick = () => {
            toggleReplacePanel();
        };
    }

    // --- REPLACE PANEL EVENTS ---
    if (elements.btnAddPair) {
        elements.btnAddPair.onclick = addReplacePair;
    }

    if (elements.btnRemovePair) {
        elements.btnRemovePair.onclick = removeReplacePairs;
    }

    if (elements.btnSwapReplaceCols) {
        elements.btnSwapReplaceCols.onclick = swapReplaceCols;
    }

    if (elements.btnProcessReplace) {
        elements.btnProcessReplace.onclick = processReplace;
    }

    // Color Picker Buttons
    if (elements.btnPickReplaceSrc) {
        elements.btnPickReplaceSrc.onclick = () => {
            const isActive = state.isPickingForReplace && state.isPickingForReplace.side === 'src';
            if (isActive) {
                // Deactivate
                state.isPickingForReplace = null;
                elements.btnPickReplaceSrc.classList.remove('picker-active');
                document.body.classList.remove('picking-mode');
            } else {
                // Activate
                state.isPickingForReplace = { side: 'src' };
                state.multiPickCounter = 0;
                elements.btnPickReplaceSrc.classList.add('picker-active');
                if (elements.btnPickReplaceTgt) elements.btnPickReplaceTgt.classList.remove('picker-active');
                document.body.classList.add('picking-mode');
            }
        };
    }

    if (elements.btnPickReplaceTgt) {
        elements.btnPickReplaceTgt.onclick = () => {
            const isActive = state.isPickingForReplace && state.isPickingForReplace.side === 'tgt';
            if (isActive) {
                // Deactivate
                state.isPickingForReplace = null;
                elements.btnPickReplaceTgt.classList.remove('picker-active');
                document.body.classList.remove('picking-mode');
            } else {
                // Activate
                state.isPickingForReplace = { side: 'tgt' };
                state.multiPickCounter = 0;
                elements.btnPickReplaceTgt.classList.add('picker-active');
                if (elements.btnPickReplaceSrc) elements.btnPickReplaceSrc.classList.remove('picker-active');
                document.body.classList.add('picking-mode');
            }
        };
    }



    if (elements.btnBatchImport) {
        elements.btnBatchImport.onclick = () => {
            const dialog = document.getElementById('batchReplaceDialog');
            const input = document.getElementById('txtBatchInput');
            if (dialog && input) {
                // Ensure translations are applied (handles newly shown elements or late-initialized ones)
                if (typeof applyTranslations === 'function') applyTranslations();

                // Pre-fill with current pairs (Index=Index format)
                let text = "; Current replacements\n";
                state.replacePairs.forEach(p => {
                    const src = (p.srcIdx !== null && p.srcIdx !== undefined) ? p.srcIdx : "";
                    const tgt = (p.tgtIdx !== null && p.tgtIdx !== undefined) ? p.tgtIdx : "";
                    text += `${src}=${tgt}\n`;
                });
                input.value = text;

                if (typeof dialog.showModal === 'function') dialog.showModal();
                else dialog.setAttribute('open', '');
            }
        };
    }

    const btnBatchCancel = document.getElementById('btnBatchCancel');
    if (btnBatchCancel) {
        btnBatchCancel.onclick = () => {
            const dialog = document.getElementById('batchReplaceDialog');
            if (dialog) dialog.close();
        };
    }

    const btnBatchProcess = document.getElementById('btnBatchProcess');
    if (btnBatchProcess) {
        btnBatchProcess.onclick = () => {
            const input = document.getElementById('txtBatchInput');
            const status = document.getElementById('batchStatus');
            if (!input) return;

            const lines = input.value.split('\n');
            let newPairs = [];
            status.innerText = '';
            let errorMsg = '';

            for (let rawLine of lines) {
                const line = rawLine.split(';')[0].trim();
                if (!line) continue;

                const parts = line.split('=');
                if (parts.length === 2) {
                    const srcPart = parts[0].trim();
                    const tgtPart = parts[1].trim();

                    const srcRef = srcPart ? parseColorRef(srcPart) : null;
                    const tgtRef = tgtPart ? parseColorRef(tgtPart) : null;

                    if (srcPart === '' && tgtPart === '') {
                        // Empty row case: "="
                        newPairs.push({ srcIdx: null, tgtIdx: null });
                    } else if (srcPart === '' && tgtRef) {
                        // Target only case: "=20"
                        newPairs.push({ srcIdx: null, tgtIdx: tgtRef.idx !== undefined ? tgtRef.idx : null });
                    } else if (srcRef && tgtPart === '') {
                        // Source only case: "10="
                        newPairs.push({ srcIdx: srcRef.idx !== undefined ? srcRef.idx : null, tgtIdx: null });
                    } else if (srcRef && tgtRef) {
                        // Standard case: "10=20"
                        newPairs.push({
                            srcIdx: srcRef.idx !== undefined ? srcRef.idx : null,
                            tgtIdx: tgtRef.idx !== undefined ? tgtRef.idx : null
                        });
                    } else {
                        errorMsg = `Could not parse line: ${line}`;
                    }
                }
            }

            if (newPairs.length > 0 || (lines.length <= 1 && errorMsg === '')) {
                state.replacePairs = newPairs;
                renderReplaceGrid();
                const dialog = document.getElementById('batchReplaceDialog');
                if (dialog) dialog.close();
            } else {
                status.innerText = errorMsg || "No valid pairs found.";
            }
        };
    }



    // Handlers for assigning colors to Source/Target cells from the canvas/palette


    if (elements.btnProcessReplace) {
        elements.btnProcessReplace.onclick = () => {
            const map = new Map();
            const conflicts = analyzeReplaceConflicts();

            state.replacePairs.forEach((p, i) => {
                if (!conflicts[i] && p.srcIdx !== null && p.srcIdx !== undefined &&
                    p.tgtIdx !== null && p.tgtIdx !== undefined) {
                    map.set(p.srcIdx, p.tgtIdx);
                }
            });

            if (map.size === 0) {
                alert('No valid replacement pairs defined.');
                return;
            }

            // Frame range logic
            let startFrame = parseInt(elements.replaceFrameStart.value) || 0;
            let endFrame = parseInt(elements.replaceFrameEnd.value) || 0;

            // If both are 0, it might mean "all frames" or just frame 0. 
            // Better logic: if end is 0 but state.frames.length > 1, maybe it wasn't set.
            // Process the specified frame range
            startFrame = Math.max(0, Math.min(startFrame, state.frames.length - 1));
            if (endFrame === 0 && startFrame === 0 && state.frames.length > 1) {
                // Default to current frame or all? 
                // Use the visible range for context-aware processing
            }
            endFrame = Math.max(startFrame, Math.min(endFrame, state.frames.length - 1));

            // Apply to frames in range
            for (let frameIdx = startFrame; frameIdx <= endFrame; frameIdx++) {
                const frame = state.frames[frameIdx];
                if (!frame) continue;

                // Recursively process all layers
                const processLayers = (layers) => {
                    layers.forEach(layer => {
                        if (layer.data) {
                            for (let i = 0; i < layer.data.length; i++) {
                                if (map.has(layer.data[i])) {
                                    layer.data[i] = map.get(layer.data[i]);
                                }
                            }
                        }
                        if (layer.children) {
                            processLayers(layer.children);
                        }
                    });
                };

                processLayers(frame.layers);
            }

            pushHistory('all');
            renderCanvas();
            renderFramesList();
            showEditorInterface();
        };
    }

    // Initialize Color Replace picker logic if needed
    // (Hook for integration with palette selection)

    // Undo/Redo
    elements.btnUndo.onclick = undo;
    elements.btnRedo.onclick = redo;

    // Layers controls
    if (elements.btnAddGroup) elements.btnAddGroup.onclick = addGroup;
    if (elements.btnAddLayer) elements.btnAddLayer.onclick = addLayer;
    if (elements.btnExternalShp) elements.btnExternalShp.onclick = addExternalShpLayer;
    if (elements.btnDelLayer) elements.btnDelLayer.onclick = (e) => deleteLayer(e.shiftKey);
    if (elements.btnDuplicateLayer) elements.btnDuplicateLayer.onclick = () => duplicateLayer();
    if (elements.btnLayerMerge) elements.btnLayerMerge.onclick = mergeLayerDown;
    if (elements.btnLayerUp) elements.btnLayerUp.onclick = moveLayerUp;
    if (elements.btnLayerDown) elements.btnLayerDown.onclick = moveLayerDown;
    if (elements.btnLayerProps) elements.btnLayerProps.onclick = () => openActiveLayerProperties();

    // Replace Colors (Old Dialog - Check if elements exist)
    if (elements.btnReplaceColor) elements.btnReplaceColor.onclick = () => elements.replaceColorDialog.showModal();
    if (elements.btnRepCancel) elements.btnRepCancel.onclick = () => elements.replaceColorDialog.close();
    if (elements.btnRepApply) elements.btnRepApply.onclick = applyColorReplace;

    // Selection Modes
    const setMode = (m) => { state.selectionMode = m; updateModeButtons(); };
    if (elements.btnSelNew) elements.btnSelNew.onclick = () => setMode('new');
    if (elements.btnSelAdd) elements.btnSelAdd.onclick = () => setMode('add');
    if (elements.btnSelSub) elements.btnSelSub.onclick = () => setMode('sub');
    if (elements.btnSelInt) elements.btnSelInt.onclick = () => setMode('int');
    if (elements.btnSelXor) elements.btnSelXor.onclick = () => setMode('xor');
    updateModeButtons(); // Initialize button states

    // Magic Wand Controls
    const wandToleranceInput = document.getElementById('wandTolerance');
    const wandToleranceVal = document.getElementById('wandToleranceVal');
    const wandToleranceBar = document.getElementById('wandToleranceBar');
    const btnWandTolMinus = document.getElementById('btnWandTolMinus');
    const btnWandTolPlus = document.getElementById('btnWandTolPlus');
    const cbWandContiguous = document.getElementById('cbWandContiguous');

    function updateToleranceDisplay(value) {
        state.toolSettings.tolerance = value;
        if (wandToleranceVal) wandToleranceVal.textContent = value + '%';
        if (wandToleranceBar) {
            const pct = value; // 0-100
            wandToleranceBar.style.width = pct + '%';
        }
        if (wandToleranceInput) wandToleranceInput.value = value;
    }

    if (wandToleranceInput) {
        wandToleranceInput.addEventListener('input', (e) => {
            updateToleranceDisplay(parseInt(e.target.value));
        });
    }

    if (btnWandTolMinus) {
        setupAutoRepeat(btnWandTolMinus, (ev) => {
            const step = (ev && ev.ctrlKey) ? 5 : 1;
            const newVal = Math.max(0, state.toolSettings.tolerance - step);
            updateToleranceDisplay(newVal);
        });
    }

    if (btnWandTolPlus) {
        setupAutoRepeat(btnWandTolPlus, (ev) => {
            const step = (ev && ev.ctrlKey) ? 5 : 1;
            const newVal = Math.min(100, state.toolSettings.tolerance + step);
            updateToleranceDisplay(newVal);
        });
    }

    if (cbWandContiguous) {
        cbWandContiguous.addEventListener('change', (e) => {
            state.toolSettings.contiguous = e.target.checked;
        });
    }

    // --- NEW: Brush Size Professional Control ---
    function updateBrushSizeDisplay(value) {
        state.toolSettings.brushSize = value;
        if (elements.brushSizeVal) elements.brushSizeVal.textContent = value + 'px';
        if (elements.brushSize) elements.brushSize.value = value;
        if (elements.brushSizeBar && elements.brushSize) {
            const min = parseInt(elements.brushSize.min) || 1;
            const max = parseInt(elements.brushSize.max) || 30;
            const pct = ((value - min) / (max - min)) * 100;
            elements.brushSizeBar.style.width = pct + '%';
        }
    }

    if (elements.brushSize) {
        elements.brushSize.addEventListener('input', (e) => {
            updateBrushSizeDisplay(parseInt(e.target.value));
        });
    }

    if (elements.btnBrushMinus) {
        setupAutoRepeat(elements.btnBrushMinus, (ev) => {
            const step = (ev && ev.ctrlKey) ? 5 : 1;
            const newVal = Math.max(1, state.toolSettings.brushSize - step);
            updateBrushSizeDisplay(newVal);
        });
    }

    if (elements.btnBrushPlus) {
        setupAutoRepeat(elements.btnBrushPlus, (ev) => {
            const step = (ev && ev.ctrlKey) ? 5 : 1;
            const newVal = Math.min(30, state.toolSettings.brushSize + step);
            updateBrushSizeDisplay(newVal);
        });
    }

    // Initial sync
    updateBrushSizeDisplay(state.toolSettings.brushSize);

    // --- NEW: Brush Shape Control ---
    function updateBrushShapeDisplay(shape) {
        state.toolSettings.brushShape = shape;
        if (elements.btnBrushShapeSquare) {
            elements.btnBrushShapeSquare.classList.toggle('active', shape === 'square');
        }
        if (elements.btnBrushShapeCircle) {
            elements.btnBrushShapeCircle.classList.toggle('active', shape === 'circle');
        }
        // Force cursor re-render if canvas is active
        if (typeof updateCanvasCursor === 'function') {
            updateCanvasCursor();
        }
    }

    if (elements.btnBrushShapeSquare) {
        elements.btnBrushShapeSquare.addEventListener('click', () => updateBrushShapeDisplay('square'));
    }
    if (elements.btnBrushShapeCircle) {
        elements.btnBrushShapeCircle.addEventListener('click', () => updateBrushShapeDisplay('circle'));
    }
    updateBrushShapeDisplay(state.toolSettings.brushShape);

    // --- NEW: Spray Density Control ---
    function updateSprayDensityDisplay(value) {
        state.toolSettings.sprayDensity = value;
        if (elements.sprayDensityVal) elements.sprayDensityVal.textContent = value + '%';
        if (elements.sprayDensity) elements.sprayDensity.value = value;
        if (elements.sprayDensityBar && elements.sprayDensity) {
            const min = parseInt(elements.sprayDensity.min) || 1;
            const max = parseInt(elements.sprayDensity.max) || 100;
            const pct = ((value - min) / (max - min)) * 100;
            elements.sprayDensityBar.style.width = pct + '%';
        }
    }

    if (elements.sprayDensity) {
        elements.sprayDensity.addEventListener('input', (e) => {
            updateSprayDensityDisplay(parseInt(e.target.value));
        });
    }

    if (elements.btnSprayDensityMinus) {
        setupAutoRepeat(elements.btnSprayDensityMinus, (ev) => {
            const step = (ev && ev.ctrlKey) ? 5 : 1;
            const newVal = Math.max(1, state.toolSettings.sprayDensity - step);
            updateSprayDensityDisplay(newVal);
        });
    }

    if (elements.btnSprayDensityPlus) {
        setupAutoRepeat(elements.btnSprayDensityPlus, (ev) => {
            const step = (ev && ev.ctrlKey) ? 5 : 1;
            const newVal = Math.min(100, state.toolSettings.sprayDensity + step);
            updateSprayDensityDisplay(newVal);
        });
    }

    // --- NEW: Fill Tolerance Control ---
    function updateFillToleranceDisplay(value) {
        state.toolSettings.fillTolerance = value;
        if (elements.fillToleranceVal) elements.fillToleranceVal.textContent = value + '%';
        if (elements.fillTolerance) elements.fillTolerance.value = value;
        if (elements.fillToleranceBar && elements.fillTolerance) {
            const min = parseInt(elements.fillTolerance.min) || 0;
            const max = parseInt(elements.fillTolerance.max) || 100;
            const pct = ((value - min) / (max - min)) * 100;
            elements.fillToleranceBar.style.width = pct + '%';
        }
    }

    if (elements.fillTolerance) {
        elements.fillTolerance.addEventListener('input', (e) => {
            updateFillToleranceDisplay(parseInt(e.target.value));
        });
    }

    if (elements.btnFillToleranceMinus) {
        setupAutoRepeat(elements.btnFillToleranceMinus, (ev) => {
            const step = (ev && ev.ctrlKey) ? 5 : 1;
            const newVal = Math.max(0, state.toolSettings.fillTolerance - step);
            updateFillToleranceDisplay(newVal);
        });
    }

    if (elements.btnFillTolerancePlus) {
        setupAutoRepeat(elements.btnFillTolerancePlus, (ev) => {
            const step = (ev && ev.ctrlKey) ? 5 : 1;
            const newVal = Math.min(100, state.toolSettings.fillTolerance + step);
            updateFillToleranceDisplay(newVal);
        });
    }

    if (elements.cbFillContiguous) {
        elements.cbFillContiguous.addEventListener('change', (e) => {
            state.toolSettings.fillContiguous = e.target.checked;
        });
    }

    // Initial sync for new tools
    updateSprayDensityDisplay(state.toolSettings.sprayDensity);
    updateFillToleranceDisplay(state.toolSettings.fillTolerance);

    // Canvas Interaction
    const scArea = elements.canvasScrollArea;
    let sprayInterval = null;

    const stopSpraying = () => {
        if (sprayInterval) {
            clearInterval(sprayInterval);
            sprayInterval = null;
        }
    };

    window.addEventListener('mousedown', (e) => {
        const workspace = elements.canvasScrollArea || elements.canvasArea;
        if (!workspace) return;

        // Broad detection: Is the click anywhere in the center panel area?
        if (!workspace.contains(e.target)) return;

        // Ignore UI components specifically
        if (e.target.closest('.toolbar-horizontal') || e.target.closest('.panel-header') || e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) {
            return;
        }

        // Avoid blocking scrollbar clicks
        if (e.target === elements.canvasScrollArea) {
            if (e.offsetX > e.target.clientWidth || e.offsetY > e.target.clientHeight) {
                return;
            }
        }

        const { x, y } = getPos(e);
        e.preventDefault(); // Prevent text selection/native dragging

        // --- NEW: Replace Picking from Canvas ---
        if (state.isPickingForReplace) {
            const idx = pickColor(x, y, e.ctrlKey);
            if (idx !== null && idx !== undefined) {
                handleReplacePickerInput(idx); 
                setIsDrawing(false);
                return;
            }
        }

        // 2. Move Selection Logic

        // Feature: Auto-select entire layer if calling Move without selection
        if (activeTool === 'movePixels' && !state.selection) {
            const frame = state.frames[state.currentFrameIdx];
            if (frame) {
                state.selection = {
                    type: 'rect',
                    x: 0, y: 0, w: frame.width, h: frame.height
                };
                // We don't need renderCanvas here necessarily as startMoving will handle preview
            }
        }

        // Handle scaling/rotation check
        if (activeTool === 'movePixels' && state.selection && !state.isMovingSelection) {
            const handleIdx = getSelectionHandleAt(x, y, state.selection, state.zoom);
            if (handleIdx !== null) {
                if (!state.floatingSelection) {
                    startMovingSelectionPixels();
                }
                if (state.floatingSelection) {
                    if (handleIdx === 8) {
                        state.isRotatingSelection = true;
                        const s = state.selection;
                        const cx = s.x + s.w / 2;
                        const cy = s.y + s.h / 2;
                        state.rotationStartAngle = Math.atan2(y - cy, x - cx);
                        state.rotationBaseAngle = 0; // Start fresh for this drag
                    } else {
                        state.isScalingSelection = true;
                        state.scaleHandleIdx = handleIdx;
                    }

                    state.dragStart = { x, y };
                    state.dragStartFloating = {
                        x: state.floatingSelection.x,
                        y: state.floatingSelection.y,
                        w: state.floatingSelection.w,
                        h: state.floatingSelection.h
                    };
                    setIsDrawing(true);
                    return;
                }
            }
        }

        if ((activeTool === 'movePixels' || activeTool === 'moveSelectionArea') && state.selection) {
            if (activeTool === 'movePixels' && !state.floatingSelection) {
                startMovingSelectionPixels();
            }

            if (activeTool === 'movePixels') {
                // Crash Fix: Ensure floatingSelection exists (it might fail if layer is hidden)
                if (state.floatingSelection) {
                    state.isMovingSelection = true;
                    state.dragStartFloating = { x: state.floatingSelection.x, y: state.floatingSelection.y };
                }
            } else {
                state.isMovingSelectionArea = true;
                state.dragStartFloating = { x: state.selection.x, y: state.selection.y };
            }

            state.dragStart = { x, y };
            setIsDrawing(true);
            setLastPos({ x, y });
            return;
        }

        setIsDrawing(true);
        setLastPos({ x, y });
        state.currentX = x;
        state.currentY = y;

        if (!activeTool) {
            return;
        }

        if (activeTool === 'select') {
            // Clear any previous selection (committing pixels if floating) before starting new selection
            if (state.floatingSelection) {
                clearSelection();
            }

            state.isSelecting = true;
            state.startSel = { x, y };
            // Track if Ctrl was held for temporary Add mode
            state.ctrlHeld = e.ctrlKey;
            // Don't clear state.selection here - let combineSelection handle it on mouseup
            // This way, the old selection stays visible until the new one is confirmed
            renderCanvas();
            renderOverlay(x, y, activeTool, { x, y });
            return;
        }
        if (activeTool === 'lasso') {
            // Clear any previous selection (committing pixels if floating) before starting new selection
            if (state.floatingSelection) {
                clearSelection();
            }

            state.isSelecting = true;
            state.startSel = [{ x, y }];
            // Track if Ctrl was held for temporary Add mode
            state.ctrlHeld = e.ctrlKey;
            // Don't clear selection if Ctrl is held (temporary Add mode)
            // or let combineSelection handle it in New mode
            renderCanvas();
            renderOverlay(x, y, activeTool, { x, y });
            return;
        }
        if (activeTool === 'wand') {
            // Clear any previous selection (committing pixels if floating) before starting new selection
            if (state.floatingSelection) {
                clearSelection();
            }

            // Track Ctrl for smart Add/Sub mode
            const wasCtrlHeld = e.ctrlKey;
            let tempMode = state.selectionMode;

            if (wasCtrlHeld) {
                // Smart behavior: Sub if clicking selected pixel, Add if clicking unselected
                const isPixelSelected = checkIfPixelSelected(x, y, state.selection);
                tempMode = isPixelSelected ? 'sub' : 'add';
            }

            // Ensure we use project coordinates for the snapshot lookup
            magicWand(Math.floor(x), Math.floor(y), tempMode);
            setIsDrawing(false);
            renderCanvas();
            renderOverlay();
            return;
        }
        if (activeTool === 'picker') {
            const idx = pickColor(x, y, e.ctrlKey);
            setIsDrawing(false);
            // Default Picker behavior (Primary Color)
            // Note: Replace picking is handled at the top of onmousedown
            return;
        }

        // Don't push history here for continuous drawing tools (pencil, eraser, spray)
        // They will push history on mouseup to ensure each stroke is saved individually
        if (activeTool === 'spray') {
            sprayInterval = setInterval(() => {
                if (isDrawing && activeTool === 'spray') {
                    handleTool(lastPos.x, lastPos.y);
                }
            }, 255);
        }
        handleTool(x, y, true);
    });

    window.addEventListener('mousemove', (e) => {
        // If actively drawing/moving, block native browser interactions (like drag-drop attempts)
        const isInteracting = isDrawing || state.isScalingSelection || state.isRotatingSelection || state.isMovingSelection || state.isMovingSelectionArea;

        if (isInteracting) {
            e.preventDefault();
        } else {
            // Optimization: Skip if mouse is NOT over the workspace area
            const scArea = elements.canvasScrollArea;
            const cvArea = elements.canvasArea;
            const isOverWorkspace = (scArea && (e.target === scArea || scArea.contains(e.target))) ||
                (cvArea && (e.target === cvArea || cvArea.contains(e.target)));
            if (!isOverWorkspace) return;

            // CRITICAL FIX: Skip canvas-specific tooltip reset if hovering over any UI elements
            // This prevents the canvas picker logic from hiding our custom tooltips in the toolbar.
            if (e.target.closest('.toolbar-horizontal, .panel-header, button, select, input, .properties-panel, .ui-tooltip, #topBar')) {
                return;
            }
        }

        const { x, y } = getPos(e);

        if (elements.coordsDisplay) {
            elements.coordsDisplay.innerText = `${x}, ${y}`;
        }
        state.currentX = x;
        state.currentY = y;

        if (state.isScalingSelection || state.isRotatingSelection) {
            updateCanvasCursor(false, handleToCursor(state.isRotatingSelection ? 8 : state.scaleHandleIdx));
        }

        // Rotate Selection Drag
        if (state.isRotatingSelection && state.floatingSelection) {
            const fs = state.floatingSelection;
            const cx = state.dragStartFloating.x + state.dragStartFloating.w / 2;
            const cy = state.dragStartFloating.y + state.dragStartFloating.h / 2;

            const currentAngle = Math.atan2(y - cy, x - cx);
            const deltaAngle = currentAngle - state.rotationStartAngle;
            state.rotationBaseAngle = deltaAngle;

            // Rotate from original data (High quality, no cumulative degradation)
            const r = rotateBufferArbitrary(fs.originalData, fs.originalW, fs.originalH, deltaAngle, Uint16Array);

            fs.data = r.data;
            fs.w = r.w;
            fs.h = r.h;
            // Center the new rotated dimensions on the same pivot
            fs.x = Math.round(cx - r.w / 2);
            fs.y = Math.round(cy - r.h / 2);

            if (fs.originalMaskData) {
                fs.maskData = rotateBufferArbitrary(fs.originalMaskData, fs.originalW, fs.originalH, deltaAngle, Uint8Array).data;
            } else {
                fs.originalMaskData = new Uint8Array(fs.originalW * fs.originalH).fill(1);
                fs.maskData = rotateBufferArbitrary(fs.originalMaskData, fs.originalW, fs.originalH, deltaAngle, Uint8Array).data;
            }

            // Sync main selection bounds
            state.selection.x = fs.x;
            state.selection.y = fs.y;
            state.selection.w = fs.w;
            state.selection.h = fs.h;
            state.selection.type = 'mask';
            if (fs.maskData) state.selection.maskData = new Uint8Array(fs.maskData);

            renderCanvas();
            renderOverlay();
            try { renderFramesList(); } catch (e) { }
            return;
        }

        // Move Selection Drag (Pixels)
        if (state.isMovingSelection && state.floatingSelection) {
            const dx = x - state.dragStart.x;
            const dy = y - state.dragStart.y;

            state.floatingSelection.x = state.dragStartFloating.x + dx;
            state.floatingSelection.y = state.dragStartFloating.y + dy;

            // Sync selection bounds
            state.selection.x = state.floatingSelection.x;
            state.selection.y = state.floatingSelection.y;

            renderCanvas();
            renderOverlay();
            try { renderFramesList(); } catch (e) { }
            return;
        }

        // Scale Selection Drag
        if (state.isScalingSelection && state.floatingSelection) {
            const dx = x - state.dragStart.x;
            const dy = y - state.dragStart.y;
            const fs = state.floatingSelection;
            const start = state.dragStartFloating;

            let x1 = start.x, y1 = start.y, x2 = start.x + start.w, y2 = start.y + start.h;

            const idx = state.scaleHandleIdx;
            // TL, TM, TR
            if (idx === 0 || idx === 1 || idx === 2) y1 = start.y + dy;
            // BL, BM, BR
            if (idx === 5 || idx === 6 || idx === 7) y2 = start.y + start.h + dy;
            // TL, ML, BL
            if (idx === 0 || idx === 3 || idx === 5) x1 = start.x + dx;
            // TR, MR, BR
            if (idx === 2 || idx === 4 || idx === 7) x2 = start.x + start.w + dx;

            // Round edges to snap precisely to game pixels
            let fx1 = Math.round(x1);
            let fy1 = Math.round(y1);
            let fx2 = Math.round(x2);
            let fy2 = Math.round(y2);

            if (e.shiftKey) {
                const origRatio = start.w / start.h;
                let newW = fx2 - fx1;
                let newH = fy2 - fy1;

                if (idx === 1 || idx === 6) {
                    // Top or Bottom (changes H) -> force W, centered
                    newW = newH * origRatio;
                    const cx = start.x + start.w / 2;
                    fx1 = cx - newW / 2;
                    fx2 = cx + newW / 2;
                } else if (idx === 3 || idx === 4) {
                    // Left or Right (changes W) -> force H, centered
                    newH = newW / origRatio;
                    const cy = start.y + start.h / 2;
                    fy1 = cy - newH / 2;
                    fy2 = cy + newH / 2;
                } else {
                    // Corners
                    if (Math.abs(newW) > Math.abs(newH * origRatio)) {
                        newH = Math.sign(newH) * Math.abs(newW / origRatio);
                    } else {
                        newW = Math.sign(newW) * Math.abs(newH * origRatio);
                    }
                    if (idx === 0) { // TL
                        fx1 = fx2 - newW; fy1 = fy2 - newH;
                    } else if (idx === 2) { // TR
                        fx2 = fx1 + newW; fy1 = fy2 - newH;
                    } else if (idx === 5) { // BL
                        fx1 = fx2 - newW; fy2 = fy1 + newH;
                    } else if (idx === 7) { // BR
                        fx2 = fx1 + newW; fy2 = fy1 + newH;
                    }
                }

                fx1 = Math.round(fx1);
                fx2 = Math.round(fx2);
                fy1 = Math.round(fy1);
                fy2 = Math.round(fy2);
            }

            // Allow scaling beyond canvas bounds: simply don't restrict fx1/fy1 or fx2/fy2
            // Constraint: minimum 1x1 width/height based on drag direction
            if (fx2 <= fx1) {
                if (idx === 0 || idx === 3 || idx === 5) fx1 = fx2 - 1;
                else fx2 = fx1 + 1;
            }
            if (fy2 <= fy1) {
                if (idx === 0 || idx === 1 || idx === 2) fy1 = fy2 - 1;
                else fy2 = fy1 + 1;
            }

            const newW = fx2 - fx1;
            const newH = fy2 - fy1;
            const newX = fx1;
            const newY = fy1;

            if (newW !== fs.w || newH !== fs.h || newX !== fs.x || newY !== fs.y) {
                fs.w = Math.round(newW);
                fs.h = Math.round(newH);
                fs.x = Math.round(newX);
                fs.y = Math.round(newY);

                // Sync selection bounds
                state.selection.x = fs.x;
                state.selection.y = fs.y;
                state.selection.w = fs.w;
                state.selection.h = fs.h;

                const protect = elements.chkScaleProtectRemap?.checked;
                const alg = document.querySelector('input[name="moveResampleAlg"]:checked')?.value || 'smart';

                if (fs.originalMaskData) {
                    fs.maskData = resampleLayerData(fs.originalMaskData, fs.originalW, fs.originalH, fs.w, fs.h, 'nearest', false, protect);
                    state.selection.maskData = fs.maskData;
                }
                fs.data = resampleLayerData(fs.originalData, fs.originalW, fs.originalH, fs.w, fs.h, alg, false, protect);

                renderCanvas();
                renderOverlay();
                try { renderFramesList(); } catch (e) { }
            }
            return;
        }

        // Move Selection Drag (Area Only)
        if (state.isMovingSelectionArea && state.selection) {
            const dx = x - state.dragStart.x;
            const dy = y - state.dragStart.y;

            state.selection.x = state.dragStartFloating.x + dx;
            state.selection.y = state.dragStartFloating.y + dy;

            renderCanvas();
            renderOverlay();
            try { renderFramesList(); } catch (e) { }
            return;
        }

        // Cursor Logic for Selection Hover (Select or Move Tools)
        if (state.selection && !isDrawing) {
            const s = state.selection;

            // Handle hover cursor
            if (activeTool === 'movePixels') {
                const handleIdx = getSelectionHandleAt(x, y, s, state.zoom);
                if (handleIdx !== null) {
                    updateCanvasCursor(false, handleToCursor(handleIdx));
                    return;
                }
            }

            // Check bounding box
            if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) {
                let isHit = true;
                if (s.type === 'mask') {
                    const mx = x - s.x;
                    const my = y - s.y;
                    if (!s.maskData[my * s.w + mx]) isHit = false;
                }

                if (isHit) {
                    updateCanvasCursor(true);
                    // Hide move cursor when hovering over current selection to avoid visual clutter
                    // If we are over a selection, always show move or default, never crosshair.
                    if (['select', 'lasso', 'wand', 'movePixels', 'moveSelectionArea'].includes(activeTool)) {
                        // Render and return to avoid being overwritten by crosshair later
                        renderOverlay(x, y, activeTool, null);
                        return;
                    }
                }
            }
        }

        // Reset cursor if not hit or tool not move-capable
        updateCanvasCursor(false);

        // Picker Tool Feedback: Show tooltip and highlight palette cell
        if (activeTool === 'picker' && !isDrawing) {
            const frame = state.frames[state.currentFrameIdx];
            if (frame) {
                let foundIdx = null;
                const activeLayer = getActiveLayer();

                if (activeLayer && activeLayer.visible && x >= 0 && x < activeLayer.width && y >= 0 && y < activeLayer.height) {
                    const idx = activeLayer.data[y * activeLayer.width + x];
                    if (idx !== TRANSPARENT_COLOR) {
                        foundIdx = idx;
                    }
                }

                const tooltip = document.getElementById('uiTooltip');
                if (foundIdx !== null) {
                    const color = state.palette[foundIdx];
                    if (tooltip && color) {
                        let label = `Index: ${foundIdx}`;
                        if (state.isAlphaImageMode) {
                            if (foundIdx === 127) label += " (Transparency/Neutral)";
                            else if (foundIdx === 0) label += " (Black/Solid)";
                        } else {
                            if (foundIdx === 0) label += " (Transparency)";
                        }
                        tooltip.innerHTML = `${label}<br>RGB: ${color.r},${color.g},${color.b}`;

                        // Ensure it's in the correct container for visibility (Standard re-parenting for Top Layer)
                        const activeDialog = e.target.closest('dialog');
                        const targetParent = activeDialog || document.body;
                        if (tooltip.parentElement !== targetParent) {
                            targetParent.appendChild(tooltip);
                        }

                        tooltip.classList.add('active');
                        tooltip.style.display = 'block';
                        tooltip.style.left = (e.clientX + 15) + 'px';
                        tooltip.style.top = (e.clientY + 15) + 'px';

                        document.querySelectorAll('.pal-cell').forEach(cell => {
                            cell.classList.toggle('picker-highlight', parseInt(cell.dataset.idx) === foundIdx);
                        });
                    } else if (tooltip) {
                        tooltip.classList.remove('active');
                        tooltip.style.display = 'none';
                    }
                } else {
                    if (tooltip) {
                        tooltip.classList.remove('active');
                        tooltip.style.display = 'none';
                    }
                    document.querySelectorAll('.pal-cell').forEach(cell => cell.classList.remove('picker-highlight'));
                }
            }
        } else {
            const tooltip = document.getElementById('uiTooltip');
            if (tooltip) {
                tooltip.classList.remove('active');
                tooltip.style.display = 'none';
            }
            document.querySelectorAll('.pal-cell').forEach(cell => cell.classList.remove('picker-highlight'));
        }

        if (!isDrawing) {
            // Only render overlay for cursor/tool preview when not drawing
            renderOverlay(x, y, activeTool, null);
            return;
        }

        if (state.isSelecting) {
            if (activeTool === 'select') {
                // Update Rect dimensions
                // We don't change state.selection (final) yet, just visuals (rendered in overlay via startSel+currentPos)
                // renderOverlay utilizes state.startSel and the current cursor position
                // So we just need to call renderOverlay.
            } else if (activeTool === 'lasso') {
                const last = state.startSel[state.startSel.length - 1];
                if (!last || last.x !== x || last.y !== y) {
                    state.startSel.push({ x, y });
                }
            }
            renderOverlay(x, y, activeTool, state.startSel);
            return;
        }

        if (activeTool === 'line') {
            renderOverlay(x, y, activeTool, lastPos);
            return;
        }

        if (activeTool === 'rect') {
            renderOverlay(x, y, activeTool, lastPos);
            return;
        }

        // Default: Just render cursor
        renderOverlay(x, y, activeTool, null);

        if (activeTool === 'pencil' || activeTool === 'eraser' || activeTool === 'spray') {
            const points = bresenham(lastPos.x, lastPos.y, x, y);
            points.forEach(p => handleTool(p.x, p.y, false, false));
            renderCanvas();
            setLastPos({ x, y });
        }
    });

    const workspace = elements.canvasScrollArea || elements.canvasArea;
    if (workspace) {
        workspace.addEventListener('mousedown', (e) => {
            if (e.target !== elements.mainCanvas && e.target !== elements.overlayCanvas && e.target !== workspace && e.target !== elements.canvasWrapper && e.target !== elements.pixelGridOverlay && e.target.id !== 'canvasResizePreview' && e.target.tagName !== 'CANVAS' && e.target !== elements.canvasArea) {
                return; // Clicking on dialogs or scrollbars
            }
            document.querySelectorAll('.pal-cell').forEach(cell => cell.classList.remove('picker-highlight'));
        });
        workspace.addEventListener('mouseleave', () => {
            const tooltip = document.getElementById('uiTooltip');
            if (tooltip) {
                tooltip.classList.remove('active');
                tooltip.style.display = 'none';
            }
            document.querySelectorAll('.pal-cell').forEach(cell => cell.classList.remove('picker-highlight'));
        });
    }

    window.onmouseup = (e) => {
        stopSpraying();

        // Handle Moving Selection (Pixels or Area), Scaling or Rotating
        if (state.isMovingSelection || state.isMovingSelectionArea || state.isScalingSelection || state.isRotatingSelection) {
            let hasChanged = false;

            // Check if actual movement/scaling/rotating occurred
            if (state.isScalingSelection || state.isRotatingSelection) {
                hasChanged = true;
            } else if ((state.isMovingSelection || state.isMovingSelectionArea) && state.dragStartFloating && state.selection) {
                if (state.selection.x !== state.dragStartFloating.x || state.selection.y !== state.dragStartFloating.y) {
                    hasChanged = true;
                }
            }

            if (state.isRotatingSelection && state.floatingSelection) {
                // Commit the rotation to originalData so future scales/rotates build on this
                const fs = state.floatingSelection;
                fs.originalData = new Uint16Array(fs.data);
                fs.originalW = fs.w;
                fs.originalH = fs.h;
                if (fs.maskData) {
                    fs.originalMaskData = new Uint8Array(fs.maskData);
                }
            } else if (state.isScalingSelection && state.floatingSelection) {
                // Commit scale to originalData
                const fs = state.floatingSelection;
                fs.originalData = new Uint16Array(fs.data);
                fs.originalW = fs.w;
                fs.originalH = fs.h;
                if (fs.maskData) {
                    fs.originalMaskData = new Uint8Array(fs.maskData);
                }
            }

            state.isMovingSelection = false;
            state.isMovingSelectionArea = false;
            state.isScalingSelection = false;
            state.isRotatingSelection = false;
            state.scaleHandleIdx = null;
            state.rotationStartAngle = 0;
            state.rotationBaseAngle = 0;
            state.dragStart = null;
            state.dragStartFloating = null;
            setIsDrawing(false);
            if (hasChanged) {
                pushHistory(); // Capture the new position, scale, or rotation
            }
            updateLayersList();
            renderFramesList();
            return;
        }

        if (!isDrawing) return;

        // Handle Finishing Selection (Rectangle or Lasso)
        if (state.isSelecting) {
            state.isSelecting = false;
            const { x, y } = getPos(e);

            if (activeTool === 'select') {
                const sx = state.startSel.x;
                const sy = state.startSel.y;
                const w = x - sx;
                const h = y - sy;
                const wasCtrlHeld = state.ctrlHeld;
                state.ctrlHeld = false; // Reset

                // Check for Click-Only (no drag)
                if (w === 0 && h === 0) {
                    if (wasCtrlHeld) {
                        togglePixelSelection(x, y);
                        if (state.selection) startAnts();
                        renderCanvas();
                        return;
                    }
                    // For regular click without drag, fall through to create 1x1 selection
                    // or clear if needed? Standard behavior: Click clears selection.
                    if (state.selectionMode === 'new') {
                        clearSelection();
                        return;
                    }
                }

                // Create Rect Selection
                const newSel = {
                    type: 'rect',
                    x: w >= 0 ? sx : sx + w,
                    y: h >= 0 ? sy : sy + h,
                    w: Math.abs(w) + 1,
                    h: Math.abs(h) + 1
                };

                const effectiveMode = wasCtrlHeld ? 'add' : state.selectionMode;

                if (effectiveMode === 'new' || !state.selection) {
                    state.selection = newSel;
                } else {
                    state.selection = combineSelection(state.selection, newSel, effectiveMode);
                }

                startAnts();
                renderCanvas();
                renderOverlay();
                pushHistory([]); // Record selection change

            } else if (activeTool === 'lasso') {
                const wasCtrlHeld = state.ctrlHeld;
                state.ctrlHeld = false;

                if (state.startSel.length < 3) {
                    if (wasCtrlHeld && state.startSel.length === 1) {
                        const { x, y } = state.startSel[0];
                        togglePixelSelection(x, y);
                        if (state.selection) startAnts();
                        renderCanvas();
                        return;
                    }

                    const points = state.startSel;
                    const w = state.canvasW;
                    const h = state.canvasH;
                    const pixels = new Set();
                    for (let i = 0; i < points.length; i++) {
                        const p1 = points[i];
                        const p2 = points[(i + 1) % points.length];
                        const line = bresenham(p1.x, p1.y, p2.x, p2.y);
                        line.forEach(p => pixels.add(p.y * w + p.x));
                    }

                    if (pixels.size === 0) {
                        state.selection = null;
                        stopAnts();
                        renderCanvas();
                        renderOverlay();
                        return;
                    }

                    let minX = w, maxX = -1, minY = h, maxY = -1;
                    pixels.forEach(idx => {
                        const x = idx % w;
                        const y = Math.floor(idx / w);
                        if (x < minX) minX = x; if (x > maxX) maxX = x;
                        if (y < minY) minY = y; if (y > maxY) maxY = y;
                    });

                    const rw = maxX - minX + 1;
                    const rh = maxY - minY + 1;
                    const maskData = new Uint8Array(rw * rh);
                    pixels.forEach(idx => {
                        const x = idx % w;
                        const y = Math.floor(idx / w);
                        maskData[(y - minY) * rw + (x - minX)] = 1;
                    });

                    const newSel = { type: 'mask', x: minX, y: minY, w: rw, h: rh, maskData };
                    const effectiveMode = wasCtrlHeld ? 'add' : state.selectionMode;

                    if (effectiveMode === 'new' || !state.selection) {
                        state.selection = newSel;
                    } else {
                        state.selection = combineSelection(state.selection, newSel, effectiveMode);
                    }

                    startAnts();
                    renderCanvas();
                    renderOverlay();
                    state.startSel = null;
                    pushHistory([]); // Record selection change
                    return;
                }

                const originalMode = state.selectionMode;
                if (wasCtrlHeld) state.selectionMode = 'add';
                finishLassoSelection();
                if (wasCtrlHeld) state.selectionMode = originalMode;

                if (state.selection) startAnts();
                renderCanvas();
                renderOverlay();
                pushHistory([]); // Record selection change
            }
            state.startSel = null;
            setIsDrawing(false);
            return;
        }

        const { x, y } = getPos(e);

        if (activeTool === 'line') {
            const points = bresenham(lastPos.x, lastPos.y, x, y);
            const size = state.toolSettings.brushSize;

            const layer = getActiveLayer();
            if (layer && (layer.type === 'layer' || !layer.type)) { // Ensure it's a layer, not group
                let colorIdx = state.primaryColorIdx;
                const isShadowFrame = state.useShadows && (state.currentFrameIdx >= state.frames.length / 2);
                if (isShadowFrame && colorIdx > 1) colorIdx = 1;

                points.forEach(p => {
                    fillCircle(layer, p.x, p.y, size, colorIdx);
                });
                state.frames[state.currentFrameIdx]._v = (state.frames[state.currentFrameIdx]._v || 0) + 1;
                renderCanvas();
                pushHistory();
            }
        }

        if (activeTool === 'rect') {
            const layer = getActiveLayer();
            if (layer && (layer.type === 'layer' || !layer.type)) {
                let colorIdx = state.primaryColorIdx;
                const isShadowFrame = state.useShadows && (state.currentFrameIdx >= state.frames.length / 2);
                if (isShadowFrame && colorIdx > 1) colorIdx = 1;

                fillRectangle(layer, lastPos.x, lastPos.y, x, y, colorIdx, state.toolSettings.squareFill, state.toolSettings.squareFillColor, state.toolSettings.brushSize);
                state.frames[state.currentFrameIdx]._v = (state.frames[state.currentFrameIdx]._v || 0) + 1;
                renderCanvas();
                pushHistory();
            }
        }

        // Push history for continuous drawing tools and fill after stroke is complete
        if (activeTool === 'pencil' || activeTool === 'eraser' || activeTool === 'spray' || activeTool === 'fill') {
            if (isDrawing) {
                pushHistory();
            }
        }

        // Update sidebar thumbnails if something was drawn
        // Use a local flag or check before resetting state
        // Update sidebar thumbnails if something was drawn
        if (isDrawing) {
            try { updateLayersList(); } catch (e) { console.error("Layers update failed", e); }
            try { renderFramesList(); } catch (e) { console.error("Frames list update failed", e); }
        }
        setIsDrawing(false);
        updateUIState();
    };

    // Frames controls
    elements.btnAddFrame.onclick = () => addFrame(state.canvasW, state.canvasH);
    elements.btnDelFrame.onclick = async (e) => {
        if (state.frames.length > 1) {
            if (!e.shiftKey) {
                const confirmed = await showConfirm(`ARE YOU SURE YOU WANT TO DELETE FRAME ${state.currentFrameIdx}?`);
                if (!confirmed) return;
            }
            state.frames.splice(state.currentFrameIdx, 1);
            if (state.currentFrameIdx >= state.frames.length) state.currentFrameIdx = state.frames.length - 1;
            pushHistory('reorder'); // frame deleted, no pixel data changed
            renderFramesList();
            updateLayersList();
            renderCanvas();
        }
    };

    // Play button removed

    // Clear overlay on mouse out
    if (elements.canvasArea) {
        elements.canvasArea.addEventListener('mouseout', () => {
            stopSpraying();
            renderOverlay(undefined, undefined, null, null);
        });
    }

    window.addEventListener('blur', stopSpraying);

    // --- SIDE PANEL EXTRA TOGGLE ---
    // --- GLOBAL TOOLTIP SYSTEM ---
    // `#pixelTooltip` logic was here, removed to unify with `ui.js` system.

    // --- SIDE PANEL EXTRA TOGGLE ---
    if (elements.btnToggleSidePanel) {
        elements.btnToggleSidePanel.onclick = () => {
            state.showSidePanel = !state.showSidePanel;
            if (elements.sidePanelExtra) {
                elements.sidePanelExtra.classList.toggle('collapsed', !state.showSidePanel);
            }
            if (elements.btnToggleSidePanel) {
                elements.btnToggleSidePanel.classList.toggle('active', state.showSidePanel);
            }

            // Reset tool state when panel is opened to prevent drawing while configured
            if (state.showSidePanel) {
                setTool(null);
            }
        };
    }

    // --- ZOOM CONTROLS ---
    // Selection Tools actions
    if (elements.btnToolCrop) elements.btnToolCrop.onclick = () => cropToSelection();
    if (elements.btnToolDeselect) elements.btnToolDeselect.onclick = () => deselect();

    if (elements.btnZoomMinus) {
        setupAutoRepeat(elements.btnZoomMinus, (ev) => {
            let val = parseInt(elements.inpZoom.value);
            if (ev && ev.ctrlKey) {
                val = val - 5;
            } else {
                if (val <= 100) val = 50;
                else val = Math.ceil(val / 100) * 100 - 100;
            }
            const min = parseInt(elements.inpZoom.min || 50);
            elements.inpZoom.value = Math.max(min, val);
            elements.inpZoom.dispatchEvent(new Event('input'));
        });
    }

    if (elements.btnZoomPlus) {
        setupAutoRepeat(elements.btnZoomPlus, (ev) => {
            let val = parseInt(elements.inpZoom.value);
            if (ev && ev.ctrlKey) {
                val = val + 5;
            } else {
                if (val < 100) val = 100;
                else val = Math.floor(val / 100) * 100 + 100;
            }
            const max = parseInt(elements.inpZoom.max || 5000);
            elements.inpZoom.value = Math.min(max, val);
            elements.inpZoom.dispatchEvent(new Event('input'));
        });
    }

    if (elements.btnToggleGrid) {
        elements.btnToggleGrid.onclick = () => {
            state.showGrid = !state.showGrid;
            elements.btnToggleGrid.classList.toggle('active', state.showGrid);
            updatePixelGrid();
        };
        // Initial sync
        elements.btnToggleGrid.classList.toggle('active', state.showGrid);
    }

    // Toggle Background
    const btnToggleBg = document.getElementById('btnToggleBg');
    if (btnToggleBg) {
        btnToggleBg.onclick = () => {
            state.showBackground = !state.showBackground;
            btnToggleBg.classList.toggle('active', state.showBackground);
            renderCanvas();
        };
        // Initial sync
        btnToggleBg.classList.toggle('active', state.showBackground);
    }

    // Isometric Grid
    const selIsoGrid = document.getElementById('selIsoGrid');
    if (selIsoGrid) {
        selIsoGrid.addEventListener('change', (e) => {
            state.isoGrid = e.target.value;
            // Sync preview window dropdown if it exists
            const prevSelGrid = document.getElementById('prevSelIsoGrid');
            if (prevSelGrid) prevSelGrid.value = state.isoGrid;

            renderCanvas();
            if (typeof window.renderPreview === 'function') window.renderPreview();
        });
    }

    // Shadows Toggle
    const cbShadows = document.getElementById('cbUseShadows');
    if (cbShadows) {
        cbShadows.onchange = (e) => {
            state.useShadows = e.target.checked;

            // If shadow mode enabled, restrict primary color to index 1 as default
            if (state.useShadows && state.primaryColorIdx > 1) {
                state.primaryColorIdx = 1;
                state.paletteSelection.clear();
                state.paletteSelection.add(1);
            }

            renderPalette();
            renderCanvas();
            renderFrameManager(); // Update visual cues
            if (typeof updateMenuState === 'function') updateMenuState(state.frames.length > 0);
        };
    }

    // Shadow Overlay Toggle
    const cbShowShadowOverlay = document.getElementById('cbShowShadowOverlay');
    if (cbShowShadowOverlay) {
        cbShowShadowOverlay.onchange = (e) => {
            state.showShadowOverlay = e.target.checked;
            renderCanvas();
        };
    }
}

function parseColorRef(str) {
    if (!str) return null;
    str = str.trim();
    // Index? Ensure it's ONLY a number
    if (/^\d+$/.test(str)) {
        const idx = parseInt(str);
        if (idx >= 0 && idx <= 255) {
            const c = state.palette[idx];
            if (c) return { r: c.r, g: c.g, b: c.b, idx: idx };
            // Even if color is null in palette, we might allow the index? 
            // Better to return the index.
            return { r: 0, g: 0, b: 0, idx: idx };
        }
    }
    return null;
}

function handleConfirmExternalShp({ layerId, shpData, frameIdx, palette }) {
    if (!layerId || !shpData) return;

    const frame = state.frames[state.currentFrameIdx];
    if (!frame) return;

    const findNode = (layers, id) => {
        for (const node of layers) {
            if (node.id === id) return node;
            const children = node.layers || node.children;
            if (children) {
                const found = findNode(children, id);
                if (found) return found;
            }
        }
        return null;
    };

    const layer = findNode(frame.layers, layerId);
    if (!layer) return;

    const f = shpData.frames[frameIdx];

    // Update layer properties
    layer.name = `Ext: ${shpData.filename} [#${frameIdx}]`;
    layer.extFilename = shpData.filename;
    layer.extFrameIdx = frameIdx;
    layer.extTotalFrames = shpData.frames.length;
    layer.extShpFrameData = new Uint8Array(f.originalIndices); // Copy it
    layer.extShpPalette = palette.map(c => c ? { ...c } : null);
    layer.extWidth = f.width;
    layer.extHeight = f.height;
    layer.extFrameX = f.x;
    layer.extFrameY = f.y;
    layer.extShpWidth = shpData.width;
    layer.extShpHeight = shpData.height;
    layer.extAllFrames = shpData.frames; // Keep all frames for property dialog navigation

    pushHistory();
    updateLayersList();
    renderCanvas();
    renderFramesList();
}

function handleConfirmImport(impShpData, impShpPalette) {
    if (!impShpData) return;

    // 1. Sync Palette
    state.palette = impShpPalette.map(c => c ? { ...c, locked: false } : null);
    renderPalette();

    // 2. Use Native Loader for Index Integrity (Loads all frames)
    loadShpData(impShpData);

    // 3. Update UI
    pushHistory("all");

    // 4. Save to Recent Files (if FSAPI handle available)
    if (window._lastShpFileHandle && impShpData.filename) {
        saveRecentFile(impShpData.filename, window._lastShpFileHandle);
    }

    // Update UI element visibility
    updateUIState();
}

let tempNewShpPalette = null;

export function openNewShpDialog() {
    const dialog = document.getElementById('newShpDialog');
    if (!dialog) return;

    const palPreview = document.getElementById('newShpPalPreview');
    const palInfo = document.getElementById('newShpPalInfo');
    const btnCreate = document.getElementById('btnNewShpCreate');

    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');

    // Reset inputs
    const startW = state.canvasW || 60;
    const startH = state.canvasH || 48;
    if (document.getElementById('inpNewShpW')) document.getElementById('inpNewShpW').value = startW;
    if (document.getElementById('inpNewShpH')) document.getElementById('inpNewShpH').value = startH;
    if (document.getElementById('inpNewShpF')) document.getElementById('inpNewShpF').value = 1;
    if (document.getElementById('selNewShpComp')) document.getElementById('selNewShpComp').value = "3";
    if (document.getElementById('cbNewShpSolid')) document.getElementById('cbNewShpSolid').checked = true;

    // Reset Palette or Inherit from Current Project
    const hasValidPalette = state.palette &&
        state.palette.length === 256 &&
        state.palette.some(c => c !== null);

    if (hasValidPalette) {
        // Clone safely: Handle nulls to avoid { ...null } which results in {}
        tempNewShpPalette = state.palette.map(c => c ? { ...c } : null);
        renderPaletteSimple(tempNewShpPalette, palPreview);
        if (palInfo) palInfo.innerText = "Current Project Palette";

        // Enable Create Button
        if (btnCreate) {
            btnCreate.disabled = false;
            btnCreate.removeAttribute('disabled');
            btnCreate.style.opacity = '1';
            btnCreate.style.cursor = 'pointer';
            btnCreate.style.pointerEvents = 'auto';
        }
    } else {
        tempNewShpPalette = null;
        renderPaletteSimple([], palPreview); // Clear preview
        if (palInfo) palInfo.innerText = "No palette loaded";

        // Disable Create Button - EXPLICITLY
        if (btnCreate) {
            btnCreate.disabled = true;
            btnCreate.setAttribute('disabled', 'true'); // Double force
            btnCreate.style.opacity = '0.5';
            btnCreate.style.cursor = 'not-allowed';
            btnCreate.style.pointerEvents = 'none'; // Prevent any clicks
        }
    }
}

function initNewShpDialog() {
    const dialog = document.getElementById('newShpDialog');
    const btnCancel = document.getElementById('btnNewShpCancel');
    const btnCreate = document.getElementById('btnNewShpCreate');
    const btnLoadPal = document.getElementById('btnNewShpLoadPal');
    const fileInPal = document.getElementById('fileNewShpPal');
    const palPreview = document.getElementById('newShpPalPreview');
    const palInfo = document.getElementById('newShpPalInfo');

    if (!dialog) return;

    // Helper for Steppers
    const stepInput = (id, delta) => {
        const inp = document.getElementById(id);
        if (!inp) return;
        let val = parseInt(inp.value) || 0;
        val = Math.max(1, val + delta);
        inp.value = val;
    };

    // Open Dialog Logic (attached to btnNew if it exists)
    if (elements.btnNew) {
        elements.btnNew.onclick = openNewShpDialog;
    }

    if (btnCancel) {
        btnCancel.onclick = () => dialog.close();
    }

    if (btnCreate) {
        btnCreate.onclick = async () => {
            const w = parseInt(document.getElementById('inpNewShpW').value) || 60;
            const h = parseInt(document.getElementById('inpNewShpH').value) || 48;

            if (w > 5000 || h > 5000) {
                alert("ERROR: Maximum allowed dimensions are 5000x5000px to prevent application crashes.");
                return;
            }

            const f = parseInt(document.getElementById('inpNewShpF').value) || 1;
            const compEl = document.getElementById('selNewShpComp');
            const comp = compEl ? parseInt(compEl.value) : 3;

            // Shadows always start disabled for new projects (toggled via toolbar later)
            const useShadows = false;

            // Solid Start?
            const solidStart = document.getElementById('cbNewShpSolid') ? document.getElementById('cbNewShpSolid').checked : true;

            let confirmed = true;
            if (state.frames.length > 0) {
                confirmed = await showConfirm("CREATE NEW SHP?", "Are you sure? This will clear all current work.");
            }

            if (confirmed) {
                const finalPal = window.tempNewShpPalette || tempNewShpPalette;
                createNewProject(w, h, f, useShadows, finalPal, comp, solidStart);

                // Sync toolbar checkbox
                const cbShadows = document.getElementById('cbUseShadows');
                if (cbShadows) cbShadows.checked = false;

                if (typeof dialog.close === 'function') dialog.close();
                else dialog.removeAttribute('open');
                showEditorInterface();
            }
        };
    }
}

window.addEventListener('paste', (e) => {
    // Only handle image paste if we are not in an input
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (e.clipboardData && e.clipboardData.items) {
        for (const item of e.clipboardData.items) {
            if (item.type.indexOf('image') !== -1) {
                const file = item.getAsFile();
                if (file) processSystemImagePaste(file);
                break;
            }
        }
    }
});

/**
 * Modern Clipboard API Interceptor (Reliable Ctrl+V)
 * Bridges the gap when standard onpaste event isn't triggered or is restricted.
 */
async function systemClipboardInterceptor() {
    if (!navigator.clipboard || !navigator.clipboard.read) {
        return false;
    }

    try {
        const clipboardItems = await navigator.clipboard.read();
        for (const item of clipboardItems) {
            // Check for our sentinel FIRST
            if (item.types.includes('text/plain')) {
                const textBlob = await item.getType('text/plain');
                const text = await textBlob.text();
                if (text === "__SHP_DATA__") {
                    console.log("Internal SHP Sentinel detected - Skipping system paste to use internal indices.");
                    return false; // Let the internal clipboard handler proceed
                }
            }

            // If No sentinel, proceeds with standard image paste
            for (const type of item.types) {
                if (type.startsWith('image/')) {
                    const blob = await item.getType(type);
                    processSystemImagePaste(blob);
                    return true;
                }
            }
        }
    } catch (err) {
        console.warn("Clipboard API restricted or blocked by user. Standard paste event remains fallback.");
        if (err.name === 'NotAllowedError') {
             showPasteNotification("🔒 Navegador bloqueó acceso al portapapeles. Habilítalo o inténtalo de nuevo.", "warning", 3000);
        }
    }
    return false;
}

window.onload = init;

function setupColorShiftUIListeners() {
    if (!elements.btnColorShiftPlus) return;

    elements.btnColorShiftPlus.onclick = () => shiftColorIndex(state.toolSettings.colorShiftAmount);
    elements.btnColorShiftMinus.onclick = () => shiftColorIndex(-state.toolSettings.colorShiftAmount);

    if (elements.colorShiftAmount) {
        elements.colorShiftAmount.oninput = (e) => {
            const val = parseInt(e.target.value);
            state.toolSettings.colorShiftAmount = val;
            if (elements.colorShiftAmtVal) elements.colorShiftAmtVal.innerText = val;
            if (elements.colorShiftBar) elements.colorShiftBar.style.width = (val / 10 * 100) + '%';
        };
    }

    if (elements.btnColorShiftAmtMinus) {
        setupAutoRepeat(elements.btnColorShiftAmtMinus, (ev) => {
            const step = (ev && ev.ctrlKey) ? 5 : 1;
            const val = Math.max(1, state.toolSettings.colorShiftAmount - step);
            state.toolSettings.colorShiftAmount = val;
            if (elements.colorShiftAmount) elements.colorShiftAmount.value = val;
            if (elements.colorShiftAmtVal) elements.colorShiftAmtVal.innerText = val;
            if (elements.colorShiftBar) elements.colorShiftBar.style.width = (val / 10 * 100) + '%';
        });
    }

    if (elements.btnColorShiftAmtPlus) {
        setupAutoRepeat(elements.btnColorShiftAmtPlus, (ev) => {
            const step = (ev && ev.ctrlKey) ? 5 : 1;
            const val = Math.min(10, state.toolSettings.colorShiftAmount + step);
            state.toolSettings.colorShiftAmount = val;
            if (elements.colorShiftAmount) elements.colorShiftAmount.value = val;
            if (elements.colorShiftAmtVal) elements.colorShiftAmtVal.innerText = val;
            if (elements.colorShiftBar) elements.colorShiftBar.style.width = (val / 10 * 100) + '%';
        });
    }

    if (elements.radColorShiftScope) {
        elements.radColorShiftScope.forEach(rad => {
            rad.onchange = (e) => {
                state.toolSettings.colorShiftScope = e.target.value;
            };
        });
    }

    if (elements.chkIgnoreColor0) {
        elements.chkIgnoreColor0.onchange = (e) => {
            state.toolSettings.ignoreColor0 = e.target.checked;
        };
    }

    if (elements.chkCycleShiftPalette) {
        elements.chkCycleShiftPalette.onchange = (e) => {
            state.toolSettings.cycleShiftPalette = e.target.checked;
        };
    }
}

// Global zoom prevention (Ctrl+Wheel and Ctrl++/Ctrl+-)
window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
        e.preventDefault();
    }
}, { passive: false });

window.addEventListener('keydown', (e) => {
    if (!e.key) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey && (k === '+' || k === '=' || k === '-' || k === '0')) {
        // We still allow Ctrl+0 via our main shortcut listener so it triggers the "Center" button,
        // but this stops the browser's native zoom reset.
        e.preventDefault();
    }
}, { capture: true, passive: false });
