import jsQR from "jsqr";

type NativeDetector = { detect(source: CanvasImageSource | ImageBitmap): Promise<{ rawValue: string }[]> };

let nativeDetector: Promise<NativeDetector | null> | null = null;

/** The browser's built-in QR detector (Android Chrome, Safari, macOS Chrome), if there is one. */
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

async function detectNative(source: CanvasImageSource | ImageBitmap): Promise<string | null> {
  const d = await native();
  if (!d) return null;
  try {
    const found = await d.detect(source);
    return found.find((f) => f.rawValue.trim())?.rawValue.trim() ?? null;
  } catch {
    return null;
  }
}

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

type Source = HTMLVideoElement | ImageBitmap | HTMLImageElement;
type Rect = { x: number; y: number; w: number; h: number };

/** Draws `rect` of the source scaled down to at most `maxDim` px and runs jsQR on it. */
function jsqr(source: Source, rect: Rect, maxDim: number, invert: boolean): string | null {
  const scale = Math.min(1, maxDim / Math.max(rect.w, rect.h));
  const w = Math.max(1, Math.round(rect.w * scale));
  const h = Math.max(1, Math.round(rect.h * scale));
  canvas.width = w;
  canvas.height = h;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const r = jsQR(img.data, w, h, { inversionAttempts: invert ? "attemptBoth" : "dontInvert" });
  return r?.data.trim() || null;
}

function sizeOf(source: Source): { w: number; h: number } {
  if (source instanceof HTMLVideoElement) return { w: source.videoWidth, h: source.videoHeight };
  if (source instanceof HTMLImageElement) return { w: source.naturalWidth, h: source.naturalHeight };
  return { w: source.width, h: source.height };
}

function centre(w: number, h: number, frac: number): Rect {
  const side = Math.min(w, h) * frac;
  return { x: (w - side) / 2, y: (h - side) / 2, w: side, h: side };
}

let frameNo = 0;

/** Quick attempt on the current camera frame (called several times a second). */
export async function decodeVideoFrame(video: HTMLVideoElement): Promise<string | null> {
  const { w, h } = sizeOf(video);
  if (!w || !h) return null;
  const n = await detectNative(video);
  if (n) return n;
  // Alternate between the scan square (QR held close) and the whole frame (QR further away).
  frameNo += 1;
  return frameNo % 2 ? jsqr(video, centre(w, h, 0.7), 640, false) : jsqr(video, { x: 0, y: 0, w, h }, 960, false);
}

async function loadImage(file: Blob): Promise<Source> {
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
 * Thorough search of a photo: built-in detector, then jsQR at several sizes on
 * the whole photo, the centre, and overlapping tiles (QR anywhere in the photo).
 */
export async function decodeImageFile(file: Blob): Promise<string | null> {
  const source = await loadImage(file);
  try {
    const n = await detectNative(source);
    if (n) return n;
    const { w, h } = sizeOf(source);
    const full: Rect = { x: 0, y: 0, w, h };
    const attempts: [Rect, number][] = [
      [full, 1000],
      [full, 1600],
      [centre(w, h, 0.6), 900],
      [full, 700],
      [centre(w, h, 0.4), 700],
      [full, 2400],
    ];
    for (const fy of [0, 0.25, 0.5]) {
      for (const fx of [0, 0.25, 0.5]) attempts.push([{ x: w * fx, y: h * fy, w: w * 0.5, h: h * 0.5 }, 900]);
    }
    for (const [rect, max] of attempts) {
      const r = jsqr(source, rect, max, true);
      if (r) return r;
      await pause();
    }
    return null;
  } finally {
    if ("close" in source) source.close();
  }
}

export const hasNativeDetector = async () => !!(await native());
