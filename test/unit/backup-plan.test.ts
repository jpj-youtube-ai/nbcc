import { describe, it, expect } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKUP_DATABASES, tablesIn, expectedTableCount } from "../../src/backup/plan";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// TASK-423. This file exists because of a near miss.
//
// NBCC does not have one database, it has THREE. The main charity database, plus two deliberately
// isolated ones so the public "My Story" form and the contact form can never read or write donor
// data (STORIES_DATABASE_URL / CONTACT_DATABASE_URL in src/config/schema.ts). The obvious way to
// write a backup — pg_dump $DATABASE_URL — captures 42 of the 44 tables and silently drops every
// story submission and every contact enquiry. It would have produced a file of plausible size,
// passed any test that only counted its own output, and been discovered during a restore.
//
// So the truth here is not a hand-written list. It is the migration directories on disk. Add a
// fourth database and this fails until the backup knows about it.

describe("the backup plan covers every database that exists", () => {
  it("names all three databases", () => {
    expect(BACKUP_DATABASES.map((d) => d.configKey).sort()).toEqual([
      "CONTACT_DATABASE_URL",
      "DATABASE_URL",
      "STORIES_DATABASE_URL",
    ]);
  });

  it("has no migration directory it does not back up", () => {
    const onDisk = readdirSync(ROOT)
      .filter((n) => n === "migrations" || n.startsWith("migrations-"))
      .filter((n) => existsSync(resolve(ROOT, n)))
      .sort();
    expect(BACKUP_DATABASES.map((d) => d.migrationsDir).sort()).toEqual(onDisk);
  });

  it("gives every database a distinct folder name inside the archive", () => {
    const labels = BACKUP_DATABASES.map((d) => d.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("knowing how many tables to expect", () => {
  // A dump that yielded three tables when 44 exist must abort before it overwrites a good backup.
  // 47 since TASK-453 added events, event_images and events_settings; 48 since TASK-464 added
  // ball_report_sends; 49 since TASK-475 added erased_stories to the stories database; 50 since
  // TASK-478 added admin_seen; 54 since TASK-479 added the four site analytics tables; 55 since
  // TASK-491 added business_supporter_calls; 60 since TASK-493 added the five community fundraising
  // tables; 62 since TASK-501 added the private area's sign in codes and sessions; 64 since TASK-503
  // added the fundraising invites and the calls made to fundraisers; 65 since TASK-505 added the
  // fundraising requests (posters, leaflets, buckets and tins, shout outs, someone to come along);
  // 66 since TASK-506 added the news updates organisers post to their pages; 68 since TASK-507
  // added the thank yous organisers send to their supporters, and their gifts; 69 with its address
  // level opt out list; 70 since TASK-511 added the old page links of fundraisers whose link staff
  // changed; 71 with the fundraising categories (the list the sign up form offers); 73 since TASK-515
  // added which automatic emails each fundraiser has had, and the Do it again links; 75 since team
  // pages added the people a team organiser invites, and the team organiser handovers; 76 with the
  // approved automatic email wordings (Jaimie, 2026-10-03); 77 with the impact examples (what gifts
  // could do, shown on fundraiser, event and team pages); 78 since profile pictures added the page
  // photos and round profile photos organisers send; 84 since event tickets added the six ticket
  // tables (types, settings, orders, lines, refunds, requests); 86 with sponsor pledges ("Sponsor now,
  // pay after") and when their Gift Aid declarations were made.
  // tables (types, settings, orders, lines, refunds, requests); 86 since welcome packs added each
  // page's pack and the things in it that staff have ticked.
  it("counts 86 across the three databases", () => {
    expect(expectedTableCount(ROOT)).toBe(86);
  });

  it("finds the three tables that live outside the main database", () => {
    // TASK-475: erased_stories remembers, by fingerprint only, the stories that were erased.
    expect(tablesIn(ROOT, "migrations-stories")).toEqual(["erased_stories", "stories"]);
    expect(tablesIn(ROOT, "migrations-contact")).toEqual(["contact_enquiries"]);
  });

  it("reads the main database's tables from its migrations, including the ones easy to forget", () => {
    const main = tablesIn(ROOT, "migrations");
    // Gift Aid (six-year HMRC retention) and the suppression list (losing it means emailing
    // people who opted out) are the two whose absence would be most expensive.
    expect(main).toContain("declarations");
    expect(main).toContain("email_suppressions");
    expect(main).toContain("erasure_log");
    // TASK-453: the events the public page is built from, their pictures, and the page switch.
    expect(main).toContain("events");
    expect(main).toContain("event_images");
    expect(main).toContain("events_settings");
    // TASK-464: which Festive Ball ticket reports went out, when, and to whom.
    expect(main).toContain("ball_report_sends");
    // TASK-478: when each person last opened each admin section, behind the New pills.
    expect(main).toContain("admin_seen");
    // TASK-479: site analytics. Numbers only, but a restore without them would lose the history.
    expect(main).toContain("analytics_settings");
    expect(main).toContain("analytics_salts");
    expect(main).toContain("analytics_views");
    expect(main).toContain("analytics_clicks");
    // TASK-491: every thank you call made to a business that gives monthly.
    expect(main).toContain("business_supporter_calls");
    // TASK-493: community fundraising: the switch, the sign-ups, their waiting changes, the
    // emailed manage links and the cash paid in.
    for (const t of ["fundraising_settings", "fundraisers", "fundraiser_edits", "fundraiser_manage_tokens", "fundraiser_cash"]) {
      expect(main).toContain(t);
    }
    // TASK-501: the private area's emailed sign in codes and signed in sessions (hashes only).
    expect(main).toContain("fundraiser_sign_in_codes");
    expect(main).toContain("fundraiser_sessions");
    // TASK-503: the invites staff send (token hashes only) and the calls made to fundraisers.
    expect(main).toContain("fundraiser_invites");
    expect(main).toContain("fundraiser_calls");
    // TASK-505: what organisers asked us for, tracked to done (buckets and tins out and back).
    expect(main).toContain("fundraiser_requests");
    // TASK-506: the news updates organisers post, with their photos, which wait for staff.
    expect(main).toContain("fundraiser_updates");
    // TASK-507: the thank yous organisers send their supporters, and what happened to each email.
    expect(main).toContain("fundraiser_thanks");
    expect(main).toContain("fundraiser_thank_gifts");
    // TASK-507: who asked us to stop (Stop all emails, or thank yous off), by address.
    expect(main).toContain("email_opt_outs");
    // TASK-511: every old page link, so a QR code printed with one still reaches its page.
    expect(main).toContain("fundraiser_slug_history");
    // The fundraising categories: the list the sign up form offers, and every old one, for good.
    expect(main).toContain("fundraising_categories");
    // TASK-515: which automatic email each fundraiser has had, so none ever goes twice.
    expect(main).toContain("fundraiser_touchpoints");
    // TASK-515: the Do it again links from the year on email (token hashes only).
    expect(main).toContain("fundraiser_again_tokens");
    // Team pages: the people a team organiser added (held, invited, then deleted), and handovers.
    expect(main).toContain("team_invites");
    expect(main).toContain("team_handovers");
    // Which new automatic email wordings an admin has approved (Jaimie, 2026-10-03).
    expect(main).toContain("touch_wording_approvals");
    // What gifts could do: the shared list of "could" examples staff edit in Admin > Fundraising.
    expect(main).toContain("impact_examples");
    // Profile pictures: the page photos and round profile photos organisers send, waiting for staff.
    expect(main).toContain("fundraiser_pictures");
    // Event tickets: buyers' names, emails and phones are on the orders, kept like donation records.
    for (const t of [
      "event_ticket_settings",
      "event_ticket_types",
      "event_ticket_orders",
      "event_ticket_order_lines",
      "event_ticket_refunds",
      "event_ticket_refund_requests",
    ]) {
      expect(main).toContain(t);
    }
    // Sponsor pledges: the promises made on a fundraiser's page, with their Gift Aid declarations.
    expect(main).toContain("sponsor_pledges");
    expect(main).toContain("sponsor_pledge_declarations");
    // Welcome packs: when each was sent and who signs its letter, and what staff have ticked in it.
    expect(main).toContain("welcome_packs");
    expect(main).toContain("welcome_pack_items");
    expect(main.length).toBe(83);
  });

  it("returns nothing for a directory that does not exist, rather than throwing", () => {
    expect(tablesIn(ROOT, "migrations-nope")).toEqual([]);
  });
});
