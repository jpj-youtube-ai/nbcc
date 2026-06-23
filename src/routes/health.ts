import { Router } from "express";
import { pool } from "../db/pool";

export const healthRouter = Router();

// The ALB health check and the pipeline smoke test both hit this.
// Keep it fast. A lightweight DB ping means "unhealthy" also covers
// "can't reach the database", which for this app is a real outage.
healthRouter.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "degraded" });
  }
});
