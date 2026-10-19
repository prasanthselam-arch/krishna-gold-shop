import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Modal } from "./Modal";
import { cameraSupported } from "./PhotoCapture";
import { decodeImageFile, decodeVideoFrame } from "../qrDecode";

function cameraError(e: unknown): string {
  const name = (e as Error)?.name || "Error";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera permission is blocked. Tap the lock / camera icon in the address bar, allow the camera, then press Try again.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No camera was found on this device. Use “Upload photo” instead.";
  if (name === "NotReadableError" || name === "TrackStartError")
    return "The camera is busy in another app or browser tab. Close it, then press Try again.";
  if (name === "OverconstrainedError") return "This camera could not be started. Pick another camera below.";
  return `Could not start the camera (${name}: ${(e as Error)?.message || "unknown error"}).`;
}

/** Camera settings to try, best first; older phones and laptop webcams reject the strict ones. */
function constraintsFor(deviceId: string): MediaStreamConstraints[] {
  if (deviceId) return [{ video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } }, { video: { deviceId: { exact: deviceId } } }];
  return [
    { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
    { video: { facingMode: { ideal: "environment" } } },
    { video: true },
  ];
}

async function openCamera(deviceId: string): Promise<MediaStream> {
  let last: unknown = null;
  for (const c of constraintsFor(deviceId)) {
    try {
      return await navigator.mediaDevices.getUserMedia({ ...c, audio: false });
    } catch (e) {
      last = e;
      const name = (e as Error)?.name;
      if (name === "NotAllowedError" || name === "SecurityError" || name === "NotReadableError") break;
    }
  }
  throw last;
}

type Torch = MediaTrackCapabilities & { torch?: boolean };

export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const takeRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const done = useRef(false);
  const live = cameraSupported();
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(live);
  const [reading, setReading] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [torch, setTorch] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [httpsPort, setHttpsPort] = useState(8443);

  const finish = useCallback(
    (text: string) => {
      if (done.current) return;
      done.current = true;
      navigator.vibrate?.(80);
      onResult(text);
    },
    [onResult],
  );

  useEffect(() => {
    if (live) return;
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: { httpsPort?: number | null }) => h.httpsPort && setHttpsPort(h.httpsPort))
      .catch(() => undefined);
  }, [live]);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let timer = 0;
    setStarting(true);
    setError("");
    setTorch(null);

    (async () => {
      try {
        const stream = await openCamera(deviceId);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        setStarting(false);

        const track = stream.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() ?? {}) as Torch & { focusMode?: string[] };
        if (caps.torch) setTorch(false);
        if (caps.focusMode?.includes("continuous")) {
          track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => undefined);
        }
        navigator.mediaDevices
          .enumerateDevices()
          .then((all) => !cancelled && setDevices(all.filter((d) => d.kind === "videoinput")))
          .catch(() => undefined);

        const tick = async () => {
          if (cancelled || done.current) return;
          if (video.readyState >= 2) {
            const text = await decodeVideoFrame(video).catch(() => null);
            if (text && !cancelled) return finish(text);
          }
          timer = window.setTimeout(tick, 100);
        };
        void tick();
      } catch (e) {
        if (!cancelled) {
          setStarting(false);
          setError(cameraError(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [live, deviceId, attempt, finish]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  }

  async function readPhoto(file: File) {
    setReading(true);
    setError("");
    try {
      const text = await decodeImageFile(file);
      if (text) finish(text);
      else
        setError(
          "No QR code found in that photo. Hold the phone 10–15 cm above the bill, keep the QR code sharp and in the middle, avoid glare, and try again.",
        );
    } catch {
      setError("Could not read that image. Try another photo.");
    } finally {
      setReading(false);
    }
  }

  const secureUrl = `https://${location.hostname}:${httpsPort}${location.pathname}`;
  const fileInput = (ref: RefObject<HTMLInputElement | null>, capture: boolean) => (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      {...(capture ? { capture: "environment" as const } : {})}
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) void readPhoto(file);
      }}
    />
  );

  return (
    <Modal
      title="Scan bill QR code"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-ghost" disabled={reading} onClick={() => pickRef.current?.click()}>
            Upload photo
          </button>
          <button type="button" className="btn btn-ink" disabled={reading} onClick={() => takeRef.current?.click()}>
            {reading ? "Reading…" : "Take photo"}
          </button>
        </>
      }
    >
      {!live && (
        <div className="notice warn">
          <p>
            The live camera only works on a secure page. You opened <b>{location.origin}</b>.
          </p>
          <a className="btn btn-gold" href={secureUrl}>
            Open secure page ({location.hostname}:{httpsPort})
          </a>
          <p className="muted small">
            If the browser warns “not private”, tap Advanced → Proceed (it is this shop computer). Or use “Take photo” below.
          </p>
        </div>
      )}
      {error && (
        <div className="notice warn">
          {error}
          {live && (
            <div>
              <button type="button" className="btn btn-gold" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </div>
          )}
        </div>
      )}
      {live && (
        <>
          <div className="scan-frame" hidden={!!error}>
            <video ref={videoRef} className="camera-view" playsInline muted autoPlay />
            <div className="scan-box" />
            {starting && <div className="scan-status">Starting camera…</div>}
          </div>
          {!error && <p className="muted center">Hold the QR code on the bill inside the square, about 10–15 cm away.</p>}
          {(devices.length > 1 || torch !== null) && (
            <div className="scan-tools">
              {devices.length > 1 && (
                <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} aria-label="Camera">
                  <option value="">Back camera (auto)</option>
                  {devices.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Camera ${i + 1}`}
                    </option>
                  ))}
                </select>
              )}
              {torch !== null && (
                <button type="button" className={`btn ${torch ? "btn-gold" : "btn-ghost"}`} onClick={() => void toggleTorch()}>
                  {torch ? "Light off" : "Light on"}
                </button>
              )}
            </div>
          )}
        </>
      )}
      {fileInput(takeRef, true)}
      {fileInput(pickRef, false)}
    </Modal>
  );
}
