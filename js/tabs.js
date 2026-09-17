let lastClosedTab = null;
let currentContextTabIndex = -1;

import { state, Tab, generateId } from './state.js';
import { updateUIState } from './main.js';
import { renderCanvas, updateLayersList, renderPalette, updateCanvasSize, renderFramesList, resetFramesList, renderOverlay, showConfirm, showChoice, syncZoomUI, syncStatusCompressionUI, renderReplaceGrid } from './ui.js';
import { renderHistory } from './history.js';
import { handleSaveShp, handleSaveAll, saveTmpData } from './file_io.js';
import { t } from './translations.js';

export function initTabs() {
    const btnNewTab = document.getElementById('btnNewTab');
    const tabsContainer = document.getElementById('tabsContainer');
    const tabsDropdownBtn = document.getElementById('tabsDropdownBtn');
    const tabsDropdown = document.getElementById('tabsDropdown');
    const tabsSearchInput = document.getElementById('tabsSearchInput');
    const tabsSearchClear = document.getElementById('tabsSearchClear');
    const tabScrollLeft = document.getElementById('tabScrollLeft');
    const tabScrollRight = document.getElementById('tabScrollRight');
    const btnPrevTab = document.getElementById('btnPrevTab');
    const btnNextTab = document.getElementById('btnNextTab');
    const ctxMenu = document.getElementById('tabContextMenu');

    // Initial tab creation if empty
    if (state.tabs.length === 0) {
        createNewTabAt(0, null);
    }

    btnNewTab.onclick = () => createNewTab(null, false);

    btnPrevTab.onclick = () => {
        if (state.activeTabIndex > 0) switchTab(state.activeTabIndex - 1);
    };
    btnNextTab.onclick = () => {
        if (state.activeTabIndex < state.tabs.length - 1) switchTab(state.activeTabIndex + 1);
    };

    tabsDropdownBtn.onclick = (e) => {
        e.stopPropagation();
        const isActive = tabsDropdown.classList.toggle('active');
        tabsDropdownBtn.classList.toggle('active', isActive);
        if (isActive) {
            tabsSearchInput.focus();
            renderTabList();
        }
    };

    tabsSearchInput.oninput = () => renderTabList();
    tabsSearchClear.onclick = () => {
        tabsSearchInput.value = '';
        renderTabList();
        tabsSearchInput.focus();
    };

    tabScrollLeft.onclick = () => tabsContainer.scrollLeft -= 200;
    tabScrollRight.onclick = () => tabsContainer.scrollLeft += 200;

    // Context Menu Actions
    document.getElementById('ctxNewTab').onclick = () => {
        createNewTabAt(currentContextTabIndex + 1, null, false);
        ctxMenu.classList.remove('active');
    };
    document.getElementById('ctxDuplicateTab').onclick = () => {
        duplicateTabAt(currentContextTabIndex);
        ctxMenu.classList.remove('active');
    };
    document.getElementById('ctxCloseTab').onclick = () => {
        closeTab(currentContextTabIndex);
        ctxMenu.classList.remove('active');
    };
    document.getElementById('ctxCloseOthers').onclick = () => {
        closeOtherTabs(currentContextTabIndex);
        ctxMenu.classList.remove('active');
    };
    const ctxCloseAll = document.getElementById('ctxCloseAll');
    if (ctxCloseAll) {
        ctxCloseAll.onclick = () => {
            closeAllTabs();
            ctxMenu.classList.remove('active');
        };
    }
    document.getElementById('ctxReopenTab').onclick = () => {
        reopenLastTab();
        ctxMenu.classList.remove('active');
    };

    document.addEventListener('click', (e) => {
        if (tabsDropdown && tabsDropdown.classList.contains('active') && !tabsDropdown.contains(e.target) && e.target !== tabsDropdownBtn) {
            tabsDropdown.classList.remove('active');
            tabsDropdownBtn.classList.remove('active');
        }
        if (ctxMenu) ctxMenu.classList.remove('active');
    });

    // Scroll interactivity
    const updateScrollButtons = () => {
        requestAnimationFrame(() => {
            const hasOverflow = tabsContainer.scrollWidth > tabsContainer.clientWidth;
            tabScrollLeft.classList.toggle('active', hasOverflow);
            tabScrollRight.classList.toggle('active', hasOverflow);
        });
    };

    new ResizeObserver(updateScrollButtons).observe(tabsContainer);

    // Wheel to NAVIGATE between tabs
    tabsContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.deltaY > 0) {
            if (state.activeTabIndex < state.tabs.length - 1) {
                switchTab(state.activeTabIndex + 1);
            }
        } else if (e.deltaY < 0) {
            if (state.activeTabIndex > 0) {
                switchTab(state.activeTabIndex - 1);
            }
        }
    }, { passive: false });

    // Component initialization
    window.renderTabs = renderTabs;
    window.updateCurrentTabName = updateCurrentTabName;
    window.closeTab = closeTab;
    window.closeAllTabs = closeAllTabs;
    renderTabs();
}

export function createNewTab(fileName = null, blankPalette = false) {
    return createNewTabAt(state.tabs.length, fileName, blankPalette);
}

function createNewTabAt(index, fileName = null, blankPalette = false) {
    const id = generateId();
    let name = fileName;
    let isNewProject = false;

    if (!name) {
        if (state.tabs.length === 0) {
            name = "";
            isNewProject = false;
        } else {
            state.newFileCounter = (state.newFileCounter || 0) + 1;
            name = `New File ${state.newFileCounter}`;
            isNewProject = true;
        }
    }

    // Inherit the palette and palette selector state from the currently active tab
    const sourceTab = (state.activeTabIndex >= 0 && state.tabs[state.activeTabIndex]) ? state.tabs[state.activeTabIndex] : state;
    const tab = new Tab(id, fileName, blankPalette ? null : sourceTab);
    tab.idName = name;
    tab.fileName = fileName;
    tab.isNewProject = isNewProject;
    tab.zoom = 1; // Always start new tab with default 100% zoom
    tab.compression = parseInt(localStorage.getItem('ase_pref_default_comp')) || 3;

    state.tabs.splice(index, 0, tab);
    switchTab(index);
    return tab;
}

function duplicateTabAt(index) {
    const source = state.tabs[index];
    if (index === state.activeTabIndex) state.saveToTab(source);

    const clone = structuredClone(source);
    clone.id = generateId();
    clone.fileName = null;
    clone.fileHandle = null;
    clone.filePath = null;
    clone.fileLastModified = 0;
    clone.hasChanges = true;
    clone.isNewProject = true;
    clone.idName = source.idName ? `${source.idName} (Copy)` : `New File ${++state.newFileCounter}`;

    state.tabs.splice(index + 1, 0, clone);
    switchTab(index + 1);
}

async function closeOtherTabs(keptIndex) {
    const others = state.tabs
        .map((tab, idx) => ({ tab, idx }))
        .filter(({ idx }) => idx !== keptIndex);

    for (const { tab, idx } of others) {
        if (!tab.hasChanges) continue;

        const tabName = tab.fileName || tab.idName || `Tab ${idx + 1}`;
        const answer = await showChoice(
            t('dlg_close_tab_title'),
            t('msg_confirm_close_single_unsaved').replace('{name}', tabName),
            t('btn_save_and_close'),
            t('btn_discard_and_close'),
            'btn btn-download',
            'btn btn-danger'
        );
        if (answer === 'cancel') {
            return;
        }
        if (answer === 'opt1') {
            try {
                const previousActive = state.activeTabIndex;
                state.activeTabIndex = idx;
                state.loadFromTab(tab);

                let saveOk = false;
                if (tab.isTmpMode) {
                    await saveTmpData(false);
                    saveOk = !state.hasChanges;
                } else {
                    saveOk = await handleSaveShp();
                }
                state.saveToTab(tab);
                if (previousActive !== idx) {
                    state.activeTabIndex = previousActive;
                }
                if (!saveOk) {
                    console.warn('[closeOtherTabs] Save was cancelled for', tabName);
                    return;
                }
            } catch (e) {
                console.warn('[closeOtherTabs] Save failed for', tabName, e);
                return;
            }
        }
    }

    const kept = state.tabs[keptIndex];
    // Persist any in-flight state into the currently active tab BEFORE we
    // drop the other tabs. Otherwise switchTab(0) below would call
    // saveToTab with state belonging to one tab and write it into the kept
    // tab, corrupting its hasChanges / historyPtr / savedHistoryPtr.
    if (state.activeTabIndex >= 0 && state.activeTabIndex < state.tabs.length) {
        const activeTab = state.tabs[state.activeTabIndex];
        if (activeTab !== kept) {
            state.saveToTab(activeTab);
        }
    }
    state.tabs = [kept];
    state.activeTabIndex = 0;
    state.loadFromTab(kept);
    resetFramesList(kept ? (kept.framesListScrollTop || 0) : 0);
    renderTabs();
    updateUIState();
    updateCanvasSize();
    renderCanvas();
    renderOverlay();
    renderFramesList(true);
    updateLayersList();
    renderPalette();
    renderReplaceGrid();
    if (typeof renderHistory === 'function') renderHistory();
}

function reopenLastTab() {
    if (!lastClosedTab) return;
    state.tabs.push(lastClosedTab);
    lastClosedTab = null;
    switchTab(state.tabs.length - 1);
}

export function switchTab(index) {
    if (index < 0 || index >= state.tabs.length) return;

    // Persist current state before switching, only if switching to a different tab
    if (state.activeTabIndex !== -1 && state.activeTabIndex !== index && state.tabs[state.activeTabIndex]) {
        const currentTab = state.tabs[state.activeTabIndex];
        state.saveToTab(currentTab);
    }

    state.activeTabIndex = index;
    const newTab = state.tabs[index];
    state.loadFromTab(newTab);

    // Sync body class for TMP mode vs SHP mode
    document.body.classList.toggle('tmp-mode', !!state.isTmpMode);

    // Synchronize file handles and filenames with active tab
    state.fileHandle = newTab.fileHandle || null;
    state.filePath = newTab.filePath || null;
    state.fileLastModified = newTab.fileLastModified || 0;
    window._lastShpFileHandle = newTab.fileHandle || null;
    window._lastShpFilePath = newTab.filePath || null;
    window._lastShpFilename = newTab.fileName || null;
    if (newTab.isTmpMode) {
        window._lastTmpFileHandle = newTab.fileHandle || null;
        window._lastTmpFilePath = newTab.filePath || null;
        window._lastTmpFilename = newTab.fileName || null;
    }

    // Update palette selector UI to match the new active tab
    if (typeof window.syncPaletteSelector === 'function') {
        window.syncPaletteSelector();
    }

    // UI Refresh
    resetFramesList(newTab.framesListScrollTop || 0);
    renderTabs();
    updateUIState();
    updateCanvasSize();
    syncZoomUI();
    syncStatusCompressionUI();
    renderCanvas();
    renderOverlay();
    renderFramesList(true);
    updateLayersList();
    renderPalette();
    renderReplaceGrid();
    if (typeof renderHistory === 'function') renderHistory();

    // Sync Replace Picker buttons active state across tabs
    const btnPickReplaceSrc = document.getElementById('btnPickReplaceSrc');
    const btnPickReplaceTgt = document.getElementById('btnPickReplaceTgt');
    if (btnPickReplaceSrc && btnPickReplaceTgt) {
        if (state.isPickingForReplace && state.isPickingForReplace.side === 'src') {
            btnPickReplaceSrc.classList.add('picker-active');
            btnPickReplaceTgt.classList.remove('picker-active');
            document.body.classList.add('picking-mode');
        } else if (state.isPickingForReplace && state.isPickingForReplace.side === 'tgt') {
            btnPickReplaceTgt.classList.add('picker-active');
            btnPickReplaceSrc.classList.remove('picker-active');
            document.body.classList.add('picking-mode');
        } else {
            btnPickReplaceSrc.classList.remove('picker-active');
            btnPickReplaceTgt.classList.remove('picker-active');
            document.body.classList.remove('picking-mode');
        }
    }

    // Active tab visibility adjustment
    setTimeout(() => {
        const activeTabEl = document.querySelector('.chrome-tab.active');
        if (activeTabEl) activeTabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }, 50);
}

function resetToCleanDefaultTab(preservePaletteFromTab = null) {
    const startupPalPref = localStorage.getItem('ase_pref_startup_pal');
    const defaultComp = parseInt(localStorage.getItem('ase_pref_default_comp')) || 3;
    const refTab = (startupPalPref === 'none') ? null : (preservePaletteFromTab || state.tabs[0] || null);
    const cleanTab = new Tab(generateId(), null, refTab);
    state.newFileCounter = 1;
    cleanTab.idName = 'New File 1';
    cleanTab.fileName = null;
    cleanTab.isNewProject = true;
    cleanTab.hasChanges = false;
    cleanTab.frames = [];
    cleanTab.fileHandle = null;
    cleanTab.filePath = null;
    cleanTab.fileLastModified = 0;
    cleanTab.history = [];
    cleanTab.historyPtr = -1;
    cleanTab.savedHistoryPtr = -1;
    cleanTab.compression = defaultComp;

    state.tabs = [cleanTab];
    state.activeTabIndex = 0;

    // Reset global state explicitly
    state.fileHandle = null;
    state.filePath = null;
    state.fileLastModified = 0;
    window._lastShpFileHandle = null;
    window._lastShpFilePath = null;
    window._lastShpFilename = null;
    state.isTmpMode = false;
    state.tmpHeader = null;
    state.originalTmpTiles = null;
    state.tmpFilename = null;
    window._lastTmpFileHandle = null;
    window._lastTmpFilePath = null;
    window._lastTmpFilename = null;
    state.frames = [];
    state.currentFrameIdx = 0;
    state.selection = null;
    state.floatingSelection = null;
    state.history = [];
    state.historyPtr = -1;
    state.savedHistoryPtr = -1;
    state.hasChanges = false;
    state.compression = defaultComp;

    document.body.classList.remove('tmp-mode');
    document.body.classList.remove('picking-mode');
    const btnPickReplaceSrc = document.getElementById('btnPickReplaceSrc');
    const btnPickReplaceTgt = document.getElementById('btnPickReplaceTgt');
    if (btnPickReplaceSrc) btnPickReplaceSrc.classList.remove('picker-active');
    if (btnPickReplaceTgt) btnPickReplaceTgt.classList.remove('picker-active');

    // Load cleanTab directly into state (do NOT call switchTab which would call saveToTab)
    state.loadFromTab(cleanTab);

    renderTabs();
    updateUIState();
    updateCanvasSize();
    syncZoomUI();
    renderCanvas();
    renderOverlay();
    renderFramesList();
    updateLayersList();
    renderPalette();
    renderReplaceGrid();
    if (typeof window.syncPaletteSelector === 'function') window.syncPaletteSelector();
    if (typeof renderHistory === 'function') renderHistory();
}

export async function closeAllTabs() {
    // Sync active tab state
    if (state.activeTabIndex >= 0 && state.tabs[state.activeTabIndex]) {
        state.saveToTab(state.tabs[state.activeTabIndex]);
    }

    const totalCount = state.tabs.length;
    const firstTab = state.tabs[0];
    const hasFirstData = (state.activeTabIndex === 0)
        ? (!!(state.isTmpMode ? state.originalTmpTiles : state.frames.length > 0))
        : (!!firstTab.isTmpMode ? !!firstTab.originalTmpTiles : firstTab.frames.length > 0);

    // If only one empty and unmodified tab, nothing to close
    if (totalCount === 1 && !hasFirstData && !firstTab.hasChanges && !firstTab.isNewProject) {
        return;
    }

    const unsavedTabs = state.tabs.filter(t => t.hasChanges);

    if (unsavedTabs.length > 0) {
        const choice = await showChoice(
            t('dlg_close_all_title'),
            t('msg_confirm_close_all_unsaved').replace('{count}', totalCount).replace('{unsaved}', unsavedTabs.length),
            t('btn_save_and_close'),
            t('btn_discard_and_close'),
            'btn btn-download',
            'btn btn-danger'
        );

        if (choice === 'cancel') return;

        if (choice === 'opt1') {
            if (typeof handleSaveAll === 'function') {
                await handleSaveAll();
                const remainingUnsaved = state.tabs.filter(t => t.hasChanges);
                if (remainingUnsaved.length > 0) {
                    return; // User cancelled saving
                }
            }
        }
    } else {
        const confirmed = await showConfirm(
            t('dlg_close_all_title'),
            t('msg_confirm_close_all_clean').replace('{count}', totalCount)
        );
        if (!confirmed) return;
    }

    resetToCleanDefaultTab();
}

export async function closeTab(index, e) {
    if (e) e.stopPropagation();

    // Ensure current tab state is saved
    if (index === state.activeTabIndex && state.tabs[index]) {
        state.saveToTab(state.tabs[index]);
    }

    const tab = state.tabs[index];
    if (!tab) return;

    if (tab.hasChanges) {
        const tabName = tab.fileName || tab.idName || `Tab ${index + 1}`;
        const choice = await showChoice(
            t('dlg_close_tab_title'),
            t('msg_confirm_close_single_unsaved').replace('{name}', tabName),
            t('btn_save_and_close'),
            t('btn_discard_and_close'),
            'btn btn-download',
            'btn btn-danger'
        );
        if (choice === 'cancel') return;

        if (choice === 'opt1') {
            const previousActive = state.activeTabIndex;
            if (state.activeTabIndex !== index) {
                state.activeTabIndex = index;
                state.loadFromTab(tab);
            }
            let saveOk = false;
            if (tab.isTmpMode) {
                await saveTmpData(false);
                saveOk = !state.hasChanges;
            } else {
                saveOk = await handleSaveShp();
            }
            state.saveToTab(tab);
            if (!saveOk) {
                if (previousActive !== index) {
                    state.activeTabIndex = previousActive;
                    state.loadFromTab(state.tabs[previousActive]);
                }
                return;
            }
        }
    }

    // Save for reopen logic
    lastClosedTab = structuredClone(tab);

    if (state.tabs.length <= 1) {
        resetToCleanDefaultTab(tab);
        return;
    }

    state.tabs.splice(index, 1);

    if (state.activeTabIndex >= index) {
        state.activeTabIndex = Math.max(0, state.activeTabIndex - 1);
    }

    const newActiveTab = state.tabs[state.activeTabIndex];
    state.loadFromTab(newActiveTab);
    document.body.classList.toggle('tmp-mode', !!state.isTmpMode);

    resetFramesList(newActiveTab ? (newActiveTab.framesListScrollTop || 0) : 0);
    renderTabs();
    updateUIState();
    updateCanvasSize();
    syncZoomUI();
    renderCanvas();
    renderOverlay();
    renderFramesList(true);
    updateLayersList();
    renderPalette();
    if (typeof renderHistory === 'function') renderHistory();
}

export function updateCurrentTabName(name, isNewProject = false) {
    if (state.activeTabIndex !== -1) {
        const tab = state.tabs[state.activeTabIndex];
        tab.fileName = name;
        tab.idName = name;
        tab.isNewProject = (tab.filePath || tab.fileHandle || state.filePath || state.fileHandle) ? false : isNewProject;
        tab.hasChanges = false;

        state.saveToTab(tab);
        renderTabs();
    }
}

function renderTabs() {
    const container = document.getElementById('tabsContainer');
    const tabBar = document.getElementById('tabBar');
    const btnNewTab = document.getElementById('btnNewTab');
    const ctxMenu = document.getElementById('tabContextMenu');

    // Clear only tab elements, keep #btnNewTab and scroll/nav buttons
    Array.from(container.querySelectorAll('.chrome-tab')).forEach(el => el.remove());

    const canClose = state.tabs.length > 1;
    tabBar.classList.toggle('single-tab', !canClose);

    // Toggle Save All visibility when multiple tabs are open
    const menuSaveAll = document.getElementById('menuSaveAll');
    if (menuSaveAll) {
        menuSaveAll.style.display = canClose ? 'flex' : 'none';
    }

    // Toggle Close All visibility when multiple tabs are open
    const menuCloseAllShp = document.getElementById('menuCloseAllShp');
    if (menuCloseAllShp) {
        menuCloseAllShp.style.display = canClose ? 'flex' : 'none';
    }

    // Toggle Replace All Tabs button visibility when multiple tabs are open
    const btnProcessReplaceAll = document.getElementById('btnProcessReplaceAll');
    if (btnProcessReplaceAll) {
        btnProcessReplaceAll.style.display = canClose ? 'block' : 'none';
    }

    // Hide entire bar if only one tab AND it's totally empty
    const firstTab = state.tabs[0];
    const hasFirstData = (state.activeTabIndex === 0)
        ? (!!(state.isTmpMode ? state.originalTmpTiles : state.frames.length > 0))
        : (!!firstTab.isTmpMode ? !!firstTab.originalTmpTiles : firstTab.frames.length > 0);
    const isFirstNew = firstTab.isNewProject;

    const isOnlyOneEmpty = state.tabs.length === 1 && !hasFirstData && !isFirstNew;
    tabBar.style.display = isOnlyOneEmpty ? 'none' : 'flex';
    btnNewTab.style.display = isOnlyOneEmpty ? 'none' : 'block';

    state.tabs.forEach((tab, index) => {
        const tabEl = document.createElement('div');
        const isActive = index === state.activeTabIndex;
        const isDirty = isActive ? state.hasChanges : tab.hasChanges;

        const hasData = isActive
            ? (state.isTmpMode ? !!state.originalTmpTiles : state.frames.length > 0)
            : (tab.isTmpMode ? !!tab.originalTmpTiles : tab.frames.length > 0);
        const isNew = tab.isNewProject;

        tabEl.className = `chrome-tab ${isActive ? 'active' : ''} ${isDirty ? 'dirty' : ''}`;
        tabEl.draggable = true;

        const gType = isActive ? state.gameType : tab.gameType;
        const isTmp = isActive ? state.isTmpMode : tab.isTmpMode;
        const displayName = tab.idName || (tab.isTmpMode ? 'Untitled TMP' : `New File ${index + 1}`);
        const suffix = isTmp ? (gType === 'ts' ? ' (TS)' : ' (RA2)') : '';
        const finalDisplayName = `${displayName}${suffix}`;
        tabEl.title = finalDisplayName;

        tabEl.innerHTML = `
            <div class="tab-status-container">
                <div class="status-changes" style="${isDirty ? '' : 'display:none'}"></div>
            </div>
            <div class="tab-title">${finalDisplayName}</div>
            <div class="tab-close" ${!canClose ? 'style="display:none"' : ''}>&times;</div>
        `;

        tabEl.onclick = () => switchTab(index);
        tabEl.oncontextmenu = (e) => {
            e.preventDefault();
            currentContextTabIndex = index;
            ctxMenu.style.left = `${e.clientX}px`;
            ctxMenu.style.top = `${e.clientY}px`;
            ctxMenu.classList.add('active');

            const reopenItem = document.getElementById('ctxReopenTab');
            reopenItem.classList.toggle('disabled', !lastClosedTab);
        };
        tabEl.onauxclick = (e) => {
            // Middle mouse button (auxclick with button === 1) closes the tab,
            // mirroring the behavior of the "X" on the tab itself.
            if (e.button === 1) {
                e.preventDefault();
                closeTab(index, e);
            }
        };
        tabEl.querySelector('.tab-close').onclick = (e) => closeTab(index, e);

        // DRAG AND DROP
        tabEl.ondragstart = (e) => {
            e.dataTransfer.setData('sourceIndex', index);
            tabEl.classList.add('dragging');
        };
        tabEl.ondragover = (e) => {
            e.preventDefault();
            tabEl.classList.add('drag-over');
        };
        tabEl.ondragleave = () => tabEl.classList.remove('drag-over');
        tabEl.ondrop = (e) => {
            e.preventDefault();
            tabEl.classList.remove('drag-over');
            const sourceIndex = parseInt(e.dataTransfer.getData('sourceIndex'));
            if (sourceIndex !== index) {
                moveTab(sourceIndex, index);
            }
        };

        container.appendChild(tabEl);
    });
}

function moveTab(from, to) {
    const element = state.tabs.splice(from, 1)[0];
    state.tabs.splice(to, 0, element);

    if (state.activeTabIndex === from) {
        state.activeTabIndex = to;
    } else if (from < state.activeTabIndex && to >= state.activeTabIndex) {
        state.activeTabIndex--;
    } else if (from > state.activeTabIndex && to <= state.activeTabIndex) {
        state.activeTabIndex++;
    }

    renderTabs();
}

function renderTabList() {
    const container = document.getElementById('tabsListContainer');
    const filter = document.getElementById('tabsSearchInput').value.toLowerCase();
    container.innerHTML = '';
    const canClose = state.tabs.length > 1;

    state.tabs.forEach((tab, index) => {
        const isActive = index === state.activeTabIndex;
        const hasData = isActive
            ? (state.isTmpMode ? !!state.originalTmpTiles : state.frames.length > 0)
            : (tab.isTmpMode ? !!tab.originalTmpTiles : tab.frames.length > 0);
        const isNew = tab.isNewProject;

        // SKIP truly empty tabs
        if (!hasData && !isNew) return;

        const tabNameForFilter = tab.idName || "New Project";
        if (filter && !tabNameForFilter.toLowerCase().includes(filter)) return;

        const gType = isActive ? state.gameType : tab.gameType;
        const isTmp = isActive ? state.isTmpMode : tab.isTmpMode;
        const suffix = isTmp ? (gType === 'ts' ? ' (TS)' : ' (RA2)') : '';
        const fullTitle = `${tabNameForFilter}${suffix}`;

        const isDirty = isActive ? state.hasChanges : tab.hasChanges;

        const item = document.createElement('div');
        item.className = `tabs-list-item ${isActive ? 'selected' : ''} ${isDirty ? 'dirty' : ''} ${!canClose ? 'single-tab' : ''}`;

        item.innerHTML = `
            <div class="tabs-list-title" style="${isDirty ? 'font-weight:bold' : ''}">${fullTitle}</div>
            <div class="tabs-list-status-container">
                <div class="status-changes" style="${isDirty ? '' : 'display:none'}"></div>
            </div>
            <div class="tabs-list-close" ${!canClose ? 'style="display:none"' : ''}>&times;</div>
        `;

        item.onclick = () => {
            switchTab(index);
            document.getElementById('tabsDropdown').classList.remove('active');
        };

        item.querySelector('.tabs-list-close').onclick = async (e) => {
            e.stopPropagation();
            await closeTab(index);
            renderTabList();
        };

        container.appendChild(item);
    });
}
