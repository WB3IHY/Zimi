/* ZimiGames: the one script every puzzle page loads before its own.
   It never touches puzzle code. Simon Tatham's frontend keeps its own menu form and its own colours; this
   script makes the page an ordinary ZimiGames page around them:
     - it builds the game's bar (Back, title, Undo) and hands the shell (../shell.js) the rest: Restart, Redo and
       Show solution go to the Menu, Game and Type go to Menu > New game, the rules are How to play (help.<name>.* in text/en.json);
     - it remaps the puzzle's canvas palette to Zimi's tokens, in light and dark;
     - a long press is the right button (touch has none); a keypad serves the puzzles that take digits.
   It runs before the puzzle's script (both are deferred, in order), so the fit box exists when the puzzle looks
   for it and the palette hook is in place before the first colour arrives. */
(function () {
  "use strict";
  var d = document, root = window;
  var SHELF = "../puzzles.html";
  var KEYPAD = { solo: 9, keen: 9, towers: 9, unequal: 9, filling: 9, group: "abcdefgh" };
  var KEY_CODES = { Backspace: 8, Enter: 13 };
  var LONG_PRESS_MS = 450;     // a touch held this long, without moving, is a right press
  var LONG_PRESS_SLOP = 10;    // px a finger may drift and still be holding still
  var TWO_FINGER_MS = 350;     // two fingers down and up within this, without moving, are the middle button
  var NATIVE_QUIET_MS = 700;   // after a touch, the browser's own mouse events for it are dropped
  var SOLVED_SHEET_MS = 1000;  // the puzzle's own flash of success plays before the sheet comes
  var READY_POLL_MS = 50;      // how often to ask whether the puzzle's own script has started the game

  function el(tag, cls, text) {
    var e = d.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  function $(id) { return d.getElementById(id); }

  // Words go through ZimiText (shell.js loads it before this file); English is what shows when it or an id is missing. A label
  // made before the language file arrives is set again when it does.
  var labelled = [];
  function T(key, english, vars) {
    var Z = root.ZimiText;
    if (Z && Z.has(key)) return Z.T(key, vars);
    return english.replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] !== undefined ? vars[k] : m; });
  }
  function num(n) { return root.ZimiText ? root.ZimiText.number(+n) : String(n); }
  function setWord(w) { if (w[3]) w[0].setAttribute(w[3], T(w[1], w[2])); else w[0].textContent = T(w[1], w[2]); }
  // Gives node its words (its text, or the attribute attr), and keeps them in the player's language.
  function word(node, key, english, attr) {
    var w = [node, key, english, attr];
    labelled.push(w); setWord(w);
    return node;
  }
  if (root.ZimiText && root.ZimiText.onChange) root.ZimiText.onChange(function () { labelled.forEach(setWord); });

  // ── the palette ──────────────────────────────────────────────────────────
  // The frontend asks C for its colours one by one (js_set_colour) and stores them in the global `colours`. The puzzle
  // script declares `var colours = []`; with an accessor already on window, that declaration assigns through our setter,
  // and every colour the frontend stores goes through `remap` first. Greys become a ramp from Zimi's ink (black) to its
  // surface2 (white), so a light puzzle becomes a dark one by the same rule; the background is surface2; yellows are
  // amber; the other hues keep their meaning but are pulled toward neutral, and lifted in dark.
  var FALLBACK = {
    light: { ink: "#26241f", surface2: "#ffffff", error: [4, 0.62, 0.40] },
    dark: { ink: "#e8e8ed", surface2: "#1c1c20", error: [4, 0.78, 0.64] }
  };
  var AMBER_HUE = 38;
  // Puzzles whose colours are the game itself (which block is which): their hues are kept apart, never merged into amber or red.
  var CATEGORICAL = { flood: 1, samegame: 1, guess: 1, signpost: 1, map: 1, inertia: 1 };
  var NAME = root.location.pathname.split("/").pop().replace(".html", "");
  // A pure blue is not Zimi: it becomes one muted slate, except where the hue is the game. Where a puzzle uses a
  // color for "selected" or "the active thing", that color is amber. The numbers are colour indexes in that puzzle's palette.
  var SLATE = { light: [220, 0.30, 0.42], dark: [220, 0.42, 0.70] };
  var KEEP_BLUE = { flood: 1, samegame: 1, guess: 1, map: 1 };
  var ROLES = {
    pegs: { 4: "amber" },                                   // the cursor
    net: { 5: "amber" },                                    // the wires that are lit
    mines: { 1: "sunk", 20: "surface2", 21: "edge" },       // an opened square sinks into the page; a closed one is raised, with an ink edge
    pattern: { 4: "unknown" }                               // a square not yet decided sits just above the panel
  };
  var raw = [], mapped = [];
  function isDark() {
    var t = d.documentElement.getAttribute("data-theme");
    if (t) return t === "dark";
    return !!(root.matchMedia && root.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function token(name, fallback) {
    var v = root.getComputedStyle(d.documentElement).getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
  }
  function parse(hex) { return [1, 3, 5].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); }); }
  function toHex(rgb) { return "#" + rgb.map(function (v) { return ("0" + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join(""); }
  function mix(a, b, t) { return a.map(function (v, i) { return v + (b[i] - v) * t; }); }
  function toHsl(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, s = 0, h = 0;
    if (mx !== mn) {
      var dd = mx - mn;
      s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
      h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function fromHsl(h, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2, p;
    p = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return p.map(function (v) { return (v + m) * 255; });
  }
  function remap(index, hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
    var dark = isDark(), fb = FALLBACK[dark ? "dark" : "light"];
    var ink = parse(token("--ink", fb.ink)), ground = parse(token("--surface2", fb.surface2));
    var rgb = parse(hex), hsl = toHsl(rgb), h = hsl[0], s = hsl[1], l = hsl[2];
    if (index === 0) return toHex(ground);
    var role = (ROLES[NAME] || {})[index];
    if (role === "amber") return token("--select-ring", "#f59e0b");
    if (role === "sunk") return toHex(dark ? parse(token("--ground", "#0a0a0b")) : mix(parse(token("--ground", "#f2efe8")), ink, 0.1));
    if (role === "surface2") return toHex(ground);
    if (role === "edge") return toHex(mix(ink, ground, 0.3));
    if (role === "unknown") return toHex(mix(ground, ink, 0.16));
    if (!KEEP_BLUE[NAME] && s > 0.8 && h >= 225 && h <= 250 && l >= 0.4 && l <= 0.5) { var sl = SLATE[dark ? "dark" : "light"]; return toHex(fromHsl(sl[0], sl[1], sl[2])); }
    if (s < 0.12) return toHex(mix(ink, ground, (rgb[0] + rgb[1] + rgb[2]) / 765));      // grey: black is ink, white is surface2
    var plain = !CATEGORICAL[NAME];
    if (plain && s > 0.5 && (h <= 12 || h >= 348)) return toHex(fromHsl(fb.error[0], fb.error[1], fb.error[2]));   // errors are Zimi's red
    if (plain && s > 0.5 && h >= 38 && h <= 70) h = AMBER_HUE;                                    // yellow is amber
    if (dark) {
      l = 0.28 + 0.42 * l + (h >= 190 && h <= 260 ? 0.1 : 0);
      s *= 0.75;
    } else s *= 0.8;
    return toHex(fromHsl(h, s, l));
  }
  var colours = new Proxy(mapped, {
    set: function (t, k, v) {
      if (/^\d+$/.test(k)) { raw[+k] = v; t[k] = remap(+k, v); } else t[k] = v;
      return true;
    }
  });
  Object.defineProperty(root, "colours", { configurable: true, get: function () { return colours; }, set: function () { /* the puzzle's `var colours = []` */ } });
  function recolour() {
    raw.forEach(function (v, i) { mapped[i] = remap(i, v); });
    if (mapped[0]) d.documentElement.style.setProperty("--puzzle-background", mapped[0]);
    root.dispatchEvent(new Event("resize"));      // the puzzle redraws on a resize
  }
  var lastDark = isDark();
  function themeMayHaveChanged() { if (isDark() !== lastDark) { lastDark = isDark(); recolour(); } }
  if (root.MutationObserver) new MutationObserver(themeMayHaveChanged).observe(d.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  if (root.matchMedia) {
    var mq = root.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", themeMayHaveChanged);
  }

  // ── the page ─────────────────────────────────────────────────────────────
  function metaViewport() {
    if (d.querySelector('meta[name="viewport"]')) return;
    var m = el("meta");
    m.name = "viewport";
    m.content = "width=device-width, initial-scale=1, viewport-fit=cover";
    d.head.appendChild(m);
  }
  function puzzleName() { return d.title.replace(/ - ZimiGames$/, ""); }

  // The frontend finds its menu and buttons by id and clicks them itself, so they stay in the page, hidden. Ours are
  // proxies: they click the original, and follow its disabled state.
  var ORIGINALS = [["undo", "Undo", "pz-undo", "shell.undo"], ["restart", "Restart", "pz-restart", "pz.restart"], ["redo", "Redo", "pz-redo", "pz.redo"], ["solve", "Show solution", "pz-solve", "puzzles.showSolution"]];
  var staged = null;      // a Type chosen in the New game pane, applied by Start
  function proxy(orig, label, id, click, key) {
    var b = word(el("button", "ar-btn"), key, label);
    b.type = "button";
    b.id = id;
    function follow() {
      b.disabled = !!orig.disabled;
      b.setAttribute("aria-disabled", b.disabled ? "true" : "false");
    }
    follow();
    if (root.MutationObserver) new MutationObserver(follow).observe(orig, { attributes: true, attributeFilter: ["disabled"] });
    b.addEventListener("click", click || function () { orig.click(); });
    return b;
  }
  function buildBar() {
    var bar = el("header", "ar-bar zf-bar");
    var back = el("a", "ar-back", String.fromCharCode(0x2039));
    back.href = SHELF;
    word(back, "shell.back", "Back", "aria-label");
    bar.appendChild(back);
    bar.appendChild(el("h1", "", puzzleName()));
    ORIGINALS.forEach(function (o) {
      var orig = $(o[0]);
      if (orig) bar.appendChild(proxy(orig, o[1], o[2], null, o[3]));
    });
    // The shell hides this one and starts the game with it, from Menu > New game.
    var newOrig = $("new");
    if (newOrig) bar.appendChild(proxy(newOrig, "New game", "pz-new", startNew, "shell.menu.new"));
    d.body.insertBefore(bar, d.body.firstChild);
  }
  function startNew() {
    var radio = staged && $("gametype") && $("gametype").querySelector('input[name="preset"][value="' + staged + '"]');
    staged = null;
    if (radio && !radio.checked) radio.click(); else $("new").click();       // choosing a type starts a game of it
  }

  // ── Menu > New game: Type, then the Game rows ───────────────────────────
  function currentPreset() {
    var c = $("gametype") && $("gametype").querySelector('input[name="preset"]:checked');
    return c ? c.value : null;
  }
  // The words a game type is named with (its difficulty, "wrapping", "mines") in the player's language; sizes, grid names and
  // anything else the puzzle writes stay as the puzzle wrote them.
  var TYPE_WORDS = ["trivial", "easy", "tricky", "normal", "hard", "extreme", "unreasonable", "basic", "advanced", "medium", "intermediate", "standard", "wrapping", "mines"];
  var TYPE_WORD = new RegExp("\\b(" + TYPE_WORDS.join("|") + ")\\b", "gi");
  function typeLabel(text) {
    if (text === "Custom...") return T("pz.w.custom", "Custom...");
    return text.replace(TYPE_WORD, function (w) {
      var k = w.toLowerCase(), s = T("pz.w." + k, k);
      return w.charAt(0) === k.charAt(0) ? s : s.charAt(0).toUpperCase() + s.slice(1);
    });
  }
  function typeRows(list, into, depth) {
    Array.prototype.forEach.call(list.children, function (li) {
      var label = li.firstElementChild, sub = li.querySelector(":scope > label > ul, :scope > ul");
      var radio = li.querySelector(":scope > label > input.tick");
      var text = label ? typeLabel(label.textContent.replace(/\s+/g, " ").trim()) : "";
      if (radio) {
        var row = el("button", "ar-btn pz-opt", text);
        row.type = "button";
        row.setAttribute("aria-pressed", String((staged || currentPreset()) === radio.value));
        row.addEventListener("click", function () {
          staged = radio.value;
          Array.prototype.forEach.call(into.querySelectorAll(".pz-opt[data-type]"), function (r) { r.setAttribute("aria-pressed", String(r === row)); });
        });
        row.setAttribute("data-type", radio.value);
        into.appendChild(row);
      } else if (sub) {
        into.appendChild(el("h3", "pz-opt-head", text));
        typeRows(sub, into, depth + 1);
      }
    });
  }
  function gameRows() {
    var rows = [["specific", "Enter game ID…"], ["random", "Enter random seed…"], ["prefs", "Preferences…"], ["save", "Download save file…"], ["load", "Upload save file…"]];   // pz.<id> in the string table
    var box = el("div", "pz-game-rows");
    rows.forEach(function (r) {
      var orig = $(r[0]);
      if (!orig) return;
      var b = word(el("button", "ar-btn pz-opt"), "pz." + r[0], r[1]);
      b.type = "button";
      b.addEventListener("click", function () { if (root.ZimiShell) root.ZimiShell.closeMenu(); orig.click(); });
      box.appendChild(b);
    });
    return box;
  }
  function newGameOptions() {
    var nodes = [], types = $("gametype");
    staged = null;
    if (types && types.children.length) {
      var box = el("div", "pz-types");
      box.setAttribute("role", "group");
      word(box, "pz.type", "Type", "aria-label");
      box.appendChild(word(el("h3", "pz-opt-head"), "pz.type", "Type"));
      typeRows(types, box, 0);
      nodes.push(box);
    }
    var rows = gameRows();
    if (rows.children.length) {
      var wrap = el("div", "pz-games");
      wrap.appendChild(word(el("h3", "pz-opt-head"), "pz.game", "Game"));
      wrap.appendChild(rows);
      nodes.push(wrap);
    }
    return { options: nodes };
  }

  // ── the status line ──────────────────────────────────────────────────────
  // The frontend writes "Moves: 12" and such into #statusbar. We keep that element (the frontend needs it), hide it,
  // and show one sentence of what a player needs in the shared status style.
  // Each line the frontends write, in the player's language. The number-bearing ones are matched by their English shape.
  var STATUS = [
    [/\bMoves(?: since auto-solve)?: \d+\s*/g, function () { return ""; }],
    [/^COMPLETED!\s*/i, function () { return T("pz.solved", "Solved") + ". "; }],
    [/\bAuto-solve[dr]( used)?\.?/i, function () { return T("pz.solutionShown", "Solution shown") + "."; }],
    [/^\[(\d+:\d\d)\]\s*/, function (m, clock) { return clock + " · "; }],
    [/\bBalls marked: (\d+) \/ (\d+)-(\d+)\.?/, function (m, a, lo, hi) { return T("pz.ballsRange", "Balls marked: {a} of {lo} to {hi}", { a: num(a), lo: num(lo), hi: num(hi) }); }],
    [/\bBalls marked: (\d+) \/ (\d+)/, function (m, a, b) { return T("pz.balls", "Balls marked: {a} of {b}", { a: num(a), b: num(b) }); }],
    [/\bMarked: (\d+) \/ (\d+)/, function (m, a, b) { return T("pz.marked", "Marked: {a} of {b}", { a: num(a), b: num(b) }); }],
    [/\bActive: (\d+)\/(\d+)/, function (m, a, b) { return T("pz.active", "Active: {a} of {b}", { a: num(a), b: num(b) }); }],
    [/(\d+) \/ (\d+) moves/, function (m, a, b) { return T("pz.movesOf", "Moves: {a} of {b}", { a: num(a), b: num(b) }); }],
    [/\bGems: (\d+)/, function (m, n) { return T("pz.gems", "Gems: {n}", { n: num(n) }); }],
    [/\bDeaths: (\d+)/, function (m, n) { return T("pz.deaths", "Deaths: {n}", { n: num(n) }); }],
    [/\bDEAD!/, function () { return T("pz.dead", "Dead"); }],
    [/\bScore: (\d+)/, function (m, n) { return T("pz.score", "Score: {n}", { n: num(n) }); }],
    [/\bSelected: (\d+) \((\d+)\)/, function (m, a, b) { return T("pz.selected", "Selected: {a} ({b})", { a: num(a), b: num(b) }); }],
    [/\bWrong! Guess again\.?/, function () { return T("pz.wrong", "Wrong. Guess again"); }],
    [/\bCORRECT!/, function () { return T("pz.correct", "Correct"); }],
    [/ \((\d+) errors?\)/, function (m, n) { return " (" + T("pz.errors", "Errors: {n}", { n: num(n) }) + ")"; }],
    [/(\d+) wrong and (\d+) missed balls\.?/, function (m, a, b) { return T("pz.wrongMissed", "Wrong: {a}, missed: {b}", { a: num(a), b: num(b) }); }]
  ];
  function sayStatus(text) {
    STATUS.forEach(function (s) { text = text.replace(s[0], s[1]); });
    return text.replace(/\s+/g, " ").trim();
  }
  var solved = false;
  function watchStatus(frame) {
    var bar = $("statusbar");
    if (!bar) return;
    var line = el("div", "pz-status");
    line.setAttribute("role", "status");
    line.setAttribute("aria-live", "polite");
    frame.parentNode.insertBefore(line, frame.nextSibling);
    var first = true;
    function sync() {
      var raw = bar.textContent, t = sayStatus(raw), was = solved;
      solved = /^(\[\d+:\d\d\]\s*)?COMPLETED!/i.test(raw);
      // Solving it yourself is a win with a sheet; a game that comes back solved, or one the solver finished, is not.
      if (solved && !was && !first && !/Auto-solve/i.test(raw) && root.ZimiShell) {
        var clock = /^\[(\d+:\d\d)\]/.exec(raw);
        root.ZimiShell.endSheet({ result: "win", after: SOLVED_SHEET_MS, stats: clock ? [[T("play.time", "Time"), clock[1]]] : [] });
      }
      first = false;
      if (line.textContent !== t) line.textContent = t;
      line.hidden = !t;
    }
    sync();
    if (root.MutationObserver) new MutationObserver(sync).observe(bar, { childList: true, characterData: true, subtree: true });
  }

  // ── touch is the mouse ───────────────────────────────────────────────────
  // The frontend speaks mouse. A finger sends its mouse events only once it lifts, never while it drags, and it has no right
  // button; so a touch or pen press is translated here and the browser's own mouse events for it are dropped. A tap is a left
  // click; a finger that moves is a left drag; a finger held still for LONG_PRESS_MS is a right press (the frontend reads
  // ctrl as the right button), and if it then moves, a right drag. The left press is only sent once we know which it is.
  function touchIsMouse(canvas) {
    var press = null, quietUntil = 0;
    function mouse(type, e, ctrl, shift) {
      var ev = new MouseEvent(type, { bubbles: true, cancelable: true, view: root, button: 0, buttons: type === "mouseup" ? 0 : 1,
        clientX: e.x, clientY: e.y, screenX: e.sx, screenY: e.sy, ctrlKey: ctrl, shiftKey: !!shift });
      ev.zfTouch = true;
      canvas.dispatchEvent(ev);
    }
    function at(e) { return { x: e.clientX, y: e.clientY, sx: e.screenX, sy: e.screenY }; }
    function fire() {
      var p = press;
      if (!p || p.phase !== "wait") return;
      p.phase = "right";
      mouse("mousedown", p.start, true);
      if (navigator.vibrate) try { navigator.vibrate(10); } catch (err) { /* not allowed */ }
    }
    canvas.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse") return;
      quietUntil = Infinity;
      if (!e.isPrimary) {
        // A second finger while the first is still waiting: this may be a two-finger tap (the frontend reads shift as the middle button).
        if (press && press.phase === "wait") { root.clearTimeout(press.timer); press.phase = "two"; press.two = Date.now(); }
        return;
      }
      press = { id: e.pointerId, start: at(e), phase: "wait", timer: root.setTimeout(fire, LONG_PRESS_MS) };
    });
    canvas.addEventListener("pointermove", function (e) {
      var p = press;
      if (!p || (e.pointerId !== p.id && p.phase !== "two")) return;
      var here = at(e);
      if (p.phase === "two") { if (e.pointerId === p.id && Math.hypot(here.x - p.start.x, here.y - p.start.y) > LONG_PRESS_SLOP) press = null; return; }
      if (p.phase === "wait" && Math.hypot(here.x - p.start.x, here.y - p.start.y) > LONG_PRESS_SLOP) {
        root.clearTimeout(p.timer);
        p.phase = "left";
        mouse("mousedown", p.start, false);
      }
      if (p.phase !== "wait") mouse("mousemove", here, p.phase === "right");
    });
    function end(e, cancelled) {
      var p = press;
      if (e.pointerType === "mouse") return;
      quietUntil = Date.now() + NATIVE_QUIET_MS;
      if (!p || e.pointerId !== p.id) return;
      press = null;
      root.clearTimeout(p.timer);
      if (p.phase === "two") {
        if (!cancelled && Date.now() - p.two < TWO_FINGER_MS) { mouse("mousedown", p.start, false, true); mouse("mouseup", p.start, false, true); }
        return;
      }
      var here = at(e);
      if (p.phase === "wait") {
        if (cancelled) return;
        mouse("mousedown", p.start, false);
        mouse("mouseup", p.start, false);
      } else mouse("mouseup", here, p.phase === "right");
    }
    canvas.addEventListener("pointerup", function (e) { end(e, false); });
    canvas.addEventListener("pointercancel", function (e) { end(e, true); });
    ["mousedown", "mousemove", "mouseup", "click"].forEach(function (t) {
      canvas.addEventListener(t, function (ev) {
        if (!ev.zfTouch && ev.isTrusted && Date.now() < quietUntil) { ev.stopImmediatePropagation(); ev.preventDefault(); }
      }, true);
    });
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  // ── digits ───────────────────────────────────────────────────────────────
  function sendKey(canvas, key) {
    var code = KEY_CODES[key] || key.toUpperCase().charCodeAt(0);
    var init = { key: key, keyCode: code, which: code, bubbles: true, cancelable: true };
    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent("keydown", init));
    canvas.dispatchEvent(new KeyboardEvent("keyup", init));
  }
  function keypad(canvas, name, into) {
    var spec = KEYPAD[name];
    if (!spec) return;
    var keys = el("div", "zf-keys");
    keys.setAttribute("role", "group");
    word(keys, "pz.keypad", "Keypad", "aria-label");
    var labels = typeof spec === "number" ? "123456789".slice(0, spec).split("") : spec.split("");
    labels.concat(["Backspace"]).forEach(function (k) {
      var b = el("button", "ar-btn", k === "Backspace" ? String.fromCharCode(0x232b) : k);
      b.type = "button";
      if (k === "Backspace") word(b, "pz.clear", "Clear", "aria-label"); else b.setAttribute("aria-label", k);
      b.onpointerdown = function (e) { e.preventDefault(); };
      b.onclick = function () { sendKey(canvas, k); };
      keys.appendChild(b);
    });
    into.appendChild(keys);
  }

  // ── never lose a game ────────────────────────────────────────────────────
  // The frontend can serialise the whole game (the same text Game > Download save file writes: parameters, the moves, the
  // place in the history). ZimiShell.persist keeps that text on leaving and after every move, and puts it back with the
  // frontend's own loader, so an opened puzzle is the one that was left, undo history and all.
  var encoder = root.TextEncoder ? new root.TextEncoder() : null;
  function saveText() {
    var cw = root.Module && root.Module.cwrap;
    if (!cw || typeof root.UTF8ToString !== "function") return null;
    var ptr = cw("get_save_file", "number", [])();
    var text = root.UTF8ToString(ptr);
    cw("free_save_file", "void", ["number"])(ptr);
    return text;
  }
  function loadText(text) {
    var bytes = encoder.encode(text), pos = 0;
    root.savefile_read_callback = function (buf, len) {
      if (pos + len > bytes.length) return false;
      root.writeArrayToMemory(new Int8Array(bytes.buffer, pos, len), buf);
      pos += len;
      return true;
    };
    try { root.Module.cwrap("load_game", "void", [])(); } finally { root.savefile_read_callback = null; }
  }
  function canMove(id) { var b = $(id); return !!b && !b.disabled; }
  function persistGame() {
    root.ZimiShell.persist({
      // Nothing to keep until a move has been made (or taken back: the redo is part of the game).
      save: function () { return canMove("undo") || canMove("redo") ? { sav: saveText() } : null; },
      load: function (data) {
        // A link to one particular game (#id) is that game, not the one left behind.
        if (!data || typeof data.sav !== "string" || !encoder || root.location.hash) return false;
        loadText(data.sav);
        return true;
      }
    });
  }
  function whenRunning(fn) {
    var timer = root.setInterval(function () {
      var shown = $("puzzle") && $("puzzle").style.display !== "none";
      if (typeof root.command !== "function" || !shown) return;
      root.clearInterval(timer);
      fn();
    }, READY_POLL_MS);
  }

  // ── start ────────────────────────────────────────────────────────────────
  function fitBox() {
    var frame = el("div", "gs-frame pz-frame");
    var box = el("div");
    box.id = "puzzlecanvascontain";
    var resizable = $("resizable");
    resizable.parentNode.insertBefore(frame, resizable);
    frame.appendChild(box);
    box.appendChild(resizable);
    return frame;
  }
  function start() {
    metaViewport();
    if (navigator.maxTouchPoints > 0 || root.matchMedia("(pointer: coarse)").matches) d.documentElement.classList.add("zf-touch");
    var canvas = $("puzzlecanvas");
    if (!canvas) return;
    buildBar();
    var frame = fitBox();
    watchStatus(frame);
    touchIsMouse(canvas);
    keypad(canvas, root.location.pathname.split("/").pop().replace(".html", ""), frame.parentNode);
    if (root.ZimiShell) {
      root.ZimiShell.game({
        // A game is under way once a move can be undone, until it is solved.
        inProgress: function () { var u = $("undo"); return !!u && !u.disabled && !solved; },
        menu: newGameOptions
      });
      whenRunning(persistGame);
    }
  }
  start();
})();
