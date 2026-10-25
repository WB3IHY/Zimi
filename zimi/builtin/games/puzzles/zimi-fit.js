/* ZimiGames: the one script every puzzle page loads before its own.
   It runs before the puzzle's script (both are deferred, in order), so the
   fit box exists when the puzzle looks for it. It never touches puzzle code:
   it wraps the canvas in the box the puzzle already knows how to fit to, adds
   a back bar, a tap-mode button (touch has no right click) and a keypad for
   the puzzles that take digits. */
(function () {
  "use strict";
  var SHELF = "../puzzles.html";
  var KEYPAD = { solo: 9, keen: 9, towers: 9, unequal: 9, filling: 9, group: "abcdefgh" };
  var TAP_MODES = [["Tap: left", 0], ["Tap: right", 2], ["Tap: middle", 1]];
  var KEY_CODES = { Backspace: 8, Enter: 13 };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  function metaViewport() {
    if (document.querySelector('meta[name="viewport"]')) return;
    var m = el("meta");
    m.name = "viewport";
    m.content = "width=device-width, initial-scale=1, viewport-fit=cover";
    document.head.appendChild(m);
  }
  function puzzleName() {
    var h = document.querySelector("body > h1");
    return h ? h.textContent.trim() : document.title.split(",")[0];
  }
  function backBar() {
    var bar = el("header", "ar-bar zf-bar");
    var back = el("a", "ar-back", String.fromCharCode(0x2039));
    back.href = SHELF;
    back.setAttribute("aria-label", "Back to the puzzles");
    bar.appendChild(back);
    bar.appendChild(el("h1", "", puzzleName()));
    var help = document.querySelector('a[href^="doc/"]');
    if (help) {
      var rules = el("a", "ar-btn", "Rules");
      rules.href = help.getAttribute("href");
      rules.style.display = "inline-flex";
      rules.style.alignItems = "center";
      rules.style.textDecoration = "none";
      bar.appendChild(rules);
    }
    document.body.insertBefore(bar, document.body.firstChild);
  }
  function fitBox() {
    var box = el("div");
    box.id = "puzzlecanvascontain";
    var resizable = document.getElementById("resizable");
    resizable.parentNode.insertBefore(box, resizable);
    box.appendChild(resizable);
  }
  function tapMode(canvas, tools) {
    var mode = 0;
    var btn = el("button", "ar-btn", TAP_MODES[0][0]);
    btn.type = "button";
    btn.setAttribute("aria-label", "Which button a tap presses");
    btn.onclick = function () {
      mode = (mode + 1) % TAP_MODES.length;
      btn.textContent = TAP_MODES[mode][0];
      btn.setAttribute("aria-pressed", mode ? "true" : "false");
    };
    // The puzzle reads ctrl as "right button" and shift as "middle" on a mouse
    // down; a tap in a non-left mode is replayed with that modifier.
    canvas.addEventListener("mousedown", function (ev) {
      if (!mode || ev.zfReplay || ev.button !== 0) return;
      ev.stopImmediatePropagation();
      ev.preventDefault();
      var again = new MouseEvent("mousedown", {
        bubbles: true, cancelable: true, view: window, button: 0, buttons: 1,
        clientX: ev.clientX, clientY: ev.clientY, screenX: ev.screenX, screenY: ev.screenY,
        ctrlKey: TAP_MODES[mode][1] === 2, shiftKey: TAP_MODES[mode][1] === 1,
      });
      again.zfReplay = true;
      canvas.dispatchEvent(again);
    }, true);
    tools.appendChild(btn);
  }
  function sendKey(canvas, key) {
    var code = KEY_CODES[key] || key.toUpperCase().charCodeAt(0);
    var init = { key: key, keyCode: code, which: code, bubbles: true, cancelable: true };
    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent("keydown", init));
    canvas.dispatchEvent(new KeyboardEvent("keyup", init));
  }
  function keypad(canvas, name) {
    var spec = KEYPAD[name];
    if (!spec) return;
    var keys = el("div", "zf-tools zf-keys");
    keys.setAttribute("role", "group");
    keys.setAttribute("aria-label", "Keypad");
    var labels = typeof spec === "number" ? "123456789".slice(0, spec).split("") : spec.split("");
    labels.concat(["Backspace"]).forEach(function (k) {
      var b = el("button", "ar-btn", k === "Backspace" ? String.fromCharCode(0x232b) : k.toUpperCase());
      b.type = "button";
      b.setAttribute("aria-label", k === "Backspace" ? "Clear" : k);
      b.onpointerdown = function (e) { e.preventDefault(); };
      b.onclick = function () { sendKey(canvas, k); };
      keys.appendChild(b);
    });
    canvas.closest("main").appendChild(keys);
  }
  function start() {
    metaViewport();
    if (navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches) document.documentElement.classList.add("zf-touch");
    var canvas = document.getElementById("puzzlecanvas");
    if (!canvas) return;
    backBar();
    fitBox();
    var tools = el("div", "zf-tools");
    tapMode(canvas, tools);
    canvas.closest("main").appendChild(tools);
    keypad(canvas, location.pathname.split("/").pop().replace(".html", ""));
  }
  start();
})();
