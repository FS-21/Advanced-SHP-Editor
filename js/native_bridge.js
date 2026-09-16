/**
 * Native Bridge for Tauri Desktop Integration
 * Provides transparent fallback between native Rust commands (desktop) and Web APIs (browser).
 */

export function isNativeApp() {
    return typeof window.__TAURI__ !== 'undefined' && typeof window.__TAURI__.core !== 'undefined';
}

/**
 * Read raw binary file from disk via Rust std::fs::read
 * @param {string} path - Absolute filesystem path
 * @returns {Promise<Uint8Array>}
 */
export async function nativeReadFile(path) {
    if (!isNativeApp()) throw new Error('Native app environment not available');
    const bytes = await window.__TAURI__.core.invoke('read_file_binary', { path });
    return new Uint8Array(bytes);
}

/**
 * Write raw binary file to disk via Rust std::fs::write
 * @param {string} path - Absolute filesystem path
 * @param {Uint8Array|ArrayBuffer} data - Binary content
 * @returns {Promise<void>}
 */
export async function nativeWriteFile(path, data) {
    if (!isNativeApp()) throw new Error('Native app environment not available');
    const u8 = (data instanceof Uint8Array) ? data : new Uint8Array(data);
    await window.__TAURI__.core.invoke('write_file_binary', {
        path,
        data: Array.from(u8)
    });
}

/**
 * Open native OS file picker
 * @param {Object} options - { title, filters: [{ name, extensions: ['shp'] }], multiple: false }
 * @returns {Promise<string[]|null>} Array of paths or null if cancelled
 */
export async function nativeOpenFileDialog(options = {}) {
    if (!isNativeApp()) return null;
    const res = await window.__TAURI__.core.invoke('pick_open_file', {
        title: options.title || null,
        filters: options.filters || [],
        multiple: !!options.multiple
    });
    return res || null;
}

/**
 * Open native OS save file picker
 * @param {Object} options - { defaultName, title, filters: [{ name, extensions: ['shp'] }] }
 * @returns {Promise<string|null>} Chosen path or null if cancelled
 */
export async function nativeSaveFileDialog(options = {}) {
    if (!isNativeApp()) return null;
    const res = await window.__TAURI__.core.invoke('pick_save_file', {
        defaultName: options.defaultName || null,
        title: options.title || null,
        filters: options.filters || []
    });
    return res || null;
}

/**
 * Get CLI arguments passed to the application on startup (e.g. file association double click)
 * @returns {Promise<string[]>}
 */
export async function nativeGetCliArgs() {
    if (!isNativeApp()) return [];
    try {
        const args = await window.__TAURI__.core.invoke('get_cli_args');
        return Array.isArray(args) ? args : [];
    } catch (err) {
        console.warn('[nativeGetCliArgs] Failed:', err);
        return [];
    }
}

/**
 * Listen to backend Tauri events
 * @param {string} eventName
 * @param {function} handler
 * @returns {Promise<function>} Unlisten function
 */
export async function nativeListenEvent(eventName, handler) {
    if (isNativeApp() && window.__TAURI__ && window.__TAURI__.event && typeof window.__TAURI__.event.listen === 'function') {
        return await window.__TAURI__.event.listen(eventName, handler);
    }
    return () => {};
}

/**
 * Force exit the application cleanly without confirmation loop
 */
export async function nativeExitApp() {
    if (isNativeApp()) {
        try {
            await window.__TAURI__.core.invoke('force_exit_app');
        } catch (e) {
            console.error('[nativeExitApp] Failed:', e);
        }
    } else {
        window.close();
    }
}

/**
 * Read image from OS clipboard
 * @returns {Promise<{width: number, height: number, rgba: Uint8ClampedArray}|null>}
 */
export async function nativeReadClipboardImage() {
    if (!isNativeApp()) return null;
    try {
        const res = await window.__TAURI__.core.invoke('read_clipboard_image');
        if (res && res.width && res.height && res.rgba) {
            return {
                width: res.width,
                height: res.height,
                rgba: new Uint8ClampedArray(res.rgba)
            };
        }
        return null;
    } catch (err) {
        console.warn('[nativeReadClipboardImage] Failed:', err);
        return null;
    }
}

/**
 * Write RGBA image directly to system clipboard
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array|Uint8ClampedArray} rgba
 * @returns {Promise<boolean>}
 */
export async function nativeWriteClipboardImage(width, height, rgba) {
    if (!isNativeApp()) return false;
    try {
        const bytes = (rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray)
            ? Array.from(rgba)
            : Array.from(new Uint8Array(rgba));
        await window.__TAURI__.core.invoke('write_clipboard_image', {
            width: Math.round(width),
            height: Math.round(height),
            rgba: bytes
        });
        return true;
    } catch (err) {
        console.warn('[nativeWriteClipboardImage] Failed:', err);
        return false;
    }
}

/**
 * Read plain text from system clipboard
 * @returns {Promise<string|null>}
 */
export async function nativeReadClipboardText() {
    if (isNativeApp()) {
        try {
            return await window.__TAURI__.core.invoke('read_clipboard_text');
        } catch (err) {
            console.warn('[nativeReadClipboardText] Failed:', err);
        }
    }
    if (navigator.clipboard && navigator.clipboard.readText) {
        try {
            return await navigator.clipboard.readText();
        } catch (err) {
            console.warn('[readText] Web fallback failed:', err);
        }
    }
    return null;
}

/**
 * Write plain text to system clipboard
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function nativeWriteClipboardText(text) {
    if (isNativeApp()) {
        try {
            await window.__TAURI__.core.invoke('write_clipboard_text', { text: String(text) });
            return true;
        } catch (err) {
            console.warn('[nativeWriteClipboardText] Failed:', err);
        }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(String(text));
            return true;
        } catch (err) {
            console.warn('[writeText] Web fallback failed:', err);
        }
    }
    return false;
}

/**
 * Open URL in the default OS browser
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export async function nativeOpenUrl(url) {
    if (isNativeApp()) {
        try {
            await window.__TAURI__.core.invoke('open_url', { url });
            return true;
        } catch (err) {
            console.warn('[nativeOpenUrl] Failed:', err);
        }
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
}


/**
 * Get file modification time in milliseconds epoch
 * @param {string} path
 * @returns {Promise<number>}
 */
export async function nativeGetFileModifiedTime(path) {
    if (!isNativeApp() || !path) return 0;
    try {
        const mtime = await window.__TAURI__.core.invoke('get_file_modified_time', { path });
        return typeof mtime === 'number' ? mtime : Number(mtime) || 0;
    } catch (err) {
        return 0;
    }
}

/**
 * Attempt to resolve absolute disk paths for files dropped onto the webview
 * @param {Array<{name: string, size: number, last_modified_ms?: number, lastModified?: number}>} files
 * @param {string|null} lastDir
 * @returns {Promise<Array<string|null>>}
 */
export async function nativeResolveDroppedFiles(files, lastDir = null) {
    if (!isNativeApp() || !Array.isArray(files) || files.length === 0) return [];
    try {
        const payload = files.map(f => ({
            name: f.name || '',
            size: typeof f.size === 'number' ? f.size : 0,
            last_modified_ms: typeof f.lastModified === 'number' ? f.lastModified : (f.last_modified_ms || null)
        }));
        const resolved = await window.__TAURI__.core.invoke('resolve_dropped_files', {
            files: payload,
            lastDir: lastDir || null
        });
        return Array.isArray(resolved) ? resolved : [];
    } catch (err) {
        console.warn('[nativeResolveDroppedFiles] Failed:', err);
        return [];
    }
}



