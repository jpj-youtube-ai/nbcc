import { writeWithAudit } from "./donations";

// TASK-491: the two writes behind the call reminders on Admin > Business supporters. Each is one
// transaction with its audit_log row (writeWithAudit), so a call or a phone change always appears in
// the supporter's History, and never appears there without having happened. The decision of who is
// due a call is the pure callDue in src/business/call-due.ts; the read is listBusinessFulfilments.

export class BusinessCallError extends Error {
  constructor(public readonly reason: "not_found") {
    super(`business call: ${reason}`);
    this.name = "BusinessCallError";
  }
}

export interface BusinessCall {
  id: number;
  fulfilment_id: number;
  called_at: Date;
  called_by: string | null;
  note: string | null;
}

/**
 * Record that somebody called this business. `calledBy` is the admin's email, shown on the page;
 * `actor` is the audit actor ("admin:<email>"). An unknown record throws not_found and writes nothing.
 */
export async function recordBusinessCall(
  fulfilmentId: number,
  note: string | null,
  calledBy: string,
  actor: string,
): Promise<BusinessCall> {
  return writeWithAudit(
    async (client) => {
      // Inserting FROM the record means an unknown id inserts nothing, rather than tripping the
      // foreign key and reading as a server fault.
      const res = await client.query<BusinessCall>(
        `INSERT INTO business_supporter_calls (fulfilment_id, called_by, note)
         SELECT f.id, $2, $3 FROM business_supporter_fulfilment f WHERE f.id = $1
         RETURNING id, fulfilment_id, called_at, called_by, note`,
        [fulfilmentId, calledBy, note],
      );
      const call = res.rows[0];
      if (!call) throw new BusinessCallError("not_found");
      return call;
    },
    (call) => ({
      actor,
      action: "fulfilment.called",
      entity: "business_supporter_fulfilment",
      entityId: call.fulfilment_id,
      data: { note: call.note },
    }),
  );
}

/**
 * Set (or, with null, take away) the number to call this business on. The History row keeps the
 * number it replaced, so a mistyped change can be put back. An unknown record throws not_found.
 */
export async function setBusinessPhone(
  fulfilmentId: number,
  phone: string | null,
  actor: string,
): Promise<{ id: number; phone: string | null; previous: string | null }> {
  return writeWithAudit(
    async (client) => {
      const before = await client.query<{ phone: string | null }>(
        `SELECT phone FROM business_supporter_fulfilment WHERE id = $1 FOR UPDATE`,
        [fulfilmentId],
      );
      if (!before.rows[0]) throw new BusinessCallError("not_found");
      const res = await client.query<{ id: number; phone: string | null }>(
        `UPDATE business_supporter_fulfilment
            SET phone = $2, updated_at = now()
          WHERE id = $1
        RETURNING id, phone`,
        [fulfilmentId, phone],
      );
      const row = res.rows[0];
      if (!row) throw new BusinessCallError("not_found");
      return { id: row.id, phone: row.phone, previous: before.rows[0].phone };
    },
    (r) => ({
      actor,
      action: "fulfilment.phone",
      entity: "business_supporter_fulfilment",
      entityId: r.id,
      data: { phone: r.phone, previous: r.previous },
    }),
  );
}
