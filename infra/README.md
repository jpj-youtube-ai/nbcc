# Infrastructure

How the AWS infrastructure for this service is built, deployed, and changed.
For the quick "where do I edit X" map, see **Infrastructure changes (Terraform)**
in the repo root `CLAUDE.md`. This file is the deeper walkthrough.

## What runs where

A single containerised Express service runs on **AWS Fargate** behind an
**Application Load Balancer**, talking to **RDS Postgres**, in two isolated
environments (**staging** and **production**). Everything is Terraform.

```
Internet
   │  HTTP :80
   ▼
Application Load Balancer  (public subnets)         security group: alb  (⇽ 0.0.0.0/0:80)
   │  forward → target group (/health check, target_type=ip)
   ▼
ECS Fargate service · task "app" :3000  (public subnets, public IP, no NAT)
   │   • config from env vars; secrets injected from SSM at task start
   │   • logs → CloudWatch  /ecs/<project>-<env>
   ▼  TLS :5432                                       security group: task (⇽ alb:3000 only)
RDS Postgres 16  (isolated database subnets, not publicly accessible)
                                                      security group: rds  (⇽ task:5432 only)
```

Cost note: tasks run in **public subnets with a public IP and no NAT gateway**
(saves ~£25–30/mo). That public IP is for *egress only* (external APIs, ECR, SSM
pulls); inbound to the task is locked to the ALB security group. RDS is reachable
only from the task security group.

## Layout

```
infra/
  modules/app/         Reusable module — the actual resources. Edit here for
                       anything BOTH environments share.
    main.tf            VPC + subnets (terraform-aws-modules/vpc), CloudWatch log
                       group, generated DB password, SSM parameters (DATABASE_URL
                       built here with sslmode=no-verify; API keys as placeholders).
    alb.tf             ALB, target group, HTTP listener, and the alb/task/rds
                       security groups.
    ecs.tf             ECS cluster, task definition (env + secrets), ECS service,
                       and the execution/task IAM roles.
    rds.tf             Postgres instance.
    variables.tf       Every input knob, with defaults.
    outputs.tf         Values the deploy workflows read back from state.
  envs/
    staging/           Thin root: calls the module with staging settings.
    production/        Thin root: calls the module with production settings.
      main.tf          Module call + per-env inputs (CIDRs, counts, AZ, etc.).
      backend.tf       S3 remote-state config + AWS provider/default tags.
      variables.tf     Root vars (region).
      outputs.tf       Re-exports module outputs.
```

Module-vs-root rule of thumb: **a resource or a setting that's the same in both
environments belongs in the module; only the values that differ belong in the env
roots.**

## Environments

| | staging | production |
|---|---|---|
| VPC CIDR | `10.20.0.0/16` | `10.30.0.0/16` (non-overlapping, so they could peer later) |
| ECS `desired_count` | 1 | 2 |
| RDS | `db.t4g.micro`, single-AZ | `db.t4g.micro`, **multi-AZ** |
| `deletion_protection` | off | **on** |
| Backup retention (`backup_retention_days`) | 7 (default) | **5** |
| Final snapshot on destroy | skipped | **taken** |
| State key | `staging/terraform.tfstate` | `production/terraform.tfstate` |

Both use region **eu-west-2**, project name **charity-site**, the shared ECR repo
**charity-site**, and the S3 state bucket **charity-site-tfstate**.

## State

Terraform state is in S3 (`charity-site-tfstate`), one key per environment, with
native S3 locking (`use_lockfile`, Terraform ≥ 1.10 — no DynamoDB). The bucket is
versioned, encrypted, and public-access-blocked. It's created by the bootstrap
script (below); if you rename it, update `bucket` in both `envs/*/backend.tf`.

## Config & secrets

The app reads only `process.env` (via `src/config`). In AWS those vars come from
the task definition:

- **Plain values** → `environment` block in `ecs.tf` (`NODE_ENV`, `PORT`,
  `EXTERNAL_API_ONE_BASE_URL`). `NODE_ENV` is set to the env name, which is what
  makes the home page show `staging` vs `production`.
- **Secrets** → `secrets` block in `ecs.tf`, each pointing at an **SSM parameter**
  (`DATABASE_URL`, `EXTERNAL_API_ONE_KEY`, `EXTERNAL_API_TWO_KEY`,
  `STORIES_DATABASE_URL`, …). ECS resolves them at task start and injects them
  as env vars — no AWS SDK in the app.

Adding a secret takes **three** edits or the task fails to start:
1. the SSM parameter in `main.tf`,
2. the `secrets` entry in `ecs.tf`,
3. that parameter's ARN in the `exec_secrets` IAM policy in `ecs.tf`.

`DATABASE_URL` is assembled in `main.tf` from the generated password + RDS address
and **must** include `sslmode=no-verify` — RDS enforces TLS (`rds.force_ssl=1`),
so a plaintext connection is rejected (`no pg_hba.conf entry … no encryption`).
The API-key SSM params ship as `REPLACE_ME` placeholders with
`lifecycle { ignore_changes = [value] }`; set real values out of band:

```
aws ssm put-parameter --name /charity-site/staging/EXTERNAL_API_ONE_KEY \
  --type SecureString --value 'real-key' --overwrite
```

### My Story: the separate `stories` database (TASK-B2)

`STORIES_DATABASE_URL` (SSM SecureString, `main.tf`) is assembled the same way as
`DATABASE_URL` — generated password (`random_password.stories`) + RDS address +
`sslmode=no-verify` — but points at a **different database name** (`stories`)
and a **different role** (`stories_app`), never the `charity` DB's master `app`
user. It's wired through the same three places as any other secret (SSM param,
`secrets` entry, `exec_secrets` ARN in `ecs.tf`).

Terraform can generate and publish that credential, but it **cannot create the
database or role**: there's no `postgresql` provider in this stack, `db_name` on
`aws_db_instance.app` is hardcoded to `charity` (`rds.tf`), and RDS is private
(only the ECS task security group can reach it). So provisioning is imperative —
`scripts/bootstrap-stories-db.mjs`, run as a one-off `ecs run-task` (same shape
as the migration step below, connecting with the **master** `DATABASE_URL`,
which has `CREATEDB`/`CREATEROLE` on RDS). It idempotently:

1. `CREATE ROLE stories_app LOGIN PASSWORD …` (or `ALTER ROLE …` to re-sync the
   password if the role already exists — covers secret rotation),
2. `CREATE DATABASE stories OWNER stories_app` (skipped if it already exists),
3. `GRANT ALL PRIVILEGES ON DATABASE stories TO stories_app`.

Every statement runs outside a transaction (`CREATE DATABASE` can't run inside
one). Safe to re-run — the deploy workflows run it on **every** deploy, not just
the first, via `npm run bootstrap:stories`.

Both deploy workflows (`deploy-staging.yml`, `deploy-prod.yml`) run, in order,
right after the `charity` migration step and before "Deploy service":
1. **Bootstrap stories database (idempotent)** — `npm run bootstrap:stories`.
2. **Run stories DB migrations** — `npm run migrate:stories` (against
   `migrations-stories/`, its own `pgmigrations` table, never touching the
   `charity` DB).

Local dev gets the same `stories` database + `stories_app` role via a
`docker-entrypoint-initdb.d` script (`docker/initdb/10-stories-db.sql`), mounted
into the `db` service in `docker-compose.yml` — it only runs on a **fresh**
Postgres data volume, so an existing local `pgdata` volume needs either the two
statements run manually or a `docker compose down -v` to pick it up.

## One-time bootstrap

Before any workflow can run, an admin runs `scripts/bootstrap-aws.sh` once. It
creates the chicken-and-egg prerequisites:

- the S3 Terraform state bucket,
- the shared ECR repo (immutable tags),
- the GitHub OIDC provider,
- one IAM deploy role per environment, trusting `repo:<org>/<repo>:*`.

```
GITHUB_ORG=jpj-youtube-ai GITHUB_REPO=nbcc bash scripts/bootstrap-aws.sh
```

> The script's repo default is `charity-site` — pass `GITHUB_REPO=nbcc` or the
> OIDC trust won't match this repo. On Windows the IAM-role step needs a tweak
> (it passes a `/tmp` path to the Windows AWS CLI); create the roles manually if
> it fails there.

Then in GitHub repo settings: create Environments `staging` and `production`, set
a variable `AWS_ROLE_ARN` on each to the printed role ARN, and add required
reviewers to `production` (the prod approval gate — needs a public repo or a paid
plan to be available).

## Provisioning (apply)

Infra is **never** applied on a normal push. Apply it deliberately via the
**Infra** workflow:

- GitHub → Actions → **Infra** → Run workflow → environment + `apply`. Do
  **staging** first, then **production**.
- On pull requests that touch `infra/**`, the same workflow runs `plan` for both
  envs so you review the diff.
- Because the `apply` job runs in `environment: production`, a prod apply also
  waits on the **same required-reviewer gate** as a prod deploy.

On the very first apply, the ECS service comes up on a placeholder image and is
unhealthy until the first real deploy.

CLI fallback: `cd infra/envs/staging && terraform init && terraform apply`.

## HTTPS & DNS (production: nbcc.scot)

HTTPS is provisioned in `infra/modules/app/dns.tf` and gated on the `domain_name`
module input. Staging leaves it empty → **HTTP-only** (port-80 listener, no zone/cert,
no change). Production sets `domain_name = "nbcc.scot"` (`infra/envs/production/main.tf`),
which provisions: a Route 53 hosted zone, a DNS-validated ACM cert (`nbcc.scot` +
`www.nbcc.scot`, auto-renewing), a 443 listener, an 80→443 redirect, and apex/www
`A`-alias records to the ALB (an alias, not a CNAME — the apex can't be a CNAME).

The zone also carries the **ported Google Workspace email records** so mail keeps
working after delegation: MX `1 smtp.google.com`, the apex `google-site-verification`
TXT, and the `google._domainkey` DKIM TXT (from `var.google_dkim_txt`).

**Cutover — delegation ordering matters (chicken-and-egg):** the ACM cert is DNS-
validated in the new Route 53 zone, but the domain still points at Freeola until you
delegate, so on the **first apply** `aws_acm_certificate_validation` *waits*.

1. Trigger the **Infra** `apply` for production (approve the prod gate). It creates the
   zone and starts waiting on cert validation.
2. Read the nameservers: `cd infra/envs/production && terraform output route53_nameservers`.
3. In Freeola, set nbcc.scot's nameservers to those **4** (replace `ns3/ns4.freeola.net`).
   Do **not** do this before step 1 — the zone must exist first or the domain goes dark.
4. Once delegation propagates (usually minutes), ACM validates and the apply completes.
   If it timed out, just re-run the `apply`.
5. **Verify** after propagation:
   ```bash
   dig +short nbcc.scot                       # → ALB (alias) addresses
   dig +short TXT google._domainkey.nbcc.scot # → must match Google Admin DKIM exactly
   dig +short MX nbcc.scot                     # → 1 smtp.google.com
   curl -I https://nbcc.scot/health            # → 200 over TLS; http:// 301s to https
   ```
   ⚠️ DKIM: confirm the `google_dkim_txt` value matches Google Admin (Gmail → Authenticate
   email) exactly — one wrong char breaks signing. There is currently **no SPF/DMARC**
   record on the domain (none existed at Freeola); add `v=spf1 include:_spf.google.com ~all`
   if you want stricter deliverability.

Follow-up (separate change): once live, point the app's public URLs at the real domain
— `stripe_success_url` / `stripe_cancel_url` module inputs and the `PORTAL_BASE_URL` /
`DECLARATION_FORM_BASE_URL` config (still the `example.org` placeholder).

## Deploy & promote (the app, not infra)

Build-once, promote-the-same-artifact:

1. **Merge to `main`** → `deploy-staging.yml`: builds the image tagged by commit
   SHA, pushes to the shared ECR, reads infra wiring via `terraform output`,
   registers a new task-def revision (image swap only), runs DB migrations as a
   one-off Fargate task, then bootstraps the `stories` database and runs its own
   migrations the same way (`bootstrap:stories` then `migrate:stories` — see
   **My Story: the separate `stories` database** above) — all **before** the
   service update — rolls the ECS service (`wait services-stable`), smoke-tests
   `/health`, runs unit + BDD against the live staging ALB, then tags a release.
2. **Staging success** triggers `deploy-prod.yml` (via `workflow_run`), which
   **pauses on the production approval gate**, then deploys the *same image by
   SHA* to prod and smoke-tests it. No rebuild.
3. **On-demand promotion**: `deploy-prod.yml` also accepts `workflow_dispatch`
   with an `image_sha` input, to promote a specific already-validated image:
   `gh workflow run deploy-prod.yml -f image_sha=<sha>` (then approve the gate).

Migrations run as a separate task *before* the service updates (never on app
boot — that would race across tasks). Follow **expand-contract**: the migration
that ships with a code change is additive only; destructive cleanup ships a later
release. Rollback is automatic — the ECS deployment circuit breaker reverts to the
last healthy task set, and a failed smoke/BDD step stops the pipeline before it
promotes.

## Common operations

```bash
# Get an environment's URL
cd infra/envs/staging && terraform init && terraform output -raw alb_dns_name
#   → open http://<that-dns>/   (/health for the health check)

# Tail the app/migration logs  (run from PowerShell on Windows — see gotchas)
aws logs tail /ecs/charity-site-staging --since 30m --region eu-west-2 --format short

# Promote a validated build to prod on demand, then approve the gate in Actions
gh workflow run deploy-prod.yml -f image_sha=<commit-sha>

# Pause costs for an environment (destroys it; prod takes a final snapshot)
cd infra/envs/staging && terraform destroy
```

## Gotchas

- **ECR is immutable.** Re-running a *failed* deploy on the same commit SHA fails
  at `docker push` (the tag already exists). Delete the orphaned tag
  (`aws ecr batch-delete-image --repository-name charity-site --image-ids
  imageTag=<sha>`) and re-run, or promote via a new SHA / `workflow_dispatch`.
- **TLS to RDS is mandatory** — keep `sslmode=no-verify` on `DATABASE_URL` (or
  upgrade to `verify-full` with the RDS CA bundle for stricter security).
- **CI owns the running image + scale.** The ECS service ignores changes to
  `task_definition` and `desired_count`, so Terraform won't clobber a deploy.
  Change the image via a deploy, not an `apply`.
- **The prod gate also gates infra applies.** Approving a prod infra change is the
  same "Review deployments → Approve" step as a prod deploy.
- **Security follow-ups before real traffic:** delete any root access key used for
  bootstrap; tighten the bootstrap deploy roles (they ship with PowerUser +
  IAMFullAccess); add an HTTPS (443) listener + ACM cert once you have a domain.
```
