import { compositeFrame, findNearestPaletteIndex, findNearestPaletteIndexInRange } from './utils.js';
import { TRANSPARENT_COLOR, state, generateId } from './state.js';
import { renderCanvas, renderFramesList, updateLayersList, clearSelection, commitSelection, renderOverlay, updateCanvasSize, getActiveLayer, findLayerParent } from './ui.js';
import { elements } from './constants.js';
import { pushHistory, cloneLayerNode } from './history.js';
import { t } from './translations.js';

export function flattenLayers(mode = 'merge_down') {
    // mode: 'merge_down' | 'merge_all' | 'new_layer'
    if (mode === 'down') mode = 'merge_down';
    else if (mode === 'all') mode = 'merge_all';
    else if (mode === 'new') mode = 'new_layer';

    if (!state.frames.length) return;
    const f = state.frames[state.currentFrameIdx];
    if (!f.layers.length) return;
    const w = f.width;
    const h = f.height;

    if (mode === 'merge_all' || mode === 'new_layer') {
        // Use the unified compositor to respect all masks and hierarchy
        const finalData = compositeFrame(f, {
            transparentIdx: TRANSPARENT_COLOR,
            backgroundIdx: TRANSPARENT_COLOR,
            includeExternalShp: false,
            floatingSelection: state.floatingSelection
        });

        if (mode === 'merge_all') {
            // Keep external_shp layers
            const preservedLayers = f.layers.filter(l => l.type === 'external_shp');
            const newLayer = {
                type: 'layer',
                id: generateId(),
                width: w,
                height: h,
                data: finalData,
                name: "Background",
                visible: true,
                opacity: 1.0,
                mask: null,
                editMask: false
            };

            f.layers = [...preservedLayers, newLayer];
            state.activeLayerId = newLayer.id;
        } else {
            // New Layer
            const newLayer = {
                type: 'layer',
                id: generateId(),
                width: w,
                height: h,
                data: finalData,
                name: "Merged",
                visible: true,
                opacity: 1.0,
                mask: null,
                editMask: false
            };
            f.layers.unshift(newLayer); // Add to top
            state.activeLayerId = newLayer.id;
        }

    } else if (mode === 'merge_down') {
        const info = findLayerParent(f.layers, state.activeLayerId);
        if (!info || info.index >= info.parent.length - 1) return; // Cannot merge bottom down

        const top = info.parent[info.index];
        const bot = info.parent[info.index + 1];

        // Composite Top Node (exactly as it looks, with its own masks)
        const topData = compositeFrame(top, {
            transparentIdx: TRANSPARENT_COLOR,
            floatingSelection: (state.activeLayerId === top.id) ? state.floatingSelection : null
        });

        // Merge onto bottom
        for (let i = 0; i < w * h; i++) {
            if (topData[i] !== TRANSPARENT_COLOR) bot.data[i] = topData[i];
        }

        // Remove top
        info.parent.splice(info.index, 1);
        // Note: activeLayerId should be updated to bot
        state.activeLayerId = bot.id;
    }

    f._v = (f._v || 0) + 1;

    pushHistory();
    updateLayersList();
    renderCanvas();
    renderFramesList(); // Thumbnails might change
}

/* =========================================================================
   IMAGE OPERATIONS (Resize, Canvas Size, Flip, Rotate, Flatten)
   ========================================================================= */

// --- RESIZE IMAGE ---

// --- RESIZE IMAGE ---

// --- RESIZE IMAGE ---
const resizeAlgorithms = {
    scale2x: (data, w, h) => {
        const out = new Uint16Array((w * 2) * (h * 2));
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const p = data[y * w + x];
                const pU = data[Math.max(0, y - 1) * w + x];
                const pD = data[Math.min(h - 1, y + 1) * w + x];
                const pL = data[y * w + Math.max(0, x - 1)];
                const pR = data[y * w + Math.min(w - 1, x + 1)];

                // EPX/Scale2x rules
                let e0 = p, e1 = p, e2 = p, e3 = p;
                if (pL === pU && pL !== pD && pU !== pR) e0 = pL;
                if (pU === pR && pU !== pL && pR !== pD) e1 = pR;
                if (pL === pD && pL !== pU && pD !== pR) e2 = pL;
                if (pD === pR && pD !== pL && pR !== pU) e3 = pR;

                const targetX = x * 2, targetY = y * 2, targetW = w * 2;
                out[targetY * targetW + targetX] = e0;
                out[targetY * targetW + targetX + 1] = e1;
                out[(targetY + 1) * targetW + targetX] = e2;
                out[(targetY + 1) * targetW + targetX + 1] = e3;
            }
        }
        return { data: out, w: w * 2, h: h * 2 };
    },
    xbr: (data, w, h, protectRemap) => {
        // True xBR 2x Pass (Discrete version without blending to preserve exact palette indices)
        // We run it twice to get 4x.
        const xbr2x = (src, sw, sh) => {
            const out = new Uint16Array((sw * 2) * (sh * 2));
            const isRemap = (c) => c >= 16 && c <= 31;
            const colorDist = (c1, c2) => {
                if (c1 === c2) return 0;
                if (c1 === TRANSPARENT_COLOR || c2 === TRANSPARENT_COLOR) return 10000;
                if (protectRemap) {
                    if (isRemap(c1) !== isRemap(c2)) return 10000; // Protect remaps!
                }
                const p1 = state.palette[c1], p2 = state.palette[c2];
                if (!p1 || !p2) return 10000;
                // Simple Euclidean in RGB mapped to YUV intuitively
                const rmean = (p1.r + p2.r) / 2;
                const r = p1.r - p2.r, g = p1.g - p2.g, b = p1.b - p2.b;
                return Math.sqrt((((512 + rmean) * r * r) >> 8) + 4 * g * g + (((767 - rmean) * b * b) >> 8));
            };

            for (let y = 0; y < sh; y++) {
                for (let x = 0; x < sw; x++) {
                    // Neighborhood 12-point star:
                    //     A1 B1 C1
                    //  A0  A  B  C C4
                    //  D0  D  E  F F4
                    //  G0  G  H  I I4
                    //     G5 H5 I5
                    const getP = (dx, dy) => src[Math.max(0, Math.min(sh - 1, y + dy)) * sw + Math.max(0, Math.min(sw - 1, x + dx))];
                    const E = src[y * sw + x];
                    const A = getP(-1, -1), B = getP(0, -1), C = getP(1, -1);
                    const D = getP(-1, 0), F = getP(1, 0);
                    const G = getP(-1, 1), H = getP(0, 1), I = getP(1, 1);
                    /* Outer pixels for discrete xBR logic */
                    const A1 = getP(-1, -2), B1 = getP(0, -2), C1 = getP(1, -2);
                    const A0 = getP(-2, -1), D0 = getP(-2, 0), G0 = getP(-2, 1);
                    const C4 = getP(2, -1), F4 = getP(2, 0), I4 = getP(2, 1);
                    const G5 = getP(-1, 2), H5 = getP(0, 2), I5 = getP(2, 1);

                    // Distances (Simulated xBR edge weights)
                    const df = (c1, c2) => colorDist(c1, c2);

                    // Simple xBR-style Edge metrics
                    const dist_H_B = df(H, B);
                    const dist_D_F = df(D, F);

                    let E0 = E, E1 = E, E2 = E, E3 = E;

                    // Simplified discrete threshold logic to avoid blurring (preserve strict index palette)
                    // Top-Left (E0)
                    if (df(D, B) < dist_H_B && df(D, B) < dist_D_F && df(E, A) > df(D, B)) E0 = D;
                    // Top-Right (E1)
                    if (df(B, F) < dist_H_B && df(B, F) < dist_D_F && df(E, C) > df(B, F)) E1 = F;
                    // Bottom-Left (E2)
                    if (df(D, H) < dist_H_B && df(D, H) < dist_D_F && df(E, G) > df(D, H)) E2 = D;
                    // Bottom-Right (E3)
                    if (df(H, F) < dist_H_B && df(H, F) < dist_D_F && df(E, I) > df(H, F)) E3 = F;

                    const tx = x * 2, ty = y * 2, tw = sw * 2;
                    out[ty * tw + tx] = E0; out[ty * tw + tx + 1] = E1;
                    out[(ty + 1) * tw + tx] = E2; out[(ty + 1) * tw + tx + 1] = E3;
                }
            }
            return { data: out, w: sw * 2, h: sh * 2 };
        };
        const pass1 = xbr2x(data, w, h);
        return xbr2x(pass1.data, pass1.w, pass1.h);
    },
    hq4x: (data, w, h, protectRemap) => {
        // True HQ4x (Discrete / Index-Safe Eagle-Variation Macroblock mapping)
        const out = new Uint16Array((w * 4) * (h * 4));
        const isRemap = (c) => c >= 16 && c <= 31;
        const colorDist = (c1, c2) => {
            if (c1 === c2) return 0;
            if (c1 === TRANSPARENT_COLOR || c2 === TRANSPARENT_COLOR) return 10000;
            if (protectRemap) {
                if (isRemap(c1) !== isRemap(c2)) return 10000;
            }
            const p1 = state.palette[c1], p2 = state.palette[c2];
            if (!p1 || !p2) return 10000;
            const rmean = (p1.r + p2.r) / 2;
            const r = p1.r - p2.r, g = p1.g - p2.g, b = p1.b - p2.b;
            return Math.sqrt((((512 + rmean) * r * r) >> 8) + 4 * g * g + (((767 - rmean) * b * b) >> 8));
        };
        const thres = 120; // YUV threshold equivalent

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const getP = (dx, dy) => data[Math.max(0, Math.min(h - 1, y + dy)) * w + Math.max(0, Math.min(w - 1, x + dx))];
                const c = data[y * w + x];
                const tl = getP(-1, -1), t = getP(0, -1), tr = getP(1, -1);
                const l = getP(-1, 0), r = getP(1, 0);
                const bl = getP(-1, 1), b = getP(0, 1), br = getP(1, 1);

                // Similarities
                const sim = (c1, c2) => colorDist(c1, c2) < thres;

                // 4x4 Grid initialization with Center Color
                let block = new Array(16).fill(c);

                // Top-Left quadrant (0,1,4,5)
                if (sim(tl, t) && sim(tl, l) && !sim(l, t)) { block[0] = tl; block[1] = t; block[4] = l; }
                else if (sim(l, t) && !sim(l, c) && !sim(t, c)) { block[0] = l; }

                // Top-Right quadrant (2,3,6,7)
                if (sim(tr, t) && sim(tr, r) && !sim(r, t)) { block[3] = tr; block[2] = t; block[7] = r; }
                else if (sim(r, t) && !sim(r, c) && !sim(t, c)) { block[3] = r; }

                // Bottom-Left quadrant (8,9,12,13)
                if (sim(bl, b) && sim(bl, l) && !sim(l, b)) { block[12] = bl; block[13] = b; block[8] = l; }
                else if (sim(l, b) && !sim(l, c) && !sim(b, c)) { block[12] = l; }

                // Bottom-Right quadrant (10,11,14,15)
                if (sim(br, b) && sim(br, r) && !sim(r, b)) { block[15] = br; block[14] = b; block[11] = r; }
                else if (sim(r, b) && !sim(r, c) && !sim(b, c)) { block[15] = r; }

                const tx = x * 4, ty = y * 4, tw = w * 4;
                for (let dy = 0; dy < 4; dy++) {
                    for (let dx = 0; dx < 4; dx++) {
                        out[(ty + dy) * tw + (tx + dx)] = block[dy * 4 + dx];
                    }
                }
            }
        }
        return { data: out, w: w * 4, h: h * 4 };
    },
    reloaded_ra2: (data, w, h, protectRemap) => {
        // xBR 4x -> Post-Process to 1.25x
        return resizeAlgorithms.xbr(data, w, h, protectRemap);
    },
    superxbr: (data, w, h, protectRemap) => {
        // Super-xBR 4x (Discrete) — Faithful adaptation of Hyllian's algorithm.
        // Key difference from plain xBR: uses an extended 5x5 neighborhood for diagonal
        // dominance scoring with a 4x weight on the main diagonal (d_AI vs d_CG).
        // This detects shallow slopes (e.g. 1:2, 1:3 diagonals) much more accurately.
        // Discrete: winner-takes-all pixel assignment instead of blending.
        const isRemap = (c) => c >= 16 && c <= 31;
        const colorDist = (c1, c2) => {
            if (c1 === c2) return 0;
            if (c1 === TRANSPARENT_COLOR || c2 === TRANSPARENT_COLOR) return 10000;
            if (protectRemap && isRemap(c1) !== isRemap(c2)) return 10000;
            const p1 = state.palette[c1], p2 = state.palette[c2];
            if (!p1 || !p2) return 10000;
            const rmean = (p1.r + p2.r) / 2;
            const r = p1.r - p2.r, g = p1.g - p2.g, b = p1.b - p2.b;
            return Math.sqrt((((512 + rmean) * r * r) >> 8) + 4 * g * g + (((767 - rmean) * b * b) >> 8));
        };

        const sxbr2x = (src, sw, sh) => {
            const out2x = new Uint16Array((sw * 2) * (sh * 2));
            const df = (idx1, idx2) => colorDist(src[idx1], src[idx2]);

            for (let y = 0; y < sh; y++) {
                for (let x = 0; x < sw; x++) {
                    const gp = (dx, dy) => {
                        const nx = Math.max(0, Math.min(sw - 1, x + dx));
                        const ny = Math.max(0, Math.min(sh - 1, y + dy));
                        return ny * sw + nx;
                    };
                    const E = gp(0, 0);
                    // 3x3 core neighborhood
                    const A = gp(-1, -1), B = gp(0, -1), C = gp(1, -1);
                    const D = gp(-1, 0), F = gp(1, 0);
                    const G = gp(-1, 1), H = gp(0, 1), I = gp(1, 1);
                    // Extended ring (5x5) — used by Hyllian's algorithm for slope detection
                    const A1 = gp(-1, -2), B1 = gp(0, -2), C1 = gp(1, -2);
                    const A0 = gp(-2, -1), D0 = gp(-2, 0), G0 = gp(-2, 1);
                    const C4 = gp(2, -1), F4 = gp(2, 0), I4 = gp(2, 1);
                    const G5 = gp(-1, 2), H5 = gp(0, 2), I5 = gp(1, 2);

                    // --- Hyllian's diagonal dominance scores ---
                    // d_AI: strength of the NW->SE (A to I) diagonal across the 5x5 area.
                    // d_CG: strength of the NE->SW (C to G) diagonal across the 5x5 area.
                    // The x4 weight on the main corner pair is the distinguishing feature of Super-xBR.
                    const d_AI = df(A, B) + df(A, D) + df(I, F) + df(I, H)
                        + df(A1, B1) + df(A0, D0) + df(I4, F4) + df(I5, H5)
                        + 4 * df(A, I);

                    const d_CG = df(C, B) + df(C, F) + df(G, D) + df(G, H)
                        + df(C1, B1) + df(C4, F4) + df(G0, D0) + df(G5, H5)
                        + 4 * df(C, G);

                    let e0 = src[E], e1 = src[E], e2 = src[E], e3 = src[E];

                    if (d_AI < d_CG) {
                        // NW-SE diagonal dominates: TL/BR corners should adopt edge colors
                        // E0 (top-left) pulls toward A; E3 (bottom-right) pulls toward I
                        if (df(E, A) < df(E, B) || df(E, A) < df(E, D)) e0 = src[A];
                        if (df(E, I) < df(E, F) || df(E, I) < df(E, H)) e3 = src[I];
                    } else if (d_CG < d_AI) {
                        // NE-SW diagonal dominates: TR/BL corners adopt edge colors
                        // E1 (top-right) pulls toward C; E2 (bottom-left) pulls toward G
                        if (df(E, C) < df(E, B) || df(E, C) < df(E, F)) e1 = src[C];
                        if (df(E, G) < df(E, D) || df(E, G) < df(E, H)) e2 = src[G];
                    }

                    // Orthogonal edge fallback (xBR-style) for corners still undecided
                    const dist_HB = df(H, B), dist_DF = df(D, F);
                    if (e0 === src[E] && df(D, B) < dist_HB && df(D, B) < dist_DF)
                        e0 = df(D, E) < df(B, E) ? src[D] : src[B];
                    if (e1 === src[E] && df(B, F) < dist_HB && df(B, F) < dist_DF)
                        e1 = df(B, E) < df(F, E) ? src[B] : src[F];
                    if (e2 === src[E] && df(D, H) < dist_HB && df(D, H) < dist_DF)
                        e2 = df(D, E) < df(H, E) ? src[D] : src[H];
                    if (e3 === src[E] && df(H, F) < dist_HB && df(H, F) < dist_DF)
                        e3 = df(H, E) < df(F, E) ? src[H] : src[F];

                    const tx = x * 2, ty = y * 2, tw = sw * 2;
                    out2x[ty * tw + tx] = e0; out2x[ty * tw + tx + 1] = e1;
                    out2x[(ty + 1) * tw + tx] = e2; out2x[(ty + 1) * tw + tx + 1] = e3;
                }
            }
            return { data: out2x, w: sw * 2, h: sh * 2 };
        };
        const pass1 = sxbr2x(data, w, h);
        return sxbr2x(pass1.data, pass1.w, pass1.h);
    },
    omniscale: (data, w, h, protectRemap) => {
        // OmniScale 4x (Discrete / Index-Safe)
        // Highly aggressive edge-directed heuristic for preserving both straight and diagonal lines.
        const out = new Uint16Array((w * 4) * (h * 4));
        const isRemap = (c) => c >= 16 && c <= 31;
        const colorDist = (c1, c2) => {
            if (c1 === c2) return 0;
            if (c1 === TRANSPARENT_COLOR || c2 === TRANSPARENT_COLOR) return 10000;
            if (protectRemap) {
                if (isRemap(c1) !== isRemap(c2)) return 10000; // Never mix remap with non-remap
            }
            const p1 = state.palette[c1], p2 = state.palette[c2];
            if (!p1 || !p2) return 10000;
            const rmean = (p1.r + p2.r) / 2;
            const r = p1.r - p2.r, g = p1.g - p2.g, b = p1.b - p2.b;
            return Math.sqrt((((512 + rmean) * r * r) >> 8) + 4 * g * g + (((767 - rmean) * b * b) >> 8));
        };

        // For OmniScale, we'll do an advanced 2x pass run twice, similar to xBR but with
        // an even stricter 8-way heuristic that completely avoids rounding off corners of 1px lines.
        const omni2x = (src, sw, sh) => {
            const out2x = new Uint16Array((sw * 2) * (sh * 2));
            for (let y = 0; y < sh; y++) {
                for (let x = 0; x < sw; x++) {
                    const getP = (dx, dy) => src[Math.max(0, Math.min(sh - 1, y + dy)) * sw + Math.max(0, Math.min(sw - 1, x + dx))];
                    const E = src[y * sw + x];
                    const A = getP(-1, -1), B = getP(0, -1), C = getP(1, -1);
                    const D = getP(-1, 0), F = getP(1, 0);
                    const G = getP(-1, 1), H = getP(0, 1), I = getP(1, 1);

                    const df = (c1, c2) => colorDist(c1, c2);
                    const sim = (c1, c2) => df(c1, c2) < 100;

                    let E0 = E, E1 = E, E2 = E, E3 = E;

                    // Omni edge rules: strict equality checks combined with high tolerance similarity
                    // to keep 45-degree angles connecting without bleeding over corners.
                    if (sim(D, B) && !sim(D, H) && !sim(B, F)) E0 = df(D, E) < df(B, E) ? D : B;
                    if (sim(B, F) && !sim(B, D) && !sim(F, H)) E1 = df(B, E) < df(F, E) ? B : F;
                    if (sim(D, H) && !sim(D, B) && !sim(H, F)) E2 = df(D, E) < df(H, E) ? D : H;
                    if (sim(H, F) && !sim(H, D) && !sim(F, B)) E3 = df(H, E) < df(F, E) ? H : F;

                    // Advanced smoothing: if 3 neighbors are similar, force the corner
                    if (sim(A, D) && sim(A, B) && sim(D, B)) E0 = A;
                    if (sim(C, B) && sim(C, F) && sim(B, F)) E1 = C;
                    if (sim(G, D) && sim(G, H) && sim(D, H)) E2 = G;
                    if (sim(I, F) && sim(I, H) && sim(F, H)) E3 = I;

                    const tx = x * 2, ty = y * 2, tw = sw * 2;
                    out2x[ty * tw + tx] = E0; out2x[ty * tw + tx + 1] = E1;
                    out2x[(ty + 1) * tw + tx] = E2; out2x[(ty + 1) * tw + tx + 1] = E3;
                }
            }
            return { data: out2x, w: sw * 2, h: sh * 2 };
        };
        const pass1 = omni2x(data, w, h);
        return omni2x(pass1.data, pass1.w, pass1.h);
    },
    xbrz: (data, w, h, protectRemap) => {
        // xBRZ 4x (Discrete / Index-Safe)
        // Uses the "Zeta-rule" pattern matching logic for cleaner corners than standard xBR.
        // It's a high-fidelity algorithm that avoids "staircasing" in pixel art.
        const isRemap = (c) => c >= 16 && c <= 31;
        const colorDist = (c1, c2) => {
            if (c1 === c2) return 0;
            if (c1 === TRANSPARENT_COLOR || c2 === TRANSPARENT_COLOR) return 10000;
            if (protectRemap && isRemap(c1) !== isRemap(c2)) return 10000;
            const p1 = state.palette[c1], p2 = state.palette[c2];
            if (!p1 || !p2) return 10000;
            // Weighted Euclidean for edge detection
            const dr = p1.r - p2.r, dg = p1.g - p2.g, db = p1.b - p2.b;
            return Math.sqrt(dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114);
        };

        const xbrz2x = (src, sw, sh) => {
            const out2x = new Uint16Array((sw * 2) * (sh * 2));
            const df = (idx1, idx2) => colorDist(src[idx1], src[idx2]);

            for (let y = 0; y < sh; y++) {
                for (let x = 0; x < sw; x++) {
                    const E = y * sw + x;
                    const getP = (dx, dy) => {
                        const nx = Math.max(0, Math.min(sw - 1, x + dx));
                        const ny = Math.max(0, Math.min(sh - 1, y + dy));
                        return ny * sw + nx;
                    };

                    // 3x3 block around E
                    const A = getP(-1, -1), B = getP(0, -1), C = getP(1, -1);
                    const D = getP(-1, 0), F = getP(1, 0);
                    const G = getP(-1, 1), H = getP(0, 1), I = getP(1, 1);

                    // Neighboring context for rules
                    const B0 = getP(0, -2), D0 = getP(-2, 0), F4 = getP(2, 0), H5 = getP(0, 2);

                    let E0 = src[E], E1 = src[E], E2 = src[E], E3 = src[E];

                    // xBRZ edge detection and blending weights (Zeta-rules)
                    const d_B_E = df(B, E), d_D_E = df(D, E), d_H_E = df(H, E), d_F_E = df(F, E);
                    const d_A_E = df(A, E), d_C_E = df(C, E), d_G_E = df(G, E), d_I_E = df(I, E);

                    // Simplified xBRZ kernel decision for each corner sub-pixel
                    const processCorner = (p, p1, p2, p3, p4, p5, p6, p7, p8) => {
                        // Logic derived from xBRZ Zeta rule: edge weight analysis
                        // p is the target subpixel's center (src[E])
                        const w1 = df(p1, p) + df(p2, p) + df(p3, p) + df(p4, p);
                        const w2 = df(p5, p) + df(p6, p) + df(p7, p) + df(p8, p);
                        if (w1 < w2) {
                            // dominant color choice
                            return df(p1, p) < df(p2, p) ? src[p1] : src[p2];
                        }
                        return src[E];
                    };

                    // Sub-pixels mapping
                    // E0 (Top-left)  : B, D vs A, B0, D0
                    // E1 (Top-right) : B, f vs C, B0, F4
                    // E2 (Bot-left)  : D, H vs G, D0, H5
                    // E3 (Bot-right) : F, H vs I, F4, H5

                    const d_D_B = df(D, B), d_D_H = df(D, H), d_F_H = df(F, H), d_F_B = df(F, B);

                    if (d_D_B < d_F_B && d_D_B < d_D_H) E0 = df(D, E) < df(B, E) ? src[D] : src[B];
                    if (d_F_B < d_D_B && d_F_B < d_F_H) E1 = df(F, E) < df(B, E) ? src[F] : src[B];
                    if (d_D_H < d_D_B && d_D_H < d_F_H) E2 = df(D, E) < df(H, E) ? src[D] : src[H];
                    if (d_F_H < d_F_B && d_F_H < d_D_H) E3 = df(F, E) < df(H, E) ? src[F] : src[H];

                    // xBRZ specific corner refinement (Zeta rule approximation)
                    if (df(A, I) < df(C, G)) {
                        if (df(E, B) + df(E, D) < df(E, F) + df(E, H)) {
                            if (df(A, E) < df(A, B) && df(A, E) < df(A, D)) E0 = src[A];
                        }
                    } else if (df(C, G) < df(A, I)) {
                        if (df(E, B) + df(E, F) < df(E, D) + df(E, H)) {
                            if (df(C, E) < df(C, B) && df(C, E) < df(C, F)) E1 = src[C];
                        }
                    }

                    const tx = x * 2, ty = y * 2, tw = sw * 2;
                    out2x[ty * tw + tx] = E0; out2x[ty * tw + tx + 1] = E1;
                    out2x[(ty + 1) * tw + tx] = E2; out2x[(ty + 1) * tw + tx + 1] = E3;
                }
            }
            return { data: out2x, w: sw * 2, h: sh * 2 };
        };

        const pass1 = xbrz2x(data, w, h);
        return xbrz2x(pass1.data, pass1.w, pass1.h);
    },
    scalefx: (data, w, h, protectRemap) => {
        // ScaleFX 4x (Discrete / Index-Safe)
        // Advanced edge-directed scaler that detects long slopes (up to 1:4).
        // This is a "Discrete" port that avoids blending but preserves the high-range edge detection.
        const isRemap = (c) => c >= 16 && c <= 31;
        const colorDist = (c1, c2) => {
            if (c1 === c2) return 0;
            if (c1 === TRANSPARENT_COLOR || c2 === TRANSPARENT_COLOR) return 10000;
            if (protectRemap && isRemap(c1) !== isRemap(c2)) return 10000;
            const p1 = state.palette[c1], p2 = state.palette[c2];
            if (!p1 || !p2) return 10000;
            const dr = p1.r - p2.r, dg = p1.g - p2.g, db = p1.b - p2.b;
            return Math.sqrt(dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114);
        };

        const sfx2x = (src, sw, sh) => {
            const out2x = new Uint16Array((sw * 2) * (sh * 2));
            const df = (idx1, idx2) => colorDist(src[idx1], src[idx2]);

            for (let y = 0; y < sh; y++) {
                for (let x = 0; x < sw; x++) {
                    const E = y * sw + x;
                    const getP = (dx, dy) => {
                        const nx = Math.max(0, Math.min(sw - 1, x + dx));
                        const ny = Math.max(0, Math.min(sh - 1, y + dy));
                        return ny * sw + nx;
                    };

                    // 5x5 neighborhood check for ScaleFX connectivity strength
                    const neighbors = [];
                    for (let dy = -2; dy <= 2; dy++) {
                        for (let dx = -2; dx <= 2; dx++) {
                            neighbors.push(getP(dx, dy));
                        }
                    }

                    // A...I mapping for the core 3x3
                    const A = neighbors[6], B = neighbors[7], C = neighbors[8];
                    const D = neighbors[11], F = neighbors[13];
                    const G = neighbors[16], H = neighbors[17], I = neighbors[18];

                    let E0 = src[E], E1 = src[E], E2 = src[E], E3 = src[E];

                    // ScaleFX Strength Heuristics (simplified for discrete implementation)
                    const strength = (p1, p2, p3) => (df(p1, p2) < 20 && df(p2, p3) < 20) ? 2 : (df(p1, p3) < 30 ? 1 : 0);

                    // TL Corner
                    if (strength(D, A, B) > strength(H, G, D) && strength(D, A, B) > strength(F, C, B)) {
                        E0 = df(D, E) < df(B, E) ? src[D] : src[B];
                    }
                    // TR Corner
                    if (strength(B, C, F) > strength(D, A, B) && strength(B, C, F) > strength(H, I, F)) {
                        E1 = df(B, E) < df(F, E) ? src[B] : src[F];
                    }
                    // BL Corner
                    if (strength(G, D, H) > strength(D, A, B) && strength(G, D, H) > strength(I, F, H)) {
                        E2 = df(D, E) < df(H, E) ? src[D] : src[H];
                    }
                    // BR Corner
                    if (strength(F, I, H) > strength(B, C, F) && strength(F, I, H) > strength(D, G, H)) {
                        E3 = df(F, E) < df(H, E) ? src[F] : src[H];
                    }

                    // Shallow slope logic (1:2 and 2:1 detection)
                    if (df(D, B) < df(F, H)) {
                        if (df(getP(-2, -1), B) < 20) E0 = src[B];
                        if (df(getP(-1, -2), D) < 20) E0 = src[D];
                    }

                    const tx = x * 2, ty = y * 2, tw = sw * 2;
                    out2x[ty * tw + tx] = E0; out2x[ty * tw + tx + 1] = E1;
                    out2x[(ty + 1) * tw + tx] = E2; out2x[(ty + 1) * tw + tx + 1] = E3;
                }
            }
            return { data: out2x, w: sw * 2, h: sh * 2 };
        };

        const pass1 = sfx2x(data, w, h);
        return sfx2x(pass1.data, pass1.w, pass1.h);
    }
};

export function resampleLayerData(oldData, ow, oh, newW, newH, method, postProcess, protectRemapOverride) {
    const isFixed = ['xbr', 'hq4x', 'scale2x', 'omniscale', 'xbrz', 'scalefx', 'reloaded_ra2', 'superxbr', 'lanczos3'].includes(method);
    let finalData;

    const protectRemap = (protectRemapOverride !== undefined) ? protectRemapOverride : elements.chkResizeProtectRemap?.checked;

    if (isFixed) {
        const algResult = resizeAlgorithms[method](oldData, ow, oh, protectRemap);
        if (algResult.w === newW && algResult.h === newH) {
            finalData = algResult.data;
        } else if (postProcess) {
            // Resize from algorithm result to exact target using the post-processing algorithm (smart or nearest)
            finalData = resampleLayerData(algResult.data, algResult.w, algResult.h, newW, newH, postProcess, false);
        } else {
            // Just nearest if algo doesn't match and no force
            finalData = new Uint16Array(newW * newH).fill(TRANSPARENT_COLOR);
            const xr = ow / newW, yr = oh / newH;
            for (let y = 0; y < newH; y++) {
                for (let x = 0; x < newW; x++) {
                    finalData[y * newW + x] = oldData[Math.floor(y * yr) * ow + Math.floor(x * xr)];
                }
            }
        }
    } else if (method === 'nearest' || !method) {
        finalData = new Uint16Array(newW * newH).fill(TRANSPARENT_COLOR);
        const xr = ow / newW, yr = oh / newH;
        for (let y = 0; y < newH; y++) {
            for (let x = 0; x < newW; x++) {
                finalData[y * newW + x] = oldData[Math.floor(y * yr) * ow + Math.floor(x * xr)];
            }
        }
    } else if (method === 'smart') {
        finalData = new Uint16Array(newW * newH).fill(TRANSPARENT_COLOR);
        const xr = ow / newW, yr = oh / newH;

        for (let y = 0; y < newH; y++) {
            for (let x = 0; x < newW; x++) {
                const sx1 = Math.floor(x * xr), sx2 = Math.ceil((x + 1) * xr);
                const sy1 = Math.floor(y * yr), sy2 = Math.ceil((y + 1) * yr);

                let r = 0, g = 0, b = 0, count = 0, totalPixels = 0;
                let count0 = 0, count65535 = 0;

                let rRemap = 0, gRemap = 0, bRemap = 0, countRemap = 0;

                for (let sy = sy1; sy < sy2 && sy < oh; sy++) {
                    for (let sx = sx1; sx < sx2 && sx < ow; sx++) {
                        totalPixels++;
                        const cIdx = oldData[sy * ow + sx];
                        if (cIdx === 0) {
                            count0++;
                        } else if (cIdx === TRANSPARENT_COLOR) {
                            count65535++;
                        } else {
                            const c = state.palette[cIdx];
                            if (c) {
                                if (protectRemap && cIdx >= 16 && cIdx <= 31) {
                                    rRemap += c.r; gRemap += c.g; bRemap += c.b; countRemap++;
                                } else {
                                    r += c.r; g += c.g; b += c.b; count++;
                                }
                            }
                        }
                    }
                }

                // Strict majority vote — pixel is OPAQUE if opaque count >= transparent count.
                // This matches the behavior expected from the backup 40 and preserves
                // stable, consistent sawtooth edges at diagonal boundaries.
                const opaqueCount = count + countRemap;

                if (opaqueCount > 0 && opaqueCount >= count65535) {
                    // STRICT SEPARATION: Pick the dominant color category
                    if (protectRemap && countRemap >= count) {
                        const avgR = rRemap / countRemap, avgG = gRemap / countRemap, avgB = bRemap / countRemap;
                        finalData[y * newW + x] = findNearestPaletteIndexInRange(avgR, avgG, avgB, state.palette, 16, 31);
                    } else if (count > 0) {
                        const avgR = r / count, avgG = g / count, avgB = b / count;
                        finalData[y * newW + x] = findNearestPaletteIndex(avgR, avgG, avgB, state.palette);
                    } else {
                        finalData[y * newW + x] = TRANSPARENT_COLOR;
                    }
                } else {
                    // Transparent: Pick whichever was more common in source
                    finalData[y * newW + x] = (count0 >= count65535) ? 0 : TRANSPARENT_COLOR;
                }
            }
        }
    }
    return finalData;
}

export async function resizeImage(newW, newH, method = 'nearest', postProcess = false) {
    if (!state.frames.length) return;

    // Recursive helper to count layers (excluding external_shp from resampling)
    const countLayersRecursive = (nodes) => {
        let count = 0;
        nodes.forEach(node => {
            if (node.type !== 'external_shp') count++;
            const children = node.layers || node.children;
            if (children) count += countLayersRecursive(children);
        });
        return count;
    };

    let totalLayers = 0;
    state.frames.forEach(f => totalLayers += countLayersRecursive(f.layers));
    let processedLayers = 0;

    // Snapshot BEFORE any mutations so undo can restore the original state
    pushHistory("all");

    // Show Progress Modal
    if (elements.progressModal) {
        elements.lblProgressText.innerText = `${t('lbl_processing')} 0 / ${totalLayers}`;
        elements.pbResizeProgress.style.width = '0%';
        elements.progressModal.showModal();
    }

    // 1. Update Canvas Dimensions
    state.canvasW = newW;
    state.canvasH = newH;

    // Recursive resizer
    const resizeLayersRecursive = async (nodes) => {
        for (const layer of nodes) {
            if (layer.type === 'external_shp') {
                // External SHP layers are not affected by project-wide resampling.
                continue;
            }

            if (layer.data) {
                const oldData = layer.data;
                const ow = layer.width;
                const oh = layer.height;

                const finalData = resampleLayerData(oldData, ow, oh, newW, newH, method, postProcess);

                layer.data = finalData;
                layer.width = newW;
                layer.height = newH;

                processedLayers++;
                if (elements.progressModal) {
                    const pct = Math.min(100, (processedLayers / totalLayers) * 100);
                    elements.lblProgressText.innerText = `${t('lbl_processing')} ${processedLayers} / ${totalLayers}`;
                    elements.pbResizeProgress.style.width = `${pct}%`;
                }
                // Yield periodically
                if (processedLayers % 5 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            const children = layer.layers || layer.children;
            if (children) {
                await resizeLayersRecursive(children);
            }
        }
    };

    // Start Iteration
    for (const frame of state.frames) {
        frame.width = newW;
        frame.height = newH;

        await resizeLayersRecursive(frame.layers);

        frame._v = (frame._v || 0) + 1;
    }

    if (elements.progressModal) elements.progressModal.close();

    // Clear selection after resize
    state.selection = null;

    updateCanvasSize();
    renderCanvas();
    renderFramesList();
}


// --- CANVAS SIZE ---

export function resizeCanvas(newW, newH, anchor = 'c') {
    if (!state.frames.length) return;

    const oldW = state.canvasW;
    const oldH = state.canvasH;

    // Snapshot BEFORE any mutations so undo can restore the original state
    pushHistory("all");

    // Calculate Offset based on Anchor
    let offX = 0;
    let offY = 0;

    // Horizontal
    if (anchor.includes('w')) offX = 0;
    else if (anchor.includes('e')) offX = newW - oldW;
    else offX = Math.floor((newW - oldW) / 2);

    // Vertical
    if (anchor.includes('n')) offY = 0;
    else if (anchor.includes('s')) offY = newH - oldH;
    else offY = Math.floor((newH - oldH) / 2);

    state.canvasW = newW;
    state.canvasH = newH;

    state.frames.forEach(frame => {
        frame.width = newW;
        frame.height = newH;

        frame.layers.forEach(layer => {
            if (layer.type === 'external_shp') {
                // External SHP layers preserve their content dimensions and data.
                // We just adjust their position based on the anchor offset (expansion/cropping).
                layer.x = (layer.x || 0) + offX;
                layer.y = (layer.y || 0) + offY;
                return;
            }

            const oldData = layer.data;
            const newData = new Uint16Array(newW * newH).fill(TRANSPARENT_COLOR); // Fill with transparent

            for (let y = 0; y < oldH; y++) {
                for (let x = 0; x < oldW; x++) {
                    const nx = x + offX;
                    const ny = y + offY;

                    if (nx >= 0 && nx < newW && ny >= 0 && ny < newH) {
                        newData[ny * newW + nx] = oldData[y * oldW + x];
                    }
                }
            }

            layer.data = newData;
            layer.width = newW;
            layer.height = newH;
        });
        frame._v = (frame._v || 0) + 1; // Increment version
    });

    if (state.selection) {
        state.selection = null;
    }

    updateCanvasSize();
    renderCanvas();
    renderFramesList();
}


// --- CANVAS SIZE (OFFSETS) ---

export function resizeCanvasOffsets(top, bottom, left, right) {
    // top, bottom, left, right are integers (can be negative)
    // Positive = Expand, Negative = Crop

    if (!state.frames.length) return;

    const oldW = state.canvasW;
    const oldH = state.canvasH;

    const newW = oldW + left + right;
    const newH = oldH + top + bottom;

    if (newW <= 0 || newH <= 0) {
        alert("Resulting canvas size must be positive.");
        return;
    }

    // Snapshot BEFORE any mutations so undo can restore the original state
    pushHistory("all");

    state.canvasW = newW;
    state.canvasH = newH;

    // Offset for old image data in new canvas
    // If we add 10 to left, old image starts at x=10.
    // If we remove 10 from left (left=-10), old image starts at x=-10 (cropped).
    const offX = left;
    const offY = top;

    state.frames.forEach(frame => {
        frame.width = newW;
        frame.height = newH;

        frame.layers.forEach(layer => {
            if (layer.type === 'external_shp') {
                // Preserve data and dimensions, just shift the position.
                layer.x = (layer.x || 0) + offX;
                layer.y = (layer.y || 0) + offY;
                return;
            }

            const oldData = layer.data;
            const newData = new Uint16Array(newW * newH).fill(TRANSPARENT_COLOR);

            for (let y = 0; y < oldH; y++) {
                for (let x = 0; x < oldW; x++) {
                    const nx = x + offX;
                    const ny = y + offY;

                    if (nx >= 0 && nx < newW && ny >= 0 && ny < newH) {
                        newData[ny * newW + nx] = oldData[y * oldW + x];
                    }
                }
            }

            layer.data = newData;
            layer.width = newW;
            layer.height = newH;
        });
        frame._v = (frame._v || 0) + 1; // Increment version
    });

    if (state.selection) {
        state.selection = null;
    }

    updateCanvasSize();
    renderCanvas();
    renderFramesList();
}


// --- FLIP ---

export function flipImage(axis = 'h', scope = 'frame') {
    // axis: 'h' | 'v'
    // scope: 'selection' | 'layer' | 'frame' | 'all'
    //
    // Selection  → Only pixels inside state.selection on the active layer. Selection rect is also flipped.
    // Active Layer (layer) → Active layer + any directly-clipped masks above it, current frame only.
    // Active Frame (frame) → ALL layers of the current frame (including masks).
    // All Frames  (all)   → ALL layers of ALL frames.

    const w = state.canvasW;
    const h = state.canvasH;

    // ── Helper: transform a single layer's full data in-place ─────────────────
    const flipLayerFull = (layer) => {
        if (!layer || !layer.data || layer.type === 'external_shp') return;
        const old = layer.data;
        const next = new Uint16Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const src = y * w + x;
                const dst = axis === 'h'
                    ? y * w + (w - 1 - x)
                    : (h - 1 - y) * w + x;
                next[dst] = old[src];
            }
        }
        layer.data = next;
    };

    // ── Helper: find the active layer node in a frame ─────────────────────────
    const findActiveLayer = (frame) => {
        const id = state.activeLayerId;
        return frame.layers.find(ly => ly.id === id)
            || frame.layers[state.preferredLayerIdx]
            || frame.layers[0]
            || null;
    };

    // ── Helper: collect clipped masks immediately above the active layer ───────
    const getClippedMasksFor = (frame, activeLayer) => {
        if (!activeLayer) return [];
        const idx = frame.layers.indexOf(activeLayer);
        if (idx < 0) return [];
        const masks = [];
        // Clipped masks sit immediately ABOVE their target (higher indices = on top)
        for (let i = idx + 1; i < frame.layers.length; i++) {
            const ly = frame.layers[i];
            if (ly.isMask && ly.clipped) masks.push(ly);
            else break; // stop at the first non-clipped layer
        }
        return masks;
    };


    // ── Helper: recursively walk ALL leaf layers in a tree node ─────────────────
    const walkLayers = (nodes, cb) => {
        for (const node of nodes) {
            if (node.type === 'external_shp') continue; // PROTECT
            if (node.data) cb(node);
            if (node.layers) walkLayers(node.layers, cb);
            if (node.children) walkLayers(node.children, cb);
        }
    };

    if (scope === 'selection' || scope === 'sel') {
        if (!state.selection && !state.floatingSelection) return;

        const flipBuffer = (buf, sw, sh, ax, Constructor) => {
            const next = new Constructor(sw * sh);
            for (let y = 0; y < sh; y++) {
                for (let x = 0; x < sw; x++) {
                    const nx = ax === 'h' ? (sw - 1 - x) : x;
                    const ny = ax === 'v' ? (sh - 1 - y) : y;
                    next[ny * sw + nx] = buf[y * sw + x];
                }
            }
            return next;
        };

        if (state.floatingSelection) {
            const fs = state.floatingSelection;
            fs.data = flipBuffer(fs.data, fs.w, fs.h, axis, Uint16Array);
            if (fs.maskData) fs.maskData = flipBuffer(fs.maskData, fs.w, fs.h, axis, Uint8Array);
            if (fs.originalData) fs.originalData = flipBuffer(fs.originalData, fs.originalW, fs.originalH, axis, Uint16Array);
            if (fs.originalMaskData) fs.originalMaskData = flipBuffer(fs.originalMaskData, fs.originalW, fs.originalH, axis, Uint8Array);

            // If selection has a mask, flip it too
            if (state.selection && state.selection.maskData) {
                state.selection.maskData = flipBuffer(state.selection.maskData, state.selection.w, state.selection.h, axis, Uint8Array);
            }
        } else {
            const frame = state.frames[state.currentFrameIdx];
            const layer = findActiveLayer(frame);
            if (!layer || !layer.data) return;
            const sel = state.selection;

            if (sel.type === 'rect') {
                const temp = new Uint16Array(sel.w * sel.h);
                for (let y = 0; y < sel.h; y++)
                    for (let x = 0; x < sel.w; x++)
                        temp[y * sel.w + x] = layer.data[(sel.y + y) * w + (sel.x + x)];

                const flipped = flipBuffer(temp, sel.w, sel.h, axis, Uint16Array);
                for (let y = 0; y < sel.h; y++)
                    for (let x = 0; x < sel.w; x++)
                        layer.data[(sel.y + y) * w + (sel.x + x)] = flipped[y * sel.w + x];
            } else if (sel.type === 'mask') {
                // For mask selections, we MUST use a floating selection to avoid destructive mess
                // Lift to floating selection if not already (this is standard behavior)
                // We'll just call the move tool logic or do it here
                const floatingData = new Uint16Array(sel.w * sel.h).fill(TRANSPARENT_COLOR);
                for (let y = 0; y < sel.h; y++) {
                    for (let x = 0; x < sel.w; x++) {
                        if (sel.maskData[y * sel.w + x]) {
                            const lx = sel.x + x, ly = sel.y + y;
                            if (lx >= 0 && lx < layer.width && ly >= 0 && ly < layer.height) {
                                floatingData[y * sel.w + x] = layer.data[ly * layer.width + lx];
                                layer.data[ly * layer.width + lx] = TRANSPARENT_COLOR;
                            }
                        }
                    }
                }
                state.floatingSelection = {
                    frameIdx: state.currentFrameIdx,
                    x: sel.x, y: sel.y, w: sel.w, h: sel.h,
                    data: floatingData,
                    originalData: new Uint16Array(floatingData),
                    originalW: sel.w, originalH: sel.h,
                    type: 'mask',
                    maskData: new Uint8Array(sel.maskData),
                    originalMaskData: new Uint8Array(sel.maskData),
                    targetLayerId: layer.id
                };

                // Now flip the newly created floating selection
                const fs = state.floatingSelection;
                fs.data = flipBuffer(fs.data, fs.w, fs.h, axis, Uint16Array);
                fs.maskData = flipBuffer(fs.maskData, fs.w, fs.h, axis, Uint8Array);
                fs.originalData = flipBuffer(fs.originalData, fs.originalW, fs.originalH, axis, Uint16Array);
                fs.originalMaskData = flipBuffer(fs.originalMaskData, fs.originalW, fs.originalH, axis, Uint8Array);
                state.selection.maskData = new Uint8Array(fs.maskData);
            }

            frame._v = (frame._v || 0) + 1;
        }

        renderCanvas();
        if (typeof window.startAnts === 'function') window.startAnts();
    }
    else if (scope === 'layer') {
        // Active layer + its clipped masks, current frame only.
        const frame = state.frames[state.currentFrameIdx];
        if (!frame) return;

        // Clone current frame to support undo
        state.frames[state.currentFrameIdx] = {
            ...frame,
            layers: frame.layers.map(l => cloneLayerNode(l))
        };
        const newFrame = state.frames[state.currentFrameIdx];

        const active = findActiveLayer(newFrame);
        const targets = active ? [active, ...getClippedMasksFor(newFrame, active)] : [];
        targets.forEach(flipLayerFull);
        newFrame._v = (newFrame._v || 0) + 1;

    } else if (scope === 'frame') {
        // All layers of the current frame (including masks inside groups).
        const frame = state.frames[state.currentFrameIdx];
        if (!frame) return;

        // Clone current frame to support undo
        state.frames[state.currentFrameIdx] = {
            ...frame,
            layers: frame.layers.map(l => cloneLayerNode(l))
        };
        const newFrame = state.frames[state.currentFrameIdx];

        walkLayers(newFrame.layers, flipLayerFull);
        newFrame._v = (newFrame._v || 0) + 1;
    } else if (scope === 'all') {
        // Deep clone frames before mutating them to protect previous history snapshots
        state.frames = state.frames.map(f => ({
            width: f.width,
            height: f.height,
            duration: f.duration,
            lastSelectedIdx: f.lastSelectedIdx,
            _v: f._v,
            layers: f.layers.map(l => cloneLayerNode(l))
        }));

        // Flip all layers across all frames
        state.frames.forEach(frame => {
            if (!frame) return;
            walkLayers(frame.layers, flipLayerFull);
            frame._v = (frame._v || 0) + 1;
        });
    }

    if (scope === 'all') {
        pushHistory('all');
    } else {
        pushHistory(state.currentFrameIdx);
    }

    updateLayersList();
    renderCanvas();
    if (typeof renderOverlay === 'function') renderOverlay();
    renderFramesList();
}


// --- ROTATE ---

/**
 * Rotating a buffer by an arbitrary angle (in radians).
 * Uses reverse mapping for stability.
 */
export function rotateBufferArbitrary(buf, sw, sh, angleRad, Constructor, protectRemap = false) {
    if (Math.abs(angleRad) < 0.001) return { data: new Constructor(buf), w: sw, h: sh };

    const cos = Math.cos(-angleRad);
    const sin = Math.sin(-angleRad);

    const absCos = Math.abs(Math.cos(angleRad));
    const absSin = Math.abs(Math.sin(angleRad));

    const nw = Math.max(1, Math.round(sw * absCos + sh * absSin));
    const nh = Math.max(1, Math.round(sw * absSin + sh * absCos));

    const next = new Constructor(nw * nh).fill(Constructor === Uint16Array ? TRANSPARENT_COLOR : 0);

    const scx = sw / 2;
    const scy = sh / 2;
    const ncx = nw / 2;
    const ncy = nh / 2;

    for (let y = 0; y < nh; y++) {
        for (let x = 0; x < nw; x++) {
            const dx = x - ncx + 0.5;
            const dy = y - ncy + 0.5;
            const sx = dx * cos - dy * sin + scx;
            const sy = dx * sin + dy * cos + scy;

            if (sx >= 0 && sx < sw && sy >= 0 && sy < sh) {
                const srcIdx = Math.floor(sy) * sw + Math.floor(sx);
                next[y * nw + x] = buf[srcIdx];
            }
        }
    }
    return { data: next, w: nw, h: nh };
}

export function rotateImage(angle = 90, scope = 'frame') {
    // angle: 90 | -90 (270)
    // scope: 'selection' | 'layer' | 'frame' | 'all'
    //
    // Selection  → Only pixels inside state.selection on the active layer. Selection rect is also rotated.
    // Active Layer (layer) → Active layer + directly-clipped masks, current frame.
    // Active Frame (frame) → ALL layers of the current frame.
    // All Frames  (all)   → ALL layers of ALL frames. 90°/-90° also swaps canvasW/canvasH.

    const w = state.canvasW;
    const h = state.canvasH;

    // ── Helper: find the active layer node in a frame ─────────────────────────
    const findActiveLayer = (frame) => {
        const id = state.activeLayerId;
        return frame.layers.find(ly => ly.id === id)
            || frame.layers[state.preferredLayerIdx]
            || frame.layers[0]
            || null;
    };

    // ── Helper: collect clipped masks immediately above the active layer ───────
    const getClippedMasksFor = (frame, activeLayer) => {
        if (!activeLayer) return [];
        const idx = frame.layers.indexOf(activeLayer);
        if (idx < 0) return [];
        const masks = [];
        for (let i = idx + 1; i < frame.layers.length; i++) {
            const ly = frame.layers[i];
            if (ly.isMask && ly.clipped) masks.push(ly);
            else break;
        }
        return masks;
    };

    // ── Helper: rotate a full layer in-place (in existing canvas bounds) ──────
    const rotateLayerFull = (layer) => {
        if (!layer || !layer.data || layer.type === 'external_shp') return;
        const old = layer.data;
        // 90° / -90° in-canvas (center-pivot, clips at canvas edges for non-square)
        const cx = w / 2, cy = h / 2;
        const next = new Uint16Array(w * h).fill(TRANSPARENT_COLOR);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const rx = x - cx, ry = y - cy;
                const nrx = angle === 90 ? -ry : ry;
                const nry = angle === 90 ? rx : -rx;
                const nx = Math.round(nrx + cx);
                const ny = Math.round(nry + cy);
                if (nx >= 0 && nx < w && ny >= 0 && ny < h)
                    next[ny * w + nx] = old[y * w + x];
            }
        }
        layer.data = next;
    };

    // ── Helper: recursively walk ALL layers in a tree node ─────────────────
    const walkLayers = (nodes, cb) => {
        for (const node of nodes) {
            if (node.type === 'external_shp') continue;
            // Always process this node if it has data (even if it also has children)
            if (node.data) cb(node);
            // Then recurse into sub-layers / children (groups, clipped masks, etc.)
            if (node.layers) walkLayers(node.layers, cb);
            if (node.children) walkLayers(node.children, cb);
        }
    };

    // ── Helper: rotate a small buffer (for floating selection / mask data) ────
    const rotBuf = (buf, bw, bh, Constructor) => {
        const nw = bh, nh = bw;
        const next = new Constructor(nw * nh);
        for (let y2 = 0; y2 < bh; y2++)
            for (let x2 = 0; x2 < bw; x2++) {
                let nx, ny;
                if (angle === 90) { nx = bh - 1 - y2; ny = x2; }
                else { nx = y2; ny = bw - 1 - x2; }
                next[ny * nw + nx] = buf[y2 * bw + x2];
            }
        return { data: next, w: nw, h: nh };
    };

    // ── Helper: rotate floating selection + selection area to keep coherence ──
    const rotateFloatAndSel = (isStructural = false) => {
        if (!state.floatingSelection && !state.selection) return;

        // Transform a center point from old canvas space to new canvas space
        const rotCenter = (px, py) => {
            if (isStructural) {
                // Canvas changes from w×h → h×w
                if (angle === 180) return { x: w - 1 - px, y: h - 1 - py };
                if (angle === 90) return { x: h - 1 - py, y: px };
                return { x: py, y: w - 1 - px }; // -90
            } else {
                // In-place rotation around canvas center
                const cx = w / 2, cy = h / 2;
                if (angle === 90) return { x: cx + (cy - py), y: cy + (px - cx) };
                return { x: cx - (cy - py), y: cy - (px - cx) }; // -90
            }
        };

        const sel = state.selection;

        // 1. Rotate floating selection data + position
        if (state.floatingSelection) {
            const fs = state.floatingSelection;
            const oldW = fs.w, oldH = fs.h;
            const oldCx = fs.x + oldW / 2;
            const oldCy = fs.y + oldH / 2;

            // Rotate pixel data
            const r = rotBuf(fs.data, oldW, oldH, Uint16Array);
            fs.data = r.data;
            fs.w = r.w;
            fs.h = r.h;

            // Rotate position around canvas center
            const nc = rotCenter(oldCx, oldCy);
            fs.x = Math.round(nc.x - r.w / 2);
            fs.y = Math.round(nc.y - r.h / 2);

            // Rotate mask data
            if (fs.maskData) {
                fs.maskData = rotBuf(fs.maskData, oldW, oldH, Uint8Array).data;
            }

            // Rotate original data (for quality-preserving future transforms)
            const oldOrigW = fs.originalW || oldW;
            const oldOrigH = fs.originalH || oldH;
            if (fs.originalData) {
                const ro = rotBuf(fs.originalData, oldOrigW, oldOrigH, Uint16Array);
                fs.originalData = ro.data;
                fs.originalW = ro.w;
                fs.originalH = ro.h;
            }
            if (fs.originalMaskData) {
                fs.originalMaskData = rotBuf(fs.originalMaskData, oldOrigW, oldOrigH, Uint8Array).data;
            }

            // Sync selection bounds with floating selection
            if (sel) {
                sel.x = fs.x;
                sel.y = fs.y;
                sel.w = fs.w;
                sel.h = fs.h;
                if (fs.maskData) sel.maskData = new Uint8Array(fs.maskData);
            }
        } else if (sel) {
            // 2. Rotate selection bounds (non-floating)
            const selCx = sel.x + sel.w / 2;
            const selCy = sel.y + sel.h / 2;
            const nc = rotCenter(selCx, selCy);

            // 90°/-90°: w and h swap
            const oldSelW = sel.w, oldSelH = sel.h;
            sel.w = oldSelH;
            sel.h = oldSelW;
            sel.x = Math.round(nc.x - sel.w / 2);
            sel.y = Math.round(nc.y - sel.h / 2);

            // Rotate mask data if present
            if (sel.maskData) {
                sel.maskData = rotBuf(sel.maskData, oldSelW, oldSelH, Uint8Array).data;
            }
        }
    };

    if (scope === 'selection' || scope === 'sel') {
        if (!state.selection && !state.floatingSelection) return;

        const rotateBuffer = (buf, sw, sh, deg, Constructor) => {
            const newW = sh, newH = sw;
            const next = new Constructor(newW * newH);
            for (let y = 0; y < sh; y++) {
                for (let x = 0; x < sw; x++) {
                    let nx, ny;
                    if (deg === 90) { nx = sh - 1 - y; ny = x; }
                    else { nx = y; ny = sw - 1 - x; }
                    next[ny * newW + nx] = buf[y * sw + x];
                }
            }
            return { data: next, w: newW, h: newH };
        };

        if (state.floatingSelection) {
            const fs = state.floatingSelection;
            const oldW = fs.w, oldH = fs.h;
            const r = rotateBuffer(fs.data, oldW, oldH, angle, Uint16Array);

            // Keep float centered on its current center
            const cx = fs.x + oldW / 2;
            const cy = fs.y + oldH / 2;
            fs.x = Math.round(cx - r.w / 2);
            fs.y = Math.round(cy - r.h / 2);
            fs.w = r.w;
            fs.h = r.h;
            fs.data = r.data;

            if (fs.maskData) {
                fs.maskData = rotateBuffer(fs.maskData, oldW, oldH, angle, Uint8Array).data;
            }
            if (fs.originalData) {
                const ro = rotateBuffer(fs.originalData, fs.originalW, fs.originalH, angle, Uint16Array);
                fs.originalData = ro.data;
                fs.originalW = ro.w;
                fs.originalH = ro.h;
            }
            if (fs.originalMaskData) {
                fs.originalMaskData = rotateBuffer(fs.originalMaskData, fs.originalW || oldW, fs.originalH || oldH, angle, Uint8Array).data;
            }

            if (state.selection) {
                state.selection.x = fs.x;
                state.selection.y = fs.y;
                state.selection.w = fs.w;
                state.selection.h = fs.h;
                if (fs.maskData) state.selection.maskData = new Uint8Array(fs.maskData);
            }
        } else {
            const frame = state.frames[state.currentFrameIdx];
            const layer = findActiveLayer(frame);
            if (!layer || !layer.data) return;
            const sel = state.selection;

            // Lift Always to floating
            const floatingData = new Uint16Array(sel.w * sel.h).fill(TRANSPARENT_COLOR);
            for (let y = 0; y < sel.h; y++) {
                for (let x = 0; x < sel.w; x++) {
                    if (sel.type === 'rect' || (sel.maskData && sel.maskData[y * sel.w + x])) {
                        const lx = sel.x + x, ly = sel.y + y;
                        if (lx >= 0 && lx < layer.width && ly >= 0 && ly < layer.height) {
                            floatingData[y * sel.w + x] = layer.data[ly * layer.width + lx];
                            layer.data[ly * layer.width + lx] = TRANSPARENT_COLOR;
                        }
                    }
                }
            }
            state.floatingSelection = {
                frameIdx: state.currentFrameIdx,
                x: sel.x, y: sel.y, w: sel.w, h: sel.h,
                data: floatingData,
                originalData: new Uint16Array(floatingData),
                originalW: sel.w, originalH: sel.h,
                type: sel.type,
                maskData: sel.maskData ? new Uint8Array(sel.maskData) : null,
                originalMaskData: sel.maskData ? new Uint8Array(sel.maskData) : null,
                targetLayerId: layer.id
            };

            // Now rotate
            const fs = state.floatingSelection;
            const r = rotBuf(fs.data, fs.w, fs.h, Uint16Array);
            const cx2 = fs.x + fs.w / 2;
            const cy2 = fs.y + fs.h / 2;
            fs.x = Math.round(cx2 - r.w / 2);
            fs.y = Math.round(cy2 - r.h / 2);
            fs.w = r.w;
            fs.h = r.h;
            fs.data = r.data;
            if (fs.maskData) fs.maskData = rotBuf(fs.maskData, r.h, r.w, Uint8Array).data;

            const ro = rotBuf(fs.originalData, fs.originalW, fs.originalH, Uint16Array);
            fs.originalData = ro.data;
            fs.originalW = ro.w; fs.originalH = ro.h;
            if (fs.originalMaskData) fs.originalMaskData = rotBuf(fs.originalMaskData, ro.h, ro.w, Uint8Array).data;

            state.selection.x = fs.x; state.selection.y = fs.y; state.selection.w = fs.w; state.selection.h = fs.h;
            if (fs.maskData) state.selection.maskData = new Uint8Array(fs.maskData);

            frame._v = (frame._v || 0) + 1;
        }
    } else if (scope === 'all' && (angle === 90 || angle === -90)) {
        // Structural: swap canvas dimensions and rotate all layers in all frames.
        const newW = h, newH = w;

        // Rotate floating selection BEFORE changing canvas dimensions
        rotateFloatAndSel(true);

        state.canvasW = newW;
        state.canvasH = newH;

        // FIX: Deep clone frames before mutating them to protect previous history snapshots
        // which may contain shallow references to these live objects.
        state.frames = state.frames.map(f => ({
            width: f.width,
            height: f.height,
            duration: f.duration,
            lastSelectedIdx: f.lastSelectedIdx,
            _v: f._v,
            layers: f.layers.map(l => cloneLayerNode(l))
        }));

        state.frames.forEach(frame => {
            if (!frame) return;
            frame.width = newW;
            frame.height = newH;
            walkLayers(frame.layers, layer => {
                if (!layer || !layer.data) return;
                const old = layer.data;
                const next = new Uint16Array(newW * newH).fill(TRANSPARENT_COLOR);
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        let nx, ny;
                        if (angle === 90) { nx = h - 1 - y; ny = x; }
                        else { nx = y; ny = w - 1 - x; }
                        next[ny * newW + nx] = old[y * w + x];
                    }
                }
                layer.data = next;
                layer.width = newW;
                layer.height = newH;
            });
            frame._v = (frame._v || 0) + 1;
        });

        updateCanvasSize();
    } else if (scope === 'layer') {
        const frame = state.frames[state.currentFrameIdx];
        if (frame) {
            const active = findActiveLayer(frame);
            const targets = active ? [active, ...getClippedMasksFor(frame, active)] : [];
            targets.forEach(rotateLayerFull);
            rotateFloatAndSel(false);
            frame._v = (frame._v || 0) + 1;
        }
    } else if (scope === 'frame') {
        const frame = state.frames[state.currentFrameIdx];
        if (frame) {
            walkLayers(frame.layers, rotateLayerFull);
            rotateFloatAndSel(false);
            frame._v = (frame._v || 0) + 1;
        }
    }

    if (scope === 'all') {
        pushHistory('all');
    } else {
        pushHistory(state.currentFrameIdx);
    }

    updateLayersList();
    renderCanvas();
    if (typeof renderOverlay === 'function') renderOverlay();
    renderFramesList();
}

// --- FLATTEN ---

/**
 * Composite a single layer node (or group) into a flat Uint16Array.
 * Used by mergeLayerDown() in ui.js.
 */
export function flattenNode(node, w, h) {
    const result = new Uint16Array(w * h).fill(TRANSPARENT_COLOR);
    function drawNode(n) {
        const children = n.layers || n.children;
        if (n.data) {
            const nx = n.x || 0;
            const ny = n.y || 0;
            const nw = n.width || w;
            const nh = n.height || h;
            for (let ly = 0; ly < nh; ly++) {
                for (let lx = 0; lx < nw; lx++) {
                    const gx = nx + lx;
                    const gy = ny + ly;
                    if (gx >= 0 && gx < w && gy >= 0 && gy < h) {
                        const val = n.data[ly * nw + lx];
                        if (val !== TRANSPARENT_COLOR) result[gy * w + gx] = val;
                    }
                }
            }
        }
        if (children) {
            for (let i = children.length - 1; i >= 0; i--) {
                if (children[i].visible !== false) drawNode(children[i]);
            }
        }
    }
    if (node && node.visible !== false) drawNode(node);
    return result;
}



/**
 * Shifts the color index of pixels by a delta amount.
 * Honors scope (layer, frame, all), amount, and ignoreColor0 settings.
 * Respects active selection area/mask if present.
 */
export function shiftColorIndex(delta) {
    if (!state.frames || !state.frames.length) return;

    const scope = state.toolSettings.colorShiftScope || 'layer';
    const ignore0 = state.toolSettings.ignoreColor0 || false;
    const cyclePalette = state.toolSettings.cycleShiftPalette || false;
    let anyModified = false;

    // Palette Filter / Cycle logic initialization
    const colorFilterSet = (state.paletteSelection && state.paletteSelection.size > 1) ? state.paletteSelection : null;
    let colorFilterList = null;
    if (colorFilterSet && cyclePalette) {
        colorFilterList = Array.from(colorFilterSet).sort((a, b) => a - b);
    }

    const getShiftedIndex = (idx) => {
        if (colorFilterList && cyclePalette) {
            const curPos = colorFilterList.indexOf(idx);
            if (curPos === -1) return idx;
            // Clamped behavior: shift within the selected list indices
            let newPos = Math.max(0, Math.min(colorFilterList.length - 1, curPos + delta));
            return colorFilterList[newPos];
        }
        return Math.max(0, Math.min(255, idx + delta));
    };

    console.log(`[ColorShift] Execution started. Delta: ${delta}, Scope: ${scope}, Ignore0: ${ignore0}`);
    if (state.selection) {
        console.log(`[ColorShift] Active Selection detected: Type=${state.selection.type}, Pos=(${state.selection.x}, ${state.selection.y}), Size=${state.selection.w}x${state.selection.h}`);
    }
    if (colorFilterSet) {
        console.log(`[ColorShift] Palette filter active (${colorFilterSet.size} colors). Limit: ${cyclePalette}`);
    }

    let framesToProcess = [];
    if (scope === 'all') {
        framesToProcess = state.frames.map((_, i) => i);
    } else {
        framesToProcess = [state.currentFrameIdx];
    }

    framesToProcess.forEach(fIdx => {
        const frame = state.frames[fIdx];
        if (!frame) return;

        let frameModified = false;

        // 1. Handle Floating Selection (Current Frame only)
        // If it exists, we shift it regardless of which layer is active, 
        // as the user is actively working on these pixels.
        if (state.floatingSelection && fIdx === state.currentFrameIdx) {
            const fs = state.floatingSelection;
            let fsModified = false;
            for (let i = 0; i < fs.data.length; i++) {
                let idx = fs.data[i];
                if (idx === TRANSPARENT_COLOR) continue;
                if (ignore0 && idx === 0) continue;
                if (colorFilterSet && !colorFilterSet.has(idx)) continue;

                const oldIdx = idx;
                const newIdx = getShiftedIndex(oldIdx);
                if (newIdx !== oldIdx) {
                    fs.data[i] = newIdx;
                    fsModified = true;
                }
            }
            if (fsModified) {
                frameModified = true;
                console.log(`[ColorShift] Floating selection pixels modified in frame ${fIdx}`);
            }
        }

        // 2. Identify Layers to process
        let layersToProcess = [];
        if (scope === 'layer') {
            const activeLayer = getActiveLayer();
            if (activeLayer) {
                // Find matching layer by ID in this frame
                const l = frame.layers.find(ly => ly.id === activeLayer.id);
                if (l) layersToProcess = [l];
            }
        } else {
            // frame or all
            const collectLayers = (nodes) => {
                nodes.forEach(n => {
                    if (n.type === 'layer' && n.data) layersToProcess.push(n);
                    if (n.children) collectLayers(n.children);
                });
            };
            collectLayers(frame.layers);
        }

        // 3. Process Layers
        layersToProcess.forEach(layer => {
            if (!layer.data) return;

            let top, bottom, left, right, maskData, selW, selH;
            const hasSelection = !!state.selection;

            if (hasSelection) {
                const sel = state.selection;
                left = sel.x;
                top = sel.y;
                right = sel.x + sel.w - 1;
                bottom = sel.y + sel.h - 1;
                maskData = sel.maskData;
                selW = sel.w;
                selH = sel.h;
            } else {
                left = 0;
                top = 0;
                right = layer.width - 1;
                bottom = layer.height - 1;
                maskData = null;
            }

            const xStart = Math.max(0, left);
            const xEnd = Math.min(layer.width - 1, right);
            const yStart = Math.max(0, top);
            const yEnd = Math.min(layer.height - 1, bottom);

            let layerModified = false;
            for (let y = yStart; y <= yEnd; y++) {
                for (let x = xStart; x <= xEnd; x++) {
                    // Selection Mask Check
                    if (maskData) {
                        const mx = x - left;
                        const my = y - top;
                        if (!maskData[my * selW + mx]) continue;
                    }

                    const offset = y * layer.width + x;
                    let idx = layer.data[offset];
                    if (idx === TRANSPARENT_COLOR) continue;
                    if (ignore0 && idx === 0) continue;
                    if (colorFilterSet && !colorFilterSet.has(idx)) continue;

                    const oldIdx = idx;
                    const newIdx = getShiftedIndex(oldIdx);
                    if (newIdx !== oldIdx) {
                        layer.data[offset] = newIdx;
                        layerModified = true;
                        frameModified = true;
                    }
                }
            }
            if (layerModified) {
                console.log(`[ColorShift] Layer "${layer.name}" (ID: ${layer.id}) modified in frame ${fIdx}`);
            }
        });

        if (frameModified) {
            frame._v = (frame._v || 0) + 1;
            anyModified = true;
        }
    });

    if (anyModified) {
        console.log("[ColorShift] Modification detected, pushing history...");
        const pushResult = scope === 'all' ? 'all' : [state.currentFrameIdx];
        pushHistory(pushResult);
        renderCanvas();
        renderFramesList();
        console.log(`[ColorShift] Success: Operation complete. Index shifted by ${delta}`);
    } else {
        console.log("[ColorShift] No pixels modified. Possible reasons: empty layer, ignore0=true on index 0 pixels, or out of bounds selection.");
    }
}
