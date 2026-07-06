import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-129 (REQ-059): PATCH /api/portal/:token/declaration edits the identity/address on the donor's
// active Gift Aid declaration (the amend path) and syncs the account name. DB + auth mocked.

const { authMock, getActiveMock, reviseMock, updateMock, snapshotMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getActiveMock: vi.fn(),
  reviseMock: vi.fn(),
  updateMock: vi.fn(),
  snapshotMock: vi.fn(),
}));

vi.mock("../../src/db/portal", () => ({
  authenticatePortalToken: authMock,
  getActiveDeclarationForDonor: getActiveMock,
  updateDonorPortal: updateMock,
  getDonorPortalSnapshot: snapshotMock,
  getDonorDonationHistory: vi.fn(),
  issuePortalAccessToken: vi.fn(),
  findNewestDonorByEmail: vi.fn(),
}));
vi.mock("../../src/db/declarations", () => ({
  reviseDeclaration: reviseMock,
  findActiveDeclarationIdForDonor: vi.fn(),
  cancelDeclaration: vi.fn(),
  DeclarationCancellationError: class extends Error {},
}));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    PORTAL_BASE_URL: "https://example.org/portal",
  },
}));

import { patchDeclaration } from "../../src/routes/portal";

type MockRes = {
  statusCode: number;
  body: unknown;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
};
const makeRes = (): MockRes => {
  const res: MockRes = {
    statusCode: 0,
    body: undefined,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
  return res;
};
const validFields = {
  title: "Dr",
  firstName: "Ada",
  lastName: "Lovelace",
  houseNameNumber: "12",
  address: "New Address, Kilmarnock",
  postcode: "KA1 1AA",
  nonUk: false,
};

beforeEach(() => {
  authMock.mockReset();
  getActiveMock.mockReset();
  reviseMock.mockReset();
  updateMock.mockReset();
  snapshotMock.mockReset();
  authMock.mockResolvedValue({ donorId: 42 });
  getActiveMock.mockResolvedValue({
    id: 7,
    scope: "all_donations",
    confirmedTaxpayer: true,
    firstName: "Ada",
    lastName: "Lovelace",
  });
  reviseMock.mockResolvedValue({ outcome: "amended", declarationId: 7, changedFields: ["address"] });
  updateMock.mockResolvedValue({ donorId: 42, fields: ["fullName"] });
  snapshotMock.mockResolvedValue({ donorId: 42, fullName: "Ada Lovelace" });
});

describe("PATCH /api/portal/:token/declaration (TASK-129)", () => {
  it("amends the active declaration and syncs the account name", async () => {
    const res = makeRes();
    await patchDeclaration({ params: { token: "t" }, body: validFields } as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(reviseMock).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ address: "New Address, Kilmarnock" }),
      expect.objectContaining({
        scope: "all_donations",
        confirmedTaxpayer: true,
        actor: "donor",
        syncDonorFullName: "Ada Lovelace",
      }),
    );
    // TASK-131: the name sync is now inside reviseDeclaration's transaction, not a separate call.
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("404s when the donor has no active declaration", async () => {
    getActiveMock.mockResolvedValueOnce(null);
    const res = makeRes();
    await patchDeclaration({ params: { token: "t" }, body: validFields } as never, res as never);
    expect(res.statusCode).toBe(404);
    expect(reviseMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("400s on an invalid body (blank last name)", async () => {
    const res = makeRes();
    await patchDeclaration(
      { params: { token: "t" }, body: { ...validFields, lastName: "" } } as never,
      res as never,
    );
    expect(res.statusCode).toBe(400);
    expect(reviseMock).not.toHaveBeenCalled();
  });

  it("401s on an invalid token", async () => {
    const { PortalTokenError } = await import("../../src/portal/tokens");
    authMock.mockRejectedValueOnce(new PortalTokenError("expired"));
    const res = makeRes();
    await patchDeclaration({ params: { token: "bad" }, body: validFields } as never, res as never);
    expect(res.statusCode).toBe(401);
  });
});
