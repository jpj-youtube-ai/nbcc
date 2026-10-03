import { escapeHtml } from "../events/render";
import { SINGLE_DONATION_WORDING } from "../declarations/wording";
import { MATERIALS_STATEMENT, POSTAL_ADDRESS_LINES } from "../legal/registration";
import { hasPage, splitStatement, type FundraiserRecord } from "./model";
import { CHARITY_NAME, shell, type MaterialAssets } from "./materials";
import { qrSvg } from "./qr";

// In memory pages (Jaimie, 2026-10-03): funeral collection envelopes, to print from Admin >
// Fundraising and from the organiser's private area (src/routes/fundraise-memory.ts).
//
// A DL envelope, 110 x 220mm: the common size for collection and Gift Aid envelopes, and one most
// home and office printers take. It is printed on its front, one envelope to a page (print as many
// copies as you need): "In memory of <name>" with the dates, the QR code to the page and its address
// in words, and on the right a Gift Aid declaration for one gift with the boxes HMRC needs to match
// it to a taxpayer (full name, home address, postcode, the date) and a box to tick. NBCC's charity
// statement runs along the bottom, word for word, as on every printed piece.
//
// The declaration is HMRC's model for a single donation, with the amount written in, so the money in
// the envelope and the declaration go together; its liability sentence is exactly the give form's
// (SINGLE_DONATION_WORDING). Built the way ./materials.ts builds every piece: one self contained
// page, fonts and logo inlined, everything typed escaped. Plain, gentle words, no dashes.

export const ENVELOPE_PAPER = { name: "DL", widthMm: 220, heightMm: 110 } as const;

/** HMRC's model single donation declaration, with a space for the amount in the envelope. */
export const ENVELOPE_DECLARATION = SINGLE_DONATION_WORDING.wording_snapshot.replace(
  "I want to Gift Aid my donation to",
  "I want to Gift Aid my donation of £________ to",
);

export const ENVELOPE_CHANGES =
  "Please tell us if you want to cancel this declaration, change your name or home address, or no longer pay enough Income Tax or Capital Gains Tax.";

// Review fix: how the envelopes come back. The giver seals theirs and hands it back; whoever is
// collecting posts them to us unopened (or hands them in), so each declaration stays with its money
// and we can claim the Gift Aid. Our address is the registered one, written with the apostrophe the
// printed pieces use ("The Elves' Workshop").
export const ENVELOPE_RETURN =
  "Please seal your envelope and hand it back to the person collecting. All envelopes are posted to NBCC unopened, so we can claim Gift Aid.";
const POST_TO = ["The Elves' Workshop", ...POSTAL_ADDRESS_LINES.slice(1)].join(", ");
export const ENVELOPE_POST_BACK = `Please post the sealed envelopes to us unopened at ${POST_TO} (or hand them in), rather than paying the cash in online, so we can claim Gift Aid on them.`;
/** By the declaration: Gift Aid is only for a giver's own money. */
export const ENVELOPE_OWN_MONEY = "This gift is my own money. It is not from a collection, a company or a group.";

export interface EnvelopeFacts {
  id: number;
  name: string;
  dates: string | null;
  /** The page's short name, printed small as a reference, so staff know whose envelope it is. */
  slug: string;
  /** Shared with another cause: the statement the 2009 regulations ask for, else null. */
  split: string | null;
  /** The page's address, or null when it has no public page. */
  link: string | null;
  linkWords: string | null;
}

/** What an envelope is drawn from: the stored (approved) record only. */
export function envelopeFacts(f: FundraiserRecord, urls: { pageUrl: string }): EnvelopeFacts {
  const link = hasPage(f) ? urls.pageUrl : null;
  return {
    id: f.id,
    name: (f.memoryName ?? f.title).trim(),
    dates: f.memoryDates?.trim() || null,
    slug: f.slug,
    split: splitStatement(f),
    link,
    linkWords: link ? link.replace(/^https?:\/\//, "").replace(/\/+$/, "") : null,
  };
}

// Quiet: cream and tan, the maroon only for the name, nothing festive. Every size in mm or pt, so it
// prints the same everywhere.
const ENVELOPE_CSS = `
  .page.envelope{width:220mm;height:110mm;background:#fff}
  .e-sheet{position:absolute;inset:0;display:grid;grid-template-columns:88mm 1fr;grid-template-rows:1fr auto;column-gap:6mm;
    padding:7mm 8mm 4.5mm}
  .e-left{display:flex;flex-direction:column;min-width:0}
  .e-logo{height:13mm;width:auto;align-self:flex-start}
  .e-eyebrow{margin-top:3.2mm;font-size:6.6pt;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);font-weight:600}
  .e-name{font-family:var(--head);font-weight:700;color:var(--maroon);font-size:18pt;line-height:1.12;margin:1mm 0 0;overflow-wrap:anywhere}
  .e-name.long{font-size:13.5pt}
  .e-dates{margin-top:1mm;font-size:8pt;color:var(--muted)}
  .e-line{margin-top:2.6mm;font-size:7.6pt;line-height:1.45;color:var(--slate);max-width:84mm}
  .e-give{margin-top:auto;display:flex;align-items:center;gap:3mm}
  .e-qr{width:23mm;height:23mm;flex:0 0 auto}
  .e-qr svg{width:100%;height:100%;display:block}
  .e-give-words{font-size:7.4pt;line-height:1.4;color:var(--slate)}
  .e-give-words b{display:block;color:var(--maroon);font-size:7.4pt;overflow-wrap:anywhere}
  .e-right{border:0.35mm solid var(--tan);border-radius:2.5mm;padding:3.2mm 4mm 2.6mm;display:flex;flex-direction:column;min-width:0;background:#FFFDFA}
  .e-ga-head{font-family:var(--head);font-weight:700;color:var(--maroon);font-size:10.5pt;margin:0}
  .e-ga-intro{margin:1mm 0 0;font-size:7pt;line-height:1.4;color:var(--slate)}
  .e-decl{display:grid;grid-template-columns:5mm 1fr;gap:2.2mm;align-items:start;margin-top:2mm}
  .e-tick{width:5mm;height:5mm;border:0.35mm solid var(--maroon);border-radius:0.8mm;background:#fff}
  .e-decl p{margin:0;font-size:7.4pt;line-height:1.42;color:var(--slate)}
  .e-fields{display:grid;grid-template-columns:auto 1fr;column-gap:2mm;row-gap:1.3mm;margin-top:2.6mm;font-size:7.4pt;align-items:end}
  .e-fields .k{color:var(--maroon);font-weight:600;white-space:nowrap}
  .e-fields .v{border-bottom:0.25mm solid #9b8f86;height:6mm}
  .e-fields .row2{display:grid;grid-template-columns:1fr auto 22mm;gap:2mm;align-items:end}
  .e-changes{margin:auto 0 0;padding-top:1.4mm;font-size:6pt;line-height:1.35;color:var(--muted)}
  .e-return{margin-top:2.2mm;font-size:6.8pt;line-height:1.4;color:var(--maroon);font-weight:600;max-width:84mm}
  .e-own{margin:1.4mm 0 0 7.2mm;font-size:6.6pt;line-height:1.35;color:var(--slate);font-weight:600}
  .e-ref{font-size:6pt;color:var(--muted);margin-top:1mm}
  .e-legal{grid-column:1 / span 2;margin-top:2.2mm;padding-top:1.2mm;border-top:0.25mm solid var(--line);font-size:5.6pt;line-height:1.3;color:var(--muted);text-align:center}`;

function envelopePage(d: EnvelopeFacts, a: MaterialAssets): string {
  const name = escapeHtml(d.name);
  const give = d.link && d.linkWords
    ? `<div class="e-give">
        <div class="e-qr">${qrSvg(d.link, { title: `QR code to give in memory of ${d.name}` })}</div>
        <div class="e-give-words">Or give online, in their memory<b>${escapeHtml(d.linkWords)}</b><div class="e-ref">Ref: ${escapeHtml(d.slug)}</div></div>
      </div>`
    : `<div class="e-give"><div class="e-ref">Ref: ${escapeHtml(d.slug)}</div></div>`;
  return `<div class="page envelope">
  <div class="e-sheet">
    <div class="e-left">
      <img class="e-logo" src="${a.logo}" alt="${CHARITY_NAME}">
      <div class="e-eyebrow">In memory of</div>
      <h1 class="e-name${d.name.length > 34 ? " long" : ""}">${name}</h1>
      ${d.dates ? `<div class="e-dates">${escapeHtml(d.dates)}</div>` : ""}
      <p class="e-line">Thank you for your gift. It goes to the ${CHARITY_NAME}, supporting children, young people and vulnerable adults across South West Scotland, all year round.</p>
      <p class="e-return">${escapeHtml(ENVELOPE_RETURN)}</p>
      ${give}
    </div>
    <div class="e-right">
      <p class="e-ga-head">Gift Aid your gift</p>
      <p class="e-ga-intro">If you are a UK taxpayer, Gift Aid adds 25p to every &pound;1 you give, at no cost to you. To add it, tick the box and fill in your details. Your home address lets HMRC know you are a UK taxpayer.</p>
      <div class="e-decl"><span class="e-tick" aria-hidden="true"></span><p>${escapeHtml(ENVELOPE_DECLARATION)}</p></div>
      <p class="e-own">${escapeHtml(ENVELOPE_OWN_MONEY)}</p>
      <div class="e-fields">
        <span class="k">Full name</span><span class="v"></span>
        <span class="k">Home address</span><span class="v"></span>
        <span class="k"></span><span class="v"></span>
        <span class="k">Postcode</span><span class="row2"><span class="v"></span><span class="k">Date</span><span class="v"></span></span>
      </div>
      <p class="e-changes">${escapeHtml(ENVELOPE_CHANGES)}</p>
    </div>
    <div class="e-legal">${d.split ? `<b>${escapeHtml(d.split)}</b> ` : ""}${escapeHtml(MATERIALS_STATEMENT)}</div>
  </div>
</div>`;
}

/** The envelope page: one DL envelope, printed on its front. */
export function renderEnvelope(d: EnvelopeFacts, a: MaterialAssets): string {
  const name = escapeHtml(d.name);
  return shell({
    title: `Collection envelope in memory of ${name}`,
    paper: { rules: `@page{size:${ENVELOPE_PAPER.widthMm}mm ${ENVELOPE_PAPER.heightMm}mm;margin:0}` },
    fontCss: a.fontCss,
    css: ENVELOPE_CSS,
    toolbar: `<span>Collection envelope in memory of <b>${name}</b></span>`,
    body: envelopePage(d, a),
    tip: escapeHtml(
      `Load DL envelopes (110 x 220mm) into your printer, printing on the front. In the print window, choose the paper size DL, landscape, switch off headers and footers, and print as many copies as you need. ${ENVELOPE_POST_BACK}`,
    ),
  });
}
