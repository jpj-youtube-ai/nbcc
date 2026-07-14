# --- Daily business-supporter reminder scheduler (TASK-222) -------------------
# EventBridge Scheduler fires ONCE A DAY and runs the reminder pass as a one-off Fargate task,
# reusing the app's cluster, task definition, subnets, security group and execution role — the same
# shape as the deploy's one-off migration task, but triggered on a cron instead of on a deploy. The
# container command is overridden to `npm run reminders` (= `node dist/scripts/send-reminders.js`),
# which emails the 5-day / 14-day thank-you nudges to supporters who have not yet chosen how they
# would like to be thanked. The runner is idempotent + safe to fire daily: it advances each record's
# reminder_count only after a successful send, so a re-run never double-sends a stage.
#
# NOTE: this needs an Infra apply to take effect (plan on PR, then a manual `apply` via the Infra
# workflow — it does NOT self-activate on merge, and app deploys never run `terraform apply`). Until
# applied, the daily job simply does not exist; nothing else about the app changes.

# The task definition is referenced by FAMILY (a task-definition ARN with no :revision). ECS RunTask
# resolves that to the LATEST ACTIVE revision at fire time, so the schedule always runs the image CI
# last deployed (carrying every env var + secret), NOT Terraform's placeholder-image revision. This
# mirrors why the deploy's one-off tasks run against the freshly registered revision, not the module's.
locals {
  reminders_task_def_family_arn = "arn:aws:ecs:${var.region}:${data.aws_caller_identity.current.account_id}:task-definition/${local.name}"
}

# Trust policy: EventBridge Scheduler assumes this role to launch the task.
data "aws_iam_policy_document" "reminders_scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "reminders_scheduler" {
  name               = "${local.name}-reminders-sched"
  assume_role_policy = data.aws_iam_policy_document.reminders_scheduler_assume.json
}

# The scheduler may RunTask the app task-def family (any revision) on THIS cluster, and must be able
# to PassRole the task's execution + task roles (RunTask assumes both) — the two classic RunTask grants.
data "aws_iam_policy_document" "reminders_scheduler" {
  statement {
    actions = ["ecs:RunTask"]
    resources = [
      "${local.reminders_task_def_family_arn}:*", # specific revisions (family:revision)
      local.reminders_task_def_family_arn,        # the family itself (latest active)
    ]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.app.arn]
    }
  }
  statement {
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.execution.arn, aws_iam_role.task.arn]
  }
}

resource "aws_iam_role_policy" "reminders_scheduler" {
  role   = aws_iam_role.reminders_scheduler.id
  policy = data.aws_iam_policy_document.reminders_scheduler.json
}

resource "aws_scheduler_schedule" "reminders" {
  name        = "${local.name}-business-reminders"
  description = "Daily business-supporter thank-you reminders (5-day + 14-day nudges), TASK-222."

  # No flexible window: fire at the scheduled time (the pass is cheap and the exact minute is not
  # important, but OFF keeps behaviour predictable).
  flexible_time_window {
    mode = "OFF"
  }

  # Once a day, early morning UK time (a quiet hour; a reminder's exact minute does not matter).
  schedule_expression          = "cron(0 8 * * ? *)"
  schedule_expression_timezone = "Europe/London"

  target {
    arn      = aws_ecs_cluster.app.arn
    role_arn = aws_iam_role.reminders_scheduler.arn

    ecs_parameters {
      task_definition_arn = local.reminders_task_def_family_arn
      launch_type         = "FARGATE"
      task_count          = 1

      # Same networking as the ECS service + the deploy's one-off tasks: public subnets, the task
      # security group, and a public IP for egress (no NAT gateway — see main.tf).
      network_configuration {
        subnets          = module.vpc.public_subnets
        security_groups  = [aws_security_group.task.id]
        assign_public_ip = true
      }
    }

    # Override the container command to run the reminder pass. Mirrors the deploy's containerOverrides
    # shape (["sh","-c","npm run ..."]); `npm run reminders` = `node dist/scripts/send-reminders.js`.
    input = jsonencode({
      containerOverrides = [{
        name    = "app"
        command = ["sh", "-c", "npm run reminders"]
      }]
    })
  }
}
