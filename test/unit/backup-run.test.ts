import { describe, it, expect, vi } from "vitest";
import { runBackup, type BackupSeams } from "../../src/backup/run";
import { buildManifest, type Manifest } from "../../src/backup/manifest";

// TASK-423. The orchestration, with every real seam injected so this stays DB-free.
//
// What matters here is not the happy path, it is the refusals. A backup system that uploads
// whatever it managed to produce is worse than none, because it replaces good archives with bad
// ones and reports success while doing it. Every test below asserts that nothing was shipped.

const NOW = new Date("2026-09-22T02:00:00.000Z");

const healthyTables = {
  main: Object.fromEntries(Array.from({ length: 42 }, (_, i) => [`t${i}`, 10])),
  stories: { stories: 12 },
  contact: { contact_enquiries: 30 },
};

const previous: Manifest = buildManifest({
  takenAt: "2026-09-21T02:00:00.000Z",
  commit: "old1234",
  databases: [
    { label: "main", tables: healthyTables.main, dumpBytes: 900_000 },
    { label: "stories", tables: healthyTables.stories, dumpBytes: 4_000 },
    { label: "contact", tables: healthyTables.contact, dumpBytes: 6_000 },
  ],
  archiveBytes: 500_000,
});

function seams(overrides: Partial<BackupSeams> = {}): BackupSeams {
  return {
    now: NOW,
    commit: "abc1234",
    expectedTables: 44,
    enabled: true,
    dump: vi.fn(async (db) => ({
      tables: healthyTables[db.label as keyof typeof healthyTables],
      dumpBytes: 100_000,
    })),
    collectWebsite: vi.fn(async () => 2_000_000),
    packageArchive: vi.fn(async () => Buffer.alloc(510_000)),
    previousManifest: vi.fn(async () => previous),
    putToS3: vi.fn(async () => {}),
    putToDrive: vi.fn(async () => {}),
    pruneDrive: vi.fn(async () => 2),
    alert: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("when everything is healthy", () => {
  it("ships to both destinations and prunes", async () => {
    const s = seams();
    const out = await runBackup(s);
    expect(out.status).toBe("ok");
    expect(s.putToS3).toHaveBeenCalledOnce();
    expect(s.putToDrive).toHaveBeenCalledOnce();
    expect(s.pruneDrive).toHaveBeenCalledOnce();
    expect(s.alert).not.toHaveBeenCalled();
  });

  it("records all three databases and the real commit", async () => {
    const out = await runBackup(seams());
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.manifest.databases.map((d) => d.label)).toEqual(["main", "stories", "contact"]);
    expect(out.manifest.tableCount).toBe(44);
    expect(out.manifest.commit).toBe("abc1234");
  });

  // The S3 copy is the one that restores fast and is protected by Object Lock. If Drive is having
  // a bad day, losing the AWS copy too would be gratuitous.
  it("writes to S3 before Drive, so a Drive outage cannot cost us both", async () => {
    const order: string[] = [];
    const s = seams({
      putToS3: vi.fn(async () => { order.push("s3"); }),
      putToDrive: vi.fn(async () => { order.push("drive"); }),
    });
    await runBackup(s);
    expect(order).toEqual(["s3", "drive"]);
  });
});

describe("refusing to ship a bad backup", () => {
  // THE test. A dump that produced 3 tables when 44 exist must never reach either destination,
  // because doing so replaces a good archive with a broken one and calls it success.
  it("uploads nothing when tables are missing, and says which count it got", async () => {
    const s = seams({
      dump: vi.fn(async () => ({ tables: { donors: 1 }, dumpBytes: 500 })),
    });
    const out = await runBackup(s);

    expect(out.status).toBe("aborted");
    if (out.status === "aborted") expect(out.reason).toMatch(/3 .*44|expected 44/i);
    expect(s.putToS3).not.toHaveBeenCalled();
    expect(s.putToDrive).not.toHaveBeenCalled();
    expect(s.alert).toHaveBeenCalledOnce();
  });

  it("uploads nothing when the archive shrank materially", async () => {
    const s = seams({ packageArchive: vi.fn(async () => Buffer.alloc(100_000)) });
    const out = await runBackup(s);

    expect(out.status).toBe("aborted");
    expect(s.putToS3).not.toHaveBeenCalled();
    expect(s.putToDrive).not.toHaveBeenCalled();
    expect(s.alert).toHaveBeenCalledOnce();
  });

  // Pruning deletes things. Doing it after a refused backup would remove good archives on the
  // strength of a bad run.
  it("never prunes when it has refused to ship", async () => {
    const s = seams({ dump: vi.fn(async () => ({ tables: { donors: 1 }, dumpBytes: 500 })) });
    await runBackup(s);
    expect(s.pruneDrive).not.toHaveBeenCalled();
  });

  it("alerts and gives up when a dump throws outright", async () => {
    const s = seams({
      dump: vi.fn(async () => { throw new Error("pg_dump: server version mismatch"); }),
    });
    const out = await runBackup(s);

    expect(out.status).toBe("failed");
    if (out.status === "failed") expect(out.reason).toMatch(/version mismatch/);
    expect(s.putToS3).not.toHaveBeenCalled();
    expect(s.alert).toHaveBeenCalledOnce();
  });

  // Drive failing after S3 succeeded is a partial success, not a disaster: the locked copy exists.
  // It still has to shout, or a permanently broken Drive upload would go unnoticed forever.
  it("treats a Drive failure as partial, keeping the S3 copy and alerting", async () => {
    const s = seams({
      putToDrive: vi.fn(async () => { throw new Error("Drive upload failed: 403"); }),
    });
    const out = await runBackup(s);

    expect(out.status).toBe("partial");
    expect(s.putToS3).toHaveBeenCalledOnce();
    expect(s.alert).toHaveBeenCalledOnce();
  });
});

describe("when the job is switched off", () => {
  // A developer machine must never write to, or prune, the production backup store.
  it("does nothing at all, quietly", async () => {
    const s = seams({ enabled: false });
    const out = await runBackup(s);
    expect(out.status).toBe("disabled");
    expect(s.dump).not.toHaveBeenCalled();
    expect(s.putToS3).not.toHaveBeenCalled();
    expect(s.pruneDrive).not.toHaveBeenCalled();
    expect(s.alert).not.toHaveBeenCalled();
  });
});
