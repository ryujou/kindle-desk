const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = path.join(__dirname, '../kindle/extensions/kindle-desk/app');
const { DeskCare: care } = require(path.join(app, 'care.js'));
const now = 1792494000;
const fresh = care.create(now);
const pat = care.act(fresh, 'pat', now);
assert.equal(pat.state.affection, 2);
assert.equal(fresh.affection, 0);
assert.equal(care.act(pat.state, 'pat', now + 59).rewarded, false);
assert.equal(care.act(pat.state, 'pat', now + 60).state.affection, 4);
const snack = care.act(pat.state, 'snack', now);
assert.equal(snack.state.energy, 95);
assert.equal(care.act(snack.state, 'snack', now + 599).rewarded, false);
assert.equal(care.act(snack.state, 'snack', now + 600).rewarded, true);
assert.equal(care.evaluate(snack.state, now + 604800).energy, 0);
assert.equal(care.evaluate(snack.state, now + 604800).affection, 5);
const resting = care.act(fresh, 'rest', now).state;
assert.equal(care.evaluate(resting, now + 3600).energy, 100);
assert.equal(care.evaluate(resting, now + 604800).energy, 100);
assert.equal(care.act(resting, 'rest', now + 1800).state.resting, false);
assert.equal(care.mood(resting, 15), 'resting');
assert.equal(care.mood({...fresh, energy: 10}, 15), 'tired');
assert.equal(care.mood({...fresh, affection: 50}, 15), 'close');
const backward = care.evaluate(resting, now - 3600);
assert.equal(backward.energy, 80);
assert.equal(backward.lastEvaluatedAt, now);
assert.equal(care.evaluate(backward, now + 1800).energy, 90);
assert.equal(care.act({...fresh, affection: 99, energy: 99}, 'snack', now).state.affection, 100);
assert.equal(care.act({...fresh, affection: 99, energy: 99}, 'snack', now).state.energy, 100);
assert.ok(care.valid(JSON.parse(JSON.stringify(snack.state))));
assert.equal(care.valid({...fresh, energy: '80'}), false);
assert.equal(care.valid({...fresh, version: 2}), false);
assert.equal(care.localPet({state: 'ready', id:'x', name:'Fuuka', url:'https://private/pet.png', rows:11}), null);
assert.ok(care.localPet({state: 'ready', id:'x', name:'Fuuka', url:'pets/fuuka.webp', rows:11}));
assert.deepEqual(care.localPet({state:'off'}), {state:'off'});

let pending, delay;
const attributes = {}, node = {style:{}, setAttribute:(key,value)=>attributes[key]=value};
const context = {document:{hidden:false}, Date, Image:function(){},
    setTimeout:(fn, ms)=>{pending=fn;delay=ms;return 1}, clearTimeout:()=>{pending=null}};
vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(app,'pet.js'),'utf8'),context);
const pet = new context.DeskPet(node);
pet.petId = 'test'; pet.enabled = true; pet.setAmbient(true);
assert.equal(pet.playOnce(3), true);
assert.equal(delay, 140); // A care reaction keeps atlas timing even while ambient animation is slow.
assert.equal(pet.playOnce(4), false);
pet.setState('running');
for(let i=0;i<4;i++) pending();
assert.equal(pet.reactionRow, null);
assert.equal(pet.currentRow(), 7);
pet.setState('idle');pet.setResting(true);assert.equal(pending,null);
assert.equal(pet.playOnce(4),true);
for(let i=0;i<5;i++) pending();
assert.equal(pending,null);assert.equal(pet.currentRow(),0);
pet.pause();assert.equal(pending,null);

const {FuukaCompanion: speech} = require(path.join(app,'standby.js'));
for(const kind of ['carePat','carePatWait','careSnack','careSnackWait','careRest','careWake']) {
    const entry = speech.careEntry(kind);
    const rows = speech.layout(entry.text,text=>text.length*22,360);
    assert.ok(rows.length<=2);
    for(const row of rows) assert.ok(row.length*22<=360 && row.replace(/[，。！？]/g,'').length>=3, kind);
}
console.log('PASS: rewards, cooldowns, offline week, rest, clock rollback, limits, local assets, native one-shot timing, task restore, rest stops scheduling, dialogue layout');
