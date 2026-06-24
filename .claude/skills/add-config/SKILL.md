---
name: add-config
description: Use when adding or changing an application config value, environment variable, API key, or secret for the nbcc service. Covers wiring the value through every required place — the Zod schema, .env.example, the SSM parameter, the ECS task definition, and (for secrets) the exec IAM policy — so it doesn't half-land (golden rule 3).
---

# Add a config value or secret

## Overview

A config value in nbcc must be added in **every** place below or it silently
breaks: the app fails validation, or worse, the ECS task won't start ("a new
secret must be added in three places or the task won't start"). This skill is
the checklist + templates. Decide first: is it a plain **value** or a **secret**?
Secrets get one extra step (IAM) and never appear as a literal anywhere.

## Steps (create a todo per item)

1. **Zod schema** — `src/config/schema.ts`, inside `configSchema`. Pick the
   right validator and default.
2. **`.env.example`** — add the key with a safe sample value (never a real
   secret; `.env` itself is gitignored).
3. **SSM parameter** — `infra/modules/app/main.tf`. A plain `String` param for a
   value; a `SecureString` for a secret.
4. **Task definition** — `infra/modules/app/ecs.tf`: add to the container
   `environment` block (plain value) **or** the `secrets` block (secret).
5. **Secrets only — IAM** — add the param's ARN to the `exec_secrets` policy
   resource list in `infra/modules/app/ecs.tf`, or the exec role can't read it.
6. **Verify** — `npm run lint && npm run build`, and `grep -rn "process.env"
   src/` to confirm nothing reads the value outside `src/config/`.

## Templates

**`src/config/schema.ts`** (add inside the `z.object({ ... })`):
```ts
// plain value with a default
FEATURE_TIMEOUT_MS: z.coerce.number().default(5000),
// required string (e.g. a base URL)
EXTERNAL_API_THREE_BASE_URL: z.string().url(),
// secret — required, non-empty, NEVER given a default
EXTERNAL_API_THREE_KEY: z.string().min(1),
```

**`.env.example`**:
```bash
EXTERNAL_API_THREE_BASE_URL=https://sandbox.api-three.example
EXTERNAL_API_THREE_KEY=local-dummy-key
```

**`infra/modules/app/main.tf`** (SSM param — match the style already in the file):
```hcl
resource "aws_ssm_parameter" "external_api_three_key" {
  name  = "/${var.env}/charity/EXTERNAL_API_THREE_KEY"
  type  = "SecureString"          # "String" for a non-secret value
  value = var.external_api_three_key
}
```

**`infra/modules/app/ecs.tf`** — secret goes in `secrets`, plain value in `environment`:
```hcl
# in the container definition "secrets" list:
{ name = "EXTERNAL_API_THREE_KEY", valueFrom = aws_ssm_parameter.external_api_three_key.arn },

# AND in the exec_secrets IAM policy "Resource" list:
aws_ssm_parameter.external_api_three_key.arn,
```

## Read config the right way

Read the value via the config module, never `process.env` directly:
```ts
import { config } from "../config";
const key = config.EXTERNAL_API_THREE_KEY;
```

## Common mistakes

- **Secret with a Zod `.default()`** — defaults mask a missing secret; secrets
  must be required (`.min(1)`).
- **Forgetting step 5** — value/secret added everywhere but the IAM policy → the
  ECS task fails to start with an SSM access-denied error.
- **Dropping `sslmode`** — if the value is a Postgres URL, RDS enforces TLS; keep
  `sslmode=no-verify` (assembled in `main.tf`).
- **A real secret in `.env.example` or Terraform** — only SSM references hold
  real secrets (golden rule 4).

After wiring, the `config-drift-reviewer` subagent can verify all touch-points.
