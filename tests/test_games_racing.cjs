// ZimiGames racing: Circuit (top-down tracks, cars, laps, computer drivers, ghosts) and Road Rush (the pseudo-3D road).
// The rules with no DOM.
//
// Run: node tests/test_games_racing.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'zimi', 'builtin', 'games');
function load(files) {
  const sandbox = {};
  vm.createContext(sandbox);
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox, { filename: f }));
  return sandbox;
}

let failures = 0;
const check = (ok, label) => {
  if (ok) console.log('ok: ' + label);
  else { console.error('FAIL: ' + label); failures++; }
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;

// ── Circuit ─────────────────────────────────────────────────────────────────
{
  const E = load(['playkit.js', 'circuit.js']).CircuitEngine;
  const DT = 1 / 60;
  check(E.TRACKS.length >= 4, 'circuit: at least four tracks');
  check(['oval', 'switchback', 'crossover', 'city'].every(id => E.TRACKS.some(t => t.id === id)), 'circuit: an oval, a twisty circuit, a figure eight and a city course');

  // geometry: closed, evenly stepped, never touching itself except on the bridge
  E.TRACKS.forEach(def => {
    const T = E.track(def.id), N = T.N;
    let worst = 0;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N; // includes the closing step from the last sample back to the first
      worst = Math.max(worst, Math.abs(Math.hypot(T.x[j] - T.x[i], T.y[j] - T.y[i]) - T.step));
    }
    check(worst < T.step * 0.12, def.id + ': closed, every step about ' + T.step.toFixed(1) + ' px (worst ' + worst.toFixed(2) + ')');
    check(near(Math.hypot(T.tx[0], T.ty[0]), 1, 1e-9) && near(Math.hypot(T.tx[N - 1], T.ty[N - 1]), 1, 1e-9), def.id + ': unit tangents, also across the closing sample');
    let total = 0; // the tangents turn through exactly one full turn round a simple loop, none for a figure eight
    for (let i = 0; i < N; i++) { const j = (i + 1) % N; let d = Math.atan2(T.ty[j], T.tx[j]) - Math.atan2(T.ty[i], T.tx[i]); while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; total += d; }
    const turns = Math.round(total / (2 * Math.PI));
    check(def.bridge ? turns === 0 : Math.abs(turns) === 1, def.id + ': ' + (def.bridge ? 'a figure eight turns through nothing in all' : 'one full turn round') + ' (' + turns + ')');
    // two stretches of road more than a tenth of the lap apart that come within a road's width are a crossing
    const gap = Math.round(N / 10);
    let crossings = 0, onBridge = 0;
    for (let i = 0; i < N; i++) for (let j = i + gap; j < i + N - gap; j++) {
      const q = j % N;
      if (Math.hypot(T.x[i] - T.x[q], T.y[i] - T.y[q]) < T.width * 1.05) { crossings++; if (T.level[i] !== T.level[q]) onBridge++; }
    }
    if (def.bridge) check(crossings > 0 && onBridge === crossings, def.id + ': where the road meets itself one stretch is on the bridge and one is under it');
    else check(crossings === 0, def.id + ': the road never comes within a width of itself');
    const lv = T.level.reduce((a, b) => a + b, 0);
    check(def.bridge ? lv > 20 && lv < N / 3 : lv === 0, def.id + ': ' + lv + ' samples of bridge');
  });

  // a car placed at a spot sits on the road; its offset is where it was put
  {
    const T = E.track('switchback'), c = E.spawn(T, 40.5, 20);
    check(near(c.lat, 20, 0.5) && !c.off, 'locate: a car put 20 px off the line reads 20 px');
    const c2 = E.spawn(T, 40.5, -T.halfW - 10);
    check(c2.off && c2.lat < -T.halfW, 'locate: past the kerb is off the track');
  }

  // laps: counted once at the line, never by going backwards over it and forwards again, never by cutting across
  {
    const T = E.track('oval'), N = T.N;
    const race = E.createRace('oval', { ai: 0, humans: 1, laps: 3 });
    const car = race.cars[0];
    race.phase = 'racing'; race.t = 0; car.input = { steer: 0, gas: 0, brake: 0 };
    // walk the parked car along the road in small hops, stepping the race at each
    function walk(to) {
      const dir = to > car.prog ? 1 : -1;
      for (let guard = 0; Math.abs(to - car.prog) > 0.01 && guard < 1000; guard++) {
        const next = car.prog + dir * Math.min(5, Math.abs(to - car.prog)), p = E.pointAt(T, next);
        car.x = p.x; car.y = p.y; car.h = Math.atan2(p.ty, p.tx); car.vx = car.vy = 0; car.stuck = 0; car.auto = false;
        E.step(race, 0.05);
      }
    }
    walk(-3); walk(5);
    check(car.maxK === 0 && car.laps.length === 0 && car.lapStart != null, 'laps: the first crossing of the line starts the lap clock and counts no lap');
    walk(-5); walk(5);
    check(car.laps.length === 0, 'laps: back over the line and forwards again counts nothing');
    walk(N - 5); walk(N + 5);
    check(car.laps.length === 1 && car.maxK === 1, 'laps: a full circuit counts one lap');
    walk(N - 5); walk(N + 5);
    check(car.laps.length === 1, 'laps: back over the second crossing and forwards again counts nothing');
    check(near(car.laps[0], N / 5 * 0.05 + 0.2, 0.15), 'laps: the lap time is the time between the crossings');
    walk(2 * N + 5); walk(3 * N + 5);
    check(car.finished && car.laps.length === 3 && race.laps === 3, 'laps: finishing is counting the last lap');
    // a two-lap race run by the computer: two lap times adding up to the race from the first crossing
    const r2 = E.createRace('oval', { ai: 0, humans: 1, laps: 2, sim: true });
    let t = 0;
    while (r2.phase !== 'done' && t < 200) { E.step(r2, DT); t += DT; }
    const c2 = r2.cars[0];
    check(c2.finished && c2.laps.length === 2, 'laps: a two-lap race gives two lap times');
    const first = c2.finishTime - c2.laps[0] - c2.laps[1];
    check(first > 0 && first < 6 && c2.laps.every(l => l > 10 && l < 40), 'laps: the clock starts within seconds of the green light, and oval laps of ' + c2.laps.map(l => l.toFixed(1)).join(' and ') + ' s are sensible');
    // cutting across: teleport to the far side of the track; the search near the old place keeps the car's progress
    const rc = E.createRace('oval', { ai: 0, humans: 1, laps: 3 });
    const cc = rc.cars[0], progBefore = cc.prog;
    cc.x = -cc.x; cc.y = -cc.y; E.locate(T, cc);
    check(Math.abs(cc.prog - progBefore) < 20, 'laps: jumping to the far side of the track does not skip the laps in between');
  }

  // the cars: speeds, grass, drift, brakes
  {
    const T = E.track('oval');
    const sp = c => Math.hypot(c.vx, c.vy);
    const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
    // a plain steering rule that follows the line, so a long run stays on the road
    const follow = c => { const p = E.pointAt(T, c.idx + 5); return { steer: Math.max(-1, Math.min(1, angDiff(Math.atan2(p.y - c.y, p.x - c.x), c.h) * 2.5)), gas: 1, brake: 0 }; };
    const flat = E.spawn(T, 30, 0);
    for (let i = 0; i < 60 * 8; i++) E.stepCar(T, flat, follow(flat), DT, false);
    check(sp(flat) > E.VMAX * 0.8 && sp(flat) < E.VMAX * 1.001 && !flat.off, 'car: full throttle reaches near the top speed on the road (' + sp(flat).toFixed(0) + ')');
    // grass, on the city course's straight: the same start at speed, on the road and 20 px past the kerb
    const C = E.track('city');
    function coast(lat) {
      const c = E.spawn(C, 24, lat), p = E.pointAt(C, 24);
      c.vx = p.tx * 250; c.vy = p.ty * 250;
      for (let i = 0; i < 25; i++) E.stepCar(C, c, { steer: 0, gas: 1, brake: 0 }, DT, false);
      return c;
    }
    const onRoad = coast(0), onGrass = coast(C.halfW + 20);
    check(onGrass.off && !onRoad.off && sp(onGrass) < sp(onRoad) * 0.85, 'car: grass slows the car (' + sp(onGrass).toFixed(0) + ' against ' + sp(onRoad).toFixed(0) + ')');
    const braked = flat;
    for (let i = 0; i < 42; i++) E.stepCar(T, braked, { steer: 0, gas: 0, brake: 1 }, DT, false);
    check(sp(braked) < 30, 'car: braking stops it');
    // a hard turn at speed slides: the nose swings further than the car travels
    const slide = (() => {
      const c = E.spawn(T, 30, 0);
      let peak = 0;
      for (let i = 0; i < 90; i++) { E.stepCar(T, c, { steer: 0, gas: 1, brake: 0 }, DT, false); }
      for (let i = 0; i < 60; i++) { E.stepCar(T, c, { steer: 1, gas: 1, brake: 0 }, DT, false); peak = Math.max(peak, c.slide); }
      return peak;
    })();
    check(slide > 0.3, 'car: full lock at speed drifts (slide ' + slide.toFixed(2) + ')');
    const calm = (() => {
      const c = E.spawn(T, 30, 0);
      let peak = 0;
      for (let i = 0; i < 90; i++) E.stepCar(T, c, { steer: 0, gas: 0.3, brake: 0 }, DT, false);
      for (let i = 0; i < 40; i++) { E.stepCar(T, c, { steer: 0.3, gas: 0, brake: 0 }, DT, false); peak = Math.max(peak, c.slide); }
      return peak;
    })();
    check(calm < slide && calm < 0.2, 'car: a gentle turn at a modest speed grips');
    // the barrier keeps a car in
    const wall = (() => {
      const c = E.spawn(T, 30, 0);
      for (let i = 0; i < 600; i++) E.stepCar(T, c, { steer: 0.35, gas: 1, brake: 0 }, DT, false);
      return Math.abs(c.lat);
    })();
    check(wall <= T.halfW + E.BARRIER + 2, 'car: the barrier holds a car that will not turn (' + wall.toFixed(0) + ' px out)');
    // reverse is slow
    for (let i = 0; i < 240; i++) E.stepCar(T, braked, { steer: 0, gas: 0, brake: 1 }, DT, false);
    check(sp(braked) < 90, 'car: reverse is slow');
  }

  // bumps
  {
    const T = E.track('oval');
    const a = E.spawn(T, 30, -5), b = E.spawn(T, 30.1, 5);
    a.x = 100; a.y = 100; b.x = 108; b.y = 100; a.vx = 100; a.vy = 0; b.vx = 0; b.vy = 0; a.level = b.level = 0;
    const p0 = a.vx + b.vx;
    check(E.bump(a, b) === true, 'bump: touching cars bump');
    check(Math.hypot(b.x - a.x, b.y - a.y) >= E.CAR_R * 2 - 1e-6, 'bump: they are pushed apart to a car\'s width');
    check(near(a.vx + b.vx, p0, 1e-6) && b.vx > a.vx, 'bump: speed passes forward and the total is kept');
    const c = E.spawn(T, 30, 0), d = E.spawn(T, 30, 0);
    c.x = d.x = 0; c.y = d.y = 0; c.level = 0; d.level = 1;
    check(E.bump(c, d) === false, 'bump: a car on the bridge and one under it do not touch');
    const e = E.spawn(T, 30, 0), f = E.spawn(T, 30, 0);
    e.x = 0; e.y = 0; f.x = 40; f.y = 0; e.level = f.level = 0;
    check(E.bump(e, f) === false, 'bump: cars apart do not');
  }

  // the computer drivers stay on the road over a whole race, on every track, and the field stays sane
  E.TRACKS.forEach(def => {
    const T = E.track(def.id), race = E.createRace(def.id, { ai: 5, humans: 1, laps: 3, sim: true, seed: 3 });
    let worst = 0, t = 0, bumps = 0, offFrames = 0;
    while (race.phase !== 'done' && t < 300) {
      E.step(race, DT); t += DT;
      race.events.splice(0).forEach(e => { if (e.type === 'bump') bumps++; });
      if (race.t > 0) race.cars.forEach(c => { worst = Math.max(worst, Math.abs(c.lat)); if (c.off) offFrames++; });
    }
    check(race.phase === 'done' && race.cars.every(c => c.finished), def.id + ': every computer car finishes three laps (' + t.toFixed(0) + ' s)');
    check(worst < T.halfW + 6, def.id + ': they stay on the track (furthest ' + worst.toFixed(0) + ' of ' + T.halfW.toFixed(0) + ' px)');
    const lapTimes = race.cars.flatMap(c => c.laps);
    check(Math.max.apply(null, lapTimes) < Math.min.apply(null, lapTimes) * 1.35, def.id + ': lap times agree within a third (' + Math.min.apply(null, lapTimes).toFixed(1) + ' to ' + Math.max.apply(null, lapTimes).toFixed(1) + ' s)');
  });

  // computer cars pass slower ones instead of sitting behind or shoving through
  {
    const T = E.track('oval'), race = E.createRace('oval', { ai: 3, humans: 1, laps: 3, sim: true, seed: 5 });
    const [slow, fast] = race.cars.filter(c => c.ai).slice(0, 2);
    race.phase = 'racing'; race.t = 0;
    race.cars.forEach(c => { if (c !== slow && c !== fast) { c.x = 1e6; c.y = 1e6; } });
    const p = E.pointAt(T, 60), q = E.pointAt(T, 56);
    slow.x = p.x; slow.y = p.y; slow.h = Math.atan2(p.ty, p.tx); slow.idx = 60; E.locate(T, slow); slow.prog = 60; slow.ai.skill = 0.5;
    fast.x = q.x; fast.y = q.y; fast.h = slow.h; fast.idx = 56; E.locate(T, fast); fast.prog = 56; fast.ai.skill = 1;
    slow.vx = Math.cos(slow.h) * 120; slow.vy = Math.sin(slow.h) * 120; fast.vx = Math.cos(fast.h) * 120; fast.vy = Math.sin(fast.h) * 120;
    let passed = false, sideways = 0;
    for (let i = 0; i < 60 * 14 && !passed; i++) { E.step(race, DT); if (fast.prog > slow.prog + 2) passed = true; sideways = Math.max(sideways, Math.abs(fast.lat - slow.lat)); }
    check(passed, 'overtaking: the faster computer car gets past the slower one');
    check(sideways > 14, 'overtaking: by going round it (' + sideways.toFixed(0) + ' px to the side)');
  }

  // grid, standings, ghost
  {
    const race = E.createRace('city', { ai: 4, humans: 2, laps: 2 });
    check(race.cars.length === 6 && race.cars[0].human && race.cars[1].human && !race.cars[2].human, 'grid: two people first in the list, four rivals after');
    const progs = race.cars.map(c => c.prog).sort((a, b) => a - b);
    check(new Set(progs).size === 6 && progs.every(p => p < 0), 'grid: six rows, all behind the line');
    check(race.phase === 'countdown' && race.t < 0, 'grid: begins with a countdown');
    for (let i = 0; i < 60 * 2.9; i++) E.step(race, DT);
    check(race.phase === 'countdown' && race.cars.every(c => Math.hypot(c.vx, c.vy) === 0), 'grid: nobody moves during the countdown');
    for (let i = 0; i < 20; i++) E.step(race, DT);
    check(race.phase === 'racing', 'grid: then the race');
    const order = E.standings(race);
    check(order.length === 6 && order[0].prog >= order[5].prog, 'standings: the furthest round first');
    race.cars[3].finished = true; race.cars[3].finishTime = 50; race.cars[4].finished = true; race.cars[4].finishTime = 45;
    const o2 = E.standings(race);
    check(o2[0] === race.cars[4] && o2[1] === race.cars[3], 'standings: finishers by time before everyone still racing');
    const g = [];
    for (let i = 0; i <= 40; i++) E.ghostPush(g, i * 10, 0, i * 0.01);
    const at = E.ghostAt(g, 0.5 / E.GHOST_HZ);
    check(at && near(at.x, 5, 0.2) && near(at.h, 0.005, 0.01), 'ghost: a position between two samples is between them');
    check(E.ghostAt(g, 100) === null && E.ghostAt(g, -1) === null, 'ghost: nothing before the lap starts or after it ends');
  }
}

// ── Road Rush ───────────────────────────────────────────────────────────────

if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('\nall racing tests passed');
