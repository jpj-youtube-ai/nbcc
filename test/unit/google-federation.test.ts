import { describe, it, expect } from "vitest";
import {
  federationAudience,
  workloadIdentityPrincipal,
  buildSubjectToken,
  STS_TARGET_HEADER,
} from "../../src/clients/google-federation";

// TASK-423. Google would not let us download a service account key: the organisation enforces
// iam.disableServiceAccountKeyCreation, which is on by default for newer organisations because a
// downloaded key is a permanent password in a file, and those leak.
//
// So there is no key. Google is told to trust one specific AWS role instead. At 2am the backup job
// signs a GetCallerIdentity call with its ECS task-role credentials, Google checks that signature
// with AWS, and issues a token that expires within the hour. Nothing to store, nothing to rotate,
// nothing to leak.
//
// The shapes below are dictated by Google and are easy to get subtly wrong in ways that fail only
// against the live API, so they are pinned here.

const PROJECT_NUMBER = "84513277257";
const POOL = "aws-nbcc";
const PROVIDER = "aws-provider";
const AWS_ACCOUNT = "049164057909";
const ROLE = "charity-site-production-task";

describe("the audience, which names the pool that is allowed to vouch for us", () => {
  it("is the full resource path Google expects", () => {
    expect(federationAudience({ projectNumber: PROJECT_NUMBER, poolId: POOL, providerId: PROVIDER })).toBe(
      "//iam.googleapis.com/projects/84513277257/locations/global/workloadIdentityPools/aws-nbcc/providers/aws-provider",
    );
  });
});

describe("the principal, which is the single AWS identity Google will trust", () => {
  // This is the whole security boundary. It names one role in one account. A different role, a
  // different AWS account, or a developer laptop cannot present it.
  it("pins trust to exactly one assumed role in one account", () => {
    expect(
      workloadIdentityPrincipal({
        projectNumber: PROJECT_NUMBER,
        poolId: POOL,
        awsAccountId: AWS_ACCOUNT,
        roleName: ROLE,
      }),
    ).toBe(
      "principalSet://iam.googleapis.com/projects/84513277257/locations/global/workloadIdentityPools/aws-nbcc/attribute.aws_role/arn:aws:sts::049164057909:assumed-role/charity-site-production-task",
    );
  });
});

describe("the subject token: a signed AWS request, handed to Google to verify", () => {
  const audience = federationAudience({
    projectNumber: PROJECT_NUMBER,
    poolId: POOL,
    providerId: PROVIDER,
  });
  const signed = {
    authorization: "AWS4-HMAC-SHA256 Credential=ASIA.../20260922/us-east-1/sts/aws4_request, ...",
    "x-amz-date": "20260922T020000Z",
    "x-amz-security-token": "FwoGZXIvYXdzE...",
    host: "sts.amazonaws.com",
    [STS_TARGET_HEADER]: audience,
  };
  const url = "https://sts.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15";

  const decode = (t: string) => JSON.parse(decodeURIComponent(t));

  it("describes the request Google should replay to AWS", () => {
    const token = decode(buildSubjectToken({ url, method: "POST", signedHeaders: signed }));
    expect(token.url).toBe(url);
    expect(token.method).toBe("POST");
  });

  it("carries the headers as a list of key/value pairs, not an object", () => {
    const token = decode(buildSubjectToken({ url, method: "POST", signedHeaders: signed }));
    expect(Array.isArray(token.headers)).toBe(true);
    const byKey = Object.fromEntries(token.headers.map((h: { key: string; value: string }) => [h.key, h.value]));
    expect(byKey.authorization).toBe(signed.authorization);
    expect(byKey["x-amz-security-token"]).toBe(signed["x-amz-security-token"]);
  });

  // Without this header the signed request could be replayed against a DIFFERENT Google project's
  // pool. It binds the signature to ours, so it must survive into the token.
  it("keeps the header that binds the signature to our pool and no other", () => {
    const token = decode(buildSubjectToken({ url, method: "POST", signedHeaders: signed }));
    const byKey = Object.fromEntries(token.headers.map((h: { key: string; value: string }) => [h.key, h.value]));
    expect(byKey[STS_TARGET_HEADER]).toBe(audience);
  });

  it("refuses to build a token that is missing that binding, rather than sending a replayable one", () => {
    const unbound = { ...signed };
    delete (unbound as Record<string, string>)[STS_TARGET_HEADER];
    expect(() => buildSubjectToken({ url, method: "POST", signedHeaders: unbound })).toThrow(
      new RegExp(STS_TARGET_HEADER),
    );
  });

  it("is URL-encoded, because Google expects it as a single opaque string", () => {
    const token = buildSubjectToken({ url, method: "POST", signedHeaders: signed });
    expect(token).not.toContain("{");
    expect(() => decode(token)).not.toThrow();
  });
});
