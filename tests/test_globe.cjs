// The globe's maths (zimi/static/globe.js): where the Sun is, what the camera
// sees from a view, where a place lands on the screen and what is under a
// finger. The drawing is tests/test_earth_page.spec.mjs.
//
// Run: node tests/test_globe.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'zimi', 'static', 'globe.js'), 'utf8');
const ctx = { window: {}, console, Math, Date, import: null };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const G = vm.runInContext('ZimiGlobe', ctx);

let failures = 0;
function check(ok, label) {
  if (!ok) { console.error('FAIL: ' + label); failures++; } else console.log('ok: ' + label);
}
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;
const W = 390, H = 844;

// ── The Sun ──
{
  const june = G.subsolar(Date.UTC(2026, 5, 21, 12, 0));
  check(near(june.lat, 23.43, 0.05), 'June solstice: the Sun is over the Tropic of Cancer (' + june.lat.toFixed(2) + ')');
  const dec = G.subsolar(Date.UTC(2026, 11, 21, 12, 0));
  check(near(dec.lat, -23.43, 0.05), 'December solstice: over the Tropic of Capricorn');
  const equinox = G.subsolar(Date.UTC(2026, 2, 20, 14, 46));
  check(near(equinox.lat, 0, 0.1), 'March equinox: over the equator');
  // At noon UTC the Sun is near the Greenwich meridian, within the equation of time (+-4 degrees).
  check(Math.abs(june.lon) < 4, 'noon UTC: the Sun is near longitude 0 (' + june.lon.toFixed(2) + ')');
  const six = G.subsolar(Date.UTC(2026, 5, 21, 18, 0));
  check(near(six.lon, -90, 4), 'six hours later it is a quarter of the way west');
}

// ── The camera ──
{
  const v = { lat: 48.86, lon: 2.35, alt: 0.01, bearing: 0 };
  const mid = G.project(v, v.lat, v.lon, W, H);
  check(near(mid.x, W / 2, 0.5) && near(mid.y, H / 2, 0.5) && mid.front, 'the place the camera hangs over is the middle of the screen');
  const north = G.project(v, v.lat + 0.01, v.lon, W, H), east = G.project(v, v.lat, v.lon + 0.01, W, H);
  check(north.y < mid.y && near(north.x, mid.x, 0.5), 'north is up with bearing 0');
  check(east.x > mid.x && near(east.y, mid.y, 0.5), 'east is to the right');
  const b = G.project({ lat: v.lat, lon: v.lon, alt: v.alt, bearing: 90 }, v.lat, v.lon + 0.01, W, H);
  check(b.y < mid.y && near(b.x, mid.x, 0.5), 'bearing 90: east runs up the screen (facing east)');
  const b180 = G.project({ lat: v.lat, lon: v.lon, alt: v.alt, bearing: 180 }, v.lat + 0.01, v.lon, W, H);
  check(b180.y > mid.y, 'bearing 180: north is down');
  const far = { lat: 0, lon: 0, alt: 2.6, bearing: 0 };
  check(G.project(far, 0, 180, W, H).front === false, 'the far side of the globe does not face the camera');
  check(G.project(far, 0, 30, W, H).front === true, 'the near side does');
}
{
  const v = { lat: 35, lon: 139, alt: 0.2, bearing: 30 };
  const p = G.project(v, 36, 140, W, H);
  const back = G.pick(v, p.x, p.y, W, H);
  check(back && near(back.lat, 36, 0.001) && near(back.lon, 140, 0.001), 'what is projected is what is picked, bearing and all');
  check(G.pick({ lat: 0, lon: 0, alt: 3, bearing: 0 }, 2, 2, W, H) === null, 'a corner of the screen at a whole-globe view is sky');
  const c = G.pick(v, W / 2, H / 2, W, H);
  check(near(c.lat, 35, 0.001) && near(c.lon, 139, 0.001), 'the middle of the screen is the place under the camera');
}

// ── What is on screen ──
{
  const v = { lat: 48.86, lon: 2.35, alt: 0.02, bearing: 0 };
  const b = G.bounds(v, W, H);
  check(b.w < 2.35 && b.e > 2.35 && b.s < 48.86 && b.n > 48.86, 'the box holds the centre');
  check(b.n - b.s < 20 && b.n - b.s > 0.5, 'at 130 km up the box is a few degrees, not the world (' + (b.n - b.s).toFixed(2) + ')');
  const whole = G.bounds({ lat: 0, lon: 0, alt: 2.6, bearing: 0 }, W, H);
  check(whole.n > 50 && whole.s < -50, 'a whole globe holds most latitudes');
  const pole = G.bounds({ lat: 85, lon: 10, alt: 1, bearing: 0 }, W, H);
  check(pole.w === -180 && pole.e === 180, 'over a pole every longitude is on screen');
  const close = G.bounds({ lat: 10, lon: 179.9, alt: 0.01, bearing: 0 }, W, H);
  check(close.w > close.e, 'across the antimeridian the west edge is east of the east edge');
}
{
  const small = G.spanKm({ lat: 0, lon: 0, alt: 0.01, bearing: 0 }, W, H), big = G.spanKm({ lat: 0, lon: 0, alt: 0.1, bearing: 0 }, W, H);
  check(near(big / small, 10, 0.001), 'ten times higher shows ten times the ground');
  check(small > 20 && small < 80, 'at 64 km up the screen is a few tens of km wide (' + small.toFixed(1) + ')');
}

// ── Dragging and zooming ──
{
  const v = { lat: 40, lon: 0, alt: 0.05, bearing: 0 };
  const right = G.dragged(v, 100, 0, H), down = G.dragged(v, 0, 100, H);
  check(right.lon < 0 && near(right.lat, 40, 0.001), 'dragging right brings the west to the middle');
  check(down.lat > 40, 'dragging down brings the north to the middle');
  const turned = G.dragged({ lat: 40, lon: 0, alt: 0.05, bearing: 90 }, 100, 0, H);
  check(turned.lat !== 40 && Math.abs(turned.lon) < 0.001, 'facing east, a drag to the right moves the map north-south');
  const polar = G.dragged({ lat: 84, lon: 0, alt: 0.5, bearing: 0 }, 0, 800, H);
  check(polar.lat <= 85, 'a drag stops short of the pole');
  const dateline = G.dragged({ lat: 0, lon: 179.9, alt: 0.05, bearing: 0 }, -400, 0, H);
  check(dateline.lon < 0, 'a drag across the antimeridian wraps the longitude');
  const slow = G.dragged({ lat: 0, lon: 0, alt: 0.01, bearing: 0 }, 100, 0, H), quick = G.dragged({ lat: 0, lon: 0, alt: 1, bearing: 0 }, 100, 0, H);
  check(Math.abs(quick.lon) > 30 * Math.abs(slow.lon), 'a finger moves the ground further the higher you are');
  check(G.zoomed(0.5, 0.0001) === G.ALT_MIN && G.zoomed(0.5, 1e6) === G.ALT_MAX, 'zoom stops at ten km and at the whole globe');
}

if (failures) { console.error(failures + ' failed'); process.exit(1); }
console.log('all passed');
