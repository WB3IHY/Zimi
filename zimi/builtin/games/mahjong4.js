/* ZimiGames: Mahjong for four, the page. The rules, the scoring and the computers are in mahjong4-engine.js; the tile
   faces are the ones Mahjong solitaire uses (mahjong-tiles.js). Each of the four seats is a computer or a person
   (handoff.js): with two or more people the screen hides each hand behind a "Pass to" cover. Our own code, GPL-3.0. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined' || !root.Mahjong4Engine || !root.MahjongTiles) return;
  var WK = root.WorldKit, BK = root.BoardKit, E = root.Mahjong4Engine, MT = root.MahjongTiles, $ = function (id) { return document.getElementById(id); };
  var SEATS = E.SEATS, ROTATIONS = 4, COMPUTER_DELAY_MS = 600, CLAIM_DELAY_MS = 800, HINT_LEVEL = 'hard';

  var G = WK.create({
    id: 'mahjong4',
    options: [
      { key: 'level', legend: 'Computers', def: 'medium', choices: [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']] },
      { key: 'min', legend: 'Minimum to win', def: '3', choices: [['3', '3 faan'], ['1', '1 faan (easier)']] }
    ],
    statKey: function (s) { return s.level + s.min; },
    onNew: newGame, onHint: hint
  });
  var seats = newSeats();
  var score = WK.scoreBar($('wk-score'), [{}, {}, {}, {}].map(function () { return { color: 'var(--m4-cloth)' }; }));
  var els = { info: $('m4-info'), opps: $('m4-opps'), pool: $('m4-pool'), claim: $('m4-claim'), melds: $('m4-melds'), hand: $('m4-hand') };
  var handSheet = BK.sheet($('m4-hand-sheet')), rulesSheet = BK.sheet($('m4-rules-sheet'));
  var game, t, epoch = 0, picked = -1, tip = -1, shown = [], event = '';   // event: what just happened, shown ahead of whose turn it is

  // ── small helpers ──
  function newSeats() { return root.ZimiSeats.create({ id: 'mahjong4', seats: SEATS, onChange: function () { if (t) render(); } }); }
  function me() { return seats.view(); }   // the seat whose hand is face up
  function level() { return G.settings.level; }
  function seatName(p) { return E.WINDS[E.seatOf(t, p)]; }
  function nameOf(p) { return seats.person(p) ? seats.name(p) : seatName(p); }
  function labelOf(p) { return seats.person(p) ? seats.name(p) + ' (' + seatName(p) + ')' : seatName(p) + ' (computer)'; }
  function verb(p, you, other) { return seats.isYou(p) ? you : other; }   // "You discard" / "East discards"
  function ownerOf(p) { return nameOf(p) + (seats.isYou(p) ? 'r' : "'s"); }
  function tileHtml(k, cls, extra) { return '<span class="m4-t' + (cls ? ' ' + cls : '') + '"' + (extra || '') + ' title="' + MT.faceName(k) + '">' + MT.faceMarkup(k) + '</span>'; }
  function backHtml(cls) { return '<span class="m4-t back ' + (cls || 'xs') + '" aria-hidden="true"></span>'; }
  function meldTiles(m) {
    if (m.type === 'chow') return [m.k, m.k + 1, m.k + 2];
    return m.type === 'pung' ? [m.k, m.k, m.k] : [m.k, m.k, m.k, m.k];
  }
  function meldHtml(m, cls) {
    var hidden = m.type === 'kong' && !m.open;   // a concealed kong shows its two middle tiles face down
    return '<span class="m4-meld" title="' + m.type + ' of ' + MT.faceName(m.k) + '">' + meldTiles(m).map(function (k, i) { return hidden && (i === 0 || i === 3) ? backHtml(cls) : tileHtml(k, cls); }).join('') + '</span>';
  }
  function later(fn, ms) { var my = epoch; setTimeout(function () { if (my === epoch) fn(); }, ms); }
  function say(text, busy) { G.say(text, busy); }
  function human() { return t.phase === 'discard' && t.turn === me() && seats.person(t.turn) && !seats.covering && !t.result; }

  // ── drawing the table ──
  function render() {
    var p, i;
    els.info.textContent = 'East round, deal ' + Math.min(ROTATIONS, game.rotations + 1) + ' of ' + ROTATIONS + (game.repeats ? ' (dealer stays)' : '') + '. ' + E.liveLeft(t) + ' tiles left in the wall.' + ' Minimum ' + t.min + ' faan.';
    var names = [], vals = [];
    for (p = 0; p < SEATS; p++) { names.push(nameOf(p) + ' (' + seatName(p).charAt(0) + ')'); vals.push(game.points[p]); }
    score(names, vals, t.result ? -1 : t.turn);
    // the three computers: tiles face down, melds face up
    var opp = '';
    for (var r = 1; r < SEATS; r++) {
      p = (me() + r) % SEATS;
      var backs = ''; for (i = 0; i < t.hands[p].length; i++) backs += backHtml('xs');
      opp += '<div class="m4-opp' + (t.turn === p && !t.result ? ' turn' : '') + '"><span class="nm">' + labelOf(p) + (p === t.dealer ? ' · dealer' : '') + '</span><span class="row" aria-label="' + t.hands[p].length + ' tiles in hand">' + backs + '</span><span class="melds">' + t.melds[p].map(function (m) { return meldHtml(m, 'xs'); }).join('') + '</span></div>';
    }
    els.opps.innerHTML = opp;
    // the discards, a row for each player, the newest claim target marked
    var pool = '';
    for (p = 0; p < SEATS; p++) {
      var d = t.discards[p], tiles = d.map(function (k, j) { var isLast = t.phase === 'claim' && t.lastDiscard && t.lastDiscard.from === p && j === d.length - 1; return tileHtml(k, 'sm' + (isLast ? ' last' : '')); }).join('');
      pool += '<div class="line"><span class="who">' + seatName(p).charAt(0) + (p === me() ? '*' : '') + '</span><span class="tiles">' + tiles + '</span></div>';
    }
    els.pool.innerHTML = pool;
    els.melds.innerHTML = t.melds[me()].map(function (m) { return meldHtml(m, 'sm'); }).join('');
    renderHand();
    G.setHint(human() && !G.over);
  }
  function handOrder() {
    var list = t.hands[me()].slice(), drawn = -1;
    if (t.lastDrawn !== null && t.turn === me() && t.phase === 'discard') { var at = list.lastIndexOf(t.lastDrawn); if (at >= 0) { list.splice(at, 1); drawn = t.lastDrawn; } }
    shown = list.concat(drawn >= 0 ? [drawn] : []);
    return { list: list, drawn: drawn };
  }
  function renderHand() {
    var o = handOrder(), can = human(), h = '', i;
    for (i = 0; i < shown.length; i++) {
      var isDrawn = o.drawn >= 0 && i === shown.length - 1, k = shown[i];
      h += '<button type="button" class="m4-t' + (isDrawn ? ' drawn' : '') + (i === picked ? ' pick' : '') + (i === tip ? ' tip' : '') + '" data-i="' + i + '" tabindex="' + (i === (picked >= 0 ? picked : 0) ? 0 : -1) + '" aria-label="' + MT.faceName(k) + (isDrawn ? ', just drawn' : '') + (i === picked ? ', picked: press again to discard' : '') + '"' + (can ? '' : ' disabled') + '>' + MT.faceMarkup(k) + '</button>';
    }
    els.hand.innerHTML = h;
  }
  els.hand.addEventListener('click', function (e) {
    var b = e.target.closest('.m4-t');
    if (!b || !human() || prompting()) return;
    var i = +b.dataset.i;
    if (picked === i) { discardTile(shown[i]); return; }
    picked = i; tip = -1; renderHand(); focusTile(i);
    say('Picked ' + MT.faceName(shown[i]) + '. Tap it again to discard it.');
  });
  function focusTile(i) { var b = els.hand.querySelector('[data-i="' + i + '"]'); if (b) b.focus(); }
  els.hand.addEventListener('keydown', function (e) {
    var b = e.target.closest('.m4-t');
    if (!b) return;
    var i = +b.dataset.i, n = shown.length, to = -1;
    if (e.key === 'ArrowLeft') to = Math.max(0, i - 1); else if (e.key === 'ArrowRight') to = Math.min(n - 1, i + 1);
    else if (e.key === 'Home') to = 0; else if (e.key === 'End') to = n - 1;
    if (to < 0) return;
    e.preventDefault();
    [].forEach.call(els.hand.children, function (c) { c.tabIndex = -1; });
    els.hand.children[to].tabIndex = 0; els.hand.children[to].focus();
  });

  // ── the claim bar ──
  var pending = null;   // what the bar is waiting for: { kind: 'self' | 'claim', ... }
  function prompting() { return !!pending && pending.kind === 'claim'; }
  function addBtn(label, cls, fn, tiles) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'ar-btn' + (cls ? ' ' + cls : '');
    b.innerHTML = (tiles || []).map(function (k) { return tileHtml(k, 'xs'); }).join('') + '<span>' + label + '</span>';
    b.addEventListener('click', fn); els.claim.appendChild(b);
  }
  function hideClaims() { els.claim.hidden = true; els.claim.textContent = ''; pending = null; }
  function showSelfOptions(o) {
    els.claim.textContent = ''; var any = false;
    var who = me();
    if (o.win) { any = true; addBtn('Win: ' + o.win.faan + ' faan, self-drawn', 'win', function () { hideClaims(); E.declareWin(t, who, false); endHand(); }); }
    o.concealedKongs.concat(o.addKongs).forEach(function (k) { any = true; addBtn('Kong ' + MT.faceName(k), '', function () { hideClaims(); doKong(who, k); }, [k]); });
    els.claim.hidden = !any; pending = any ? { kind: 'self' } : null;
  }
  function showClaims(c, tile) {
    els.claim.textContent = ''; pending = { kind: 'claim' };
    if (c.win) addBtn('Win: ' + c.win.faan + ' faan', 'win', function () { choose({ type: 'win' }); }, [tile]);
    if (c.kong) addBtn('Kong', '', function () { choose({ type: 'kong' }); }, [tile, tile, tile, tile]);
    if (c.pung) addBtn('Pung', '', function () { choose({ type: 'pung' }); }, [tile, tile, tile]);
    c.chows.forEach(function (s) { addBtn('Chow', '', function () { choose({ type: 'chow', start: s }); }, [s, s + 1, s + 2]); });
    addBtn('Pass', '', function () { choose(null); });
    els.claim.hidden = false;
    var first = els.claim.querySelector('button'); if (first) first.focus({ preventScroll: true });
  }

  // ── turns ──
  function startHand() {
    epoch++; picked = -1; tip = -1; hideClaims();
    t = E.newHand({ dealer: game.dealer, min: +G.settings.min });
    render();
    event = (seats.isYou(game.dealer) ? 'You deal' : nameOf(game.dealer) + ' deals') + '.';
    beginTurn();
  }
  function beginTurn() {
    if (t.result) { endHand(); return; }
    picked = -1; tip = -1; render();
    var p = t.turn, lead = event ? event + ' ' : '', my = epoch;
    if (seats.person(p)) {
      // With several people the next person takes the screen first, then sees their own tiles and options.
      seats.ensure(p, function () {
        if (my !== epoch) return;
        render();
        showSelfOptions(E.selfOptions(t, p));
        var you = seats.isYou(p), to = you ? 'Your turn' : nameOf(p) + ', your turn';
        say(lead + (els.claim.hidden ? to + ': discard a tile.' : (you ? 'You' : nameOf(p)) + ' can declare, or discard a tile.'));
      });
    } else { say(lead + seatName(p) + ' is thinking...', true); later(function () { computerAct(p); }, COMPUTER_DELAY_MS); }
  }
  function computerAct(p) {
    var self = E.aiSelf(t, p, level());
    if (self && self.type === 'win') { E.declareWin(t, p, false); endHand(); return; }
    if (self && self.type === 'kong') { doKong(p, self.k); return; }
    var tile = E.aiDiscard(t, p, level());
    discardTile(tile, p);
  }
  function doKong(p, k) {
    E.declareKong(t, p, k);
    event = nameOf(p) + verb(p, ' declare', ' declares') + ' a kong of ' + MT.faceName(k) + '.';
    if (t.result) { endHand(); return; }
    beginTurn();
  }
  function discardTile(tile, p) {
    p = p === undefined ? me() : p;
    if (!E.discard(t, p, tile)) return;
    picked = -1; tip = -1; hideClaims();
    event = nameOf(p) + verb(p, ' discard ', ' discards ') + MT.faceName(tile) + '.';
    render();
    // the computers' answers are known at once; each person with an option is asked in turn after the discarder
    var picks = {}, asking = [], q, d;
    for (d = 1; d < SEATS; d++) {
      q = (p + d) % SEATS;
      if (seats.person(q)) { var o = t.claims[q]; if (o.win || o.pung || o.kong || o.chows.length) asking.push(q); }
      else { var c = E.aiClaim(t, q, level()); if (c) picks[q] = c; }
    }
    pending = null;
    askClaims(asking, picks, tile);
  }
  function askClaims(asking, picks, tile) {
    if (!asking.length) {
      say(event, true);
      later(function () { settle(picks); }, CLAIM_DELAY_MS);
      return;
    }
    var q = asking[0], my = epoch;
    seats.ensure(q, function () {
      if (my !== epoch) return;
      render();
      say(event + (seats.isYou(q) ? ' You may claim it.' : ' ' + nameOf(q) + ' may claim it.'));
      showClaims(t.claims[q], tile);
      pending.picks = picks; pending.asking = asking; pending.tile = tile;
    }, 'Pass the device. You may claim the last discard, and your tiles stay hidden until you tap.');
  }
  function choose(pick) {
    var wait = pending, q = wait.asking[0];
    hideClaims();
    if (pick) wait.picks[q] = pick;
    askClaims(wait.asking.slice(1), wait.picks, wait.tile);
  }
  function settle(picks) {
    var tile = t.lastDiscard.tile, res = E.resolve(t, picks);
    if (res === 'win' || res === 'draw') { endHand(); return; }
    if (res === 'next') { event = ''; beginTurn(); return; }
    var claimant = t.turn;   // the one who took the tile now has the turn
    event = nameOf(claimant) + verb(claimant, ' take', ' takes') + ' the ' + MT.faceName(tile) + ' for a ' + res + '.';
    beginTurn();
  }

  // ── the end of a hand ──
  function endHand() {
    hideClaims(); render();
    var r = t.result, body = '', title, i;
    if (r.type === 'win') {
      for (i = 0; i < SEATS; i++) game.points[i] += r.points[i];
      var w = r.winner, selfDrawn = r.from === null;
      title = seats.isYou(w) ? 'You win the hand' : nameOf(w) + ' wins the hand';
      var tilesRow = t.hands[w].slice(); if (!selfDrawn) tilesRow.push(r.tile);
      E.sortTiles(tilesRow);
      body += '<div class="m4-result"><p>' + (selfDrawn ? nameOf(w) + verb(w, ' drew', ' draws') + ' the winning tile.' : nameOf(w) + verb(w, ' win', ' wins') + ' on ' + ownerOf(r.from) + ' ' + MT.faceName(r.tile) + '.') + '</p>';
      body += '<div class="tiles">' + t.melds[w].map(function (m) { return meldHtml(m, 'sm'); }).join('') + tilesRow.map(function (k) { return tileHtml(k, 'sm'); }).join('') + '</div>';
      body += '<h3>' + r.faan + ' faan' + (r.limit ? ' (limit)' : '') + ': ' + E.pointsFor(r.faan) + ' points</h3><table>' + r.items.map(function (it) { return '<tr><td>' + it.name + '</td><td class="n">' + it.faan + '</td></tr>'; }).join('') + '</table>';
      body += '<h3>Points</h3><table><tr><th></th><th class="n">Change</th><th class="n">Total</th></tr>' + [0, 1, 2, 3].map(function (p) { return '<tr><td>' + nameOf(p) + ' (' + seatName(p) + ')</td><td class="n">' + (r.points[p] > 0 ? '+' : '') + r.points[p] + '</td><td class="n">' + game.points[p] + '</td></tr>'; }).join('') + '</table></div>';
      game.repeats = w === t.dealer ? game.repeats + 1 : 0;
      if (w !== t.dealer) { game.dealer = (game.dealer + 1) % SEATS; game.rotations++; }
    } else {
      title = 'A draw';
      body = '<div class="m4-result"><p>The wall has run out. Nobody scores, and the dealer stays.</p></div>';
      game.repeats++;
    }
    say(title + '.');
    var last = game.rotations >= ROTATIONS;
    $('m4-hand-next').textContent = last ? 'Final result' : 'Next hand';
    $('m4-hand-title').textContent = title;
    $('m4-hand-body').innerHTML = body;
    handSheet.open($('m4-hand-next'));
    score(game.points.map(function (_, p) { return nameOf(p) + ' (' + seatName(p).charAt(0) + ')'; }), game.points, -1);
    game.last = last;
  }
  $('m4-hand-next').addEventListener('click', function () {
    handSheet.close();
    if (game.last) { gameOver(); return; }
    startHand();
  });
  $('m4-hand-look').addEventListener('click', function () { handSheet.close(); });
  function gameOver() {
    var order = [0, 1, 2, 3].sort(function (a, b) { return game.points[b] - game.points[a]; }), hot = seats.hotseat(), place = order.indexOf(seats.people()[0]) + 1;
    var msg = 'Final points: ' + order.map(function (p) { return nameOf(p) + ' ' + game.points[p]; }).join(', ') + '. ' +
      (hot ? nameOf(order[0]) + ' comes first.' : place === 1 ? 'You come first.' : 'You finish ' + ['', 'first', 'second', 'third', 'fourth'][place] + '.');
    G.finish(msg, hot ? null : place === 1 ? 'w' : 'l', hot ? nameOf(order[0]) + ' wins' : place === 1 ? 'You win the game' : 'Game over');
  }

  // ── hint, rules, new game ──
  function hint() {
    if (!human()) return;
    var who = me(), k = E.aiDiscard(t, who, HINT_LEVEL), i = shown.lastIndexOf(k), c = E.countsOf(t.hands[who]);
    tip = i >= 0 ? i : -1; picked = -1; renderHand();
    c[k]--;
    var w = E.waits(c, t.melds[who].length), text = 'Try discarding the ' + MT.faceName(k) + '.';
    if (w.length) text += ' Then you are waiting on ' + w.map(MT.faceName).join(', ') + '.';
    say(text);
  }
  function rulesHtml() {
    var h = '<div class="m4-rules"><p>A hand is four sets (chow, pung or kong) and a pair. It needs at least the minimum faan to win, three by default. The prevailing wind is East; the dealer is East.</p><table>';
    E.TABLE.forEach(function (r) { h += '<tr><td>' + r[0] + '<div class="how">' + r[2] + '</div></td><td class="n">' + r[1] + '</td></tr>'; });
    h += '</table><h3>Points</h3><table>';
    [1, 2, 3, 4, 5, 6, 7, 8].forEach(function (f) { h += '<tr><td>' + f + (f === 8 ? ' or more (limit)' : ' faan') + '</td><td class="n">' + E.POINTS[f] + '</td></tr>'; });
    h += '</table><p class="how">A win on your own draw is paid by all three players, a win on a discard by the player who discarded, at double. The deal passes when someone other than the dealer wins; a draw or a dealer win keeps it. Four deals make the game.</p></div>';
    return h;
  }
  $('m4-rules-body').innerHTML = rulesHtml();
  $('m4-rules').addEventListener('click', function () { rulesSheet.open($('m4-rules-close')); });
  $('m4-rules-close').addEventListener('click', rulesSheet.close);

  function newGame() {
    epoch++; t = null;
    seats = newSeats();
    game = { dealer: 0, rotations: 0, repeats: 0, points: [0, 0, 0, 0], last: false };
    handSheet.close();
    var my = epoch;
    seats.begin(function () { if (my === epoch) startHand(); }, game.dealer);
  }
  // The Players rows join the New game sheet, ahead of its buttons.
  (function seatRows() {
    var card = $('wk-menu-title').parentNode;
    card.insertBefore(seats.block(null, { note: 'Seat 1 deals first.' }), card.querySelector('.ar-sheet-actions'));
  })();
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('.ar-sheet,input')) return;
    if (e.key === 'Escape' && picked >= 0) { picked = -1; renderHand(); }
  });

  G.newGame();

  if (new URLSearchParams(location.search).has('debug')) {
    root.__m4 = { engine: E, table: function () { return t; }, game: function () { return game; }, discard: discardTile, begin: beginTurn, shown: function () { return shown; } };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
