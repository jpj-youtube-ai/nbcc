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

  # HTTPS: provisions the Route53 zone, ACM cert (nbcc.scot + www), 443 listener and
  # 80->443 redirect. After the first apply, delegate the domain by pasting the
  # `route53_nameservers` output into Freeola. See infra/README.md.
  domain_name = "nbcc.scot"

  # Stripe post-checkout redirects on the live domain (were the example.org default).
  stripe_success_url = "https://nbcc.scot/donate/thank-you"
  stripe_cancel_url  = "https://nbcc.scot/donate"

  # Google Workspace DKIM public key, ported so mail keeps signing post-delegation.
  # VERIFY against Google Admin (Gmail -> Authenticate email) before relying on it.
  google_dkim_txt = "v=DKIM1;k=rsa;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAj7k5aobirseiSKceRwYu4B4lEnBZSBaNgvnaWQTKIoBjx1FIEaN0c/Dpv4WCQcl0T8mXY1rZGB6pOMROQJP5CKSRuy/8tF7zLbf16meN5jXo4ejzZc7DdKPUZpRpaAPHs/xLtgm0odB473Qe699UUI43uP/2KTdtZMIVhIn77BTtTrKVIlTEIX0ub2I9E+PFQWOVnappKPHjcqRUWlZdYL6cQF/NyY2i5aQ2zYuBCPtt82kEDfJYVx+ahODiMR8dP/GCrU4dhBVOcLIDKpzTrvE9rR/FlzuG1wwt5nKqQWkqRmY1iIFfaBFkWrzGitf1x7p7B0NV1JjyfDO7TRCl2QIDAQAB"
}
