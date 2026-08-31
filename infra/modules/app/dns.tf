# --- HTTPS: ACM cert + DNS records --------------------------------------------
# Gated on `domain_name`. Empty => HTTP-only (staging default before this: no cert).
# Two modes:
#   • Apex mode (parent_zone_id == ""): CREATE a Route53 hosted zone for domain_name
#     and put every record + the ported Google email records in it (SES's own records live
#     in ses.tf). Production
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
  # TASK-273: the apex TXT set carries BOTH the Google site verification and the root SPF record.
  # They must live in one record set — Route 53 allows only one TXT set per name, and a second
  # resource at the apex would collide.
  #
  # Why a root SPF at all: there was none, so anyone could send mail claiming to be @nbcc.scot and
  # nothing contradicted them. Donors, HMRC correspondence, appeals — all spoofable.
  #
  # Why _spf.google.com specifically: the apex MX is smtp.google.com (above), i.e. staff mail is
  # Google Workspace. Publishing an SPF record that omitted Google would start FAILING every real
  # email a human sends from @nbcc.scot — worse than having none.
  #
  # SES is deliberately NOT included here: its envelope sender is bounce.nbcc.scot, which has its
  # own SPF record (ses.tf). Adding include:amazonses.com at the apex would authorise every
  # Amazon SES customer to send as @nbcc.scot — far broader than we need.
  #
  # ~all (softfail) not -all: a hard fail is the goal, but only after the DMARC reports (rua below)
  # show nothing legitimate is being missed. Tightening is a deliberate later step.
  records = [
    "google-site-verification=jUKUlpbnahczgBEa-dhCEnKbRtt45dkWnnXgUdEpr-8",
    "v=spf1 include:_spf.google.com ~all",
  ]
}

resource "aws_route53_record" "dkim" {
  count   = local.create_zone && var.google_dkim_txt != "" ? 1 : 0
  zone_id = local.zone_id
  name    = "google._domainkey.${var.domain_name}"
  type    = "TXT"
  ttl     = 3600
  records = [join("\"\"", local.dkim_chunks)]
}

# Email sending records live in ses.tf (Resend→SES migration): Easy-DKIM CNAMEs for the apex and
# news.<apex> identities, plus the bounce.* / bounce.news.* MAIL FROM MX + SPF pairs. The old
# Resend records (resend._domainkey.*, send.* / send.news.* MX+SPF) are gone with the provider.
#
# The news.<apex> subdomain itself remains the dedicated newsletter sender (TASK-296 rationale
# unchanged): one campaign that upsets a spam filter must risk its OWN reputation, not the apex's
# — the apex carries donation receipts, Gift Aid confirmations and admin login codes. DMARC is
# inherited from the apex policy (no sp= tag), so p=quarantine applies to it without a second
# record.

# TASK-295/299: the click-tracking subdomain for the newsletter sender, links.news.nbcc.scot.
#
# SES rewrites every link in a newsletter (the click-tracked configuration set in ses.tf) so
# clicks can be counted. By default those rewritten links point at SES's own shared tracker — so
# an email that says it is from news.nbcc.scot would carry links to somewhere else entirely,
# which is the shape of a phishing message. With this CNAME the rewritten links stay on the
# sender's own subdomain and the click data is kept. Open tracking stays OFF (Apple Mail and
# Gmail pre-load images, so the numbers lie, and some filters read the pixel as a negative
# signal). The old apex tracker (links.nbcc.scot) is gone: transactional mail no longer carries
# click tracking at all, by design.
resource "aws_route53_record" "news_tracking" {
  count   = local.create_zone ? 1 : 0
  zone_id = local.zone_id
  name    = "links.news.${var.domain_name}"
  type    = "CNAME"
  ttl     = 3600
  records = ["r.${var.region}.awstrack.me"]
}

resource "aws_route53_record" "dmarc" {
  count   = local.create_zone ? 1 : 0
  zone_id = local.zone_id
  name    = "_dmarc.${var.domain_name}"
  type    = "TXT"
  ttl     = 3600
  # TASK-273: DMARC with REPORTING. The policy was `p=none;` and nothing else — monitor-only with no
  # rua address, so it neither protected the domain nor told anyone what was happening. It satisfied
  # the letter of the Gmail/Yahoo bulk-sender rule and delivered none of the value.
  #
  # rua gives the aggregate XML reports that say who is sending as nbcc.scot and whether SPF/DKIM
  # pass. Those reports are the EVIDENCE needed before tightening the policy: going straight to
  # p=reject blind risks silently binning legitimate mail (a fundraising platform, an events tool)
  # nobody remembered was sending on the charity's behalf.
  #
  # The intended path, once a few weeks of reports look clean:
  #   p=none  ->  p=quarantine; pct=25  ->  p=quarantine  ->  p=reject
  #
  # MANUAL STEP: dmarc@nbcc.scot must exist in Google Workspace (a group or alias is fine) or the
  # reports bounce and this stays as blind as it was before.
  #
  # TASK-294: taking the FIRST step on that path — p=none -> p=quarantine; pct=25.
  #
  # Why now: a real send went to Hotmail junk, and Microsoft weighs DMARC policy strength. p=none is
  # the weakest possible signal, and a domain that never asserts anything about forgery is treated
  # as one.
  #
  # Why it is safe: both things that send as nbcc.scot were checked to authenticate AND align, so
  # neither is affected by a stricter policy —
  #   - Amazon SES (newsletters, receipts): envelope on bounce.nbcc.scot / bounce.news.nbcc.scot
  #     -> SPF include:amazonses.com; Easy DKIM signs d=nbcc.scot / d=news.nbcc.scot (ses.tf).
  #     Aligns on both.
  #   - Google Workspace (staff mail): apex SPF include:_spf.google.com, and google._domainkey is
  #     present, so it aligns on DKIM too rather than on SPF alone.
  # The policy only ever acts on mail that FAILS. Genuine mail passes and is untouched.
  #
  # Why pct=25 rather than straight to quarantine: the aggregate reports are the real evidence and
  # they go to a mailbox this repo cannot read. 25% means that if some forgotten sender does exist,
  # three quarters of its mail still lands while the reports surface it — a hedge against the one
  # thing that cannot be verified from here, not a hedge against the two that can.
  records = ["v=DMARC1; p=quarantine; pct=25; rua=mailto:newsletter@nbcc.scot; fo=1;"]
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
