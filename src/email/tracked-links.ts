// TASK-480: links to our own site in emails gain utm words, so the site analytics (TASK-479) can
// tell a visit from a newsletter or an email apart from someone typing the address. Pure: no
// config, no I/O; the send path in src/clients/email.ts passes the hosts in.
//
// The rules, all deliberately cautious, because an address in an email is someone's way back to
// us and a broken one cannot be recalled:
// - only links whose host is our own site (nbcc.scot, www.nbcc.scot, the configured site
//   address). Never news.nbcc.scot or its click tracker, never anyone else's site;
// - a link that already has any utm_ word keeps its own;
// - a link that carries a token or is personal (unsubscribe, preferences, portal, letters, guest
//   details, certificates, set password, admin) is left exactly as it is, and so is any link
//   with a token style query parameter or a part that looks like a long random string;
// - the words go after any existing query and before any #fragment; nothing else changes.
//
// Adding query words to links to our own site is the only change: no host, path or tracking
// setting moves, so the deliverability rules (newsletters on news.nbcc.scot, no state changing
// GET links, Reply-To) are untouched.

export interface LinkTags {
  source: string;
  medium: string;
  campaign: string;
}

export function newsletterLinkTags(newsletterId: number | string): LinkTags {
  return { source: "newsletter", medium: "email", campaign: String(newsletterId) };
}

export function emailLinkTags(kind: string): LinkTags {
  return { source: "email", medium: "email", campaign: kind };
}

// Kinds that only ever go to staff (email log kinds, src/clients/email.ts). Their links stay
// untagged, so a trustee opening the ticket report never counts as an Email visit. A new staff only
// kind belongs here.
export const STAFF_ONLY_KINDS: ReadonlySet<string> = new Set([
  "adminInvite",
  "adminReset",
  "loginCode",
  "lapsedAdmin",
  "ballReport",
  "ballTransferStaff",
  "backupAlert",
]);

// The words for an email of this kind, or null for a staff only kind.
export function linkTagsForKind(kind: string): LinkTags | null {
  return STAFF_ONLY_KINDS.has(kind) ? null : emailLinkTags(kind);
}

const ALWAYS_OURS = ["nbcc.scot", "www.nbcc.scot"];

// The newsletter's sending subdomain and anything under it (click.news.nbcc.scot is SES's click
// tracker) is never "our site", whatever config says.
function isNewsHost(host: string): boolean {
  return host === "news.nbcc.scot" || host.endsWith(".news.nbcc.scot");
}

export function ownSiteHosts(configured: ReadonlyArray<string | undefined | null>): Set<string> {
  const hosts = new Set(ALWAYS_OURS);
  for (const address of configured) {
    if (!address) continue;
    try {
      const host = new URL(address).host.toLowerCase();
      if (host && !isNewsHost(host)) hosts.add(host);
    } catch {
      // A broken configured address simply adds nothing.
    }
  }
  return hosts;
}

// Pages that are personal or carry a token in the path. First path part:
const PERSONAL_FIRST = new Set(["unsubscribe", "preferences", "portal", "admin", "api", "g", "media", "assets"]);
// First two path parts:
const PERSONAL_PAIRS = new Set([
  "thank-you/letter",
  "ball/guests",
  "business/certificate",
  "business/thank-you",
  "gift-aid/declare",
]);
// Anywhere in the path:
const PERSONAL_ANYWHERE = new Set(["unsubscribe", "preferences", "set-password", "reset-password"]);

// Query parameters that carry a token or a one time secret.
const TOKEN_PARAMS = new Set([
  "token",
  "t",
  "k",
  "key",
  "code",
  "sig",
  "signature",
  "session",
  "session_id",
  "sid",
  "otp",
  "auth",
  "access_token",
  "id_token",
  "jwt",
  "secret",
  "hash",
  "nonce",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A long random string: a UUID, a long run of digits, or a long hyphen free run that mixes letters
// with digits or upper with lower case. Readable addresses ("festive-ball-2026") are split on
// hyphens first, so their short words never trip it.
export function looksLikeToken(value: string): boolean {
  if (UUID.test(value)) return true;
  if (/^\d{12,}$/.test(value)) return true;
  return value.split("-").some((piece) => {
    if (piece.length < 16) return false;
    const letters = /[a-z]/i.test(piece);
    return (letters && /\d/.test(piece)) || (/[a-z]/.test(piece) && /[A-Z]/.test(piece));
  });
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

// encodeURIComponent leaves ' ( ) * ! alone; a ' would end a single quoted href early.
function encodeWord(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function queryWords(tags: LinkTags): string {
  return [
    `utm_source=${encodeWord(tags.source)}`,
    `utm_medium=${encodeWord(tags.medium)}`,
    `utm_campaign=${encodeWord(tags.campaign)}`,
  ].join("&");
}

// Whether this (already entity decoded) address should gain the words, and with which separator.
// Null means leave it exactly as it is.
function separatorFor(address: string, hosts: ReadonlySet<string>): "?" | "&" | "" | null {
  if (!/^https?:\/\//i.test(address)) return null;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (!hosts.has(url.host.toLowerCase()) || isNewsHost(url.hostname.toLowerCase())) return null;

  for (const [name, value] of url.searchParams) {
    const key = name.toLowerCase();
    if (key.startsWith("utm_")) return null;
    if (TOKEN_PARAMS.has(key)) return null;
    if (looksLikeToken(value)) return null;
  }

  const parts = url.pathname.split("/").filter(Boolean).map(safeDecode);
  const lower = parts.map((p) => p.toLowerCase());
  if (lower.length && PERSONAL_FIRST.has(lower[0])) return null;
  if (lower.length >= 2 && PERSONAL_PAIRS.has(`${lower[0]}/${lower[1]}`)) return null;
  if (lower.some((p) => PERSONAL_ANYWHERE.has(p))) return null;
  if (parts.some(looksLikeToken)) return null;

  const beforeFragment = address.split("#")[0];
  if (!beforeFragment.includes("?")) return "?";
  return beforeFragment.endsWith("?") || beforeFragment.endsWith("&") ? "" : "&";
}

export function tagUrl(address: string, tags: LinkTags, hosts: ReadonlySet<string>): string {
  const sep = separatorFor(address, hosts);
  if (sep === null) return address;
  const hashAt = address.indexOf("#");
  const head = hashAt === -1 ? address : address.slice(0, hashAt);
  const tail = hashAt === -1 ? "" : address.slice(hashAt);
  return `${head}${sep}${queryWords(tags)}${tail}`;
}

// A numeric reference beyond the last code point (&#1114112;) is left as written rather than
// thrown on; the address then fails to parse or keeps its odd character, which only means it is
// not tagged.
function fromCodePoint(whole: string, code: number): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
}

function decodeAttribute(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (whole, hex: string) => fromCodePoint(whole, parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (whole, dec: string) => fromCodePoint(whole, Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// The first # that starts the fragment, not one inside a numeric entity such as &#38;.
function fragmentStart(value: string): number {
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "#" && value[i - 1] !== "&") return i;
  }
  return -1;
}

// Rewrites href attribute values only. The attribute's existing text is kept byte for byte (no
// decode and re-encode round trip, so an existing &amp; is never doubled), apart from spaces and
// line breaks around a link that is tagged: those are dropped, since "https://nbcc.scot/ball ?utm..."
// would be a different, missing page. The words go before the fragment with & written as &amp;.
export function tagLinksInHtml(html: string, tags: LinkTags, hosts: ReadonlySet<string>): string {
  return html.replace(
    /(\shref\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi,
    (whole, lead: string, dq: string | undefined, sq: string | undefined) => {
      const raw = (dq ?? sq ?? "").trim();
      const quote = dq !== undefined ? '"' : "'";
      const sep = separatorFor(decodeAttribute(raw), hosts);
      if (sep === null) return whole;
      const hashAt = fragmentStart(raw);
      const head = hashAt === -1 ? raw : raw.slice(0, hashAt);
      const tail = hashAt === -1 ? "" : raw.slice(hashAt);
      const words = `${sep}${queryWords(tags)}`.replace(/&/g, "&amp;");
      return `${lead}${quote}${head}${words}${tail}${quote}`;
    },
  );
}

// Bare addresses in the plain text part. Brackets and quotes end an address (the plain text part
// prints "Label (https://...)"), and trailing punctuation belongs to the sentence, not the link.
export function tagLinksInText(text: string, tags: LinkTags, hosts: ReadonlySet<string>): string {
  return text.replace(/https?:\/\/[^\s<>"'()[\]{}]+/gi, (match) => {
    const trailing = /[.,;:!?]+$/.exec(match)?.[0] ?? "";
    const address = trailing ? match.slice(0, -trailing.length) : match;
    return tagUrl(address, tags, hosts) + trailing;
  });
}
