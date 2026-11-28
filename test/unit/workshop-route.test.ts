import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

// POST /api/workshop: the tablet page at /workshop sends each drop-off here
// (docs/superpowers/specs/2026-11-28-workshop-dropoffs-design.md). The database, the newsletter and
// the email are mocked. Every name and address here is invented.

const { insertDropOff, subscribeSelf, sendWorkshopThanks } = vi.hoisted(() => ({
  insertDropOff: vi.fn(),
  subscribeSelf: vi.fn(),
  sendWorkshopThanks: vi.fn(),
}));
vi.mock("../../src/db/workshop-dropoffs", () => ({ insertDropOff }));
vi.mock("../../src/newsletter/self-signup", () => ({ subscribeSelf }));
vi.mock("../../src/clients/email", () => ({ sendWorkshopThanks }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { workshopRouter, resetWorkshopRateLimit } from "../../src/routes/workshop";

const app = express();
app.use(express.json());
app.use(workshopRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
afterAll(() => server.close());

const post = (body: unknown) =>
  fetch(`${base}/api/workshop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const GOOD = { name: "Robin Example", email: "robin@example.com", brought: "Two bags of selection boxes" };
const tick = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  resetWorkshopRateLimit();
  insertDropOff.mockReset().mockResolvedValue(1);
  subscribeSelf.mockReset().mockResolvedValue("added");
  sendWorkshopThanks.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/workshop", () => {
  it("saves the drop-off, thanks them by email and answers 201 with their first name", async () => {
    const res = await post({ ...GOOD, groupName: " Church group ", phone: "07700 900123" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, firstName: "Robin" });
    expect(insertDropOff).toHaveBeenCalledWith({ ...GOOD, groupName: "Church group", phone: "07700 900123", newsletter: false });
    await tick();
    expect(sendWorkshopThanks).toHaveBeenCalledTimes(1);
    const sent = sendWorkshopThanks.mock.calls[0][0];
    expect(sent.email).toBe("robin@example.com");
    expect(sent.subject).toBe("Thank you for dropping in");
    expect(sent.html).toContain("Two bags of selection boxes");
    expect(sent.html).not.toContain("mailing list");
  });

  it("keeps the optional boxes empty as nothing, not blank words", async () => {
    await post({ ...GOOD, groupName: "  ", phone: "" });
    expect(insertDropOff).toHaveBeenCalledWith({ ...GOOD, groupName: null, phone: null, newsletter: false });
  });

  it("joins the newsletter only when the box was ticked, as a workshop sign up", async () => {
    await post({ ...GOOD, newsletter: true });
    expect(subscribeSelf).toHaveBeenCalledWith({ name: "Robin Example", email: "robin@example.com", phone: null }, "workshop");
    await tick();
    expect(sendWorkshopThanks.mock.calls[0][0].html).toContain("mailing list");

    subscribeSelf.mockClear();
    await post({ ...GOOD, newsletter: false });
    await post({ ...GOOD, newsletter: "yes" });
    expect(subscribeSelf).not.toHaveBeenCalled();
  });

  it("answers a filled honeypot cheerfully and saves nothing", async () => {
    const res = await post({ ...GOOD, website: "spam.example" });
    expect(res.status).toBe(200);
    expect(insertDropOff).not.toHaveBeenCalled();
    expect(sendWorkshopThanks).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...GOOD, name: " " }, "name", "Please tell us your name."],
    [{ ...GOOD, email: "robin" }, "email", "Please check your email address."],
    [{ ...GOOD, brought: "" }, "brought", "Please tell us what you brought in."],
  ])("says plainly what is missing (%#)", async (body, field, error) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error, field });
    expect(insertDropOff).not.toHaveBeenCalled();
  });

  it("sends one address at most three thank you emails an hour, and still saves every drop-off", async () => {
    for (let i = 0; i < 5; i++) expect((await post({ ...GOOD, email: i % 2 ? "ROBIN@example.com" : "robin@example.com" })).status).toBe(201);
    await tick();
    expect(insertDropOff).toHaveBeenCalledTimes(5);
    expect(sendWorkshopThanks).toHaveBeenCalledTimes(3);
  });

  it("lets one busy tablet send 60 in an hour, and stops the 61st", async () => {
    for (let i = 0; i < 60; i++) expect((await post({ ...GOOD, email: `p${i}@example.com` })).status).toBe(201);
    expect((await post(GOOD)).status).toBe(429);
  });

  it("still thanks the person on screen when the email fails", async () => {
    sendWorkshopThanks.mockRejectedValue(new Error("SES down"));
    const res = await post(GOOD);
    expect(res.status).toBe(201);
    await tick();
  });

  it("still thanks the person on screen when the newsletter cannot be joined", async () => {
    subscribeSelf.mockRejectedValue(new Error("db down"));
    const res = await post({ ...GOOD, newsletter: true });
    expect(res.status).toBe(201);
  });
});
