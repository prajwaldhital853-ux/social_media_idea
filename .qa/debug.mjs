import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.post', { timeout: 30000 });
await new Promise(r => setTimeout(r, 1200));
const info = await page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1') || 'null');
  return {
    meId: db?.meId,
    p9: db?.posts.find(p => p.id === 'p9')?.status,
    articles: [...document.querySelectorAll('article.post')].map(a => a.textContent.slice(0, 40)),
    hasGolden: document.body.textContent.includes('Golden hour'),
    url: location.href
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();