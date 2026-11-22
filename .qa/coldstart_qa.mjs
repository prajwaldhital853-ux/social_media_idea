/**
 * Cold-start check: does a dead API end with a sentence, or with a spinner that
 * never finishes?
 *
 * Scenario B stops Django and leaves it stopped — the sign-in must fall over with
 * a readable error. Scenario A stops it, signs in anyway, and brings it back a few
 * seconds later, which is what a sleeping free instance actually does: the screen
 * should say it is waking the server and then finish the sign-in on its own.
 *
 * It stops and starts the API on its own, so run it alone, against the pair of
 * servers this checkout owns:
 *
 *   QA_BASE=http://127.0.0.1:3001 node coldstart_qa.mjs
 */
import puppeteer from 'puppeteer-core';
import { execSync, spawn } from 'node:child_process';

const BASE = process.env.QA_BASE || 'http://127.0.0.1:3001';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PY = process.env.QA_PY || 'D:/social_medial/backend/.venv/Scripts/python.exe';
const BACKEND = process.env.QA_BACKEND || 'D:/social_medial-wt/agent-b/backend';
const API_HOST = process.env.QA_API_HOST || '127.0.0.1:8002';
const MEDIA = process.env.QA_MEDIA || 'D:/social_medial/backend/media';
const DEMO = { email: 'sita@demo.test', password: 'exposing-demo-1' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

function apiPid() {
  try {
    const line = execSync('netstat -ano -p tcp', { encoding: 'utf8' })
      .split('\n').find(l => l.includes(API_HOST) && /LISTENING/.test(l));
    return line ? line.trim().split(/\s+/).pop() : '';
  } catch {
    return '';
  }
}

function stopApi() {
  const pid = apiPid();
  if (pid) execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
  return pid;
}

function startApi() {
  const child = spawn(PY, ['manage.py', 'runserver', API_HOST, '--noreload'], {
    cwd: BACKEND,
    detached: true,
    stdio: 'ignore',
    // The API this restarts serves the chat sockets too, so it has to keep
    // accepting the page's own origin — an env-less restart 403s every handshake
    // and the failure then shows up in a later suite as someone else's bug.
    env: {
      ...process.env,
      EXPOSING_OTP_VISIBLE: '1',
      MEDIA_DISK: MEDIA,
      DJANGO_WS_ORIGINS: process.env.DJANGO_WS_ORIGINS || [BASE, BASE.replace('127.0.0.1', 'localhost')].join(','),
    },
  });
  child.unref();
}

async function waitApi(healthy) {
  for (let i = 0; i < 60; i++) {
    const up = await fetch(`${BASE}/api/health/`).then(r => r.ok).catch(() => false);
    if (up === healthy) return true;
    await sleep(500);
  }
  return false;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--lang=en-US'],
});

const state = page => page.evaluate(() => ({
  path: location.pathname,
  notice: document.querySelector('.auth-notice')?.textContent.trim() || '',
  error: document.querySelector('.signup-error')?.textContent.trim() || '',
  button: document.querySelector('.login-submit')?.textContent.trim() || '',
}));

async function signInPage() {
  const page = await browser.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(1500);
  const fill = () => page.evaluate(({ email, password }) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const [mail, pass] = document.querySelectorAll('.login-content input.login-input');
    setter.call(mail, email);
    mail.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(pass, password);
    pass.dispatchEvent(new Event('input', { bubbles: true }));
  }, DEMO);
  // Values posted before React hydrates never reach its state, so keep re-posting
  // until the button is actually armed.
  for (let i = 0; i < 12; i++) {
    await fill();
    await sleep(350);
    if (await page.$('.login-submit.active')) break;
  }
  return page;
}

/** One sample a second, so a spinner that never ends is visible as what it is. */
async function watch(page, seconds) {
  const seen = [];
  for (let i = 0; i < seconds; i++) {
    seen.push({ t: i + 1, ...(await state(page)) });
    await sleep(1000);
  }
  return seen;
}

// ---------------------------------------------------------------- B: no server
stopApi();
await waitApi(false);
let page = await signInPage();
await page.click('.login-submit');
let trail = await watch(page, 70);
let s = await state(page);
const saidAloud = trail.some(x => x.notice.includes('sleeps between visits'));
const ended = !s.button.includes('Checking') && (!!s.error || s.path === '/');
ok('cold start: the screen says the server is asleep', saidAloud, trail.find(x => x.notice)?.notice);
ok('cold start: the wait ends with an error, not a spinner', ended, JSON.stringify(s));
ok('cold start: nobody is signed in', s.path !== '/', s.path);
await page.screenshot({ path: 'D:/social_medial-wt/agent-b/.qa/_coldstart-down.png' });
await page.close();

// ------------------------------------------------------- A: server wakes up
// Django takes a few seconds to boot, which is the whole point: sign in while it
// is still refusing connections and see whether the screen recovers by itself.
startApi();
page = await signInPage();
await page.click('.login-submit');
trail = await watch(page, 60);
s = await state(page);
ok('waking up: the retry finishes the sign-in on its own', s.path === '/', JSON.stringify(s));
ok('waking up: the message appeared while it waited', trail.some(x => x.notice.includes('sleeps between visits')));
const landedAt = trail.find(x => x.path === '/')?.t;
ok('waking up: it lands within the wait window', !!landedAt && landedAt <= 60, `landed at ~${landedAt}s`);
await page.screenshot({ path: 'D:/social_medial-wt/agent-b/.qa/_coldstart-awake.png' });

const client = await page.createCDPSession();
await client.send('Network.clearBrowserCookies');
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await sleep(1200);
ok('cleanup: the browser is signed out again', (await state(page)).path === '/login');
await page.close();
await browser.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} cold-start assertions passed`);
process.exit(failed.length ? 1 : 0);
