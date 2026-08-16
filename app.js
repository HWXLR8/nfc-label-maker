(function () {
  'use strict';

  const Core = window.NfcCardDesignerCore;
  const Pdf = window.NfcCardDesignerPdf;
  const template = Object.freeze({
    viewBox: [0, 0, 648, 1020],
    placeholder: { x: 0, y: 0, width: 648, height: 1020, rx: 36, ry: 36 },
    svg: '<svg width="648" height="1020" viewBox="0 0 648 1020" xmlns="http://www.w3.org/2000/svg"><g id="artwork-slot"></g></svg>',
  });
  const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const DEFAULT_MARGIN_MM = 1;
  const state = {
    cards: [],
    draft: null,
    dragDepth: 0,
  };

  const elements = {
    addImages: document.querySelector('#add-images'),
    cardGrid: document.querySelector('#card-grid'),
    cropMarks: document.querySelector('#crop-marks'),
    downloadPdf: document.querySelector('#download-pdf'),
    editorDialog: document.querySelector('#editor-dialog'),
    editorMargin: document.querySelector('#editor-margin'),
    editorMarginOutput: document.querySelector('#editor-margin-output'),
    editorReset: document.querySelector('#editor-reset'),
    editorSave: document.querySelector('#editor-save'),
    editorStage: document.querySelector('#editor-stage'),
    editorZoom: document.querySelector('#editor-zoom'),
    emptyState: document.querySelector('#empty-state'),
    fileInput: document.querySelector('#file-input'),
    openPrint: document.querySelector('#open-print'),
    outlines: document.querySelector('#outlines'),
    printCount: document.querySelector('#print-count'),
    printDialog: document.querySelector('#print-dialog'),
    status: document.querySelector('#status'),
  };

  initialize();

  function initialize() {
    elements.addImages.addEventListener('click', openFilePicker);
    elements.emptyState.addEventListener('click', openFilePicker);
    elements.fileInput.addEventListener('change', () => {
      void addFiles(elements.fileInput.files);
      elements.fileInput.value = '';
    });
    elements.cardGrid.addEventListener('click', handleCardAction);
    elements.openPrint.addEventListener('click', openPrintDialog);
    elements.downloadPdf.addEventListener('click', () => void downloadPdf());
    elements.editorMargin.addEventListener('change', changeDraftMargin);
    elements.editorMargin.addEventListener('keydown', handleMarginKeydown);
    elements.editorZoom.addEventListener('input', changeDraftZoom);
    elements.editorReset.addEventListener('click', resetDraft);
    elements.editorSave.addEventListener('click', saveDraft);
    elements.editorDialog.addEventListener('close', cancelDraft);
    bindEditorDrag();
    bindFileDrop();
    window.addEventListener('paste', handlePaste);
    window.addEventListener('pagehide', releasePreviewUrls);
    renderGrid();
  }

  function warnBeforeUnload(event) {
    event.preventDefault();
    event.returnValue = true;
  }

  function syncBeforeUnloadWarning() {
    if (state.cards.length > 0) {
      window.addEventListener('beforeunload', warnBeforeUnload);
    } else {
      window.removeEventListener('beforeunload', warnBeforeUnload);
    }
  }

  function openFilePicker() {
    elements.fileInput.click();
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setBusy(true, `Adding ${files.length} image${files.length === 1 ? '' : 's'}…`);
    const errors = [];
    let added = 0;

    for (const file of files) {
      try {
        const asset = await loadAsset(file);
        const card = {
          id: makeId(),
          asset,
          marginMm: DEFAULT_MARGIN_MM,
          transform: Core.resetTransform(),
          previewUrl: '',
          previewVersion: 0,
        };
        state.cards.push(card);
        added += 1;
        renderGrid();
        await refreshCardPreview(card);
      } catch (error) {
        errors.push(`${file.name || 'Clipboard image'}: ${error.message}`);
      }
    }

    setBusy(
      false,
      errors.length
        ? `${added} added. ${errors.join(' ')}`
        : `${added} image${added === 1 ? '' : 's'} added.`,
      errors.length > 0,
    );
    renderGrid();
  }

  function loadAsset(file) {
    if (!supportedTypes.has(file.type)) {
      return Promise.reject(new Error('Use a JPEG, PNG, or WebP file.'));
    }
    return readAsDataUrl(file).then(
      (dataUrl) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            if (!image.naturalWidth || !image.naturalHeight) {
              reject(new Error('The image has no usable dimensions.'));
              return;
            }
            resolve({
              id: makeId(),
              name: file.name || 'Clipboard image',
              dataUrl,
              width: image.naturalWidth,
              height: image.naturalHeight,
            });
          };
          image.onerror = () => reject(new Error('The image could not be decoded.'));
          image.src = dataUrl;
        }),
    );
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('The file could not be read.'));
      reader.readAsDataURL(file);
    });
  }

  function renderGrid() {
    syncBeforeUnloadWarning();
    elements.emptyState.hidden = state.cards.length > 0;
    elements.openPrint.disabled = state.cards.length === 0;
    elements.cardGrid.innerHTML = state.cards
      .map((card) => {
        const preview = card.previewUrl
          ? `<img src="${card.previewUrl}">`
          : '<span class="preview-loading"></span>';
        return `<article class="label-card" data-card-id="${card.id}">
          <button class="label-preview" type="button" data-action="edit">${preview}</button>
          <div class="label-details">
            <div class="card-actions">
              <button class="button secondary" type="button" data-action="duplicate">Duplicate</button>
              <button class="button secondary delete" type="button" data-action="delete">×</button>
            </div>
          </div>
        </article>`;
      })
      .join('');
  }

  function handleCardAction(event) {
    const button = event.target.closest('[data-action]');
    const cardElement = event.target.closest('[data-card-id]');
    if (!button || !cardElement) return;
    const index = state.cards.findIndex((card) => card.id === cardElement.dataset.cardId);
    if (index < 0) return;
    const action = button.dataset.action;
    if (action === 'edit') openEditor(state.cards[index]);
    if (action === 'duplicate') duplicateCard(index);
    if (action === 'delete') deleteCard(index);
  }

  function duplicateCard(index) {
    const source = state.cards[index];
    const duplicate = {
      ...source,
      id: makeId(),
      transform: { ...source.transform },
      previewUrl: '',
      previewVersion: 0,
    };
    state.cards.splice(index + 1, 0, duplicate);
    renderGrid();
    void refreshCardPreview(duplicate);
    showStatus('Label duplicated.');
  }

  function deleteCard(index) {
    const [card] = state.cards.splice(index, 1);
    if (card.previewUrl) URL.revokeObjectURL(card.previewUrl);
    renderGrid();
    showStatus('Label deleted.');
  }

  function openEditor(card) {
    state.draft = {
      cardId: card.id,
      marginMm: card.marginMm ?? DEFAULT_MARGIN_MM,
      transform: { ...card.transform },
    };
    elements.editorMargin.value = String(state.draft.marginMm);
    elements.editorZoom.value = String(state.draft.transform.zoom);
    renderEditor();
    elements.editorDialog.showModal();
  }

  function renderEditor() {
    const card = getDraftCard();
    if (!card || !state.draft) return;
    const template = getDraftTemplate();
    const printDimensions = Core.getPrintDimensionsMm(template);
    elements.editorMarginOutput.textContent = `Label: ${formatMillimetres(
      printDimensions.height,
    )} × ${formatMillimetres(printDimensions.width)} mm`;
    const svg = Core.composeSvg(
      template,
      card.asset,
      state.draft.transform,
      `editor-${card.id}`,
    );
    const printScaleX = template.printScaleX || 1;
    const printScaleY = template.printScaleY || 1;
    elements.editorStage.innerHTML = `<div class="editor-card-reference">
        <div class="editor-label-output" style="width: ${Core.formatNumber(
          printScaleX * 100,
        )}%; height: ${Core.formatNumber(printScaleY * 100)}%">${svg}</div>
      </div>`;
  }

  function updateEditorArtwork() {
    const card = getDraftCard();
    if (!card || !state.draft) return;
    const template = getDraftTemplate();
    state.draft.transform = Core.clampTransform(
      card.asset.width,
      card.asset.height,
      template.placeholder,
      state.draft.transform,
    );
    const artwork = elements.editorStage.querySelector('#card-artwork');
    if (!artwork) return;
    const rect = Core.getArtworkRect(
      card.asset.width,
      card.asset.height,
      template.placeholder,
      state.draft.transform,
    );
    artwork.setAttribute('x', Core.formatNumber(rect.x));
    artwork.setAttribute('y', Core.formatNumber(rect.y));
    artwork.setAttribute('width', Core.formatNumber(rect.width));
    artwork.setAttribute('height', Core.formatNumber(rect.height));
    elements.editorZoom.value = String(rect.zoom);
  }

  function changeDraftZoom() {
    if (!state.draft) return;
    state.draft.transform.zoom = Number(elements.editorZoom.value);
    updateEditorArtwork();
  }

  function changeDraftMargin() {
    if (!state.draft) return;
    state.draft.marginMm = Core.normalizePrintMargin(elements.editorMargin.value);
    elements.editorMargin.value = String(state.draft.marginMm);
    renderEditor();
  }

  function handleMarginKeydown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    elements.editorMargin.blur();
  }

  function resetDraft() {
    if (!state.draft) return;
    state.draft.marginMm = DEFAULT_MARGIN_MM;
    state.draft.transform = Core.resetTransform();
    elements.editorMargin.value = String(state.draft.marginMm);
    elements.editorZoom.value = '1';
    renderEditor();
  }

  function saveDraft() {
    const card = getDraftCard();
    if (!card || !state.draft) return;
    card.marginMm = state.draft.marginMm;
    card.transform = { ...state.draft.transform };
    state.draft = null;
    elements.editorDialog.close();
    renderGrid();
    void refreshCardPreview(card);
    showStatus('Label updated.');
  }

  function cancelDraft() {
    state.draft = null;
  }

  function getDraftCard() {
    return state.draft
      ? state.cards.find((card) => card.id === state.draft.cardId)
      : null;
  }

  function getDraftTemplate() {
    if (!state.draft) return null;
    return Core.applyPrintMargin(
      template,
      state.draft.marginMm,
    );
  }

  function bindEditorDrag() {
    let drag = null;
    elements.editorStage.addEventListener('pointerdown', (event) => {
      if (!state.draft) return;
      drag = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        panX: state.draft.transform.panX,
        panY: state.draft.transform.panY,
      };
      elements.editorStage.setPointerCapture(event.pointerId);
      elements.editorStage.classList.add('dragging');
    });
    elements.editorStage.addEventListener('pointermove', (event) => {
      if (!drag || !state.draft || event.pointerId !== drag.pointerId) return;
      const template = getDraftTemplate();
      const svg = elements.editorStage.querySelector('svg');
      if (!svg) return;
      const bounds = svg.getBoundingClientRect();
      const scaleX = template.viewBox[2] / bounds.width;
      const scaleY = template.viewBox[3] / bounds.height;
      state.draft.transform.panX = drag.panX + (event.clientX - drag.clientX) * scaleX;
      state.draft.transform.panY = drag.panY + (event.clientY - drag.clientY) * scaleY;
      updateEditorArtwork();
    });
    const finishDrag = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag = null;
      elements.editorStage.classList.remove('dragging');
    };
    elements.editorStage.addEventListener('pointerup', finishDrag);
    elements.editorStage.addEventListener('pointercancel', finishDrag);
    elements.editorStage.addEventListener(
      'wheel',
      (event) => {
        const card = getDraftCard();
        if (!card || !state.draft) return;
        event.preventDefault();
        const template = getDraftTemplate();
        const svg = elements.editorStage.querySelector('svg');
        if (!svg) return;
        const bounds = svg.getBoundingClientRect();
        const insideSvg =
          event.clientX >= bounds.left &&
          event.clientX <= bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY <= bounds.bottom;
        const point = insideSvg
          ? {
              x:
                template.viewBox[0] +
                ((event.clientX - bounds.left) / bounds.width) * template.viewBox[2],
              y:
                template.viewBox[1] +
                ((event.clientY - bounds.top) / bounds.height) * template.viewBox[3],
            }
          : {
              x: template.placeholder.x + template.placeholder.width / 2,
              y: template.placeholder.y + template.placeholder.height / 2,
            };
        const delta =
          event.deltaY *
          (event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? 500
              : 1);
        const nextZoom = state.draft.transform.zoom * Math.exp(-delta * 0.0015);
        state.draft.transform = Core.zoomTransformAtPoint(
          card.asset.width,
          card.asset.height,
          template.placeholder,
          state.draft.transform,
          nextZoom,
          point,
        );
        updateEditorArtwork();
      },
      { passive: false },
    );
  }

  function bindFileDrop() {
    window.addEventListener('dragenter', (event) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      state.dragDepth += 1;
      document.body.classList.add('dragging');
    });
    window.addEventListener('dragover', (event) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', (event) => {
      if (!hasFiles(event.dataTransfer)) return;
      state.dragDepth = Math.max(0, state.dragDepth - 1);
      if (!state.dragDepth) document.body.classList.remove('dragging');
    });
    window.addEventListener('drop', (event) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      state.dragDepth = 0;
      document.body.classList.remove('dragging');
      void addFiles(event.dataTransfer.files);
    });
  }

  function hasFiles(dataTransfer) {
    return dataTransfer && Array.from(dataTransfer.types || []).includes('Files');
  }

  function releasePreviewUrls() {
    state.cards.forEach((card) => {
      if (card.previewUrl) URL.revokeObjectURL(card.previewUrl);
    });
  }

  function handlePaste(event) {
    const files = Array.from(event.clipboardData?.files || []).filter((file) =>
      file.type.startsWith('image/'),
    );
    if (files.length) {
      event.preventDefault();
      void addFiles(files);
    }
  }

  async function refreshCardPreview(card) {
    const version = ++card.previewVersion;
    try {
      const canvas = await renderCardToCanvas(card, 0.42, true);
      const blob = await canvasToBlob(canvas, 'image/webp', 0.9);
      if (!state.cards.includes(card) || version !== card.previewVersion) return;
      if (card.previewUrl) URL.revokeObjectURL(card.previewUrl);
      card.previewUrl = URL.createObjectURL(blob);
      renderGrid();
    } catch (error) {
      showStatus(`Preview failed: ${error.message}`, true);
    }
  }

  async function renderCardToCanvas(card, resolutionScale, transparent) {
    const outputTemplate = Core.applyPrintMargin(template, card.marginMm);
    const svg = Core.composeSvg(
      outputTemplate,
      card.asset,
      card.transform,
      `render-${card.id}-${makeId()}`,
    );
    const source = await loadSvg(svg);
    const canvas = document.createElement('canvas');
    const printDimensions = Core.getPrintDimensionsMm(outputTemplate);
    const pixelsPerMm = Math.max(1, Math.round(20 * resolutionScale));
    canvas.width = Math.round(printDimensions.width * pixelsPerMm);
    canvas.height = Math.round(printDimensions.height * pixelsPerMm);
    const context = canvas.getContext('2d', { alpha: Boolean(transparent) });
    if (!transparent) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function loadSvg(svg) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('The composed label could not be rendered.'));
      };
      image.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Canvas encoding failed.'))),
        type,
        quality,
      );
    });
  }

  function openPrintDialog() {
    const pages = Math.ceil(state.cards.length / Pdf.CARDS_PER_PAGE);
    elements.printCount.textContent = `${state.cards.length} label${state.cards.length === 1 ? '' : 's'} · ${pages} page${pages === 1 ? '' : 's'}`;
    elements.printDialog.showModal();
  }

  async function downloadPdf() {
    elements.printDialog.close();
    setBusy(true, `Rendering ${state.cards.length} label${state.cards.length === 1 ? '' : 's'} at 300 DPI…`);
    try {
      const renderedCards = [];
      for (let index = 0; index < state.cards.length; index += 1) {
        const card = state.cards[index];
        showStatus(`Rendering label ${index + 1} of ${state.cards.length}…`);
        const canvas = await renderCardToCanvas(card, 1);
        const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.95);
        const outputTemplate = Core.applyPrintMargin(template, card.marginMm);
        renderedCards.push({
          jpegBytes: new Uint8Array(await jpeg.arrayBuffer()),
          cornerRadiusRatio: Core.getCornerRadiusRatio(outputTemplate),
          marginMm: outputTemplate.printMarginMm || 0,
        });
      }
      const bytes = Pdf.createPdf(renderedCards, {
        cropMarks: elements.cropMarks.checked,
        outlines: elements.outlines.checked,
      });
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `nfc-card-labels-${new Date().toISOString().slice(0, 10)}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setBusy(false, 'PDF downloaded. Print it at 100% scale.');
    } catch (error) {
      setBusy(false, `PDF creation failed: ${error.message}`, true);
    }
  }

  function setBusy(busy, message, isError) {
    document.body.classList.toggle('busy', busy);
    showStatus(message, isError);
  }

  function showStatus(message, isError) {
    elements.status.textContent = message || '';
    elements.status.classList.toggle('error', Boolean(isError));
    clearTimeout(showStatus.timeout);
    if (message && !document.body.classList.contains('busy')) {
      showStatus.timeout = setTimeout(() => {
        elements.status.textContent = '';
        elements.status.classList.remove('error');
      }, isError ? 9000 : 3500);
    }
  }

  function makeId() {
    return window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function formatMillimetres(value) {
    return Number(value.toFixed(1)).toString();
  }

})();
