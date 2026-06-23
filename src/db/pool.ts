import { Pool } from "pg";
import { config } from "../config";

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 5, // small pool: Fargate tasks are few; keep RDS connections modest
});
