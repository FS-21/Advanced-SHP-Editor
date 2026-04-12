import { state, TRANSPARENT_COLOR } from './state.js';
import { ShpFormat80 } from './shp_format.js';

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
            await writable.write(u8Array);
            await writable.close();
            return handle;
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Save File Picker failed, falling back:', err);
                if (existingHandle) throw err; // Fallback to normal download if explicitly saving to an existing handle fails
            } else {
                return null; // User cancelled
            }
        }
    }

    // Fallback
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
