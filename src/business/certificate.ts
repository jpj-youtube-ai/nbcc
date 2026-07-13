import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-211: the per-business Platinum Certificate of Appreciation — the print-ready HTML page served
// by GET /business/certificate/:token (src/routes/business.ts). This module owns the RENDER: the
// approved cert.html design (maroon frame, engraved "Platinum Donor" mark, the business name as the
// hero, "Supporting since <Month Year>", Jodie McFarlane's signature block, the charity registration)
// reproduced as a fully self-contained page. Self-contained = the two brand fonts and the NBCC logo
// are base64-inlined, so the browser can print it to PDF with no network. No server-side PDF library
// (task constraint) — the browser's own print-to-PDF is the delivery.
//
// The pure helpers (formatMonthYear, certificateHeroName) are DB-free and unit-tested per golden rule
// 5; buildCertificateHtml reads the committed brand assets at runtime (cached) and assembles the page.
// NOTE: no dashes appear in any human-readable certificate copy (task constraint).

// Repo root at runtime: this file compiles to dist/business/certificate.js, so ../.. is the app root
// (repo root locally, /app in the container) — the same asset-resolution used by src/routes/api.ts.
const REPO_ROOT = resolve(__dirname, "../..");

// Escape a user-sourced value (the business/donor name) for safe HTML interpolation. Mirrors the
// escapeHtml used across src/routes/site.ts and the render modules.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

// Format a Date as "Month Year" (e.g. December 2025) for the "Supporting since" line. UTC-based so the
// output is deterministic regardless of the server timezone. Pure — no pool/config/clock — so it is
// unit-tested DB-free.
export function formatMonthYear(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// The name shown as the certificate hero: the business's own name when we have one, otherwise the
// donor's contact full_name (a sole trader / partnership donates under an individual donor row WITH a
// business_name; a company has business_name too — but fall back defensively). Pure.
export function certificateHeroName(input: { businessName: string | null; fullName: string }): string {
  const business = (input.businessName ?? "").trim();
  return business.length > 0 ? business : input.fullName;
}

// Load + cache the base64-inlined brand assets (read once, reused for every certificate). Kept lazy so
// importing this module for the pure helpers (or the unit tests) does no file IO.
let cachedAssets: { fontCss: string; logoDataUri: string } | null = null;
function certificateAssets(): { fontCss: string; logoDataUri: string } {
  if (cachedAssets) return cachedAssets;
  const b64 = (rel: string) => readFileSync(resolve(REPO_ROOT, rel)).toString("base64");
  // The site's own two faces (assets/css/styles.css): Playfair Display variable (400 to 800, italic
  // synthesized) covers the title/name/campaign/quote; Poppins covers the body. Inlined so the printed
  // PDF carries the real brand type with no network fetch.
  const playfair = b64("assets/fonts/playfair-var.woff2");
  const poppins = b64("assets/fonts/poppins-400.woff2");
  const logo = b64("assets/img/nbcc-logo.png");
  const fontCss =
    `@font-face{font-family:"Playfair Display";font-style:normal;font-weight:400 800;font-display:swap;` +
    `src:url(data:font/woff2;base64,${playfair}) format("woff2")}` +
    `@font-face{font-family:"Poppins";font-style:normal;font-weight:400 600;font-display:swap;` +
    `src:url(data:font/woff2;base64,${poppins}) format("woff2")}`;
  cachedAssets = { fontCss, logoDataUri: `data:image/png;base64,${logo}` };
  return cachedAssets;
}

// The certificate CSS, reproduced verbatim from the approved cert.html mockup, with the inlined
// @font-face prepended and print rules appended so it prints faithfully to PDF (the maroon frame and
// engraved marks keep their colour via print-color-adjust:exact).
function certificateCss(fontCss: string): string {
  return `${fontCss}
  :root{
    --cream:#FBF7EF; --maroon:#7a1420; --maroon-dk:#5c0f18; --ink:#33302c;
    --gold:#B8862B; --gold-soft:#e9d9b0; --crimson:#C02238; --holly:#1A531A; --muted:#7a726a;
    --head:"Playfair Display",Georgia,serif; --body:"Poppins",system-ui,sans-serif;
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0}
  .stage{background:#efe9de;min-height:100%;padding:30px 16px 46px;font-family:var(--body)}
  .cert{max-width:880px;margin:0 auto;background:var(--maroon);border-radius:12px;padding:13px;
    box-shadow:0 24px 60px -26px rgba(92,15,24,.6);-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .inner{background:radial-gradient(130% 100% at 50% 0%, #fffdf8 0%, var(--cream) 72%);
    border:1.5px solid #e7ddcb;border-radius:6px;
    padding:34px clamp(24px,5vw,56px) 30px;text-align:center;position:relative;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}

  .top{display:flex;align-items:center;justify-content:space-between;gap:16px}
  .logo{width:clamp(72px,10vw,104px);height:auto;display:block}
  .titlewrap{flex:1}
  .title{font-family:var(--head);font-weight:700;font-size:clamp(1.9rem,4.6vw,2.9rem);color:var(--maroon);line-height:1.02;letter-spacing:.01em}
  .plat{display:inline-flex;align-items:center;justify-content:center;gap:clamp(10px,2vw,16px);margin-top:14px}
  .plat::before,.plat::after{content:"";height:1px;width:clamp(22px,6vw,52px);flex:0 0 auto;
    background:linear-gradient(90deg,transparent,#9aa0ab);print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .plat::after{background:linear-gradient(90deg,#9aa0ab,transparent)}
  .plat span{font-family:var(--body);font-weight:700;letter-spacing:.32em;text-transform:uppercase;
    font-size:clamp(.86rem,2.1vw,1.14rem);color:#4c5460;margin-right:-.32em;
    background:linear-gradient(180deg,#8b929d 0%,#565e69 46%,#3f4752 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
    print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .to{margin-top:24px;font-family:var(--body);font-size:.7rem;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);font-weight:600}
  .name{font-family:var(--head);font-weight:700;font-size:clamp(1.7rem,5vw,2.9rem);color:var(--maroon-dk);line-height:1.05;margin-top:5px;overflow-wrap:break-word}
  .campaign{font-family:var(--head);font-style:italic;color:var(--maroon);font-size:clamp(1rem,2.2vw,1.32rem);margin-top:8px}
  .since{font-family:var(--body);font-size:clamp(.72rem,1.5vw,.82rem);letter-spacing:.02em;color:var(--muted);margin-top:6px}

  .body{max-width:56ch;margin:16px auto 0;color:var(--ink);font-family:var(--body);font-size:clamp(.82rem,1.6vw,.96rem);line-height:1.55}
  .divider{display:flex;align-items:center;gap:12px;margin:18px auto 0;width:min(66%,440px)}
  .divider::before,.divider::after{content:"";height:1.5px;flex:1;background:linear-gradient(90deg,transparent,var(--maroon))}
  .divider::after{background:linear-gradient(90deg,var(--maroon),transparent)}
  .divider .dot{color:var(--crimson);font-size:.8rem}
  .quote{font-family:var(--head);font-style:italic;color:var(--maroon);font-size:clamp(.98rem,2.1vw,1.24rem);line-height:1.4;margin-top:14px}

  .sign{margin-top:22px}
  .sign .nm{font-family:"Snell Roundhand","Palace Script MT","Edwardian Script ITC","Apple Chancery","Lucida Calligraphy","Lucida Handwriting",cursive;font-weight:400;font-size:clamp(1.95rem,4.4vw,2.75rem);color:var(--crimson);line-height:1.15;padding-bottom:2px}
  .sign .rule{width:210px;max-width:70%;height:1px;background:var(--maroon);opacity:.45;margin:6px auto 6px}
  .sign .ttl{font-family:var(--body);font-size:.6rem;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:700}

  .charity{margin-top:20px;font-family:var(--body);font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}

  @media print{
    @page{size:A4;margin:12mm}
    .stage{background:#fff;min-height:auto;padding:0}
  }`;
}

// Assemble the full certificate page. Pure over its inputs (the escaped business name, the formatted
// "Supporting since" month/year, the inlined fonts and logo), so the render is testable without file
// IO. The body reproduces the approved cert.html markup exactly (the mockup-only annotation footnote
// is intentionally omitted from the real certificate).
export function renderCertificate(input: {
  businessName: string;
  since: string;
  fontCss: string;
  logoDataUri: string;
}): string {
  const name = escapeHtml(input.businessName);
  const since = escapeHtml(input.since);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Certificate of Appreciation | Night Before Christmas Campaign</title>
<style>${certificateCss(input.fontCss)}</style>
</head>
<body>
<div class="stage">
  <div class="cert">
    <div class="inner">
      <div class="top">
        <img class="logo" alt="Night Before Christmas Campaign logo" src="${input.logoDataUri}">
        <div class="titlewrap">
          <div class="title">Certificate of Appreciation</div>
          <div class="plat"><span>Platinum Donor</span></div>
        </div>
      </div>
      <div class="to">Proudly presented to</div>
      <div class="name">${name}</div>
      <div class="campaign">Night Before Christmas Campaign</div>
      <div class="since">Supporting since ${since}</div>
      <p class="body">Thank you for your generous support as a Platinum donor, helping us bring comfort, dignity and joy to children, young people and vulnerable adults experiencing hardship across South West Scotland.</p>
      <div class="divider"><span class="dot">&#9670;</span></div>
      <p class="quote">&ldquo;How do we change the world?<br>One random act of kindness at a time.&rdquo;</p>
      <div class="sign">
        <div class="nm">Jodie McFarlane</div>
        <div class="rule"></div>
        <div class="ttl">Head Elf (Trustee)</div>
      </div>
      <div class="charity">Night Before Christmas Campaign &middot; Scottish Charity No. SC047995</div>
    </div>
  </div>
</div>
</body>
</html>`;
}

// Build the certificate page for a business, reading (and caching) the inlined brand assets. This is
// the impure entry point the route calls; the pure render above is what the tests exercise directly.
export function buildCertificateHtml(input: { businessName: string; since: string }): string {
  const { fontCss, logoDataUri } = certificateAssets();
  return renderCertificate({ ...input, fontCss, logoDataUri });
}
