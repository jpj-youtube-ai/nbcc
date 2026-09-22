# --- Nightly off-site backup (TASK-423) ---------------------------------------
#
# Two destinations, because they defend against different things. This file builds the AWS one: a
# WRITE-ONCE bucket that restores quickly and holds seven years of monthly copies for HMRC. The
# other is Google Drive, which the job writes directly and which survives losing this account
# altogether. Neither alone is sufficient.
#
# The schedule mirrors scheduler.tf exactly: an EventBridge Scheduler firing a one-off Fargate task
# on the app's own task definition with the container command overridden. Same shape the deploy
# uses for migrations.

locals {
  backup_bucket_name  = "${local.name}-backups-${data.aws_caller_identity.current.account_id}"
  backup_task_def_arn = "arn:aws:ecs:${var.region}:${data.aws_caller_identity.current.account_id}:task-definition/${local.name}"
}

# --- the bucket ---------------------------------------------------------------
#
# object_lock_enabled CANNOT be turned on after creation. Getting it wrong here means destroying
# and recreating the bucket later, which is exactly the operation the lock exists to prevent.
resource "aws_s3_bucket" "backups" {
  bucket              = local.backup_bucket_name
  object_lock_enabled = true

  tags = {
    Purpose = "Nightly database and website backups. Write-once: see the object lock below."
  }
}

# Required by Object Lock, and the reason an overwrite cannot destroy history.
resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration {
    status = "Enabled"
  }
}

# COMPLIANCE, not GOVERNANCE, and the distinction is the whole point.
#
# GOVERNANCE can be overridden by a principal holding s3:BypassGovernanceRetention — which a
# compromised or mistaken administrator plausibly has, and they are precisely the threat this is
# for. Under COMPLIANCE nobody can delete or alter an object before its retention expires. Not an
# admin, not the root account, not AWS support.
#
# The cost of that is real and worth stating: a file written here is immovable for 35 days, so a
# runaway job would be paid for in full. At a few megabytes a night that is pennies, which is why
# the stronger mode is affordable here and would not be everywhere.
resource "aws_s3_bucket_object_lock_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = 35
    }
  }

  depends_on = [aws_s3_bucket_versioning.backups]
}

# SSE-S3 rather than KMS: the archive arrives already encrypted with AES-256 by 7-Zip, so this is
# defence in depth rather than the primary control, and KMS would add per-request cost and a key
# whose loss would be another way to lose the backups.
resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Daily for 35 days, then cheap storage, then gone at seven years.
#
# Seven years is not arbitrary: HMRC requires Gift Aid declarations and claim records to be kept
# for six years after the accounting period they relate to, and seven clears that with a margin.
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "age-out-to-glacier-then-expire"
    status = "Enabled"

    filter {
      prefix = "archives/"
    }

    # Glacier Instant Retrieval: far cheaper to hold, still readable in milliseconds. A restore
    # that needs a twelve-hour thaw is a restore nobody performs.
    transition {
      days          = 35
      storage_class = "GLACIER_IR"
    }

    expiration {
      days = 2555 # seven years
    }

    noncurrent_version_expiration {
      noncurrent_days = 35
    }
  }

  depends_on = [aws_s3_bucket_versioning.backups]
}

# --- the archive passphrase ----------------------------------------------------
#
# The ONLY secret this feature has, now that Google auth is keyless.
#
# ignore_changes on value because the real passphrase is pasted in by hand, once, from the
# charity's password manager. Terraform must never see it, never store it in state, and never
# overwrite it on a later apply.
#
# A copy MUST also live outside AWS. An archive whose only passphrase is in the account we just
# lost is an unopenable file in exactly the disaster it exists for.
resource "aws_ssm_parameter" "backup_archive_passphrase" {
  name  = "/${var.project}/${var.environment}/BACKUP_ARCHIVE_PASSPHRASE"
  type  = "SecureString"
  value = "REPLACE-ME-FROM-THE-PASSWORD-MANAGER"

  lifecycle {
    ignore_changes = [value]
  }
}

# --- what the backup task may do ----------------------------------------------
#
# Scoped to this bucket and nothing else. Note the absence of s3:DeleteObject: the job has no
# business deleting anything here, and Object Lock would refuse it anyway. Pruning happens on
# Drive, where 35 days of immutability would be unhelpful.
data "aws_iam_policy_document" "task_backups" {
  statement {
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.backups.arn}/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.backups.arn]
  }
}

resource "aws_iam_role_policy" "task_backups" {
  name   = "${local.name}-backups"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_backups.json
}

# --- the schedule --------------------------------------------------------------
data "aws_iam_policy_document" "backup_scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup_scheduler" {
  name               = "${local.name}-backup-sched"
  assume_role_policy = data.aws_iam_policy_document.backup_scheduler_assume.json
}

data "aws_iam_policy_document" "backup_scheduler" {
  statement {
    actions = ["ecs:RunTask"]
    resources = [
      "${local.backup_task_def_arn}:*",
      local.backup_task_def_arn,
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

resource "aws_iam_role_policy" "backup_scheduler" {
  role   = aws_iam_role.backup_scheduler.id
  policy = data.aws_iam_policy_document.backup_scheduler.json
}

resource "aws_scheduler_schedule" "backup" {
  name        = "${local.name}-nightly-backup"
  description = "Nightly dump of all three databases plus the site, to S3 and Google Drive. TASK-423."

  flexible_time_window {
    mode = "OFF"
  }

  # 02:00 UK. Deliberately not 08:00 like the reminders job: a dump holds read locks briefly and
  # there is no reason for the two to contend, and 2am is the quietest the site gets.
  schedule_expression          = "cron(0 2 * * ? *)"
  schedule_expression_timezone = "Europe/London"

  target {
    arn      = aws_ecs_cluster.app.arn
    role_arn = aws_iam_role.backup_scheduler.arn

    ecs_parameters {
      task_definition_arn = local.backup_task_def_arn
      launch_type         = "FARGATE"
      task_count          = 1

      network_configuration {
        subnets          = module.vpc.public_subnets
        security_groups  = [aws_security_group.task.id]
        assign_public_ip = true
      }
    }

    input = jsonencode({
      containerOverrides = [{
        name    = "app"
        command = ["sh", "-c", "npm run backup"]
      }]
    })
  }
}

# --- noticing that it stopped ---------------------------------------------------
#
# The app emails on failures it detects. It cannot email about a run that never happened: if the
# task fails to start, or dies before reaching its own error handling, nothing in that process is
# alive to complain. That is the failure mode that actually kills backups — they stop in February
# and are discovered in November — so it is watched from outside.
#
# The job prints BACKUP_OK on success. This counts those, and the alarm fires when the count is
# missing, which is what "nothing ran" looks like.
resource "aws_cloudwatch_log_metric_filter" "backup_ok" {
  name           = "${local.name}-backup-ok"
  log_group_name = aws_cloudwatch_log_group.app.name
  pattern        = "BACKUP_OK"

  metric_transformation {
    name      = "BackupSucceeded"
    namespace = "NBCC/Backups"
    value     = "1"
  }
}

resource "aws_sns_topic" "backup_alarms" {
  name = "${local.name}-backup-alarms"
}

# The subscription must be CONFIRMED by clicking a link in an email AWS sends on apply. Until that
# happens the alarm fires into nothing, so this is a required manual step, not an optional one.
resource "aws_sns_topic_subscription" "backup_alarms_email" {
  count     = var.backup_alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.backup_alarms.arn
  protocol  = "email"
  endpoint  = var.backup_alarm_email
}

resource "aws_cloudwatch_metric_alarm" "backup_missing" {
  alarm_name        = "${local.name}-backup-has-not-run"
  alarm_description = "No successful NBCC backup in 48 hours. Either the nightly task is not running, or it is failing before it can report."

  namespace           = "NBCC/Backups"
  metric_name         = "BackupSucceeded"
  statistic           = "Sum"
  period              = 86400 # a day
  evaluation_periods  = 2     # two of them: one missed night is noise, two is a problem
  threshold           = 1
  comparison_operator = "LessThanThreshold"

  # The crux. By default a metric with NO data is treated as insufficient and the alarm stays
  # quiet — which would mean a backup that never ran at all, producing no data points whatsoever,
  # is the one case that never alerts. Missing data IS the emergency here.
  treat_missing_data = "breaching"

  alarm_actions = [aws_sns_topic.backup_alarms.arn]
  ok_actions    = [aws_sns_topic.backup_alarms.arn]
}
