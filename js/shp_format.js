/**
 * SHP Format 80 Parser/Encoder
 */
import { TRANSPARENT_COLOR } from './state.js';

export class ShpFormat80 {
    constructor() { }

    static parse(buffer) {
        const dv = new DataView(buffer);
        const type = dv.getUint16(0, true);
        if (type !== 0) console.warn("SHP Warning: Header Type is not 0");

        const width = dv.getUint16(2, true);
        const height = dv.getUint16(4, true);
        const numImages = dv.getUint16(6, true);

        if (width === 0 || height === 0 || numImages === 0) throw new Error("Invalid SHP Dimensions or Empty File");

        let curHeaderOffset = 8;
        const frameHeaders = [];
        for (let i = 0; i < numImages; i++) {
            const x = dv.getUint16(curHeaderOffset, true);
            const y = dv.getUint16(curHeaderOffset + 2, true);
            const w = dv.getUint16(curHeaderOffset + 4, true);
            const h = dv.getUint16(curHeaderOffset + 6, true);
            const flags = dv.getUint32(curHeaderOffset + 8, true);
            const compression = flags & 0x03;
            const dataOffset = dv.getUint32(curHeaderOffset + 20, true);

            frameHeaders.push({ x, y, w, h, compression, dataOffset });
            curHeaderOffset += 24;
        }

        const u8 = new Uint8Array(buffer);
        const frames = [];

        for (let i = 0; i < numImages; i++) {
            const fh = frameHeaders[i];
            if (fh.w === 0 || fh.h === 0) {
                frames.push({
                    width: fh.w, height: fh.h, x: fh.x, y: fh.y,
                    originalIndices: new Array(0), compression: fh.compression
                });
                continue;
            }

            let frameData;
            const isRLE = (fh.compression & 2) !== 0;

            if (!isRLE) {
                // Direct byte copy to Uint16Array for 1-to-1 index fidelity (0 stays 0)
                const rawIndices = u8.subarray(fh.dataOffset, fh.dataOffset + (fh.w * fh.h));
                frameData = new Uint16Array(rawIndices);
            } else {
                frameData = ShpFormat80.decodeRLEZero(u8, fh.dataOffset, fh.w, fh.h);
            }

            frames.push({
                width: fh.w, height: fh.h, x: fh.x, y: fh.y,
                originalIndices: frameData, compression: fh.compression
            });
        }
        return { width, height, frames };
    }

    static decodeRLEZero(fileData, dataOffset, w, h) {
        // RLE Skips are mapped to Index 0 for game engine compatibility.
        // Modern "Void" (checkerboard) is only used for manual erasing or layering.
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
                    let count = fileData[lineStart + curByte + 1];
                    curByte += 2;
                    x += count;
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

    static encode(images, isVga = false, type = 3, transparentMapping = 0) {
        let maxWidth = 0, maxHeight = 0;
        images.forEach(img => {
            maxWidth = Math.max(maxWidth, img.width);
            maxHeight = Math.max(maxHeight, img.height);
        });

        const numImages = images.length;
        const globalHeaderSize = 8;
        const frameHeaderSize = 24;
        const headersBlockSize = globalHeaderSize + (numImages * frameHeaderSize);

        const frameDataBlobs = [];
        const frameHeadersInfo = [];
        let currentFileOffset = headersBlockSize;

        for (let i = 0; i < numImages; i++) {
            const img = images[i];
            const indices = img.indices || new Uint8Array(img.width * img.height);
            let blob;
            let compressionFlag;

            if (type === 3) {
                blob = ShpFormat80.encodeRLEZero(indices, img.width, img.height, transparentMapping);
                compressionFlag = 3;
            } else {
                // For uncompressed (Type 1 or 0), map TRANSPARENT_COLOR back to chosen index
                const raw = new Uint8Array(img.width * img.height);
                for (let j = 0; j < indices.length; j++) {
                    raw[j] = indices[j] === TRANSPARENT_COLOR ? transparentMapping : indices[j];
                }
                blob = raw;
                compressionFlag = 1;
            }

            frameDataBlobs.push(blob);
            frameHeadersInfo.push({
                x: 0, y: 0,
                w: img.width, h: img.height,
                compression: compressionFlag,
                offset: currentFileOffset
            });
            currentFileOffset += blob.length;
        }

        const totalSize = currentFileOffset;
        const buffer = new ArrayBuffer(totalSize);
        const dv = new DataView(buffer);
        const u8 = new Uint8Array(buffer);

        dv.setUint16(0, 0, true);
        dv.setUint16(2, maxWidth, true);
        dv.setUint16(4, maxHeight, true);
        dv.setUint16(6, numImages, true);

        let p = globalHeaderSize;
        frameHeadersInfo.forEach(fh => {
            dv.setUint16(p, fh.x, true);
            dv.setUint16(p + 2, fh.y, true);
            dv.setUint16(p + 4, fh.w, true);
            dv.setUint16(p + 6, fh.h, true);
            dv.setUint32(p + 8, fh.compression, true);
            dv.setUint32(p + 20, fh.offset, true);
            p += 24;
        });

        let dataP = headersBlockSize;
        frameDataBlobs.forEach(b => {
            u8.set(b, dataP);
            dataP += b.length;
        });

        return buffer;
    }

    static encodeRLEZero(indices, w, h, transparentMapping = 0) {
        const lines = [];
        let totalSize = 0;

        for (let y = 0; y < h; y++) {
            const lineBytes = [];
            let x = 0;
            while (x < w) {
                const val = indices[y * w + x];
                if (val === TRANSPARENT_COLOR || val === transparentMapping) {
                    let count = 0;
                    while (x < w && (indices[y * w + x] === TRANSPARENT_COLOR || indices[y * w + x] === transparentMapping) && count < 255) {
                        count++; x++;
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
        lines.forEach(l => {
            out.set(l, p);
            p += l.length;
        });
        return out;
    }
}
