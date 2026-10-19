export const cameraSupported = () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

export function cameraError(e: unknown): string {
  const name = (e as Error)?.name || "Error";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera permission is blocked. Tap the lock / camera icon in the address bar, allow the camera, then press Try again.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No camera was found on this device. Use “Upload photo” instead.";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError")
    return "The camera is busy in another app or browser tab (e.g. a video call). Close it, then press Try again.";
  if (name === "OverconstrainedError") return "This camera could not be started. Pick another camera.";
  return `Could not start the camera (${name}: ${(e as Error)?.message || "unknown error"}).`;
}

/** Camera settings to try, best first; older phones and laptop webcams reject the strict ones. */
function constraintsFor(facing: "user" | "environment", deviceId: string): MediaTrackConstraints[] {
  if (deviceId) {
    return [
      { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      { deviceId: { exact: deviceId } },
    ];
  }
  return [
    { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    { facingMode: { ideal: facing } },
    {},
  ];
}

export async function openCamera(facing: "user" | "environment", deviceId = ""): Promise<MediaStream> {
  let last: unknown = null;
  for (const video of constraintsFor(facing, deviceId)) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: Object.keys(video).length ? video : true, audio: false });
    } catch (e) {
      last = e;
      const name = (e as Error)?.name;
      if (name === "NotAllowedError" || name === "SecurityError" || name === "NotReadableError") break;
    }
  }
  throw last;
}

/** Attaches the stream and resolves once the first frame is available (videoWidth > 0). */
export async function startVideo(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(() => undefined);
  if (video.videoWidth) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener("loadeddata", done);
      resolve();
    };
    video.addEventListener("loadeddata", done);
    window.setTimeout(done, 4000);
  });
}

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  } catch {
    return [];
  }
}

type ImageCaptureLike = { takePhoto(): Promise<Blob> };

/**
 * Best still picture: the full-resolution sensor photo where the browser
 * supports it (Android Chrome), otherwise the current video frame.
 */
export async function takeStill(video: HTMLVideoElement, stream: MediaStream | null): Promise<Blob | HTMLCanvasElement> {
  const track = stream?.getVideoTracks()[0];
  const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike }).ImageCapture;
  if (track && IC) {
    try {
      return await Promise.race([
        new IC(track).takePhoto(),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), 3000)),
      ]);
    } catch {
      // fall through to the video frame
    }
  }
  const c = document.createElement("canvas");
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext("2d")!.drawImage(video, 0, 0);
  return c;
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}
