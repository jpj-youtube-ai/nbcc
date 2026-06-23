#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# ONE-TIME AWS bootstrap. Run by an admin with broad IAM perms BEFORE any
# GitHub Actions workflow can deploy. Solves the chicken-and-egg problem:
# CI assumes an IAM role via OIDC and stores Terraform state in S3 - both of
# which must exist first.
#
# Creates:
#   - Terraform state bucket (versioned, encrypted, public access blocked)
#   - Shared ECR repo (build-once: both envs pull the same image by SHA)
#   - GitHub OIDC provider
#   - One IAM role per environment, trusting your repo
#
# Usage:
#   GITHUB_ORG=your-org GITHUB_REPO=charity-site ./scripts/bootstrap-aws.sh
# ---------------------------------------------------------------------------
set -euo pipefail

PROJECT="${PROJECT:-charity-site}"
REGION="${REGION:-eu-west-2}"
GITHUB_ORG="${GITHUB_ORG:?set GITHUB_ORG (your GitHub org or user)}"
GITHUB_REPO="${GITHUB_REPO:-charity-site}"
STATE_BUCKET="${STATE_BUCKET:-${PROJECT}-tfstate}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"

echo "== Terraform state bucket: ${STATE_BUCKET}"
aws s3api create-bucket --bucket "$STATE_BUCKET" --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION" 2>/dev/null || true
aws s3api put-bucket-versioning --bucket "$STATE_BUCKET" \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$STATE_BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket "$STATE_BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

echo "== Shared ECR repo: ${PROJECT}"
aws ecr create-repository --repository-name "$PROJECT" --region "$REGION" \
  --image-tag-mutability IMMUTABLE \
  --image-scanning-configuration scanOnPush=true 2>/dev/null || true

echo "== GitHub OIDC provider"
OIDC_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
fi

create_role () {
  local ENV="$1"
  local ROLE="${PROJECT}-gha-${ENV}"
  echo "== IAM role: ${ROLE}"
  cat > "/tmp/trust-${ENV}.json" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "${OIDC_ARN}" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": "repo:${GITHUB_ORG}/${GITHUB_REPO}:*" }
    }
  }]
}
JSON
  aws iam create-role --role-name "$ROLE" \
    --assume-role-policy-document "file:///tmp/trust-${ENV}.json" 2>/dev/null \
    || aws iam update-assume-role-policy --role-name "$ROLE" \
         --policy-document "file:///tmp/trust-${ENV}.json"

  # WARNING: PowerUserAccess + IAMFullAccess is broad. It lets Terraform create
  # everything in this baseline, but you should replace it with a scoped policy
  # (only the ECS/ECR/RDS/SSM/VPC/IAM actions you actually use) before prod.
  aws iam attach-role-policy --role-name "$ROLE" \
    --policy-arn arn:aws:iam::aws:policy/PowerUserAccess || true
  aws iam attach-role-policy --role-name "$ROLE" \
    --policy-arn arn:aws:iam::aws:policy/IAMFullAccess || true

  echo "   ARN: arn:aws:iam::${ACCOUNT_ID}:role/${ROLE}"
}

create_role staging
create_role production

cat <<DONE

Done. Next, in GitHub (repo Settings):
  1. Create Environments 'staging' and 'production'.
     Add required reviewers to 'production' for the deploy approval gate.
  2. On each environment, set a variable named AWS_ROLE_ARN to the matching
     role ARN printed above.
  3. If you changed STATE_BUCKET, update bucket = "..." in infra/envs/*/backend.tf.

Then: provision infra (Actions -> Infra -> Run workflow -> staging -> apply),
push to main, and the staging pipeline takes over.
DONE
