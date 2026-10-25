/* ZimiGames: Dominoes (double six, Draw and Block). Our own code, GPL-3.0. The first half is the
   rules and the computer players (no DOM, tested under node); the second half is the page.
   A tile is [low, high] pips; the chain is a list of tiles turned to run left to right. */
(function (root) {
  'use strict';

  var MAX_PIP = 6, TILE_COUNT = 28;
  var HAND_SIZE = { draw: { 2: 7, 3: 5, 4: 5 }, block: { 2: 7, 3: 7, 4: 7 } };
  var LEVELS = { easy: { noise: 1000, smart: false }, medium: { noise: 3, smart: false }, hard: { noise: 0.5, smart: true } };

  function allTiles() {
    var out = [];
    for (var a = 0; a <= MAX_PIP; a++) for (var b = a; b <= MAX_PIP; b++) out.push([a, b]);
    return out;
  }
  function pips(tile) { return tile[0] + tile[1]; }
  function isDouble(tile) { return tile[0] === tile[1]; }
  function handPips(hand) { return hand.reduce(function (n, t) { return n + pips(t); }, 0); }
  function same(a, b) { return a[0] === b[0] && a[1] === b[1]; }
  function shuffle(list, rng) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor((rng || Math.random)() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // ── a round ──
  // state: { mode, hands, boneyard, chain, ends: [left, right] | null, turn, passes, lacks: [{pip: true}], last }
  function deal(mode, players, rng) {
    var tiles = shuffle(allTiles(), rng), size = HAND_SIZE[mode][players], hands = [];
    for (var p = 0; p < players; p++) hands.push(tiles.splice(0, size));
    var lacks = [];
    for (p = 0; p < players; p++) lacks.push({});
    return { mode: mode, hands: hands, boneyard: tiles, chain: [], ends: null, turn: 0, passes: 0, lacks: lacks, last: null };
  }
  // The best tile to lead with: the highest double, else the heaviest tile.
  function bestLead(hand) {
    var best = -1, bestKey = -1;
    hand.forEach(function (t, i) { var k = (isDouble(t) ? 100 : 0) + pips(t) * 2 + t[1]; if (k > bestKey) { bestKey = k; best = i; } });
    return best;
  }
  // Who leads the first round: the holder of the highest double, else of the heaviest tile.
  function firstPlayer(st) {
    var who = 0, bestKey = -1;
    st.hands.forEach(function (h, p) {
      if (!h.length) return;
      var k = (isDouble(h[bestLead(h)]) ? 100 : 0) + pips(h[bestLead(h)]) * 2 + h[bestLead(h)][1];
      if (k > bestKey) { bestKey = k; who = p; }
    });
    return who;
  }
  // The plays open to a player: { tile: index in hand, end: 'L' | 'R' | 'C' (the first tile) }.
  function legalPlays(st, p) {
    var out = [];
    st.hands[p].forEach(function (t, i) {
      if (!st.chain.length) { out.push({ tile: i, end: 'C' }); return; }
      if (t[0] === st.ends[0] || t[1] === st.ends[0]) out.push({ tile: i, end: 'L' });
      if (t[0] === st.ends[1] || t[1] === st.ends[1]) out.push({ tile: i, end: 'R' });
    });
    return out;
  }
  function play(st, p, play_) {
    var t = st.hands[p].splice(play_.tile, 1)[0], placed;
    if (play_.end === 'C') { placed = { a: t[0], b: t[1] }; st.chain = [placed]; st.ends = [t[0], t[1]]; }
    else if (play_.end === 'L') { placed = t[1] === st.ends[0] ? { a: t[0], b: t[1] } : { a: t[1], b: t[0] }; st.chain.unshift(placed); st.ends[0] = placed.a; }
    else { placed = t[0] === st.ends[1] ? { a: t[0], b: t[1] } : { a: t[1], b: t[0] }; st.chain.push(placed); st.ends[1] = placed.b; }
    st.passes = 0; st.last = { player: p, tile: placed, end: play_.end };
    return placed;
  }
  function draw(st, p) {
    if (st.mode !== 'draw' || !st.boneyard.length) return null;
    var t = st.boneyard.pop();
    st.hands[p].push(t);
    return t;
  }
  function pass(st, p) {
    st.passes++;
    if (st.ends) { st.lacks[p][st.ends[0]] = true; st.lacks[p][st.ends[1]] = true; }
  }
  function canDraw(st) { return st.mode === 'draw' && st.boneyard.length > 0; }
  function isBlocked(st) { return st.passes >= st.hands.length; }

  // How a finished round scores: { winner, points } or { winner: -1, points: 0 } for a tied block.
  function scoreRound(st) {
    var n = st.hands.length, p, totals = st.hands.map(handPips);
    for (p = 0; p < n; p++) if (!st.hands[p].length) return { winner: p, points: totals.reduce(function (a, b) { return a + b; }, 0), how: 'out' };
    var low = Math.min.apply(null, totals), lows = totals.filter(function (x) { return x === low; }).length;
    if (lows > 1) return { winner: -1, points: 0, how: 'tie' };
    var w = totals.indexOf(low);
    return { winner: w, points: totals.reduce(function (a, b) { return a + b; }, 0) - 2 * low, how: 'blocked' };
  }

  // ── the computer ──
  function countIn(hand, pip, skip) { var n = 0; hand.forEach(function (t, i) { if (i !== skip && (t[0] === pip || t[1] === pip)) n++; }); return n; }
  function scorePlay(st, p, pl, smart) {
    var t = st.hands[p][pl.tile], s = pips(t) + (isDouble(t) ? 4 : 0);
    if (!smart) return s;
    // after the play, which numbers are left open, and do I hold more of them than a rival can answer?
    var open = st.ends ? st.ends.slice() : [t[0], t[1]];
    if (pl.end === 'L') open[0] = t[0] === st.ends[0] ? t[1] : t[0];
    else if (pl.end === 'R') open[1] = t[0] === st.ends[1] ? t[1] : t[0];
    open.forEach(function (e) {
      s += countIn(st.hands[p], e, pl.tile) * 2.2;
      var lacking = 0;
      st.lacks.forEach(function (l, q) { if (q !== p && l[e]) lacking++; });
      s += lacking * 3;
    });
    if (open[0] === open[1]) s -= 1;
    return s;
  }
  function choosePlay(st, p, level, rng) {
    var plays = legalPlays(st, p);
    if (!plays.length) return null;
    var cfg = LEVELS[level] || LEVELS.medium, best = null, bs = -Infinity;
    rng = rng || Math.random;
    if (!st.chain.length) return { tile: bestLead(st.hands[p]), end: 'C' };
    plays.forEach(function (pl) { var s = scorePlay(st, p, pl, cfg.smart) + rng() * cfg.noise; if (s > bs) { bs = s; best = pl; } });
    return best;
  }

  var Engine = {
    MAX_PIP: MAX_PIP, TILE_COUNT: TILE_COUNT, HAND_SIZE: HAND_SIZE, LEVELS: LEVELS,
    allTiles: allTiles, pips: pips, isDouble: isDouble, handPips: handPips, same: same, shuffle: shuffle, deal: deal, bestLead: bestLead, firstPlayer: firstPlayer,
    legalPlays: legalPlays, play: play, draw: draw, pass: pass, canDraw: canDraw, isBlocked: isBlocked, scoreRound: scoreRound, choosePlay: choosePlay
  };
  root.DominoEngine = Engine;

  if (typeof document === 'undefined') return;

  // ═══════════ the page ═══════════
  var BK = root.BoardKit, $ = function (id) { return document.getElementById(id); };
  var SETTINGS_KEY = 'dominoes.settings', STATS_KEY = 'dominoes.stats';
  var COMPUTER_MS = 900, DRAW_MS = 520, PASS_MS = 1000, LEAD_MS = 700, NEXT_MS = 350;
  var PIP_SLOTS = { 0: [], 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  var TILE_MIN_ROW = 5, TILE_MAX_ROW = 9, TILE_TARGET_LENGTH = 52;   // tiles to a row: about 7 on a phone, never more than 9

  var settings = BK.load(SETTINGS_KEY, {});
  if (settings.mode !== 'block') settings.mode = 'draw';
  if ([1, 2, 3].indexOf(settings.opponents) < 0) settings.opponents = 1;
  if (!LEVELS[settings.level]) settings.level = 'medium';
  if ([50, 100, 150].indexOf(settings.target) < 0) settings.target = 100;
  var stats = BK.load(STATS_KEY, {});

  var st, scores, round = 0, timer = 0, selected = -1, lastWinner = -1, matchOver = false, busy = false, ghosts = null;
  var chainEl = $('dm-chain'), handEl = $('dm-hand');
  var reduced = BK.reducedMotion();

  function players() { return settings.opponents + 1; }
  // Seats: each is the Computer or a Person; with two or more people, hands hide behind a handoff.
  var seats = root.ZimiSeats.create({ id: 'dominoes', seats: players(), onChange: function () { if (st) render(); } });
  function seatsFor() { seats = root.ZimiSeats.create({ id: 'dominoes', seats: players(), onChange: function () { if (st) render(); } }); }
  function you(p) { return seats.isYou(p); }
  function nameOf(p) {
    if (seats.person(p)) return seats.name(p);
    var k = 0; for (var q = 0; q < p; q++) if (!seats.person(q)) k++;
    return 'Computer ' + (k + 1);
  }
  function humanSeat(p) { return seats.person(p); }

  function tileEl(a, b, cls) {
    var t = document.createElement('div');
    t.className = 'dm-tile ' + (cls || '');
    [a, b].forEach(function (v) {
      var h = document.createElement('div');
      h.className = 'dm-half';
      for (var i = 0; i < 9; i++) { var c = document.createElement('i'); if (PIP_SLOTS[v].indexOf(i) >= 0) c.className = 'on'; h.appendChild(c); }
      t.appendChild(h);
    });
    t.setAttribute('aria-label', a + ' and ' + b);
    return t;
  }

  // ── drawing ──
  function paintChain() {
    chainEl.textContent = '';
    var width = chainEl.clientWidth || 340, per = Math.min(TILE_MAX_ROW, Math.max(TILE_MIN_ROW, Math.round(width / TILE_TARGET_LENGTH))), length = Math.floor(width / per) - 2;
    chainEl.style.setProperty('--s', (length / 2) + 'px');
    var seq = st.chain.map(function (c, i) { return { c: c, i: i }; });
    if (ghosts) {
      if (ghosts.indexOf('L') >= 0) seq.unshift({ ghost: 'L' });
      if (ghosts.indexOf('R') >= 0) seq.push({ ghost: 'R' });
    }
    if (!seq.length) { var e = document.createElement('p'); e.className = 'dm-empty'; e.textContent = 'No tiles yet'; chainEl.appendChild(e); return; }
    for (var r = 0; r * per < seq.length; r++) {
      var row = document.createElement('div');
      row.className = 'dm-row' + (r % 2 ? ' rev' : '');
      seq.slice(r * per, (r + 1) * per).forEach(function (item) {
        var node;
        if (item.ghost) {
          node = document.createElement('button');
          node.type = 'button'; node.className = 'dm-tile ghost'; node.textContent = item.ghost === 'L' ? 'Here' : 'Here';
          node.setAttribute('aria-label', 'Play on the ' + (item.ghost === 'L' ? 'left' : 'right') + ' end');
          node.addEventListener('click', function () { humanPlay(selected, item.ghost); });
        } else {
          var c = item.c, last = st.last && st.last.tile === c;
          node = tileEl(c.a, c.b, (c.a === c.b ? 'double' : '') + (last ? ' last' : '') + (item.i === 0 ? ' endL' : '') + (item.i === st.chain.length - 1 ? ' endR' : ''));
        }
        row.appendChild(node);
      });
      chainEl.appendChild(row);
    }
    var lastEl = chainEl.querySelector('.last');
    if (lastEl && lastEl.scrollIntoView) lastEl.scrollIntoView({ block: 'nearest' });
  }

  function paintHand() {
    handEl.textContent = '';
    var V = seats.view(), shown = !seats.hotseat() || (seats.viewer >= 0 && st.turn === V), mine = st.hands[V], plays = humanTurn() && shown ? legalPlays(st, V) : [], playable = {};
    plays.forEach(function (pl) { playable[pl.tile] = (playable[pl.tile] || []).concat(pl.end); });
    mine.forEach(function (t, i) {
      var b = document.createElement('button');
      b.type = 'button';
      var ok = !!playable[i];
      b.className = 'dm-card' + (ok ? ' can' : '') + (i === selected ? ' sel' : '');
      b.disabled = !ok;
      if (!shown) { b.className = 'dm-card'; b.disabled = true; b.setAttribute('aria-label', 'Hidden tile'); b.appendChild(tileEl(0, 0, 'vert dm-hidden')); handEl.appendChild(b); return; }
      b.setAttribute('aria-label', 'Tile ' + t[0] + ' and ' + t[1] + (ok ? (st.chain.length ? ', can play' : ', lead with it') : ', cannot play now'));
      b.appendChild(tileEl(t[0], t[1], 'vert' + (isDouble(t) ? ' double' : '')));
      b.addEventListener('click', function () { onHandTile(i, playable[i]); });
      handEl.appendChild(b);
    });
    $('dm-hand-count').textContent = mine.length ? mine.length + (mine.length === 1 ? ' tile' : ' tiles') + ' in ' + (you(V) ? 'your' : nameOf(V) + "'s") + ' hand' + (shown ? ', ' + handPips(mine) + ' dots' : ', hidden until their turn') : '';
  }

  function paintOpponents() {
    var box = $('dm-opps');
    box.textContent = '';
    for (var p = 0; p < players(); p++) {
      if (p === seats.view()) continue;
      var d = document.createElement('div');
      d.className = 'dm-opp' + (st.turn === p && !matchOver ? ' now' : '');
      var nm = document.createElement('span'); nm.className = 'dm-opp-name'; nm.textContent = nameOf(p);
      var backs = document.createElement('span'); backs.className = 'dm-backs'; backs.setAttribute('aria-label', st.hands[p].length + ' tiles');
      for (var i = 0; i < st.hands[p].length; i++) backs.appendChild(document.createElement('i'));
      var n = document.createElement('b'); n.textContent = st.hands[p].length;
      d.appendChild(nm); d.appendChild(backs); d.appendChild(n); box.appendChild(d);
    }
    var yard = $('dm-yard');
    yard.textContent = settings.mode === 'draw' ? 'Boneyard ' + st.boneyard.length : 'Block game';
  }
  function paintScores() {
    var box = $('dm-scores');
    box.textContent = '';
    scores.forEach(function (s, p) {
      var d = document.createElement('span');
      d.className = 'dm-score' + (p === st.turn && !matchOver ? ' now' : '');
      d.appendChild(document.createTextNode(nameOf(p) + ' '));
      var b = document.createElement('b'); b.textContent = s; d.appendChild(b);
      box.appendChild(d);
    });
    $('dm-target').textContent = 'Round ' + round + ', first to ' + settings.target + (st.ends ? '  /  Open ends ' + st.ends[0] + ' and ' + st.ends[1] : '');
  }
  function say(text, busyDots) {
    var s = $('dm-status');
    s.textContent = '';
    if (busyDots) { var sp = document.createElement('span'); sp.className = 'bg-spin'; s.appendChild(sp); }
    s.appendChild(document.createTextNode(text));
  }
  function render() { paintOpponents(); paintScores(); paintChain(); paintHand(); }
  function humanTurn() { return humanSeat(st.turn) && !busy && !matchOver; }

  // ── a round ──
  function startRound() {
    clearTimeout(timer);
    round++; selected = -1; ghosts = null; busy = true;
    st = deal(settings.mode, players());
    st.turn = lastWinner >= 0 ? lastWinner : firstPlayer(st);
    render();
    say(nameOf(st.turn) + (you(st.turn) ? ' lead' : ' leads'), false);
    timer = setTimeout(function () { // the leader's first tile is played for them
      var pl = { tile: bestLead(st.hands[st.turn]), end: 'C' };
      busy = false;
      doPlay(st.turn, pl);
    }, LEAD_MS);
  }

  function doPlay(p, pl) {
    var t = st.hands[p][pl.tile];
    play(st, p, pl);
    selected = -1; ghosts = null;
    render();
    say(nameOf(p) + ' played ' + t[0] + '|' + t[1]);
    if (!st.hands[p].length) { endRound(); return; }
    nextPlayer();
  }
  function nextPlayer() {
    st.turn = (st.turn + 1) % players();
    timer = setTimeout(takeTurn, NEXT_MS);
    paintOpponents(); paintScores();
  }
  function takeTurn() {
    clearTimeout(timer);
    var p = st.turn, plays = legalPlays(st, p);
    render();
    if (plays.length) {
      if (humanSeat(p)) { seats.ensure(p, function () { render(); say((you(p) ? 'Your turn' : nameOf(p) + ', your turn') + ': pick a tile that matches an open end'); }, 'Pass the device. Your tiles stay hidden until you tap.'); return; }
      say(nameOf(p) + ' is thinking', true);
      busy = true;
      timer = setTimeout(function () { busy = false; doPlay(p, choosePlay(st, p, settings.level)); }, COMPUTER_MS);
      return;
    }
    if (canDraw(st)) {
      say(nameOf(p) + (you(p) ? ' have no match, and draw' : ' draws'), !you(p));
      busy = true;
      timer = setTimeout(function () { draw(st, p); busy = false; render(); takeTurn(); }, DRAW_MS);
      return;
    }
    pass(st, p);
    say(nameOf(p) + (you(p) ? ' cannot play, and pass' : ' cannot play, and passes'));
    if (isBlocked(st)) { timer = setTimeout(endRound, PASS_MS); return; }
    busy = true;
    timer = setTimeout(function () { busy = false; nextPlayer(); }, PASS_MS);
  }

  function endRound() {
    clearTimeout(timer); busy = true;
    var r = scoreRound(st);
    if (r.winner >= 0) { scores[r.winner] += r.points; lastWinner = r.winner; }
    var lines = [];
    if (r.winner < 0) lines.push('The game is blocked and two hands tie for the lowest count. No one scores.');
    else if (r.how === 'out') lines.push(nameOf(r.winner) + ' went out and ' + (you(r.winner) ? 'score' : 'scores') + ' ' + r.points + '.');
    else lines.push('The game is blocked. ' + nameOf(r.winner) + (you(r.winner) ? ' have' : ' has') + ' the lowest count and ' + (you(r.winner) ? 'score' : 'scores') + ' ' + r.points + '.');
    st.hands.forEach(function (h, p) { if (p !== r.winner || r.how !== 'out') lines.push(nameOf(p) + ' held ' + handPips(h) + ' dots.'); });
    var top = Math.max.apply(null, scores);
    matchOver = top >= settings.target;
    render();
    var title = $('dm-round-title'), body = $('dm-round-text');
    body.textContent = '';
    lines.forEach(function (l) { var p = document.createElement('p'); p.textContent = l; body.appendChild(p); });
    var tally = document.createElement('p'); tally.className = 'dm-tally';
    tally.textContent = scores.map(function (s, p) { return nameOf(p) + ' ' + s; }).join('   ');
    body.appendChild(tally);
    if (matchOver) {
      var champ = scores.indexOf(top);
      title.textContent = you(champ) ? 'You win the match' : nameOf(champ) + ' wins the match';
      if (!seats.hotseat()) {
        var key = settings.mode + '.' + settings.opponents + '.' + settings.level, s = stats[key] = stats[key] || { w: 0, l: 0 };
        if (seats.person(champ)) s.w++; else s.l++;
        BK.save(STATS_KEY, stats);
      }
      $('dm-next').textContent = 'New match';
      say(title.textContent);
    } else {
      title.textContent = r.winner >= 0 && you(r.winner) ? 'You win the round' : r.winner < 0 ? 'Round drawn' : nameOf(r.winner) + ' wins the round';
      $('dm-next').textContent = 'Next round';
      say(title.textContent);
    }
    showStats();
    roundSheet.open($('dm-next'));
  }
  function showStats() {
    var s = stats[settings.mode + '.' + settings.opponents + '.' + settings.level];
    if (seats.hotseat()) { $('dm-stats').textContent = (settings.mode === 'draw' ? 'Draw' : 'Block') + ', ' + seats.people().length + ' people on this device'; return; }
    $('dm-stats').textContent = (settings.mode === 'draw' ? 'Draw' : 'Block') + ' vs ' + settings.opponents + ' computer' + (settings.opponents > 1 ? 's' : '') + ', ' + settings.level + ': ' + (s ? s.w : 0) + ' matches won, ' + (s ? s.l : 0) + ' lost';
  }

  // ── input ──
  function onHandTile(i, ends) {
    if (!humanTurn() || !ends) return;
    if (ends.length === 1 || (ends.length === 2 && st.ends[0] === st.ends[1])) { humanPlay(i, ends[0]); return; }
    if (selected === i) { selected = -1; ghosts = null; } else { selected = i; ghosts = ends; say('Which end? Tap Here on the chain'); }
    render();
  }
  function humanPlay(i, end) {
    if (!humanTurn() || i < 0) return;
    doPlay(st.turn, { tile: i, end: end });
  }

  function newMatch() {
    clearTimeout(timer);
    seatsFor();
    scores = []; for (var p = 0; p < players(); p++) scores.push(0);
    round = 0; lastWinner = -1; matchOver = false; busy = false;
    roundSheet.close();
    showStats();
    startRound();
    // A table of people starts behind a handoff; the round already deals underneath.
    seats.begin(function () { render(); if (!busy && !matchOver && st.turn >= 0) takeTurn(); });
  }

  // ── controls ──
  var menu = BK.sheet($('dm-sheet')), roundSheet = BK.sheet($('dm-round'));
  function paintSeatsBlock() {
    var host = $('dm-seats'); host.textContent = '';
    var n = +BK.chipValue($('dm-f-opp')) + 1;
    host.appendChild(root.ZimiSeats.create({ id: 'dominoes', seats: n }).block());
  }
  $('dm-f-opp').addEventListener('change', paintSeatsBlock);
  function syncMenu() {
    BK.chipSet($('dm-f-mode'), settings.mode); BK.chipSet($('dm-f-opp'), settings.opponents);
    BK.chipSet($('dm-f-level'), settings.level); BK.chipSet($('dm-f-target'), settings.target);
    paintSeatsBlock();
  }
  $('dm-new').addEventListener('click', function () { syncMenu(); menu.open(); });
  $('dm-cancel').addEventListener('click', menu.close);
  $('dm-start').addEventListener('click', function () {
    settings.mode = BK.chipValue($('dm-f-mode')); settings.opponents = +BK.chipValue($('dm-f-opp'));
    settings.level = BK.chipValue($('dm-f-level')); settings.target = +BK.chipValue($('dm-f-target'));
    BK.save(SETTINGS_KEY, settings);
    menu.close(); newMatch();
  });
  $('dm-next').addEventListener('click', function () { roundSheet.close(); if (matchOver) newMatch(); else startRound(); });
  $('dm-look').addEventListener('click', function () { roundSheet.close(); });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('.ar-sheet,input')) return;
    if (e.key.toLowerCase() === 'n') { syncMenu(); menu.open(); }
    else if (e.key === 'Escape' && selected >= 0) { selected = -1; ghosts = null; render(); }
  });
  var resizeTimer = 0;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { if (st) paintChain(); }, 120); });

  newMatch();

  if (new URLSearchParams(location.search).has('debug')) {
    root.__dm = { engine: Engine, state: function () { return st; }, scores: function () { return scores; }, settings: settings, busy: function () { return busy; }, humanTurn: humanTurn, matchOver: function () { return matchOver; } };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
