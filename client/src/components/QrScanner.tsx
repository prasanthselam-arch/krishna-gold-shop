import { useEffect, useRef, useState } from "react";
import { BarcodeFormat, BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import { Modal } from "./Modal";
import { cameraSupported } from "./PhotoCapture";

// CODE_128 keeps bills printed before the switch to QR scannable.
const hints = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128]],
  [DecodeHintType.TRY_HARDER, true],
]);

function cameraError(e: unknown): string {
  const name = (e as Error)?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera permission is blocked. Click the camera / lock icon in the address bar, choose Allow, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found on this device.";
  if (name === "NotReadableError") return "The camera is being used by another app. Close it and try again.";
  return "Could not start the camera.";
}

function insecureHint(): string {
  const https = `https://${location.hostname}:8443`;
  return `Live camera needs a secure page. Open ${https} instead of ${location.origin}, or use "Take photo of QR" below.`;
}

export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const live = cameraSupported();
  const [error, setError] = useState(live ? "" : insecureHint());
  const [reading, setReading] = useState(false);

  useEffect(() => {
    if (!live || !videoRef.current) return;
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
    let controls: IScannerControls | null = null;
    let cancelled = false;

    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        videoRef.current,
        (result, _err, ctl) => {
          if (!result || done.current) return;
          done.current = true;
          ctl.stop();
          navigator.vibrate?.(80);
          onResult(result.getText().trim());
        },
      )
      .then((c) => {
        if (cancelled) c.stop();
        else controls = c;
      })
      .catch((e) => setError(cameraError(e)));

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [live, onResult]);

  async function decodePhoto(file: File) {
    setReading(true);
    const url = URL.createObjectURL(file);
    try {
      const result = await new BrowserMultiFormatReader(hints).decodeFromImageUrl(url);
      onResult(result.getText().trim());
    } catch {
      setError("No QR code found in that photo. Hold the bill flat, fill the frame with the QR code and try again.");
    } finally {
      URL.revokeObjectURL(url);
      setReading(false);
    }
  }

  return (
    <Modal
      title="Scan bill QR code"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-ink" disabled={reading} onClick={() => fileRef.current?.click()}>
            {reading ? "Reading…" : "Take photo of QR"}
          </button>
        </>
      }
    >
      {error && <div className="notice warn">{error}</div>}
      {live && !error && (
        <>
          <div className="scan-frame">
            <video ref={videoRef} className="camera-view" playsInline muted />
            <div className="scan-box" />
          </div>
          <p className="muted center">Hold the QR code on the bill inside the square.</p>
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void decodePhoto(file);
        }}
      />
    </Modal>
  );
}
