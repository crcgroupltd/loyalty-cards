import { bwipOptions, validate } from '../formats.js';
import { h } from './dom.js';

// bwip-js is ~2 MB, so it loads on first use (and is then cached offline).
let bwip;
const loadBwip = () => (bwip ??= import('../vendor/bwip-js/bwip-js.mjs'));

// Renders a barcode as SVG on a white background. bwip-js draws shapes only
// (no human-readable text), so the SVG never contains user data as markup.
export async function renderBarcode(type, value) {
  const box = h('div', { class: 'barcode' });
  const err = validate(type, value);
  if (err) {
    box.classList.add('barcode-error');
    box.textContent = err;
    return box;
  }
  try {
    const { toSVG } = await loadBwip();
    box.innerHTML = toSVG(bwipOptions(type, value));
    box.classList.add(isMatrix(type) ? 'barcode-2d' : 'barcode-1d');
  } catch (e) {
    box.classList.add('barcode-error');
    box.textContent = `Cannot draw this barcode: ${e.message ?? e}`;
  }
  return box;
}

const isMatrix = (type) => ['QR_CODE', 'AZTEC', 'DATA_MATRIX'].includes(type);

export function preloadBarcodes() {
  loadBwip().catch(() => {});
}
