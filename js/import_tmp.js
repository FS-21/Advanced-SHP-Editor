import { TmpTsFile } from './tmp_format.js';
import { state, TRANSPARENT_COLOR } from './state.js';
import { SVG_PLAY_MODERN as SVG_PLAY, SVG_PAUSE_MODERN as SVG_PAUSE, SVG_STEP_FWD_MODERN as SVG_STEP_FORWARD } from './utils.js';
import { elements, LAND_TYPE_NAMES, getLandTypeName, getRampTypeName } from './constants.js';
import { t } from './translations.js';
import { GAME_PALETTES } from './game_palettes.js';
import { parsePaletteBuffer } from './file_io.js';
import { updatePaletteSelectorUI, getActivePaletteName, getActivePaletteId, getLib, findNodeById } from './palette_menu.js';
import { renderPaletteSimple } from './ui.js';

let importPaletteSelectedManually = false;
let _lastImpPaletteNodeId = null;

export function setLastImpPaletteNodeId(id) {
    _lastImpPaletteNodeId = id;
}

let impTmpPalette = new Array(256).fill(null);
let impTmpData = null; // { header, tiles, numTiles }
let impTmpBuffer = null; // raw ArrayBuffer for editor loading
let impTmpFrameIdx = 0;
let impTmpTimer = null;

export function initImportTmp(onConfirm) {
    // Initialize Grid
    tmp_initImportGrid();

    // Initialize Icons
    if (elements.btnImpTmpPlay) elements.btnImpTmpPlay.innerHTML = SVG_PLAY;
    if (elements.btnImpTmpStep) elements.btnImpTmpStep.innerHTML = SVG_STEP_FORWARD;

    elements.btnImpTmpLoadFile.onclick = async () => {
        if (window.showOpenFilePicker) {
            try {
                const [handle] = await window.showOpenFilePicker({
                    types: [{
                        description: 'Westwood TMP Files',
                        accept: { 'application/x-wwn-tmp-all': ['.tem', '.sno', '.urb', '.des', '.ubn', '.lun'] }
                    }],
                    excludeAcceptAllOption: true
                });
                
                resetTmpImportState(); // Clean before new load
                
                const file = await handle.getFile();
                const buf = await file.arrayBuffer();
                try {
                    console.log(`[Import] Parsing TMP: ${file.name} (${buf.byteLength} bytes)`);
                    const parsed = TmpTsFile.parse(buf);
                    if (!parsed) throw new Error("Parser returned empty result");
                    
                    impTmpData = parsed;
                    impTmpBuffer = buf;
                    window.curImportTmpData = impTmpData;
                    impTmpData.filename = file.name;
                    window._lastTmpFileHandle = handle;

                    // Auto-sync palette from editor if none selected or all transparent
                    if (!impTmpPalette || impTmpPalette.every(c => c === null)) {
                        if (state.palette) impTmpPalette = [...state.palette];
                    }

                    impTmpFrameIdx = 0;
                    tmp_updateFrameLimits();
                    if (elements.impTmpSlider) elements.impTmpSlider.value = 0;
                    
                    autoDetectImportPalette(impTmpData.header.cx, file.name);

                    console.log(`[Import] TMP Parsed: ${impTmpData.numTiles} tiles. Initializing preview...`);
                    tmp_renderImportFrame(0);
                    tmp_updateImportUI();
                    if (impTmpPalette && impTmpPalette.some(c => c !== null)) {
                        tmp_renderImportPalette();
                    }
                } catch (err) {
                    console.error("[Import] Parse/Render Error:", err);
                    alert("Error parsing TMP: " + err.message);
                    resetTmpImportState();
                }
            } catch (err) {
                if (err.name !== 'AbortError') console.error("[Import] Picker Error:", err);
            }
        } else {
            elements.inpImpTmpFile.click();
        }
    };
    elements.inpImpTmpFile.onchange = (e) => {
        if (!e.target.files.length) return;
        const file = e.target.files[0];
        
        resetTmpImportState(); // Clean before new load
        
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const buf = ev.target.result;
                console.log(`[Import] Parsing TMP (Legacy): ${file.name}`);
                impTmpData = TmpTsFile.parse(buf);
                impTmpBuffer = buf;
                window.curImportTmpData = impTmpData;
                impTmpData.filename = file.name;

                impTmpFrameIdx = 0;
                tmp_updateFrameLimits();
                if (elements.impTmpSlider) elements.impTmpSlider.value = 0;

                autoDetectImportPalette(impTmpData.header.cx, file.name);

                tmp_renderImportFrame(0);
                tmp_updateImportUI();
            } catch (err) {
                console.error(err);
                alert(t('msg_err_parse_tmp').replace('{{error}}', err.message));
            }
            elements.inpImpTmpFile.value = '';
        };
        reader.readAsArrayBuffer(file);
    };

    if (elements.btnImpTmpStep) {
        elements.btnImpTmpStep.onclick = () => {
            if (!impTmpData) return;
            const maxIdx = impTmpData.numTiles - 1;
            impTmpFrameIdx = (impTmpFrameIdx + 1) > maxIdx ? 0 : impTmpFrameIdx + 1;
            if (elements.impTmpSlider) elements.impTmpSlider.value = impTmpFrameIdx;
            tmp_renderImportFrame(impTmpFrameIdx);
        };
    }

    if (elements.impTmpSlider) {
        elements.impTmpSlider.oninput = () => {
            if (!impTmpData) return;
            impTmpFrameIdx = parseInt(elements.impTmpSlider.value);
            tmp_renderImportFrame(impTmpFrameIdx);
        };
    }

    if (elements.btnImpTmpPlay) {
        elements.btnImpTmpPlay.onclick = () => {
            if (impTmpTimer) {
                clearInterval(impTmpTimer);
                impTmpTimer = null;
                elements.btnImpTmpPlay.innerHTML = SVG_PLAY;
            } else {
                impTmpTimer = setInterval(() => {
                    if (elements.btnImpTmpStep) elements.btnImpTmpStep.click()
                }, 100);
                elements.btnImpTmpPlay.innerHTML = SVG_PAUSE;
            }
        };
    }

    elements.btnCancelImpTmp.onclick = () => {
        tmp_stopAnimation();
        elements.importTmpDialog.close();
    };

    elements.btnConfirmImpTmp.onclick = () => {
        if (onConfirm) onConfirm(impTmpBuffer, impTmpData.filename, impTmpPalette, importPaletteSelectedManually, _lastImpPaletteNodeId);
        
        tmp_stopAnimation();
        elements.importTmpDialog.close();
    };

}

export function syncTmpImporterPalette(palette, isManual = false) {
    if (!palette) return;
    if (isManual) {
        importPaletteSelectedManually = true;
    }
    // Clone palette to avoid reference issues
    impTmpPalette = palette.map(c => c ? { ...c } : null);
    tmp_renderImportPalette();
    if (impTmpData) tmp_renderImportFrame(impTmpFrameIdx);
    tmp_updateImportUI();
}

export function resetTmpImportState() {
    console.log("[Import] Resetting importer state...");
    importPaletteSelectedManually = false;
    _lastImpPaletteNodeId = null;
    impTmpData = null;
    impTmpBuffer = null;
    window.curImportTmpData = null;
    impTmpFrameIdx = 0;
    tmp_stopAnimation();

    // Update button text/icon: restore active palette if one is loaded
    const el = document.getElementById('menuItemImpTmpPalettes');
    if (el) {
        const activeId = getActivePaletteId();
        if (activeId) {
            const lib = getLib();
            const node = findNodeById(lib.custom, activeId);
            if (node) {
                updatePaletteSelectorUI('menuItemImpTmpPalettes', node);
            }
        } else {
            const btn = el.querySelector('.menu-btn');
            if (btn) {
                let iconContainer = btn.querySelector('.menu-icon');
                if (iconContainer) iconContainer.innerText = '🎨';
                const nameSpan = btn.querySelector('span:not(.menu-icon):not(.arrow)');
                if (nameSpan) {
                    nameSpan.innerText = t('btn_select_palette') || 'SELECT PALETTE';
                    nameSpan.setAttribute('data-i18n', 'btn_select_palette');
                }
            }
        }
    }

    // Clear Canvas
    if (elements.impTmpCanvas) {
        const ctx = elements.impTmpCanvas.getContext('2d');
        ctx.clearRect(0, 0, elements.impTmpCanvas.width, elements.impTmpCanvas.height);
    }
    if (elements.impTmpCounter) elements.impTmpCounter.innerText = "-/-";
    if (elements.impTmpInfo) elements.impTmpInfo.innerText = t('msg_no_data_loaded');
    
    if (elements.impTmpSlider) {
        elements.impTmpSlider.value = 0;
        elements.impTmpSlider.max = 0;
    }

    const tableBody = document.getElementById('impTmpTileTableBody');
    if (tableBody) tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 10px; color: #666;">${t('msg_no_data_loaded')}</td></tr>`;

    const container = document.getElementById('impTmpPreviewContainer');
    if (container) container.style.backgroundColor = '#000';

    tmp_updateImportUI();
}

function tmp_updateFrameLimits() {
    if (!impTmpData) return;
    const total = impTmpData.numTiles;
    const max = total - 1;
    if (elements.impTmpSlider) elements.impTmpSlider.max = Math.max(0, max);
    // Update counter to reflect new max immediately
    const maxIdx = Math.max(0, max);
    if (elements.impTmpCounter) elements.impTmpCounter.innerText = `${impTmpFrameIdx}/${maxIdx}`;
}

function tmp_initImportGrid() {
    const grid = elements.impTmpPalGrid;
    grid.innerHTML = '';
    for (let i = 0; i < 256; i++) {
        const d = document.createElement('div');
        d.className = 'pal-cell ' + (i % 2 === 0 ? 'empty-p1' : 'empty-p2');
        grid.appendChild(d);
    }
}

function tmp_renderImportPalette() {
    const cells = elements.impTmpPalGrid.children;
    for (let i = 0; i < 256; i++) {
        const c = impTmpPalette[i];
        if (c) {
            cells[i].style.backgroundColor = `rgb(${c.r},${c.g},${c.b})`;
            cells[i].className = 'pal-cell used';
        } else {
            cells[i].style.backgroundColor = '';
            cells[i].className = 'pal-cell ' + (i % 2 === 0 ? 'empty-p1' : 'empty-p2');
        }
    }
}

function tmp_clearImportPalette() {
    impTmpPalette = new Array(256).fill(null);
    tmp_renderImportPalette();
    if (impTmpData) tmp_renderImportFrame(impTmpFrameIdx);
    tmp_updateImportUI();
}

function tmp_renderImportFrame(idx) {
    if (!impTmpData) {
        return;
    }
    
    const canvas = elements.impTmpCanvas;
    if (!canvas) {
        console.error("[Import] Preview canvas element not found");
        return;
    }

    console.log(`[Import] tmp_renderImportFrame: Composing view for ${impTmpData.filename}...`);
    const { canvas: compositeCanvas, bounds } = TmpTsFile.composeToCanvas(impTmpData, impTmpPalette);
    
    if (!compositeCanvas) {
        console.warn("[Import] composeToCanvas returned null - Bounds:", bounds);
        canvas.width = 1; canvas.height = 1;
        canvas.getContext('2d').clearRect(0, 0, 1, 1);
        return;
    }

    console.log(`[Import] Composite generated: ${compositeCanvas.width}x${compositeCanvas.height}. Setting preview canvas.`);

    // Force resize to match content exactly
    canvas.width = compositeCanvas.width;
    canvas.height = compositeCanvas.height;
    
    // Ensure CSS allows auto-scaling via the attributes
    canvas.style.width = '';
    canvas.style.height = '';

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(compositeCanvas, 0, 0);

    // Sync container background with palette color 0 if available
    const container = document.getElementById('impTmpPreviewContainer');
    if (container && impTmpPalette && impTmpPalette[0]) {
        const c = impTmpPalette[0];
        container.style.backgroundColor = `rgb(${c.r},${c.g},${c.b})`;
    }

    console.log(`[Import] Preview rendered at 1:1 scale.`);

    if (elements.impTmpCounter) {
        elements.impTmpCounter.style.display = 'block';
        elements.impTmpCounter.innerText = `${impTmpData.numTiles} Tiles (${impTmpData.header.cblocks_x}x${impTmpData.header.cblocks_y})`;
    }
    
    if (elements.impTmpInfo) {
        const game = impTmpData.header.cx === 48 ? 'TS' : 'RA2';
        elements.impTmpInfo.innerText = `${impTmpData.filename} (${game}) (${bounds.width}x${bounds.height})`;
    }
}


function tmp_updateImportUI() {
    // A palette is considered loaded if at least ONE color is not null
    const hasPal = impTmpPalette && impTmpPalette.some(c => c !== null);
    const hasData = !!impTmpData;

    const btn = elements.btnConfirmImpTmp;
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

    // Populate Table
    const tableBody = document.getElementById('impTmpTileTableBody');
    if (tableBody && hasData) {
        // Filter out null tiles so we only show valid data rows
        tableBody.innerHTML = impTmpData.tiles
            .map((t, i) => ({ t, i }))
            .filter(item => item.t !== null)
            .map(({ t, i }) => {
                const h = t.tileHeader || t.header;
                if (!h) return ''; // skip missing headers
                return `<tr>
                    <td style="padding: 2px 4px; border: 1px solid #222;">${i}</td>
                    <td style="padding: 2px 4px; border: 1px solid #222;">${h.x}</td>
                    <td style="padding: 2px 4px; border: 1px solid #222;">${h.y}</td>
                    <td style="padding: 2px 4px; border: 1px solid #222; color: ${h.height > 0 ? 'var(--accent)' : 'inherit'}">${h.height}</td>
                    <td style="padding: 2px 4px; border: 1px solid #222;">${h.has_extra_data ? 'YES' : 'NO'}</td>
                    <td style="padding: 2px 4px; border: 1px solid #222;">${h.land_type}${getLandTypeName(h.land_type)}</td>
                    <td style="padding: 2px 4px; border: 1px solid #222;">${h.ramp_type}${getRampTypeName(h.ramp_type)}</td>
                </tr>`;
            }).join('');
    }
}

function tmp_stopAnimation() {
    if (impTmpTimer) {
        clearInterval(impTmpTimer);
        impTmpTimer = null;
        if (elements.btnImpTmpPlay) elements.btnImpTmpPlay.innerHTML = SVG_PLAY;
    }
}

function autoDetectImportPalette(cx, filename) {
    if (importPaletteSelectedManually || !filename) return;
    
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
        } else if (ext === 'tem') {
            autoPaletteId = 'game_ra2_isotem';
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
        // Find node b64
        let node = null;
        for (const cat in GAME_PALETTES) {
            const found = GAME_PALETTES[cat].find(p => p.id === autoPaletteId);
            if (found) {
                node = found;
                break;
            }
        }
        if (node && node.b64) {
            const activeName = getActivePaletteName();
            if (activeName) {
                const norm = (s) => s.replace(/\.pal$/i, '').toLowerCase().trim();
                if (norm(activeName) === norm(node.name)) {
                    return;
                }
            }
            try {
                // Decode base64
                const bin = atob(node.b64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                const buffer = bytes.buffer;
                
                const palArray = parsePaletteBuffer(buffer);
                syncTmpImporterPalette(palArray, false);
                _lastImpPaletteNodeId = node.id;

                // Update UI text and icon using the shared helper
                updatePaletteSelectorUI('menuItemImpTmpPalettes', node);
                
                // Render Simple
                if (typeof renderPaletteSimple === 'function') {
                    renderPaletteSimple(palArray, document.getElementById('impTmpPalGrid'));
                }
            } catch (e) {
                console.error("autoDetectImportPalette error:", e);
            }
        }
    }
}
