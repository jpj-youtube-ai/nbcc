import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

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

// Every block with this header (a file can hold several `provider "aws"` blocks).
function hclBlocks(source: string, header: string): string[] {
  const blocks: string[] = [];
  for (let at = source.indexOf(header); at !== -1; at = source.indexOf(header, at + 1)) {
    blocks.push(hclBlock(source.slice(at), header));
  }
  return blocks;
}

// TASK-466: the newsletter's click tracking rewrites every link to https://links.news.nbcc.scot/…
// (ses.tf: custom_redirect_domain with https_policy REQUIRE). links.news was a bare CNAME to SES's
// tracker, which answered for that name with its own certificate (r.eu-west-2.awstrack.me), so every
// tracked link in every newsletter stopped at a browser security warning and no click was counted.
// AWS's documented HTTPS setup puts a CDN holding the domain's own certificate in front of the
// tracker, passing the requester's Host header through. These pin that shape.
describe("the newsletter's click-tracking domain serves its own certificate", () => {
  const ses = read("infra/modules/app/ses.tf");
  const dns = read("infra/modules/app/dns.tf");

  it("rewrites links to https on links.news", () => {
    const tracking = hclBlock(hclBlock(ses, 'resource "aws_sesv2_configuration_set" "newsletter"'), "tracking_options");
    expect(tracking).toMatch(/custom_redirect_domain\s*=\s*"links\.news\.\$\{var\.domain_name\}"/);
    expect(tracking).toMatch(/https_policy\s*=\s*"REQUIRE"/);
  });

  it("holds a certificate for links.news in us-east-1, where CloudFront reads certificates", () => {
    const cert = hclBlock(ses, 'resource "aws_acm_certificate" "links_news"');
    expect(cert).toMatch(/provider\s*=\s*aws\.us_east_1/);
    expect(cert).toMatch(/domain_name\s*=\s*"links\.news\.\$\{var\.domain_name\}"/);
    expect(hclBlock(ses, 'resource "aws_acm_certificate_validation" "links_news"')).toMatch(/provider\s*=\s*aws\.us_east_1/);
  });

  it("fronts SES's regional tracker with CloudFront, over https, passing the Host header, caching nothing", () => {
    const cdn = hclBlock(ses, 'resource "aws_cloudfront_distribution" "links_news"');
    expect(cdn).toMatch(/aliases\s*=\s*\["links\.news\.\$\{var\.domain_name\}"\]/);
    expect(cdn).toMatch(/domain_name\s*=\s*"r\.\$\{var\.region\}\.awstrack\.me"/);
    expect(cdn).toMatch(/origin_protocol_policy\s*=\s*"https-only"/);
    expect(cdn).toMatch(/acm_certificate_arn\s*=\s*aws_acm_certificate_validation\.links_news/);
    // AWS: "The CDN must pass the Host header supplied by the requester to the origin."
    expect(cdn).toMatch(/origin_request_policy_id\s*=\s*data\.aws_cloudfront_origin_request_policy\.all_viewer/);
    expect(hclBlock(ses, 'data "aws_cloudfront_origin_request_policy" "all_viewer"')).toContain('"Managed-AllViewer"');
    // A cached redirect is a click SES never sees.
    expect(cdn).toMatch(/cache_policy_id\s*=\s*data\.aws_cloudfront_cache_policy\.caching_disabled/);
    expect(hclBlock(ses, 'data "aws_cloudfront_cache_policy" "caching_disabled"')).toContain('"Managed-CachingDisabled"');
  });

  it("points links.news at CloudFront, not straight at the tracker", () => {
    const record = hclBlock(dns, 'resource "aws_route53_record" "news_tracking"');
    expect(record).toMatch(/type\s*=\s*"A"/);
    expect(record).toMatch(/name\s*=\s*aws_cloudfront_distribution\.links_news\[0\]\.domain_name/);
    expect(dns).not.toMatch(/records\s*=\s*\["r\.\$\{var\.region\}\.awstrack\.me"\]/);
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
