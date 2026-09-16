/**
 * SHP (TD / RA1) Format Parser and Encoder
 * Supports:
 *   - Format 80 (LCW keyframe)
 *   - Format 40 (XOR delta against reference frame)
 *   - Format 20 (XOR delta against previous frame i-1)
 *   - Format 0  (Uncompressed raw frame)
 */
import { TRANSPARENT_COLOR } from './state.js';

export class ShpTdRaFormat {
    /**
     * Inspects a binary buffer to determine if it is a TD/RA1 SHP file.
     * @param {ArrayBuffer} buffer 
     * @returns {boolean}
     */
    static isTdRaShp(buffer) {
        if (buffer && ArrayBuffer.isView(buffer)) {
            buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        }
        if (!buffer || buffer.byteLength < 14 + 16) return false;
        const dv = new DataView(buffer);
        const numImages = dv.getUint16(0, true);
        if (numImages === 0 || numImages > 3000) return false;

        // In TD/RA1, bytes 2..5 (X and Y offsets) are always 0.
        // In TS/RA2, bytes 2..5 are Width and Height, which are non-zero.
        const hX = dv.getInt16(2, true);
        const hY = dv.getInt16(4, true);
        if (hX !== 0 || hY !== 0) return false;

        const width = dv.getUint16(6, true);
        const height = dv.getUint16(8, true);
        if (width === 0 || width > 2048 || height === 0 || height > 2048) return false;

        const tableOffset = 14;
        const expectedTableSize = (numImages + 2) * 8;
        if (tableOffset + expectedTableSize > buffer.byteLength) return false;

        // Validate format nibble of the first entries (must be 0, 2, 4, or 8)
        const checkCount = Math.min(numImages, 5);
        for (let i = 0; i < checkCount; i++) {
            const val1 = dv.getUint32(tableOffset + i * 8, true);
            const fmt = val1 >>> 28;
            if (fmt !== 0 && fmt !== 2 && fmt !== 4 && fmt !== 8) return false;
            const offset = val1 & 0x0fffffff;
            if (offset < tableOffset + expectedTableSize || offset > buffer.byteLength) return false;
        }

        // Check file size entry in index table at index [numImages]
        const eofOffset = dv.getUint32(tableOffset + numImages * 8, true) & 0x0fffffff;
        if (eofOffset > buffer.byteLength) return false;
        if (eofOffset > 0 && eofOffset < tableOffset + expectedTableSize) return false;

        return true;
    }

    /** Compatibility alias */
    static isClassicShp(buffer) {
        return ShpTdRaFormat.isTdRaShp(buffer);
    }

    /**
     * Parses a TD/RA1 SHP buffer into editor frames.
     * @param {ArrayBuffer} buffer 
     * @returns {{ width: number, height: number, frames: Array, formatType: string }}
     */
    static parse(buffer) {
        if (buffer && ArrayBuffer.isView(buffer)) {
            buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        }
        const dv = new DataView(buffer);
        const numImages = dv.getUint16(0, true);
        const width = dv.getUint16(6, true);
        const height = dv.getUint16(8, true);

        if (numImages === 0 || width === 0 || height === 0) {
            throw new Error("Invalid TD/RA1 SHP: Invalid header dimensions or frame count.");
        }

        const totalPixels = width * height;
        const u8 = new Uint8Array(buffer);

        // Read index entries
        const tableOffset = 14;
        const entries = [];
        const offsetToFrameIndex = new Map();

        for (let i = 0; i < numImages; i++) {
            const entryPos = tableOffset + i * 8;
            const val1 = dv.getUint32(entryPos, true);
            const dataOffset = val1 & 0x0fffffff;
            const format = val1 >>> 28;
            const refOffset = dv.getUint32(entryPos + 4, true) & 0x0fffffff;

            entries.push({ dataOffset, format, refOffset, index: i });
            offsetToFrameIndex.set(dataOffset, i);
        }

        const frames = [];
        const decodedPixelBuffers = [];

        for (let i = 0; i < numImages; i++) {
            const entry = entries[i];
            let framePixels;

            if (entry.format === 8) {
                // Format 80: Independent keyframe (LCW)
                framePixels = ShpTdRaFormat.decodeLCW(u8, entry.dataOffset, totalPixels);
            } else if (entry.format === 4) {
                // Format 40: XOR Delta against referenced frame
                const refIdx = offsetToFrameIndex.get(entry.refOffset);
                const baseBuf = (refIdx !== undefined && refIdx >= 0 && refIdx < i)
                    ? decodedPixelBuffers[refIdx]
                    : (i > 0 ? decodedPixelBuffers[i - 1] : new Uint16Array(totalPixels));

                const cloned = new Uint16Array(baseBuf);
                framePixels = ShpTdRaFormat.decodeFormat40(u8, entry.dataOffset, cloned);
            } else if (entry.format === 2) {
                // Format 20: XOR Delta against immediately preceding frame (i - 1)
                const baseBuf = (i > 0) ? decodedPixelBuffers[i - 1] : new Uint16Array(totalPixels);
                const cloned = new Uint16Array(baseBuf);
                framePixels = ShpTdRaFormat.decodeFormat40(u8, entry.dataOffset, cloned);
            } else if (entry.format === 0) {
                // Format 0: Raw uncompressed bytes
                const rawSlice = u8.subarray(entry.dataOffset, entry.dataOffset + totalPixels);
                framePixels = new Uint16Array(rawSlice);
            } else {
                // Fallback LCW
                framePixels = ShpTdRaFormat.decodeLCW(u8, entry.dataOffset, totalPixels);
            }

            decodedPixelBuffers.push(framePixels);

            frames.push({
                width: width,
                height: height,
                x: 0,
                y: 0,
                originalIndices: framePixels,
                compression: entry.format === 8 ? 8 : (entry.format === 4 ? 4 : (entry.format === 2 ? 2 : 0)),
                formatCode: entry.format
            });
        }

        return {
            width,
            height,
            frames,
            formatType: 'td_ra'
        };
    }

    /**
     * Decompresses Format 80 (LCW) data.
     * @param {Uint8Array} fileBytes 
     * @param {number} dataOffset 
     * @param {number} totalPixels 
     * @returns {Uint16Array}
     */
    static decodeLCW(fileBytes, dataOffset, totalPixels) {
        const out = new Uint16Array(totalPixels);
        let src = dataOffset;
        let dst = 0;
        const fileLen = fileBytes.length;

        while (src < fileLen && dst < totalPixels) {
            const op = fileBytes[src++];

            if ((op & 0x80) === 0) {
                // Opcode 0: Short relative copy
                const count = (op >> 4) + 3;
                if (src >= fileLen) break;
                const relOffset = fileBytes[src++] | ((op & 0x0f) << 8);
                let copySrc = dst - relOffset;
                for (let k = 0; k < count && dst < totalPixels; k++) {
                    const val = (copySrc >= 0 && copySrc < totalPixels) ? out[copySrc++] : 0;
                    out[dst++] = val;
                }
            } else if ((op & 0x40) === 0) {
                if (op === 0x80) {
                    // Opcode 1 (0x80): End of compressed stream
                    break;
                } else {
                    // Opcode 1 (10cccccc): Literal run (1..63 bytes)
                    const count = op & 0x3f;
                    for (let k = 0; k < count && src < fileLen && dst < totalPixels; k++) {
                        out[dst++] = fileBytes[src++];
                    }
                }
            } else {
                if (op === 0xfe) {
                    // Opcode 3 (0xFE): Long run fill
                    if (src + 2 >= fileLen) break;
                    const count = fileBytes[src] | (fileBytes[src + 1] << 8);
                    src += 2;
                    const val = fileBytes[src++];
                    for (let k = 0; k < count && dst < totalPixels; k++) {
                        out[dst++] = val;
                    }
                } else if (op === 0xff) {
                    // Opcode 4 (0xFF): Long absolute copy
                    if (src + 3 >= fileLen) break;
                    const count = fileBytes[src] | (fileBytes[src + 1] << 8);
                    src += 2;
                    const absOffset = fileBytes[src] | (fileBytes[src + 1] << 8);
                    src += 2;
                    let copySrc = absOffset;
                    for (let k = 0; k < count && dst < totalPixels; k++) {
                        const val = (copySrc >= 0 && copySrc < totalPixels) ? out[copySrc++] : 0;
                        out[dst++] = val;
                    }
                } else {
                    // Opcode 2 (11cccccc): Medium absolute copy
                    const count = (op & 0x3f) + 3;
                    if (src + 1 >= fileLen) break;
                    const absOffset = fileBytes[src] | (fileBytes[src + 1] << 8);
                    src += 2;
                    let copySrc = absOffset;
                    for (let k = 0; k < count && dst < totalPixels; k++) {
                        const val = (copySrc >= 0 && copySrc < totalPixels) ? out[copySrc++] : 0;
                        out[dst++] = val;
                    }
                }
            }
        }

        return out;
    }

    /**
     * Decompresses Format 40 (XOR Delta with RLE skip) in-place onto a buffer.
     * @param {Uint8Array} fileBytes 
     * @param {number} dataOffset 
     * @param {Uint16Array} buffer 
     * @returns {Uint16Array}
     */
    static decodeFormat40(fileBytes, dataOffset, buffer) {
        let src = dataOffset;
        let dst = 0;
        const totalPixels = buffer.length;
        const fileLen = fileBytes.length;

        while (src < fileLen && dst < totalPixels) {
            const code = fileBytes[src++];

            if ((code & 0x80) !== 0) {
                let count = code & 0x7f;
                if (count > 0) {
                    // Short skip
                    dst += count;
                } else {
                    // Long command
                    if (src + 1 >= fileLen) break;
                    count = fileBytes[src] | (fileBytes[src + 1] << 8);
                    src += 2;
                    if (count === 0) {
                        // End of delta stream
                        break;
                    }

                    const code2 = count >> 8;
                    if ((code2 & 0x80) !== 0) {
                        count &= 0x3fff;
                        if ((code2 & 0x40) !== 0) {
                            // XOR fill
                            if (src >= fileLen) break;
                            const val = fileBytes[src++];
                            for (let k = 0; k < count && dst < totalPixels; k++) {
                                buffer[dst++] ^= val;
                            }
                        } else {
                            // XOR copy literal
                            for (let k = 0; k < count && src < fileLen && dst < totalPixels; k++) {
                                buffer[dst++] ^= fileBytes[src++];
                            }
                        }
                    } else {
                        // Long skip
                        dst += count;
                    }
                }
            } else if (code > 0) {
                // Short XOR literal copy
                const count = code;
                for (let k = 0; k < count && src < fileLen && dst < totalPixels; k++) {
                    buffer[dst++] ^= fileBytes[src++];
                }
            } else {
                // Short XOR fill (code === 0)
                if (src + 1 >= fileLen) break;
                const count = fileBytes[src++];
                const val = fileBytes[src++];
                for (let k = 0; k < count && dst < totalPixels; k++) {
                    buffer[dst++] ^= val;
                }
            }
        }

        return buffer;
    }

    /**
     * Encodes raw image frames into TD/RA1 SHP (Format 80 LCW or Format 0 Uncompressed).
     * @param {Array<{ width: number, height: number, indices: Uint8Array|Uint16Array }>} images 
     * @param {number} transparentMapping 
     * @param {number} compressionFormat 80 for LCW, 0 for Uncompressed raw
     * @returns {Uint8Array}
     */
    static encode(images, transparentMapping = 0, compressionFormat = 80) {
        if (!images || images.length === 0) {
            throw new Error("Cannot encode empty image list.");
        }

        const width = images[0].width;
        const height = images[0].height;
        const numImages = images.length;
        const totalPixels = width * height;

        // 14-byte header + (numImages + 2) * 8 index entries
        const headerSize = 14;
        const indexTableSize = (numImages + 2) * 8;
        const dataStartOffset = headerSize + indexTableSize;

        const encodedFrameBlobs = [];
        const indexEntries = [];
        let curOffset = dataStartOffset;
        const isRawFormat0 = (compressionFormat === 0);

        for (let i = 0; i < numImages; i++) {
            const img = images[i];
            const raw = new Uint8Array(totalPixels);
            const srcIndices = img.indices || new Uint8Array(totalPixels);

            for (let p = 0; p < totalPixels; p++) {
                const idx = srcIndices[p];
                raw[p] = (idx === TRANSPARENT_COLOR) ? transparentMapping : (idx & 0xff);
            }

            if (isRawFormat0) {
                encodedFrameBlobs.push(raw);
                const formatOffset = (0x00000000 >>> 0) | (curOffset & 0x0fffffff);
                indexEntries.push({
                    offset: formatOffset,
                    refOffset: 0
                });
                curOffset += raw.length;
            } else {
                const lcwBlob = ShpTdRaFormat.encodeLCWFrame(raw);
                encodedFrameBlobs.push(lcwBlob);

                // Format 80 flag = 0x80000000
                const formatOffset = (0x80000000 >>> 0) | (curOffset & 0x0fffffff);
                indexEntries.push({
                    offset: formatOffset,
                    refOffset: 0
                });
                curOffset += lcwBlob.length;
            }
        }

        // EOF entry and Terminator entry
        const fileSize = curOffset;
        indexEntries.push({ offset: fileSize, refOffset: 0 });
        indexEntries.push({ offset: 0, refOffset: 0 });

        const out = new Uint8Array(fileSize);
        const dv = new DataView(out.buffer);

        // 1. Write Header
        dv.setUint16(0, numImages, true);
        dv.setInt16(2, 0, true);
        dv.setInt16(4, 0, true);
        dv.setUint16(6, width, true);
        dv.setUint16(8, height, true);
        dv.setUint32(10, 0, true);

        // 2. Write Index Table
        let tablePos = headerSize;
        for (let i = 0; i < indexEntries.length; i++) {
            dv.setUint32(tablePos, indexEntries[i].offset, true);
            dv.setUint32(tablePos + 4, indexEntries[i].refOffset, true);
            tablePos += 8;
        }

        // 3. Write Frame Blobs
        let writePos = dataStartOffset;
        for (let i = 0; i < numImages; i++) {
            out.set(encodedFrameBlobs[i], writePos);
            writePos += encodedFrameBlobs[i].length;
        }

        return out;
    }

    /**
     * Compresses a single frame buffer into LCW (Format 80) format.
     * @param {Uint8Array} src 
     * @returns {Uint8Array}
     */
    static encodeLCWFrame(src) {
        const len = src.length;
        const out = [];
        let r = 0;

        while (r < len) {
            // Check for run length of identical bytes (>= 4 bytes)
            let runLen = 1;
            const val = src[r];
            while (r + runLen < len && src[r + runLen] === val && runLen < 0xffff) {
                runLen++;
            }

            if (runLen >= 4) {
                // Opcode 0xFE: Long run fill
                out.push(0xfe);
                out.push(runLen & 0xff);
                out.push((runLen >> 8) & 0xff);
                out.push(val);
                r += runLen;
                continue;
            }

            // Check for relative lookback match (count 3..10, offset 1..4095)
            let bestMatchOffset = 0;
            let bestMatchLen = 0;
            const maxLookback = Math.min(r, 4095);

            for (let offset = 1; offset <= maxLookback; offset++) {
                let matchLen = 0;
                while (r + matchLen < len && matchLen < 10 && src[r + matchLen] === src[r - offset + matchLen]) {
                    matchLen++;
                }
                if (matchLen > bestMatchLen && matchLen >= 3) {
                    bestMatchLen = matchLen;
                    bestMatchOffset = offset;
                    if (bestMatchLen === 10) break; // Maximum for Opcode 0 short relative copy
                }
            }

            if (bestMatchLen >= 3) {
                // Opcode 0: Short relative copy (count: 3..10 -> countCode: 0..7)
                const countCode = (bestMatchLen - 3) & 0x07;
                const highByte = (countCode << 4) | ((bestMatchOffset >> 8) & 0x0f);
                const lowByte = bestMatchOffset & 0xff;
                out.push(highByte);
                out.push(lowByte);
                r += bestMatchLen;
                continue;
            }

            // Literal run: collect up to 63 uncompressed bytes
            let litLen = 0;
            const litStart = r;
            while (r < len && litLen < 63) {
                if (r + 4 <= len && src[r] === src[r + 1] && src[r] === src[r + 2] && src[r] === src[r + 3]) {
                    break;
                }
                litLen++;
                r++;
            }

            // Opcode 1: Literal run (10cccccc)
            out.push(0x80 | litLen);
            for (let k = 0; k < litLen; k++) {
                out.push(src[litStart + k]);
            }
        }

        // End of image command (0x80)
        out.push(0x80);
        return new Uint8Array(out);
    }
}

// Global registration
if (typeof window !== 'undefined') {
    window.ShpTdRaFormat = ShpTdRaFormat;
    window.ShpClassicFormat = ShpTdRaFormat;
}
