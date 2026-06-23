import express from "express";
import { config } from "./config";
import { healthRouter } from "./routes/health";
import { createHomeRouter } from "./routes/home";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(createHomeRouter(config.NODE_ENV));
  app.use(healthRouter);
  // Add feature routers here.
  return app;
}
