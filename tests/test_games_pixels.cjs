// ZimiGames card art, measured in WebKit at 3x: backs are centred and symmetric where they are drawn symmetric, the Zimi
// back's Z sits on the cartouche's centre at every size, the court art is scaled evenly, and no shared rule moves SVG geometry.
// Eric, 2026-10-26: "I need pixel perfection here. This is art." A shared `.zc-bk * { transform-box: fill-box }` had
// moved every transform attribute in the backs (the Z, the lower halves of deco and seigaiha, guilloche's roses).
//
// Run: NODE_PATH=node_modules node tests/test_games_pixels.cjs   (exit 0 = pass; skips when WebKit is not installed)

const fs = require('fs'), path = require('path'), http = require('http');
const dir = path.join(__dirname, '..', 'zimi', 'builtin', 'games');
let failures = 0;
const ok = (label, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  ' + detail : '')); if (!cond) failures++; };

// 1. Static: transform-box may only be set on the parts that animate about their own centre.
const css = fs.readFileSync(path.join(dir, 'cards.css'), 'utf8');
const boxRules = css.split('\n').filter(l => /transform-box:\s*fill-box/.test(l));
ok('cards.css sets fill-box only on the animated parts', boxRules.length === 1 && /^\.zc-boat, \.zc-eye, \.zc-arm, \.zc-wing \{/.test(boxRules[0]), boxRules.join(' | '));

let chromium;
try { chromium = require('playwright').webkit; } catch (e) { console.log('SKIP  playwright is not installed'); process.exit(failures ? 1 : 0); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const harness = '<!doctype html><meta charset=utf-8><link rel=stylesheet href="/games.css"><link rel=stylesheet href="/cards.css">' +
  '<body class="zc-game" style="margin:0;background:#fff;overflow:visible;height:auto;display:block"><script src="/text.js"></script><script src="/cardbacks.js"></script>' +
  '<script src="/courts.js"></script><script src="/courts-es.js"></script><script src="/hanafuda-art.js"></script><script src="/cards.js"></script><div id=box style="padding:20px"></div><script>ZimiCards.ensureSprite();' +
  'window.show=function(id,cw){var c=document.createElement("div");c.className="zc-card zc-down";c.style.cssText="position:relative;left:0;top:0;--cw:"+cw+"px;width:"+cw+"px;height:"+(cw*1.4)+"px";' +
  'c.innerHTML="<div class=zc-back>"+ZimiCards.backMarkup(id)+"</div>";var b=document.getElementById("box");b.innerHTML="";b.appendChild(c);' +
  'document.querySelectorAll(".zc-bk *").forEach(function(e){e.style.animation="none"});};</script>';
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  if (u === '/h.html') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(harness); }
  fs.readFile(path.join(dir, u), (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': TYPES[path.extname(u)] || 'text/plain' }); r.end(d); });
});

(async () => {
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try { browser = await chromium.launch(); } catch (e) { console.log('SKIP  WebKit is not installed'); server.close(); process.exit(failures ? 1 : 0); }
  const page = await (await browser.newContext({ deviceScaleFactor: 3, viewport: { width: 400, height: 500 } })).newPage();
  const decoder = await (await browser.newContext()).newPage();
  await page.goto(base + '/h.html');
  // A screenshot's pixels: [width, height, rgba bytes as base64].
  async function pixels(id, cw) {
    await page.evaluate(([i, c]) => show(i, c), [id, cw]);
    const png = await page.locator('.zc-card').screenshot();
    return decoder.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
      return { w: img.width, h: img.height, d: Array.from(cx.getImageData(0, 0, img.width, img.height).data) };
    }, png.toString('base64'));
  }
  const px = (im, x, y) => { const i = (y * im.w + x) * 4; return [im.d[i], im.d[i + 1], im.d[i + 2]]; };
  const mismatch = (im, map) => { let n = 0; for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) { const a = px(im, x, y), b = px(im, ...map(x, y)); if (Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) > 60) n++; } return n; };

  // 2. Symmetry of the backs drawn symmetric, at the full size (100 px, 300 device px).
  for (const [id, both] of [['classic', true], ['guilloche', true], ['deco', true], ['seigaiha', true], ['zellige', true], ['robot', false]]) {
    const im = await pixels(id, 100);
    const lr = mismatch(im, (x, y) => [im.w - 1 - x, y]);
    ok(id + ' back is the same mirrored left to right', lr < 40, lr + ' px differ');
    if (both) { const r = mismatch(im, (x, y) => [im.w - 1 - x, im.h - 1 - y]); ok(id + ' back is the same turned half a turn', r < 40, r + ' px differ'); }
  }

  // 3. The Zimi back's Z: its orange bounding box is centred on the cartouche (the card's centre) at every size.
  for (const cw of [100, 52, 40, 30]) {
    const im = await pixels('zimi', cw), s = 3 * cw / 100, cx = 50 * s, cy = 70 * s;
    let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
      if (Math.abs(x + .5 - cx) > 12 * s || Math.abs(y + .5 - cy) > 14 * s) continue;
      const [r, g, b] = px(im, x, y);
      if (r > 180 && b < 120 && r - b > 80) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
    }
    const dx = (x0 + x1) / 2 - cx, dy = (y0 + y1) / 2 - cy;
    ok('Zimi back Z is centred at ' + cw + 'px', x1 > 0 && Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5, 'off (' + dx.toFixed(2) + ', ' + dy.toFixed(2) + ') device px');
  }
  const browser2 = browser;

  // 4. The court art is scaled evenly: never preserveAspectRatio="none", and the frame it fills is the box it covers.
  const vm = require('vm'), sb = { console }; sb.window = sb; vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(dir, 'courts.js'), 'utf8'), sb);
  const king = sb.ZimiCourts.markup('king', 3);
  const svgs = [...king.matchAll(/<svg x="([^"]*)" y="[^"]*" width="([\d.]+)" height="([\d.]+)" viewBox="0 0 (\d+) (\d+)" preserveAspectRatio="([^"]*)"/g)];
  ok('court art svgs found', svgs.length === 2);
  svgs.forEach(m => {
    ok('court art is never stretched', m[6] === 'xMidYMid slice', m[6]);
    const scale = Math.max(m[2] / m[4], m[3] / m[5]), lost = (m[5] * scale - m[3]) / 2;   // units cut at top and bottom by the cover
    ok('court art covers its frame and loses under 3 units at each end', m[2] / m[4] <= scale + 1e-9 && lost >= 0 && lost < 3, lost.toFixed(2) + ' units');
  });
  ok('court frame is a crisp rule, a stepped path round the index columns', /<path[^>]*class="zc-rule"/.test(king));
  const backs = fs.readFileSync(path.join(dir, 'cardbacks.js'), 'utf8');
  ok('the backs\' band rules are crisp rules', (backs.match(/class: 'zc-rule'/g) || []).length === 2);
  ok('crisp rules snap to the device pixel', /\.zc-rule \{[^}]*vector-effect: non-scaling-stroke[^}]*crispEdges[^}]*var\(--zc-px/.test(css));

  // 5. The index's top: flat ranks and rounds start at the 5.5 inset; pointed ones (A, 4) overshoot it by under a unit, never touching the edge.
  const cb = await browser2.newContext({ deviceScaleFactor: 1 }).then(c => c.newPage());
  await cb.goto(base + '/h.html');
  const tops = await cb.evaluate(async () => {
    const S = 8, out = {};
    for (const r of 'A23456789TJQK') {
      const id = 39 + 'A23456789TJQK'.indexOf(r);
      const svg = ZimiCards.faceMarkup(id, true).replace('<svg ', '<svg width="' + 100 * S + '" height="' + 140 * S + '" ');
      const img = new Image(); img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg); await img.decode();
      const cv = document.createElement('canvas'); cv.width = 100 * S; cv.height = 140 * S; const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, 100 * S, 30 * S).data; let top = 1e9;
      for (let y = 3 * S; y < 30 * S; y++) for (let x = 3 * S; x < 30 * S; x++) { const i = (y * 100 * S + x) * 4; if (d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100 && y < top) top = y; }
      out[r] = top / S;
    }
    return out;
  });
  for (const [r, t] of Object.entries(tops)) {
    const pointed = r === 'A' || r === '4';
    ok('index ' + r + ' top inset', pointed ? t >= 4.7 && t <= 5.3 : Math.abs(t - 5.5) <= 0.13, t.toFixed(2) + (pointed ? ' (apex overshoots 0.2 to 0.8)' : ''));
  }

  // 6. The index has a column of its own: on every court (French, Spanish) and every Hanafuda card, no art or frame ink comes within
  // CLEAR units of the index's ink. Each part of the index (the glyph, then the suit below it) is measured on a render of the index
  // alone and checked against a render of the art alone (index glyph and pip removed, the cream plates kept).
  const CLEAR = 1.5;
  const clear = await cb.evaluate(async (CLEAR) => {
    const S = 8, W = 100 * S, H = 140 * S, out = [];
    const render = async (svg) => {
      const img = new Image(); img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg); await img.decode();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d'); cx.fillStyle = '#fdfcf8'; cx.fillRect(0, 0, W, H); cx.drawImage(img, 0, 0);
      return cx.getImageData(0, 0, W, H).data;
    };
    const variant = (markup, keep) => {
      const doc = new DOMParser().parseFromString(markup, 'image/svg+xml'), svg = doc.documentElement;
      if (keep === 'index') [...svg.children].forEach(c => { if (!/zc-idx-std/.test(c.getAttribute('class') || '') && c.tagName !== 'defs' && c.tagName !== 'rect') c.remove(); });
      else svg.querySelectorAll('.zc-idx-std').forEach(g => [...g.children].forEach(c => { if (c.getAttribute('class') !== 'zc-plate') c.remove(); }));
      if (keep === 'index') svg.querySelectorAll('.zc-plate').forEach(p => p.remove());
      svg.setAttribute('width', W); svg.setAttribute('height', H);
      return new XMLSerializer().serializeToString(svg);
    };
    const dark = (d, x, y) => { const i = (y * W + x) * 4; return d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200; };
    const far = (d, x, y) => { const i = (y * W + x) * 4; return Math.abs(d[i] - 253) + Math.abs(d[i + 1] - 252) + Math.abs(d[i + 2] - 248) > 40; };
    const cases = [];
    for (let id = 0; id < 52; id++) if (id % 13 > 9) cases.push(['French ' + 'JQK'[id % 13 - 10] + 'CDHS'[Math.floor(id / 13)], ZimiCards.faceMarkup(id, true)]);
    for (let id = 0; id < 40; id++) if (id % 10 > 6) cases.push(['Spanish ' + id, ZimiCards.spanishFaceMarkup(id, true)]);
    for (let id = 0; id < 48; id++) cases.push(['Hanafuda ' + id, ZimiCards.hanafudaFaceMarkup(id, true)]);
    for (const [name, markup] of cases) {
      const idx = await render(variant(markup, 'index')), art = await render(variant(markup, 'art'));
      const rows = []; for (let y = 3 * S; y < 70 * S; y++) { let a = 1e9, b = -1; for (let x = 3 * S; x < 50 * S; x++) if (dark(idx, x, y)) { a = Math.min(a, x); b = Math.max(b, x + 1); } if (b >= 0) rows.push([y, a, b]); }
      const parts = [[]]; rows.forEach((r, i) => { if (i && r[0] - rows[i - 1][0] > 1.5 * S) parts.push([]); parts[parts.length - 1].push(r); });
      let worst = 1e9;
      parts.forEach(p => {
        const x0 = Math.min(...p.map(r => r[1])) - CLEAR * S, x1 = Math.max(...p.map(r => r[2])) + CLEAR * S, y0 = p[0][0] - CLEAR * S, y1 = p[p.length - 1][0] + 1 + CLEAR * S;
        for (let y = Math.max(3 * S, Math.floor(y0)); y < y1; y++) for (let x = Math.max(3 * S, Math.floor(x0)); x < x1; x++) if (far(art, x, y)) { worst = Math.min(worst, 0); }
      });
      out.push([name, parts.length, worst === 0 ? 'art within ' + CLEAR : 'ok']);
    }
    return out;
  }, CLEAR);
  const hit = clear.filter(r => r[2] !== 'ok'), thin = clear.filter(r => r[1] < 2);
  ok('every court and Hanafuda card (' + clear.length + ') keeps art and frame ' + CLEAR + ' units from the index', hit.length === 0, hit.map(r => r[0]).join(', '));
  ok('the index was measured as glyph and suit', thin.length === 0, thin.map(r => r[0]).join(', '));
  await browser2.close();

  server.close();
  console.log(failures ? failures + ' FAILED' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
