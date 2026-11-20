import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await browser.newPage();
await p.setViewport({ width: 1280, height: 900 });
p.on('console', m => { const t = m.text(); if (t.startsWith('HIST') || t.startsWith('POP')) console.log(t.slice(0, 140)); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hist = label => p.evaluate(l => { console.log('HIST ' + l + ' = ' + history.length); }, label);
await p.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
await sleep(1200);
await p.evaluate(() => {
  window.addEventListener('popstate', e => console.log('POP layer=' + (e.state?.exposingLayer ?? '-') + ' hist=' + history.length));
  for (const fn of ['pushState', 'replaceState', 'back', 'forward', 'go']) {
    const orig = history[fn].bind(history);
    history[fn] = (...a) => { console.log('HIST ' + fn + ' called, len=' + history.length + (fn === 'pushState' ? ' layer=' + (a[0]?.exposingLayer ?? '-') : '')); return orig(...a); };
  }
});
await hist('initial');
await p.evaluate(() => { [...document.querySelectorAll('article.post')].find(a => a.textContent.includes('Weekend in Pokhara')).querySelector('.post-video .video-play').click(); });
await sleep(800);
await hist('viewer open');
await p.evaluate(() => document.querySelector('.media-viewer-actions .media-comment-btn').click());
await sleep(600);
await hist('sheet open');
await p.type('.comments-overlay .comments-compose input', 'dbg');
await hist('typed');
await p.evaluate(() => document.querySelector('.comments-overlay button[type="submit"]').click());
await sleep(400);
await hist('submitted');
await p.keyboard.press('Escape');
await sleep(900);
await hist('after escape');
console.log('final:', await p.evaluate(() => ({ sheet: !!document.querySelector('.comments-overlay'), modal: !!document.querySelector('.media-modal'), url: location.href })));
await browser.close();
