/* ZimiGames: the one script every puzzle page loads before its own.
   It never touches puzzle code. Simon Tatham's frontend keeps its own menu form and its own colours; this
   script makes the page an ordinary ZimiGames page around them:
     - it builds the game's bar (Back, title, Undo) and hands the shell (../shell.js) the rest: Restart, Redo and
       Show solution go to the Menu, Game and Type go to Menu > New game, the rules are How to play (games-help.js);
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
  var NATIVE_QUIET_MS = 700;   // after a touch, the browser's own mouse events for it are dropped

  function el(tag, cls, text) {
    var e = d.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  function $(id) { return d.getElementById(id); }

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
  var ORIGINALS = [["undo", "Undo", "pz-undo"], ["restart", "Restart", "pz-restart"], ["redo", "Redo", "pz-redo"], ["solve", "Show solution", "pz-solve"]];
  var staged = null;      // a Type chosen in the New game pane, applied by Start
  function proxy(orig, label, id, click) {
    var b = el("button", "ar-btn", label);
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
    back.setAttribute("aria-label", "Back");
    bar.appendChild(back);
    bar.appendChild(el("h1", "", puzzleName()));
    ORIGINALS.forEach(function (o) {
      var orig = $(o[0]);
      if (orig) bar.appendChild(proxy(orig, o[1], o[2]));
    });
    // The shell hides this one and starts the game with it, from Menu > New game.
    var newOrig = $("new");
    if (newOrig) bar.appendChild(proxy(newOrig, "New game", "pz-new", startNew));
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
  function typeRows(list, into, depth) {
    Array.prototype.forEach.call(list.children, function (li) {
      var label = li.firstElementChild, sub = li.querySelector(":scope > label > ul, :scope > ul");
      var radio = li.querySelector(":scope > label > input.tick");
      var text = label ? label.textContent.replace(/\s+/g, " ").trim() : "";
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
    var rows = [["specific", "Enter game ID…"], ["random", "Enter random seed…"], ["prefs", "Preferences…"], ["save", "Download save file…"], ["load", "Upload save file…"]];
    var box = el("div", "pz-game-rows");
    rows.forEach(function (r) {
      var orig = $(r[0]);
      if (!orig) return;
      var b = el("button", "ar-btn pz-opt", r[1]);
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
      box.setAttribute("aria-label", "Type");
      box.appendChild(el("h3", "pz-opt-head", "Type"));
      typeRows(types, box, 0);
      nodes.push(box);
    }
    var rows = gameRows();
    if (rows.children.length) {
      var wrap = el("div", "pz-games");
      wrap.appendChild(el("h3", "pz-opt-head", "Game"));
      wrap.appendChild(rows);
      nodes.push(wrap);
    }
    return { options: nodes };
  }

  // ── the status line ──────────────────────────────────────────────────────
  // The frontend writes "Moves: 12" and such into #statusbar. We keep that element (the frontend needs it), hide it,
  // and show one sentence of what a player needs in the shared status style.
  function sayStatus(text) {
    return text
      .replace(/\bMoves: \d+\s*/g, "")
      .replace(/^COMPLETED!\s*/i, "Solved. ")
      .replace(/\bAuto-solved\.?/i, "Solution shown.")
      .replace(/^\[(\d+:\d\d)\]\s*/, "$1 · ")
      .replace(/\s+/g, " ")
      .trim();
  }
  var solved = false;
  function watchStatus(frame) {
    var bar = $("statusbar");
    if (!bar) return;
    var line = el("div", "pz-status");
    line.setAttribute("role", "status");
    line.setAttribute("aria-live", "polite");
    frame.parentNode.insertBefore(line, frame.nextSibling);
    function sync() {
      var t = sayStatus(bar.textContent);
      solved = /^Solved\b/.test(t);
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
    function mouse(type, e, ctrl) {
      var ev = new MouseEvent(type, { bubbles: true, cancelable: true, view: root, button: 0, buttons: type === "mouseup" ? 0 : 1,
        clientX: e.x, clientY: e.y, screenX: e.sx, screenY: e.sy, ctrlKey: ctrl });
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
      if (!e.isPrimary) return;
      press = { id: e.pointerId, start: at(e), phase: "wait", timer: root.setTimeout(fire, LONG_PRESS_MS) };
    });
    canvas.addEventListener("pointermove", function (e) {
      var p = press;
      if (!p || e.pointerId !== p.id) return;
      var here = at(e);
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
    keys.setAttribute("aria-label", "Keypad");
    var labels = typeof spec === "number" ? "123456789".slice(0, spec).split("") : spec.split("");
    labels.concat(["Backspace"]).forEach(function (k) {
      var b = el("button", "ar-btn", k === "Backspace" ? String.fromCharCode(0x232b) : k);
      b.type = "button";
      b.setAttribute("aria-label", k === "Backspace" ? "Clear" : k);
      b.onpointerdown = function (e) { e.preventDefault(); };
      b.onclick = function () { sendKey(canvas, k); };
      keys.appendChild(b);
    });
    into.appendChild(keys);
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
    }
  }
  start();
})();
