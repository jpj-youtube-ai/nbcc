// Shared brand theme + frame for the newsletter block renderer (TASK-168/REQ-069). Mirrors the
// inline-hex palette + 660px cream-card-on-maroon frame of src/thank-you/letter.ts, because email
// clients don't load the site stylesheet. Pure + DB-free — unit-tested directly.

export const MAROON = "#800000";
export const CRIMSON = "#C02238";
export const CREAM = "#F8F5EE";
export const SLATE = "#333333";
export const SLATE_SOFT = "#6F6A66";
export const TAN_SOFT = "#F3E4DD";
export const HOLLY_DARK = "#123C12";
export const CREAM_82 = "rgba(248,245,238,.82)";
export const HEAD = "'Playfair Display', Georgia, 'Times New Roman', serif";
export const BODY = "'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
export const LOGO_URL = "https://nbcc.scot/assets/img/nbcc-logo.png";

export interface RenderCtx {
  firstName: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Escape the whole string, THEN substitute {{firstName}} with the escaped name — so neither the
// author's copy nor the donor's name can inject markup.
export function applyMerge(text: string, ctx: RenderCtx): string {
  return escapeHtml(text).replace(/\{\{firstName\}\}/g, escapeHtml(ctx.firstName));
}

export function brandButton(
  label: string,
  href: string,
  style: "primary" | "outline" | "full" | "link",
): string {
  const safeLabel = escapeHtml(label);
  const safeHref = escapeHtml(href);
  const base = `font-family:${BODY};font-weight:700;font-size:15px;text-decoration:none;display:inline-block`;
  if (style === "link") {
    return `<a href="${safeHref}" style="${base};color:${CRIMSON}">${safeLabel} &rarr;</a>`;
  }
  if (style === "outline") {
    return `<a href="${safeHref}" style="${base};color:${CRIMSON};border:2px solid ${CRIMSON};border-radius:8px;padding:10px 22px">${safeLabel}</a>`;
  }
  const width = style === "full" ? "display:block;text-align:center;" : "";
  return `<a href="${safeHref}" style="${base};${width}color:${CREAM};background:${CRIMSON};border-radius:8px;padding:12px 26px">${safeLabel}</a>`;
}

// Wrap the concatenated block HTML in the fixed email frame + NBCC contact/legal footer bar.
export function renderFrame(innerHtml: string): string {
  return `<!doctype html>
<html lang="en-GB">
<body style="margin:0;background:${MAROON};padding:24px 0;font-family:${BODY}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;margin:0 auto;background:${CREAM}">
    <tr><td style="padding:0">${innerHtml}</td></tr>
    <tr><td style="background:${MAROON};color:${CREAM};padding:20px 40px;font-family:${BODY};font-size:14px;text-align:center">
      <div style="font-weight:700">01292 811 015 &nbsp;·&nbsp; info@nbcc.scot &nbsp;·&nbsp; nbcc.scot</div>
      <div style="color:${CREAM_82};font-size:11px;margin-top:8px">Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation. Scottish Charity Number SC047995, regulated by OSCR.</div>
    </td></tr>
  </table>
</body>
</html>`;
}
