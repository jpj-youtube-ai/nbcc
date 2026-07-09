-- Contact form inbox (2026-07-10 spec): local-dev parity with staging/production.
--
-- Mirrors what scripts/bootstrap-contact-db.mjs provisions imperatively in
-- staging/production (there's no Terraform postgresql provider and RDS is
-- private, so it's created out of band there too — see that script). Postgres
-- runs every *.sql file in docker-entrypoint-initdb.d on first container init
-- ONLY (an existing data volume is left alone), so this creates the SEPARATE
-- `contact` database + its own `contact_app` role alongside the `charity` DB
-- (POSTGRES_DB/POSTGRES_USER) and the `stories` DB (10-stories-db.sql).
--
-- Credentials match the .env.example default:
--   CONTACT_DATABASE_URL=postgres://contact_app:contact@localhost:5432/contact
--
-- If you already have a local pgdata volume from before this change, either
-- run these two statements manually against it, or `docker compose down -v`
-- to let the init scripts run fresh (destroys local data).
CREATE ROLE contact_app LOGIN PASSWORD 'contact';
CREATE DATABASE contact OWNER contact_app;
GRANT ALL PRIVILEGES ON DATABASE contact TO contact_app;
