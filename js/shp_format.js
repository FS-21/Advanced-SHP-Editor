/**
 * SHP Format 80 Parser/Encoder
 */
import { TRANSPARENT_COLOR } from './state.js';
import { ShpTdRaFormat } from './shp_td_ra_format.js';

export class ShpFormat80 {
    constructor() { }

    static parse(buffer) {
        if (ShpTdRaFormat.isTdRaShp(buffer)) {
            return ShpTdRaFormat.parse(buffer);
        }

        if (buffer.byteLength < 8) {
            throw new Error("Invalid SHP: Buffer too small");
        }

        const dv = new DataView(buffer);
        const type = dv.getUint16(0, true);
        if (type !== 0) {
            console.warn("SHP Warning: Header Type is not 0");
        }

        const width = dv.getUint16(2, true);
        const height = dv.getUint16(4, true);
        const numImages = dv.getUint16(6, true);

        if (width === 0 || height === 0 || numImages === 0) {
            throw new Error("Invalid SHP Dimensions or Empty File");
        }

        const frameHeaders = [];
        let curHeaderOffset = 8;
        for (let i = 0; i < numImages; i++) {
            if (curHeaderOffset + 24 > buffer.byteLength) {
                break;
            }
            const x = dv.getInt16(curHeaderOffset, true);
            const y = dv.getInt16(curHeaderOffset + 2, true);
            const w = dv.getUint16(curHeaderOffset + 4, true);
            const h = dv.getUint16(curHeaderOffset + 6, true);
            const flags = dv.getUint16(curHeaderOffset + 8, true);
            const size = dv.getUint16(curHeaderOffset + 10, true);
            const radarColor = [
                dv.getUint8(curHeaderOffset + 12),
                dv.getUint8(curHeaderOffset + 13),
                dv.getUint8(curHeaderOffset + 14)
            ];
            const dataOffset = dv.getUint32(curHeaderOffset + 20, true);

            frameHeaders.push({
                x,
                y,
                w,
                h,
                flags,
                size,
                radarColor,
                compression: flags & 0x03,
                dataOffset
            });
            curHeaderOffset += 24;
        }

        const u8 = new Uint8Array(buffer);
        const frames = [];

        for (let i = 0; i < frameHeaders.length; i++) {
            const fh = frameHeaders[i];
            const canvasData = new Uint16Array(width * height);

            const isEmpty = (fh.dataOffset === 0 || fh.w === 0 || fh.h === 0 || fh.dataOffset >= buffer.byteLength);
            if (!isEmpty) {
                const isRle = (fh.flags & 0x02) !== 0;
                let subPixels;

                if (!isRle) {
                    const rawIndices = u8.subarray(fh.dataOffset, Math.min(fh.dataOffset + (fh.w * fh.h), u8.length));
                    subPixels = new Uint16Array(rawIndices);
                } else {
                    subPixels = ShpFormat80.decodeRLEZero(u8, fh.dataOffset, fh.w, fh.h);
                }

                // Blit sub-rectangle into logical canvas coordinates
                for (let row = 0; row < fh.h; row++) {
                    const destY = fh.y + row;
                    if (destY < 0 || destY >= height) continue;
                    const srcRowOffset = row * fh.w;
                    const destRowOffset = destY * width;
                    for (let col = 0; col < fh.w; col++) {
                        const destX = fh.x + col;
                        if (destX < 0 || destX >= width) continue;
                        canvasData[destRowOffset + destX] = subPixels[srcRowOffset + col];
                    }
                }
            }

            frames.push({
                width: width,
                height: height,
                x: 0,
                y: 0,
                subX: fh.x,
                subY: fh.y,
                subW: fh.w,
                subH: fh.h,
                flags: fh.flags,
                size: fh.size,
                radarColor: fh.radarColor,
                compression: (fh.flags & 0x02) ? 3 : 1,
                dataOffset: fh.dataOffset,
                originalIndices: canvasData
            });
        }

        return { width, height, frames, formatType: 'ts_ra2' };
    }

    static decodeRLEZero(fileData, dataOffset, w, h) {
        const out = new Uint16Array(w * h);
        out.fill(0);

        let currentReadOffset = 0;
        const totalLen = fileData.length;

        for (let y = 0; y < h; y++) {
            const lineStart = dataOffset + currentReadOffset;
            if (lineStart + 2 > totalLen) break;

            const lineLen = fileData[lineStart] | (fileData[lineStart + 1] << 8);
            if (lineLen < 2 || lineStart + lineLen > totalLen) break;

            let curByte = 2;
            let x = 0;
            const lineOffset = y * w;

            while (curByte < lineLen && x < w) {
                const val = fileData[lineStart + curByte];
                if (val === 0) {
                    if (curByte + 1 >= lineLen) break;
                    const count = fileData[lineStart + curByte + 1];
                    curByte += 2;
                    x = Math.min(w, x + count);
                } else {
                    out[lineOffset + x] = val;
                    x++;
                    curByte++;
                }
            }
            currentReadOffset += lineLen;
        }
        return out;
    }

    static calculateBoundingBox(indices, w, h, transparentMapping = 0) {
        let minX = w, minY = h, maxX = -1, maxY = -1;
        let hasContent = false;

        for (let y = 0; y < h; y++) {
            const rowOffset = y * w;
            for (let x = 0; x < w; x++) {
                const val = indices[rowOffset + x];
                if (val !== 0 && val !== TRANSPARENT_COLOR && val !== transparentMapping) {
                    hasContent = true;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (!hasContent) {
            return { hasContent: false, x: 0, y: 0, w: 0, h: 0 };
        }

        return {
            hasContent: true,
            x: minX,
            y: minY,
            w: maxX - minX + 1,
            h: maxY - minY + 1
        };
    }

    static extractSubImage(indices, srcW, srcH, cropX, cropY, cropW, cropH, transparentMapping = 0) {
        const subIndices = new Uint8Array(cropW * cropH);
        let hasTransparency = false;

        for (let y = 0; y < cropH; y++) {
            const srcRow = (cropY + y) * srcW;
            const dstRow = y * cropW;
            for (let x = 0; x < cropW; x++) {
                const val = indices[srcRow + (cropX + x)];
                if (val === 0 || val === TRANSPARENT_COLOR || val === transparentMapping) {
                    subIndices[dstRow + x] = transparentMapping;
                    hasTransparency = true;
                } else {
                    subIndices[dstRow + x] = val;
                }
            }
        }

        return { subIndices, hasTransparency };
    }

    static calculateRadarColor(indices, srcW, srcH, cropX, cropY, cropW, cropH, palette, transparentMapping = 0) {
        if (!palette || cropW <= 0 || cropH <= 0) return [0, 0, 0];

        let totalR = 0, totalG = 0, totalB = 0, count = 0;

        for (let y = 0; y < cropH; y++) {
            const rowOffset = (cropY + y) * srcW;
            for (let x = 0; x < cropW; x++) {
                const val = indices[rowOffset + (cropX + x)];
                if (val === 0 || val === TRANSPARENT_COLOR || val === transparentMapping) continue;

                const entry = palette[val];
                if (!entry) continue;

                const r = Array.isArray(entry) ? entry[0] : entry.r;
                const g = Array.isArray(entry) ? entry[1] : entry.g;
                const b = Array.isArray(entry) ? entry[2] : entry.b;

                if (r !== undefined && g !== undefined && b !== undefined) {
                    totalR += r;
                    totalG += g;
                    totalB += b;
                    count++;
                }
            }
        }

        if (count === 0) return [0, 0, 0];

        return [
            Math.round(totalR / count) & 0xFF,
            Math.round(totalG / count) & 0xFF,
            Math.round(totalB / count) & 0xFF
        ];
    }

    static encodeRLEZero(indices, w, h, transparentMapping = 0) {
        const lines = [];
        let totalSize = 0;

        for (let y = 0; y < h; y++) {
            const lineBytes = [];
            let x = 0;
            const lineStart = y * w;
            while (x < w) {
                const val = indices[lineStart + x];
                if (val === 0 || val === TRANSPARENT_COLOR || val === transparentMapping) {
                    let count = 0;
                    while (
                        x < w &&
                        (indices[lineStart + x] === 0 ||
                         indices[lineStart + x] === TRANSPARENT_COLOR ||
                         indices[lineStart + x] === transparentMapping) &&
                        count < 255
                    ) {
                        count++;
                        x++;
                    }
                    lineBytes.push(0, count);
                } else {
                    lineBytes.push(val);
                    x++;
                }
            }
            const len = lineBytes.length + 2;
            const lineBuf = new Uint8Array(len);
            lineBuf[0] = len & 0xFF;
            lineBuf[1] = (len >> 8) & 0xFF;
            lineBuf.set(lineBytes, 2);
            lines.push(lineBuf);
            totalSize += len;
        }

        const out = new Uint8Array(totalSize);
        let p = 0;
        for (let i = 0; i < lines.length; i++) {
            out.set(lines[i], p);
            p += lines[i].length;
        }
        return out;
    }

    static encode(images, isVga = false, type = 3, transparentMapping = 0, options = {}) {
        let nominalWidth = options.width || 0;
        let nominalHeight = options.height || 0;

        images.forEach(img => {
            nominalWidth = Math.max(nominalWidth, img.width || 0);
            nominalHeight = Math.max(nominalHeight, img.height || 0);
        });

        const numImages = images.length;
        const globalHeaderSize = 8;
        const frameHeaderSize = 24;
        const headersBlockSize = globalHeaderSize + (numImages * frameHeaderSize);

        const frameHeadersInfo = [];
        const frameBlobs = [];
        let currentFileOffset = headersBlockSize;

        const palette = options.palette || null;

        for (let i = 0; i < numImages; i++) {
            const img = images[i];
            const srcW = img.width || nominalWidth;
            const srcH = img.height || nominalHeight;
            const indices = img.indices || img.originalIndices || new Uint8Array(srcW * srcH);

            const bbox = ShpFormat80.calculateBoundingBox(indices, srcW, srcH, transparentMapping);

            if (!bbox.hasContent) {
                frameHeadersInfo.push({
                    x: 0,
                    y: 0,
                    w: 0,
                    h: 0,
                    flags: 0,
                    size: 0,
                    radarColor: [0, 0, 0],
                    dataOffset: 0
                });
                frameBlobs.push(null);
                continue;
            }

            const { subIndices, hasTransparency } = ShpFormat80.extractSubImage(
                indices, srcW, srcH,
                bbox.x, bbox.y, bbox.w, bbox.h,
                transparentMapping
            );

            const isRle = (type === 3 || type === 2);
            let blob;

            if (isRle) {
                blob = ShpFormat80.encodeRLEZero(subIndices, bbox.w, bbox.h, transparentMapping);
            } else {
                blob = subIndices;
            }

            const isTransparent = hasTransparency || (bbox.w < nominalWidth) || (bbox.h < nominalHeight);
            let flags = 0;
            if (isTransparent) flags |= 0x01;
            if (isRle) flags |= 0x02;

            let radarColor = [0, 0, 0];
            if (palette) {
                radarColor = ShpFormat80.calculateRadarColor(
                    indices, srcW, srcH,
                    bbox.x, bbox.y, bbox.w, bbox.h,
                    palette, transparentMapping
                );
            } else if (img.radarColor && Array.isArray(img.radarColor)) {
                radarColor = [img.radarColor[0] || 0, img.radarColor[1] || 0, img.radarColor[2] || 0];
            }

            // Align data offset to 8-byte boundary
            const pad = (8 - (currentFileOffset % 8)) % 8;
            currentFileOffset += pad;
            const dataOffset = currentFileOffset;
            currentFileOffset += blob.length;

            frameHeadersInfo.push({
                x: bbox.x,
                y: bbox.y,
                w: bbox.w,
                h: bbox.h,
                flags: flags,
                size: blob.length & 0xFFFF,
                radarColor: radarColor,
                dataOffset: dataOffset
            });
            frameBlobs.push(blob);
        }

        const totalFileSize = (currentFileOffset + 7) & ~7;
        const buffer = new ArrayBuffer(totalFileSize);
        const dv = new DataView(buffer);
        const u8 = new Uint8Array(buffer);

        // Global Header (8 bytes)
        dv.setUint16(0, 0, true);
        dv.setUint16(2, nominalWidth, true);
        dv.setUint16(4, nominalHeight, true);
        dv.setUint16(6, numImages, true);

        // Frame Headers (24 bytes each)
        for (let i = 0; i < numImages; i++) {
            const fh = frameHeadersInfo[i];
            const p = globalHeaderSize + (i * frameHeaderSize);

            dv.setInt16(p, fh.x, true);
            dv.setInt16(p + 2, fh.y, true);
            dv.setUint16(p + 4, fh.w, true);
            dv.setUint16(p + 6, fh.h, true);
            dv.setUint16(p + 8, fh.flags, true);
            dv.setUint16(p + 10, fh.size, true);
            dv.setUint8(p + 12, fh.radarColor[0]);
            dv.setUint8(p + 13, fh.radarColor[1]);
            dv.setUint8(p + 14, fh.radarColor[2]);
            dv.setUint8(p + 15, 0);
            dv.setUint8(p + 16, 0);
            dv.setUint8(p + 17, 0);
            dv.setUint8(p + 18, 0);
            dv.setUint8(p + 19, 0);
            dv.setUint32(p + 20, fh.dataOffset, true);
        }

        // Frame Data
        for (let i = 0; i < numImages; i++) {
            const blob = frameBlobs[i];
            const fh = frameHeadersInfo[i];
            if (blob && fh.dataOffset > 0) {
                u8.set(blob, fh.dataOffset);
            }
        }

        return buffer;
    }
}

export function parseShpFile(buffer) {
    if (ShpTdRaFormat.isTdRaShp(buffer)) {
        return ShpTdRaFormat.parse(buffer);
    }
    return ShpFormat80.parse(buffer);
}

export { ShpTdRaFormat, ShpTdRaFormat as ShpClassicFormat };
