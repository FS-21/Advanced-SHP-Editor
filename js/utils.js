import { state } from './state.js';

// --- SHARED UI ICONS (SVG) ---
export const SVG_PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>';
export const SVG_PAUSE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
export const SVG_STEP_BACK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 17 6 12 11 7"></polyline><polyline points="18 17 13 12 18 7"></polyline></svg>';
export const SVG_STEP_FORWARD = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 17 18 12 13 7"></polyline><polyline points="6 17 11 12 6 7"></polyline></svg>';

// Neon Styles (Used in newer editors)
export const SVG_PLAY_MODERN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="var(--accent)"><path d="M7 4.5l13 7.5-13 7.5V4.5z"/></svg>';
export const SVG_PAUSE_MODERN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="var(--accent)"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
export const SVG_STEP_FWD_MODERN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 17 18 12 13 7"></polyline><polyline points="6 17 11 12 6 7"></polyline></svg>';
export const SVG_STEP_BACK_MODERN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 17 6 12 11 7"></polyline><polyline points="18 17 13 12 18 7"></polyline></svg>';
// Skip/Skip versions (often used in main preview)
export const SVG_SKIP_BACK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>';
export const SVG_SKIP_FWD = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>';

export function bresenham(x0, y0, x1, y1) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = (x0 < x1) ? 1 : -1;
    const sy = (y0 < y1) ? 1 : -1;
    let err = dx - dy;
    const points = [];

    while (true) {
        points.push({ x: x0, y: y0 });
        if ((x0 === x1) && (y0 === y1)) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
    }
    return points;
}

/**
 * Finds the nearest palette index for a given RGB color.
 * @param {number} r 
 * @param {number} g 
 * @param {number} b 
 * @param {Array} palette - Array of {r,g,b} or null
 * @returns {number} The index in the palette (0-255)
 */
export function findNearestPaletteIndex(r, g, b, palette) {
    let minD = Infinity;
    let bestIdx = 0;

    const skipIdx = state.isAlphaImageMode ? 127 : 0;
    const skipCol = palette[skipIdx];
    if (skipCol && skipCol.r === r && skipCol.g === g && skipCol.b === b) {
        return skipIdx; // EXACT match for transparency/background
    }

    for (let i = 0; i < 256; i++) {
        if (i === skipIdx) continue;
        const c = palette[i];
        if (!c) continue;

        const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
        if (d === 0) return i;
        if (d < minD) {
            minD = d;
            bestIdx = i;
        }
    }
    return bestIdx;
}

/**
 * Finds the nearest palette index within a specific range.
 */
export function findNearestPaletteIndexInRange(r, g, b, palette, start, end) {
    let minD = Infinity;
    let bestIdx = start;
    for (let i = start; i <= end; i++) {
        const c = palette[i];
        if (!c) continue;
        const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
        if (d === 0) return i;
        if (d < minD) {
            minD = d;
            bestIdx = i;
        }
    }
    return bestIdx;
}

export function setupAutoRepeat(btn, action, initialDelay = 500) {
    let timer = null;
    let currentDelay = initialDelay;

    const repeat = (e) => {
        action(e);
        // Aggressive acceleration: 50% reduction per repetition step
        currentDelay = Math.max(150, currentDelay * 0.5);
        timer = setTimeout(() => repeat(e), currentDelay);
    };

    const start = (e) => {
        if (e.button !== 0) return; // Only left click
        stop();
        currentDelay = initialDelay;
        action(e); // First click
        timer = setTimeout(() => repeat(e), currentDelay);
    };

    const stop = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    btn.addEventListener('mousedown', start);
    window.addEventListener('mouseup', stop);
    btn.addEventListener('mouseleave', stop);
}

/**
 * Unified frame compositing engine.
 * Computes a flat pixel array (Uint16 indexes) from a frame's layer tree,
 * respecting all masking and visibility rules.
 * 
 * @param {Object} frame - The frame object containing .layers, .width, .height
 * @param {Object} options - { 
 *    floatingSelection: Object, // Optional selection to overlay
 *    ctx: CanvasRenderingContext2D, // Optional: if provided, renders mapped pixels to it
 *    zoom: Number, // Used if ctx is provided
 *    palette: Array, // Required if ctx is provided
 *    isShadow: Boolean, // If true, renders as semi-transparent black shadow
 *    remapBase: Object, // {r,g,b} for faction remapping (indices 16-31)
 *    transparentIdx: Number // The color index to treat as air (usually 0xFFFF)
 * }
 * @returns {Uint16Array} The final composited index array.
 */
export function compositeFrame(frame, options = {}) {
    frame._extNodes = []; // Reset registry for this pass
    const {
        zoom = 1,
        transparentIdx = 65535,
        backgroundIdx = 65535,
        floatingSelection = null,
        ctx = null,
        palette = state.palette,
        isShadow = false,
        remapBase = null,
        showIndex0 = true,
        alphaBuffer = null,
        includeExternalShp = false,
        excludeNodeId = null,
        substitutionMap = null,
        affectedIndices = null,
        visualData = null // NEW: If provided, renders colors sequentially for correctly blended transparency
    } = options;

    const w = frame.width;
    const h = frame.height;
    // Initialize results with backgroundIdx (e.g. 0 for previews, transparentIdx for merging/editing)
    const res = new Uint16Array(w * h).fill(backgroundIdx);
    // Ghost alpha buffer: 255 = normal, 128 = ghosted (semi-transparent visual aid)
    const ghostAlpha = new Uint8Array(w * h).fill(255);
    let fsRendered = false;

    function drawNodeRecursive(node, currentMasks = []) {
        if (!node || node.visible === false) return;
        if (excludeNodeId && node.id === excludeNodeId) return;
        if (node.type === 'external_shp' && !includeExternalShp) return;

        function drawIntoMask(mNode, maskBuffer, valToSet) {
            const mw = mNode.width || w;
            const mh = mNode.height || h;

            if (mNode.type === 'external_shp') {
                const nw = mNode.extWidth;
                const nh = mNode.extHeight;
                const fx = mNode.extFrameX || 0;
                const fy = mNode.extFrameY || 0;

                const extShpW = mNode.extShpWidth || nw;
                const extShpH = mNode.extShpHeight || nh;
                const originX = Math.round(w / 2 - extShpW / 2);
                const originY = Math.round(h / 2 - extShpH / 2);

                const nx = originX + (mNode.x || 0) + fx;
                const ny = originY + (mNode.y || 0) + fy;
                const indices = mNode.extShpFrameData;

                if (!indices) return;

                const actualTransparent = state.isAlphaImageMode ? 127 : 0;
                for (let ly = 0; ly < nh; ly++) {
                    for (let lx = 0; lx < nw; lx++) {
                        const gx = nx + lx;
                        const gy = ny + ly;
                        if (gx < 0 || gx >= w || gy < 0 || gy >= h) continue;
                        const color = indices[ly * nw + lx];
                        if (color !== transparentIdx && color !== actualTransparent) {
                            maskBuffer[gy * w + gx] = valToSet;
                        }
                    }
                }
            } else {
                const mx = mNode.x || 0;
                const my = mNode.y || 0;
                if (!mNode.data) return;

                const actualTransparent = state.isAlphaImageMode ? 127 : 0;
                for (let ly = 0; ly < mh; ly++) {
                    for (let lx = 0; lx < mw; lx++) {
                        const gx = mx + lx;
                        const gy = my + ly;
                        if (gx < 0 || gx >= w || gy < 0 || gy >= h) continue;
                        const color = mNode.data[ly * mw + lx];
                        if (color !== transparentIdx && color !== actualTransparent) {
                            maskBuffer[gy * w + gx] = valToSet;
                        }
                    }
                }
            }
        }

        // 1. Collect nested clipped masks for this node
        const children = node.layers || node.children;
        let nestedClippedMasks = [];
        if (children) {
            for (const child of children) {
                if (child.isMask && child.clipped && child.visible && (child.data || child.type === 'external_shp')) {
                    nestedClippedMasks.push(child);
                }
            }
        }

        let effectiveParentMasks = currentMasks;
        if (nestedClippedMasks.length > 0) {
            const combined = new Uint8Array(w * h);
            const opMasks = nestedClippedMasks.filter(c => c.maskType !== 'hide');
            const hideMasks = nestedClippedMasks.filter(c => c.maskType === 'hide');

            combined.fill(opMasks.length > 0 ? 0 : 1);
            for (const mL of opMasks) drawIntoMask(mL, combined, 1);
            for (const mL of hideMasks) drawIntoMask(mL, combined, 0);
            effectiveParentMasks = [...currentMasks, combined];
        }

        // 2. Draw node's own content
        if (node.id && !node.isMask) {
            const isExt = node.type === 'external_shp';
            const indices = isExt ? node.extShpFrameData : node.data;
            const nodePal = isExt ? node.extShpPalette : palette;
            const isGhosted = !!node.ghosting;
            const gAlpha = isGhosted ? Math.round(255 * (node.ghostOpacity !== undefined ? node.ghostOpacity : 50) / 100) : 255;
            const actualTransparent = state.isAlphaImageMode ? 127 : 0;

            if (indices) {
                let nw, nh, nx, ny;
                if (isExt) {
                    nw = node.extWidth;
                    nh = node.extHeight;
                    const fx = node.extFrameX || 0;
                    const fy = node.extFrameY || 0;
                    const extShpW = node.extShpWidth || nw;
                    const extShpH = node.extShpHeight || nh;
                    const originX = Math.round(w / 2 - extShpW / 2);
                    const originY = Math.round(h / 2 - extShpH / 2);
                    nx = originX + (node.x || 0) + fx;
                    ny = originY + (node.y || 0) + fy;
                } else {
                    nw = node.width || w;
                    nh = node.height || h;
                    nx = node.x || 0;
                    ny = node.y || 0;
                }

                // Populate index buffer (for renderCanvas, remapping, etc.)
                let regIdx = -1;
                if (includeExternalShp && isExt) {
                    if (!node._regIdx) {
                        if (!frame._extNodes) frame._extNodes = [];
                        regIdx = frame._extNodes.indexOf(node);
                        if (regIdx === -1) {
                            regIdx = frame._extNodes.length;
                            frame._extNodes.push(node);
                        }
                    } else {
                        regIdx = node._regIdx;
                    }
                }

                for (let ly = 0; ly < nh; ly++) {
                    const py = ny + ly;
                    if (py < 0 || py >= h) continue;
                    for (let lx = 0; lx < nw; lx++) {
                        const px = nx + lx;
                        if (px < 0 || px >= w) continue;

                        const idx = indices[ly * nw + lx];
                        if (idx !== transparentIdx) {
                            if (idx !== actualTransparent || res[py * w + px] === transparentIdx) {
                                const gk = py * w + px;
                                let ok = true;
                                for (const m of effectiveParentMasks) if (m && !m[gk]) { ok = false; break; }
                                if (ok) {
                                    // 1. Update Index Buffer (for tools/saves - top-most takes priority)
                                    if (options.flattenToPalette) {
                                        if (!isExt || nodePal === options.flattenToPalette) {
                                            // Normal layers already use the main palette, and external SHPs with the same palette
                                            // should also skip remapping to avoid precision loss or accidental transparent index shifts.
                                            res[gk] = idx;
                                        } else {
                                            // Only map external colors to the nearest index in the target palette if palettes differ
                                            const color = nodePal[idx];
                                            if (color) {
                                                res[gk] = findNearestPaletteIndex(color.r, color.g, color.b, options.flattenToPalette);
                                            } else {
                                                res[gk] = idx;
                                            }
                                        }
                                    } else if (includeExternalShp && regIdx !== -1) {
                                        res[gk] = ((regIdx + 1) << 8) | idx;
                                    } else {
                                        res[gk] = idx;
                                    }
                                    ghostAlpha[gk] = gAlpha;

                                    // 2. High-Fidelity Visual Blending (IF ACTIVE)
                                    if (visualData && nodePal && idx !== actualTransparent) {
                                        let finalIdx = idx;
                                        if (substitutionMap && substitutionMap.has(idx) && !isExt) finalIdx = substitutionMap.get(idx);

                                        const col = nodePal[finalIdx] || { r: 0, g: 0, b: 0 };
                                        let r = col.r, g = col.g, b = col.b, a = gAlpha;

                                        if (affectedIndices && affectedIndices.has(idx) && !isExt) {
                                            r = Math.min(255, r + 60); g = Math.min(255, g + 60); b = Math.min(255, b + 60);
                                        } else if (affectedIndices && !isExt) {
                                            r *= 0.2; g *= 0.2; b *= 0.2;
                                        }

                                        // Faction Remapping
                                        if (remapBase && finalIdx >= 16 && finalIdx <= 31 && !isExt) {
                                            let brightness = Math.max(r, Math.max(g, b)) / 255.0;
                                            brightness *= 1.25;
                                            r = Math.min(255, Math.round(remapBase.r * brightness));
                                            g = Math.min(255, Math.round(remapBase.g * brightness));
                                            b = Math.min(255, Math.round(remapBase.b * brightness));
                                        }

                                        if (isShadow) { r = 0; g = 0; b = 0; a = Math.round(a * 120 / 255); }

                                        const off = gk * 4;
                                        if (a === 255) {
                                            visualData[off] = r; visualData[off + 1] = g; visualData[off + 2] = b; visualData[off + 3] = 255;
                                        } else {
                                            // Back-to-front alpha blending (Painter's algorithm)
                                            // Standard formula: outA = srcA + dstA * (1 - srcA)
                                            // outRGB = (srcRGB * srcA + dstRGB * dstA * (1 - srcA)) / outA
                                            const fa = a / 255;
                                            const da = visualData[off + 3] / 255;
                                            const outA = fa + da * (1 - fa);

                                            if (outA > 0) {
                                                visualData[off] = Math.round((r * fa + visualData[off] * da * (1 - fa)) / outA);
                                                visualData[off + 1] = Math.round((g * fa + visualData[off + 1] * da * (1 - fa)) / outA);
                                                visualData[off + 2] = Math.round((b * fa + visualData[off + 2] * da * (1 - fa)) / outA);
                                            }
                                            visualData[off + 3] = Math.round(outA * 255);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // 3. Render Floating Selection if this is the target layer
        if (floatingSelection && node.id === floatingSelection.targetLayerId) {
            const fsGAlpha = node.ghosting ? Math.round(255 * (node.ghostOpacity !== undefined ? node.ghostOpacity : 50) / 100) : 255;
            renderFloatingSelection(effectiveParentMasks, !!node.ghosting, fsGAlpha);
            fsRendered = true;
        }

        // 4. Draw children (Painter's Algorithm: Bottom-to-Top)
        if (children) {
            const siblingMasks = new Array(children.length).fill(null);
            let cumulative = null;

            // Sequential sibling masks (affects layers below them)
            for (let i = 0; i < children.length; i++) {
                const c = children[i];
                siblingMasks[i] = cumulative ? new Uint8Array(cumulative) : null;

                if (c.isMask && c.visible && (c.data || c.type === 'external_shp') && !c.clipped) {
                    if (!cumulative) {
                        cumulative = new Uint8Array(w * h);
                        cumulative.fill(c.maskType === 'hide' ? 1 : 0);
                    }
                    if (c.maskType === 'hide') {
                        drawIntoMask(c, cumulative, 0);
                    } else {
                        drawIntoMask(c, cumulative, 1);
                    }
                }
            }

            for (let i = children.length - 1; i >= 0; i--) {
                const child = children[i];
                if (child.isMask) continue;

                // Find clipped masks that target this child
                // A clipped mask targets the first NON-mask layer below it.
                // So any contiguous block of clipped masks directly above `i` (meaning indices < i) belong to `i`.
                let siblingsPrivateMaskLayers = [];
                for (let j = i - 1; j >= 0; j--) {
                    const above = children[j];
                    if (above.isMask && above.clipped) {
                        if (above.visible && (above.data || above.type === 'external_shp')) {
                            siblingsPrivateMaskLayers.push(above);
                        }
                    } else if (!above.isMask) {
                        // We hit another solid layer, so clipped masks above this belong to the other solid layer.
                        break;
                    }
                }

                let effectiveStack = effectiveParentMasks;
                if (siblingMasks[i]) effectiveStack = [...effectiveStack, siblingMasks[i]];

                if (siblingsPrivateMaskLayers.length > 0) {
                    const pMask = new Uint8Array(w * h);
                    const opMasks = siblingsPrivateMaskLayers.filter(c => c.maskType !== 'hide');
                    const hideMasks = siblingsPrivateMaskLayers.filter(c => c.maskType === 'hide');
                    pMask.fill(opMasks.length > 0 ? 0 : 1);
                    for (const mL of opMasks) drawIntoMask(mL, pMask, 1);
                    for (const mL of hideMasks) drawIntoMask(mL, pMask, 0);
                    effectiveStack = [...effectiveStack, pMask];
                }
                drawNodeRecursive(child, effectiveStack);
            }
        }
    }

    function renderFloatingSelection(masks, isGhosted = false, gAlpha = 255) {
        const fs = floatingSelection;
        if (!fs || !fs.data) return;
        const fsW = fs.w || fs.width;
        const fsH = fs.h || fs.height;
        for (let fy = 0; fy < fsH; fy++) {
            for (let fx = 0; fx < fsW; fx++) {
                const tx = fs.x + fx;
                const ty = fs.y + fy;
                if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
                    const idx = fs.data[fy * fsW + fx];
                    if (idx !== transparentIdx) {
                        const actualTransparent = state.isAlphaImageMode ? 127 : 0;
                        const k = ty * w + tx;
                        if (idx !== actualTransparent || res[k] === transparentIdx) {
                            let ok = true;
                            if (fs.maskData && !fs.maskData[fy * fsW + fx]) ok = false;
                            if (ok) {
                                for (const m of masks) if (m && !m[k]) { ok = false; break; }
                            }
                            if (ok) {
                                res[k] = idx;
                                const alpha = isGhosted ? gAlpha : 255;
                                ghostAlpha[k] = alpha;

                                if (visualData && palette) {
                                    let finalIdx = idx;
                                    if (substitutionMap && substitutionMap.has(idx)) finalIdx = substitutionMap.get(idx);
                                    const col = palette[finalIdx] || { r: 0, g: 0, b: 0 };
                                    let r = col.r, g = col.g, b = col.b;
                                    const off = k * 4;
                                    if (alpha === 255) {
                                        visualData[off] = r; visualData[off + 1] = g; visualData[off + 2] = b; visualData[off + 3] = 255;
                                    } else {
                                        // Back-to-front alpha blending
                                        const fa = alpha / 255;
                                        const da = visualData[off + 3] / 255;
                                        const outA = fa + da * (1 - fa);

                                        if (outA > 0) {
                                            visualData[off] = Math.round((r * fa + visualData[off] * da * (1 - fa)) / outA);
                                            visualData[off + 1] = Math.round((g * fa + visualData[off + 1] * da * (1 - fa)) / outA);
                                            visualData[off + 2] = Math.round((b * fa + visualData[off + 2] * da * (1 - fa)) / outA);
                                        }
                                        visualData[off + 3] = Math.round(outA * 255);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    drawNodeRecursive(frame);

    // Ensure floating selection is ALWAYS rendered, even if its target layer was lost or mismatched geometry
    if (floatingSelection && !fsRendered) {
        renderFloatingSelection([]);
    }

    if (alphaBuffer) alphaBuffer.set(ghostAlpha);

    // If a context is provided, we perform the palette mapping and render.
    if (ctx && palette) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w;
        tempCanvas.height = h;
        const tCtx = tempCanvas.getContext('2d');
        const imgData = tCtx.createImageData(w, h);
        const screenPixels = imgData.data;

        for (let i = 0; i < res.length; i++) {
            const originalIdx = res[i];
            const actualTransparent = state.isAlphaImageMode ? 127 : 0;

            if (originalIdx === transparentIdx) continue;

            let idx = originalIdx;
            let pPalette = palette;

            // Decode Rich Index if it's an External SHP pixel
            if (originalIdx > 255 && originalIdx !== transparentIdx) {
                const regIdx = (originalIdx >> 8) - 1;
                const colorIdx = originalIdx & 0xFF;
                const extNodes = res.extNodes || [];
                if (extNodes[regIdx]) {
                    pPalette = extNodes[regIdx].extShpPalette;
                    idx = colorIdx;
                }
            }

            if (idx === actualTransparent && !showIndex0) continue;
            if (isShadow && idx === actualTransparent) continue; // Index representing background

            const pCol = pPalette[idx] || { r: 0, g: 0, b: 0 };
            let r = pCol.r, g = pCol.g, b = pCol.b, a = ghostAlpha[i];

            // Faction Remapping (Indices 16-31)
            if (remapBase && idx >= 16 && idx <= 31) {
                let brightness = Math.max(r, Math.max(g, b)) / 255.0;
                brightness *= 1.25;
                r = Math.min(255, Math.round(remapBase.r * brightness));
                g = Math.min(255, Math.round(remapBase.g * brightness));
                b = Math.min(255, Math.round(remapBase.b * brightness));
            }

            if (isShadow) {
                r = 0; g = 0; b = 0; a = 120;
            }

            const pi = i * 4;
            screenPixels[pi] = r;
            screenPixels[pi + 1] = g;
            screenPixels[pi + 2] = b;
            screenPixels[pi + 3] = a;
        }
        tCtx.putImageData(imgData, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tempCanvas, 0, 0, w * zoom, h * zoom);
    }

    if (frame._extNodes) res.extNodes = [...frame._extNodes];
    return res;
}

