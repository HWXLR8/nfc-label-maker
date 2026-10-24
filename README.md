# NFC Card Label Designer

A dependency-free, local label designer for standard 85 × 54 mm NFC cards.

## Run

Open `index.html` in a web browser. The application supports local JPEG, PNG, and WebP artwork. Work exists only in memory and is cleared when the page reloads.

## Workflow

1. Add one or more local images.
2. Edit individual labels to drag the artwork, adjust zoom, or set placement margin.
3. Duplicate or delete labels as needed. The grid order is the print order.
4. Download a US Letter PDF. Nine labels fit on each page; crop marks and outlines are optional.
5. Print at 100% or actual size. Do not use a printer driver's “fit to page” setting.

## Files

- `index.html`, `styles.css`, and `app.js` implement the interface.
- `core.js` contains template composition and crop calculations.
- `pdf.js` writes the small PDF subset required for Letter label sheets.

## Privacy

The app makes no network requests and stores no user data.
