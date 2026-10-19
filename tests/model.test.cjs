const assert = require('node:assert/strict');
const model = require('../kindle/extensions/kindle-desk/app/model.js');
const now = 1792382400;
function snapshot(plan = 'plus', key = 'A') {
    return {schemaVersion: 1, computer: {sampledAt: now, cpuPercent: 24, memoryPercent: 50, gpuPercent: null}, codex: {state: 'ready', account: {key, label: key, plan}, quotaAccountKey: key, fetchedAt: now, buckets: [{id: 'codex', primary: {usedPercent: 28, windowDurationMins: 300, resetsAt: now + 1000}, secondary: {usedPercent: 59, windowDurationMins: 10080, resetsAt: now + 10000}}]}};
}
for (const plan of ['plus', 'pro']) {const result = model.derive(snapshot(plan), now); assert.equal(result.account.plan, plan === 'plus' ? 'Plus' : 'Pro'); assert.deepEqual(result.rows.map(r => r.remaining), [72, 41]);}
let s = snapshot('pro', 'B'); s.codex.quotaAccountKey = 'A'; assert.equal(model.derive(s, now).rows.length, 0);
s = snapshot(); s.codex.state = 'switching'; assert.equal(model.derive(s, now).rows.length, 0);
s = snapshot(); s.codex.state = 'signed_out'; assert.equal(model.derive(s, now).account, null);
s = snapshot(); s.codex.fetchedAt = now - 601; assert.equal(model.derive(s, now).rows.length, 0);
s = snapshot(); s.computer.sampledAt = now - 46; assert.equal(model.derive(s, now).computer, null);
s = snapshot(); s.codex.buckets[0].primary.resetsAt = now; assert.equal(model.derive(s, now).rows[0].remaining, null);
s = snapshot(); s.codex.buckets[0].secondary = null; assert.equal(model.derive(s, now).rows.length, 1);
s = snapshot(); s.codex.buckets[0].primary.usedPercent = null; assert.equal(model.derive(s, now).rows[0].remaining, null);
s = snapshot(); s.codex.buckets[0].primary.usedPercent = 101; assert.equal(model.derive(s, now).rows[0].remaining, null);
s = snapshot(); s.codex.buckets[0].primary.usedPercent = 0; assert.equal(model.derive(s, now).rows[0].remaining, 100);
s = snapshot(); s.codex.buckets[0].primary.usedPercent = 100; assert.equal(model.derive(s, now).rows[0].remaining, 0);
s = snapshot(); s.codex.buckets.push({id: 'other', primary: {usedPercent: 12, windowDurationMins: 60, resetsAt: now + 1000}}); assert.equal(model.derive(s, now).rows.length, 3);
assert.equal(model.derive(null, now).rows.length, 0);
assert.equal(model.derive({schemaVersion: 99}, now).rows.length, 0);
console.log('Model: Plus/Pro, identity isolation, missing and stale data, resets and multiple buckets passed.');
