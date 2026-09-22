import { createHash } from "node:crypto";
import { signRequest, type AwsCredentials } from "./aws-sigv4";

// TASK-423: the AWS-side backup destination, hand-signed on the existing SigV4 signer.
//
// No @aws-sdk/client-s3, for the reason recorded in src/clients/aws-sigv4.ts: the npm registry is
// blocked on the owner's machine, so a new runtime dependency would stop the app booting locally
// at all. S3's REST API is two verbs for what this needs.

export type S3ClientOptions = {
  bucket: string;
  region: string;
  credentials: () => Promise<AwsCredentials>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

export type S3Client = {
  put: (key: string, body: Buffer, contentType?: string) => Promise<void>;
  getJson: <T>(key: string) => Promise<T | null>;
};

export function createS3Client(opts: S3ClientOptions): S3Client {
  const doFetch = opts.fetchImpl ?? fetch;
  const clock = opts.now ?? (() => new Date());
  const endpoint = (key: string) =>
    `https://${opts.bucket}.s3.${opts.region}.amazonaws.com/${key}`;

  return {
    async put(key, body, contentType = "application/octet-stream") {
      // S3 refuses a signed request without this header, and it must hash the ACTUAL payload.
      // Getting it wrong surfaces as an opaque SignatureDoesNotMatch rather than anything useful.
      const payloadHash = createHash("sha256").update(body).digest("hex");
      const url = endpoint(key);

      const headers = signRequest({
        method: "PUT",
        url,
        headers: { "content-type": contentType, "x-amz-content-sha256": payloadHash },
        body,
        region: opts.region,
        service: "s3",
        credentials: await opts.credentials(),
        now: clock(),
      });

      const res = await doFetch(url, {
        method: "PUT",
        headers,
        body: body as unknown as BodyInit,
      });
      if (!res.ok) throw new Error(`S3 put ${key} failed: ${res.status} ${await res.text()}`);
    },

    async getJson<T>(key: string): Promise<T | null> {
      const url = endpoint(key);
      const emptyHash = createHash("sha256").update("").digest("hex");

      const headers = signRequest({
        method: "GET",
        url,
        headers: { "x-amz-content-sha256": emptyHash },
        body: "",
        region: opts.region,
        service: "s3",
        credentials: await opts.credentials(),
        now: clock(),
      });

      const res = await doFetch(url, { method: "GET", headers });

      // A missing object is the normal state on the first ever run. Treating it as an error would
      // mean the backup could never take its first successful run. Anything else IS an error: a
      // 403 must not be quietly mistaken for "no history yet", or a permissions fault would
      // disable the continuity check permanently and silently.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`S3 get ${key} failed: ${res.status} ${await res.text()}`);
      return (await res.json()) as T;
    },
  };
}
