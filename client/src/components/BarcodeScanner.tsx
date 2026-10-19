import { useEffect, useRef, useState } from "react";
import { BarcodeFormat, BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import { Modal } from "./Modal";
import { cameraSupported } from "./PhotoCapture";

export function BarcodeScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(
    cameraSupported() ? "" : "Camera needs a secure page (https or localhost). Use a USB barcode scanner or type the token.",
  );
  const done = useRef(false);

  useEffect(() => {
    if (!cameraSupported() || !videoRef.current) return;
    const hints = new Map<DecodeHintType, unknown>([
      [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE]],
      [DecodeHintType.TRY_HARDER, true],
    ]);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
    let controls: IScannerControls | null = null;
    let cancelled = false;

    reader
      .decodeFromConstraints(
        { video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false },
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
      .catch((e: Error) =>
        setError(
          e.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in the browser address bar."
            : "No camera found. Use a USB barcode scanner or type the token.",
        ),
      );

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [onResult]);

  return (
    <Modal
      title="Scan bill barcode"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      }
    >
      {error ? (
        <div className="notice err">{error}</div>
      ) : (
        <>
          <div className="scan-frame">
            <video ref={videoRef} className="camera-view" playsInline muted />
            <div className="scan-line" />
          </div>
          <p className="muted center">Hold the barcode on the bill steady inside the box.</p>
        </>
      )}
    </Modal>
  );
}
