// The Field Guide card's pure parts: the emergency number for a time zone's
// country, the place a sky is read for, and which sky leads (fieldguide-card.js).
//
// Run: node tests/test_fieldguide_client.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'zimi', 'static');
const ctx = { document: { getElementById: () => null } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'fieldguide-card.js'), 'utf8') + '\nthis.CARD = FieldGuideCard;', ctx);
const CARD = ctx.CARD;
// The sky's own time zone table, as the page reads it.
vm.runInContext(fs.readFileSync(path.join(root, 'zone-places.js'), 'utf8') + '\nthis.ZONES = { place: _skyZonePlace, country: _skyZoneCountry };', ctx);
const zones = ctx.ZONES;
const numbers = JSON.parse(fs.readFileSync(path.join(root, 'fieldguide-numbers.json'), 'utf8'));

let failures = 0;
function ok(label, cond, detail) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  ' + detail : ''));
  if (!cond) failures++;
}
const text = (tz) => CARD.emergencyHtml(CARD.emergencyFor(zones, numbers, tz), numbers, {}).replace(/<[^>]+>/g, '');

ok('Sydney: Emergency number here: 000', /Emergency number here: 000/.test(text('Australia/Sydney')), text('Australia/Sydney'));
ok('Denver: 911', /Emergency number here: 911/.test(text('America/Denver')));
ok('London: 999 or 112', /Emergency number here: 999 or 112/.test(text('Europe/London')));
ok('Berlin gives police and the rest', /Emergency numbers here: Police 110 · Ambulance 112 · Fire 112/.test(text('Europe/Berlin')), text('Europe/Berlin'));
ok('Windhoek is Namibia, not the north', /Police 10 111/.test(text('Africa/Windhoek')));
ok('Johannesburg adds the mobile 112', /Mobile phones 112/.test(text('Africa/Johannesburg')));
ok('an old zone name (Calcutta) finds India', /Emergency number here: 112/.test(text('Asia/Calcutta')));
ok('unknown zone says 112 / 911 and that it is unknown', /Emergency number: 112 \/ 911/.test(text('Etc/UTC')) && !/here/.test(text('Etc/UTC')), text('Etc/UTC'));
ok('no zone at all is the same', /Emergency number: 112 \/ 911/.test(text('')));
ok('the source is named with its licence', /Emergency numbers from List of emergency telephone numbers, CC BY-SA 4.0/.test(text('Australia/Sydney')));
ok('the table failing to load still says 112 / 911', /112 \/ 911/.test(CARD.emergencyHtml(CARD.emergencyFor(null, null, 'Australia/Sydney'), null, {}).replace(/<[^>]+>/g, '')));

// The place
const c = CARD.placeLat('-33.9', zones, 'America/Denver', '151.2', 'Sydney');
ok('a chosen place wins and is not a guess', c.lat === -33.9 && c.lon === 151.2 && c.guessed === false && c.name === 'Sydney');
const g = CARD.placeLat('', zones, 'Australia/Sydney');
ok('no chosen place: the zone, said to be a guess, with its city', g && g.guessed && g.lat < -30 && g.lon > 150 && g.city === 'Sydney');
ok('Manaus and Windhoek are south', CARD.placeLat('', zones, 'America/Manaus').lat < 0 && CARD.placeLat('', zones, 'Africa/Windhoek').lat < 0);
ok('an unknown zone gives no place', CARD.placeLat('', zones, 'Etc/UTC') === null);

// Which sky leads
const lost = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'shadow', sky: 'any' }, { id: 'north', sky: 'north' }, { id: 'south', sky: 'south' }];
const ids = (qs) => qs.map((q) => q.id).join(',');
ok('south: the Cross before the shadow and the Pole Star', ids(CARD.skyFirst(lost, -33.9)) === 'a,b,c,south,shadow,north', ids(CARD.skyFirst(lost, -33.9)));
ok('north: Polaris first', ids(CARD.skyFirst(lost, 40)) === 'a,b,c,north,shadow,south');
ok('no place: the data order', CARD.skyFirst(lost, null) === lost);

if (failures) { console.log(failures + ' failed'); process.exit(1); }

// The guidance date reads in the reader's language, month and year.
(function () {
  var assert = require('assert');
  var fs = require('fs'), vm = require('vm');
  var ctx = { window: {}, document: { getElementById: function () { return null; } }, Intl: Intl };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'zimi', 'static', 'fieldguide-card.js'), 'utf8') + '\nthis.C = FieldGuideCard;', ctx);
  assert.strictEqual(ctx.C.asOfText('2026-08', { lang: 'en' }), 'August 2026');
  assert.strictEqual(ctx.C.asOfText('1992', { lang: 'en' }), '1992');
  assert.ok(/2026/.test(ctx.C.asOfText('2026-08', { lang: 'de' })));
  var html = ctx.C.quoteHtml({ id: 'x', heading: 'Infants', locator: 'L', lines: ['a'], url: 'https://e.org', source: { title: 'T', as_of: '2026-08', edition: 'e', publisher: 'p', licence: 'CC BY-SA 4.0' } }, { lang: 'en' });
  assert.ok(html.indexOf('Guidance as of August 2026') >= 0, html);
  console.log('guidance date: ok');
})();
