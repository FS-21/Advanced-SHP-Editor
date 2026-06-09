let lastClosedTab = null;
let currentContextTabIndex = -1;

import { state, Tab, generateId } from './state.js';
import { updateUIState } from './main.js';
import { renderCanvas, updateLayersList, renderPalette, updateCanvasSize, renderFramesList, renderOverlay, showConfirm, showChoice } from './ui.js';
import { renderHistory } from './history.js';
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

    btnNewTab.onclick = () => createNewTab(null, true);

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
        createNewTabAt(currentContextTabIndex + 1, null, true);
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
    renderTabs();
}

export function createNewTab(fileName = null, blankPalette = false) {
    return createNewTabAt(state.tabs.length, fileName, blankPalette);
}

function createNewTabAt(index, fileName = null, blankPalette = false) {
    const id = generateId();
    const name = fileName || "";
    // When called from the "+" button or the tab context menu, we want a fresh
    // tab with no inherited palette (the user will pick one via "New SHP/TMP"
    // or an import). For Open Recent / Open dialogs, we pass blankPalette=false
    // so the new tab can inherit the current palette state and have it swapped
    // by applyPaletteById / loadTmpData right after.
    const tab = new Tab(id, fileName, blankPalette ? null : state);
    tab.idName = name;

    state.tabs.splice(index, 0, tab);
    switchTab(index);
    return tab;
}

function duplicateTabAt(index) {
    const source = state.tabs[index];
    if (index === state.activeTabIndex) state.saveToTab(source);

    const clone = structuredClone(source);
    clone.id = generateId();

    state.tabs.splice(index + 1, 0, clone);
    switchTab(index + 1);
}

async function closeOtherTabs(keptIndex) {
    // Iterate other tabs and process each one individually. We always ask
    // the user (Save / Don't Save / Cancel) for any dirty tab — we never
    // auto-save, because that would silently trigger native file pickers or
    // overwrite prompts and bypass the user's intent.
    const others = state.tabs
        .map((tab, idx) => ({ tab, idx }))
        .filter(({ idx }) => idx !== keptIndex);

    for (const { tab, idx } of others) {
        if (!tab.hasChanges) continue;

        const tabName = tab.fileName || tab.idName || `Tab ${idx + 1}`;
        const answer = await showChoice(
            t('dlg_confirm_title'),
            t('msg_unsaved_changes_tab', { name: tabName }),
            t('btn_save'),
            t('btn_dont_save')
        );
        if (answer === 'cancel') {
            // Abort: do not close any more tabs.
            return;
        }
        if (answer === 'opt1') {
            // Save the tab. Make it active, invoke save, then capture back.
            // If the user cancels the Save As picker, treat as "don't save"
            // and continue closing the other tabs.
            try {
                const previousActive = state.activeTabIndex;
                state.activeTabIndex = idx;
                state.loadFromTab(tab);

                let saveOk = false;
                if (tab.isTmpMode) {
                    if (typeof saveTmpData === 'function') {
                        await saveTmpData(false);
                        saveOk = !state.hasChanges;
                    }
                } else {
                    if (typeof saveShpData === 'function') {
                        await saveShpData(false);
                        saveOk = !state.hasChanges;
                    }
                }
                // Capture the saved snapshot back into the tab.
                state.saveToTab(tab);
                if (previousActive !== idx) {
                    state.activeTabIndex = previousActive;
                }
                // If the user dismissed the Save As dialog, state.hasChanges
                // is still true; in that case the file wasn't saved, so we
                // close it anyway (user's intent was to discard by clicking
                // Save and then cancelling the picker).
                if (!saveOk) {
                    console.warn('[closeOtherTabs] Save was cancelled for', tabName);
                }
            } catch (e) {
                console.warn('[closeOtherTabs] Save failed for', tabName, e);
            }
        }
        // 'discard' -> fall through and close
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
    renderTabs();
    updateUIState();
    updateCanvasSize();
    renderCanvas();
    renderOverlay();
    renderFramesList();
    updateLayersList();
    renderPalette();
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

    // Persist current state before switching
    if (state.activeTabIndex !== -1 && state.tabs[state.activeTabIndex]) {
        const currentTab = state.tabs[state.activeTabIndex];
        state.saveToTab(currentTab);
    }

    state.activeTabIndex = index;
    const newTab = state.tabs[index];
    state.loadFromTab(newTab);

    // Update palette selector UI to match the new active tab
    if (typeof window.syncPaletteSelector === 'function') {
        window.syncPaletteSelector();
    }

    // UI Refresh
    renderTabs();
    updateUIState();
    updateCanvasSize();
    renderCanvas();
    renderOverlay();
    renderFramesList();
    updateLayersList();
    renderPalette();
    if (typeof renderHistory === 'function') renderHistory();

    // Active tab visibility adjustment
    setTimeout(() => {
        const activeTabEl = document.querySelector('.chrome-tab.active');
        if (activeTabEl) activeTabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }, 50);
}

export async function closeTab(index, e) {
    if (e) e.stopPropagation();

    const tab = state.tabs[index];
    if (tab.hasChanges) {
        const confirmed = await showConfirm(
            t('dlg_confirm_title'),
            t('msg_confirm_close_tab')
        );
        if (!confirmed) return;
    }

    // Save for reopen logic
    if (index === state.activeTabIndex) state.saveToTab(tab);
    lastClosedTab = structuredClone(tab);

    if (state.tabs.length <= 1) {
        // Reset single remaining tab state
        state.tabs[0] = new Tab(generateId());
        state.newFileCounter = 1;
        state.tabs[0].idName = 'New File 1';
        state.tabs[0].isNewProject = true;
        state.tabs[0].hasChanges = false;
        switchTab(0);
        return;
    }

    state.tabs.splice(index, 1);

    if (state.activeTabIndex >= index) {
        state.activeTabIndex = Math.max(0, state.activeTabIndex - 1);
    }

    const newActiveTab = state.tabs[state.activeTabIndex];
    state.loadFromTab(newActiveTab);

    renderTabs();
    updateUIState();
    updateCanvasSize();
    renderCanvas();
    renderOverlay();
    renderFramesList();
    updateLayersList();
    renderPalette();
    if (typeof renderHistory === 'function') renderHistory();
}

export function updateCurrentTabName(name, isNewProject = false) {
    if (state.activeTabIndex !== -1) {
        const tab = state.tabs[state.activeTabIndex];
        tab.fileName = name;
        tab.idName = name;
        tab.isNewProject = isNewProject;
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
        const displayName = tab.idName;
        const suffix = isTmp ? (gType === 'ts' ? ' (TS)' : ' (RA2)') : '';
        const finalDisplayName = (hasData || isNew) ? `${displayName}${suffix}` : '';
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
