import { state, TRANSPARENT_COLOR } from './state.js';
import { compositeFrame, setupAutoRepeat, SVG_PLAY_MODERN, SVG_PAUSE_MODERN, SVG_STEP_BACK_MODERN, SVG_STEP_FWD_MODERN } from './utils.js';
import { showConfirm } from './ui.js';
import { t } from './translations.js';

// ============================================================
// VEHICLE SEQUENCE EDITOR
// ============================================================

// Predefined ACTION definitions. Each action verb adds a pair of Start/Count entries.
const VSEQ_ACTION_DEFS = [
    {
        verb: 'Standing',
        labelKey: 'vseq_verb_standing',
        startProp: 'StartStandFrame',
        countProp: 'StandingFrames',
        startDescKey: 'vseq_std_start',
        countDescKey: 'vseq_std_count'
    },
    {
        verb: 'Walk',
        labelKey: 'vseq_verb_walk',
        startProp: 'StartWalkFrame',
        countProp: 'WalkFrames',
        startDescKey: 'vseq_walk_start',
        countDescKey: 'vseq_walk_count'
    },
    {
        verb: 'Firing',
        labelKey: 'vseq_verb_firing',
        startProp: 'StartFiringFrame',
        countProp: 'FiringFrames',
        startDescKey: 'vseq_fire_start',
        countDescKey: 'vseq_fire_count'
    },
    {
        verb: 'Death (Only in Tiberian Sun)',
        labelKey: 'vseq_verb_death_ts',
        startProp: 'StartDeathFrame',
        countProp: 'DeathFrames',
        startDescKey: 'vseq_death_start',
        countDescKey: 'vseq_death_count'
    },
    {
        verb: 'Idle (Vinifera only)',
        labelKey: 'vseq_verb_idle_vin',
        startProp: 'StartIdleFrame',
        countProp: 'IdleFrames',
        startDescKey: 'vseq_idle_start',
        countDescKey: 'vseq_idle_count'
    }
];

// All recognized INI keys (for Plain Text parsing)
const VSEQ_KNOWN_KEYS = new Set();
VSEQ_ACTION_DEFS.forEach(a => { VSEQ_KNOWN_KEYS.add(a.startProp); VSEQ_KNOWN_KEYS.add(a.countProp); });

let vseq_Facings = 8;
// Each entry: { verb, startFrame, frameCount (null = empty), error }
let vseq_Entries = [];
let vseq_SelectedIndices = new Set();
let vseq_CurrentTab = 'visual';
let vseq_PlayerTimers = {};
let vseq_PreviewState = {};
let vseq_DraggedIdx = null;

function vseq_isValidString(s) {
    return /^[a-zA-Z0-9_-]+$/.test(s);
}

function vseq_getNormalFrameCount() {
    const totalFrames = state.frames ? state.frames.length : 0;
    return (state.useShadows || false) ? Math.floor(totalFrames / 2) : totalFrames;
}

// Find the action definition by verb name
function vseq_getActionDef(verb) {
    return VSEQ_ACTION_DEFS.find(a => a.verb === verb) || null;
}

// Find the action definition by one of its INI property names
function vseq_getActionDefByProp(propName) {
    return VSEQ_ACTION_DEFS.find(a => a.startProp === propName || a.countProp === propName) || null;
}

function vseq_validateEntry(entry) {
    const normalFrames = vseq_getNormalFrameCount();
    if (normalFrames <= 0) return null;

    const startVal = entry.startFrame;
    const countVal = entry.frameCount === null ? 1 : entry.frameCount;

    if (startVal < 0) return 'Start frame < 0';
    if (countVal < 0) return 'Frame count < 0';

    if (countVal === 0) {
        if (startVal >= normalFrames) return `Start frame exceeds SHP (max: ${normalFrames - 1})`;
        return null;
    }

    const totalNeeded = vseq_getTotalFramesUsed({ ...entry, frameCount: countVal });
    const lastFrame = startVal + totalNeeded - 1;

    if (lastFrame >= normalFrames) {
        return `Exceeds SHP: needs ${totalNeeded} frames (ends at ${lastFrame}, max ${normalFrames - 1})`;
    }
    return null;
}

function vseq_getTotalFramesUsed(entry) {
    const count = entry.frameCount === null ? 1 : entry.frameCount;
    if (count <= 0) return 0;
    if (entry.verb === 'Death (Only in Tiberian Sun)') return count;
    return vseq_Facings * count;
}

function vseq_serializeToINI() {
    let lines = [];
    if (vseq_Facings !== 8) lines.push(`Facings=${vseq_Facings}`);
    for (const e of vseq_Entries) {
        const def = vseq_getActionDef(e.verb);
        if (def) {
            lines.push(`${def.startProp}=${e.startFrame}`);
            if (e.frameCount !== null && e.frameCount !== '') {
                lines.push(`${def.countProp}=${e.frameCount}`);
            } else {
                lines.push(`; ${def.countProp} is inherited from engine defaults`);
            }
        }
    }
    return lines.join('\n');
}

function vseq_parseINI(text) {
    const rawLines = text.split(/\r?\n/);
    let facings = 8; // Default when not specified
    const entries = [];
    const propMap = {}; // Gather property values by prop name

    for (const rl of rawLines) {
        let line = rl.split(';')[0].trim();
        if (!line) continue;
        if (line.startsWith('[')) continue;
        const kvMatch = line.match(/^([^=]+)=(.+)$/);
        if (!kvMatch) continue;
        const name = kvMatch[1].trim();
        const valStr = kvMatch[2].trim();
        // Ensure the value is a valid integer (optionally starting with a minus sign)
        if (!/^-?\d+$/.test(valStr)) continue;
        const val = parseInt(valStr);

        if (name.toLowerCase() === 'facings') {
            facings = val;
            continue;
        }

        // Only process known keys (propMap already excludes non-integer values by the regex check above)
        if (VSEQ_KNOWN_KEYS.has(name)) {
            propMap[name] = val;
        }
    }

    // Build entries from action definitions
    for (const def of VSEQ_ACTION_DEFS) {
        const hasStart = def.startProp in propMap;
        const hasCount = def.countProp in propMap;
        if (hasStart || hasCount) {
            const e = {
                verb: def.verb,
                startFrame: hasStart ? propMap[def.startProp] : 0,
                frameCount: hasCount ? propMap[def.countProp] : null,
                error: null
            };
            e.error = vseq_validateEntry(e);
            entries.push(e);
        }
    }

    return { facings, entries };
}

function vseq_renderFrameToCanvas(canvas, shpFrameIdx, shadowFrameIdx) {
    const ctx = canvas.getContext('2d');
    const totalFrames = state.frames ? state.frames.length : 0;
    if (!totalFrames || shpFrameIdx < 0 || shpFrameIdx >= totalFrames) {
        ctx.clearRect(0, 0, canvas.width, canvas.height); return;
    }
    const frame = state.frames[shpFrameIdx];
    canvas.width = frame.width; canvas.height = frame.height;
    const composited = compositeFrame(frame, { backgroundIdx: TRANSPARENT_COLOR, transparentIdx: TRANSPARENT_COLOR });
    const imgData = ctx.createImageData(frame.width, frame.height);
    const d = imgData.data;
    if (shadowFrameIdx >= 0 && shadowFrameIdx < totalFrames) {
        const shadowComp = compositeFrame(state.frames[shadowFrameIdx], { backgroundIdx: TRANSPARENT_COLOR, transparentIdx: TRANSPARENT_COLOR });
        for (let i = 0; i < frame.width * frame.height; i++) {
            if (shadowComp[i] !== TRANSPARENT_COLOR && shadowComp[i] !== 0) {
                const k = i * 4; d[k] = 0; d[k + 1] = 0; d[k + 2] = 0; d[k + 3] = 100;
            }
        }
    }
    for (let i = 0; i < frame.width * frame.height; i++) {
        if (composited[i] !== TRANSPARENT_COLOR) {
            const c = state.palette[composited[i]];
            if (c) { const k = i * 4; d[k] = c.r; d[k + 1] = c.g; d[k + 2] = c.b; d[k + 3] = 255; }
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

function vseq_createNumericControl(label, value, min, tooltip, onChange, allowEmpty) {
    const wrapper = document.createElement('div');
    wrapper.className = 'seq-num-row';
    const lbl = document.createElement('label');
    lbl.className = 'seq-num-label'; lbl.textContent = label;
    if (tooltip) lbl.setAttribute('data-title', tooltip);
    wrapper.appendChild(lbl);

    const stepper = document.createElement('div');
    stepper.className = 'input-stepper';
    stepper.style.flex = '1';
    stepper.style.height = '24px';

    const btnMinus = document.createElement('button');
    btnMinus.className = 'step-btn step-btn-minus'; btnMinus.textContent = '\u2212';
    btnMinus.title = 'Decrease (Ctrl+Click for -5)';
    stepper.appendChild(btnMinus);

    const input = document.createElement('input');
    input.type = 'number'; input.className = 'input-step';
    input.style.flex = '1';
    input.style.minWidth = '0';
    input.style.fontSize = '12px';
    input.min = min;
    if (allowEmpty && value === null) {
        input.value = '';
    } else {
        input.value = value;
    }
    stepper.appendChild(input);

    const btnPlus = document.createElement('button');
    btnPlus.className = 'step-btn step-btn-plus'; btnPlus.textContent = '+';
    btnPlus.title = 'Increase (Ctrl+Click for +5)';
    stepper.appendChild(btnPlus);

    wrapper.appendChild(stepper);

    input.onchange = () => {
        if (allowEmpty && input.value.trim() === '') {
            onChange(null); return;
        }
        let v = parseInt(input.value) || 0; if (v < min) v = min;
        input.value = v; onChange(v);
    };
    const doChange = (ev, delta) => {
        const step = ev.ctrlKey ? 5 : 1;
        // If empty, start from 0
        const current = (allowEmpty && input.value.trim() === '') ? 0 : (parseInt(input.value) || 0);
        let v = Math.max(min, current + delta * step);
        input.value = v; onChange(v);
    };
    setupAutoRepeat(btnMinus, (ev) => doChange(ev, -1));
    setupAutoRepeat(btnPlus, (ev) => doChange(ev, 1));
    return wrapper;
}

// Compute degree label for a given facing index
function vseq_getFacingLabel(facingIdx, totalFacings) {
    const degreesPerFacing = 360 / totalFacings;
    const degrees = Math.round(facingIdx * degreesPerFacing);
    return `${degrees}°`;
}

function vseq_renderCards() {
    vseq_stopAllPlayers();
    const container = document.getElementById('vseqCardsContainer');
    if (!container) return;
    container.innerHTML = '';
    const totalFrames = state.frames ? state.frames.length : 0;
    const useShadows = state.useShadows || false;

    for (let i = 0; i < vseq_Entries.length; i++) {
        const entry = vseq_Entries[i];
        const def = vseq_getActionDef(entry.verb);
        if (!vseq_PreviewState[entry.verb]) vseq_PreviewState[entry.verb] = { facingIdx: -1, frameIdx: 0, loop: true, playbackSpeed: 1.0 };
        const pState = vseq_PreviewState[entry.verb];

        const card = document.createElement('div');
        card.className = 'seq-card' + (entry.error ? ' seq-card-error' : '');
        const header = document.createElement('div'); header.className = 'seq-card-header';
        const cardTitle = def ? (t(def.labelKey) || entry.verb) : entry.verb;
        header.innerHTML = `<span class="seq-card-title">${cardTitle}</span>` +
            `<span class="seq-card-frames-info"></span>`;
        card.appendChild(header);

        const body = document.createElement('div'); body.className = 'seq-card-body';
        const controls = document.createElement('div'); controls.className = 'seq-card-controls';
        const preview = document.createElement('div'); preview.className = 'seq-card-preview';

        const canvas = document.createElement('canvas'); canvas.className = 'seq-preview-canvas';
        const canvasWrap = document.createElement('div'); canvasWrap.className = 'seq-preview-canvas-wrap checkerboard-bg';
        const spacer = document.createElement('img'); spacer.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; spacer.style.height = '220px'; spacer.style.width = '1px'; spacer.style.visibility = 'hidden';
        canvasWrap.append(spacer, canvas); preview.appendChild(canvasWrap);

        const timeline = document.createElement('div'); timeline.className = 'seq-timeline';
        const btnStepBack = document.createElement('button'); btnStepBack.className = 'seq-tl-btn'; btnStepBack.innerHTML = SVG_STEP_BACK_MODERN;
        const btnPlay = document.createElement('button'); btnPlay.className = 'seq-tl-btn seq-play-btn'; btnPlay.innerHTML = SVG_PLAY_MODERN;
        const btnStep = document.createElement('button'); btnStep.className = 'seq-tl-btn'; btnStep.innerHTML = SVG_STEP_FWD_MODERN;
        const slider = document.createElement('input'); slider.type = 'range'; slider.className = 'seq-tl-slider';
        const counter = document.createElement('span'); counter.className = 'seq-tl-counter';
        timeline.append(btnStepBack, btnPlay, btnStep, slider, counter);
        preview.appendChild(timeline);

        const getAnimCount = () => {
            if (entry.frameCount === null) return 1;
            return entry.frameCount > 0 ? entry.frameCount : 0;
        };

        const updatePreview = () => {
            // Validation
            entry.error = vseq_validateEntry(entry);
            vseq_updateCardState(card, entry);

            const animCount = getAnimCount();

            if (entry.error || animCount <= 0) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                slider.max = 0; slider.value = 0;
                counter.textContent = '0/0';
                return;
            }

            const fIdx = pState.facingIdx;
            let shpIdx = -1, currentMax = 0;

            if (fIdx === -1) {
                // All facings mode: play through all frames linearly
                currentMax = vseq_getTotalFramesUsed(entry);
                if (currentMax <= 0) return;
                if (pState.frameIdx >= currentMax) pState.frameIdx = 0;
                shpIdx = entry.startFrame + pState.frameIdx;
            } else {
                // Single facing mode
                currentMax = animCount;
                if (pState.frameIdx >= currentMax) pState.frameIdx = 0;

                // For Death, there is only 1 facing logically, so no multiply by facings
                const isDeath = entry.verb === 'Death (Only in Tiberian Sun)';
                const facingOffset = isDeath ? 0 : fIdx * animCount;
                shpIdx = entry.startFrame + facingOffset + pState.frameIdx;
            }

            let shadowIdx = -1;
            if (useShadows && shpIdx + Math.floor(totalFrames / 2) < totalFrames) shadowIdx = shpIdx + Math.floor(totalFrames / 2);
            vseq_renderFrameToCanvas(canvas, shpIdx, shadowIdx);
            slider.max = Math.max(0, currentMax - 1); slider.value = pState.frameIdx;
            counter.textContent = `${pState.frameIdx}/${Math.max(0, currentMax - 1)}`;

            // Frame info
            const totalUsed = vseq_getTotalFramesUsed(entry);
            const endFrame = entry.startFrame + totalUsed - 1;
            const info = card.querySelector('.seq-card-frames-info');
            if (info && totalUsed > 0) info.textContent = `Frames: ${entry.startFrame} - ${endFrame} (${totalUsed} total)`;
            else if (info) info.textContent = '';
        };

        // Start Frame control
        controls.appendChild(vseq_createNumericControl(
            def ? def.startProp : 'Start Frame',
            entry.startFrame, 0,
            def ? t(def.startDescKey) : 'Starting frame index in the SHP',
            (v) => {
                entry.startFrame = (v === null) ? 0 : v;
                entry.error = vseq_validateEntry(entry);
                vseq_renderLeftPanel();
                updatePreview();
            },
            false
        ));

        // Frame Count control (allows empty)
        controls.appendChild(vseq_createNumericControl(
            def ? def.countProp : 'Frame Count',
            entry.frameCount, 0,
            def ? t(def.countDescKey) : 'Number of frames per facing',
            (v) => {
                entry.frameCount = v;
                // Just validate and update preview without rebuilding DOM to prevent pausing
                entry.error = vseq_validateEntry(entry);
                vseq_renderLeftPanel();
                updatePreview();
            },
            true // allowEmpty
        ));

        // Preview facing selector (like Infantry editor)
        const prefRow = document.createElement('div'); prefRow.className = 'seq-num-row';
        prefRow.style.cssText = 'margin-top:6px; padding-top:8px; border-top:1px solid #2d3748;';
        prefRow.innerHTML = `<label class="seq-num-label" style="min-width:90px;">Preview</label>`;
        const facingSelect = document.createElement('select'); facingSelect.className = 'seq-direction-select';

        const isDeathVerb = entry.verb === 'Death (Only in Tiberian Sun)';

        if (isDeathVerb) {
            const optAll = document.createElement('option');
            optAll.value = '-1'; optAll.textContent = t('opt_vseq_single') || 'Single Sequence';
            facingSelect.appendChild(optAll);
            facingSelect.disabled = true;
            pState.facingIdx = -1; // Force single sequence state
        } else {
            // "All facings" option (default)
            const optAll = document.createElement('option');
            optAll.value = '-1'; optAll.textContent = t('opt_all_facings') || 'All facings';
            if (pState.facingIdx === -1) optAll.selected = true;
            facingSelect.appendChild(optAll);

            // Individual facing options labeled with degrees
            for (let f = 0; f < vseq_Facings; f++) {
                const opt = document.createElement('option');
                opt.value = f;
                opt.textContent = vseq_getFacingLabel(f, vseq_Facings);
                if (pState.facingIdx === f) opt.selected = true;
                facingSelect.appendChild(opt);
            }
        }

        facingSelect.onchange = () => { pState.facingIdx = parseInt(facingSelect.value); pState.frameIdx = 0; updatePreview(); };
        prefRow.appendChild(facingSelect); controls.appendChild(prefRow);

        // Loop checkbox
        const loopRow = document.createElement('div'); loopRow.className = 'seq-num-row'; loopRow.style.justifyContent = 'flex-end';
        loopRow.innerHTML = `<label style="font-size:11px; color:#718096; display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" ${pState.loop ? 'checked' : ''} style="margin:0;"> ${t('lbl_loop_anim') || 'Loop animation'}</label>`;
        loopRow.querySelector('input').onchange = (e) => { pState.loop = e.target.checked; };
        controls.appendChild(loopRow);

        // Speed control
        const speedRow = document.createElement('div'); speedRow.className = 'seq-num-row';
        speedRow.style.marginTop = '6px';
        speedRow.innerHTML = `<label class="seq-num-label" style="min-width:90px;">${t('lbl_speed') || 'Speed'}</label>`;

        const zoomGroup = document.createElement('div');
        zoomGroup.className = 'status-zoom-group';
        zoomGroup.style.cssText = 'padding:0; background:transparent; border:none; gap:2px; height:24px; flex:1; display:flex; align-items:center;';

        const btnReset = document.createElement('button');
        btnReset.className = 'status-zoom-btn';
        btnReset.title = 'Reset to 1.0x';
        btnReset.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
        btnReset.style.cssText = 'display:flex; align-items:center; justify-content:center; border-radius:4px; width:24px; height:24px; border:1px solid #4a5568 !important; flex-shrink:0;';

        const btnMinus = document.createElement('button');
        btnMinus.className = 'status-zoom-btn status-zoom-btn-minus';
        btnMinus.textContent = '\u2212';
        btnMinus.style.cssText = 'border-radius:4px 0 0 4px; width:24px; height:24px; border:1px solid #4a5568 !important; border-right:none !important; flex-shrink:0;';

        const speedSliderWrap = document.createElement('div');
        speedSliderWrap.className = 'status-zoom-slider-container';
        speedSliderWrap.style.cssText = 'height: 24px; flex:1;';

        const speedBar = document.createElement('div');
        speedBar.className = 'status-zoom-bar';

        const speedSlider = document.createElement('input');
        speedSlider.type = 'range'; speedSlider.className = 'status-zoom-slider';
        speedSlider.style.height = '24px';
        speedSlider.min = '0.2'; speedSlider.max = '2.0'; speedSlider.step = '0.2';
        speedSlider.value = pState.playbackSpeed || 1.0;

        const speedVal = document.createElement('span');
        speedVal.className = 'status-zoom-val';
        speedVal.style.cssText = 'font-size:10px; line-height:24px; pointer-events:none;';
        speedVal.textContent = (pState.playbackSpeed || 1.0).toFixed(2) + 'x';

        speedSliderWrap.append(speedBar, speedSlider, speedVal);

        const btnPlus = document.createElement('button');
        btnPlus.className = 'status-zoom-btn status-zoom-btn-plus';
        btnPlus.textContent = '+';
        btnPlus.style.cssText = 'border-radius:0 4px 4px 0; width:24px; height:24px; border:1px solid #4a5568 !important; border-left:none !important; flex-shrink:0;';

        const togglePlay = () => {
            if (vseq_PlayerTimers[i]) { clearInterval(vseq_PlayerTimers[i]); delete vseq_PlayerTimers[i]; btnPlay.innerHTML = SVG_PLAY_MODERN; return; }
            vseq_stopAllPlayers();
            btnPlay.innerHTML = SVG_PAUSE_MODERN;
            vseq_PlayerTimers[i] = setInterval(() => {
                const mx = (pState.facingIdx === -1) ? vseq_getTotalFramesUsed(entry) : getAnimCount();
                if (mx <= 0) return;
                if (pState.frameIdx + 1 >= mx) {
                    if (!pState.loop) { vseq_stopAllPlayers(); pState.frameIdx = 0; updatePreview(); return; }
                    pState.frameIdx = 0;
                } else pState.frameIdx++;
                updatePreview();
            }, 100 / (pState.playbackSpeed || 1.0));
        };

        const updateSpeedValue = (v) => {
            const sv = Math.max(0.2, Math.min(2.0, parseFloat(v) || 1.0));
            pState.playbackSpeed = sv;
            speedSlider.value = sv;
            speedVal.textContent = sv.toFixed(2) + 'x';
            const pct = ((sv - 0.2) / (2.0 - 0.2)) * 100;
            speedBar.style.width = pct + '%';
            if (vseq_PlayerTimers[i]) { 
                // Restart timer with new speed without triggering DOM clicks
                clearInterval(vseq_PlayerTimers[i]);
                vseq_PlayerTimers[i] = setInterval(() => {
                    const mx = (pState.facingIdx === -1) ? vseq_getTotalFramesUsed(entry) : getAnimCount();
                    if (mx <= 0) return;
                    if (pState.frameIdx + 1 >= mx) {
                        if (!pState.loop) { vseq_stopAllPlayers(); pState.frameIdx = 0; updatePreview(); return; }
                        pState.frameIdx = 0;
                    } else pState.frameIdx++;
                    updatePreview();
                }, 100 / (pState.playbackSpeed || 1.0));
            }
        };

        btnReset.onclick = () => updateSpeedValue(1.0);
        speedSlider.oninput = () => updateSpeedValue(speedSlider.value);
        setupAutoRepeat(btnMinus, (ev) => updateSpeedValue((pState.playbackSpeed || 1.0) - 0.2));
        setupAutoRepeat(btnPlus, (ev) => updateSpeedValue((pState.playbackSpeed || 1.0) + 0.2));

        const initialPct = (((pState.playbackSpeed || 1.0) - 0.2) / (2.0 - 0.2)) * 100;
        speedBar.style.width = initialPct + '%';

        zoomGroup.append(btnReset, btnMinus, speedSliderWrap, btnPlus);
        speedRow.appendChild(zoomGroup);
        controls.appendChild(speedRow);

        updatePreview();
        slider.oninput = () => { pState.frameIdx = parseInt(slider.value) || 0; updatePreview(); };
        btnStepBack.onclick = () => {
            if (vseq_PlayerTimers[i]) { togglePlay(); }
            const mx = (pState.facingIdx === -1) ? vseq_getTotalFramesUsed(entry) : getAnimCount();
            pState.frameIdx--; if (pState.frameIdx < 0) pState.frameIdx = Math.max(0, mx - 1);
            updatePreview();
        };
        btnStep.onclick = () => {
            if (vseq_PlayerTimers[i]) { togglePlay(); }
            const mx = (pState.facingIdx === -1) ? vseq_getTotalFramesUsed(entry) : getAnimCount();
            pState.frameIdx++; if (pState.frameIdx >= mx) pState.frameIdx = 0;
            updatePreview();
        };
        btnPlay.onclick = togglePlay;

        body.append(controls, preview);
        card.appendChild(body); container.appendChild(card);
    }
}

function vseq_updateCardState(card, entry) {
    const header = card.querySelector('.seq-card-header');
    let errMsg = card.querySelector('.seq-card-error-msg');
    if (!errMsg) {
        errMsg = document.createElement('div');
        errMsg.className = 'seq-card-error-msg';
        header.after(errMsg);
    }
    if (entry.error) {
        card.classList.add('seq-card-error');
        errMsg.textContent = '\u26A0 ' + entry.error;
        errMsg.style.visibility = 'visible';
    } else {
        card.classList.remove('seq-card-error');
        errMsg.textContent = '';
        errMsg.style.visibility = 'hidden';
    }
}

function vseq_moveSelectedEntries(delta) {
    if (vseq_SelectedIndices.size === 0) return;
    const indices = [...vseq_SelectedIndices].sort((a, b) => a - b);
    if (delta < 0) {
        if (indices[0] === 0) return;
        for (const i of indices) [vseq_Entries[i], vseq_Entries[i - 1]] = [vseq_Entries[i - 1], vseq_Entries[i]];
        vseq_SelectedIndices = new Set(indices.map(i => i - 1));
    } else {
        if (indices[indices.length - 1] === vseq_Entries.length - 1) return;
        for (let k = indices.length - 1; k >= 0; k--) {
            const i = indices[k];[vseq_Entries[i], vseq_Entries[i + 1]] = [vseq_Entries[i + 1], vseq_Entries[i]];
        }
        vseq_SelectedIndices = new Set(indices.map(i => i + 1));
    }

    vseq_renderLeftPanel();
    if (vseq_CurrentTab === 'visual') {
        vseq_renderCards();
    } else {
        const area = document.getElementById('vseqTextArea');
        if (area) area.value = vseq_serializeToINI();
    }
}

function vseq_handleDrop(targetIdx, e) {
    e.preventDefault();
    if (vseq_DraggedIdx === null || vseq_DraggedIdx === targetIdx) return;
    const item = vseq_Entries.splice(vseq_DraggedIdx, 1)[0];
    const actualInsertIdx = targetIdx > vseq_DraggedIdx ? targetIdx - 1 : targetIdx;
    vseq_Entries.splice(actualInsertIdx, 0, item);
    vseq_SelectedIndices.clear(); vseq_SelectedIndices.add(actualInsertIdx);
    vseq_DraggedIdx = null; vseq_renderLeftPanel();
    if (vseq_CurrentTab === 'visual') {
        vseq_renderCards();
    } else {
        const area = document.getElementById('vseqTextArea');
        if (area) area.value = vseq_serializeToINI();
    }
}

function vseq_stopAllPlayers() {
    Object.keys(vseq_PlayerTimers).forEach(k => { clearInterval(vseq_PlayerTimers[k]); delete vseq_PlayerTimers[k]; });
    document.querySelectorAll('#vehicleSeqDialog .seq-play-btn').forEach(b => { b.innerHTML = SVG_PLAY_MODERN; });
}

function vseq_renderLeftPanel() {
    const list = document.getElementById('vseqEntryList'); if (!list) return; list.innerHTML = '';
    vseq_Entries.forEach((e, i) => {
        const div = document.createElement('div');
        div.className = 'seq-entry-item' + (vseq_SelectedIndices.has(i) ? ' selected' : '') + (e.error ? ' has-error' : '');
        div.draggable = true;
        const countStr = (e.frameCount !== null) ? e.frameCount : '—';
        const def = vseq_getActionDef(e.verb);
        const label = def ? (t(def.labelKey) || e.verb) : e.verb;
        div.innerHTML = `<span class="seq-entry-name">${label}</span><span class="seq-entry-vals">${e.startFrame}, ${countStr}</span>`;
        div.onclick = (ev) => {
            if (ev.ctrlKey) { if (vseq_SelectedIndices.has(i)) vseq_SelectedIndices.delete(i); else vseq_SelectedIndices.add(i); }
            else if (ev.shiftKey && vseq_SelectedIndices.size > 0) {
                const last = [...vseq_SelectedIndices].pop();
                const start = Math.min(last, i), end = Math.max(last, i);
                for (let k = start; k <= end; k++) vseq_SelectedIndices.add(k);
            }
            else { vseq_SelectedIndices.clear(); vseq_SelectedIndices.add(i); }
            vseq_renderLeftPanel();
        };
        div.ondragstart = (ev) => { vseq_DraggedIdx = i; div.classList.add('dragging'); ev.dataTransfer.effectAllowed = 'move'; };
        div.ondragend = () => { div.classList.remove('dragging'); vseq_DraggedIdx = null; };
        div.ondragover = (ev) => { ev.preventDefault(); div.classList.add('drag-over'); };
        div.ondragleave = () => { div.classList.remove('drag-over'); };
        div.ondrop = (ev) => { div.classList.remove('drag-over'); vseq_handleDrop(i, ev); };
        list.appendChild(div);
    });
    const hasSel = vseq_SelectedIndices.size > 0;
    document.getElementById('vseqBtnDeleteSelected').style.display = hasSel ? '' : 'none';
    document.getElementById('vseqBtnMoveUp').style.display = hasSel ? '' : 'none';
    document.getElementById('vseqBtnMoveDown').style.display = hasSel ? '' : 'none';
}

function vseq_switchTab(tab) {
    vseq_CurrentTab = tab;
    const vTab = document.getElementById('vseqTabVisual'), tTab = document.getElementById('vseqTabText');
    const vBtn = document.getElementById('vseqTabBtnVisual'), tBtn = document.getElementById('vseqTabBtnText');

    if (tab === 'visual') {
        tTab.classList.remove('active');
        vTab.classList.add('active');
        tBtn.classList.remove('active');
        vBtn.classList.add('active');
        vseq_renderCards();
    } else {
        vseq_stopAllPlayers();
        vTab.classList.remove('active');
        tTab.classList.add('active');
        vBtn.classList.remove('active');
        tBtn.classList.add('active');
        const area = document.getElementById('vseqTextArea');
        if (area) {
            area.value = vseq_serializeToINI();
            setTimeout(() => area.focus(), 10);
        }
    }
}

export function openVehicleSequenceEditor() {
    if (!state.frames || state.frames.length === 0) return;
    const dlg = document.getElementById('vehicleSeqDialog');
    dlg.showModal?.() || dlg.setAttribute('open', '');
    vseq_SelectedIndices.clear(); vseq_stopAllPlayers();
    const sel = document.getElementById('vseqPredefinedSelect');
    if (sel && sel.options.length <= 1) {
        VSEQ_ACTION_DEFS.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.verb;
            opt.textContent = t(a.labelKey) || a.verb;
            opt.setAttribute('data-title', `${t(a.startDescKey)}\n${t(a.countDescKey)}`);
            sel.appendChild(opt);
        });
    }
    vseq_renderLeftPanel(); vseq_switchTab('visual');
}

export function initVehicleSequenceEditor() {
    document.getElementById('vseqBtnClose').onclick = () => { vseq_stopAllPlayers(); document.getElementById('vehicleSeqDialog')?.close(); };

    const facingsIn = document.getElementById('vseqFacingsInput');
    const facingsDropBtn = document.getElementById('vseqFacingsDropBtn');
    const facingsDropdown = document.getElementById('vseqFacingsDropdown');

    // Build dropdown options
    const FACINGS_PRESETS = [
        { value: 8, labelKey: 'opt_vseq_facings_std' },
        { value: 32, labelKey: 'opt_vseq_facings_high' }
    ];
    FACINGS_PRESETS.forEach(p => {
        const opt = document.createElement('div');
        opt.className = 'seq-combo-option';
        opt.textContent = t(p.labelKey) || (p.value + " Facings");
        opt.onmousedown = (e) => {
            e.preventDefault(); // Prevent blur before setting value
            facingsIn.value = p.value;
            facingsDropdown.style.display = 'none';
            facingsIn.dispatchEvent(new Event('input'));
        };
        facingsDropdown.appendChild(opt);
    });

    // Toggle dropdown
    facingsDropBtn.onclick = () => {
        facingsDropdown.style.display = facingsDropdown.style.display === 'none' ? '' : 'none';
    };
    // Close on outside click
    document.addEventListener('mousedown', (e) => {
        if (!facingsDropdown.contains(e.target) && e.target !== facingsDropBtn) {
            facingsDropdown.style.display = 'none';
        }
    });

    facingsIn.oninput = () => {
        vseq_Facings = Math.max(1, parseInt(facingsIn.value) || 8);
        vseq_Entries.forEach(e => e.error = vseq_validateEntry(e));
        vseq_renderLeftPanel();
        vseq_renderCards();
    };

    const btnAddPre = document.getElementById('vseqBtnAddPredefined');
    const selPre = document.getElementById('vseqPredefinedSelect');

    btnAddPre.disabled = true;
    selPre.onchange = () => { btnAddPre.disabled = !selPre.value; };
    btnAddPre.onclick = () => {
        if (selPre.value) {
            vseq_addAction(selPre.value);
            selPre.value = ''; btnAddPre.disabled = true;
            if (vseq_CurrentTab === 'text') {
                const area = document.getElementById('vseqTextArea');
                if (area) area.value = vseq_serializeToINI();
            }
        }
    };
    document.getElementById('vseqBtnDeleteSelected').onclick = async () => {
        if (vseq_SelectedIndices.size === 0) return;
        if (!await showConfirm('DELETE ENTRIES', `Delete ${vseq_SelectedIndices.size} entries?`)) return;
        const sorted = [...vseq_SelectedIndices].sort((a, b) => b - a);
        sorted.forEach(idx => vseq_Entries.splice(idx, 1));
        vseq_SelectedIndices.clear(); vseq_stopAllPlayers(); vseq_renderLeftPanel(); if (vseq_CurrentTab === 'visual') vseq_renderCards();
    };
    document.getElementById('vseqBtnMoveUp').onclick = () => vseq_moveSelectedEntries(-1);
    document.getElementById('vseqBtnMoveDown').onclick = () => vseq_moveSelectedEntries(1);
    document.getElementById('vseqTabBtnVisual').onclick = () => {
        if (vseq_CurrentTab === 'text') {
            const r = vseq_parseINI(document.getElementById('vseqTextArea').value);
            vseq_Facings = r.facings; vseq_Entries = r.entries;
            document.getElementById('vseqFacingsInput').value = vseq_Facings;
            vseq_renderLeftPanel();
        }
        vseq_switchTab('visual');
    };
    document.getElementById('vseqTabBtnText').onclick = () => vseq_switchTab('text');
    document.getElementById('vseqBtnApplyText').onclick = () => {
        const r = vseq_parseINI(document.getElementById('vseqTextArea').value);
        vseq_Facings = r.facings; vseq_Entries = r.entries;
        document.getElementById('vseqFacingsInput').value = vseq_Facings;
        vseq_renderLeftPanel(); vseq_switchTab('visual');
    };
    document.getElementById('vseqBtnCopyText').onclick = () => {
        const area = document.getElementById('vseqTextArea');
        if (area) {
            navigator.clipboard.writeText(area.value).then(() => {
                const b = document.getElementById('vseqBtnCopyText'), o = b.textContent; b.textContent = '\u2713 Copied!'; setTimeout(() => b.textContent = o, 1500);
            });
        }
    };
}

function vseq_addAction(verb) {
    // Don't add duplicates
    if (vseq_Entries.find(e => e.verb === verb)) return;
    const e = { verb, startFrame: 0, frameCount: null, error: null };
    e.error = vseq_validateEntry(e);
    vseq_Entries.push(e);
    vseq_PreviewState[verb] = { facingIdx: -1, frameIdx: 0, loop: true, playbackSpeed: 1.0 };
    vseq_renderLeftPanel();
    if (vseq_CurrentTab === 'visual') {
        vseq_renderCards();
    } else {
        const area = document.getElementById('vseqTextArea');
        if (area) area.value = vseq_serializeToINI();
    }
}
