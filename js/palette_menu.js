import { setupSubmenusRecursive, renderPalette, updateCanvasSize, renderCanvas, renderFramesList, updateLayersList } from './ui.js';
import { updateUIState } from './main.js';
import { GAME_PALETTES } from './game_palettes.js';
import { t } from './translations.js';
import { parsePaletteData, parsePaletteBuffer } from './file_io.js';
import { state } from './state.js';


// palette_menu.js — Palette Library & Palettes Menu Manager
// Provides: PaletteLibrary (localStorage), menu rendering, Custom Palette Manager dialog

// ─────────────────────────────────────────────────────────────
// STORAGE KEY & DEFAULTS
// ─────────────────────────────────────────────────────────────
const PAL_LIB_KEY = 'shpEditor_paletteLib';

// Library structure:
// {
//   custom: [ treeNode, ... ]    <- array of roots
//   lastUsed: [ libEntry, ... ]  <- up to 5, most recent first
//   usageCount: { id: count }
// }
// treeNode: { id, name, type:'folder'|'palette', b64?:'...', children?:[] }
// libEntry: { id, name, path:[] }   path = [rootName, ...folderNames]

let _lib = null;

function _defaultLib() {
    return { custom: [], lastUsed: [], usageCount: {}, pinned: [] };
}

function loadLibrary() {
    try {
        const raw = localStorage.getItem(PAL_LIB_KEY);
        if (raw) {
            _lib = JSON.parse(raw);
            if (!_lib.custom) _lib.custom = [];
            if (!_lib.lastUsed) _lib.lastUsed = [];
            if (!_lib.usageCount) _lib.usageCount = {};
            if (!_lib.pinned) _lib.pinned = [];
        } else {
            _lib = _defaultLib();
        }
    } catch (e) {
        console.error('PaletteLibrary: failed to load from localStorage', e);
        _lib = _defaultLib();
    }
    return _lib;
}

function saveLibrary() {
    try {
        localStorage.setItem(PAL_LIB_KEY, JSON.stringify(_lib));
    } catch (e) {
        console.error('PaletteLibrary: failed to save to localStorage', e);
        if (e.name === 'QuotaExceededError') {
            alert('Palette storage is full. Try deleting some custom palettes to free space.');
        }
    }
}

export function getLib() {
    if (!_lib) loadLibrary();
    return _lib;
}

// ─────────────────────────────────────────────────────────────
// ID UTILITIES
// ─────────────────────────────────────────────────────────────
function generateId() {
    return 'pal_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// ─────────────────────────────────────────────────────────────
// TREE UTILITIES
// ─────────────────────────────────────────────────────────────
export function findNodeById(nodes, id) {
    if (id.startsWith('game_')) {
        // Search in GAME_PALETTES (global)
        for (const cat in GAME_PALETTES) {
            const found = GAME_PALETTES[cat].find(p => p.id === id);
            if (found) return { ...found, type: 'palette' };
        }
    }
    for (const node of nodes) {
        if (node.id === id) return node;
        if (node.type === 'folder' && node.children) {
            const found = findNodeById(node.children, id);
            if (found) return found;
        }
    }
    return null;
}

function findParentArray(nodes, id, parent = null) {
    for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) return { arr: nodes, idx: i, parent };
        if (nodes[i].type === 'folder' && nodes[i].children) {
            const found = findParentArray(nodes[i].children, id, nodes[i]);
            if (found) return found;
        }
    }
    return null;
}

function collectAllIds(nodes) {
    const ids = [];
    for (const node of nodes) {
        ids.push(node.id);
        if (node.type === 'folder' && node.children) {
            ids.push(...collectAllIds(node.children));
        }
    }
    return ids;
}

// Build path array for a given node id (array of names from root)
function buildPath(nodes, id, acc = []) {
    if (id.startsWith('game_')) {
        const node = findNodeById([], id);
        return node ? [node.name] : null;
    }
    for (const node of nodes) {
        if (node.id === id) return [...acc, node.name];
        if (node.type === 'folder' && node.children) {
            const found = buildPath(node.children, id, [...acc, node.name]);
            if (found) return found;
        }
    }
    return null;
}

// ─────────────────────────────────────────────────────────────
// BASE64  <->  ArrayBuffer HELPERS
// ─────────────────────────────────────────────────────────────
function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}

function base64ToBuffer(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}

// ─────────────────────────────────────────────────────────────
import { pushHistory } from './history.js';

// APPLY PALETTE  (shared by menu items AND manager dialog)
// ─────────────────────────────────────────────────────────────
export function applyPaletteFromEntry(entry) {
    // entry: treeNode with b64 data
    try {
        pushHistory(); // Record state before changing palette
        const buffer = base64ToBuffer(entry.b64);
        parsePaletteData(buffer);   // from main app (ui.js / main.js)
        setTimeout(() => {
            if (typeof renderPalette === 'function') renderPalette();
            if (typeof updateCanvasSize === 'function') updateCanvasSize();
            if (typeof renderCanvas === 'function') renderCanvas();
            if (typeof renderFramesList === 'function') renderFramesList();
            if (typeof updateLayersList === 'function') updateLayersList();
            if (typeof updateUIState === 'function') updateUIState();
        }, 50);

        state.paletteVersion++; // Signal UI to refresh thumbnails
        _appliedPaletteId = entry.id;
        refreshPalettesMenuDynamic();
    } catch (e) {
        alert('Error applying palette: ' + e.message);
    }
}

// ─────────────────────────────────────────────────────────────
// USAGE TRACKING & PINNING
// ─────────────────────────────────────────────────────────────
function recordUsage(libEntry) {
    const lib = getLib();
    // Update count
    lib.usageCount[libEntry.id] = (lib.usageCount[libEntry.id] || 0) + 1;
    // Update lastUsed: remove existing entry if present, then prepend
    lib.lastUsed = lib.lastUsed.filter(e => e.id !== libEntry.id);
    lib.lastUsed.unshift({ id: libEntry.id, name: libEntry.name, path: libEntry.path });
    if (lib.lastUsed.length > 8) lib.lastUsed.length = 8;
    saveLibrary();
    // Refresh UI
    refreshAllPaletteMenus();
}

function togglePin(id) {
    const lib = getLib();
    const idx = lib.pinned.indexOf(id);
    if (idx !== -1) {
        lib.pinned.splice(idx, 1);
    } else {
        lib.pinned.push(id);
    }
    saveLibrary();
    refreshAllPaletteMenus();
}

function clearRecentUsage() {
    const lib = getLib();
    lib.lastUsed = [];
    saveLibrary();
    refreshAllPaletteMenus();
    updateManagerButtons();
}



// ─────────────────────────────────────────────────────────────
// MENU RENDERING — Dynamic sections (recently + most used)
// ─────────────────────────────────────────────────────────────
// Helper to create inline SVG game icons
const _GAME_ICON_COLORS = { ts: '#4ade80', ra2: '#f87171', yr: '#a78bfa', cncreloaded: '#f6ad55' };
const _GAME_ICON_LABELS = { ts: 'TS', ra2: 'RA2', yr: 'YR', cncreloaded: 'RL' };

function _createPaletteSvg(size) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.743 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.688-1.688h1.937c3.085 0 5.625-2.54 5.625-5.625 0-4.812-4.034-8.75-10-8.75Z');
    svg.appendChild(path);

    [[13.5, 6.5], [17.5, 10.5], [8.5, 7.5], [6.5, 12.5]].forEach(([cx, cy]) => {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', String(cx));
        c.setAttribute('cy', String(cy));
        c.setAttribute('r', '.5');
        c.setAttribute('fill', 'currentColor');
        svg.appendChild(c);
    });

    return svg;
}
function _createGameIconSvg(category, size) {
    const color = _GAME_ICON_COLORS[category];
    const text = _GAME_ICON_LABELS[category];
    if (!color || !text) return null;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // Maintain aspect ratio 22:16
    const width = Math.round(size * (22 / 16));
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 22 16');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', '22');
    rect.setAttribute('height', '16');
    rect.setAttribute('rx', '3');
    rect.setAttribute('fill', color);
    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', '11'); // Center of 22
    txt.setAttribute('y', '12'); // Perfect vertical centering
    txt.setAttribute('dominant-baseline', 'middle');
    txt.setAttribute('font-size', '11.5');
    txt.setAttribute('font-weight', '900');
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('font-family', 'Inter, system-ui, sans-serif');
    txt.setAttribute('fill', '#000');
    if (category === 'ra2') txt.setAttribute('letter-spacing', '-0.5px');
    txt.textContent = text;
    svg.appendChild(rect);
    svg.appendChild(txt);
    return svg;
}

function buildMenuPaletteItem(entry, node, showGameIcon, onSelect = null) {
    const lib = getLib();
    const isPinned = lib.pinned.includes(entry.id);
    const isActive = _appliedPaletteId === entry.id;

    const div = document.createElement('div');
    div.className = 'menu-action pal-menu-item' + (isActive ? ' menu-checked' : '');
    div.setAttribute('data-title', entry.name);

    // small color strip preview (first 16 colors)
    const strip = createPaletteStrip(node);

    const label = document.createElement('span');
    label.textContent = entry.name;
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';
    label.style.whiteSpace = 'nowrap';
    label.style.flex = '1';

    const pinBtn = document.createElement('span');
    pinBtn.className = 'pal-menu-pin' + (isPinned ? ' pinned' : '');
    pinBtn.setAttribute('data-title', isPinned ? t('tt_unpin_fav') : t('tt_pin_fav'));
    pinBtn.onclick = (e) => {
        e.stopPropagation();
        togglePin(entry.id);
    };

    if (showGameIcon && node && node.category) {
        const gameIcon = _createGameIconSvg(node.category, 14);
        if (gameIcon) {
            gameIcon.style.marginRight = '4px';
            gameIcon.style.verticalAlign = 'middle';
            gameIcon.style.flexShrink = '0';
            div.appendChild(gameIcon);
        }
    } else {
        const palIcon = _createPaletteSvg(14);
        palIcon.style.marginRight = '4px';
        palIcon.style.verticalAlign = 'middle';
        palIcon.style.flexShrink = '0';
        palIcon.style.opacity = '0.5';
        div.appendChild(palIcon);
    }

    div.appendChild(label);
    if (strip) div.appendChild(strip);
    div.appendChild(pinBtn);

    div.addEventListener('click', (e) => {
        if (node && node.b64) {
            e.stopPropagation();

            // Record usage and mark as applied
            const path = buildPath(lib.custom, node.id) || [node.name];
            recordUsage({ id: node.id, name: node.name, path });
            _appliedPaletteId = node.id;

            if (onSelect) {
                onSelect(node);
            } else {
                applyPaletteFromEntry(node);
            }

            closeAllPaletteMenus();
        }
    });
    return div;
}

function createPaletteStrip(node) {
    if (!node || !node.b64) return null;
    const strip = document.createElement('span');
    strip.className = 'pal-menu-strip';
    try {
        const buf = base64ToBuffer(node.b64);
        const pal = parsePaletteBuffer(buf);
        const cvs = document.createElement('canvas');
        cvs.width = 256;
        cvs.height = 1;
        cvs.style.width = '100%';
        cvs.style.height = '100%';
        cvs.style.display = 'block';

        const ctx = cvs.getContext('2d');
        const imgData = ctx.createImageData(256, 1);
        for (let i = 0; i < 256; i++) {
            const c = pal[i] || { r: 24, g: 24, b: 24 };
            imgData.data[i * 4] = c.r;
            imgData.data[i * 4 + 1] = c.g;
            imgData.data[i * 4 + 2] = c.b;
            imgData.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);
        strip.appendChild(cvs);
        return strip;
    } catch (_) {
        return null;
    }
}

function refreshPalettesMenuDynamic() {
    const lib = getLib();

    // Pinned Favorites
    const pinnedSection = document.getElementById('palMenuPinnedSection');
    const pinnedList = document.getElementById('palMenuPinnedList');
    if (pinnedSection && pinnedList) {
        pinnedList.innerHTML = '';
        if (lib.pinned.length > 0) {
            pinnedSection.style.display = '';
            lib.pinned.forEach(id => {
                const node = findNodeById(lib.custom, id);
                if (node) {
                    pinnedList.appendChild(buildMenuPaletteItem({ id, name: node.name }, node, true));
                }
            });
        } else {
            pinnedSection.style.display = 'none';
        }
    }

    // Recently Used (exclude pinned — they're already visible in Pinned Favorites)
    const recentSection = document.getElementById('palMenuRecentSection');
    const recentList = document.getElementById('palMenuRecentList');
    if (recentSection && recentList) {
        recentList.innerHTML = '';
        const pinnedSet = new Set(lib.pinned);
        const valid = lib.lastUsed.filter(e => !pinnedSet.has(e.id) && findNodeById(lib.custom, e.id));
        if (valid.length > 0) {
            recentSection.style.display = '';
            valid.forEach(entry => {
                const node = findNodeById(lib.custom, entry.id);
                recentList.appendChild(buildMenuPaletteItem(entry, node, true));
            });
        } else {
            recentSection.style.display = 'none';
        }
    }



    // Custom submenu
    const customSubmenu = document.getElementById('palCustomSubmenu');
    const customEmpty = document.getElementById('palCustomEmptyMsg');
    if (customSubmenu) {
        // Clear all except the empty msg element
        Array.from(customSubmenu.children).forEach(child => {
            if (child.id !== 'palCustomEmptyMsg') child.remove();
        });
        if (lib.custom.length === 0) {
            if (customEmpty) customEmpty.style.display = '';
        } else {
            if (customEmpty) customEmpty.style.display = 'none';
            renderCustomSubmenuNodes(lib.custom, customSubmenu);
        }
    }

    // Game submenus (TS, RA2, YR, C&C Reloaded)
    if (typeof GAME_PALETTES !== 'undefined') {
        const categories = [
            { id: 'palTsSubmenu', container: 'palMenuTsContainer', trigger: 'triggerPalTS', key: 'ts' },
            { id: 'palRa2Submenu', container: 'palMenuRa2Container', trigger: 'triggerPalRA2', key: 'ra2' },
            { id: 'palYrSubmenu', container: 'palMenuYrContainer', trigger: 'triggerPalYR', key: 'yr' },
            { id: 'palCnCReloadedSubmenu', container: 'palMenuCnCReloadedContainer', trigger: 'triggerPalCnCReloaded', key: 'cncreloaded' }
        ];

        categories.forEach(cat => {
            const container = document.getElementById(cat.container);
            const triggerEl = document.getElementById(cat.trigger);
            if (container) {
                if (GAME_PALETTES[cat.key] && GAME_PALETTES[cat.key].length > 0) {
                    container.style.display = '';
                    renderGameSubmenu(cat.id, GAME_PALETTES[cat.key]);
                    
                    // Inject professional SVG icon into trigger if missing or incorrect
                    if (triggerEl) {
                        const existingIcon = triggerEl.querySelector('.menu-icon');
                        if (existingIcon) {
                            existingIcon.innerHTML = '';
                            const svg = _createGameIconSvg(cat.key, 16);
                            if (svg) {
                                // Ensure standard styling
                                svg.style.display = 'block';
                                existingIcon.appendChild(svg);
                                existingIcon.style.filter = 'none';
                                existingIcon.style.width = '22px';
                                existingIcon.style.height = '16px';
                            }
                        }
                    }
                } else {
                    container.style.display = 'none';
                }
            }
        });
    }

    // Attach hover logic to all potentially new submenus
    const palMenu = document.getElementById('menuItemPalettes');
    if (palMenu) attachSubmenuHoverLogic(palMenu);
}

function renderGameSubmenu(containerId, palettes) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    palettes.forEach(p => {
        const item = buildMenuPaletteItem({ id: p.id, name: p.name }, p, false);
        container.appendChild(item);
    });
}

function attachSubmenuHoverLogic(container) {
    if (typeof setupSubmenusRecursive === 'function') {
        setupSubmenusRecursive(container);
    }
}

export function renderCustomSubmenuNodes(nodes, container, onSelect = null) {
    nodes.forEach(node => {
        if (node.type === 'folder') {
            // submenu wrapper
            const wrapper = document.createElement('div');
            wrapper.className = 'menu-item-submenu';
            const trigger = document.createElement('div');
            trigger.className = 'menu-action submenu-trigger';
            trigger.innerHTML = `<span class="menu-icon pm-icon-folder"></span><span>${escHtml(node.name)}</span><span class="arrow">▶</span>`;
            trigger.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation(); // Prevent closing menu on folder click
            });
            const sub = document.createElement('div');
            sub.className = 'menu-dropdown submenu';
            sub.style.minWidth = '200px';
            if (node.children && node.children.length > 0) {
                renderCustomSubmenuNodes(node.children, sub, onSelect);
            } else {
                const empty = document.createElement('div');
                empty.className = 'pal-menu-section-label';
                empty.textContent = '(empty)';
                sub.appendChild(empty);
            }
            wrapper.appendChild(trigger);
            wrapper.appendChild(sub);
            container.appendChild(wrapper);
        } else {
            // palette item
            const item = buildMenuPaletteItem({ id: node.id, name: node.name }, node, false, onSelect);
            container.appendChild(item);
        }
    });
}

function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────
// CUSTOM PALETTE MANAGER DIALOG
// ─────────────────────────────────────────────────────────────
let _mgrSelection = new Set(); // selected node IDs
let _mgrLastClickId = null;    // for shift-click range
let _mgrFlatOrder = [];        // flat ordered list of visible IDs (for shift-range)
let _mgrDragSrcIds = [];       // drag source IDs for multi-move
let _mgrExpandState = {};      // { folderId: true/false }
let _mgrOnSelectCallback = null; // Callback for double-click selection

let _appliedPaletteId = null;  // Track currently applied palette

function showPrompt(title, message, defaultValue = "") {
    return new Promise((resolve) => {
        const dlg = document.getElementById('promptModal');
        const inp = document.getElementById('promptInput');
        const titleEl = document.getElementById('promptTitle');
        const msgEl = document.getElementById('promptMessage');
        const btnOk = document.getElementById('btnPromptOk');
        const btnCancel = document.getElementById('btnPromptCancel');

        if (!dlg || !inp) {
            resolve(prompt(message, defaultValue));
            return;
        }

        titleEl.textContent = title;
        msgEl.textContent = message;
        inp.value = defaultValue;

        const cleanup = (val) => {
            btnOk.onclick = null;
            btnCancel.onclick = null;
            inp.onkeydown = null;
            dlg.oncancel = null;
            if (dlg.open) dlg.close();
            resolve(val);
        };

        btnOk.onclick = () => cleanup(inp.value);
        btnCancel.onclick = () => cleanup(null);
        inp.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                cleanup(inp.value);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cleanup(null);
            }
        };
        dlg.oncancel = (e) => {
            e.preventDefault();
            cleanup(null);
        };

        dlg.showModal();
        inp.select();
        inp.focus();
    });
}

function openPaletteManager(onSelect = null) {
    const dlg = document.getElementById('dlgPaletteManager');
    if (!dlg) return;
    _mgrOnSelectCallback = onSelect;
    _mgrSelection.clear();
    _mgrLastClickId = null;

    // Default selection: "Custom" folder
    const lib = getLib();
    if (lib.custom && lib.custom.length > 0) {
        // Find roots or just select first root-level folder
        const customRoot = lib.custom.find(n => n.type === 'folder' && n.name === 'Custom');
        if (customRoot) {
            _mgrSelection.add(customRoot.id);
            _mgrExpandState[customRoot.id] = true;
        } else {
            // fallback to first item
            _mgrSelection.add(lib.custom[0].id);
        }
    }

    renderManagerTree();
    updateManagerPreview();
    updateManagerButtons();
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
}

function closePaletteManager() {
    const dlg = document.getElementById('dlgPaletteManager');
    if (dlg) {
        if (typeof dlg.close === 'function') dlg.close();
        else dlg.removeAttribute('open');
    }
    _mgrOnSelectCallback = null;
    refreshAllPaletteMenus();
}

// ── TREE RENDER ───────────────────────────────────────────────
function renderManagerTree() {
    const tree = document.getElementById('palMgrTree');
    if (!tree) return;
    _mgrFlatOrder = [];
    tree.innerHTML = '';
    const lib = getLib();

    // Add "Root / Custom" drop target
    const rootTarget = document.createElement('div');
    rootTarget.className = 'pm-tree-item pm-root-target';
    rootTarget.innerHTML = `<span class="pm-icon-folder" style="filter:grayscale(1) opacity(0.5)"></span><span style="color:#718096">${t('lbl_move_to_root', 'Move to Root (Custom)')}</span>`;
    rootTarget.style.paddingLeft = '12px';
    rootTarget.addEventListener('dragover', (e) => {
        const isExternal = e.dataTransfer.types.includes('Files');
        if (isExternal || _mgrDragSrcIds.length > 0) {
            e.preventDefault();
            rootTarget.classList.add('pm-drag-over');
        }
    });
    rootTarget.addEventListener('dragleave', () => rootTarget.classList.remove('pm-drag-over'));
    rootTarget.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        rootTarget.classList.remove('pm-drag-over');
        if (e.dataTransfer.files && e.dataTransfer.files.length) {
            const files = Array.from(e.dataTransfer.files).filter(f =>
                f.name.toLowerCase().endsWith('.pal') || f.name.toLowerCase().endsWith('.txt')
            );
            if (files.length) {
                await mgrImportFiles(files, 'root');
                return;
            }
        }
        if (_mgrDragSrcIds.length > 0) {
            mgrMoveNodes(_mgrDragSrcIds, 'root', 'into');
        }
    });
    tree.appendChild(rootTarget);

    // 1. Custom Tree
    renderManagerNodes(lib.custom, tree, 0);


}

function renderManagerNodes(nodes, container, depth) {
    nodes.forEach(node => {
        const item = document.createElement('div');
        item.className = 'pm-tree-item';
        item.dataset.id = node.id;
        item.dataset.type = node.type;
        item.style.paddingLeft = (12 + depth * 18) + 'px';
        item.draggable = true;

        if (_mgrSelection.has(node.id)) item.classList.add('selected');

        if (node.type === 'folder') {
            const open = _mgrExpandState[node.id] !== false; // default expanded
            const arrow = document.createElement('span');
            arrow.className = 'pm-tree-arrow';
            arrow.textContent = open ? '▾' : '▸';
            arrow.style.marginRight = '4px';
            arrow.style.cursor = 'pointer';
            arrow.addEventListener('click', (e) => {
                e.stopPropagation();
                _mgrExpandState[node.id] = !(_mgrExpandState[node.id] !== false);
                renderManagerTree();
            });
            const icon = document.createElement('span');
            icon.className = 'pm-tree-icon';
            if (node.id.startsWith('game_folder_')) {
                // Inline SVG game icon for virtual game folders
                const category = node.id.replace('game_folder_', '');
                const svg = _createGameIconSvg(category, 16);
                if (svg) {
                    svg.style.marginRight = '6px';
                    svg.style.verticalAlign = 'middle';
                    icon.appendChild(svg);
                } else {
                    icon.className = 'pm-icon-folder';
                }
            } else {
                icon.className = 'pm-icon-folder';
            }

            const label = document.createElement('span');
            label.textContent = node.name;
            item.setAttribute('data-title', node.name); // Premium tooltip
            item.appendChild(arrow);
            item.appendChild(icon);
            item.appendChild(label);

            _mgrFlatOrder.push(node.id);
            container.appendChild(item);

            if (open) {
                const childContainer = document.createElement('div');
                childContainer.className = 'pm-tree-children';
                childContainer.dataset.parentId = node.id;
                container.appendChild(childContainer);
                if (node.children && node.children.length > 0) {
                    renderManagerNodes(node.children, childContainer, depth + 1);
                } else {
                    const emptyMsg = document.createElement('div');
                    emptyMsg.style.cssText = `padding-left:${12 + (depth + 1) * 18}px; font-size:11px; color:#555; font-style:italic;`;
                    emptyMsg.textContent = '(empty folder)';
                    childContainer.appendChild(emptyMsg);
                }
            }
        } else {
            const icon = document.createElement('span');
            icon.className = 'pm-icon-palette';

            const label = document.createElement('span');
            label.className = 'pm-label';
            label.textContent = node.name;
            label.style.flex = '1';
            label.style.overflow = 'hidden';
            label.style.textOverflow = 'ellipsis';
            label.style.marginRight = '10px';

            item.setAttribute('data-title', node.name); // Premium tooltip
            item.appendChild(icon);
            item.appendChild(label);

            const strip = createPaletteStrip(node);
            if (strip) {
                strip.style.width = '220px'; // Requested width
                strip.style.flexShrink = '0';
                strip.style.height = '14px';
                strip.style.marginRight = 'auto'; // Keep it to the left
                item.appendChild(strip);
            }

            _mgrFlatOrder.push(node.id);
            container.appendChild(item);

            // Double click to apply and close
            item.addEventListener('dblclick', () => {
                if (node.b64) {
                    if (_mgrOnSelectCallback) {
                        _mgrOnSelectCallback(node);
                    } else {
                        applyPaletteFromEntry(node);
                    }
                    closePaletteManager();
                }
            });
        }

        // Click: single/multi select
        item.addEventListener('click', (e) => {
            if (e.shiftKey && _mgrLastClickId) {
                // Range select
                const fromIdx = _mgrFlatOrder.indexOf(_mgrLastClickId);
                const toIdx = _mgrFlatOrder.indexOf(node.id);
                if (fromIdx !== -1 && toIdx !== -1) {
                    const lo = Math.min(fromIdx, toIdx);
                    const hi = Math.max(fromIdx, toIdx);
                    if (!e.ctrlKey) _mgrSelection.clear();
                    for (let i = lo; i <= hi; i++) _mgrSelection.add(_mgrFlatOrder[i]);
                }
            } else if (e.ctrlKey || e.metaKey) {
                if (_mgrSelection.has(node.id)) _mgrSelection.delete(node.id);
                else _mgrSelection.add(node.id);
            } else {
                _mgrSelection.clear();
                _mgrSelection.add(node.id);
            }
            _mgrLastClickId = node.id;
            renderManagerTree();
            updateManagerPreview();
            updateManagerButtons();
        });

        // Drag source
        item.addEventListener('dragstart', (e) => {
            if (_mgrSelection.has(node.id)) {
                _mgrDragSrcIds = Array.from(_mgrSelection);
            } else {
                _mgrDragSrcIds = [node.id];
            }
            item.classList.add('pm-dragging');
            // If dragging multiple, visually mark them all
            _mgrDragSrcIds.forEach(id => {
                const el = document.querySelector(`.pm-tree-item[data-id="${id}"]`);
                if (el) el.classList.add('pm-dragging');
            });
            e.dataTransfer.effectAllowed = 'move';
        });
        item.addEventListener('dragend', () => {
            _mgrDragSrcIds = [];
            document.querySelectorAll('.pm-tree-item.pm-dragging').forEach(el => el.classList.remove('pm-dragging'));
            document.querySelectorAll('.pm-tree-item.pm-drag-over').forEach(el => el.classList.remove('pm-drag-over'));
        });

        // Drop target
        item.addEventListener('dragover', (e) => {
            const isExternal = e.dataTransfer.types.includes('Files');
            const isInternal = _mgrDragSrcIds.length > 0 && !_mgrDragSrcIds.includes(node.id);
            if (isExternal || isInternal) {
                e.preventDefault();
                item.classList.add('pm-drag-over');
            }
        });
        item.addEventListener('dragleave', () => item.classList.remove('pm-drag-over'));
        item.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            item.classList.remove('pm-drag-over');

            if (e.dataTransfer.files && e.dataTransfer.files.length) {
                const files = Array.from(e.dataTransfer.files).filter(f =>
                    f.name.toLowerCase().endsWith('.pal') || f.name.toLowerCase().endsWith('.txt')
                );
                if (files.length) {
                    await mgrImportFiles(files, node.id);
                    return;
                }
            }

            if (_mgrDragSrcIds.length === 0 || _mgrDragSrcIds.includes(node.id)) return;
            mgrMoveNodes(_mgrDragSrcIds, node.id, node.type === 'folder' ? 'into' : 'before');
        });
    });
}

// ── DRAG MOVE ─────────────────────────────────────────────────
function mgrMoveNodes(srcIds, targetId, mode) {
    const lib = getLib();
    const nodesToMove = [];

    // First collect and remove all nodes from their parents
    srcIds.forEach(id => {
        const info = findParentArray(lib.custom, id);
        if (info) {
            const node = info.arr[info.idx];
            // Security: Don't move a folder into itself or its children
            if (isDescendant(node, targetId)) return;
            info.arr.splice(info.idx, 1);
            nodesToMove.push(node);
        }
    });

    if (nodesToMove.length === 0) return;

    if (mode === 'into') {
        if (targetId === 'root') {
            lib.custom.push(...nodesToMove);
        } else {
            const targetNode = findNodeById(lib.custom, targetId);
            if (!targetNode || targetNode.type !== 'folder') {
                lib.custom.push(...nodesToMove);
            } else {
                if (!targetNode.children) targetNode.children = [];
                targetNode.children.push(...nodesToMove);
            }
        }
    } else {
        const tgtInfo = findParentArray(lib.custom, targetId);
        if (!tgtInfo) {
            lib.custom.push(...nodesToMove);
        } else {
            tgtInfo.arr.splice(tgtInfo.idx, 0, ...nodesToMove);
        }
    }

    saveLibrary();
    renderManagerTree();
    refreshAllPaletteMenus();
}

function isDescendant(parentFolder, targetId) {
    if (parentFolder.id === targetId) return true;
    if (parentFolder.children) {
        for (const child of parentFolder.children) {
            if (isDescendant(child, targetId)) return true;
        }
    }
    return false;
}

// ── PREVIEW ───────────────────────────────────────────────────
function updateManagerPreview() {
    const grid = document.getElementById('palMgrPreviewGrid');
    const nameEl = document.getElementById('palMgrPreviewName');
    const applyBtn = document.getElementById('btnPalMgrApply');
    if (!grid) return;

    // Single palette selection
    if (_mgrSelection.size === 1) {
        const id = [..._mgrSelection][0];
        const node = findNodeById(getLib().custom, id);
        if (node && node.type === 'palette' && node.b64) {
            try {
                const buf = base64ToBuffer(node.b64);
                const pal = parsePaletteBuffer(buf);
                if (typeof renderPaletteSimple === 'function') {
                    renderPaletteSimple(pal, grid);
                }
                if (nameEl) nameEl.textContent = node.name;
                if (applyBtn) applyBtn.disabled = false;
                return;
            } catch (e) { /* fall through */ }
        }
    }
    // Clear preview
    if (typeof renderPaletteSimple === 'function') {
        renderPaletteSimple([], grid);
    } else {
        grid.innerHTML = '';
    }
    if (nameEl) nameEl.textContent = _mgrSelection.size > 1 ? `${_mgrSelection.size} items selected` : '';
    if (applyBtn) applyBtn.disabled = true;
}

function updateManagerButtons() {
    const renameBtn = document.getElementById('btnPalMgrRename');
    const deleteBtn = document.getElementById('btnPalMgrDelete');
    const clearRecentBtn = document.getElementById('btnPalMgrClearRecent');

    if (renameBtn) renameBtn.disabled = _mgrSelection.size !== 1;
    if (deleteBtn) deleteBtn.disabled = _mgrSelection.size === 0;

    const lib = getLib();
    if (clearRecentBtn) clearRecentBtn.disabled = (lib.lastUsed || []).length === 0;
}

// ── FILE IMPORT ───────────────────────────────────────────────
async function mgrImportFiles(files, forcedTargetId = null) {
    const lib = getLib();
    let imported = 0;

    // Determine destination
    let targetId = forcedTargetId;
    if (!targetId && _mgrSelection.size === 1) {
        targetId = [..._mgrSelection][0];
    }

    let destArray = lib.custom;
    let targetFolderNode = null;

    if (targetId && targetId !== 'root') {
        const node = findNodeById(lib.custom, targetId);
        if (node) {
            if (node.type === 'folder') {
                if (!node.children) node.children = [];
                destArray = node.children;
                targetFolderNode = node;
            } else {
                // It's a palette, use its parent's children array
                const info = findParentArray(lib.custom, targetId);
                if (info && info.parent) {
                    destArray = info.parent.children;
                    targetFolderNode = info.parent;
                }
            }
        }
    }

    for (const file of files) {
        try {
            const buf = await file.arrayBuffer();
            // Validate
            parsePaletteBuffer(buf);
            const name = file.name.replace(/\.pal$/i, '').replace(/\.txt$/i, '');
            const node = { id: generateId(), name, type: 'palette', b64: bufferToBase64(buf) };

            destArray.push(node);
            imported++;

            // Ensure parent is expanded so user sees where it went
            if (targetFolderNode) {
                _mgrExpandState[targetFolderNode.id] = true;
            }
        } catch (e) {
            console.warn('Failed to import', file.name, e.message);
        }
    }

    saveLibrary();
    renderManagerTree();
    refreshAllPaletteMenus();

    if (imported > 0) {
        console.log(`Imported ${imported} palette(s)`);
    } else if (files.length > 0) {
        alert('None of the selected files could be read as valid palettes (JASC-PAL or 768-byte binary).');
    }
}

// ── TOOLBAR ACTIONS ───────────────────────────────────────────
async function mgrNewFolder() {
    const name = await showPrompt('NEW FOLDER', 'Enter folder name:');
    if (!name || !name.trim()) return;
    const lib = getLib();
    const node = { id: generateId(), name: name.trim(), type: 'folder', children: [] };
    // Insert inside selected folder, or at root
    const targetId = _mgrSelection.size === 1 ? [..._mgrSelection][0] : null;
    const targetNode = targetId ? findNodeById(lib.custom, targetId) : null;
    if (targetNode && targetNode.type === 'folder') {
        if (!targetNode.children) targetNode.children = [];
        targetNode.children.unshift(node);
        _mgrExpandState[targetNode.id] = true;
    } else {
        lib.custom.unshift(node);
    }
    saveLibrary();
    _mgrSelection.clear();
    _mgrSelection.add(node.id);
    renderManagerTree();
    refreshAllPaletteMenus();
}

async function mgrRename() {
    if (_mgrSelection.size !== 1) return;
    const id = [..._mgrSelection][0];
    const node = findNodeById(getLib().custom, id);
    if (!node) return;
    const isFolder = node.type === 'folder';
    const current = node.name;
    const newName = await showPrompt('RENAME', `Enter new name for ${isFolder ? 'folder' : 'palette'}:`, current);
    if (!newName || !newName.trim() || newName.trim() === current) return;
    node.name = newName.trim();
    saveLibrary();
    renderManagerTree();
    refreshAllPaletteMenus();
}

/**
 * Generates an HTML string for a small color strip preview of a palette.
 */
function generatePaletteStripHTML(node) {
    if (!node || node.type !== 'palette' || !node.b64) return "";
    try {
        const buf = base64ToBuffer(node.b64);
        const pal = (typeof parsePaletteBuffer === 'function') ? parsePaletteBuffer(buf) : null;
        if (!pal) return "";

        let html = '<div style="display:inline-flex; vertical-align:middle; width:100px; height:10px; margin-left:10px; border:1px solid rgba(255,255,255,0.2); border-radius:1px; overflow:hidden; background:#000; line-height:0;">';
        for (let i = 0; i < 256; i++) {
            const c = pal[i] || { r: 0, g: 0, b: 0 };
            html += `<div style="flex:1; height:100%; background:rgb(${c.r},${c.g},${c.b});"></div>`;
        }
        html += '</div>';
        return html;
    } catch (e) { return ""; }
}

async function mgrDelete() {
    if (_mgrSelection.size === 0) return;
    const lib = getLib();
    // Collect all nodes to delete (including children of selected folders)
    const allToDelete = new Set();
    _mgrSelection.forEach(id => {
        allToDelete.add(id);
        const node = findNodeById(lib.custom, id);
        if (node && node.type === 'folder') {
            collectAllIds(node.children || []).forEach(cid => allToDelete.add(cid));
        }
    });
    // Build readable names list for confirmation
    const names = [];
    _mgrSelection.forEach(id => {
        const node = findNodeById(lib.custom, id);
        if (node) {
            const strip = node.type === 'palette' ? generatePaletteStripHTML(node) : '';
            const typeSuffix = node.type === 'folder' ? ' (folder + contents)' : '';
            names.push(`
                <div style="display:flex; align-items:center; justify-content:space-between; gap:15px; margin-bottom:4px; width:100%;">
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:400px;" title="${node.name}${typeSuffix}">
                        • ${node.name}${typeSuffix}
                    </span>
                    ${strip}
                </div>
            `);
        }
    });

    const title = `Delete ${_mgrSelection.size} item(s)?`;
    const message = `${t("msg_delete_confirm")}<br><br><div style="text-align:left; padding-left:20px; color:#f56565;">${names.join("<br>")}</div><br>${t("msg_cannot_be_undone")}`;

    // Dynamic import to avoid circular dependency if possible, though they are usually co-resident
    const Conf = window.showConfirm || (await import('./ui.js')).showConfirm;
    const confirmed = await Conf(title, message);
    if (!confirmed) return;

    // Remove nodes
    _mgrSelection.forEach(id => {
        const info = findParentArray(lib.custom, id);
        if (info) info.arr.splice(info.idx, 1);
    });
    // Clean up usageCount + lastUsed for all deleted IDs
    allToDelete.forEach(id => {
        delete lib.usageCount[id];
    });
    lib.lastUsed = lib.lastUsed.filter(e => !allToDelete.has(e.id));

    saveLibrary();
    _mgrSelection.clear();
    _mgrLastClickId = null;
    renderManagerTree();
    updateManagerPreview();
    updateManagerButtons();
    refreshAllPaletteMenus();
}

function refreshAllPaletteMenus() {
    // Standard menu
    refreshPalettesMenuDynamic();
    // New SHP dialog menu
    refreshDialogPaletteMenu('newPalettesMenuDropdown', (node) => {
        if (typeof parsePaletteBuffer === 'function') {
            const buf = base64ToBuffer(node.b64);
            const palArray = parsePaletteBuffer(buf);

            // Set global for main.js to pick up
            window.tempNewShpPalette = palArray;

            if (typeof renderPaletteSimple === 'function') {
                renderPaletteSimple(palArray, document.getElementById('newShpPalPreview'));
            }

            const info = document.getElementById('newShpPalInfo');
            if (info) info.innerText = `Selected: ${node.name}`;

            // Enable Create Button
            const btnCreate = document.getElementById('btnNewShpCreate');
            if (btnCreate) {
                btnCreate.disabled = false;
                btnCreate.removeAttribute('disabled');
                btnCreate.style.opacity = '1';
                btnCreate.style.cursor = 'pointer';
                btnCreate.style.pointerEvents = 'auto';
            }
        }
    });
    // Open SHP dialog menu
    refreshDialogPaletteMenu('impPalettesMenuDropdown', (node) => {
        if (typeof parsePaletteBuffer === 'function') {
            const buf = base64ToBuffer(node.b64);
            const palArray = parsePaletteBuffer(buf);

            // Call syncImporterPalette if it exists (import_shp.js)
            if (typeof syncImporterPalette === 'function') {
                syncImporterPalette(palArray);
            } else {
                // Fallback for bundle
                if (window.syncImporterPalette) window.syncImporterPalette(palArray);
            }

            if (typeof renderPaletteSimple === 'function') {
                renderPaletteSimple(palArray, document.getElementById('impShpPalGrid'));
            }

            console.log("Selected import palette:", node.name);
            const btnOpen = document.getElementById('btnConfirmImpShp');
            if (btnOpen && window.curImportShpData) btnOpen.disabled = false;
        }
    });

    // External SHP dialog menu
    refreshDialogPaletteMenu('extPalettesMenuDropdown', (node) => {
        if (typeof window.syncExternalPalette === 'function') {
            window.syncExternalPalette(node);
        }
    });
}

function refreshDialogPaletteMenu(dropdownId, onSelect) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    dropdown.innerHTML = '';
    const lib = getLib();

    // Set consistent min-width and ensure it's readable
    dropdown.style.minWidth = '320px';
    dropdown.style.maxWidth = '450px';

    // 1. Pinned Favorites
    if (lib.pinned.length > 0) {
        const label = document.createElement('div');
        label.className = 'pal-menu-section-label';
        label.innerHTML = `<span class="section-icon pm-icon-pin"></span>${t("lbl_pinned")}`;
        dropdown.appendChild(label);
        lib.pinned.forEach(id => {
            const node = findNodeById(lib.custom, id);
            if (node) dropdown.appendChild(buildMenuPaletteItem({ id, name: node.name }, node, true, onSelect));
        });
        dropdown.appendChild(document.createElement('div')).className = 'menu-divider';
    }

    // 2. Recently Used
    const pinnedSet = new Set(lib.pinned);
    const validRecent = lib.lastUsed.filter(e => !pinnedSet.has(e.id) && findNodeById(lib.custom, e.id));
    if (validRecent.length > 0) {
        const label = document.createElement('div');
        label.className = 'pal-menu-section-label';
        label.textContent = t("lbl_recent_used");
        dropdown.appendChild(label);
        validRecent.forEach(entry => {
            const node = findNodeById(lib.custom, entry.id);
            dropdown.appendChild(buildMenuPaletteItem(entry, node, true, onSelect));
        });
        dropdown.appendChild(document.createElement('div')).className = 'menu-divider';
    }



    // 3. Custom (as a sub-tree flattened or just the roots)
    const custTrigger = document.createElement('div');
    custTrigger.className = 'menu-item-submenu';
    custTrigger.innerHTML = `
        <div class="menu-action submenu-trigger">
            <span class="menu-icon pm-icon-folder"></span><span>${t("lbl_custom")}</span><span class="arrow">▶</span>
        </div>
        <div class="menu-dropdown submenu" style="min-width:200px;"></div>
    `;
    const custSub = custTrigger.querySelector('.submenu');
    if (lib.custom.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'pal-menu-section-label';
        empty.textContent = t("lbl_empty");
        custSub.appendChild(empty);
    } else {
        renderCustomSubmenuNodes(lib.custom, custSub, onSelect);
    }
    dropdown.appendChild(custTrigger);

    // 4. Games
    const games = [
        { id: 'TS', name: 'Tiberian Sun', subId: 'palTsSubmenu_dlg_' + dropdownId, nodes: GAME_PALETTES.ts },
        { id: 'RA2', name: 'Red Alert 2', subId: 'palRa2Submenu_dlg_' + dropdownId, nodes: GAME_PALETTES.ra2 },
        { id: 'YR', name: 'Yuri\'s Revenge', subId: 'palYrSubmenu_dlg_' + dropdownId, nodes: GAME_PALETTES.yr }
    ];

    games.forEach(g => {
        const gTrigger = document.createElement('div');
        gTrigger.className = 'menu-item-submenu';
        gTrigger.innerHTML = `
            <div class="menu-action submenu-trigger">
                <span class="menu-icon pm-icon-${g.id.toLowerCase()}"></span><span>${g.name}</span><span class="arrow">▶</span>
            </div>
            <div class="menu-dropdown submenu" style="min-width:200px;"></div>
        `;
        const gSub = gTrigger.querySelector('.submenu');
        // Inject SVG
        const iconContainer = gTrigger.querySelector('.menu-icon');
        const svg = _createGameIconSvg(g.id.toLowerCase(), 14);
        if (svg) { iconContainer.innerHTML = ''; iconContainer.appendChild(svg); }

        (g.nodes || []).forEach(p => {
            gSub.appendChild(buildMenuPaletteItem({ id: p.id, name: p.name }, p, false, onSelect));
        });
        dropdown.appendChild(gTrigger);
    });

    // Handle submenu hover (fixed positioning to avoid scroll clipping)
    attachSubmenuHoverLogic(dropdown);

    // 6. Manage Custom Palettes Link
    const manage = document.createElement('div');
    manage.className = 'menu-action';
    manage.style.borderTop = '1px solid #2d3748';
    manage.style.marginTop = '4px';
    manage.innerHTML = `<span class="menu-icon pm-icon-manage"></span><span>${t("menu_manage_palettes")}</span>`;
    manage.onclick = (e) => {
        e.stopPropagation();
        openPaletteManager(onSelect);
        // Close menu
        document.querySelectorAll('.menu-item.open').forEach(m => m.classList.remove('open'));
        dropdown.classList.remove('active');
    };
    dropdown.appendChild(manage);
}

// ── CLOSING UTILITIES ─────────────────────────────────────────
export function closeAllPaletteMenus() {
    document.querySelectorAll('.menu-item.active').forEach(m => {
        m.classList.remove('active');
        const dd = m.querySelector('.menu-dropdown');
        if (dd) {
            dd.style.display = '';
            dd.style.visibility = '';
            dd.style.opacity = '';
            dd.style.position = '';
            dd.style.pointerEvents = '';
        }
    });
}

// ── INITIALIZATION  (called from main.js / setupPaletteMenu)
// ─────────────────────────────────────────────────────────────
export function setupPaletteMenu() {
    loadLibrary();

    // ── Open manager ──────────────────────────────────────────
    const menuManage = document.getElementById('menuManagePalettes');
    if (menuManage) {
        menuManage.addEventListener('click', () => {
            openPaletteManager();
        });
    }

    // ── Close manager ─────────────────────────────────────────
    const btnClose = document.getElementById('btnClosePalManager');
    if (btnClose) btnClose.addEventListener('click', closePaletteManager);

    // ── Clear History ──────────────────────────────────────────
    const btnClearRecent = document.getElementById('btnPalMgrClearRecent');
    if (btnClearRecent) btnClearRecent.addEventListener('click', clearRecentUsage);

    // ── Toolbar actions ───────────────────────────────────────
    const btnNewFolder = document.getElementById('btnPalMgrNewFolder');
    if (btnNewFolder) btnNewFolder.addEventListener('click', mgrNewFolder);

    const btnRename = document.getElementById('btnPalMgrRename');
    if (btnRename) btnRename.addEventListener('click', mgrRename);

    const btnDelete = document.getElementById('btnPalMgrDelete');
    if (btnDelete) btnDelete.addEventListener('click', mgrDelete);

    const btnApply = document.getElementById('btnPalMgrApply');
    if (btnApply) {
        btnApply.addEventListener('click', () => {
            if (_mgrSelection.size === 1) {
                const id = [..._mgrSelection][0];
                const node = findNodeById(getLib().custom, id);
                if (node && node.type === 'palette' && node.b64) {
                    applyPaletteFromEntry(node);
                    closePaletteManager();
                }
            }
        });
    }

    // ── Prevent closure on folder triggers ──────────────────
    ['triggerPalCustom', 'triggerPalTS', 'triggerPalRA2', 'triggerPalYR'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', e => e.stopPropagation());

            // Re-inject SVG icons for game triggers in the main menu
            const category = id.replace('triggerPal', '').toLowerCase();
            if (['ts', 'ra2', 'yr'].includes(category)) {
                const iconContainer = el.querySelector('.menu-icon');
                if (iconContainer) {
                    iconContainer.innerHTML = '';
                    const svg = _createGameIconSvg(category, 14);
                    if (svg) iconContainer.appendChild(svg);
                }
            }
        }
    });

    // ── File input (Browse button) ────────────────────────────
    const fileInMgr = document.getElementById('fileInPalManager');
    if (fileInMgr) {
        fileInMgr.addEventListener('change', async (e) => {
            if (!e.target.files.length) return;
            await mgrImportFiles(Array.from(e.target.files));
            e.target.value = '';
        });
    }

    // ── Drop Zone drag & drop  ────────────────────────────────
    const dropZone = document.getElementById('palMgrDropZone');
    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('pm-drop-zone-active');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('pm-drop-zone-active'));
        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropZone.classList.remove('pm-drop-zone-active');
            const files = Array.from(e.dataTransfer.files).filter(f =>
                f.name.toLowerCase().endsWith('.pal') || f.name.toLowerCase().endsWith('.txt')
            );
            if (files.length) await mgrImportFiles(files);
        });
        dropZone.addEventListener('click', (e) => {
            document.getElementById('fileInPalManager')?.click();
        });
    }

    // ── Tree drop zone (drop files onto tree for root-level add) ─
    const treeEl = document.getElementById('palMgrTree');
    if (treeEl) {
        treeEl.addEventListener('dragover', (e) => {
            // Allow dropping files (from OS) onto tree area
            if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                treeEl.classList.add('pm-drag-over');
            }
        });
        treeEl.addEventListener('dragleave', () => treeEl.classList.remove('pm-drag-over'));
        treeEl.addEventListener('drop', async (e) => {
            treeEl.classList.remove('pm-drag-over');
            if (e.dataTransfer.files && e.dataTransfer.files.length) {
                e.preventDefault();
                const files = Array.from(e.dataTransfer.files).filter(f =>
                    f.name.toLowerCase().endsWith('.pal') || f.name.toLowerCase().endsWith('.txt')
                );
                if (files.length) await mgrImportFiles(files);
            }
        });
    }

    // ── Palettes menu: refresh dynamic sections on open ───────
    const menuItemPalettes = document.getElementById('menuItemPalettes');
    if (menuItemPalettes) {
        menuItemPalettes.addEventListener('mouseenter', refreshPalettesMenuDynamic);
    }

    // Dialog menus: Click to toggle (floating menu behavior)
    ['menuItemNewPalettes', 'menuItemImpPalettes', 'menuItemExtPalettes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const btn = el.querySelector('.menu-btn');
            const dropdown = el.querySelector('.menu-dropdown');

            if (btn && dropdown) {
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const wasActive = el.classList.contains('active');
                    console.log(`TRACE: Toggle menu ${id}, wasActive: ${wasActive}`);

                    closeAllPaletteMenus();

                    if (!wasActive) {
                        el.classList.add('active');
                        refreshAllPaletteMenus();

                        // Truly floating: use fixed positioning and getBoundingClientRect
                        const rect = btn.getBoundingClientRect();
                        dropdown.style.position = 'fixed';
                        dropdown.style.display = 'block';
                        dropdown.style.visibility = 'visible';
                        dropdown.style.opacity = '1';
                        dropdown.style.zIndex = '2000000'; // Even higher
                        dropdown.style.top = (rect.bottom + 4) + 'px';
                        dropdown.style.left = rect.left + 'px';
                        dropdown.style.width = Math.max(rect.width, 320) + 'px';
                        dropdown.style.pointerEvents = 'auto';

                        console.log(`TRACE: Menu ${id} OPENED`);
                    }
                };
            }
        }
    });

    // Global click to close
    document.addEventListener('click', (e) => {
        // Only close if not clicking inside a menu
        if (!e.target.closest('.menu-item')) {
            closeAllPaletteMenus();
        }
    });

    // Initial render
    refreshAllPaletteMenus();

    // Start with the most recently used palette if available
    const lastId = getMostRecentPaletteId();
    if (lastId) applyPaletteById(lastId);
}

// ─────────────────────────────────────────────────────────────
// PUBLIC API for Recent Files palette integration
// ─────────────────────────────────────────────────────────────


export function getActivePaletteId() {
    return _appliedPaletteId;
}

export function applyPaletteById(id) {
    if (!id) return false;
    const lib = getLib();
    const node = findNodeById(lib.custom, id);
    if (node && node.b64) {
        applyPaletteFromEntry(node);
        return true;
    }
    return false;
}

export function getMostRecentPaletteId() {
    const lib = getLib();
    if (lib.lastUsed && lib.lastUsed.length > 0) {
        // Return the first recent palette that still exists
        for (const entry of lib.lastUsed) {
            const node = findNodeById(lib.custom, entry.id);
            if (node && node.b64) return entry.id;
        }
    }
    return null;
}

export function getPaletteName(id) {
    if (!id) return null;
    const lib = getLib();
    const node = findNodeById(lib.custom, id);
    return node ? node.name : null;
}

