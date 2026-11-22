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
 *   backend/.venv/Scripts/python.exe admin/qa/reset.py    # seats back to first run
 *   node admin/qa/console.mjs                             # from the repository root
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

const clearAndType = async (page, selector, value) => {
  await again(async () => {
    await page.click(selector);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.type(selector, value);
  });
};

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

/**
 * The whole sign-in: password, then whatever the console asks for. A seat that
 * has never enrolled prints a QR; an enrolled seat only wants the code, and the
 * secret it was given the first time is kept in secrets.json for exactly this.
 */
async function signIn(page, username, label, known = null) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[autocomplete="username"]', { visible: true });
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
  // instead of showing the door. Give that redirect a moment to land, then decide
  // which page this actually is — reading the form while it is being replaced is
  // how the suite used to type a username into nothing.
  const live = await page.waitForSelector('.side-signout', { timeout: 5000 })
    .then(() => true, () => false);
  if (live) {
    await clickText(page, '.side-signout', 'Sign out');
    await page.waitForSelector('input[autocomplete="username"]', { timeout: 40000 });
  } else {
    await page.waitForSelector('input[autocomplete="username"]', { timeout: 40000 });
  }
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
  ok('an alert whose screen has not been built yet is named, not linked to a 404',
    dead.screens.includes('/reports') && dead.alerts.length > 0
      && dead.alerts.every(href => dead.screens.includes(screenOf(href)))
      && dead.named.length === raised.length - dead.alerts.length && dead.named.length > 0,
    `${dead.alerts.length} of ${raised.length} alerts link to the queue, ${dead.named.length} name their screen: ${dead.named.join(', ')}`);
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
  const byState = '.toolbar select[aria-label="Filter by report status"]';
  await pick(owner, byKind, 'listing', 'target=listing');
  await waitCases(owner, 0);
  const listedEmpty = await see(owner, '.panel.empty h2');
  await pick(owner, byKind, '', '/api/admin/review/');
  await pick(owner, byState, 'all', 'status=all');
  const allRows = await waitCases(owner, 7);
  const everyReport = await owner.$$eval('.cases .case .pile', nodes => nodes.map(node => node.className));
  ok('a decided report does not vanish: every-report view still lists it, marked shut',
    allRows.length === 7 && listedEmpty === 'Nothing here'
      && everyReport.filter(cls => cls.includes('shut')).length === 4,
    `${everyReport.filter(cls => cls.includes('shut')).length} of ${everyReport.length} rows already decided`);
  await pick(owner, byState, 'open', 'status=open');
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
  await pick(owner, '.toolbar select[aria-label="Filter by state"]', 'all', 'state=all');
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
  await pick(owner, '.toolbar select[aria-label="Filter by state"]', 'taken_down', 'state=taken_down');
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

  await pick(owner, '.toolbar select[aria-label="Filter by what it is about"]', 'post', 'target=post');
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
  await pick(owner, '.toolbar select[aria-label="Filter by state"]', 'all', 'state=all');
  await reload(owner, '/api/admin/content/');
  const auditRows = await shelfRows(owner, `type=post&state=all&q=${AUTHOR}`);
  const modRecord = auditRows.find(row => row.target === spare.target);
  ok('the audit names the moderator who decided, not the Client who was watching',
    Boolean(modRecord) && /^Reports dismissed by moddemo/.test(modRecord.decision),
    modRecord ? modRecord.decision.slice(0, 90) : `rows: ${auditRows.map(row => `${row.target} ${row.decision}`).join(' / ')}`);
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
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'admin-console-results.json'), JSON.stringify(summary, null, 2));
  console.log(`\n${summary.passed}/${summary.total} checks passed`
    + `\nfailed: ${summary.failed.join(' | ') || 'none'}`
    + `\nconsole errors: ${summary.console_errors.join(' | ') || 'none'}`);
  await browser.close();
  process.exit(summary.failed.length || summary.console_errors.length ? 1 : 0);
}
