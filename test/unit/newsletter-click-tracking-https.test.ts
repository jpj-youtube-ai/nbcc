import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Full-line comments removed, so a commented-out line can never satisfy a check.
const read = (path: string) =>
  readFileSync(resolve(ROOT, path), "utf8").replace(/^\s*(#|\/\/).*$/gm, "");

// One Terraform block, found by its header and then by counting braces from its opening one. The
// `${…}` interpolations inside it are balanced, so they do not throw the count off.
function hclBlock(source: string, header: string): string {
  const start = source.indexOf(header);
  if (start === -1) throw new Error(`could not find ${header}`);
  let depth = 0;
  for (let i = source.indexOf("{", start + header.length - 1); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`could not find the end of ${header}`);
}

// Every block with this header (a file holds several `provider "aws"` or Route 53 record blocks).
function hclBlocks(source: string, header: string): string[] {
  const blocks: string[] = [];
  for (let at = source.indexOf(header); at !== -1; at = source.indexOf(header, at + 1)) {
    blocks.push(hclBlock(source.slice(at), header));
  }
  return blocks;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// TASK-466: the newsletter's click tracking rewrites every link to https://<tracking domain>/…
// (ses.tf: custom_redirect_domain with https_policy REQUIRE). links.news was a bare CNAME to SES's
// tracker, which answered for that name with its own certificate (r.eu-west-2.awstrack.me), so every
// tracked link in every newsletter stopped at a browser security warning and no click was counted.
// AWS's documented HTTPS setup puts a CDN holding the domain's own certificate in front of the
// tracker, passing the requester's Host header through. These pin that shape for whatever domain the
// newsletter configuration set names.
describe("the newsletter's click-tracking domain serves its own certificate", () => {
  const ses = read("infra/modules/app/ses.tf");
  const dns = read("infra/modules/app/dns.tf");
  const tracking = hclBlock(hclBlock(ses, 'resource "aws_sesv2_configuration_set" "newsletter"'), "tracking_options");
  const domain = (tracking.match(/custom_redirect_domain\s*=\s*"([^"]+)"/) || [])[1] ?? "";
  const quoted = escape(`"${domain}"`);

  it("rewrites links to https on click.news", () => {
    expect(tracking).toMatch(/https_policy\s*=\s*"REQUIRE"/);
    // Not links.news: that name is still held by the retired Resend's CloudFront distribution, and
    // CloudFront gives an alternate domain name to one distribution only, so ours could not take it.
    expect(domain).toBe("click.news.${var.domain_name}");
  });

  it("holds a certificate for it in us-east-1, where CloudFront reads certificates", () => {
    const cert = hclBlock(ses, 'resource "aws_acm_certificate" "click_tracking"');
    expect(cert).toMatch(/provider\s*=\s*aws\.us_east_1/);
    expect(cert).toMatch(new RegExp(`domain_name\\s*=\\s*${quoted}`));
    expect(hclBlock(ses, 'resource "aws_acm_certificate_validation" "click_tracking"')).toMatch(/provider\s*=\s*aws\.us_east_1/);
  });

  it("fronts SES's regional tracker with CloudFront, over https, passing the Host header, caching nothing", () => {
    const cdn = hclBlock(ses, 'resource "aws_cloudfront_distribution" "click_tracking"');
    expect(cdn).toMatch(new RegExp(`aliases\\s*=\\s*\\[${quoted}\\]`));
    expect(cdn).toMatch(/domain_name\s*=\s*"r\.\$\{var\.region\}\.awstrack\.me"/);
    expect(cdn).toMatch(/origin_protocol_policy\s*=\s*"https-only"/);
    expect(cdn).toMatch(/allowed_methods\s*=\s*\["GET", "HEAD"\]/);
    expect(cdn).toMatch(/acm_certificate_arn\s*=\s*aws_acm_certificate_validation\.click_tracking/);
    // A dedicated-IP certificate costs hundreds of pounds a month; SNI costs nothing.
    expect(cdn).toMatch(/ssl_support_method\s*=\s*"sni-only"/);
    // AWS: "The CDN must pass the Host header supplied by the requester to the origin."
    expect(cdn).toMatch(/origin_request_policy_id\s*=\s*data\.aws_cloudfront_origin_request_policy\.all_viewer/);
    expect(hclBlock(ses, 'data "aws_cloudfront_origin_request_policy" "all_viewer"')).toContain('"Managed-AllViewer"');
    // A cached redirect is a click SES never sees.
    expect(cdn).toMatch(/cache_policy_id\s*=\s*data\.aws_cloudfront_cache_policy\.caching_disabled/);
    expect(hclBlock(ses, 'data "aws_cloudfront_cache_policy" "caching_disabled"')).toContain('"Managed-CachingDisabled"');
  });

  it("points it at CloudFront over IPv4 and IPv6, never straight at the tracker", () => {
    const records = hclBlocks(dns, 'resource "aws_route53_record"').filter((r) =>
      new RegExp(`name\\s*=\\s*${quoted}`).test(r),
    );
    const typeOf = (r: string) => (r.match(/type\s*=\s*"(\w+)"/) || [])[1];
    expect(records.map(typeOf).sort()).toEqual(["A", "AAAA"]);
    for (const record of records) {
      expect(record).toMatch(/name\s*=\s*aws_cloudfront_distribution\.click_tracking\[0\]\.domain_name/);
    }
  });

  it("switches the links over only once the new address answers", () => {
    const set = hclBlock(ses, 'resource "aws_sesv2_configuration_set" "newsletter"');
    expect(set).toMatch(/depends_on\s*=\s*\[[^\]]*aws_route53_record\.news_click_tracking\b/);
  });

  it("gives the module a us-east-1 provider from the production root", () => {
    expect(read("infra/modules/app/main.tf")).toMatch(/configuration_aliases\s*=\s*\[aws\.us_east_1\]/);
    const east = hclBlocks(read("infra/envs/production/backend.tf"), 'provider "aws"').find((block) =>
      /alias\s*=\s*"us_east_1"/.test(block),
    );
    expect(east, 'a provider "aws" with alias "us_east_1"').toBeDefined();
    expect(east).toMatch(/region\s*=\s*"us-east-1"/);
    expect(read("infra/envs/production/main.tf")).toMatch(/aws\.us_east_1\s*=\s*aws\.us_east_1/);
  });
});
