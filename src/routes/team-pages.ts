import type { Request, Response, NextFunction, Router } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FundraiserRecord, Meter } from "../fundraising/model";
import type { TeamExtras } from "../fundraising/team-render";

// Team pages (Jaimie, 2026-10-03): the public pages a team adds.
//
//   GET /fundraise/:slug/join    the join form (fundraise-join.html) for an approved team while
//                                fundraising is on: a finished team shows its closed panel, and
//                                anything that is not a team is the site's 404. Never indexed,
//                                never kept (an invite's token may ride in its address).
//
// And, for /fundraise/:slug (src/routes/fundraise-pages.ts), teamPageExtras: a team page's combined
// meter and its members, and a member page's "Part of the team". The database modules are imported
// lazily, like the rest of the site router, and a failure only leaves the extras out.

export interface TeamPageDeps {
  decorate: (html: string, cookieHeader: string | undefined) => Promise<string>;
}

async function fundraisingOn(): Promise<boolean> {
  try {
    return await (await import("../db/fundraisers")).fundraisingIsOn();
  } catch {
    return false;
  }
}

const base = async () => (await import("../config")).config.PORTAL_BASE_URL.replace(/\/+$/, "");

/**
 * What a team adds to a fundraiser's page: for a team, the combined meter (its own gifts and every
 * current member page's) and its members, A to Z; for a member page still on its team, the team it is
 * part of. Nothing for any other page, or if it cannot be read.
 */
export async function teamPageExtras(
  f: FundraiserRecord & { meter: Meter },
  shortName: (name: string) => string,
): Promise<{ meter?: Meter; team?: Partial<TeamExtras> }> {
  try {
    if (f.isTeam) {
      const [{ listTeamMembers }, { teamMeter, teamMemberList, joinUrl }, { renderTeamExtras }] = await Promise.all([
        import("../db/fundraising-teams"),
        import("../fundraising/teams"),
        import("../fundraising/team-render"),
      ]);
      const rows = (await listTeamMembers(f.id)).filter((m) => !m.teamLeftAt && (m.status === "approved" || m.status === "finished"));
      return {
        meter: teamMeter(f.meter, rows.map((m) => m.meter), f.targetPence),
        team: renderTeamExtras({
          slug: f.slug,
          title: f.title,
          organisedBy: shortName(f.name),
          finished: f.status !== "approved",
          members: teamMemberList(rows),
          joinUrl: joinUrl(await base(), f.slug),
        }),
      };
    }
    if (f.teamId && !f.teamLeftAt) {
      const [{ getFundraiser }, { hasPage }, { renderMemberOfLine }] = await Promise.all([
        import("../db/fundraisers"),
        import("../fundraising/model"),
        import("../fundraising/team-render"),
      ]);
      const t = await getFundraiser(f.teamId);
      if (t && hasPage(t)) return { team: { factsHtml: renderMemberOfLine({ title: t.title, url: `/fundraise/${t.slug}` }) } };
    }
  } catch (err) {
    console.error("team page extras failed:", err instanceof Error ? err.message : err);
  }
  return {};
}

/**
 * Get involved, with teams in mind: a team is listed once, with its combined meter (its own gifts and
 * every current member page's), and its current member pages are not listed on their own (they are
 * on the team page). A page taken off its team is listed as any other. Only a list with a team in it
 * asks the database for more.
 */
export async function teamsOnGetInvolved<T extends FundraiserRecord & { meter: Meter }>(list: T[]): Promise<T[]> {
  const shown = list.filter((f) => !(f.teamId && !f.teamLeftAt));
  const teamIds = shown.filter((f) => f.isTeam).map((f) => f.id);
  if (teamIds.length === 0) return shown;
  const [{ memberMetersFor }, { teamMeter }] = await Promise.all([import("../db/fundraising-teams"), import("../fundraising/teams")]);
  const metersBy = await memberMetersFor(teamIds);
  return shown.map((f) => (f.isTeam ? { ...f, meter: teamMeter(f.meter, metersBy.get(f.id) ?? [], f.targetPence) } : f));
}

export function addTeamPageRoutes(router: Router, siteRoot: string, deps: TeamPageDeps): void {
  const joinFile = join(siteRoot, "fundraise-join.html");

  router.get("/fundraise/:slug/join", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!(await fundraisingOn())) return next();
      const [{ getBySlug }, { shortName, kindLabelOf }, { membersAskedToShare }, { renderJoinPage, teamShareNote }] = await Promise.all([
        import("../db/fundraisers"),
        import("../fundraising/model"),
        import("../fundraising/teams"),
        import("../fundraising/team-render"),
      ]);
      const t = await getBySlug(String(req.params.slug));
      if (!t || !t.isTeam || (t.status !== "approved" && t.status !== "finished")) return next();
      const html = renderJoinPage(readFileSync(joinFile, "utf8"), {
        open: t.status === "approved",
        team: { slug: t.slug, title: t.title, organisedBy: shortName(t.name), kindLabel: kindLabelOf(t), eventDate: t.eventDate },
        shareNote: t.teamShareMode === "team" ? teamShareNote(t) : null,
        askShare: membersAskedToShare(t),
      });
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.setHeader("Referrer-Policy", "strict-origin");
      res.type("html").send(await deps.decorate(html, req.headers.cookie));
    } catch (err) {
      console.error("team join page failed:", err instanceof Error ? err.message : err);
      next();
    }
  });
}
