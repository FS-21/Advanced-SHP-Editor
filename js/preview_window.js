import { state, TRANSPARENT_COLOR } from './state.js';
import { setupAutoRepeat, compositeFrame, SVG_PLAY, SVG_PAUSE, SVG_SKIP_BACK, SVG_SKIP_FWD } from './utils.js';

let previewCtx = null;
let animationId = null;
let lastFrameTime = 0;
let currentFrameIdx = 0;
let isPlaying = true;
let zoom = 1.0;

// Side Color Ramp Variables
let baseColorRamp = null;
let customColorHistory = []; // Max 8 colors

/**
 * Initializes the Preview Window UI and logic.
 */
export function initPreviewWindow() {
    const dialog = document.getElementById('previewDialog');
    const canvas = document.getElementById('prevCanvas');
    const displayArea = document.getElementById('prevDisplayArea');
    if (!canvas || !dialog) return;

    previewCtx = canvas.getContext('2d', { alpha: true });

    // UI Elements
    const btnPlay = document.getElementById('prevBtnPlay');
    const btnStep = document.getElementById('prevBtnStep');
    const btnStepBack = document.getElementById('prevBtnStepBack');
    const sliderTimeline = document.getElementById('prevSliderTimeline');
    const lblCounter = document.getElementById('prevFrameCounter');

    // Zoom Elements
    const btnZoomReset = document.getElementById('prevBtnZoomReset');
    const btnZoomMinus = document.getElementById('prevBtnZoomMinus');
    const btnZoomPlus = document.getElementById('prevBtnZoomPlus');
    const inpZoom = document.getElementById('prevInpZoom');
    const zoomVal = document.getElementById('prevZoomVal');
    const zoomSizeBar = document.getElementById('prevZoomSizeBar');

    // Range Elements
    const chkCustomRange = document.getElementById('prevChkCustomRange');
    const inpStart = document.getElementById('prevInpStart');
    const inpEnd = document.getElementById('prevInpEnd');
    const rangeContainer = document.getElementById('prevRangeControls');

    const cbLoop = document.getElementById('prevChkLoop');
    const cbShadow = document.getElementById('prevChkShadows');
    const cbBackground = document.getElementById('prevChkBackground');

    // Setup Side Color Buttons
    setupSideColors();

    const updateZoomUI = () => {
        if (!inpZoom || !zoomVal || !zoomSizeBar) return;
        let val = parseInt(inpZoom.value);

        if (val > 50 && val < 100) {
            val = (val > 75) ? 100 : 50;
            inpZoom.value = val;
        } else if (val > 100) {
            val = Math.round(val / 100) * 100;
            inpZoom.value = val;
        }

        zoomVal.textContent = val + '%';
        zoom = val / 100;

        const min = parseInt(inpZoom.min);
        const max = parseInt(inpZoom.max);
        const p = ((val - min) / (max - min)) * 100;
        zoomSizeBar.style.width = p + '%';

        updatePixelGrid();
        renderPreview();
    };

    if (inpZoom) {
        inpZoom.oninput = updateZoomUI;
    }

    if (btnZoomReset) {
        btnZoomReset.onclick = () => {
            if (inpZoom) {
                inpZoom.value = 100;
                updateZoomUI();
            }
        };
    }

    if (btnZoomMinus) {
        setupAutoRepeat(btnZoomMinus, (ev) => {
            let val = parseInt(inpZoom.value);
            if (ev && ev.ctrlKey) {
                val = val - 5;
            } else {
                if (val <= 100) val = 50;
                else val = Math.ceil(val / 100) * 100 - 100;
            }
            const min = parseInt(inpZoom.min || 50);
            inpZoom.value = Math.max(min, val);
            updateZoomUI();
        });
    }

    if (btnZoomPlus) {
        setupAutoRepeat(btnZoomPlus, (ev) => {
            let val = parseInt(inpZoom.value);
            if (ev && ev.ctrlKey) {
                val = val + 5;
            } else {
                if (val < 100) val = 100;
                else val = Math.floor(val / 100) * 100 + 100;
            }
            const max = parseInt(inpZoom.max || 5000);
            inpZoom.value = Math.min(max, val);
            updateZoomUI();
        });
    }

    // Event Listeners
    if (btnPlay) {
        btnPlay.onclick = () => {
            isPlaying = !isPlaying;
            btnPlay.innerHTML = isPlaying ? SVG_PAUSE : SVG_PLAY;

            if (isPlaying) {
                lastFrameTime = performance.now();
                requestAnimationFrame(animationLoop);
            }
        };
    }
    if (btnStepBack) {
        btnStepBack.innerHTML = SVG_SKIP_BACK;
        btnStepBack.onclick = () => {
            isPlaying = false;
            if (btnPlay) btnPlay.innerHTML = SVG_PLAY;
            stepFrame(-1);
            renderPreview();
            updateTimelineBounds();
        };
    }

    if (btnStep) {
        btnStep.innerHTML = SVG_SKIP_FWD;
        btnStep.onclick = () => {
            isPlaying = false;
            if (btnPlay) btnPlay.innerHTML = SVG_PLAY;
            stepFrame(1);
            renderPreview();
            updateTimelineBounds();
        };
    }

    if (sliderTimeline) {
        sliderTimeline.oninput = () => {
            isPlaying = false;
            if (btnPlay) btnPlay.innerHTML = SVG_PLAY;
            currentFrameIdx = parseInt(sliderTimeline.value);
            renderPreview();
        };
    }

    // Wheel Zoom
    if (displayArea) {
        displayArea.onwheel = (e) => {
            e.preventDefault();
            const direction = e.deltaY < 0 ? 1 : -1;
            let current = parseInt(inpZoom.value);
            let next;

            if (e.ctrlKey) {
                // Fine zoom
                next = current + (direction * 5);
            } else {
                // Snap zoom
                if (direction > 0) {
                    next = current < 100 ? 100 : Math.floor(current / 100) * 100 + 100;
                } else {
                    next = current <= 100 ? 50 : Math.ceil(current / 100) * 100 - 100;
                }
            }

            const min = parseInt(inpZoom.min) || 50;
            const max = parseInt(inpZoom.max) || 5000;
            next = Math.max(min, Math.min(max, next));

            if (next !== current) {
                inpZoom.value = next;
                updateZoomUI();
            }
        };
    }

    // Range Toggle Logic
    if (chkCustomRange) {
        chkCustomRange.onchange = () => {
            const active = chkCustomRange.checked;
            if (rangeContainer) {
                rangeContainer.style.opacity = active ? "1" : "0.5";
                rangeContainer.style.pointerEvents = active ? "auto" : "none";
            }
            // Update slider bounds if active
            updateTimelineBounds();
            renderPreview();
        };
    }

    // Stepper Helpers
    const setupStepper = (inpId, decId, incId) => {
        const inp = document.getElementById(inpId);
        const dec = document.getElementById(decId);
        const inc = document.getElementById(incId);
        if (!inp || !dec || !inc) return;

        const getMax = () => {
            const cbShadow = document.getElementById('prevChkShadows');
            if (cbShadow && cbShadow.checked && state.frames.length % 2 === 0) {
                return (state.frames.length / 2) - 1;
            }
            return Math.max(0, state.frames.length - 1);
        };

        setupAutoRepeat(dec, () => {
            const step = state.isCtrlPressed ? 5 : 1;
            inp.value = Math.max(0, parseInt(inp.value) - step);
            inp.dispatchEvent(new Event('change'));
        });

        setupAutoRepeat(inc, () => {
            const step = state.isCtrlPressed ? 5 : 1;
            const max = getMax();
            inp.value = Math.min(max, parseInt(inp.value) + step);
            inp.dispatchEvent(new Event('change'));
        });

        inp.onchange = () => {
            let val = parseInt(inp.value) || 0;
            const max = getMax();
            val = Math.max(0, Math.min(val, max));
            inp.value = val;
            updateTimelineBounds();
            renderPreview();
        };
    };

    setupStepper('prevInpStart', 'prevStepStartDec', 'prevStepStartInc');
    setupStepper('prevInpEnd', 'prevStepEndDec', 'prevStepEndInc');

    if (cbLoop) cbLoop.onchange = () => renderPreview();
    if (cbShadow) {
        cbShadow.onchange = () => {
            updateTimelineBounds();
            renderPreview();
        };
    }
    if (cbBackground) {
        cbBackground.onchange = () => renderPreview();
    }

    const selPrevGrid = document.getElementById('prevSelIsoGrid');
    if (selPrevGrid) {
        selPrevGrid.onchange = (e) => {
            state.isoGrid = e.target.value;
            // Sync main editor dropdown if it exists
            const mainSelGrid = document.getElementById('selIsoGrid');
            if (mainSelGrid) mainSelGrid.value = state.isoGrid;

            // Re-render both canvases to reflect the grid change
            if (typeof window.renderCanvas === 'function') window.renderCanvas();
            renderPreview();
        };
    }

    const btnClearColor = document.getElementById('prevBtnClearColor');
    if (btnClearColor) {
        btnClearColor.onclick = () => {
            state.previewSideColorIdx = null; // Clear Preset
            state.previewCustomColorHex = null; // Clear Custom
            setupSideColors();
            renderCustomHistory();
            renderPreview();
        };
    }

    dialog.addEventListener('close', () => {
        isPlaying = false;
        if (animationId) cancelAnimationFrame(animationId);
    });
}

function updateTimelineBounds() {
    const slider = document.getElementById('prevSliderTimeline');
    if (!slider) return;

    const chkCustomRange = document.getElementById('prevChkCustomRange');
    const useRange = chkCustomRange && chkCustomRange.checked;
    const cbShadow = document.getElementById('prevChkShadows');
    const useShadow = cbShadow && cbShadow.checked;

    let start = 0;
    let end = Math.max(0, state.frames.length - 1);

    // If Shadow Mode is active, we only navigate the first half of frames
    if (useShadow && state.frames.length % 2 === 0) {
        end = (state.frames.length / 2) - 1;
    }

    if (useRange) {
        const inpStart = document.getElementById('prevInpStart');
        const inpEnd = document.getElementById('prevInpEnd');

        // Ensure range inputs don't exceed current logic bounds
        if (parseInt(inpStart.value) > end) inpStart.value = end;
        if (parseInt(inpEnd.value) > end) inpEnd.value = end;

        const valStart = parseInt(inpStart.value);
        const valEnd = parseInt(inpEnd.value);
        start = !isNaN(valStart) ? valStart : 0;
        end = !isNaN(valEnd) ? valEnd : end;
    }

    slider.min = start;
    slider.max = end;

    if (currentFrameIdx < start) currentFrameIdx = start;
    if (currentFrameIdx > end) currentFrameIdx = end;
    slider.value = currentFrameIdx;
}

function updatePixelGrid() {
    const displayArea = document.getElementById('prevDisplayArea');
    if (!displayArea) return;

    if (zoom >= 4.0) {
        displayArea.classList.add('pixel-grid');
        displayArea.style.setProperty('--grid-size', `${zoom}px`);
    } else {
        displayArea.classList.remove('pixel-grid');
    }
}

/**
 * Opens the preview dialog and starts playback.
 */
export function openPreview() {
    const dialog = document.getElementById('previewDialog');
    if (!dialog) return;

    // Reset UI State
    isPlaying = false; // Start PAUSED by default
    const btnPlay = document.getElementById('prevBtnPlay');
    if (btnPlay) btnPlay.innerHTML = SVG_PLAY;

    const chkCustomRange = document.getElementById('prevChkCustomRange');
    if (chkCustomRange) {
        chkCustomRange.checked = false;
        const rangeContainer = document.getElementById('prevRangeControls');
        if (rangeContainer) {
            rangeContainer.style.opacity = "0.5";
            rangeContainer.style.pointerEvents = "none";
        }
    }
    // Initialize Frame Range Inputs
    const totalFrames = state.frames.length;
    const inpStart = document.getElementById('prevInpStart');
    const inpEnd = document.getElementById('prevInpEnd');
    if (inpStart) inpStart.value = 0;
    if (inpEnd) inpEnd.value = totalFrames > 0 ? totalFrames - 1 : 0;

    // Prevent duplicate tooltips throughout the app
    // Browsers show 'title' attribute as a tooltip. Custom CSS/JS tooltips also show.
    // Solution: Move 'title' to 'data-title' so custom logic can use it, but browser doesn't show it.
    document.querySelectorAll('[title]').forEach(el => {
        el.setAttribute('data-title', el.getAttribute('title'));
        el.removeAttribute('title');
    });

    const inpZoom = document.getElementById('prevInpZoom');
    if (inpZoom) {
        inpZoom.value = "100";
        // Trigger input event to sync zoom UI
        inpZoom.dispatchEvent(new Event('input'));
    }

    const cbLoop = document.getElementById('prevChkLoop');
    if (cbLoop) cbLoop.checked = true;

    // Shadow Mode availability based on frame count
    const cbShadow = document.getElementById('prevChkShadows');
    if (cbShadow) {
        const canShadow = state.frames.length > 0 && state.frames.length % 2 === 0;
        cbShadow.disabled = !canShadow;
        cbShadow.parentElement.style.opacity = canShadow ? "1" : "0.5";
        if (!canShadow) cbShadow.checked = false;
    }

    zoom = 1.0;
    updatePixelGrid();
    updateTimelineBounds();

    dialog.showModal();
    currentFrameIdx = 0;
    lastFrameTime = performance.now();
    renderCustomHistory();
    renderPreview(); // Initial render
}

function stepFrame(dir) {
    const chkCustomRange = document.getElementById('prevChkCustomRange');
    const useRange = chkCustomRange && chkCustomRange.checked;
    const cbLoop = document.getElementById('prevChkLoop');
    const loop = cbLoop && cbLoop.checked;
    const cbShadow = document.getElementById('prevChkShadows');
    const useShadow = cbShadow && cbShadow.checked;

    let start = 0;
    let end = state.frames.length - 1;

    // Default bound for Shadow Mode (half the frames)
    if (useShadow && state.frames.length % 2 === 0) {
        end = (state.frames.length / 2) - 1;
    }

    // Apply range override
    if (useRange) {
        const valStart = parseInt(document.getElementById('prevInpStart')?.value);
        const valEnd = parseInt(document.getElementById('prevInpEnd')?.value);
        start = !isNaN(valStart) ? valStart : 0;
        end = !isNaN(valEnd) ? valEnd : end;
    }

    currentFrameIdx += dir;

    if (currentFrameIdx > end) {
        currentFrameIdx = start;
        if (!loop) {
            currentFrameIdx = end;
            if (start !== end) isPlaying = false;
        }
    } else if (currentFrameIdx < start) {
        currentFrameIdx = end;
        if (!loop) {
            currentFrameIdx = start;
            if (start !== end) isPlaying = false;
        }
    }

    // Update play button state if stopped
    if (!isPlaying) {
        const btnPlay = document.getElementById('prevBtnPlay');
        if (btnPlay) btnPlay.innerHTML = SVG_PLAY;
    }

    // Update slider UI
    const slider = document.getElementById('prevSliderTimeline');
    if (slider) slider.value = currentFrameIdx;
}

/**
 * Main animation loop.
 */
function animationLoop(time) {
    if (!isPlaying) return;

    const currentFrame = state.frames[currentFrameIdx];
    const duration = currentFrame ? (currentFrame.duration || 100) : 100;

    if (time - lastFrameTime >= duration) {
        stepFrame(1);
        renderPreview();
        lastFrameTime = time;
    }

    animationId = requestAnimationFrame(animationLoop);
}

/**
 * Renders a single frame of the animation to the preview canvas.
 */
function renderPreview() {
    if (!previewCtx) return;
    const canvas = previewCtx.canvas;

    const frame = state.frames[currentFrameIdx];
    if (!frame) {
        previewCtx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    canvas.width = frame.width * zoom;
    canvas.height = frame.height * zoom;

    previewCtx.clearRect(0, 0, canvas.width, canvas.height);

    const cbBackground = document.getElementById('prevChkBackground');
    if (cbBackground && cbBackground.checked && state.palette) {
        const bgCol = state.palette[0] || { r: 0, g: 0, b: 0 };
        previewCtx.fillStyle = `rgb(${bgCol.r}, ${bgCol.g}, ${bgCol.b})`;
        previewCtx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const cbShadow = document.getElementById('prevChkShadows');
    const useShadow = cbShadow && cbShadow.checked;

    const totalFrames = state.frames.length;
    let shadowFrame = null;
    let shadowIdx = null;
    const maxIndex = totalFrames > 0 ? totalFrames - 1 : 0;
    let actualCounterText = `${currentFrameIdx} / ${maxIndex}`;

    if (useShadow && totalFrames % 2 === 0) {
        shadowIdx = currentFrameIdx + (totalFrames / 2);
        shadowFrame = state.frames[shadowIdx];
        const shadowMaxIndex = (totalFrames / 2) - 1;
        actualCounterText = `${currentFrameIdx} / ${shadowMaxIndex}`;
    }

    const showIndex0 = cbBackground && cbBackground.checked;

    // 1. Draw Shadow (if enabled)
    if (shadowFrame) {
        compositeFrame(shadowFrame, {
            ctx: previewCtx,
            zoom: zoom,
            palette: state.palette,
            isShadow: true,
            transparentIdx: TRANSPARENT_COLOR,
            showIndex0: false
        });
    }

    // 2. Draw Normal Frame
    const compositeData = compositeFrame(frame, {
        ctx: previewCtx,
        zoom: zoom,
        palette: state.palette,
        floatingSelection: state.floatingSelection,
        remapBase: baseColorRamp,
        transparentIdx: TRANSPARENT_COLOR,
        showIndex0: false
    });

    // Update Counter & Slider
    const counter = document.getElementById('prevFrameCounter');
    if (counter) {
        counter.textContent = actualCounterText;
    }

    // Update Slider if playing (so it follows the animation)
    const slider = document.getElementById('prevSliderTimeline');
    if (slider && isPlaying) {
        slider.value = currentFrameIdx;
    }
    // Draw Game Grid (ISO) if enabled - AFTER drawing frame
    if (state.isoGrid && state.isoGrid !== 'none' && frame) {
        // Use the exact same logic as main canvas to ensure pixel-perfect match
        const isTS = state.isoGrid === 'ts';
        const tileW = isTS ? 48 : 60;
        const color = { r: 255, g: 255, b: 255, a: 180 };

        const fw = frame.width;
        const fh = frame.height;
        const cx = Math.floor(fw / 2);
        const cy = fh;

        previewCtx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;

        for (let py = 0; py < fh; py++) {
            for (let px = 0; px < fw; px++) {
                // Skip if this pixel has actual image content
                if (compositeData && compositeData[py * fw + px] !== TRANSPARENT_COLOR && compositeData[py * fw + px] !== 0) {
                    continue;
                }

                const dx = px - cx;
                const dy = py - cy;
                const u = dx + 2 * dy;
                const v = 2 * dy - dx;
                if (Math.abs(u % tileW) < 2 || Math.abs(v % tileW) < 2) {
                    // Draw a scalable rect for each pixel
                    previewCtx.fillRect(px * zoom, py * zoom, zoom, zoom);
                }
            }
        }
    }
}

/**
 * Draws a frame's layers to a context.
 */


/**
 * Sets up side color buttons and remapping logic.
 */
function setupSideColors() {
    const container = document.getElementById('prevSideColorGrid');
    if (!container) return;

    // Define standard C&C house colors
    const presets = [
        { name: t('clr_red'), color: '#b40000' },
        { name: t('clr_gold_yellow'), color: '#ffd700' },
        { name: t('clr_green'), color: '#008000' },
        { name: t('clr_blue'), color: '#0000b4' },
        { name: t('clr_orange'), color: '#ff8000' },
        { name: t('clr_sky_blue'), color: '#00ffff' },
        { name: t('clr_pink'), color: '#ff69b4' },
        { name: t('clr_purple'), color: '#800080' }
    ];

    container.innerHTML = ''; // Clear for initialization

    // Define standard C&C house colors for quick palette remapping presets
    const houseColors = [
        { name: t('clr_red'), hex: '#bf0000' },
        { name: t('clr_gold_yellow'), hex: '#e3a502' },
        { name: t('clr_green'), hex: '#48bb78' },
        { name: t('clr_blue'), hex: '#2255ff' },
        { name: t('clr_light_red'), hex: '#f56565' },
        { name: t('clr_orange'), hex: '#ed8936' },
        { name: t('clr_teal'), hex: '#4fd1c5' },
        { name: t('clr_pink'), hex: '#d53f8c' }
    ];

    houseColors.forEach((item, i) => {
        const color = item.hex;
        const btn = document.createElement('button');
        btn.className = 'side-color-btn'; // Updated class for smaller size
        btn.style.backgroundColor = color;
        btn.dataset.title = `${item.name} (${color.toUpperCase()})`;

        // Check active state using index
        if (state.previewSideColorIdx === i) {
            btn.classList.add('active');
        }

        btn.onclick = () => {
            if (state.previewSideColorIdx === i) {
                // Deselect if clicking the same color
                state.previewSideColorIdx = null;
            } else {
                state.previewSideColorIdx = i;
                state.previewCustomColorHex = null; // Clear custom selection if present
                updateBaseColorRamp(color); // Update the ramp so the remap logic has a target
            }
            setupSideColors();
            renderCustomHistory(); // Re-render custom history to clear active state there
            renderPreview();
        };
        container.appendChild(btn);
    });

    const picker = document.getElementById('prevColorPicker');
    const btnAdd = document.getElementById('prevBtnAddHistory');

    if (picker) {
        // Enable add button when picker is used
        picker.onclick = () => {
            if (btnAdd) {
                btnAdd.disabled = false;
                btnAdd.style.opacity = "1";
                btnAdd.style.pointerEvents = "auto";
            }
        };

        // oninput: real-time visual update while dragging
        picker.oninput = (e) => {
            // Remove active state from other buttons
            const buttons = document.querySelectorAll('#prevSideColorGrid button, #prevCustomHistoryGrid .history-slot');
            buttons.forEach(b => b.classList.remove('active'));

            updateBaseColorRamp(e.target.value);
            renderPreview();
        };

        // onchange: also save to history when picker is closed
        picker.onchange = (e) => addToColorHistory(e.target.value);
    }

    if (btnAdd && picker) {
        // Initially disabled
        btnAdd.disabled = true;
        btnAdd.style.opacity = "0.5";
        btnAdd.style.pointerEvents = "none";

        btnAdd.onclick = () => {
            addToColorHistory(picker.value);
        };
    }
}

function addToColorHistory(hex) {
    // Check if duplicate
    const idx = customColorHistory.indexOf(hex);
    if (idx !== -1) {
        // Move to front
        customColorHistory.splice(idx, 1);
    }
    customColorHistory.unshift(hex);
    if (customColorHistory.length > 8) {
        customColorHistory.length = 8;
    }
    renderCustomHistory();
}

function renderCustomHistory() {
    const grid = document.getElementById('prevCustomHistoryGrid');
    const container = document.getElementById('prevCustomHistoryGrid');
    if (!grid) return;
    grid.innerHTML = '';

    for (let i = 0; i < 8; i++) {
        const slot = document.createElement('button');
        slot.className = 'side-color-btn';
        slot.style.borderStyle = 'dashed';
        slot.style.borderColor = '#444';
        slot.style.background = 'transparent';

        const color = customColorHistory[i];
        if (color) {
            slot.style.backgroundColor = color;
            slot.style.borderStyle = 'solid';
            slot.dataset.title = `${t('clr_custom')} (${color.toUpperCase()})`;

            // Check active state
            if (state.previewCustomColorHex === color) {
                slot.classList.add('active');
            }

            slot.onclick = () => {
                if (state.previewCustomColorHex === color) {
                    // Deselect
                    state.previewCustomColorHex = null;
                    state.previewSideColorIdx = null; // Ensure preset is clear
                } else {
                    state.previewCustomColorHex = color;
                    state.previewSideColorIdx = null; // Clear preset selection
                    updateBaseColorRamp(color);
                }

                // Refresh UIs
                renderCustomHistory();
                setupSideColors(); // To clear active state on presets
                renderPreview();
            };
        }
        grid.appendChild(slot);
    }
}

// Helper to remove active class if we handle it manually now
function setActiveColorBtn(activeBtn) {
    // Deprecated or simplified? 
    // We handle active class via re-render now.
    // But picker drag still needs immediate feedback?
    // Update the ramp configuration with the newly selected custom side color.
    if (!activeBtn) return;
    const container = document.getElementById('prevSideColorGrid');
    const historyGrid = document.getElementById('prevCustomHistoryGrid');
    if (container) container.querySelectorAll('.side-color-btn').forEach(btn => btn.classList.remove('active'));
    if (historyGrid) historyGrid.querySelectorAll('.side-color-btn').forEach(btn => btn.classList.remove('active'));
    activeBtn.classList.add('active');
}

/**
 * Updates the base house color for remapping.
 */
function updateBaseColorRamp(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    // Store as simple object for weighted algorithm
    baseColorRamp = { r, g, b };
}
