import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { cameraError, cameraSupported, listCameras, openCamera, startVideo, stopStream, takeStill } from "../camera";
import { decodeImage, decodeVideoFrame, type QrResult } from "../qrDecode";

type Torch = MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };

function foreignMessage(text: string): string {
  const short = text.length > 40 ? `${text.slice(0, 40)}…` : text;
  return `That QR code is not a Krishna Gold Shop bill (${short}). Scan the QR printed on the bill.`;
}

export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const takeRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const done = useRef(false);
  const paused = useRef(false);
  const live = cameraSupported();
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [starting, setStarting] = useState(live);
  const [reading, setReading] = useState<number | null>(null);
  const [found, setFound] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [torch, setTorch] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [httpsPort, setHttpsPort] = useState(8443);

  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const finish = useCallback((text: string) => {
    if (done.current) return;
    done.current = true;
    setFound(text);
    navigator.vibrate?.(80);
    window.setTimeout(() => onResultRef.current(text), 350);
  }, []);

  const handle = useCallback(
    (r: QrResult): boolean => {
      if (r.text) {
        finish(r.text);
        return true;
      }
      if (r.foreign) setHint(foreignMessage(r.foreign));
      return false;
    },
    [finish],
  );

  useEffect(() => {
    if (live) return;
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: { httpsPort?: number | null }) => h.httpsPort && setHttpsPort(h.httpsPort))
      .catch(() => undefined);
  }, [live]);

  // Live camera with automatic capture as soon as a bill QR is seen.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let timer = 0;
    setStarting(true);
    setError("");
    setTorch(null);

    (async () => {
      try {
        const stream = await openCamera("environment", deviceId);
        if (cancelled) return stopStream(stream);
        streamRef.current = stream;
        const video = videoRef.current!;
        await startVideo(video, stream);
        if (cancelled) return;
        setStarting(false);

        const track = stream.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() ?? {}) as Torch;
        if (caps.torch) setTorch(false);
        if (caps.focusMode?.includes("continuous")) {
          track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => undefined);
        }
        listCameras().then((d) => !cancelled && setDevices(d));

        const tick = async () => {
          if (cancelled || done.current) return;
          if (!paused.current && video.readyState >= 2) {
            const r = await decodeVideoFrame(video).catch(() => ({ text: null, foreign: null }));
            if (!cancelled && handle(r)) return;
          }
          timer = window.setTimeout(tick, 60);
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
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [live, deviceId, attempt, handle]);

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

  async function readStill(source: Blob | HTMLCanvasElement) {
    setReading(0);
    setHint("");
    paused.current = true;
    try {
      const r = await decodeImage(source, (f) => setReading(f));
      if (!handle(r) && !r.foreign) {
        setHint(
          "No QR code found. Hold the bill flat about 10–15 cm away, keep the QR code sharp and in the square, tilt the bill a little if there is glare, and try again.",
        );
      }
    } catch {
      setHint("Could not read that image. Try another photo.");
    } finally {
      paused.current = false;
      setReading(null);
    }
  }

  async function captureNow() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    void readStill(await takeStill(video, streamRef.current));
  }

  const secureUrl = `https://${location.hostname}:${httpsPort}${location.pathname}`;
  const busy = reading !== null;

  return (
    <Modal
      title="Scan bill QR code"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => pickRef.current?.click()}>
            Upload photo
          </button>
          {live && !error ? (
            <button type="button" className="btn btn-ink" disabled={busy || starting} onClick={() => void captureNow()}>
              {busy ? `Reading… ${Math.round((reading ?? 0) * 100)}%` : "Capture now"}
            </button>
          ) : (
            <button type="button" className="btn btn-ink" disabled={busy} onClick={() => takeRef.current?.click()}>
              {busy ? `Reading… ${Math.round((reading ?? 0) * 100)}%` : "Take photo"}
            </button>
          )}
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
          <div>
            <button type="button" className="btn btn-gold" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </div>
        </div>
      )}
      {live && (
        <>
          <div className={`scan-frame ${found ? "found" : ""}`} hidden={!!error}>
            <video ref={videoRef} className="camera-view" playsInline muted autoPlay />
            <div className="scan-box" />
            {starting && <div className="scan-status">Starting camera…</div>}
            {found && <div className="scan-status ok">✓ QR found · {found}</div>}
          </div>
          {!error && !found && (
            <p className="muted center">
              Hold the bill’s QR code inside the square (10–15 cm away). It is captured automatically.
            </p>
          )}
          {(devices.length > 1 || torch !== null) && !error && (
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
      {hint && !found && <div className="notice warn">{hint}</div>}
      {[
        { ref: takeRef, capture: true },
        { ref: pickRef, capture: false },
      ].map(({ ref, capture }) => (
        <input
          key={String(capture)}
          ref={ref}
          type="file"
          accept="image/*"
          {...(capture ? { capture: "environment" as const } : {})}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void readStill(file);
          }}
        />
      ))}
    </Modal>
  );
}
