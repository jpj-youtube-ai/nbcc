// TASK-511: an organiser's Instagram and Facebook, each in a box of its own on the sign up form.
// People type a handle (@name, or just name) or paste a link, with or without https, from the app or
// the website. Each is tidied to one full https link, so staff can open it from the admin, and
// anything that is not that website's address is refused in plain words. https is never required.
// Pure: no pool, no config.

export type SocialResult = { ok: true; link: string | null } | { ok: false; message: string };

export const SOCIAL_MAX = 300;

export const INSTAGRAM_PROBLEM = "Give your Instagram name, like @yourname, or the link to your Instagram profile.";
export const FACEBOOK_PROBLEM = "Give your Facebook page name, or paste the link to your Facebook page, group or event.";

// Instagram's own rule for a username: letters, numbers, full stops and underscores, up to 30, never
// starting or ending with a full stop, and never two together.
const INSTAGRAM_HANDLE = /^(?!\.)(?!.*\.\.)[A-Za-z0-9._]{1,30}(?<!\.)$/;
// The first part of an Instagram address that is a page of Instagram's own, not a person.
const INSTAGRAM_NOT_A_PERSON = new Set(["p", "reel", "reels", "stories", "explore", "accounts", "tv", "direct", "about", "legal"]);

// A Facebook page name typed on its own: letters, numbers and full stops (Facebook's own rule).
const FACEBOOK_NAME = /^[A-Za-z0-9.]{1,80}$/;
// One part of a Facebook address: letters, numbers, full stops, underscores and hyphens.
const FACEBOOK_PART = /^[A-Za-z0-9._-]{1,100}$/;
const FACEBOOK_NOT_A_PAGE = new Set(["login", "login.php", "home.php", "sharer", "sharer.php", "dialog", "plugins", "help", "settings"]);
// Review fix: a post, a photo or a video is found by its query (story.php?story_fbid=...&id=...,
// watch?v=...), so the query is kept for these, less the tracking Facebook and others add to links.
const FACEBOOK_BY_QUERY = new Set(["story.php", "permalink.php", "watch", "photo.php", "video.php"]);
const TRACKING = /^(fbclid|mibextid|ref|refsrc|rdid|share_url|sfnsn|_rdr|_rdc|__tn__|__cft__.*|__xts__.*|utm_.*)$/i;
const QUERY_KEY = /^[A-Za-z0-9_]{1,40}$/;
const QUERY_VALUE = /^[A-Za-z0-9._~%-]{1,200}$/;

/** The query of a post or video link, less tracking: "story_fbid=123&id=456", or null if unusable. */
function keptQuery(query: string): string | null {
  const kept: string[] = [];
  for (const pair of query.replace(/^\?/, "").split("&")) {
    if (!pair) continue;
    const at = pair.indexOf("=");
    const key = at === -1 ? pair : pair.slice(0, at);
    const value = at === -1 ? "" : pair.slice(at + 1);
    if (TRACKING.test(key)) continue;
    if (!QUERY_KEY.test(key) || !QUERY_VALUE.test(value)) return null;
    kept.push(key + "=" + value);
  }
  return kept.length ? kept.join("&") : null;
}

/**
 * A pasted address taken apart: the host, and the path's parts, with any https, query and fragment
 * set aside. Null when it does not look like an address at all. The query is kept for Facebook's
 * profile.php?id=.
 */
function addressParts(typed: string): { host: string; parts: string[]; query: string } | null {
  const rest = typed.replace(/^https?:\/\//i, "");
  const m = /^([A-Za-z0-9.-]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/.exec(rest);
  if (!m) return null;
  return {
    host: m[1].toLowerCase(),
    parts: (m[2] ?? "").split("/").filter(Boolean),
    query: m[3] ?? "",
  };
}

// An address, rather than a name: https, a slash, or one of the two websites on its own. A name may
// itself have a full stop in it (robin.bakes), so a full stop alone does not make an address.
const looksLikeAddress = (typed: string) =>
  /^https?:\/\//i.test(typed) || typed.includes("/") || /^((www|m)\.)?(instagram\.com|instagr\.am|facebook\.com|fb\.com)$/i.test(typed);

/** Their Instagram, tidied to https://www.instagram.com/<name>, or nothing. */
export function instagramLink(raw: unknown): SocialResult {
  const typed = String(raw ?? "").trim();
  if (typed === "") return { ok: true, link: null };
  const refuse: SocialResult = { ok: false, message: INSTAGRAM_PROBLEM };
  if (typed.length > SOCIAL_MAX) return refuse;
  let handle: string;
  if (looksLikeAddress(typed)) {
    const a = addressParts(typed);
    if (!a || !/^((www|m)\.)?(instagram\.com|instagr\.am)$/.test(a.host)) return refuse;
    const first = a.parts[0] ?? "";
    if (INSTAGRAM_NOT_A_PERSON.has(first.toLowerCase())) return refuse;
    handle = first.replace(/^@/, "");
  } else {
    handle = typed.replace(/^@/, "");
  }
  if (!INSTAGRAM_HANDLE.test(handle)) return refuse;
  return { ok: true, link: `https://www.instagram.com/${handle.toLowerCase()}` };
}

/** Their Facebook page, group or event, tidied to https://www.facebook.com/<path>, or nothing. */
export function facebookLink(raw: unknown): SocialResult {
  const typed = String(raw ?? "").trim();
  if (typed === "") return { ok: true, link: null };
  const refuse: SocialResult = { ok: false, message: FACEBOOK_PROBLEM };
  if (typed.length > SOCIAL_MAX) return refuse;
  if (!looksLikeAddress(typed)) {
    const name = typed.replace(/^@/, "");
    return FACEBOOK_NAME.test(name) ? { ok: true, link: `https://www.facebook.com/${name}` } : refuse;
  }
  const a = addressParts(typed);
  if (!a || !/^((www|m|web|mobile|business)\.)?(facebook\.com|fb\.com)$/.test(a.host)) return refuse;
  if (a.parts.length === 0 || a.parts.length > 5) return refuse;
  if (!a.parts.every((p) => FACEBOOK_PART.test(p))) return refuse;
  if (FACEBOOK_NOT_A_PAGE.has(a.parts[0].toLowerCase())) return refuse;
  if (a.parts[0].toLowerCase() === "profile.php") {
    // A profile with no name of its own: the id is the only part of the query that matters.
    const id = /[?&]id=(\d{1,25})(?:&|$)/.exec(a.query);
    return id && a.parts.length === 1 ? { ok: true, link: `https://www.facebook.com/profile.php?id=${id[1]}` } : refuse;
  }
  if (a.parts.length === 1 && FACEBOOK_BY_QUERY.has(a.parts[0].toLowerCase())) {
    const query = keptQuery(a.query);
    return query ? { ok: true, link: `https://www.facebook.com/${a.parts[0]}?${query}` } : refuse;
  }
  return { ok: true, link: `https://www.facebook.com/${a.parts.join("/")}` };
}
