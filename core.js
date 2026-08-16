(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_ZOOM = 10;
  const MAX_PRINT_MARGIN_MM = 24;
  const CARD_WIDTH_MM = 54;
  const CARD_HEIGHT_MM = 85;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function resetTransform() {
    return { zoom: 1, panX: 0, panY: 0 };
  }

  function getArtworkRect(imageWidth, imageHeight, placeholder, transform) {
    const imageRatio = imageWidth / imageHeight;
    const placeholderRatio = placeholder.width / placeholder.height;
    let baseWidth;
    let baseHeight;

    if (imageRatio > placeholderRatio) {
      baseHeight = placeholder.height;
      baseWidth = baseHeight * imageRatio;
    } else {
      baseWidth = placeholder.width;
      baseHeight = baseWidth / imageRatio;
    }

    const zoom = clamp(Number(transform.zoom) || 1, 1, MAX_ZOOM);
    const width = baseWidth * zoom;
    const height = baseHeight * zoom;
    const maxPanX = Math.max(0, (width - placeholder.width) / 2);
    const maxPanY = Math.max(0, (height - placeholder.height) / 2);
    const panX = clamp(Number(transform.panX) || 0, -maxPanX, maxPanX);
    const panY = clamp(Number(transform.panY) || 0, -maxPanY, maxPanY);

    return {
      x: placeholder.x + placeholder.width / 2 + panX - width / 2,
      y: placeholder.y + placeholder.height / 2 + panY - height / 2,
      width,
      height,
      zoom,
      panX,
      panY,
      maxPanX,
      maxPanY,
    };
  }

  function clampTransform(imageWidth, imageHeight, placeholder, transform) {
    const rect = getArtworkRect(
      imageWidth,
      imageHeight,
      placeholder,
      transform,
    );
    return { zoom: rect.zoom, panX: rect.panX, panY: rect.panY };
  }

  function zoomTransformAtPoint(
    imageWidth,
    imageHeight,
    placeholder,
    transform,
    nextZoom,
    point,
  ) {
    const currentRect = getArtworkRect(
      imageWidth,
      imageHeight,
      placeholder,
      transform,
    );
    const zoom = clamp(nextZoom, 1, MAX_ZOOM);
    if (zoom === currentRect.zoom) {
      return clampTransform(imageWidth, imageHeight, placeholder, transform);
    }

    const ratio = zoom / currentRect.zoom;
    const width = currentRect.width * ratio;
    const height = currentRect.height * ratio;
    const x = point.x - (point.x - currentRect.x) * ratio;
    const y = point.y - (point.y - currentRect.y) * ratio;
    const candidate = {
      zoom,
      panX: x + width / 2 - (placeholder.x + placeholder.width / 2),
      panY: y + height / 2 - (placeholder.y + placeholder.height / 2),
    };
    return clampTransform(imageWidth, imageHeight, placeholder, candidate);
  }

  function composeSvg(template, asset, transform, instanceId) {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(template.svg, 'image/svg+xml');
    const parseError = documentNode.querySelector('parsererror');
    if (parseError) {
      throw new Error('The card template could not be parsed.');
    }

    const root = documentNode.documentElement;
    const slot = root.querySelector('#artwork-slot');
    if (!slot || !slot.parentNode) {
      throw new Error('The card template has no artwork slot.');
    }

    const safeId = String(instanceId).replace(/[^a-zA-Z0-9_-]/g, '-');
    const clipId = `artwork-clip-${safeId}`;
    const defs = documentNode.createElementNS(SVG_NS, 'defs');
    const clipPath = documentNode.createElementNS(SVG_NS, 'clipPath');
    const clipRect = documentNode.createElementNS(SVG_NS, 'rect');
    clipPath.setAttribute('id', clipId);
    clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
    setRectAttributes(clipRect, template.placeholder);
    if (template.placeholder.rx) {
      clipRect.setAttribute('rx', formatNumber(template.placeholder.rx));
    }
    if (template.placeholder.ry) {
      clipRect.setAttribute('ry', formatNumber(template.placeholder.ry));
    }
    clipPath.appendChild(clipRect);
    defs.appendChild(clipPath);
    root.insertBefore(defs, root.firstChild);

    const artworkRect = getArtworkRect(
      asset.width,
      asset.height,
      template.placeholder,
      transform,
    );
    const image = documentNode.createElementNS(SVG_NS, 'image');
    image.setAttribute('id', 'card-artwork');
    image.setAttribute('href', asset.dataUrl);
    image.setAttribute('preserveAspectRatio', 'none');
    image.setAttribute('clip-path', `url(#${clipId})`);
    setRectAttributes(image, artworkRect);
    slot.parentNode.replaceChild(image, slot);

    root.setAttribute('xmlns', SVG_NS);
    root.setAttribute('viewBox', template.viewBox.join(' '));
    root.setAttribute('width', formatNumber(template.viewBox[2]));
    root.setAttribute('height', formatNumber(template.viewBox[3]));
    return new XMLSerializer().serializeToString(root);
  }

  function setRectAttributes(element, rect) {
    element.setAttribute('x', formatNumber(rect.x));
    element.setAttribute('y', formatNumber(rect.y));
    element.setAttribute('width', formatNumber(rect.width));
    element.setAttribute('height', formatNumber(rect.height));
  }

  function formatNumber(value) {
    return Number(value.toFixed(4)).toString();
  }

  function getPrintDimensionsMm(template = {}) {
    return {
      width: CARD_WIDTH_MM * (template.printScaleX || 1),
      height: CARD_HEIGHT_MM * (template.printScaleY || 1),
    };
  }

  function normalizePrintMargin(value) {
    return Number(clamp(Number(value) || 0, 0, MAX_PRINT_MARGIN_MM).toFixed(1));
  }

  function applyPrintMargin(template, value) {
    const marginMm = normalizePrintMargin(value);
    if (!marginMm) return template;

    const printScaleX = 1 - (2 * marginMm) / CARD_WIDTH_MM;
    const printScaleY = 1 - (2 * marginMm) / CARD_HEIGHT_MM;
    const width = template.viewBox[2] * printScaleX;
    const height = template.viewBox[3] * printScaleY;
    const radiusX = Math.max(
      0,
      (template.placeholder.rx || 0) -
        (marginMm * template.viewBox[2]) / CARD_WIDTH_MM,
    );
    const radiusY = Math.max(
      0,
      (template.placeholder.ry || 0) -
        (marginMm * template.viewBox[3]) / CARD_HEIGHT_MM,
    );
    return {
      ...template,
      viewBox: [0, 0, width, height],
      placeholder: {
        ...template.placeholder,
        x: 0,
        y: 0,
        width,
        height,
        rx: radiusX,
        ry: radiusY,
      },
      printMarginMm: marginMm,
      printScaleX,
      printScaleY,
    };
  }

  function getCornerRadiusRatio(template) {
    const radius = Math.max(template.placeholder.rx || 0, template.placeholder.ry || 0);
    return radius / Math.min(template.viewBox[2], template.viewBox[3]);
  }

  function parseJpegDimensions(bytes) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error('Rendered card is not a JPEG image.');
    }

    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (
        marker >= 0xc0 &&
        marker <= 0xc3 &&
        marker !== 0xc4
      ) {
        return {
          height: (bytes[offset + 5] << 8) | bytes[offset + 6],
          width: (bytes[offset + 7] << 8) | bytes[offset + 8],
        };
      }
      offset += 2 + length;
    }
    throw new Error('JPEG dimensions could not be read.');
  }

  window.NfcCardDesignerCore = Object.freeze({
    applyPrintMargin,
    clampTransform,
    composeSvg,
    formatNumber,
    getArtworkRect,
    getCornerRadiusRatio,
    getPrintDimensionsMm,
    normalizePrintMargin,
    parseJpegDimensions,
    resetTransform,
    zoomTransformAtPoint,
  });
})();
