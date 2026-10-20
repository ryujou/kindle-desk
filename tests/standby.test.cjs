const assert = require('node:assert/strict');
const { FuukaCompanion } = require('../kindle/extensions/kindle-desk/app/standby.js');
const base = {now: 1792494000, hour: 15, day: '2026-10-20', sittingSeconds: 0, away: false, weather: null};
const at = (seconds, changes = {}) => ({...base, now: base.now + seconds, ...changes});

for (const [hour, kind] of [[8, 'morning'], [12, 'lunch'], [19, 'evening'], [23, 'night']]) {
    const engine = FuukaCompanion.create(() => 0.5);
    assert.equal(engine.read(at(0, {hour})).kind, kind);
    assert.equal(engine.read(at(1200, {hour})).kind, 'daily');
}
const rotation = FuukaCompanion.create(() => 0.5);
const first = rotation.read(base);
assert.deepEqual(rotation.read(at(1199)), first);
const second = rotation.read(at(1200));
assert.notEqual(second.text, first.text);
assert.notEqual(rotation.read(at(1201), true).text, second.text);

const quotes = FuukaCompanion.create(() => 0);
assert.equal(quotes.read(base).kind, 'quote');
assert.ok(quotes.read(base).author);
assert.equal(quotes.read(at(1200)).kind, 'daily');
assert.equal(quotes.read(at(2400)).kind, 'quote');

const sitting = FuukaCompanion.create(() => 0.5);
assert.equal(sitting.read(at(0, {sittingSeconds: 2700})).kind, 'sitting');
assert.equal(sitting.read(at(1200, {sittingSeconds: 3900})).kind, 'daily');
assert.equal(sitting.read(at(3600, {sittingSeconds: 6300})).kind, 'sitting');
assert.equal(sitting.read(at(3601, {away: true, sittingSeconds: 0})).kind, 'daily');

const forecast = {forecastRain: true, sampledAt: base.now};
const rain = FuukaCompanion.create(() => 0.5);
assert.equal(rain.read(at(0, {weather: forecast})).kind, 'rain');
assert.equal(rain.read(at(1200, {weather: forecast, sittingSeconds: 3000})).kind, 'daily');
const stale = FuukaCompanion.create(() => 0.5);
assert.equal(stale.read(at(3601, {weather: forecast})).kind, 'daily');
assert.equal(stale.read(at(3602, {weather: null})).kind, 'daily');
const removed = FuukaCompanion.create(() => 0.5);
assert.equal(removed.read(at(0, {weather: forecast})).kind, 'rain');
assert.equal(removed.read(at(1, {weather: null})).kind, 'daily');
const unavailable = FuukaCompanion.create(() => 0.5);
assert.equal(unavailable.read(at(0, {weather: {code: 61, sampledAt: base.now}})).kind, 'daily');

console.log('PASS: greetings, 20-minute rotation, attributed quotes, reminder cooldowns, away reset, fresh forecast only');
console.log('Original dialogue:', Object.values(FuukaCompanion.lines).flat().length, 'Selected quotes:', FuukaCompanion.quotes.length);
assert.deepEqual(FuukaCompanion.layout('早呀，老师。今天也别太勉强自己。', text => text.length * 24, 300),
    ['早呀，老师。', '今天也别太勉强自己。']);
assert.deepEqual(FuukaCompanion.layout('老师，今天也辛苦啦。', text => text.length * 24, 500),
    ['老师，今天也辛苦啦。']);

let measured = 0;
global.getComputedStyle = () => ({fontWeight: 'normal', fontSize: '22px', fontFamily: 'sans-serif'});
global.document = {createElement: () => ({getContext: () => ({measureText: text => {measured++; return {width: text.length * 24};}})})};
const attrs = {}, node = {clientWidth: 500, textContent: '', getAttribute: key => attrs[key], setAttribute: (key, value) => {attrs[key] = value;}};
const entry = {text: '早呀，老师。今天也别太勉强自己。', kind: 'morning'};
FuukaCompanion.paint(node, entry);
const initialMeasures = measured;
FuukaCompanion.paint(node, entry);
assert.equal(measured, initialMeasures, 'unchanged speech avoids layout measurements');
node.clientWidth = 300;
FuukaCompanion.paint(node, entry);
assert.ok(measured > initialMeasures, 'width changes still recompute line wrapping');
assert.equal(node.textContent, '早呀，老师。\n今天也别太勉强自己。');
node.textContent = '任务进度';
FuukaCompanion.paint(node, entry);
assert.equal(node.textContent, '早呀，老师。\n今天也别太勉强自己。', 'returning from a task restores speech');
delete global.document; delete global.getComputedStyle;
