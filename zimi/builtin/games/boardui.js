/* ZimiGames: what the board games share on top of the shell (shell.js) and the board kit (boardkit.js):
   option rows for Menu > New game, the thinking state, the illegal-move refusal, the end sheet, the record line,
   and the strings a page holds in its markup. Our own code, GPL-3.0. No network, no modules.

     BoardUI.t(id, vars)                  a string by id (ZimiText.T)
     BoardUI.localize(root)               fills [data-t] (text), [data-t-aria] (aria-label), [data-t-title] (title) from the
                                          string table, now and whenever the language changes; the markup keeps its English
     BoardUI.row(label, choices, value, onPick)       an option row: a 13px label and a segmented control. choices is
                                          [[value, label], ...]; returns { el, value(), set(v) }
     BoardUI.toggle(label, value, onPick)             the same for a yes or no (On and Off), value a boolean
     BoardUI.options(rows)                the object ZimiShell.game({ menu }) wants: { options: [nodes] }
     BoardUI.status(el)                   the page's one status line: { say(text), reason(text), thinking(on), turn(text) }
     BoardUI.refuse(statusApi, el, text)  an illegal move: the shake on el and the reason on the status line
     BoardUI.end(opts)                    ZimiShell.endSheet with the board games' defaults
     BoardUI.record(el, level, rec)       "Medium: 3 won, 1 lost" in the records line (empty until the first game)
     BoardUI.side(color)                  the word for a side ("White", "Black", ...) by id */
(function (root) {
  'use strict';
  var d = root.document;
  function T(id, vars) { return root.ZimiText ? root.ZimiText.T(id, vars) : id; }
  function shell() { return root.ZimiShell; }
  function h(tag, attrs, kids) {
    var e = d.createElement(tag), k;
    for (k in (attrs || {})) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (n) { if (n) e.appendChild(n); });
    return e;
  }

  // ── strings held in markup ──
  var MAP = [['data-t', function (e, s) { e.textContent = s; }], ['data-t-aria', function (e, s) { e.setAttribute('aria-label', s); }],
    ['data-t-title', function (e, s) { e.setAttribute('title', s); }]];
  function localize(scope) {
    scope = scope || d;
    MAP.forEach(function (m) {
      Array.prototype.forEach.call(scope.querySelectorAll('[' + m[0] + ']'), function (e) { m[1](e, T(e.getAttribute(m[0]))); });
    });
  }
  if (d) {
    var run = function () { localize(d); if (root.ZimiText && root.ZimiText.onChange) root.ZimiText.onChange(function () { localize(d); }); };
    if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', run); else run();
  }

  // ── option rows ──
  function row(label, choices, value, onPick) {
    var cur = value, buttons = [];
    var seg = h('div', { class: 'gs-seg' + (choices.length > 3 ? ' is-wrap' : ''), role: 'group', 'aria-label': label });
    function paint() { buttons.forEach(function (b, i) { b.setAttribute('aria-pressed', String(String(choices[i][0]) === String(cur))); }); }
    choices.forEach(function (c) {
      var b = h('button', { class: 'ar-btn', type: 'button', text: c[1] });
      b.addEventListener('click', function () { cur = c[0]; paint(); if (onPick) onPick(cur); });
      buttons.push(b); seg.appendChild(b);
    });
    paint();
    var el = h('div', { class: 'gs-row' }, [h('label', { text: label }), seg]);
    return { el: el, value: function () { return cur; }, set: function (v) { cur = v; paint(); },
      // A choice that does not apply (the level against a person) keeps its place and cannot be pressed.
      disable: function (on) { buttons.forEach(function (b) { b.disabled = !!on; b.setAttribute('aria-disabled', String(!!on)); }); el.classList.toggle('is-off', !!on); } };
  }
  function toggle(label, value, onPick) {
    var r = row(label, [[1, T('shell.on')], [0, T('shell.off')]], value ? 1 : 0, function (v) { if (onPick) onPick(!!+v); });
    return { el: r.el, value: function () { return !!+r.value(); }, set: function (v) { r.set(v ? 1 : 0); }, disable: r.disable };
  }
  function options(rows) { return { options: rows.map(function (r) { return r.el || r; }) }; }

  // ── the status line, the thinking state, the refusal ──
  // The opponent's turn pulses a dot ahead of the line; the dot's room is always there, so the layout does not jump.
  function status(el) {
    el.classList.add('bu-status');
    var api = shell() && shell().status ? shell().status(el) : null, text = '', timer = 0;
    var say = function (t) { text = t; if (api) api.say(t); else el.textContent = t; };
    return {
      say: function (t) { el.classList.remove('is-thinking'); say(t); },
      reason: function (t, ms) { if (api) api.reason(t, ms); else el.textContent = t; },
      thinking: function (on) { el.classList.toggle('is-thinking', !!on); },
      turn: function (t, thinking) { el.classList.toggle('is-thinking', !!thinking); say(t); }
    };
  }
  function refuse(st, el, text) {
    if (shell() && shell().shake) shell().shake(el);
    if (st && text) st.reason(text);
  }

  // ── the end ──
  function end(opts) {
    if (!shell() || !shell().endSheet) return;
    shell().endSheet(opts);
  }

  // ── records ──
  function record(el, level, rec) {
    if (!el) return;
    rec = rec || { w: 0, l: 0, d: 0 };
    if (!(rec.w + rec.l + rec.d)) { el.textContent = ''; return; }
    el.textContent = rec.d ? T('board.record.draws', { level: level, won: rec.w, lost: rec.l, drawn: rec.d }) : T('board.record', { level: level, won: rec.w, lost: rec.l });
  }

  var SIDES = { white: 'board.white', black: 'board.black', red: 'board.red', blue: 'board.blue', green: 'board.green', yellow: 'board.yellow', you: 'board.you', computer: 'board.computer' };
  function side(color) { return T(SIDES[color] || color); }

  root.BoardUI = { t: T, localize: localize, row: row, toggle: toggle, options: options, status: status, refuse: refuse, end: end, record: record, side: side, h: h };
})(typeof globalThis !== 'undefined' ? globalThis : this);
