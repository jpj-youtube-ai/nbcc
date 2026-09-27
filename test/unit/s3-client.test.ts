import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { createS3Client } from "../../src/clients/s3";

// TASK-423. The backup's AWS-side destination. Hand-signed like SES, for the same reason recorded
// in src/clients/aws-sigv4.ts: the npm registry is blocked on the owner's machine, so adding the
// AWS SDK would stop the app booting locally at all.

const credentials = async () => ({
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secret",
  sessionToken: "token",
});

function capture() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const client = (fetchImpl: typeof fetch) =>
  createS3Client({
    bucket: "nbcc-backups",
    region: "eu-west-2",
    credentials,
    fetchImpl,
    now: () => new Date("2026-09-22T02:00:00.000Z"),
  });

describe("putting an object", () => {
  it("addresses the right bucket, region and key", async () => {
    const { calls, fetchImpl } = capture();
    await client(fetchImpl).put("nbcc-backup-2026-09-22.7z", Buffer.from("archive"));
    expect(calls[0].url).toBe(
      "https://nbcc-backups.s3.eu-west-2.amazonaws.com/nbcc-backup-2026-09-22.7z",
    );
    expect(calls[0].init.method).toBe("PUT");
  });

  // S3 refuses a signed PUT that does not carry this header, and it must be the hash of the ACTUAL
  // payload. Sending a hash of the wrong thing fails with an opaque SignatureDoesNotMatch.
  it("sends x-amz-content-sha256 matching the real payload", async () => {
    const { calls, fetchImpl } = capture();
    const body = Buffer.from("the archive bytes");
    await client(fetchImpl).put("k.7z", body);

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-amz-content-sha256"]).toBe(
      createHash("sha256").update(body).digest("hex"),
    );
  });

  // TASK-428. The first real backup got all the way here and was rejected:
  //
  //   InvalidRequest: Content-MD5 OR x-amz-checksum- HTTP header is required for Put Object
  //   requests with Object Lock parameters
  //
  // A bucket with Object Lock will not accept an upload it cannot verify, which is the whole
  // point of a write-once store: it will not immortalise bytes that may have arrived corrupted.
  // An ordinary bucket has no such requirement, so this could only fail against the real one.
  //
  // Note the encodings differ and mixing them gives an opaque signature error:
  // x-amz-content-sha256 is HEX (SigV4 needs it), x-amz-checksum-sha256 is BASE64.
  it("sends the checksum Object Lock requires, base64 not hex", async () => {
    const { calls, fetchImpl } = capture();
    const body = Buffer.from("the archive bytes");
    await client(fetchImpl).put("k.7z", body);

    const headers = calls[0].init.headers as Record<string, string>;
    const digest = createHash("sha256").update(body).digest();

    expect(headers["x-amz-checksum-sha256"]).toBe(digest.toString("base64"));
    // And the SigV4 payload hash is still hex, unchanged.
    expect(headers["x-amz-content-sha256"]).toBe(digest.toString("hex"));
    expect(headers["x-amz-checksum-sha256"]).not.toBe(digest.toString("hex"));
  });

  it("signs the checksum header, or S3 rejects the signature", async () => {
    const { calls, fetchImpl } = capture();
    await client(fetchImpl).put("k.7z", Buffer.from("x"));
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toContain("x-amz-checksum-sha256");
  });

  it("carries the session token, because ECS task-role credentials are always temporary", async () => {
    const { calls, fetchImpl } = capture();
    await client(fetchImpl).put("k.7z", Buffer.from("x"));
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-amz-security-token"]).toBe("token");
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/);
  });
});

describe("reading the previous manifest", () => {
  it("parses it when present", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tableCount: 44 }),
      text: async () => "",
    })) as unknown as typeof fetch;
    expect(await client(fetchImpl).getJson("manifest.json")).toEqual({ tableCount: 44 });
  });

  // The first ever run has no previous manifest. That is a normal state, not an error, and must
  // not stop the backup: treating it as a failure would mean the system could never start.
  it("returns null on the first ever run rather than throwing", async () => {
    const fetchImpl = (async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => "NoSuchKey",
    })) as unknown as typeof fetch;
    expect(await client(fetchImpl).getJson("manifest.json")).toBeNull();
  });

  it("still throws on a real failure, so a broken bucket is not mistaken for a first run", async () => {
    const fetchImpl = (async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
      text: async () => "AccessDenied",
    })) as unknown as typeof fetch;
    await expect(client(fetchImpl).getJson("manifest.json")).rejects.toThrow(/403/);
  });
});
