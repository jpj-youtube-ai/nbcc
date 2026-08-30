import { Router } from "express";
import { getAvailability } from "../db/ball";

// TASK-313: the public, read-only availability feed for the Festive Ball page.
// Deliberately returns ONLY counts — never a buyer name, email or booking reference — because
// it is unauthenticated. Mirrors the supporter ticker feed's shape (src/routes/ticker.ts).

export const ballRouter = Router();

ballRouter.get("/api/ball/availability", async (_req, res) => {
  try {
    const a = await getAvailability();
    res.json({
      totalSeats: a.totalSeats,
      seatsRemaining: a.seatsRemaining,
      tablesRemaining: a.tablesRemaining,
      soldOut: a.soldOut,
      salesOpen: a.salesOpen,
    });
  } catch (err) {
    console.error("ball availability failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Could not read availability" });
  }
});
