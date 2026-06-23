# --- IAM ----------------------------------------------------------------------
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
    ]

    # ECS resolves these from SSM at task start and injects them as env vars, so
    # the app reads process.env exactly as it does locally - no AWS SDK in the
    # config path. CI inherits this block when it swaps only the image.
    secrets = [
      { name = "DATABASE_URL", valueFrom = aws_ssm_parameter.db_url.arn },
      { name = "EXTERNAL_API_ONE_KEY", valueFrom = aws_ssm_parameter.api_one_key.arn },
      { name = "EXTERNAL_API_TWO_KEY", valueFrom = aws_ssm_parameter.api_two_key.arn },
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
