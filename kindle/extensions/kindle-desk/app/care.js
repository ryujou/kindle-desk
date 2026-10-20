(function (root) {
    'use strict';
    function create(now) {
        return {version: 1, firstMetAt: now, affection: 0, energy: 80, resting: false,
            lastEvaluatedAt: now, lastPatAt: null, lastSnackAt: null, lastPet: null};
    }
    function valid(value) {
        function number(n) { return typeof n === 'number' && isFinite(n) && n >= 0; }
        function reward(n) { return n === null || number(n); }
        return value && value.version === 1 && number(value.firstMetAt) && number(value.lastEvaluatedAt) &&
            number(value.affection) && value.affection <= 100 && number(value.energy) && value.energy <= 100 &&
            typeof value.resting === 'boolean' && reward(value.lastPatAt) && reward(value.lastSnackAt) &&
            (value.lastPet === null || localPet(value.lastPet) !== null);
    }
    function localPet(value) {
        if (!value) return null;
        if (value.state === 'off') return {state: 'off'};
        if (value.state !== 'ready' || typeof value.id !== 'string' || typeof value.name !== 'string' ||
                !/^\/?pets\/[a-zA-Z0-9_.-]+\.(png|webp)$/.test(value.url) ||
                typeof value.rows !== 'number' || value.rows < 9 || value.rows > 32 || value.rows % 1) return null;
        return {state: 'ready', id: value.id, name: value.name, url: value.url, rows: value.rows};
    }
    function evaluate(state, now) {
        var next = JSON.parse(JSON.stringify(state));
        // Keep the last evaluated time when the clock moves back, so an interval is never counted twice.
        var elapsed = Math.max(0, now - state.lastEvaluatedAt);
        next.energy = Math.max(0, Math.min(100, state.energy + elapsed / 3600 * (state.resting ? 20 : -2)));
        next.lastEvaluatedAt = Math.max(now, state.lastEvaluatedAt);
        return next;
    }
    function act(state, action, now) {
        var next = evaluate(state, now), rewarded = false, kind, row = null;
        if (action === 'pat') {
            rewarded = next.lastPatAt === null || now - next.lastPatAt >= 60;
            if (rewarded) { next.affection = Math.min(100, next.affection + 2); next.lastPatAt = now; row = 3; }
            kind = rewarded ? 'carePat' : 'carePatWait';
        } else if (action === 'snack') {
            rewarded = next.lastSnackAt === null || now - next.lastSnackAt >= 600;
            if (rewarded) { next.affection = Math.min(100, next.affection + 3); next.energy = Math.min(100, next.energy + 15); next.lastSnackAt = now; row = 4; }
            kind = rewarded ? 'careSnack' : 'careSnackWait';
        } else if (action === 'rest') {
            next.resting = !next.resting;
            kind = next.resting ? 'careRest' : 'careWake';
        } else throw new Error('Unknown care action');
        return {state: next, kind: kind, row: row, rewarded: rewarded};
    }
    function mood(state, hour) {
        return state.resting ? 'resting' : state.energy <= 25 ? 'tired' :
            hour >= 23 || hour < 6 ? 'quiet' : state.affection >= 30 ? 'close' : 'calm';
    }
    root.DeskCare = {create: create, valid: valid, evaluate: evaluate, act: act, mood: mood, localPet: localPet};
}(typeof module !== 'undefined' ? module.exports : this));
