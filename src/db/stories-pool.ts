import { Pool } from "pg";
import { config } from "../config";

// A SEPARATE pool from src/db/pool.ts, pointed at the dedicated `stories` database
// (own name + credentials, same RDS server). This is the ONLY pool the My Story
// feature may use — it must never import or reach the main `charity` DB (Task B1).
export const storiesPool = new Pool({
  connectionString: config.STORIES_DATABASE_URL,
  max: 5, // small pool: Fargate tasks are few; keep RDS connections modest
});
