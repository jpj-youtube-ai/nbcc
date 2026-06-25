import { Router } from "express";

// Marketing-site API endpoints. Routing/STUBS ONLY — the business logic ships in
// REQ-029 (checkout-session: payment) and REQ-030 (contact: message handling).
// Each returns 501 Not Implemented so the route is wired and discoverable
// without implementing payments/email here (per TASK-005 scope).
export const apiRouter = Router();

apiRouter.post("/api/checkout-session", (_req, res) => {
  res.status(501).json({ error: "Not Implemented", requirement: "REQ-029" });
});

apiRouter.post("/api/contact", (_req, res) => {
  res.status(501).json({ error: "Not Implemented", requirement: "REQ-030" });
});
