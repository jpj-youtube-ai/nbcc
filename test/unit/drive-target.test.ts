import { describe, it, expect } from "vitest";
import { resolveFolderKind } from "../../src/clients/google-drive";

// TASK-423. Whether the backup folder lives in a Shared Drive or in someone's personal My Drive
// is not cosmetic: a service account has no Drive storage of its own, so a file it would own in a
// personal folder is rejected outright with "Service Accounts do not have storage quota". A
// Shared Drive owns its own files, so it just works.
//
// Rather than ask a human to classify their own folder correctly and store the answer in config
// where it can silently drift, ask Drive. A folder inside a Shared Drive carries a driveId; one in
// My Drive does not. Getting this wrong fails only against the live API, so it is worth not
// guessing.

function fakeFetch(payload: unknown, ok = true, status = 200): typeof fetch {
  return (async () => ({
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  })) as unknown as typeof fetch;
}

describe("working out what kind of folder we were given", () => {
  it("recognises a Shared Drive folder by its driveId", async () => {
    const kind = await resolveFolderKind({
      accessToken: "t",
      folderId: "abc",
      fetchImpl: fakeFetch({ id: "abc", name: "NBCC Backups", driveId: "0ABCdef" }),
    });
    expect(kind.sharedDrive).toBe(true);
    expect(kind.name).toBe("NBCC Backups");
  });

  it("recognises a personal My Drive folder by the absence of one", async () => {
    const kind = await resolveFolderKind({
      accessToken: "t",
      folderId: "abc",
      fetchImpl: fakeFetch({ id: "abc", name: "NBCC Backups" }),
    });
    expect(kind.sharedDrive).toBe(false);
  });

  // The failure that would otherwise be a 2am mystery: the folder was never shared with the
  // service account, so Drive says it does not exist. The message has to name the fix.
  it("explains a 404 as a sharing problem, because that is what it always is", async () => {
    await expect(
      resolveFolderKind({
        accessToken: "t",
        folderId: "abc",
        fetchImpl: fakeFetch({ error: "not found" }, false, 404),
      }),
    ).rejects.toThrow(/shared with the service account/i);
  });

  it("surfaces any other failure with its status rather than swallowing it", async () => {
    await expect(
      resolveFolderKind({
        accessToken: "t",
        folderId: "abc",
        fetchImpl: fakeFetch({ error: "boom" }, false, 500),
      }),
    ).rejects.toThrow(/500/);
  });
});
