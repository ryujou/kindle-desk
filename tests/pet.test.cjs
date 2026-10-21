const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let pending = null;
let delay = null;
const context = {
    document: {hidden: false},
    setTimeout: (callback, ms) => { pending = callback; delay = ms; return 1; },
    clearTimeout: () => { pending = null; }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../kindle/extensions/kindle-desk/app/pet.js'), 'utf8'), context);
const pet = new context.DeskPet({style: {visibility: 'visible'}, setAttribute: () => {}});
pet.petId = 'test';
pet.resume();
pet.setState('running');
assert.equal(delay, 120);
pet.cycleAnimation();
assert.equal(pet.currentRow(), 3);
pet.setState('waiting');
assert.equal(pet.currentRow(), 3);
for (let frame = 0; frame < 12; frame++) {
    assert.ok(pending);
    pending();
}
assert.equal(pet.reactionRow, null);
assert.equal(pet.currentRow(), 6);
for (const state of ['waiting', 'failed', 'review']) {
    pet.setState(state); pet.cycleAnimation();
    assert.equal(pet.reactionRow, null);
}
pet.setState('running');
for (const row of [4, 1, 2, 3]) {
    pet.cycleAnimation();
    assert.equal(pet.currentRow(), row);
}
pet.pause();
assert.equal(pending, null);
assert.equal(pet.reactionRow, null);
pet.cycleAnimation();
assert.equal(pending, null);
console.log('Pet timing, tap cycle, live-state restoration and pause tests passed.');
