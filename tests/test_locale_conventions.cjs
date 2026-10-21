// Numbers, dates, sorting and the first day of the week follow Zimi's
// language, not the phone's (Eric, 2026-10-20: "all around the app there's
// lots we can learn from conventions like that").
//
// Run: node tests/test_locale_conventions.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'zimi', 'static', 'app.js'), 'utf8');
const start = src.indexOf('function _uiLocale()');
const end = src.indexOf('// Localized pluralization: picks');
if (start < 0 || end < start) throw new Error('the locale helpers moved: update this test');

let _currentLang = 'en';
let navigator = { language: 'en-US' };
const _uiLangPrimary = () => String(_currentLang || 'en').split('-')[0];
const _langPrimary = (tag) => String(tag || '').split('-')[0];
eval(src.slice(start, end));

let failures = 0;
function ok(label, cond, got) { console.log((cond ? '  ok: ' : '  FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(got))); if (!cond) failures++; }
const plain = (s) => s.replace(/[  ]/g, ' ');

_currentLang = 'de';
ok('a German Zimi groups thousands with a point', fmtNum(1234567) === '1.234.567', fmtNum(1234567));
ok('and writes the date day first', fmtDate(new Date(2026, 9, 20)) === '20.10.2026', fmtDate(new Date(2026, 9, 20)));
_currentLang = 'fr';
ok('a French Zimi groups with a narrow space', plain(fmtNum(1234)) === '1 234', fmtNum(1234));
_currentLang = 'en';
ok('English keeps the comma', fmtNum(1234) === '1,234');
navigator = { language: 'en-GB' };
ok('a British phone writes the day first', fmtDate(new Date(2026, 9, 20)) === '20/10/2026', fmtDate(new Date(2026, 9, 20)));
navigator = { language: 'en-US' };
ok('an American one the month first', fmtDate(new Date(2026, 9, 20)) === '10/20/2026');
navigator = { language: 'de-AT' };
_currentLang = 'fr';
ok('a phone in another language leaves the date to Zimi\'s', fmtDate(new Date(2026, 9, 20)) === '20/10/2026');
_currentLang = 'en';
navigator = { language: 'en-US' };
ok('an unreadable date is empty, not "Invalid Date"', fmtDate('nope') === '');
ok('a percentage in English', fmtPct(73.6, 1) === '73.6%');
_currentLang = 'de';
ok('and in German, comma and space', plain(fmtPct(73.6, 1)) === '73,6 %', fmtPct(73.6, 1));
_currentLang = 'en';

const parts = ['Part 10', 'part 2', 'Part 1', 'Éclair', 'apple', 'Zebra'];
ok('numbers sort by value and case does not split the list', JSON.stringify(parts.slice().sort(cmpText)) ===
  JSON.stringify(['apple', 'Éclair', 'Part 1', 'part 2', 'Part 10', 'Zebra']), parts.slice().sort(cmpText));
ok('absent titles sort as empty, not "undefined"', cmpText(undefined, 'a') < 0);
ok('titles fall back to names', cmpTitle({ name: 'b' }, { title: 'a' }) > 0);

// The week's first day: 0 = Sunday.
const week = (lang, phone) => { _currentLang = lang; navigator = { language: phone }; return _weekFirstDay(); };
ok('en-US starts on Sunday', week('en', 'en-US') === 0);
ok('en-GB starts on Monday', week('en', 'en-GB') === 1);
ok('a German Zimi starts on Monday', week('de', 'en-US') === 1);
ok('an Arabic Zimi starts on Saturday', week('ar', 'en-US') === 6);
ok('a phone in another language does not decide it', week('fr', 'en-US') === 1);

// Where the browser has no week info (Firefox), the table answers the same.
const RealLocale = Intl.Locale;
Intl.Locale = function (tag) { return { tag }; };
try {
  ok('without week info: en-US Sunday', week('en', 'en-US') === 0);
  ok('without week info: en-GB Monday', week('en', 'en-GB') === 1);
  ok('without week info: pt (Brazil) Sunday', week('pt', 'de-DE') === 0);
  ok('without week info: ar Saturday', week('ar', 'ar') === 6);
  ok('without week info: zh-Hans-CN Monday', week('zh', 'zh-Hans-CN') === 1);
  ok('without week info: he Sunday', week('he', 'he') === 0);
} finally { Intl.Locale = RealLocale; }

if (failures) { console.log(failures + ' FAIL'); process.exit(1); }
console.log('PASS');
