import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

export function Barcode({ value, height = 28, width = 1.1, fontSize = 9 }: { value: string; height?: number; width?: number; fontSize?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    JsBarcode(ref.current, value, {
      format: "CODE128",
      height,
      width,
      fontSize,
      margin: 0,
      textMargin: 1,
      displayValue: true,
      font: "monospace",
    });
  }, [value, height, width, fontSize]);
  return <svg ref={ref} className="barcode" aria-label={`Barcode ${value}`} />;
}
