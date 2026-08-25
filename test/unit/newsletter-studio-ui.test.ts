// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-283: the Newsletter Studio restructure moves almost every element in the tab — audiences and
// people become their own destination, composing becomes a full-screen takeover, and the send
// history becomes a results view.
//
// app.js binds by element **id** and fails SILENTLY at runtime when one goes missing: no build
// error, no test failure, just a control that quietly stops working. That is the single largest
// risk in a restructure this size, and it is exactly how TASK-279 could have gone wrong.
//
// So the contract is pinned here as data. Every id that existed in the newsletter section before
// the restructure must still exist after it. Elements may be moved, re-parented, re-styled, wrapped
// or hidden — they may not be renamed or deleted. Adding new ids is always fine.
//
// If a future task genuinely retires a control, delete its id from this list IN THAT TASK, with the
// reason in the commit message. Never weaken the assertion to make a red test go away.

const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");

/** The newsletter section only — from its own id to the start of the thank-you section. */
function newsletterSection(source: string): string {
  // Back up to the opening <section so the section's own id falls inside the slice.
  const start = source.lastIndexOf("<section", source.indexOf('id="view-newsletter"'));
  const end = source.indexOf('id="view-thank-you"');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("could not locate the newsletter section in admin.html");
  }
  return source.slice(start, end);
}

const idsInSection = new Set(
  [...newsletterSection(html).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]),
);

// Captured from admin.html at TASK-283, before any markup moved.
const REQUIRED_IDS = [
  "amAddBtn", "amEmail", "amList", "amName", "amPhone", "audienceArchive", "audienceArchived",
  "audienceArchivedList", "audienceCancel", "audienceCreate", "audienceKindNote",
  "audienceMemberForm", "audienceMembers", "audienceMsg", "audienceName", "audienceNew",
  "audiencePick", "importAttest", "importCommitBtn", "importFile", "importIssues",
  "importListPick", "importMsg", "importPreview", "importPreviewBtn", "importSummary",
  "newsletter-heading", "newsletterForm", "newsletterId", "newsletterList", "newsletterMsg",
  "newsletterNew", "newsletterSave", "newsletterSend", "newsletterSubject", "newsletterTemplate",
  "newsletterTemplateDelete", "newsletterTemplateName", "newsletterTemplatePick",
  "newsletterTemplateSave", "newsletterTemplateSaveCancel", "newsletterTemplateSaveConfirm",
  "newsletterTemplateUse", "newsletterTest", "nlAddPerson", "nlAttachFile", "nlAttachHint",
  "nlAttachList", "nlAttachMsg", "nlAttachTools", "nlAttachments", "nlCanvas", "nlPalette",
  "nlPanelAudience", "nlPanelHistory", "nlPanelSend", "nlPanelWrite", "nlPreview",
  "nlPreviewWrap", "nlReconsent", "nlStageAudience", "nlStats", "nlStatsGrid", "nlStatsNote",
  "nlSteps", "nlSubscriberCard", "nlSuppressions", "nlTemplateMsg", "nlTemplates", "reAddBtn",
  "reEmail", "reMsg", "reName", "reconsentForm", "sendAudienceNote", "sendCancel",
  "sendListPick", "sendListWrap", "sendPause", "sendProgress", "sendProgressFill",
  "sendProgressText", "sendResume", "sendRollout", "sendRolloutWrap", "sendScheduleAt",
  "sendScheduleClear", "sendScheduleHint", "sendScheduleWrap", "subExport", "subList",
  "subManage", "subMsg", "subSearch", "suppressionList", "suppressionMsg", "view-newsletter",
] as const;

// TASK-285: the OTHER half of the contract. TASK-283 shipped five elements — the in-flight strip,
// the compose subject echo, the saved indicator — as markup with nothing driving them: they rendered
// as empty boxes forever and no test noticed, because "the id exists" was all anyone checked.
//
// So every container the tab is supposed to FILL is listed here and must be referenced by app.js.
// An element that exists but is never written to is not a feature, it is a gap that looks like one.
const DRIVEN_IDS = [
  // TASK-283 overview
  "nlOverviewTiles", "nlRecentSends", "nlAttention", "nlAudienceSnapshot",
  "nlInflight", "nlInflightTxt", "nlInflightOpen",
  // TASK-283 compose chrome
  "nlComposeSubject", "nlComposeSaved", "nlComposeNext", "nlComposeBack", "nlComposeHint",
  // TASK-284 send step
  "nlSendSummaryList", "nlReach",
  // TASK-285 parity screens
  "nlAudienceCards", "nlChecks", "nlWhenNow", "nlWhenLater",
  "nlResultsTitle", "nlResultsMeta", "nlResultsTiles", "nlResultsLinks",
  "nlResultsRecord", "nlResultsNote", "nlResultsBack", "nlResultsWho",
  // TASK-282/283 tick lists
  "amAudiences", "importAudiences",
] as const;

describe("every container the tab renders into is actually driven", () => {
  const app = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");

  it.each(DRIVEN_IDS)("app.js references #%s", (id) => {
    expect(idsInSection.has(id), `#${id} is not in the newsletter markup`).toBe(true);
    expect(app.includes('"' + id + '"'), `#${id} exists in admin.html but nothing in app.js touches it`).toBe(true);
  });
});

describe("the newsletter tab keeps its element contract", () => {
  it("still has every id the tab had before the restructure", () => {
    const missing = REQUIRED_IDS.filter((id) => !idsInSection.has(id));
    expect(missing, `these ids vanished from the newsletter section: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  // A duplicate id makes getElementById return whichever came first, so a control silently starts
  // driving the wrong element. Easy to introduce when a panel is copied to make a new destination.
  it("uses each id exactly once", () => {
    const all = [...newsletterSection(html).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const seen = new Set<string>();
    const dupes = all.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
    expect([...new Set(dupes)]).toEqual([]);
  });
});
