import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Sponsor pledges are built as their own module (src/pledges, src/db/pledges.ts, src/routes/pledges.ts)
// with a few small hooks in shared files. These read the source, so a hook lost in a merge is caught
// here rather than on the live site.

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

describe("where sponsor pledges plug in", () => {
  it("the API is mounted before the fundraising router, whose retired link route would take its address", () => {
    const app = read("src/app.ts");
    expect(app).toContain('import { pledgesRouter } from "./routes/pledges";');
    expect(app.indexOf("app.use(pledgesRouter)")).toBeGreaterThan(-1);
    expect(app.indexOf("app.use(pledgesRouter)")).toBeLessThan(app.indexOf("app.use(fundraiseRouter)"));
  });

  it("the pay and cancel pages are on the site router, before its catch all", () => {
    const site = read("src/routes/site.ts");
    expect(site).toContain("addPledgePageRoutes(router, siteRoot, { decorate: decorateNav });");
    const routes = read("src/routes/pledges.ts");
    for (const path of ["/pledge/confirm", "/pledge/pay", "/pledge/cancel"]) {
      expect(routes).toContain(`router.get("${path}"`);
      expect(routes).toContain(`router.post("${path}"`);
    }
  });

  it("their page template ships in the image", () => {
    const line = read("Dockerfile").split(/\r?\n/).find((l) => l.startsWith("COPY ") && /\b_redirects\b/.test(l)) ?? "";
    expect(line).toMatch(/\bpledge\.html\b/);
  });

  it("the daily task sends the pledge emails and tidies up, each in its own try", () => {
    const task = read("src/scripts/send-reminders.ts");
    expect(task).toContain("runPledgeEmails");
    expect(task).toContain("runPledgeRetention");
    // And tells the events inbox about any pledge paid twice that the webhook could not.
    expect(task).toContain("sendDoublePaidAlerts");
  });

  it("the fundraiser's page asks for the pledge extras, and a failure there never takes the page down", () => {
    const pages = read("src/routes/fundraise-pages.ts");
    expect(pages).toContain("pledgePageExtras");
    expect(pages).toMatch(/pledge: await pledgePageExtras\(f/);
    // In memory pages draw with their own renderer, which takes no pledge extras at all.
    expect(read("src/fundraising/memory-render.ts")).not.toContain("pledge");
  });

  it("the fundraiser's page loads the pledge script and styles of its own", () => {
    const page = read("fundraiser.html");
    expect(page).toContain('<script defer src="/assets/js/fundraiser-pledge.js"></script>');
    expect(page).toContain('<link rel="stylesheet" href="/assets/css/pledges.css" />');
  });

  it("the private area and the admin load theirs", () => {
    const manage = read("fundraise-manage.html");
    expect(manage).toContain('<script defer src="/assets/js/fundraise-pledges.js"></script>');
    expect(manage).toContain("data-pledges-pattern");
    const admin = read("admin.html");
    expect(admin).toContain('<script defer src="/assets/js/admin/pledges.js"></script>');
    expect(admin).toContain('id="frPledges"');
  });

  it("the webhook marks a pledge paid in the donation's own transaction", () => {
    const hook = read("src/db/stripe-webhook.ts");
    expect(hook).toContain("pledgeFromSession(event.data.object)");
    expect(hook).toContain("await settlePledgeSafely(client, pledgePayment");
    // A second payment loses its Gift Aid before anything reads the session.
    expect(hook.indexOf("await guardPledgePaymentSafely(client, event.data.object)")).toBeGreaterThan(-1);
    expect(hook.indexOf("await guardPledgePaymentSafely(client, event.data.object)")).toBeLessThan(hook.indexOf("const { donor, donation } = donationFromCheckoutSession(event.data.object);"));
    expect(hook).toContain("sendDoublePaidAlerts()");
  });

  it("the nightly backup takes the pledges", () => {
    const names = [...read("migrations/1791200000220_sponsor-pledges.js").matchAll(/createTable\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(["sponsor_pledges", "sponsor_pledge_declarations"]);
  });
});
