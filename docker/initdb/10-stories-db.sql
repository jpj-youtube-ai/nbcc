-- My Story submissions (TASK-B2): local-dev parity with staging/production.
--
-- Mirrors what scripts/bootstrap-stories-db.mjs provisions imperatively in
-- staging/production (there's no Terraform postgresql provider and RDS is
-- private, so it's created out of band there too — see that script). Postgres
-- runs every *.sql file in docker-entrypoint-initdb.d on first container init
-- ONLY (an existing data volume is left alone), so this creates the SEPARATE
-- `stories` database + its own `stories_app` role alongside the `charity` DB
-- that POSTGRES_DB/POSTGRES_USER already create.
--
-- Credentials match the .env.example default:
--   STORIES_DATABASE_URL=postgres://stories_app:stories@localhost:5432/stories
--
-- If you already have a local pgdata volume from before this change, either
-- run these two statements manually against it, or `docker compose down -v`
-- to let the init scripts run fresh (destroys local data).
CREATE ROLE stories_app LOGIN PASSWORD 'stories';
CREATE DATABASE stories OWNER stories_app;
GRANT ALL PRIVILEGES ON DATABASE stories TO stories_app;
