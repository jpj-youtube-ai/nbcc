module "app" {
  source = "../../modules/app"

  project     = "charity-site"
  environment = "production"
  region      = var.region

  # Non-overlapping CIDRs so prod and staging could peer/migrate later if needed.
  vpc_cidr            = "10.30.0.0/16"
  public_subnet_cidrs = ["10.30.1.0/24", "10.30.2.0/24"]
  db_subnet_cidrs     = ["10.30.101.0/24", "10.30.102.0/24"]

  # TASK-424: one container, not two. ~$195/year.
  #
  # READ THIS BEFORE TRUSTING THE NUMBER. The ECS service sets
  # lifecycle.ignore_changes = [desired_count], so Terraform set this once at creation and has
  # ignored it ever since, and the deploy workflow passes only --task-definition. Changing this
  # line ALONE therefore does nothing at all: it documents intent and takes effect only if the
  # service is ever recreated. The live count is changed separately, in the console, and
  # README.md records that this is how it works.
  desired_count       = 1
  db_instance_class   = "db.t4g.micro"

  # TASK-424: no standby database. ~$230/year.
  #
  # This costs availability, not durability. Automated RDS backups and 35-day point-in-time
  # recovery are unaffected, as is the nightly off-site backup (TASK-423). What is given up is
  # automatic failover: if an availability zone is lost, recovery is a restore of perhaps half an
  # hour rather than a switch-over of seconds, and up to ~5 minutes of the most recent writes
  # could be lost in a sudden total instance failure.
  #
  # For donations specifically, Stripe is the source of truth and redelivers its webhooks, and
  # stripe_webhook_events already makes that replay idempotent, so the money is recoverable even
  # in that window.
  #
  # NOTE rds.tf sets apply_immediately = true, so this takes effect when infra is applied rather
  # than waiting for the maintenance window.
  multi_az            = false
  deletion_protection = true
  skip_final_snapshot = false

  # Daily automated backups (snapshots + PITR), retained 5 days in AWS-managed
  # backup storage. Staging keeps the module default (7).
  # TASK-311: raised from 5 to 35 - the AWS maximum for automated backups. Three stories were
  # permanently deleted and the 5-day window had already closed by the time anyone noticed, which
  # is the whole argument: a week is not long enough to notice a quiet loss. Backup storage up to
  # the database size is free and this database is ~18 MB, so the cost of the extra month is pennies.
  #
  # 35 days is a hard AWS ceiling. Anything longer (3 months, a year) needs AWS Backup with its own
  # retention plan, which is a separate piece of work - see docs/NEWSLETTER-STATUS.md.
  backup_retention_days = 35

  # HTTPS: provisions the Route53 zone, ACM cert (nbcc.scot + www), 443 listener and
  # 80->443 redirect. After the first apply, delegate the domain by pasting the
  # `route53_nameservers` output into Freeola. See infra/README.md.
  domain_name = "nbcc.scot"

  # Stripe post-checkout redirects on the live domain (were the example.org default).
  stripe_success_url = "https://nbcc.scot/donate/thank-you"
  stripe_cancel_url  = "https://nbcc.scot/donate"
  # Festive Ball (TASK-313): where Stripe returns a ticket buyer after payment.
  ball_base_url = "https://nbcc.scot"
  # Stripe publishable key (TASK-215) for Embedded Checkout — PUBLIC, not a secret. Replace with the
  # real Stripe LIVE publishable key for production; a placeholder just falls back to hosted checkout.
  stripe_publishable_key = "pk_live_51TY8v74nlOtH58iwQR2oZ607WpQKSo5oAGG0JbK9wVIG05iRMYbFIa1Wf8GXDGWngxpGy2JyarU6ropAMSzB43Kg00WD09oA5u"

  # Google Workspace DKIM public key, ported so mail keeps signing post-delegation.
  # VERIFY against Google Admin (Gmail -> Authenticate email) before relying on it.
  google_dkim_txt = "v=DKIM1;k=rsa;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAj7k5aobirseiSKceRwYu4B4lEnBZSBaNgvnaWQTKIoBjx1FIEaN0c/Dpv4WCQcl0T8mXY1rZGB6pOMROQJP5CKSRuy/8tF7zLbf16meN5jXo4ejzZc7DdKPUZpRpaAPHs/xLtgm0odB473Qe699UUI43uP/2KTdtZMIVhIn77BTtTrKVIlTEIX0ub2I9E+PFQWOVnappKPHjcqRUWlZdYL6cQF/NyY2i5aQ2zYuBCPtt82kEDfJYVx+ahODiMR8dP/GCrU4dhBVOcLIDKpzTrvE9rR/FlzuG1wwt5nKqQWkqRmY1iIFfaBFkWrzGitf1x7p7B0NV1JjyfDO7TRCl2QIDAQAB"

  # Newsletter daily ceiling. Terraform's default is 70, but production has been running at 500
  # since someone raised it by hand (the SSM parameter is on version 2). That drift was harmless
  # only while nobody applied infra: the next apply, for any reason at all, would have quietly
  # reset the cap to 70 and made a newsletter take a week to go out, with nothing to connect the
  # symptom to the cause. Recording the real value here is what stops that.
  newsletter_daily_send_cap = 500

  # Nightly off-site backup (TASK-423). The Google side is keyless: the organisation forbids
  # downloadable service-account keys, so Google is told to trust the ECS task role directly and
  # nothing here is a credential. The one secret, the archive passphrase, is pasted into SSM by
  # hand from the charity's password manager and Terraform never sees it.
  google_drive_folder_id                 = "0AFET5N0mT5uMUk9PVA"
  google_service_account_email           = "nbcc-backup-writer@nbcc-backups.iam.gserviceaccount.com"
  google_workload_identity_project_number = "84513277257"
  backup_alarm_email                     = "admin@nbcc.scot"
}
