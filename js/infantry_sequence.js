import { state, TRANSPARENT_COLOR } from './state.js';
import { compositeFrame, setupAutoRepeat, SVG_PLAY_MODERN, SVG_PAUSE_MODERN, SVG_STEP_BACK_MODERN, SVG_STEP_FWD_MODERN } from './utils.js';
import { showConfirm } from './ui.js';
import { t } from './translations.js';

// ============================================================
// INFANTRY SEQUENCE EDITOR
// ============================================================

const ISEQ_KNOWN_ACTIONS = [
    { name: 'Ready', desc: 'Standing around' },
    { name: 'Guard', desc: 'Standing around with weapon drawn' },
    { name: 'Prone', desc: 'While prone' },
    { name: 'Walk', desc: 'Walking (normal movement)' },
    { name: 'FireUp', desc: 'Firing while standing' },
    { name: 'Down', desc: 'Transition: standing \u2192 prone' },
    { name: 'Crawl', desc: 'Moving while prone' },
    { name: 'Up', desc: 'Transition: prone \u2192 standing' },
    { name: 'FireProne', desc: 'Firing while prone' },
    { name: 'Idle1', desc: 'Idle animation sequence #1' },
    { name: 'Idle2', desc: 'Idle animation sequence #2' },
    { name: 'Die1', desc: 'Death animation when hit by gunfire' },
    { name: 'Die2', desc: 'Death animation when exploding' },
    { name: 'Die3', desc: 'Death animation when exploding (alt)' },
    { name: 'Die4', desc: 'Death animation by concussion explosion' },
    { name: 'Die5', desc: 'Death animation by fire' },
    { name: 'Fly', desc: 'Flying (jumpjet)' },
    { name: 'Hover', desc: 'Hovering (jumpjet)' },
    { name: 'Tumble', desc: 'Tumbling (jumpjet)' },
    { name: 'FireFly', desc: 'Firing while flying (jumpjet)' },
    { name: 'Deploy', desc: 'Deploy transition' },
    { name: 'Deployed', desc: 'Deployed still frame' },
    { name: 'DeployFire', desc: 'Fire while deployed' },
    { name: 'DeployIdle', desc: 'Idle while deployed' },
    { name: 'Undeploy', desc: 'Undeploy transition' },
    { name: 'SecondaryFire', desc: 'Special anim for firing secondary weapon' },
    { name: 'SecondaryProne', desc: 'Secondary weapon fire while prone' },
    { name: 'Paradrop', desc: 'Paratrooper drop frame' },
    { name: 'Cheer', desc: 'Cheer/celebration animation' },
    { name: 'Panic', desc: 'Panic animation' },
    { name: 'Shovel', desc: 'Shoveling animation (YR)' },
    { name: 'Carry', desc: 'Carrying animation (YR)' }
];

const ISEQ_NUM_FACINGS = 8;
const ISEQ_FACING_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const ISEQ_DIRECTIONS = ['', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const ISEQ_DIRECTION_KEYS = ['lbl_dir_none', 'lbl_dir_n', 'lbl_dir_ne', 'lbl_dir_e', 'lbl_dir_se', 'lbl_dir_s', 'lbl_dir_sw', 'lbl_dir_w', 'lbl_dir_nw'];

// State
let iseq_SectionName = 'InfantrySequence';
let iseq_Entries = [];
let iseq_SelectedIndices = new Set();
let iseq_CurrentTab = 'visual';
let iseq_PlayerTimers = {};

// Persistence for UI state per sequence (to avoid resets on re-render)
let iseq_PreviewState = {};
let iseq_DraggedIdx = null;

function iseq_isValidString(s) {
    return /^[a-zA-Z0-9_-]+$/.test(s);
}

function iseq_getNumFacings(entry) {
    return entry.facingMult > 0 ? ISEQ_NUM_FACINGS : 1;
}

function iseq_getTotalFramesUsed(entry) {
    if (entry.frameCount <= 0) return 0;
    if (entry.facingMult > 0) {
        return (ISEQ_NUM_FACINGS - 1) * entry.facingMult + entry.frameCount;
    }
    return entry.frameCount;
}

function iseq_getShpFrameIndex(entry, animFrame, facingIdx) {
    let shpFacingIdx = facingIdx;
    if (facingIdx > 0) {
        shpFacingIdx = 8 - facingIdx;
    }
    return entry.startFrame + (shpFacingIdx * entry.facingMult) + animFrame;
}

function iseq_getNormalFrameCount() {
    const totalFrames = state.frames ? state.frames.length : 0;
    return (state.useShadows || false) ? Math.floor(totalFrames / 2) : totalFrames;
}

function iseq_validateEntry(entry) {
    const errors = [];
    if (!entry.name || !iseq_isValidString(entry.name)) errors.push('Invalid name');
    if (entry.startFrame < 0) errors.push('Start frame < 0');
    if (entry.frameCount < 0) errors.push('Count < 0');
    if (entry.facingMult < 0) errors.push('Multiplier < 0');

    const normalFrames = iseq_getNormalFrameCount();
    if (entry.frameCount > 0 && normalFrames > 0) {
        const lastFrame = entry.startFrame + iseq_getTotalFramesUsed(entry) - 1;
        if (lastFrame >= normalFrames) {
            errors.push(`Exceeds SHP (last: ${lastFrame}, max: ${normalFrames - 1})`);
        }
    }
    return errors.length > 0 ? errors.join('; ') : null;
}

function iseq_serializeToINI() {
    let lines = [`[${iseq_SectionName}]`];
    for (const e of iseq_Entries) {
        let val = `${e.startFrame},${e.frameCount},${e.facingMult}`;
        if (e.direction) val += `,${e.direction}`;
        lines.push(`${e.name}=${val}`);
    }
    return lines.join('\n');
}

function iseq_parseINI(text) {
    const rawLines = text.split(/\r?\n/);
    let sectionName = iseq_SectionName;
    const entries = [];
    for (const rl of rawLines) {
        let line = rl.split(';')[0].trim();
        if (!line) continue;
        const secMatch = line.match(/^\[([^\]]+)\]$/);
        if (secMatch) { sectionName = secMatch[1]; continue; }
        const kvMatch = line.match(/^([^=]+)=(.+)$/);
        if (!kvMatch) continue;
        const name = kvMatch[1].trim();
        const v = kvMatch[2].trim().split(',').map(s => s.trim());
        if (v.length < 3) continue;
        const e = { name, startFrame: parseInt(v[0]) || 0, frameCount: parseInt(v[1]) || 0, facingMult: parseInt(v[2]) || 0, direction: v[3] || '', error: null };
        e.error = iseq_validateEntry(e);
        entries.push(e);
    }
    return { sectionName, entries };
}

function iseq_renderFrameToCanvas(canvas, shpFrameIdx, shadowFrameIdx) {
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

function iseq_createNumericControl(label, value, min, tooltip, onChange) {
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
    input.min = min; input.value = value;
    stepper.appendChild(input);

    const btnPlus = document.createElement('button');
    btnPlus.className = 'step-btn step-btn-plus'; btnPlus.textContent = '+';
    btnPlus.title = 'Increase (Ctrl+Click for +5)';
    stepper.appendChild(btnPlus);

    wrapper.appendChild(stepper);

    input.onchange = () => {
        let v = parseInt(input.value) || 0; if (v < min) v = min;
        input.value = v; onChange(v);
    };
    const doChange = (ev, delta) => {
        const step = ev.ctrlKey ? 5 : 1;
        let v = Math.max(min, (parseInt(input.value) || 0) + delta * step);
        input.value = v; onChange(v);
    };
    setupAutoRepeat(btnMinus, (ev) => doChange(ev, -1));
    setupAutoRepeat(btnPlus, (ev) => doChange(ev, 1));
    return wrapper;
}

function iseq_renderCards() {
    iseq_stopAllPlayers();
    const container = document.getElementById('seqCardsContainer');
    if (!container) return;
    container.innerHTML = '';
    const totalFrames = state.frames ? state.frames.length : 0;
    const useShadows = state.useShadows || false;

    for (let i = 0; i < iseq_Entries.length; i++) {
        const entry = iseq_Entries[i];
        if (!iseq_PreviewState[entry.name]) iseq_PreviewState[entry.name] = { facingIdx: -1, frameIdx: 0, loop: true, playbackSpeed: 1.0 };
        const pState = iseq_PreviewState[entry.name];

        const card = document.createElement('div');
        card.className = 'seq-card' + (entry.error ? ' seq-card-error' : '');
        const header = document.createElement('div'); header.className = 'seq-card-header';
        const known = ISEQ_KNOWN_ACTIONS.find(a => a.name === entry.name);
        header.innerHTML = `<span class="seq-card-title">${entry.name}</span>` +
            (known ? `<span class="seq-card-desc">${known.desc}</span>` : '') +
            `<span class="seq-card-frames-info"></span>`;
        card.appendChild(header);

        const body = document.createElement('div'); body.className = 'seq-card-body';
        const controls = document.createElement('div'); controls.className = 'seq-card-controls';
        const preview = document.createElement('div'); preview.className = 'seq-card-preview';

        const canvas = document.createElement('canvas'); canvas.className = 'seq-preview-canvas';
        const canvasWrap = document.createElement('div'); canvasWrap.className = 'seq-preview-canvas-wrap checkerboard-bg';
        const spacer = document.createElement('img'); spacer.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; spacer.style.height = '280px'; spacer.style.width = '1px'; spacer.style.visibility = 'hidden';
        canvasWrap.append(spacer, canvas); preview.appendChild(canvasWrap);
        const timeline = document.createElement('div'); timeline.className = 'seq-timeline';
        const btnStepBack = document.createElement('button'); btnStepBack.className = 'seq-tl-btn'; btnStepBack.innerHTML = SVG_STEP_BACK_MODERN;
        const btnPlay = document.createElement('button'); btnPlay.className = 'seq-tl-btn seq-play-btn'; btnPlay.innerHTML = SVG_PLAY_MODERN;
        const btnStep = document.createElement('button'); btnStep.className = 'seq-tl-btn'; btnStep.innerHTML = SVG_STEP_FWD_MODERN;
        const slider = document.createElement('input'); slider.type = 'range'; slider.className = 'seq-tl-slider';
        const counter = document.createElement('span'); counter.className = 'seq-tl-counter';
        timeline.append(btnStepBack, btnPlay, btnStep, slider, counter);
        preview.appendChild(timeline);

        const updatePreview = () => {
            iseq_updateCardState(card, entry);
            if (entry.error || entry.frameCount <= 0) return;
            const fIdx = pState.facingIdx;
            let shpIdx = -1, currentMax = 0;
            if (fIdx === -1) {
                currentMax = iseq_getTotalFramesUsed(entry);
                if (pState.frameIdx >= currentMax) pState.frameIdx = 0;
                shpIdx = entry.startFrame + pState.frameIdx;
            } else {
                currentMax = entry.frameCount;
                if (pState.frameIdx >= currentMax) pState.frameIdx = 0;
                shpIdx = iseq_getShpFrameIndex(entry, pState.frameIdx, fIdx);
            }
            let shadowIdx = -1;
            if (useShadows && shpIdx + Math.floor(totalFrames / 2) < totalFrames) shadowIdx = shpIdx + Math.floor(totalFrames / 2);
            iseq_renderFrameToCanvas(canvas, shpIdx, shadowIdx);
            slider.max = Math.max(0, currentMax - 1); slider.value = pState.frameIdx;
            counter.textContent = `${pState.frameIdx}/${Math.max(0, currentMax - 1)}`;
        };

        controls.appendChild(iseq_createNumericControl('Start Frame', entry.startFrame, 0, 'Initial frame index in SHP', (v) => { entry.startFrame = v; entry.error = iseq_validateEntry(entry); iseq_renderLeftPanel(); updatePreview(); }));
        controls.appendChild(iseq_createNumericControl('Frame Count', entry.frameCount, 0, 'Number of frames in this action animation', (v) => { entry.frameCount = v; entry.error = iseq_validateEntry(entry); iseq_renderLeftPanel(); updatePreview(); }));
        controls.appendChild(iseq_createNumericControl('Facing Mult', entry.facingMult, 0, 'Distance between facings (usually same as Frame Count)', (v) => { entry.facingMult = v; entry.error = iseq_validateEntry(entry); iseq_renderLeftPanel(); iseq_renderCards(); }));

        const dirRow = document.createElement('div'); dirRow.className = 'seq-num-row';
        dirRow.innerHTML = `<label class="seq-num-label">Direction</label>`;
        const dirContainer = document.createElement('div'); dirContainer.className = 'seq-direction-container';
        const dirSelect = document.createElement('select'); dirSelect.className = 'seq-direction-select';
        ISEQ_DIRECTIONS.forEach((d, di) => { const opt = document.createElement('option'); opt.value = d; opt.textContent = t(ISEQ_DIRECTION_KEYS[di]) || ISEQ_DIRECTION_KEYS[di]; if (d === entry.direction) opt.selected = true; dirSelect.appendChild(opt); });

        const btnHelp = document.createElement('button'); btnHelp.className = 'seq-help-btn'; btnHelp.textContent = '?';
        const popover = document.createElement('div'); popover.className = 'seq-compass-popover';
        popover.innerHTML = `
            <svg viewBox="0 0 100 100" width="220" height="220" style="display:block;">
                <circle cx="50" cy="50" r="45" fill="none" stroke="#00ffaa" stroke-width="0.5" stroke-dasharray="2,2" opacity="0.3"/>
                <circle cx="50" cy="50" r="30" fill="none" stroke="#00ffaa" stroke-width="1" opacity="0.5"/>
                <line x1="50" y1="10" x2="50" y2="90" stroke="#00ffaa" stroke-width="0.5" opacity="0.3"/>
                <line x1="10" y1="50" x2="90" y2="50" stroke="#00ffaa" stroke-width="0.5" opacity="0.3"/>
                <line x1="22" y1="22" x2="78" y2="78" stroke="#00ffaa" stroke-width="0.5" opacity="0.3"/>
                <line x1="78" y1="22" x2="22" y2="78" stroke="#00ffaa" stroke-width="0.5" opacity="0.3"/>
                <text x="50" y="8" text-anchor="middle" fill="#00ffaa" font-size="6" font-weight="bold">N</text>
                <text x="50" y="96" text-anchor="middle" fill="#00ffaa" font-size="6" font-weight="bold">S</text>
                <text x="94" y="52" text-anchor="start" fill="#00ffaa" font-size="6" font-weight="bold">E</text>
                <text x="6" y="52" text-anchor="end" fill="#00ffaa" font-size="6" font-weight="bold">W</text>
                <text x="82" y="20" text-anchor="start" fill="#00ffaa" font-size="5">NE</text>
                <text x="18" y="20" text-anchor="end" fill="#00ffaa" font-size="5">NW</text>
                <text x="82" y="84" text-anchor="start" fill="#00ffaa" font-size="5">SE</text>
                <text x="18" y="84" text-anchor="end" fill="#00ffaa" font-size="5">SW</text>
                <circle cx="50" cy="50" r="2" fill="#00ffaa"/>
            </svg>`;

        dirSelect.onchange = () => {
            entry.direction = dirSelect.value;
            iseq_renderLeftPanel();
            btnHelp.classList.remove('active');
        };
        dirSelect.onclick = (e) => e.stopPropagation();
        dirSelect.onmousedown = (e) => e.stopPropagation();

        btnHelp.onclick = (e) => {
            e.stopPropagation();
            const isCurrentlyActive = btnHelp.classList.contains('active');
            document.querySelectorAll('.seq-help-btn.active').forEach(b => b.classList.remove('active'));
            if (!isCurrentlyActive) btnHelp.classList.add('active');
        };

        dirContainer.append(dirSelect, btnHelp, popover); dirRow.appendChild(dirContainer); controls.appendChild(dirRow);

        const prefRow = document.createElement('div'); prefRow.className = 'seq-num-row';
        prefRow.style.cssText = 'margin-top:6px; padding-top:8px; border-top:1px solid #2d3748;';
        prefRow.innerHTML = `<label class="seq-num-label">Preview</label>`;
        const facingSelect = document.createElement('select'); facingSelect.className = 'seq-direction-select';

        const optAll = document.createElement('option'); optAll.value = '-1'; optAll.textContent = t('opt_all_facings') || 'All facings'; if (pState.facingIdx === -1) optAll.selected = true;
        facingSelect.appendChild(optAll);

        for (let f = 0; f < ISEQ_NUM_FACINGS; f++) {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = t(ISEQ_DIRECTION_KEYS[f + 1]) || ISEQ_DIRECTION_KEYS[f + 1];
            if (pState.facingIdx === f) opt.selected = true;
            facingSelect.appendChild(opt);
        }

        const di = ISEQ_DIRECTIONS.indexOf(entry.direction);
        if (di > 0) {
            pState.facingIdx = di - 1;
            facingSelect.value = pState.facingIdx;
            facingSelect.disabled = true;
            facingSelect.style.opacity = '0.5';
            facingSelect.style.cursor = 'not-allowed';
            facingSelect.title = 'Preview is locked to the configured Direction';
        } else {
            facingSelect.disabled = false;
            facingSelect.style.opacity = '1';
            facingSelect.style.cursor = '';
            facingSelect.title = '';
        }
        facingSelect.onchange = () => { pState.facingIdx = parseInt(facingSelect.value); pState.frameIdx = 0; updatePreview(); };
        facingSelect.onclick = (e) => e.stopPropagation();
        facingSelect.onmousedown = (e) => e.stopPropagation();
        prefRow.appendChild(facingSelect); controls.appendChild(prefRow);

        const loopRow = document.createElement('div'); loopRow.className = 'seq-num-row'; loopRow.style.justifyContent = 'flex-end';
        loopRow.innerHTML = `<label style="font-size:11px; color:#718096; display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" ${pState.loop ? 'checked' : ''} style="margin:0;"> ${t('lbl_loop_anim') || 'Loop animation'}</label>`;
        loopRow.querySelector('input').onchange = (e) => { pState.loop = e.target.checked; };
        controls.appendChild(loopRow);

        const speedRow = document.createElement('div'); speedRow.className = 'seq-num-row';
        speedRow.style.marginTop = '6px';
        speedRow.innerHTML = `<label class="seq-num-label">${t('lbl_speed') || 'Speed'}</label>`;

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

        const updateSpeedValue = (v) => {
            const sv = Math.max(0.2, Math.min(2.0, parseFloat(v) || 1.0));
            pState.playbackSpeed = sv;
            speedSlider.value = sv;
            speedVal.textContent = sv.toFixed(2) + 'x';
            const pct = ((sv - 0.2) / (2.0 - 0.2)) * 100;
            speedBar.style.width = pct + '%';
            if (iseq_PlayerTimers[i]) { btnPlay.click(); btnPlay.click(); }
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
        btnStepBack.onclick = () => { if (iseq_PlayerTimers[i]) { btnPlay.click(); } pState.frameIdx--; if (pState.frameIdx < 0) pState.frameIdx = (pState.facingIdx === -1 ? iseq_getTotalFramesUsed(entry) : entry.frameCount) - 1; updatePreview(); };
        btnStep.onclick = () => { if (iseq_PlayerTimers[i]) { btnPlay.click(); } pState.frameIdx++; if (pState.frameIdx >= (pState.facingIdx === -1 ? iseq_getTotalFramesUsed(entry) : entry.frameCount)) pState.frameIdx = 0; updatePreview(); };
        btnPlay.onclick = () => {
            if (iseq_PlayerTimers[i]) {
                clearInterval(iseq_PlayerTimers[i]); delete iseq_PlayerTimers[i];
                btnPlay.innerHTML = SVG_PLAY_MODERN;
                return;
            }
            iseq_stopAllPlayers();
            btnPlay.innerHTML = SVG_PAUSE_MODERN;
            iseq_PlayerTimers[i] = setInterval(() => {
                const mx = (pState.facingIdx === -1) ? iseq_getTotalFramesUsed(entry) : entry.frameCount;
                if (mx <= 0) return;
                if (pState.frameIdx + 1 >= mx) {
                    if (!pState.loop) { iseq_stopAllPlayers(); pState.frameIdx = 0; updatePreview(); return; }
                    pState.frameIdx = 0;
                } else pState.frameIdx++;
                updatePreview();
            }, 100 / (pState.playbackSpeed || 1.0));
        };
        body.append(controls, preview); card.appendChild(body); container.appendChild(card);
    }
}

function iseq_updateCardState(card, entry) {
    const header = card.querySelector('.seq-card-header');
    let errMsg = card.querySelector('.seq-card-error-msg');
    const preview = card.querySelector('.seq-card-preview');

    if (!errMsg) {
        errMsg = document.createElement('div');
        errMsg.className = 'seq-card-error-msg';
        header.after(errMsg);
    }

    if (entry.error) {
        card.classList.add('seq-card-error');
        errMsg.textContent = '\u26A0 ' + entry.error;
        errMsg.style.visibility = 'visible';
        errMsg.style.opacity = '1';
        if (preview) preview.style.opacity = '0.3';
        if (preview) preview.style.pointerEvents = 'none';
    } else {
        card.classList.remove('seq-card-error');
        errMsg.textContent = '';
        errMsg.style.visibility = 'hidden';
        errMsg.style.opacity = '0';
        if (preview) preview.style.opacity = '1';
        if (preview) preview.style.pointerEvents = 'auto';
    }

    const info = card.querySelector('.seq-card-frames-info');
    if (info) {
        const nf = iseq_getNumFacings(entry);
        info.textContent = `${iseq_getTotalFramesUsed(entry)} frames \u00b7 ${nf} facing${nf > 1 ? 's' : ''}`;
    }
}

function iseq_moveSelectedEntries(delta) {
    if (iseq_SelectedIndices.size === 0) return;
    const indices = [...iseq_SelectedIndices].sort((a, b) => a - b);

    if (delta < 0) { // Move UP
        if (indices[0] === 0) return;
        for (const i of indices) {
            [iseq_Entries[i], iseq_Entries[i - 1]] = [iseq_Entries[i - 1], iseq_Entries[i]];
        }
        iseq_SelectedIndices = new Set(indices.map(i => i - 1));
    } else { // Move DOWN
        if (indices[indices.length - 1] === iseq_Entries.length - 1) return;
        for (let k = indices.length - 1; k >= 0; k--) {
            const i = indices[k];
            [iseq_Entries[i], iseq_Entries[i + 1]] = [iseq_Entries[i + 1], iseq_Entries[i]];
        }
        iseq_SelectedIndices = new Set(indices.map(i => i + 1));
    }
    iseq_renderLeftPanel();
    if (iseq_CurrentTab === 'visual') iseq_renderCards();
}

function iseq_handleDrop(targetIdx, e) {
    e.preventDefault();
    if (iseq_DraggedIdx === null || iseq_DraggedIdx === targetIdx) return;

    const dragIdx = iseq_DraggedIdx;
    const sortedSelected = [...iseq_SelectedIndices].sort((a, b) => a - b);

    if (iseq_SelectedIndices.has(dragIdx)) {
        const movingItems = sortedSelected.map(idx => iseq_Entries[idx]);
        for (let k = sortedSelected.length - 1; k >= 0; k--) {
            iseq_Entries.splice(sortedSelected[k], 1);
        }
        let insertIdx = targetIdx;
        const itemsBeforeTarget = sortedSelected.filter(idx => idx < targetIdx).length;
        insertIdx -= itemsBeforeTarget;
        iseq_Entries.splice(insertIdx, 0, ...movingItems);
        iseq_SelectedIndices.clear();
        for (let k = 0; k < movingItems.length; k++) {
            iseq_SelectedIndices.add(insertIdx + k);
        }
    } else {
        const itemToMove = iseq_Entries.splice(dragIdx, 1)[0];
        const actualInsertIdx = targetIdx > dragIdx ? targetIdx - 1 : targetIdx;
        iseq_Entries.splice(actualInsertIdx, 0, itemToMove);
        iseq_SelectedIndices.clear();
        iseq_SelectedIndices.add(actualInsertIdx);
    }

    iseq_DraggedIdx = null;
    iseq_renderLeftPanel();
    if (iseq_CurrentTab === 'visual') {
        iseq_renderCards();
    } else {
        const area = document.getElementById('seqTextArea');
        if (area) area.value = iseq_serializeToINI();
    }
}

function iseq_stopAllPlayers() {
    Object.keys(iseq_PlayerTimers).forEach(k => { clearInterval(iseq_PlayerTimers[k]); delete iseq_PlayerTimers[k]; });
    document.querySelectorAll('#seqEditorDialog .seq-play-btn').forEach(b => { b.innerHTML = SVG_PLAY_MODERN; });
}

function iseq_renderLeftPanel() {
    const list = document.getElementById('seqEntryList'); if (!list) return; list.innerHTML = '';
    iseq_Entries.forEach((e, i) => {
        const div = document.createElement('div');
        div.className = 'seq-entry-item' + (iseq_SelectedIndices.has(i) ? ' selected' : '') + (e.error ? ' has-error' : '');
        div.draggable = true;
        div.innerHTML = `<span class="seq-entry-name">${e.name}</span><span class="seq-entry-vals">${e.startFrame},${e.frameCount},${e.facingMult}${e.direction ? ',' + e.direction : ''}</span>`;

        div.onclick = (ev) => {
            if (ev.ctrlKey) { if (iseq_SelectedIndices.has(i)) iseq_SelectedIndices.delete(i); else iseq_SelectedIndices.add(i); }
            else if (ev.shiftKey && iseq_SelectedIndices.size > 0) {
                const last = [...iseq_SelectedIndices].pop();
                const start = Math.min(last, i), end = Math.max(last, i);
                for (let k = start; k <= end; k++) iseq_SelectedIndices.add(k);
            }
            else { iseq_SelectedIndices.clear(); iseq_SelectedIndices.add(i); }
            iseq_renderLeftPanel();
        };

        div.ondragstart = (ev) => {
            iseq_DraggedIdx = i;
            div.classList.add('dragging');
            ev.dataTransfer.effectAllowed = 'move';
        };
        div.ondragend = () => {
            div.classList.remove('dragging');
            iseq_DraggedIdx = null;
        };
        div.ondragover = (ev) => {
            ev.preventDefault();
            div.classList.add('drag-over');
        };
        div.ondragleave = () => {
            div.classList.remove('drag-over');
        };
        div.ondrop = (ev) => {
            div.classList.remove('drag-over');
            iseq_handleDrop(i, ev);
        };

        list.appendChild(div);
    });
    const hasSel = iseq_SelectedIndices.size > 0;
    document.getElementById('seqBtnDeleteSelected').style.display = hasSel ? '' : 'none';
    document.getElementById('seqBtnMoveUp').style.display = hasSel ? '' : 'none';
    document.getElementById('seqBtnMoveDown').style.display = hasSel ? '' : 'none';
}

function iseq_switchTab(tab) {
    iseq_CurrentTab = tab;
    const vTab = document.getElementById('seqTabVisual'), tTab = document.getElementById('seqTabText');
    const vBtn = document.getElementById('seqTabBtnVisual'), tBtn = document.getElementById('seqTabBtnText');

    if (tab === 'visual') {
        tTab.classList.remove('active');
        vTab.classList.add('active');
        tBtn.classList.remove('active');
        vBtn.classList.add('active');
        iseq_renderCards();
    } else {
        iseq_stopAllPlayers();
        vTab.classList.remove('active');
        tTab.classList.add('active');
        vBtn.classList.remove('active');
        tBtn.classList.add('active');
        const area = document.getElementById('seqTextArea');
        if (area) {
            area.value = iseq_serializeToINI();
            setTimeout(() => area.focus(), 10);
        }
    }
}

export function openSequenceEditor() {
    if (!state.frames || state.frames.length === 0) return;
    const dlg = document.getElementById('seqEditorDialog');
    dlg.showModal?.() || dlg.setAttribute('open', '');
    iseq_SelectedIndices.clear(); iseq_stopAllPlayers();
    const sel = document.getElementById('seqPredefinedSelect');
    if (sel && sel.options.length <= 1) {
        ISEQ_KNOWN_ACTIONS.forEach(a => { const opt = document.createElement('option'); opt.value = a.name; opt.textContent = a.name; opt.setAttribute('data-title', a.desc); sel.appendChild(opt); });
    }
    iseq_renderLeftPanel(); iseq_switchTab('visual');
}

export function initSequenceEditor() {
    document.getElementById('seqBtnClose').onclick = () => { iseq_stopAllPlayers(); document.getElementById('seqEditorDialog')?.close(); };
    const nameIn = document.getElementById('seqSectionNameInput');
    nameIn.value = iseq_SectionName; nameIn.oninput = () => { iseq_SectionName = nameIn.value.trim() || 'InfantrySequence'; };
    const btnAddPre = document.getElementById('seqBtnAddPredefined');
    const btnAddCust = document.getElementById('seqBtnAddCustom');
    const selPre = document.getElementById('seqPredefinedSelect');
    const inputCust = document.getElementById('seqCustomNameInput');

    btnAddPre.disabled = true;
    btnAddCust.disabled = true;

    selPre.onchange = () => { btnAddPre.disabled = !selPre.value; };
    inputCust.oninput = () => { btnAddCust.disabled = !iseq_isValidString(inputCust.value.trim()); };

    btnAddPre.onclick = () => {
        if (selPre.value) {
            iseq_addEntry(selPre.value);
            selPre.value = ''; btnAddPre.disabled = true;
        }
    };
    btnAddCust.onclick = () => {
        const v = inputCust.value.trim();
        if (iseq_isValidString(v)) {
            iseq_addEntry(v);
            inputCust.value = ''; btnAddCust.disabled = true;
        }
    };

    document.querySelectorAll('input[name="seqAddMode"]').forEach(rb => {
        rb.onchange = () => {
            const predGroup = document.getElementById('seqPredefinedGroup');
            const custGroup = document.getElementById('seqCustomGroup');
            if (predGroup) predGroup.style.display = rb.value === 'predefined' ? 'flex' : 'none';
            if (custGroup) custGroup.style.display = rb.value === 'custom' ? 'flex' : 'none';
        };
    });

    document.getElementById('seqBtnDeleteSelected').onclick = async () => {
        if (iseq_SelectedIndices.size === 0) return;
        const sorted = [...iseq_SelectedIndices].sort((a, b) => a - b);
        let msg = `<div style="margin-bottom:10px;">Are you sure you want to delete these ${iseq_SelectedIndices.size} actions?</div>`;
        msg += `<div style="max-height:200px; overflow-y:auto; background:rgba(0,0,0,0.2); padding:8px; border-radius:4px; font-family:monospace; font-size:12px; line-height:1.4;">`;
        for (const idx of sorted) {
            const e = iseq_Entries[idx];
            msg += `<div style="display:flex; justify-content:space-between; gap:20px; border-bottom:1px solid rgba(255,255,255,0.05); padding:2px 0;">`;
            msg += `<span>${e.name}</span>`;
            msg += `<span style="color:#718096; font-style:italic;">${e.startFrame}, ${e.frameCount}, ${e.facingMult}${e.direction ? ', ' + e.direction : ''}</span>`;
            msg += `</div>`;
        }
        msg += `</div>`;

        if (!await showConfirm('DELETE ACTIONS', msg)) return;

        const sortedForDelete = [...iseq_SelectedIndices].sort((a, b) => b - a);
        sortedForDelete.forEach(idx => iseq_Entries.splice(idx, 1));
        iseq_SelectedIndices.clear(); iseq_stopAllPlayers(); iseq_renderLeftPanel();
        if (iseq_CurrentTab === 'visual') {
            iseq_renderCards();
        } else {
            const area = document.getElementById('seqTextArea');
            if (area) area.value = iseq_serializeToINI();
        }
    };

    document.getElementById('seqBtnMoveUp').onclick = () => iseq_moveSelectedEntries(-1);
    document.getElementById('seqBtnMoveDown').onclick = () => iseq_moveSelectedEntries(1);
    document.getElementById('seqTabBtnVisual').onclick = () => {
        if (iseq_CurrentTab === 'text') {
            const r = iseq_parseINI(document.getElementById('seqTextArea').value);
            iseq_SectionName = r.sectionName;
            iseq_Entries = r.entries;
            document.getElementById('seqSectionNameInput').value = iseq_SectionName;
            iseq_renderLeftPanel();
        }
        iseq_switchTab('visual');
    };
    document.getElementById('seqTabBtnText').onclick = () => iseq_switchTab('text');
    document.getElementById('seqBtnApplyText').onclick = () => {
        const r = iseq_parseINI(document.getElementById('seqTextArea').value);
        iseq_SectionName = r.sectionName;
        iseq_Entries = r.entries;
        document.getElementById('seqSectionNameInput').value = iseq_SectionName;
        iseq_renderLeftPanel();
        iseq_switchTab('visual');
    };
    document.getElementById('seqBtnCopyText').onclick = () => {
        const area = document.getElementById('seqTextArea');
        if (area) {
            navigator.clipboard.writeText(area.value).then(() => {
                const b = document.getElementById('seqBtnCopyText'), o = b.textContent;
                b.textContent = '\u2713 Copied!'; setTimeout(() => b.textContent = o, 1500);
            });
        }
    };
    window.addEventListener('click', () => { document.querySelectorAll('.seq-help-btn.active').forEach(b => b.classList.remove('active')); });
}

function iseq_addEntry(name) {
    if (iseq_Entries.find(e => e.name === name)) return;
    const e = { name, startFrame: 0, frameCount: 1, facingMult: 0, direction: '', error: null };
    e.error = iseq_validateEntry(e); iseq_Entries.push(e);
    iseq_PreviewState[name] = { facingIdx: -1, frameIdx: 0, loop: true, playbackSpeed: 1.0 };
    iseq_renderLeftPanel();
    if (iseq_CurrentTab === 'visual') {
        iseq_renderCards();
    } else {
        const area = document.getElementById('seqTextArea');
        if (area) area.value = iseq_serializeToINI();
    }
}
