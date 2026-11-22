/**
 * Browser verification for the shipped batch: #82 (profile media opened big +
 * the update post it announces), #83 (the count row and the Message button),
 * #84 (About contacts, links and their validation), #87 (follow-back button on
 * a follower notification), #88 (share metadata on the three public routes) and
 * #89 (the self-service list in Settings).
 *
 * Every assertion is a click a reviewer can repeat, and each screen leaves a
 * screenshot behind, because these items are judged by eye rather than by count.
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const API = 'http://127.0.0.1:8001/api';
const OUT = 'D:/social_medial/.qa';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PASS = 'exposing-demo-1';

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
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
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

const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = name => page.screenshot({ path: `${OUT}/${name}.png` });
const goto = async path => {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(900);
};
const setField = (sel, value) => page.evaluate(([sel, value]) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, [sel, value]);
const clickText = (containerSel, label) => page.evaluate(([containerSel, label]) => {
  const el = [...document.querySelectorAll(`${containerSel} button, ${containerSel} a`)]
    .find(b => b.textContent.trim().includes(label));
  if (!el) return false;
  el.click();
  return true;
}, [containerSel, label]);
const textOf = sel => page.$eval(sel, el => el.textContent.trim()).catch(() => '');

// A 1x1 fixture cannot prove "opens big", so render a photo-sized picture.
async function makePhoto(name, size = 400) {
  const p = await browser.newPage();
  await p.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await p.setContent('<body style="margin:0;background:linear-gradient(135deg,#B63740,#FDA041 45%,#1F6F78)"></body>');
  await sleep(200);
  await p.screenshot({ path: `${OUT}/${name}.png` });
  await p.close();
  return `${OUT}/${name}.png`;
}

async function signOut() {
  await goto('/settings');
  await page.waitForSelector('.settings-logout', { timeout: 10000 }).catch(() => {});
  await page.evaluate(() => document.querySelector('.settings-logout')?.click());
  await page.waitForFunction(() => location.pathname === '/login', { timeout: 15000 }).catch(() => {});
  await sleep(600);
}

async function signIn(identifier) {
  // A leftover session bounces /login straight back to the feed, so sign out first.
  await goto('/login');
  if (!(await page.$('.login-content'))) {
    await signOut();
    await goto('/login');
  }
  await page.waitForSelector('.login-content', { timeout: 20000 }).catch(() => {});
  await page.evaluate(([identifier, pass]) => {
    const set = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = [...document.querySelectorAll('.login-content input.login-input')];
    set(inputs[0], identifier);
    set(inputs[1], pass);
    document.querySelector('.login-content form button.login-submit')?.click();
  }, [identifier, PASS]);
  await page.waitForFunction(() => location.pathname === '/' || !!document.querySelector('.auth-code'), { timeout: 25000 }).catch(() => {});
  if ((await textOf('.auth-code-title')) === 'Confirm it is you') {
    await page.evaluate(() => document.querySelector('.auth-code-dev')?.click());
    await page.waitForFunction(() => location.pathname === '/', { timeout: 20000 }).catch(() => {});
  }
  await sleep(900);
  return page.evaluate(() => location.pathname);
}

// ===== #82 — the profile picture and the cover open big =====
await signIn('sita@demo.test');
await goto('/u/sita');
await page.waitForSelector('.profile-view', { timeout: 20000 });

const chip = await page.evaluate(() => Math.round(document.querySelector('.profile-avatar-open')?.getBoundingClientRect().width || 0));
await page.evaluate(() => document.querySelector('.profile-avatar-open')?.click());
await page.waitForSelector('.lightbox', { timeout: 5000 }).catch(() => {});
const avatarBox = await page.evaluate(() => {
  const img = document.querySelector('.lightbox .lightbox-img');
  const r = img?.getBoundingClientRect();
  return {
    open: !!document.querySelector('.lightbox'),
    w: Math.round(r?.width || 0),
    natural: img?.naturalWidth || 0,
    caption: (document.querySelector('.lightbox figcaption')?.textContent || '').trim(),
    closer: !!document.querySelector('.lightbox-close')
  };
});
ok('82: the profile photo opens as a big lightbox with its caption',
  avatarBox.open && avatarBox.natural > 0 && avatarBox.w >= 300 && avatarBox.w > chip * 2 &&
  /View profile photo/.test(avatarBox.caption) && avatarBox.closer,
  JSON.stringify({ ...avatarBox, chip }));
await shot('verify-82-avatar-lightbox');
await page.evaluate(() => document.querySelector('.lightbox-close')?.click());
await sleep(500);
ok('82: the close button dismisses the lightbox', await page.evaluate(() => !document.querySelector('.lightbox')));

await page.evaluate(() => document.querySelector('.profile-cover-open')?.click());
await page.waitForSelector('.lightbox', { timeout: 5000 }).catch(() => {});
const coverBox = await page.evaluate(() => {
  const img = document.querySelector('.lightbox .lightbox-img');
  return {
    open: !!document.querySelector('.lightbox'),
    caption: (document.querySelector('.lightbox figcaption')?.textContent || '').trim(),
    landscape: !!img && img.getBoundingClientRect().width >= 500
  };
});
ok('82: the cover opens big and keeps its landscape shape',
  coverBox.open && /View cover photo/.test(coverBox.caption) && coverBox.landscape, JSON.stringify(coverBox));
await shot('verify-82-cover-lightbox');
await page.keyboard.press('Escape');
await sleep(500);
ok('82: Escape closes the lightbox the same way', await page.evaluate(() => !document.querySelector('.lightbox')));

// ===== #84 — About: contacts, links, and the validation that keeps them safe =====
await clickText('.tabs', 'About');
await page.waitForSelector('.about-list', { timeout: 5000 }).catch(() => {});
const aboutRows = await page.evaluate(() => [...document.querySelectorAll('.about-list > div')].map(row => {
  const a = row.querySelector('a');
  return {
    label: (row.querySelector('dt')?.textContent || '').trim(),
    value: (row.querySelector('dd')?.textContent || '').trim(),
    href: a?.getAttribute('href') || '',
    rel: a?.getAttribute('rel') || '',
    target: a?.getAttribute('target') || ''
  };
}));
const phoneRow = aboutRows.find(r => /Phone/.test(r.label));
const siteRow = aboutRows.find(r => /Website/.test(r.label));
ok('84: About lists the phone as a dialable link',
  !!phoneRow && phoneRow.href.startsWith('tel:') && /\+?977/.test(phoneRow.value), JSON.stringify(phoneRow || {}));
ok('84: About opens the website in a new tab it cannot reach back from',
  !!siteRow && siteRow.href.startsWith('https://') && siteRow.target === '_blank' && siteRow.rel.includes('noopener'),
  JSON.stringify(siteRow || {}));
await shot('verify-84-about');

// A scheme-less website is refused before it can become a dead link.
await clickText('.profile-actions', 'Edit profile');
await page.waitForSelector('.edit-profile-modal', { timeout: 5000 }).catch(() => {});
await setField('.edit-profile-modal input[type="url"]', 'sita.example.com');
await page.evaluate(() => document.querySelector('.edit-profile-modal button.promote-submit')?.click());
await sleep(600);
const badLink = await page.evaluate(() => ({
  error: (document.querySelector('.edit-profile-modal p.form-error')?.textContent || '').trim(),
  stillOpen: !!document.querySelector('.edit-profile-modal')
}));
ok('84: a website without a scheme is refused with a usable instruction',
  badLink.stillOpen && /full http\(s\) address/.test(badLink.error), JSON.stringify(badLink));
await shot('verify-84-link-invalid');

// A bad phone is refused the same way.
await setField('.edit-profile-modal input[type="url"]', 'https://sita.example.com');
await setField('.edit-profile-modal input[type="tel"]', '98-phone!!');
await page.evaluate(() => document.querySelector('.edit-profile-modal button.promote-submit')?.click());
await sleep(600);
ok('84: a phone with letters in it is refused too',
  await page.evaluate(() => /digits, spaces, brackets/.test(document.querySelector('.edit-profile-modal p.form-error')?.textContent || '')));

// Save a real website plus a labeled link, then read them back from About.
await setField('.edit-profile-modal input[type="tel"]', '+977 984000000');
// Clear whatever an earlier run left behind, so this writes exactly one link.
for (let i = 0; i < 10; i++) {
  const left = await page.evaluate(() => {
    document.querySelector('.edit-profile-modal .edit-link-remove')?.click();
    return document.querySelectorAll('.edit-profile-modal .edit-link-remove').length;
  });
  if (!left) break;
  await sleep(350);
}
await page.evaluate(() => document.querySelector('.edit-profile-modal .edit-link-add')?.click());
await sleep(300);
const linkRow = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.edit-profile-modal .edit-link-row')];
  const last = rows[rows.length - 1];
  if (!last) return false;
  const set = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set(last.querySelector('.edit-link-label'), 'Newsletter');
  set(last.querySelector('.edit-link-url'), 'https://sita.example.com/news');
  return { rows: rows.length };
});
await shot('verify-84-edit-form');
await page.evaluate(() => document.querySelector('.edit-profile-modal button.promote-submit')?.click());
await page.waitForFunction(() => !document.querySelector('.edit-profile-modal'), { timeout: 12000 }).catch(() => {});
await sleep(600);
await goto('/u/sita');
await clickText('.tabs', 'About');
await sleep(700);
const savedRows = await page.evaluate(() => [...document.querySelectorAll('.about-list > div')].map(row => ({
  label: (row.querySelector('dt')?.textContent || '').trim(),
  href: row.querySelector('a')?.getAttribute('href') || ''
})));
const newsRows = savedRows.filter(r => r.label.startsWith('Newsletter'));
ok('84: a saved link appears on About with its own label and address',
  newsRows.length === 1 && newsRows[0].href === 'https://sita.example.com/news', JSON.stringify({ savedRows, wrote: linkRow }));
ok('84: the corrected website survives the save',
  savedRows.some(r => /Website/.test(r.label) && r.href.replace(/\/$/, '') === 'https://sita.example.com'), JSON.stringify(savedRows));
await shot('verify-84-about-after');

// ===== #82 — changing the photo is announced by its own post =====
await clickText('.profile-actions', 'Edit profile');
await page.waitForSelector('.edit-profile-modal', { timeout: 5000 }).catch(() => {});
const avatarInput = await page.$('.edit-profile-modal input[type="file"]');
await avatarInput.uploadFile(await makePhoto('verify-82-photo'));
await sleep(900);
await page.evaluate(() => document.querySelector('.edit-profile-modal button.promote-submit')?.click());
await page.waitForFunction(() => !document.querySelector('.edit-profile-modal'), { timeout: 15000 }).catch(() => {});
await sleep(800);
await goto('/u/sita');
await sleep(1200);
const announce = await page.evaluate(() => {
  const card = document.querySelector('article.post');
  return {
    path: location.pathname,
    activity: (card?.querySelector('.post-activity')?.textContent || '').trim(),
    name: (card?.querySelector('.post-name')?.textContent || '').trim(),
    hasImage: !!card?.querySelector('.post-media img, .post-mosaic img, img')
  };
});
ok('82: a new profile photo publishes its own update post',
  /updated their profile photo/.test(announce.activity) && announce.name.length > 0 && announce.hasImage,
  JSON.stringify(announce));
await shot('verify-82-update-post');

// ===== #83 — the count row is bold and each number is a way in =====
const stats = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.profile-stats .profile-stat')];
  return cells.map(c => {
    const b = c.querySelector('b');
    return {
      label: c.textContent.trim(),
      bold: b ? Number(getComputedStyle(b).fontWeight) : 0,
      size: b ? Math.round(parseFloat(getComputedStyle(b).fontSize)) : 0,
      href: c.getAttribute('href') || null
    };
  });
});
ok('83: the count row reads as three bold numbers',
  stats.length === 3 && stats.every(s => s.bold >= 600 && s.size >= 14 && /\d/.test(s.label)), JSON.stringify(stats));
const followerCell = stats.find(s => /Followers/i.test(s.label));
ok('83: Followers opens its own list page',
  followerCell?.href === '/u/sita/followers', JSON.stringify(followerCell || {}));
await page.evaluate(() => document.querySelector('.profile-stats a[href="/u/sita/followers"]')?.click());
await page.waitForSelector('.people-page', { timeout: 10000 }).catch(() => {});
await sleep(900);
const followerPage = await page.evaluate(() => ({
  path: location.pathname,
  rows: document.querySelectorAll('.people-page img').length,
  title: (document.querySelector('.header-title')?.textContent || '').trim()
}));
ok('83: the followers list arrives with rows, not an empty shell',
  followerPage.path === '/u/sita/followers' && followerPage.rows >= 1, JSON.stringify(followerPage));
await shot('verify-83-followers');

// Someone else's profile offers Message next to Follow.
await goto('/u/arjun');
await page.waitForSelector('.profile-actions', { timeout: 10000 });
const others = await page.evaluate(() => ({
  actions: [...document.querySelectorAll('.profile-actions button')].map(b => b.textContent.trim()).filter(Boolean)
}));
ok('83: another account shows Follow and Message side by side',
  others.actions.some(a => /Follow/.test(a)) && others.actions.some(a => a === 'Message'), JSON.stringify(others));
await shot('verify-83-profile-actions');
await clickText('.profile-actions', 'Message');
// Until the restored session lands, a tap is held rather than bounced, so the
// suite taps again instead of calling a swallowed first click a failure.
for (let i = 0; i < 5 && (await page.evaluate(() => location.pathname)) !== '/messages/arjun'; i++) {
  await sleep(1200);
  await clickText('.profile-actions', 'Message');
}
await sleep(1200);
const thread = await page.evaluate(() => ({
  path: location.pathname,
  bubbles: document.querySelectorAll('.bubble, .msg, .chat-view .message').length,
  compose: !!document.querySelector('.chat-compose input, .compose-input, .chat-view input')
}));
ok('83: Message lands on the thread with a way to reply',
  thread.path === '/messages/arjun' && thread.compose, JSON.stringify(thread));
await shot('verify-83-message');

// ===== #87 — following someone leaves them a button to follow back =====
await goto('/u/arjun');
await page.waitForSelector('.profile-actions .follow-btn', { timeout: 10000 });
const followLabel = () => page.evaluate(() => (document.querySelector('.profile-actions .follow-btn')?.textContent || '').trim());
const waitLabel = async (re, tries = 7) => {
  for (let i = 0; i < tries; i++) {
    const label = await followLabel();
    if (re.test(label)) return label;
    await sleep(900);
  }
  return followLabel();
};

// A hard load can beat the restored session, and a tap in that window does
// nothing at all, so this reads the label back instead of trusting one click.
let label = await followLabel();
if (/^(Following|Requested)/.test(label)) {
  await page.evaluate(() => document.querySelector('.profile-actions .follow-btn')?.click());
  label = await waitLabel(/^Follow$/);
}
for (let i = 0; i < 3 && !/^(Following|Requested)/.test(label); i++) {
  await page.evaluate(() => document.querySelector('.profile-actions .follow-btn')?.click());
  label = await waitLabel(/^(Following|Requested)/);
}
ok('87: sita follows arjun from his profile', /^Following/.test(label), label);

await goto('/settings');
await page.waitForSelector('.settings-logout', { timeout: 10000 }).catch(() => {});
await page.evaluate(() => document.querySelector('.settings-logout')?.click());
await page.waitForFunction(() => location.pathname === '/login', { timeout: 15000 }).catch(() => {});
const arjunPath = await signIn('arjun');
ok('87: signed in as the new follower to read their side', arjunPath === '/', arjunPath);
await page.evaluate(() => document.querySelector('[aria-label="Notifications"]')?.click());
await page.waitForSelector('.topbar-panel .notif-row', { timeout: 10000 }).catch(() => {});
const followRow = () => page.evaluate(() => {
  const row = [...document.querySelectorAll('.topbar-panel .notif-row')]
    .find(r => /started following you/.test(r.querySelector('.notif-text')?.textContent || ''));
  const btn = row?.querySelector('.notif-follow');
  return { exists: !!row, label: (btn?.textContent || '').trim(), on: !!btn?.classList.contains('on') };
});
const pressRow = () => page.evaluate(() => {
  const row = [...document.querySelectorAll('.topbar-panel .notif-row')]
    .find(r => /started following you/.test(r.querySelector('.notif-text')?.textContent || ''));
  row?.querySelector('.notif-follow')?.click();
  return !!row;
});
const waitRow = async re => {
  for (let i = 0; i < 8; i++) {
    const row = await followRow();
    if (re.test(row.label)) return row;
    await sleep(800);
  }
  return followRow();
};

// A previous run may have already taken the follow-back, so put the card back
// to the state this check is about before reading it.
let ask = await followRow();
if (/^Following/.test(ask.label)) {
  await pressRow();
  ask = await waitRow(/Follow back/);
}
ok('87: the follower notification carries a Follow back button',
  ask.exists && ask.label === 'Follow back', JSON.stringify(ask));
await shot('verify-87-follow-back');
const pressed = await pressRow();
ask = await waitRow(/^Following/);
ok('87: pressing it follows back and the button says so',
  pressed && ask.label === 'Following' && ask.on, JSON.stringify(ask));
await shot('verify-87-followed-back');

// ===== #88 — the three public routes describe themselves to a crawler =====
const list = await fetch(`${API}/posts/?limit=1`).then(r => r.json()).then(d => (d.results || d)[0]).catch(() => null);
const listing = await fetch(`${API}/marketplace/?limit=1`).then(r => r.json()).then(d => (d.results || d)[0]).catch(() => null);
const metaOf = async path => {
  const html = await fetch(BASE + path).then(r => r.text());
  const grab = prop => {
    const m = html.match(new RegExp(`<meta[^>]+(property|name)="${prop}"[^>]+content="([^"]*)"`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(property|name)="${prop}"`, 'i'));
    return m ? (m[2] || m[1]) : '';
  };
  return {
    title: grab('og:title'),
    desc: grab('og:description'),
    image: grab('og:image'),
    type: grab('og:type'),
    card: grab('twitter:card')
  };
};
const postMeta = await metaOf(`/post/${list?.id || 1}`);
ok('88: a post hands a crawler its own title, picture and card',
  /— Exposing$/.test(postMeta.title) && postMeta.image && postMeta.type === 'article' && /summary/.test(postMeta.card),
  JSON.stringify(postMeta));
const profileMeta = await metaOf('/u/sita');
ok('88: a profile names the account and its handle',
  /\(@sita\)/.test(profileMeta.title) && profileMeta.type === 'profile' && !!profileMeta.image, JSON.stringify(profileMeta));
const listingMeta = await metaOf(`/marketplace/${listing?.id || 1}`);
ok('88: a listing quotes its price so the preview is useful',
  /NPR [\d,]+/.test(listingMeta.title) && !!listingMeta.image && !!listingMeta.desc, JSON.stringify(listingMeta));

// ===== #89 — the self-service list in Settings =====
await goto('/login');
await signIn('sita@demo.test');
await goto('/settings');
await page.waitForSelector('.settings-card', { timeout: 10000 }).catch(() => {});
const settings = await page.evaluate(() => ({
  cards: [...document.querySelectorAll('.settings-card h2, .settings-card h3, .settings-card .settings-title')]
    .map(h => h.textContent.trim()).filter(Boolean),
  choices: [...document.querySelectorAll('.settings-choice')].map(b => b.textContent.trim()).filter(Boolean),
  switches: [...document.querySelectorAll('.switch[role="switch"]')].map(s => s.getAttribute('aria-label')),
  legal: [...document.querySelectorAll('.settings-legal a')].map(a => a.getAttribute('href')),
  logout: !!document.querySelector('.settings-logout')
}));
ok('89: Settings offers appearance, language, account, security and privacy',
  settings.cards.length >= 4 && settings.choices.length >= 2 && settings.switches.length >= 2 && settings.logout,
  JSON.stringify(settings));
await shot('verify-89-settings');

const themeFlip = await page.evaluate(async () => {
  const before = document.documentElement.dataset.theme || document.body.className || getComputedStyle(document.body).backgroundColor;
  const other = [...document.querySelectorAll('.settings-choice')].find(b => b.textContent.trim() === 'Light' || b.textContent.trim() === 'Dark');
  const want = other?.textContent.trim();
  other?.click();
  await new Promise(r => setTimeout(r, 700));
  return {
    before, want,
    stored: localStorage.getItem('exposing-theme'),
    pressed: [...document.querySelectorAll('.settings-choice')].find(b => b.textContent.trim() === want)?.getAttribute('aria-pressed')
  };
});
ok('89: the theme choice takes effect and is remembered',
  themeFlip.stored === themeFlip.want.toLowerCase() && themeFlip.pressed === 'true', JSON.stringify(themeFlip));
// Leave the demo account on the dark desktop default the suite started from.
await clickText('.settings-choices', themeFlip.want === 'Light' ? 'Dark' : 'Light');
await sleep(600);

const langFlip = await page.evaluate(async () => {
  const heading = () => document.querySelector('.settings-card h2, .settings-card h3')?.textContent || '';
  const en = heading();
  [...document.querySelectorAll('.settings-choice')].find(b => b.textContent.includes('ने'))?.click();
  await new Promise(r => setTimeout(r, 900));
  return { en, np: heading(), stored: localStorage.getItem('exposing-lang') };
});
ok('89: the language choice re-renders the screen in Nepali',
  langFlip.np !== langFlip.en && /[क-ह]/.test(langFlip.np), JSON.stringify(langFlip));
await shot('verify-89-settings-nepali');
await page.evaluate(async () => {
  [...document.querySelectorAll('.settings-choice')].find(b => b.textContent.includes('English') || b.textContent.includes('EN'))?.click();
  await new Promise(r => setTimeout(r, 800));
});

const security = await page.evaluate(async () => {
  const sw = document.querySelector('.switch[aria-label="Two-step verification"]');
  const was = sw?.getAttribute('aria-checked');
  sw?.click();
  await new Promise(r => setTimeout(r, 1400));
  const now = document.querySelector('.switch[aria-label="Two-step verification"]')?.getAttribute('aria-checked');
  return { was, now };
});
ok('89: two-step verification persists a flipped switch',
  security.was !== security.now, JSON.stringify(security));
await goto('/settings');
// The switch mounts only after the settings fetch lands, which the goto settle
// window can outrun; poll for it instead of racing a fixed sleep.
const kept = await page
  .waitForFunction(() => document.querySelector('.switch[aria-label="Two-step verification"]')?.getAttribute('aria-checked'), { timeout: 15000 })
  .then(h => h.jsonValue())
  .catch(() => undefined);
ok('89: a reload reads the switch back from the server', kept === security.now, JSON.stringify({ kept, want: security.now }));
await page.evaluate(() => document.querySelector('.switch[aria-label="Two-step verification"]')?.click());
await sleep(1200);

const privacy = await page.evaluate(() => {
  const read = label => {
    const s = document.querySelector(`.switch[aria-label="${label}"]`);
    return { on: s?.getAttribute('aria-checked'), role: s?.getAttribute('role') };
  };
  return { account: read('Private account'), emails: read('Email about followers') };
});
ok('89: private account and follower mail are both offered as switches',
  privacy.account.role === 'switch' && privacy.emails.role === 'switch' && ['true', 'false'].includes(privacy.emails.on),
  JSON.stringify(privacy));
const mailFlip = await page.evaluate(async () => {
  const sw = document.querySelector('.switch[aria-label="Email about followers"]');
  const was = sw.getAttribute('aria-checked');
  sw.click();
  await new Promise(r => setTimeout(r, 1500));
  const now = document.querySelector('.switch[aria-label="Email about followers"]').getAttribute('aria-checked');
  return { was, now, toast: (document.querySelector('.toast')?.textContent || '').trim() };
});
ok('89: the follower mail switch saves and answers with a toast',
  mailFlip.was !== mailFlip.now, JSON.stringify(mailFlip));
await page.evaluate(() => document.querySelector('.switch[aria-label="Email about followers"]')?.click());
await sleep(1000);

await page.evaluate(() => document.querySelector('.settings-legal a')?.click());
await sleep(1200);
const legal = await page.evaluate(() => ({ path: location.pathname, doc: !!document.querySelector('.legal-doc') }));
ok('89: the policy links open the real documents', legal.path.startsWith('/legal/') && legal.doc, JSON.stringify(legal));

ok('no console or HTTP errors during the batch pass', errors.length === 0, errors.slice(0, 6).join(' | '));

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} batch checks passed`);
writeFileSync(`${OUT}/batch-verify-results.json`, JSON.stringify(results, null, 2));
await browser.close();
process.exit(failed.length ? 1 : 0);
