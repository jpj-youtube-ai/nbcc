module "app" {
  source = "../../modules/app"

  project     = "charity-site"
  environment = "staging"
  region      = var.region

  desired_count       = 1
  db_instance_class   = "db.t4g.micro"
  multi_az            = false
  deletion_protection = false
  skip_final_snapshot = true
}
