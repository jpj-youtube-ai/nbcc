const { Before, After, AfterAll, Given, When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const sharp = require("sharp");

// Steps for features/elf-game.feature: December's doors switched off, a real door shut until its day, and
// a whole practice evening played through the preview link; and for features/elf-grand-prize.feature, a
// graduate's picture sent in for the grand prize on Christmas Eve, and Head Elf HQ's side: the entries, the one
// winner, and when the entries close and the graduates' video in Settings; and a family stopping the emails that are
// not essential from the link in one, and starting them again from Detective HQ. The families come from the elf join steps
// (features/steps/elf-join.steps.js, whose @elf-school hooks clear them, play every scenario in next
// year's December with December's doors off, and clear the practice door); the staff from "an admin user
// {string} with role {string} and password {string}" (features/steps/admin-api.steps.js, whose @admin
// hooks clear them); next year's door rows from "has opened the doors list"
// (features/steps/elf-admin-doors.steps.js); the email log count from "once the request has finished,
// {int} {string} email(s) went to {string}" (features/steps/elf-admin.steps.js). The elf worker ticks in
// the app every 30 seconds on the real clock, in CI too; the tick hook (POST /api/admin/elf/worker/tick)
// runs it once more at a time a step gives, and its claims in elf_sends mean a send goes once whichever
// tick sends it. Every family, person and place here is invented.
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const nextYear = () => new Date().getFullYear() + 1;

// The doors list makes next year's 24 door rows, and the practice evening makes a preview link: each
// scenario starts without those rows and leaves none behind, and puts the preview link back as it was.
// These touch neither the year nor December's doors switch, which the @elf-school hooks keep. A scenario
// played in last year's December (whose After hook runs after the @elf-school one, which has put the
// year back) leaves nothing of that December behind either.
Before({ tags: "@elf-game" }, async function () {
  await pool.query("DELETE FROM elf_doors WHERE year = $1", [nextYear()]);
  // Every scenario starts with no photo alert: when the next one may go is worked out from the last one
  // (and its claim), and the alerts to this feature's head elf are counted in the email log.
  await pool.query("DELETE FROM elf_alerts WHERE kind = 'photo'");
  await pool.query("DELETE FROM elf_sends WHERE kind = 'photo-alert'");
  await pool.query("DELETE FROM email_log WHERE recipient LIKE '%game.admin.bdd@example.com'");
  const r = await pool.query("SELECT preview_hash FROM elf_settings WHERE id = 1");
  this.gamePreviewBefore = r.rows[0] ? { hash: r.rows[0].preview_hash } : null;
});
After({ tags: "@elf-game" }, async function () {
  await pool.query("DELETE FROM elf_doors WHERE year = $1", [nextYear()]);
  if (this.gamePastYear) {
    // A grand prize entry's picture goes with its entry.
    for (const table of ["elf_guesses", "elf_word_tries", "elf_visits", "elf_photos", "elf_grand_prize_entries"]) {
      await pool.query(`DELETE FROM ${table} WHERE year = $1`, [this.gamePastYear]);
    }
    // The door's names and clues go with it.
    await pool.query("DELETE FROM elf_doors WHERE year = $1", [this.gamePastYear]);
  }
  if (this.gamePreviewBefore) await pool.query("UPDATE elf_settings SET preview_hash = $1 WHERE id = 1", [this.gamePreviewBefore.hash]);
  // The grand prize entries' closing and the graduates' video, as they were before a step changed them
  // (features/elf-grand-prize.feature).
  if (this.prizeClosesBefore) await pool.query("UPDATE elf_settings SET grand_prize_closes_at = $1 WHERE id = 1", [this.prizeClosesBefore.at]);
  if (this.prizeVideoBefore) await pool.query("UPDATE elf_settings SET graduate_video_url = $1 WHERE id = 1", [this.prizeVideoBefore.url]);
});
AfterAll(async () => {
  await pool.end();
});

/** A real admin session, through the sign in and its emailed code (handed back here outside production),
 *  as features/steps/elf-admin.steps.js signs in. */
async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.token) return body.token;
  if (body.step === "2fa" && body.devCode) {
    const res2 = await fetch(`${BASE_URL}/api/admin/login/2fa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code: body.devCode }),
    });
    const body2 = await res2.json().catch(() => ({}));
    return body2.token;
  }
  return undefined;
}

/** A head elf's request to Head Elf HQ's API, which must answer 200. */
async function asHeadElf(email, password, method, path, body) {
  const token = await login(email, password);
  assert.ok(token, `could not sign in as ${email}`);
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const answer = await res.json().catch(() => ({}));
  assert.equal(res.status, 200, `${method} ${path}: ${JSON.stringify(answer)}`);
  return answer;
}

/** A cookie's value from a response's Set-Cookie headers, as the elf join steps read it. */
function cookieFrom(res, name) {
  const all = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""];
  for (const line of all) {
    const m = new RegExp(`(?:^|,\\s*)${name}=([^;]*)`).exec(line);
    if (m) return m[1];
  }
  return null;
}

/** A family by its email, with the cookies its browser holds. */
function familyOf(world, email) {
  const f = (world.gameFamilies || {})[email];
  assert.ok(f, `no signed in browser kept for ${email}`);
  return f;
}

/** The Cookie header a family's browser sends: its session, and the preview link once it has opened it. */
function cookiesOf(family) {
  return `nbcc_elf_session=${family.session}` + (family.preview ? `; nbcc_elf_preview=${family.preview}` : "");
}

/** Sends a request as a family's browser (or as nobody), and keeps the answer. JSON posts carry no Origin
 *  header, as the elf join steps' posts do, so they count as from our own page. */
async function asFamily(world, family, method, path, json) {
  const headers = {};
  if (family) headers.Cookie = cookiesOf(family);
  if (json !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, redirect: "manual", body: json === undefined ? undefined : JSON.stringify(json) });
  world.gameStatus = res.status;
  world.gameType = res.headers.get("content-type") || "";
  world.gameText = await res.text();
  try {
    world.gameBody = JSON.parse(world.gameText);
  } catch {
    world.gameBody = null;
  }
  return world.gameBody;
}

async function detectiveIdOf(email) {
  const r = await pool.query("SELECT d.id FROM elf_detectives d JOIN elf_families f ON f.id = d.family_id WHERE f.email = $1 ORDER BY d.id LIMIT 1", [email]);
  assert.ok(r.rows[0], `no detective for ${email}`);
  return r.rows[0].id;
}

/** A real door's poster code this year, as the server sees the year (the hooks make it next year). */
async function posterCodeOf(door) {
  const r = await pool.query("SELECT poster_code FROM elf_doors WHERE year = (SELECT year FROM elf_settings WHERE id = 1) AND door = $1", [door]);
  assert.ok(r.rows[0], `door ${door} has no row: open the doors list first`);
  return r.rows[0].poster_code;
}

/** The practice door's own row: its word and its poster code. */
async function practiceRow() {
  const r = await pool.query("SELECT tag_word, poster_code FROM elf_practice WHERE id = 1");
  assert.ok(r.rows[0], "no practice evening is running");
  return r.rows[0];
}

/** A real 4 by 4 red JPEG, made here from nothing as test/unit/fixtures/tiny-jpeg.ts makes it. */
function tinyJpeg() {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 0, b: 0 } } })
    .jpeg()
    .toBuffer();
}

const sentence = (world) => `${world.gameStatus}: ${String(world.gameText).slice(0, 400)}`;

// ---- the families ------------------------------------------------------------------------------------

// The signed in browser from "the paying browser comes back from Stripe", kept under the family's email
// so two families can each keep their own cookies.
Given("that browser is the family {string}", function (email) {
  assert.ok(this.elfSignedIn, "the family was signed in first");
  this.gameFamilies = this.gameFamilies || {};
  this.gameFamilies[email] = { session: this.elfSignedIn, preview: null };
});

When("the family {string} opens {string}", async function (email, path) {
  await asFamily(this, familyOf(this, email), "GET", path);
});

When("the family {string} opens the poster page of door {int}", async function (email, door) {
  await asFamily(this, familyOf(this, email), "GET", `/elf/p/${await posterCodeOf(door)}`);
});

When("someone signed out opens the poster page of door {int}", async function (door) {
  await asFamily(this, null, "GET", `/elf/p/${await posterCodeOf(door)}`);
});

Then("the game answers {int}", function (status) {
  assert.equal(this.gameStatus, status, sentence(this));
});

Then("the game answers {int} with the reason {string}", function (status, reason) {
  assert.equal(this.gameStatus, status, sentence(this));
  assert.equal(this.gameBody && this.gameBody.reason, reason, sentence(this));
});

Then("the game page holds {int} clue(s)", function (n) {
  assert.equal(this.gameStatus, 200, sentence(this));
  assert.equal((String(this.gameText).match(/<li class="elf-clue">/g) || []).length, n, sentence(this));
});

Then("the game page says {string}", function (words) {
  assert.ok(String(this.gameText).includes(words), `expected "${words}" in ${sentence(this)}`);
});

Then("the game page carries the chip {string}", function (words) {
  const chip = new RegExp(`<span class="elf-chip[^"]*">${words}</span>`);
  assert.match(String(this.gameText), chip, sentence(this));
});

// ---- a real door, next year ------------------------------------------------------------------------------

Given("December's doors are switched on", async function () {
  await pool.query("UPDATE elf_settings SET doors_on = true WHERE id = 1");
});

Given("door {int}'s tag word is {string}", async function (door, word) {
  const r = await pool.query("UPDATE elf_doors SET tag_word = $1 WHERE year = (SELECT year FROM elf_settings WHERE id = 1) AND door = $2", [word, door]);
  assert.equal(r.rowCount, 1, `door ${door} has no row: open the doors list first`);
});

/** The word on a door's tag, typed as the poster page's script sends it. */
async function typeWord(world, email, code, word) {
  return asFamily(world, familyOf(world, email), "POST", "/api/elf/word", { code, detectiveIds: [String(await detectiveIdOf(email))], word });
}

When("the family {string} types the word {string} at door {int}", async function (email, word, door) {
  await typeWord(this, email, await posterCodeOf(door), word);
});

Then("the family has {int} tries left at that door", function (n) {
  assert.equal(this.gameBody && this.gameBody.triesLeft, n, sentence(this));
});

When("the family {string} types {int} more wrong words at door {int}", async function (email, count, door) {
  const code = await posterCodeOf(door);
  this.gameAnswers = [];
  for (let i = 0; i < count; i++) {
    await typeWord(this, email, code, `snowball 99${i}`);
    this.gameAnswers.push({ status: this.gameStatus, reason: this.gameBody && this.gameBody.reason, triesLeft: this.gameBody && this.gameBody.triesLeft });
  }
});

Then("each was refused as a wrong word, the last with no tries left", function () {
  const answers = this.gameAnswers || [];
  assert.ok(answers.length > 0, "no words were typed");
  for (const a of answers) {
    assert.equal(a.status, 400, JSON.stringify(answers));
    assert.equal(a.reason, "wrong-word", JSON.stringify(answers));
  }
  assert.equal(answers[answers.length - 1].triesLeft, 0, JSON.stringify(answers));
});

When("the family {string} guesses {string} for door {int}", async function (email, text, door) {
  await asFamily(this, familyOf(this, email), "POST", "/api/elf/guess", { door, text });
});

// ---- the practice evening ----------------------------------------------------------------------------------

Given("{string} with password {string} makes a preview link", async function (email, password) {
  const answer = await asHeadElf(email, password, "POST", "/api/admin/elf/preview");
  const m = /\/elf\/preview\/([0-9a-f]{64})$/.exec(String(answer.url));
  assert.ok(m, `no preview link in ${JSON.stringify(answer)}`);
  this.gamePreviewToken = m[1];
});

Given("{string} with password {string} starts a practice evening at {string} in {string}, {int} minute(s) apart", async function (email, password, placeName, placeTown, minutesApart) {
  const answer = await asHeadElf(email, password, "POST", "/api/admin/elf/practice", { placeName, placeTown, minutesApart });
  // Taken once the answer is here, so the server's own start is no later than this.
  this.gamePracticeStartedAt = Date.now();
  const p = answer.practice;
  assert.ok(p && p.tagWord, JSON.stringify(answer));
  assert.equal(p.placeName, placeName);
  assert.equal(p.found, false);
  // Absolute times: clue 1 a minute after the start, then the gap asked for.
  const clue1 = Date.parse(p.clue1At);
  assert.ok(Math.abs(clue1 - (this.gamePracticeStartedAt + 60_000)) < 10_000, `clue 1 at ${p.clue1At}`);
  assert.equal(Date.parse(p.clue2At) - clue1, minutesApart * 60_000);
  assert.equal(Date.parse(p.revealAt) - Date.parse(p.clue3At), minutesApart * 60_000);
});

When("the family {string} opens the preview link", async function (email) {
  assert.ok(this.gamePreviewToken, "a preview link was made first");
  const family = familyOf(this, email);
  const res = await fetch(`${BASE_URL}/elf/preview/${this.gamePreviewToken}`, { redirect: "manual", headers: { Cookie: cookiesOf(family) } });
  assert.equal(res.status, 303, `the preview link answered ${res.status}`);
  family.preview = cookieFrom(res, "nbcc_elf_preview");
  assert.ok(family.preview, "the preview link set its cookie");
});

// Clue 1 comes out a minute after the start; by 65 seconds it is out, and clue 2 is still a minute away.
When("65 seconds have passed since the practice evening started", { timeout: 90 * 1000 }, async function () {
  assert.ok(this.gamePracticeStartedAt, "a practice evening was started first");
  const wait = this.gamePracticeStartedAt + 65_000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
});

When("the family {string} guesses {string} for the practice door", async function (email, text) {
  await asFamily(this, familyOf(this, email), "POST", "/api/elf/guess", { door: 0, text });
});

Then("the guess is saved", function () {
  assert.equal(this.gameStatus, 200, sentence(this));
  assert.equal(this.gameBody && this.gameBody.ok, true, sentence(this));
});

When("the family {string} types the practice door's word with one detective", async function (email) {
  const practice = await practiceRow();
  await typeWord(this, email, practice.poster_code, practice.tag_word);
});

Then("the word wins, and the card says {string}", function (words) {
  assert.equal(this.gameStatus, 200, sentence(this));
  assert.equal(this.gameBody.outcome, "won", sentence(this));
  assert.ok(String(this.gameBody.html).includes(words), sentence(this));
});

Then("the word is a visit, and the card says {string}", function (words) {
  assert.equal(this.gameStatus, 200, sentence(this));
  assert.equal(this.gameBody.outcome, "visited", sentence(this));
  assert.ok(String(this.gameBody.html).includes(words), sentence(this));
});

When("the family {string} sends a photo to the practice door, saying yes to showing it", async function (email) {
  const practice = await practiceRow();
  const jpeg = await tinyJpeg();
  this.gamePhotoFrom = email;
  await asFamily(this, familyOf(this, email), "POST", `/api/elf/p/${practice.poster_code}/photo`, { mime: "image/jpeg", dataBase64: jpeg.toString("base64"), consent: true });
});

// The photo is kept as the family's that sent it, so a scenario with two families' photos can name each.
Then("the photo is waiting, with a token", async function () {
  assert.equal(this.gameStatus, 202, sentence(this));
  assert.equal(this.gameBody.status, "waiting", sentence(this));
  assert.match(String(this.gameBody.token), /^[a-km-np-z2-9]{12}$/);
  this.gamePhotoToken = this.gameBody.token;
  const r = await pool.query("SELECT id FROM elf_photos WHERE token = $1 AND year = 0 AND door = 0", [this.gamePhotoToken]);
  assert.ok(r.rows[0], "the photo was kept as the practice door's");
  this.gamePhotoId = r.rows[0].id;
  this.gamePhotos = this.gamePhotos || {};
  this.gamePhotos[this.gamePhotoFrom] = { token: this.gamePhotoToken, id: this.gamePhotoId };
});

/** The photo a family sent in this scenario. */
function photoFrom(world, email) {
  const photo = (world.gamePhotos || {})[email];
  assert.ok(photo, `${email} has sent no photo in this scenario`);
  return photo;
}

// Asked for by the browser that sent it, holding the preview link, so only the photo's own rules answer:
// it waits for a head elf, and the practice door's place is still hidden.
When("the family {string} asks for that photo", async function (email) {
  assert.ok(this.gamePhotoToken, "a photo was sent first");
  await asFamily(this, familyOf(this, email), "GET", `/elf/door/0/photo/${this.gamePhotoToken}.jpg`);
});

When("clue 2 and clue 3 of the practice door are out", async function () {
  await pool.query("UPDATE elf_practice SET clue2_at = now() - interval '1 minute', clue3_at = now() - interval '1 minute' WHERE id = 1");
});

When("the practice door's place is shown", async function () {
  await pool.query("UPDATE elf_practice SET reveal_at = now() - interval '1 minute' WHERE id = 1");
});

Then("the family's marks are empty: the practice door never counts", function () {
  assert.deepEqual(this.gameBody, { doors: [], photos: [] }, sentence(this));
});

When("{string} with password {string} clears the practice", async function (email, password) {
  const answer = await asHeadElf(email, password, "DELETE", "/api/admin/elf/practice");
  assert.equal(answer.practice, null, JSON.stringify(answer));
});

// ---- the photo check, the alerts and the elf worker --------------------------------------------------------

When("{string} with password {string} gives themselves the mobile {string}", async function (email, password, mobile) {
  const answer = await asHeadElf(email, password, "PATCH", "/api/admin/elf/alerts/me", { mobile });
  const me = (answer.people || []).find((p) => p.me);
  assert.ok(me && me.mobile, `no mobile kept: ${JSON.stringify(answer.people)}`);
});

/** A clock time today in London, as a moment: London is UTC in winter and an hour ahead in summer, so the
 *  same clock time in UTC is moved by however far London's clock reads from it. For daytime times only. */
function todayInLondon(clock) {
  const [hours, minutes] = clock.split(":").map(Number);
  const partsOf = (format, at) => Object.fromEntries(format.formatToParts(at).map((p) => [p.type, p.value]));
  const date = partsOf(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }), new Date());
  const guess = Date.UTC(Number(date.year), Number(date.month) - 1, Number(date.day), hours, minutes);
  const shown = partsOf(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), new Date(guess));
  const drift = Number(shown.hour) * 60 + Number(shown.minute) - (hours * 60 + minutes);
  return new Date(guess - drift * 60_000);
}

/** Runs the elf worker's tick once, at a moment of the step's choosing (outside production only). */
async function tickAt(email, password, at) {
  const answer = await asHeadElf(email, password, "POST", "/api/admin/elf/worker/tick", { at: at.toISOString() });
  assert.deepEqual(answer, { ok: true });
}

When("{string} with password {string} runs the elf worker at {string} today, London time", async function (email, password, clock) {
  await tickAt(email, password, todayInLondon(clock));
});

// February is on GMT, so midday in London is midday UTC. 1 February is past the 31 January that clears
// last year's photos, whatever day this runs.
When("{string} with password {string} runs the elf worker at midday on 1 February this year", async function (email, password) {
  await tickAt(email, password, new Date(Date.UTC(new Date().getFullYear(), 1, 1, 12, 0)));
});

// A minute after a door's first clue, in Elf Detective School's own year (features/elf-grand-prize.feature): worked
// out from the year and the door's own evening as Head Elf HQ's doors answer gives it, the times the worker itself
// reads, never from a time written in a feature. A door's first clue is 10am on a weekend and 5:30pm on a school
// day unless a head elf types another, so the same door falls at different times in different years. December has
// no clock change, so London is UTC then. The tick route answers once the whole tick has run.
When("{string} with password {string} runs the elf worker a minute after door {int}'s first clue", async function (email, password, door) {
  const sheet = await asHeadElf(email, password, "GET", `/api/admin/elf/doors/${door}`);
  const evening = sheet.door && sheet.door.evening;
  const clue1 = evening ? String(evening.clue1) : "";
  assert.match(clue1, /^\d{1,2}:\d{2}$/, `door ${door}'s first clue as Head Elf HQ gives it: ${JSON.stringify(evening)}`);
  const [hours, minutes] = clue1.split(":").map(Number);
  await tickAt(email, password, new Date(Date.UTC(await schoolYear(), 11, door, hours, minutes + 1)));
});

// The alert's record is written just after its emails and texts, by whichever tick sent it: so the last
// alert is read until it is there.
Then("{string} with password {string} sees the last photo alert, with no text that failed", async function (email, password) {
  let answer = {};
  for (let i = 0; i < 20; i++) {
    answer = await asHeadElf(email, password, "GET", "/api/admin/elf/alerts");
    if (answer.lastAlert) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(answer.lastAlert, `no photo alert went: ${JSON.stringify(answer)}`);
  assert.deepEqual(answer.lastAlert.textsFailed, []);
});

// The texts are counted in the alert's own record (Settings > Alerts shows only whose text did not go).
// Only this scenario's head elf has a mobile: no other step gives one, and the @admin hooks remove the
// test head elves (their mobiles with them) before every scenario.
Then("the last photo alert went by text to {int} head elf/elves", async function (n) {
  const r = await pool.query("SELECT texts, texts_failed FROM elf_alerts WHERE kind = 'photo' ORDER BY sent_at DESC, id DESC LIMIT 1");
  assert.ok(r.rows[0], "no photo alert is on record");
  assert.equal(r.rows[0].texts, n, JSON.stringify(r.rows[0]));
  assert.deepEqual(r.rows[0].texts_failed, []);
});

When("{string} with password {string} reads the photos waiting", async function (email, password) {
  this.gamePhotosAnswer = await asHeadElf(email, password, "GET", "/api/admin/elf/photos");
});

Then("the photos waiting are the practice door's, from {string} and {string}", function (one, other) {
  const waiting = (this.gamePhotosAnswer && this.gamePhotosAnswer.waiting) || [];
  for (const email of [one, other]) {
    const photo = photoFrom(this, email);
    const row = waiting.find((w) => w.id === photo.id);
    assert.ok(row, `${email}'s photo is not waiting: ${JSON.stringify(waiting.map((w) => w.id))}`);
    assert.equal(row.token, photo.token);
    assert.equal(row.door, 0);
    assert.equal(row.practice, true);
  }
});

When("{string} with password {string} approves the photo from {string}", async function (email, password, family) {
  this.gameHeadElf = { email, password };
  const answer = await asHeadElf(email, password, "POST", `/api/admin/elf/photos/${photoFrom(this, family).id}/approve`);
  assert.deepEqual(answer, { ok: true });
});

Then("the photo log's newest step for the photo from {string} starts {string}", async function (family, words) {
  assert.ok(this.gameHeadElf, "a head elf checked a photo first");
  const photo = photoFrom(this, family);
  const answer = await asHeadElf(this.gameHeadElf.email, this.gameHeadElf.password, "GET", "/api/admin/elf/photos");
  const row = (answer.log || []).find((r) => r.id === photo.id);
  assert.ok(row, `the photo log has no line for ${family}'s photo`);
  const newest = row.steps[row.steps.length - 1];
  assert.ok(newest && String(newest.words).startsWith(words), JSON.stringify(row.steps));
});

// Asked for by a browser holding the preview link, so only the photo's own rules answer.
When("the family {string} asks for the photo from {string}", async function (email, from) {
  await asFamily(this, familyOf(this, email), "GET", `/elf/door/0/photo/${photoFrom(this, from).token}.jpg`);
});

When("the family {string} takes its photo down from the practice door's poster", async function (email) {
  const practice = await practiceRow();
  await asFamily(this, familyOf(this, email), "DELETE", `/api/elf/p/${practice.poster_code}/photo`);
});

Then("the photo from {string} is taken down, with its bytes gone", async function (family) {
  const photo = photoFrom(this, family);
  const r = await pool.query("SELECT status, taken_down_by FROM elf_photos WHERE id = $1", [photo.id]);
  assert.equal(r.rows[0].status, "taken-down");
  assert.equal(r.rows[0].taken_down_by, "family");
  const files = await pool.query("SELECT count(*)::int AS n FROM elf_photo_files WHERE photo_id = $1", [photo.id]);
  assert.equal(files.rows[0].n, 0, "the photo's bytes are still there");
});

// ---- a real door, played in a December that is over ----------------------------------------------------
//
// A real door keeps clock times on its own day, December n of the school's year (elf_doors), where the
// practice door keeps instants. So with next year's year no SQL on a door can bring its evening into the
// past, and no real door can be hunted in CI without a date bomb: these steps play in last year's
// December, which is always over. The @elf-school After hook puts the year back; the @elf-game After hook
// above takes last year's rows away.

/** The school's year as the server reads it. */
async function schoolYear() {
  return (await pool.query("SELECT year FROM elf_settings WHERE id = 1")).rows[0].year;
}

async function familyIdOf(email) {
  const r = await pool.query("SELECT id FROM elf_families WHERE email = $1", [email]);
  assert.ok(r.rows[0], `no family ${email}`);
  return r.rows[0].id;
}

/** A place's name as a guess is compared: normalisePlaceName (src/elf/place-names.ts), for plain letters. */
const placeNorm = (name) =>
  String(name)
    .toLowerCase()
    .trim()
    .replace(/^the(?![a-z0-9])/, "")
    .replace(/[^a-z0-9]/g, "");

Given("the school's year is last year, whose December is over", async function () {
  const year = new Date().getFullYear() - 1;
  // Only ever on a test database: a December that already holds doors is never played over.
  const had = await pool.query("SELECT count(*)::int AS n FROM elf_doors WHERE year = $1", [year]);
  assert.equal(had.rows[0].n, 0, `${year} already has doors in this database, so this scenario will not play over them`);
  this.gamePastYear = year;
  await pool.query("UPDATE elf_settings SET year = $1 WHERE id = 1", [year]);
});

// Every door row is made with a usable tag word: with a place and a first clue too, the door can run, so
// it is never snowed in.
Given("door {int} is ready to run at {string} in {string}, with the prize {string}", async function (door, placeName, placeTown, prize) {
  const year = await schoolYear();
  const r = await pool.query("UPDATE elf_doors SET place_name = $1, place_town = $2, prize = $3 WHERE year = $4 AND door = $5", [placeName, placeTown, prize, year, door]);
  assert.equal(r.rowCount, 1, `door ${door} has no row: open the doors list first`);
  await pool.query(
    `INSERT INTO elf_clues (year, door, n, words) VALUES ($1, $2, 1, $3)
     ON CONFLICT (year, door, n) DO UPDATE SET words = EXCLUDED.words`,
    [year, door, "Pretend clue 1: it lives where the bread lives."],
  );
});

// A guess can only be typed while its door is hunted, which a December that is over never is: this one is
// kept as if typed at noon on 1 December, before the door's evening.
Given("the family {string} guessed {string} for door {int} before its evening", async function (email, text, door) {
  const year = await schoolYear();
  await pool.query("INSERT INTO elf_guesses (year, door, family_id, text, norm, saved_at) VALUES ($1, $2, $3, $4, $5, $6)", [
    year,
    door,
    await familyIdOf(email),
    text,
    placeNorm(text),
    new Date(Date.UTC(year, 11, 1, 12)),
  ]);
});

When("{string} with password {string} clears the wrong words of {string} at door {int}", async function (email, password, familyEmail, door) {
  const id = await familyIdOf(familyEmail);
  const sheet = await asHeadElf(email, password, "GET", `/api/admin/elf/families/${id}`);
  assert.deepEqual(sheet.wordTries, [{ door, wrong: 1 }], JSON.stringify(sheet.wordTries));
  const cleared = await asHeadElf(email, password, "POST", `/api/admin/elf/families/${id}/word-tries/clear`, { door });
  assert.deepEqual(cleared.wordTries, [], JSON.stringify(cleared));
});

Then("the family {string} has no wrong words left at door {int}", async function (email, door) {
  const r = await pool.query("SELECT wrong FROM elf_word_tries WHERE year = $1 AND door = $2 AND family_id = $3", [await schoolYear(), door, await familyIdOf(email)]);
  assert.equal(r.rows.length, 1, JSON.stringify(r.rows));
  assert.equal(r.rows[0].wrong, 0);
});

Then("door {int} was found by the family {string}", async function (door, email) {
  const year = await schoolYear();
  const family = await familyIdOf(email);
  const r = await pool.query("SELECT found_at, found_family_id FROM elf_doors WHERE year = $1 AND door = $2", [year, door]);
  assert.ok(r.rows[0] && r.rows[0].found_at, `door ${door} was not found`);
  assert.equal(r.rows[0].found_family_id, family);
  const visits = await pool.query("SELECT found FROM elf_visits WHERE year = $1 AND door = $2 AND family_id = $3", [year, door, family]);
  assert.deepEqual(
    visits.rows.map((v) => v.found),
    [true],
  );
});

When("the family {string} sends a photo to door {int}, saying yes to showing it", { timeout: 20 * 1000 }, async function (email, door) {
  const jpeg = await tinyJpeg();
  await asFamily(this, familyOf(this, email), "POST", `/api/elf/p/${await posterCodeOf(door)}/photo`, { mime: "image/jpeg", dataBase64: jpeg.toString("base64"), consent: true });
});

// The answer says the photo is waiting. Its row is not checked for that: a December that is over is past
// its 31 January, so the elf worker's own tick may clear it away the moment it is kept.
Then("the photo for door {int} was kept, with a token", async function (door) {
  assert.equal(this.gameStatus, 202, sentence(this));
  assert.equal(this.gameBody.status, "waiting", sentence(this));
  assert.match(String(this.gameBody.token), /^[a-km-np-z2-9]{12}$/);
  this.gamePhotoToken = this.gameBody.token;
  const r = await pool.query("SELECT id FROM elf_photos WHERE token = $1 AND year = $2 AND door = $3", [this.gamePhotoToken, await schoolYear(), door]);
  assert.ok(r.rows[0], `the photo was not kept as door ${door}'s`);
  this.gamePhotoId = r.rows[0].id;
});

// The January clear out: the row stays for the log, reading deleted, and its bytes are gone.
Then("that photo has been cleared away, with its bytes gone", async function () {
  assert.ok(this.gamePhotoId, "a photo was sent first");
  const r = await pool.query("SELECT status, deleted_at FROM elf_photos WHERE id = $1", [this.gamePhotoId]);
  assert.equal(r.rows[0].status, "deleted");
  assert.ok(r.rows[0].deleted_at, "the photo has no time it was deleted");
  const files = await pool.query("SELECT count(*)::int AS n FROM elf_photo_files WHERE photo_id = $1", [this.gamePhotoId]);
  assert.equal(files.rows[0].n, 0, "the photo's bytes are still there");
});

When("someone signed out asks for that photo at door {int}", async function (door) {
  assert.ok(this.gamePhotoToken, "a photo was sent first");
  await asFamily(this, null, "GET", `/elf/door/${door}/photo/${this.gamePhotoToken}.jpg`);
});

Then("the game answers {int} with a picture of type {string}", function (status, type) {
  assert.equal(this.gameStatus, status, `${this.gameStatus}: ${this.gameType}`);
  assert.equal(String(this.gameType).split(";")[0].trim(), type);
});

When("someone signed out asks for the elf of the visit of {string} to door {int}", { timeout: 20 * 1000 }, async function (email, door) {
  const r = await pool.query("SELECT id FROM elf_visits WHERE year = $1 AND door = $2 AND family_id = $3", [await schoolYear(), door, await familyIdOf(email)]);
  assert.equal(r.rows.length, 1, `${email} has no one visit to door ${door}: ${JSON.stringify(r.rows)}`);
  this.gameVisit = { id: r.rows[0].id, door };
  await asFamily(this, null, "GET", `/elf/door/${door}/elf/${this.gameVisit.id}.png`);
});

When("that visit is moved to count from an hour from now", async function () {
  assert.ok(this.gameVisit, "a visit was asked for first");
  await pool.query("UPDATE elf_visits SET counts_from = now() + interval '1 hour' WHERE id = $1", [this.gameVisit.id]);
});

When("that visit is moved back to count from a minute ago", async function () {
  assert.ok(this.gameVisit, "a visit was asked for first");
  await pool.query("UPDATE elf_visits SET counts_from = now() - interval '1 minute' WHERE id = $1", [this.gameVisit.id]);
});

When("someone signed out asks for the elf of that visit", { timeout: 20 * 1000 }, async function () {
  assert.ok(this.gameVisit, "a visit was asked for first");
  await asFamily(this, null, "GET", `/elf/door/${this.gameVisit.door}/elf/${this.gameVisit.id}.png`);
});

/** A door's tile and detail together, as the calendar's door feed draws them. */
const doorSaid = (world) => (world.gameBody ? `${world.gameBody.tile || ""}${world.gameBody.detail || ""}` : "");

// The calendar is built at most once every 15 seconds and shared, so a door can take that long to show what
// has just happened. Each build also snows in every door not ready at its first clue (only once
// December's doors are on).
When("someone signed out reads door {int} on the calendar until it says {string}", { timeout: 45 * 1000 }, async function (door, words) {
  const until = Date.now() + 40_000;
  for (;;) {
    await asFamily(this, null, "GET", `/api/elf/door/${door}`);
    if (this.gameStatus === 200 && doorSaid(this).includes(words)) return;
    assert.ok(Date.now() < until, `door ${door} never said "${words}": ${sentence(this)}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
});

Then("door {int} on the calendar says {string}", async function (door, words) {
  await asFamily(this, null, "GET", `/api/elf/door/${door}`);
  assert.equal(this.gameStatus, 200, sentence(this));
  assert.ok(doorSaid(this).includes(words), `door ${door} does not say "${words}": ${sentence(this)}`);
});

// The calendar everyone shares names no open door's place before Christmas Day, nor from 1 January (Plan
// 2c-1). Read signed out, from the door feed.
Then("door {int} on the calendar does not say {string}", async function (door, words) {
  await asFamily(this, null, "GET", `/api/elf/door/${door}`);
  assert.equal(this.gameStatus, 200, sentence(this));
  assert.ok(!doorSaid(this).includes(words), `door ${door} on the calendar says "${words}": ${sentence(this)}`);
});

// /api/elf/me with December's doors on: `known` holds the doors whose place the family can see, and `goes`
// the doors it may still have a go at: none, once Christmas Day has come.
Then("the family can see door {int}'s place, and has no doors left to crack", function (door) {
  assert.equal(this.gameStatus, 200, sentence(this));
  const known = (this.gameBody && this.gameBody.known) || [];
  assert.ok(known.includes(door), `door ${door} is not in known: ${sentence(this)}`);
  assert.deepEqual(this.gameBody.goes, [], sentence(this));
});

// The family's own door (/api/elf/me/door/:n): its tile and detail, drawn as the door feed draws a door.
Then("the family's own door says {string}", function (words) {
  assert.equal(this.gameStatus, 200, sentence(this));
  assert.ok(doorSaid(this).includes(words), `the family's own door does not say "${words}": ${sentence(this)}`);
});

// Every door of the family's own in one answer (/api/elf/me/doors), which the calendar's script draws when the
// page loads: each door's number, tile and detail, with every door's photos read in one query.
Then("the family's own doors are door {int} alone, and it says {string}", function (door, words) {
  assert.equal(this.gameStatus, 200, sentence(this));
  const doors = (this.gameBody && this.gameBody.doors) || [];
  assert.deepEqual(
    doors.map((d) => d.door),
    [door],
    sentence(this),
  );
  assert.ok(`${doors[0].tile || ""}${doors[0].detail || ""}`.includes(words), `the family's own door ${door} does not say "${words}": ${sentence(this)}`);
});

Then("door {int}'s scrapbook shows {string} first, then {string}", async function (door, first, then) {
  await asFamily(this, null, "GET", `/api/elf/door/${door}`);
  const detail = String((this.gameBody && this.gameBody.detail) || "");
  const collage = /<div class="elf-collage">([\s\S]*?)<\/div>/.exec(detail);
  assert.ok(collage, `door ${door} has no scrapbook: ${sentence(this)}`);
  const names = [...collage[1].matchAll(/<figcaption>([^<]*)<\/figcaption>/g)].map((m) => m[1]);
  assert.deepEqual(names, [first, then], collage[1].slice(0, 400));
  // The finder's polaroid comes first and wears the rosette.
  assert.ok(collage[1].startsWith('<figure class="elf-pol elf-pol--first">'), collage[1].slice(0, 200));
  assert.ok(collage[1].includes("FOUND FIRST!"));
});

Then("door {int} was snowed in automatically", async function (door) {
  const r = await pool.query("SELECT snow_day_at, snow_day_by FROM elf_doors WHERE year = $1 AND door = $2", [await schoolYear(), door]);
  assert.ok(r.rows[0] && r.rows[0].snow_day_at, `door ${door} was not snowed in`);
  assert.equal(r.rows[0].snow_day_by, "automatic");
});

Then("the family's marks say door {int} is cracked and visited, and door {int} is snowed in", function (done, snowed) {
  assert.equal(this.gameStatus, 200, sentence(this));
  const doors = (this.gameBody && this.gameBody.doors) || [];
  assert.deepEqual(
    doors.find((d) => d.door === done),
    { door: done, cracked: true, visited: true, snow: false },
    sentence(this),
  );
  assert.deepEqual(
    doors.find((d) => d.door === snowed),
    { door: snowed, cracked: false, visited: false, snow: true },
    sentence(this),
  );
});

// ---- having a go (Plan 2c-1) --------------------------------------------------------------------------------
//
// A family that missed a door's evening has a go at it on the door's own page in Detective HQ: the clues one
// at a time, then one guess, kept to one by the database. Played on the practice door, whose times are
// absolute, so no step compares the real clock with a date written here.

// The practice evening put three hours back: its clues out, its reveal two and a half hours ago and its
// closing (an hour after the reveal) an hour and a half ago, with nobody found. So its place has been shown
// with its elf still hiding, and a family that missed it may have a go.
When("the practice door's place is shown with its elf still hiding", async function () {
  const r = await pool.query(
    `UPDATE elf_practice SET clue1_at = now() - interval '3 hours', clue2_at = now() - interval '170 minutes',
       clue3_at = now() - interval '160 minutes', reveal_at = now() - interval '150 minutes' WHERE id = 1`,
  );
  assert.equal(r.rowCount, 1, "no practice evening is running");
});

When("the family {string} has a go at the practice door with {string}", async function (email, text) {
  await asFamily(this, familyOf(this, email), "POST", "/elf/hq/door/0/go", { text });
});

/** A go at the practice door, as a script would send it: JSON to the door's own address (the go page itself
 *  posts a plain form, with no script). The answer is handed back rather than kept as the world's one
 *  answer, so two sent together each keep their own. */
async function goAtPractice(family, text) {
  const res = await fetch(`${BASE_URL}/elf/hq/door/0/go`, {
    method: "POST",
    headers: { Cookie: cookiesOf(family), "Content-Type": "application/json" },
    redirect: "manual",
    body: JSON.stringify({ text }),
  });
  const said = await res.text();
  let body = null;
  try {
    body = JSON.parse(said);
  } catch {
    body = null;
  }
  return { status: res.status, body, said: said.slice(0, 400) };
}

// Two tabs press Lock in my guess at the same moment. Promise.all keeps the order the posts were sent in,
// not the order they finished in, so the answers are compared sorted.
When("the family {string} has a go at the practice door with {string} from two tabs at once", async function (email, text) {
  const family = familyOf(this, email);
  this.gameGoes = await Promise.all([goAtPractice(family, text), goAtPractice(family, text)]);
});

Then("one go was taken and the other refused, and the go says {string}", function (words) {
  const goes = [...(this.gameGoes || [])].sort((a, b) => a.status - b.status);
  const told = JSON.stringify(goes);
  assert.deepEqual(
    goes.map((g) => g.status),
    [200, 409],
    told,
  );
  assert.equal(goes[1].body && goes[1].body.reason, "already", told);
  assert.ok(String(goes[0].body && goes[0].body.message).includes(words), told);
});

Then("the go says {string}", function (words) {
  assert.ok(String(this.gameBody && this.gameBody.message).includes(words), `the go does not say "${words}": ${sentence(this)}`);
});

Then("nothing of the practice door is left", async function () {
  for (const table of ["elf_guesses", "elf_word_tries", "elf_visits", "elf_photos"]) {
    const r = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE year = 0`);
    assert.equal(r.rows[0].n, 0, `${table} still has practice rows`);
  }
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM elf_practice")).rows[0].n, 0, "the practice row is still there");
  if (this.gamePhotoId) {
    const files = await pool.query("SELECT count(*)::int AS n FROM elf_photo_files WHERE photo_id = $1", [this.gamePhotoId]);
    assert.equal(files.rows[0].n, 0, "the photo's bytes are still there");
  }
});

// ---- the grand prize (Plan 2c-2, features/elf-grand-prize.feature) ----------------------------------------
//
// Played in last year's December, whose 24 doors and Christmas are always over. The entries' closing is a moment
// set by SQL from the database's own clock, never a date written here, so every answer holds whenever this runs.
// The closing as it was is kept in the world the first time a step moves it, and the @elf-game After hook puts
// it back.

async function keepPrizeClosing(world) {
  if (world.prizeClosesBefore) return;
  const r = await pool.query("SELECT grand_prize_closes_at FROM elf_settings WHERE id = 1");
  world.prizeClosesBefore = { at: r.rows[0] ? r.rows[0].grand_prize_closes_at : null };
}

Given("the grand prize entries close an hour from now", async function () {
  await keepPrizeClosing(this);
  await pool.query("UPDATE elf_settings SET grand_prize_closes_at = now() + interval '1 hour' WHERE id = 1");
});

Given("the grand prize entries closed a minute ago", async function () {
  await keepPrizeClosing(this);
  await pool.query("UPDATE elf_settings SET grand_prize_closes_at = now() - interval '1 minute' WHERE id = 1");
});

// What makes a family that has been to that one door a graduate: every other door of the school's year snowed in.
Then("every door but door {int} is snowed in", async function (door) {
  const r = await pool.query("SELECT door, snow_day_at FROM elf_doors WHERE year = (SELECT year FROM elf_settings WHERE id = 1) ORDER BY door");
  assert.equal(r.rows.length, 24, JSON.stringify(r.rows.map((x) => x.door)));
  assert.deepEqual(
    r.rows.filter((x) => x.snow_day_at === null).map((x) => x.door),
    [door],
  );
});

When("the family {string} opens its detective's entry page", async function (email) {
  await asFamily(this, familyOf(this, email), "GET", `/elf/hq/entry/${await detectiveIdOf(email)}`);
});

/** A graduate's picture for the grand prize, as the entry page's script sends it: a real JPEG in base64, with
 *  the mobile when one is given. */
async function sendEntry(world, email, mobile) {
  const jpeg = await tinyJpeg();
  const json = { mime: "image/jpeg", dataBase64: jpeg.toString("base64") };
  if (mobile !== undefined) json.mobile = mobile;
  await asFamily(world, familyOf(world, email), "POST", `/api/elf/entry/${await detectiveIdOf(email)}`, json);
}

When("the family {string} sends its detective's picture for the grand prize", { timeout: 20 * 1000 }, async function (email) {
  await sendEntry(this, email);
});

When("the family {string} sends its detective's picture for the grand prize, with the mobile {string}", { timeout: 20 * 1000 }, async function (email, mobile) {
  await sendEntry(this, email, mobile);
});

// The picture's own route, as the entry page shows it (GET /elf/hq/entry/:detective/picture.jpg): asked for as the
// family `email`, for the first detective of the family `owner`. It goes to its own family only, so for another
// family's detective it is not found.
When("the family {string} asks for the grand prize picture of the detective of {string}", async function (email, owner) {
  await asFamily(this, familyOf(this, email), "GET", `/elf/hq/entry/${await detectiveIdOf(owner)}/picture.jpg`);
});

// A graduate's certificate (GET /elf/hq/certificate/:detective), a sheet to print with the elf drawn on the server, and
// their share card (GET /elf/hq/share/:detective.png), a picture drawn on the server, for the first detective of the
// family `email`. The certificate is dated the day it is printed, so nothing here reads a date.
When("the family {string} opens its detective's graduate certificate", { timeout: 20 * 1000 }, async function (email) {
  await asFamily(this, familyOf(this, email), "GET", `/elf/hq/certificate/${await detectiveIdOf(email)}`);
});

When("the family {string} asks for its detective's share card", { timeout: 20 * 1000 }, async function (email) {
  await asFamily(this, familyOf(this, email), "GET", `/elf/hq/share/${await detectiveIdOf(email)}.png`);
});

Then("the game answers {int} with a sheet to print saying {string}", function (status, words) {
  assert.equal(this.gameStatus, status, sentence(this));
  assert.equal(String(this.gameType).split(";")[0].trim(), "text/html", sentence(this));
  assert.ok(String(this.gameText).includes("Print or save as PDF"), `expected a sheet to print in ${sentence(this)}`);
  assert.ok(String(this.gameText).includes(words), `expected "${words}" in ${sentence(this)}`);
});

// Every family is enrolled with a mobile (features/steps/elf-join.steps.js): this one is taken off again, as a
// family that enrolled before one was asked for has none.
Given("the family {string} has no mobile number", async function (email) {
  const r = await pool.query("UPDATE elf_families SET mobile = NULL WHERE email = $1", [email]);
  assert.equal(r.rowCount, 1, `no family ${email}`);
});

// One entry for the detective however many pictures were sent, with the picture's bytes beside it.
Then("the family {string} has one grand prize entry, with its picture", async function (email) {
  const r = await pool.query(
    `SELECT e.mime, octet_length(b.bytes) AS size
       FROM elf_grand_prize_entries e
       JOIN elf_families f ON f.id = e.family_id
       LEFT JOIN elf_grand_prize_files b ON b.entry_id = e.id
      WHERE f.email = $1 AND e.year = (SELECT year FROM elf_settings WHERE id = 1)`,
    [email],
  );
  assert.equal(r.rows.length, 1, JSON.stringify(r.rows));
  assert.equal(r.rows[0].mime, "image/jpeg");
  assert.ok(Number(r.rows[0].size) > 0, "the entry has no picture");
});

// The end of January clear out (deleteExpiredGrandPrizeEntries, on every elf worker tick). An entry goes from 31
// January after the December its picture came in for, worked out from sent_at. This moves the family's entry's picture
// to two years ago, by SQL from the database's own clock, so its 31 January has passed whenever this runs; and says,
// in the same statement, that the entry has its picture to lose. The entry is kept in the world by its id, so a later
// step can look for its picture once the entry has gone.
Given("the grand prize picture of the family {string} came in two years ago", async function (email) {
  const r = await pool.query(
    `UPDATE elf_grand_prize_entries e SET sent_at = now() - interval '2 years'
       FROM elf_families f
      WHERE f.id = e.family_id AND f.email = $1
      RETURNING e.id, EXISTS (SELECT 1 FROM elf_grand_prize_files b WHERE b.entry_id = e.id) AS has_picture`,
    [email],
  );
  assert.equal(r.rows.length, 1, `${email} has no one grand prize entry: ${JSON.stringify(r.rows)}`);
  assert.equal(r.rows[0].has_picture, true, "the entry has no picture to clear out");
  this.prizeClearedEntryId = Number(r.rows[0].id);
});

Then("the family {string} has no grand prize entry, and its picture has gone too", async function (email) {
  const r = await pool.query(
    "SELECT count(*)::int AS n FROM elf_grand_prize_entries e JOIN elf_families f ON f.id = e.family_id WHERE f.email = $1",
    [email],
  );
  assert.equal(r.rows[0].n, 0, `${email} still has a grand prize entry`);
  assert.ok(this.prizeClearedEntryId, "no step moved an entry's picture back");
  const files = await pool.query("SELECT count(*)::int AS n FROM elf_grand_prize_files WHERE entry_id = $1", [this.prizeClearedEntryId]);
  assert.equal(files.rows[0].n, 0, "the entry's picture is still there");
});

// ---- Head Elf HQ's side of the grand prize: the Grand prize part and Settings > The grand prize ----------
//
// The head elf's answers are kept whatever they are (asHeadElf above asserts a 200), so a step can see a 409.
// Each head elf signs in once a scenario. An entry is found by SQL from its family's email; the winner is read
// by SQL on winner_at. The video link as it was is kept the first time a step changes it, and the @elf-game
// After hook puts it back, as it does the closing.

/** A head elf's request to Head Elf HQ's API, kept as `world.headElf` whatever it answers: its status, its
 *  type and its headers, its size, and its JSON when it is JSON. */
async function headElfAsks(world, email, password, method, path, body) {
  world.headElfTokens = world.headElfTokens || {};
  if (!world.headElfTokens[email]) world.headElfTokens[email] = await login(email, password);
  const token = world.headElfTokens[email];
  assert.ok(token, `could not sign in as ${email}`);
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get("content-type") || "";
  let json = null;
  if (type.includes("json")) {
    try {
      json = JSON.parse(bytes.toString("utf8"));
    } catch {
      json = null;
    }
  }
  world.headElf = {
    request: `${method} ${path}`,
    status: res.status,
    type,
    cache: res.headers.get("cache-control") || "",
    sniff: res.headers.get("x-content-type-options") || "",
    robots: res.headers.get("x-robots-tag") || "",
    size: bytes.length,
    body: json,
  };
  return world.headElf;
}

const headElfSaid = (world) => `${world.headElf.request}: ${world.headElf.status} ${JSON.stringify(world.headElf.body)}`;

/** The grand prize entry of the family `email` this year, by SQL. */
async function entryIdOf(email) {
  const r = await pool.query(
    `SELECT e.id FROM elf_grand_prize_entries e
       JOIN elf_families f ON f.id = e.family_id
      WHERE f.email = $1 AND e.year = (SELECT year FROM elf_settings WHERE id = 1)`,
    [email],
  );
  assert.equal(r.rows.length, 1, `${email} has no one grand prize entry: ${JSON.stringify(r.rows)}`);
  return Number(r.rows[0].id);
}

/** This year's entries marked as the winner, by SQL on winner_at. */
async function winnersNow() {
  const r = await pool.query(
    "SELECT id FROM elf_grand_prize_entries WHERE year = (SELECT year FROM elf_settings WHERE id = 1) AND winner_at IS NOT NULL ORDER BY id",
  );
  return r.rows.map((row) => Number(row.id));
}

async function keepPrizeVideo(world) {
  if (world.prizeVideoBefore) return;
  const r = await pool.query("SELECT graduate_video_url FROM elf_settings WHERE id = 1");
  world.prizeVideoBefore = { url: r.rows[0] ? r.rows[0].graduate_video_url : null };
}

When("{string} with password {string} reads the grand prize entries", async function (email, password) {
  await headElfAsks(this, email, password, "GET", "/api/admin/elf/grand-prize");
  assert.equal(this.headElf.status, 200, headElfSaid(this));
});

Then("there are {int} entries, the first from {string}", async function (n, email) {
  const entries = (this.headElf.body && this.headElf.body.entries) || [];
  assert.equal(entries.length, n, headElfSaid(this));
  assert.equal(entries[0].id, await entryIdOf(email), headElfSaid(this));
});

When("{string} with password {string} marks the entry from {string} as the winner", async function (email, password, family) {
  await headElfAsks(this, email, password, "POST", `/api/admin/elf/grand-prize/${await entryIdOf(family)}/winner`);
});

When("{string} with password {string} reads the picture of the entry from {string}", async function (email, password, family) {
  await headElfAsks(this, email, password, "GET", `/api/admin/elf/grand-prize/${await entryIdOf(family)}/picture`);
});

Then("the head elf's answer is {int}", function (status) {
  assert.equal(this.headElf.status, status, headElfSaid(this));
});

Then("the head elf's answer is {int}, saying {string}", function (status, words) {
  assert.equal(this.headElf.status, status, headElfSaid(this));
  assert.equal(this.headElf.body && this.headElf.body.error, words, headElfSaid(this));
});

Then("the entry from {string} is the winner", async function (family) {
  assert.equal(this.headElf.status, 200, headElfSaid(this));
  assert.ok((await winnersNow()).includes(await entryIdOf(family)), `the entry from ${family} is not the winner`);
});

Then("the entry from {string} is the winner, and only that one", async function (family) {
  assert.equal(this.headElf.status, 200, headElfSaid(this));
  assert.deepEqual(await winnersNow(), [await entryIdOf(family)]);
});

Then("the head elf's answer is a picture of type {string}, kept by no cache", function (type) {
  const a = this.headElf;
  assert.equal(a.status, 200, headElfSaid(this));
  assert.equal(a.type.split(";")[0].trim(), type);
  assert.ok(a.size > 0, "the picture came back empty");
  assert.match(a.cache, /no-store/);
  assert.equal(a.sniff, "nosniff");
  assert.equal(a.robots, "noindex, nofollow");
});

When("{string} with password {string} saves the grand prize closing time {string}", async function (email, password, time) {
  await keepPrizeClosing(this);
  await headElfAsks(this, email, password, "PUT", "/api/admin/elf/grand-prize/settings", { time });
});

// The moment is worked out by the database from Elf Detective School's own year (last year here) and the time
// typed, so no step compares the real clock with a date written in the feature.
Then("the grand prize entries are saved to close at {string} on Christmas Eve of Elf Detective School's year", async function (clock) {
  const [hour, minute] = clock.split(":").map(Number);
  const r = await pool.query(
    `SELECT grand_prize_closes_at, year,
            grand_prize_closes_at = make_timestamptz(year, 12, 24, $1::int, $2::int, 0, 'Europe/London') AS saved
       FROM elf_settings WHERE id = 1`,
    [hour, minute],
  );
  assert.equal(r.rows[0].saved, true, `saved ${JSON.stringify(r.rows[0].grand_prize_closes_at)} for the year ${r.rows[0].year}`);
});

When("{string} with password {string} saves the graduates' video {string}", async function (email, password, videoUrl) {
  await keepPrizeVideo(this);
  await headElfAsks(this, email, password, "PUT", "/api/admin/elf/grand-prize/settings", { videoUrl });
});

When("{string} with password {string} clears the graduates' video", async function (email, password) {
  await keepPrizeVideo(this);
  await headElfAsks(this, email, password, "PUT", "/api/admin/elf/grand-prize/settings", { videoUrl: "" });
});

Then("the graduates' video is {string}", async function (url) {
  const r = await pool.query("SELECT graduate_video_url FROM elf_settings WHERE id = 1");
  assert.equal(r.rows[0].graduate_video_url, url);
});

Then("there is no graduates' video", async function () {
  const r = await pool.query("SELECT graduate_video_url FROM elf_settings WHERE id = 1");
  assert.equal(r.rows[0].graduate_video_url, null);
});

// ---- the emails a family can stop (features/elf-grand-prize.feature, ruling F16) ---------------------------------
//
// The small link at the foot of a clue email, a promotion or a graduation opens the family's own page, found by the
// token the database made for the family (elf_families.emails_token, read here by SQL). Following it changes
// nothing: only the page's button does. Detective HQ has the same switch for the family signed in. Each button is
// pressed as the page drew it: its own form, posted with the choice it holds. Whether the emails are stopped is read
// by SQL, and so is the audit log's newest line about them. Nothing here reads a date.

/** The family's own token for the link that stops its emails. */
async function emailsTokenOf(email) {
  const r = await pool.query("SELECT emails_token FROM elf_families WHERE email = $1", [email]);
  assert.ok(r.rows[0], `no family ${email}`);
  return r.rows[0].emails_token;
}

/** The first form a page draws after `marker`: where it posts, and the choice its hidden field holds. */
function stoppedFormAfter(world, marker) {
  const html = String(world.gameText);
  const from = html.indexOf(marker);
  assert.ok(from > -1, `no ${marker} in ${sentence(world)}`);
  const form = /<form\b[^>]*\baction="([^"]+)"[^>]*>([\s\S]*?)<\/form>/.exec(html.slice(from));
  assert.ok(form, `no form after ${marker} in ${sentence(world)}`);
  const choice = /name="stopped" value="(yes|no)"/.exec(form[2]);
  assert.ok(choice, `the form after ${marker} holds no choice: ${form[0]}`);
  return { action: form[1], stopped: choice[1] };
}

/** A plain form posted as a family's browser (or as nobody) sends it, and the answer kept as asFamily keeps it. With
 *  no Origin header, as the other posts here, it counts as from our own page. */
async function postFormAs(world, family, path, fields) {
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (family) headers.Cookie = cookiesOf(family);
  const res = await fetch(`${BASE_URL}${path}`, { method: "POST", headers, redirect: "manual", body: new URLSearchParams(fields).toString() });
  world.gameStatus = res.status;
  world.gameType = res.headers.get("content-type") || "";
  world.gameText = await res.text();
  world.gameBody = null;
}

/** Whether the family has stopped the emails, and the audit log's newest line about them. */
async function emailsOf(email) {
  const f = await pool.query("SELECT id, emails_stopped_at FROM elf_families WHERE email = $1", [email]);
  assert.ok(f.rows[0], `no family ${email}`);
  const a = await pool.query(
    "SELECT action, actor, data FROM audit_log WHERE entity = 'elf_family' AND entity_id = $1 AND action LIKE 'elf.emails.%' ORDER BY id DESC LIMIT 1",
    [f.rows[0].id],
  );
  return { id: Number(f.rows[0].id), stopped: f.rows[0].emails_stopped_at !== null, audit: a.rows[0] ? { action: a.rows[0].action, actor: a.rows[0].actor, data: a.rows[0].data } : null };
}

When("someone opens the link to stop the emails in an email to {string}", async function (email) {
  await asFamily(this, null, "GET", `/elf/emails/${await emailsTokenOf(email)}`);
});

When("someone presses the button on that page", async function () {
  const form = stoppedFormAfter(this, "<main");
  await postFormAs(this, null, form.action, { stopped: form.stopped });
});

When("the family {string} presses the button in Detective HQ's Your emails", async function (email) {
  const form = stoppedFormAfter(this, 'class="section elf-hq-emails"');
  assert.equal(form.action, "/api/elf/emails", `Detective HQ's switch posts to ${form.action}`);
  await postFormAs(this, familyOf(this, email), form.action, { stopped: form.stopped });
});

Then("the family {string} gets the emails", async function (email) {
  const now = await emailsOf(email);
  assert.equal(now.stopped, false, `the emails of ${email} are stopped`);
});

Then("the family {string} has stopped the emails, and the audit log says so", async function (email) {
  const now = await emailsOf(email);
  assert.equal(now.stopped, true, `the emails of ${email} are not stopped`);
  assert.deepEqual(now.audit, { action: "elf.emails.stopped", actor: "family", data: { familyId: now.id } });
});

Then("the family {string} gets the emails again, and the audit log says so", async function (email) {
  const now = await emailsOf(email);
  assert.equal(now.stopped, false, `the emails of ${email} are still stopped`);
  assert.deepEqual(now.audit, { action: "elf.emails.started", actor: "family", data: { familyId: now.id } });
});
