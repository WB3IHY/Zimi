// The globe: the Earth as a ball you hold, drawn with the three.js and the
// maps the Almanac's 3D view already ships (static/earth/). Zimi Earth
// (earth.html) and the Look overlay (almanac-look.js, the ground under your
// feet) are both this one thing, so a fix reaches both. The maths comes
// first and touches nothing but numbers (tests/test_globe.cjs).
//
// A view is where the camera hangs: over (lat, lon), `alt` Earth radii above
// the surface, with `bearing` degrees (clockwise from north) running up the
// screen. Day and night come from the Sun's real place at a given time.
//
//   ZimiGlobe.create(canvas, opts) -> Promise<globe>
//   globe.set({lat, lon, alt, bearing}, animateMs?)   globe.get()
//   globe.project(lat, lon) -> {x, y, front}    (CSS px in the canvas)
//   globe.bounds() -> {w, s, e, n}              (what is on screen, a little generous)
//   globe.setTime(ms)   globe.resize()   globe.dispose()
//   opts: {interactive, onMove(view), onTap(lat, lon, x, y), onFrame(), alt, lat, lon, time}

var ZimiGlobe = (function () {
  var RAD = Math.PI / 180;
  var THREE_URL = '/static/earth/three-r186.min.js?v=1';
  var DAY_URL = '/static/earth/earth-day-v1.webp?v=1';
  var NIGHT_URL = '/static/earth/earth-night-v1.webp?v=1';
  var FOV_DEG = 40;                   // vertical
  var ALT_MIN = 0.0016;               // ten kilometres up: a street's width fills the screen
  var ALT_MAX = 6;
  var ALT_START = 2.6;
  var WHEEL_ZOOM_PER_PX = 0.0012;     // log-zoom per wheel pixel
  var TAP_SLOP_PX = 6;
  var TAP_MS = 450;
  var FLING_DECAY_MS = 500;           // a flung globe slows to a stop in about this
  var FLING_MIN_PX_MS = 0.02;          // below this many pixels a millisecond it has stopped
  var MAX_DPR = 2;
  var DAY_MS = 86400000;
  var J2000_MS = Date.UTC(2000, 0, 1, 12);

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function wrapLon(x) { return ((x + 540) % 360 + 360) % 360 - 180; }
  function norm360(x) { return ((x % 360) + 360) % 360; }

  // ── The maths ────────────────────────────────────────────────────────────

  // Where the Sun is overhead at `ms` (the Astronomical Almanac's low
  // precision formulae: 0.01 degrees, far finer than a terminator drawn on a
  // phone needs).
  function subsolar(ms) {
    var d = (ms - J2000_MS) / DAY_MS;
    var L = norm360(280.460 + 0.9856474 * d), g = norm360(357.528 + 0.9856003 * d) * RAD;
    var lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
    var eps = (23.439 - 0.0000004 * d) * RAD;
    var dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
    var ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / RAD;
    var gmst = norm360(280.46061837 + 360.98564736629 * d);
    return { lat: dec / RAD, lon: wrapLon(ra - gmst) };
  }

  // A point on the unit sphere: y is the north pole, longitude 0 faces +z.
  function toVec(lat, lon) {
    var la = lat * RAD, lo = lon * RAD;
    return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
  }
  function fromVec(v) {
    return { lat: Math.asin(clamp(v[1], -1, 1)) / RAD, lon: Math.atan2(v[0], v[2]) / RAD };
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function unit(a) { var n = Math.sqrt(dot(a, a)) || 1; return [a[0] / n, a[1] / n, a[2] / n]; }
  function scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

  // The camera for a view: where it is, which way it looks, what is up.
  // `bearing` is the direction (clockwise from north) that runs up the screen.
  function cameraFor(view) {
    var p = toVec(view.lat, view.lon);
    var la = view.lat * RAD, lo = view.lon * RAD, b = (view.bearing || 0) * RAD;
    var north = [-Math.sin(la) * Math.sin(lo), Math.cos(la), -Math.sin(la) * Math.cos(lo)];
    var east = [Math.cos(lo), 0, -Math.sin(lo)];
    var up = add(scale(north, Math.cos(b)), scale(east, Math.sin(b)));
    return { pos: scale(p, 1 + view.alt), look: [0, 0, 0], up: up, forward: scale(p, -1), right: cross(scale(p, -1), up) };
  }

  // The surface point under a screen position (x, y in 0..w, 0..h), or null
  // where the ray misses the globe (the sky around it).
  function pick(view, x, y, w, h) {
    var cam = cameraFor(view);
    var t = Math.tan(FOV_DEG * RAD / 2);
    var nx = (x / w * 2 - 1) * t * (w / h), ny = (1 - y / h * 2) * t;
    var dir = unit(add(add(cam.forward, scale(cam.right, nx)), scale(cam.up, ny)));
    var o = cam.pos, b = dot(o, dir), c = dot(o, o) - 1, disc = b * b - c;
    if (disc < 0) return null;
    var s = -b - Math.sqrt(disc);
    if (s < 0) return null;
    return fromVec(add(o, scale(dir, s)));
  }

  // A surface point on screen, and whether it faces the camera.
  function project(view, lat, lon, w, h) {
    var cam = cameraFor(view), p = toVec(lat, lon);
    var rel = sub(p, cam.pos);
    var z = dot(rel, cam.forward);
    if (z <= 0) return { x: 0, y: 0, front: false };
    var t = Math.tan(FOV_DEG * RAD / 2);
    var x = dot(rel, cam.right) / z / (t * (w / h)), y = dot(rel, cam.up) / z / t;
    // Facing: the point is on the near side of the globe from the camera.
    var front = dot(p, cam.pos) > 1;
    return { x: (x + 1) / 2 * w, y: (1 - y) / 2 * h, front: front };
  }

  // The smallest box holding what the screen shows (the edge and corner rays;
  // a miss means the globe's rim is on screen, so the horizon's own reach).
  function bounds(view, w, h) {
    var reach = Math.acos(clamp(1 / (1 + view.alt), 0, 1)) / RAD, r = 0;
    var cp = toVec(view.lat, view.lon);
    [[0, 0], [w / 2, 0], [w, 0], [0, h / 2], [w, h / 2], [0, h], [w / 2, h], [w, h]].forEach(function (pt) {
      var g = pick(view, pt[0], pt[1], w, h);
      r = Math.max(r, g ? Math.acos(clamp(dot(cp, toVec(g.lat, g.lon)), -1, 1)) / RAD : reach);
    });
    var south = view.lat - r, north = view.lat + r;
    if (south <= -90 || north >= 90 || r >= 90) return { w: -180, s: Math.max(-90, south), e: 180, n: Math.min(90, north) };
    var dl = r / Math.max(Math.cos(Math.max(Math.abs(south), Math.abs(north)) * RAD), 0.02);
    if (dl >= 180) return { w: -180, s: south, e: 180, n: north };
    return { w: wrapLon(view.lon - dl), s: south, e: wrapLon(view.lon + dl), n: north };
  }

  // Kilometres from one side of the screen to the other at the centre.
  function spanKm(view, w, h) {
    var half = Math.tan(FOV_DEG * RAD / 2) * (w / h);
    return 2 * half * view.alt * 6371;
  }

  // A drag of (dx, dy) pixels as a new centre: the surface follows the finger.
  function dragged(view, dx, dy, h) {
    var k = 2 * Math.tan(FOV_DEG * RAD / 2) * view.alt / h;          // radians per pixel at the centre
    var b = (view.bearing || 0) * RAD;
    // The screen's right and up in compass terms, then the move opposite the finger.
    var east = (-dx * Math.cos(b) + dy * Math.sin(b)) * k;
    var north = (dy * Math.cos(b) + dx * Math.sin(b)) * k;
    var lat = clamp(view.lat + north / RAD, -85, 85);
    var lon = wrapLon(view.lon + east / RAD / Math.max(Math.cos(lat * RAD), 0.05));
    return { lat: lat, lon: lon };
  }

  // How high the camera hangs for the whole globe to fit the screen's
  // narrower side with a margin: a phone held upright is the narrow case.
  var FIT_MARGIN = 0.84;
  function fitAlt(w, h) {
    var half = Math.atan(Math.tan(FOV_DEG * RAD / 2) * Math.min(1, w / h));
    return 1 / Math.sin(half * FIT_MARGIN) - 1;
  }

  function zoomed(alt, factor) { return clamp(alt * factor, ALT_MIN, ALT_MAX); }

  // ── The thing ────────────────────────────────────────────────────────────

  var threePromise = null;
  function loadThree() {
    if (!threePromise) {
      threePromise = import(THREE_URL);
      threePromise.catch(function () { threePromise = null; });
    }
    return threePromise;
  }
  function loadTexture(THREE, url) {
    return new Promise(function (resolve, reject) { new THREE.TextureLoader().load(url, resolve, undefined, reject); });
  }

  var VERT = [
    'varying vec3 vP;',
    'void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
  ].join('\n');
  // Day where the Sun is up, the city lights where it is not, a soft twilight
  // between, the air's blue at the limb.
  var FRAG = [
    'precision highp float;',
    'uniform sampler2D dayMap; uniform sampler2D nightMap; uniform vec3 sunDir;',
    'varying vec3 vP;',
    'const float PI = 3.14159265;',
    'void main() {',
    '  vec3 N = normalize(vP);',
    '  vec2 uv = vec2(atan(N.x, N.z) / (2.0 * PI) + 0.5, asin(clamp(N.y, -1.0, 1.0)) / PI + 0.5);',
    '  float mu = dot(N, normalize(sunDir));',
    '  vec3 day = texture2D(dayMap, uv).rgb;',
    '  float lights = texture2D(nightMap, uv).r;',
    '  float sun = smoothstep(-0.05, 0.12, mu) * (0.4 + 0.6 * max(mu, 0.0));',
    '  float night = 1.0 - smoothstep(-0.18, 0.02, mu);',
    '  vec3 col = day * (0.09 + 1.0 * sun) + vec3(0.05, 0.09, 0.16) * sun;',
    '  col += vec3(1.0, 0.78, 0.45) * pow(lights, 1.6) * 1.25 * night;',
    '  vec3 V = normalize(cameraPosition - vP);',
    '  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);',
    '  col += vec3(0.30, 0.55, 1.0) * rim * 0.5 * smoothstep(-0.25, 0.4, mu);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function create(canvas, opts) {
    opts = opts || {};
    return loadThree().then(function (THREE) {
      return Promise.all([loadTexture(THREE, DAY_URL), loadTexture(THREE, NIGHT_URL)]).then(function (maps) {
        return build(THREE, canvas, opts, maps[0], maps[1]);
      });
    });
  }

  function build(THREE, canvas, opts, dayMap, nightMap) {
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.001, 20);
    [dayMap, nightMap].forEach(function (m) { m.anisotropy = renderer.capabilities.getMaxAnisotropy(); m.wrapS = THREE.RepeatWrapping; });
    var sunDir = new THREE.Vector3(1, 0, 0);
    var material = new THREE.ShaderMaterial({
      uniforms: { dayMap: { value: dayMap }, nightMap: { value: nightMap }, sunDir: { value: sunDir } },
      vertexShader: VERT, fragmentShader: FRAG
    });
    var ball = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), material);
    scene.add(ball);

    var view = { lat: opts.lat != null ? opts.lat : 20, lon: opts.lon != null ? opts.lon : 0, alt: opts.alt || ALT_START, bearing: 0 };
    var fitted = !opts.alt;
    var W = 1, H = 1, dirty = true, raf = 0, tween = null, fling = null, dead = false;
    var G = {};

    function setSun(ms) {
      var s = subsolar(ms), v = toVec(s.lat, s.lon);
      sunDir.set(v[0], v[1], v[2]);
      dirty = true; kick();
    }
    function place() {
      var c = cameraFor(view);
      camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
      camera.up.set(c.up[0], c.up[1], c.up[2]);
      camera.lookAt(0, 0, 0);
      camera.near = Math.max(0.0002, view.alt * 0.3);
      camera.far = 20;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    }
    function draw(now) {
      raf = 0;
      if (dead) return;
      var moving = false;
      if (tween) {
        var p = clamp((now - tween.t0) / tween.ms, 0, 1), e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        view = {
          lat: tween.a.lat + (tween.b.lat - tween.a.lat) * e,
          lon: wrapLon(tween.a.lon + (wrapLon(tween.b.lon - tween.a.lon)) * e),
          alt: Math.exp(Math.log(tween.a.alt) + (Math.log(tween.b.alt) - Math.log(tween.a.alt)) * e),
          bearing: tween.a.bearing + wrapLon(tween.b.bearing - tween.a.bearing) * e
        };
        if (p >= 1) tween = null; else moving = true;
        dirty = true;
        if (opts.onMove) opts.onMove(view);
      }
      if (fling) {
        var dt = Math.min(now - fling.t, 50);
        fling.t = now;
        var f = Math.exp(-dt / FLING_DECAY_MS * 3);
        fling.vx *= f; fling.vy *= f;
        if (Math.hypot(fling.vx, fling.vy) < FLING_MIN_PX_MS) fling = null;
        else {
          var g = dragged(view, fling.vx * dt, fling.vy * dt, H);
          view.lat = g.lat; view.lon = g.lon; moving = true; dirty = true;
          if (opts.onMove) opts.onMove(view);
        }
      }
      if (dirty) {
        place();
        renderer.render(scene, camera);
        dirty = false;
        if (opts.onFrame) opts.onFrame();
      }
      if (moving) kick();
    }
    function kick() { if (!raf && !dead) raf = requestAnimationFrame(draw); }

    G.set = function (v, ms) {
      var next = {
        lat: v.lat != null ? clamp(v.lat, -89, 89) : view.lat, lon: v.lon != null ? wrapLon(v.lon) : view.lon,
        alt: v.alt != null ? clamp(v.alt, ALT_MIN, ALT_MAX) : view.alt, bearing: v.bearing != null ? v.bearing : view.bearing
      };
      fling = null;
      if (ms && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) tween = { a: { lat: view.lat, lon: view.lon, alt: view.alt, bearing: view.bearing }, b: next, t0: performance.now(), ms: ms };
      else { tween = null; view = next; if (opts.onMove) opts.onMove(view); }
      dirty = true; kick();
    };
    G.get = function () { return { lat: view.lat, lon: view.lon, alt: view.alt, bearing: view.bearing }; };
    G.project = function (lat, lon) { return project(view, lat, lon, W, H); };
    G.bounds = function () { return bounds(view, W, H); };
    G.spanKm = function () { return spanKm(view, W, H); };
    G.size = function () { return { w: W, h: H }; };
    G.setTime = setSun;
    G.resize = function () {
      var r = canvas.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
      renderer.setSize(W, H, false);
      dirty = true; kick();
    };
    G.dispose = function () {
      dead = true;
      G.disposeObserver();
      if (raf) cancelAnimationFrame(raf);
      ball.geometry.dispose(); material.dispose(); dayMap.dispose(); nightMap.dispose();
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch (e) { /* already gone */ }
    };

    if (opts.interactive !== false) bindPointer(canvas, G, function () { return view; }, function (v) { view = v; dirty = true; tween = null; fling = null; kick(); if (opts.onMove) opts.onMove(view); },
      function (v) { fling = v; fling.t = performance.now(); kick(); }, opts, function () { return H; });

    G.resize();
    if (fitted) { view.alt = clamp(fitAlt(W, H), ALT_MIN, ALT_MAX); G.fitAlt = view.alt; }
    setSun(opts.time || Date.now());
    var resizer = typeof ResizeObserver === 'function' ? new ResizeObserver(function () { G.resize(); }) : null;
    if (resizer) resizer.observe(canvas);
    G.disposeObserver = function () { if (resizer) resizer.disconnect(); };
    return G;
  }

  // One finger drags, two pinch, a wheel zooms, a short still touch is a tap.
  function bindPointer(canvas, G, getView, setView, startFling, opts, getH) {
    var pts = new Map(), last = null, down = null, pinch = null, vel = { x: 0, y: 0 };
    canvas.style.touchAction = 'none';
    function dist() { var a = Array.from(pts.values()); return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }
    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false }; last = { x: e.clientX, y: e.clientY, t: down.t }; vel = { x: 0, y: 0 }; setView(getView()); }
      if (pts.size === 2) { pinch = { d: dist(), alt: getView().alt }; down = null; }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinch) {
        var v = getView();
        setView({ lat: v.lat, lon: v.lon, alt: clamp(pinch.alt * pinch.d / Math.max(dist(), 1), ALT_MIN, ALT_MAX), bearing: v.bearing });
        return;
      }
      if (!down) return;
      var dx = e.clientX - last.x, dy = e.clientY - last.y, now = performance.now();
      if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < TAP_SLOP_PX) return;
      down.moved = true;
      var view = getView(), g = dragged(view, dx, dy, getH());
      var dt = Math.max(now - last.t, 1);
      vel = { x: dx / dt, y: dy / dt };
      last = { x: e.clientX, y: e.clientY, t: now };
      setView({ lat: g.lat, lon: g.lon, alt: view.alt, bearing: view.bearing });
    });
    function end(e) {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (down && e.type === 'pointerup') {
        if (!down.moved && performance.now() - down.t < TAP_MS && opts.onTap) {
          var r = canvas.getBoundingClientRect(), s = G.size();
          var hit = pick(getView(), e.clientX - r.left, e.clientY - r.top, s.w, s.h);
          if (hit) opts.onTap(hit.lat, hit.lon, e.clientX - r.left, e.clientY - r.top);
        } else if (down.moved && performance.now() - last.t < 80) {
          // Flung: the speed it left the finger with, in radians a second per pixel scale.
          var v = getView();
          startFling({ vx: vel.x, vy: vel.y });
          void v;
        }
      }
      if (!pts.size) down = null;
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var v = getView();
      setView({ lat: v.lat, lon: v.lon, alt: zoomed(v.alt, Math.exp(e.deltaY * WHEEL_ZOOM_PER_PX)), bearing: v.bearing });
    }, { passive: false });
  }

  // Whether this device can draw a globe at all, asked once: a context made to find out is let go at once.
  var canDraw = null;
  function supported() {
    if (canDraw === null) {
      try {
        var gl = document.createElement('canvas').getContext('webgl2'), lose = gl && gl.getExtension('WEBGL_lose_context');
        canDraw = !!gl;
        if (lose) lose.loseContext();
      } catch (e) { canDraw = false; }
    }
    return canDraw;
  }

  return {
    create: create, supported: supported,
    // The maths, for the tests and for the surfaces that draw over the globe.
    subsolar: subsolar, toVec: toVec, fromVec: fromVec, cameraFor: cameraFor, pick: pick, project: project, bounds: bounds,
    spanKm: spanKm, dragged: dragged, zoomed: zoomed, fitAlt: fitAlt,
    ALT_MIN: ALT_MIN, ALT_MAX: ALT_MAX, FOV_DEG: FOV_DEG
  };
})();
