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

  # HTTPS on a subdomain of the existing nbcc.scot zone (subdomain mode — see dns.tf).
  # No new zone/delegation and no email records; just an ACM cert + 443 + alias so
  # staging has a real trusted HTTPS URL (e.g. for Stripe test webhooks).
  domain_name    = "staging.nbcc.scot"
  parent_zone_id = "Z09647452ZFTMDWPFTGZN" # the nbcc.scot hosted zone (owned by prod state)
}
