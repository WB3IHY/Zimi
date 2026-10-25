/* ZimiGames: the page shell the world board games share (new-game sheet built from a
   description, settings and win/loss stats in localStorage, status line, undo, hint,
   the computer's turn, the result sheet, and buttons laid over a drawn board).
   Our own code, GPL-3.0. Needs boardkit.js first. No network, no modules. */
(function (root) {
  'use strict';
  var BK = root.BoardKit;
  var COMPUTER_DELAY_MS = 420;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // The usual options: who you play against, how strong, which side.
  function standardOptions(opts) {
    opts = opts || {};
    var out = [{ key: 'mode', legend: 'Opponent', def: 'cpu', choices: [['cpu', 'Computer'], ['two', 'Two players']] }];
    out.push({ key: 'level', legend: 'Level', def: 'medium', cpuOnly: true, choices: [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']].concat(opts.levels || []) });
    if (opts.side !== false) out.push({ key: 'side', legend: 'You play', def: 'first', cpuOnly: true, choices: [['first', opts.first || 'First'], ['second', opts.second || 'Second']] });
    return out;
  }

  // cfg: { id, options:[{key,legend,choices,def,cpuOnly}], checks:[{key,label,def}], statKey(settings),
  //        onNew(settings), onUndo(), onHint() }
  function create(cfg) {
    var $ = function (id) { return document.getElementById(id); };
    var SETTINGS_KEY = cfg.id + '.settings', STATS_KEY = cfg.id + '.stats';
    var settings = BK.load(SETTINGS_KEY, {}), stats = BK.load(STATS_KEY, {});
    var options = cfg.options || standardOptions(), checks = cfg.checks || [];
    options.forEach(function (o) {
      var ok = o.choices.some(function (c) { return c[0] === settings[o.key]; });
      if (!ok) settings[o.key] = o.def;
    });
    checks.forEach(function (c) { if (typeof settings[c.key] !== 'boolean') settings[c.key] = c.def; });

    var G = { settings: settings, thinking: 0, over: false };
    var els = { status: $('wk-status'), stats: $('wk-stats'), undo: $('wk-undo'), hint: $('wk-hint') };

    // ── the sheets, built from the description ──
    var menuHost = el('div', 'ar-sheet'), resHost = el('div', 'ar-sheet');
    menuHost.hidden = resHost.hidden = true;
    menuHost.setAttribute('role', 'dialog'); menuHost.setAttribute('aria-modal', 'true'); menuHost.setAttribute('aria-labelledby', 'wk-menu-title');
    resHost.setAttribute('role', 'dialog'); resHost.setAttribute('aria-modal', 'true'); resHost.setAttribute('aria-labelledby', 'wk-res-title');
    var card = el('div', 'ar-sheet-card');
    card.appendChild(el('h2', null, 'New game')).id = 'wk-menu-title';
    var groups = {};
    options.forEach(function (o) {
      var f = el('fieldset', 'bg-field'), chips = el('div', 'bg-chips');
      f.appendChild(el('legend', null, o.legend));
      o.choices.forEach(function (c) {
        var lab = el('label', 'bg-chip'), inp = document.createElement('input');
        inp.type = 'radio'; inp.name = 'wk-' + o.key; inp.value = c[0];
        lab.appendChild(inp); lab.appendChild(el('span', null, c[1])); chips.appendChild(lab);
      });
      f.appendChild(chips); card.appendChild(f);
      groups[o.key] = { fieldset: f, chips: chips, opt: o };
    });
    var boxes = {};
    checks.forEach(function (c) {
      var lab = el('label', 'bg-check'), inp = document.createElement('input');
      inp.type = 'checkbox'; lab.appendChild(inp); lab.appendChild(document.createTextNode(' ' + c.label));
      card.appendChild(lab); boxes[c.key] = inp;
    });
    var actions = el('div', 'ar-sheet-actions'), cancel = el('button', 'ar-btn', 'Cancel'), start = el('button', 'ar-btn', 'Start');
    cancel.type = start.type = 'button'; start.setAttribute('aria-pressed', 'true');
    actions.appendChild(cancel); actions.appendChild(start); card.appendChild(actions); menuHost.appendChild(card);

    var rcard = el('div', 'ar-sheet-card'), rtext = el('p');
    rcard.appendChild(el('h2', null, 'Game over')).id = 'wk-res-title';
    rcard.appendChild(rtext);
    var ract = el('div', 'ar-sheet-actions'), rclose = el('button', 'ar-btn', 'Look at the board'), ragain = el('button', 'ar-btn', 'Play again');
    rclose.type = ragain.type = 'button'; ragain.setAttribute('aria-pressed', 'true');
    ract.appendChild(rclose); ract.appendChild(ragain); rcard.appendChild(ract); resHost.appendChild(rcard);
    document.body.appendChild(menuHost); document.body.appendChild(resHost);
    var menu = BK.sheet(menuHost), result = BK.sheet(resHost);

    function twoPlayers() { return BK.chipValue(groups.mode.chips) === 'two'; }
    function refreshMenu() {
      var two = groups.mode && twoPlayers();
      Object.keys(groups).forEach(function (k) {
        var g = groups[k], off = g.opt.cpuOnly && two;
        g.fieldset.disabled = off; g.fieldset.style.opacity = off ? 0.45 : 1;
      });
    }
    function syncMenu() {
      Object.keys(groups).forEach(function (k) { BK.chipSet(groups[k].chips, settings[k]); });
      Object.keys(boxes).forEach(function (k) { boxes[k].checked = settings[k]; });
      refreshMenu();
    }
    function openMenu() { syncMenu(); menu.open(); }
    if (groups.mode) groups.mode.chips.addEventListener('change', refreshMenu);
    cancel.addEventListener('click', menu.close);
    start.addEventListener('click', function () {
      Object.keys(groups).forEach(function (k) { var v = BK.chipValue(groups[k].chips); if (v) settings[k] = v; });
      Object.keys(boxes).forEach(function (k) { settings[k] = boxes[k].checked; });
      BK.save(SETTINGS_KEY, settings);
      menu.close(); G.newGame();
    });
    ragain.addEventListener('click', function () { G.newGame(); });
    rclose.addEventListener('click', function () { result.close(); });

    // ── the page's parts ──
    G.vsComputer = function () { return settings.mode !== 'two'; };
    // Is the player to move (0 first, 1 second) a person at this screen?
    G.watching = null;   // Watch and learn: the driver's controller while a demo runs
    G.human = function (p) { if (G.watching) return false; return !G.vsComputer() || (settings.side === 'second' ? 1 : 0) === p; };
    G.say = function (text, busy) {
      // While a demo runs nobody is "thinking": the narration above says what is happening.
      if (G.watching && /^(Computer is thinking|Thinking about)/.test(text)) { text = 'Watching'; busy = false; }
      els.status.textContent = '';
      if (busy) els.status.appendChild(el('span', 'bg-spin'));
      els.status.appendChild(document.createTextNode(text));
    };
    // The two sides' names on screen: "You" and "Computer" against the machine.
    G.names = function (a, b) {
      if (G.watching || !G.vsComputer()) return [a, b];
      return settings.side === 'second' ? ['Computer', 'You'] : ['You', 'Computer'];
    };
    G.who = function (p, a, b) { return G.names(a, b)[p]; };
    // The level as the chip calls it, in lower case (a level can be shown under a different name than its key).
    function levelName() {
      var o = options.filter(function (x) { return x.key === 'level'; })[0], c = o && o.choices.filter(function (x) { return x[0] === settings.level; })[0];
      return c ? c[1].toLowerCase() : settings.level;
    }
    G.showStats = function () {
      var s = stats[cfg.statKey ? cfg.statKey(settings) : settings.level];
      s = s || { w: 0, l: 0, d: 0 };
      els.stats.textContent = G.vsComputer() ? 'vs ' + levelName() + ': ' + s.w + ' won, ' + s.l + ' lost, ' + s.d + ' drawn' : 'Two players on this device';
    };
    G.setUndo = function (on) { if (els.undo) els.undo.disabled = !on || !!G.thinking; };
    G.setHint = function (on) { if (els.hint) els.hint.disabled = !on || !!G.thinking || G.over; };

    // The computer's turn runs later, so the screen shows the person's move first. A new
    // game or an undo cancels it (the token no longer matches).
    var seq = 0;
    G.later = function (fn, ms) {
      var token = G.begin();
      setTimeout(function () {
        if (token !== G.thinking) return;
        G.thinking = 0; fn();
      }, ms == null ? COMPUTER_DELAY_MS : ms);
    };
    // An asynchronous computer move (a worker): the caller says when it is done.
    G.begin = function () { G.thinking = ++seq; return G.thinking; };
    G.current = function (token) { return token === G.thinking; };
    G.done = function (token) { if (token === G.thinking) { G.thinking = 0; return true; } return false; };
    G.cancel = function () { seq++; G.thinking = 0; };

    // outcome: 'w' (a person won against the computer), 'l', 'd', or undefined (not recorded)
    G.finish = function (msg, outcome, title) {
      G.over = true;
      if (els.hint) els.hint.disabled = true;
      if (root.ZimiShell) root.ZimiShell.turn(false);
      if (G.watching) { G.say(msg); G.watching.finish(msg + ' That was the whole game. Press Done to play one yourself.'); return; }
      if (G.vsComputer() && outcome) {
        var key = cfg.statKey ? cfg.statKey(settings) : settings.level;
        var s = stats[key] = stats[key] || { w: 0, l: 0, d: 0 };
        s[outcome]++; BK.save(STATS_KEY, stats);
      }
      G.say(msg); G.showStats();
      rtext.textContent = msg;
      document.getElementById('wk-res-title').textContent = title || 'Game over';
      result.open(ragain);
    };
    G.newGame = function () {
      G.cancel(); G.over = false; result.close();
      G.showStats();
      cfg.onNew(settings);
    };
    // The move timer: a person's turn starts (or the turn is not a person's), and what to do at zero.
    G.turnTimer = function (active, onExpire) { if (root.ZimiShell) root.ZimiShell.turn(active && !G.watching && !G.over, onExpire); };
    // Watch and learn, the part every page shares. def: { script, unit, intro, level, side (the
    // side that moves first, 'first'), whoseTurn() -> 0 or 1, busy() -> true while a move is
    // animating, resume() repaints and carries on after a takeover, hint, stats }.
    G.registerWatch = function (def) {
      if (!root.ZimiShell) return;
      var saved = null;
      root.ZimiShell.game({
        watch: {
          script: def.script, unit: def.unit,
          start: function (ctl) {
            saved = { mode: settings.mode, level: settings.level, side: settings.side };
            // options that would stop a demo (the doubling cube waits for a person's answer)
            Object.keys(def.override || {}).forEach(function (k) { saved[k] = settings[k]; settings[k] = def.override[k]; });
            settings.mode = 'cpu'; settings.level = def.level || 'medium'; settings.side = 'first';
            G.watching = ctl; G.newGame();
            ctl.say(def.intro);
          },
          // takeover: you play whoever is to move; stop: a fresh game; new: the New game sheet follows.
          stop: function (kind) {
            var ctl = G.watching; G.watching = null;
            function restore() { Object.keys(saved).forEach(function (k) { settings[k] = saved[k]; }); }
            function settle() {
              if (def.busy && def.busy()) { setTimeout(settle, 100); return; }
              G.cancel();
              var turn = def.whoseTurn();
              if (kind === 'takeover') { restore(); settings.mode = 'cpu'; settings.side = turn === 0 ? 'first' : 'second'; def.resume(); }
              else { restore(); if (kind === 'stop') G.newGame(); }
            }
            if (ctl) settle();
          }
        }
      });
    };
    if (root.ZimiShell) root.ZimiShell.game({
      stats: function () {
        var s = stats[cfg.statKey ? cfg.statKey(settings) : settings.level] || { w: 0, l: 0, d: 0 };
        return G.vsComputer() ? 'Against the computer, ' + settings.level + ': ' + s.w + ' won, ' + s.l + ' lost, ' + s.d + ' drawn' : 'Two players on this device';
      }
    });
    G.openMenu = openMenu;
    G.closeResult = result.close;

    $('wk-new').addEventListener('click', openMenu);
    if (els.undo) els.undo.addEventListener('click', function () { if (!els.undo.disabled && cfg.onUndo) cfg.onUndo(); });
    if (els.hint) {
      if (!cfg.onHint) els.hint.hidden = true;
      else els.hint.addEventListener('click', function () { if (!els.hint.disabled) cfg.onHint(); });
    }
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('.ar-sheet,input')) return;
      var k = e.key.toLowerCase();
      if (k === 'n') openMenu();
      else if (k === 'u' && els.undo && !els.undo.disabled && cfg.onUndo) cfg.onUndo();
      else if (k === 'h' && els.hint && !els.hint.disabled && cfg.onHint) cfg.onHint();
    });
    return G;
  }

  // Buttons laid over a drawn board, one per place a person can tap or reach with the keys.
  // pts: [{x, y, w, h, label}] in the drawing's units (W by H); arrows move to the nearest
  // place in that direction. Returns the buttons.
  var DIRVEC = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  function overlay(host, W, H, pts, onPick, cls) {
    var btns = [];
    pts.forEach(function (p, i) {
      var b = el('button', 'wk-pt' + (cls ? ' ' + cls : ''));
      b.type = 'button'; b.dataset.i = i;
      var w = p.w, h = p.h || p.w;
      b.style.left = ((p.x - w / 2) / W * 100) + '%'; b.style.top = ((p.y - h / 2) / H * 100) + '%';
      b.style.width = (w / W * 100) + '%'; b.style.height = (h / H * 100) + '%';
      b.tabIndex = i ? -1 : 0;
      b.addEventListener('click', function () { onPick(i); });
      b.addEventListener('focus', function () { btns.forEach(function (o) { o.tabIndex = o === b ? 0 : -1; }); });
      host.appendChild(b); btns.push(b);
    });
    host.addEventListener('keydown', function (e) {
      var d = DIRVEC[e.key], cur = btns.indexOf(document.activeElement);
      if (!d || cur < 0 || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      var c = pts[cur], best = -1, bestCost = Infinity;
      pts.forEach(function (p, i) {
        if (i === cur) return;
        var dx = p.x - c.x, dy = p.y - c.y, along = dx * d[0] + dy * d[1], across = Math.abs(dx * d[1] - dy * d[0]);
        if (along <= 0) return;
        var cost = along + across * 2.2;
        if (cost < bestCost) { bestCost = cost; best = i; }
      });
      if (best >= 0) btns[best].focus();
    });
    return btns;
  }

  // The row above the board: who is who (a colour dot and a name), a number each, and a ring
  // round whoever is to move. defs: [{color}]; update(names, values, turnIndex).
  function scoreBar(host, defs) {
    host.textContent = '';
    var parts = defs.map(function (d) {
      var s = el('span', 'wk-who'), dot = el('i', 'wk-pip'), name = el('span'), b = el('b');
      if (d.color) dot.style.background = d.color;
      if (d.border) dot.style.borderColor = d.border;
      s.appendChild(dot); s.appendChild(name); s.appendChild(b); host.appendChild(s);
      return { s: s, name: name, b: b };
    });
    return function (names, values, turn) {
      parts.forEach(function (p, i) {
        p.name.textContent = names[i];
        p.b.textContent = values && values[i] != null ? values[i] : '';
        p.s.classList.toggle('turn', i === turn);
      });
    };
  }

  // Gradients for round stones (Go, Gomoku, Morris): fill="url(#wk-stone-b)" and "...-w".
  var STONE_DEFS = '<defs><radialGradient id="wk-stone-b" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#5a6275"/><stop offset="0.55" stop-color="#1c222d"/><stop offset="1" stop-color="#090b10"/></radialGradient>' +
    '<radialGradient id="wk-stone-w" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#ece8dc"/><stop offset="1" stop-color="#b9b3a2"/></radialGradient></defs>';

  // A flat undo stack of snapshots (the snapshot is whatever the game hands in).
  function History() { var h = []; return { push: function (s) { h.push(s); }, pop: function () { return h.pop(); }, clear: function () { h.length = 0; }, size: function () { return h.length; }, last: function () { return h[h.length - 1]; } }; }

  // Fisher-Yates with a given random function.
  function shuffle(a, rnd) {
    for (var i = a.length - 1; i > 0; i--) { var j = (rnd() * (i + 1)) | 0, t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function pick(a, rnd) { return a[(rnd() * a.length) | 0]; }

  // Wait for the page's frame before heavy work, so a "thinking" line gets painted first.
  function afterPaint(fn) { setTimeout(fn, 30); }

  root.WorldKit = { create: create, standardOptions: standardOptions, overlay: overlay, History: History, scoreBar: scoreBar, STONE_DEFS: STONE_DEFS, shuffle: shuffle, pick: pick, afterPaint: afterPaint, el: el };
})(typeof globalThis !== 'undefined' ? globalThis : this);
