# --- HTTPS: ACM cert + DNS records --------------------------------------------
# Gated on `domain_name`. Empty => HTTP-only (staging default before this: no cert).
# Two modes:
#   • Apex mode (parent_zone_id == ""): CREATE a Route53 hosted zone for domain_name
#     and put every record + the ported Google/Resend email records in it. Production
#     (nbcc.scot) uses this — the zone's nameservers are delegated at the registrar.
#   • Subdomain mode (parent_zone_id set): do NOT create a zone; add the cert-validation
#     + A-alias records into the EXISTING parent zone (already delegated). Staging
#     (staging.nbcc.scot, parent = the nbcc.scot zone) uses this — no new delegation,
#     no email records, cert validates fast because the parent zone is already public.
#
# Apex-mode operational note: on the FIRST apply the zone exists but the registrar still
# points elsewhere, so `aws_acm_certificate_validation` waits until the NS delegation
# (from the `route53_nameservers` output) propagates. Subdomain mode has no such wait.

locals {
  https_enabled = var.domain_name != ""
  # Apex mode creates + owns the zone; subdomain mode reuses a parent zone by id.
  create_zone = local.https_enabled && var.parent_zone_id == ""
  # The zone every record targets: the created one (apex) or the given parent (subdomain).
  zone_id = local.create_zone ? aws_route53_zone.primary[0].zone_id : var.parent_zone_id

  # DKIM value can exceed a single 255-char DNS character-string; Route53/Terraform
  # need it split into <=255-char quoted chunks concatenated within one TXT record.
  dkim_chunks = var.google_dkim_txt != "" ? [
    for i in range(0, length(var.google_dkim_txt), 255) : substr(var.google_dkim_txt, i, 255)
  ] : []
}

# ---- Hosted zone (apex mode only; authoritative once delegated at the registrar) ----
resource "aws_route53_zone" "primary" {
  count = local.create_zone ? 1 : 0
  name  = var.domain_name
}

# ---- Ported email records (apex mode only — these belong to the root domain) --------
# Google Workspace: MX + apex site-verification TXT + google._domainkey DKIM.
resource "aws_route53_record" "mx" {
  count   = local.create_zone ? 1 : 0
  zone_id = local.zone_id
  name    = var.domain_name
  type    = "MX"
  ttl     = 3600
  records = ["1 smtp.google.com"]
}

resource "aws_route53_record" "txt_apex" {
  count   = local.create_zone ? 1 : 0
  zone_id = local.zone_id
  name    = var.domain_name
  type    = "TXT"
  ttl     = 3600
  records = ["google-site-verification=jUKUlpbnahczgBEa-dhCEnKbRtt45dkWnnXgUdEpr-8"]
}

resource "aws_route53_record" "dkim" {
  count   = local.create_zone && var.google_dkim_txt != "" ? 1 : 0
  zone_id = local.zone_id
  name    = "google._domainkey.${var.domain_name}"
  type    = "TXT"
  ttl     = 3600
  records = [join("\"\"", local.dkim_chunks)]
}

# Resend (transactional email relay) sender verification — apex mode only.
resource "aws_route53_record" "resend_dkim" {
  count   = local.create_zone ? 1 : 0
  zone_id = local.zone_id
  name    = "resend._domainkey.${var.domain_name}"
  type    = "TXT"
  ttl     = 3600
  records = ["p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDObmTJ0OFRvcEFtdxNNptkaGrbU6xnXoHkZj3CoB7cfSLywko1WOUYsinRa3DjQ67QAyLcfQeZKP+jyxcb/Hj+WCSOtNWQ5H4h7CzizVjiQ/JeRwSJNiYG6cl2RiL7avUsGgni2ri+y30XRUbzeQCGMAt68+Wd7YjRw8uteMaLtwIDAQAB"]
}

resource "aws_route53_record" "resend_mx" {
  count   = local.create_zone ? 1 : 0
  zone_id = local.zone_id
  name    = "send.${var.domain_name}"
  type    = "MX"
  ttl     = 3600
  records = ["10 feedback-smtp.eu-west-1.amazonses.com"]
}

resource "aws_route53_record" "resend_spf" {
  count   = local.create_zone ? 1 : 0
  zone_id = local.zone_id
  name    = "send.${var.domain_name}"
  type    = "TXT"
  ttl     = 3600
  records = ["v=spf1 include:amazonses.com ~all"]
}

resource "aws_route53_record" "dmarc" {
  count   = local.create_zone ? 1 : 0
  zone_id = local.zone_id
  name    = "_dmarc.${var.domain_name}"
  type    = "TXT"
  ttl     = 3600
  records = ["v=DMARC1; p=none;"]
}

# ---- ACM certificate, DNS-validated, auto-renewing -----------------------------
# Apex mode covers domain + www; subdomain mode covers just the subdomain.
resource "aws_acm_certificate" "app" {
  count                     = local.https_enabled ? 1 : 0
  domain_name               = var.domain_name
  subject_alternative_names = local.create_zone ? ["www.${var.domain_name}"] : []
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

  zone_id         = local.zone_id
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

# ---- Alias records -> the ALB (A-alias handles the apex CNAME limit) ------------
# The primary name (domain_name) always; www only in apex mode.
resource "aws_route53_record" "apex" {
  count   = local.https_enabled ? 1 : 0
  zone_id = local.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.app.dns_name
    zone_id                = aws_lb.app.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "www" {
  count   = local.create_zone ? 1 : 0
  zone_id = local.zone_id
  name    = "www.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_lb.app.dns_name
    zone_id                = aws_lb.app.zone_id
    evaluate_target_health = true
  }
}
