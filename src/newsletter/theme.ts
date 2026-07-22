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
export const CREAM_24 = "rgba(248,245,238,.24)";
export const HEAD = "'Playfair Display', Georgia, 'Times New Roman', serif";
export const BODY = "'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
export const LOGO_URL = "https://nbcc.scot/assets/img/nbcc-logo.png";

export interface RenderCtx {
  firstName: string;
  // Per-recipient unsubscribe URL. When present, the frame footer renders a branded Unsubscribe
  // button + the PECR opt-in reason line. The live preview passes a placeholder so the button shows.
  unsubscribeUrl?: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// TASK-254: {{firstName}} in the SUBJECT line.
//
// Deliberately NOT applyMerge. That escapes, because a body is HTML — but a subject line is PLAIN
// TEXT that a mail client prints literally, so escaping it would put "Hey, O&#39;Brien" and
// "Ben &amp; Jerry" in donors' inboxes. Two different jobs, two functions.
//
// A blank name falls back to "friend" for the same reason the body's firstNameOf does: "Hey, !" must
// never reach a donor. The send already passes a resolved name; this is the backstop.
export function mergeSubject(subject: string, firstName: string): string {
  const name = firstName.trim() || "friend";
  return subject.replace(/\{\{firstName\}\}/g, name);
}

// TASK-253: inline emphasis. An author marks a phrase **bold** or *italic* in the plain text; those
// markers become <strong>/<em> HERE, on ALREADY-ESCAPED copy. That ordering is the whole safety
// argument: the input can contain no live markup by this point, so the only tags that can reach a
// donor's inbox are the two we introduce ourselves — no sanitiser, no allowlist, nothing to get wrong.
// The block's data stays a plain string, so templates, size steps and the merge all keep working.
// <strong>/<em> are the two most universally supported tags in email (Outlook included), which is why
// this is safe where arbitrary per-word font sizes were not.
// Bold runs first so `**x**` is consumed before the italic pass; a lone `*` is left alone.
function applyEmphasis(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

// Prose an author wrote: escaped, then emphasised. Use for any field where a paragraph is written —
// NOT for a title or a button label, where emphasis has no business.
export function proseHtml(text: string): string {
  return applyEmphasis(escapeHtml(text));
}

// Escape the whole string, THEN substitute {{firstName}} with the escaped name — so neither the
// author's copy nor the donor's name can inject markup.
// The emphasis pass runs BEFORE the substitution, so a donor called "**Bob**" has their name printed
// rather than bolded: their name is never read for markers.
export function applyMerge(text: string, ctx: RenderCtx): string {
  return proseHtml(text).replace(/\{\{firstName\}\}/g, escapeHtml(ctx.firstName));
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

// Contact icons as HOSTED PNG <img>s (TASK-266), the LOGO_URL pattern. They were inline SVG, but
// Gmail (and other clients) strips <svg> entirely while keeping the styled chip <span> — recipients
// saw empty rings where the phone/mail/social icons belonged. The PNGs are cream-on-transparent,
// rendered at 3x their display size (assets/img/email-icon-*.png), decorative (empty alt: the
// contact text sits right beside each icon).
const iconImg = (name: string, display: number): string =>
  `<img src="https://nbcc.scot/assets/img/email-icon-${name}.png" width="${display}" height="${display}" alt="" style="vertical-align:middle;display:inline-block;border:0" />`;
const ICON_PHONE = iconImg("phone", 13);
const ICON_MAIL = iconImg("mail", 13);
const ICON_FB = iconImg("facebook", 10);
const ICON_IG = iconImg("instagram", 10);

// A circular icon chip: fixed-size span with a hairline ring, holding one inline SVG.
function iconChip(svg: string, size = 22): string {
  return `<span style="display:inline-block;width:${size}px;height:${size}px;line-height:${size}px;text-align:center;border:1px solid ${CREAM_82};border-radius:50%;margin-right:8px;vertical-align:middle">${svg}</span>`;
}

// One contact cell: an icon chip (or chips) followed by the contact text, matching the .ty-cell layout.
function contactCell(inner: string, divider: boolean): string {
  const border = divider ? `border-left:1px solid ${CREAM_24};` : "";
  return `<td style="${border}padding:0 20px;font-family:${BODY};font-weight:700;font-size:14px;color:${CREAM};white-space:nowrap">${inner}</td>`;
}

// The contact text as an explicitly cream-coloured anchor. Wrapping it pre-empts the auto-linking
// that mail clients and browsers apply to bare phone numbers / emails / URLs — which would otherwise
// render them as default blue links (in the sent email AND the admin preview iframe). Because it is
// already an <a> with an inline colour, the client leaves it cream instead of recolouring it.
function contactLink(href: string, text: string): string {
  return `<a href="${href}" style="color:${CREAM};text-decoration:none">${text}</a>`;
}

// The branded unsubscribe row for the footer: the PECR opt-in reason line + a cream pill button
// linking to the recipient's one-click unsubscribe URL (the /unsubscribe/<token> route flips the
// donor's email_consent off). Rendered only when a URL is supplied.
function unsubscribeRow(url: string): string {
  const safe = escapeHtml(url);
  return `<div style="margin-top:16px;padding-top:14px;border-top:1px solid ${CREAM_24}">
      <div style="color:${CREAM_82};font-size:11px;margin-bottom:8px">You're receiving this because you opted in to updates from NBCC.</div>
      <a href="${safe}" style="display:inline-block;font-family:${BODY};font-weight:600;font-size:12px;color:${CREAM};text-decoration:none;border:1px solid ${CREAM_82};border-radius:999px;padding:7px 18px">Unsubscribe</a>
    </div>`;
}

// Wrap the concatenated block HTML in the fixed email frame + NBCC contact/legal footer bar. The
// contact bar mirrors the thank-you letter footer: circular phone / envelope / social icon chips
// around the contact text (they degrade to plain text in clients that strip inline SVG). When an
// unsubscribe URL is given, a branded Unsubscribe button is appended to the footer.
export function renderFrame(innerHtml: string, unsubscribeUrl?: string): string {
  const socialChips =
    `<span style="display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border:1px solid ${CREAM_82};border-radius:50%;vertical-align:middle">${ICON_FB}</span>` +
    `<span style="display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border:1px solid ${CREAM_82};border-radius:50%;margin:0 8px 0 4px;vertical-align:middle">${ICON_IG}</span>`;
  const footRow =
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr>` +
    contactCell(`${iconChip(ICON_PHONE)}${contactLink("tel:+441292811015", "01292 811 015")}`, false) +
    contactCell(`${iconChip(ICON_MAIL)}${contactLink("mailto:newsletter@nbcc.scot", "newsletter@nbcc.scot")}`, true) +
    contactCell(`${socialChips}${contactLink("https://nbcc.scot", "nbcc.scot")}`, true) +
    `</tr></table>`;
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- Keep the fixed maroon/cream palette in dark-mode mail clients: color-scheme "light" + the
     supported-color-schemes hint tell Apple Mail / iOS / newer Outlook not to auto-invert the
     colours. Combined with the fully inline colours below, the newsletter renders the same in
     light and dark. (Gmail's app does its own partial adjustment that ignores these hints; there
     is no email-wide way to fully override that, but this covers the clients that honour it.) -->
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<style>
  :root { color-scheme: light; supported-color-schemes: light; }
</style>
</head>
<body style="margin:0;background:${MAROON};padding:24px 0;font-family:${BODY}">
  <!-- TASK-264: the maroon frame is part of the 660px card (outer maroon cell, 12px padding all
       round), matching the thank-you letter's cream-card-on-maroon look. Body background alone is
       not enough: Outlook ignores it, and the composer preview iframe is exactly card-width, so
       only an in-card frame shows maroon on every edge everywhere. -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;margin:0 auto">
    <tr><td style="background:${MAROON};padding:12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}">
        <tr><td style="padding:0">${innerHtml}</td></tr>
        <tr><td style="background:${MAROON};color:${CREAM};padding:20px 40px;font-family:${BODY};font-size:14px;text-align:center">
          ${footRow}
          <div style="color:${CREAM_82};font-size:11px;margin-top:12px">Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation. Scottish Charity Number SC047995, regulated by OSCR.</div>
          ${unsubscribeUrl ? unsubscribeRow(unsubscribeUrl) : ""}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
