# --- HTTPS: Route53 zone + ACM cert + email records ---------------------------
# All gated on `domain_name` being set, so staging (empty) provisions nothing here
# and stays HTTP-only. Production sets domain_name = "nbcc.scot" (infra/envs/production).
#
# Operational note (delegation ordering): the FIRST apply creates the hosted zone but
# the domain's nameservers still point at Freeola, so the ACM DNS validation record is
# not yet publicly resolvable. `aws_acm_certificate_validation` will WAIT. Read the
# `route53_nameservers` output, set those 4 NS at Freeola, and once delegation
# propagates the cert validates and the apply completes (re-run apply if it times out).

locals {
  https_enabled = var.domain_name != ""

  # DKIM value can exceed a single 255-char DNS character-string; Route53/Terraform
  # need it split into <=255-char quoted chunks concatenated within one TXT record.
  dkim_chunks = var.google_dkim_txt != "" ? [
    for i in range(0, length(var.google_dkim_txt), 255) : substr(var.google_dkim_txt, i, 255)
  ] : []
}

# ---- Hosted zone (authoritative once Freeola delegates to these nameservers) ----
resource "aws_route53_zone" "primary" {
  count = local.https_enabled ? 1 : 0
  name  = var.domain_name
}

# ---- Ported Google Workspace email records (so mail survives delegation) --------
# MX: Google Workspace simplified single record.
resource "aws_route53_record" "mx" {
  count   = local.https_enabled ? 1 : 0
  zone_id = aws_route53_zone.primary[0].zone_id
  name    = var.domain_name
  type    = "MX"
  ttl     = 3600
  records = ["1 smtp.google.com"]
}

# TXT at the apex: Google site-verification token.
resource "aws_route53_record" "txt_apex" {
  count   = local.https_enabled ? 1 : 0
  zone_id = aws_route53_zone.primary[0].zone_id
  name    = var.domain_name
  type    = "TXT"
  ttl     = 3600
  records = ["google-site-verification=jUKUlpbnahczgBEa-dhCEnKbRtt45dkWnnXgUdEpr-8"]
}

# TXT google._domainkey: DKIM public key (chunked; VERIFY against Google Admin — see
# var.google_dkim_txt). Skipped if the value is empty.
resource "aws_route53_record" "dkim" {
  count   = local.https_enabled && var.google_dkim_txt != "" ? 1 : 0
  zone_id = aws_route53_zone.primary[0].zone_id
  name    = "google._domainkey.${var.domain_name}"
  type    = "TXT"
  ttl     = 3600
  records = [join("\"\"", local.dkim_chunks)]
}

# ---- ACM certificate (apex + www), DNS-validated, auto-renewing ----------------
resource "aws_acm_certificate" "app" {
  count                     = local.https_enabled ? 1 : 0
  domain_name               = var.domain_name
  subject_alternative_names = ["www.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = local.https_enabled ? {
    for dvo in aws_acm_certificate.app[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  } : {}

  zone_id         = aws_route53_zone.primary[0].zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "app" {
  count                   = local.https_enabled ? 1 : 0
  certificate_arn         = aws_acm_certificate.app[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# ---- Alias records: apex + www -> the ALB (A-alias handles the apex CNAME limit) --
resource "aws_route53_record" "apex" {
  count   = local.https_enabled ? 1 : 0
  zone_id = aws_route53_zone.primary[0].zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.app.dns_name
    zone_id                = aws_lb.app.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "www" {
  count   = local.https_enabled ? 1 : 0
  zone_id = aws_route53_zone.primary[0].zone_id
  name    = "www.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_lb.app.dns_name
    zone_id                = aws_lb.app.zone_id
    evaluate_target_health = true
  }
}
