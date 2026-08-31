import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-320: "may this request see the ball before launch?" now has one implementation,
// because two places ask it — /ball itself and the home page's promo preview. A second copy
// would drift, and the copy that drifts leniently announces an event The Designer Rooms has
// not announced yet.
//
// The DB and config are mocked so this stays a DB-free unit test (golden rule 5).

const getPreviewPasswordHash = vi.fn();
vi.mock("../../src/db/ball", () => ({ getPreviewPasswordHash: () => getPreviewPasswordHash() }));
vi.mock("../../src/config", () => ({ config: { BALL_PREVIEW_PASSWORD: "config-fallback-secret" } }));

const { holdsPreviewCookie, previewSecret } = await import("../../src/ball/preview-access");
const { signGateToken, GATE_COOKIE } = await import("../../src/ball/gate");

const NOW = new Date("2026-09-01T12:00:00Z");

describe("previewSecret", () => {
  beforeEach(() => getPreviewPasswordHash.mockReset());

  it("signs with the stored password hash once staff have set one", async () => {
    getPreviewPasswordHash.mockResolvedValue("stored-hash");
    expect((await previewSecret()).signingKey).toBe("stored-hash");
  });

  // Signing with the hash is what makes changing the password invalidate every cookie issued
  // under the old one — which is the point of changing a shared password.
  it("falls back to the configured password until one is set", async () => {
    getPreviewPasswordHash.mockResolvedValue(null);
    expect((await previewSecret()).signingKey).toBe("config-fallback-secret");
  });
});

describe("holdsPreviewCookie", () => {
  beforeEach(() => {
    getPreviewPasswordHash.mockReset();
    getPreviewPasswordHash.mockResolvedValue("stored-hash");
  });

  it("accepts a cookie we signed", async () => {
    const token = signGateToken("stored-hash", NOW);
    expect(await holdsPreviewCookie(`${GATE_COOKIE}=${token}`)).toBe(true);
  });

  it("refuses a request with no cookie at all", async () => {
    expect(await holdsPreviewCookie(undefined)).toBe(false);
    expect(await holdsPreviewCookie("")).toBe(false);
  });

  // The whole attack: a cookie of the right NAME carrying anything at all.
  it("refuses a cookie by the right name that we never signed", async () => {
    expect(await holdsPreviewCookie(`${GATE_COOKIE}=not-a-token-we-issued`)).toBe(false);
  });

  it("refuses a cookie signed with a different secret, so changing the password locks people out", async () => {
    const token = signGateToken("the-old-hash", NOW);
    expect(await holdsPreviewCookie(`${GATE_COOKIE}=${token}`)).toBe(false);
  });

  it("ignores other cookies on the same request", async () => {
    const token = signGateToken("stored-hash", NOW);
    expect(await holdsPreviewCookie(`other=1; ${GATE_COOKIE}=${token}; another=2`)).toBe(true);
    expect(await holdsPreviewCookie("other=1; another=2")).toBe(false);
  });

  // Fails CLOSED. The two wrong answers do not cost the same: wrongly saying yes announces an
  // unannounced event, wrongly saying no means someone types the password again.
  it("says no when the password hash cannot be read at all", async () => {
    getPreviewPasswordHash.mockRejectedValue(new Error("database is down"));
    const token = signGateToken("stored-hash", NOW);
    expect(await holdsPreviewCookie(`${GATE_COOKIE}=${token}`)).toBe(false);
  });
});
