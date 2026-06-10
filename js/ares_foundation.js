// Ares Custom Foundation editor — ported from ra2_foundation_tool.html (tab-ares).
// Lets the user paint an isometric tile grid with two cell types (Foundation
// and Outline) and emits the corresponding Ares INI snippet for the
// [Building] Foundation / FoundationOutline entries.

import { setupAutoRepeat } from './utils.js';

let aresData = new Map();
let aresInitialized = false;
let aresGameGrid = 'ra2'; // 'ts' or 'ra2' — set from state.isoGrid on open
let aresIsFirstLayout = true;

function aresGetTileSize() {
    // Returns [tileW, tileH] based on the currently selected game grid.
    return aresGameGrid === 'ts' ? [48, 24] : [60, 30];
}

function aresCreateStepper(labelKey, tooltipKey, min, max, value, onChange) {
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '4px';
    wrapper.style.minWidth = '110px';
    wrapper.style.flex = '0 0 auto';

    const lbl = document.createElement('label');
    lbl.className = 'seq-num-label';
    lbl.setAttribute('data-i18n', labelKey);
    lbl.textContent = window.t ? window.t(labelKey) : labelKey;
    if (tooltipKey) {
        lbl.setAttribute('data-i18n-title', tooltipKey);
        lbl.setAttribute('data-title', window.t ? window.t(tooltipKey) : tooltipKey);
    }
    wrapper.appendChild(lbl);

    const stepper = document.createElement('div');
    stepper.className = 'input-stepper';
    stepper.style.height = '24px';

    const btnMinus = document.createElement('button');
    btnMinus.className = 'step-btn step-btn-minus';
    btnMinus.textContent = '\u2212';
    btnMinus.title = 'Decrease (Ctrl+Click for -5)';
    stepper.appendChild(btnMinus);

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'input-step';
    input.style.flex = '1';
    input.style.minWidth = '0';
    input.style.fontSize = '12px';
    input.min = String(min);
    if (max !== undefined) input.max = String(max);
    input.value = String(value);
    stepper.appendChild(input);

    const btnPlus = document.createElement('button');
    btnPlus.className = 'step-btn step-btn-plus';
    btnPlus.textContent = '+';
    btnPlus.title = 'Increase (Ctrl+Click for +5)';
    stepper.appendChild(btnPlus);

    wrapper.appendChild(stepper);

    // Mark the stepper so setupSteppers() (which runs after initAresFoundation
    // in the init flow) does not bind a second setupAutoRepeat to our
    // buttons. Without this guard, a single mousedown would call the
    // change handler twice and the value would jump by 2 per click.
    stepper.dataset.autoRepeatBound = '1';

    const clamp = (v) => {
        if (isNaN(v)) v = min;
        v = Math.max(min, v);
        if (max !== undefined) v = Math.min(max, v);
        return v;
    };
    const doChange = (ev, delta) => {
        const step = ev.ctrlKey ? 5 : 1;
        const v = clamp((parseInt(input.value, 10) || min) + delta * step);
        input.value = String(v);
        onChange(v);
    };
    setupAutoRepeat(btnMinus, (ev) => doChange(ev, -1));
    setupAutoRepeat(btnPlus, (ev) => doChange(ev, 1));
    return { wrapper, input };
}

function aresGetDim(input) {
    const v = parseInt(input.value, 10);
    return isNaN(v) ? 0 : v;
}

function aresGetIsoCoords(x, y, cx, cy) {
    const [tileW, tileH] = aresGetTileSize();
    const tw = tileW / 2;
    const th = tileH / 2;
    return {
        x: cx + (x - y) * tw,
        y: cy + (x + y) * th
    };
}

function aresDrawTilePath(ctx, px, py) {
    const [tileW, tileH] = aresGetTileSize();
    const tw = tileW / 2;
    const th = tileH / 2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + tw, py + th);
    ctx.lineTo(px, py + th * 2);
    ctx.lineTo(px - tw, py + th);
    ctx.closePath();
}

function aresGetCurrentFrameImage() {
    // Pull the current SHP frame + palette from the global state, build an
    // ImageData with RGB pixels, and return it (or null if unavailable).
    // Mirrors the SHP Editor's renderCanvas logic: if showBackground is
    // false, index 0 stays fully transparent; if true, it's filled with
    // the palette's color at index 0 (the editor's "solid background" mode).
    const state = window.state;
    if (!state || !state.frames || state.frames.length === 0) return null;
    if (state.isTmpMode) return null;
    const frame = state.frames[state.currentFrameIdx];
    if (!frame) return null;

    const w = frame.width;
    const h = frame.height;
    const flat = new Uint8Array(w * h);
    for (let li = 0; li < frame.layers.length; li++) {
        const layer = frame.layers[li];
        if (!layer || !layer.visible || layer.type === 'external_shp') continue;
        if (!layer.data) continue;
        for (let k = 0; k < flat.length; k++) {
            const v = layer.data[k];
            if (v !== undefined && v !== 255 /* TRANSPARENT_COLOR */) {
                flat[k] = v & 0xFF;
            }
        }
    }

    const palette = state.palette;
    if (!palette) return null;

    const showBg = state.showBackground !== false; // default true
    const bgIdx = state.isAlphaImageMode ? 127 : 0;
    const bg = palette[bgIdx] || { r: 0, g: 0, b: 0 };

    const imgData = new ImageData(w, h);
    for (let k = 0; k < flat.length; k++) {
        const idx = flat[k];
        const c = palette[idx];
        const o = k * 4;
        if (c && idx !== 0) {
            imgData.data[o] = c.r;
            imgData.data[o + 1] = c.g;
            imgData.data[o + 2] = c.b;
            imgData.data[o + 3] = 255;
        } else if (showBg) {
            // Solid background: paint index 0 with the palette color so the
            // user can see the SHP "background fill" as in the main editor.
            imgData.data[o] = bg.r;
            imgData.data[o + 1] = bg.g;
            imgData.data[o + 2] = bg.b;
            imgData.data[o + 3] = 255;
        } else {
            // Transparent background (checkerboard in main editor): leave
            // alpha = 0 so the dialog's panel color shows through.
            imgData.data[o] = 0;
            imgData.data[o + 1] = 0;
            imgData.data[o + 2] = 0;
            imgData.data[o + 3] = 0;
        }
    }
    return { imageData: imgData, w, h };
}

function aresDrawGrid() {
    const w = aresGetDim(aresWidthInp);
    const h = aresGetDim(aresHeightInp);
    const cvs = aresCanvas;
    const ctx = aresCtx;
    const [tileW, tileH] = aresGetTileSize();
    const halfW = tileW / 2;
    const halfH = tileH / 2;

    // The canvas is sized to fill its container (#aresCanvasScroll).
    // The diamond grid is then drawn centred on that fixed area, and
    // if width/height are large enough to overflow the visible area
    // the user scrolls within the container to see the cells off-screen.
    // This keeps the canvas bitmap a 1:1 match with the CSS box (no
    // stretching) and avoids the canvas resizing the container with it.
    const container = document.getElementById('aresCanvasScroll');
    
    const oldW = cvs.width;
    const oldH = cvs.height;
    const oldScrollLeft = container ? container.scrollLeft : 0;
    const oldScrollTop = container ? container.scrollTop : 0;

    // Calculate required canvas bounds to fit the whole grid and reference image.
    // Origin (cx, cy) is at the center of the canvas. The grid X coordinate spans
    // from cx - (h + 2) * halfW to cx + (w + 2) * halfW relative to the center.
    // The grid Y coordinate spans from cy - 2 * halfH to cy + (w + h + 2) * halfH.
    const maxDistX = Math.max(w + 2, h + 2) * halfW;
    const maxDistY = (w + h + 2) * halfH;

    const frameImg = aresGetCurrentFrameImage();
    const refW = frameImg ? frameImg.w : 0;
    const refH = frameImg ? frameImg.h : 0;

    const margin = 80;
    const requiredW = Math.ceil(2 * (Math.max(maxDistX, refW / 2) + margin));
    const requiredH = Math.ceil(2 * (Math.max(maxDistY, refH / 2) + margin));

    const newW = container ? Math.max(container.clientWidth - 4, requiredW) : requiredW;
    const newH = container ? Math.max(container.clientHeight - 4, requiredH) : requiredH;

    if (cvs.width !== newW) cvs.width = newW;
    if (cvs.height !== newH) cvs.height = newH;
    // Keep the CSS box in sync with the bitmap so the canvas displays at
    // 1:1 (no stretching). With overflow:auto on the container, the
    // grid simply paints past the visible area and the user scrolls to
    // see it.
    cvs.style.width = `${newW}px`;
    cvs.style.height = `${newH}px`;

    if (container) {
        if (aresIsFirstLayout && container.clientWidth > 0 && container.clientHeight > 0) {
            container.scrollLeft = (newW - container.clientWidth) / 2;
            container.scrollTop = (newH - container.clientHeight) / 2;
            aresIsFirstLayout = false;
        } else {
            const deltaW = newW - oldW;
            const deltaH = newH - oldH;
            if (deltaW !== 0) container.scrollLeft = oldScrollLeft + deltaW / 2;
            if (deltaH !== 0) container.scrollTop = oldScrollTop + deltaH / 2;
        }
    }

    // Centre the canvas on the geometric centre of the full rendered
    // grid (cells -1..w × -1..h). With aresGetIsoCoords using this
    // (cx, cy) as the origin, the iso centre of the rendered grid is at
    // (cx, cy + (w + h) * halfH / 2). We set cy so the rendered grid
    // is exactly centred on the canvas.
    const centerX = cvs.width / 2;
    const centerY = cvs.height / 2;

    ctx.clearRect(0, 0, cvs.width, cvs.height);
    cvs.dataset.cx = centerX;
    cvs.dataset.cy = centerY;

    // Fill the canvas (and the surrounding container via the inline
    // background) with the SHP's index-0 colour. When the diamond grid
    // grows beyond the frame's bounding box, the surrounding area
    // shows this background colour, so the image appears "embedded"
    // in the playfield rather than floating in the void. Falls back to
    // the editor panel colour when the palette slot is empty.
    const state = window.state;
    let bgColor = null;
    if (state && state.palette && state.palette[0]) {
        bgColor = state.palette[0];
    } else {
        const panel = getComputedStyle(document.documentElement).getPropertyValue('--bg-panel').trim() || '#0b0e14';
        const m = panel.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
        if (m) bgColor = { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
    }
    if (bgColor) {
        const bgCss = `rgb(${bgColor.r}, ${bgColor.g}, ${bgColor.b})`;
        ctx.fillStyle = bgCss;
        ctx.fillRect(0, 0, cvs.width, cvs.height);
        // Also paint the container so the empty area (scrollbars, padding)
        // matches the canvas background.
        if (container) container.style.background = bgCss;
    }

    // Draw the current SHP frame as a faint background reference, centred
    // on the canvas. The image keeps its native size (matching the
    // ra2_foundation_tool behaviour: the reference image is fixed, the
    // diamond grid expands or contracts around it).
    if (frameImg) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        const off = document.createElement('canvas');
        off.width = frameImg.w;
        off.height = frameImg.h;
        off.getContext('2d').putImageData(frameImg.imageData, 0, 0);
        ctx.drawImage(off, centerX - frameImg.w / 2, centerY - frameImg.h / 2);
        ctx.restore();
    }

    const aresFoundationStroke = '#00ff66';
    const aresFoundationFill = 'rgba(0,255,102,0.5)';
    const aresOutlineStroke = '#ff9900';
    const aresOutlineFill = 'rgba(255,153,0,0.5)';

    for (let x = -1; x <= w; x++) {
        for (let y = -1; y <= h; y++) {
            const pos = aresGetIsoCoords(x, y, centerX, centerY);
            const key = `${x},${y}`;
            const status = aresData.get(key);

            aresDrawTilePath(ctx, pos.x, pos.y);

            if (status === 'foundation') {
                ctx.fillStyle = aresFoundationFill;
                ctx.fill();
                ctx.strokeStyle = aresFoundationStroke;
                ctx.lineWidth = 2;
                ctx.stroke();
            } else if (status === 'outline') {
                ctx.fillStyle = aresOutlineFill;
                ctx.fill();
                ctx.strokeStyle = aresOutlineStroke;
                ctx.lineWidth = 2;
                ctx.stroke();
            } else if (x >= 0 && x < w && y >= 0 && y < h) {
                ctx.fillStyle = 'rgba(255,255,255,0.04)';
                ctx.fill();
                // Match the SHP Editor's Game Grid look: white translucent lines.
                ctx.strokeStyle = 'rgba(255,255,255,0.7)';
                ctx.lineWidth = 1;
                ctx.stroke();
            } else {
                ctx.strokeStyle = 'rgba(180,180,180,0.45)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    }

    // Outline the playfield bounds
    ctx.beginPath();
    const top = aresGetIsoCoords(0, 0, centerX, centerY);
    const right = aresGetIsoCoords(w, 0, centerX, centerY);
    const bottom = aresGetIsoCoords(w, h, centerX, centerY);
    const left = aresGetIsoCoords(0, h, centerX, centerY);
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(right.x, right.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.lineTo(left.x, left.y);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.lineWidth = 1;
}

// State used by the drag-to-paint interaction below.
let aresIsPainting = false;
let aresLastPaintedKey = null;

function aresCellAt(clientX, clientY) {
    const rect = aresCanvas.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    const cx = parseFloat(aresCanvas.dataset.cx);
    const cy = parseFloat(aresCanvas.dataset.cy);
    const w = aresGetDim(aresWidthInp);
    const h = aresGetDim(aresHeightInp);

    for (let x = -1; x <= w; x++) {
        for (let y = -1; y <= h; y++) {
            const pos = aresGetIsoCoords(x, y, cx, cy);
            aresDrawTilePath(aresCtx, pos.x, pos.y);
            if (aresCtx.isPointInPath(mouseX, mouseY)) {
                return { x, y };
            }
        }
    }
    return null;
}

function aresPaintAt(cell) {
    if (!cell) return;
    const w = aresGetDim(aresWidthInp);
    const h = aresGetDim(aresHeightInp);
    const key = `${cell.x},${cell.y}`;
    // Cells outside the playfield are forced to 'outline' (matching the
    // original ra2_foundation_tool behaviour).
    let mode = document.querySelector('input[name="aresMode"]:checked').value;
    if (cell.x < 0 || cell.y < 0 || cell.x >= w || cell.y >= h) {
        mode = 'outline';
    }
    const current = aresData.get(key);
    if (current === mode) {
        aresData.delete(key);
    } else {
        aresData.set(key, mode);
    }
}

function aresHandleMouseDown(e) {
    if (e.button !== 0) return; // Only left click
    e.preventDefault();
    aresIsPainting = true;
    aresLastPaintedKey = null;
    const cell = aresCellAt(e.clientX, e.clientY);
    if (cell) {
        aresPaintAt(cell);
        aresLastPaintedKey = `${cell.x},${cell.y}`;
        aresDrawGrid();
        aresGenerateCode();
    }
}

function aresHandleMouseMove(e) {
    if (!aresIsPainting) return;
    const cell = aresCellAt(e.clientX, e.clientY);
    if (!cell) return;
    const key = `${cell.x},${cell.y}`;
    if (key === aresLastPaintedKey) return; // Already painted this cell
    aresPaintAt(cell);
    aresLastPaintedKey = key;
    aresDrawGrid();
    aresGenerateCode();
}

function aresHandleMouseUp() {
    aresIsPainting = false;
    aresLastPaintedKey = null;
}

function aresAutoOutline() {
    const neighbors = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
    const newOutlines = new Set();
    const w = aresGetDim(aresWidthInp);
    const h = aresGetDim(aresHeightInp);

    aresData.forEach((val, key) => {
        if (val === 'foundation') {
            const [x, y] = key.split(',').map(Number);
            neighbors.forEach(([dx, dy]) => {
                const nx = x + dx;
                const ny = y + dy;
                const nKey = `${nx},${ny}`;
                if (nx >= -1 && nx <= w && ny >= -1 && ny <= h) {
                    if (!aresData.has(nKey)) newOutlines.add(nKey);
                }
            });
        }
    });
    newOutlines.forEach(k => aresData.set(k, 'outline'));
    aresDrawGrid();
    aresGenerateCode();
}

function aresClear() {
    aresData.clear();
    aresDrawGrid();
    aresGenerateCode();
}

function aresGenerateCode() {
    if (aresData.size === 0) {
        aresCodeArea.value = '';
        return;
    }
    const name = aresBuildingNameInp.value || 'SOME_BUILDING';
    const w = aresWidthInp.value;
    const h = aresHeightInp.value;
    const lines = [`[${name}]`, `Foundation=Custom`, `Foundation.X=${w}`, `Foundation.Y=${h}`];
    let fCount = 0;
    const outlines = [];
    const sortedKeys = Array.from(aresData.keys()).sort((a, b) => {
        const [ax, ay] = a.split(',').map(Number);
        const [bx, by] = b.split(',').map(Number);
        if (ay !== by) return ay - by;
        return ax - bx;
    });
    sortedKeys.forEach(key => {
        const type = aresData.get(key);
        if (type === 'foundation') {
            lines.push(`Foundation.${fCount}=${key}`);
            fCount++;
        } else if (type === 'outline') {
            outlines.push(key);
        }
    });
    if (outlines.length > 0) {
        lines.push(`FoundationOutline.Length=${outlines.length}`);
        outlines.forEach((key, idx) => {
            lines.push(`FoundationOutline.${idx}=${key}`);
        });
    }
    aresCodeArea.value = lines.join('\n');
}

function aresCopyCode() {
    if (!aresCodeArea.value) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(aresCodeArea.value).catch(() => {
            aresCodeArea.select();
            document.execCommand('copy');
        });
    } else {
        aresCodeArea.select();
        document.execCommand('copy');
    }
}

function aresCopyDesign() {
    if (!aresCanvas) return;
    aresCanvas.toBlob(blob => {
        if (!blob) return;
        if (navigator.clipboard && navigator.clipboard.write) {
            navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                .catch(err => console.warn('Clipboard write failed:', err));
        }
    }, 'image/png');
}

let aresCanvas, aresCtx, aresCodeArea, aresWidthInp, aresHeightInp, aresBuildingNameInp;

export function openAresFoundationEditor() {
    const dlg = document.getElementById('aresEditorDialog');
    if (!dlg) return;
    aresIsFirstLayout = true;
    // Inherit the SHP Editor's current game grid selection. "none" is not
    // allowed in this tool — we fall back to RA2.
    const state = window.state;
    if (state && (state.isoGrid === 'ts' || state.isoGrid === 'ra2')) {
        aresGameGrid = state.isoGrid;
    } else {
        aresGameGrid = 'ra2';
    }
    // Hide the "none" option in the editor's selIsoGrid while the dialog
    // is open — this tool always renders some game grid.
    const sel = document.getElementById('selIsoGrid');
    const noneOpt = sel ? sel.querySelector('option[value="none"]') : null;
    let prevNoneDisplay = null;
    if (sel && noneOpt) {
        prevNoneDisplay = noneOpt.style.display;
        noneOpt.style.display = 'none';
        if (sel.value === 'none') sel.value = aresGameGrid;
    }
    // Remember to restore the option visibility when the dialog closes.
    dlg.addEventListener('close', () => {
        if (noneOpt) noneOpt.style.display = prevNoneDisplay ?? '';
    }, { once: true });
    if (sel) sel.value = aresGameGrid;
    dlg.showModal?.() || dlg.setAttribute('open', '');
    aresDrawGrid();
    aresGenerateCode();
}

export function initAresFoundation() {
    if (aresInitialized) return;
    aresInitialized = true;

    aresCanvas = document.getElementById('aresCanvas');
    aresCtx = aresCanvas.getContext('2d');
    aresCodeArea = document.getElementById('aresCode');
    aresBuildingNameInp = document.getElementById('aresBuildingName');

    // Build the Width / Height steppers using the same widget the Infantry
    // Sequence Editor uses (button + number input + button, with auto-repeat
    // and Ctrl+Click for ±5).
    const widthHost = document.getElementById('aresWidthStepper');
    if (widthHost) {
        const res = aresCreateStepper(
            'ares_lbl_width',
            'tt_ares_width',
            1,
            20,
            3,
            (v) => {
                aresData.clear();
                aresDrawGrid();
                aresGenerateCode();
            }
        );
        aresWidthInp = res.input;
        widthHost.appendChild(res.wrapper);
    }

    const heightHost = document.getElementById('aresHeightStepper');
    if (heightHost) {
        const res = aresCreateStepper(
            'ares_lbl_height',
            'tt_ares_height',
            1,
            20,
            3,
            (v) => {
                aresData.clear();
                aresDrawGrid();
                aresGenerateCode();
            }
        );
        aresHeightInp = res.input;
        heightHost.appendChild(res.wrapper);
    }

    const btnClose = document.getElementById('aresBtnClose');
    if (btnClose) btnClose.onclick = () => {
        document.getElementById('aresEditorDialog')?.close();
    };

    const btnClear = document.getElementById('aresBtnClear');
    if (btnClear) btnClear.onclick = aresClear;

    const btnAuto = document.getElementById('aresBtnAutoOutline');
    if (btnAuto) btnAuto.onclick = aresAutoOutline;

    const btnCopyCode = document.getElementById('aresBtnCopyCode');
    if (btnCopyCode) btnCopyCode.onclick = aresCopyCode;

    const btnCopyDesign = document.getElementById('aresBtnCopyDesign');
    if (btnCopyDesign) btnCopyDesign.onclick = aresCopyDesign;

    if (aresCanvas) {
        aresCanvas.addEventListener('mousedown', aresHandleMouseDown);
        aresCanvas.addEventListener('mousemove', aresHandleMouseMove);
        // Stop painting on mouseup anywhere (not just on the canvas) and
        // when the pointer leaves the canvas so the user can release
        // outside without leaving a half-painted stroke.
        window.addEventListener('mouseup', aresHandleMouseUp);
        aresCanvas.addEventListener('mouseleave', () => {
            aresIsPainting = false;
            aresLastPaintedKey = null;
        });
    }

    if (aresBuildingNameInp) aresBuildingNameInp.addEventListener('input', aresGenerateCode);

    // React to the editor's own selIsoGrid changes while the dialog is open.
    // (Only "ts" and "ra2" are valid here; "none" is hidden in openAresFoundation.)
    const selIsoGrid = document.getElementById('selIsoGrid');
    if (selIsoGrid) {
        selIsoGrid.addEventListener('change', () => {
            if (selIsoGrid.value === 'ts' || selIsoGrid.value === 'ra2') {
                aresGameGrid = selIsoGrid.value;
                aresData.clear();
                aresDrawGrid();
                aresGenerateCode();
            }
        });
    }

    // Re-render whenever the canvas container resizes (e.g. the user
    // resizes the browser window or the dialog itself). Without this the
    // canvas bitmap keeps the size it had at the previous render and the
    // contents get stretched/squashed by the CSS box.
    const canvasContainer = document.getElementById('aresCanvasScroll');
    if (canvasContainer && typeof ResizeObserver !== 'undefined') {
        // Defer the redraw to the next animation frame to avoid the
        // "ResizeObserver loop completed with undelivered notifications"
        // warning that browsers emit when an observer callback mutates
        // layout (in our case, resizing the canvas bitmap).
        const ro = new ResizeObserver(() => {
            requestAnimationFrame(aresDrawGrid);
        });
        ro.observe(canvasContainer);
    } else {
        // Fallback for environments without ResizeObserver.
        window.addEventListener('resize', aresDrawGrid);
    }
}

window.openAresFoundationEditor = openAresFoundationEditor;
