import { state, TRANSPARENT_COLOR } from './state.js';
import { ShpFormat80 } from './shp_format.js';
import { TmpTsFile } from './tmp_format.js';
import { getCurrentEditedTiles } from './file_io.js';
import { PcxLoader } from './pcx_loader.js';
import { t } from './translations.js';


/**
 * Generic helper to export a given list of frames as a SHP file.
 */
export async function exportFrameList(filename, frames, compression, existingHandle = null) {
    try {
        const flatImages = frames.map(f => {
            const composite = new Uint8Array(f.width * f.height).fill(0);

            function compositeNode(node) {
                if (!node.visible || node.type === 'external_shp') return;

                if (node.children) {
                    // Visit children in reverse (Bottom first)
                    for (let i = node.children.length - 1; i >= 0; i--) {
                        compositeNode(node.children[i]);
                    }
                } else if (node.data) {
                    // Composite Layer
                    for (let k = 0; k < composite.length; k++) {
                        if (node.mask && node.mask[k] === 0) continue;
                        const val = node.data[k];
                        if (val !== TRANSPARENT_COLOR) composite[k] = val;
                    }
                }
            }

            // Start from Bottom of Root
            for (let i = f.layers.length - 1; i >= 0; i--) {
                compositeNode(f.layers[i]);
            }

            return { width: f.width, height: f.height, indices: composite };
        });

        const transparentMapping = state.isAlphaImageMode ? 127 : 0;
        const buf = ShpFormat80.encode(flatImages, true, compression, transparentMapping);
        const handle = await downloadFile(filename, buf, existingHandle);
        return handle;
    } catch (err) {
        alert("Error exporting SHP: " + err.message);
        console.error(err);
        return null;
    }
}

async function downloadFile(name, u8Array, existingHandle = null) {
    if (window.showSaveFilePicker) {
        let handle = existingHandle;
        try {
            if (!handle) {
                handle = await window.showSaveFilePicker({
                    suggestedName: name,
                    types: [
                        {
                            description: 'SHP File (Standard)',
                            accept: { 'application/x-shp': ['.shp'] },
                        },
                        {
                            description: 'SHA File (Mouse Cursor)',
                            accept: { 'application/x-sha': ['.sha'] },
                        },
                    ],
                });
            }
            const writable = await handle.createWritable();
            const blob = new Blob([u8Array], { type: "application/octet-stream" });
            await writable.write(blob);
            await writable.close();
            return handle;
        } catch (err) {
            if (err.name === 'AbortError') {
                return null; // User cancelled — do nothing
            }
            console.error('showSaveFilePicker write failed:', err);
            alert('Save failed: ' + (err.message || err));
            return null;
        }
    }

    // Fallback for browsers that do not support showSaveFilePicker (e.g. Firefox)
    const blob = new Blob([u8Array], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return null; // Indicate no handle was created
}

/**
 * Helper to generate a canvas and indexed data from the current TMP tile structure.
 */
export async function generateExportDataFromTiles(mode) {
    try {
        const tiles = getCurrentEditedTiles();
        if (!tiles) return null;

        const isZMode = mode.includes('z');
        const gameType = state.tmpHeader.cx === 48 ? 'ts' : 'ra2';
        const baseW = gameType === 'ts' ? 48 : 60;
        const baseH = gameType === 'ts' ? 24 : 30;

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        let workSet = [];

        workSet = tiles.map((_, i) => i).filter(idx => tiles[idx] && tiles[idx].tileHeader);

        const halfCy = state.tmpHeader.cy / 2;
        for (const idx of workSet) {
            const tTile = tiles[idx];
            const elevation = tTile.tileHeader.height * halfCy;
            const includeBase = mode.includes('merged') || mode.includes('cell') || mode.includes('total');
            const includeExtra = mode.includes('merged') || mode.includes('extra') || mode.includes('total');

            if (includeBase) {
                minX = Math.min(minX, tTile.tileHeader.x);
                minY = Math.min(minY, tTile.tileHeader.y - elevation);
                maxX = Math.max(maxX, tTile.tileHeader.x + baseW);
                maxY = Math.max(maxY, tTile.tileHeader.y - elevation + baseH);
            }
            if (includeExtra && tTile.tileHeader.has_extra_data) {
                const drawImg = mode.includes('extra') || mode.includes('merged') || mode.includes('total');
                const drawZ = mode.includes('extra') || mode.includes('merged') || mode.includes('total');

                let ew = 0, eh = 0;
                if (drawImg && tTile.extraImageData) {
                    ew = Math.max(ew, tTile._extraImg_cx || tTile.tileHeader.cx_extra || 0);
                    eh = Math.max(eh, tTile._extraImg_cy || tTile.tileHeader.cy_extra || 0);
                }
                if (drawZ && tTile.extraZData) {
                    ew = Math.max(ew, tTile._extraZ_cx || tTile.tileHeader.cx_extra || 0);
                    eh = Math.max(eh, tTile._extraZ_cy || tTile.tileHeader.cy_extra || 0);
                }

                // Fallback to shared header if no buffers exist but data is flagged
                if (ew === 0 && eh === 0) {
                    ew = tTile.tileHeader.cx_extra;
                    eh = tTile.tileHeader.cy_extra;
                }

                minX = Math.min(minX, tTile.tileHeader.x_extra);
                minY = Math.min(minY, tTile.tileHeader.y_extra - elevation);
                maxX = Math.max(maxX, tTile.tileHeader.x_extra + ew);
                maxY = Math.max(maxY, tTile.tileHeader.y_extra - elevation + eh);
            }
        }

        const totalW = (minX === Infinity) ? 0 : maxX - minX;
        const totalH = (minY === Infinity) ? 0 : maxY - minY;

        if (minX === Infinity || totalW <= 0 || totalH <= 0) {
            alert(t('msg_no_tiles_export') || 'No tiles to export');
            return null;
        }

        const canvas = document.createElement('canvas');
        canvas.width = totalW;
        canvas.height = totalH;
        const ctx = canvas.getContext('2d');
        const indexedIndices = new Uint8Array(totalW * totalH).fill(255);

        const currentPalette = state.palette;
        if (!currentPalette && !isZMode) {
            alert(t('msg_no_pal_export') || 'No palette selected for export');
            return null;
        }

        const palLUT = new Uint32Array(256);
        if (currentPalette) {
            for (let i = 0; i < 256; i++) {
                const c = currentPalette[i] || { r: 0, g: 0, b: 0 };
                palLUT[i] = (255 << 24) | (c.b << 16) | (c.g << 8) | c.r;
            }
        }

        const zLUT = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            if (i < 32) {
                const gray = Math.round((i * 255) / 31);
                zLUT[i] = (255 << 24) | (gray << 16) | (gray << 8) | gray;
            } else {
                zLUT[i] = (255 << 24) | (0 << 16) | (0 << 8) | 255;
            }
        }

        const zValidMask = isZMode ? new Uint8Array(totalW * totalH) : null;
        const bgIdx = 0;

        const drawLayer = (buffer, lx, ly, bw, bh, isZ, isBase) => {
            if (!buffer) return;
            const temp = document.createElement('canvas');
            temp.width = bw;
            temp.height = bh;
            const tempCtx = temp.getContext('2d');
            const imgData = tempCtx.createImageData(bw, bh);
            const d32 = new Uint32Array(imgData.data.buffer);
            const lut = isZ ? zLUT : palLUT;

            const startX = Math.round(lx - minX);
            const startY = Math.round(ly - minY);
            
            if (isBase) {
                // Rhomboid diamond-packed tile decoding
                let rd = 0;
                let xO = bw / 2;
                let cR = 0;
                const halfCy = bh / 2;
                for (let y = 0; y < bh; y++) {
                    if (y < halfCy) { cR += 4; xO -= 2; } else { cR -= 4; xO += 2; }
                    if (cR <= 0) continue;
                    for (let j = 0; j < cR; j++) {
                        const px = (buffer && (rd + j) < buffer.length) ? buffer[rd + j] : 0;
                        if (isZ) {
                            if (px >= 32) continue; // Z-Data is 0-31
                        } else {
                            if (px === 0) continue; 
                        }

                        const localX = Math.floor(xO + j);
                        const localY = y;
                        if (localX >= 0 && localX < bw && localY >= 0 && localY < bh) {
                            const localIdx = localY * bw + localX;
                            d32[localIdx] = lut[px & 0xFF];

                            const destX = startX + localX;
                            const destY = startY + localY;
                            if (destX >= 0 && destX < totalW && destY >= 0 && destY < totalH) {
                                const destIdx = destY * totalW + destX;
                                indexedIndices[destIdx] = px;
                                if (isZ && px < 32 && zValidMask) zValidMask[destIdx] = 1;
                            }
                        }
                    }
                    rd += cR;
                }
            } else {
                // Flat rectangular draw (for extra data)
                const area = bw * bh;
                for (let i = 0; i < area; i++) {
                    const localX = i % bw;
                    const localY = Math.floor(i / bw);
                    
                    let px = (buffer && i < buffer.length) ? buffer[i] : (isZ ? 0 : bgIdx);
                    
                    if (isZ) {
                        if (px >= 32) continue; // Z-Data is 0-31. 255 is transparent.
                        if (px === 0) continue; // Extra Data treats 0 as void
                    } else {
                        if (px === 0) continue; 
                    }

                    d32[i] = lut[px & 0xFF];
                    
                    const destX = startX + localX;
                    const destY = startY + localY;
                    const destIdx = destY * totalW + destX;
                    if (destX >= 0 && destX < totalW && destY >= 0 && destY < totalH) {
                        indexedIndices[destIdx] = px;
                        if (isZ && px < 32 && zValidMask) zValidMask[destIdx] = 1;
                    }
                }
            }
            tempCtx.putImageData(imgData, 0, 0);
            ctx.drawImage(temp, startX, startY);
        };

        for (const idx of workSet) {
            const tTile = tiles[idx];
            const elevation = tTile.tileHeader.height * halfCy;
            
            const drawBaseImg = mode === 'img_cell' || mode === 'img_merged' || mode === 'img_total';
            const drawBaseZ = mode === 'z_cell' || mode === 'z_merged' || mode === 'z_total';

            if (drawBaseImg) {
                drawLayer(tTile.data, tTile.tileHeader.x, tTile.tileHeader.y - elevation, baseW, baseH, false, true);
            }
            if (drawBaseZ) {
                drawLayer(tTile.zData, tTile.tileHeader.x, tTile.tileHeader.y - elevation, baseW, baseH, true, true);
            }

            if (tTile.tileHeader.has_extra_data) {
                const drawExtraImg = mode === 'img_extra' || mode === 'img_merged' || mode === 'img_total';
                const drawExtraZ = mode === 'z_extra' || mode === 'z_merged' || mode === 'z_total';

                if (drawExtraImg && tTile.extraImageData) {
                    const eCx = tTile._extraImg_cx || tTile.tileHeader.cx_extra;
                    const eCy = tTile._extraImg_cy || tTile.tileHeader.cy_extra;
                    drawLayer(tTile.extraImageData, tTile.tileHeader.x_extra, tTile.tileHeader.y_extra - elevation, eCx, eCy, false, false);
                }
                if (drawExtraZ && tTile.extraZData) {
                    const zCx = tTile._extraZ_cx || tTile.tileHeader.cx_extra;
                    const zCy = tTile._extraZ_cy || tTile.tileHeader.cy_extra;
                    drawLayer(tTile.extraZData, tTile.tileHeader.x_extra, tTile.tileHeader.y_extra - elevation, zCx, zCy, true, false);
                }
            }
        }

        if (isZMode) {
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, totalW, totalH);
            ctx.globalCompositeOperation = 'source-over';
        } else if (state.showBackground) {
            const bg = currentPalette[0] || { r: 0, g: 0, b: 255 };
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = `rgb(${bg.r},${bg.g},${bg.b})`;
            ctx.fillRect(0, 0, totalW, totalH);
            ctx.globalCompositeOperation = 'source-over';
        }

        return { canvas, indices: indexedIndices, width: totalW, height: totalH };
    } catch (err) {
        console.error("Export data generation failed:", err);
        alert((t('msg_err_export') || "Export error: {{error}}").replace('{{error}}', err.message));
        return null;
    }
}

/**
 * Saves the selected tiles or whole project to a file (TMP mode)
 */
export async function saveTmpSelectedTilesToFile(mode) {
    try {
        const data = await generateExportDataFromTiles(mode);
        if (!data) return;

        const isZ = mode.includes('z');
        const defaultName = isZ ? "z_mask.png" : "image.png";

        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: defaultName,
                    types: [
                        { description: 'PNG Image', accept: { 'image/png': ['.png'] } },
                        { description: 'PCX Image', accept: { 'image/x-pcx': ['.pcx'] } },
                        { description: 'JPEG Image', accept: { 'image/jpeg': ['.jpg'] } },
                        { description: 'BMP Image', accept: { 'image/bmp': ['.bmp'] } }
                    ]
                });
                
                const writable = await handle.createWritable();
                const filename = handle.name.toLowerCase();
                
                if (filename.endsWith('.pcx')) {
                    const currentPalette = state.palette;
                    const pcxBuffer = PcxLoader.encode(data.width, data.height, data.indices, currentPalette);
                    await writable.write(new Blob([pcxBuffer], { type: 'image/x-pcx' }));
                } else {
                    const fileType = filename.endsWith('.jpg') ? 'image/jpeg' : 
                                   filename.endsWith('.bmp') ? 'image/bmp' : 'image/png';
                    const blob = await new Promise(resolve => data.canvas.toBlob(resolve, fileType));
                    await writable.write(blob);
                }
                
                await writable.close();
                console.log(`Saved ${mode} to file ${handle.name}`);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error("Save File Picker failed:", err);
                    throw err;
                }
            }
        } else {
            // Fallback for Firefox/Safari: Browser Download
            const link = document.createElement('a');
            link.download = defaultName;
            link.href = data.canvas.toDataURL('image/png');
            link.click();
        }
    } catch (err) {
        console.error("Save failed:", err);
        alert((t('msg_err_export') || "Export error: {{error}}").replace('{{error}}', err.message));
    }
}


