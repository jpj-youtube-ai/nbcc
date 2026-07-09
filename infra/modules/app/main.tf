terraform {
  required_version = ">= 1.6"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.0" }
  }
}

locals {
  name = "${var.project}-${var.environment}"
}

data "aws_availability_zones" "available" {
  state = "available"
}

# --- Networking ---------------------------------------------------------------
# COST DECISION: tasks run in PUBLIC subnets with a public IP and NO NAT gateway.
# Saves ~£25-30/mo. Safe because the security groups (alb.tf) allow inbound to
# the tasks ONLY from the ALB; the public IP is purely for egress (external API
# calls + ECR/SSM pulls). RDS sits in isolated DB subnets, reachable only by tasks.
# To go private+NAT: set enable_nat_gateway = true, add private_subnets, move the
# ECS service into them, set assign_public_ip = false (ecs.tf).
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = local.name
  cidr = var.vpc_cidr
  azs  = slice(data.aws_availability_zones.available.names, 0, 2)

  public_subnets   = var.public_subnet_cidrs
  database_subnets = var.db_subnet_cidrs

  create_database_subnet_group       = true
  create_database_subnet_route_table = true
  enable_nat_gateway                 = false
  enable_dns_hostnames               = true
}

# --- Logs ---------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name}"
  retention_in_days = 30
}

# --- Secrets ------------------------------------------------------------------
# DB password generated here, stored in SSM. NOTE: it lands in TF state, so keep
# state in a locked, encrypted S3 bucket. If you'd rather it never touch state,
# set manage_master_user_password = true on the RDS instance (rds.tf) instead.
resource "random_password" "db" {
  length  = 24
  special = false
}

resource "aws_ssm_parameter" "db_url" {
  name  = "/${var.project}/${var.environment}/DATABASE_URL"
  type  = "SecureString"
  # sslmode=no-verify: RDS enforces TLS (rds.force_ssl=1), so connect encrypted.
  # no-verify encrypts without requiring the RDS CA bundle in the image. The pg
  # client AND node-pg-migrate both parse this from the URL. (Local dev uses a
  # plain URL with no sslmode, so docker Postgres still connects plaintext.)
  value = "postgres://app:${random_password.db.result}@${aws_db_instance.app.address}:5432/charity?sslmode=no-verify"
}

# My Story submissions (TASK-B2/REQ intent: "Persist My Story submissions to a
# dedicated stories database..."). A SEPARATE database on the same RDS instance,
# with its own name (`stories`) and its own role (`stories_app`) — never the
# `charity` DB's `app` master user. Terraform has no `postgresql` provider wired
# here and RDS is private, so it can only generate the credential + publish it;
# the database and role are created imperatively by scripts/bootstrap-stories-db.mjs
# (run as a one-off ECS task in the deploy workflow, BEFORE migrate:stories).
resource "random_password" "stories" {
  length  = 24
  special = false
}

resource "aws_ssm_parameter" "stories_db_url" {
  name  = "/${var.project}/${var.environment}/STORIES_DATABASE_URL"
  type  = "SecureString"
  # Same sslmode=no-verify requirement as db_url above (RDS enforces TLS). The
  # bootstrap script and node-pg-migrate (migrate:stories) both parse this URL.
  value = "postgres://stories_app:${random_password.stories.result}@${aws_db_instance.app.address}:5432/stories?sslmode=no-verify"
}

# App / third-party secrets: placeholders. Set REAL values out of band:
#   aws ssm put-parameter --name /charity-site/staging/EXTERNAL_API_ONE_KEY \
#     --type SecureString --value 'real-key' --overwrite
resource "aws_ssm_parameter" "api_one_key" {
  name  = "/${var.project}/${var.environment}/EXTERNAL_API_ONE_KEY"
  type  = "SecureString"
  value = "REPLACE_ME"
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "api_two_key" {
  name  = "/${var.project}/${var.environment}/EXTERNAL_API_TWO_KEY"
  type  = "SecureString"
  value = "REPLACE_ME"
  lifecycle { ignore_changes = [value] }
}

# Stripe (REQ-028/REQ-029). The secret key is a SecureString; the four recurring
# price IDs are non-secret Strings but still env-specific, so they live in SSM and
# are injected the same way (and so need the same exec-role read grant, ecs.tf).
# Real values set out of band (see the put-parameter example above), so the apply
# never overwrites them: lifecycle ignore_changes = [value].
resource "aws_ssm_parameter" "stripe_secret_key" {
  name  = "/${var.project}/${var.environment}/STRIPE_SECRET_KEY"
  type  = "SecureString"
  value = "REPLACE_ME"
  lifecycle { ignore_changes = [value] }
}

# Stripe webhook signing secret (REQ-036/TASK-046) — verifies inbound webhook
# signatures. A SecureString like the API key; real value set out of band.
resource "aws_ssm_parameter" "stripe_webhook_secret" {
  name  = "/${var.project}/${var.environment}/STRIPE_WEBHOOK_SECRET"
  type  = "SecureString"
  value = "REPLACE_ME"
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "stripe_price_bronze" {
  name  = "/${var.project}/${var.environment}/STRIPE_PRICE_BRONZE"
  type  = "String"
  value = "REPLACE_ME"
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "stripe_price_silver" {
  name  = "/${var.project}/${var.environment}/STRIPE_PRICE_SILVER"
  type  = "String"
  value = "REPLACE_ME"
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "stripe_price_gold" {
  name  = "/${var.project}/${var.environment}/STRIPE_PRICE_GOLD"
  type  = "String"
  value = "REPLACE_ME"
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "stripe_price_platinum" {
  name  = "/${var.project}/${var.environment}/STRIPE_PRICE_PLATINUM"
  type  = "String"
  value = "REPLACE_ME"
  lifecycle { ignore_changes = [value] }
}

# Contact form forwarding endpoint (REQ-030). A SecureString — it authorises form
# submissions. The placeholder is a VALID `.example` URL (not REPLACE_ME) so the
# app's URL validation passes on a fresh apply; the contact client treats a
# `.example` host as unconfigured and stubs the forward outside production until a
# real URL is set out of band. Set the real value with put-parameter (see README).
resource "aws_ssm_parameter" "contact_forward_url" {
  name  = "/${var.project}/${var.environment}/CONTACT_FORWARD_URL"
  type  = "SecureString"
  value = "https://forward.example/replace-me"
  lifecycle { ignore_changes = [value] }
}

# Transactional email send endpoint (TASK-070). A SecureString — it authorises
# sends. The placeholder is a VALID `.example` URL (not REPLACE_ME) so the app's URL
# validation passes on a fresh apply; the email client treats a `.example` host as
# unconfigured and stubs the send outside production until a real URL is set out of
# band. Set the real value with put-parameter (see README).
resource "aws_ssm_parameter" "email_send_url" {
  name  = "/${var.project}/${var.environment}/EMAIL_SEND_URL"
  type  = "SecureString"
  value = "https://email.example/replace-me"
  lifecycle { ignore_changes = [value] }
}

# Declaration form base URL (TASK-075). NOT a secret (it ships in the in-person
# confirmation email + QR), but SSM-held and injected like the price IDs so it varies
# per environment. A plain String; the placeholder is a valid URL so app URL validation
# passes on a fresh apply. Set the real public site URL with put-parameter (see README).
resource "aws_ssm_parameter" "declaration_form_base_url" {
  name  = "/${var.project}/${var.environment}/DECLARATION_FORM_BASE_URL"
  type  = "String"
  value = "https://nbcc.example"
  lifecycle { ignore_changes = [value] }
}

# Admin notification recipient (TASK-092). NOT a secret (an internal inbox), but SSM-held and
# injected like DECLARATION_FORM_BASE_URL so it varies per environment. A plain String; the
# placeholder is a valid email so app validation passes on a fresh apply. Set the real inbox
# with put-parameter (see README).
resource "aws_ssm_parameter" "admin_notification_email" {
  name  = "/${var.project}/${var.environment}/ADMIN_NOTIFICATION_EMAIL"
  type  = "String"
  value = "admin@nbcc.example"
  lifecycle { ignore_changes = [value] }
}

# Donor portal base URL (TASK-100). NOT a secret (it ships in the magic-link email), but SSM-held
# and injected like DECLARATION_FORM_BASE_URL so it varies per environment. A plain String; the
# placeholder is a valid URL so app validation passes on a fresh apply. Set the real public site URL
# with put-parameter (see README).
resource "aws_ssm_parameter" "portal_base_url" {
  name  = "/${var.project}/${var.environment}/PORTAL_BASE_URL"
  type  = "String"
  value = "https://nbcc.example"
  lifecycle { ignore_changes = [value] }
}

# Admin session token signing key (TASK-105/REQ-062) — HMAC key the admin login
# endpoint signs session tokens with. A SecureString like the Stripe secrets; the
# real long random value is set out of band (ignore_changes keeps Terraform from
# overwriting it).
resource "aws_ssm_parameter" "admin_session_secret" {
  name  = "/${var.project}/${var.environment}/ADMIN_SESSION_SECRET"
  type  = "SecureString"
  value = "REPLACE_ME"
  lifecycle { ignore_changes = [value] }
}

# From/Reply-To address for the admin newsletter (TASK-161/REQ-069). NOT a secret (it ships in
# the email headers), but SSM-held and injected like ADMIN_NOTIFICATION_EMAIL so it varies per
# environment. A plain String; the value is the real production address.
resource "aws_ssm_parameter" "newsletter_from_email" {
  name  = "/${var.project}/${var.environment}/NEWSLETTER_FROM_EMAIL"
  type  = "String"
  value = var.newsletter_from_email
}

# From/Reply-To address for donor thank-you letters (TASK-165/REQ-069). NOT a secret (it ships in
# the email headers), but SSM-held and injected like newsletter_from_email so it varies per
# environment. A plain String; the value is the real giving inbox address.
resource "aws_ssm_parameter" "giving_from_email" {
  name  = "/${var.project}/${var.environment}/GIVING_FROM_EMAIL"
  type  = "String"
  value = var.giving_from_email
}
