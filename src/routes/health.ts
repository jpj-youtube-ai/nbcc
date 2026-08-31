import { Router } from "express";
import { pool } from "../db/pool";
import { config } from "../config";

export const healthRouter = Router();

// The ALB health check and the pipeline smoke test both hit this.
// Keep it fast. A lightweight DB ping means "unhealthy" also covers
// "can't reach the database", which for this app is a real outage.
healthRouter.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    // `version` is what makes a silent rollback visible: without it there is no way to ask a
    // running service which build it is, and a deploy that quietly reverted looks identical
    // to one that worked. Static string, so golden rule 6 still holds.
    res.status(200).json({ status: "ok", version: config.GIT_SHA });
  } catch {
    res.status(503).json({ status: "degraded", version: config.GIT_SHA });
  }
});
