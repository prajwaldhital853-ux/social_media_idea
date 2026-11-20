import fs from 'node:fs';
import zlib from 'node:zlib';

const buf = fs.readFileSync('D:/NepTech_Social_Platform_Development_Agreement_v6 (2) (4).pdf');
const streams = [];
let i = 0;
while ((i = buf.indexOf('stream', i)) >= 0) {
  const prev = buf.slice(Math.max(0, i - 10), i).toString('latin1');
  if (prev.includes('end')) { i += 6; continue; }
  let s = i + 6;
  if (buf[s] === 13) s++;
  if (buf[s] === 10) s++;
  const e = buf.indexOf('endstream', s);
  if (e < 0) break;
  try { streams.push(zlib.inflateSync(buf.slice(s, e)).toString('latin1')); } catch {}
  i = e + 9;
}
const map = {};
for (const s of streams) {
  for (const sec of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of sec[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map[parseInt(m[1], 16)] = String.fromCodePoint(parseInt(m[2], 16));
    }
  }
  for (const sec of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of sec[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const a = parseInt(m[1], 16), b = parseInt(m[2], 16), c = parseInt(m[3], 16);
      for (let k = a; k <= b && k - a < 512; k++) map[k] = String.fromCodePoint(c + (k - a));
    }
  }
}
const decode = h => [...h.matchAll(/([0-9A-Fa-f]{4})/g)].map(x => map[parseInt(x[1], 16)] ?? '').join('');
const out = [];
for (const s of streams) {
  if (!s.includes('TJ') && !s.includes('Tj')) continue;
  for (const m of s.matchAll(/\[([^\]]*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
    if (m[1] !== undefined) {
      const hexes = [...m[1].matchAll(/<([0-9A-Fa-f]+)>/g)].map(x => decode(x[1]));
      const lits = [...m[1].matchAll(/\((?:[^()\\]|\\.)*\)/g)].map(x => x[0].slice(1, -1));
      out.push(hexes.join('') + lits.join(''));
    } else out.push(m[2]);
  }
}
console.log('streams', streams.length, 'mapsize', Object.keys(map).length);
console.log(out.join(' ').replace(/\s+/g, ' ').slice(0, 5000));