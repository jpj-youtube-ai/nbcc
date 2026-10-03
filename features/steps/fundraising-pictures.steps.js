const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const sharp = require("sharp");

// Steps for fundraising-pictures.feature (profile pictures, Jaimie, 2026-10-03). The fundraisers, the
// staff, the switch, signing an organiser in and "the fundraising answer is" are fundraising.steps.js's
// and fundraising-private.steps.js's (whose hooks also clean up: a picture goes with its fundraiser);
// opening a page is fundraising-pages.steps.js's, "the page shows" events.steps.js's, the history
// fundraising-news.steps.js's and the team's fundraising-teams.steps.js's. These add sending a photo,
// staff deciding one, and where it can be seen. The photos are made here, from nothing: a plain
// coloured picture with an invented camera note, so it can be checked that the note is gone.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const COOKIE = "nbcc_fr_session";
const PASSWORD = "pw-fundraising-bdd";
const CAMERA = "ExampleCam BDD";

async function fundraiserId(title) {
  const r = await pool.query("SELECT id FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  return r.rows[0].id;
}

async function latestPicture(title, kind) {
  const r = await pool.query(
    "SELECT id, photo_id, status, bytes FROM fundraiser_pictures WHERE fundraiser_id = $1 AND kind = $2 ORDER BY id DESC LIMIT 1",
    [await fundraiserId(title), kind],
  );
  assert.ok(r.rows[0], `no ${kind} photo on ${title}`);
  return r.rows[0];
}

function photo(width, height) {
  return sharp({ create: { width, height, channels: 3, background: { r: 192, g: 34, b: 56 } } })
    .withMetadata({ exif: { IFD0: { Make: CAMERA } } })
    .jpeg()
    .toBuffer();
}

// As the private area's page sends it: JSON, from our own origin, with the session cookie.
async function organiserCall(world, method, path, body) {
  const headers = { "Content-Type": "application/json", Origin: new URL(BASE_URL).origin };
  if (world.frSession) headers.Cookie = `${COOKIE}=${world.frSession}`;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
  return world.frBody;
}

async function login(email) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.token) return body.token;
  if (body.step === "2fa" && body.devCode) {
    const res2 = await fetch(`${BASE_URL}/api/admin/login/2fa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code: body.devCode }),
    });
    return (await res2.json().catch(() => ({}))).token;
  }
  throw new Error(`could not sign in as ${email}: ${JSON.stringify(body)}`);
}

async function staffCall(world, email, method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await login(email)}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
  return world.frBody;
}

const KINDS = { "round photo": "profile", "main photo": "main" };

// ---- a team, for its page ----

// A team with nobody added, under an address of its own. It must not add the people the team pages
// feature adds (fundraising-teams.feature): approving a team emails everyone added, those emails stay
// in email_log after the clean up, and that feature checks none has gone to them yet.
When("the team {string} signs up with nobody added, organised by {string}", async function (title, email) {
  const res = await fetch(`${BASE_URL}/api/fundraise`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: new URL(BASE_URL).origin },
    body: JSON.stringify({
      path: "raising",
      kind: "santa_dash",
      kindOther: "",
      title,
      description: "The under 12s, dashing in Santa suits.",
      eventDate: "2099-12-05",
      startTime: "",
      venue: "",
      town: "Exampleton",
      targetPence: 200000,
      public: true,
      firstName: "Robin",
      lastName: "Organiser",
      email,
      phone: "07700 900111",
      instagram: "",
      facebook: "",
      socialOk: false,
      over18: true,
      sharesWithOther: false,
      team: "team",
      teamShareMode: null,
      teamMembers: [],
      wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 0, shoutOut: false, attend: false },
      newsletterOk: false,
      company: "",
    }),
  });
  this.frStatus = res.status;
  this.frBody = await res.json().catch(() => ({}));
  assert.equal(this.frStatus, 200, JSON.stringify(this.frBody));
});

// ---- the organiser ----

When(/^the signed in organiser sends a (round photo|main photo) for "([^"]+)"$/, async function (which, title) {
  const kind = KINDS[which];
  const bytes = await photo(kind === "profile" ? 600 : 1200, kind === "profile" ? 500 : 800);
  await organiserCall(this, "POST", `/api/fundraise/manage/fundraisers/${await fundraiserId(title)}/pictures`, {
    kind,
    mime: "image/jpeg",
    dataBase64: bytes.toString("base64"),
  });
});

async function privateAreaEntry(world, title) {
  const id = await fundraiserId(title);
  const body = await organiserCall(world, "GET", "/api/fundraise/manage/pictures");
  const mine = (body.fundraisers || []).find((f) => f.id === id);
  assert.ok(mine, `${title} is not in the private area's photos`);
  assert.doesNotMatch(JSON.stringify(body), /decidedBy|admin:/);
  return mine;
}

Then("the private area says the round photo on {string} is {string}", async function (title, words) {
  const mine = await privateAreaEntry(this, title);
  const shown = mine.profile.latest || mine.profile.inUse;
  assert.equal(shown && shown.statusWords, words);
});

Then("the private area shows the note {string} on {string}", async function (note, title) {
  const mine = await privateAreaEntry(this, title);
  assert.equal(mine.profile.latest && mine.profile.latest.note, note);
});

Then("the round photo of {string} is stored without anything from the camera", async function (title) {
  const p = await latestPicture(title, "profile");
  assert.equal(p.bytes.includes(Buffer.from(CAMERA)), false);
  const meta = await sharp(p.bytes).metadata();
  assert.equal(meta.exif, undefined);
  assert.deepEqual([meta.width, meta.height], [400, 400]);
});

// ---- the public ----

async function publicStatus(title) {
  const p = await latestPicture(title, "profile");
  return fetch(`${BASE_URL}/media/fundraiser-profile/${p.photo_id}`);
}

Then("the round photo of {string} is not served to the public", async function (title) {
  assert.equal((await publicStatus(title)).status, 404);
});

Then("the round photo of {string} is served to the public", async function (title) {
  const res = await publicStatus(title);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

Then("the page shows the round photo of {string}", async function (title) {
  const p = await latestPicture(title, "profile");
  assert.ok(this.visitorBody.includes(`/media/fundraiser-profile/${p.photo_id}`), "the round photo is not on the page");
});

Then("the page has no main photo", function () {
  assert.ok(!this.visitorBody.includes('<figure class="fr-photo">'), "the page has a main photo");
});

Then("the page has the main photo staff approved for {string}", async function (title) {
  const r = await pool.query("SELECT image_src FROM fundraisers WHERE id = $1", [await fundraiserId(title)]);
  const src = r.rows[0] && r.rows[0].image_src;
  assert.match(String(src), /^\/media\/events\/[0-9a-f-]{36}$/);
  assert.ok(this.visitorBody.includes(`<figure class="fr-photo"><img src="${src}"`), "the approved main photo is not on the page");
  const res = await fetch(`${BASE_URL}${src}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
});

// ---- staff ----

When(/^"([^"]+)" approves the (round photo|main photo) on "([^"]+)"$/, async function (email, which, title) {
  const p = await latestPicture(title, KINDS[which]);
  await staffCall(this, email, "POST", `/api/admin/fundraisers/${await fundraiserId(title)}/pictures/${p.id}/approve`);
  assert.equal(this.frStatus, 200, JSON.stringify(this.frBody));
  if (KINDS[which] === "main") {
    // Each approved main photo's address, in order, to check later that an old one answers nothing.
    const r = await pool.query("SELECT image_src FROM fundraisers WHERE id = $1", [await fundraiserId(title)]);
    this.approvedMainSrcs = [...(this.approvedMainSrcs || []), r.rows[0].image_src];
  }
});

When(/^"([^"]+)" takes the (round photo|main photo) on "([^"]+)" off the page$/, async function (email, which, title) {
  const p = await latestPicture(title, KINDS[which]);
  await staffCall(this, email, "POST", `/api/admin/fundraisers/${await fundraiserId(title)}/pictures/${p.id}/remove`);
  assert.equal(this.frStatus, 200, JSON.stringify(this.frBody));
});

Then("the first approved main photo of {string} is not served to the public", async function (title) {
  const src = (this.approvedMainSrcs || [])[0];
  assert.match(String(src), /^\/media\/events\//, `no main photo of ${title} was approved`);
  assert.equal((await fetch(`${BASE_URL}${src}`)).status, 404);
});

When("{string} does not use the round photo on {string}, saying {string}", async function (email, title, reason) {
  const p = await latestPicture(title, "profile");
  await staffCall(this, email, "POST", `/api/admin/fundraisers/${await fundraiserId(title)}/pictures/${p.id}/decline`, { reason });
  assert.equal(this.frStatus, 200, JSON.stringify(this.frBody));
});
