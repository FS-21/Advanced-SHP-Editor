/**
 * PCX File Loader
 * Decodes and Encodes 8-bit indexed PCX files.
 */
export class PcxLoader {
    constructor(buffer) {
        this.b = new Uint8Array(buffer);
        this.p = 0;
    }

    r8() { return this.b[this.p++]; }
    r16() {
        const v = this.b[this.p] | (this.b[this.p + 1] << 8);
        this.p += 2;
        return v;
    }

    static getDimensions(buffer) {
        const b = new Uint8Array(buffer);
        if (b.length < 128) return { width: 0, height: 0 };
        if (b[0] !== 0x0A) return { width: 0, height: 0 };
        const x1 = b[4] | (b[5] << 8);
        const y1 = b[6] | (b[7] << 8);
        const x2 = b[8] | (b[9] << 8);
        const y2 = b[10] | (b[11] << 8);
        return { width: x2 - x1 + 1, height: y2 - y1 + 1 };
    }

    decode() {
        if (this.b.length < 128) throw new Error("File too small for PCX");

        // Header parsing
        this.p = 0;
        const identifier = this.r8(); // 0: Identifier
        const version = this.r8();    // 1: Version
        const encoding = this.r8();   // 2: Encoding
        const bitsPerPixel = this.r8(); // 3: BitsPerPixel

        if (identifier !== 0x0A) throw new Error("Not a valid PCX file");

        const x1 = this.r16(), y1 = this.r16(), x2 = this.r16(), y2 = this.r16();
        const width = x2 - x1 + 1;
        const height = y2 - y1 + 1;

        // Skip HRes, VRes, EgaPalette, Reserved
        this.p = 65;
        const numPlanes = this.r8();
        const bytesPerLine = this.r16();
        // PaletteInfo, HScreenSize, VScreenSize, Filler
        this.p = 128;

        if (bitsPerPixel !== 8 || numPlanes !== 1) {
            throw new Error(`Unsupported PCX format: ${bitsPerPixel}bpp, ${numPlanes} planes. Only 8-bit indexed PCX is supported.`);
        }

        const totalScanLine = numPlanes * bytesPerLine;
        const pixelData = new Uint8Array(width * height);
        let pixelIndex = 0;

        for (let y = 0; y < height; y++) {
            let linePtr = 0;
            while (linePtr < totalScanLine) {
                let val = this.r8();
                let count = 1;
                if ((val & 0xC0) === 0xC0) {
                    count = val & 0x3F;
                    val = this.r8();
                }
                for (let k = 0; k < count; k++) {
                    if (linePtr < totalScanLine) {
                        if (pixelIndex < width * height && linePtr < width) {
                            pixelData[pixelIndex] = val;
                        }
                        linePtr++;
                        if (linePtr <= width) pixelIndex++;
                    }
                }
            }
        }

        // Palette is at the end of the file: 0x0C marker followed by 768 bytes
        let paletteOffset = this.b.length - 769;
        const palette = [];
        if (this.b[paletteOffset] === 0x0C) {
            let pp = paletteOffset + 1;
            for (let i = 0; i < 256; i++) {
                palette.push({ r: this.b[pp++], g: this.b[pp++], b: this.b[pp++] });
            }
        } else {
            // Fallback to grayscale if no palette found
            for (let i = 0; i < 256; i++) palette.push({ r: i, g: i, b: i });
        }

        return { width, height, indices: pixelData, palette, originalIndices: pixelData };
    }

    static encode(width, height, pixels, palette) {
        const header = new Uint8Array(128);
        header[0] = 0x0A; // Identifier
        header[1] = 0x05; // Version 3.0+
        header[2] = 0x01; // Encoding: RLE
        header[3] = 0x08; // Bits per pixel

        const view = new DataView(header.buffer);
        view.setUint16(4, 0, true); // XMin
        view.setUint16(6, 0, true); // YMin
        view.setUint16(8, width - 1, true); // XMax
        view.setUint16(10, height - 1, true); // YMax
        header[64] = 0x01; // Num Planes
        view.setUint16(66, width, true); // Bytes per line
        view.setUint16(68, 1, true); // Palette Info: Color/BW

        const rleData = [];
        for (let y = 0; y < height; y++) {
            let x = 0;
            while (x < width) {
                let run = 1;
                const val = pixels[y * width + x] || 0;
                while (x + run < width && run < 63 && pixels[y * width + x + run] === val) {
                    run++;
                }
                if (run > 1 || (val & 0xC0) === 0xC0) {
                    rleData.push(0xC0 | run);
                }
                rleData.push(val);
                x += run;
            }
        }

        const paletteData = new Uint8Array(769);
        paletteData[0] = 0x0C;
        for (let i = 0; i < 256; i++) {
            const c = (palette && palette[i]) || { r: i, g: i, b: i };
            paletteData[1 + i * 3 + 0] = c.r;
            paletteData[1 + i * 3 + 1] = c.g;
            paletteData[1 + i * 3 + 2] = c.b;
        }

        const out = new Uint8Array(128 + rleData.length + 769);
        out.set(header, 0);
        out.set(new Uint8Array(rleData), 128);
        out.set(paletteData, 128 + rleData.length);
        return out;
    }
}
