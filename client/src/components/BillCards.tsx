import { useEffect, useRef, useState } from "react";
import { photoUrl, type PhotoKind, type Receipt } from "../api";
import { formatDate, inr } from "../format";
import { Modal } from "./Modal";
import { QrCode } from "./QrCode";

const MAX_ROWS = 4;

function firstPhoto(r: Receipt, kind: PhotoKind) {
  return r.pledge.photos.find((p) => p.kind === kind);
}

function weight(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function Card({ r, copy }: { r: Receipt; copy: "CUSTOMER COPY" | "SHOP COPY" }) {
  const p = r.pledge;
  const person = firstPhoto(r, "customer");
  const jewel = firstPhoto(r, "jewel");
  const shown = p.gold.length > MAX_ROWS ? p.gold.slice(0, MAX_ROWS - 1) : p.gold;
  const hidden = p.gold.slice(shown.length);
  const qty = p.gold.reduce((s, g) => s + g.quantity, 0);

  return (
    <div className="bill-card">
      <div className="bill-head">
        <div className="bill-shop">{r.shop}</div>
        <div className={`bill-copy ${copy === "SHOP COPY" ? "shop" : ""}`}>{copy}</div>
      </div>

      <div className="bill-body">
        <div className="bill-photos">
          {person ? <img src={photoUrl(person.id)} alt="Customer" /> : <div className="bill-nophoto">Customer</div>}
          {jewel ? <img src={photoUrl(jewel.id)} alt="Jewellery" /> : <div className="bill-nophoto">Jewellery</div>}
        </div>

        <div className="bill-info">
          <div className="bill-name">{p.customer_name}</div>
          <div className="bill-row">
            <span>Mobile</span>
            <b>{p.mobile}</b>
          </div>
          <div className="bill-row">
            <span>Pledge date</span>
            <b>{formatDate(p.pledge_date)}</b>
          </div>
          <div className="bill-row strong">
            <span>Principal</span>
            <b>{inr.format(p.principal)}</b>
          </div>
          <table className="bill-items">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Wt (g)</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((g, i) => (
                <tr key={i}>
                  <td>{g.name}</td>
                  <td>{g.quantity}</td>
                  <td>{weight(g.weight_grams * g.quantity)}</td>
                </tr>
              ))}
              {hidden.length > 0 && (
                <tr>
                  <td>+{hidden.length} more</td>
                  <td>{hidden.reduce((s, g) => s + g.quantity, 0)}</td>
                  <td>{weight(hidden.reduce((s, g) => s + g.weight_grams * g.quantity, 0))}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td>{qty}</td>
                <td>{weight(p.total_weight)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="bill-qr">
          <QrCode value={p.token} />
          <div className="bill-token">{p.token}</div>
        </div>
      </div>
    </div>
  );
}

type Paper = "card" | "a4";

async function waitForPrintables(root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((done) => {
          if (img.complete) return done();
          img.addEventListener("load", () => done(), { once: true });
          img.addEventListener("error", () => done(), { once: true });
        }),
    ),
  );
  for (let i = 0; i < 20 && root.querySelectorAll(".qr svg").length < 2; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

export function BillPreview({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  const [paper, setPaper] = useState<Paper>(() => (localStorage.getItem("kgs-paper") as Paper) || "a4");
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem("kgs-paper", paper);
    // margin: 0 also stops the browser printing its own header/footer (date, URL, page number).
    const style = document.createElement("style");
    style.textContent =
      paper === "card" ? "@page { size: 85.6mm 54mm; margin: 0; }" : "@page { size: A4 portrait; margin: 0; }";
    document.head.appendChild(style);
    const title = document.title;
    document.title = " ";
    return () => {
      style.remove();
      document.title = title;
    };
  }, [paper]);

  async function print() {
    if (areaRef.current) await waitForPrintables(areaRef.current);
    window.print();
  }

  return (
    <Modal
      title={`Bill · ${receipt.pledge.token}`}
      onClose={onClose}
      wide
      className="bill-backdrop"
      footer={
        <>
          <div className="paper-toggle">
            <label>
              <input type="radio" checked={paper === "a4"} onChange={() => setPaper("a4")} /> A4 sheet
            </label>
            <label>
              <input type="radio" checked={paper === "card"} onChange={() => setPaper("card")} /> ID card printer
            </label>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-gold" onClick={() => void print()}>
            Print both copies
          </button>
        </>
      }
    >
      <div className="bill-scroll">
        <div ref={areaRef} className={`print-area paper-${paper}`}>
          <Card r={receipt} copy="CUSTOMER COPY" />
          <Card r={receipt} copy="SHOP COPY" />
        </div>
      </div>
    </Modal>
  );
}
