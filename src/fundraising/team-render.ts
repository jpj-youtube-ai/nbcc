import { dateParts, escapeHtml } from "../events/render";
import { renderMeter } from "./render";
import type { TeamMemberCard } from "./teams";
import { avatarHtml } from "./pictures";

// Team pages (Jaimie, 2026-10-03): the parts of the public pages that are a team's, drawn on the
// server like the rest of a fundraiser's page (src/fundraising/render.ts), in its classes and look.
// Pure: no database, no clock. Everything a person typed is escaped.
//
//   - a team page: "Join this team" under the give button, and a "The team" section after the
//     story: the team organiser, every member A to Z (the caller sorts them; teamMemberList) with
//     a small meter and a link to their page, never a ranking, and the join link to copy;
//   - a member page: "Part of the team ..." under its facts;
//   - the join form's page (/fundraise/<team>/join, fundraise-join.html).

export interface TeamExtrasInput {
  slug: string;
  title: string;
  /** The team organiser, as the page names organisers ("Robin O."). */
  organisedBy: string;
  /** Profile pictures: the team organiser's approved round photo, or null for the NBCC elf. */
  organiserPhotoSrc?: string | null;
  finished: boolean;
  members: TeamMemberCard[];
  joinUrl: string;
}

/** What a team adds to its page: a button in the summary, and a section in the main column. */
export interface TeamExtras {
  summaryHtml: string;
  mainHtml: string;
  factsHtml?: string;
  /** How many are on the team: the give box only points to "The team" when there is someone there. */
  memberCount?: number;
}

const LINK_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';

function memberItem(m: TeamMemberCard): string {
  return (
    '<li class="fr-team__member">' +
    '<div class="fr-team__who">' +
    avatarHtml(m.photoSrc, m.name, { elf: true }) +
    `<a class="fr-team__name" href="${escapeHtml(m.url)}">${escapeHtml(m.name)}<span class="sr-only">: see their page</span></a>` +
    "</div>" +
    renderMeter(m.meter) +
    "</li>"
  );
}

export function renderTeamExtras(t: TeamExtrasInput): TeamExtras {
  const joinPath = `/fundraise/${t.slug}/join`;
  const count = t.members.length;
  const list = count
    ? `<p class="fr-team__count">${count === 1 ? "1 person is" : `${count} people are`} fundraising as part of the team, A to Z.</p>` +
      `<ol class="fr-team__list" role="list">${t.members.map(memberItem).join("")}</ol>`
    : '<p class="fr-wall__empty">Nobody has joined the team yet. Could you be the first?</p>';
  const join = t.finished
    ? ""
    : '<div class="fr-team__join" data-copy-scope>' +
      '<h3 class="fr-team__join-title">Join the team</h3>' +
      "<p>Get your own page, and everything you raise counts towards the team’s total too. We check every page before it goes live.</p>" +
      '<div class="fr-share__links">' +
      `<a class="btn btn-primary" href="${escapeHtml(joinPath)}">Join this team</a>` +
      `<button class="fr-share__btn fr-share__copy" type="button" data-copy-link="${escapeHtml(t.joinUrl)}" hidden>${LINK_ICON}Copy the join link</button>` +
      "</div>" +
      `<p class="fr-share__url"><span class="sr-only">The join link: </span>${escapeHtml(t.joinUrl.replace(/^https?:\/\//, ""))}</p>` +
      '<p class="fr-share__status" role="status" aria-live="polite" data-copy-status></p>' +
      "</div>";
  return {
    memberCount: count,
    summaryHtml: t.finished ? "" : `<a class="btn btn-ghost fr-summary__join" href="${escapeHtml(joinPath)}">Join this team</a>`,
    mainHtml:
      '<section class="fr-team" aria-labelledby="fr-team-heading">' +
      '<h2 id="fr-team-heading">The team</h2>' +
      `<p class="fr-team__organiser">${avatarHtml(t.organiserPhotoSrc, t.organisedBy, { elf: true })}<span>Team organiser: ${escapeHtml(t.organisedBy)}</span></p>` +
      list +
      join +
      "</section>",
  };
}

/** Under a member page's facts: the team it is part of, linked. */
export function renderMemberOfLine(team: { title: string; url: string }): string {
  return `<p class="fr-team-of">Part of the team <a href="${escapeHtml(team.url)}">${escapeHtml(team.title)}</a></p>`;
}

// --- the join form's page --------------------------------------------------------------------------

export interface JoinPageInput {
  /** An approved team, taking new members, while fundraising is on. */
  open: boolean;
  team: { slug: string; title: string; organisedBy: string; kindLabel: string; eventDate: string | null };
  /** A whole team split, in words ("This team shares 50% with ..."): shown, never asked. */
  shareNote: string | null;
  /** Just the team organiser's split: each member answers the sharing question. */
  askShare: boolean;
}

/** "This team shares 50% with Exampleton Food Larder." The rest of the statement is on the page. */
export function teamShareNote(t: { nbccSharePercent?: number | null; otherCauseName?: string | null }): string | null {
  if (!t.nbccSharePercent || !t.otherCauseName) return null;
  const other = t.otherCauseName.trim();
  return `This team shares what it raises: ${t.nbccSharePercent}% comes to NBCC and the rest goes to ${other}${/[.!?]$/.test(other) ? "" : "."} Your page will share the same way.`;
}

export function renderJoinPage(template: string, p: JoinPageInput): string {
  const d = p.team.eventDate ? dateParts(p.team.eventDate) : null;
  const what = [p.team.kindLabel, d ? `${d.dayName} ${d.day} ${d.month} ${d.year}` : ""].filter(Boolean).join(", ");
  const facts =
    `<p class="fr-team__organiser">Team organiser: ${escapeHtml(p.team.organisedBy)}</p>` +
    (what ? `<p class="fr-team-of">${escapeHtml(what)}</p>` : "") +
    `<p class="fr-aside-link">See the team page first? <a href="/fundraise/${escapeHtml(p.team.slug)}">${escapeHtml(p.team.title)}</a></p>`;
  const fill: Record<string, string> = {
    __TEAM_TITLE__: escapeHtml(p.team.title),
    __TEAM_SLUG__: escapeHtml(p.team.slug),
  };
  let html = template
    .replace(/__(TEAM_TITLE|TEAM_SLUG)__/g, (token) => fill[token])
    .replace("<!-- join:facts -->", () => facts)
    .replace("<!-- join:share-note -->", () => (p.shareNote ? `<p class="fr-split">${escapeHtml(p.shareNote)}</p>` : ""));
  if (!p.askShare) html = html.replace("data-join-share>", "data-join-share hidden>");
  if (!p.open) html = html.replace("data-join-open>", "data-join-open hidden>").replace("data-join-closed hidden>", "data-join-closed>");
  return html;
}
