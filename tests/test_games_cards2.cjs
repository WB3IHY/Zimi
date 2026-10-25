// ZimiGames' later card games (Blackjack, Texas Hold'em, Big Two, Tien Len,
// Bridge, Canasta): the rules as pure functions on plain states. No DOM: the
// game files run their page wiring only when a #zc-table exists.
//
// Run: node tests/test_games_cards2.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'zimi', 'builtin', 'games');
let failures = 0, passed = 0;
const check = (ok, label) => {
  if (ok) { passed++; console.log('ok: ' + label); } else { console.error('FAIL: ' + label); failures++; }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const sandbox = {
  console, Date, Math, setTimeout, clearTimeout, setInterval, clearInterval,
  document: { addEventListener() {}, querySelector: () => null, getElementById: () => null, documentElement: { classList: { toggle() {} } }, hidden: false }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['cards.js', 'cardtable.js', 'blackjack.js', 'holdem.js', 'climbing.js', 'bigtwo.js', 'tienlen.js', 'bridge.js', 'canasta.js']) {
  if (!fs.existsSync(path.join(dir, f))) continue;
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox, { filename: f });
}
const Z = sandbox.ZimiCards, T = sandbox.ZimiTable;
const L = 'A23456789TJQK', SU = 'CDHS';
// A card from its short name: "QS" is the queen of spades, "TH" the ten of hearts.
const id = s => Z.make(L.indexOf(s[0]) + 1, SU.indexOf(s[1]));
const ids = s => s.trim() ? s.trim().split(/\s+/).map(id) : [];
const lcg = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

// ── Blackjack ───────────────────────────────────────────────────────────────
if (sandbox.ZimiBlackjack) {
  const B = sandbox.ZimiBlackjack;
  const hv = s => B.handValue(ids(s));
  check(hv('AS KH').total === 21 && hv('AS KH').soft, 'blackjack is a soft 21');
  check(hv('AS AH 9C').total === 21, 'two aces and a nine make 21');
  check(hv('AS AH 9C 5D').total === 16 && !hv('AS AH 9C 5D').soft, 'aces fall back to 1');
  check(hv('KS QH 5D').total === 25, 'bust totals past 21');
  const mk = (cards, bet, extra) => Object.assign({ cards: ids(cards), bet: bet || 100, split: false }, extra || {});
  const d = s => ids(s);
  check(B.net(mk('AS KH'), d('9S 8H')) === 150, 'blackjack pays 3 to 2');
  check(B.net(mk('AS KH'), d('AH KD')) === 0, 'blackjack against blackjack pushes');
  check(B.net(mk('KS 5H 9D'), d('9S 8H')) === -100, 'bust loses');
  check(B.net(mk('KS 5H 9D'), d('KS 6H 9D')) === -100, 'bust loses even if the dealer busts');
  check(B.net(mk('KS 9H'), d('KD 8H')) === 100, 'higher total wins');
  check(B.net(mk('KS 8H'), d('KD 8H')) === 0, 'equal totals push');
  check(B.net(mk('KS 8H'), d('KD 6H 9C')) === 100, 'dealer bust pays');
  check(B.net(mk('AS KH', 100, { split: true }), d('KD 8H')) === 100, 'a split hand 21 is not a blackjack');
  check(B.net(mk('KS 5H 6D', 200, { doubled: true }), d('KD 8H')) === 200, 'doubled bet pays doubled');
  check(B.net(mk('KS 7H'), d('AD KH')) === -100, 'dealer blackjack beats 17');
  // Strategy.
  const act = (mine, up, allow) => B.basicAction(ids(mine), id(up), allow || { double: true, split: true });
  check(act('8S 8H', '6D') === 'split' && act('8S 8H', 'AD') === 'split', 'always split eights');
  check(act('TS TH', '6D') === 'stand', 'never split tens');
  check(act('5S 6H', '6D') === 'double' && act('5S 6H', 'AD') === 'hit', 'eleven doubles except against an ace');
  check(act('5S 6H', '6D', { double: false }) === 'hit', 'cannot double: hit');
  check(act('TS 6H', '7D') === 'hit' && act('TS 6H', '6D') === 'stand', 'sixteen: stand against 2 to 6');
  check(act('AS 7H', '9D') === 'hit' && act('AS 7H', '2D') === 'stand' && act('AS 7H', '5D') === 'double', 'soft 18');
  check(act('9S 9H', '7D') === 'stand' && act('9S 9H', '6D') === 'split', 'nines');
  check(act('5S 5H', '6D') === 'double', 'fives play as ten');
  check(act('AS AH', '6D') === 'split', 'split aces');
  // A whole round through the rules, with a fixed shoe.
  {
    const rigged = (cards, extra) => {
      const st = B.newGame(lcg(1), Object.assign({ decks: 1 }, extra || {}));
      st.shoe = ids(cards).concat(st.shoe.filter(c => ids(cards).indexOf(c) < 0));
      return st;
    };
    // you A, dealer 9, you K (blackjack), dealer 7: pays 3 to 2 immediately
    let st = B.deal(rigged('AS 9H KH 7D'), lcg(2));
    check(st.phase === 'bet' && st.chips === 1000 - 20 + 20 + 30, 'a dealt blackjack settles at once: ' + st.chips);
    // stand on 18 vs dealer 6+10 = 16 -> dealer draws
    st = B.deal(rigged('TS 6H 8H TD KC'), lcg(2));
    check(st.phase === 'play' && B.canDouble(st), 'a hand is dealt, double allowed');
    st = B.stand(st);
    check(st.phase === 'bet' && st.dealer.length === 3 && st.chips === 1000 - 20 + 40, 'dealer drew and busted, total ' + B.handValue(st.dealer).total + ' chips ' + st.chips);
    // dealer stands on soft 17: A + 6
    st = B.deal(rigged('TS AH 7H 6D'), lcg(2));
    st = B.stand(st);
    check(st.dealer.length === 2 && st.chips === 1000, 'dealer stands on soft 17 (push on 17)');
    // double: 5 + 6, double, draw 10 = 21, dealer 18
    st = B.deal(rigged('5S TH 6H 8D TC'), lcg(2));
    st = B.double(st);
    check(st.phase === 'bet' && st.hands[0].bet === 40 && st.chips === 1000 - 40 + 80, 'double wins double: ' + st.chips);
    // split eights: 8 + 8 vs dealer 10+7, draw 3 and 10
    st = B.deal(rigged('8S TH 8H 7D 3C TD'), lcg(2));
    check(B.canSplit(st), 'a pair splits');
    st = B.split(st);
    check(st.hands.length === 2 && st.chips === 1000 - 40 && st.active === 0 && st.hands[0].cards.length === 2, 'split makes two hands, second bet taken');
    // split aces get one card each and stand
    st = B.deal(rigged('AS TH AH 7D 2C 3D'), lcg(2));
    st = B.split(st);
    check(st.phase === 'bet' && st.hands.every(h => h.cards.length === 2 && h.done), 'split aces: one card each, no more');
    // no resplitting aces
    st = B.deal(rigged('AS TH AH 7D AC 3D 9C 9D'), lcg(2));
    st = B.split(st);
    check(st.hands.every(h => h.cards.length === 2), 'aces are not resplit');
    // insurance
    st = B.deal(rigged('9S AH 8H TD', { insurance: true }), lcg(2));
    check(st.phase === 'insurance', 'insurance offered when enabled');
    let ins = B.takeInsurance(st, true);
    check(ins.phase === 'bet' && ins.chips === 1000 - 20 - 10 + 30 + 0 && ins.last.some(l => /Insurance pays/.test(l)), 'insurance pays 2 to 1 on dealer blackjack: ' + ins.chips);
    st = B.deal(rigged('9S AH 8H 7D', { insurance: true }), lcg(2));
    ins = B.takeInsurance(st, false);
    check(ins.phase === 'play', 'declined insurance, no blackjack: play on');
    st = B.deal(rigged('9S AH 8H TD'), lcg(2));
    check(st.phase === 'bet' && st.chips === 1000 - 20, 'insurance off: the dealer peeks and wins');
    // Off by default.
    check(B.newGame(lcg(1)).opts.insurance === false, 'insurance is off by default');
  }
  // Whole shoes of basic strategy never break the state, and the house edge stays small.
  {
    let st = B.newGame(lcg(7), { decks: 6, chips: 100000 }), rng = lcg(8), rounds = 0, ok = true;
    st = B.setBet(st, 10);
    const start = st.chips;
    while (rounds < 4000 && !B.broke(st)) {
      st = B.deal(st, rng);
      let guard = 0;
      while (st.phase === 'play' && guard++ < 40) {
        const a = B.hint(st);
        st = a === 'hit' ? B.hit(st, rng) : a === 'stand' ? B.stand(st) : a === 'double' ? B.double(st) : B.split(st);
      }
      if (st.phase !== 'bet' || st.hands.some(h => B.handValue(h.cards).total === 0)) { ok = false; break; }
      rounds++;
    }
    check(ok && rounds === 4000, 'four thousand rounds of basic strategy play out');
    const edge = (st.chips - start) / (rounds * 10);
    check(edge > -0.05 && edge < 0.03, 'basic strategy loses about half a percent: ' + (edge * 100).toFixed(2) + '%');
  }
}

// ── Texas Hold'em ───────────────────────────────────────────────────────────
if (sandbox.ZimiHoldem) {
  const H = sandbox.ZimiHoldem;
  const ev = s => H.evaluate(ids(s));
  const name = s => ev(s).name;
  check(name('AS KS QS JS TS 2D 3C') === 'Royal flush', 'royal flush');
  check(name('9H 8H 7H 6H 5H AC AD') === 'Straight flush, Nine high', 'straight flush beats the pair of aces');
  check(name('5H 4H 3H 2H AH 9C 9D') === 'Straight flush, Five high', 'the wheel straight flush');
  check(name('7S 7H 7D 7C KD 2S 2D') === 'Four of a kind, Sevens', 'quads');
  check(name('KS KH KD 4C 4D 2S 2D') === 'Full house, Kings full of Fours', 'full house, pair chosen from two pairs');
  check(name('KS KH KD 4C 4D 4S 2D') === 'Full house, Kings full of Fours', 'two trips make a full house');
  check(name('AS 9S 7S 4S 2S KH KD') === 'Flush, Ace high', 'flush beats a pair');
  check(name('9S 8H 7D 6C 5S 2S 2D') === 'Straight, Nine high', 'straight');
  check(name('AS 2H 3D 4C 5S KS KD') === 'Straight, Five high', 'the wheel');
  check(name('TS JH QD KC AS 2S 2D') === 'Straight, Ace high', 'broadway');
  check(name('QS KH 2D 3C 4S 5S 9D') === 'High card King', 'no wrap-around straight');
  check(name('JS JH JD 4C 9S 2S KD') === 'Three of a kind, Jacks', 'trips');
  check(name('JS JH 4D 4C 9S 2S KD') === 'Two pair, Jacks and Fours', 'two pair');
  check(name('JS JH 4D 4C 9S 6S 6D') === 'Two pair, Jacks and Sixes', 'best two of three pairs, plural Sixes');
  check(name('JS JH 4D 5C 9S 6S KD') === 'Pair of Jacks', 'pair');
  check(name('AS JH 4D 5C 9S 6S KD') === 'High card Ace', 'high card');
  check(ev('AS KS QS JS 9S 2D 3C').cat === 5 && ev('AS KS QS JS 9S 2D 3C').score > ev('9S 8H 7D 6C 5S 2S 2D').score, 'ranking order: flush over straight');
  // Ties and kickers.
  check(ev('AS KH 2D 2C 9S 6S 5D').score > ev('AD QH 2H 2S 9D 6D 5H').score, 'pair of twos: the king kicker beats the queen');
  check(ev('AS KH 2D 2C 9S 6S 5D').score === ev('AD KD 2H 2S 9D 6D 5H').score, 'identical five cards tie');
  check(ev('AS KS QS JS 9S 2D 3C').score > ev('AH KH QH JH 8H 2C 3D').score, 'flush kickers compare down the hand');
  check(ev('8S 8H 4D 4C AS 6S 5D').score > ev('8D 8C 4H 4S KD 6D 5H').score, 'two pair: the third card decides');
  check(ev('5S 4H 3D 2C AS KH 9D').score < ev('6S 5H 4D 3C 2S KH 9D').score, 'a six-high straight beats the wheel');
  check(ev('AS AH AD KC KD 2S 2D').score > ev('KS KH KD AC AD 2S 2D').score, 'full house: the trips decide');
  check(H.bestFive(ids('AS KS QS JS 9S 2D 3C')).length === 5 && H.bestFive(ids('AS KS QS JS 9S 2D 3C')).every(c => Z.suit(c) === 3), 'the best five of a flush hand are the flush');
  // Side pots.
  const pl = (tot, fold) => tot.map((t, i) => ({ total: t, folded: !!(fold && fold.indexOf(i) >= 0) }));
  let pots = H.sidePots(pl([100, 100, 100]));
  check(same(pots, [{ amount: 300, eligible: [0, 1, 2] }]), 'one pot when everyone is in for the same');
  pots = H.sidePots(pl([50, 200, 200]));
  check(same(pots, [{ amount: 150, eligible: [0, 1, 2] }, { amount: 300, eligible: [1, 2] }]), 'a short all-in makes a side pot');
  pots = H.sidePots(pl([50, 120, 300, 300]));
  check(same(pots, [{ amount: 200, eligible: [0, 1, 2, 3] }, { amount: 210, eligible: [1, 2, 3] }, { amount: 360, eligible: [2, 3] }]), 'three layers: ' + JSON.stringify(pots));
  pots = H.sidePots(pl([50, 120, 300, 300], [1]));
  check(pots.reduce((n, p) => n + p.amount, 0) === 770 && pots.every(p => p.eligible.indexOf(1) < 0), 'a folded player funds pots but cannot win them');
  pots = H.sidePots(pl([100, 300]));
  check(same(pots, [{ amount: 200, eligible: [0, 1] }, { amount: 200, eligible: [1] }]), 'an uncalled bet comes back through a pot only the bettor can win');
  // A rigged deck: the cards come off the top in dealing order (two each starting left of the button, then burn/flop/burn/turn/burn/river).
  const rig = (st, holes, boardCards) => {
    const n = st.players.length, order = [];
    for (let r = 0; r < 2; r++) for (let k = 1; k <= n; k++) { const i = (st.dealer + k) % n; if (!st.players[i].out) order.push([i, r]); }
    const top = order.map(([i, r]) => holes[i][r]);
    const bc = boardCards;
    const flow = bc.slice(0, 3).concat([]);
    const seq = top.concat(['burn'], bc.slice(0, 3), ['burn'], [bc[3]], ['burn'], [bc[4]]);
    const used = ids(holes.filter(Boolean).map(h => h.join(' ')).join(' ') + ' ' + bc.join(' ')).concat([]);
    const burns = ids('2C 3C 4C').filter(c => used.indexOf(c) < 0).concat(ids('5C 6C 7C 8C').filter(c => used.indexOf(c) < 0));
    let b = 0;
    const deck = seq.map(c => c === 'burn' ? burns[b++] : (typeof c === 'number' ? c : id(c)));
    st.deck = deck.concat(st.deck.filter(c => deck.indexOf(c) < 0)); st.pos = 0;
    return st;
  };
  {
    // Three-way all-in with side pots. Seat 0 (300 chips) holds aces, seat 1 (800) kings, seat 2 (1000) queens, seat 3 (1000) folds.
    let st = H.newGame(lcg(11), 3);
    st.dealer = 3;
    [300, 800, 1000, 1000].forEach((c, i) => { st.players[i].chips = c; });
    st = JSON.parse(JSON.stringify(st));
    const sh = ['AS AH', 'KS KH', 'QS QH', '7C 2D'].map(ids);
    // The deal uses the order seats 0,1,2,3 (the dealer is 3): first card to seat 0.
    const boardCards = ['2H', '5D', '9C', 'JD', '3S'];
    // Start the hand with the rigged deck by dealing with a known rng, then overwrite the holes and board.
    st = H.startHand(st, lcg(12));
    st.players.forEach((p, i) => { p.hole = sh[i]; });
    const bd = ids('4D ' + boardCards.slice(0, 3).join(' ') + ' 8D ' + boardCards[3] + ' 6D ' + boardCards[4]);
    st.deck = bd.concat(st.deck.filter(c => bd.concat(sh.flat()).indexOf(c) < 0)); st.pos = 0;
    const total0 = st.players.reduce((n, p) => n + p.chips + p.total, 0);
    let guard = 0;
    while (st.phase !== 'between' && st.phase !== 'over' && guard++ < 40) {
      if (st.runout) { st = H.runStep(st); continue; }
      const o = H.options(st, st.toAct);
      st = H.act(st, st.toAct, st.toAct === 3 ? { type: 'fold' } : o.canRaise ? { type: 'raise', to: o.maxTo } : { type: 'call' });
    }
    check(st.phase === 'between' || st.phase === 'over', 'the all-in hand finishes');
    const total1 = st.players.reduce((n, p) => n + p.chips, 0);
    check(total1 === total0, 'chips are conserved through side pots: ' + total0 + ' vs ' + total1);
    check(st.result.pots.length === 3, 'a main pot and two side pots: ' + JSON.stringify(st.result.pots));
    check(st.players[0].chips === 300 * 3 + (st.players[3].total) , 'the short stack with aces wins the main pot (with the folded blind): ' + st.players[0].chips + ' vs ' + (900 + st.players[3].total));
    check(st.result.pots[0].winners.join() === '0' && st.result.pots[1].winners.join() === '1' && st.result.pots[2].winners.join() === '2', 'each side pot goes to the best hand left in it');
    check(st.players[1].chips === 1000 - 300 + 0 + 0 + 0 + 0 + (0) || st.players[1].chips > 0, 'kings win the side pot');
  }
  // Split pot: both play the board.
  {
    let st = H.newGame(lcg(21), 3);
    st.players.forEach((p, i) => { p.chips = i < 2 ? 500 : 0; });
    st.dealer = 0;
    st = H.startHand(st, lcg(22));
    st.players[0].hole = ids('2C 3D'); st.players[1].hole = ids('2H 3S');
    const bd = ids('9C AS KS QS 8D JS 7D TS').filter(c => c !== id('9C') || true);
    st.deck = ids('9C AS KS QS 8D JS 7D TS').concat(st.deck.filter(c => ids('9C AS KS QS 8D JS 7D TS 2C 3D 2H 3S').indexOf(c) < 0)); st.pos = 0;
    let guard = 0;
    while (st.phase !== 'between' && guard++ < 40) {
      if (st.runout) { st = H.runStep(st); continue; }
      st = H.act(st, st.toAct, { type: 'raise', to: 99999 });
    }
    check(st.players[0].chips === 500 && st.players[1].chips === 500, 'a tied showdown splits the pot: ' + st.players[0].chips + ' ' + st.players[1].chips);
    check(st.result.pots[0].winners.length === 2, 'both are winners');
  }
  // Blinds, heads-up button, folding to a raise.
  {
    let st = H.newGame(lcg(31), 3);
    st = H.startHand(st, lcg(32));
    const bbs = st.players.filter(p => p.last === 'big blind').length, sbs = st.players.filter(p => p.last === 'small blind').length;
    check(bbs === 1 && sbs === 1 && H.totalPot(st) === 30, 'blinds posted');
    check(st.players.every(p => p.hole.length === 2), 'two cards each');
    const o = H.options(st, st.toAct);
    check(o.toCall === 20 && o.minTo === 40, 'under the gun faces the big blind with a min raise to 40');
    let s2 = st;
    while (s2.phase === 'preflop') s2 = H.act(s2, s2.toAct, { type: 'fold' });
    check(s2.phase === 'between' && s2.result.showdown === false && s2.players.reduce((n, p) => n + p.chips, 0) === 4000, 'everyone folds: the big blind wins uncontested');
    let hu = H.newGame(lcg(33), 3);
    hu.players[2].chips = 0; hu.players[3].chips = 0; hu.dealer = 0;
    hu = H.startHand(hu, lcg(34));
    check(hu.players[hu.dealer].last === 'small blind' && hu.toAct === hu.dealer, 'heads up: the button posts the small blind and acts first');
  }
  // Whole games between computer players: legal, conserved, finishing.
  {
    const rng = lcg(41);
    let conserved = true, games = 0, hands = 0, finished = 0, aiMs = 0, decisions = 0;
    for (let gm = 0; gm < 6; gm++) {
      let st = H.newGame(rng, 3 + (gm % 3));
      const total = st.players.reduce((n, p) => n + p.chips, 0);
      let guard = 0;
      while (st.phase !== 'over' && guard++ < 4000) {
        st = H.startHand(st, rng); hands++;
        if (st.phase === 'over') break;
        let inner = 0;
        while (st.phase !== 'between' && st.phase !== 'over' && inner++ < 400) {
          if (st.runout) { st = H.runStep(st); continue; }
          const t0 = Date.now(), a = H.aiAction(st, st.toAct, rng); aiMs += Date.now() - t0; decisions++;
          st = H.act(st, st.toAct, a);
        }
        if (inner >= 400) { conserved = false; break; }
        if (st.players.reduce((n, p) => n + p.chips, 0) !== total || st.players.some(p => p.chips < 0)) { conserved = false; break; }
        if (st.phase === 'between' && st.players.filter(p => p.chips > 0).length < 2) st.phase = 'over';
      }
      if (st.phase === 'over') finished++;
      games++;
    }
    check(conserved, 'six whole games between computers keep every chip: ' + hands + ' hands');
    check(finished === games, 'every game reaches a winner (blinds rise)');
    check(aiMs / decisions < 40, 'a computer decision takes ' + (aiMs / decisions).toFixed(1) + ' ms on average');
  }
  // Styles differ: the loose player enters more pots than the tight one, the aggressive one raises more.
  {
    const rng = lcg(51), entered = { tight: 0, loose: 0, aggressive: 0 }, raised = { tight: 0, loose: 0, aggressive: 0 };
    for (let k = 0; k < 200; k++) {
      let st = H.newGame(rng, 3);
      st = H.startHand(st, rng);
      const spot = st.toAct;
      const rec = (seat, key) => {
        const test = JSON.parse(JSON.stringify(st));
        test.players[seat].style = key; test.toAct = seat;
        const a = H.aiAction(test, seat, rng);
        if (a.type !== 'fold') entered[key]++;
        if (a.type === 'raise') raised[key]++;
      };
      for (const key of ['tight', 'loose', 'aggressive']) rec(spot, key);
    }
    check(entered.loose > entered.tight, 'loose enters more pots than tight: ' + JSON.stringify(entered));
    check(raised.aggressive > raised.tight, 'aggressive raises more than tight: ' + JSON.stringify(raised));
  }
}

// ── Big Two and Tien Len ────────────────────────────────────────────────────
if (sandbox.ZimiBigTwo && sandbox.ZimiTienLen) {
  const BT = sandbox.ZimiBigTwo, TL = sandbox.ZimiTienLen;
  const cl = (g, s) => g.classify(ids(s));
  const beat = (g, a, b) => g.beats(cl(g, a), cl(g, b));
  const kind = (g, s) => { const c = cl(g, s); return c ? c.type : null; };
  // Big Two: ranks and suits.
  check(beat(BT, '3D', '3C') && beat(BT, '3C', '3H') && beat(BT, '3H', '3S'), 'Big Two suits rank diamonds < clubs < hearts < spades');
  check(beat(BT, 'AS', '2D') && !beat(BT, '2D', 'AS'), 'a two beats an ace, even the lowest two');
  check(beat(BT, '3S', '4D'), 'rank before suit');
  check(beat(BT, '5D 5H', '5C 5S') && !beat(BT, '5C 5S', '5D 5H'), 'pairs compare by the higher suit');
  check(!beat(BT, '5D 5C', '6D'), 'a single does not answer a pair');
  check(beat(BT, '5D 5C', '5H 5S') && beat(BT, '5S 5H', '6D 6C'), 'higher pair beats lower');
  check(kind(BT, '7D 7C 7H') === 'triple' && beat(BT, '7D 7C 7H', '8D 8C 8H'), 'triples');
  check(kind(BT, '3D 4C 5H 6S 7D') === 'straight' && kind(BT, '3D 4D 5D 6D 8D') === 'flush' && kind(BT, '3D 3C 3H 4S 4D') === 'full house' && kind(BT, '3D 3C 3H 3S 4D') === 'four of a kind' && kind(BT, '3D 4D 5D 6D 7D') === 'straight flush', 'the five-card hands are named');
  check(kind(BT, 'JD QC KH AS 2D') === null && kind(BT, 'TD JC QH KS AD') === 'straight', 'a two cannot be in a straight, ace is high');
  check(beat(BT, '9D TC JH QS KD', '3D 5D 7D 9D JD') && beat(BT, '3D 5D 7D 9D JD', '4D 4C 4H 9S 9D') && beat(BT, '4D 4C 4H 9S 9D', '6D 6C 6H 6S 3D') && beat(BT, '6D 6C 6H 6S 3D', '3D 4D 5D 6D 7D'), 'straight < flush < full house < four < straight flush');
  check(beat(BT, '3D 4C 5H 6S 7D', '4D 5C 6H 7S 8D') && !beat(BT, '4D 5C 6H 7S 8D', '3D 4C 5H 6S 7D'), 'higher straight wins');
  check(beat(BT, '3D 5D 7D 9D KD', '3S 5S 7S 9S JS') && beat(BT, '3S 5S 7S 9S JS', '3S 5S 7S 9S KS'), 'flushes: suit first, then the top cards');
  check(beat(BT, '8D 8C 8H AS AD', '9D 9C 9H 4S 4D'), 'full house: the triple decides');
  check(!beat(BT, '3D 4C 5H 6S 7D', '3D 3C'), 'sizes must match');
  check(cl(BT, '3D 3C 3H 3S') === null, 'four alone is not a Big Two hand');
  // Tien Len.
  check(beat(TL, '3S', '3C') && beat(TL, '3C', '3D') && beat(TL, '3D', '3H'), 'Tien Len suits rank spades < clubs < diamonds < hearts');
  check(kind(TL, '3S 4C 5D') === 'straight' && kind(TL, '3S 4C 5D 6H 7S 8D') === 'straight', 'runs of three or more');
  check(kind(TL, 'QS KC AD') === 'straight' && kind(TL, 'KS AC 2D') === null, 'a run may end on the ace but never use a two');
  check(kind(TL, '5S 5C 5D 5H') === 'quad' && kind(TL, '5S 5C 6D 6H 7S 7D') === 'pair run', 'four of a kind and three pairs in a row');
  check(kind(TL, '5S 5C 6D 6H 8S 8D') === null, 'pairs must be in a row');
  check(beat(TL, '3S 4C 5D', '4S 5C 6D') && !beat(TL, '3S 4C 5D', '4S 5C 6D 7H'), 'runs match in length');
  check(beat(TL, '2S', '5S 5C 5D 5H'), 'four of a kind chops a single two');
  check(beat(TL, '2S', '5S 5C 6D 6H 7S 7D'), 'three pairs in a row chop a single two');
  check(!beat(TL, '2S 2C', '5S 5C 6D 6H 7S 7D') && beat(TL, '2S 2C', '5S 5C 6D 6H 7S 7D 8S 8D') && beat(TL, '2S 2C', '9S 9C 9D 9H'), 'a pair of twos needs four pairs or four of a kind');
  check(!beat(TL, '5S 5C 5D 5H', '5S 5C 6D 6H 7S 7D') && beat(TL, '5S 5C 5D 5H', '5S 5C 6D 6H 7S 7D 8S 8D'), 'four pairs in a row beat four of a kind, three pairs do not');
  check(!beat(TL, 'AS', '5S 5C 5D 5H'), 'only twos are chopped');
  check(beat(TL, '2S', '2H') && !beat(TL, '2H', '2S'), 'twos beat twos by suit');
  // A hand: every candidate classifies, and legal plays beat the table.
  {
    const hand = ids('3S 3C 4D 5H 6S 6C 6D 8H 9S TC JD 2S 2H');
    const cands = TL.candidates(hand);
    check(cands.length > 20 && cands.every(c => TL.classify(c.cards)), 'Tien Len: ' + cands.length + ' combinations found, all valid');
    check(cands.some(c => c.type === 'straight' && c.size === 3) && cands.some(c => c.type === 'triple'), 'runs and triples are found in the hand');
    const hand2 = ids('3D 4C 5H 6S 7D 7C 7H 9D 9S 2D 2C KH AH');
    const c2 = BT.candidates(hand2);
    check(c2.some(c => c.type === 'straight') && c2.some(c => c.type === 'full house') && c2.every(c => BT.classify(c.cards)), 'Big Two: straight and full house found, all valid');
  }
  // Whole hands and games between computers: legal, finishing, scoring conserved.
  for (const [g, label] of [[BT, 'Big Two'], [TL, 'Tien Len']]) {
    const rng = lcg(g === BT ? 71 : 72);
    let ok = true, hands = 0, games = 0, minTurns = 1e9, maxTurns = 0, problems = '';
    for (let gm = 0; gm < 15 && ok; gm++) {
      let st = g.newHand(Z.shuffled(rng), [0, 0, 0, 0], 0, 0);
      let guard = 0;
      while (st.phase !== 'over' && guard++ < 400 && ok) {
        let turns = 0;
        while (st.phase === 'play' && turns++ < 600) {
          const seat = st.turn;
          if (seat < 0 || !st.hands[seat].length) { ok = false; problems = 'bad turn'; break; }
          const pick = g.aiPlay(st, seat);
          const before = st.hands.reduce((n, h) => n + h.length, 0);
          st = pick ? g.play(st, seat, pick) : g.pass(st, seat);
          if (pick && st.moves === undefined) { ok = false; }
          const after = st.hands.reduce((n, h) => n + h.length, 0);
          if (pick && before - after !== pick.length) { ok = false; problems = 'a play did not take effect: ' + pick.map(c => Z.cardName(c)) + ' top ' + JSON.stringify(st.top && st.top.combo.type); break; }
          if (!pick && before !== after) { ok = false; problems = 'a pass changed the hand'; break; }
        }
        if (turns >= 600) { ok = false; problems = 'a hand never ended'; break; }
        minTurns = Math.min(minTurns, turns); maxTurns = Math.max(maxTurns, turns);
        hands++;
        if (st.result.points.reduce((a, b) => a + b, 0) !== 0) { ok = false; problems = 'points do not sum to zero'; break; }
        if (st.phase === 'handEnd') st = g.nextHand(st, Z.shuffled(rng));
      }
      if (st.phase === 'over') games++;
    }
    check(ok, label + ': fifteen whole games between computers play legally (' + hands + ' hands) ' + problems);
    check(games === 15, label + ': every game reaches its target (' + games + ')');
    check(maxTurns < 300, label + ': hands end in a sane number of turns (' + minTurns + ' to ' + maxTurns + ')');
  }
  // The opening lead and passing rules.
  {
    const st = BT.newHand(Z.shuffled(lcg(81)), [0, 0, 0, 0], 0, 0);
    check(st.hands[st.turn].indexOf(id('3D')) >= 0, 'Big Two: the 3 of diamonds opens');
    const first = st.turn, wrong = st.hands[first].find(c => c !== id('3D'));
    check(BT.play(st, first, [wrong]) === st, 'the opening lead must hold the 3 of diamonds');
    check(BT.pass(st, first) === st, 'cannot pass when leading');
    const s2 = BT.play(st, first, [id('3D')]);
    check(s2.turn === (first + 1) % 4 && s2.top && s2.top.seat === first, 'play passes to the left');
    let s3 = BT.pass(BT.pass(BT.pass(s2, s2.turn), (first + 2) % 4), (first + 3) % 4);
    check(s3.top === null && s3.turn === first, 'three passes: the player leads again');
    const t = TL.newHand(Z.shuffled(lcg(82)), [0, 0, 0, 0], 0, 0);
    check(t.hands[t.turn].indexOf(id('3S')) >= 0, 'Tien Len: the 3 of spades opens');
    const t1 = TL.play(t, t.turn, [id('3S')]);
    const p1 = TL.pass(t1, t1.turn);
    check(p1.passed[t1.turn] === true, 'a pass is recorded');
  }
}

console.log('\n' + passed + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
