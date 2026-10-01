import { CHARITY_NAME, OSCR_NUMBER, POSTAL_ADDRESS_LINES, REGISTRATION_LINES } from "../legal/registration";
import { describe, money } from "./confirmation-email";
import { escapeHtml } from "./page";

// TASK-486: the printable invoice for a Festive Ball booking paid by bank transfer, at the private
// link /ball/invoice/<token> (src/ball/invoice-token.ts). Pure: the route loads the booking and passes
// it in. Printed or saved as a PDF from the browser, like the thank-you letter, and it always shows the
// booking as it stands: once paid it says Paid, and once cancelled it says so and gives no bank details.
//
// The invoice number is the booking reference, which is also the payment reference. NBCC is not
// registered for VAT, so there is no VAT line, and it says so. The donation is its own line: it is a
// gift, not part of the price of the evening.

export interface InvoicePageData {
  reference: string;
  /** The UK date it was booked: the invoice date. */
  issuedOn: string;
  payBy: string;
  status: "pending" | "paid" | "cancelled";
  /** The UK date it was marked paid. */
  paidOn: string | null;
  company: string;
  address: string;
  po: string | null;
  buyerName: string;
  kind: "seat" | "table";
  quantity: number;
  seats: number;
  ticketsPence: number;
  donationPence: number;
  totalPence: number;
  bank: { accountName: string; sortCode: string; accountNumber: string } | null;
}

/** "2026-10-01" as "1 October 2026". */
function fullDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );
}

const lines = (s: string) => escapeHtml(s).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join("<br />");

export function renderInvoicePage(inv: InvoicePageData): string {
  const ref = escapeHtml(inv.reference);
  const rows: Array<[string, number]> = [
    [`Festive Ball 2026, Saturday 7 November 2026, The Park Hotel, Kilmarnock: ${describe(inv)}`, inv.ticketsPence],
  ];
  if (inv.donationPence > 0) rows.push(["Donation to NBCC", inv.donationPence]);
  const rowsHtml = rows
    .map(([what, pence]) => `<tr><td>${escapeHtml(what)}</td><td class="num">${money(pence)}</td></tr>`)
    .join("");

  let state: string;
  if (inv.status === "paid") {
    state = `<p class="stamp paid">Paid${inv.paidOn ? ` on ${fullDate(inv.paidOn)}` : ""}. Thank you.</p>`;
  } else if (inv.status === "cancelled") {
    state = `<p class="stamp cancelled">This invoice has been cancelled.</p>`;
  } else {
    const b = inv.bank;
    state = `<section class="pay" aria-labelledby="pay-h">
      <h2 id="pay-h">Please pay by ${fullDate(inv.payBy)}</h2>
      ${
        b
          ? `<dl>
        <div><dt>Account name</dt><dd>${escapeHtml(b.accountName)}</dd></div>
        <div><dt>Sort code</dt><dd>${escapeHtml(b.sortCode)}</dd></div>
        <div><dt>Account number</dt><dd>${escapeHtml(b.accountNumber)}</dd></div>
        <div><dt>Payment reference</dt><dd>${ref}</dd></div>
      </dl>
      <p>Please use the reference exactly as it is written, so we can match your payment to this invoice.</p>`
          : `<p>Please contact us for our bank details, quoting ${ref}.</p>`
      }
    </section>`;
  }

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
    .to p{margin:0}
    table{width:100%;border-collapse:collapse;margin:8mm 0 2mm}
    th{text-align:left;font-size:9pt;text-transform:uppercase;letter-spacing:.1em;color:var(--slate-soft);border-bottom:1px solid var(--line);padding:2mm 0}
    td{padding:3mm 0;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
    .num{text-align:right;white-space:nowrap;padding-left:6mm;font-variant-numeric:tabular-nums lining-nums}
    tfoot td{border-bottom:0;font-weight:700;color:var(--maroon);font-size:12pt}
    .vat{margin:0 0 8mm;color:var(--slate-soft);font-size:9.5pt}
    .pay{background:var(--tan-soft);border-radius:10px;padding:5mm 6mm}
    .pay h2{color:var(--maroon);font-size:11pt;letter-spacing:0;text-transform:none;font-family:var(--font-head);margin-bottom:3mm}
    .pay dl{margin:0 0 3mm;display:grid;grid-template-columns:repeat(auto-fit,minmax(42mm,1fr));gap:3mm 8mm}
    .pay dt{font-size:9pt;color:var(--slate-soft)}
    .pay dd{margin:0;font-weight:700;color:var(--maroon);font-size:12pt;font-variant-numeric:lining-nums tabular-nums;letter-spacing:.02em;overflow-wrap:anywhere}
    .pay p{margin:0;font-size:9.5pt}
    .stamp{font-family:var(--font-head);font-size:16pt;font-weight:800;padding:4mm 6mm;border-radius:10px;margin:0}
    .stamp.paid{background:var(--holly-soft);color:var(--holly-dark)}
    .stamp.cancelled{background:var(--tan-soft);color:var(--maroon)}
    .legal{margin-top:10mm;font-size:8pt;color:var(--slate-soft)}
    .legal p{margin:0}
    @media print{
      html,body{background:#fff}
      .toolbar{display:none}
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
      <address class="from"><b>${escapeHtml(CHARITY_NAME)}</b><br />${POSTAL_ADDRESS_LINES.map(escapeHtml).join("<br />")}<br />events@nbcc.scot &middot; 01292 811 015</address>
      <img src="/assets/img/nbcc-logo.png" alt="" />
    </div>

    <h1>Invoice ${ref}</h1>
    <p class="meta"><span>Date <b>${fullDate(inv.issuedOn)}</b></span><span>Invoice number <b>${ref}</b></span>${
      inv.po ? `<span>Purchase order <b>${escapeHtml(inv.po)}</b></span>` : ""
    }</p>

    <section class="to" aria-labelledby="to-h">
      <h2 id="to-h">Bill to</h2>
      <p><b>${escapeHtml(inv.company)}</b><br />${lines(inv.address)}<br />For the attention of ${escapeHtml(inv.buyerName)}</p>
    </section>

    <table>
      <thead><tr><th scope="col">Description</th><th scope="col" class="num">Amount</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${money(inv.totalPence)}</td></tr></tfoot>
    </table>
    <p class="vat">Not registered for VAT, so no VAT is charged.</p>

    ${state}

    <div class="legal"><p>${REGISTRATION_LINES.map(escapeHtml).join(" ")}</p><p>Scottish Charity Number ${OSCR_NUMBER}.</p></div>
  </main>
</body>
</html>`;
}
