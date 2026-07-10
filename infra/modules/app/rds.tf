resource "aws_db_instance" "app" {
  identifier     = local.name
  engine         = "postgres"
  engine_version = "16" # pin to a current minor (e.g. "16.6") and match local
  instance_class = var.db_instance_class

  allocated_storage     = 20
  max_allocated_storage = 100 # storage autoscaling ceiling
  storage_encrypted     = true

  db_name  = "charity"
  username = "app"
  password = random_password.db.result
  # More secure alternative (never in state): manage_master_user_password = true

  db_subnet_group_name   = module.vpc.database_subnet_group_name
  vpc_security_group_ids = [aws_security_group.rds.id]
  multi_az               = var.multi_az
  publicly_accessible    = false

  backup_retention_period = var.backup_retention_days # daily backups + point-in-time recovery
  deletion_protection     = var.deletion_protection
  skip_final_snapshot     = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${local.name}-final"

  apply_immediately = true
}
