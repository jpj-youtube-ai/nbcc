import { describe, it, expect, vi } from "vitest";
import { impersonateServiceAccount } from "../../src/clients/google-federation";

// TASK-451: the scope the backup asks Google for.
//
// This asked for drive.file, reasoning that a token which can only touch files the service account
// itself created cannot read the rest of the charity's Drive even if stolen. The instinct was right
// and the scope was wrong: drive.file grants access ONLY to files the app created, so it cannot see
// a folder a human shared with it. Every upload failed with "folder not found" no matter how
// correctly the folder was shared - which reads as a permissions problem and is not one.

function captureScope() {
  const seen: { url?: string; body?: unknown } = {};
  const fetchImpl = vi.fn(async (url: string, init: { body: string }) => {
    seen.url = String(url);
    seen.body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ accessToken: "tok" }) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

describe("the scope the backup asks for", () => {
  it("asks for drive, because drive.file cannot see a folder somebody shared with it", async () => {
    const { seen, fetchImpl } = captureScope();
    await impersonateServiceAccount({
      federatedToken: "fed",
      serviceAccountEmail: "nbcc-backup-writer@example.iam.gserviceaccount.com",
      fetchImpl,
    });
    expect((seen.body as { scope: string[] }).scope).toEqual(["https://www.googleapis.com/auth/drive"]);
  });

  // Pinned so nobody "tightens" it back on the reasoning that a narrower scope must be safer. It is
  // narrower and it does not work: the folder is not one the service account created.
  it("does not ask for drive.file", async () => {
    const { seen, fetchImpl } = captureScope();
    await impersonateServiceAccount({
      federatedToken: "fed",
      serviceAccountEmail: "nbcc-backup-writer@example.iam.gserviceaccount.com",
      fetchImpl,
    });
    expect((seen.body as { scope: string[] }).scope.join()).not.toContain("drive.file");
  });

  it("impersonates the named service account and nothing else", async () => {
    const { seen, fetchImpl } = captureScope();
    await impersonateServiceAccount({
      federatedToken: "fed",
      serviceAccountEmail: "nbcc-backup-writer@example.iam.gserviceaccount.com",
      fetchImpl,
    });
    expect(seen.url).toContain("nbcc-backup-writer@example.iam.gserviceaccount.com:generateAccessToken");
  });

  // An hour is long enough for a backup of this size and short enough that a leaked token is stale
  // before anybody could use it.
  it("keeps the token short lived", async () => {
    const { seen, fetchImpl } = captureScope();
    await impersonateServiceAccount({
      federatedToken: "fed",
      serviceAccountEmail: "nbcc-backup-writer@example.iam.gserviceaccount.com",
      fetchImpl,
    });
    expect((seen.body as { lifetime: string }).lifetime).toBe("3600s");
  });
});
