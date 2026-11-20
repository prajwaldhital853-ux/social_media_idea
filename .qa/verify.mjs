import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const inject = () => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  db.posts.unshift({ id: 'qa_tag', uid: 'u1', kind: 'post', text: 'Tagged single-photo post to verify chips and mosaic fill.', media: [{ type: 'image', src: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1200&q=80' }], ts: Date.now(), status: 'live', mood: 'happy', place: 'Pokhara' });
  localStorage.setItem('exposing-demo-v1', JSON.stringify(db));
};
const probe = () => {
  const a = [...document.querySelectorAll('article.post')].find(x => x.textContent.includes('Tagged single-photo'));
  const mo = a.querySelector('.media-mosaic');
  const img = mo.querySelector('img');
  const tags = [...a.querySelectorAll('.post-tag')];
  const r0 = tags[0]?.getBoundingClientRect(), r1 = tags[1]?.getBoundingClientRect();
  return {
    mosaicH: mo.clientHeight, imgH: img.clientHeight, fill: Math.abs(mo.clientHeight - img.clientHeight) <= 2,
    tagCount: tags.length, gap: r0 && r1 ? Math.round(r1.left - r0.right) : null,
    pill: tags[0] ? getComputedStyle(tags[0]).borderRadius : null, display: getComputedStyle(a.querySelector('.post-tags')).display
  };
};
const m = await browser.newPage();
await m.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await m.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
await m.waitForSelector('.post');
await m.evaluate(inject);
await m.reload({ waitUntil: 'domcontentloaded' });
await m.waitForSelector('.post');
await sleep(1500);
console.log('MOBILE', JSON.stringify(await m.evaluate(probe)));
await m.screenshot({ path: 'D:/social_medial/.qa/fix-mobile-feed.png' });
const d = await browser.newPage();
await d.setViewport({ width: 1280, height: 900 });
await d.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
await d.waitForSelector('.post');
await sleep(1500);
console.log('DESKTOP', JSON.stringify(await d.evaluate(probe)));
await d.screenshot({ path: 'D:/social_medial/.qa/fix-desktop-feed.png' });
await browser.close();