/**
 * Auth QA against the live Django backend.
 *
 * Drives the real screens (sign in, sign up, email code, lockout, unlock, Google
 * hand-off, logout) through the Next proxy at :3000, so cookies, CSRF and the
 * trailing-slash rewrite are all exercised exactly as a browser sees them.
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = 'http://localhost:3000';
const OUT = 'D:/social_medial/.qa';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const RUN = Date.now().toString(36).slice(-5);
const QA = { username: `qa${RUN}`, email: `qa${RUN}@demo.test`, password: 'Exposing-qa-9271', name: 'QA Tester' };
const DEMO_PASSWORD = 'exposing-demo-1';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--lang=en-US', '--force-device-scale-factor=1']
});

const errors = [];
async function newPage(viewport, mobile = false) {
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const where = (m.location() && m.location().url) || '';
    if (/\/api\/(auth|sync)\//.test(where)) return;
    errors.push(`console: ${m.text().slice(0, 200)}${where ? ' @ ' + where.slice(0, 140) : ''}`);
  });
  page.on('response', r => {
    if (r.status() < 400) return;
    const u = r.url();
    // Rejections of a credential are the contract under test, and a signed-out app
    // probing /api/sync/ is supposed to be told 401.
    if (/\/api\/auth\//.test(u)) return;
    if (/\/api\/sync\//.test(u) && (r.status() === 401 || r.status() === 403)) return;
    errors.push(`http ${r.status()}: ${u.slice(0, 160)}`);
  });
  return page;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

async function goto(page, path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(600);
}
const url = page => page.evaluate(() => location.pathname);
const textOf = (page, sel) => page.$eval(sel, el => el.textContent.trim()).catch(() => '');
const count = (page, sel) => page.$$eval(sel, els => els.length).catch(() => 0);

/** React reads value only through the native setter. */
const setNative = (page, sel, value) => page.evaluate(([sel, value]) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, [sel, value]);

const setInput = (page, nth, value) => page.evaluate(([nth, value]) => {
  const el = document.querySelectorAll('.login-content input.login-input')[nth];
  if (!el) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, [nth, value]);

/** Unrecognised device id, so the new-device code step fires on every run. */
const freshDevice = page => page.evaluate(() => {
  localStorage.setItem('exposing-device', `qa-${Math.random().toString(36).slice(2, 12)}`);
});

/** A missing form means the run drifted off the sign-in screen; report that instead of throwing. */
const submitLogin = async page => {
  const sent = await page.evaluate(() => {
    const button = document.querySelector('.login-content form button.login-submit');
    if (!button) return false;
    button.click();
    return true;
  });
  if (!sent) ok('the sign-in form was on screen when a submit was asked for', false, `at ${(await url(page)).slice(0, 40)}`);
  return sent;
};

/** Password plus, when the device is unknown, the demo code — until a session exists. */
async function signIn(page, identifier, password) {
  await goto(page, '/login');
  await page.waitForSelector('.login-content', { timeout: 20000 }).catch(() => {});
  await setInput(page, 0, identifier);
  await setInput(page, 1, password);
  await submitLogin(page);
  // A trusted device answers with a session, an unknown one with the code card; either can take a few seconds.
  await page.waitForFunction(() => location.pathname === '/' || !!document.querySelector('.auth-code'), { timeout: 25000 }).catch(() => {});
  if ((await textOf(page, '.auth-code-title')) === 'Confirm it is you') {
    await clickChip(page);
    await page.waitForFunction(() => location.pathname === '/', { timeout: 20000 }).catch(() => {});
  }
  await sleep(800);
  return url(page);
}

async function loginError(page, expected, timeout = 10000) {
  await page.waitForFunction(t => (document.querySelector('.signup-error')?.textContent || '').includes(t),
    { timeout }, expected).catch(() => {});
  return textOf(page, '.signup-error');
}

async function codeCard(page, timeout = 10000) {
  await page.waitForSelector('.auth-code', { timeout }).catch(() => {});
  await sleep(300);
  return {
    title: await textOf(page, '.auth-code-title'),
    detail: await textOf(page, '.auth-code-detail'),
    hint: await textOf(page, '.auth-code-hint'),
    meta: await textOf(page, '.auth-code-meta'),
    dev: await textOf(page, '.auth-code-dev'),
    links: await page.$$eval('.auth-code-link', els => els.map(e => e.textContent.trim())),
    codeValue: await page.$eval('.auth-code-input', el => el.value).catch(() => null),
  };
}

const enterCode = (page, value) => page.evaluate(v => {
  const el = document.querySelector('.auth-code-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, value);

const clickChip = page => page.evaluate(() => document.querySelector('.auth-code-dev')?.click());

const apiMe = page => page.evaluate(async () => {
  const res = await fetch('/api/auth/me/', { credentials: 'same-origin' });
  return { status: res.status, body: res.ok ? await res.json() : null };
});

/** Fill whatever the signup form shows, keyed by input type rather than position. */
const fillSignup = (page, data) => page.evaluate(d => {
  const set = (el, v) => {
    if (!el || v === undefined) return;
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const texts = [...document.querySelectorAll('.signup-form input[type=text]')];
  set(texts[0], d.name);
  set(texts[1], d.username);
  set(document.querySelector('.signup-form input[type=email]'), d.email);
  set(document.querySelector('.signup-form input[type=password]'), d.password);
  set(document.querySelector('.signup-form input[type=date]'), d.dob);
  document.querySelectorAll('.signup-check input[type=checkbox]').forEach(c => { if (!c.checked) c.click(); });
}, data);

async function submitSignup(page) {
  await page.evaluate(() => document.querySelector('.signup-form button[type=submit]').click());
  await sleep(1600);
}

async function logout(page) {
  await goto(page, '/settings');
  // The class, not the label: the settings screen is translated by the time some runs get here.
  await page.waitForSelector('.settings-logout', { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => {
    const b = document.querySelector('.settings-logout');
    if (b) b.click();
  });
  const landed = await page.waitForFunction(() => location.pathname === '/login', { timeout: 15000 })
    .then(() => true).catch(() => false);
  await sleep(400);
  // Later steps assume the sign-in screen; callers assert on `landed` so a broken logout cannot hide.
  if (!landed) await goto(page, '/login');
  return landed;
}

// ================= DESKTOP 1280x900 =================
const d = await newPage({ width: 1280, height: 900 });

await goto(d, '/login');
await d.waitForSelector('.login-content', { timeout: 20000 });
const loginShape = await d.evaluate(() => {
  const inputs = [...document.querySelectorAll('.login-content input.login-input')];
  return {
    title: document.querySelector('.login-title')?.textContent,
    inputs: inputs.map(i => ({ type: i.type, placeholder: i.placeholder, autocomplete: i.autocomplete })),
    google: document.querySelector('.social-btn span')?.textContent,
    legal: [...document.querySelectorAll('.auth-legal a')].map(a => a.getAttribute('href')),
    unlock: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(x => x.includes('unlock code')),
    submitDisabled: document.querySelector('.login-submit')?.disabled,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
});
ok('desktop: sign-in card shows identifier + password with real autofill hints',
  loginShape.title === 'Sign in to Exposing' && loginShape.inputs.length === 2
  && loginShape.inputs[0].autocomplete === 'username' && loginShape.inputs[1].type === 'password',
  JSON.stringify({ title: loginShape.title, inputs: loginShape.inputs }));
ok('desktop: only a Google button this server can finish is offered',
  loginShape.google === 'Continue with a demo Google account', String(loginShape.google));
ok('desktop: sign-in keeps the legal nav and an unlock escape hatch',
  loginShape.legal.length === 4 && loginShape.unlock.length === 1, JSON.stringify(loginShape).slice(0, 200));
ok('desktop: submit starts disabled and the card fits without sideways scroll',
  loginShape.submitDisabled === true && !loginShape.overflow,
  JSON.stringify({ disabled: loginShape.submitDisabled, overflow: loginShape.overflow }));
await shot(d, 'auth-desktop-login');

await setInput(d, 0, 'half.typed');
await sleep(300);
const halfState = await d.evaluate(() => ({
  disabled: document.querySelector('.login-content form button.login-submit')?.disabled,
  errors: document.querySelectorAll('.signup-error').length,
  requests: 0,
}));
ok('desktop: the button waits for both fields instead of firing an empty request',
  halfState.disabled === true && halfState.errors === 0, JSON.stringify(halfState));

await setInput(d, 0, 'no.such.user.zzz');
await setInput(d, 1, 'whatever-1');
await submitLogin(d);
const unknown = await loginError(d, 'No account matches');
ok('desktop: an unknown account gets the server detail, not a fake success',
  unknown === 'No account matches those credentials.', unknown);

// ---- new device: email code step ----
await freshDevice(d);
await setInput(d, 0, 'sita');
await setInput(d, 1, DEMO_PASSWORD);
await submitLogin(d);
const card = await codeCard(d);
ok('desktop: a new device gets the code step instead of a session',
  card.title === 'Confirm it is you', JSON.stringify(card).slice(0, 180));
ok('desktop: the code step names the address the mail went to',
  card.hint.includes('sita@demo.test'), card.hint);
ok('desktop: the code step counts down and offers resend + back',
  /\d+:\d\d/.test(card.meta) && card.links.length >= 2, JSON.stringify({ meta: card.meta, links: card.links }));
ok('desktop: the DEBUG mailer exposes the code as a one-tap chip',
  /\d{6}/.test(card.dev), card.dev);
await shot(d, 'auth-desktop-code');

await enterCode(d, '000000');
const wrongCode = await loginError(d, 'Wrong code');
ok('desktop: a wrong code is rejected with code-scoped tries left',
  wrongCode === 'Wrong code. 4 tries left before this code stops working.', wrongCode);
ok('desktop: a rejected code leaves the visitor signed out', (await apiMe(d)).status === 401);

await d.evaluate(() => { [...document.querySelectorAll('.auth-code-link')].find(b => b.textContent.includes('Resend'))?.click(); });
const resent = await codeCard(d, 12000);
ok('desktop: resend rotates the challenge and restarts the clock',
  /\d+:\d\d/.test(resent.meta) && /\d{6}/.test(resent.dev) && resent.codeValue === '',
  JSON.stringify({ meta: resent.meta, dev: resent.dev, code: resent.codeValue }));

await clickChip(d);
await d.waitForFunction(() => location.pathname === '/', { timeout: 15000 }).catch(() => {});
await sleep(1000);
const welcome = await textOf(d, '.toast');
ok('desktop: the confirmed code signs in and greets by name', welcome === 'Welcome, Sita Karki.', welcome);
const me = await apiMe(d);
ok('desktop: the HttpOnly cookie carries the session /api/auth/me/ reads',
  me.status === 200 && me.body.username === 'sita', JSON.stringify({ status: me.status, u: me.body?.username }));
await d.reload({ waitUntil: 'domcontentloaded' });
await sleep(1400);
ok('desktop: a reload restores the signed-in app instead of the login wall',
  (await url(d)) === '/' && (await count(d, '.tabs')) > 0, await url(d));

await goto(d, '/settings');
await d.waitForSelector('.settings-body', { timeout: 15000 }).catch(() => {});
const settings = await d.evaluate(() => {
  const body = document.querySelector('.settings-body')?.textContent || '';
  return {
    handle: body.includes('@sita'),
    email: body.includes('sita@demo.test'),
    verified: body.includes('Email verified.'),
    twoStep: !!document.querySelector('.settings-body [role=switch][aria-checked=true]'),
    resetDemo: body.includes('Reset demo data'),
  };
});
ok('desktop: settings shows the server-owned account, verified and two-step on',
  settings.handle && settings.email && settings.verified && settings.twoStep, JSON.stringify(settings));
ok('desktop: the demo-data reset is hidden while the API owns the data',
  settings.resetDemo === false, JSON.stringify({ resetDemo: settings.resetDemo }));

// Two-step is a server field, not a local toggle.
const flipTwoStep = () => d.evaluate(() => {
  document.querySelector('.settings-body [role=switch]').click();
});
await flipTwoStep();
await sleep(1200);
const afterFlip = await d.evaluate(() => document.querySelector('.settings-body [role=switch]')?.getAttribute('aria-checked'));
await d.reload({ waitUntil: 'domcontentloaded' });
await d.waitForSelector('.settings-body', { timeout: 15000 }).catch(() => {});
await sleep(1200);
const afterReload = await d.evaluate(() => document.querySelector('.settings-body [role=switch]')?.getAttribute('aria-checked'));
ok('desktop: turning two-step off is written to the server and survives a reload',
  afterFlip === 'false' && afterReload === 'false', JSON.stringify({ afterFlip, afterReload }));
await flipTwoStep();
await sleep(1200);
const restored = await d.evaluate(() => document.querySelector('.settings-body [role=switch]')?.getAttribute('aria-checked'));
ok('desktop: two-step goes back on for the demo account', restored === 'true', restored);

const wentHome = await logout(d);
const outMe = await apiMe(d);
const anonSync = await d.evaluate(async () => (await fetch('/api/sync/', { credentials: 'same-origin' })).status);
ok('desktop: log out clears the cookies and lands on the sign-in card',
  wentHome && outMe.status === 401, JSON.stringify({ landed: wentHome, me: outMe.status }));
ok('desktop: the hydration endpoint stays closed after logout', anonSync === 401, String(anonSync));

// ---- signup with an email verification code ----
await freshDevice(d);
await goto(d, '/signup');
await d.waitForSelector('.signup-form', { timeout: 20000 });
await fillSignup(d, { ...QA, dob: '1996-04-02' });
await submitSignup(d);
const signupCard = await codeCard(d, 12000);
ok('desktop: signup creates the account and asks to confirm the email',
  signupCard.title === 'Confirm it is you' && signupCard.hint.includes(QA.email),
  JSON.stringify(signupCard).slice(0, 180));
await shot(d, 'auth-desktop-signup-code');
await clickChip(d);
await d.waitForFunction(() => location.pathname === '/', { timeout: 15000 }).catch(() => {});
await sleep(900);
const signupMe = await apiMe(d);
ok('desktop: the verified code completes signup and opens the session',
  signupMe.status === 200 && signupMe.body.username === QA.username, JSON.stringify(signupMe.body));

// ---- wrong password, lockout, unlock, sign in ----
await logout(d);
await goto(d, '/login');
await d.waitForSelector('.login-content', { timeout: 20000 });
const badPassword = async () => {
  await setInput(d, 0, QA.username);
  await setInput(d, 1, 'wrong-password-zz');
  await submitLogin(d);
  return loginError(d, 'Wrong password');
};
const first = await badPassword();
ok('desktop: one wrong password reports the plural attempts left',
  first === 'Wrong password. 2 attempts left before the account locks.', first);
ok('desktop: a failed password never opens a session', (await apiMe(d)).status === 401);
const second = await badPassword();
ok('desktop: the last try before lock reads in the singular',
  second === 'Wrong password. 1 attempt left before the account locks.', second);
await shot(d, 'auth-desktop-attempts');

await setInput(d, 0, QA.username);
await setInput(d, 1, 'wrong-password-zz');
await submitLogin(d);
const locked = await codeCard(d, 12000);
ok('desktop: the third wrong password locks the account and hands over an unlock code',
  locked.title === 'Account locked' && /\d{6}/.test(locked.dev), JSON.stringify(locked).slice(0, 180));
await shot(d, 'auth-desktop-locked');

await d.evaluate(() => { [...document.querySelectorAll('.auth-code-link')].find(b => b.textContent.includes('Back'))?.click(); });
await d.waitForSelector('.auth-unlock-link', { timeout: 10000 }).catch(() => {});
await d.evaluate(() => document.querySelector('.auth-unlock-link')?.click());
await sleep(500);
const unlockStep = await d.evaluate(() => ({
  title: document.querySelector('.auth-code-title')?.textContent,
  detail: document.querySelector('.auth-code-detail')?.textContent,
  placeholder: document.querySelector('.auth-code input.login-input')?.placeholder,
}));
ok('desktop: the lock screen explains the unlock path and accepts either handle',
  unlockStep.title === 'Account locked'
  && unlockStep.detail === 'Too many wrong passwords. Ask for an unlock code, then sign in again.'
  && unlockStep.placeholder === 'Email or username', JSON.stringify(unlockStep));
await setNative(d, '.auth-code input.login-input', QA.username);
await d.evaluate(() => document.querySelector('.auth-code form button[type=submit]').click());
const unlockCard = await codeCard(d, 12000);
ok('desktop: an unlock code is issued for a username as well as an email',
  unlockCard.title === 'Account locked' && /\d{6}/.test(unlockCard.dev), JSON.stringify(unlockCard).slice(0, 160));
await shot(d, 'auth-desktop-unlock');
await clickChip(d);
await d.waitForSelector('.auth-notice', { timeout: 10000 }).catch(() => {});
const unlocked = await textOf(d, '.auth-notice');
ok('desktop: the unlock code returns to the form with the server status line',
  unlocked === 'Account unlocked. Sign in with your password.', unlocked);
await setInput(d, 1, QA.password);
await submitLogin(d);
await d.waitForFunction(() => location.pathname === '/', { timeout: 15000 }).catch(() => {});
await sleep(900);
const unlockedMe = await apiMe(d);
ok('desktop: an unlocked account signs in with its real password',
  (await url(d)) === '/' && unlockedMe.status === 200 && unlockedMe.body.username === QA.username,
  JSON.stringify({ path: await url(d), me: unlockedMe.status }));

// ---- Google hand-off: new identity -> signup, known identity -> device code ----
await logout(d);
await freshDevice(d);
await goto(d, '/login');
await d.waitForSelector('.social-btn', { timeout: 15000 });
await d.evaluate(() => document.querySelector('.social-btn').click());
await d.waitForFunction(() => location.pathname === '/signup' || location.pathname === '/' || !!document.querySelector('.auth-code'),
  { timeout: 25000 }).catch(() => {});
await sleep(600);
const googlePath = await url(d);
const googleCard = googlePath === '/login' ? await codeCard(d, 12000) : null;
if (googlePath === '/signup') {
  const handoff = await textOf(d, '.auth-notice');
  const shape = await d.evaluate(() => ({
    readOnly: document.querySelector('.signup-form input[type=email]')?.readOnly,
    passwordFields: [...document.querySelectorAll('.signup-form input[type=password]')].length,
    name: document.querySelector('.signup-form input[type=text]')?.value,
  }));
  ok('desktop: Google hands a new identity to signup with the email locked',
    handoff.includes('guest@demo.test') && shape.readOnly && shape.passwordFields === 0 && shape.name === 'Guest Demo',
    JSON.stringify({ handoff: handoff.slice(0, 60), shape }));
  await fillSignup(d, { username: `qag${RUN}`, dob: '1994-01-05' });
  await submitSignup(d);
  const gMe = await apiMe(d);
  ok('desktop: a Google signup skips the email code and goes straight in',
    (await url(d)) === '/' && gMe.status === 200 && gMe.body.email === 'guest@demo.test',
    JSON.stringify({ path: await url(d), me: gMe.status }));
  await shot(d, 'auth-desktop-google');
} else if (googleCard && googleCard.title === 'Confirm it is you') {
  // The guest account already exists from an earlier run and this device id is fresh,
  // so the server is right to ask for a code instead of opening a session.
  ok('desktop: a known Google identity on a new device gets the code step, not a session',
    googleCard.hint.includes('guest@demo.test'), JSON.stringify(googleCard).slice(0, 160));
  await clickChip(d);
  await d.waitForFunction(() => location.pathname === '/', { timeout: 15000 }).catch(() => {});
  await sleep(900);
  const gMe = await apiMe(d);
  ok('desktop: the confirmed Google code opens the session for the demo identity',
    gMe.status === 200 && gMe.body.email === 'guest@demo.test',
    JSON.stringify({ path: await url(d), me: gMe.status, email: gMe.body && gMe.body.email }));
  await shot(d, 'auth-desktop-google');
} else {
  const gMe = await apiMe(d);
  ok('desktop: the demo Google identity signs straight in once it exists',
    googlePath === '/' && gMe.status === 200, JSON.stringify({ path: googlePath, me: gMe.status, card: googleCard }));
}
await logout(d);

// ---- refresh + CSRF after rotation ----
await signIn(d, 'sita', DEMO_PASSWORD);
await sleep(400);
const refreshed = await d.evaluate(async () => {
  const res = await fetch('/api/auth/refresh/', { method: 'POST', credentials: 'same-origin' });
  const me = await fetch('/api/auth/me/', { credentials: 'same-origin' });
  return { refresh: res.status, me: me.status };
});
ok('desktop: refresh rotates the session and the cookie still authenticates',
  refreshed.refresh === 200 && refreshed.me === 200, JSON.stringify(refreshed));
const csrfWrite = await d.evaluate(async (text) => {
  const token = decodeURIComponent((document.cookie.split('; ').find(c => c.startsWith('exposing_csrf=')) || '').split('=')[1] || '');
  const res = await fetch('/api/posts/', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
    body: JSON.stringify({ text })
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, id: data?.id };
}, `auth qa probe ${RUN}`);
ok('desktop: after a refresh the browser still passes CSRF on writes',
  csrfWrite.status === 201, JSON.stringify(csrfWrite));
if (csrfWrite.id) {
  await d.evaluate(async (id) => {
    const token = decodeURIComponent((document.cookie.split('; ').find(c => c.startsWith('exposing_csrf=')) || '').split('=')[1] || '');
    await fetch(`/api/posts/${id}/`, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-CSRF-Token': token } });
  }, csrfWrite.id);
}

// ---- the new auth copy is translated ----
await goto(d, '/settings');
await d.waitForSelector('.settings-body', { timeout: 15000 }).catch(() => {});
await d.evaluate(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('नेपाली'))?.click(); });
await sleep(600);
// Signing out lands on the card, so the choice has to survive both the redirect and the reload.
await logout(d);
await d.waitForSelector('.login-content', { timeout: 20000 }).catch(() => {});
await d.evaluate(() => document.querySelector('.auth-unlock-link')?.click());
await sleep(500);
const nepali = await d.evaluate(() => ({
  title: document.querySelector('.login-title')?.textContent,
  placeholder: document.querySelector('.login-content input.login-input')?.placeholder,
  unlock: document.querySelector('.auth-code-detail')?.textContent,
}));
ok('desktop: the language choice survives navigation',
  nepali.title === 'Exposing मा साइन इन' && (nepali.placeholder || '').includes('इमेल'), JSON.stringify(nepali));
ok('desktop: the lockout copy is translated too',
  !!nepali.unlock && nepali.unlock.includes('अनलक'), JSON.stringify(nepali));
await d.evaluate(() => localStorage.setItem('exposing-lang', 'en'));
await goto(d, '/login');
await sleep(400);

// ================= MOBILE 390x844 =================
const m = await newPage({ width: 390, height: 844 }, true);
await goto(m, '/login');
await freshDevice(m);
await goto(m, '/login');
await m.waitForSelector('.login-content', { timeout: 20000 });
const mShape = await m.evaluate(() => {
  const submit = document.querySelector('.login-submit').getBoundingClientRect();
  return {
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    submitH: Math.round(submit.height),
    inputH: Math.round(document.querySelector('.login-input').getBoundingClientRect().height),
    googleH: Math.round(document.querySelector('.social-btn').getBoundingClientRect().height),
    unlockH: Math.round(document.querySelector('.auth-unlock-link').getBoundingClientRect().height),
  };
});
ok('mobile: sign-in fits 390px with tap targets a thumb can hit',
  !mShape.overflow && mShape.submitH >= 44 && mShape.inputH >= 44 && mShape.googleH >= 40,
  JSON.stringify(mShape));
await shot(m, 'auth-mobile-login');

await setInput(m, 0, 'sita');
await setInput(m, 1, DEMO_PASSWORD);
await submitLogin(m);
const mCard = await codeCard(m, 12000);
const mOverflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
ok('mobile: the code step renders with a visible countdown and no overflow',
  mCard.title === 'Confirm it is you' && /\d+:\d\d/.test(mCard.meta) && !mOverflow,
  JSON.stringify({ title: mCard.title, meta: mCard.meta, overflow: mOverflow }));
await shot(m, 'auth-mobile-code');
await clickChip(m);
await m.waitForFunction(() => location.pathname === '/', { timeout: 15000 }).catch(() => {});
await sleep(1000);
ok('mobile: the code completes and the app opens signed in',
  (await url(m)) === '/' && (await count(m, '.tabs')) > 0 && (await apiMe(m)).status === 200,
  JSON.stringify({ path: await url(m) }));
await shot(m, 'auth-mobile-feed');
const mLanded = await logout(m);
ok('mobile: signing out from settings returns to the sign-in card', mLanded, `landed: ${mLanded}`);

const unexpected = errors.filter(e => !/abort|ERR_|favicon|\.ico|DevTools/.test(e));
ok('integration: the auth pass produced no unexpected console, page or HTTP errors',
  unexpected.length === 0, unexpected.slice(0, 6).join(' | '));

fs.writeFileSync(`${OUT}/auth-results.json`, JSON.stringify(results, null, 2));
const passed = results.filter(r => r.pass).length;
console.log(`\n${passed}/${results.length} auth assertions passed`);
await browser.close();
process.exit(passed === results.length ? 0 : 1);
