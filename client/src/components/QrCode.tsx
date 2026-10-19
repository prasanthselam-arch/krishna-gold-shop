import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrCode({ value, className = "" }: { value: string; className?: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let alive = true;
    QRCode.toString(value, { type: "svg", errorCorrectionLevel: "Q", margin: 1 })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(""));
    return () => {
      alive = false;
    };
  }, [value]);
  return <div className={`qr ${className}`} role="img" aria-label={`QR code ${value}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}
