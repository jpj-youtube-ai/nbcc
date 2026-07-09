// TASK-165 (REQ-069): the public printable thank-you letter PAGE. A thank-you email links to
// `${PORTAL_BASE_URL}/thank-you/letter/<token>`; this renders that stored letter as a full,
// print-optimised A4 HTML page the donor can print or save as a PDF from the browser (a link, not an
// email attachment, keeps deliverability clean). Faithful to assets/thankyou-letter-print.html:
// logo lockup, script signature, pull-quote, donate CTA and the maroon contact/legal bar. Served on
// our own domain, so it links the site stylesheet (fonts + brand tokens) and the real logo. Pure and
// DB-free (the route loads the row and passes it in), so it is unit-tested directly.
import { formatGiftAmount, giftAidUpliftPence } from "./model";

// The fields of a sent letter this page renders (a subset of db ThankYouSent).
export interface ThankYouLetterPageData {
  thankYouName: string;
  addressedTo: string;
  giftType: "money" | "in_kind";
  giftAmountPence: number | null;
  giftInKind: string | null;
  giftAided: boolean;
  personalMessage: string | null;
  signedByName: string;
  signedByRole: string | null;
  sentAt: string; // ISO timestamp; rendered as the letter date
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Money with thousands grouping for the letter body (matches the mockup: £1,500 / £1,875), whole
// pounds shown without decimals. Falls back to the model's formatGiftAmount shape for odd pence.
function letterMoney(pence: number): string {
  if (pence % 100 === 0) return "£" + (pence / 100).toLocaleString("en-GB");
  return formatGiftAmount(pence);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Format an ISO timestamp as e.g. "25 December 2026" (UTC), or "" when unparseable.
function letterDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// The gift callout markup (money + optional Gift-Aid uplift note, or in-kind description).
function giftCallout(d: ThankYouLetterPageData): string {
  if (d.giftType === "in_kind") {
    const items = escapeHtml(d.giftInKind ?? "your kind donation");
    return `<div class="gift-callout">With heartfelt thanks for your donation of <b>${items}</b>.</div>`;
  }
  const amount = letterMoney(d.giftAmountPence ?? 0);
  let note = "";
  if (d.giftAided) {
    const worth = letterMoney((d.giftAmountPence ?? 0) + giftAidUpliftPence(d.giftAmountPence ?? 0));
    note = `<span class="ga-note">Because you Gift Aided it, HMRC adds 25%, making your gift worth <b>${worth}</b> to our work, at no extra cost to you.</span>`;
  }
  return `<div class="gift-callout">With heartfelt thanks for your gift of <b>${amount}</b>.${note}</div>`;
}

// Render the full, self-contained printable letter page for one sent thank-you.
export function buildThankYouLetterPage(d: ThankYouLetterPageData): string {
  const title = `Thank you, ${escapeHtml(d.thankYouName)}.`;
  const salutation = `Dear ${escapeHtml(d.addressedTo)},`;
  const personal = d.personalMessage
    ? `<p class="personal">${escapeHtml(d.personalMessage)}</p>`
    : "";
  const role = d.signedByRole ? `<div class="sig-role">${escapeHtml(d.signedByRole)}</div>` : "";

  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Your thank-you letter — NBCC</title>
  <link rel="stylesheet" href="/assets/css/styles.css" />
  <style>
    *{box-sizing:border-box}
    html,body{margin:0;background:var(--slate-soft)}
    .toolbar{position:sticky;top:0;z-index:5;display:flex;gap:12px;align-items:center;justify-content:center;padding:12px;background:var(--maroon);color:var(--cream);font-family:var(--font-body);font-size:.95rem}
    .toolbar button{font-family:var(--font-body);font-weight:600;border:0;border-radius:var(--radius-pill);background:var(--cream);color:var(--maroon);padding:9px 22px;cursor:pointer}
    .page{width:210mm;min-height:297mm;margin:18px auto;background:var(--maroon);padding:7mm;box-sizing:border-box;box-shadow:0 10px 40px rgba(0,0,0,.25)}
    .sheet{background:var(--cream);min-height:calc(297mm - 14mm);display:flex;flex-direction:column;overflow:hidden}
    .sheet-body{flex:1;padding:8mm 15mm 3mm}
    .letter-head{display:flex;justify-content:space-between;align-items:center;gap:12mm}
    .sender{font-family:var(--font-body);font-weight:700;color:var(--maroon);font-size:10.5pt;line-height:1.5;font-style:normal;margin-top:1mm}
    .logo{text-align:center;flex:0 0 auto}
    .logo img{height:48mm;width:auto;display:block;margin:0 auto}
    .logo .tagline{font-family:var(--font-body);font-weight:800;text-transform:uppercase;letter-spacing:.18em;color:var(--maroon);font-size:11pt;margin-top:-2mm;padding-left:.18em}
    .letter-meta{display:flex;justify-content:flex-start;margin-top:7mm}
    .date{font-family:var(--font-body);font-weight:700;color:var(--slate);font-size:10pt;white-space:nowrap}
    .letter-title{font-family:var(--font-head);color:var(--crimson);font-weight:800;letter-spacing:-.01em;font-size:18pt;line-height:1.12;margin:4mm 0 2mm}
    .salutation{font-family:var(--font-head);font-weight:700;color:var(--maroon);font-size:12.5pt;margin:0 0 4mm}
    .letter-body p{font-family:var(--font-body);color:var(--slate);font-size:10pt;line-height:1.5;margin:0 0 2.5mm}
    .gift-callout{background:var(--tan-soft);border-left:4px solid var(--crimson);border-radius:0 8px 8px 0;padding:3mm 5mm;margin:1mm 0 4mm;font-family:var(--font-body);font-size:10.5pt;color:var(--slate)}
    .gift-callout b{color:var(--maroon)}
    .gift-callout .ga-note{display:block;margin-top:1.5mm;font-size:9.5pt;color:var(--holly-dark);line-height:1.45}
    .gift-callout .ga-note b{color:var(--holly-dark)}
    .personal{font-family:var(--font-head);font-style:italic;color:var(--maroon);font-size:11pt;line-height:1.4;margin:0 0 3mm}
    .signoff{margin-top:4mm}
    .signoff p{font-family:var(--font-body);color:var(--slate);font-size:10.5pt;margin:0}
    .signoff .sig-name{font-family:"Snell Roundhand","Palace Script MT","Edwardian Script ITC","Apple Chancery","Lucida Calligraphy","Lucida Handwriting",cursive;font-weight:400;color:var(--crimson);font-size:19pt;line-height:1.15;margin-top:1mm}
    .signoff .sig-role{font-family:var(--font-body);color:var(--slate-soft);font-size:9.5pt}
    .pullquote{font-family:var(--font-head);font-style:italic;color:var(--crimson);text-align:center;font-size:13pt;line-height:1.3;margin:4mm auto 3mm;max-width:150mm}
    .donate{text-align:center;margin-bottom:1mm}
    .donate .eyebrow{font-family:var(--font-body);text-transform:uppercase;letter-spacing:.18em;font-size:8pt;font-weight:600;color:var(--crimson);display:block;margin-bottom:2mm}
    .donate .go{font-family:var(--font-body);font-weight:700;color:var(--maroon);font-size:13pt}
    .donate .go b{color:var(--crimson)}
    .letter-foot{background:var(--maroon);color:var(--cream);padding:5mm 8mm 4mm}
    .letter-foot .frow{display:flex;align-items:center;justify-content:center}
    .letter-foot .cell{display:flex;align-items:center;gap:3mm;padding:0 6mm;font-family:var(--font-body);font-weight:700;font-size:10pt;color:var(--cream)}
    .letter-foot .cell + .cell{border-left:1px solid var(--cream-24)}
    .letter-foot .ic{width:8mm;height:8mm;border:1.3px solid var(--cream-82);border-radius:50%;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
    .letter-foot .ic.pair{border:0;gap:1.5mm;width:auto}
    .letter-foot .ic.pair span{width:6.5mm;height:6.5mm;border:1.3px solid var(--cream-82);border-radius:50%;display:flex;align-items:center;justify-content:center}
    .letter-foot .legal{text-align:center;font-family:var(--font-body);font-weight:400;font-size:7.5pt;color:var(--cream-82);margin-top:3mm}
    @media print{
      html,body{background:#fff}
      .toolbar{display:none}
      .page{margin:0;box-shadow:none;width:auto;min-height:auto}
      *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      @page{size:A4;margin:0}
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <span>Your thank-you letter from NBCC</span>
    <button type="button" onclick="window.print()">Print / Save as PDF</button>
  </div>
  <div class="page">
    <div class="sheet">
      <div class="sheet-body">
        <div class="letter-head">
          <address class="sender">Elves Workshop<br />Annbank Village Hall<br />Weston Avenue<br />Annbank<br />KA6 5EE</address>
          <div class="logo">
            <img src="/assets/img/nbcc-logo.png" alt="Night Before Christmas Campaign" />
            <div class="tagline">Here all year</div>
          </div>
        </div>
        <div class="letter-meta"><div class="date">${escapeHtml(letterDate(d.sentAt))}</div></div>
        <h1 class="letter-title">${title}</h1>
        <p class="salutation">${salutation}</p>
        <div class="letter-body">
          <p>On behalf of everyone at the Night Before Christmas Campaign, thank you. Your generosity means children, young people and vulnerable adults across South West Scotland will know they have not been forgotten this Christmas.</p>
          ${giftCallout(d)}
          ${personal}
          <p>Gifts like yours become Red Bags Full of Joy: thoughtful presents that bring dignity, comfort and a moment of joy. In 2025 our volunteers delivered 7,657 of them across South West Scotland, and the need grows every year.</p>
          <p>We are volunteer-run and here all year round, not just at Christmas. If you would like to fundraise, volunteer, or ask a question, reply to this letter or call the number below.</p>
        </div>
        <div class="signoff">
          <p>With warmest thanks,</p>
          <div class="sig-name">${escapeHtml(d.signedByName)}</div>
          ${role}
        </div>
        <p class="pullquote">&ldquo;How do we change the world?<br />One random act of kindness at a time.&rdquo;</p>
        <div class="donate">
          <span class="eyebrow">How you can donate</span>
          <span class="go">Go to <b>nbcc.scot/donate</b></span>
        </div>
      </div>
      <div class="letter-foot">
        <div class="frow">
          <span class="cell"><span class="ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F8F5EE" stroke-width="1.8" aria-hidden="true"><path d="M4 4h4l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 2 6a2 2 0 0 1 2-2z"/></svg></span>01292 811 015</span>
          <span class="cell"><span class="ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F8F5EE" stroke-width="1.8" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M3 6l9 7 9-7"/></svg></span>giving@nbcc.scot</span>
          <span class="cell"><span class="ic pair"><span><svg width="11" height="11" viewBox="0 0 24 24" fill="#F8F5EE" aria-hidden="true"><path d="M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H7v3h3v6h3v-6h3l1-3h-4v-2c0-.6.4-1 1-1z"/></svg></span><span><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#F8F5EE" stroke-width="1.8" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="#F8F5EE" stroke="none"/></svg></span></span>nbcc.scot</span>
        </div>
        <div class="legal">Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation. Scottish Charity Number SC047995, regulated by OSCR.</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
