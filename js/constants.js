export const elements = {
    // Canvases
    get bgCanvas() { return document.getElementById('bgCanvas'); },
    get mainCanvas() { return document.getElementById('mainCanvas'); },
    get overlayCanvas() { return document.getElementById('overlayCanvas'); },
    get canvasWrapper() { return document.getElementById('canvasWrapper'); },
    get canvasScrollArea() { return document.getElementById('canvasScrollArea'); },
    get canvasArea() { return document.getElementById('canvasArea'); },

    // Contexts
    get bgCtx() { return this.bgCanvas ? this.bgCanvas.getContext('2d') : null; },
    get ctx() { return this.mainCanvas ? this.mainCanvas.getContext('2d') : null; },
    get overlayCtx() { return this.overlayCanvas ? this.overlayCanvas.getContext('2d') : null; },

    // Panels
    get paletteGrid() { return document.getElementById('paletteGrid'); },
    get layersList() { return document.getElementById('layersList'); },
    get framesList() { return document.getElementById('framesList'); },
    get historyList() { return document.getElementById('historyList'); },
    get panelRight() { return document.querySelector('.panel-right'); },
    get panelRightResizer() { return document.getElementById('panelRightResizer'); },

    // Panel Toggles & Sections
    get btnToggleFrames() { return document.getElementById('btnToggleFrames'); },
    get btnToggleLayers() { return document.getElementById('btnToggleLayers'); },
    get panelSectionFrames() { return document.getElementById('panelSectionFrames'); },
    get panelSectionLayers() { return document.getElementById('panelSectionLayers'); },

    // Buttons
    get btnAddGroup() { return document.getElementById('btnAddGroup'); },
    get btnExternalShp() { return document.getElementById('btnExternalShp'); },

    // Replace Panel
    get btnAddPair() { return document.getElementById('btnAddPair'); },
    get btnRemovePair() { return document.getElementById('btnRemovePair'); },
    get btnPickReplaceSrc() { return document.getElementById('btnPickReplaceSrc'); },
    get btnSwapReplaceCols() { return document.getElementById('btnSwapReplaceCols'); },
    get btnPickReplaceTgt() { return document.getElementById('btnPickReplaceTgt'); },
    get replaceGrid() { return document.getElementById('replaceGrid'); },
    get btnProcessReplace() { return document.getElementById('btnProcessReplace'); },
    get btnBatchImport() { return document.getElementById('btnBatchImport'); },
    get btnPreviewReplace() { return document.getElementById('btnPreviewReplace'); },
    get replaceFrameStart() { return document.getElementById('replaceFrameStart'); },
    get replaceFrameEnd() { return document.getElementById('replaceFrameEnd'); },

    // Side Panel Extra
    get btnToggleSidePanel() { return document.getElementById('btnToggleSidePanel'); },
    get sidePanelExtra() { return document.getElementById('sidePanelExtra'); },

    // Top Bar / Toolbar
    get btnNew() { return document.getElementById('btnNew'); },
    get btnOpenShp() { return document.getElementById('btnOpenShp'); },
    get fileInShp() { return document.getElementById('fileInShp'); },
    get btnSaveShp() { return document.getElementById('btnSaveShp'); },
    get toolsBar() { return document.getElementById('toolsBar'); },

    get chkShowBackground() { return document.getElementById('chkShowBackground'); },
    get cbUseShadows() { return document.getElementById('cbUseShadows'); },
    get cbShowShadowOverlay() { return document.getElementById('cbShowShadowOverlay'); },
    get btnUndo() { return document.getElementById('btnUndo'); },
    get btnRedo() { return document.getElementById('btnRedo'); },

    // Selection Tools
    // Selection Tools
    get btnToolCrop() { return document.getElementById('btnToolCrop'); },
    get btnToolDeselect() { return document.getElementById('btnToolDeselect'); },

    // Left Panel
    get primaryColorPreview() { return document.getElementById('primaryColorPreview'); },
    get brushSize() { return document.getElementById('brushSize'); },
    get brushSizeVal() { return document.getElementById('brushSizeVal'); },
    get brushSizeBar() { return document.getElementById('brushSizeBar'); },
    get btnBrushMinus() { return document.getElementById('btnBrushMinus'); },
    get btnBrushPlus() { return document.getElementById('btnBrushPlus'); },

    // Selection Modes
    get propSelectionModes() { return document.getElementById('prop-selection-modes'); },
    get btnSelNew() { return document.getElementById('btn-sel-new'); },
    get btnSelAdd() { return document.getElementById('btn-sel-add'); },
    get btnSelSub() { return document.getElementById('btn-sel-sub'); },
    get btnSelInt() { return document.getElementById('btn-sel-int'); },
    get btnSelXor() { return document.getElementById('btn-sel-xor'); },

    // Tools
    get btnToolPencil() { return document.getElementById('btnToolPencil'); },
    get btnToolLine() { return document.getElementById('btnToolLine'); },
    get btnToolRect() { return document.getElementById('btnToolRect'); },
    get btnToolEraser() { return document.getElementById('btnToolEraser'); },
    get btnToolMovePixels() { return document.getElementById('btnToolMovePixels'); },
    get btnToolMoveSelection() { return document.getElementById('btnToolMoveSelection'); },
    get btnToolSelect() { return document.getElementById('btnToolSelect'); },
    get btnToolLasso() { return document.getElementById('btnToolLasso'); },
    get btnToolWand() { return document.getElementById('btnToolWand'); },
    get btnToolSpray() { return document.getElementById('btnToolSpray'); },
    get btnToolFill() { return document.getElementById('btnToolFill'); },
    get btnToolPicker() { return document.getElementById('btnToolPicker'); },

    // Properties
    get propBrushSize() { return document.getElementById('propBrushSize'); },
    get propBrushShape() { return document.getElementById('propBrushShape'); },
    get btnBrushShapeSquare() { return document.getElementById('btnBrushSquare'); },
    get btnBrushShapeCircle() { return document.getElementById('btnBrushCircle'); },
    get propSquareOptions() { return document.getElementById('propSquareOptions'); },
    get cbSquareFill() { return document.getElementById('cbSquareFill'); },
    get inpSquareFillColor() { return document.getElementById('inpSquareFillColor'); },

    // Spray Density
    get sprayDensity() { return document.getElementById('sprayDensity'); },
    get sprayDensityVal() { return document.getElementById('sprayDensityVal'); },
    get sprayDensityBar() { return document.getElementById('sprayDensityBar'); },
    get btnSprayDensityMinus() { return document.getElementById('btnSprayDensityMinus'); },
    get btnSprayDensityPlus() { return document.getElementById('btnSprayDensityPlus'); },

    // Fill Options
    get fillTolerance() { return document.getElementById('fillTolerance'); },
    get fillToleranceVal() { return document.getElementById('fillToleranceVal'); },
    get fillToleranceBar() { return document.getElementById('fillToleranceBar'); },
    get btnFillToleranceMinus() { return document.getElementById('btnFillToleranceMinus'); },
    get btnFillTolerancePlus() { return document.getElementById('btnFillTolerancePlus'); },
    get cbFillContiguous() { return document.getElementById('cbFillContiguous'); },

    // Color Shift
    get btnToolColorShift() { return document.getElementById('btnToolColorShift'); },
    get propColorShift() { return document.getElementById('prop-colorShift'); },
    get btnColorShiftMinus() { return document.getElementById('btnColorShiftMinus'); },
    get btnColorShiftPlus() { return document.getElementById('btnColorShiftPlus'); },
    get colorShiftAmount() { return document.getElementById('colorShiftAmount'); },
    get colorShiftAmtVal() { return document.getElementById('colorShiftAmtVal'); },
    get colorShiftBar() { return document.getElementById('colorShiftBar'); },
    get btnColorShiftAmtMinus() { return document.getElementById('btnColorShiftAmtMinus'); },
    get btnColorShiftAmtPlus() { return document.getElementById('btnColorShiftAmtPlus'); },
    get radColorShiftScope() { return document.getElementsByName('colorShiftScope'); },
    get chkIgnoreColor0() { return document.getElementById('chkIgnoreColor0'); },
    get chkCycleShiftPalette() { return document.getElementById('chkCycleShiftPalette'); },

    // Layer Ops
    get btnAddLayer() { return document.getElementById('btnAddLayer'); },
    get btnDelLayer() { return document.getElementById('btnDelLayer'); },
    get btnDuplicateLayer() { return document.getElementById('btnDuplicateLayer'); },
    get btnLayerUp() { return document.getElementById('btnLayerUp'); },
    get btnLayerDown() { return document.getElementById('btnLayerDown'); },
    get btnLayerMerge() { return document.getElementById('btnLayerMerge'); },
    get btnLayerProps() { return document.getElementById('btnLayerProps'); },


    // Frame Ops
    get btnAddFrame() { return document.getElementById('btnAddFrame'); },
    get btnDelFrame() { return document.getElementById('btnDelFrame'); },
    // Animation play controls (deprecated in current toolbar layout)
    get btnStop() { return document.getElementById('btnStop'); },

    // Modals
    get resizeImageDialog() { return document.getElementById('resizeImageDialog'); },
    get inpResizeW() { return document.getElementById('inpResizeW'); },
    get inpResizeH() { return document.getElementById('inpResizeH'); },
    get inpResizePct() { return document.getElementById('inpResizePct'); },
    get btnResizePctMinus() { return document.getElementById('btnResizePctMinus'); },
    get btnResizePctPlus() { return document.getElementById('btnResizePctPlus'); },
    get btnResizeApply() { return document.getElementById('btnResizeApply'); },
    get btnResizeCancel() { return document.getElementById('btnResizeCancel'); },
    get lblResizeOriginalSize() { return document.getElementById('lblResizeOriginalSize'); },
    get lblResizeFinalSize() { return document.getElementById('lblResizeFinalSize'); },
    get rowResizePostProcess() { return document.getElementById('rowResizePostProcess'); },
    get chkResizePostProcess() { return document.getElementById('chkResizePostProcess'); },
    get grpResizePostProcessMethods() { return document.getElementById('grpResizePostProcessMethods'); },
    get valResizePostProcessMethod() {
        const rad = document.querySelector('input[name="radResizePostProcess"]:checked');
        return rad ? rad.value : 'nearest';
    },
    get chkResizeProtectRemap() { return document.getElementById('chkResizeProtectRemap'); },
    get chkScaleProtectRemap() { return document.getElementById('chkScaleProtectRemap'); },
    get progressModal() { return document.getElementById('progressModal'); },
    get pbResizeProgress() { return document.getElementById('pbResizeProgress'); },
    get lblProgressText() { return document.getElementById('lblProgressText'); },
    get lblResizeMethodDescription() { return document.getElementById('lblResizeMethodDescription'); },
    get chkResizeAspectRatio() { return document.getElementById('chkResizeAspectRatio'); },
    get selResizeMethod() { return document.getElementById('selResizeMethod'); },
    get selResizeZoom() { return document.getElementById('selResizeZoom'); }, // Legacy dropdown
    get inpResizeZoom() { return document.getElementById('inpResizeZoom'); },
    get btnResizeZoomMinus() { return document.getElementById('btnResizeZoomMinus'); },
    get btnResizeZoomPlus() { return document.getElementById('btnResizeZoomPlus'); },
    get btnResizeZoomReset() { return document.getElementById('btnResizeZoomReset'); },
    get resizeZoomBar() { return document.getElementById('resizeZoomBar'); },
    get resizeZoomVal() { return document.getElementById('resizeZoomVal'); },
    get canvasResizePreview() { return document.getElementById('canvasResizePreview'); },
    get resizePreviewScrollContainer() { return document.getElementById('resizePreviewScrollContainer'); },
    get resizePreviewScene() { return document.getElementById('resizePreviewScene'); },

    get canvasResizeUnifiedDialog() { return document.getElementById('canvasResizeUnifiedDialog'); },
    get menuResizeCanvasUnified() { return document.getElementById('menuResizeCanvasUnified'); },
    get radioResizeModeClassic() { return document.getElementById('radioResizeModeClassic'); },
    get radioResizeModeAdvanced() { return document.getElementById('radioResizeModeAdvanced'); },
    get panelResizeClassic() { return document.getElementById('panelResizeClassic'); },
    get panelResizeAdvanced() { return document.getElementById('panelResizeAdvanced'); },
    get chkAdvAutoFit() { return document.getElementById('chkAdvAutoFit'); },
    get unifiedResizeZoomGrp() { return document.getElementById('unifiedResizeZoomGrp'); },
    get selUnifiedResizeZoom() { return document.getElementById('selUnifiedResizeZoom'); },
    get lblUnifiedFinalSize() { return document.getElementById('lblUnifiedFinalSize'); },
    get unifiedResizePreviewContainer() { return document.getElementById('unifiedResizePreviewContainer'); },
    get canvasUnifiedResizePreview() { return document.getElementById('canvasUnifiedResizePreview'); },
    get unifiedResizeOverlay() { return document.getElementById('unifiedResizeOverlay'); },
    get btnUnifiedResizeCancel() { return document.getElementById('btnUnifiedResizeCancel'); },
    get inpCanvasW() { return document.getElementById('inpCanvasW'); },
    get inpCanvasH() { return document.getElementById('inpCanvasH'); },
    get selCanvasAnchor() { return document.getElementById('selCanvasAnchor'); },
    get chkCanvasAspectRatio() { return document.getElementById('chkCanvasAspectRatio'); },

    get inpAdvOffTop() { return document.getElementById('inpAdvOffTop'); },
    get inpAdvOffLeft() { return document.getElementById('inpAdvOffLeft'); },
    get inpAdvOffBot() { return document.getElementById('inpAdvOffBot'); },
    get inpAdvOffRight() { return document.getElementById('inpAdvOffRight'); },
    get btnAdvResetOffsets() { return document.getElementById('btnAdvResetOffsets'); },
    get btnUnifiedResizeApply() { return document.getElementById('btnUnifiedResizeApply'); },

    get closeModal() { return document.querySelector('.close-modal'); },

    // Export SHP Dialog
    get exportShpDialog() { return document.getElementById('exportShpDialog'); },
    get txtExpShpName() { return document.getElementById('txtExpShpName'); },
    get selExpShpType() { return document.getElementById('selExpShpType'); },
    get btnCancelExpShp() { return document.getElementById('btnCancelExpShp'); },
    get btnConfirmExpShp() { return document.getElementById('btnConfirmExpShp'); },

    // Import SHP Dialog
    get importShpDialog() { return document.getElementById('importShpDialog'); },
    get impShpPalGrid() { return document.getElementById('impShpPalGrid'); },
    get btnImpShpLoadFile() { return document.getElementById('btnImpShpLoadFile'); },
    get impShpCanvas() { return document.getElementById('impShpCanvas'); },
    get impShpInfo() { return document.getElementById('impShpInfo'); },
    get btnImpShpPlay() { return document.getElementById('btnImpShpPlay'); },
    get btnImpShpStep() { return document.getElementById('btnImpShpStep'); },
    get impShpSlider() { return document.getElementById('impShpSlider'); },
    get impShpCounter() { return document.getElementById('impShpCounter'); },
    get btnCancelImpShp() { return document.getElementById('btnCancelImpShp'); },
    get btnConfirmImpShp() { return document.getElementById('btnConfirmImpShp'); },
    get chkImpShpNoShadow() { return document.getElementById('chkImpShpNoShadow'); },
    get inpImpShpFile() { return document.getElementById('inpImpShpFile'); },

    // Replace Dialog (Legacy)
    get replaceColorDialog() { return document.getElementById('replaceColorDialog'); },
    get btnRepCancel() { return document.getElementById('btnRepCancel'); },
    get btnRepApply() { return document.getElementById('btnRepApply'); },

    // Status Bar
    get statusBar() { return document.getElementById('statusBar'); },
    get resDisplay() { return document.getElementById('resDisplay'); },
    get statusSelectionInfo() { return document.getElementById('statusSelectionInfo'); },
    get selectionDisplay() { return document.getElementById('selectionDisplay'); },
    get coordsDisplay() { return document.getElementById('coordsDisplay'); },
    get btnZoomMinus() { return document.getElementById('btnZoomMinus'); },
    get btnZoomPlus() { return document.getElementById('btnZoomPlus'); },
    get btnZoomReset() { return document.getElementById('btnZoomReset'); },
    get inpZoom() { return document.getElementById('inpZoom'); },
    get zoomSizeBar() { return document.getElementById('zoomSizeBar'); },
    get zoomVal() { return document.getElementById('zoomVal'); },

    // Grid
    get btnToggleGrid() { return document.getElementById('btnToggleGrid'); },
    get menuGridShowNone() { return document.getElementById('menuGridShowNone'); },
    get menuGridShowLight() { return document.getElementById('menuGridShowLight'); },
    get menuGridShowDark() { return document.getElementById('menuGridShowDark'); },
    get pixelGridOverlay() { return document.getElementById('pixelGridOverlay'); },

    // Confirm Dialog
    get confirmDialog() { return document.getElementById('confirmDialog'); },
    get confirmTitle() { return document.getElementById('confirmTitle'); },
    get confirmMessage() { return document.getElementById('confirmMessage'); },
    get btnConfirmYes() { return document.getElementById('btnConfirmYes'); },
    get btnConfirmNo() { return document.getElementById('btnConfirmNo'); },

    // Advanced Export Sprite Sheet
    get exportSpriteSheetDialog() { return document.getElementById('exportSpriteSheetDialog'); },
    get inpExpSheetStart() { return document.getElementById('inpExpSheetStart'); },
    get inpExpSheetEnd() { return document.getElementById('inpExpSheetEnd'); },
    get inpExpSheetDiv() { return document.getElementById('inpExpSheetDiv'); },
    get selExpSheetOrder() { return document.getElementById('selExpSheetOrder'); },
    get selExpSheetFormat() { return document.getElementById('selExpSheetFormat'); },
    get txtExpSheetName() { return document.getElementById('txtExpSheetName'); },
    get btnExpSheetCancel() { return document.getElementById('btnExpSheetCancel'); },
    get btnExpSheetOk() { return document.getElementById('btnExpSheetOk'); },
    get lblExpSheetFinalDim() { return document.getElementById('lblExpSheetFinalDim'); },


    // Advanced Export Frame Range
    get exportFrameRangeDialog() { return document.getElementById('exportFrameRangeDialog'); },
    get txtExpRangePrefix() { return document.getElementById('txtExpRangePrefix'); },
    get selExpRangeFormat() { return document.getElementById('selExpRangeFormat'); },
    get inpExpRangeStart() { return document.getElementById('inpExpRangeStart'); },
    get inpExpRangeEnd() { return document.getElementById('inpExpRangeEnd'); },
    get previewRangeList() { return document.getElementById('previewRangeList'); },
    get btnExpRangeCancel() { return document.getElementById('btnExpRangeCancel'); },
    get btnExpRangeOk() { return document.getElementById('btnExpRangeOk'); },

    // Advanced Import Sprite Sheet
    get importSpriteSheetDialog() { return document.getElementById('importSpriteSheetDialog'); },
    get dropZoneSpriteSheet() { return document.getElementById('dropZoneSpriteSheet'); },
    get fileImpSpriteSheet() { return document.getElementById('fileImpSpriteSheet'); },
    get btnClearSpriteSheet() { return document.getElementById('btnClearSpriteSheet'); },
    get spriteSheetFileInfo() { return document.getElementById('spriteSheetFileInfo'); },
    get btnImpSheetCancel() { return document.getElementById('btnImpSheetCancel'); },
    get btnImpSheetOk() { return document.getElementById('btnImpSheetOk'); },
    get impSpriteSheetControls() { return document.getElementById('impSpriteSheetControls'); },
    get btnImpSheetWDec() { return document.getElementById('btnImpSheetWDec'); },
    get btnImpSheetWInc() { return document.getElementById('btnImpSheetWInc'); },
    get btnImpSheetHDec() { return document.getElementById('btnImpSheetHDec'); },
    get btnImpSheetHInc() { return document.getElementById('btnImpSheetHInc'); },
    get inpImpSheetW() { return document.getElementById('inpImpSheetW'); },
    get inpImpSheetH() { return document.getElementById('inpImpSheetH'); },
    get rowImpSheetComp() { return document.getElementById('rowImpSheetComp'); },
    get selImpSheetComp() { return document.getElementById('selImpSheetComp'); },

    get inpImpSheetDiv() { return document.getElementById('inpImpSheetDiv'); },
    get inpImpSheetStart() { return document.getElementById('inpImpSheetStart'); },
    get inpImpSheetEnd() { return document.getElementById('inpImpSheetEnd'); },



    // Advanced Import another SHP
    get importOtherShpDialog() { return document.getElementById('importOtherShpDialog'); },
    get dropZoneOtherShp() { return document.getElementById('dropZoneOtherShp'); },
    get fileImpOtherShp() { return document.getElementById('fileImpOtherShp'); },
    get btnClearOtherShp() { return document.getElementById('btnClearOtherShp'); },
    get otherShpFileInfo() { return document.getElementById('otherShpFileInfo'); },
    get impOtherShpControls() { return document.getElementById('impOtherShpControls'); },
    get inpImpOtherStart() { return document.getElementById('inpImpOtherStart'); },

    get inpImpOtherEnd() { return document.getElementById('inpImpOtherEnd'); },
    get btnImpOtherCancel() { return document.getElementById('btnImpOtherCancel'); },
    get btnImpOtherOk() { return document.getElementById('btnImpOtherOk'); },
    get rowImpOtherComp() { return document.getElementById('rowImpOtherComp'); },
    get selImpOtherComp() { return document.getElementById('selImpOtherComp'); },
    // Advanced Import From Images
    get importFromImageDialog() { return document.getElementById('importFromImageDialog'); },
    get dropZoneFromImage() { return document.getElementById('dropZoneFromImage'); },
    get fileImpFromImage() { return document.getElementById('fileImpFromImage'); },
    get btnClearFromImage() { return document.getElementById('btnClearFromImage'); },
    get impFromImageList() { return document.getElementById('impFromImageList'); },
    get inpImpFromImageW() { return document.getElementById('inpImpFromImageW'); },
    get inpImpFromImageH() { return document.getElementById('inpImpFromImageH'); },
    get btnImpFromImageWDec() { return document.getElementById('btnImpFromImageWDec'); },
    get btnImpFromImageWInc() { return document.getElementById('btnImpFromImageWInc'); },
    get btnImpFromImageHDec() { return document.getElementById('btnImpFromImageHDec'); },
    get btnImpFromImageHInc() { return document.getElementById('btnImpFromImageHInc'); },
    get btnImpFromImageCancel() { return document.getElementById('btnImpFromImageCancel'); },
    get btnImpFromImageOk() { return document.getElementById('btnImpFromImageOk'); },
    get rowImpFromImageComp() { return document.getElementById('rowImpFromImageComp'); },
    get selImpFromImageComp() { return document.getElementById('selImpFromImageComp'); },
    get impFromImageProgress() { return document.getElementById('impFromImageProgress'); },
    get lblImpFromImageProgress() { return document.getElementById('lblImpFromImageProgress'); },
    get barImpFromImageProgress() { return document.getElementById('barImpFromImageProgress'); },
    get btnImpFromImageCancel() { return document.getElementById('btnImpFromImageCancel'); },
    get btnClearFromImage() { return document.getElementById('btnClearFromImage'); },
    get dropZoneFromImage() { return document.getElementById('dropZoneFromImage'); },

    get btnNewShpCancel() { return document.getElementById('btnNewShpCancel'); },
    get btnNewShpCreate() { return document.getElementById('btnNewShpCreate'); },

    // Unified Canvas Resize Dialog
    get canvasResizeUnifiedDialog() { return document.getElementById('canvasResizeUnifiedDialog'); },
    get radioResizeModeClassic() { return document.getElementById('radioResizeModeClassic'); },
    get radioResizeModeAdvanced() { return document.getElementById('radioResizeModeAdvanced'); },
    get panelResizeClassic() { return document.getElementById('panelResizeClassic'); },
    get panelResizeAdvanced() { return document.getElementById('panelResizeAdvanced'); },
    // Classic mode
    get inpCanvasW() { return document.getElementById('inpCanvasW'); },
    get inpCanvasH() { return document.getElementById('inpCanvasH'); },
    get chkCanvasAspectRatio() { return document.getElementById('chkCanvasAspectRatio'); },
    get selCanvasAnchor() { return document.getElementById('selCanvasAnchor'); },
    // Advanced mode
    get inpAdvOffTop() { return document.getElementById('inpAdvOffTop'); },
    get inpAdvOffBot() { return document.getElementById('inpAdvOffBot'); },
    get inpAdvOffLeft() { return document.getElementById('inpAdvOffLeft'); },
    get inpAdvOffRight() { return document.getElementById('inpAdvOffRight'); },
    get btnAdvResetOffsets() { return document.getElementById('btnAdvResetOffsets'); },
    // Shared / Preview
    get chkAdvAutoFit() { return document.getElementById('chkAdvAutoFit'); },
    get selUnifiedResizeZoom() { return document.getElementById('selUnifiedResizeZoom'); },
    get unifiedResizeZoomGrp() { return document.getElementById('unifiedResizeZoomGrp'); },
    get unifiedResizePreviewContainer() { return document.getElementById('unifiedResizePreviewContainer'); },
    get unifiedResizeScene() { return document.getElementById('unifiedResizeScene'); },
    get canvasUnifiedResizePreview() { return document.getElementById('canvasUnifiedResizePreview'); },
    get unifiedResizeOverlay() { return document.getElementById('unifiedResizeOverlay'); },
    get lblUnifiedFinalSize() { return document.getElementById('lblUnifiedFinalSize'); },
    get btnUnifiedResizeApply() { return document.getElementById('btnUnifiedResizeApply'); },
    get btnUnifiedResizeCancel() { return document.getElementById('btnUnifiedResizeCancel'); },

    // External SHP Layer Properties
    get layerPropsExternalShpGroup() { return document.getElementById('layerPropsExternalShpGroup'); },
    get layerPropsOffX() { return document.getElementById('layerPropsOffX'); },
    get layerPropsOffY() { return document.getElementById('layerPropsOffY'); },
    get btnLayerOffXMinus() { return document.getElementById('btnLayerOffXMinus'); },
    get btnLayerOffXPlus() { return document.getElementById('btnLayerOffXPlus'); },
    get btnLayerOffYMinus() { return document.getElementById('btnLayerOffYMinus'); },
    get btnLayerOffYPlus() { return document.getElementById('btnLayerOffYPlus'); },
    get btnLayerChangeShp() { return document.getElementById('btnLayerChangeShp'); },

    // External SHP Dialog
    get externalShpDialog() { return document.getElementById('externalShpDialog'); },
    get extShpPalGrid() { return document.getElementById('extShpPalGrid'); },
    get btnExtShpLoadFile() { return document.getElementById('btnExtShpLoadFile'); },
    get extShpCanvas() { return document.getElementById('extShpCanvas'); },
    get extShpInfo() { return document.getElementById('extShpInfo'); },
    get btnExtShpPrev() { return document.getElementById('btnExtShpPrev'); },
    get btnExtShpNext() { return document.getElementById('btnExtShpNext'); },
    get extShpSlider() { return document.getElementById('extShpSlider'); },
    get extShpFrameInput() { return document.getElementById('extShpFrameInput'); },
    get extShpCounter() { return document.getElementById('extShpCounter'); },
    get btnCancelExtShp() { return document.getElementById('btnCancelExtShp'); },
    get btnConfirmExtShp() { return document.getElementById('btnConfirmExtShp'); },
    get inpExtShpPal() { return document.getElementById('inpExtShpPal'); },
    get inpExtShpFile() { return document.getElementById('inpExtShpFile'); },
    get menuItemExtPalettes() { return document.getElementById('menuItemExtPalettes'); },
    get extPalettesMenuDropdown() { return document.getElementById('extPalettesMenuDropdown'); },
    get layerPropsPreviewCol() { return document.getElementById('layerPropsPreviewCol'); },
    get layerPropsExternalPreview() { return document.getElementById('layerPropsExternalPreview'); },
    get layerPropsExternalInfo() { return document.getElementById('layerPropsExternalInfo'); }

};

window.elements = elements;
