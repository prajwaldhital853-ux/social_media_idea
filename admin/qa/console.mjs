/**
 * Contract 6.1 walkthrough, in a real browser against the real API.
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
const text = (page, selector) => page.$eval(selector, node => node.textContent.trim());
const many = (page, selector) => page.$$eval(selector, nodes => nodes.map(n => n.textContent.trim()));

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
  await page.click(selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type(selector, value);
};

/** Green banner, and specifically the one this action wrote. */
async function expectBanner(page, needle) {
  await page.waitForFunction(want => [...document.querySelectorAll('.banner-ok')]
    .some(banner => banner.textContent.includes(want)), { timeout: 40000 }, needle);
  return text(page, '.banner-ok');
}

/** Make sure that username's roster row is expanded. */
async function openSeat(page, username) {
  if (await page.$('.seat.open .seat-side')) return;
  await clickText(page, '.seat-id', username);
  await page.waitForSelector('.seat-side', { timeout: 40000 });
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
  await page.waitForSelector('.codes-grid code, .me-grid, .roster, .card-error', { timeout: 40000 });
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
  await owner.waitForSelector('.roster, .panel.empty', { timeout: 40000 });
  ok('saving the codes lands on Staff and access',
    new URL(owner.url()).pathname === '/access', owner.url());
  const meter = await text(owner, '.window-meter');
  ok('the top bar counts the 30-minute window down', /\d+ min left/.test(meter), meter);
  const nav = await many(owner, '.side-item-label');
  ok('a Client seat sees both console entries',
    nav.includes('Staff and access') && nav.includes('My seat'), nav.join(', '));

  // ── 3. appoint a Moderator, then move two screens ──────────────────────────
  await clickText(owner, '.console-head-right button', 'Grant a seat');
  await owner.waitForSelector('.grant', { timeout: 20000 });
  await owner.type('.grant input', SEAT);
  await owner.select('.grant select', 'moderator');
  await shot(owner, 'owner-3-grant-form');
  await clickText(owner, '.grant button', 'Give access');
  const appointed = await expectBanner(owner, SEAT);
  ok('the Client appoints a Moderator seat', appointed.includes(SEAT), appointed);

  await clearAndType(owner, '.search input', SEAT);
  await owner.waitForFunction(() => document.querySelectorAll('.seat').length === 1, { timeout: 40000 });
  const flags = await many(owner, '.seat .pill');
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
  await mod.waitForSelector('.me-grid', { timeout: 40000 });
  const modNav = await many(mod, '.side-item-label');
  await shot(mod, 'moderator-1-my-seat');
  ok('a Moderator is dropped on My seat and never sees Staff and access',
    new URL(mod.url()).pathname === '/me' && !modNav.includes('Staff and access'), modNav.join(', '));
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
  await mod.waitForSelector('.me-grid', { timeout: 40000 });
  ok('the code reopens the console with its screens intact',
    (await many(mod, '.me-group h3')).includes('Coins and payments'));

  // ── 5. ending a seat takes the console away immediately ────────────────────
  await owner.bringToFront();
  await clearAndType(owner, '.search input', SEAT);
  await owner.waitForFunction(() => document.querySelectorAll('.seat').length === 1, { timeout: 40000 });
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
  fs.writeFileSync(path.join(OUT, 'admin-6-1-results.json'), JSON.stringify(summary, null, 2));
  console.log(`\n${summary.passed}/${summary.total} checks passed`
    + `\nfailed: ${summary.failed.join(' | ') || 'none'}`
    + `\nconsole errors: ${summary.console_errors.join(' | ') || 'none'}`);
  await browser.close();
  process.exit(summary.failed.length || summary.console_errors.length ? 1 : 0);
}
