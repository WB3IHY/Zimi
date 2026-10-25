/* ZimiGames: Liar's Dice. Our own code, GPL-3.0. No network, no fonts, no modules.
   Bidding in the Perudo manner: ones are wild unless they are what is bid on; bids on ones count half.
   The rules (pure functions, no DOM, so node can test them) and the page (only when there is a document). */
(function (root) {
  'use strict';

  // ── the rules ────────────────────────────────────────────────────────────
  var START_DICE = 5, MIN_PLAYERS = 2, MAX_PLAYERS = 6, FACES = 6;
  var NAMES = ['You', 'Ada', 'Bram', 'Cleo', 'Dov', 'Esme'];

  function mulberry(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function createGame(n, seed) {
    n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, n || 3));
    var rng = mulberry(seed === undefined ? Math.floor(Math.random() * 4294967296) : seed);
    var players = [];
    for (var i = 0; i < n; i++) {
      // Each computer has a temperament: how readily it calls, how often it bluffs.
      players.push({ name: NAMES[i], ai: i > 0, n: START_DICE, dice: [], calls: 0.22 + rng() * 0.16, bluff: 0.08 + rng() * 0.2 });
    }
    var g = { players: players, turn: 0, starter: 0, bid: null, over: false, winner: -1, rng: rng, round: 1, last: null };
    rollAll(g);
    return g;
  }

  function rollAll(g) {
    g.players.forEach(function (p) { p.dice = []; for (var i = 0; i < p.n; i++) p.dice.push(1 + Math.floor(g.rng() * FACES)); });
  }
  function totalDice(g) { return g.players.reduce(function (a, p) { return a + p.n; }, 0); }
  function alive(g) { return g.players.map(function (p, i) { return i; }).filter(function (i) { return g.players[i].n > 0; }); }
  function nextAlive(g, i) { var k = i; do { k = (k + 1) % g.players.length; } while (g.players[k].n <= 0); return k; }

  // Is (q, f) a legal bid after prev ({q, f} or null) with `total` dice on the table?
  function isLegal(prev, q, f, total) {
    if (q !== Math.floor(q) || f !== Math.floor(f) || f < 1 || f > FACES || q < 1 || q > total) return false;
    if (!prev) return true;
    if (prev.f === 1) return f === 1 ? q > prev.q : q >= 2 * prev.q + 1;
    if (f === 1) return q >= Math.ceil(prev.q / 2);
    return q > prev.q || (q === prev.q && f > prev.f);
  }
  // The smallest legal quantity on a face, or 0 when none fits on the table.
  function minQty(prev, f, total) {
    for (var q = 1; q <= total; q++) if (isLegal(prev, q, f, total)) return q;
    return 0;
  }
  function legalBids(prev, total) {
    var out = [];
    for (var f = 1; f <= FACES; f++) for (var q = minQty(prev, f, total); q > 0 && q <= total; q++) out.push({ q: q, f: f });
    return out;
  }

  // How many of the face count for a bid: the face itself, plus wild ones unless the bid is on ones.
  function countFace(dice, f) { var n = 0; dice.forEach(function (d) { if (d === f || (f !== 1 && d === 1)) n++; }); return n; }
  function tableCount(g, f) { var n = 0; g.players.forEach(function (p) { n += countFace(p.dice, f); }); return n; }

  // Make a move for the player whose turn it is: {type: 'bid', q, f} or {type: 'challenge'}.
  // Returns false when it is not legal. A challenge returns the result and takes a die from the loser.
  function act(g, move) {
    if (g.over) return false;
    if (move.type === 'bid') {
      if (!isLegal(g.bid, move.q, move.f, totalDice(g))) return false;
      g.bid = { q: move.q, f: move.f, by: g.turn };
      g.turn = nextAlive(g, g.turn);
      return true;
    }
    if (move.type === 'challenge' && g.bid) {
      var actual = tableCount(g, g.bid.f), bidTrue = actual >= g.bid.q;
      var loser = bidTrue ? g.turn : g.bid.by;
      var res = { bid: g.bid, challenger: g.turn, bidder: g.bid.by, actual: actual, bidTrue: bidTrue, loser: loser, dice: g.players.map(function (q) { return q.dice.slice(); }) };
      g.players[loser].n--;
      g.last = res;
      if (alive(g).length === 1) { g.over = true; g.winner = alive(g)[0]; }
      g.bid = null;
      g.turn = g.players[loser].n > 0 ? loser : nextAlive(g, loser);
      g.starter = g.turn;
      return res;
    }
    return false;
  }
  function nextRound(g) { if (g.over) return; g.round++; rollAll(g); }

  // The computer sees its own dice and the dice count, nothing else.
  function binomTail(k, trials, p) {
    if (k <= 0) return 1;
    if (k > trials) return 0;
    var t = 0, c = 1, i;
    for (i = 0; i < k; i++) c = c * (trials - i) / (i + 1); // C(trials, k)
    for (var j = k; j <= trials; j++) {
      t += c * Math.pow(p, j) * Math.pow(1 - p, trials - j);
      c = c * (trials - j) / (j + 1);
    }
    return Math.min(1, t);
  }
  function chance(mine, total, q, f) {
    var unknown = total - mine.length, need = q - countFace(mine, f);
    return binomTail(need, unknown, f === 1 ? 1 / 6 : 1 / 3);
  }

  function aiMove(g) {
    var p = g.players[g.turn], total = totalDice(g), rng = g.rng, mine = p.dice, prev = g.bid;
    var jitter = (rng() - 0.5) * 0.12;
    if (prev) {
      var pt = chance(mine, total, prev.q, prev.f);
      if (pt < p.calls + jitter) return { type: 'challenge' };
    }
    var options = legalBids(prev, total);
    if (!options.length) return { type: 'challenge' };
    options.forEach(function (o) {
      o.p = chance(mine, total, o.q, o.f);
      var own = countFace(mine, o.f);
      var raise = prev ? o.q - prev.q + (o.f === prev.f ? 0 : 0.4) : 0;
      o.value = o.p + 0.12 * Math.min(3, own) - 0.05 * raise;
    });
    var bluffing = rng() < p.bluff, pool;
    if (bluffing) {
      pool = options.filter(function (o) { return o.p >= 0.18 && o.p < 0.42; });
      if (pool.length) { pool.sort(function (a, b) { return b.value - a.value; }); return { type: 'bid', q: pool[0].q, f: pool[0].f }; }
    }
    pool = options.filter(function (o) { return o.p >= 0.4; });
    if (!pool.length) {
      if (prev) return { type: 'challenge' };
      pool = options;
    }
    pool.sort(function (a, b) { return b.value - a.value; });
    var pick = pool[0];
    if (pool.length > 1 && rng() < 0.2) pick = pool[1]; // not always the same line
    return { type: 'bid', q: pick.q, f: pick.f };
  }

  var Engine = { START_DICE: START_DICE, createGame: createGame, isLegal: isLegal, minQty: minQty, legalBids: legalBids, countFace: countFace, tableCount: tableCount, totalDice: totalDice, act: act, nextRound: nextRound, aiMove: aiMove, chance: chance, alive: alive };
  root.LiarsDiceEngine = Engine;

  if (typeof document === 'undefined') return;

  // ── the page ─────────────────────────────────────────────────────────────
  var Play = root.ArcadePlay, $ = Play.$;
  var SETTINGS_KEY = 'zimi.games.liarsdice.settings', STATS_KEY = 'zimi.games.liarsdice.stats';
  var AI_DELAY_MS = 950;
  Play.applyTheme();

  var els = { opps: $('ld-opps'), who: $('ld-who'), bid: $('ld-bid'), msg: $('ld-msg'), mine: $('ld-mine'), ctl: $('ld-ctl'), qty: $('ld-qty'), faces: $('ld-faces'), bidbtn: $('ld-bidbtn'), liar: $('ld-liar'), plus: $('ld-plus'), minus: $('ld-minus'),
    reveal: $('ld-reveal'), rtext: $('ld-reveal-text'), cups: $('ld-cups'), next: $('ld-next'), sheet: $('ld-sheet'), title: $('ld-sheet-title'), text: $('ld-sheet-text'), go: $('ld-go'), n: $('ld-n'), nu: $('ld-new') };
  var settings = Play.load(SETTINGS_KEY, { players: 3 }), stats = Play.load(STATS_KEY, { played: 0, won: 0 });
  var g = createGame(settings.players), timer = null, sel = { q: 1, f: 2 };

  function dieEl(n, cls) { var d = document.createElement('div'); d.className = 'pl-die ' + (cls || ''); Play.pips(d, n); return d; }
  function bidText(b) { return b.q + ' × ' + (b.f === 1 ? 'ones' : b.f + 's'); }
  function myTurn() { return !g.over && g.turn === 0 && g.players[0].n > 0; }

  function paintOpps() {
    els.opps.textContent = '';
    g.players.forEach(function (p, i) {
      if (i === 0) return;
      var d = document.createElement('div'); d.className = 'ld-opp' + (i === g.turn && !g.over ? ' ld-turn' : '') + (p.n === 0 ? ' ld-out' : ''); d.setAttribute('role', 'listitem');
      var dots = '', k; for (k = 0; k < p.n; k++) dots += '<i></i>';
      var said = g.bid && g.bid.by === i ? 'bid ' + bidText(g.bid) : p.n === 0 ? 'out' : '';
      d.innerHTML = '<b></b><span class="ld-dots" aria-hidden="true">' + dots + '</span><small></small>';
      d.firstChild.textContent = p.name; d.lastChild.textContent = said;
      d.setAttribute('aria-label', p.name + ', ' + p.n + ' dice' + (said ? ', ' + said : ''));
      els.opps.appendChild(d);
    });
  }
  function paintBid() {
    els.bid.textContent = '';
    if (!g.bid) { els.who.textContent = g.over ? 'Game over' : g.players[g.turn].name + (g.turn === 0 ? ' open the bidding' : ' opens the bidding'); return; }
    els.who.textContent = (g.bid.by === 0 ? 'You' : g.players[g.bid.by].name) + (g.bid.by === 0 ? ' bid' : ' bids');
    var q = document.createElement('span'); q.textContent = g.bid.q; els.bid.appendChild(q);
    var x = document.createElement('span'); x.textContent = '×'; x.setAttribute('aria-hidden', 'true'); els.bid.appendChild(x);
    var d = dieEl(g.bid.f); d.setAttribute('role', 'img'); d.setAttribute('aria-label', g.bid.f === 1 ? 'ones' : g.bid.f + 's'); els.bid.appendChild(d);
  }
  function paintMine() {
    els.mine.textContent = '';
    g.players[0].dice.forEach(function (v) { els.mine.appendChild(dieEl(v)); });
  }
  function clampSel() {
    var total = totalDice(g), m = minQty(g.bid, sel.f, total);
    if (!m) { // nothing fits on this face: move to the nearest face that has a bid
      for (var f = 1; f <= 6; f++) if (minQty(g.bid, f, total)) { sel.f = f; m = minQty(g.bid, f, total); break; }
    }
    if (sel.q < m) sel.q = m;
    if (sel.q > total) sel.q = total;
  }
  function paintCtl() {
    var on = myTurn(), total = totalDice(g);
    els.ctl.classList.toggle('ld-wait', !on);
    if (on) clampSel();
    els.qty.textContent = sel.q;
    els.faces.textContent = '';
    for (var f = 1; f <= 6; f++) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'pl-die'; Play.pips(b, f);
      b.setAttribute('aria-label', f === 1 ? 'Ones' : 'Face ' + f); b.setAttribute('aria-pressed', String(on && sel.f === f));
      b.disabled = !on || !minQty(g.bid, f, total);
      (function (face) { b.addEventListener('click', function () { sel.f = face; sel.q = Math.max(sel.q, minQty(g.bid, face, total)); paintCtl(); }); })(f);
      els.faces.appendChild(b);
    }
    els.bidbtn.disabled = !on || !isLegal(g.bid, sel.q, sel.f, total); els.liar.disabled = !on || !g.bid;
    els.minus.disabled = !on || sel.q <= 1; els.plus.disabled = !on || sel.q >= total;
    if (on) els.msg.textContent = g.bid ? 'Your turn. Raise, or call Liar.' : 'Your turn. Open the bidding.';
  }
  function paint() {
    paintOpps(); paintBid(); paintMine(); paintCtl();
    if (!myTurn() && !g.over) els.msg.textContent = g.players[g.turn].name + ' is thinking.';
  }

  function play(move) {
    var res = act(g, move);
    if (!res) return false;
    if (move.type === 'challenge') return showReveal(res);
    paint(); schedule(); return true;
  }
  function schedule() {
    if (timer) timer.cancel();
    if (g.over || !g.players[g.turn].ai) return;
    timer = Play.later(function () { var m = aiMove(g); if (m.type === 'bid' || g.bid) play(m); }, AI_DELAY_MS);
  }

  function showReveal(res) {
    var caller = res.challenger === 0 ? 'You call' : g.players[res.challenger].name + ' calls';
    els.rtext.textContent = caller + ' Liar on ' + bidText(res.bid) + '. There were ' + res.actual + '. ' +
      (res.bidTrue ? 'The bid stands: ' : 'It was a lie: ') + (res.loser === 0 ? 'you lose a die.' : g.players[res.loser].name + ' loses a die.');
    els.cups.textContent = '';
    res.dice.forEach(function (ds, i) {
      var r = document.createElement('div'); r.className = 'ld-cup';
      var nm = document.createElement('b'); nm.textContent = g.players[i].name; r.appendChild(nm);
      ds.forEach(function (v) { var d = dieEl(v, 'pl-mini' + (v === res.bid.f || (res.bid.f !== 1 && v === 1) ? ' ld-hit' : '')); r.appendChild(d); });
      if (!ds.length) { var s = document.createElement('span'); s.textContent = 'out'; r.appendChild(s); }
      els.cups.appendChild(r);
    });
    els.next.textContent = g.over ? 'See result' : 'Next round';
    paint();
    Play.openSheet(els.reveal, '#ld-next');
    return true;
  }
  els.next.addEventListener('click', function () {
    Play.closeSheet(els.reveal);
    if (g.over) return finish();
    nextRound(g); sel = { q: 1, f: 2 }; paint(); schedule();
  });

  function finish() {
    stats.played++;
    var won = g.winner === 0;
    if (won) stats.won++;
    Play.save(STATS_KEY, stats);
    var text = won ? 'You are the last with dice. You win.' : (g.players[0].n === 0 ? 'You are out of dice. ' : '') + g.players[g.winner].name + ' wins.';
    text += ' You have won ' + stats.won + ' of ' + stats.played + '.';
    els.msg.textContent = text;
    showSheet(won ? 'You win' : 'Game over', text, 'Play again');
  }

  function paintN() {
    els.n.textContent = '';
    for (var n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = n;
      b.setAttribute('aria-pressed', String(settings.players === n));
      (function (k) { b.addEventListener('click', function () { settings.players = k; Play.save(SETTINGS_KEY, settings); paintN(); }); })(n);
      els.n.appendChild(b);
    }
  }
  function showSheet(title, text, label) { els.title.textContent = title; els.text.textContent = text; els.go.textContent = label; paintN(); Play.openSheet(els.sheet, '#ld-go'); }
  function begin() {
    if (timer) timer.cancel();
    g = createGame(settings.players); sel = { q: 1, f: 2 };
    Play.closeSheet(els.sheet); paint(); schedule();
  }
  els.go.addEventListener('click', begin);
  els.nu.addEventListener('click', function () { if (timer) timer.cancel(); showSheet('New game', 'Start over with fresh dice?', 'Start'); });
  els.plus.addEventListener('click', function () { sel.q++; paintCtl(); });
  els.minus.addEventListener('click', function () { sel.q--; paintCtl(); });
  els.bidbtn.addEventListener('click', function () { if (myTurn() && isLegal(g.bid, sel.q, sel.f, totalDice(g))) play({ type: 'bid', q: sel.q, f: sel.f }); });
  els.liar.addEventListener('click', function () { if (myTurn() && g.bid) play({ type: 'challenge' }); });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || !els.sheet.hidden || !els.reveal.hidden || !myTurn()) return;
    if (e.target && e.target.closest && e.target.closest('button') && e.key === 'Enter') return;
    if (e.key === 'ArrowUp') { e.preventDefault(); sel.q++; paintCtl(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel.q--; paintCtl(); }
    else if (e.key >= '1' && e.key <= '6') { var f = +e.key; if (minQty(g.bid, f, totalDice(g))) { sel.f = f; paintCtl(); } }
    else if (e.key === 'Enter') { e.preventDefault(); els.bidbtn.click(); }
    else if (e.key === 'l' || e.key === 'L') els.liar.click();
  });

  paint();
  showSheet("Liar's Dice", 'Bluff, read the table, call the lie. You against computers.', 'Start');
  root.__liarsdice = { get g() { return g; } };
})(this);
