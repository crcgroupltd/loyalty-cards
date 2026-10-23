// Barcode symbologies supported by the wallet. Shared by the server and the
// browser so validation and rendering always agree.
//
// Keys use Catima's names so Catima exports import without translation.
// `bwip` is the bwip-js encoder, `zxing` is the zxing-wasm format name.

export const FORMATS = {
  QR_CODE: { label: 'QR Code', bwip: 'qrcode', zxing: 'QRCode', matrix: true },
  AZTEC: { label: 'Aztec', bwip: 'azteccode', zxing: 'Aztec', matrix: true },
  DATA_MATRIX: { label: 'Data Matrix', bwip: 'datamatrix', zxing: 'DataMatrix', matrix: true },
  PDF_417: { label: 'PDF417', bwip: 'pdf417', zxing: 'PDF417', stacked: true },
  CODE_128: { label: 'Code 128', bwip: 'code128', zxing: 'Code128' },
  CODE_39: { label: 'Code 39', bwip: 'code39', zxing: 'Code39' },
  CODE_93: { label: 'Code 93', bwip: 'code93', zxing: 'Code93' },
  EAN_13: { label: 'EAN-13', bwip: 'ean13', zxing: 'EAN13' },
  EAN_8: { label: 'EAN-8', bwip: 'ean8', zxing: 'EAN8' },
  UPC_A: { label: 'UPC-A', bwip: 'upca', zxing: 'UPCA' },
  UPC_E: { label: 'UPC-E', bwip: 'upce', zxing: 'UPCE' },
  ITF: { label: 'ITF (Interleaved 2 of 5)', bwip: 'interleaved2of5', zxing: 'ITF' },
  CODABAR: { label: 'Codabar', bwip: 'rationalizedCodabar', zxing: 'Codabar' },
};

export const FORMAT_KEYS = Object.keys(FORMATS);

const ZXING_TO_KEY = Object.fromEntries(FORMAT_KEYS.map((k) => [FORMATS[k].zxing, k]));

// Maps a zxing-wasm result format (e.g. "EAN13") to our key, or null.
export function keyFromZxing(format) {
  return ZXING_TO_KEY[format] ?? null;
}

// Checks that a value can be encoded in the given symbology. Returns an error
// message, or null when valid. Values are never modified to make them fit.
export function validate(type, value) {
  if (!FORMATS[type]) return 'Unknown barcode type';
  if (typeof value !== 'string' || value.length === 0) return 'Barcode value is required';
  if (value.length > 2000) return 'Barcode value is too long';
  const digits = /^\d+$/.test(value);
  switch (type) {
    case 'EAN_13':
      if (!digits || (value.length !== 12 && value.length !== 13)) return 'EAN-13 needs 12 or 13 digits';
      if (value.length === 13 && !checkDigitOk(value)) return 'EAN-13 check digit is wrong';
      break;
    case 'EAN_8':
      if (!digits || (value.length !== 7 && value.length !== 8)) return 'EAN-8 needs 7 or 8 digits';
      if (value.length === 8 && !checkDigitOk(value)) return 'EAN-8 check digit is wrong';
      break;
    case 'UPC_A':
      if (!digits || (value.length !== 11 && value.length !== 12)) return 'UPC-A needs 11 or 12 digits';
      if (value.length === 12 && !checkDigitOk(value)) return 'UPC-A check digit is wrong';
      break;
    case 'UPC_E':
      if (!digits || value.length < 6 || value.length > 8) return 'UPC-E needs 6 to 8 digits';
      break;
    case 'ITF':
      if (!digits || value.length % 2 !== 0) return 'ITF needs an even number of digits';
      break;
    case 'CODABAR':
      if (!/^[A-D]?[0-9\-$:/.+]+[A-D]?$/i.test(value)) return 'Codabar allows digits and - $ : / . +';
      break;
    case 'CODE_39':
      if (!/^[\x00-\x7f]+$/.test(value)) return 'Code 39 allows ASCII only';
      break;
    case 'CODE_93':
      if (!/^[\x00-\x7f]+$/.test(value)) return 'Code 93 allows ASCII only';
      break;
    case 'CODE_128':
      if (!/^[\x00-\xff]+$/.test(value)) return 'Code 128 allows Latin-1 characters only';
      break;
  }
  return null;
}

// GS1 mod-10 check used by EAN-13, EAN-8 and UPC-A.
function checkDigitOk(value) {
  const body = value.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10 === Number(value.at(-1));
}

// Builds bwip-js options for rendering. The value is passed through exactly;
// only symbology framing that the decoder strips (Codabar start/stop
// characters, Code 39 full-ASCII) is handled here.
export function bwipOptions(type, value) {
  const f = FORMATS[type];
  // An opaque white background gives scanners a quiet zone; a transparent
  // one reads as black on dark screens and in decoders that drop alpha.
  const opts = {
    bcid: f.bwip,
    text: value,
    scale: 3,
    paddingwidth: 10,
    paddingheight: 10,
    backgroundcolor: 'FFFFFF',
  };
  if (!f.matrix && !f.stacked) opts.height = 22;
  if (f.stacked) opts.columns = 4;
  if (type === 'CODABAR' && !/^[A-D].*[A-D]$/i.test(value)) {
    // Scanners strip Codabar's start/stop characters; zxing's writer
    // restores them as "A" in the same way.
    opts.text = `A${value}A`;
  }
  if (type === 'CODE_39' && !/^[0-9A-Z\-. $/+%]+$/.test(value)) opts.bcid = 'code39ext';
  if (type === 'CODE_93') {
    // Code 93's two check characters are mandatory; scanners reject it without them.
    opts.includecheck = true;
    if (!/^[0-9A-Z\-. $/+%]+$/.test(value)) opts.bcid = 'code93ext';
  }
  if (type === 'UPC_E' && value.length === 6) opts.text = `0${value}`;
  return opts;
}

// Converts a zxing-wasm decode into the value we store. zxing reports UPC-A
// and UPC-E as 13-digit GTINs (AIM "]E0" transmission); we keep them in their
// native 12-digit / 8-digit form so they render as the same symbology.
// Returns { type, value } or null for an unsupported format.
export function normalizeDecoded(zxingFormat, text) {
  const type = keyFromZxing(zxingFormat);
  if (!type) return null;
  let value = text;
  if ((type === 'UPC_A' || type === 'UPC_E') && /^0\d{12}$/.test(value)) value = value.slice(1);
  if (type === 'UPC_E' && value.length === 12) value = compressUpcA(value) ?? value;
  return { type, value };
}

// Expands an 8-digit UPC-E (number system, 6 data digits, check) to UPC-A.
export function expandUpcE(e) {
  const [ns, d1, d2, d3, d4, d5, d6, c] = e;
  let body;
  if (d6 <= '2') body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === '3') body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === '4') body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${ns}${body}${c}`;
}

// Compresses a 12-digit UPC-A back to 8-digit UPC-E, or null if it has no
// UPC-E form. Where several UPC-E encodings expand to the same UPC-A, any of
// them transmits the identical number to a till, so the first match is used.
export function compressUpcA(a) {
  if (!/^[01]\d{11}$/.test(a)) return null;
  const ns = a[0];
  const m = a.slice(1, 6);
  const p = a.slice(6, 11);
  const c = a[11];
  const candidates = [
    `${m[0]}${m[1]}${p[2]}${p[3]}${p[4]}${m[2]}`,
    `${m[0]}${m[1]}${m[2]}${p[3]}${p[4]}3`,
    `${m[0]}${m[1]}${m[2]}${m[3]}${p[4]}4`,
    `${m}${p[4]}`,
  ];
  for (const six of candidates) {
    const e = `${ns}${six}${c}`;
    if (expandUpcE(e) === a) return e;
  }
  return null;
}
