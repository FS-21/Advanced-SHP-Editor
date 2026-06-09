import { state } from './state.js';
import { elements } from './constants.js';
import { updateCanvasSize, renderFrameManager, clearThumbCaches } from './ui.js';

let hook_renderCanvas, hook_renderFramesList, hook_updateLayersList, hook_startAnts, hook_stopAnts, hook_updateUIState;

export function initHistoryHooks(renderCanvasFn, renderFramesListFn, updateLayersListFn, startAntsFn, stopAntsFn, updateUIStateFn) {
    hook_renderCanvas = renderCanvasFn;
    hook_renderFramesList = renderFramesListFn;
    hook_updateLayersList = updateLayersListFn;
    hook_startAnts = startAntsFn;
    hook_stopAnts = stopAntsFn;
    hook_updateUIState = updateUIStateFn;
}

export function renderHistory() {
    if (!elements.historyList) return;
    elements.historyList.innerHTML = '';
    state.history.forEach((h, i) => {
        const el = document.createElement('div');
        el.style.padding = "4px";
        el.style.cursor = "pointer";
        el.style.borderBottom = "1px solid #333";
        el.style.fontSize = "12px";
        el.innerText = `Action ${i + 1}`;
        if (i === state.historyPtr) {
            el.style.backgroundColor = "#094771";
            el.style.color = "#fff";
        } else {
            el.style.color = "#888";
        }

        el.onclick = () => {
            if (i === state.historyPtr) return;
            state.historyPtr = i;
            restoreHistory(state.history[i]);
        };
        elements.historyList.appendChild(el);
    });
    elements.historyList.scrollTop = elements.historyList.scrollHeight;
}

/**
 * Deep clones a layer/group node recursively.
 */
export function cloneLayerNode(node) {
    if (!node) return null;
    const cloned = {
        id: node.id,
        name: node.name,
        type: node.type || 'layer',
        visible: node.visible !== undefined ? node.visible : true,
        width: node.width,
        height: node.height,
        clipped: !!node.clipped,
        expanded: !!node.expanded,
        isMask: !!node.isMask,
        maskType: node.maskType || 'alpha',
        ghosting: !!node.ghosting,
        ghostOpacity: node.ghostOpacity !== undefined ? node.ghostOpacity : 50,
        x: node.x || 0,
        y: node.y || 0,
        _v: node._v || 0
    };

    if (node.type === 'external_shp') {
        cloned.extWidth = node.extWidth;
        cloned.extHeight = node.extHeight;
        cloned.extFrameX = node.extFrameX;
        cloned.extFrameY = node.extFrameY;
        cloned.extShpWidth = node.extShpWidth;
        cloned.extShpHeight = node.extShpHeight;
        cloned.extFilename = node.extFilename;

        if (node.extShpFrameData) {
            cloned.extShpFrameData = new Uint8Array(node.extShpFrameData);
        }
        if (node.extShpPalette) {
            cloned.extShpPalette = JSON.parse(JSON.stringify(node.extShpPalette));
        }
        if (node.index0Transparent !== undefined) {
            cloned.index0Transparent = node.index0Transparent;
        }
    }

    if (node.data) {
        // High Performance Copy for Typed Arrays
        if (node.data instanceof Uint8Array || node.data instanceof Uint16Array) {
            cloned.data = new node.data.constructor(node.data);
        } else {
            cloned.data = node.data.slice();
        }
    }
    if (node.mask) {
        cloned.mask = new Uint8Array(node.mask);
    }
    if (node.layers) {
        cloned.layers = node.layers.map(c => cloneLayerNode(c));
    }
    if (node.children) {
        cloned.children = node.children.map(c => cloneLayerNode(c));
    }

    return cloned;
}

/**
 * Resets the undo/redo history to a single "fresh open" entry. Use this
 * after loading a new file (Open, Open Recent, drag&drop, Import). It
 * prevents the user from Ctrl+Z-ing the file away — the newly opened
 * document is the only history entry, and it is marked as the saved state.
 */
export function resetHistoryForFreshOpen() {
    clearThumbCaches();
    // Truncate any pending redo entries, then push the current state as the
    // only history entry.
    if (state.historyPtr < state.history.length - 1) {
        state.history = state.history.slice(0, state.historyPtr + 1);
    }

    // Build a fresh snapshot of the current state.
    state.frames.forEach(f => {
        if (!f.id) f.id = Math.random().toString(36).substr(2, 9);
    });
    const framesSnapshot = state.frames.map((f) => {
        const newV = (f._v || 0) + 1;
        f._v = newV;
        return {
            id: f.id,
            width: f.width,
            height: f.height,
            duration: f.duration,
            lastSelectedIdx: f.lastSelectedIdx,
            _v: newV,
            tmpMeta: f.tmpMeta ? { ...f.tmpMeta } : undefined,
            layers: f.layers.map(l => cloneLayerNode(l))
        };
    });

    let selectionSnapshot = null;
    if (state.selection) {
        selectionSnapshot = { ...state.selection };
        if (state.selection.maskData) {
            selectionSnapshot.maskData = new Uint8Array(state.selection.maskData);
        }
    }

    let floatingSnapshot = null;
    if (state.floatingSelection) {
        floatingSnapshot = { ...state.floatingSelection };
        if (state.floatingSelection.data) {
            floatingSnapshot.data = state.floatingSelection.data.slice();
        }
        if (state.floatingSelection.maskData) {
            floatingSnapshot.maskData = new Uint8Array(state.floatingSelection.maskData);
        }
        if (state.floatingSelection.originalData) {
            floatingSnapshot.originalData = state.floatingSelection.originalData.slice();
        }
        if (state.floatingSelection.originalMaskData) {
            floatingSnapshot.originalMaskData = new Uint8Array(state.floatingSelection.originalMaskData);
        }
    }

    state.history = [{
        frames: framesSnapshot,
        selection: selectionSnapshot,
        floatingSelection: floatingSnapshot,
        canvasW: state.canvasW,
        canvasH: state.canvasH,
        activeLayerId: state.activeLayerId,
        currentFrameIdx: state.currentFrameIdx,
        tmpFullZPreviewActive: !!state.tmpFullZPreviewActive,
        palette: state.palette.map(c => c ? { ...c } : null)
    }];
    state.historyPtr = 0;
    state.savedHistoryPtr = 0;
    state.hasChanges = false;

    if (window.renderTabs) window.renderTabs();
    renderHistory();
    if (hook_updateUIState) hook_updateUIState(state.frames.length > 0);
}


export function pushHistory(modifiedFrameIndices = null) {
    clearThumbCaches();
    if (state.historyPtr < state.history.length - 1) {
        state.history = state.history.slice(0, state.historyPtr + 1);
    }

    // Special case for selection-only history points
    const isSelectionOnly = modifiedFrameIndices !== null &&
        Array.isArray(modifiedFrameIndices) &&
        modifiedFrameIndices.length === 0;

    const prevSnapshot = state.historyPtr >= 0 ? state.history[state.historyPtr] : null;

    // Optimization: Skip if no change vs previous state (to avoid duplicate selection points)
    if (prevSnapshot && isSelectionOnly) {
        const selChanged = (!!prevSnapshot.selection !== !!state.selection) ||
            (state.selection && (
                prevSnapshot.selection.x !== state.selection.x ||
                prevSnapshot.selection.y !== state.selection.y ||
                prevSnapshot.selection.w !== state.selection.w ||
                prevSnapshot.selection.h !== state.selection.h ||
                prevSnapshot.selection.type !== state.selection.type
            ));

        if (prevSnapshot.currentFrameIdx === state.currentFrameIdx &&
            prevSnapshot.activeLayerId === state.activeLayerId &&
            !selChanged) {
            return;
        }
    }

    let framesSnapshot;
    if (isSelectionOnly && prevSnapshot && prevSnapshot.frames.length === state.frames.length) {
        // FAST PATH: selection only, we trust the frames are the same (no deletions or additions happened)
        framesSnapshot = prevSnapshot.frames;
    } else {
        // Ensure all live frames have unique IDs for tracking across reorders
        state.frames.forEach(f => {
            if (!f.id) f.id = Math.random().toString(36).substr(2, 9);
        });

        // ALWAYS deep-clone every frame. This is slower but guarantees
        // that undo correctly restores previous states — the COW path
        // could leak the previous snapshot's layers into the live frame
        // after a draw → undo → draw cycle, breaking the oldest undo entry.
        framesSnapshot = state.frames.map((f, i) => {
            const newV = (f._v || 0) + 1;
            f._v = newV; // bump version on live frame
            return {
                id: f.id,
                width: f.width,
                height: f.height,
                duration: f.duration,
                lastSelectedIdx: f.lastSelectedIdx,
                _v: newV,
                tmpMeta: f.tmpMeta ? { ...f.tmpMeta } : undefined,
                layers: f.layers.map(l => cloneLayerNode(l))
            };
        });
    }

    let selectionSnapshot = null;
    if (state.selection) {
        selectionSnapshot = { ...state.selection };
        if (state.selection.maskData) {
            selectionSnapshot.maskData = new Uint8Array(state.selection.maskData);
        }
    }

    let floatingSnapshot = null;
    if (state.floatingSelection) {
        floatingSnapshot = { ...state.floatingSelection };
        if (state.floatingSelection.data) {
            floatingSnapshot.data = state.floatingSelection.data.slice();
        }
        if (state.floatingSelection.maskData) {
            floatingSnapshot.maskData = new Uint8Array(state.floatingSelection.maskData);
        }
        if (state.floatingSelection.originalData) {
            floatingSnapshot.originalData = state.floatingSelection.originalData.slice();
        }
        if (state.floatingSelection.originalMaskData) {
            floatingSnapshot.originalMaskData = new Uint8Array(state.floatingSelection.originalMaskData);
        }
    }

    state.history.push({
        frames: framesSnapshot,
        selection: selectionSnapshot,
        floatingSelection: floatingSnapshot,
        canvasW: state.canvasW,
        canvasH: state.canvasH,
        activeLayerId: state.activeLayerId, // Save so undo restores the correct active layer
        currentFrameIdx: state.currentFrameIdx, // Save the active frame
        tmpFullZPreviewActive: !!state.tmpFullZPreviewActive, // Save whether Full Z Preview is active
        palette: state.palette.map(c => c ? { ...c } : null) // Snapshot the current palette
    });

    // Dynamic history limit based on project size to prevent excessive memory usage
    const projectSize = state.frames.length * state.canvasW * state.canvasH;
    let historyLimit;

    // Each snapshot deep-clones every frame's layers, so memory grows linearly
    // with the limit × frames × pixels. The limit is kept conservative for
    // large projects and generous for small ones.
    if (projectSize > 500000000) {
        historyLimit = 100;
    } else if (projectSize > 200000000) {
        historyLimit = 200;
    } else if (projectSize > 50000000) {
        historyLimit = 300;
    } else {
        historyLimit = 1500;
    }

    // Log warning if history limit was reduced
    if (historyLimit < 50 && !state.historyLimitNotified) {
        state.historyLimitNotified = true;
        console.warn(`History limit reduced to ${historyLimit} entries due to large project size (${state.frames.length} frames, ${state.canvasW}x${state.canvasH})`);
    }

    if (state.history.length > historyLimit) {
        state.history.shift();
        state.historyPtr = state.history.length - 1;
    } else {
        state.historyPtr++;
    }

    // Update "hasChanges" and Tab visual state
    // Don't mark as dirty for non-modifying operations (selection/navigation/reorder)
    const isNonModifying = (modifiedFrameIndices === 'reorder') ||
        (Array.isArray(modifiedFrameIndices) && modifiedFrameIndices.length === 0);
    if (!isNonModifying) {
        const wasChanged = state.hasChanges;
        state.hasChanges = (state.historyPtr !== state.savedHistoryPtr);

        if (wasChanged !== state.hasChanges) {
            if (window.renderTabs) window.renderTabs();
        }
    }

    renderHistory();
    if (hook_updateUIState) hook_updateUIState(state.frames.length > 0);
}

export function undo() {
    if (state.historyPtr > 0 && state.historyPtr < state.history.length) {
        state.historyPtr--;
        restoreHistory(state.history[state.historyPtr]);

        // Update dirty flag
        state.hasChanges = (state.historyPtr !== state.savedHistoryPtr);
        if (window.renderTabs) window.renderTabs();

        if (hook_updateUIState) hook_updateUIState();
    }
}

export function redo() {
    if (state.historyPtr >= 0 && state.historyPtr < state.history.length - 1) {
        state.historyPtr++;
        restoreHistory(state.history[state.historyPtr]);
        
        // Update dirty flag
        state.hasChanges = (state.historyPtr !== state.savedHistoryPtr);
        if (window.renderTabs) window.renderTabs();
        
        if (hook_updateUIState) hook_updateUIState();
    }
}

export function restoreHistory(snapshot) {
    if (!snapshot) return;

    clearThumbCaches();
    console.log(`[History] Restoring snapshot. Frames: ${snapshot.frames.length}, Canvas: ${snapshot.canvasW}x${snapshot.canvasH}`);

    // Handle both old (array of frames) and new formats
    const isNewFormat = snapshot && !Array.isArray(snapshot) && snapshot.frames;
    const frames = isNewFormat ? snapshot.frames : snapshot;

    // Restore: copy the snapshot's frames into the live state.
    // The snapshot itself is NOT modified (it's the history entry).
    // Each frame's layers are deep-cloned so the live state is fully
    // independent of the snapshot. We re-bump _v for thumbnail invalidation.
    state.frames = frames.map((f, i) => ({
        id: f.id,
        width: f.width,
        height: f.height,
        duration: f.duration,
        lastSelectedIdx: f.lastSelectedIdx,
        _v: (f._v || 0) + 1, // Bump _v for thumbnail invalidation
        tmpMeta: f.tmpMeta ? { ...f.tmpMeta } : undefined,
        layers: f.layers.map(l => cloneLayerNode(l))
    }));

    if (isNewFormat) {
        if (snapshot.selection) {
            state.selection = { ...snapshot.selection };
            if (snapshot.selection.maskData) {
                state.selection.maskData = new Uint8Array(snapshot.selection.maskData);
            }
        } else {
            state.selection = null;
        }

        if (snapshot.floatingSelection) {
            state.floatingSelection = { ...snapshot.floatingSelection };
            if (snapshot.floatingSelection.data) {
                state.floatingSelection.data = new Uint16Array(snapshot.floatingSelection.data);
            }
            if (snapshot.floatingSelection.maskData) {
                state.floatingSelection.maskData = new Uint8Array(snapshot.floatingSelection.maskData);
            }
            if (snapshot.floatingSelection.originalData) {
                state.floatingSelection.originalData = new Uint16Array(snapshot.floatingSelection.originalData);
            }
            if (snapshot.floatingSelection.originalMaskData) {
                state.floatingSelection.originalMaskData = new Uint8Array(snapshot.floatingSelection.originalMaskData);
            }
        } else {
            state.floatingSelection = null;
        }

        if (snapshot.canvasW !== undefined) state.canvasW = snapshot.canvasW;
        if (snapshot.canvasH !== undefined) state.canvasH = snapshot.canvasH;
        if (snapshot.activeLayerId !== undefined) state.activeLayerId = snapshot.activeLayerId;
        if (snapshot.currentFrameIdx !== undefined) state.currentFrameIdx = snapshot.currentFrameIdx;
        state.tmpFullZPreviewActive = snapshot.tmpFullZPreviewActive !== undefined ? snapshot.tmpFullZPreviewActive : false;
        
        if (snapshot.palette) {
            state.palette = snapshot.palette.map(c => c ? { ...c } : null);
        }

    } else {
        state.floatingSelection = null;
        state.selection = null;
    }

    updateCanvasSize();

    if (state.currentFrameIdx >= state.frames.length) state.currentFrameIdx = 0;

    if (state.selection) {
        if (hook_startAnts) hook_startAnts();
    } else {
        if (hook_stopAnts) hook_stopAnts();
    }

    // UI refresh — hook_renderCanvas already calls renderFramesList + updateLayersList
    // internally (see main.js initHistoryHooks), so we do NOT call those hooks again 
    // separately to avoid duplicate/redundant DOM rebuilds.
    if (hook_renderCanvas) hook_renderCanvas();
    renderFrameManager();
    renderHistory();
    if (hook_updateUIState) hook_updateUIState(state.frames.length > 0);
}
