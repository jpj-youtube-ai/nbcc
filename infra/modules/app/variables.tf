variable "project" { type = string }
variable "environment" { type = string }
variable "region" { type = string }

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "public_subnet_cidrs" {
  type    = list(string)
  default = ["10.20.1.0/24", "10.20.2.0/24"]
}

variable "db_subnet_cidrs" {
  type    = list(string)
  default = ["10.20.101.0/24", "10.20.102.0/24"]
}

# Placeholder image used only for the FIRST apply. CI owns the running image
# after that (the service ignores task_definition changes), so this is never
# overridden and just lets the service resource be created.
variable "container_image" {
  type    = string
  default = "public.ecr.aws/nginx/nginx:stable"
}

variable "app_port" {
  type    = number
  default = 3000
}

variable "task_cpu" {
  type    = number
  default = 256
}

variable "task_memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "external_api_base_url" {
  type    = string
  default = "https://sandbox.api-one.example"
}

# Stripe redirect URLs (REQ-028/REQ-029) — non-secret, injected via the task-def
# environment block. Placeholder defaults use the REQ-033 placeholder domain;
# override per env (or once the real domain lands) in infra/envs/*/main.tf.
variable "stripe_success_url" {
  type    = string
  default = "https://www.example.org/donate/thank-you"
}

variable "stripe_cancel_url" {
  type    = string
  default = "https://www.example.org/donate"
}

# Stripe PUBLISHABLE key (TASK-215) for Embedded Checkout — the `pk_test_…`/`pk_live_…` the browser
# needs to construct Stripe.js. PUBLIC, not a secret (it ships to every donor's browser), so it is a
# plain task-def environment value (like the redirect URLs), NOT an SSM SecureString and NOT in the
# exec_secrets IAM policy. Placeholder default; set the real per-env key in infra/envs/*/main.tf.
variable "stripe_publishable_key" {
  type    = string
  default = "pk_test_replace_me"
}

# Optional Stripe Product id (prod_…) to group one-off donations under. Non-secret;
# empty by default (the app then names an inline product). Set per env in
# infra/envs/*/main.tf when a donation product exists.
variable "stripe_donation_product" {
  type    = string
  default = ""
}

# Per-environment toggles (staging vs prod).
variable "multi_az" {
  type    = bool
  default = false
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "skip_final_snapshot" {
  type    = bool
  default = true
}

# Days of automated RDS backups to retain (daily snapshots + point-in-time
# recovery), stored in AWS-managed backup storage. 1-35; 0 disables backups.
# Default 7 (staging); production caps at 5 in infra/envs/production/main.tf.
variable "backup_retention_days" {
  type    = number
  default = 7

  validation {
    condition     = var.backup_retention_days >= 1 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be between 1 and 35 (0 disables backups; not allowed here)."
  }
}

# Public HTTPS domain (REQ-034). Empty => HTTP-only: staging keeps the port-80
# listener and provisions no Route53 zone / ACM cert (zero change). Set to the real
# apex domain in the env root (e.g. "nbcc.scot") to provision a Route53 hosted zone,
# a DNS-validated ACM cert (apex + www), a 443 listener, an 80->443 redirect and
# apex/www alias records to the ALB. See dns.tf.
variable "domain_name" {
  type    = string
  default = ""
}

# Subdomain mode (see dns.tf): when set, the module does NOT create a Route53 zone — it
# adds the cert-validation + A-alias records into this EXISTING parent zone (already
# delegated). Used by staging (domain_name = "staging.nbcc.scot", parent_zone_id = the
# nbcc.scot zone id). Empty => apex mode: the module creates + owns the zone (production).
variable "parent_zone_id" {
  type    = string
  default = ""
}

# DKIM public-key TXT value for Google Workspace mail on `domain_name`
# (google._domainkey). Ported from the existing DNS so email keeps signing after the
# zone is delegated to Route53. Non-secret (it is a PUBLIC key). VERIFY this exact
# string against Google Admin -> Apps -> Google Workspace -> Gmail -> Authenticate
# email before relying on it — one wrong char breaks DKIM. Only used when
# domain_name is set. Empty => the DKIM record is skipped.
variable "google_dkim_txt" {
  type    = string
  default = ""
}

# From/Reply-To address for the admin newsletter (TASK-161/REQ-069). Non-secret; injected via
# the task-def secrets list like ADMIN_NOTIFICATION_EMAIL. Override per env in
# infra/envs/*/main.tf if needed.
variable "newsletter_from_email" {
  description = "From/Reply-To address for the admin newsletter"
  type        = string
  default     = "newsletter@nbcc.scot"
}

# From/Reply-To for donor thank-you letters (TASK-165/REQ-069). Held in SSM and injected via the
# task-def secrets list like newsletter_from_email. Override per env in infra/envs/*/main.tf if needed.
variable "giving_from_email" {
  description = "From/Reply-To address for donor thank-you letters"
  type        = string
  default     = "giving@nbcc.scot"
}
