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

  # Stripe post-checkout redirects on the staging domain (were the example.org default).
  stripe_success_url = "https://staging.nbcc.scot/donate/thank-you"
  stripe_cancel_url  = "https://staging.nbcc.scot/donate"
  # Stripe publishable key (TASK-215) for Embedded Checkout — PUBLIC, not a secret. Replace with the
  # real Stripe TEST publishable key for staging; a placeholder just falls back to hosted checkout.
  stripe_publishable_key = "pk_test_REPLACE_ME"
}
