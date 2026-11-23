/**
 * Contract 6.1 (who may open the console) and 6.2 (what they see first), walked
 * through in a real browser against the real API.
 *
 * Nothing here mocks the second factor: the page is asked to enrol, the secret it
 * prints is read back out of the DOM, and a live TOTP code is computed from it and
 * typed in — so the QR screen, the server's verifier and the cookies it hands out
 * are all proved against each other, proxy, CSRF and SameSite included.
 *
 * Two browser contexts, not two tabs: the console's cookies live on the origin, so
 * a Client seat and a Moderator seat can only be watched side by side apart.
 *
 *   backend/.venv/Scripts/python.exe admin/qa/reset.py          # seats back to first run
 *   backend/.venv/Scripts/python.exe admin/qa/review_seed.py    # the pile section 7 decides
 *   backend/.venv/Scripts/python.exe admin/qa/people_seed.py    # the accounts section 8 acts on
 *   backend/.venv/Scripts/python.exe admin/qa/coins_seed.py     # the payments section 10 decides
 *   backend/.venv/Scripts/python.exe admin/qa/promotions_seed.py # the paid reach section 11 decides
 *   node admin/qa/console.mjs                                   # from the repository root
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.ADMIN_CONSOLE_ORIGIN || 'http://localhost:3002';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('admin/qa/shots');
const SECRETS = path.join(OUT, 'secrets.json');
const secrets = fs.existsSync(SECRETS) ? JSON.parse(fs.readFileSync(SECRETS, 'utf8')) : {};
const PASSWORD = 'exposing-demo-1';
const OWNER = 'sita';
const SEAT = 'moddemo';
/** The nine counts section 6.2 asks for, in the order it asks for them. */
const TILES = 'new_users,posts,comments,listings,open_reports,coin_requests,promotions,storage,coins_moved';

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function fromBase32(text) {
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of text.toUpperCase().replace(/=+$/, '').replace(/\s/g, '')) {
    const index = B32.indexOf(char);
    if (index < 0) throw new Error(`not base32: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** RFC 6238, six digits, thirty seconds — the same recipe the server runs. */
function totp(secret, at = Date.now()) {
  const step = Math.floor(at / 1000 / 30);
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(step / 4294967296), 0);
  counter.writeUInt32BE(step >>> 0, 4);
  const digest = crypto.createHmac('sha1', fromBase32(secret)).update(counter).digest();
  const offset = digest[19] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24 | digest[offset + 1] << 16
    | digest[offset + 2] << 8 | digest[offset + 3]) >>> 0;
  return String(binary % 1000000).padStart(6, '0');
}

const retryWrite = async run => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      const retryable = /UNKNOWN|EBUSY|EPERM|ENOMEM/.test(`${err?.code || ''} ${err?.message || ''}`);
      if (attempt >= 5 || !retryable) throw err;
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }
};

const shot = async (page, name) => retryWrite(() => page.screenshot({ path: path.join(OUT, `${name}.png`) }));

/**
 * Every screen ships as server-rendered HTML and is hydrated a beat later, and a
 * list repaints after each write. The node a read or a type just found can be
 * replaced under it mid-call, which surfaces as a detached-node error rather
 * than a wrong answer — so try the same call again against the fresh tree.
 */
async function again(run) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      if (!/detached|No element found/.test(err.message)) throw err;
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }
  return run();
}

const text = (page, selector) => again(() => page.$eval(selector, node => node.textContent.trim()));
const many = (page, selector) => again(() => page.$$eval(selector, nodes => nodes.map(n => n.textContent.trim())));

/** Click the one element under `selector` whose text contains `needle`. */
async function clickText(page, selector, needle) {
  const missing = await page.evaluate((sel, want) => {
    const list = [...document.querySelectorAll(sel)];
    const el = list.find(node => node.textContent.includes(want));
    if (!el) return `${want} not found in ${sel} (${list.length} candidates: ${list.slice(0, 6).map(n => n.textContent.trim().slice(0, 28)).join(' / ')})`;
    el.click();
    return null;
  }, selector, needle);
  if (missing) throw new Error(missing);
  await new Promise(resolve => setTimeout(resolve, 350));
}

/**
 * Type into a box and prove the box took it.
 *
 * A click can land on whatever is painted on top of the field, and a box typed into
 * before React has hydrated silently reverts to its saved value. Both leave the old
 * number in the field with a green save banner above it, which is a walkthrough that
 * believes itself — so the field is focused from inside, cleared, typed, and read
 * back, and anything that still refuses to hold is said out loud at the end.
 */
const typeStubs = [];
async function typeInto(page, selector, value) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.evaluate(sel => {
      const box = document.querySelector(sel);
      if (!box) throw new Error(`No element found for ${sel}`);
      box.focus();
      if (box.select) box.select();
    }, selector);
    await page.keyboard.press('Backspace');
    await page.type(selector, value);
    const now = await page.evaluate(sel => document.querySelector(sel).value, selector);
    if (now === value) return;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  typeStubs.push(await page.evaluate(sel => {
    const box = document.querySelector(sel);
    return `${sel} still reads "${box ? box.value : 'gone'}"`;
  }, selector));
}
const clearAndType = (page, selector, value) => again(() => typeInto(page, selector, value));

/** Green banner, and specifically the one this action wrote. */
async function expectBanner(page, needle) {
  await page.waitForFunction(want => [...document.querySelectorAll('.banner-ok')]
    .some(banner => banner.textContent.includes(want)), { timeout: 40000 }, needle);
  return text(page, '.banner-ok');
}

/**
 * Red banner. A refused write answers with the server's own sentence and the page
 * paints it as `.banner-bad`, so a check that expects a 400 has to wait for that
 * one — waiting for the green banner instead times out forty seconds later.
 */
async function expectBad(page, needle) {
  await page.waitForFunction(want => [...document.querySelectorAll('.banner-bad')]
    .some(banner => banner.textContent.includes(want)), { timeout: 40000 }, needle);
  return text(page, '.banner-bad');
}

/**
 * A node whose text has to change because of the write that just landed. Reading
 * it straight after the banner answers races the reload the page fires next, so
 * wait for the words this action is supposed to have produced. Sibling spans are
 * joined with a space: `textContent` glues them, and the screen does not.
 */
async function until(page, selector, needle) {
  await page.waitForFunction(([sel, want]) => {
    const line = document.querySelector(sel);
    if (!line) return false;
    const said = line.children.length
      ? [...line.children].map(part => part.textContent.replace(/\s+/g, ' ').trim()).join(' ')
      : line.textContent;
    return said.includes(want);
  }, { timeout: 40000 }, [selector, needle]);
  return lineText(page, selector);
}

/** The text a node reads on screen, span boundaries and all. */
const lineText = (page, selector) => again(() => page.$eval(selector, node => (node.children.length
  ? [...node.children].map(part => part.textContent.replace(/\s+/g, ' ').trim()).join(' ')
  : node.textContent).trim()));

/**
 * A row a delete just removed. The green banner answers before the refetch that
 * rebuilds the list lands, so counting rows the instant it appears still shows
 * the deleted one — wait for the node itself to leave the page.
 */
async function waitGone(page, selector) {
  await page.waitForFunction(sel => !document.querySelector(sel), { timeout: 40000 }, selector);
}

/**
 * A filter select fires its own request the moment it changes, and the search box
 * fires one per keystroke. Waiting for the answer to *this* change is what keeps
 * the screen and the row count the suite then reads from being the same thing.
 */
async function pick(page, selector, value, apiNeedle) {
  const answer = page.waitForResponse(res => new RegExp(apiNeedle).test(res.url()), { timeout: 40000 });
  await page.select(selector, value);
  return answer;
}

/** The same promise for a filter chip: the row of chips is a select that reads like a table. */
async function chip(page, value, apiNeedle) {
  const answer = page.waitForResponse(res => new RegExp(apiNeedle).test(res.url()), { timeout: 40000 });
  await page.evaluate(want => {
    const hit = [...document.querySelectorAll('.filters .fchip')].find(node => node.dataset.chip === want);
    if (!hit) throw new Error(`no chip for ${want}`);
    hit.click();
  }, value);
  return answer;
}

/** Click the one button whose text matches, and hand back what the server answered. */
async function answered(page, selector, want, apiNeedle) {
  const out = page.waitForResponse(res => new RegExp(apiNeedle).test(res.url())
    && res.request().method() !== 'GET', { timeout: 40000 });
  await clickText(page, selector, want);
  const res = await out;
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

/**
 * The roster answers the search box once per keystroke, so which rows are on
 * screen at any instant is whichever answer landed last. Everything read out of
 * it is therefore found by its own username, not by the number of rows.
 */
const seatRow = (page, username) => page.waitForFunction(name => [...document.querySelectorAll('.seat')]
  .some(node => node.textContent.includes(`@${name}`)), { timeout: 40000 }, username);

/** Make sure that username's roster row is expanded. */
async function openSeat(page, username) {
  await seatRow(page, username);
  const opened = await page.evaluate(name => {
    const row = [...document.querySelectorAll('.seat')].find(node => node.textContent.includes(`@${name}`));
    if (!row) return 'missing';
    if (row.className.includes('open')) return true;
    row.querySelector('.seat-id').click();
    return false;
  }, username);
  if (opened === 'missing') throw new Error(`${username} is not in the roster`);
  if (opened !== true) await page.waitForSelector('.seat.open .seat-side', { timeout: 40000 });
}

/** The state pills of one seat, read from that seat's row and no other. */
async function seatFlags(page, username) {
  await seatRow(page, username);
  return page.$$eval('.seat', (nodes, name) => {
    const row = nodes.find(node => node.textContent.includes(`@${name}`));
    return [...row.querySelectorAll('.seat-flags .pill')].map(pill => pill.textContent.trim());
  }, username);
}

const nap = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The sign-in page paints its boxes while it is still asking the server who this
 * browser is, so a browser that never signed out of a live seat gets a form for a
 * heartbeat and then the console. Typing during that heartbeat is typing into
 * nothing. Read the page until it says the same thing twice in a row, and walk it
 * back out whenever it says it is already inside.
 */
async function signInDoor(page) {
  const where = () => page.evaluate(() => {
    if (document.querySelector('.side-signout')) return 'console';
    if (document.querySelector('input[autocomplete="username"]')
      && !document.querySelector('.skeleton-stack')) return 'door';
    return 'thinking';
  }).catch(() => 'thinking'); // the page is mid-navigation, so it has decided nothing yet
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const first = await where();
    if (first === 'console') {
      await clickText(page, '.side-signout', 'Sign out');
      continue;
    }
    if (first === 'door') {
      await nap(600);
      if (await where() === 'door') return;
      continue;
    }
    await nap(250);
  }
  throw new Error('the sign-in door never settled into either the form or the console');
}

/**
 * The whole sign-in: password, then whatever the console asks for. A seat that
 * has never enrolled prints a QR; an enrolled seat only wants the code, and the
 * secret it was given the first time is kept in secrets.json for exactly this.
 */
async function signIn(page, username, label, known = null) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await signInDoor(page);
  await page.type('input[autocomplete="username"]', username);
  await page.type('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('.qr-manual code, input[autocomplete="one-time-code"]', { timeout: 40000 });

  if (await page.$('.qr-manual code')) {
    const secret = await text(page, '.qr-manual code');
    ok(`${label}: enrolment prints a scannable QR and the key behind it`,
      Boolean(await page.$('img.qr')) && secret.length >= 16, secret.slice(0, 8) + '…');
    await shot(page, `${label}-enrol`);
    secrets[username] = secret;
    fs.writeFileSync(SECRETS, JSON.stringify(secrets, null, 2));
    await page.type('input[autocomplete="one-time-code"]', totp(secret));
  } else {
    if (!known) throw new Error(`${username} is enrolled but no secret is known — run admin/qa/reset.py`);
    await page.type('input[autocomplete="one-time-code"]', totp(known));
  }
  await page.click('button[type="submit"]');
  await page.waitForSelector('.codes-grid code, .me-grid, .roster, .card-error, .health', { timeout: 40000 });
  return secrets[username] || known;
}

/** The ten codes, read out of the sheet as soon as all ten are on screen. */
async function readCodes(page) {
  const handle = await page.waitForFunction(() => {
    const list = [...document.querySelectorAll('.codes-grid code')];
    return list.length === 10 ? list.map(node => node.textContent.trim()) : false;
  }, { timeout: 40000 });
  return handle.jsonValue();
}

/** The one-time codes are a screen of their own; everything else is the console. */
async function dismissCodes(page) {
  await page.waitForSelector('.codes-actions button', { timeout: 40000 });
  await clickText(page, '.codes-actions button', 'I have saved them');
}

/**
 * A second sign-in for a seat that already has an authenticator: password, code,
 * and whatever screen its own permissions land it on. Used again after the suite
 * turns a seat off, because the console hands that browser back the login door.
 */
async function seatSignIn(page, username, secret) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  // A seat switched off and back on inside its own thirty-minute window holds a
  // cookie the server takes seriously again, so this route walks the browser home
  // instead of showing the door. `signInDoor` reads which of the two this page
  // turned out to be before the first keystroke.
  await signInDoor(page);
  await clearAndType(page, 'input[autocomplete="username"]', username);
  await clearAndType(page, 'input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('input[autocomplete="one-time-code"]', { timeout: 40000 });
  await clearAndType(page, 'input[autocomplete="one-time-code"]', totp(secret));
  await page.click('button[type="submit"]');
  await page.waitForSelector('.tile, .me-grid, .codes-grid, .card-error', { timeout: 40000 });
}

const errors = [];
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--lang=en-US', '--force-device-scale-factor=1'],
});

async function freshPage() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  // Deleting a blocked word and withdrawing a notice both ask first; the suite
  // always answers yes, and the app still has to make the call it says it makes.
  page.on('dialog', dialog => dialog.accept());
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const where = message.location()?.url || '';
    if (/\/api\//.test(where) || /favicon|Download the React/i.test(where + message.text())) return;
    errors.push(`console: ${message.text()}`);
  });
  return page;
}

const statusOf = (page, apiPath) => page.evaluate(target => fetch(target, { credentials: 'include' })
  .then(async res => ({ status: res.status, body: await res.json().catch(() => ({})) })), apiPath);

/** The same write the page would make, asked straight of the API to see what the door says. */
const postOf = (page, apiPath, body) => page.evaluate(async (target, payload) => {
  const csrf = (document.cookie.match(/(?:^|;\s*)exposing_csrf=([^;]*)/) || [])[1] || '';
  const res = await fetch(target, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf) },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}, apiPath, body);

const owner = await freshPage();
const mod = await freshPage();

try {
  // ── 1. nothing is open to a stranger ───────────────────────────────────────
  await owner.goto(`${BASE}/access`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('input[autocomplete="username"]', { timeout: 40000 });
  ok('a stranger typing /access is walked to the sign-in screen',
    owner.url().endsWith('/login'), owner.url());

  await owner.type('input[autocomplete="username"]', 'nobody-at-all');
  await owner.type('input[type="password"]', 'wrong-password-here');
  await owner.click('button[type="submit"]');
  await owner.waitForSelector('.card-error', { timeout: 40000 });
  await shot(owner, 'owner-1-rejected');
  ok('a wrong password gets one neutral sentence',
    (await text(owner, '.card-error')).includes('did not match a staff account'));
  const cold = await statusOf(owner, '/api/admin/session/');
  ok('and no session of any kind is handed out', cold.status === 401, `HTTP ${cold.status}`);

  // ── 2. the Client seat: enrol, codes, roster ───────────────────────────────
  await signIn(owner, OWNER, 'owner', secrets[OWNER] || null);
  const codes = await readCodes(owner);
  await shot(owner, 'owner-2-recovery-codes');
  ok('first enrolment hands out ten one-time recovery codes',
    codes.every(code => /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){2}$/.test(code)),
    `${codes.length} codes, e.g. ${codes[0]}`);

  await dismissCodes(owner);
  await owner.waitForSelector('.tile, .roster, .panel.empty', { timeout: 40000 });
  ok('saving the codes lands on the dashboard, which the seat is allowed to open',
    new URL(owner.url()).pathname === '/overview', owner.url());
  const meter = await text(owner, '.window-meter');
  ok('the top bar counts the 30-minute window down', /\d+ min left/.test(meter), meter);
  const nav = await many(owner, '.side-item-label');
  ok('a Client seat sees every console entry',
    nav.includes('Staff and access') && nav.includes('My seat') && nav.includes('Dashboard'), nav.join(', '));

  // ── 3. appoint a Moderator, then move two screens ──────────────────────────
  await owner.goto(`${BASE}/access`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.search input', { timeout: 40000 });
  await clickText(owner, '.console-head-right button', 'Grant a seat');
  await owner.waitForSelector('.grant', { timeout: 20000 });
  await owner.type('.grant input', SEAT);
  await owner.select('.grant select', 'moderator');
  await shot(owner, 'owner-3-grant-form');
  await clickText(owner, '.grant button', 'Give access');
  const appointed = await expectBanner(owner, SEAT);
  ok('the Client appoints a Moderator seat', appointed.includes(SEAT), appointed);

  await clearAndType(owner, '.search input', SEAT);
  const flags = await seatFlags(owner, SEAT);
  await shot(owner, 'owner-4-granted');
  ok('the new seat is active and still has to enrol an authenticator',
    flags.some(flag => flag.startsWith('Active')) && flags.some(flag => flag.includes('No authenticator')),
    flags.join(' | '));

  await openSeat(owner, SEAT);
  await owner.waitForSelector('.key-groups', { timeout: 40000 });
  await shot(owner, 'owner-5-permissions');
  const toggles = await many(owner, '.seat-keys button.key');
  ok('the seat is edited as a list of named screens', toggles.length >= 28, `${toggles.length} toggles`);

  await clickText(owner, '.seat-keys button.key', 'Coin request queue');
  await owner.waitForSelector('.seat-keys button.key.allow', { timeout: 20000 });
  await clickText(owner, '.key-actions button', 'Save screens');
  const grantSaved = await expectBanner(owner, 'Saved');
  const grantedRow = (await statusOf(owner, `/api/admin/staff/?q=${SEAT}`)).body.results[0];
  ok('an explicit grant opens a payment screen on top of the role defaults',
    grantedRow.granted_keys.includes('coins_view') && grantedRow.permissions.includes('coins_view')
      && grantedRow.permissions.includes('reports'),
    `${grantedRow.permissions.length} screens; granted ${grantedRow.granted_keys.join(',')}`);
  ok('the save answers in plain words', grantSaved.includes('Saved'), grantSaved);

  for (let cycle = 0; cycle < 2; cycle += 1) {
    await clickText(owner, '.seat-keys button.key', 'Report queue');
  }
  await clickText(owner, '.key-actions button', 'Save screens');
  await expectBanner(owner, 'Saved');
  const deniedRow = (await statusOf(owner, `/api/admin/staff/?q=${SEAT}`)).body.results[0];
  ok('cycling a role-default screen to denied wins over the role',
    deniedRow.denied_keys.includes('reports') && !deniedRow.permissions.includes('reports'),
    `denied ${deniedRow.denied_keys.join(',')}`);
  await shot(owner, 'owner-6-denied');

  // ── 4. what that Moderator actually sees ───────────────────────────────────
  const modSecret = await signIn(mod, SEAT, 'moderator', secrets[SEAT] || null);
  const modCodes = await readCodes(mod);
  await shot(mod, 'moderator-0-codes');
  ok('the new seat is handed its own ten codes, not the ones the Client was given',
    modCodes.length === 10 && !modCodes.some(code => codes.includes(code)),
    `${modCodes.length} codes`);
  await dismissCodes(mod);
  await mod.waitForSelector('.tile, .me-grid', { timeout: 40000 });
  const modNav = await many(mod, '.side-item-label');
  ok('a Moderator is dropped on the dashboard and never sees Staff and access',
    new URL(mod.url()).pathname === '/overview' && !modNav.includes('Staff and access'), modNav.join(', '));

  await mod.goto(`${BASE}/me`, { waitUntil: 'domcontentloaded' });
  await mod.waitForSelector('.me-grid', { timeout: 40000 });
  await shot(mod, 'moderator-1-my-seat');
  const groups = await many(mod, '.me-group h3');
  ok('the seat lists its own screens under named groups',
    groups.length >= 2 && groups.includes('Coins and payments') && !groups.includes('Staff'),
    groups.join(', '));
  ok('the window is the same thirty minutes for every role',
    /\d+ min left/.test(await text(mod, '.window-meter')), await text(mod, '.window-meter'));

  await mod.goto(`${BASE}/access`, { waitUntil: 'domcontentloaded' });
  await mod.waitForSelector('.panel.blocked', { timeout: 40000 });
  await shot(mod, 'moderator-2-blocked');
  ok('opening a staff screen by hand answers with a reason, not a blank page',
    (await text(mod, '.blocked h2')) === 'Not on your seat');
  const gate = await statusOf(mod, '/api/admin/staff/');
  ok('and the endpoint refuses it naming the permission that is missing',
    gate.status === 403 && gate.body.permission === 'staff_view' && gate.body.label === 'Staff roster',
    `HTTP ${gate.status} ${gate.body.permission}`);
  const catalogue = await statusOf(mod, '/api/admin/permissions/');
  ok('the catalogue is a staff screen too, so the seat reads its own labels',
    catalogue.status === 403, `HTTP ${catalogue.status}`);

  await clickText(mod, '.side-signout', 'Sign out');
  await mod.waitForSelector('input[autocomplete="username"]', { timeout: 40000 });
  await mod.type('input[autocomplete="username"]', SEAT);
  await mod.type('input[type="password"]', PASSWORD);
  await mod.click('button[type="submit"]');
  await mod.waitForSelector('input[autocomplete="one-time-code"]', { timeout: 40000 });
  await shot(mod, 'moderator-3-code-only');
  ok('an enrolled seat is asked only for the code, never to scan a second time',
    Boolean(await mod.$('input[autocomplete="one-time-code"]')) && !(await mod.$('.qr-manual code')));
  await mod.type('input[autocomplete="one-time-code"]', totp(modSecret));
  await mod.click('button[type="submit"]');
  await mod.waitForSelector('.tile, .me-grid', { timeout: 40000 });
  await mod.goto(`${BASE}/me`, { waitUntil: 'domcontentloaded' });
  await mod.waitForSelector('.me-grid', { timeout: 40000 });
  ok('the code reopens the console with its screens intact',
    (await many(mod, '.me-group h3')).includes('Coins and payments'));

  // ── 5. the dashboard (6.2) ─────────────────────────────────────────────────
  // Both API answers the paint is made of are captured off the network, so every
  // comparison below is between one screen and the one call that filled it — a
  // second fetch would race the other agents writing to this same database.
  const tilesLoad = owner.waitForResponse(res => /\/api\/admin\/overview\//.test(res.url()), { timeout: 40000 });
  const promoLoad = owner.waitForResponse(res => /\/api\/admin\/analytics\/promotions\//.test(res.url()), { timeout: 40000 });
  await owner.bringToFront();
  await owner.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const dash = await (await tilesLoad).json();
  const promos = await (await promoLoad).json();
  await owner.waitForSelector('.tile', { timeout: 40000 });
  await shot(owner, 'owner-8-dashboard');

  const ids = await owner.$$eval('.tile-grid .tile', nodes => nodes.map(node => node.dataset.tile));
  ok('the fold carries the nine counts the contract names, in its order',
    ids.join(',') === TILES, ids.join(', '));

  const figure = async id => Number((await text(owner, `.tile[data-tile="${id}"] .tile-number`)).replace(/[^\d]/g, ''));
  const rates = dash.tiles.filter(tile => tile.kind === 'rate');
  const counted = [];
  for (const tile of rates) {
    if (Number(await figure(tile.id)) !== tile.today) counted.push(tile.label);
  }
  ok('every trend card shows the number its own call counted',
    counted.length === 0, counted.length ? `${counted.join(', ')} disagree` : `${rates.length} cards, e.g. ${rates[0].today} posts today`);

  const sparks = await owner.$$eval('.tile .spark polyline', nodes => nodes
    .map(node => node.getAttribute('points').trim().split(/\s+/).length));
  ok('each trend draws a gap-free fourteen-day line',
    sparks.length === 5 && sparks.every(points => points === 14), `${sparks.join(', ')} points`);

  const queue = dash.tiles.find(tile => tile.id === 'open_reports');
  const split = await owner.$$eval('.tile[data-tile="open_reports"] .chip', nodes => nodes
    .map(node => Number(node.textContent.match(/\d+/)[0]))
    .reduce((sum, count) => sum + count, 0));
  ok('the report card adds up: its kind chips sum to the number it says is waiting',
    split === queue.value && split > 0, `${queue.value} open — ${(await text(owner, '.tile[data-tile="open_reports"] .chips')).replace(/\s+/g, ' ')}`);
  const coins = dash.tiles.find(tile => tile.id === 'coins_moved');
  const purse = dash.tiles.find(tile => tile.id === 'coin_requests');
  ok('coins sold, coins spent and the proofs held up are all on the screen',
    coins.spent_today >= 0 && purse.collected_npr >= 0 && /NPR [\d,]+/.test(await text(owner, '.tile[data-tile="coin_requests"] .tile-split')),
    `${purse.sold_today} sold today, ${(await text(owner, '.tile[data-tile="coin_requests"] .tile-split')).replace(/\s+/g, ' ')}`);

  const stored = dash.tiles.find(tile => tile.id === 'storage');
  ok('storage used is measured from the upload directory, and says so',
    stored.state === 'unknown' || (stored.bytes > 0 && /\s(B|KB|MB|GB|TB)$/.test(await text(owner, '.tile[data-tile="storage"] .tile-number'))),
    `${stored.state}: ${await text(owner, '.tile[data-tile="storage"] .tile-number')} in ${stored.files} files`);

  const healthIds = dash.health.checks.map(check => check.id);
  const stated = dash.health.checks.every(check => check.detail.length > 12);
  const headline = await text(owner, '.health-summary b');
  ok('system health answers each part separately, in words',
    healthIds.length >= 5 && stated && (await many(owner, '.health-item em')).length === healthIds.length,
    `“${headline}” — ${healthIds.join(', ')}`);

  const screenOf = href => (href.split('?')[0] || '/').replace(/\/$/, '') || '/';
  const raised = dash.alerts.recent.filter(row => row.href);
  const actionable = raised.filter(row => row.status === 'open');
  const settledRows = raised.filter(row => row.status !== 'open');
  const dead = await owner.evaluate(() => ({
    tiles: [...document.querySelectorAll('.tile-link')].map(a => a.getAttribute('href')),
    alerts: [...document.querySelectorAll('.alert-go')].map(a => a.getAttribute('href')),
    named: [...document.querySelectorAll('.alert-here')].map(node => node.textContent.trim()),
    screens: [...document.querySelectorAll('.side-nav a')].map(a => a.getAttribute('href')),
  }));
  const targets = [...new Set([...dead.tiles, ...dead.alerts])];
  const linkCodes = await owner.evaluate(links => Promise.all(links.map(link => fetch(link, { credentials: 'include' })
    .then(res => res.status, () => 0))), targets);
  ok('every link the dashboard hands out opens a real screen',
    targets.length > 0 && linkCodes.every(code => code === 200),
    `${targets.length} links: ${[...new Set(linkCodes)].join(', ')} — ${dead.screens.length} screens on this seat`);
  // A Client holds every screen, so on this seat "the screen has not been built" is
  // never the reason a row has no button: only a condition somebody already dealt
  // with is allowed to name its screen instead of linking to it.
  ok('an open alert is taken to the screen that fixes it, and every one of those screens is on this seat',
    dead.screens.includes('/reports') && actionable.length > 0
      && dead.alerts.length === actionable.length
      && actionable.every(row => dead.screens.includes(screenOf(row.href)))
      && dead.named.length === settledRows.length,
    `${dead.alerts.length} of ${raised.length} alerts link out to ${[...new Set(raised.map(row => screenOf(row.href)))].join(', ')}, `
    + `${dead.named.length} name the screen of an alert already decided: ${dead.named.join(', ')}`);
  const pills = await many(owner, '.alert .pill');
  ok('the alert feed carries its severity and status on every row',
    pills.length === dash.alerts.recent.length
      && (await owner.$$('.alert .alert-dot')).length === dash.alerts.recent.length,
    pills.join(', '));

  await owner.waitForFunction(() => document.querySelector('.campaigns')
    || document.querySelector('.performance .empty-note'), { timeout: 40000 });
  await owner.$eval('.performance', node => node.scrollIntoView());
  await new Promise(resolve => setTimeout(resolve, 400));
  await shot(owner, 'owner-9-campaigns');
  const scored = await owner.$$eval('.campaigns thead th', nodes => nodes.slice(1, -1).map(node => node.textContent.trim()));
  ok('campaign results carry every metric the contract lists',
    scored.length === promos.metrics.length && scored.filter(cell => cell.includes('*')).length === 2,
    scored.join(' | '));
  const blanks = await owner.$$eval('.campaigns tbody td.is-dim', nodes => [...new Set(nodes.map(node => node.dataset.metric))]);
  ok('the two metrics with no event behind them are left blank, not zeroed',
    blanks.length === 2 && blanks.includes('profile_visits') && blanks.includes('listing_messages'),
    `${blanks.join(', ')} across ${promos.shown} campaigns`);
  const told = await text(owner, '.performance .panel-foot');
  ok('and the screen says which ones and why under the table',
    told.includes('not measured yet') && told.includes('profile visits') && told.includes('listing messages'),
    told.slice(0, 120));

  const recount = owner.waitForResponse(res => /\/api\/admin\/overview\/\?refresh=1/.test(res.url()), { timeout: 40000 });
  await clickText(owner, '.console-head-right button', 'Re-count');
  const again = await recount;
  ok('Re-count re-measures the disk rather than reusing the cached figure',
    again.status() === 200, `HTTP ${again.status()}`);

  await mod.goto(`${BASE}/overview`, { waitUntil: 'domcontentloaded' });
  await mod.waitForSelector('.tile', { timeout: 40000 });
  const modTiles = await mod.$$eval('.tile-grid .tile', nodes => nodes.map(node => node.dataset.tile));
  const modGate = await statusOf(mod, '/api/admin/overview/');
  ok('a Moderator gets the same dashboard, because the role ships with it',
    modGate.status === 200 && modTiles.join(',') === TILES, `HTTP ${modGate.status}, ${modTiles.length} cards`);
  await shot(mod, 'moderator-5-dashboard');

  // The same alerts on a seat that holds four of the seven screens they point at.
  // `shipped()` decides button-or-label per seat, so the drawer is the only honest
  // list of what this person may open — and a button that walks a Moderator to a
  // door answering 403 is worse than the plain word it is replaced with.
  const modSeat = (await statusOf(mod, '/api/admin/session/')).body;
  const modScreens = await mod.$$eval('.side-nav a', nodes => nodes.map(node => node.getAttribute('href')));
  const modRaised = await mod.evaluate(() => ({
    links: [...document.querySelectorAll('.alert-go')].map(a => a.getAttribute('href')),
    named: [...document.querySelectorAll('.alert-here')].map(node => node.textContent.trim()),
  }));
  const modOpen = dash.alerts.recent.filter(row => row.href && row.status === 'open');
  const onSeat = modOpen.filter(row => modScreens.includes(screenOf(row.href)));
  const clientKeys = (await statusOf(owner, '/api/admin/session/')).body.permissions.length;
  ok('a Moderator is offered an alert only for a screen that seat actually holds',
    clientKeys > modSeat.permissions.length && modScreens.length < dead.screens.length
      && modRaised.links.length === onSeat.length && onSeat.length < modOpen.length
      && modRaised.named.length === modOpen.length - onSeat.length + settledRows.length,
    `${onSeat.length} of ${modOpen.length} alert buttons survive the seat, and ${modRaised.named.length} rows name their screen instead: ${modRaised.named.join(', ')}`);
  ok('and the rows it does open are the same numbers the Client was shown',
    (await mod.$$eval('.alert', nodes => nodes.length)) === dash.alerts.recent.length,
    `${dash.alerts.recent.length} rows on both seats, ${modSeat.permissions.length} screens on this one`);

  // ── 6. ending a seat takes the console away immediately ────────────────────
  await owner.bringToFront();
  await owner.goto(`${BASE}/access`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.search input', { timeout: 40000 });
  await clearAndType(owner, '.search input', SEAT);
  await openSeat(owner, SEAT);
  await clickText(owner, '.seat-side button', 'Switch seat off');
  const switched = await expectBanner(owner, 'stops at the next click');
  await shot(owner, 'owner-7-seat-off');
  ok('the Client switches a seat off from the roster',
    switched.includes(SEAT), switched);

  const ended = await statusOf(mod, '/api/admin/session/');
  ok('the disabled seat is locked out mid-session, at its very next call',
    ended.status === 403 && ended.body.code === 'staff_disabled', `HTTP ${ended.status} ${ended.body.code}`);
  await mod.reload({ waitUntil: 'domcontentloaded' });
  await mod.waitForSelector('input[autocomplete="username"]', { timeout: 40000 });
  await shot(mod, 'moderator-4-locked-out');
  ok('the dead seat is handed back the sign-in door', mod.url().endsWith('/login'), mod.url());

  await openSeat(owner, SEAT);
  await clickText(owner, '.seat-side button', 'Switch seat back on');
  const back = await expectBanner(owner, 'can sign in again');
  ok('and the same seat can be handed back', back.includes(SEAT), back);
  const revived = (await statusOf(owner, `/api/admin/staff/?q=${SEAT}`)).body.results[0];
  ok('the reinstated seat keeps the screens it was given',
    revived.is_enabled && revived.permissions.includes('coins_view') && !revived.permissions.includes('reports'),
    `${revived.permissions.length} screens`);

  // ── 7. content and marketplace review (contract 6.3) ───────────────────────
  /*
   * Every step below works on rows the walkthrough owns — `qa_reviewer`'s sample
   * content and the three `qa_rep_*` reporters made by admin/qa/review_seed.py —
   * and reaches them through a search for `qa_rep`, because this same database
   * carries the demo site's own posts, listings and reports. Aggregate counts are
   * therefore only ever compared with the call that painted the screen.
   */
  const SAMPLE = 'qa_rep';
  const AUTHOR = 'qa_reviewer';
  // Typed into the page and compared back exactly, so these stay plain ASCII.
  const NOTICE_A = 'console QA sample - this post advertises something the platform does not allow.';
  const NOTICE_L = 'console QA sample - this listing is not allowed on the marketplace.';
  const REASON_L = 'console QA sample - advertising a prohibited item';
  const REASON_D = 'console QA sample - a paid campaign selling something banned';

  const tap = async (page, selector) => {
    await page.waitForSelector(selector, { timeout: 40000 });
    await page.click(selector);
    await new Promise(resolve => setTimeout(resolve, 350));
  };
  const see = async (page, selector) => {
    await page.waitForFunction(want => Boolean(document.querySelector(want)), { timeout: 40000 }, selector);
    return text(page, selector);
  };
  const readCases = page => page.$$eval('.cases .case', nodes => nodes.map(node => {
    const line = node.querySelector('.shelf-decision');
    return {
      target: node.dataset.case,
      kind: node.dataset.case.split(':')[0],
      open: node.querySelector('.pile b')?.textContent.trim() || '',
      state: node.querySelector('.cbar .pill')?.textContent.trim() || '',
      flag: node.querySelector('.cbar .pill.warn')?.textContent.trim() || '',
      money: Boolean(node.querySelector('.case-side .pill')),
      chips: [...node.querySelectorAll('.case-why .chip')].map(chip => chip.textContent.trim()),
      verbs: [...node.querySelectorAll('.verbs button')].map(btn => btn.dataset.verb),
      hits: [...node.querySelectorAll('.ctext mark.hit')].map(mark => mark.textContent.trim()),
      parent: (node.querySelector('.conpost')?.textContent || '').replace(/\s+/g, ' ').trim(),
      // The verb and the actor sit in sibling spans, so textContent glues them;
      // joining the parts is what makes "Taken down by sita" read like the screen.
      decision: line ? [...line.children].map(part => part.textContent.replace(/\s+/g, ' ').trim()).join(' ') : '',
      verdict: (node.querySelector('.verdict-money')?.textContent || '').replace(/\s+/g, ' ').trim(),
      tellers: [...node.querySelectorAll('.reporters li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()),
    };
  }));
  /**
   * A decision repaints rows it does not remove, so the number of rows on screen
   * is not proof the reload has landed. Ask for the shape this step expects and
   * keep reading until the screen agrees or the step is reported as it stands.
   */
  const rows = async (page, isReady) => {
    let list = [];
    for (let attempt = 0; attempt < 80; attempt += 1) {
      // A queue row keeps its decision buttons and the content itself behind a
      // click, so reading the screen means opening every row on it first.
      await page.evaluate(() => {
        document.querySelectorAll('.case:not(.open) .case-id').forEach(node => node.click());
      });
      list = await readCases(page);
      if (isReady(list)) return list;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    return list;
  };
  const waitCases = (page, want) => rows(page, list => list.length === want);
  const sameSet = (a, b) => [...a].sort().join('|') === [...b].sort().join('|');
  /** The shelf keeps its row count when a decision lands, so compare with the server. */
  const shelfRows = async (page, params) => {
    const want = (await statusOf(page, `/api/admin/content/?${params}`)).body.results.map(row => row.target);
    return rows(page, list => sameSet(list.map(row => row.target), want));
  };
  /** A row the next step clicks on. Missing it is reported, not left to a 40s selector timeout. */
  const found = (list, isRow, what) => {
    const row = list.find(isRow);
    if (!row) {
      ok(`the walkthrough found ${what}`, false, `rows: ${list.map(entry => `${entry.target} [${entry.state}] ${entry.verbs.join('/')}`).join(', ') || 'none'}`);
      throw new Error(`no ${what} on the screen`);
    }
    return row;
  };
  const reload = async (page, needle) => {
    // Typing a search fires one call per keystroke; let those land before asking
    // for the answer this screen is compared against.
    await new Promise(resolve => setTimeout(resolve, 900));
    const answer = page.waitForResponse(res => new RegExp(needle).test(res.url()), { timeout: 40000 });
    await clickText(page, '.console-head-right button', 'Refresh');
    return answer;
  };

  // 7.1 the lists a decision is made against ──────────────────────────────────
  const rulesLoad = owner.waitForResponse(res => /\/api\/admin\/policy\//.test(res.url()), { timeout: 40000 });
  await owner.goto(`${BASE}/policy`, { waitUntil: 'domcontentloaded' });
  const rules0 = await (await rulesLoad).json();
  await owner.waitForSelector('.panel[data-list="word"] .term-add', { timeout: 40000 });
  const headings = await many(owner, '.panel-head h2');
  ok('the rules screen opens on the three lists a review decision is made against',
    headings.some(h => h.startsWith('Blocked words')) && headings.some(h => h.startsWith('Prohibited items'))
      && headings.some(h => h.startsWith('Marketplace categories')) && rules0.auto_hide_at > 0,
    headings.join(' | '));

  await clearAndType(owner, '.panel[data-list="word"] input[name="text"]', '  GunPowder  ');
  await clearAndType(owner, '.panel[data-list="word"] input[name="note"]', 'the walkthrough word, typed with padding');
  await clickText(owner, '.panel[data-list="word"] .term-add button', 'Add');
  const wordSaved = await expectBanner(owner, 'blocked list');
  // The banner lands before the list has re-fetched, so reading the rows straight
  // away sometimes catches the screen a frame too early. Waiting for a row to
  // appear — not for a particular word — keeps a broken normalisation a FAIL.
  await owner.waitForSelector('.panel[data-list="word"] .term-text', { timeout: 40000 })
    .catch(() => undefined);
  const words = await many(owner, '.panel[data-list="word"] .term-text');
  ok('a blocked word is stored in one case, without the padding it was typed with',
    wordSaved.includes('gunpowder') && words.includes('gunpowder')
      && !words.some(word => word !== word.toLowerCase()), `${words.length} words, e.g. ${words[0]}`);

  await clearAndType(owner, '.panel[data-list="word"] input[name="text"]', 'gunpowder');
  await clickText(owner, '.panel[data-list="word"] .term-add button', 'Add');
  const twice = await expectBad(owner, 'already on that list');
  ok('typing the same word twice is refused, in the server’s own sentence',
    twice.includes('gunpowder') && twice.includes('already on that list'), twice);

  await clearAndType(owner, '.panel[data-list="item"] input[name="text"]', 'firearms');
  await clickText(owner, '.panel[data-list="item"] .term-add button', 'Add');
  const itemSaved = await expectBanner(owner, 'prohibited item');
  await until(owner, '.panel[data-list="item"] .term[data-term="firearms"] .pill', 'Enforced');
  const off = await answered(owner, '.term[data-term="firearms"] .term-acts button', 'Turn off',
    'admin/policy/terms/\\d+/');
  const offState = await until(owner, '.term[data-term="firearms"] .pill', 'Switched off');
  const on = await answered(owner, '.term[data-term="firearms"] .term-acts button', 'Turn on',
    'admin/policy/terms/\\d+/');
  const onState = await until(owner, '.term[data-term="firearms"] .pill', 'Enforced');
  ok('an entry is switched off without deleting it, and switched back on',
    itemSaved.includes('firearms') && off.body.is_active === false && on.body.is_active === true
      && offState === 'Switched off' && onState === 'Enforced', `${offState} then ${onState}`);

  await clickText(owner, '.term[data-term="firearms"] .term-acts button', 'Remove');
  const termGone = await expectBanner(owner, 'off the list');
  await waitGone(owner, '.panel[data-list="item"] .term[data-term="firearms"]');
  const itemsLeft = await many(owner, '.panel[data-list="item"] .term-text');
  ok('taking one off the list asks first and then really removes it',
    termGone.includes('firearms') && !itemsLeft.includes('firearms'), `${termGone} — ${itemsLeft.length} left`);

  await clearAndType(owner, '.panel[data-list="categories"] input[name="name"]', 'Bicycles QA');
  await clickText(owner, '.panel[data-list="categories"] .term-add button', 'Add category');
  const catSaved = await expectBanner(owner, 'Bicycles QA');
  await until(owner, '.cats tr[data-cat="Bicycles QA"] .pill', 'On the shelf');
  const hidden = await answered(owner, '.cats tr[data-cat="Bicycles QA"] .cat-acts button', 'Hide',
    'admin/policy/categories/\\d+/');
  const catHidden = await until(owner, '.cats tr[data-cat="Bicycles QA"] .pill', 'Hidden');
  const shown = await answered(owner, '.cats tr[data-cat="Bicycles QA"] .cat-acts button', 'Show',
    'admin/policy/categories/\\d+/');
  const catBack = await until(owner, '.cats tr[data-cat="Bicycles QA"] .pill', 'On the shelf');
  const catWorth = await text(owner, '.cats tr[data-cat="Bicycles QA"] td:nth-child(3)');
  ok('a marketplace shelf label is added, hidden and shown again with what it is worth',
    catSaved.includes('Bicycles QA') && hidden.body.is_active === false && shown.body.is_active === true
      && catHidden === 'Hidden' && catBack === 'On the shelf'
      && /\d/.test(catWorth), `${catHidden} then ${catBack}, ${catWorth} live listings`);
  await shot(owner, 'review-1-policy');

  const ruleNotes = await many(owner, '.note.row');
  const threshold = ruleNotes.find(line => line.includes('pulled out of the feed')) || '';
  ok('the screen names the number that hides a post by itself and where it is changed',
    threshold.includes(`${rules0.auto_hide_at} different`) && threshold.includes('spam controls')
      && threshold.includes('audit log'), threshold.replace(/\s+/g, ' ').slice(0, 120));

  // 7.2 the report queue ──────────────────────────────────────────────────────
  await owner.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.search input', { timeout: 40000 });
  await clearAndType(owner, '.search input', SAMPLE);
  if (await owner.$('.btn.wide')) await clickText(owner, '.btn.wide', 'Show older reports');
  const queuePage = await (await reload(owner, '/api/admin/review/')).json();
  const cases = await waitCases(owner, 7);
  await shot(owner, 'review-2-queue');
  const three = cases.find(row => row.kind === 'post' && row.open === '3');
  const autohid = cases.find(row => row.kind === 'post' && row.state === 'Hidden pending review');
  const paid = cases.find(row => row.money);
  const spare = cases.find(row => row.kind === 'post' && row.open === '1' && !row.money);
  const spoken = cases.find(row => row.kind === 'comment');
  const sell = cases.find(row => row.kind === 'listing');
  const acct = cases.find(row => row.kind === 'user');
  ok('ten reports about seven things are seven decisions, not ten',
    cases.length === 7 && queuePage.results.length === 10
      && cases.reduce((sum, row) => sum + Number(row.open), 0) === 10
      && [three, autohid, paid, spare, spoken, sell, acct].every(Boolean),
    `${cases.length} cases of ${queuePage.results.length} reports: post, comment, listing and account all present`);
  const missing = Object.entries({ three, autohid, paid, spare, spoken, sell, acct })
    .filter(([, row]) => !row).map(([name]) => name);
  if (missing.length) throw new Error(`the queue has no ${missing.join(' or ')} row to click`);

  ok('the reported text is marked where the banned word sits, even inside a longer word',
    three.hits.length === 2 && three.hits.every(hit => hit === 'gunpowder')
      && three.flag.includes('on the blocked list'), `${three.flag} — ${three.hits.join(' + ')}`);

  await clickText(owner, `.case[data-case="${three.target}"] .case-who button`, 'reporters');
  const tellRows = await many(owner, `.case[data-case="${three.target}"] .reporters li`);
  ok('one row opens into the people who reported it, with what each one said',
    tellRows.length === 3 && tellRows.every(line => line.includes('@qa_rep'))
      && tellRows.some(line => line.includes('posted the same caption three times')), tellRows[0]);

  const refusedNotice = owner.waitForResponse(res => /\/decide\/$/.test(res.url()), { timeout: 40000 });
  await tap(owner, `.case[data-case="${three.target}"] .verbs button[data-verb="warn"]`);
  await tap(owner, `.case[data-case="${three.target}"] .ask-actions button`);
  const notice400 = await refusedNotice;
  const needSentence = await see(owner, `.case[data-case="${three.target}"] .card-error`);
  ok('a public notice verb with nothing written comes back 400 and says what is missing',
    notice400.status() === 400 && needSentence.includes('Write the sentence the community is shown')
      && (await waitCases(owner, 7)).length === 7, `HTTP ${notice400.status()} — ${needSentence}`);

  await clearAndType(owner, `.case[data-case="${three.target}"] textarea[name="notice"]`, NOTICE_A);
  const warnedOut = owner.waitForResponse(res => /\/decide\/$/.test(res.url()), { timeout: 40000 });
  await tap(owner, `.case[data-case="${three.target}"] .ask-actions button`);
  const warned = await expectBanner(owner, 'Left up with a public notice');
  const warnBody = await (await warnedOut).json();
  const afterWarn = await waitCases(owner, 6);
  ok('one notice decision speaks for all three reports and the case leaves the queue',
    warned.includes('3 report(s) closed as resolved') && warnBody.reports_closed === 3
      && warnBody.notice.text === NOTICE_A && !afterWarn.some(row => row.target === three.target),
    `${warned} — 6 things left`);

  const soldState = three.state;
  await tap(owner, `.case[data-case="${sell.target}"] .verbs button[data-verb="remove"]`);
  const askFields = await owner.$$eval(`.case[data-case="${sell.target}"] .ask textarea`,
    nodes => nodes.map(node => node.name));
  const noReason = owner.waitForResponse(res => /\/decide\/$/.test(res.url()), { timeout: 40000 });
  await tap(owner, `.case[data-case="${sell.target}"] .ask-actions button`);
  const reason400 = await noReason;
  const needReason = await see(owner, `.case[data-case="${sell.target}"] .card-error`);
  ok('a takedown with no reason is refused — the author has to be told why it came down',
    askFields.join(',') === 'reason,notice' && reason400.status() === 400
      && needReason.includes('Say why it is coming down'), `fields ${askFields.join(' + ')} — ${needReason}`);

  await clearAndType(owner, `.case[data-case="${sell.target}"] textarea[name="reason"]`, REASON_L);
  await clearAndType(owner, `.case[data-case="${sell.target}"] textarea[name="notice"]`, NOTICE_L);
  await tap(owner, `.case[data-case="${sell.target}"] .ask-actions button`);
  const tookListing = await expectBanner(owner, 'Taken down');
  const afterListing = await waitCases(owner, 5);
  ok('a marketplace takedown needs its own reason, and a public sentence when asked for one',
    tookListing.includes('1 report(s) closed + a public notice')
      && !afterListing.some(row => row.target === sell.target), `${tookListing} — 5 things left`);

  const spokenRow = found(afterListing, row => row.target === spoken.target, 'the comment row');
  const parentLine = spokenRow.parent;
  await tap(owner, `.case[data-case="${spoken.target}"] .verbs button[data-verb="dismiss"]`);
  const leftUp = await expectBanner(owner, 'Left up. 1 open report');
  ok('a comment is decided on its own, in the middle of the post it sits on',
    parentLine.includes('on a post by @qa_reviewer') && leftUp.includes('closed as dismissed'),
    `${parentLine.slice(0, 70)}… — ${leftUp}`);

  const acctRow = found(await waitCases(owner, 4), row => row.target === acct.target, 'the account row');
  await tap(owner, `.case[data-case="${acct.target}"] .verbs button[data-verb="dismiss"]`);
  const acctLeft = await waitCases(owner, 3);
  ok('an account row offers no takedown verb, because accounts are suspended from People',
    acctRow.verbs.join(',') === 'dismiss,warn' && acctLeft.length === 3
      && acctLeft.every(row => row.kind === 'post'), `verbs ${acctRow.verbs.join('/')} — 3 left: posts only`);

  ok('the auto-hidden post is waiting with the release verb and the pile that hid it',
    autohid.verbs.includes('release') && autohid.open === '2' && soldState === 'In the feed'
      && spare.verbs.join(',') === 'dismiss,remove,warn',
    `hidden: ${autohid.verbs.join('/')}; live: ${spare.verbs.join('/')}`);

  const byKind = '.toolbar select[aria-label="Filter by what was reported"]';
  await pick(owner, byKind, 'listing', 'target=listing');
  await waitCases(owner, 0);
  const listedEmpty = await see(owner, '.panel.empty h2');
  await pick(owner, byKind, '', '/api/admin/review/');
  await chip(owner, 'all', 'status=all');
  const allRows = await waitCases(owner, 7);
  const everyReport = await owner.$$eval('.cases .case .pile', nodes => nodes.map(node => node.className));
  ok('a decided report does not vanish: every-report view still lists it, marked shut',
    allRows.length === 7 && listedEmpty === 'Nothing here'
      && everyReport.filter(cls => cls.includes('shut')).length === 4,
    `${everyReport.filter(cls => cls.includes('shut')).length} of ${everyReport.length} rows already decided`);
  await chip(owner, 'open', 'status=open');
  await waitCases(owner, 3);

  // 7.3 the takedown shelf ────────────────────────────────────────────────────
  const shelfLoad = owner.waitForResponse(res => /\/api\/admin\/content\//.test(res.url()), { timeout: 40000 });
  await owner.goto(`${BASE}/content`, { waitUntil: 'domcontentloaded' });
  const shelf0 = await (await shelfLoad).json();
  await owner.waitForSelector('.tabs .tab', { timeout: 40000 });
  const tabs = await owner.$$eval('.tabs .tab', nodes => nodes.map(node => ({
    label: node.textContent.trim(), off: node.disabled, active: node.className.includes('active'),
  })));
  ok('the shelf opens on the kind this seat reviews and every tab it can sign is live',
    tabs[0].active && tabs[0].label === 'Posts' && tabs.every(tab => !tab.off) && shelf0.type === 'post',
    tabs.map(tab => tab.label).join(', '));

  await clearAndType(owner, '.search input', AUTHOR);
  await chip(owner, 'all', 'state=all');
  const shelf = await (await reload(owner, '/api/admin/content/')).json();
  const rows0 = await shelfRows(owner, `type=post&state=all&q=${AUTHOR}`);
  const shelfWords = { live: 'in the feed', active: 'live', hidden: 'hidden', removed: 'taken down' };
  const shelfFigures = await owner.$$eval('.facets span', nodes => nodes.map(node => ({
    count: Number(node.querySelector('b').textContent.replace(/[^\d]/g, '')),
    label: node.textContent.replace(node.querySelector('b').textContent, '').trim(),
  })));
  const agreed = shelfFigures.every(figure => Object.keys(shelfWords)
    .some(raw => shelfWords[raw] === figure.label && shelf.counts[raw] === figure.count));
  ok('the shelf totals are the ones its own call counted, in the words each state uses',
    agreed && rows0.length === 4, `${shelfFigures.map(f => `${f.count} ${f.label}`).join(', ')} — ${rows0.length} of ours`);
  await shot(owner, 'review-3-shelf');

  const paidRow = found(rows0, row => row.chips.some(chip => chip.includes('campaign running')),
    'the shelf row with the campaign chip');
  await tap(owner, `.case[data-case="${paidRow.target}"] .verbs button[data-verb="remove"]`);
  await clearAndType(owner, `.case[data-case="${paidRow.target}"] textarea[name="reason"]`, REASON_D);
  const stopped = owner.waitForResponse(res => /\/api\/admin\/content\/post\/\d+\/$/.test(res.url()), { timeout: 40000 });
  await tap(owner, `.case[data-case="${paidRow.target}"] .ask-actions button`);
  const refunded = await expectBanner(owner, 'coins refunded');
  const stopBody = await (await stopped).json();
  const moneyLine = await until(owner, `.case[data-case="${paidRow.target}"] .verdict-money`, 'refunded to @qa_reviewer');
  const stopRecord = await until(owner, `.case[data-case="${paidRow.target}"] .shelf-decision`, REASON_D);
  ok('a takedown that stops a paid campaign names the coins, the account and the reason on file',
    refunded.includes('1 campaign(s) cancelled, 600 coins refunded') && stopBody.refunded === '600'
      && /600 refunded to @qa_reviewer/.test(moneyLine) && stopRecord.includes(REASON_D),
    `${refunded} — ${moneyLine}`);

  const autoRow = found(await shelfRows(owner, `type=post&state=all&q=${AUTHOR}`),
    row => row.state === 'Hidden pending review', 'the hidden post still sitting on the shelf');
  await tap(owner, `.case[data-case="${autoRow.target}"] .verbs button[data-verb="release"]`);
  const freed = await expectBanner(owner, 'Back in the feed');
  const freedState = await until(owner, `.case[data-case="${autoRow.target}"] .cbar .pill`, 'In the feed');
  const afterQueue = await statusOf(owner, `/api/admin/review/?q=${SAMPLE}`);
  ok('releasing content the report counter hid puts it back and clears the pile behind it',
    freed.includes('2 report(s) closed') && freedState === 'In the feed'
      && afterQueue.body.results.length === 1, `${freed} — pill now reads “${freedState}”, 1 report left in the queue`);

  const backRow = found(await shelfRows(owner, `type=post&state=all&q=${AUTHOR}`),
    row => row.target === paidRow.target, 'the campaign row after the release');
  await tap(owner, `.case[data-case="${paidRow.target}"] .verbs button[data-verb="restore"]`);
  const restored = await expectBanner(owner, 'Restored');
  const restoredLine = await until(owner, `.case[data-case="${paidRow.target}"] .shelf-decision`, 'Restored by sita');
  ok('a takedown is undone from the same row, and the shelf keeps who did what',
    backRow.verbs.includes('restore') && restored.includes('The author is told it is back')
      && /^Restored by sita/.test(restoredLine), restoredLine.slice(0, 90));

  await clickText(owner, '.tabs .tab', 'Listings');
  const shelfList = await (await reload(owner, 'type=listing')).json();
  const sellRows = await shelfRows(owner, `type=listing&state=all&q=${AUTHOR}`);
  const takenListing = sellRows.find(row => row.target === sell.target);
  ok('a listing decided in the queue is on the marketplace shelf with the same sentence',
    sameSet(shelfList.results.map(row => row.target), sellRows.map(row => row.target))
      && Boolean(takenListing)
      && /^Taken down by sita/.test(takenListing.decision)
      && takenListing.state === 'Taken down', takenListing ? takenListing.decision.slice(0, 90) : 'missing');

  await clickText(owner, '.tabs .tab', 'Comments');
  await chip(owner, 'taken_down', 'state=taken_down');
  await reload(owner, 'type=comment');
  const commentShelf = await see(owner, '.panel.empty h2');
  ok('a comment that was left up is not on the shelf, and the screen says so instead of spinning',
    commentShelf === 'The shelf is empty', commentShelf);

  // 7.4 the public warning notices ────────────────────────────────────────────
  await owner.goto(`${BASE}/notices`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.search input', { timeout: 40000 });
  await clearAndType(owner, '.search input', AUTHOR);
  await reload(owner, '/api/admin/notices/');
  await owner.waitForFunction(() => document.querySelectorAll('.notice').length === 2, { timeout: 40000 });
  const posted = await owner.$$eval('.notice', nodes => nodes.map(node => ({
    target: node.dataset.target,
    text: node.querySelector('.notice-text').textContent.trim(),
    pill: node.querySelector('.pill').textContent.trim(),
    meta: (node.querySelector('.notice-meta').textContent || '').replace(/\s+/g, ' ').trim(),
    reason: node.querySelector('.notice-reason')?.textContent.trim() || '',
  })));
  ok('both public sentences land on the notice desk, with who wrote them and why',
    posted.length === 2 && posted.every(row => row.pill === 'Standing' && row.meta.includes('written by sita'))
      && posted.some(row => row.target === three.target && row.text === NOTICE_A)
      && posted.filter(row => row.reason).length === 1,
    posted.map(row => `${row.target} ${row.pill}`).join(', '));
  await shot(owner, 'review-4-notices');

  const withdrawOut = owner.waitForResponse(res => /\/withdraw\/$/.test(res.url()), { timeout: 40000 });
  await tap(owner, `.notice[data-target="${sell.target}"] .notice-act button`);
  const withdrawn = await (await withdrawOut).json();
  const withdrew = await expectBanner(owner, 'is withdrawn');
  await owner.waitForFunction(target => (document.querySelector(`.notice[data-target="${target}"] .pill`)?.textContent
    || '').includes('Withdrawn'), { timeout: 40000 }, sell.target);
  const deskCount = await text(owner, '.toolbar-count');
  ok('withdrawing a notice is a state, not a deletion: the row stays, marked withdrawn',
    withdrawn.is_live === false && withdrew.includes('@qa_reviewer')
      && deskCount.startsWith('1 standing of 2') && !(await owner.$(`.notice[data-target="${sell.target}"] .notice-act`)),
    `${withdrew} — ${deskCount}`);

  await chip(owner, 'post', 'target=post');
  await reload(owner, 'target=post');
  await owner.waitForFunction(() => document.querySelectorAll('.notice').length === 1, { timeout: 40000 });
  const oneKind = await text(owner, '.notice .notice-text');
  ok('the notice desk filters to what a person is asking about',
    oneKind === NOTICE_A, oneKind.slice(0, 60));

  // 7.5 the pen is per-seat, not per-screen ────────────────────────────────────
  await seatSignIn(mod, SEAT, secrets[SEAT]);
  await mod.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  await mod.waitForSelector('.panel.blocked', { timeout: 40000 });
  const doorShut = await statusOf(mod, `/api/admin/review/?q=${SAMPLE}`);
  ok('a seat without the report key is refused the queue by name, on both sides',
    (await text(mod, '.blocked h2')) === 'Not on your seat' && doorShut.status === 403
      && doorShut.body.permission === 'reports', `HTTP ${doorShut.status} ${doorShut.body.permission}`);

  await owner.bringToFront();
  await owner.goto(`${BASE}/access`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.search input', { timeout: 40000 });
  await clearAndType(owner, '.search input', SEAT);
  await openSeat(owner, SEAT);
  await clickText(owner, '.seat-keys button.key', 'Report queue');
  for (let n = 0; n < 2; n += 1) {
    await clickText(owner, '.seat-keys button.key', 'Post and comment review');
  }
  await clickText(owner, '.key-actions button', 'Save screens');
  await expectBanner(owner, 'Saved');
  const noPen = (await statusOf(owner, `/api/admin/staff/?q=${SEAT}`)).body.results[0];
  ok('the Client hands the queue back and takes the feed pen away, two clicks and a save',
    noPen.permissions.includes('reports') && noPen.permissions.includes('listings')
      && !noPen.permissions.includes('content'), `denied ${noPen.denied_keys.join(',')}`);

  await mod.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  await mod.waitForSelector('.search input', { timeout: 40000 });
  await clearAndType(mod, '.search input', SAMPLE);
  const modRows = await waitCases(mod, 1);
  const modRead = await statusOf(mod, `/api/admin/review/?q=${SAMPLE}`);
  const lockNote = await text(mod, '.cases .case .decide .note.row');
  const disabledVerbs = await mod.$$eval('.cases .case .verbs button', nodes => nodes.map(node => node.disabled));
  ok('the seat that lost the pen still reads the report, but cannot sign it',
    modRead.status === 200 && modRows[0].target === spare.target && lockNote.includes('Post and comment review')
      && disabledVerbs.every(Boolean), `${lockNote.replace(/\s+/g, ' ').slice(0, 90)} — ${modRead.status}`);
  const refused = await postOf(mod, `/api/admin/review/${modRead.body.results[0].id}/decide/`,
    { action: 'dismiss', reason: '', notice: '' });
  ok('and the endpoint refuses the same verb naming the missing key, not a blank page',
    refused.status === 403 && refused.body.permission === 'content'
      && refused.body.label === 'Post and comment review', `HTTP ${refused.status} ${refused.body.permission}`);
  await shot(mod, 'review-5-no-pen');

  await mod.goto(`${BASE}/policy`, { waitUntil: 'domcontentloaded' });
  await mod.waitForSelector('.policy-grid', { timeout: 40000 });
  const modNotes = (await many(mod, '.panel .note.row')).map(line => line.replace(/\s+/g, ' '));
  ok('a moderator reads the rules and changes none of them',
    !(await mod.$('.term-add')) && modNotes.some(l => l.includes('changing it is not'))
      && modNotes.some(l => l.includes('Marketplace categories')), modNotes.join(' | ').slice(0, 130));

  await owner.bringToFront();
  await clickText(owner, '.seat-keys button.key', 'Post and comment review');
  await clickText(owner, '.key-actions button', 'Save screens');
  await expectBanner(owner, 'Saved');
  const withPen = (await statusOf(owner, `/api/admin/staff/?q=${SEAT}`)).body.results[0];
  ok('giving it back is one more click, with no new code anywhere',
    withPen.permissions.includes('content') && !withPen.denied_keys.includes('content'),
    `${withPen.permissions.length} screens, denied ${withPen.denied_keys.join(',') || 'none'}`);

  await mod.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  await mod.waitForSelector('.search input', { timeout: 40000 });
  await clearAndType(mod, '.search input', SAMPLE);
  await waitCases(mod, 1);
  await tap(mod, `.case[data-case="${spare.target}"] .verbs button[data-verb="dismiss"]`);
  const seatLeft = await expectBanner(mod, 'Left up. 1 open report');
  const emptyDesk = await see(mod, '.panel.empty h2');
  ok('the moderator who was handed the pen clears the last report on the queue',
    seatLeft.includes('closed as dismissed') && emptyDesk === 'Nothing here', `${seatLeft} — the desk is ${emptyDesk}`);

  await owner.bringToFront();
  await owner.goto(`${BASE}/content`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.search input', { timeout: 40000 });
  await clearAndType(owner, '.search input', AUTHOR);
  await chip(owner, 'all', 'state=all');
  await reload(owner, '/api/admin/content/');
  const auditRows = await shelfRows(owner, `type=post&state=all&q=${AUTHOR}`);
  const modRecord = auditRows.find(row => row.target === spare.target);
  ok('the audit names the moderator who decided, not the Client who was watching',
    Boolean(modRecord) && /^Reports dismissed by moddemo/.test(modRecord.decision),
    modRecord ? modRecord.decision.slice(0, 90) : `rows: ${auditRows.map(row => `${row.target} ${row.decision}`).join(' / ')}`);

  // ── 8. user management and enforcement (contract 6.4) ──────────────────────
  /*
   * The six accounts below are made by admin/qa/people_seed.py and belong to this
   * walkthrough alone, so every claim is about an account the run just changed —
   * never about how many suspended or verified accounts the demo database happens
   * to be holding at the time.
   */
  const MEMBER = 'qa_member';     // signed up with Google, starts with no tick
  const FLAGGED = 'qa_flagged';   // a real pile, a lockout, warning emails turned off
  const BARRED = 'qa_barred';     // suspended for days, then handed back
  const FOREVER = 'qa_forever';   // suspended for good, then handed back
  const WALLETED = 'qa_walleted'; // holds the coins a deletion refuses
  const GONER = 'qa_goner';       // owes nothing, and is deleted by this run
  const SEARCH = '.search input';
  const PROVIDER_CHIP = '.toolbar select[aria-label="Filter by sign-up method"]';
  const REASON = '.person.open .ask textarea[name="reason"]';
  const WARN_BOX = '.person.open .ask textarea[name="warn_text"]';
  const DAYS = '.person.open .ask input[aria-label="Days of suspension"]';
  const TYPED = '.person.open .ask input[aria-label="Type the username to confirm"]';
  const CONFIRM = '.person.open .ask-actions button';
  const CANCEL = '.person.open .ask-actions button:nth-child(2)';
  const verbAt = verb => `.person.open .verbs button[data-verb="${verb}"]`;

  const TICK_WHY = 'console QA sample - confirmed the shop behind this profile in person';
  const WARN_TEXT = 'console QA sample - second warning about your comments to other members.';
  const SUSPEND_WHY = 'console QA sample - three upheld reports this month, barred until you appeal';
  const FOREVER_WHY = 'console QA sample - selling prohibited items from a re-opened account';
  const CLEAR_WHY = 'console QA sample - the pile was one dispute, not spam';
  const DELETE_WHY = 'console QA sample - created for this walkthrough and used for nothing else';
  const MOD_WHY = 'console QA sample - the moderator seat holds the pen again';

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const listed = page => page.$$eval('.person', nodes => nodes.map(node => node.dataset.person));
  /** The screen and the server have to agree about who is listed before the screen is believed. */
  async function peopleShown(page, params) {
    let dom = [];
    let want = [];
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const call = await statusOf(page, `/api/admin/people/?${params}`);
      want = (call.body.results || []).map(row => row.username);
      dom = await listed(page);
      if (sameSet(dom, want)) return dom;
      await sleep(300);
    }
    throw new Error(`the directory never settled on ${params || 'the first page'}`
      + ` — screen ${dom.join(',')} / server ${want.join(',')}`);
  }
  const pillsOf = (page, username) => page.$$eval('.person', (nodes, name) => {
    const read = node => (node.children.length
      ? [...node.children].map(part => part.textContent).join(' ') : node.textContent)
      .replace(/\s+/g, ' ').trim();
    const row = nodes.find(node => node.dataset.person === name);
    return row ? [...row.querySelectorAll('.person-flags .pill, .person-flags .pile')].map(read) : [];
  }, username);
  const pillWaiting = async (page, username, needle) => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const hit = (await pillsOf(page, username)).find(pill => pill.includes(needle));
      if (hit) return hit;
      await sleep(300);
    }
    return '';
  };
  const pillGone = async (page, username, needle) => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (!(await pillsOf(page, username)).some(pill => pill.includes(needle))) return true;
      await sleep(300);
    }
    return false;
  };
  /** Expand one account, and fail with the sentence the card answered if it will not open. */
  async function openPerson(page, username) {
    await page.waitForFunction(name => [...document.querySelectorAll('.person')]
      .some(node => node.dataset.person === name), { timeout: 40000 }, username);
    await page.evaluate(name => {
      const row = [...document.querySelectorAll('.person')].find(node => node.dataset.person === name);
      if (!row.className.includes('open')) row.querySelector('.person-id').click();
    }, username);
    const ready = await page.waitForFunction(() => (document.querySelector('.person.open .person-body .facts')
      ? 'open' : document.querySelector('.person .card-error') ? 'error' : false), { timeout: 40000 });
    if (await ready.jsonValue() !== 'open') throw new Error(`the card for ${username} answered: ${await text(page, '.person .card-error')}`);
  }
  const heldBack = (page, selector) => page.$eval(selector, node => node.disabled);
  const askBox = page => page.waitForSelector('.person.open .ask', { timeout: 40000 });
  /** A refusal this card raises itself is painted inside the ask box, not on the page banner. */
  const badAsk = async (page, needle) => {
    await page.waitForFunction(want => [...document.querySelectorAll('.person.open .ask .card-error')]
      .some(node => node.textContent.includes(want)), { timeout: 40000 }, needle);
    return lineText(page, '.person.open .ask .card-error');
  };
  const rowGone = (page, username) => page.waitForFunction(name => ![...document.querySelectorAll('.person')]
    .some(node => node.dataset.person === name), { timeout: 40000 }, username);

  // 8.1 the directory, and how each account first reached the platform ────────
  await owner.bringToFront();
  await owner.goto(`${BASE}/people`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector(SEARCH, { timeout: 40000 });
  const firstPage = await peopleShown(owner, '');
  const door = (await statusOf(owner, '/api/admin/people/')).body;
  ok('the directory opens ten accounts at a time and hands a cursor for the rest',
    firstPage.length === 10 && door.next_cursor && door.facets.total > 10,
    `${firstPage.length} of ${door.facets.total} accounts`);

  const facetLine = await lineText(owner, '.facets');
  ok('the line above it counts the four things a seat filters on',
    /\d+ accounts/.test(facetLine) && /flagged at 3\+ reporters/.test(facetLine)
      && /sign-in locked/.test(facetLine) && /\d+ verified/.test(facetLine),
    facetLine.replace(/\s+/g, ' ').slice(0, 150));

  await clearAndType(owner, SEARCH, MEMBER);
  ok('one account is found by its username',
    (await peopleShown(owner, `q=${MEMBER}`)).join() === MEMBER, MEMBER);
  await clearAndType(owner, SEARCH, '@example.test');
  const byMail = await peopleShown(owner, 'q=%40example.test');
  ok('and by the address it signed up with',
    byMail.length > 1 && byMail.includes(MEMBER), `${byMail.length} accounts on that domain`);

  await clearAndType(owner, SEARCH, 'qa_');
  await peopleShown(owner, 'q=qa_');
  await pick(owner, PROVIDER_CHIP, 'apple', 'provider=apple');
  const byApple = await peopleShown(owner, 'q=qa_&provider=apple');
  ok('a method nobody used answers with an empty list, not with everyone',
    byApple.length === 0 && (await text(owner, '.panel.empty h2')) === 'Nobody matches this view',
    'no account signed up with Apple');
  await pick(owner, PROVIDER_CHIP, 'google', 'provider=google');
  const byGoogle = await peopleShown(owner, 'q=qa_&provider=google');
  await pick(owner, PROVIDER_CHIP, 'facebook', 'provider=facebook');
  const byFacebook = await peopleShown(owner, 'q=qa_&provider=facebook');
  ok('the sign-up method is on the row itself, so a seat sees how they arrived',
    byGoogle.join() === MEMBER && byFacebook.join() === WALLETED
      && (await pillWaiting(owner, WALLETED, 'Facebook')) === 'Facebook',
    `${MEMBER} via Google, ${WALLETED} via Facebook`);
  await pick(owner, PROVIDER_CHIP, 'all', 'q=qa_');
  await peopleShown(owner, 'q=qa_');

  await clearAndType(owner, SEARCH, FLAGGED);
  const flaggedOn = await peopleShown(owner, `q=${FLAGGED}`);
  const pile = (await statusOf(owner, `/api/admin/people/?q=${FLAGGED}`)).body.results[0];
  const pilePill = await pillWaiting(owner, FLAGGED, 'against');
  ok('the flag is the pile the queue already counted, in the seat’s own words',
    flaggedOn.join() === FLAGGED && pile.flags.reporters >= pile.flags.auto_hide_at
      && pilePill === `${pile.flags.on_account + pile.flags.on_content} reports against ${pile.flags.reporters} reporters`,
    pilePill);
  const lockPill = await pillWaiting(owner, FLAGGED, 'failed sign-ins');
  ok('a sign-in lockout and the account’s own email choice are on the same row',
    lockPill === `${pile.failed_attempts} failed sign-ins, locked`
      && (await pillsOf(owner, FLAGGED)).includes('warning emails off'),
    `${lockPill} | warning emails off`);
  await shot(owner, 'people-1-directory');

  // 8.2 verifying an account by hand ─────────────────────────────────────────
  await clearAndType(owner, SEARCH, MEMBER);
  await peopleShown(owner, `q=${MEMBER}`);
  await openPerson(owner, MEMBER);
  ok('the tick button already says which way it is going to move it',
    (await until(owner, verbAt('verify'), 'Give the verified tick')).includes('Give the verified tick'));
  await tap(owner, verbAt('verify'));
  await askBox(owner);
  ok('putting a tick on asks for the reason before it lets the button through',
    await heldBack(owner, CONFIRM) === true, 'Confirm is disabled while the reason is blank');
  await clearAndType(owner, REASON, TICK_WHY);
  const ticked = await answered(owner, CONFIRM, 'Confirm', `admin/people/${MEMBER}/verify/`);
  const tickBanner = await expectBanner(owner, 'is verified');
  ok('one sentence is enough, and the tick lands on the account it names',
    ticked.status === 200 && tickBanner.includes(`@${MEMBER}`), tickBanner);
  ok('and repaints the row the seat is looking at',
    (await until(owner, '.person.open .person-name', '✓')).includes('✓'), 'the grey tick is on the name');
  const tickRecord = (await statusOf(owner, `/api/admin/people/${MEMBER}/`)).body;
  ok('the record names the seat that signed it and keeps why it was worth one',
    tickRecord.person.verified === true && tickRecord.audit[0].action === 'verify_user'
      && tickRecord.audit[0].actor === OWNER && tickRecord.audit[0].detail.includes(TICK_WHY),
    `${tickRecord.audit[0].action} by ${tickRecord.audit[0].actor}`);
  const tickTwice = await postOf(owner, `/api/admin/people/${MEMBER}/verify/`, { verified: true, reason: TICK_WHY });
  ok('asking the same account for the tick twice is refused, not counted twice',
    tickTwice.status === 400 && /already on/.test(tickTwice.body.detail), `${tickTwice.status} ${tickTwice.body.detail}`);
  ok('and the button now reads as the way round it will go next',
    (await until(owner, verbAt('verify'), 'Take the tick off')).includes('Take the tick off'));
  await shot(owner, 'people-2-verified');

  // 8.3 a direct warning, sent by a Moderator ────────────────────────────────
  await mod.bringToFront();
  await mod.goto(`${BASE}/people`, { waitUntil: 'domcontentloaded' });
  await mod.waitForSelector(SEARCH, { timeout: 40000 });
  await clearAndType(mod, SEARCH, FLAGGED);
  await peopleShown(mod, `q=${FLAGGED}`);
  await openPerson(mod, FLAGGED);
  await tap(mod, verbAt('warn'));
  await askBox(mod);
  ok('a warning with no words in it cannot be sent',
    await heldBack(mod, CONFIRM) === true, 'Confirm is disabled while the box is empty');
  await clearAndType(mod, WARN_BOX, WARN_TEXT);
  const warnSent = await answered(mod, CONFIRM, 'Confirm', `admin/people/${FLAGGED}/warn/`);
  const warnBanner = await expectBanner(mod, 'was warned in the app');
  ok('the warning goes to their bell, and the screen says out loud it was kept out of their inbox',
    warnSent.status === 200 && warnSent.body.opted_out === true
      && warnBanner.includes('turned warning emails off'), warnBanner);
  ok('and the words are on the account record the next seat reads',
    (await until(mod, '.person.open .person-record', WARN_TEXT.slice(0, 40))).includes(WARN_TEXT.slice(0, 40)));
  const warnRecord = (await statusOf(mod, `/api/admin/people/${FLAGGED}/`)).body;
  ok('with the seat that sent it written next to them',
    warnRecord.warnings[0].text === WARN_TEXT && warnRecord.warnings[0].actor === SEAT
      && warnRecord.audit[0].action === 'warn_user', `@${warnRecord.warnings[0].actor}`);
  await shot(mod, 'people-3-warned');

  // 8.4 clearing a spam flag ─────────────────────────────────────────────────
  await owner.bringToFront();
  await owner.goto(`${BASE}/people`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector(SEARCH, { timeout: 40000 });
  await clearAndType(owner, SEARCH, FLAGGED);
  await peopleShown(owner, `q=${FLAGGED}`);
  await openPerson(owner, FLAGGED);
  await tap(owner, verbAt('clear_flags'));
  await askBox(owner);
  ok('closing a pile also needs the reason the audit row keeps',
    await heldBack(owner, CONFIRM) === true, 'Confirm is disabled while the reason is blank');
  await clearAndType(owner, REASON, CLEAR_WHY);
  const cleared = await answered(owner, CONFIRM, 'Confirm', `admin/people/${FLAGGED}/clear-flags/`);
  const clearBanner = await expectBanner(owner, 'open report(s) closed');
  ok('one click closes the whole pile — on the account and on its content — and the lockout too',
    cleared.status === 200 && cleared.body.reports_closed === pile.flags.on_account + pile.flags.on_content
      && /login lockout cleared/.test(clearBanner), clearBanner);
  ok('and it admits what it did not do: a takedown somebody decided stays decided',
    cleared.body.held_posts === 0 && clearBanner.includes('Nothing of theirs is held'),
    clearBanner.slice(-60));
  const clearedRow = (await statusOf(owner, `/api/admin/people/${FLAGGED}/`)).body.person;
  ok('with the lockout column actually cleared, not just hidden',
    clearedRow.locked_until === null && clearedRow.failed_attempts === 0
      && clearedRow.flags.on_account + clearedRow.flags.on_content === 0,
    `${clearedRow.failed_attempts} failed sign-ins, ${clearedRow.flags.on_account + clearedRow.flags.on_content} open reports`);
  ok('the flag and the lockout pills leave the row with it',
    (await pillGone(owner, FLAGGED, 'reports against')) && (await pillGone(owner, FLAGGED, 'failed sign-ins'))
      && (await pillWaiting(owner, FLAGGED, 'In good standing')) === 'In good standing', 'back to good standing');
  await chip(owner, 'flagged', 'status=flagged');
  const stillFlagged = await peopleShown(owner, `q=${FLAGGED}&status=flagged`);
  ok('the flagged filter no longer lists the account it just cleared',
    stillFlagged.length === 0, 'the pile is gone from the state chip too');
  await chip(owner, 'all', 'q=qa_flagged');
  ok('and switching back to Everyone finds it again, because clearing flags is not deleting',
    (await peopleShown(owner, `q=${FLAGGED}`)).join() === FLAGGED, FLAGGED);
  await shot(owner, 'people-4-flags-cleared');

  // 8.5 a suspension with an end, and handing the account back ───────────────
  await clearAndType(owner, SEARCH, BARRED);
  await peopleShown(owner, `q=${BARRED}`);
  await openPerson(owner, BARRED);
  await tap(owner, verbAt('suspend'));
  await askBox(owner);
  const kinds = await owner.$$eval('.person.open .suspend-kind select option',
    nodes => nodes.map(node => node.textContent.trim()));
  ok('a bar is asked as a number of days, an end date, or no end at all',
    kinds.length === 3 && /permanent/i.test(kinds[2]), kinds.join(' | '));
  ok('and it will not bar anyone without the sentence their email carries',
    await heldBack(owner, CONFIRM) === true, 'Confirm is disabled while the reason is blank');
  await clearAndType(owner, REASON, SUSPEND_WHY);
  await clearAndType(owner, DAYS, '30');
  await answered(owner, CONFIRM, 'Confirm', `admin/people/${BARRED}/suspend/`);
  const barBanner = await expectBanner(owner, 'open session(s) cannot be renewed');
  ok('a dated bar signs them out at once and says where the mail went',
    new RegExp(`^Suspended until \\d+ \\w+ \\d{4}\\. \\d+ open session\\(s\\) cannot be renewed\\. An email went to ${BARRED}@example\\.test\\.$`).test(barBanner),
    barBanner);
  const barDetail = (await statusOf(owner, `/api/admin/people/${BARRED}/`)).body;
  const barPill = await pillWaiting(owner, BARRED, 'Suspended to');
  ok('the date on the row is the date the server wrote, and it is still counting down',
    barPill.includes(barDetail.person.suspension.until.slice(0, 10))
      && barDetail.person.suspension.days_left > 20 && barDetail.person.suspension.reason === SUSPEND_WHY,
    `${barPill}, ${barDetail.person.suspension.days_left} days left`);
  ok('a bar is a bar and not a deletion: the purse and the content are untouched',
    barDetail.holdings.balance === '0.00' && barDetail.audit[0].action === 'suspend_user'
      && barDetail.audit[0].actor === OWNER, `${barDetail.holdings.posts} posts still theirs`);
  await tap(owner, verbAt('reinstate'));
  const lifted = await expectBanner(owner, 'The suspension is lifted');
  ok('reinstating is one click with no form in front of it',
    lifted.includes('sign in again right now') && !(await owner.$('.person.open .ask')), lifted);
  ok('the row drops back to good standing and hands the Suspend button to the seat',
    (await pillWaiting(owner, BARRED, 'In good standing')) === 'In good standing'
      && (await until(owner, verbAt('suspend'), 'Suspend')).includes('Suspend')
      && !(await owner.$(verbAt('reinstate'))), 'the bar is off, in both directions');
  await shot(owner, 'people-5-suspended');

  // 8.6 a suspension with no end ─────────────────────────────────────────────
  await clearAndType(owner, SEARCH, FOREVER);
  await peopleShown(owner, `q=${FOREVER}`);
  await openPerson(owner, FOREVER);
  await tap(owner, verbAt('suspend'));
  await askBox(owner);
  await owner.select('.person.open .suspend-kind select', 'permanent');
  const foreverNote = await see(owner, '.person.open .suspend-kind .fineprint');
  ok('choosing no end says what it really is: the same column set far ahead',
    /reinstate/.test(foreverNote) && /not deleting/.test(foreverNote), foreverNote.replace(/\s+/g, ' ').slice(0, 110));
  await clearAndType(owner, REASON, FOREVER_WHY);
  const barredGood = await answered(owner, CONFIRM, 'Confirm', `admin/people/${FOREVER}/suspend/`);
  const foreverBanner = await expectBanner(owner, 'Suspended for good');
  ok('a permanent bar is written, mailed and said in one sentence',
    /^Suspended for good\. \d+ open session\(s\) cannot be renewed\. An email went to/.test(foreverBanner)
      && barredGood.body.permanent === true, foreverBanner);
  const foreverDetail = (await statusOf(owner, `/api/admin/people/${FOREVER}/`)).body;
  ok('and it has no end coming round, so only a reinstate can lift it',
    (await pillWaiting(owner, FOREVER, 'Suspended for good')) === 'Suspended for good'
      && foreverDetail.person.suspension.permanent === true
      && foreverDetail.person.suspension.days_left === null, 'no date, no countdown');
  const facetAfter = await until(owner, '.facets', 'suspended for good');
  ok('the directory counts it apart from the bars that end on their own',
    /\d+ suspended for good/.test(facetAfter), facetAfter.replace(/\s+/g, ' ').slice(0, 150));
  await tap(owner, verbAt('reinstate'));
  ok('and the same one-click reinstate takes that bar off too',
    (await pillWaiting(owner, FOREVER, 'In good standing')) === 'In good standing', 'lifted, with no date to wait for');
  const afterForever = (await statusOf(owner, `/api/admin/people/${FOREVER}/`)).body;
  ok('with nothing left half-set: one column, and it is empty',
    afterForever.person.suspension === null
      && afterForever.audit.some(entry => entry.action === 'reinstate_user'), 'no second flag anywhere');

  // 8.7 what a deletion refuses, and why ─────────────────────────────────────
  await clearAndType(owner, SEARCH, WALLETED);
  await peopleShown(owner, `q=${WALLETED}`);
  await openPerson(owner, WALLETED);
  const purseFacts = await lineText(owner, '.person.open .person-side .facts');
  ok('the card says up front what a deletion would take',
    purseFacts.includes('250.00 coins') && purseFacts.includes('Running campaigns')
      && purseFacts.includes('Payment proofs waiting') && purseFacts.includes('Content'),
    purseFacts.replace(/\s+/g, ' ').slice(0, 130));
  await tap(owner, verbAt('delete'));
  await askBox(owner);
  const guardNote = (await many(owner, '.person.open .ask .note.row')).map(l => l.replace(/\s+/g, ' ')).join(' | ');
  ok('and warns in the box that the wallet has to be settled first',
    guardNote.includes('wallet with the ledger in it') && guardNote.includes('refused while a campaign runs'),
    guardNote.slice(0, 150));
  await clearAndType(owner, REASON, DELETE_WHY);
  ok('a reason alone does not open the button', await heldBack(owner, CONFIRM) === true, 'name still missing');
  await clearAndType(owner, TYPED, 'not-the-username');
  ok('nor does a name typed wrongly', await heldBack(owner, CONFIRM) === true, 'Confirm still disabled');
  await clearAndType(owner, TYPED, WALLETED);
  ok('only the exact username opens it', await heldBack(owner, CONFIRM) === false, 'Confirm enabled');
  await tap(owner, CONFIRM);
  const heldMail = await badAsk(owner, 'wallet still holds');
  ok('and the server still refuses while the purse holds coins, naming the screen that empties it',
    heldMail.includes('250.00') && heldMail.includes('Coins and payments'), heldMail);
  const purseStill = (await statusOf(owner, `/api/admin/people/${WALLETED}/`)).body;
  ok('the account is left there to be settled properly, not half-deleted',
    purseStill.holdings.balance === '250.00' && purseStill.person.is_active === true,
    `${purseStill.holdings.balance} coins still on it`);
  await tap(owner, CANCEL);

  // 8.8 deleting an account that owes nothing ────────────────────────────────
  await clearAndType(owner, SEARCH, GONER);
  await peopleShown(owner, `q=${GONER}`);
  await openPerson(owner, GONER);
  const taking = await lineText(owner, '.person.open .person-side .facts');
  ok('the same card on an empty purse lists what goes with it',
    taking.includes('0.00 coins') && taking.includes('1 posts, 1 comments'),
    taking.replace(/\s+/g, ' ').slice(0, 130));
  await tap(owner, verbAt('delete'));
  await askBox(owner);
  await clearAndType(owner, REASON, DELETE_WHY);
  await clearAndType(owner, TYPED, GONER);
  const destroyed = await answered(owner, CONFIRM, 'Confirm', `admin/people/${GONER}/delete/`);
  const goneBanner = await expectBanner(owner, 'is deleted');
  ok('nothing owed, name typed, and the account is destroyed with what it posted',
    destroyed.status === 200 && goneBanner.includes('1 post(s)') && goneBanner.includes('1 comment(s)')
      && goneBanner.includes('cannot be undone'), goneBanner);
  await rowGone(owner, GONER);
  const afterGone = await statusOf(owner, `/api/admin/people/${GONER}/`);
  ok('the row leaves the directory and the username answers 404 afterwards',
    afterGone.status === 404 && /not an account/.test(afterGone.body.detail), `HTTP ${afterGone.status}`);
  await shot(owner, 'people-6-deleted');

  // 8.9 nobody locks the door they are standing behind ───────────────────────
  await clearAndType(owner, SEARCH, OWNER);
  await peopleShown(owner, `q=${OWNER}`);
  await openPerson(owner, OWNER);
  ok('the account you are signed in with is marked as such, and every action on it is off',
    (await pillsOf(owner, OWNER)).includes('You')
      && (await owner.$$eval('.person.open .verbs button', nodes => nodes.map(node => node.disabled))).length >= 4
      && (await owner.$$eval('.person.open .verbs button', nodes => nodes.every(node => node.disabled))),
    'the Client cannot suspend themselves from their own seat');
  ok('with the reason printed where the buttons would have done the damage',
    (await see(owner, '.person.open .person-side .note.row')).includes('signed in with'),
    'the card says why the buttons are dead');
  const selfBar = await postOf(owner, `/api/admin/people/${OWNER}/suspend/`, { days: 1, reason: 'lock myself out' });
  ok('and the endpoint refuses it too, so a hand-typed request cannot lock the Client out either',
    selfBar.status === 400 && /signed in with/.test(selfBar.body.detail), `${selfBar.status} ${selfBar.body.detail}`);

  // 8.10 the pen for acting on an account is its own screen ──────────────────
  await owner.bringToFront();
  await owner.goto(`${BASE}/access`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.search input', { timeout: 40000 });
  await clearAndType(owner, '.search input', SEAT);
  await openSeat(owner, SEAT);
  for (const screen of ['Suspend, reinstate, verify, delete', 'Private warnings to users']) {
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await clickText(owner, '.seat-keys button.key', screen);
    }
  }
  await clickText(owner, '.key-actions button', 'Save screens');
  await expectBanner(owner, 'Saved');
  const stripped = (await statusOf(owner, `/api/admin/staff/?q=${SEAT}`)).body.results[0];
  ok('the Client can hand a seat the whole directory and take the pen off it',
    stripped.denied_keys.includes('user_actions') && stripped.denied_keys.includes('warnings')
      && stripped.permissions.includes('users'), `denied ${stripped.denied_keys.join(', ')}`);

  await mod.bringToFront();
  await mod.goto(`${BASE}/people`, { waitUntil: 'domcontentloaded' });
  await mod.waitForSelector(SEARCH, { timeout: 40000 });
  await clearAndType(mod, SEARCH, BARRED);
  await peopleShown(mod, `q=${BARRED}`);
  await openPerson(mod, BARRED);
  const penless = await see(mod, '.person.open .person-side .note');
  ok('a seat that reads everybody and signs nobody is told so on the card',
    penless.includes('holds neither'), penless.replace(/\s+/g, ' ').slice(0, 120));
  const deadButtons = await mod.$$eval('.person.open .verbs button', nodes => nodes.length);
  ok('and gets no buttons at all, rather than six dead ones to click',
    deadButtons === 0, `${deadButtons} verbs offered`);
  const penlessBar = await postOf(mod, `/api/admin/people/${BARRED}/suspend/`, { days: 2, reason: 'no pen' });
  const penlessWarn = await postOf(mod, `/api/admin/people/${BARRED}/warn/`, { text: 'no pen', reason: '' });
  ok('the endpoints answer which screen is missing, so the seat knows what to ask for',
    penlessBar.status === 403 && penlessBar.body.permission === 'user_actions'
      && penlessWarn.status === 403 && penlessWarn.body.permission === 'warnings',
    `${penlessBar.body.permission} / ${penlessWarn.body.permission}`);
  ok('while reading an account stays open, because that is a different key',
    (await statusOf(mod, `/api/admin/people/${BARRED}/`)).status === 200, 'the directory still reads');
  await shot(mod, 'people-7-no-pen');

  await owner.bringToFront();
  await clickText(owner, '.seat-keys button.key', 'Suspend, reinstate, verify, delete');
  await clickText(owner, '.seat-keys button.key', 'Private warnings to users');
  await clickText(owner, '.key-actions button', 'Save screens');
  await expectBanner(owner, 'Saved');
  const handed = (await statusOf(owner, `/api/admin/staff/?q=${SEAT}`)).body.results[0];
  ok('giving it back is one click each, with no new code anywhere',
    !handed.denied_keys.includes('user_actions') && !handed.denied_keys.includes('warnings')
      && handed.permissions.includes('user_actions') && handed.permissions.includes('warnings'),
    `denied ${handed.denied_keys.join(', ') || 'none'}`);

  await mod.bringToFront();
  await mod.goto(`${BASE}/people`, { waitUntil: 'domcontentloaded' });
  await mod.waitForSelector(SEARCH, { timeout: 40000 });
  await clearAndType(mod, SEARCH, BARRED);
  await peopleShown(mod, `q=${BARRED}`);
  await openPerson(mod, BARRED);
  await tap(mod, verbAt('suspend'));
  await askBox(mod);
  await clearAndType(mod, REASON, MOD_WHY);
  await clearAndType(mod, DAYS, '1');
  const byMod = await answered(mod, CONFIRM, 'Confirm', `admin/people/${BARRED}/suspend/`);
  const modBanner = await expectBanner(mod, 'open session(s) cannot be renewed');
  ok('the seat that was handed the pen signs a member out for a day',
    byMod.status === 200 && /^Suspended until \d+ \w+ \d{4}\./.test(modBanner)
      && modBanner.includes(`${BARRED}@example.test`), modBanner);
  await tap(mod, verbAt('reinstate'));
  const modLifted = await expectBanner(mod, 'The suspension is lifted');
  const modAudit = (await statusOf(mod, `/api/admin/people/${BARRED}/`)).body.audit;
  ok('and the audit row says the Moderator did it, not the Client who was watching',
    modLifted.includes('sign in again right now') && modAudit[0].actor === SEAT
      && modAudit[0].action === 'reinstate_user'
      && modAudit.some(entry => entry.actor === SEAT && entry.action === 'suspend_user'),
    `${modAudit[0].action} by ${modAudit[0].actor}`);
  await shot(mod, 'people-8-moderator-decides');

  // ── 9. the notice desk and the first-load wording (contract 6.5, 6.6) ──────
  /*
   * Section 7 proved the notice that comes out of a decision; this proves the one
   * that comes out of the desk alone, on content nobody reported, and then the
   * wording a visitor reads before they have an account. Both halves are written
   * by this run and wiped by the seeds that made the content they act on.
   */
  const NOTICE_TEXT = 'console QA sample - this claim has been checked and is false.';
  const NOTICE_WHY = 'console QA sample - misinformation, the health claim has no source';
  const NOTICE_AGAIN = 'console QA sample - and this second sentence stands beside the first.';
  const CARD_MESSAGE = 'console QA sample - a hundred small studios, one feed to see them all.';
  const CARD_TAGLINE = 'console QA sample - made by the people who use it';
  const CARD_PHONE = '+977-1-4567890';

  const DESK = '.panel[data-attach="notice"]';
  const KIND_PICK = `${DESK} select[aria-label="What the notice goes on"]`;
  const NOTICE_ID = `${DESK} input[name="id"]`;
  const NOTICE_BOX = `${DESK} textarea[name="text"]`;
  const NOTICE_WHY_BOX = `${DESK} input[name="reason"]`;
  const PUT_UP = `${DESK} .ask-actions button`;
  const noticeAt = target => `.notices .notice[data-target="${target}"]`;
  /** The sentences the desk says are standing on one piece of content, withdrawn ones left out. */
  const standingOn = async (target, count) => {
    await owner.waitForFunction(([sel, want]) => document.querySelectorAll(sel).length === want,
      { timeout: 40000 }, [`${noticeAt(target)}:not(.gone) .notice-text`, count]);
    return owner.$$eval(`${noticeAt(target)}:not(.gone) .notice-text`, nodes => nodes.map(n => n.textContent.trim()));
  };
  const EDITOR = '.panel[data-welcome="editor"]';
  const lineBox = field => `${EDITOR} [data-line="${field}"]`;
  const SAVE = `${EDITOR} .ask-actions button`;

  const kindOf = target => target.split(':')[0];
  const idOf = target => target.split(':')[1];

  /**
   * The line under each box names the seat that wrote it inside a <b>, so it is
   * text and element glued together — `until` reads element children only, which
   * would hand back the username and never the words being waited for.
   */
  const whoSays = async (field, needle) => {
    const sel = `${lineBox(field)} .welcome-who`;
    await owner.waitForFunction(([where, want]) => {
      const node = document.querySelector(where);
      return !!node && node.textContent.replace(/\s+/g, ' ').includes(want);
    }, { timeout: 40000 }, [sel, needle]);
    return text(owner, sel);
  };

  // 9.1 — the desk writes a notice with no report behind it.
  await owner.bringToFront();
  await owner.goto(`${BASE}/notices`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector(DESK, { timeout: 40000 });
  ok('the notice desk is a door of its own, not a side effect of a decision',
    (await text(owner, `${DESK} h2`)).includes('Put a notice on content')
      && (await many(owner, `${KIND_PICK} option`)).length === 4,
    `${(await many(owner, `${KIND_PICK} option`)).join(' / ')}`);
  ok('and it says which pen a notice about this kind also needs',
    (await lineText(owner, `${DESK} p.note`)).includes('Post and comment review'),
    (await lineText(owner, `${DESK} p.note`)).replace(/\s+/g, ' ').slice(0, 110));
  ok('the sentence and the reason both have to be there before the button wakes',
    await heldBack(owner, PUT_UP), 'empty boxes, dead button');

  await clearAndType(owner, NOTICE_ID, idOf(spare.target));
  await clearAndType(owner, NOTICE_BOX, NOTICE_TEXT);
  ok('and a sentence alone is still not enough — the reason is what the log keeps',
    await heldBack(owner, PUT_UP), 'reason blank');

  await clearAndType(owner, NOTICE_WHY_BOX, NOTICE_WHY);
  const putUp = await answered(owner, PUT_UP, 'Put the notice up', 'admin/notices/attach/');
  const putBanner = await expectBanner(owner, 'standing on post');
  ok('one click puts it up, and the screen answers with what just happened',
    putUp.status === 201 && putBanner.includes(`${kindOf(spare.target)} ${idOf(spare.target)}`)
      && putUp.body.notice.about === AUTHOR, `${putUp.status} ${putBanner.slice(0, 90)}`);
  ok('the sentence is on the row, with the seat that wrote it named',
    (await until(owner, `${noticeAt(spare.target)} .notice-text`, 'console QA sample')).includes(NOTICE_TEXT)
      && (await lineText(owner, `${noticeAt(spare.target)} .notice-meta`)).includes(OWNER),
    (await lineText(owner, `${noticeAt(spare.target)} .notice-meta`)).replace(/\s+/g, ' ').slice(0, 110));
  ok('and it is standing, which is the only state the community ever sees',
    (await text(owner, `${noticeAt(spare.target)} .pill`)) === 'Standing',
    await text(owner, `${noticeAt(spare.target)} .pill`));
  await shot(owner, 'notices-1-hand-written');

  // 9.2 — the open door, with nobody signed in.
  const stranger = await freshPage();
  await stranger.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  const openRead = await statusOf(stranger, `/api/notices/${kindOf(spare.target)}/${idOf(spare.target)}/`);
  ok('a stranger with no session reads exactly what will be shown over that post',
    openRead.status === 200 && openRead.body.notices.length === 1
      && openRead.body.notices[0].text === NOTICE_TEXT,
    `${openRead.status} · ${(openRead.body.notices || []).length} notice(s)`);

  // 9.3 — taking it down is the desk too, and it is not a deletion.
  const taken = await answered(owner, `${noticeAt(spare.target)} .notice-act button`,
    'Withdraw notice', 'withdraw/');
  const withdrawnBanner = await expectBanner(owner, 'is withdrawn');
  await waitGone(owner, `${noticeAt(spare.target)} .notice-act button`);
  ok('withdrawing is a decision of its own, said in the past tense',
    taken.status === 200 && taken.body.is_live === false && !!taken.body.withdrawn_at
      && withdrawnBanner.includes(`@${AUTHOR}`)
      && (await text(owner, `${noticeAt(spare.target)} .pill`)).startsWith('Withdrawn'),
    `${taken.status} ${withdrawnBanner.slice(0, 90)}`);
  const shutDoor = await statusOf(stranger, `/api/notices/${kindOf(spare.target)}/${idOf(spare.target)}/`);
  ok('the community stops seeing it the moment it is withdrawn',
    shutDoor.status === 200 && shutDoor.body.notices.length === 0,
    `${shutDoor.body.notices.length} notice(s) still open`);
  ok('and the row is still on the desk, because a notice people read is history',
    (await many(owner, '.notices .notice')).length > 0
      && (await until(owner, '.toolbar-count', 'standing of')).includes('of'),
    await lineText(owner, '.toolbar-count'));
  await shot(owner, 'notices-2-withdrawn');

  // 9.4 — the guards: the same sentence twice, and a seat with no pen.
  await clearAndType(owner, NOTICE_ID, idOf(spare.target));
  await clearAndType(owner, NOTICE_BOX, NOTICE_TEXT);
  await clearAndType(owner, NOTICE_WHY_BOX, NOTICE_WHY);
  const backUp = await answered(owner, PUT_UP, 'Put the notice up', 'admin/notices/attach/');
  const backBanner = await expectBanner(owner, 'is standing');
  ok('a sentence nobody reads any more may go back over the same content',
    backUp.status === 201 && (await standingOn(spare.target, 1))[0] === NOTICE_TEXT,
    `${backUp.status} ${backBanner.slice(0, 70)}`);

  await clearAndType(owner, NOTICE_BOX, NOTICE_TEXT);
  await clearAndType(owner, NOTICE_WHY_BOX, NOTICE_WHY);
  const upTwice = await answered(owner, PUT_UP, 'Put the notice up', 'admin/notices/attach/');
  const upTwiceBanner = await expectBad(owner, 'already standing');
  ok('the same sentence does not go over the same content twice',
    upTwice.status === 400 && upTwiceBanner.includes('already standing')
      && (await standingOn(spare.target, 1)).length === 1,
    `${upTwice.status} ${upTwiceBanner.slice(0, 80)}`);

  await clearAndType(owner, NOTICE_BOX, NOTICE_AGAIN);
  const second = await answered(owner, PUT_UP, 'Put the notice up', 'admin/notices/attach/');
  const beside = await standingOn(spare.target, 2);
  ok('a second sentence about the same thing stands beside the first',
    second.status === 201 && beside.length === 2 && beside.includes(NOTICE_AGAIN)
      && (await statusOf(owner, `/api/admin/notices/?target=post&q=${idOf(spare.target)}`))
        .body.results.filter(row => row.target === spare.target && row.is_live).length === 2,
    `${second.status} · ${beside.length} standing on ${spare.target}`);

  // The pen for the kind, not the pen for notices, is what decides this.
  await owner.bringToFront();
  await owner.goto(`${BASE}/access`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.search input', { timeout: 40000 });
  await clearAndType(owner, '.search input', SEAT);
  await openSeat(owner, SEAT);
  for (let n = 0; n < 2; n += 1) {
    await clickText(owner, '.seat-keys button.key', 'Post and comment review');
  }
  await clickText(owner, '.key-actions button', 'Save screens');
  await expectBanner(owner, 'Saved');

  await mod.bringToFront();
  await mod.goto(`${BASE}/notices`, { waitUntil: 'domcontentloaded' });
  await mod.waitForSelector('.notices .notice, .panel.empty', { timeout: 40000 });
  const modWrite = await postOf(mod, '/api/admin/notices/attach/',
    { target: spare.target, text: 'console QA sample - written from a seat with no pen.', reason: 'spam' });
  ok('a seat that lost the content pen reads every notice and writes none about a post',
    modWrite.status === 403 && modWrite.body.permission === 'content'
      && modWrite.body.label === 'Post and comment review',
    `${modWrite.status} ${modWrite.body.permission || 'allowed'}`);
  const modListing = await postOf(mod, '/api/admin/notices/attach/',
    { target: sell.target, text: 'console QA sample - this listing is not what it claims.',
      reason: 'console QA sample - counterfeit' });
  ok('while the same sentence about a listing goes straight through, on the other pen',
    modListing.status === 201 && modListing.body.notice.target === sell.target
      && modListing.body.notice.actor === SEAT,
    `${modListing.status} ${modListing.body.notice ? modListing.body.notice.actor : 'no notice'}`);
  await shot(mod, 'notices-3-no-pen');

  await owner.bringToFront();
  await owner.goto(`${BASE}/access`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.search input', { timeout: 40000 });
  await clearAndType(owner, '.search input', SEAT);
  await openSeat(owner, SEAT);
  await clickText(owner, '.seat-keys button.key', 'Post and comment review');
  await clickText(owner, '.key-actions button', 'Save screens');
  await expectBanner(owner, 'Saved');
  const backAgain = (await statusOf(owner, `/api/admin/staff/?q=${SEAT}`)).body.results[0];
  ok('and handing the pen back is one click, because it was never a code change',
    !backAgain.denied_keys.includes('content') && backAgain.permissions.includes('content'),
    `denied ${backAgain.denied_keys.join(', ') || 'none'}`);

  // 9.5 — the wording a visitor reads before they have an account.
  await owner.bringToFront();
  await owner.goto(`${BASE}/welcome`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector(EDITOR, { timeout: 40000 });
  const unwritten = await many(owner, `${EDITOR} .welcome-who`);
  ok('the platform ships with its own wording, so the card is never an empty box',
    (await owner.$eval(`${lineBox('message')} textarea`, node => node.value)).startsWith('Welcome to Exposing')
      && unwritten.every(line => line.includes('unwritten') || line.includes('written by')),
    unwritten[0].replace(/\s+/g, ' ').slice(0, 90));
  ok('and saving nothing is not a button, because it would write an audit row for nothing',
    await heldBack(owner, SAVE), 'nothing typed yet');

  await clearAndType(owner, `${lineBox('message')} textarea`, CARD_MESSAGE);
  await clearAndType(owner, `${lineBox('tagline')} input`, CARD_TAGLINE);
  await clearAndType(owner, `${lineBox('phone')} input`, CARD_PHONE);
  ok('the counters tell the Client how much room the line has',
    (await lineText(owner, `${lineBox('message')} span`)).includes(`${CARD_MESSAGE.length}/300`)
      && !(await heldBack(owner, SAVE)),
    await lineText(owner, `${lineBox('message')} span`));

  const formBlank = await owner.$eval(`${EDITOR} [data-line="form"] input`, node => node.value);
  const cap = await owner.$eval(`${lineBox('message')} textarea`, node => node.maxLength);
  ok('a line cannot be typed past the length the card holds',
    cap === 300 && formBlank === '', `${cap} characters is the cap, and the form link is still empty`);

  const saved = await answered(owner, SAVE, 'Save the wording', 'admin/welcome/');
  const savedBanner = await expectBanner(owner, 'next first load');
  ok('saving writes the wording and says where it will be read',
    saved.status === 200 && savedBanner.includes('welcome message')
      && savedBanner.includes('tagline'), `${saved.status} ${savedBanner.slice(0, 110)}`);
  ok('the card the desk shows is the card that was saved, not the box being typed',
    (await until(owner, '.panel[data-welcome="card"] .notice-text', 'console QA sample')).includes(CARD_MESSAGE),
    (await text(owner, '.panel[data-welcome="card"] .notice-text')).slice(0, 90));
  ok('and every line now names the seat that wrote it',
    (await whoSays('message', 'written by')).includes(OWNER),
    (await text(owner, `${lineBox('message')} .welcome-who`)).replace(/\s+/g, ' ').slice(0, 90));
  await shot(owner, 'welcome-1-wording');

  const site = await statusOf(stranger, '/api/welcome/');
  ok('the website reads it with nobody signed in, and gets only the card',
    site.status === 200 && site.body.message === CARD_MESSAGE && site.body.tagline === CARD_TAGLINE
      && Object.keys(site.body).join(',') === 'message,tagline,contact',
    `${site.status} · ${Object.keys(site.body).join(',')}`);
  ok('the contact details are the ones filled in, and an empty line is left off',
    site.body.contact.some(line => line.value === CARD_PHONE)
      && !site.body.contact.some(line => line.label === 'Support form'),
    site.body.contact.map(line => `${line.label} ${line.value}`).join(' · ').slice(0, 120));
  const closedDesk = await statusOf(stranger, '/api/admin/welcome/');
  ok('the door that changes the wording is not the open one',
    closedDesk.status === 401 || closedDesk.status === 403, `${closedDesk.status}`);

  // 9.6 — undo, the fallback, and writing the same words twice.
  await clearAndType(owner, `${lineBox('tagline')} input`, 'console QA sample - a line nobody will keep');
  await clickText(owner, `${EDITOR} .ask-actions button:nth-child(2)`, 'Undo');
  ok('undoing the typing hands the boxes back to what is stored',
    (await owner.$eval(`${lineBox('tagline')} input`, node => node.value)) === CARD_TAGLINE
      && await heldBack(owner, SAVE), 'the box is back to the saved line');

  await clearAndType(owner, `${lineBox('tagline')} input`, '');
  const emptied = await answered(owner, SAVE, 'Save the wording', 'admin/welcome/');
  ok('a line emptied on purpose falls back to the platform’s own wording',
    emptied.status === 200
      && (await statusOf(stranger, '/api/welcome/')).body.tagline === 'Expose the work.'
      && (await whoSays('tagline', 'unwritten')).includes('unwritten'),
    `${emptied.status} · ${emptied.body.card.tagline}`);

  const sameAgain = await postOf(owner, '/api/admin/welcome/', {
    message: CARD_MESSAGE, tagline: '', phone: CARD_PHONE,
  });
  ok('and typing the same words a second time is refused, not logged twice',
    sameAgain.status === 400 && sameAgain.body.detail.includes('already says exactly this'),
    `${sameAgain.status} ${sameAgain.body.detail.slice(0, 70)}`);

  await mod.bringToFront();
  await mod.goto(`${BASE}/welcome`, { waitUntil: 'domcontentloaded' });
  await mod.waitForSelector('.panel.blocked, .panel', { timeout: 40000 });
  const modWording = await postOf(mod, '/api/admin/welcome/', { tagline: 'console QA sample - mine now.' });
  const welcomeShown = await mod.$eval('.side-nav', node => node.textContent.includes('First-load wording'));
  ok('the wording is the Client’s and the Admin’s: a moderator is not offered the screen at all',
    (await mod.$(EDITOR)) === null && !welcomeShown && modWording.status === 403
      && modWording.body.permission === 'welcome_text',
    `${modWording.status} ${modWording.body.permission || 'allowed'} · nav ${welcomeShown}`);
  ok('and the card the visitor reads still says what the Client wrote',
    (await statusOf(stranger, '/api/welcome/')).body.message === CARD_MESSAGE
      && (await statusOf(stranger, '/api/welcome/')).body.tagline === 'Expose the work.',
    (await statusOf(stranger, '/api/welcome/')).body.tagline);
  await shot(mod, 'welcome-2-locked');
  await stranger.close();

  // ── 10. the coin desk (contract 6.7) ────────────────────────────────────────
  // Real rupees, a stranger's bank slip and somebody's wallet balance: the three
  // things a wrong click cannot be taken back. So this section reads the queue for
  // what it does *not* carry, opens a receipt only through the link minted seconds
  // earlier, moves money in all three directions the desk offers, and then turns
  // the retention window down to nothing to watch the slip actually get deleted.
  const nobody = await freshPage();
  // A fetch has to be standing on a document to resolve a root-relative URL, and a
  // fresh context sits on about:blank until something is navigated into it.
  await nobody.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  const PAYER_ONE = 'qa_coin_one';
  const PAYER_TWO = 'qa_coin_two';
  const PAYER_THREE = 'qa_coin_three';
  const PAYER_FOUR = 'qa_coin_four';
  const COIN_BOX = id => `.coin[data-coin="${id}"]`;
  const COIN_REASON = id => `${COIN_BOX(id)} .ask textarea[name="reason"]`;
  const COIN_YES = id => `${COIN_BOX(id)} .ask-actions button`;
  const coinVerb = (id, verb) => `${COIN_BOX(id)} .verbs button[data-verb="${verb}"]`;

  /** The queue repaints after every decision, so a row is found by its payer. */
  const findCoin = async who => {
    await owner.waitForFunction(name => [...document.querySelectorAll('.coin')]
      .some(row => row.textContent.includes(`@${name}`)), { timeout: 40000 }, who);
    return owner.evaluate(name => [...document.querySelectorAll('.coin')]
      .find(row => row.textContent.includes(`@${name}`)).dataset.coin, who);
  };
  const openCoin = async who => {
    const id = await findCoin(who);
    const already = await owner.$eval(COIN_BOX(id), node => node.className.includes('open'));
    if (!already) await tap(owner, `${COIN_BOX(id)} .coin-id`);
    await owner.waitForSelector(`${COIN_BOX(id)} .coin-body`, { timeout: 40000 });
    return id;
  };

  // 10.1 — what the queue holds, and what it refuses to hold.
  await owner.goto(`${BASE}/coins`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.coin', { timeout: 40000 });
  const coinQueue = (await statusOf(owner, '/api/admin/coins/?status=pending')).body;
  const coinIds = Object.fromEntries(coinQueue.results.map(row => [row.card.username, row.id]));
  const chipCount = await owner.$eval('.filters [data-chip="pending"] b', node => Number(node.textContent.trim()));
  ok('the coin desk opens on what is waiting, and the chip carries the server’s own count',
    chipCount > 0 && chipCount === coinQueue.counts.pending, `${chipCount} vs ${coinQueue.counts.pending}`);
  const held = await lineText(owner, '.facets');
  ok('and the screen leads with how much money is held up and how long a slip is kept',
    held.includes('coins') && held.includes('held up behind the review') && held.includes('kept for'),
    held.replace(/\s+/g, ' ').slice(0, 130));
  ok('the list is told a payment proof exists and is never given the proof itself',
    coinQueue.results.every(row => 'has_proof' in row) && !/screenshot|media\/proofs/.test(JSON.stringify(coinQueue)),
    `${coinQueue.results.filter(row => row.has_proof).length} of ${coinQueue.results.length} rows hold a slip`);
  const byRef = (await statusOf(owner, '/api/admin/coins/?q=TRX-8801')).body.results;
  ok('a bank reference finds the payer, which is how a cashier with a statement works',
    byRef.length === 1 && byRef[0].card.username === PAYER_ONE,
    byRef.map(row => row.card.username).join(', ') || 'nothing found');
  const coldQueue = await statusOf(nobody, '/api/admin/coins/');
  const openPricing = await statusOf(nobody, '/api/coins/pricing/');
  ok('a stranger cannot read who has paid, but is told what a Coin costs and where to send it',
    (coldQueue.status === 401 || coldQueue.status === 403) && openPricing.status === 200
      && openPricing.body.bank.account.length > 4 && openPricing.body.min_purchase >= 1,
    `${coldQueue.status} / ${openPricing.status} · ${openPricing.body.coin_price} NPR per Coin`);
  await shot(owner, 'coins-1-queue');

  // 10.2 — the receipt, behind a link that dies.
  await clearAndType(owner, '.search input', PAYER_ONE);
  const one = await openCoin(PAYER_ONE);
  await tap(owner, `${COIN_BOX(one)} [data-proof-open]`);
  // A bare selector timeout here would only say the picture did not arrive, so the
  // wait reports what the row did say: the link it was given, or the sentence it
  // answered with, or that the button is still sitting shut.
  const opened = await owner.waitForFunction(box => {
    const img = document.querySelector(`${box} .proof-img`);
    if (img) {
      // `complete` is the browser's own word for "the bytes have arrived or failed",
      // so a picture still decoding keeps the poll running instead of reading 0px.
      return img.complete ? { href: img.getAttribute('src'), width: img.naturalWidth } : false;
    }
    const said = document.querySelector(`${box} .card-error`);
    if (said) return { error: said.textContent.trim() };
    const shut = document.querySelector(`${box} .proof-shut`);
    if (shut) return { shut: shut.textContent.replace(/\s+/g, ' ').trim() };
    return false;
  }, { timeout: 40000 }, COIN_BOX(one)).then(handle => handle.jsonValue());
  ok('the payment slip opens only through a link the queue minted seconds ago',
    Boolean(opened.href) && opened.width > 40 && /receipt\/\?t=/.test(opened.href),
    JSON.stringify(opened).slice(0, 150));
  const slip = { href: opened.href || '' };
  const replay = await statusOf(owner, slip.href);
  const tampered = await statusOf(owner, `${slip.href.slice(0, -6)}AAAAAA`);
  const swapped = await statusOf(owner, slip.href.replace(`/coins/${one}/`, `/coins/${coinIds[PAYER_TWO]}/`));
  ok('the link answers again inside its two minutes, and a broken one is refused outright',
    replay.status === 200 && tampered.status === 410, `${replay.status} / ${tampered.status}`);
  ok('and the same token will not open the next payer’s slip', swapped.status === 403, `${swapped.status}`);
  await shot(owner, 'coins-2-proof');

  await clearAndType(owner, '.search input', PAYER_THREE);
  const ask3 = await openCoin(PAYER_THREE);
  const noSlip = await see(owner, `${COIN_BOX(ask3)} .empty-note`);
  ok('a request nobody has uploaded a slip for says so instead of opening a blank picture',
    noSlip.includes('not uploaded a receipt'), noSlip.slice(0, 70));
  const noLink = await statusOf(owner, `/api/admin/coins/${ask3}/receipt-link/`);
  ok('and its receipt door answers 404 rather than handing out an empty file',
    noLink.status === 404, `${noLink.status}`);

  // 10.3 — the three verbs, and the sentence each one costs.
  await tap(owner, coinVerb(ask3, 'proof'));
  ok('asking for better proof is refused until the sentence is written',
    await heldBack(owner, COIN_YES(ask3)), 'Confirm sits disabled on an empty box');
  await clearAndType(owner, COIN_REASON(ask3), 'console QA sample - send the whole page of the slip');
  const asked = await answered(owner, COIN_YES(ask3), 'Confirm', 'admin/coins/');
  const stillOpen = (await statusOf(owner, `/api/admin/coins/${ask3}/`)).body;
  ok('once written, the question goes out and the request stays open',
    asked.status === 200 && stillOpen.request.status === 'pending' && stillOpen.asks.length === 1,
    `${asked.status} · ${stillOpen.request.status} · ${stillOpen.asks.length} ask(s)`);
  const askedBy = await see(owner, `${COIN_BOX(ask3)} .coin-by`);
  ok('the row says who asked, so a delay has a name on it',
    askedBy.includes(OWNER) && askedBy.includes('more proof'), askedBy.replace(/\s+/g, ' ').slice(0, 80));

  // The paper behind a delay is a list, not a line somebody rewrites. This payer
  // already carries a question from before the run, so counting the server's own
  // list now, before the decision, is what makes "it kept the old one" a fact.
  const paperBefore = (await statusOf(owner, `/api/admin/coins/${coinIds[PAYER_TWO]}/`)).body.asks;

  await clearAndType(owner, '.search input', PAYER_TWO);
  const two = Number(await openCoin(PAYER_TWO));
  await tap(owner, coinVerb(two, 'reject'));
  await clearAndType(owner, COIN_REASON(two), 'console QA sample - the reference does not match this amount');
  const refusedOut = await answered(owner, COIN_YES(two), 'Confirm', 'admin/coins/');
  ok('a rejection needs the sentence the payer is sent, and moves no coins at all',
    refusedOut.status === 200 && refusedOut.body.request.status === 'rejected'
      && refusedOut.body.coins_credited === 0, `${refusedOut.status} · ${refusedOut.body.detail.slice(0, 70)}`);

  const paper = await statusOf(owner, `/api/admin/coins/${two}/`);
  ok('and the paper behind the delay keeps growing: the earlier question is still on the row',
    paperBefore.length === 1 && paperBefore[0].action === 'proof'
      && paper.body.asks.length === paperBefore.length + 1
      && paper.body.asks[0].action === 'proof' && paper.body.asks[0].by === OWNER
      && paper.body.asks[1].action === 'reject' && Boolean(paper.body.asks[1].reason),
    `${paperBefore.length} → ${paper.body.asks.length} asks · ${paper.body.asks.map(ask => ask.action).join(', ')}`);

  // Deciding a request is also a move between piles: the desk must not keep
  // counting it as somebody's wait, on the server or on the chip beside the filter.
  const pendingNow = (await statusOf(owner, '/api/admin/coins/?status=pending')).body;
  const rejectedNow = (await statusOf(owner, `/api/admin/coins/?status=rejected&q=${PAYER_TWO}`)).body;
  const chipNow = await owner.$eval('.filters [data-chip="pending"] b', node => Number(node.textContent.trim()));
  ok('a rejected request stops being somebody’s wait, on the server and on the chip, with no reload',
    !pendingNow.results.some(row => row.id === two)
      && rejectedNow.results.some(row => row.id === two)
      && pendingNow.counts.pending === coinQueue.counts.pending - 1
      && chipNow === pendingNow.counts.pending,
    `${coinQueue.counts.pending} → ${pendingNow.counts.pending} waiting, chip says ${chipNow}`);

  await clearAndType(owner, '.search input', PAYER_ONE);
  await openCoin(PAYER_ONE);
  const credited = await answered(owner, coinVerb(one, 'approve'), 'Credit', 'admin/coins/');
  const said = await expectBanner(owner, 'Credited');
  ok('crediting a purchase moves the coins through the wallet and names the ledger row it wrote',
    credited.status === 200 && credited.body.coins_credited === 500 && /ledger row is #/.test(credited.body.detail),
    said.replace(/\s+/g, ' ').slice(0, 90));
  const creditedTwice = await postOf(owner, `/api/admin/coins/${one}/approve/`, {});
  ok('the same receipt cannot be credited twice, and the door says it was already decided',
    creditedTwice.status === 409 && /already approved/.test(creditedTwice.body.detail),
    `${creditedTwice.status} ${creditedTwice.body.detail.slice(0, 50)}`);
  const settled = (await statusOf(owner, `/api/admin/coins/${one}/`)).body.request;
  ok('the row now names the seat that decided it, with the coins beside the words',
    settled.status === 'approved' && settled.review.by === OWNER && settled.review.coins_credited === 500,
    `${settled.review.label} by ${settled.review.by}`);
  await shot(owner, 'coins-3-decided');

  // 10.4 — the ledger, which only ever grows.
  await owner.goto(`${BASE}/ledger`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('tbody.entry', { timeout: 40000 });
  const ledger = (await statusOf(owner, '/api/admin/coins/ledger/')).body;
  ok('the ledger is the wallet’s own table and the screen calls it what it is',
    ledger.totals.entries > 0 && (await lineText(owner, '.facets')).includes('none of them editable'),
    `${ledger.totals.entries} rows · ${ledger.totals.credited} in · ${ledger.totals.debited} out`);
  await clearAndType(owner, '.search input', PAYER_ONE);
  // A search box settles a beat after the last keystroke, so waiting only for
  // "some rows" would count the whole ledger before the filter had landed — and
  // every row-count claim below is measured against this one wallet's history.
  await owner.waitForFunction(name => {
    const rows = [...document.querySelectorAll('tbody.entry')];
    return rows.length > 0 && rows.every(row => row.textContent.includes(`@${name}`));
  }, { timeout: 40000 }, PAYER_ONE);
  const top = await owner.$eval('tbody.entry', node => ({
    note: node.querySelector('.entry-note').textContent.trim(),
    move: node.querySelector('.state').textContent.trim(),
    balance: node.querySelector('td.num').textContent.trim(),
  }));
  ok('the approval the desk just made is a ledger row, with the wallet’s number beside it',
    /approved/.test(top.note) && top.move.startsWith('+') && top.balance === '500.00',
    `${top.move} · ${top.balance} · ${top.note.slice(0, 46)}`);
  const rowsBefore = await owner.$$eval('tbody.entry', nodes => nodes.length);

  await tap(owner, '[data-adjust-open]');
  await owner.waitForSelector('[data-adjust]', { timeout: 40000 });
  await clearAndType(owner, '[data-adjust] input[name="username"]', PAYER_ONE);
  await clearAndType(owner, '[data-adjust] input[name="amount"]', '40');
  ok('a hand-written row is refused until the reason is written',
    await heldBack(owner, '[data-adjust-save]'), 'Confirm sits disabled on an empty reason');
  await clearAndType(owner, '[data-adjust] textarea[name="reason"]',
    'console QA sample - the bank confirmed a second payment');
  const moved = await answered(owner, '[data-adjust-save]', 'Write the row', 'admin/coins/ledger/adjust/');
  ok('with a reason it writes a new row and says plainly that nothing old was touched',
    moved.status === 200 && moved.body.entry.note.includes(OWNER) && moved.body.balance === '540.00',
    moved.body.detail.slice(0, 90));
  const rowBanner = await expectBanner(owner, 'Credited 40');
  ok('the new row is on the screen before the reload lands, and the note carries the seat',
    rowBanner.includes('Credited 40'), rowBanner.replace(/\s+/g, ' ').slice(0, 80));

  await tap(owner, '[data-adjust-open]');
  await owner.waitForSelector('[data-adjust]', { timeout: 40000 });
  await clearAndType(owner, '[data-adjust] input[name="username"]', PAYER_ONE);
  await tap(owner, '[data-move-pick="debit"]');
  await clearAndType(owner, '[data-adjust] input[name="amount"]', '99999');
  await clearAndType(owner, '[data-adjust] textarea[name="reason"]',
    'console QA sample - taking more than the wallet holds');
  const over = await answered(owner, '[data-adjust-save]', 'Write the row', 'admin/coins/ledger/adjust/');
  const overSaid = await see(owner, '[data-adjust] .card-error');
  ok('a debit bigger than the wallet is refused by the ledger itself, and the screen repeats its words',
    over.status === 400 && /Insufficient balance/.test(over.body.detail) && overSaid.includes('Insufficient balance'),
    `${over.status} · ${overSaid.slice(0, 60)}`);
  // The refused debit wrote no row, so the only difference between these two
  // counts is the one honest row the desk wrote by hand.
  await owner.waitForFunction(([count, name]) => {
    const rows = [...document.querySelectorAll('tbody.entry')];
    return rows.length === count && rows.every(row => row.textContent.includes(`@${name}`));
  }, { timeout: 40000 }, [rowsBefore + 1, PAYER_ONE]).catch(() => undefined);
  const entries = await owner.$$eval('tbody.entry', nodes => nodes.length);
  ok('and the hand-written row sits on top of the wallet’s own history, none of it editable',
    entries === rowsBefore + 1, `${rowsBefore} rows → ${entries} for ${PAYER_ONE}`);
  await shot(owner, 'ledger-1-history');

  // 10.5 — the pricing desk: the numbers, the QR and the clock on a stranger's slip.
  await owner.goto(`${BASE}/pricing`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('[data-knob="coin_price"]', { timeout: 40000 });
  const knobs = await owner.$$eval('[data-knob]', nodes => nodes.map(node => node.dataset.knob));
  ok('every number the contract names is a box on this desk, not a line of code',
    ['coin_price', 'coin_min_purchase', 'coin_bank_name', 'coin_bank_account', 'coin_bank_holder',
      'coin_proof_days', 'alert_coin_queue_hours'].every(key => knobs.includes(key)),
    knobs.join(', '));
  await clearAndType(owner, '[data-knob="coin_price"] input', '12.50');
  await clearAndType(owner, '[data-knob="coin_min_purchase"] input', '250');
  const priced = await answered(owner, '[data-desk-save]', 'Save the desk', 'admin/coins/desk/');
  const quoted = (await statusOf(nobody, '/api/coins/pricing/')).body;
  ok('a price and a floor written here are what the open door quotes next, with no deploy',
    priced.status === 200 && Number(quoted.coin_price) === 12.5 && quoted.min_purchase === 250,
    `${priced.status} · ${quoted.coin_price} / ${quoted.min_purchase} · ${priced.body.detail.slice(0, 50)}`);
  ok('and the card a payer is told repaints to the new number',
    (await text(owner, '.quote-price b')) === '12.50', await text(owner, '.quote-price b'));
  await clearAndType(owner, '[data-knob="coin_price"] input', '0');
  const free = await answered(owner, '[data-desk-save]', 'Save the desk', 'admin/coins/desk/');
  ok('a Coin cannot be priced at zero, and the desk answers in the server’s own words',
    free.status === 400 && /above zero/.test(free.body.detail), `${free.status} ${free.body.detail.slice(0, 60)}`);
  await clearAndType(owner, '[data-knob="coin_price"] input', '10');
  await answered(owner, '[data-desk-save]', 'Save the desk', 'admin/coins/desk/');

  const qrBox = await owner.$('[data-qr-file]');
  await qrBox.uploadFile(path.join(OUT, 'coin-qr.png'));
  await nap(500);
  const uploaded = await answered(owner, '[data-desk-save]', 'Save the desk', 'admin/coins/qr/');
  const qrShown = await owner.$eval('.qr-img', node => node.naturalWidth).catch(() => 0);
  ok('the payment QR is stored in its own folder, painted back on the desk and quoted to a payer',
    uploaded.status === 200 && /coin-qr\//.test(uploaded.body.pricing.bank.qr)
      && (await statusOf(nobody, '/api/coins/pricing/')).body.bank.qr === uploaded.body.pricing.bank.qr,
    `${uploaded.status} · ${uploaded.body.pricing.bank.qr.split('/').pop()} · ${qrShown}px on screen`);
  // The swap also lands in the audit log; section 11 reads that log back once the
  // audit screen exists, so the claim is proved there rather than half-proved here.

  await clearAndType(owner, '[data-knob="coin_proof_days"] input', '0');
  const shortened = await answered(owner, '[data-desk-save]', 'Save the desk', 'admin/coins/desk/');
  ok('how long a stranger’s payment screenshot is kept is a number the Admin turns',
    shortened.status === 200, `${shortened.status} · ${shortened.body.pricing.proof_days} days`);
  await owner.goto(`${BASE}/coins`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.coin', { timeout: 40000 });
  // The banner counts the sweep this page load's own queue call just did, so the
  // line has to be read before anything else asks the queue — a second fetch would
  // find nothing left to delete and the count would be the run's, not the screen's.
  const sweptLine = await owner.$('[data-swept]');
  const sweptText = sweptLine ? (await text(owner, '[data-swept]')) : 'nothing reported';
  const four = (await statusOf(owner, `/api/admin/coins/?status=all&q=${PAYER_FOUR}`)).body.results[0].id;
  const afterSweep = (await statusOf(owner, `/api/admin/coins/${four}/`)).body.request;
  ok('once the window closes, the queue says how many slips it deleted',
    Boolean(sweptLine) && /[1-9]/.test(sweptText), sweptText.slice(0, 70));
  ok('a settled purchase keeps its row and its decision but loses the picture',
    afterSweep.has_proof === false && afterSweep.status === 'approved',
    `proof ${afterSweep.has_proof} · ${afterSweep.status}`);
  await owner.goto(`${BASE}/pricing`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('[data-knob="coin_proof_days"]', { timeout: 40000 });
  await clearAndType(owner, '[data-knob="coin_proof_days"] input', '30');
  await answered(owner, '[data-desk-save]', 'Save the desk', 'admin/coins/desk/');
  await shot(owner, 'pricing-1-desk');

  // 10.6 — the money doors are their own screens, not a side effect of being staff.
  // Section 3 handed this seat the coin queue as an explicit grant, so the honest
  // thing to prove is not that a Moderator can never see money but that the grant
  // was the only reason it could — and a Client taking it back takes the screen back.
  await owner.bringToFront();
  await owner.goto(`${BASE}/access`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.search input', { timeout: 40000 });
  await clearAndType(owner, '.search input', SEAT);
  await openSeat(owner, SEAT);
  await owner.waitForSelector('.key-groups', { timeout: 40000 });
  await clickText(owner, '.seat-keys button.key', 'Coin request queue');
  await clickText(owner, '.key-actions button', 'Save screens');
  await expectBanner(owner, 'Saved');
  const revoked = (await statusOf(owner, `/api/admin/staff/?q=${SEAT}`)).body.results[0];
  ok('one click takes a granted money screen out of a seat, and the denial is written on the row',
    revoked.denied_keys.includes('coins_view') && !revoked.permissions.includes('coins_view'),
    `denied ${revoked.denied_keys.join(', ') || 'nothing'}`);

  const modQueue = await statusOf(mod, '/api/admin/coins/');
  ok('a Moderator is not handed the coin queue, and the door names the screen to ask for',
    modQueue.status === 403 && modQueue.body.permission === 'coins_view',
    `${modQueue.status} ${modQueue.body.permission || 'allowed'}`);
  const modDesk = await postOf(mod, `/api/admin/coins/${two}/reject/`, { reason: 'no pen on money' });
  ok('and cannot reject a payment either, which is a different key again',
    modDesk.status === 403 && modDesk.body.permission === 'coins_review',
    `${modDesk.status} ${modDesk.body.permission || 'allowed'}`);
  await mod.bringToFront();
  await mod.goto(`${BASE}/coins`, { waitUntil: 'domcontentloaded' });
  await mod.waitForSelector('.panel.blocked', { timeout: 40000 });
  const moneyNav = await text(mod, '.side-nav');
  ok('the console does not offer a Moderator the money screens at all',
    !moneyNav.includes('Coin requests') && !moneyNav.includes('Coin ledger') && !moneyNav.includes('Coin pricing'),
    moneyNav.replace(/\s+/g, ' ').slice(0, 90));
  await shot(mod, 'coins-4-locked');
  await nobody.close();

  // ── 11. paid reach: the campaigns, the shelf they were bought from, the dials ──
  // 6.8 is judged on money, so every refund here is read out of the wallet's own
  // ledger and out of the open door the member site actually reads — not from the
  // sentence the decision endpoint returned about itself. A desk that prints
  // "180 coins went back" while writing no row is exactly the failure this
  // section exists to catch, and a shelf that saves without the feed being told
  // about it is the other one.
  const REACH = {
    refuse: 'qa_promo_one', live: 'qa_promo_two', paused: 'qa_promo_three',
    record: 'qa_promo_four', clean: 'qa_promo_five', stale: 'qa_promo_stale',
    draft: 'qa_promo_draft',
  };
  const PROMO_BOX = id => `.promo[data-promo="${id}"]`;
  const promoVerb = (id, verb) => `${PROMO_BOX(id)} .verbs button[data-verb="${verb}"]`;
  const PROMO_REASON = id => `${PROMO_BOX(id)} .ask textarea[name="reason"]`;
  const PROMO_YES = id => `${PROMO_BOX(id)} .ask-actions button.btn.primary`;

  /** The queue repaints after every decision, so a campaign is found by its payer.
   *  Its payer, specifically: an open row prints the people who reported the thing
   *  underneath it, and a match on the row's whole text answers to a reporter — the
   *  stale rows of the pile just left are still on the page for a moment, and one of
   *  them was the payer of the campaign two claims ago. */
  const findPromo = async who => {
    await owner.waitForFunction(name => [...document.querySelectorAll('.promo .promo-name b')]
      .some(tag => tag.textContent === `@${name}`), { timeout: 40000 }, who);
    return owner.evaluate(name => Number([...document.querySelectorAll('.promo')]
      .find(row => row.querySelector('.promo-name b').textContent === `@${name}`).dataset.promo), who);
  };
  const openPromo = async who => {
    const id = await findPromo(who);
    const already = await owner.$eval(PROMO_BOX(id), node => node.className.includes('open'));
    if (!already) await tap(owner, `${PROMO_BOX(id)} .promo-id`);
    await owner.waitForSelector(`${PROMO_BOX(id)} .promo-body`, { timeout: 40000 });
    return id;
  };
  /** Rows for one payer only, so a count read after a search is not the old list. */
  const seeOnly = async who => {
    await clearAndType(owner, '.search input', who);
    await owner.waitForFunction(name => {
      const list = [...document.querySelectorAll('.promo')];
      return list.length > 0 && list.every(row => row.querySelector('.promo-name b').textContent === `@${name}`);
    }, { timeout: 40000 }, who);
  };
  /** A filter chip fires its own request; wait for that answer, not the next paint. */
  const reachPile = async which => {
    // Clicking the chip that is already on refires nothing, so waiting for an
    // answer to it would sit out the full timeout for no reason.
    if (await owner.$eval('.filters .fchip.on', node => node.dataset.chip) !== which) {
      const answer = owner.waitForResponse(res => /\/api\/admin\/promotions\//.test(res.url()), { timeout: 40000 });
      await owner.evaluate(want => {
        const hit = [...document.querySelectorAll('.filters .fchip')].find(node => node.dataset.chip === want);
        if (!hit) throw new Error(`no chip for ${want}`);
        hit.click();
      }, which);
      await answer;
    }
    await clearAndType(owner, '.search input', '');
  };
  const walletRows = async who => (await statusOf(owner, `/api/admin/coins/ledger/?q=${who}`)).body.results || [];
  const unseated = await freshPage();
  await unseated.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });

  const pid = {};
  for (const [name, who] of Object.entries(REACH)) {
    const found = await statusOf(owner, `/api/admin/promotions/?state=all&q=${who}`);
    const hit = (found.body.results || []).find(row => row.owner === who);
    pid[name] = hit ? hit.id : null;
  }
  ok('every verb 6.8 promises has a campaign of its own to do it to',
    Object.values(pid).every(Boolean),
    Object.entries(pid).map(([key, id]) => `${key}=#${id || 'missing'}`).join(' '));

  // 11.1 — the queue, and what a seat is asked to look at before it signs anything.
  await owner.goto(`${BASE}/promotions`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.promo', { timeout: 40000 });
  const reachNav = await text(owner, '.side-nav');
  ok('paid reach is its own drawer section, with the three screens it was promised',
    reachNav.includes('Reach') && reachNav.includes('Paid campaigns')
      && reachNav.includes('Campaign packages') && reachNav.includes('Reach controls'),
    reachNav.replace(/\s+/g, ' ').slice(0, 120));
  const waitingDesk = (await statusOf(owner, '/api/admin/promotions/')).body;
  ok('the desk opens on money the site already took and nobody has looked at — not on a status column',
    waitingDesk.state === 'waiting' && waitingDesk.results.length > 0
      && waitingDesk.results.every(row => row.status === 'active' && row.sign_off === 'waiting'),
    `${waitingDesk.results.length} on screen · ${waitingDesk.counts.waiting} waiting · `
    + `${waitingDesk.counts.live} already signed off of ${waitingDesk.counts.every} bought`);
  const waitingChip = await owner.$eval('.filters [data-chip="waiting"] b', node => Number(node.textContent));
  ok('the chip carries the server’s own count of the pile, so a seat can see it clear to zero',
    waitingChip === waitingDesk.counts.waiting && waitingChip > 0, `${waitingChip} vs ${waitingDesk.counts.waiting}`);
  const reservedLine = await lineText(owner, '[data-held]');
  ok('the screen says up front how much is being held and which dials decide who is shown it',
    reservedLine.includes('reserved by campaigns that are running or paused')
      && reservedLine.includes('promotions per person per day') && reservedLine.includes('relevance floor'),
    reservedLine.replace(/\s+/g, ' ').slice(0, 150));

  await seeOnly(REACH.refuse);
  const dirtyRow = await openPromo(REACH.refuse);
  ok('a campaign row names the coins and the package before anybody opens it',
    (await text(owner, `${PROMO_BOX(dirtyRow)} [data-coins]`)) === '300.00'
      && (await text(owner, `${PROMO_BOX(dirtyRow)} [data-package]`)).includes('7 d'),
    `${await text(owner, `${PROMO_BOX(dirtyRow)} [data-coins]`)} coins · `
    + `${await text(owner, `${PROMO_BOX(dirtyRow)} [data-package]`)}`);
  ok('a decision about paid reach is made with the thing itself on the screen',
    (await text(owner, `${PROMO_BOX(dirtyRow)} .cwrap .ctext`)).includes('a studio tour in Kathmandu'),
    (await text(owner, `${PROMO_BOX(dirtyRow)} .cwrap .ctext`)).slice(0, 90));
  const aimed = await many(owner, `${PROMO_BOX(dirtyRow)} [data-targeting] li`);
  ok('and with the audience the payer asked for, written out rather than guessed from an id',
    aimed.some(fact => fact.includes('18–35')) && aimed.some(fact => fact.includes('Nepal'))
      && aimed.some(fact => fact.includes('Kathmandu')) && aimed.some(fact => fact.includes('Photography')),
    aimed.join(' | ').slice(0, 160));
  const pileLine = await lineText(owner, `${PROMO_BOX(dirtyRow)} [data-pile] .line`);
  ok('the reports already sitting under it are read before the signature, not filed after it',
    pileLine.includes('2 open report(s) from 2 people') && pileLine.includes('misleading'),
    pileLine.replace(/\s+/g, ' ').slice(0, 150));
  const reportLines = await many(owner, `${PROMO_BOX(dirtyRow)} li[data-report]`);
  ok('and each one arrives as a quotable row — who said it, what they said, when',
    reportLines.length === 3 && reportLines.some(line => line.includes('the same footage another account posted first'))
      && reportLines.some(line => line.includes('dismissed')),
    `${reportLines.length} rows: ${reportLines.map(line => line.slice(0, 40)).join(' / ')}`);
  await shot(owner, 'reach-1-campaign-open');

  // 11.2 — approve moves nothing, because the site took the coins when it was bought.
  const cleanBefore = await walletRows(REACH.clean);
  await reachPile('waiting');
  const cleanRow = await openPromo(REACH.clean);
  const signed = await answered(owner, promoVerb(cleanRow, 'approve'), 'Approve', 'admin/promotions/');
  ok('signing a campaign off hands back nothing and charges nothing again',
    signed.status === 200 && Number(signed.body.refunded) === 0
      && /Nothing was charged again/.test(signed.body.detail),
    `${signed.status} · ${signed.body.detail}`.slice(0, 140));
  ok('and the wallet’s own history gains no row for it, which is the only proof that matters',
    (await walletRows(REACH.clean)).length === cleanBefore.length,
    `${cleanBefore.length} → ${(await walletRows(REACH.clean)).length} ledger rows for @${REACH.clean}`);
  await waitGone(owner, PROMO_BOX(cleanRow));
  await reachPile('live');
  const nowLive = await statusOf(owner, `/api/admin/promotions/${cleanRow}/`);
  ok('the campaign it just signed off is counted in the pile that is running, with the seat named on it',
    nowLive.body.campaign.sign_off === 'approve'
      && nowLive.body.campaign.review.by === OWNER
      && (await findPromo(REACH.clean)) === cleanRow,
    `signed off by @${nowLive.body.campaign.review.by}`);

  // 11.3 — refuse: the money has to be worth writing a sentence for.
  await reachPile('waiting');
  const refuseRow = await openPromo(REACH.refuse);
  await tap(owner, promoVerb(refuseRow, 'reject'));
  await owner.waitForSelector(PROMO_REASON(refuseRow), { timeout: 40000 });
  const owedBack = await lineText(owner, `${PROMO_BOX(refuseRow)} .ask .note.row`);
  const purseBefore = await walletRows(REACH.refuse);
  const blunt = await owner.$eval(PROMO_YES(refuseRow), node => node.disabled);
  ok('the refund button will not fire until the seat has written the sentence the payer is sent',
    blunt === true, `disabled with an empty reason box: ${blunt}`);
  await clearAndType(owner, PROMO_REASON(refuseRow), 'console QA sample - the footage is not theirs to promote');
  const armedNow = await owner.$eval(PROMO_YES(refuseRow), node => node.disabled);
  ok('and the promise of what comes back is printed before the click, not after it',
    armedNow === false && owedBack.includes('180'), owedBack.replace(/\s+/g, ' ').slice(0, 120));
  const refusedReach = await answered(owner, PROMO_YES(refuseRow), 'Confirm', 'admin/promotions/');
  ok('a campaign the platform itself turned down is paid back in full for the run it never got',
    refusedReach.status === 200 && Number(refusedReach.body.refunded) === 180
      && refusedReach.body.campaign.status === 'ended',
    `${refusedReach.status} · ${refusedReach.body.refunded} back · ${refusedReach.body.campaign.status_label}`);
  const refundRows = await walletRows(REACH.refuse);
  ok('the refund is a real ledger row through the wallet, and the note says which campaign it answers',
    refundRows.length === purseBefore.length + 1
      && refundRows[0].kind === 'credit' && Number(refundRows[0].amount) === 180
      && refundRows[0].note.includes(`campaign ${refuseRow}`) && refundRows[0].note.includes(OWNER),
    refundRows.length ? `${refundRows[0].kind} ${refundRows[0].amount} · ${refundRows[0].note}` : 'no row written');
  await shot(owner, 'reach-2-refund-paper');

  // 11.4 — pause holds the reservation; a stop has to say what happens to the money.
  await reachPile('live');
  const runRow = await openPromo(REACH.live);
  const halted = await answered(owner, promoVerb(runRow, 'pause'), 'Pause', 'admin/promotions/');
  ok('pausing takes paid reach out of the feed without touching the coins behind it',
    halted.status === 200 && Number(halted.body.refunded) === 0
      && halted.body.campaign.status === 'paused' && /reservation stands/.test(halted.body.detail),
    `${halted.status} · ${halted.body.detail}`.slice(0, 130));
  await reachPile('paused');
  const stoppedRow = await openPromo(REACH.live);
  await tap(owner, promoVerb(stoppedRow, 'stop'));
  await owner.waitForSelector(`${PROMO_BOX(stoppedRow)} [data-refund]`, { timeout: 40000 });
  const undecided = await owner.$eval(PROMO_YES(stoppedRow), node => node.disabled);
  await clearAndType(owner, PROMO_REASON(stoppedRow), 'console QA sample - the bank reversed this payment');
  const stillBlind = await owner.$eval(PROMO_YES(stoppedRow), node => node.disabled);
  ok('a stop refuses to be clicked until the seat has said out loud whether the coins go back',
    undecided === true && stillBlind === true,
    `disabled before the reason: ${undecided} · disabled after it, with no choice: ${stillBlind}`);
  await tap(owner, `${PROMO_BOX(stoppedRow)} [data-refund] button[data-refund-pick="credit"]`);
  const paidBack = await answered(owner, PROMO_YES(stoppedRow), 'Confirm', 'admin/promotions/');
  ok('and choosing refund hands the 12 unrun days of an 800-coin run back to the payer',
    paidBack.status === 200 && Number(paidBack.body.refunded) === 600
      && paidBack.body.reviews[paidBack.body.reviews.length - 1].choice === 'refunded',
    `${paidBack.status} · ${paidBack.body.refunded} back · ${JSON.stringify(
      paidBack.body.reviews[paidBack.body.reviews.length - 1].choice)}`);

  // 11.5 — withhold is the other honest answer, and it is a different amount.
  await reachPile('paused');
  const heldRow = await openPromo(REACH.paused);
  const backOn = await answered(owner, promoVerb(heldRow, 'resume'), 'Resume', 'admin/promotions/');
  ok('a paused campaign goes back into the feed on the end date it already had, not a fresh one',
    backOn.status === 200 && backOn.body.campaign.status === 'active'
      && backOn.body.campaign.left_hours > 0 && /end date it already had/.test(backOn.body.detail),
    `${backOn.status} · ${Math.round((backOn.body.campaign.left_hours || 0) / 24)} days still to run`);
  await reachPile('live');
  const keptRow = await openPromo(REACH.paused);
  const keptBefore = await walletRows(REACH.paused);
  await tap(owner, promoVerb(keptRow, 'stop'));
  await owner.waitForSelector(`${PROMO_BOX(keptRow)} [data-refund]`, { timeout: 40000 });
  await clearAndType(owner, PROMO_REASON(keptRow), 'console QA sample - the account kept breaking this term');
  await tap(owner, `${PROMO_BOX(keptRow)} [data-refund] button[data-refund-pick="withhold"]`);
  const withheld = await answered(owner, PROMO_YES(keptRow), 'Confirm', 'admin/promotions/');
  ok('withholding the same money is allowed too, and writes no credit row to pretend otherwise',
    withheld.status === 200 && Number(withheld.body.refunded) === 0
      && withheld.body.reviews[withheld.body.reviews.length - 1].choice === 'withheld'
      && (await walletRows(REACH.paused)).length === keptBefore.length,
    `${withheld.status} · ${withheld.body.refunded} back · `
    + `${keptBefore.length} → ${(await walletRows(REACH.paused)).length} ledger rows`);

  // 11.6 — the three answers that must not be allowed, and the record that must not move.
  await reachPile('waiting');
  const lateRow = await openPromo(REACH.stale);
  const lateVerbs = await owner.$$eval(`${PROMO_BOX(lateRow)} [data-verb]`, nodes => nodes.map(n => n.dataset.verb));
  const lateNote = await lineText(owner, `${PROMO_BOX(lateRow)} [data-over]`);
  ok('a run that finished before anybody looked is not offered an Approve, and says why on the row',
    !lateVerbs.includes('approve') && lateVerbs.length > 0 && /no longer exists/.test(lateNote),
    `${lateVerbs.join(', ') || 'no verbs'} — ${lateNote.replace(/\s+/g, ' ').slice(0, 90)}`);
  const tooLate = await postOf(owner, `/api/admin/promotions/${lateRow}/approve/`, {});
  ok('and the door refuses the same approval even to something typing around the screen',
    tooLate.status === 409 && /run is over/.test(tooLate.body.detail),
    `${tooLate.status} · ${tooLate.body.detail}`);

  await reachPile('all');
  await seeOnly(REACH.draft);
  const draftRow = await openPromo(REACH.draft);
  const unpaid = await postOf(owner, `/api/admin/promotions/${draftRow}/approve/`, {});
  const draftNote = await lineText(owner, `${PROMO_BOX(draftRow)} [data-unpaid]`);
  ok('an unpaid draft has no coins behind it, so there is nothing here to approve',
    unpaid.status === 400 && /not been paid for/.test(unpaid.body.detail) && !draftNote.includes('undefined'),
    `${unpaid.status} · ${draftNote.replace(/\s+/g, ' ').slice(0, 90)}`);

  await reachPile('ended');
  const recordRow = await openPromo(REACH.record);
  const recordNote = await lineText(owner, `${PROMO_BOX(recordRow)} [data-record]`);
  const movedAgain = {};
  for (const verb of ['approve', 'pause', 'reject', 'stop']) {
    movedAgain[verb] = (await postOf(owner, `/api/admin/promotions/${recordRow}/${verb}/`,
      { reason: 'console QA sample - try to change a record', refund: 'credit' })).status;
  }
  ok('an ended campaign is a record, not a task: none of the five verbs changes it again',
    Object.values(movedAgain).every(code => code === 409),
    Object.entries(movedAgain).map(([verb, code]) => `${verb} ${code}`).join(' '));
  ok('and the screen shows the decision that closed it, in the words the seat wrote when it took it',
    recordNote.includes('Stopped') && /kept breaking the same policy term/.test(recordNote)
      && !recordNote.includes('undefined'),
    recordNote.replace(/\s+/g, ' ').slice(0, 150));
  const promoPaper = await many(owner, `${PROMO_BOX(recordRow)} li[data-paper]`);
  ok('the whole trail is on the row, oldest first, with the money answer spelled out',
    promoPaper.length >= 1 && promoPaper[0].includes('Stopped') && promoPaper[0].includes('withheld')
      && promoPaper[0].includes(`@${OWNER}`),
    promoPaper.map(line => line.slice(0, 60)).join(' / '));
  await shot(owner, 'reach-3-paper-trail');

  // 11.7 — the shelf: what a package is, and what the site is told when it changes.
  await owner.goto(`${BASE}/packages`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('[data-pkg-row]', { timeout: 40000 });
  const shelfDesk = (await statusOf(owner, '/api/admin/promotions/packages/')).body;
  await postOf(owner, '/api/admin/promotions/packages/', { packages: shelfDesk.shipped });
  await owner.goto(`${BASE}/packages`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('[data-pkg-row="pk_prime"]', { timeout: 40000 });
  const quoted0 = (await statusOf(unseated, '/api/promotions/config/')).body;
  const rowsOnShelf = await owner.$$eval('[data-pkg-row]', nodes => nodes.length);
  ok('a package is three numbers a seat can read on one screen: price, days, people',
    rowsOnShelf === 3 && quoted0.packages.length === 3
      && quoted0.packages.every(pack => pack.coins > 0 && pack.days > 0 && /Up to [\d,]+ people/.test(pack.reach)),
    quoted0.packages.map(pack => `${pack.name} ${pack.coins}/${pack.days}d`).join(' · '));
  const boughtOn = await many(owner, '.pk-bought');
  ok('the shelf shows how many campaigns already paid for each id, so a price is not changed blind',
    boughtOn.some(line => /campaign/.test(line)) && !boughtOn.some(line => line.includes('undefined')),
    boughtOn.join(' | ').slice(0, 120));

  await clearAndType(owner, '[data-pkg-row="pk_prime"] [data-pkg-field="coins"]', '950');
  await clearAndType(owner, '[data-pkg-row="pk_prime"] [data-pkg-field="days"]', '21');
  await clearAndType(owner, '[data-pkg-row="pk_prime"] [data-pkg-field="reach"]', '55000');
  const resold = await answered(owner, '[data-pkg-save]', 'Save the shelf', 'admin/promotions/packages/');
  const quotedNow = (await statusOf(unseated, '/api/promotions/config/')).body;
  ok('the shelf a payer chooses from is rewritten here, with no deploy and no code',
    resold.status === 200 && quotedNow.packages_edited === true
      && quotedNow.packages.some(pack => pack.id === 'pk_prime' && pack.coins === 950 && pack.days === 21),
    `${resold.status} · Prime is now ${JSON.stringify(
      (quotedNow.packages.find(pack => pack.id === 'pk_prime') || {}).coins)}`);
  ok('and the member site is told the new number on the same open door it already reads',
    quotedNow.packages.some(pack => pack.id === 'pk_prime'
      && /55,000/.test(pack.reach) && pack.reach_max === 55000),
    (quotedNow.packages.find(pack => pack.id === 'pk_prime') || {}).reach || 'nothing quoted');
  const paidStay = await statusOf(owner, `/api/admin/promotions/${cleanRow}/`);
  ok('a campaign already bought keeps the coins it reserved, so a shelf rewrite never re-bills anybody',
    paidStay.body.campaign.coins === '600.00'
      && (await walletRows(REACH.clean)).length === cleanBefore.length,
    `#${cleanRow} still shows ${paidStay.body.campaign.coins} coins and no new ledger row`);

  await clearAndType(owner, '[data-pkg-row="pk_growth"] [data-pkg-field="coins"]', '0');
  const cheap = await postOf(owner, '/api/admin/promotions/packages/', {
    packages: [{ id: 'pk_growth', name: 'Growth', coins: 0, days: 7, reach_max: 12000 }],
  });
  const freeShelf = await answered(owner, '[data-pkg-save]', 'Save the shelf', 'admin/promotions/packages/');
  ok('a package priced at zero is refused, and the desk repeats the server’s own sentence',
    cheap.status === 400 && /above zero/.test(cheap.body.detail)
      && freeShelf.status === 400 && (await text(owner, '.pk-problems')).includes('above zero'),
    `${cheap.status} · ${(await many(owner, '.pk-problems li')).join(' / ')}`.slice(0, 150));
  await postOf(owner, '/api/admin/promotions/packages/', { packages: shelfDesk.shipped });
  await unseated.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await shot(owner, 'reach-4-shelf');

  // 11.8 — the dials: weights, gates, caps and the one big switch.
  await owner.goto(`${BASE}/algorithm`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('[data-knob="algo_weight_like"]', { timeout: 40000 });
  const knobBlocks = await owner.$$eval('[data-block]', nodes => nodes.map(n => n.dataset.block));
  const doorFirst = (await statusOf(unseated, '/api/promotions/config/')).body;
  const boxLike = await owner.$eval('[data-knob="algo_weight_like"] input', node => Number(node.value));
  ok('the tuning is a desk of boxes, not a config file: weights, gates and the switch, split',
    knobBlocks.join(',') === 'weight,gate,switch' && boxLike === doorFirst.weights.algo_weight_like,
    `${knobBlocks.join(' + ')} · a like is worth ${boxLike}, which is what the feed is told`);
  // Each dial is turned one notch off whatever the desk holds right now, because
  // a run that typed the same seven every time would be a run that quietly turned
  // nothing on its second trip through this file.
  const DIALS = ['algo_weight_like', 'algo_relevance_floor', 'promo_daily_cap',
    'promo_repeat_limit', 'promo_organic_gap'];
  const turnedTo = {};
  for (const key of DIALS) {
    const now = await owner.$eval(`[data-knob="${key}"] input`, node => Number(node.value) || 0);
    turnedTo[key] = now + 1;
    await clearAndType(owner, `[data-knob="${key}"] input`, String(turnedTo[key]));
  }
  const turned = await answered(owner, '[data-algo-save]', 'Save', 'admin/promotions/algorithm/');
  const doorNow = (await statusOf(unseated, '/api/promotions/config/')).body;
  ok('relevance weights, the floor, the daily cap, the repeat limit and the organic gap all move without code',
    turned.status === 200
      && doorNow.weights.algo_weight_like === turnedTo.algo_weight_like
      && doorNow.floor === turnedTo.algo_relevance_floor
      && doorNow.caps.daily === turnedTo.promo_daily_cap
      && doorNow.caps.repeat === turnedTo.promo_repeat_limit
      && doorNow.caps.gap === turnedTo.promo_organic_gap,
    `like ${doorNow.weights.algo_weight_like} · floor ${doorNow.floor} · `
    + `${doorNow.caps.daily}/day · ${doorNow.caps.repeat} seen · ${doorNow.caps.gap} ordinary between`);
  ok('and the audit line names only the dials that were actually turned',
    (turned.body.changed || []).length === 5
      && !turned.body.changed.includes('algo_weight_save') && !turned.body.changed.includes('promo_global_pause'),
    (turned.body.changed || []).join(', '));
  const untouched = await postOf(owner, '/api/admin/promotions/algorithm/', {});
  ok('saving an unchanged desk is refused rather than written as a pretend staff action',
    untouched.status === 400 && /no dial has been turned/.test(untouched.body.detail),
    `${untouched.status} · ${untouched.body.detail}`);

  await tap(owner, '[data-knob="promo_global_pause"] button[data-pause="1"]');
  const pausedAll = await answered(owner, '[data-algo-save]', 'Save the dials', 'admin/promotions/algorithm/');
  const doorPaused = (await statusOf(unseated, '/api/promotions/config/')).body;
  ok('one switch stops every paid campaign at once, and the open door says so for the feed to obey',
    pausedAll.status === 200 && doorPaused.global_pause === true
      && /pause every promotion/i.test(pausedAll.body.detail),
    `${pausedAll.status} · global_pause ${doorPaused.global_pause}`);
  await owner.goto(`${BASE}/promotions`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.promo, .panel.empty', { timeout: 40000 });
  const stoppedWarning = await lineText(owner, '[data-paused-all]');
  ok('the campaign desk itself warns that approving now signs off reach the feed is not showing',
    /paused at the platform level/.test(stoppedWarning) && /not showing anyone/.test(stoppedWarning),
    stoppedWarning.replace(/\s+/g, ' ').slice(0, 140));
  await reachPile('all');
  const stillRunning = (await statusOf(owner, '/api/admin/promotions/?state=all')).body;
  ok('and the switch changes no campaign: they keep their status and their reservation',
    stillRunning.results.some(row => row.status === 'active')
      && Number(stillRunning.counts.reserved) > 0,
    `${stillRunning.results.filter(row => row.status === 'active').length} still active · `
    + `${stillRunning.counts.reserved} coins still reserved`);
  await owner.goto(`${BASE}/algorithm`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('[data-knob="promo_global_pause"]', { timeout: 40000 });
  await tap(owner, '[data-knob="promo_global_pause"] button[data-pause="off"]');
  await answered(owner, '[data-algo-save]', 'Save', 'admin/promotions/algorithm/');
  const doorOff = (await statusOf(unseated, '/api/promotions/config/')).body;
  ok('turning it back off is the same one switch, so a spam wave is not a two-hour incident',
    doorOff.global_pause === false, `global_pause ${doorOff.global_pause}`);
  await shot(owner, 'reach-5-dials');

  // 11.9 — reading paid reach and deciding it are two different keys.
  const blindQueue = await statusOf(mod, '/api/admin/promotions/');
  ok('a Moderator is not handed the paid campaign queue, and the door names the screen to ask for',
    blindQueue.status === 403 && blindQueue.body.permission === 'promotions_view',
    `${blindQueue.status} ${blindQueue.body.permission || 'allowed'}`);
  await mod.bringToFront();
  await mod.goto(`${BASE}/promotions`, { waitUntil: 'domcontentloaded' });
  await mod.waitForSelector('.panel.blocked', { timeout: 40000 });
  const modReachNav = await text(mod, '.side-nav');
  ok('and is not offered the reach screens in the drawer either',
    !modReachNav.includes('Paid campaigns') && !modReachNav.includes('Reach controls')
      && !modReachNav.includes('Campaign packages'),
    modReachNav.replace(/\s+/g, ' ').slice(0, 100));

  await owner.bringToFront();
  await owner.goto(`${BASE}/access`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.search input', { timeout: 40000 });
  await clearAndType(owner, '.search input', SEAT);
  await openSeat(owner, SEAT);
  await owner.waitForSelector('.key-groups', { timeout: 40000 });
  await clickText(owner, '.seat-keys button.key', 'Promotion queue and performance');
  await clickText(owner, '.key-actions button', 'Save screens');
  await expectBanner(owner, 'Saved');
  const halfSeat = await statusOf(mod, '/api/admin/promotions/');
  ok('a seat can be handed the campaign queue to read without being handed the coins behind it',
    halfSeat.status === 200 && halfSeat.body.can_review === false
      && halfSeat.body.results.length > 0,
    `${halfSeat.status} · can_review ${halfSeat.body.can_review}`);
  const halfDecide = await postOf(mod, `/api/admin/promotions/${cleanRow}/pause/`, { reason: 'read-only seat trying' });
  ok('and the same seat is refused the decision, with the second key named on the way out',
    halfDecide.status === 403 && halfDecide.body.permission === 'promotions_review',
    `${halfDecide.status} ${halfDecide.body.permission || 'allowed'}`);
  await mod.goto(`${BASE}/promotions`, { waitUntil: 'domcontentloaded' });
  await mod.waitForSelector('.promo', { timeout: 40000 });
  const readOnlyNote = await lineText(mod, '[data-readonly]');
  const noVerbs = await mod.$$eval('.promo .verbs button', nodes => nodes.length);
  ok('the screen a read-only seat is given says so on the page instead of offering dead buttons',
    noVerbs === 0 && readOnlyNote.includes('Approve, pause, stop, refund')
      && !readOnlyNote.includes('undefined'),
    `${noVerbs} verbs offered — ${readOnlyNote.replace(/\s+/g, ' ').slice(0, 110)}`);
  await shot(mod, 'reach-6-read-only');

  await owner.goto(`${BASE}/access`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.search input', { timeout: 40000 });
  await clearAndType(owner, '.search input', SEAT);
  await openSeat(owner, SEAT);
  await owner.waitForSelector('.key-groups', { timeout: 40000 });
  await clickText(owner, '.seat-keys button.key', 'Promotion queue and performance');
  await clickText(owner, '.key-actions button', 'Save screens');
  await expectBanner(owner, 'Saved');
  const shutAgain = await statusOf(mod, '/api/admin/promotions/');
  ok('taking the screen back is the same one click, so a promotion desk can be closed for the night',
    shutAgain.status === 403, `${shutAgain.status} after the grant was withdrawn`);

  // ── 12. the safety desk, the pile, the alerts, the log, the files, the sizes ──
  //
  // Contracts 6.9 and 6.10 walk in the order a seat actually does them: read the log
  // before anything has been touched, so the gap list is the honest one; turn the
  // rules; watch the flagged pile move with the number; run the checks; take a file;
  // then read the log again and find that every click above wrote its own row.
  //
  // The fixture for this section is `admin/qa/watch_seed.py`: four reporters on one
  // hidden post, two on a live one, three each on a comment and a listing, three on a
  // post that no longer exists, and four outside reporters each given a different
  // answer — one healthy, one gone quiet, one counting trouble, one never wired in.

  /**
   * A file, asked for the way the screen asks for it.
   *
   * `again()` retries, and a retried build would hand the audit log a second
   * download that no person took, so this one answers exactly once and keeps the
   * headers the server set rather than the numbers the page already knew.
   */
  const rawFile = (page, apiPath, payload = {}) => page.evaluate(async (target, sent) => {
    const csrf = (document.cookie.match(/(?:^|;\s*)exposing_csrf=([^;]*)/) || [])[1] || '';
    const res = await fetch(target, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'text/csv, application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf),
      },
      body: JSON.stringify(sent),
    });
    const text = await res.text();
    return {
      status: res.status,
      type: res.headers.get('Content-Type') || '',
      filename: ((res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || '',
      rows: Number(res.headers.get('X-Export-Rows') || 0),
      truncated: res.headers.get('X-Export-Truncated') === '1',
      said: text.slice(0, 240),
      head: text.split('\n')[0] || '',
    };
  }, apiPath, payload);

  const watchPile = async () => (await statusOf(owner, '/api/admin/spam/flags/?page=0')).body;
  // Only the rows this file's own accounts own, because the demo seed has a pile of
  // its own and a count that includes it would be a count of somebody else's work.
  const ownPile = desk => desk.content.filter(row => row.owner && row.owner.username === 'qa_peek_host');

  await owner.goto(`${BASE}/audit`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('[data-list="audit"] .entry', { timeout: 40000 });
  const logShape = await owner.evaluate(() => ({
    pens: document.querySelectorAll('[data-list="audit"] button').length,
    families: document.querySelectorAll('.filters .fchip').length,
    tiles: document.querySelectorAll('[data-entry]').length,
  }));
  ok('the audit log opens as evidence, not as a workspace: rows listed, families filterable, not one pen',
    logShape.pens === 0 && logShape.families > 6 && logShape.tiles > 0,
    `${logShape.pens} buttons in the table · ${logShape.families} family filters · ${logShape.tiles} rows`);

  const gapFirst = await lineText(owner, '[data-missing-families]');
  ok('a screen that counts zeroes can tell a quiet month from a hole in the logging, and says which families they are',
    gapFirst.includes('alerts') && gapFirst.includes('data exports')
      && !gapFirst.includes('coins and payments') && !gapFirst.includes('staff and access'),
    gapFirst.replace(/\s+/g, ' ').slice(0, 180));

  await clearAndType(owner, '.toolbar .search input', 'safety watch');
  const systemLine = await until(owner, '[data-list="audit"] .entry', 'the platform itself');
  ok('a row the platform wrote itself is named as one, instead of leaving the Who column blank',
    systemLine.includes('the platform itself') && systemLine.includes('no account behind it')
      && systemLine.includes('auto hide post'),
    systemLine.replace(/\s+/g, ' ').slice(0, 150));

  await clearAndType(owner, '.toolbar .search input', '');
  await clearAndType(owner, '.toolbar .dates input:nth-of-type(2)', 'november');
  const dateRefused = await expectBad(owner, 'Give a date as');
  ok('a date typed in words is refused in words, before the screen shows an empty table that looks like a quiet year',
    dateRefused.includes('2026-11-22'), dateRefused.replace(/\s+/g, ' ').slice(0, 140));
  await clearAndType(owner, '.toolbar .dates input:nth-of-type(2)', '2020-01-01');
  await owner.waitForFunction(() => (document.querySelector('[data-totals]') || {}).textContent
    && document.querySelector('[data-totals]').textContent.includes('0 entries match'), { timeout: 40000 });
  const logEmpty = await text(owner, '[data-totals]');
  ok('and a window that holds nothing says so as a window, with the whole log still counted beside it',
    logEmpty.startsWith('0 entries match this filter') && logEmpty.includes('rows in the log since it began'),
    logEmpty.replace(/\s+/g, ' ').slice(0, 160));
  await waitGone(owner, '[data-list="audit"]');
  await clearAndType(owner, '.toolbar .dates input:nth-of-type(2)', '');
  await owner.waitForSelector('[data-list="audit"] .entry', { timeout: 40000 });
  await shot(owner, 'safety-1-audit-gap');

  await owner.goto(`${BASE}/flags`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('[data-totals]', { timeout: 40000 });
  const pileRead = await watchPile();
  const mineThree = ownPile(pileRead);
  const pileTold = await text(owner, '[data-totals]');
  ok('the pile screen leads with the number that decides it, and the number is the rule on the spam desk',
    pileRead.threshold === 3 && pileTold.includes('a pile of 3 distinct reporters')
      && (await owner.$('[data-totals] a[href="/spam"]')) !== null,
    pileTold.replace(/\s+/g, ' ').slice(0, 140));
  ok('the pile lists what the number reached, and keeps the four states apart instead of flattening them into one list',
    mineThree.length === 3
      && mineThree.filter(row => row.kind === 'post' && row.live === false).length === 1
      && mineThree.filter(row => row.live === true).length === 2
      && mineThree.every(row => row.reporters >= 3),
    `${mineThree.length} of this fixture’s rows over the pile · `
      + `${mineThree.filter(row => row.live).length} still in the feed`);
  ok('auto-hide has only ever looked at posts, and the screen says so rather than implying a comment was judged',
    mineThree.filter(row => row.kind !== 'post').every(row => row.state_word === 'in the feed' && row.live === true),
    mineThree.map(row => `${row.kind}:${row.state_word || row.state}`).join(' · '));
  const lostTarget = (pileRead.content || []).find(row => row.gone);
  ok('a report outlives the thing it pointed at: the complaints on a deleted post stay on the list, named as gone',
    !!lostTarget && lostTarget.owner === null && lostTarget.state === 'gone',
    lostTarget ? `target ${lostTarget.id} with ${lostTarget.reporters} reporters` : 'no deleted target listed');
  const pileQuiet = await owner.evaluate(() => ({
    rows: document.querySelectorAll('[data-flag]').length,
    held: [...document.querySelectorAll('[data-flag] [data-where]')].map(node => node.dataset.where),
  }));
  ok('what the list says about each target is what the platform actually did to it, row for row',
    pileQuiet.rows === (pileRead.content || []).length && pileQuiet.held.includes('hidden')
      && pileQuiet.held.includes('gone'),
    `${pileQuiet.rows} rows · ${[...new Set(pileQuiet.held)].join(', ')}`);
  await shot(owner, 'safety-2-flags');

  await owner.goto(`${BASE}/spam`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('[data-knob="alert_report_pile"] input', { timeout: 40000 });
  const ruleBoxes = await owner.evaluate(() => ({
    knobs: document.querySelectorAll('[data-spam="rules"] [data-knob]').length,
    told: [...document.querySelectorAll('[data-spam="rules"] .desk-live')].map(node => node.textContent.trim()),
  }));
  ok('the spam desk is a screen of rules, and the four the site already refuses on are marked as refused-on',
    ruleBoxes.knobs === 14 && ruleBoxes.told.length === 4
      && ruleBoxes.told.every(line => line.includes('the site refuses this at its own door today')),
    `${ruleBoxes.knobs} knobs · ${ruleBoxes.told.length} marked as already enforced`);

  const quoteOpen = await statusOf(unseated, '/api/spam/config/');
  ok('what the desk publishes is readable with nobody signed in, because that is the half that makes "no code changes" true',
    quoteOpen.status === 200 && quoteOpen.body.auto_hide.reports === 3
      && quoteOpen.body.limits.spam_signup_per_hour === 3,
    `${quoteOpen.status} · pile ${quoteOpen.body.auto_hide && quoteOpen.body.auto_hide.reports}`);

  await clearAndType(owner, '[data-knob="alert_report_pile"] input', '4');
  await tap(owner, '[data-spam-save]');
  const pileSaved = await expectBanner(owner, 'Saved reports before content is pulled');
  ok('the number that decides what is pulled is a box, and saving it is written as a change to that box',
    pileSaved.includes('/api/spam/config/'), pileSaved.replace(/\s+/g, ' ').slice(0, 150));
  const quoteFive = await statusOf(unseated, '/api/spam/config/');
  ok('a stranger is told the new rule on the next request, without anybody deploying anything',
    quoteFive.body.auto_hide.reports === 4, `the open door now answers a pile of ${quoteFive.body.auto_hide.reports}`);
  const deskCrossed = await statusOf(owner, '/api/admin/alerts/');
  const pileDial = (deskCrossed.body.thresholds || []).find(item => item.key === 'alert_report_pile');
  ok('and the other desk that reads the same rule sees the number the first one wrote',
    pileDial && String(pileDial.value) === '4' && !!pileDial.set,
    pileDial ? `the alerts desk reads ${pileDial.value}, written by ${pileDial.by}` : 'no shared dial');

  await clearAndType(owner, '[data-knob="alert_report_pile"] input', '5');
  await tap(owner, '[data-spam-save]');
  await expectBanner(owner, 'Saved');
  const pileFive = ownPile(await watchPile());
  ok('raise the pile and the list shrinks by itself: at five reporters nothing here is over the line',
    pileFive.length === 0, `${pileFive.length} of the fixture’s targets at or over five`);

  const tightPile = await postOf(owner, '/api/admin/spam/', { alert_report_pile: 1 });
  ok('a pile of one is refused out loud, because one complaint has never been a consensus',
    tightPile.status === 400 && tightPile.body.detail.includes('Two people is the smallest pile'),
    `${tightPile.status} — ${String(tightPile.body.detail).slice(0, 90)}`);
  const stillDesk = await postOf(owner, '/api/admin/spam/', {});
  ok('saving a desk nobody moved is refused rather than written to the log as a change',
    stillDesk.status === 400 && stillDesk.body.detail.includes('no rule has been changed'),
    `${stillDesk.status} — ${String(stillDesk.body.detail).slice(0, 80)}`);

  await clearAndType(owner, '[data-knob="alert_report_pile"] input', '');
  await tap(owner, '[data-spam-save]');
  await expectBanner(owner, 'Saved');
  const pileHome = await watchPile();
  ok('a rule can be given back to the platform, and the desk then says it is the number the site was built with',
    pileHome.threshold === 3 && ownPile(pileHome).length === 3,
    `back to a pile of ${pileHome.threshold}`);

  await tap(owner, '[data-knob="spam_autohide"] .moves button:nth-of-type(2)');
  await tap(owner, '[data-spam-save]');
  await expectBanner(owner, 'Saved');
  const autoQuiet = await until(owner, '[data-live="auto_hide"]', 'off — every report waits');
  const warnSaid = await lineText(owner, '[data-autohide-off]');
  const spamDoor = await statusOf(unseated, '/api/spam/config/');
  ok('switching auto-hide off is said three ways: the desk warns, the screen repeats, the open door agrees',
    warnSaid.includes('Auto-hide is off') && autoQuiet.includes('off — every report waits for a person')
      && spamDoor.body.auto_hide.enabled === false,
    `the door answers enabled ${spamDoor.body.auto_hide.enabled}`);
  await tap(owner, '[data-knob="spam_autohide"] .moves button:nth-of-type(1)');
  await tap(owner, '[data-spam-save]');
  await expectBanner(owner, 'Saved');
  const autoBack = await until(owner, '[data-live="auto_hide"]', 'distinct reporters');
  ok('and putting it back is the same two clicks, with the number it pulls on printed beside it',
    autoBack.includes('on 3 distinct reporters'), autoBack.replace(/\s+/g, ' ').slice(0, 110));
  await shot(owner, 'safety-3-spam');

  await owner.goto(`${BASE}/alerts`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('[data-alerts="wires"] [data-wire]', { timeout: 40000 });
  const wireRows = await owner.$$eval('[data-wire]', nodes => nodes.map(node => ({
    key: node.dataset.wire, wired: node.dataset.wired, said: node.textContent.replace(/\s+/g, ' ').trim(),
  })));
  ok('the four conditions nothing outside this codebase reports on are listed as wires, not as zeroes',
    wireRows.length === 4 && wireRows.filter(row => row.wired === '1').length === 3
      && wireRows.some(row => row.key === 'jobs' && row.wired === '0' && row.said.includes('never reported in')),
    wireRows.map(row => `${row.key}:${row.wired}`).join(' '));
  const wireCommand = await lineText(owner, '[data-alerts="wires"] .panel-foot');
  ok('a wire comes with the exact command that would connect it, so the gap is somebody’s five-second job',
    wireCommand.includes('python manage.py adminpulse') && wireCommand.includes('--state=ok'),
    wireCommand.replace(/\s+/g, ' ').slice(0, 130));
  const backupWire = wireRows.find(row => row.key === 'backup');
  ok('heard from, then gone quiet, is told apart from never heard of — the backup wire says when it last spoke',
    !!backupWire && backupWire.wired === '1' && backupWire.said.includes('last heard from')
      && backupWire.said.includes('nightly dump'),
    backupWire ? backupWire.said.slice(0, 120) : 'no backup wire');

  const liveBefore = (await statusOf(owner, '/api/admin/alerts/?status=open')).body;
  const errorsFired = liveBefore.rows.find(row => row.key === 'errors:backlog');
  const backupFired = liveBefore.rows.find(row => row.key === 'backup:stale');
  ok('a collector reporting 47 errors an hour against a dial of 20 becomes an alert a seat can see',
    !!errorsFired && errorsFired.severity === 'critical' && errorsFired.title.includes('47 waiting'),
    errorsFired ? `${errorsFired.title} → ${errorsFired.href}` : 'the error count raised nothing');
  ok('and a backup that stopped talking raises its own trouble, linked to the screen a restore would come from',
    !!backupFired && backupFired.severity === 'critical' && backupFired.href === '/exports'
      && backupFired.title.includes('No word about backups for'),
    backupFired ? backupFired.title : 'the silent backup raised nothing');

  await clearAndType(owner, '[data-knob="alert_error_rate"] input', '100');
  await tap(owner, '[data-thresholds-save]');
  const dialSaved = await expectBanner(owner, 'Saved app errors in an hour');
  ok('the dial that decides when something becomes an alert is a box on this desk too',
    dialSaved.includes('closes whatever it no longer believes'), dialSaved.replace(/\s+/g, ' ').slice(0, 150));
  const scanRan = await answered(owner, '[data-scan]', 'Run the checks', '/api/admin/alerts/scan/');
  ok('a check runs because a person pressed it, and the screen says what was still true after that run',
    scanRan.status === 200 && scanRan.body.detail.includes('condition(s) true'),
    `${scanRan.status} · ${String(scanRan.body.detail).slice(0, 110)}`);
  const liveRaised = (await statusOf(owner, '/api/admin/alerts/?status=open')).body;
  ok('and the dial that was just moved is honoured by the very next scan: at 100 an hour, 47 is not an alert',
    !liveRaised.rows.some(row => row.key === 'errors:backlog'),
    `${liveRaised.rows.length} conditions still true after raising the dial`);

  await clearAndType(owner, '[data-knob="alert_error_rate"] input', '20');
  await tap(owner, '[data-thresholds-save]');
  await expectBanner(owner, 'Saved');
  await answered(owner, '[data-scan]', 'Run the checks', '/api/admin/alerts/scan/');
  const liveBack = (await statusOf(owner, '/api/admin/alerts/?status=open')).body;
  const errorsAgain = liveBack.rows.find(row => row.key === 'errors:backlog');
  ok('put the dial back and the condition returns by itself — resolving is not the same as fixing',
    !!errorsAgain && errorsAgain.status === 'open' && errorsAgain.occurrences > 1,
    errorsAgain ? `back as ${errorsAgain.status} after ${errorsAgain.occurrences} times true` : 'it did not come back');

  const ackTarget = liveBack.rows.find(row => row.key === 'backup:stale');
  ok('and the trouble a seat has to act on is the one still listed as open after every scan above',
    !!ackTarget && ackTarget.status === 'open', ackTarget ? `${ackTarget.key} ${ackTarget.status}`
      : 'nothing in the backup family was open to acknowledge');
  await owner.reload({ waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('[data-scan]', { timeout: 40000 });
  await tap(owner, `[data-ack="${ackTarget.id}"]`);
  const ackSaid = await expectBanner(owner, 'Acknowledged by');
  ok('acknowledging says a person has read it, and says plainly that it did not make it less true',
    ackSaid.includes('Still true until the next scan') && ackSaid.includes('sita'),
    ackSaid.replace(/\s+/g, ' ').slice(0, 130));
  const ackedPill = await until(owner, `[data-alert="${ackTarget.id}"] .pill`, 'acked');
  ok('the row the desk just acknowledged is the row the list now shows as acknowledged',
    ackedPill === 'acked', `the pill reads ${ackedPill}`);
  await tap(owner, `[data-resolve="${ackTarget.id}"]`);
  const resolvedSaid = await expectBanner(owner, 'Resolved by');
  ok('resolving by hand is allowed, and is labelled as a claim about the condition rather than about the job',
    resolvedSaid.includes('comes back on its own if the condition is still true'),
    resolvedSaid.replace(/\s+/g, ' ').slice(0, 130));
  await shot(owner, 'safety-4-alerts');

  await owner.goto(`${BASE}/limits`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('[data-knob="limit_photo_count"] input', { timeout: 40000 });
  const sixNumbers = await owner.$$eval('[data-limits="sizes"] [data-knob] input', nodes => nodes.map(node => ({
    key: node.name, value: node.value, dflt: node.dataset.default,
  })));
  ok('contract 6.10’s five defaults are six boxes on a settings screen, each showing the number the clause named',
    sixNumbers.length === 6
      && sixNumbers.every(box => box.value === box.dflt)
      && sixNumbers.find(box => box.key === 'limit_text_chars').dflt === '2000'
      && sixNumbers.find(box => box.key === 'limit_photo_count').dflt === '4'
      && sixNumbers.find(box => box.key === 'limit_photo_mb').dflt === '5'
      && sixNumbers.find(box => box.key === 'limit_video_seconds').dflt === '60'
      && sixNumbers.find(box => box.key === 'limit_video_mb').dflt === '150',
    sixNumbers.map(box => `${box.key}=${box.dflt}`).join(' '));
  const sizesOpen = await statusOf(unseated, '/api/limits/config/');
  ok('a composer is told the same six numbers without signing in, in the units it needs them in',
    sizesOpen.status === 200 && sizesOpen.body.text.characters === 2000
      && sizesOpen.body.photo.per_post === 4 && sizesOpen.body.photo.each_bytes === 5242880
      && sizesOpen.body.video.seconds === 60,
    `${sizesOpen.status} · ${JSON.stringify(sizesOpen.body.photo)}`);

  await clearAndType(owner, '[data-knob="limit_photo_count"] input', '6');
  await clearAndType(owner, '[data-knob="limit_video_mb"] input', '400');
  await tap(owner, '[data-limits-save]');
  const sizesSaved = await expectBanner(owner, 'Saved');
  ok('a limit raised past what the server can honour is saved, and the banner is the one that admits it',
    sizesSaved.includes('turned away by the upload endpoint') && sizesSaved.includes('150 MB'),
    sizesSaved.replace(/\s+/g, ' ').slice(0, 180));
  const sizesPublished = await statusOf(unseated, '/api/limits/config/');
  await owner.waitForFunction(() => (document.querySelector('[data-drifted]') || {}).textContent
    && document.querySelector('[data-drifted]').textContent.includes('2 of the six'), { timeout: 40000 });
  const driftSaid = await text(owner, '[data-drifted]');
  ok('the roomier composer is the rule the site is told now, and the screen still names the ceiling it cannot lift',
    sizesPublished.body.photo.per_post === 6 && sizesPublished.body.video.each_mb === 400
      && driftSaid.includes('150 → 400'),
    driftSaid.replace(/\s+/g, ' ').slice(0, 170));
  const outOfRange = await postOf(owner, '/api/admin/limits/', { limit_photo_count: 99 });
  ok('a number that would break the composer is refused with the range it broke, not accepted as a stricter rule',
    outOfRange.status === 400 && outOfRange.body.detail.includes('between 1 and 20'),
    `${outOfRange.status} — ${String(outOfRange.body.detail).slice(0, 90)}`);
  const notANumber = await postOf(owner, '/api/admin/limits/', { limit_text_chars: 'two thousand' });
  ok('and a limit typed in words is refused in words, so no screen downstream has to render an `abc`',
    notANumber.status === 400 && notANumber.body.detail.includes('whole number'),
    `${notANumber.status} — ${String(notANumber.body.detail).slice(0, 90)}`);

  await clearAndType(owner, '[data-knob="limit_photo_count"] input', '4');
  await clearAndType(owner, '[data-knob="limit_video_mb"] input', '150');
  await tap(owner, '[data-limits-save]');
  await expectBanner(owner, 'Saved');
  const sizesBack = await until(owner, '[data-live="photo"]', '4 per post');
  const drifted = await owner.evaluate(() => document.querySelectorAll('[data-drifted], [data-oversized]').length);
  ok('giving the six numbers back leaves nothing behind: no drift note, no ceiling warning, the clause’s own defaults',
    drifted === 0 && sizesBack.includes('5 MB') && sizesBack.includes('5242880') === false,
    `${drifted} warnings left · ${sizesBack.replace(/\s+/g, ' ').slice(0, 90)}`);
  await shot(owner, 'safety-5-limits');

  await owner.goto(`${BASE}/exports`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('[data-list="exports"] .entry', { timeout: 40000 });
  const fiveFiles = await owner.$$eval('[data-export]', nodes => nodes.map(node => node.dataset.export));
  const capSaid = await lineText(owner, '[data-totals]');
  const countSaid = await text(owner, '.toolbar-count');
  ok('the five files the contract names are the five on the screen, in the order an accountant asks for them',
    fiveFiles.join(',') === 'users,reports,coin_requests,coin_ledger,promotions'
      && capSaid.includes('50,000') && /\d[\d,]* rows across the five files/.test(countSaid),
    `${fiveFiles.join(', ')} · ${countSaid.replace(/\s+/g, ' ').slice(0, 60)} · ${capSaid.replace(/\s+/g, ' ').slice(0, 70)}`);

  await clearAndType(owner, '.toolbar .dates input:nth-of-type(1)', '2026-11-20');
  await clearAndType(owner, '.toolbar .dates input:nth-of-type(2)', '2026-11-01');
  const windowBad = await expectBad(owner, 'first date is after the second');
  ok('a window typed backwards is refused in words instead of handing over an empty file that looks like a quiet month',
    windowBad.includes('would hold nothing'), windowBad.replace(/\s+/g, ' ').slice(0, 120));
  await clearAndType(owner, '.toolbar .dates input:nth-of-type(1)', '');
  await clearAndType(owner, '.toolbar .dates input:nth-of-type(2)', '');
  // Blanking the two dates re-counts the five files, and a re-count deliberately
  // greys out every Download while it runs — `busy` is one flag for reads and builds
  // alike. So the click waits for the button to be clickable again, not for the line
  // above the table: that line had already been the whole table once, so it never
  // goes back to its spinner and a wait on it passes a second before the click would
  // have landed on a disabled button.
  await owner.waitForSelector('[data-download="users"]:not([disabled])', { timeout: 40000 });
  await tap(owner, '[data-download="users"]');
  await owner.waitForSelector('[data-saved="users"]', { timeout: 40000 });
  const fileTaken = await text(owner, '[data-saved="users"]');
  const fileProof = await rawFile(owner, '/api/admin/exports/coin_ledger/?raw=1');
  ok('one click hands over the real file: the name and the count come from the headers the server set, not the page',
    fileTaken.includes('exposing-users-') && fileTaken.includes(' rows, ') && !fileTaken.includes('undefined')
      && fileProof.status === 200 && /text\/csv/.test(fileProof.type) && fileProof.rows > 0
      && fileProof.head.startsWith('id,created_at,username') && fileProof.filename.startsWith('exposing-coin_ledger-'),
    `${fileProof.filename} · ${fileProof.rows} rows · ${fileProof.head.slice(0, 40)}`);
  const takenNote = await until(owner, '[data-list="exports-taken"]', 'exposing-users-');
  ok('building a file of other people’s email addresses is a staff action, and the screen shows the record of it',
    takenNote.includes('sita') && takenNote.includes('every row the table holds'),
    takenNote.replace(/\s+/g, ' ').slice(-150));
  const unknownFile = await rawFile(owner, '/api/admin/exports/names/?raw=1');
  ok('and there is no sixth file to ask for: a dataset that is not one of the five is named back as a list',
    unknownFile.status === 404 && unknownFile.said.includes('Choose one of'),
    `${unknownFile.status} — ${unknownFile.said.slice(0, 90)}`);
  await shot(owner, 'safety-6-exports');

  await owner.goto(`${BASE}/audit`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('[data-list="audit"] .entry', { timeout: 40000 });
  const gapClosed = await statusOf(owner, '/api/admin/audit/');
  const stillGaps = (gapClosed.body.facets.families || []).filter(row => row.contract && row.n === 0);
  const gapLeft = await owner.evaluate(() => document.querySelectorAll('[data-missing-families]').length);
  ok('the walkthrough closed the gap it opened with: every family the contract names now carries at least one row',
    stillGaps.length === 0 && gapLeft === 0,
    stillGaps.map(row => row.label).join(', ') || 'all nine families written');

  const verbsWritten = {};
  for (const verb of ['spam_settings', 'alert_scan', 'alert_thresholds', 'alert_ack', 'alert_resolve',
    'post_limits', 'export_csv']) {
    const read = await statusOf(owner, `/api/admin/audit/?action=${verb}`);
    verbsWritten[verb] = (read.body.results || []).length;
  }
  ok('every action this desk took wrote its own row, with the seat’s name and the reason typed with it',
    Object.entries(verbsWritten).every(([, n]) => n > 0),
    Object.entries(verbsWritten).map(([verb, n]) => `${verb} ${n}`).join(' · '));

  const fileInLog = await statusOf(owner, '/api/admin/audit/?q=exposing-users');
  const fileRow = (fileInLog.body.results || [])[0];
  ok('a file handed over a month from now is findable by its own filename, because the name is on the row',
    (fileInLog.body.results || []).length > 0 && !!fileRow && fileRow.action === 'export_csv'
      && fileRow.actor === 'sita' && String(fileRow.detail).includes('.csv'),
    fileRow ? `${fileRow.actor} ${fileRow.action} — ${String(fileRow.detail).slice(0, 90)}` : 'the search found nothing');

  await chip(owner, 'alerts', '/api/admin/audit/');
  await until(owner, '[data-list="audit"] .entry', 'alert');
  const alertVerbs = await many(owner, '[data-list="audit"] .verb');
  ok('the family filter is a filter: every row it leaves is an alert action, and none of them is a coin or a campaign',
    alertVerbs.length > 0 && alertVerbs.every(verb => verb.startsWith('alert')),
    `${alertVerbs.length} rows · ${[...new Set(alertVerbs)].join(', ').slice(0, 110)}`);
  await shot(owner, 'safety-7-audit-closed');

  const shutDoors = [
    ['/spam', 'spam_settings'], ['/alerts', 'alerts'], ['/audit', 'audit'],
    ['/exports', 'exports'], ['/limits', 'post_limits'],
  ];
  for (const [gateRoute, gateKey] of shutDoors) {
    const doorRead = await statusOf(mod, `/api/admin/${gateRoute.replace('/', '')}/`);
    await mod.goto(`${BASE}${gateRoute}`, { waitUntil: 'domcontentloaded' });
    await mod.waitForSelector('.panel.blocked', { timeout: 40000 });
    const doorSeen = await mod.evaluate(() => ({
      knobs: document.querySelectorAll('[data-knob]').length,
      rows: document.querySelectorAll('[data-list] .entry').length,
      said: document.querySelector('.panel.blocked').textContent.replace(/\s+/g, ' ').trim(),
    }));
    ok(`a Moderator is stopped at ${gateRoute} by the seat, not by a spinner: the door names ${gateKey} and the screen names nothing to type into`,
      doorRead.status === 403 && doorRead.body.permission === gateKey
        && doorSeen.knobs === 0 && doorSeen.rows === 0 && doorSeen.said.includes('Not on your seat'),
      `${doorRead.status} ${doorRead.body.permission || 'allowed'} · ${doorSeen.knobs} knobs rendered`);
  }
  const pileShared = await statusOf(mod, '/api/admin/spam/flags/');
  const rulesShut = await statusOf(mod, '/api/admin/spam/');
  ok('the pile a moderator works from stays open to a moderator; only the rules behind it are a Client’s',
    pileShared.status === 200 && pileShared.body.threshold === 3 && rulesShut.status === 403
      && rulesShut.body.permission === 'spam_settings',
    `flags ${pileShared.status} at a pile of ${pileShared.body.threshold} · rules ${rulesShut.status}`);
  await mod.goto(`${BASE}/flags`, { waitUntil: 'domcontentloaded' });
  await mod.waitForSelector('[data-totals]', { timeout: 40000 });
  const pileForSeat = await mod.evaluate(() => ({
    rows: document.querySelectorAll('[data-flag]').length,
    link: !!document.querySelector('[data-totals] a[href="/spam"]'),
  }));
  ok('and the link that would take a moderator to the desk they cannot open is the one thing the screen does not hide',
    pileForSeat.rows > 0 && pileForSeat.link === true,
    `${pileForSeat.rows} rows · the spam desk ${pileForSeat.link ? 'is' : 'is not'} offered`);
  await shot(mod, 'safety-8-gated');

  await owner.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await owner.goto(`${BASE}/overview`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.tile', { timeout: 40000 });
  const motionLoud = await owner.evaluate(() => {
    const style = getComputedStyle(document.querySelector('.tile'));
    return { name: style.animationName, seconds: style.animationDuration };
  });
  await owner.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await owner.reload({ waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.tile', { timeout: 40000 });
  const motionCalm = await owner.evaluate(() => {
    const style = getComputedStyle(document.querySelector('.tile'));
    return { name: style.animationName, seconds: style.animationDuration };
  });
  // Compared in milliseconds, because the sheet writes `.01ms` and Chrome answers in
  // seconds: `getComputedStyle` normalises `animation-duration` to `1e-05s`, so a
  // check spelled `0.01ms` fails on a rule that is doing exactly what it says.
  const asMs = value => (/ms$/.test(value) ? parseFloat(value) : parseFloat(value) * 1000);
  ok('the animations are decoration that stands down when asked: reduced motion keeps the same entrance and gives it almost no time',
    asMs(motionLoud.seconds) === 300 && motionCalm.name === motionLoud.name
      && asMs(motionCalm.seconds) < 1,
    `${motionLoud.name} ${motionLoud.seconds} → ${motionCalm.name} ${motionCalm.seconds}`);
  await owner.emulateMediaFeatures([]);

  await unseated.close();
} catch (err) {
  ok('the walkthrough completed', false, `${err.message}`);
  await shot(owner, 'crash-owner').catch(() => undefined);
  await shot(mod, 'crash-mod').catch(() => undefined);
} finally {
  const summary = {
    ran_at: new Date().toISOString(),
    base: BASE,
    passed: results.filter(entry => entry.pass).length,
    total: results.length,
    failed: results.filter(entry => !entry.pass).map(entry => entry.name),
    console_errors: [...new Set(errors)].slice(0, 20),
    // A box that would not hold what was typed is not a passing run: every claim
    // above it was judged on a number the desk never actually had.
    typed_but_not_kept: typeStubs,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'admin-console-results.json'), JSON.stringify(summary, null, 2));
  console.log(`\n${summary.passed}/${summary.total} checks passed`
    + `\nfailed: ${summary.failed.join(' | ') || 'none'}`
    + `\nconsole errors: ${summary.console_errors.join(' | ') || 'none'}`
    + `\nboxes that would not hold what was typed: ${summary.typed_but_not_kept.join(' | ') || 'none'}`);
  await browser.close();
  process.exit(summary.failed.length || summary.console_errors.length
    || summary.typed_but_not_kept.length ? 1 : 0);
}
