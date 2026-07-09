import { Pool } from "pg";
import { config } from "../config";

// A SEPARATE pool from src/db/pool.ts and src/db/stories-pool.ts, pointed at the dedicated
// `contact` database (own name + credentials, same RDS server). This is the ONLY pool the
// contact-inbox feature may use — it must never import or reach the main `charity` DB or the
// `stories` DB.
export const contactPool = new Pool({
  connectionString: config.CONTACT_DATABASE_URL,
  max: 5, // small pool: Fargate tasks are few; keep RDS connections modest
});
