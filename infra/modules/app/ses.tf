# --- Amazon SES: sending identities, configuration sets, delivery events (Resend→SES) ---------
#
# The app sends email straight to the SESv2 API from ECS (src/clients/ses.ts, task-role auth) —
# the Cloudflare Worker relay and the Resend account are gone. This file provisions:
#   • two sending identities with Easy DKIM + a custom MAIL FROM domain:
#       - the apex (nbcc.scot)      — transactional mail: receipts, login codes, thank-yous
#       - news.<apex>               — the newsletter's OWN reputation (TASK-296 rationale holds)
#   • two configuration sets: the NEWSLETTER one carries click tracking on
#     click.news.<apex> (TASK-295/299 rationale: the link domain must match the sender), the
#     TRANSACTIONAL one deliberately does not — a receipt carrying newsletter-tracking links is
#     the mismatched-link phishing shape TASK-295 removed;
#   • one SNS topic receiving delivery/bounce/complaint (and newsletter click) events, with an
#     HTTPS subscription to the app's token-addressed webhook (/api/webhooks/ses/<token>). The
#     token is minted here (random_password), lands in SSM for the app, and rides in the
#     subscription URL — the same shared-secret trust model the Svix signing key provided.
#
# Everything sending-related is gated on apex mode (local.create_zone, dns.tf): only the
# environment that owns the domain can verify identities on it.
#
# OPERATIONAL NOTE (first apply): the account starts in the SES sandbox — verified recipients
# only, 200/day. Request production access in the SES console BEFORE flipping the app onto real
# sends; DKIM/MAIL FROM verification completes automatically once the Route53 records below
# exist. See docs/NEWSLETTER-STATUS.md.

# ---- Sending identities (Easy DKIM) --------------------------------------------------------

resource "aws_sesv2_email_identity" "apex" {
  count          = local.create_zone ? 1 : 0
  email_identity = var.domain_name
}

resource "aws_sesv2_email_identity" "news" {
  count          = local.create_zone ? 1 : 0
  email_identity = "news.${var.domain_name}"
}

# Custom MAIL FROM (the envelope/Return-Path domain, where bounce feedback goes). bounce.* is
# NEW on purpose — send.* / send.news.* belonged to the retired Resend verification and are
# removed from dns.tf in the same change.
resource "aws_sesv2_email_identity_mail_from_attributes" "apex" {
  count                  = local.create_zone ? 1 : 0
  email_identity         = aws_sesv2_email_identity.apex[0].email_identity
  mail_from_domain       = "bounce.${var.domain_name}"
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

resource "aws_sesv2_email_identity_mail_from_attributes" "news" {
  count                  = local.create_zone ? 1 : 0
  email_identity         = aws_sesv2_email_identity.news[0].email_identity
  mail_from_domain       = "bounce.news.${var.domain_name}"
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

# ---- DNS for the identities (in the zone dns.tf owns) --------------------------------------
# Easy DKIM: three CNAMEs per identity, values supplied by SES at identity creation.

resource "aws_route53_record" "ses_apex_dkim" {
  count   = local.create_zone ? 3 : 0
  zone_id = local.zone_id
  name    = "${aws_sesv2_email_identity.apex[0].dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain_name}"
  type    = "CNAME"
  ttl     = 3600
  records = ["${aws_sesv2_email_identity.apex[0].dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

resource "aws_route53_record" "ses_news_dkim" {
  count   = local.create_zone ? 3 : 0
  zone_id = local.zone_id
  name    = "${aws_sesv2_email_identity.news[0].dkim_signing_attributes[0].tokens[count.index]}._domainkey.news.${var.domain_name}"
  type    = "CNAME"
  ttl     = 3600
  records = ["${aws_sesv2_email_identity.news[0].dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

# MAIL FROM: MX (bounce feedback) + SPF authorising SES to send from the bounce domain.
resource "aws_route53_record" "ses_apex_mail_from_mx" {
  count   = local.create_zone ? 1 : 0
  zone_id = local.zone_id
  name    = "bounce.${var.domain_name}"
  type    = "MX"
  ttl     = 3600
  records = ["10 feedback-smtp.${var.region}.amazonses.com"]
}

resource "aws_route53_record" "ses_apex_mail_from_spf" {
  count   = local.create_zone ? 1 : 0
  zone_id = local.zone_id
  name    = "bounce.${var.domain_name}"
  type    = "TXT"
  ttl     = 3600
  records = ["v=spf1 include:amazonses.com ~all"]
}

resource "aws_route53_record" "ses_news_mail_from_mx" {
  count   = local.create_zone ? 1 : 0
  zone_id = local.zone_id
  name    = "bounce.news.${var.domain_name}"
  type    = "MX"
  ttl     = 3600
  records = ["10 feedback-smtp.${var.region}.amazonses.com"]
}

resource "aws_route53_record" "ses_news_mail_from_spf" {
  count   = local.create_zone ? 1 : 0
  zone_id = local.zone_id
  name    = "bounce.news.${var.domain_name}"
  type    = "TXT"
  ttl     = 3600
  records = ["v=spf1 include:amazonses.com ~all"]
}

# ---- Configuration sets --------------------------------------------------------------------

resource "aws_sesv2_configuration_set" "newsletter" {
  count                  = local.create_zone ? 1 : 0
  configuration_set_name = "${local.name}-newsletter"

  # Click tracking on the newsletter's own subdomain (TASK-295/299: the rewritten link domain
  # must match the sender, or the mail reads as phishing). HTTPS required — the old Resend tracker
  # served https links, and downgrading rewritten links to http would trip the same filters. An
  # https custom domain needs its OWN certificate, so the tracking domain is CloudFront in front of
  # SES's regional tracker (below, TASK-466), not a bare CNAME to it. It is click.news, not the
  # links.news it used to be: the retired Resend's CloudFront distribution still holds links.news,
  # and CloudFront gives a name to one distribution only.
  tracking_options {
    custom_redirect_domain = "click.news.${var.domain_name}"
    https_policy           = "REQUIRE"
  }

  # Switch the links over only once the new address answers, so nothing sent while this is being
  # applied carries links to a name that does not resolve yet.
  depends_on = [aws_route53_record.news_click_tracking, aws_route53_record.news_click_tracking_ipv6]
}

# Transactional mail: NO tracking options, and the event destination below omits CLICK/OPEN, so
# SES never rewrites links in receipts, login codes or thank-yous.
resource "aws_sesv2_configuration_set" "transactional" {
  count                  = local.create_zone ? 1 : 0
  configuration_set_name = "${local.name}-transactional"
}

# ---- HTTPS for the click-tracking domain (TASK-466) ----------------------------------------
# The newsletter configuration set rewrites every link to https://<tracking domain>/… . Until
# TASK-466 that was links.news.<apex>, a bare CNAME to SES's tracker, which answered with its own
# certificate (r.<region>.awstrack.me): every tracked link in every newsletter stopped at a browser
# security warning, and no click was counted. This is AWS's documented HTTPS setup
# (docs.aws.amazon.com/ses/latest/dg/configure-custom-open-click-domains.html): a CDN holding the
# domain's own certificate in front of the regional tracker, where "the CDN must pass the Host
# header supplied by the requester to the origin". It serves click.news.<apex>. links.news could not
# be used: the retired Resend's CloudFront distribution still holds that name, and CloudFront refuses
# a name another distribution holds (CNAMEAlreadyExists). To check it, AWS's own test:
#   curl --head https://click.news.<apex>/favicon.ico
# must answer 200 with x-amz-ses-region: <region> and x-amz-ses-request-protocol: https.

resource "aws_acm_certificate" "click_tracking" {
  count             = local.create_zone ? 1 : 0
  provider          = aws.us_east_1 # CloudFront only reads certificates from us-east-1
  domain_name       = "click.news.${var.domain_name}"
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "click_tracking_cert_validation" {
  for_each = local.create_zone ? {
    for dvo in aws_acm_certificate.click_tracking[0].domain_validation_options : dvo.domain_name => {
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

resource "aws_acm_certificate_validation" "click_tracking" {
  count                   = local.create_zone ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.click_tracking[0].arn
  validation_record_fqdns = [for r in aws_route53_record.click_tracking_cert_validation : r.fqdn]
}

# AWS-managed policies: pass on everything the reader's browser sent, Host included, and cache
# nothing. A cached redirect is a click SES never sees.
data "aws_cloudfront_origin_request_policy" "all_viewer" {
  count = local.create_zone ? 1 : 0
  name  = "Managed-AllViewer"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  count = local.create_zone ? 1 : 0
  name  = "Managed-CachingDisabled"
}

resource "aws_cloudfront_distribution" "click_tracking" {
  count           = local.create_zone ? 1 : 0
  enabled         = true
  comment         = "${local.name}: newsletter click tracking, click.news.${var.domain_name} to SES"
  aliases         = ["click.news.${var.domain_name}"]
  price_class     = "PriceClass_100" # edges in Europe and North America, where the readers are
  is_ipv6_enabled = true
  http_version    = "http2"

  origin {
    origin_id   = "ses-click-tracker"
    domain_name = "r.${var.region}.awstrack.me"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id         = "ses-click-tracker"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled[0].id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer[0].id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.click_tracking[0].certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ---- Delivery events: SES → SNS → the app's webhook ----------------------------------------

resource "aws_sns_topic" "ses_events" {
  count = local.create_zone ? 1 : 0
  name  = "${local.name}-ses-events"
}

# SES must be allowed to publish into the topic (scoped to this account's identities).
data "aws_iam_policy_document" "ses_events_topic" {
  count = local.create_zone ? 1 : 0
  statement {
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.ses_events[0].arn]
    principals {
      type        = "Service"
      identifiers = ["ses.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "ses_events" {
  count  = local.create_zone ? 1 : 0
  arn    = aws_sns_topic.ses_events[0].arn
  policy = data.aws_iam_policy_document.ses_events_topic[0].json
}

resource "aws_sesv2_configuration_set_event_destination" "newsletter" {
  count                  = local.create_zone ? 1 : 0
  configuration_set_name = aws_sesv2_configuration_set.newsletter[0].configuration_set_name
  event_destination_name = "sns"

  event_destination {
    enabled = true
    # OPEN deliberately absent: open tracking lies (Apple Mail/Gmail prefetch) and reads as a
    # negative signal to some filters. Clicks are the honest engagement measure.
    matching_event_types = ["SEND", "DELIVERY", "BOUNCE", "COMPLAINT", "CLICK"]
    sns_destination {
      topic_arn = aws_sns_topic.ses_events[0].arn
    }
  }

  depends_on = [aws_sns_topic_policy.ses_events]
}

resource "aws_sesv2_configuration_set_event_destination" "transactional" {
  count                  = local.create_zone ? 1 : 0
  configuration_set_name = aws_sesv2_configuration_set.transactional[0].configuration_set_name
  event_destination_name = "sns"

  event_destination {
    enabled              = true
    matching_event_types = ["DELIVERY", "BOUNCE", "COMPLAINT"]
    sns_destination {
      topic_arn = aws_sns_topic.ses_events[0].arn
    }
  }

  depends_on = [aws_sns_topic_policy.ses_events]
}

# ---- The webhook token + subscription ------------------------------------------------------
# One secret, two consumers: the app (via SSM → task-def secrets) checks it; the SNS
# subscription URL carries it. Living in Terraform state is the same posture as the generated
# DB password in main.tf.

resource "random_password" "ses_webhook_token" {
  length  = 40
  special = false
}

resource "aws_ssm_parameter" "ses_webhook_token" {
  name  = "/${var.project}/${var.environment}/SES_WEBHOOK_TOKEN"
  type  = "SecureString"
  value = random_password.ses_webhook_token.result
}

resource "aws_sns_topic_subscription" "ses_events_webhook" {
  count     = local.create_zone ? 1 : 0
  topic_arn = aws_sns_topic.ses_events[0].arn
  protocol  = "https"
  endpoint  = "https://${var.domain_name}/api/webhooks/ses/${random_password.ses_webhook_token.result}"
  # The route confirms the subscription itself (it fetches the SubscribeURL after checking the
  # token), so Terraform must not wait for a manual confirmation.
  endpoint_auto_confirms = true
}
