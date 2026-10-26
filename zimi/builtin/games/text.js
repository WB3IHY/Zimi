/* ZimiGames: ZimiText, the one door every visible and spoken string goes through. Our own code, GPL-3.0.

     T('shell.menu.new')                      a string by id
     T('cards.count', { n: 3 })               named slots, never concatenation; numbers format with Intl
     T('cards.count', { n: 1 })               a plural entry ({ one, other, ... }) picks its form with Intl.PluralRules
     ZimiText.clock(75)  -> "1:15"            ZimiText.ago(ms)  -> "5 minutes ago" (Intl.RelativeTimeFormat)
     ZimiText.number(1234.5)                  ZimiText.lang / ZimiText.dir

   English ships in the ZIM as text/en.json; the block between the markers below is that file, written by
   scripts/games_text.py, so the page has its strings before the first paint (a translation is fetched later
   as text/<lang>.json and fills in what it has). The language comes from the hash Zimi passes
   (#lang=fr&dir=ltr), else navigator.language; it sets <html lang dir>. shell.js loads this file first. */
(function (root) {
  'use strict';
  var EN = /* en:begin */{
 "board.black": "Black",
 "board.blue": "Blue",
 "board.chooseWhere": "Choose where to move",
 "board.computer": "Computer",
 "board.fairyNote": "Strong is unavailable here, so the computer plays at its own best level. {thinking}",
 "board.first": "First",
 "board.flip": "Flip",
 "board.green": "Green",
 "board.hint": "Hint",
 "board.level": "Level",
 "board.level.easy": "Easy",
 "board.level.hard": "Hard",
 "board.level.medium": "Medium",
 "board.opponent": "Opponent",
 "board.pass": "Pass",
 "board.record": "{level}: {won} won, {lost} lost",
 "board.record.draws": "{level}: {won} won, {lost} lost, {drawn} drawn",
 "board.red": "Red",
 "board.second": "Second",
 "board.timeUp": "Time ran out. A move was played for you.",
 "board.toMove": "{name} to move",
 "board.twoPlayers": "Two players",
 "board.undo": "Undo",
 "board.watch.done": "{text} That was the whole game. Press Done to play one yourself.",
 "board.watching": "Watching",
 "board.white": "White",
 "board.yellow": "Yellow",
 "board.you": "You",
 "board.youPlay": "You play",
 "board.yourTurn": "Your turn",
 "cards.back.castle": "Castle",
 "cards.back.classic": "Classic",
 "cards.back.night": "Night sky",
 "cards.back.robot": "Robot",
 "cards.back.sea": "The sea",
 "cards.back.zimi": "Zimi",
 "cards.backLabel": "{name} card back",
 "cards.backs": "Card backs",
 "cards.backsMore": "Card backs…",
 "cards.cancelled": "Cancelled",
 "cards.choices": "Choices",
 "cards.done": "Done",
 "cards.look": "Look",
 "cards.moved": "Moved",
 "cards.n.bag": {
  "one": "{n} bag",
  "other": "{n} bags"
 },
 "cards.n.card": {
  "one": "{n} card",
  "other": "{n} cards"
 },
 "cards.n.checker": {
  "one": "{n} checker",
  "other": "{n} checkers"
 },
 "cards.n.disc": {
  "one": "{n} disc",
  "other": "{n} discs"
 },
 "cards.n.hand": {
  "one": "{n} hand",
  "other": "{n} hands"
 },
 "cards.n.heart": {
  "one": "{n} heart",
  "other": "{n} hearts"
 },
 "cards.n.liberty": {
  "one": "{n} liberty",
  "other": "{n} liberties"
 },
 "cards.n.month": {
  "one": "{n} month",
  "other": "{n} months"
 },
 "cards.n.move": {
  "one": "{n} move",
  "other": "{n} moves"
 },
 "cards.n.overtrick": {
  "one": "{n} overtrick",
  "other": "{n} overtricks"
 },
 "cards.n.piece": {
  "one": "{n} piece",
  "other": "{n} pieces"
 },
 "cards.n.point": {
  "one": "{n} point",
  "other": "{n} points"
 },
 "cards.n.round": {
  "one": "{n} round",
  "other": "{n} rounds"
 },
 "cards.n.seed": {
  "one": "{n} seed",
  "other": "{n} seeds"
 },
 "cards.n.spade": {
  "one": "{n} spade",
  "other": "{n} spades"
 },
 "cards.n.stone": {
  "one": "{n} stone",
  "other": "{n} stones"
 },
 "cards.name": "{rank} of {suit}",
 "cards.noMove": "No move",
 "cards.notAllowed": "Not allowed there",
 "cards.picked": "Picked up {card}. Choose a pile, Enter to drop.",
 "cards.pile.count": {
  "one": "{name}, {n} card",
  "other": "{name}, {n} cards"
 },
 "cards.pile.empty": "{name}, empty",
 "cards.pile.top": {
  "one": "{name}, {n} card, top {card}",
  "other": "{name}, {n} cards, top {card}"
 },
 "cards.rank.1": "ace",
 "cards.rank.10": "10",
 "cards.rank.11": "jack",
 "cards.rank.12": "queen",
 "cards.rank.13": "king",
 "cards.rank.2": "2",
 "cards.rank.3": "3",
 "cards.rank.4": "4",
 "cards.rank.5": "5",
 "cards.rank.6": "6",
 "cards.rank.7": "7",
 "cards.rank.8": "8",
 "cards.rank.9": "9",
 "cards.stats.bestScore": "Best score",
 "cards.stats.bestTime": "Best time",
 "cards.stats.played": "Played",
 "cards.stats.time": "Time",
 "cards.stats.won": "Won",
 "cards.stats.wonOf": "{won} of {played}",
 "cards.suit.clubs": "clubs",
 "cards.suit.diamonds": "diamonds",
 "cards.suit.hearts": "hearts",
 "cards.suit.spades": "spades",
 "chess.board": "Chess board",
 "chess.cantMove": "That piece cannot move",
 "chess.check": "Check. {line}",
 "chess.flipTitle": "Turn the board around",
 "chess.legalMoves": "Show legal moves",
 "chess.level.beginner": "Beginner",
 "chess.level.casual": "Casual",
 "chess.level.club": "Club",
 "chess.level.fairy": "Strong",
 "chess.level.master": "Master",
 "chess.level.strong": "Advanced",
 "chess.moves": "Moves",
 "chess.piece.1": "pawn",
 "chess.piece.2": "knight",
 "chess.piece.3": "bishop",
 "chess.piece.4": "rook",
 "chess.piece.5": "queen",
 "chess.piece.6": "king",
 "chess.promote": "Promote the pawn to",
 "chess.side.white": "White (first)",
 "chess.sq.empty": "{sq}, empty",
 "chess.sq.piece": "{sq}, {color} {piece}",
 "chess.sq.selected": "{label}, selected",
 "chess.sq.target": "{sq}, move here",
 "chess.watch.intro": "White moves first. The computer plays both sides at club level.",
 "chess.why.fifty": "A draw by the fifty-move rule.",
 "chess.why.mate": "Checkmate.",
 "chess.why.material": "A draw: neither side has enough pieces to mate.",
 "chess.why.repetition": "A draw by threefold repetition.",
 "chess.why.stalemate": "Stalemate, a draw.",
 "play.act": "Act",
 "play.actions": "Actions",
 "play.best": "Best",
 "play.board": "The board",
 "play.bomb": "Bomb",
 "play.brake": "Brake",
 "play.down": "Down",
 "play.drop": "Drop",
 "play.fire": "Fire",
 "play.gas": "Gas",
 "play.hold": "Hold",
 "play.jump": "Jump",
 "play.left": "Left",
 "play.level": "Level",
 "play.lives": "Lives",
 "play.pad": "Controls",
 "play.pause": "Pause",
 "play.paused": "Paused",
 "play.pressKey": "Press any key",
 "play.resume": "Resume",
 "play.right": "Right",
 "play.rotate": "Rotate",
 "play.score": "Score",
 "play.tapStart": "Tap to start",
 "play.thrust": "Thrust",
 "play.time": "Time",
 "play.up": "Up",
 "play.wave": "Wave",
 "shelf.chip.all": "All games",
 "shelf.chip.recent": "Recent",
 "shelf.era.ancient": "Ancient",
 "shelf.era.ancient.note": "before AD 500",
 "shelf.era.medieval": "Medieval and after",
 "shelf.era.medieval.note": "AD 500 to 1699",
 "shelf.era.modern": "1900s",
 "shelf.era.modern.note": "1900 to 1969",
 "shelf.era.parlour": "1700s to 1800s",
 "shelf.era.parlour.note": "parlors and railways",
 "shelf.era.unknown": "Age unknown",
 "shelf.era.unknown.note": "no one knows who first played it",
 "shelf.era.video": "Video game era",
 "shelf.era.video.note": "1970 on",
 "shelf.family.line": {
  "one": "{n} game. {line}",
  "other": "{n} games. {line}"
 },
 "shelf.head.az": "A to Z",
 "shelf.head.oldest": "Eras",
 "shelf.head.players": "Players",
 "shelf.head.quick": "Length",
 "shelf.head.recent": "Played",
 "shelf.head.region": "Regions",
 "shelf.head.sections": "Sections",
 "shelf.length.l10": "About 10 minutes",
 "shelf.length.l15": "About 15 minutes",
 "shelf.length.l30": "About 30 minutes",
 "shelf.length.l30p": "Half an hour and more",
 "shelf.length.l5": "About 5 minutes",
 "shelf.minutes": "{n} min",
 "shelf.minutes.plus": "{n} min+",
 "shelf.noMatch": "No game matches that.",
 "shelf.players.line": {
  "one": "{p} player",
  "other": "{p} players"
 },
 "shelf.players.many": "Three or more",
 "shelf.players.many.note": "a table full",
 "shelf.players.solo": "Solo",
 "shelf.players.solo.note": "just you",
 "shelf.players.two": "Two",
 "shelf.players.two.note": "head to head",
 "shelf.recent.none": "Nothing played yet",
 "shelf.recent.played": "Played lately",
 "shelf.recent.played.note": "newest first",
 "shelf.recent.rest": "Not played yet",
 "shelf.region.Africa": "Africa",
 "shelf.region.Americas": "Americas",
 "shelf.region.East Asia": "East Asia",
 "shelf.region.Europe": "Europe",
 "shelf.region.Middle East": "Middle East",
 "shelf.region.Oceania": "Oceania",
 "shelf.region.South Asia": "South Asia",
 "shelf.region.Southeast Asia": "Southeast Asia",
 "shelf.region.Worldwide/Modern": "Worldwide/Modern",
 "shelf.search": "Search games",
 "shelf.searchN": {
  "one": "Search {n} game",
  "other": "Search {n} games"
 },
 "shelf.searchShort": "Search",
 "shelf.sort.az": "A to Z",
 "shelf.sort.oldest": "Oldest first",
 "shelf.sort.players": "By players",
 "shelf.sort.quick": "Quick games first",
 "shelf.sort.recent": "Recently played",
 "shelf.sort.region": "By region",
 "shelf.sort.sections": "Sections",
 "shelf.sortGames": "Sort games",
 "shelf.table.classic": "A classic",
 "shelf.table.idle": "Start something",
 "shelf.table.last": "Last played:",
 "shelf.table.played": "On the table",
 "shelf.today": "Game of the day",
 "shelf.view": "Shelf view",
 "shelf.view.index": "Index",
 "shelf.view.lobby": "Lobby",
 "shelf.year.bc": "c. {y} BC",
 "shell.back": "Back",
 "shell.cancel": "Cancel",
 "shell.choose": "Choose…",
 "shell.close": "Close",
 "shell.end.draw": "Draw",
 "shell.end.lose": "You lose",
 "shell.end.over": "Game over",
 "shell.end.win": "You win",
 "shell.end.wins": "{name} wins",
 "shell.fast": "Fast",
 "shell.help.end": "The end",
 "shell.help.goal": "Goal",
 "shell.help.keys": "Keys",
 "shell.help.tip": "Tip",
 "shell.help.turn": "Your turn",
 "shell.menu": "Menu",
 "shell.menu.about": "About this game",
 "shell.menu.history": "History",
 "shell.menu.how": "How to play",
 "shell.menu.new": "New game",
 "shell.menu.settings": "Settings",
 "shell.menu.stats": "Stats",
 "shell.menu.watch": "Watch and learn",
 "shell.meta.era": "Era",
 "shell.meta.length": "Length",
 "shell.meta.origin": "Origin",
 "shell.meta.players": "Players",
 "shell.meta.region": "Region",
 "shell.meta.year": "Year",
 "shell.new.ask": "Start a new game?",
 "shell.new.lost": "Your current game will be lost.",
 "shell.normal": "Normal",
 "shell.off": "Off",
 "shell.on": "On",
 "shell.running": "Running",
 "shell.seconds": "{n} s",
 "shell.set.allGames": "All games",
 "shell.set.anim": "Animation",
 "shell.set.cardBack": "Card back",
 "shell.set.confirm": "Ask before a new game",
 "shell.set.hints": "Hints",
 "shell.set.moveTimer": "Move timer",
 "shell.set.moveTimerNote": "Time for each of your turns. When it runs out, a move is played for you.",
 "shell.set.reducedNote": "Off now, because your device asks for less motion.",
 "shell.set.scope": "Applies to",
 "shell.set.sound": "Sound",
 "shell.set.thisGame": "This game only",
 "shell.set.timer": "Timer",
 "shell.set.useAll": "Use the settings for all games",
 "shell.start": "Start",
 "shell.stats.none": "Nothing yet. Finish a game and it shows here.",
 "shell.summary.anim": "Animation {mode}",
 "shell.summary.timer": "Timer off",
 "shell.thinking": "Computer is thinking",
 "shell.watch.intro": "The computer plays both sides and explains each move. You can pause, step or take over at any time.",
 "shell.watch.running": "The computer is playing both sides. Use the bar under the title to pause, step or take over.",
 "shell.watch.start": "Start watching",
 "shell.watch.stop": "Stop watching",
 "snake.apples": "Apples",
 "snake.bestWalls": "Best with walls",
 "snake.bestWrap": "Best with wrap",
 "snake.readyKeys": "Press an arrow key to start",
 "snake.readyTouch": "Tap to start, then swipe to turn",
 "snake.wrap": "Wrap around",
 "time.day": {
  "one": "{n} day ago",
  "other": "{n} days ago"
 },
 "time.hour": {
  "one": "{n} hour ago",
  "other": "{n} hours ago"
 },
 "time.minute": {
  "one": "{n} minute ago",
  "other": "{n} minutes ago"
 },
 "time.month": {
  "one": "{n} month ago",
  "other": "{n} months ago"
 },
 "time.now": "just now",
 "time.week": {
  "one": "{n} week ago",
  "other": "{n} weeks ago"
 },
 "time.year": {
  "one": "{n} year ago",
  "other": "{n} years ago"
 }
}/* en:end */;
  var RTL = /^(ar|fa|he|iw|ur|ps|sd|yi|dv|ug|ckb)(-|$)/;
  var tables = { en: EN }, listeners = [];

  // The hash as { key: value }: "#lang=fr&dir=ltr".
  function hashParams() {
    var out = {}, h = (root.location && root.location.hash || '').replace(/^#/, '');
    h.split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) { try { out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } catch (e) { /* bad escape: skipped */ } } });
    return out;
  }
  function detect() {
    var p = hashParams(), l = p.lang || (root.navigator && (root.navigator.language || '')) || 'en';
    l = String(l).toLowerCase().replace('_', '-');
    return /^[a-z]{2,3}(-[a-z0-9]+)*$/.test(l) ? l : 'en';
  }
  var Text = { lang: detect(), dir: 'ltr', table: tables };
  var hashDir = hashParams().dir;
  Text.dir = hashDir === 'rtl' || (hashDir !== 'ltr' && RTL.test(Text.lang)) ? 'rtl' : 'ltr';

  // The tables to read, best first: the exact language, its base language, English.
  function chain() {
    var l = Text.lang, base = l.split('-')[0], out = [];
    if (tables[l]) out.push(tables[l]);
    if (base !== l && tables[base]) out.push(tables[base]);
    out.push(EN);
    return out;
  }
  function entry(key) {
    var c = chain(), i;
    for (i = 0; i < c.length; i++) if (Object.prototype.hasOwnProperty.call(c[i], key)) return c[i][key];
    return undefined;
  }
  function locale() { return Text.lang; }
  function number(n, opts) {
    try { return new Intl.NumberFormat(locale(), opts).format(n); } catch (e) { return String(n); }
  }
  function plural(n) {
    try { return new Intl.PluralRules(locale()).select(n); } catch (e) { return n === 1 ? 'one' : 'other'; }
  }
  function fill(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      if (!vars || !(k in vars)) return m;
      var v = vars[k];
      return typeof v === 'number' ? number(v) : String(v);
    });
  }
  // T(key, vars): a plural entry is chosen by vars.n.
  function T(key, vars) {
    var e = entry(key);
    if (e === undefined) return key;
    if (e && typeof e === 'object') {
      var n = vars && typeof vars.n === 'number' ? vars.n : 0, form = plural(n);
      e = e[form] !== undefined ? e[form] : (e.other !== undefined ? e.other : key);
    }
    return fill(e, vars);
  }
  // 75 seconds is "1:15"; an hour or more shows hours. Digits follow the language.
  function clock(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    var two = function (x) { return number(x, { minimumIntegerDigits: 2, useGrouping: false }); };
    return h ? number(h, { useGrouping: false }) + ':' + two(m) + ':' + two(s) : number(m, { useGrouping: false }) + ':' + two(s);
  }
  var AGO_STEPS = [['year', 31536000000], ['month', 2592000000], ['week', 604800000], ['day', 86400000], ['hour', 3600000], ['minute', 60000]];
  function ago(ms) {
    ms = Math.max(0, ms);
    if (ms < 60000) return T('time.now');
    for (var i = 0; i < AGO_STEPS.length; i++) {
      if (ms >= AGO_STEPS[i][1]) {
        var n = Math.floor(ms / AGO_STEPS[i][1]);
        try { return new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }).format(-n, AGO_STEPS[i][0]); } catch (e) { return T('time.' + AGO_STEPS[i][0], { n: n }); }
      }
    }
    return T('time.now');
  }
  // A translation: add it (a file's parsed JSON) and repaint whoever asked to hear.
  function add(lang, table) {
    tables[lang] = Object.assign(tables[lang] || {}, table);
    listeners.slice().forEach(function (f) { try { f(); } catch (e) { /* one listener must not stop the rest */ } });
  }
  function applyDocument() {
    var de = root.document && root.document.documentElement;
    if (de && de.setAttribute) { de.setAttribute('lang', Text.lang); de.setAttribute('dir', Text.dir); }
  }
  // Fetch text/<lang>.json beside this file when the language is not English; a missing file leaves English.
  function load(base) {
    var l = Text.lang.split('-')[0];
    if (l === 'en' || !root.fetch || !base) return;
    root.fetch(String(base).replace(/[^/]*$/, '') + 'text/' + l + '.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (t) { if (t) add(l, t); }).catch(function () { /* English stays */ });
  }

  Text.T = T; Text.number = number; Text.plural = plural; Text.clock = clock; Text.ago = ago; Text.add = add;
  Text.onChange = function (f) { listeners.push(f); };
  Text.applyDocument = applyDocument; Text.load = load; Text.has = function (k) { return entry(k) !== undefined; };
  if (typeof module !== 'undefined' && module.exports) { module.exports = Text; return; }
  root.ZimiText = Text;
  applyDocument();
  var self = root.document && root.document.currentScript;
  if (self && self.src) load(self.src);
})(typeof globalThis !== 'undefined' ? globalThis : window);
