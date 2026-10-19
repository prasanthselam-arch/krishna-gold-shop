import { useEffect, useRef, useState } from "react";
import { photoUrl, type PhotoKind, type Receipt } from "../api";
import { formatDate, formatDateTime, grams, inr } from "../format";
import { Barcode } from "./Barcode";
import { Modal } from "./Modal";

const TITLE = { pledge: "PLEDGE BILL", payment: "PAYMENT RECEIPT", release: "GOLD RELEASE" } as const;

function latestPhoto(r: Receipt, kind: PhotoKind) {
  return [...r.pledge.photos].reverse().find((p) => p.kind === kind);
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`bill-row ${strong ? "strong" : ""}`}>
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

function Card({ r, copy }: { r: Receipt; copy: "CUSTOMER COPY" | "SHOP COPY" }) {
  const p = r.pledge;
  const isRelease = r.kind === "release";
  const person = latestPhoto(r, isRelease ? "release_customer" : "customer");
  const jewel = latestPhoto(r, isRelease ? "release_jewel" : "jewel");
  const rate = `${p.interest_rate}% / ${p.rate_period === "monthly" ? "month" : "year"}${p.interest_type === "compound" ? " (compound)" : ""}`;
  const items = p.gold.map((g) => (g.quantity > 1 ? `${g.name}×${g.quantity}` : g.name)).join(", ");
  const pay = r.lastPayment;

  return (
    <div className="bill-card">
      <div className="bill-head">
        <div>
          <div className="bill-shop">{r.shop}</div>
          <div className="bill-title">{TITLE[r.kind]}</div>
        </div>
        <div className={`bill-copy ${copy === "SHOP COPY" ? "shop" : ""}`}>{copy}</div>
      </div>

      <div className="bill-body">
        <div className="bill-photos">
          {person ? <img src={photoUrl(person.id)} alt="Customer" /> : <div className="bill-nophoto">Photo</div>}
          {jewel ? <img src={photoUrl(jewel.id)} alt="Jewellery" /> : <div className="bill-nophoto">Gold</div>}
        </div>
        <div className="bill-info">
          <div className="bill-name">
            {p.customer_name}
            {p.additional_name && <small> c/o {p.additional_name}</small>}
          </div>
          <Row k="Mobile" v={p.mobile} />
          {r.kind === "pledge" && (
            <>
              <Row k="Date" v={formatDate(p.pledge_date)} />
              <Row k="Loan" v={inr.format(p.principal)} strong />
              <Row k="Interest" v={rate} />
              <Row k="Gold" v={`${p.gold.reduce((s, g) => s + g.quantity, 0)} pcs · ${grams(p.total_weight)}`} />
              <div className="bill-items">{items}</div>
            </>
          )}
          {r.kind === "payment" && pay && (
            <>
              <Row k="Paid on" v={formatDateTime(pay.received_at)} />
              <Row k="Amount paid" v={inr.format(pay.amount)} strong />
              <Row k="To interest" v={inr.format(pay.interest_portion)} />
              <Row k="To loan" v={inr.format(pay.principal_portion)} />
              <Row k="Balance due" v={inr.format(pay.balance_after)} strong />
            </>
          )}
          {isRelease && (
            <>
              <Row k="Released" v={p.released_at ? formatDateTime(p.released_at) : "—"} />
              <Row k="Loan" v={inr.format(p.principal)} />
              <Row k="Interest paid" v={inr.format(p.finance.interestPaid)} />
              <Row k="Total paid" v={inr.format(p.finance.totalPaid)} strong />
              <Row k="Gold" v={`${grams(p.total_weight)} returned`} />
              <div className="bill-items">OTP verified · Loan closed</div>
            </>
          )}
        </div>
      </div>

      <div className="bill-foot">
        <Barcode value={p.token} height={22} width={1} fontSize={8} />
        <div className="bill-meta">
          <div>{r.receipt_no}</div>
          {copy === "SHOP COPY" ? (
            <div className="bill-sign">Customer sign</div>
          ) : (
            <div className="bill-note">{isRelease ? "Thank you" : "Bring this card to pay / collect gold"}</div>
          )}
        </div>
      </div>
    </div>
  );
}

type Paper = "card" | "a4";

async function waitForImages(root: HTMLElement) {
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
}

export function BillPreview({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  const [paper, setPaper] = useState<Paper>(() => (localStorage.getItem("kgs-paper") as Paper) || "a4");
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem("kgs-paper", paper);
    const style = document.createElement("style");
    style.textContent =
      paper === "card"
        ? "@page { size: 85.6mm 54mm; margin: 0; }"
        : "@page { size: A4 portrait; margin: 12mm; }";
    document.head.appendChild(style);
    return () => style.remove();
  }, [paper]);

  async function print() {
    if (areaRef.current) await waitForImages(areaRef.current);
    window.print();
  }

  return (
    <Modal
      title={`${TITLE[receipt.kind]} · ${receipt.pledge.token}`}
      onClose={onClose}
      wide
      className="bill-backdrop"
      footer={
        <>
          <div className="paper-toggle">
            <label>
              <input type="radio" checked={paper === "a4"} onChange={() => setPaper("a4")} /> A4 sheet (cut out)
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
      <div ref={areaRef} className={`print-area paper-${paper}`}>
        <Card r={receipt} copy="CUSTOMER COPY" />
        <Card r={receipt} copy="SHOP COPY" />
      </div>
    </Modal>
  );
}
