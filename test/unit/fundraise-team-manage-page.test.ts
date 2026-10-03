// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// Team pages (Jaimie, 2026-10-03): the team organiser's private area (assets/js/fundraise-team-manage.js).
// A team's card gets a "Your team" part: the join link and a message to forward, ready to copy, and
// who has joined (live and waiting), each of whom the team organiser can take off the team. And
// anyone staff have asked to take over a team confirms it with the code we emailed them. Every name
// here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const { initTeamManage } = require(resolve(ROOT, "assets/js/fundraise-team-manage.js"));
const template = readFileSync(resolve(ROOT, "fundraise-manage.html"), "utf8");

type Reply = { status: number; body: unknown };
let calls: Array<{ url: string; method: string; body: unknown }>;
let replies: Record<string, Reply>;
let confirmAnswer = true;

const teamData = {
  joinUrl: "https://nbcc.test/fundraise/ej/join",
  forwardMessage: "I've set up a team, Exampleton Juniors ... Join here: https://nbcc.test/fundraise/ej/join",
  shareMode: null,
  members: [
    { id: 41, name: "Ava Sample", status: "waiting", raisedPence: 0, targetPence: null, pageUrl: null },
    { id: 42, name: "Zara Example", status: "live", raisedPence: 2000, targetPence: 5000, pageUrl: "https://nbcc.test/fundraise/ze" },
  ],
};

function load() {
  document.documentElement.innerHTML = new DOMParser().parseFromString(template, "text/html").documentElement.innerHTML;
  calls = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    const r = replies[`${init?.method ?? "GET"} ${url}`] ?? { status: 404, body: {} };
    return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, json: () => Promise.resolve(r.body) });
  });
  w.confirm = vi.fn(() => confirmAnswer);
  w.NBCCFormValidation = { validateForm: shared.validateForm, clearValidation: shared.clearValidation };
  return initTeamManage(document, window);
}

function addCard(id: number) {
  const card = document.createElement("article");
  card.setAttribute("data-fundraiser", String(id));
  card.innerHTML = '<section data-f-done-part><h3>All done?</h3></section>';
  document.querySelector("[data-manage-list]")!.appendChild(card);
  return card;
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;

beforeEach(() => {
  confirmAnswer = true;
  replies = {
    "GET /api/fundraise/manage/fundraisers/40/team": { status: 200, body: teamData },
    "POST /api/fundraise/manage/fundraisers/40/team/members/41/remove": { status: 200, body: { status: "removed" } },
  };
});

describe("Your team, on a team's card", () => {
  it("shows the join link, the message to forward and who has joined, before All done?", async () => {
    load();
    const card = addCard(40);
    await flush();
    const part = $("[data-team-part]", card);
    expect(part).toBeTruthy();
    expect(part.nextElementSibling?.hasAttribute("data-f-done-part")).toBe(true);
    expect($("[data-team-link]", part).textContent).toBe("https://nbcc.test/fundraise/ej/join");
    expect($("[data-team-forward]", part).textContent).toBe(teamData.forwardMessage);
    const items = [...part.querySelectorAll("[data-team-list] li")].map((li) => li.textContent!.replace(/\s+/g, " ").trim());
    expect(items[0]).toContain("Ava Sample");
    expect(items[0]).toContain("Waiting for us to check their page");
    expect(items[1]).toContain("Zara Example");
    expect(items[1]).toContain("£20 raised");
    expect(part.textContent).toContain("team organiser");
    expect(part.textContent).not.toMatch(/captain/i);
  });

  it("adds nothing to a card that is not a team", async () => {
    load();
    const card = addCard(9);
    await flush();
    expect(card.querySelector("[data-team-part]")).toBeNull();
  });

  it("takes someone off the team once the team organiser says so, then shows the list again", async () => {
    load();
    const card = addCard(40);
    await flush();
    replies["GET /api/fundraise/manage/fundraisers/40/team"] = { status: 200, body: { ...teamData, members: [teamData.members[1]] } };
    $<HTMLButtonElement>('[data-team-remove="41"]', card).click();
    await flush();
    expect(window.confirm).toHaveBeenCalled();
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/team/members/41/remove"))).toBe(true);
    expect(card.querySelectorAll("[data-team-list] li")).toHaveLength(1);
    expect($("[data-team-status]", card).textContent).toContain("Ava Sample is off the team");
  });

  it("changes nothing when they think again", async () => {
    confirmAnswer = false;
    load();
    const card = addCard(40);
    await flush();
    $<HTMLButtonElement>('[data-team-remove="41"]', card).click();
    await flush();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("says so kindly when nobody has joined", async () => {
    replies["GET /api/fundraise/manage/fundraisers/40/team"] = { status: 200, body: { ...teamData, members: [] } };
    load();
    const card = addCard(40);
    await flush();
    expect($("[data-team-empty]", card).hidden).toBe(false);
  });
});

describe("taking over a team", () => {
  it("is a form with the email and the code from our email", async () => {
    replies["POST /api/fundraise/manage/handover"] = { status: 200, body: { status: "ok", title: "Exampleton Juniors" } };
    load();
    $<HTMLButtonElement>("[data-handover-open]").click();
    expect($("[data-manage-handover]").hidden).toBe(false);
    ($("#handoverEmail") as HTMLInputElement).value = "sam@example.com";
    ($("#handoverCode") as HTMLInputElement).value = "123 456";
    $("#handoverForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(calls.find((c) => c.url === "/api/fundraise/manage/handover")?.body).toEqual({ email: "sam@example.com", code: "123 456" });
    expect($("[data-handover-status]").textContent).toBe(
      "You are now the team organiser of Exampleton Juniors. Sign in above with the same email to look after your team.",
    );
  });

  it("says when the code does not work", async () => {
    replies["POST /api/fundraise/manage/handover"] = { status: 401, body: { error: "That code does not work. Check it and your email address, or ask us to send a new one." } };
    load();
    $<HTMLButtonElement>("[data-handover-open]").click();
    ($("#handoverEmail") as HTMLInputElement).value = "sam@example.com";
    ($("#handoverCode") as HTMLInputElement).value = "000000";
    $("#handoverForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect($("[data-handover-status]").textContent).toContain("That code does not work");
  });
});
