import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";

const MAX_SIDE = 1024;
const QUALITY = 0.8;

function toJpeg(source: CanvasImageSource, width: number, height: number): string {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", QUALITY);
}

function fileToJpeg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve(toJpeg(img, img.naturalWidth, img.naturalHeight));
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file is not a photo."));
    };
    img.src = url;
  });
}

export const cameraSupported = () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

function CameraModal({
  title,
  facing,
  onCapture,
  onClose,
}: {
  title: string;
  facing: "user" | "environment";
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    const video: MediaTrackConstraints = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 } }
      : { facingMode: facing, width: { ideal: 1280 } };
    navigator.mediaDevices
      .getUserMedia({ video, audio: false })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play().catch(() => undefined);
        }
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setDevices(all.filter((d) => d.kind === "videoinput"));
      })
      .catch((e: Error) =>
        setError(
          e.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in the browser address bar."
            : "No camera found. Use 'Upload photo' instead.",
        ),
      );
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facing, deviceId]);

  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    onCapture(toJpeg(v, v.videoWidth, v.videoHeight));
    onClose();
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-gold" onClick={capture} disabled={!!error}>
            Take photo
          </button>
        </>
      }
    >
      {error ? (
        <div className="notice err">{error}</div>
      ) : (
        <video ref={videoRef} className="camera-view" playsInline muted />
      )}
      {devices.length > 1 && (
        <div className="field" style={{ marginTop: 8 }}>
          <label>Camera</label>
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">Default</option>
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}
    </Modal>
  );
}

export function PhotoCapture({
  label,
  hint,
  value,
  onChange,
  facing = "environment",
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (dataUrl: string) => void;
  facing?: "user" | "environment";
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const canUseCamera = cameraSupported();

  return (
    <div className={`photo-box ${value ? "has-photo" : ""}`}>
      <div className="photo-label">
        {label} <span className="req">*</span>
      </div>
      {value ? (
        <img src={value} alt={label} className="photo-preview" />
      ) : (
        <div className="photo-empty">{hint || "No photo yet"}</div>
      )}
      <div className="photo-actions">
        {canUseCamera && (
          <button type="button" className="btn btn-ink" onClick={() => setOpen(true)}>
            {value ? "Retake" : "Take photo"}
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
          {canUseCamera ? "Upload" : value ? "Change photo" : "Take / upload photo"}
        </button>
      </div>
      {error && <div className="notice err">{error}</div>}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture={facing}
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            setError("");
            onChange(await fileToJpeg(file));
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      />
      {open && <CameraModal title={label} facing={facing} onCapture={onChange} onClose={() => setOpen(false)} />}
    </div>
  );
}
