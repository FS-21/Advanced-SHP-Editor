/**
 * TMP Format Parser/Encoder for TS/RA2
 * Based on XCC TMP Editor specifications.
 */

export class TmpTsFile {
    // Parse TMP file from ArrayBuffer
    static parse(buffer) {
        const dv = new DataView(buffer);
        const u8 = new Uint8Array(buffer);
        
        // Read Global Header (16 bytes)
        const header = {
            cblocks_x: dv.getInt32(0, true),   // Grid columns
            cblocks_y: dv.getInt32(4, true),   // Grid rows
            cx: dv.getInt32(8, true),          // Tile width (60 or 48)
            cy: dv.getInt32(12, true)          // Tile height (30 or 24)
        };
        
        const numTiles = header.cblocks_x * header.cblocks_y;
        const tileIndexOffset = 16;
        
        // Read tile index (array of offsets)
        const tileIndex = [];
        for (let i = 0; i < numTiles; i++) {
            const offset = dv.getInt32(tileIndexOffset + i * 4, true);
            tileIndex.push(offset);
        }
        
        console.group(`[TMP Parser] Parsing: ${header.cblocks_x}x${header.cblocks_y} (${numTiles} tiles)`);
        console.table({
            "Blocks X": header.cblocks_x,
            "Blocks Y": header.cblocks_y,
            "Tile Width (cx)": header.cx,
            "Tile Height (cy)": header.cy
        });

        // Parse each tile
        const tiles = [];
        for (let i = 0; i < numTiles; i++) {
            if (tileIndex[i] === 0) {
                tiles.push(null);
            } else {
                const tileOffset = tileIndex[i];
                const tileData = TmpTsFile.parseTile(u8, dv, tileOffset, header.cx, header.cy, i);
                tiles.push(tileData);
            }
        }
        console.groupEnd();
        
        return {
            header,
            tiles,
            numTiles
        };
    }
    
    // Parse individual tile at given offset
    static parseTile(u8, dv, offset, cx, cy, slot) {
        const diamondSize = (cx * cy) / 2;
        
        const imageHeader = {
            x: dv.getInt32(offset, true),
            y: dv.getInt32(offset + 4, true),
            extra_ofs: dv.getInt32(offset + 8, true),
            z_ofs: dv.getInt32(offset + 12, true),
            extra_z_ofs: dv.getInt32(offset + 16, true),
            x_extra: dv.getInt32(offset + 20, true),
            y_extra: dv.getInt32(offset + 24, true),
            cx_extra: dv.getInt32(offset + 28, true),
            cy_extra: dv.getInt32(offset + 32, true)
        };
        
        // Based on analysis and user report:
        // 36: Flags (uint8) - bit 0=Extra, bit 1=Z, bit 3=Transparent
        // 37: Height (int8) - Actual elevation
        // 38-39: Padding or potentially high bytes of height (but many files use byte only)
        // 40: Terrain Type (uint8)
        // 41: Ramp Type (uint8)
        
        // Corrected offsets for TS/RA2 TMP tile header (Format 80):
        // 36: Flags (uint32 usually, but we read byte 36)
        // 40: Height (int8) 
        // 41: Land Type (uint8)
        // 42: Ramp Type (uint8) 
        // 43-48: Radar Colors (6 bytes)
        
        imageHeader.flags = dv.getUint8(offset + 36);
        imageHeader.height = dv.getInt8(offset + 40);
        imageHeader.land_type = dv.getUint8(offset + 41);
        imageHeader.ramp_type = dv.getUint8(offset + 42);
        
        imageHeader.has_extra_data = (imageHeader.flags & 0x01) !== 0;
        imageHeader.has_z_data = (imageHeader.flags & 0x02) !== 0;
        imageHeader.has_damaged_data = (imageHeader.flags & 0x04) !== 0;
        imageHeader.is_fully_transparent = (imageHeader.flags & 0x08) !== 0;

        // Radar colors start at 42 (3 bytes each)
        // Radar colors start at 43 (3 bytes each)
        imageHeader.radar_red_left = dv.getUint8(offset + 43);
        imageHeader.radar_green_left = dv.getUint8(offset + 44);
        imageHeader.radar_blue_left = dv.getUint8(offset + 45);
        imageHeader.radar_red_right = dv.getUint8(offset + 46);
        imageHeader.radar_green_right = dv.getUint8(offset + 47);
        imageHeader.radar_blue_right = dv.getUint8(offset + 48);
        
        const dataOffset = offset + 52; 
        const imageData = new Uint8Array(u8.slice(dataOffset, dataOffset + diamondSize));
        
        let zData = null;
        let extraImageData = null;
        let extraZData = null;
        let damagedData = null;
        
        let currentEnd = dataOffset + diamondSize;

        if (imageHeader.has_z_data) {
            const zStart = imageHeader.z_ofs > 0 ? offset + imageHeader.z_ofs : currentEnd;
            zData = new Uint8Array(u8.slice(zStart, zStart + diamondSize));
            if (imageHeader.z_ofs === 0) currentEnd += diamondSize;
        }

        if (imageHeader.has_damaged_data) {
            damagedData = new Uint8Array(u8.slice(currentEnd, currentEnd + diamondSize));
            currentEnd += diamondSize;
        }
        
        if (imageHeader.has_extra_data) {
            const extraSize = imageHeader.cx_extra * imageHeader.cy_extra;
            if (extraSize > 1) {
                const extraStart = imageHeader.extra_ofs > 0 ? offset + imageHeader.extra_ofs : currentEnd;
                extraImageData = new Uint8Array(u8.slice(extraStart, extraStart + extraSize));
                if (imageHeader.extra_ofs === 0) currentEnd += extraSize;
                
                if (imageHeader.has_z_data) {
                    const extraZStart = imageHeader.extra_z_ofs > 0 ? offset + imageHeader.extra_z_ofs : currentEnd;
                    extraZData = new Uint8Array(u8.slice(extraZStart, extraZStart + extraSize));
                    if (imageHeader.extra_z_ofs === 0) currentEnd += extraSize;
                }
            }
        }

        if (slot < 10) {
            console.log(`[TMP] Tile[${slot}]: X=${imageHeader.x}, Y=${imageHeader.y}, H=${imageHeader.height}, Ter=${imageHeader.land_type}, Ramp=${imageHeader.ramp_type}, Flags=0x${imageHeader.flags.toString(16)}`);
        }
        
        return {
            slot,
            tileHeader: imageHeader,
            _extraImg_cx: imageHeader.cx_extra,
            _extraImg_cy: imageHeader.cy_extra,
            _extraZ_cx: imageHeader.cx_extra,
            _extraZ_cy: imageHeader.cy_extra,
            data: imageData,      
            zData: zData,          
            extraImageData, 
            extraZData,
            damagedData,
            cx,
            cy
        };
    }

    static generateDefaultZData(cx, cy) {
        const rect = new Uint8Array(cx * cy).fill(0);
        for (let y = 0; y < cy; y++) {
            const val = Math.round(31 * (1 - (y / (cy - 1))));
            for (let x = 0; x < cx; x++) {
                rect[y * cx + x] = val;
            }
        }
        return TmpTsFile.encodeTileRectangle(rect, cx, cy);
    }

    static isInsideWestwoodDiamond(lx, ly, cx, cy) {
        const halfW = Math.floor(cx / 2);
        const halfH = Math.floor(cy / 2);
        let ry;
        if (ly < halfH) ry = ly;
        else ry = cy - 1 - ly - 1;
        if (ry < 0) return false;

        const xOffset = halfW - (ry + 1) * 2;
        const cxRow = (ry + 1) * 4;
        return (lx >= xOffset && lx < (xOffset + cxRow));
    }

    static decodeTileDiamond(diamondData, cx, cy, fillValue = 0) {
        const rect = new Uint8Array(cx * cy);
        if (fillValue !== 0) rect.fill(fillValue);
        let readIdx = 0;
        let x = cx / 2;
        let cx_row = 0;
        for (let y = 0; y < cy / 2; y++) {
            cx_row += 4; x -= 2;
            for (let i = 0; i < cx_row; i++) rect[(y * cx) + (x + i)] = diamondData[readIdx++];
        }
        for (let y = cy / 2; y < cy; y++) {
            cx_row -= 4; x += 2;
            for (let i = 0; i < cx_row; i++) rect[(y * cx) + (x + i)] = diamondData[readIdx++];
        }
        return rect;
    }

    static encodeTileRectangle(rectData, cx, cy) {
        const diamondSize = (cx * cy) / 2;
        const diamond = new Uint8Array(diamondSize);
        let writeIdx = 0;
        let x = cx / 2;
        let cx_row = 0;
        for (let y = 0; y < cy / 2; y++) {
            cx_row += 4; x -= 2;
            for (let i = 0; i < cx_row; i++) diamond[writeIdx++] = rectData[(y * cx) + (x + i)];
        }
        for (let y = cy / 2; y < cy; y++) {
            cx_row -= 4; x += 2;
            for (let i = 0; i < cx_row; i++) diamond[writeIdx++] = rectData[(y * cx) + (x + i)];
        }
        return diamond;
    }

    static encode(tmpData) {
        const { header, tiles } = tmpData;
        const numTiles = header.cblocks_x * header.cblocks_y;
        console.group(`[TMP Encoder] Encoding ${header.cblocks_x}x${header.cblocks_y} (${numTiles} tiles)`);
        
        // Validation
        if (!(header.cx === 48 && header.cy === 24) && !(header.cx === 60 && header.cy === 30)) {
            console.warn(`[TMP Encoder] NON-STANDARD: ${header.cx}x${header.cy}. Potential XCC crash.`);
        }
        
        if (numTiles <= 0) {
            console.error("[TMP Encoder] Invalid dimensions: 0x0");
            console.groupEnd();
            throw new Error("Invalid grid dimensions (0x0).");
        }
        
        const indexSize = numTiles * 4;
        const globalHeaderSize = 16;
        let currentOffset = globalHeaderSize + indexSize;
        const tileBuffers = [];
        const indexTable = new Int32Array(numTiles);
        const halfCx = header.cx / 2;
        const halfCy = header.cy / 2;
        const cbDiamond = (header.cx * header.cy) / 2; // Global source of truth

        console.log(`[TMP Encoder] Global Diamond Size: ${cbDiamond} bytes`);

        let encodedCount = 0;
        for (let i = 0; i < numTiles; i++) {
            const tile = tiles[i];
            if (!tile) { indexTable[i] = 0; continue; }

            const tileHeader = { ...tile.tileHeader };
            
            // 🚨 XCC Compatibility: Use ACTUAL coordinates from the tile, NOT the grid index!
            if (tileHeader.x === undefined || tileHeader.y === undefined) {
                const gx = i % header.cblocks_x;
                const gy = Math.floor(i / header.cblocks_x);
                tileHeader.x = halfCx * (gx - gy);
                tileHeader.y = halfCy * (gx + gy);
            }

            const tilePayloadSize = 52 + cbDiamond + 
                                   (tileHeader.has_z_data ? cbDiamond : 0) + 
                                   ((tile.damagedData && (tileHeader.flags & 0x04)) ? cbDiamond : 0) + 
                                   ((tileHeader.has_extra_data && tile.extraImageData) ? (tileHeader.cx_extra * tileHeader.cy_extra) : 0) +
                                   ((tileHeader.has_extra_data && tile.extraImageData && tileHeader.has_z_data && tile.extraZData) ? (tileHeader.cx_extra * tileHeader.cy_extra) : 0);
            
            const tileBuf = new ArrayBuffer(tilePayloadSize);
            const dv = new DataView(tileBuf);
            const u8 = new Uint8Array(tileBuf);
            
            dv.setInt32(0, tileHeader.x || 0, true);
            dv.setInt32(4, tileHeader.y || 0, true);
            
            // 🚨 Write Extra Metadata at offsets 20, 24, 28, 32
            if (tileHeader.has_extra_data) {
                dv.setInt32(20, tileHeader.x_extra || 0, true);
                dv.setInt32(24, tileHeader.y_extra || 0, true);
                dv.setInt32(28, tileHeader.cx_extra || 0, true);
                dv.setInt32(32, tileHeader.cy_extra || 0, true);
            }

            // Main Image Data
            if (tile.data) u8.set(tile.data, 52);
            
            let cursor = 52 + cbDiamond;
            
            // Z-Data
            if (tileHeader.has_z_data && tile.zData) { 
                dv.setInt32(12, cursor, true); 
                u8.set(tile.zData, cursor); 
                cursor += cbDiamond; 
            }
            
            // Damaged Data
            if (tile.damagedData && (tileHeader.flags & 0x04)) { 
                u8.set(tile.damagedData, cursor); 
                cursor += cbDiamond; 
            }
            
            // Extra Data
            const cbExtraSize = (tileHeader.cx_extra || 0) * (tileHeader.cy_extra || 0);
            if (tileHeader.has_extra_data && tile.extraImageData && cbExtraSize > 0) {
                dv.setInt32(8, cursor, true); 
                u8.set(tile.extraImageData, cursor); 
                cursor += cbExtraSize;
                
                // Extra Z-Data
                if (tileHeader.has_z_data && tile.extraZData) { 
                    dv.setInt32(16, cursor, true); 
                    u8.set(tile.extraZData, cursor); 
                    cursor += cbExtraSize; 
                }
            }
            
            // Header Attributes
            dv.setUint32(36, tileHeader.flags || 0, true); // Write as 32-bit flags
            dv.setInt8(40, tileHeader.height || 0);
            dv.setUint8(41, tileHeader.land_type || 0);
            dv.setUint8(42, tileHeader.ramp_type || 0);
            dv.setUint8(43, tileHeader.radar_red_left || 0);
            dv.setUint8(44, tileHeader.radar_green_left || 0);
            dv.setUint8(45, tileHeader.radar_blue_left || 0);
            dv.setUint8(46, tileHeader.radar_red_right || 0);
            dv.setUint8(47, tileHeader.radar_green_right || 0);
            dv.setUint8(48, tileHeader.radar_blue_right || 0);
            
            indexTable[i] = currentOffset;
            tileBuffers.push(new Uint8Array(tileBuf));
            currentOffset += tilePayloadSize;
            encodedCount++;
        }
        
        const finalBuffer = new ArrayBuffer(currentOffset);
        const finalDv = new DataView(finalBuffer);
        const finalU8 = new Uint8Array(finalBuffer);
        
        finalDv.setInt32(0, header.cblocks_x, true);
        finalDv.setInt32(4, header.cblocks_y, true);
        finalDv.setInt32(8, header.cx, true);
        finalDv.setInt32(12, header.cy, true);
        for (let i = 0; i < numTiles; i++) finalDv.setInt32(16 + i * 4, indexTable[i], true);
        
        let writePtr = globalHeaderSize + indexSize;
        for (const buf of tileBuffers) { finalU8.set(buf, writePtr); writePtr += buf.length; }
        
        console.log(`[TMP Encoder] Finished: ${encodedCount} tiles. ${currentOffset} bytes.`);
        console.groupEnd();
        return finalBuffer;
    }

    static computeBounds(tmpData) {
        const { header, tiles } = tmpData;
        const halfCy = header.cy / 2;
        const mult = halfCy; // 15px for RA2, 12px for TS
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, found = false;

        for (const tile of tiles) {
            if (!tile) continue;
            found = true;
            const h = tile.tileHeader || tile.header;
            if (!h) continue;
            const vx = h.x;
            const vy = h.y - h.height * mult;
            minX = Math.min(minX, vx); minY = Math.min(minY, vy);
            maxX = Math.max(maxX, vx + header.cx); maxY = Math.max(maxY, vy + header.cy);
            if (h.has_extra_data && h.cx_extra > 0 && h.cy_extra > 0) {
                const evx = h.x_extra;
                const evy = h.y_extra - (h.height || 0) * mult;
                minX = Math.min(minX, evx); minY = Math.min(minY, evy);
                maxX = Math.max(maxX, evx + h.cx_extra); maxY = Math.max(maxY, evy + h.cy_extra);
            }
        }
        if (!found) {
            console.warn("[TMP] computeBounds: No valid tiles found.");
            return { minX: 0, minY: 0, width: 1, height: 1, hasTiles: false };
        }
        console.log(`[TMP] computeBounds: Calculated bounds: X=${minX}, Y=${minY}, W=${maxX - minX}, H=${maxY - minY}`);
        return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, hasTiles: true };
    }


    static composeToCanvas(tmpData, palette, showBackground = true) {
        const numTiles = tmpData.numTiles !== undefined ? tmpData.numTiles : (tmpData.tiles ? tmpData.tiles.length : 0);
        console.log(`[TMP] composeToCanvas: Processing ${numTiles} tiles. Palette size: ${palette ? palette.length : 'null'}`);
        const bounds = TmpTsFile.computeBounds(tmpData);
        if (!bounds.hasTiles) {
            console.warn("[TMP] composeToCanvas: No tiles found in computeBounds. Bounds:", bounds);
            return { canvas: null, bounds, indices: null };
        }
        
        const canvas = document.createElement('canvas');
        const w = Math.ceil(bounds.width);
        const h = Math.ceil(bounds.height);
        
        console.log(`[TMP] composeToCanvas: Canvas size ${w}x${h} for ${numTiles} tiles.`);

        // Safety check for extreme sizes
        if (w <= 0 || h <= 0 || w > 32768 || h > 32768) {
            console.error(`[TMP] composeToCanvas: Invalid or extreme canvas size: ${w}x${h}`);
            return { canvas: null, bounds, indices: null };
        }

        canvas.width = w; 
        canvas.height = h;
        
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(w, h);
        const d = img.data;
        const rectIndices = new Uint16Array(w * h); // Initialized with 0 (transparent/background)

        // Background Fill (Index 0 of palette)
        // Ensure index 0 is used for background if available, otherwise black
        if (showBackground) {
            const bg = (palette && palette[0]) ? palette[0] : { r: 0, g: 0, b: 0 };
            for (let i = 0; i < d.length; i += 4) {
                d[i] = bg.r; d[i+1] = bg.g; d[i+2] = bg.b; d[i+3] = 255;
            }
        }

        const halfCy = tmpData.header.cy / 2;
        const mult = halfCy;

        for (let i = 0; i < numTiles; i++) {
            const tile = tmpData.tiles[i];
            if (!tile) continue;
            const h = tile.tileHeader || tile.header;
            if (!h) continue;
            const lx = h.x - bounds.minX;
            const ly = (h.y - h.height * mult) - bounds.minY;
            let rd = 0, xO = tmpData.header.cx / 2, cR = 0;
            for (let y = 0; y < tmpData.header.cy; y++) {
                if (y < halfCy) { cR += 4; xO -= 2; } else { cR -= 4; xO += 2; }
                if (cR <= 0) continue;
                const py = Math.floor(ly + y);
                if (py >= 0 && py < canvas.height) {
                    for (let j = 0; j < cR; j++) {
                        const pI = tile.data ? tile.data[rd + j] : (tile.imageData ? tile.imageData[rd + j] : 0);
                        if (pI !== 0) {
                            const px = Math.floor(lx + xO + j);
                            if (px >= 0 && px < canvas.width) {
                                const off = (py * canvas.width + px) * 4;
                                const c = palette[pI] || { r: 0, g: 0, b: 0 };
                                d[off] = c.r; d[off+1] = c.g; d[off+2] = c.b; d[off+3] = 255;
                                rectIndices[py * w + px] = pI;
                            }
                        }
                    }
                }
                rd += cR;
            }
            if (h.has_extra_data && tile.extraImageData) {
                const elx = h.x_extra - bounds.minX, ely = (h.y_extra - h.height * mult) - bounds.minY;
                for (let ey = 0; ey < h.cy_extra; ey++) {
                    const py = Math.floor(ely + ey);
                    if (py >= 0 && py < canvas.height) {
                        for (let ex = 0; ex < h.cx_extra; ex++) {
                            const pI = tile.extraImageData[ey * h.cx_extra + ex];
                            if (pI !== 0) {
                                const px = Math.floor(elx + ex);
                                if (px >= 0 && px < canvas.width) {
                                    const off = (py * canvas.width + px) * 4;
                                    const c = palette[pI] || { r: 0, g: 0, b: 0 };
                                    d[off] = c.r; d[off+1] = c.g; d[off+2] = c.b; d[off+3] = 255;
                                    rectIndices[py * w + px] = pI;
                                }
                            }
                        }
                    }
                }
            }
        }
        ctx.putImageData(img, 0, 0);
        return { canvas, bounds, indices: rectIndices };
    }

    static composeZDataToCanvas(tmpData) {
        const numTiles = tmpData.numTiles !== undefined ? tmpData.numTiles : (tmpData.tiles ? tmpData.tiles.length : 0);
        const bounds = TmpTsFile.computeBounds(tmpData);
        if (!bounds.hasTiles) {
            return { canvas: null, bounds, indices: null };
        }
        
        const canvas = document.createElement('canvas');
        const w = Math.ceil(bounds.width);
        const h = Math.ceil(bounds.height);
        
        canvas.width = w; 
        canvas.height = h;
        
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(w, h);
        const d = img.data;
        const rectIndices = new Uint16Array(w * h);
        rectIndices.fill(255); // 255 is transparent Z-data

        // Fill with black background
        for (let i = 0; i < d.length; i += 4) {
            d[i] = 0; d[i+1] = 0; d[i+2] = 0; d[i+3] = 255;
        }

        const zValidMask = new Uint8Array(w * h);
        const halfCy = tmpData.header.cy / 2;
        const mult = halfCy;

        for (let i = 0; i < numTiles; i++) {
            const tile = tmpData.tiles[i];
            if (!tile) continue;
            const h_tile = tile.tileHeader || tile.header;
            if (!h_tile) continue;

            const elevation = h_tile.height * halfCy;
            const lx = h_tile.x - bounds.minX;
            const ly = (h_tile.y - elevation) - bounds.minY;
            const bw = tmpData.header.cx;
            const bh = tmpData.header.cy;

            // 1. Base Z-Data
            if (tile.zData) {
                let rd = 0, xO = bw / 2, cR = 0;
                for (let ty = 0; ty < bh; ty++) {
                    if (ty < halfCy) { cR += 4; xO -= 2; } else { cR -= 4; xO += 2; }
                    if (cR <= 0) continue;
                    const py = Math.floor(ly + ty);
                    if (py >= 0 && py < h) {
                        for (let j = 0; j < cR; j++) {
                            const zVal = tile.zData[rd + j];
                            const px = Math.floor(lx + xO + j);
                            if (px >= 0 && px < w) {
                                const target = (py * w + px) * 4;
                                if (zVal < 32) {
                                    const gray = Math.round((zVal * 255) / 31);
                                    d[target] = gray; d[target+1] = gray; d[target+2] = gray; d[target+3] = 255;
                                    zValidMask[py * w + px] = 1;
                                    rectIndices[py * w + px] = zVal;
                                } else if (zVal === 255) {
                                    d[target] = 0; d[target+1] = 0; d[target+2] = 0; d[target+3] = 255;
                                } else if (!zValidMask[py * w + px]) {
                                    d[target] = 255; d[target+1] = 0; d[target+2] = 0; d[target+3] = 255;
                                }
                            }
                        }
                    }
                    rd += cR;
                }
            }

            // 2. Extra Z-Data
            if (h_tile.has_extra_data && tile.extraZData) {
                const zData = tile.extraZData;
                const ezW = tile._extraZ_cx || h_tile.cx_extra;
                const ezH = tile._extraZ_cy || h_tile.cy_extra;
                const elx = h_tile.x_extra - bounds.minX;
                const ely = (h_tile.y_extra - elevation) - bounds.minY;

                for (let ty = 0; ty < ezH; ty++) {
                    const py = Math.floor(ely + ty);
                    if (py < 0 || py >= h) continue;
                    for (let tx = 0; tx < ezW; tx++) {
                        const zVal = zData[ty * ezW + tx];
                        if (zVal === 0 || zVal === 255) continue;

                        const px = Math.floor(elx + tx);
                        if (px >= 0 && px < w) {
                            const target = (py * w + px) * 4;
                            if (zVal < 32) {
                                const gray = Math.round((zVal * 255) / 31);
                                d[target] = gray; d[target+1] = gray; d[target+2] = gray; d[target+3] = 255;
                                zValidMask[py * w + px] = 1;
                                rectIndices[py * w + px] = zVal;
                            } else if (!zValidMask[py * w + px]) {
                                d[target] = 255; d[target+1] = 0; d[target+2] = 0; d[target+3] = 255;
                            }
                        }
                    }
                }
            }
        }

        ctx.putImageData(img, 0, 0);
        return { canvas, bounds, indices: rectIndices };
    }
}
