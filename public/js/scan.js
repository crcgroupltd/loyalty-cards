// Barcode reading with zxing-wasm, which works in iOS Safari (it has no
// BarcodeDetector). The wasm file is served by this app, not a CDN.
import { FORMATS, normalizeDecoded } from '../formats.js';

let zxing;
async function reader() {
  if (!zxing) {
    zxing = await import('../vendor/zxing/reader/index.js');
    zxing.prepareZXingModule({
      overrides: {
        locateFile: (path, prefix) =>
          path.endsWith('.wasm') ? new URL('/vendor/zxing/zxing_reader.wasm', location.href).href : prefix + path,
      },
    });
  }
  return zxing;
}

const OPTIONS = {
  formats: Object.values(FORMATS).map((f) => f.zxing),
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  maxNumberOfSymbols: 1,
};

function firstResult(results) {
  for (const r of results) {
    if (!r.isValid) continue;
    const decoded = normalizeDecoded(r.format, r.text);
    if (decoded) return decoded;
  }
  return null;
}

// Reads a photo or screenshot. Resolves to { type, value } or null.
export async function decodeImage(blob) {
  const { readBarcodes } = await reader();
  return firstResult(await readBarcodes(blob, OPTIONS));
}

// Starts the rear camera in `video` and calls onResult once with
// { type, value }. Returns a stop function. Throws if the camera is denied.
export async function startLiveScan(video, onResult) {
  const { readBarcodes } = await reader();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  await video.play();

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  let timer;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };

  const tick = async () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      try {
        const found = firstResult(await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), OPTIONS));
        if (found && !stopped) {
          stop();
          onResult(found);
          return;
        }
      } catch {}
    }
    timer = setTimeout(tick, 100);
  };
  tick();
  return stop;
}
