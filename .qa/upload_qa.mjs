/**
 * Upload + publish + profile-media QA against the live Django backend.
 *
 * These checks follow a real file from the picker to the disk behind /media/ and
 * back to a rendered pixel, because the interesting failure modes are invisible
 * otherwise: a blob: or data: URL silently dropped from the post payload, a
 * progress ring that moves on a timer instead of on bytes, or a profile patch the
 * server refuses while the screen still says "Profile updated".
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync, rmSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const OUT = 'D:/social_medial/.qa';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DEMO = { username: 'sita', email: 'sita@demo.test', password: 'exposing-demo-1' };
const PHOTO = `${OUT}/test.png`;
const CLIP = `${OUT}/clip.mp4`;
const BAD = `${OUT}/notes.txt`;

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

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
    if (/\/api\/(auth|sync|notifications\/unread)\//.test(where)) return;
    errors.push(`console: ${m.text().slice(0, 200)}${where ? ' @ ' + where.slice(0, 140) : ''}`);
  });
  page.on('response', r => {
    if (r.status() < 400) return;
    const u = r.url();
    if (/\/api\/auth\//.test(u)) return;
    if (/\/api\/sync\//.test(u) && (r.status() === 401 || r.status() === 403)) return;
    errors.push(`http ${r.status()}: ${u.slice(0, 160)}`);
  });
  return page;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const textOf = (page, sel) => page.$eval(sel, el => el.textContent.trim()).catch(() => '');
const count = (page, sel) => page.$$eval(sel, els => els.length).catch(() => 0);

async function goto(page, path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(700);
}

async function waitFor(page, sel, timeout = 20000) {
  await page.waitForSelector(sel, { timeout }).catch(() => {});
  return count(page, sel);
}

const api = (page, path, init = {}) => page.evaluate(async ([path, init]) => {
  const headers = { ...(init.headers || {}) };
  if (init.method && init.method !== 'GET') {
    const pair = document.cookie.split('; ').find(c => c.startsWith('exposing_csrf='));
    headers['X-CSRF-Token'] = pair ? decodeURIComponent(pair.split('=')[1]) : '';
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, body };
}, [path, init]);

const setNative = (page, sel, value) => page.evaluate(([sel, value]) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
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

async function signIn(page, identifier, password) {
  await goto(page, '/login');
  await page.waitForSelector('.login-content', { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => localStorage.setItem('exposing-device', `qa-${Math.random().toString(36).slice(2, 12)}`));
  await setInput(page, 0, identifier);
  await setInput(page, 1, password);
  await page.evaluate(() => document.querySelector('.login-content form button.login-submit')?.click());
  await page.waitForFunction(() => location.pathname === '/' || !!document.querySelector('.auth-code'), { timeout: 25000 }).catch(() => {});
  if ((await textOf(page, '.auth-code-title')) === 'Confirm it is you') {
    await page.evaluate(() => document.querySelector('.auth-code-dev')?.click());
    await page.waitForFunction(() => location.pathname === '/', { timeout: 20000 }).catch(() => {});
  }
  await sleep(900);
  return page.evaluate(() => location.pathname);
}

/** Watches the media strip so a bar that only exists for 200ms is still counted. */
const watchUploads = page => page.evaluate(() => {
  const seen = { strips: 0, names: [], maxPct: 0, present: false };
  window.__uploads = seen;
  const report = () => {
    const strip = document.querySelector('.create-upload');
    if (strip && !seen.present) {
      seen.present = true;
      seen.strips++;
    }
    if (!strip) { seen.present = false; return; }
    const pct = parseInt(strip.querySelector('.create-upload-pct')?.textContent || '0', 10);
    if (Number.isFinite(pct)) seen.maxPct = Math.max(seen.maxPct, pct);
    const name = strip.querySelector('.create-upload-name')?.textContent || '';
    if (name && !seen.names.includes(name)) seen.names.push(name);
  };
  new MutationObserver(report).observe(document.body, { childList: true, subtree: true, characterData: true });
  report();
});

const uploads = page => page.evaluate(() => window.__uploads || { strips: 0, names: [], maxPct: 0 });

/** Slows uploads only, so a progress bar can be watched while the bytes are still in flight. */
const throttleUploads = async (page, bytesPerSecond) => {
  const cdp = await page.createCDPSession();
  const set = uploadThroughput => cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput,
  });
  await set(bytesPerSecond);
  return { async restore() { await set(-1); await cdp.detach(); } };
};

const pctNow = async page => parseInt(await textOf(page, '.create-upload-pct'), 10) || 0;

/** Resolves with the first matching request/response pair after it is armed. */
const capture = (page, method, needle, timeout = 60000) => new Promise(resolve => {
  const finish = value => {
    if (settled) return;
    settled = true;
    page.off('response', handler);
    clearTimeout(timer);
    resolve(value);
  };
  let settled = false;
  const handler = async res => {
    const req = res.request();
    if (req.method() !== method || !res.url().includes(needle)) return;
    let body = null;
    try { body = await res.json(); } catch {}
    let payload = null;
    try { payload = JSON.parse(req.postData() || 'null'); } catch {}
    finish({ status: res.status(), body, payload });
  };
  const timer = setTimeout(() => finish({ status: 0, body: null, payload: null, timedOut: true }), timeout);
  page.on('response', handler);
});

const attach = async (page, file, sel = 'input[type=file]') => {
  const input = await page.$(sel);
  if (!input) return false;
  await input.uploadFile(file);
  return true;
};
const mediaSrcs = page => page.$$eval('.create-media-item img, .create-media-item video', els => els.map(el => el.getAttribute('src') || ''));

writeFileSync(BAD, 'not a photo at all\n');

const d = await newPage({ width: 1440, height: 900 });
await signIn(d, DEMO.email, DEMO.password);

// ── photo: picker → /api/uploads/ → preview → POST /api/posts/ ───────────────
const marker = `upload-qa-${Date.now().toString(36)}`;
const postCapture = capture(d, 'POST', '/api/posts/');
await goto(d, '/create');
await waitFor(d, 'textarea.create-post-textarea');
await watchUploads(d);
await setNative(d, 'textarea.create-post-textarea', `Photo posted from the upload QA run. ${marker}`);
await attach(d, PHOTO);
await d.waitForFunction(() => document.querySelectorAll('.create-media-item').length > 0, { timeout: 30000 }).catch(() => {});
const photoSrcs = await mediaSrcs(d);
ok('a picked photo is stored on the server, not in the page',
  photoSrcs.some(s => s.includes('/media/uploads/')) && !photoSrcs.some(s => /^(blob:|data:)/.test(s)),
  photoSrcs.join(' '));
const photoWatch = await uploads(d);
ok('the create page reports the photo upload by name', photoWatch.names.includes('test.png'), JSON.stringify(photoWatch));
await shot(d, 'upg-desktop-attach-photo');
await d.evaluate(() => document.querySelector('.create-publish')?.click());
await d.waitForSelector('.chooser-card', { timeout: 10000 }).catch(() => {});
await d.evaluate(() => document.querySelectorAll('.chooser-card .chooser-options button')[0]?.click());

const posted = await postCapture;
ok('publishing posts the upload to /api/posts/ and the API accepts it',
  posted.status === 201 && !!posted.body?.media?.length, `status ${posted.status}`);
ok('the payload carries an absolute stored URL for the attachment',
  /^https?:\/\/.+\/media\/uploads\//.test(posted.payload?.media?.[0]?.url || ''), posted.payload?.media?.[0]?.url || 'none');
const storedUrl = posted.body?.media?.[0]?.url || '';
const served = await d.evaluate(async u => {
  const res = await fetch(u);
  return { status: res.status, type: res.headers.get('content-type') || '' };
}, storedUrl);
ok('the stored file is served back from /media/', served.status === 200 && /^image\//.test(served.type), JSON.stringify(served));

await d.waitForFunction(() => location.pathname === '/', { timeout: 25000 }).catch(() => {});
await sleep(1200);
const inFeed = await d.evaluate(m => {
  const img = [...document.querySelectorAll('.post img')].find(i => (i.getAttribute('src') || '').includes('/media/uploads/'));
  return !!img && img.complete && img.naturalWidth > 0 && !!document.body.textContent.includes(m);
}, marker);
ok('the feed renders the uploaded photo', inFeed);
await shot(d, 'upg-desktop-feed-photo');

// ── video: byte progress, then a reel that streams from storage ──────────────
await goto(d, '/create');
await waitFor(d, 'textarea.create-post-textarea');
await watchUploads(d);
const reelCapture = capture(d, 'POST', '/api/posts/');
await setNative(d, 'textarea.create-post-textarea', `Reel from the upload QA run. ${marker}`);
const throttle = await throttleUploads(d, 300 * 1024);
await attach(d, CLIP);
const liveBar = await d.waitForSelector('.create-upload', { timeout: 20000 }).catch(() => null);
const firstPct = await pctNow(d);
await sleep(1200);
const secondPct = await pctNow(d);
await shot(d, 'upg-desktop-upload-progress');
ok('the bar is on screen and climbing while the bytes are still moving',
  !!liveBar && secondPct > firstPct && secondPct < 100, `${firstPct}% → ${secondPct}%`);
await throttle.restore();
await d.waitForFunction(() => document.querySelectorAll('.create-media-item').length > 0, { timeout: 60000 }).catch(() => {});
const clipSrcs = await mediaSrcs(d);
const clipWatch = await uploads(d);
ok('a clip of a megabyte moves the bar with the bytes actually sent',
  clipWatch.names.includes('clip.mp4') && clipWatch.maxPct > 0, JSON.stringify(clipWatch));
ok('the clip preview plays the stored file', clipSrcs.some(s => s.includes('/media/uploads/')), clipSrcs.join(' '));
await shot(d, 'upg-desktop-attach-clip');

await d.evaluate(() => document.querySelector('.create-publish')?.click());
await d.waitForSelector('.chooser-card', { timeout: 10000 }).catch(() => {});
const reelEnabled = await d.$$eval('.chooser-card .chooser-options button', els => els.length > 1 && !els[1].disabled);
ok('an uploaded clip unlocks publishing as a reel', reelEnabled);
await d.evaluate(() => document.querySelectorAll('.chooser-card .chooser-options button')[1]?.click());
const reel = await reelCapture;
ok('the reel is created with a video attachment',
  reel.status === 201 && reel.body?.media?.some(m => m.kind === 'video'), `status ${reel.status}`);
ok('the reel payload carries the stored clip URL',
  /^https?:\/\/.+\/media\/uploads\//.test(reel.payload?.media?.[0]?.url || ''), reel.payload?.media?.[0]?.url || 'none');
await d.waitForFunction(() => location.pathname === '/', { timeout: 25000 }).catch(() => {});
await goto(d, '/video');
await d.waitForSelector('.reels-page', { timeout: 15000 }).catch(() => {});
await sleep(1500);
const clipFile = ((reel.body?.media || []).find(x => x.kind === 'video')?.url || '').split('/').pop();
const reelStreams = await d.evaluate(f => !!f && [...document.querySelectorAll('.reel-slide video')]
  .some(v => (v.getAttribute('src') || v.currentSrc || '').includes(f)), clipFile);
ok('the video tab streams the uploaded clip', reelStreams, clipFile);
await shot(d, 'upg-desktop-reel-uploaded');

// ── validation: a non-media file never reaches the server ───────────────────
await goto(d, '/create');
await waitFor(d, 'textarea.create-post-textarea');
await attach(d, BAD);
const rejected = await textOf(d, '.create-feedback.error');
ok('a file that is not a photo or video is refused with real copy',
  /jpeg|png|webp|video/i.test(rejected) && (await count(d, '.create-media-item')) === 0, rejected);

// ── profile: avatar upload + patch, then a reload that has to agree ──────────
const bioMarker = `bio via upload qa ${Date.now().toString(36)}`;
await goto(d, '/u/sita');
// The own-profile chrome only exists once the session has restored.
await d.waitForFunction(() => [...document.querySelectorAll('.profile-actions button')]
  .some(b => b.textContent.includes('Edit')), { timeout: 20000 }).catch(() => {});
await d.evaluate(() => [...document.querySelectorAll('.profile-actions button')]
  .find(b => b.textContent.includes('Edit'))?.click());
await d.waitForSelector('.edit-profile-modal', { timeout: 10000 }).catch(() => {});
const patchCapture = capture(d, 'PATCH', '/api/profiles/');
const avatarUpload = capture(d, 'POST', '/api/uploads/');
await attach(d, PHOTO, '.edit-profile-modal input[type=file]');
const uploadedAvatar = await avatarUpload;
const avatarFile = (uploadedAvatar.body?.url || '').split('/').pop();
// A previous run leaves an /media/uploads/ picture in the local cache, so the
// preview has to be compared against the URL this upload actually returned.
await d.waitForFunction(f => (document.querySelector('.edit-avatar-row img')?.getAttribute('src') || '').includes(f),
  { timeout: 30000 }, avatarFile).catch(() => {});
const avatarPreview = await d.$eval('.edit-avatar-row img', el => el.getAttribute('src') || '').catch(() => '');
ok('the avatar preview comes from the stored file', avatarPreview.includes(avatarFile), avatarPreview);
await setNative(d, '.edit-profile-modal textarea', bioMarker);
await d.evaluate(() => {
  const clear = label => {
    const el = document.querySelector(`.edit-profile-modal .dp [aria-label="${label}"]`);
    if (!el) return;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  ['Day', 'Month', 'Year'].forEach(clear);
});
// Save stays disabled until the upload settles; clicking it early is a silent no-op.
await d.waitForFunction(() => {
  const button = document.querySelector('.edit-profile-modal button[type=submit]');
  return !!button && !button.disabled;
}, { timeout: 30000 }).catch(() => {});
await d.evaluate(() => document.querySelector('.edit-profile-modal button[type=submit]')?.click());
const patched = await patchCapture;
ok('the profile patch is accepted, empty birthday and all',
  patched.status === 200, `status ${patched.status} ${JSON.stringify(patched.body || patched.payload || {})}`);
ok('the server keeps the uploaded avatar URL',
  (patched.body?.avatar_url || '').includes('/media/uploads/'), patched.body?.avatar_url || 'none');
await sleep(600);
const stillFailed = await textOf(d, '.edit-profile-modal .form-error');
const sheetOpen = await count(d, '.edit-profile-modal');
ok('a saved profile closes the sheet without an error',
  !stillFailed && sheetOpen === 0, stillFailed || (sheetOpen ? 'the sheet is still open' : ''));

await goto(d, '/u/sita');
await d.waitForSelector('.profile-avatar', { timeout: 20000 }).catch(() => {});
const after = await d.evaluate(m => {
  const img = document.querySelector('.profile-avatar img');
  const bio = document.querySelector('.profile-bio')?.textContent || document.body.textContent;
  return {
    src: img ? img.getAttribute('src') || '' : '',
    painted: !!img && img.complete && img.naturalWidth > 0,
    bio: bio.includes(m),
  };
}, bioMarker);
ok('the uploaded avatar survives a reload', after.src.includes(avatarFile) && after.painted, after.src);
ok('the edited bio survives a reload', after.bio);
await shot(d, 'upg-desktop-profile-uploaded');

const profile = await api(d, '/api/profiles/sita/');
ok('the profile row on the server holds the uploaded URL',
  (profile.body?.avatar_url || '').includes('/media/uploads/') && profile.body?.bio === bioMarker,
  `${profile.body?.avatar_url} / ${profile.body?.bio}`);

// ── phone: the same upload path on a small screen ────────────────────────────
const m = await newPage({ width: 390, height: 844 }, true);
await signIn(m, DEMO.email, DEMO.password);
const mobileCapture = capture(m, 'POST', '/api/posts/');
await goto(m, '/create');
await waitFor(m, 'textarea.create-post-textarea');
await watchUploads(m);
await setNative(m, 'textarea.create-post-textarea', `Phone photo from upload QA. ${marker}`);
await attach(m, PHOTO);
await m.waitForFunction(() => document.querySelectorAll('.create-media-item').length > 0, { timeout: 30000 }).catch(() => {});
ok('mobile: a picked photo uploads from a phone',
  (await mediaSrcs(m)).some(s => s.includes('/media/uploads/')), JSON.stringify(await uploads(m)));
await shot(m, 'upg-mobile-attach-photo');
await m.evaluate(() => document.querySelector('.create-publish')?.click());
await m.waitForSelector('.chooser-card', { timeout: 10000 }).catch(() => {});
await m.evaluate(() => document.querySelectorAll('.chooser-card .chooser-options button')[0]?.click());
const mobilePost = await mobileCapture;
ok('mobile: the phone post is accepted with its attachment',
  mobilePost.status === 201 && !!mobilePost.body?.media?.length, `status ${mobilePost.status}`);
await m.waitForFunction(() => location.pathname === '/', { timeout: 25000 }).catch(() => {});
await sleep(1000);
ok('mobile: the phone sees its own uploaded photo in the feed',
  await m.evaluate(() => [...document.querySelectorAll('.post img')]
    .some(i => (i.getAttribute('src') || '').includes('/media/uploads/') && i.complete && i.naturalWidth > 0)));
await shot(m, 'upg-mobile-feed-photo');

await browser.close();
rmSync(BAD, { force: true });

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} upload checks green.`);
if (errors.length) console.log('console/network noise:\n' + [...new Set(errors)].slice(0, 25).join('\n'));
writeFileSync(`${OUT}/upload-results.json`, JSON.stringify({ results, errors: [...new Set(errors)] }, null, 2));
process.exit(failed.length ? 1 : 0);
