
export function fillRectangle(layer, x0, y0, x1, y1, colorIdx, filled, hexFillColor) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);

    // If filled, find closest color index
    let fillIdx = 0;
    if (filled && hexFillColor) {
        const r = parseInt(hexFillColor.substr(1, 2), 16);
        const g = parseInt(hexFillColor.substr(3, 2), 16);
        const b = parseInt(hexFillColor.substr(5, 2), 16);

        let minDist = Infinity;
        for (let i = 0; i < state.palette.length; i++) {
            const c = state.palette[i];
            if (!c) continue;
            const dist = Math.abs(c.r - r) + Math.abs(c.g - g) + Math.abs(c.b - b);
            if (dist < minDist) {
                minDist = dist;
                fillIdx = i;
            }
        }
    }

    // Loop through bounding box
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            if (x < 0 || x >= layer.width || y < 0 || y >= layer.height) continue;

            const isBorder = x === minX || x === maxX || y === minY || y === maxY;
            if (isBorder) {
                layer.data[y * layer.width + x] = colorIdx;
            } else if (filled) {
                layer.data[y * layer.width + x] = fillIdx;
            }
        }
    }
}
