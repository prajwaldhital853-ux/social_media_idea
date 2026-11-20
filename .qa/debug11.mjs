import puppeteer from 'puppeteer-core';
import zlib from 'node:zlib';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await browser.newPage();
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
await p.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
await sleep(1200);
await p.evaluate(() => { [...document.querySelectorAll('article.post')].find(a => a.textContent.includes('Golden hour'))?.scrollIntoView({ block: 'center' }); });
await sleep(400);
await p.evaluate(() => { [...document.querySelectorAll('article.post')].find(a => a.textContent.includes('Golden hour')).querySelector('.stack.n4 .mosaic-cell:nth-child(3) img').click(); });
await sleep(1500);
console.log(await p.evaluate(() => {
  const el = document.querySelector('.media-modal');
  const cs = getComputedStyle(el);
  return { opacity: cs.opacity, bg: cs.backgroundColor, anim: cs.animationName, rect: el.getBoundingClientRect().toJSON(), z: cs.zIndex, bodyOpacity: getComputedStyle(document.body).opacity };
}));
function pixel(buf, x, y) {
  // parse PNG chunks
  let off = 8, w = 0, h = 0, depth = 0, color = 0, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; color = data[9]; }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = color === 6 ? 4 : 3;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let row = 0; row < h; row++) {
    const f = raw[pos++];
    for (let i = 0; i < stride; i++) {
      const v = raw[pos + i];
      const a = i >= bpp ? out[row * stride + i - bpp] : 0;
      const b = row > 0 ? out[(row - 1) * stride + i] : 0;
      const c = (row > 0 && i >= bpp) ? out[(row - 1) * stride + i - bpp] : 0;
      let r;
      if (f === 0) r = v; else if (f === 1) r = v + a; else if (f === 2) r = v + b; else if (f === 3) r = v + ((a + b) >> 1);
      else { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      out[row * stride + i] = r & 255;
    }
    pos += stride;
  }
  const o = y * stride + x * bpp;
  return [out[o], out[o + 1], out[o + 2]];
}
const cdp = await p.createCDPSession();
const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 390, height: 300, scale: 1 } });
const buf = Buffer.from(data, 'base64');
console.log('pixel(195,150) scrim area:', pixel(buf, 195, 150), 'pixel(195,40):', pixel(buf, 195, 40));
await browser.close();
