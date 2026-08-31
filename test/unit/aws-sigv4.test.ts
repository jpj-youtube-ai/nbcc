import { describe, it, expect, vi } from "vitest";
import { signRequest, createCredentialProvider } from "../../src/clients/aws-sigv4";

// The signer is pinned to AWS's own published SigV4 example ("Complete Signature Version 4
// signing process", the ListUsers/IAM request): fixed key, fixed clock, byte-exact expected
// signature. If the canonicalisation drifts in ANY way — header ordering, query encoding,
// payload hashing — this vector catches it without a network in sight.

const DOC_CREDENTIALS = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

describe("signRequest (SigV4)", () => {
  it("reproduces AWS's published signing example byte for byte", () => {
    const headers = signRequest({
      method: "GET",
      url: "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
      body: "",
      region: "us-east-1",
      service: "iam",
      credentials: DOC_CREDENTIALS,
      now: new Date("2015-08-30T12:36:00Z"),
    });
    expect(headers["x-amz-date"]).toBe("20150830T123600Z");
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, " +
        "SignedHeaders=content-type;host;x-amz-date, " +
        "Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
    );
  });

  it("includes and signs the session token when credentials are temporary", () => {
    const headers = signRequest({
      method: "POST",
      url: "https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
      region: "eu-west-1",
      service: "ses",
      credentials: { ...DOC_CREDENTIALS, sessionToken: "TOKEN123" },
      now: new Date("2026-08-31T10:00:00Z"),
    });
    expect(headers["x-amz-security-token"]).toBe("TOKEN123");
    expect(headers.authorization).toContain("SignedHeaders=content-type;host;x-amz-date;x-amz-security-token");
    expect(headers.host).toBe("email.eu-west-1.amazonaws.com");
  });

  it("changes the signature when the body changes — the payload hash is signed", () => {
    const base = {
      method: "POST",
      url: "https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails",
      region: "eu-west-1",
      service: "ses",
      credentials: DOC_CREDENTIALS,
      now: new Date("2026-08-31T10:00:00Z"),
    };
    const a = signRequest({ ...base, body: "one" }).authorization;
    const b = signRequest({ ...base, body: "two" }).authorization;
    expect(a).not.toBe(b);
  });
});

describe("createCredentialProvider", () => {
  it("prefers static env credentials and never refetches them", async () => {
    const fetchImpl = vi.fn();
    const provider = createCredentialProvider(
      { accessKeyId: "AKID", secretAccessKey: "SECRET", sessionToken: "TOK" },
      fetchImpl as unknown as typeof fetch,
    );
    const first = await provider();
    const second = await provider();
    expect(first).toEqual({ accessKeyId: "AKID", secretAccessKey: "SECRET", sessionToken: "TOK" });
    expect(second).toBe(first);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falls back to the ECS endpoint and caches until near expiry", async () => {
    let now = Date.parse("2026-08-31T10:00:00Z");
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        AccessKeyId: "ECSKEY",
        SecretAccessKey: "ECSSECRET",
        Token: "ECSTOKEN",
        Expiration: "2026-08-31T11:00:00Z",
      }),
    });
    const provider = createCredentialProvider(
      { containerCredentialsRelativeUri: "/v2/credentials/abc" },
      fetchImpl as unknown as typeof fetch,
      () => now,
    );
    const creds = await provider();
    expect(creds).toEqual({ accessKeyId: "ECSKEY", secretAccessKey: "ECSSECRET", sessionToken: "ECSTOKEN" });
    expect(fetchImpl).toHaveBeenCalledWith("http://169.254.170.2/v2/credentials/abc");

    await provider(); // still fresh — cached
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now = Date.parse("2026-08-31T10:56:00Z"); // inside the 5-minute refresh margin
    await provider();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws a clear error when no credential source exists", async () => {
    const provider = createCredentialProvider({}, vi.fn() as unknown as typeof fetch);
    await expect(provider()).rejects.toThrow(/No AWS credentials available/);
  });
});
