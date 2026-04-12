export function updateToolSettingsUI(tool) {
    const { elements } = await import('./constants.js'); // async import to avoid cycle if needed, or just use global
    // Actually ui.js imports elements at top.
}
