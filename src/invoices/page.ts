import { CHARITY_NAME, OSCR_NUMBER, POSTAL_ADDRESS_LINES, REGISTRATION_LINES } from "../legal/registration";
import { SINGLE_DONATION_WORDING } from "../declarations/wording";
import type { DeclarationFields } from "../declarations/fields";
import type { BankDetails } from "../ball/transfer";
import { GIVING_EMAIL, PHONE_DISPLAY } from "../email/brand";
import { isPayable, type DisplayState, type PayerKind } from "./model";

// The private invoice page, /invoice/<token> (src/routes/invoices.ts): printed or saved as a PDF from the
// browser, in the same look as the Festive Ball's invoice (src/ball/invoice-page.ts). It always shows the
// invoice as it stands. While it can be paid: a Pay by card button, our bank details when they are set,
// and, for a person only, the Gift Aid box. Paid shows a stamp; cancelled says so; neither shows any way
// to pay. Plain forms, so it works with no script at all. Pure: the route loads the invoice and passes it in.

export interface InvoicePageData {
  number: string;
  token: string;
  issuedOn: string;
  dueOn: string;
  state: DisplayState;
  paidOn: string | null;
  paidBy: "card" | "transfer" | null;
  payerKind: PayerKind;
  contactName: string;
  orgName: string | null;
  address: string | null;
  postcode: string | null;
  description: string;
  note: string | null;
  amountPence: number;
  bank: BankDetails | null;
  /** A person's saved Gift Aid declaration, or what they just typed when it needs another look. */
  giftAid: Partial<DeclarationFields> | null;
  /** Just back from Stripe: the payment is being confirmed. */
  justPaid: boolean;
  /** A line to show above the payment box, e.g. what was wrong with the Gift Aid details. */
  message: string | null;
}

const esc = (s: unknown): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const lines = (s: string | null): string => (s ? s.split(/\r?\n/).map((l) => esc(l.trim())).filter(Boolean).join("<br>") : "");

const money = (pence: number): string =>
  `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "2026-11-05" as "5 November 2026". */
function fullDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );
}

function giftAidBox(inv: InvoicePageData): string {
  const g = inv.giftAid ?? {};
  const saved = Boolean(inv.giftAid && inv.giftAid.firstName);
  const field = (name: "firstName" | "lastName" | "houseNameNumber" | "address" | "postcode", label: string, auto: string, wide = false) =>
    `<label class="ga-field${wide ? " wide" : ""}">${label}<input name="${name}" autocomplete="${auto}" value="${esc(g[name] ?? "")}" /></label>`;
  return `<fieldset class="ga">
        <legend>Add Gift Aid</legend>
        <p>If you are a UK taxpayer, we can claim an extra 25p for every £1 you give, at no cost to you.</p>
        <label class="ga-tick"><input type="checkbox" name="giftAid" value="yes"${saved ? " checked" : ""} /> ${esc(SINGLE_DONATION_WORDING.wording_snapshot)}</label>
        ${saved ? `<p class="ga-saved" role="status">Your Gift Aid declaration is saved. Thank you.</p>` : ""}
        <div class="ga-grid">
          ${field("firstName", "First name", "given-name")}
          ${field("lastName", "Last name", "family-name")}
          ${field("houseNameNumber", "House name or number", "address-line1")}
          ${field("address", "Street and town", "address-line2", true)}
          ${field("postcode", "Postcode", "postal-code")}
        </div>
      </fieldset>`;
}

function payBox(inv: InvoicePageData): string {
  if (inv.state === "paid" || inv.state === "paid-after-cancel") {
    const by = inv.paidBy === "card" ? " by card" : inv.paidBy === "transfer" ? " by bank transfer" : "";
    return `<p class="stamp paid">Paid${inv.paidOn ? ` on ${fullDate(inv.paidOn)}` : ""}${by}. Thank you.</p>`;
  }
  if (inv.state === "cancelled") return `<p class="stamp cancelled">This invoice has been cancelled.</p>`;
  if (!isPayable(inv.state)) return "";
  if (inv.justPaid) {
    return `<p class="stamp paid" role="status">Thank you. Your payment is being confirmed and this page will say Paid shortly.</p>`;
  }
  const person = inv.payerKind === "person";
  const ref = esc(inv.number);
  const b = inv.bank;
  return `<section class="pay" aria-labelledby="pay-h">
      <h2 id="pay-h">${inv.state === "overdue" ? "This invoice is now due" : `Please pay by ${fullDate(inv.dueOn)}`}</h2>
      ${inv.message ? `<p class="msg" role="alert">${esc(inv.message)}</p>` : ""}
      <form method="post" action="/invoice/${esc(inv.token)}/pay">
        ${person ? giftAidBox(inv) : ""}
        <div class="actions">
          <button type="submit" class="pay-btn">Pay by card</button>
          ${person && b ? `<button type="submit" class="save-btn" formaction="/invoice/${esc(inv.token)}/gift-aid">Save my Gift Aid declaration</button>` : ""}
        </div>
        <p class="small">Card, Apple Pay or Google Pay, on Stripe's secure payment page.</p>
      </form>
      ${
        b
          ? `<div class="transfer">
        <h3>Or pay by bank transfer</h3>
        <dl>
          <div><dt>Account name</dt><dd>${esc(b.accountName)}</dd></div>
          <div><dt>Sort code</dt><dd>${esc(b.sortCode)}</dd></div>
          <div><dt>Account number</dt><dd>${esc(b.accountNumber)}</dd></div>
          <div><dt>Amount</dt><dd>${money(inv.amountPence)}</dd></div>
        </dl>
        <p>Please use this reference: <b>${ref}</b>, exactly as it is written, so we can match your payment to this invoice.${
          person ? " If you would like Gift Aid, save your declaration above before you pay." : ""
        }</p>
      </div>`
          : ""
      }
    </section>`;
}

export function renderDonationInvoicePage(inv: InvoicePageData): string {
  const ref = esc(inv.number);
  const org = inv.payerKind !== "person" && inv.orgName;
  const addr = [lines(inv.address), esc(inv.postcode ?? "")].filter(Boolean).join("<br>");
  const to = org
    ? `<b>${esc(inv.orgName)}</b>${addr ? `<br>${addr}` : ""}<br>For the attention of ${esc(inv.contactName)}`
    : `<b>${esc(inv.contactName)}</b>${addr ? `<br>${addr}` : ""}`;

  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Invoice ${ref} | NBCC</title>
  <link rel="stylesheet" href="/assets/css/styles.css" />
  <style>
    *{box-sizing:border-box}
    html,body{margin:0;background:var(--tint);-webkit-text-size-adjust:100%;text-size-adjust:100%}
    .toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:center;padding:12px;background:var(--maroon)}
    .toolbar button{font-family:var(--font-body);font-weight:600;border:0;border-radius:var(--radius-pill);background:var(--cream);color:var(--maroon);padding:9px 22px;cursor:pointer}
    .sheet{width:100%;max-width:210mm;margin:18px auto;background:#fffdf8;padding:clamp(18px,6vw,16mm);font-family:var(--font-body);color:var(--slate);font-size:10.5pt;line-height:1.5;box-shadow:0 8px 30px rgba(0,0,0,.12)}
    .head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8mm;align-items:flex-start}
    .from{font-style:normal;line-height:1.45}
    .from b{color:var(--maroon)}
    .head img{height:26mm;width:auto}
    h1{font-family:var(--font-head);color:var(--crimson);font-size:22pt;margin:8mm 0 2mm;letter-spacing:-.01em}
    .meta{display:flex;flex-wrap:wrap;gap:2mm 10mm;margin:0 0 6mm;color:var(--slate-soft)}
    .meta b{color:var(--slate)}
    .to h2,.pay h2{font-family:var(--font-body);font-size:9pt;text-transform:uppercase;letter-spacing:.12em;color:var(--slate-soft);margin:0 0 1.5mm}
    .to p{margin:0;overflow-wrap:anywhere}
    table{width:100%;border-collapse:collapse;margin:8mm 0 2mm}
    th{text-align:left;font-size:9pt;text-transform:uppercase;letter-spacing:.1em;color:var(--slate-soft);border-bottom:1px solid var(--line);padding:2mm 0}
    td{padding:3mm 0;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
    .num{text-align:right;white-space:nowrap;padding-left:6mm;font-variant-numeric:tabular-nums lining-nums}
    tfoot td{border-bottom:0;font-weight:700;color:var(--maroon);font-size:12pt}
    .note{margin:0 0 4mm;font-family:var(--font-head);font-style:italic;color:var(--maroon);overflow-wrap:anywhere}
    .vat{margin:0 0 8mm;color:var(--slate-soft);font-size:9.5pt}
    .pay{background:var(--tan-soft);border-radius:10px;padding:5mm 6mm}
    .pay h2{color:var(--maroon);font-size:13pt;letter-spacing:0;text-transform:none;font-family:var(--font-head);margin-bottom:3mm}
    .pay h3{font-family:var(--font-head);color:var(--maroon);font-size:11pt;margin:0 0 2mm}
    .pay p{margin:0;font-size:9.5pt}
    .msg{background:#fffdf8;border:1px solid var(--crimson);border-radius:8px;padding:2.5mm 4mm;margin:0 0 4mm !important;color:var(--crimson);font-weight:600}
    .ga{border:0;margin:0 0 4mm;padding:0}
    .ga legend{font-family:var(--font-head);color:var(--maroon);font-weight:700;font-size:11pt;padding:0;margin:0 0 1mm}
    .ga-tick{display:flex;gap:3mm;align-items:flex-start;margin:2mm 0;font-size:9.5pt}
    .ga-tick input{margin-top:1mm;width:18px;height:18px;flex:none;accent-color:var(--crimson)}
    .ga-saved{color:var(--holly-dark);font-weight:600;margin:0 0 2mm !important}
    .ga-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:2mm 4mm}
    .ga-field{display:flex;flex-direction:column;font-size:9pt;color:var(--slate-soft);gap:1mm}
    .ga-field.wide{grid-column:1/-1}
    .ga-field input{font:inherit;font-size:11pt;color:var(--slate);padding:2mm 3mm;border:1px solid var(--line);border-radius:6px;background:#fff;min-height:40px}
    .actions{display:flex;flex-wrap:wrap;gap:3mm;margin:2mm 0}
    .actions button{font-family:var(--font-body);font-weight:700;font-size:11pt;border-radius:var(--radius-pill);padding:3mm 7mm;cursor:pointer;min-height:44px}
    .pay-btn{background:var(--crimson);color:var(--cream);border:0}
    .save-btn{background:transparent;color:var(--maroon);border:1.5px solid var(--maroon)}
    .small{font-size:8.5pt !important;color:var(--slate-soft)}
    .transfer{margin-top:5mm;padding-top:4mm;border-top:1px solid rgba(128,0,0,.18)}
    .transfer dl{margin:0 0 3mm;display:grid;grid-template-columns:repeat(auto-fit,minmax(38mm,1fr));gap:3mm 8mm}
    .transfer dt{font-size:9pt;color:var(--slate-soft)}
    .transfer dd{margin:0;font-weight:700;color:var(--maroon);font-size:12pt;font-variant-numeric:lining-nums tabular-nums;letter-spacing:.02em;overflow-wrap:anywhere}
    .stamp{font-family:var(--font-head);font-size:16pt;font-weight:800;padding:4mm 6mm;border-radius:10px;margin:0}
    .stamp.paid{background:var(--holly-soft);color:var(--holly-dark)}
    .stamp.cancelled{background:var(--tan-soft);color:var(--maroon)}
    .legal{margin-top:10mm;font-size:8pt;color:var(--slate-soft)}
    .legal p{margin:0}
    @media print{
      html,body{background:#fff}
      .toolbar,form,.msg{display:none}
      .sheet{margin:0;box-shadow:none;max-width:none;padding:14mm}
      *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      @page{size:A4;margin:0}
    }
  </style>
</head>
<body>
  <div class="toolbar"><button type="button" onclick="window.print()">Print or save as PDF</button></div>
  <main class="sheet">
    <div class="head">
      <address class="from"><b>${esc(CHARITY_NAME)}</b><br />${POSTAL_ADDRESS_LINES.map(esc).join("<br />")}<br />${esc(GIVING_EMAIL)} &middot; ${esc(PHONE_DISPLAY)}</address>
      <img src="/assets/img/nbcc-logo.png" alt="" />
    </div>

    <h1>Invoice ${ref}</h1>
    <p class="meta"><span>Date <b>${fullDate(inv.issuedOn)}</b></span><span>Invoice number <b>${ref}</b></span><span>Due <b>${fullDate(inv.dueOn)}</b></span></p>

    <section class="to" aria-labelledby="to-h">
      <h2 id="to-h">To</h2>
      <p>${to}</p>
    </section>

    <table>
      <thead><tr><th scope="col">Description</th><th scope="col" class="num">Amount</th></tr></thead>
      <tbody><tr><td>${esc(inv.description)}</td><td class="num">${money(inv.amountPence)}</td></tr></tbody>
      <tfoot><tr><td>Total</td><td class="num">${money(inv.amountPence)}</td></tr></tfoot>
    </table>
    ${inv.note ? `<p class="note">${esc(inv.note)}</p>` : ""}
    <p class="vat">NBCC is not registered for VAT. This is a donation, so no VAT is due.</p>

    ${payBox(inv)}

    <div class="legal"><p>${REGISTRATION_LINES.map(esc).join(" ")}</p><p>Scottish Charity Number ${OSCR_NUMBER}.</p></div>
  </main>
</body>
</html>`;
}
