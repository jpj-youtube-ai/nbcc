import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// TASK-490: the web server, and only the web server, refuses to start in production without the
// contact form's spam check keys (src/index.ts). Everything it starts is mocked: no port is opened,
// no newsletter is sent and no place lookups run.

const { mockConfig, listen, startSendWorker, startPlaceLookups } = vi.hoisted(() => ({
  mockConfig: {} as Record<string, unknown>,
  listen: vi.fn(),
  startSendWorker: vi.fn(),
  startPlaceLookups: vi.fn(),
}));
vi.mock("../../src/config", () => ({ config: mockConfig }));
vi.mock("../../src/app", () => ({ createApp: () => ({ listen }) }));
vi.mock("../../src/newsletter/send-worker", () => ({ startSendWorker }));
vi.mock("../../src/analytics/start", () => ({ startPlaceLookups }));

beforeEach(() => {
  for (const key of Object.keys(mockConfig)) delete mockConfig[key];
  Object.assign(mockConfig, { NODE_ENV: "production", PORT: 3000, TURNSTILE_SITE_KEY: "", TURNSTILE_SECRET_KEY: "" });
  listen.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as never);
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("starting the web server in production", () => {
  it("refuses without the Turnstile keys, naming them, before it listens", async () => {
    await expect(import("../../src/index")).rejects.toThrow("exit 1");
    expect(listen).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("Invalid environment configuration:", [
      "TURNSTILE_SITE_KEY is required in production",
      "TURNSTILE_SECRET_KEY is required in production",
    ]);
  });

  it("listens once both keys are set", async () => {
    mockConfig.TURNSTILE_SITE_KEY = "0x4AAAAAAFLWXsnTJas6eb4L";
    mockConfig.TURNSTILE_SECRET_KEY = "REPLACE_ME";
    await import("../../src/index");
    expect(process.exit).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledWith(3000, expect.any(Function));
  });
});
