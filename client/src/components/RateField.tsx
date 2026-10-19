import type { RateUnit, RupeeBasis } from "../api";
import { inr, paiseInput, rupeesInput } from "../format";

export function rateFieldLabel(unit: RateUnit, basis: RupeeBasis): string {
  if (unit === "percent") return "Interest rate (%)";
  return basis > 0 ? `Interest per ${inr.format(basis)} (₹)` : "Interest amount (₹)";
}

/** Cleans what was typed: whole rupees for a fixed amount, up to 2 decimals otherwise. */
export function cleanRate(v: string, unit: RateUnit, basis: RupeeBasis): string {
  if (unit === "rupees" && basis === 0) return rupeesInput(v);
  return unit === "rupees" ? paiseInput(v) : v;
}

export function RateField({
  unit,
  rate,
  basis,
  onUnit,
  onRate,
  big = false,
  required = false,
  label,
}: {
  unit: RateUnit;
  rate: string;
  basis: RupeeBasis;
  onUnit: (u: RateUnit) => void;
  onRate: (v: string) => void;
  big?: boolean;
  required?: boolean;
  label?: string;
}) {
  const text = label ?? rateFieldLabel(unit, basis);
  return (
    <div className="field">
      <label>
        {text}
        {required && " *"}
      </label>
      <div className="input-unit">
        <input
          className={big ? "big-input" : undefined}
          inputMode={unit === "rupees" && basis === 0 ? "numeric" : "decimal"}
          aria-label={text}
          value={rate}
          onChange={(e) => onRate(cleanRate(e.target.value, unit, basis))}
        />
        <div className="seg" role="group" aria-label="Interest unit">
          <button type="button" className={unit === "percent" ? "active" : ""} onClick={() => onUnit("percent")}>
            %
          </button>
          <button
            type="button"
            className={unit === "rupees" ? "active" : ""}
            onClick={() => {
              onUnit("rupees");
              onRate(cleanRate(rate, "rupees", basis));
            }}
          >
            ₹
          </button>
        </div>
      </div>
    </div>
  );
}
