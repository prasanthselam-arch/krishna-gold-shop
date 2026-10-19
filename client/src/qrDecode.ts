import jsQR from "jsqr";
import { TOKEN_PATTERN } from "./format";

/** `text` is a shop bill token; `foreign` is some other QR code that was seen (e.g. a UPI code). */
export type QrResult = { text: string | null; foreign: string | null };

const isToken = (t: string) => TOKEN_PATTERN.test(t);

// ---------- built-in detector (Android Chrome, Safari, macOS Chrome) ----------

type NativeDetector = { detect(source: CanvasImageSource | ImageBitmap): Promise<{ rawValue: string }[]> };
let nativeDetector: Promise<NativeDetector | null> | null = null;

function native(): Promise<NativeDetector | null> {
  nativeDetector ??= (async () => {
    const BD = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector;
    if (!BD) return null;
    try {
      const formats: string[] = (await BD.getSupportedFormats?.()) ?? ["qr_code"];
      return formats.includes("qr_code") ? (new BD({ formats: ["qr_code"] }) as NativeDetector) : null;
    } catch {
      return null;
    }
  })();
  return nativeDetector;
}

async function detectNative(source: CanvasImageSource | ImageBitmap, found: QrResult): Promise<void> {
  const d = await native();
  if (!d) return;
  try {
    for (const f of await d.detect(source)) note(f.rawValue, found);
  } catch {
    // ignore: fall back to jsQR
  }
}

function note(raw: string | undefined, found: QrResult) {
  const t = raw?.trim();
  if (!t) return;
  if (isToken(t)) found.text ??= t.toUpperCase();
  else found.foreign ??= t;
}

// ---------- image clean-up (glare, uneven light, blur) ----------

type Src = HTMLVideoElement | ImageBitmap | HTMLImageElement | HTMLCanvasElement;
type Rect = { x: number; y: number; w: number; h: number };
type Variant = "raw" | "gamma" | "flat" | "binary" | "binaryFine" | "sharp" | "deglare" | "deglareWide";

const work = document.createElement("canvas");
const wctx = work.getContext("2d", { willReadFrequently: true })!;

function sizeOf(s: Src): { w: number; h: number } {
  if (s instanceof HTMLVideoElement) return { w: s.videoWidth, h: s.videoHeight };
  if (s instanceof HTMLImageElement) return { w: s.naturalWidth, h: s.naturalHeight };
  return { w: s.width, h: s.height };
}

/** Grey pixels of `rect`, scaled so the longer side is about `maxDim` (small crops are enlarged up to 2×). */
function grab(src: Src, rect: Rect, maxDim: number, flip: boolean): { lum: Uint8ClampedArray; w: number; h: number } {
  const scale = Math.min(2, maxDim / Math.max(rect.w, rect.h));
  const w = Math.max(1, Math.round(rect.w * scale));
  const h = Math.max(1, Math.round(rect.h * scale));
  work.width = w;
  work.height = h;
  wctx.imageSmoothingEnabled = true;
  wctx.imageSmoothingQuality = "high";
  wctx.setTransform(flip ? -1 : 1, 0, 0, 1, flip ? w : 0, 0);
  wctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  wctx.setTransform(1, 0, 0, 1, 0, 0);
  const d = wctx.getImageData(0, 0, w, h).data;
  const lum = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  return { lum, w, h };
}

/** Mean of the (2r+1)² window around every pixel, using an integral image. */
function boxMean(lum: Uint8ClampedArray, w: number, h: number, r: number): Float32Array {
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += lum[y * w + x];
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const s = sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0];
      out[y * w + x] = s / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

/**
 * Glare adds white light on top of the code, so black modules turn light grey but are
 * still darker than their white neighbours. Stretching every neighbourhood between its own
 * darkest and brightest value brings back full black and white. Flat areas (no real
 * contrast, only camera noise) keep their normal look so the noise is not blown up.
 * `b` is the block size in pixels; each pixel looks at the 3×3 blocks around it.
 */
function deglare(lum: Uint8ClampedArray, w: number, h: number, b: number): Uint8ClampedArray {
  const bw = Math.ceil(w / b);
  const bh = Math.ceil(h / b);
  const bmin = new Uint8Array(bw * bh).fill(255);
  const bmax = new Uint8Array(bw * bh);
  for (let y = 0; y < h; y++) {
    const by = ((y / b) | 0) * bw;
    for (let x = 0; x < w; x++) {
      const v = lum[y * w + x];
      const k = by + ((x / b) | 0);
      if (v < bmin[k]) bmin[k] = v;
      if (v > bmax[k]) bmax[k] = v;
    }
  }
  const lo = new Float32Array(bw * bh);
  const hi = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let mn = 255;
      let mx = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(bh - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const k = yy * bw + Math.min(bw - 1, Math.max(0, x + dx));
          if (bmin[k] < mn) mn = bmin[k];
          if (bmax[k] > mx) mx = bmax[k];
        }
      }
      lo[y * bw + x] = mn;
      hi[y * bw + x] = mx;
    }
  }
  const base = stretch(lum);
  const out = new Uint8ClampedArray(lum.length);
  for (let y = 0; y < h; y++) {
    // Bilinear blend of the block values, so there are no visible block edges.
    const fy = Math.min(bh - 1, Math.max(0, y / b - 0.5));
    const y0 = fy | 0;
    const y1 = Math.min(bh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1, Math.max(0, x / b - 0.5));
      const x0 = fx | 0;
      const x1 = Math.min(bw - 1, x0 + 1);
      const tx = fx - x0;
      const a = y0 * bw;
      const c = y1 * bw;
      const l = (lo[a + x0] * (1 - tx) + lo[a + x1] * tx) * (1 - ty) + (lo[c + x0] * (1 - tx) + lo[c + x1] * tx) * ty;
      const u = (hi[a + x0] * (1 - tx) + hi[a + x1] * tx) * (1 - ty) + (hi[c + x0] * (1 - tx) + hi[c + x1] * tx) * ty;
      const range = u - l;
      const i = y * w + x;
      const weight = Math.min(1, Math.max(0, (range - 18) / 30));
      const local = ((lum[i] - l) / Math.max(range, 1)) * 255;
      out[i] = weight * local + (1 - weight) * base[i];
    }
  }
  return out;
}

/** Linear stretch so the darkest 1% becomes black and the brightest 1% white. */
function stretch(lum: Uint8ClampedArray): Uint8ClampedArray {
  const hist = new Uint32Array(256);
  for (let i = 0; i < lum.length; i++) hist[lum[i]]++;
  const lowN = lum.length * 0.01;
  const highN = lum.length * 0.99;
  let lo = 0;
  let hi = 255;
  for (let v = 0, acc = 0; v < 256; v++) {
    acc += hist[v];
    if (acc <= lowN) lo = v;
    if (acc <= highN) hi = v;
  }
  if (hi - lo < 8) return lum;
  const out = new Uint8ClampedArray(lum.length);
  const k = 255 / (hi - lo);
  for (let i = 0; i < lum.length; i++) out[i] = (lum[i] - lo) * k;
  return out;
}

function transform(v: Variant, lum: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const side = Math.min(w, h);
  switch (v) {
    case "raw":
      return lum;
    case "gamma": {
      // Glare turns black modules light grey; a strong gamma pulls them back down.
      const s = stretch(lum);
      const lut = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) lut[i] = 255 * Math.pow(i / 255, 2.4);
      const out = new Uint8ClampedArray(s.length);
      for (let i = 0; i < s.length; i++) out[i] = lut[s[i]];
      return out;
    }
    case "flat": {
      // Divide by a heavily blurred copy: removes glare blobs, shadows and uneven light.
      const bg = boxMean(lum, w, h, Math.max(6, Math.round(side / 12)));
      const out = new Uint8ClampedArray(lum.length);
      for (let i = 0; i < lum.length; i++) out[i] = (lum[i] / (bg[i] + 1)) * 190;
      return stretch(out);
    }
    case "binary":
    case "binaryFine": {
      const mean = boxMean(lum, w, h, Math.max(4, Math.round(side / (v === "binary" ? 10 : 24))));
      const out = new Uint8ClampedArray(lum.length);
      for (let i = 0; i < lum.length; i++) out[i] = lum[i] < mean[i] * 0.9 ? 0 : 255;
      return out;
    }
    case "sharp": {
      const blur = boxMean(lum, w, h, 1);
      const out = new Uint8ClampedArray(lum.length);
      for (let i = 0; i < lum.length; i++) out[i] = lum[i] + 1.6 * (lum[i] - blur[i]);
      return stretch(out);
    }
    case "deglare":
      return deglare(lum, w, h, Math.max(4, Math.round(side / 110)));
    case "deglareWide":
      return deglare(lum, w, h, Math.max(6, Math.round(side / 50)));
  }
}

function jsqr(lum: Uint8ClampedArray, w: number, h: number, invert: boolean, found: QrResult) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) {
    rgba[j] = rgba[j + 1] = rgba[j + 2] = lum[i];
    rgba[j + 3] = 255;
  }
  note(jsQR(rgba, w, h, { inversionAttempts: invert ? "attemptBoth" : "dontInvert" })?.data, found);
}

type Attempt = { rect: Rect; max: number; variants: Variant[]; flip?: boolean; invert?: boolean };

function run(src: Src, a: Attempt, invert: boolean, found: QrResult) {
  const { lum, w, h } = grab(src, a.rect, a.max, !!a.flip);
  for (const v of a.variants) {
    jsqr(transform(v, lum, w, h), w, h, invert, found);
    if (found.text) return;
  }
}

function centre(w: number, h: number, frac: number): Rect {
  const side = Math.min(w, h) * frac;
  return { x: (w - side) / 2, y: (h - side) / 2, w: side, h: side };
}

// ---------- live camera ----------

let frameNo = 0;

/**
 * One quick attempt on the current camera frame (called ~10 times a second).
 * Successive frames cycle through zoom levels and clean-up filters, so glare,
 * dim light, small codes and mirrored images are all covered within a second.
 */
export async function decodeVideoFrame(video: HTMLVideoElement): Promise<QrResult> {
  const found: QrResult = { text: null, foreign: null };
  const { w, h } = sizeOf(video);
  if (!w || !h) return found;
  await detectNative(video, found);
  if (found.text) return found;
  const full: Rect = { x: 0, y: 0, w, h };
  const plan: Attempt[] = [
    { rect: centre(w, h, 0.7), max: 720, variants: ["raw"] },
    { rect: centre(w, h, 0.7), max: 720, variants: ["deglare"] },
    { rect: full, max: 960, variants: ["raw"] },
    { rect: centre(w, h, 0.45), max: 720, variants: ["raw", "deglare"] },
    { rect: full, max: 960, variants: ["deglare"] },
    { rect: centre(w, h, 0.7), max: 720, variants: ["flat", "deglareWide"] },
    { rect: centre(w, h, 0.7), max: 720, variants: ["gamma", "sharp"] },
    { rect: centre(w, h, 0.3), max: 600, variants: ["raw", "deglare"] },
    { rect: centre(w, h, 0.7), max: 720, variants: ["binaryFine"] },
    { rect: centre(w, h, 0.7), max: 720, variants: ["raw", "deglare"], flip: true },
  ];
  run(video, plan[frameNo++ % plan.length], false, found);
  return found;
}

// ---------- photos (upload / capture) ----------

async function load(file: Blob | HTMLCanvasElement): Promise<Src> {
  if (file instanceof HTMLCanvasElement) return file;
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

const pause = () => new Promise((r) => setTimeout(r, 0));

/**
 * Thorough search of a still photo: built-in detector, then jsQR on the whole
 * photo, the centre and overlapping tiles at several sizes, each with the
 * glare / lighting / blur clean-ups, and finally mirrored.
 */
export async function decodeImage(file: Blob | HTMLCanvasElement, onProgress?: (fraction: number) => void): Promise<QrResult> {
  const found: QrResult = { text: null, foreign: null };
  const src = await load(file);
  try {
    await detectNative(src, found);
    if (found.text) return found;
    const { w, h } = sizeOf(src);
    const full: Rect = { x: 0, y: 0, w, h };
    const tiles: Rect[] = [];
    for (const fy of [0, 0.25, 0.5]) for (const fx of [0, 0.25, 0.5]) tiles.push({ x: w * fx, y: h * fy, w: w * 0.5, h: h * 0.5 });
    const main: Rect[] = [full, centre(w, h, 0.6), centre(w, h, 0.35)];
    const with_ = (rects: Rect[], max: number, variants: Variant[], extra: Partial<Attempt> = {}): Attempt[] =>
      rects.map((rect) => ({ rect, max, variants, ...extra }));
    const attempts: Attempt[] = [
      ...with_([full], 1000, ["raw", "deglare"]),
      ...with_([full], 1600, ["raw", "deglare"]),
      ...with_(main.slice(1), 1000, ["raw", "deglare"]),
      ...with_([full], 700, ["raw"]),
      ...with_(tiles, 800, ["raw", "deglare"]),
      ...with_(main, 1000, ["flat", "deglareWide", "gamma", "binaryFine", "sharp"]),
      ...with_(tiles, 800, ["deglareWide", "flat", "gamma"]),
      ...with_(main, 1000, ["raw", "deglare"], { flip: true }),
      ...with_([full], 1000, ["raw", "binary"], { invert: true }),
    ];
    for (const [i, a] of attempts.entries()) {
      run(src, a, !!a.invert, found);
      if (found.text) return found;
      onProgress?.((i + 1) / attempts.length);
      await pause();
    }
    return found;
  } finally {
    if ("close" in src && typeof src.close === "function") src.close();
  }
}
