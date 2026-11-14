import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  BLOCK_TYPES,
  renderBlock,
  renderNewsletter,
  type Block,
  type NewsletterDoc,
} from "../../src/newsletter/blocks";
import { brandButton, renderFrame, applyMerge, proseHtml } from "../../src/newsletter/theme";
import { htmlToPlainText } from "../../src/newsletter/plain-text";
import { welcomeDoc, buildWelcomeEmail } from "../../src/newsletter/welcome";

// THE GOLDEN TEST: every newsletter already written must render byte for byte as it does today.
//
// The fifteen block types that existed before the paper-look blocks are rendered here at every
// variant, with every field filled, with nothing filled, and at a size step, alone and inside the
// frame, and each result is reduced to a SHA-256. The values below were recorded from the code as it
// stood BEFORE any paper-look block was added, so a change to an existing renderer, to the frame, to
// the button, to the merge or to the plain-text version shows up here as a changed hash.
//
// A hash and not a fixture file: a file on disk picks up Windows line endings and fails falsely.
// (Template literals always read their own line breaks as "\n", whatever the file on disk uses.)
//
// These fifteen names are written out, never read from BLOCK_TYPES, so adding a block type cannot
// change what is pinned. If one of these fails, the answer is almost never to re-record it: it means
// a newsletter that has already been written, or sent, would now look different.
//
// To see the current values (for example after a change that is MEANT to alter old newsletters, which
// needs Jaimie's say-so), run this file with NL_GOLDEN_PRINT=1 and read the printed object.

const ORIGINAL_TYPES = [
  "masthead",
  "greeting",
  "text",
  "heading",
  "image",
  "story",
  "spotlight",
  "stats",
  "waysToHelp",
  "events",
  "donationCta",
  "button",
  "divider",
  "signoff",
  "rawHtml",
] as const;
type OriginalType = (typeof ORIGINAL_TYPES)[number];

// Awkward on purpose: markup that must be escaped, emphasis markers, line breaks, the merge tag.
const AWKWARD = 'Tom & "Jerry" <b>bold</b>';
const PROSE = "Hello {{firstName}}, this is **bold** and *italic*.\n\nA second paragraph & more.\nA new line.";

const RICH: Record<OriginalType, Record<string, unknown>> = {
  masthead: {
    issueTitle: `Winter Update ${AWKWARD}`,
    heroUrl: "https://example.com/hero.jpg?a=1&b=2",
    date: "November 2026",
  },
  greeting: { lead: PROSE, heading: `A heading ${AWKWARD}` },
  text: { text: PROSE },
  heading: { title: `Section ${AWKWARD}`, kicker: "A kicker & more" },
  image: {
    url: "https://example.com/photo.jpg?a=1&b=2",
    alt: `A photo of ${AWKWARD}`,
    caption: `Caption ${AWKWARD}`,
  },
  story: {
    imageUrl: "https://example.com/story.jpg",
    title: `Story ${AWKWARD}`,
    body: PROSE,
    label: "Read the story",
    href: "https://example.com/story?a=1&b=2",
    items: [
      {
        imageUrl: "https://example.com/one.jpg",
        title: "First story",
        body: "First **body**.",
        label: "Read on",
        href: "https://example.com/one",
      },
      { title: "Second story", body: "Second body.\nNext line." },
      { imageUrl: "https://example.com/three.jpg", title: "Third", body: "", href: "https://example.com/three" },
    ],
  },
  spotlight: {
    photoUrl: "https://example.com/person.jpg",
    name: `Morag ${AWKWARD}`,
    quote: PROSE,
    role: "Volunteer & driver",
  },
  stats: {
    items: [
      { number: "7,657", label: "Red Bags delivered", caption: `A caption ${AWKWARD}` },
      { number: "312", label: "Volunteers" },
      { number: "£50", label: "Fills a bag", caption: "Each one" },
    ],
  },
  waysToHelp: {
    items: [
      { icon: "🎁", title: "Donate", body: PROSE, label: "Donate", href: "https://example.com/donate" },
      { icon: "", title: `Volunteer ${AWKWARD}`, body: "Give an evening.", label: "", href: "https://example.com/v" },
      { icon: "🧦", title: "Collect", body: "", label: "Start", href: "" },
    ],
  },
  events: {
    items: [
      { day: "15", month: "JUL", name: `Summer fair ${AWKWARD}`, location: "Kilmarnock", label: "Book", href: "https://example.com/fair" },
      { day: "7", month: "NOV", name: "The Ball", location: "", label: "", href: "https://example.com/ball" },
      { day: "24", month: "DEC", name: "Christmas Eve", location: "Everywhere", label: "Register", href: "" },
    ],
  },
  donationCta: {
    imageUrl: "https://example.com/cta.jpg",
    heading: `Support our work ${AWKWARD}`,
    label: "Make a donation today",
    href: "https://example.com/donate?a=1&b=2",
  },
  button: { label: `Learn more ${AWKWARD}`, href: "https://example.com/learn?a=1&b=2" },
  divider: {},
  signoff: {
    closing: "With love and gratitude,",
    name: "Morag Example",
    role: `On behalf of everyone ${AWKWARD}`,
    email: " hello@example.com ",
  },
  rawHtml: { html: '<p style="font-size:15px">LEGACY <b>BODY</b></p>' },
};

const VARIANTS = [0, 1, 2, 3];
const NAMED = { firstName: "Jane" };
const UNSUB = "https://example.com/unsubscribe/abc?x=1&y=2";

function sha(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function block(type: OriginalType, variant: number, data: Record<string, unknown>, size?: number): Block {
  return size === undefined ? { type, variant, data } : { type, variant, data, size };
}

function everyBlockDoc(size?: number): NewsletterDoc {
  const blocks: Block[] = [];
  for (const type of ORIGINAL_TYPES) for (const v of VARIANTS) blocks.push(block(type, v, RICH[type], size));
  return { blocks };
}

function record(): Record<string, string> {
  const out: Record<string, string> = {};

  for (const type of ORIGINAL_TYPES) {
    // Every variant, every field filled, no size set (how every newsletter written so far is stored).
    for (const v of VARIANTS) out[`${type}.${v}`] = sha(renderBlock(block(type, v, RICH[type]), NAMED));
    // Every variant with nothing filled in: what each block degrades to.
    out[`${type}.empty`] = sha(VARIANTS.map((v) => renderBlock(block(type, v, {}), NAMED)).join("\n--\n"));
    // Every variant at each size step, with nobody's name.
    out[`${type}.sized`] = sha(
      [-2, -1, 1, 2]
        .map((size) => VARIANTS.map((v) => renderBlock(block(type, v, RICH[type], size), { firstName: "" })).join("\n--\n"))
        .join("\n==\n"),
    );
  }

  // Whole newsletters, through the frame.
  const all = everyBlockDoc();
  const named = renderNewsletter(all, NAMED);
  out["doc.named"] = sha(named);
  out["doc.named.text"] = sha(htmlToPlainText(named));
  out["doc.unsubscribe"] = sha(renderNewsletter(all, { firstName: "Jane", unsubscribeUrl: UNSUB }));
  const blank = renderNewsletter(all, { firstName: "" });
  out["doc.blankName"] = sha(blank);
  out["doc.blankName.text"] = sha(htmlToPlainText(blank));
  out["doc.blankName.fallbacks"] = sha(
    renderNewsletter({ ...all, merge: { nameFallback: "friend", greetingFallback: "Supporter" } }, { firstName: "" }),
  );
  out["doc.awkwardName"] = sha(renderNewsletter(all, { firstName: '**Bob** <i>&"' }));
  out["doc.sized.up"] = sha(renderNewsletter(everyBlockDoc(1), NAMED));
  out["doc.sized.down"] = sha(renderNewsletter(everyBlockDoc(-2), NAMED));
  out["doc.empty"] = sha(renderNewsletter({ blocks: [] }, NAMED));

  // The welcome email is built from a block document too.
  out["welcome.doc"] = sha(renderNewsletter(welcomeDoc(), { firstName: "Jane", unsubscribeUrl: UNSUB }));
  const welcome = buildWelcomeEmail(null, UNSUB);
  out["welcome.email"] = sha(`${welcome.subject}\n${welcome.html}\n${welcome.text}`);

  // The shared parts the new blocks must not move.
  out["shared.frame"] = sha(`${renderFrame("<p>INNER</p>")}\n--\n${renderFrame("<p>INNER</p>", UNSUB)}`);
  out["shared.brandButton"] = sha(
    (["primary", "outline", "full", "link"] as const).map((s) => brandButton(`Go ${AWKWARD}`, UNSUB, s)).join("\n"),
  );
  out["shared.prose"] = sha(
    `${proseHtml(PROSE)}\n--\n${applyMerge(PROSE, NAMED)}\n--\n${applyMerge(PROSE, { firstName: "" })}\n--\n${applyMerge(PROSE, { firstName: "", nameFallback: "friend" })}`,
  );

  return out;
}

// Recorded on 14 November 2026 from commit b36b7b79, before any paper-look block existed.
const GOLDEN: Record<string, string> = {
  "masthead.0": "0006de550c092fee7edce39a14a9307ca3bb5fedd57810a65a9e6cc2d796de53",
  "masthead.1": "57ebc0ca5ab2d2837197212deaec56fcd22f65af8f71c09e38136eaa815b5a04",
  "masthead.2": "7ea680f6fb63775179c7470cd13fa709900837a2b32c88767bf26d8ddf91d1a6",
  "masthead.3": "1a1b84348cb7f5a809d3d724adf0227b73b6cd03eecff64473217c47707c70af",
  "masthead.empty": "b0d443cc8cd29d4c79be754ed19908b18062388203c403707da69447d3bc8bdc",
  "masthead.sized": "a15a6133034b8017cfd58423d6e965c8cbb8c750703f0e0d8a3d1f4311c522f6",
  "greeting.0": "eb89b797a0ae5f2a7d10b05f9739bfbe636feed4df972e9b2f0faef73ea12dbb",
  "greeting.1": "3d5aeadcf6d40f853095973ddef02c8c24e58f15f7b260010397365c0ae51fbe",
  "greeting.2": "b140023efc5b8198e1bc79c60dd355ec3a74542e91b85443eab182d7eb29b6c8",
  "greeting.3": "b19cda68dc29025a8c507d4ce8f04d0789dcf29a9ba9c1c334aa91e52b99ed1c",
  "greeting.empty": "fe566ce713a997590b5f3d6bb1b20d5560cff9f714dd3ad4665c4a21ea6fc1d2",
  "greeting.sized": "e56de71634adf32b10390f5b03e84834a2f3a4907466e7a27212c293c3a72cd3",
  "text.0": "68906832f30943cef02952956e2685f00f232f80e0ab2a2e6597c120aaa381d2",
  "text.1": "c8da34387cfb96d1a4324428be77f03a9aa3f5d441c8529102181b760ae84276",
  "text.2": "7e016df852b4ada8d2d3c62fec31b634610cdd7b36f39479ee67ae6257695946",
  "text.3": "3251da7f3b4b2b4fe6e71eb40782e1a0bb0176be386a04fd0ea57c680eb255f1",
  "text.empty": "c9a89935beee04a682c727f40cfbca615f59db0981c61e5f09ae01beef798cc7",
  "text.sized": "5862ba7a22a5ee9e6036a669c1dce8e723387e0519a42871134b37549a4d8d19",
  "heading.0": "cbd307c6d66633c095e55b7d3f193afcdeb8e826a6c82fc70871183e2e263a88",
  "heading.1": "afdfb3365df9515d25a9650b8710b19049323c330963c89f977c41341304491e",
  "heading.2": "78d9d54e748ff34094cff66c31f7043d8842094ca33ce6c49ab29530dbd1768e",
  "heading.3": "c0c3f0f964555ee8a9e59befc97343f824565a3e430c47153df5e92b620d606d",
  "heading.empty": "644ecac7b9083fec9da1599fd1c7a82217dd6c96b4981dd0c9b7ac1bb19d21f5",
  "heading.sized": "9c1508d36a76ac5bc745b9e384855ff5a12714458a52a3c829e44a03fcf24f8f",
  "image.0": "dc12de68936ada7903b794ed5a4c3784ccec013fbf250f358fef42b4aa58c778",
  "image.1": "b8d75df32090700266376dc6649837c7468b9b3a5ab42cd06a3cf74451386e09",
  "image.2": "cd207011758b49eece49c1c553b37ada59d690f64461269cc4be1365dfb89eea",
  "image.3": "5c21b85257071a05a16c72ac0263b9eb0a992ad8ed209234a47e9406586d14e5",
  "image.empty": "6ead276d6a3e061fa07bb025b7ccbcf2d270f11a56a10be87d6d1ac8c34c1834",
  "image.sized": "a03e11623e020d39a7bbc47c529cb91172eaaa74d573d475cf37cc4683df8a7e",
  "story.0": "983e520837048ca6c2af796d6296d1eb6da94ed965efbb20cbbaee227523f94d",
  "story.1": "f26f39bfa1e3b1bdf692f9eeb0dbb6495390939a6924ca4a2d8dd4923b9b8e5a",
  "story.2": "d4ac24332dbbbbddd157994e8124fe08c025ffd9afd8d852678f075721e04575",
  "story.3": "7fbb0fd44057cea494f7d791ee0f073e83acef59ace776867e51d466ea419f52",
  "story.empty": "dccfd5efce906615e86a44ccd5c5bcd811ab76c6a540997285c9aca600a2dade",
  "story.sized": "c0bb6547f5e56a8866a1c04cb13c09b6c63917a865d09a466da1be7ad9525da0",
  "spotlight.0": "ef6d93961de39bd14191bab8bfbdd1b4569cea0ac37bc21c154be68afa30ec3a",
  "spotlight.1": "fea6f313640a16292e460ab0a8ee76f4fa079173aa09438f7cc86c66381bd05a",
  "spotlight.2": "a8d3391a81b2ce93596a39502ed2de874de8325627012c9b69f302894781963d",
  "spotlight.3": "a5841ea7cce3f983d9789e5f819ad8b9345d112931c0681c0488e753ad146737",
  "spotlight.empty": "16cfeb382b6ccc99d450291cbf580c46bbe63f57c9ee2ee05389b9d659c2cb07",
  "spotlight.sized": "c835ca2b19652ade58f82fe5137ad05fe0823f4e721491b2ead876fc96d23408",
  "stats.0": "7daf259bd4ba03d41200d33ec556de4a6863e06b693d6f622b1112e7e91488b7",
  "stats.1": "7ec2b9aa5846fd5d858f3c6933477481eeb8df4f21555a87d9c7ac0c9191d007",
  "stats.2": "97f1ccc14976e1f3b481392a38c79f4cf00bc3274bb07fcc67da1cc302329f41",
  "stats.3": "95d7680737f92c815d71b42c75d95303b7e191a08fac1b1d1b9b69e6572443e5",
  "stats.empty": "6ead276d6a3e061fa07bb025b7ccbcf2d270f11a56a10be87d6d1ac8c34c1834",
  "stats.sized": "415817c1cc7a70b27667d77a263241d6760844ee74ff372ed9ae35554399cb14",
  "waysToHelp.0": "ed2ef8c38e969c901653e7dea341fd59a23cdfb1a8fa7c7d9d58c28b6e034127",
  "waysToHelp.1": "549982e492e5f3b1d6917f98336e58b7054844bad37598158dbc0f7d2992ca8e",
  "waysToHelp.2": "f6012c08432f140d0489cbf1c24aaf551467fc72a0883b64eaea6a419a497da6",
  "waysToHelp.3": "67fa4e53f95640231d11f04dd1e1e31873218e2a63523f2dd2a40bdd447f225f",
  "waysToHelp.empty": "6ead276d6a3e061fa07bb025b7ccbcf2d270f11a56a10be87d6d1ac8c34c1834",
  "waysToHelp.sized": "f95ec809238b7a2c1577adcaefbbf006c4e9067ee2050c3a1c7f1aeb8128a7cd",
  "events.0": "a6f880d88e83d0cd296d21e754e27b05a5663cc30f60cac35f2caff7863321a0",
  "events.1": "8218cf522ead99679caf4eb20c9508bf349e90a43eec41a0dcd7a3109b1663ee",
  "events.2": "97f3d0825ec4803c9821a940da7ce3d60808ebec72f5f1890ce983957f4abb0e",
  "events.3": "1ea9af80ca9b916d62ea41f95396ee6d24c478575af1012debd9bb70a7c22820",
  "events.empty": "6ead276d6a3e061fa07bb025b7ccbcf2d270f11a56a10be87d6d1ac8c34c1834",
  "events.sized": "709b61691a4b3a3f25db75dbc9c64add7cace0b9b39c26b577b1bad033805efe",
  "donationCta.0": "e160aaaeeb0b6b4fec9984340c0b394c975528646d3400b938844a5d76645786",
  "donationCta.1": "1472563037bbabfabdc6a7095e4322827b0b2678ac76b48befd4e06b8d4b652b",
  "donationCta.2": "f46ff26c203fc4a557d519e5e2651a8d1bd0f3cc1bb01aa78338166227e77f7c",
  "donationCta.3": "8b369673ad129e738d13acf8bdc8effd4ee8376603e5c8319cdc40d9658c3aa7",
  "donationCta.empty": "bd898333601e606b6e41c6403d295f76f77d900bd088def8774059a80fa6efed",
  "donationCta.sized": "dcfd5e998628f411660aa77007eff9d43c9cc84f9e01aa3867b67876879620dc",
  "button.0": "dfca80950dea3503c9d6472a512ff6b27f6d6c23893556cad9435c97fae3b5a5",
  "button.1": "e6084e64de0e42ad020c0b292b4dc14ed6e5d1d44ef013a81041d65ab7faa522",
  "button.2": "e731ebcd01aff28d1fb50c5975c726680a71de976ae4b57ed3d672eeea0e35fa",
  "button.3": "c548aff3d59575c58b735b5bc685bc688b9eb552b957f279ba3ec8104b34c347",
  "button.empty": "6ead276d6a3e061fa07bb025b7ccbcf2d270f11a56a10be87d6d1ac8c34c1834",
  "button.sized": "c512f0103cd4fe597178d6a52aa1223bff7f0c53503bf6c5484fab3b71294b88",
  "divider.0": "991648d2c9ed688cf48eb741b025a8b0d13ec93c714a996c5549b508a3ceaaaf",
  "divider.1": "0be5ea2bc1bf025491b4a931cdbfc60fcfd4f78d2bb7b5dfd258d4a8bb5ae922",
  "divider.2": "27fe5382295ce68f0a17a23b805e0394959770d8078cd8b905c12f823929df3d",
  "divider.3": "ce6c9345d08f6e97b9b8cb945d07adc29fe577c656e3493d2c35a915af3ecf17",
  "divider.empty": "163b179418f8509cc4a8eff527c74ae06e1450704640491a079943fa107d9951",
  "divider.sized": "817f9098d0a89b2a71640bb8ad775669b6f37c54426b90608476926de069ca7d",
  "signoff.0": "ebe1df1a91abbff2e1a40bfd5fd817859a31a034860600381e4232866fe0d915",
  "signoff.1": "dd35322f9c935f7b075a3fe5ca9826f4f9864c9d4a1528aa97ddcbeaac5d80d3",
  "signoff.2": "ebe1df1a91abbff2e1a40bfd5fd817859a31a034860600381e4232866fe0d915",
  "signoff.3": "ebe1df1a91abbff2e1a40bfd5fd817859a31a034860600381e4232866fe0d915",
  "signoff.empty": "71888746aa2e9b255564fefe624c9e22ad52449e1f9d4eb81568f6f57bafa16b",
  "signoff.sized": "cd2bd58d150912828fa13053853dc8f740b464ebd819b634687f8472575aee19",
  "rawHtml.0": "6dcf51636e8b32daf90dd2512505563448ec9d3b7c08654c58230d7c0042bf53",
  "rawHtml.1": "6dcf51636e8b32daf90dd2512505563448ec9d3b7c08654c58230d7c0042bf53",
  "rawHtml.2": "6dcf51636e8b32daf90dd2512505563448ec9d3b7c08654c58230d7c0042bf53",
  "rawHtml.3": "6dcf51636e8b32daf90dd2512505563448ec9d3b7c08654c58230d7c0042bf53",
  "rawHtml.empty": "627a80274351ff106f9dc4f4fc3abc113ee150d85e99d713261a416d417eafea",
  "rawHtml.sized": "02b0e9d1e30f6c7d606b9dc763941f597625eecb5ca8ccb74db4bc872b68acd3",
  "doc.named": "3132ced033c462e5a251c16f607a76cbe5b602ed9aa7da6033e2b30860a84d82",
  "doc.named.text": "338f21190a9cb36c1f0afeebcd84c06df0b4a8d03927210388fe46944b4d9428",
  "doc.unsubscribe": "877c28fabffe7b8965e7f5d842818f2bdbc0b34c29961c74047386398a3f8e62",
  "doc.blankName": "0dcffcaa418a3f51191758b6bfb75d812dd95d5f928969ea4415433f9ac65250",
  "doc.blankName.text": "3711b95461fe4b9fd8aff59050f0da5256eac0a0c060a29cc81d98818be9266c",
  "doc.blankName.fallbacks": "8294619c8962ea93816161c177cc60af3dfb5bb475764bf355557451bdbeecba",
  "doc.awkwardName": "5105f3fa8c6fa1d7937ca47b9646d3dd2a9e85acdf5ce201306a7cc2adc0b9d9",
  "doc.sized.up": "22219f0a1bbc625410179d1c1a002fbec93783803d842835eadb148c69afae22",
  "doc.sized.down": "2fbc28d6def39339872cc200eed7845e91fdb6ca59b95358610ee9bfdbe50d77",
  "doc.empty": "ee67b17bad40b58cbc550e78ebb08d4cf5ce8302c41a80842da9bac0d2396c8a",
  "welcome.doc": "17eee6a1c2227fab1a8c00f9d69c75b2afc49e1094507c63ca6a7bbab354dc3f",
  "welcome.email": "733f543d69007af4001209ed038b8e6dbc7907414c8c91940ac3f0a5b7e9134a",
  "shared.frame": "7c4a2679bc556de93a237d4501ad76b453e970c83395f9e5e9fc143c562ed080",
  "shared.brandButton": "34ca1978cd82bcb20feb35d392c4426c67e7e7a056565f9353ea1fc8199b8503",
  "shared.prose": "9faa8e387a27a976e403db825c52e22dc19e8a56ab7a670d789d20b697bd48c3",
};

describe("the golden test: existing newsletters render byte for byte as they always have", () => {
  const actual = record();

  if (process.env.NL_GOLDEN_PRINT) {
    // eslint-disable-next-line no-console
    console.log(
      Object.keys(actual)
        .map((k) => `  "${k}": "${actual[k]}",`)
        .join("\n"),
    );
  }

  it("still knows the fifteen original block types", () => {
    for (const type of ORIGINAL_TYPES) expect(BLOCK_TYPES).toContain(type);
  });

  it("pins a hash for every case it renders, and nothing else", () => {
    expect(Object.keys(GOLDEN).sort()).toEqual(Object.keys(actual).sort());
    // 15 types x (4 variants + empty + sized) + 10 whole documents + 2 welcome + 3 shared parts.
    expect(Object.keys(actual)).toHaveLength(15 * 6 + 10 + 2 + 3);
  });

  it.each(Object.keys(actual))("%s is unchanged", (name) => {
    expect(actual[name]).toBe(GOLDEN[name]);
  });

  it("renders the same thing twice (no clock, no randomness in an existing block)", () => {
    expect(record()).toEqual(actual);
  });
});
