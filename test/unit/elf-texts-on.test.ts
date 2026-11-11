import { describe, it, expect, vi, afterEach } from "vitest";

// NBCC Elf Detective School: the one rule for whether an alert tries its texts, asked by the worker's photo
// alert (src/elf/worker.ts) and by the test alert (src/routes/admin-elf.ts), so the two never disagree.

const { cfg, sms } = vi.hoisted(() => ({ cfg: { NODE_ENV: "development" }, sms: { on: false } }));
vi.mock("../../src/config", () => ({ config: cfg }));
vi.mock("../../src/clients/sms", () => ({
  get smsConfigured() {
    return sms.on;
  },
}));

import { elfTextsOn } from "../../src/elf/texts-on";

afterEach(() => {
  cfg.NODE_ENV = "development";
  sms.on = false;
});

describe("whether an alert tries its texts", () => {
  it("tries them outside production, where the text client sends nothing, switched on or not", () => {
    expect(elfTextsOn()).toBe(true);
    sms.on = true;
    expect(elfTextsOn()).toBe(true);
  });

  it("tries them in production only once texts are switched on", () => {
    cfg.NODE_ENV = "production";
    expect(elfTextsOn()).toBe(false);
    sms.on = true;
    expect(elfTextsOn()).toBe(true);
  });
});
