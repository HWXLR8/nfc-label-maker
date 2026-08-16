(function () {
  'use strict';

  const { formatNumber, parseJpegDimensions } = window.NfcCardDesignerCore;
  const encoder = new TextEncoder();
  const POINTS_PER_MM = 72 / 25.4;
  const PAGE_WIDTH = 612;
  const PAGE_HEIGHT = 792;
  const CARD_WIDTH = 54 * POINTS_PER_MM;
  const CARD_HEIGHT = 85 * POINTS_PER_MM;
  const GUTTER = 3 * POINTS_PER_MM;
  const COLUMNS = 3;
  const ROWS = 3;
  const CARDS_PER_PAGE = COLUMNS * ROWS;

  function calculateLetterLayout(cardCount) {
    const gridWidth = COLUMNS * CARD_WIDTH + (COLUMNS - 1) * GUTTER;
    const gridHeight = ROWS * CARD_HEIGHT + (ROWS - 1) * GUTTER;
    const startX = (PAGE_WIDTH - gridWidth) / 2;
    const startY = (PAGE_HEIGHT - gridHeight) / 2;
    const slots = [];

    for (let index = 0; index < cardCount; index += 1) {
      const page = Math.floor(index / CARDS_PER_PAGE);
      const pageIndex = index % CARDS_PER_PAGE;
      const column = pageIndex % COLUMNS;
      const row = Math.floor(pageIndex / COLUMNS);
      slots.push({
        page,
        column,
        row,
        x: startX + column * (CARD_WIDTH + GUTTER),
        y:
          PAGE_HEIGHT -
          startY -
          CARD_HEIGHT -
          row * (CARD_HEIGHT + GUTTER),
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      });
    }
    return slots;
  }

  function createPdf(cards, options) {
    if (!cards.length) {
      throw new Error('Add at least one card before creating a PDF.');
    }

    const slots = calculateLetterLayout(cards.length);
    const pageCount = Math.ceil(cards.length / CARDS_PER_PAGE);
    const pages = Array.from({ length: pageCount }, () => ({
      pageId: 0,
      contentId: 0,
      images: [],
    }));
    let nextObjectId = 3;

    pages.forEach((page) => {
      page.pageId = nextObjectId++;
      page.contentId = nextObjectId++;
    });
    cards.forEach((card, index) => {
      pages[slots[index].page].images.push({
        objectId: nextObjectId++,
        card,
        slot: insetSlot(slots[index], card.marginMm),
      });
    });

    const objects = new Map();
    objects.set(1, ascii('<< /Type /Catalog /Pages 2 0 R >>'));
    objects.set(
      2,
      ascii(
        `<< /Type /Pages /Count ${pages.length} /Kids [${pages
          .map((page) => `${page.pageId} 0 R`)
          .join(' ')}] >>`,
      ),
    );

    pages.forEach((page) => {
      const resources = page.images
        .map((image, index) => `/Im${index} ${image.objectId} 0 R`)
        .join(' ');
      objects.set(
        page.pageId,
        ascii(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /ProcSet [/PDF /ImageC] /XObject << ${resources} >> >> /Contents ${page.contentId} 0 R >>`,
        ),
      );

      const commands = [];
      page.images.forEach(({ card, slot }, index) => {
        commands.push(imageCommand(index, slot, card.cornerRadiusRatio));
        if (options.outlines) {
          commands.push(outlineCommand(slot, card.cornerRadiusRatio));
        }
        if (options.cropMarks) commands.push(cropMarkCommands(slot));
      });
      objects.set(page.contentId, stream(ascii(commands.join('\n'))));

      page.images.forEach(({ objectId, card }) => {
        const dimensions = parseJpegDimensions(card.jpegBytes);
        objects.set(
          objectId,
          stream(card.jpegBytes, {
            dictionary: `/Type /XObject /Subtype /Image /Width ${dimensions.width} /Height ${dimensions.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
          }),
        );
      });
    });

    return serializePdf(objects, nextObjectId - 1);
  }

  function imageCommand(index, slot, cornerRadiusRatio) {
    const { x, y, width, height } = slot;
    const clip = cornerRadiusRatio
      ? `${roundedRectanglePath(slot, width * cornerRadiusRatio)} W n `
      : '';
    return `q ${clip}${n(width)} 0 0 ${n(height)} ${n(x)} ${n(y)} cm /Im${index} Do Q`;
  }

  function outlineCommand(slot, cornerRadiusRatio) {
    if (cornerRadiusRatio) {
      return `q 0.25 w 0 0 0 RG ${roundedRectanglePath(
        slot,
        slot.width * cornerRadiusRatio,
      )} S Q`;
    }
    return `q 0.25 w 0 0 0 RG ${n(slot.x)} ${n(slot.y)} ${n(slot.width)} ${n(slot.height)} re S Q`;
  }

  function roundedRectanglePath(slot, requestedRadius) {
    const { x, y, width, height } = slot;
    const radius = Math.min(requestedRadius, width / 2, height / 2);
    const control = radius * 0.55228475;
    const right = x + width;
    const top = y + height;
    return [
      `${n(x + radius)} ${n(y)} m`,
      `${n(right - radius)} ${n(y)} l`,
      `${n(right - radius + control)} ${n(y)} ${n(right)} ${n(y + radius - control)} ${n(right)} ${n(y + radius)} c`,
      `${n(right)} ${n(top - radius)} l`,
      `${n(right)} ${n(top - radius + control)} ${n(right - radius + control)} ${n(top)} ${n(right - radius)} ${n(top)} c`,
      `${n(x + radius)} ${n(top)} l`,
      `${n(x + radius - control)} ${n(top)} ${n(x)} ${n(top - radius + control)} ${n(x)} ${n(top - radius)} c`,
      `${n(x)} ${n(y + radius)} l`,
      `${n(x)} ${n(y + radius - control)} ${n(x + radius - control)} ${n(y)} ${n(x + radius)} ${n(y)} c`,
      'h',
    ].join(' ');
  }

  function insetSlot(slot, marginMm) {
    const inset = Math.max(0, Number(marginMm) || 0) * POINTS_PER_MM;
    return {
      ...slot,
      x: slot.x + inset,
      y: slot.y + inset,
      width: slot.width - 2 * inset,
      height: slot.height - 2 * inset,
    };
  }

  function cropMarkCommands(slot) {
    const gap = 0.5 * POINTS_PER_MM;
    const length = 2 * POINTS_PER_MM;
    const left = slot.x;
    const right = slot.x + slot.width;
    const bottom = slot.y;
    const top = slot.y + slot.height;
    const lines = [
      [left - gap - length, bottom, left - gap, bottom],
      [left, bottom - gap - length, left, bottom - gap],
      [right + gap, bottom, right + gap + length, bottom],
      [right, bottom - gap - length, right, bottom - gap],
      [left - gap - length, top, left - gap, top],
      [left, top + gap, left, top + gap + length],
      [right + gap, top, right + gap + length, top],
      [right, top + gap, right, top + gap + length],
    ];
    return `q 0.25 w 0 0 0 RG ${lines
      .map(([x1, y1, x2, y2]) => `${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l`)
      .join(' ')} S Q`;
  }

  function serializePdf(objects, objectCount) {
    const chunks = [ascii('%PDF-1.4\n%NFC Card Label Designer\n')];
    const offsets = new Array(objectCount + 1).fill(0);
    let byteLength = chunks[0].length;

    for (let objectId = 1; objectId <= objectCount; objectId += 1) {
      const body = objects.get(objectId);
      if (!body) throw new Error(`Missing PDF object ${objectId}.`);
      offsets[objectId] = byteLength;
      const prefix = ascii(`${objectId} 0 obj\n`);
      const suffix = ascii('\nendobj\n');
      chunks.push(prefix, body, suffix);
      byteLength += prefix.length + body.length + suffix.length;
    }

    const xrefOffset = byteLength;
    const xref = [
      `xref\n0 ${objectCount + 1}\n`,
      '0000000000 65535 f \n',
      ...offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
      `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    ].join('');
    chunks.push(ascii(xref));
    return concatenate(chunks);
  }

  function stream(bytes, options) {
    const dictionary = options && options.dictionary ? `${options.dictionary} ` : '';
    return concatenate([
      ascii(`<< ${dictionary}/Length ${bytes.length} >>\nstream\n`),
      bytes,
      ascii('\nendstream'),
    ]);
  }

  function ascii(value) {
    return encoder.encode(value);
  }

  function concatenate(chunks) {
    const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    chunks.forEach((chunk) => {
      output.set(chunk, offset);
      offset += chunk.length;
    });
    return output;
  }

  function n(value) {
    return formatNumber(value);
  }

  window.NfcCardDesignerPdf = Object.freeze({
    CARDS_PER_PAGE,
    createPdf,
  });
})();
