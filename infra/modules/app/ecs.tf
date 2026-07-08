# --- IAM ----------------------------------------------------------------------
# Account id + region for constructing ARNs of parameters not managed as Terraform
# resources (e.g. the transient ADMIN_BOOTSTRAP_PASSWORD used by the admin-password ops task).
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution role: pulls the image, writes logs, reads injected SSM secrets.
# The ssm:GetParameters + kms:Decrypt statements are THE classic gotcha -
# without them the task fails to start with a secrets error.
resource "aws_iam_role" "execution" {
  name               = "${local.name}-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "exec_secrets" {
  statement {
    actions = ["ssm:GetParameters"]
    resources = [
      aws_ssm_parameter.db_url.arn,
      aws_ssm_parameter.api_one_key.arn,
      aws_ssm_parameter.api_two_key.arn,
      # Stripe (REQ-028/REQ-029): the secret key and the SSM-held price IDs are
      # all injected via valueFrom, so the exec role must be able to read them.
      aws_ssm_parameter.stripe_secret_key.arn,
      aws_ssm_parameter.stripe_webhook_secret.arn,
      aws_ssm_parameter.stripe_price_bronze.arn,
      aws_ssm_parameter.stripe_price_silver.arn,
      aws_ssm_parameter.stripe_price_gold.arn,
      aws_ssm_parameter.stripe_price_platinum.arn,
      # Contact forwarding endpoint (REQ-030): injected via valueFrom, so the exec
      # role must be able to read it.
      aws_ssm_parameter.contact_forward_url.arn,
      # Transactional email send endpoint (TASK-070): injected via valueFrom, so the
      # exec role must be able to read it.
      aws_ssm_parameter.email_send_url.arn,
      # Declaration form base URL (TASK-075): injected via valueFrom, so the exec role
      # must be able to read it.
      aws_ssm_parameter.declaration_form_base_url.arn,
      # Admin notification recipient (TASK-092): injected via valueFrom, so the exec role
      # must be able to read it.
      aws_ssm_parameter.admin_notification_email.arn,
      # Donor portal base URL (TASK-100): injected via valueFrom, so the exec role must read it.
      aws_ssm_parameter.portal_base_url.arn,
      # Admin session signing key (TASK-105): a SecureString injected via valueFrom, so the exec
      # role must be able to read it.
      aws_ssm_parameter.admin_session_secret.arn,
      # Newsletter From/Reply-To address (TASK-161): non-secret String injected via valueFrom, so
      # the exec role must be able to read it.
      aws_ssm_parameter.newsletter_from_email.arn,
      # Admin password bootstrap: a TRANSIENT, operator-managed SecureString (not a Terraform
      # resource and not read by the running service) that the one-off `node dist/ops/set-admin-
      # password.js` ECS task injects as the ADMIN_PASSWORD secret. Granting read here lets that
      # one-off task-def pull it; the operator sets the value with put-parameter before a run and
      # deletes it after, so the parameter usually does not exist (the grant is then harmless).
      "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter/${var.project}/${var.environment}/ADMIN_BOOTSTRAP_PASSWORD",
    ]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = ["*"] # default aws/ssm key; scope to your CMK ARN if you use one
  }
}

resource "aws_iam_role_policy" "exec_secrets" {
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.exec_secrets.json
}

# Task role: the app's OWN runtime AWS permissions. Empty for now - add
# statements only if the app calls AWS APIs (e.g. S3). Keep least-privilege.
resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

# --- ECS ----------------------------------------------------------------------
resource "aws_ecs_cluster" "app" {
  name = local.name
}

resource "aws_ecs_task_definition" "app" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name         = "app"
    image        = var.container_image
    essential    = true
    portMappings = [{ containerPort = var.app_port }]

    environment = [
      { name = "NODE_ENV", value = var.environment },
      { name = "PORT", value = tostring(var.app_port) },
      { name = "EXTERNAL_API_ONE_BASE_URL", value = var.external_api_base_url },
      # Stripe redirect URLs (REQ-028/REQ-029) — non-secret, so plain env values.
      { name = "STRIPE_SUCCESS_URL", value = var.stripe_success_url },
      { name = "STRIPE_CANCEL_URL", value = var.stripe_cancel_url },
      # Optional Stripe donation product id for one-off gifts — non-secret, empty by default.
      { name = "STRIPE_DONATION_PRODUCT", value = var.stripe_donation_product },
    ]

    # ECS resolves these from SSM at task start and injects them as env vars, so
    # the app reads process.env exactly as it does locally - no AWS SDK in the
    # config path. CI inherits this block when it swaps only the image.
    secrets = [
      { name = "DATABASE_URL", valueFrom = aws_ssm_parameter.db_url.arn },
      { name = "EXTERNAL_API_ONE_KEY", valueFrom = aws_ssm_parameter.api_one_key.arn },
      { name = "EXTERNAL_API_TWO_KEY", valueFrom = aws_ssm_parameter.api_two_key.arn },
      # Stripe (REQ-028/REQ-029): the secret key plus the SSM-held price IDs.
      # All are pulled from SSM via valueFrom, so every ARN must also appear in
      # the exec_secrets policy below or the task fails to start.
      { name = "STRIPE_SECRET_KEY", valueFrom = aws_ssm_parameter.stripe_secret_key.arn },
      { name = "STRIPE_WEBHOOK_SECRET", valueFrom = aws_ssm_parameter.stripe_webhook_secret.arn },
      { name = "STRIPE_PRICE_BRONZE", valueFrom = aws_ssm_parameter.stripe_price_bronze.arn },
      { name = "STRIPE_PRICE_SILVER", valueFrom = aws_ssm_parameter.stripe_price_silver.arn },
      { name = "STRIPE_PRICE_GOLD", valueFrom = aws_ssm_parameter.stripe_price_gold.arn },
      { name = "STRIPE_PRICE_PLATINUM", valueFrom = aws_ssm_parameter.stripe_price_platinum.arn },
      # Contact forwarding endpoint (REQ-030): a SecureString, injected like a secret.
      { name = "CONTACT_FORWARD_URL", valueFrom = aws_ssm_parameter.contact_forward_url.arn },
      # Transactional email send endpoint (TASK-070): a SecureString, injected like a secret.
      { name = "EMAIL_SEND_URL", valueFrom = aws_ssm_parameter.email_send_url.arn },
      # Declaration form base URL (TASK-075): non-secret SSM String, injected via valueFrom
      # like the price IDs — so its ARN must also appear in exec_secrets below.
      { name = "DECLARATION_FORM_BASE_URL", valueFrom = aws_ssm_parameter.declaration_form_base_url.arn },
      # Admin notification recipient (TASK-092): non-secret SSM String, injected via valueFrom
      # like DECLARATION_FORM_BASE_URL — so its ARN must also appear in exec_secrets below.
      { name = "ADMIN_NOTIFICATION_EMAIL", valueFrom = aws_ssm_parameter.admin_notification_email.arn },
      # Donor portal base URL (TASK-100): non-secret SSM String, injected via valueFrom — so its
      # ARN must also appear in exec_secrets below.
      { name = "PORTAL_BASE_URL", valueFrom = aws_ssm_parameter.portal_base_url.arn },
      # Admin session signing key (TASK-105): a SecureString, injected like a secret — so its ARN
      # must also appear in exec_secrets above.
      { name = "ADMIN_SESSION_SECRET", valueFrom = aws_ssm_parameter.admin_session_secret.arn },
      # Newsletter From/Reply-To address (TASK-161/REQ-069): non-secret SSM String, injected via
      # valueFrom like PORTAL_BASE_URL — so its ARN must also appear in exec_secrets below.
      { name = "NEWSLETTER_FROM_EMAIL", valueFrom = aws_ssm_parameter.newsletter_from_email.arn },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.app.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "app"
      }
    }
  }])
}

resource "aws_ecs_service" "app" {
  name            = local.name
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.public_subnets
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true # egress without a NAT gateway (see main.tf)
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = var.app_port
  }

  health_check_grace_period_seconds = 30

  # Native rollback: if a new deployment fails health checks, ECS reverts to the
  # last healthy task set. This is the ECS half of the pipeline's
  # "smoke/health check fails -> roll back" arrow.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # CI owns the running image + scale; Terraform owns everything else.
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [aws_lb_listener.http]
}
