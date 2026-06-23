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
  value = "postgres://app:${random_password.db.result}@${aws_db_instance.app.address}:5432/charity"
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
