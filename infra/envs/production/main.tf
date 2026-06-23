module "app" {
  source = "../../modules/app"

  project     = "charity-site"
  environment = "production"
  region      = var.region

  # Non-overlapping CIDRs so prod and staging could peer/migrate later if needed.
  vpc_cidr            = "10.30.0.0/16"
  public_subnet_cidrs = ["10.30.1.0/24", "10.30.2.0/24"]
  db_subnet_cidrs     = ["10.30.101.0/24", "10.30.102.0/24"]

  desired_count       = 2     # availability
  db_instance_class   = "db.t4g.micro"
  multi_az            = true  # automatic failover
  deletion_protection = true
  skip_final_snapshot = false
}
