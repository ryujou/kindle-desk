/* Codex Pet v2 atlas contract and timing reference:
 * github.com/tristanmuzzu/Pipsqueak-Agent-Pets/blob/main/src/pet.js */
(function (root) {
    'use strict';
    var rows = { idle: 0, unknown: 0, offline: 5, failed: 5, waiting: 6, running: 7, review: 8 };
    var timings = [
        [280,110,110,140,140,320], [120,120,120,120,120,120,120,220],
        [120,120,120,120,120,120,120,220], [140,140,140,280], [140,140,140,140,280],
        [140,140,140,140,140,140,140,240], [150,150,150,150,150,260],
        [120,120,120,120,120,220], [150,150,150,150,150,280]
    ];
    function Pet(node) {
        if (root.kindle) { node.style.webkitFilter = 'none'; node.style.filter = 'none'; }
        this.node = node; this.state = 'idle'; this.frame = 0; this.draws = 0;
        this.reactionRow = null; this.reactionLoops = 0; this.nextReaction = 0;
        this.mode = 'native'; this.timer = null; this.enabled = false;
        this.atlasRows = 11; this.name = 'Fuuka'; this.petId = null; this.loadingId = null;
        this.ambient = false; this.nextAmbientWave = Date.now() + 120000;
    }
    Pet.prototype.currentRow = function () {
        return this.reactionRow !== null ? this.reactionRow : (rows[this.state] === undefined ? 0 : rows[this.state]);
    };
    Pet.prototype.draw = function () {
        var row = this.currentRow();
        if (root.kindle && this.nativeAsset) {
            if (this.onDraw) this.onDraw(row);
            return;
        }
        this.node.style.backgroundPosition = (this.frame * 100 / 7) + '% ' + (row * 100 / (this.atlasRows - 1)) + '%';
        this.node.setAttribute('data-frame', String(this.frame));
        this.node.setAttribute('data-state', this.state);
        this.node.setAttribute('aria-label', this.name + ' · ' + this.state);
        this.draws++;
        if (this.onDraw) this.onDraw();
    };
    Pet.prototype.schedule = function () {
        var self = this, row = this.currentRow();
        clearTimeout(this.timer);
        if (!this.enabled || document.hidden || this.node.style.visibility === 'hidden' || this.mode === 'still' || (this.state === 'offline' && this.reactionRow === null)) return;
        this.timer = setTimeout(function () {
            if (self.ambient && self.reactionRow === null && Date.now() >= self.nextAmbientWave) {
                self.reactionRow = 3; self.reactionLoops = 1; self.frame = 0;
                self.nextAmbientWave = Date.now() + 120000;
                self.draw(); self.schedule(); return;
            }
            self.frame = (self.frame + 1) % timings[row].length;
            if (self.frame === 0 && self.reactionRow !== null && --self.reactionLoops === 0) self.reactionRow = null;
            self.draw(); self.schedule();
        }, this.ambient ? (this.reactionRow === null ? 2000 : 500) : this.mode === 'eink' ? Math.max(500, timings[row][this.frame] * 3) : timings[row][this.frame]);
    };
    Pet.prototype.setAmbient = function (value) {
        if (this.ambient === value) return;
        this.ambient = value; this.nextAmbientWave = Date.now() + 120000;
        this.schedule();
    };
    Pet.prototype.setState = function (state) {
        if (state === this.state) return;
        this.state = state;
        if (this.reactionRow !== null) return;
        this.frame = 0; this.draw(); this.schedule();
    };
    Pet.prototype.cycleAnimation = function () {
        if (!this.enabled || !this.petId || this.node.style.visibility === 'hidden') return;
        var actions = [3, 4, 1, 2];
        this.reactionRow = actions[this.nextReaction];
        this.nextReaction = (this.nextReaction + 1) % actions.length;
        this.reactionLoops = 3; this.frame = 0;
        this.draw(); this.schedule();
    };
    Pet.prototype.setMode = function (mode) { this.mode = mode; this.schedule(); };
    Pet.prototype.setPet = function (value) {
        var self = this;
        if (value.state !== 'ready') {
            this.loadingId = null; this.petId = null; this.node.style.visibility = 'hidden';
            clearTimeout(this.timer); this.timer = null;
            return;
        }
        if (value.id === this.petId || value.id === this.loadingId) return;
        this.loadingId = value.id;
        var image = new Image();
        image.onload = function () {
            if (self.loadingId !== value.id) return;
            self.petId = value.id; self.loadingId = null; self.name = value.name;
            self.atlasRows = value.rows;
            self.nativeAsset = root.kindle ? value.url.split('/').pop().replace(/\.png$/, '') : null;
            self.node.style.backgroundImage = root.kindle ? 'none' : 'url("' + value.url + '")';
            self.node.style.backgroundSize = '800% ' + (value.rows * 100) + '%';
            self.node.style.visibility = 'visible'; self.frame = 0; self.draw(); self.schedule();
        };
        image.onerror = function () {
            if (self.loadingId !== value.id) return;
            self.loadingId = null; self.petId = null; self.node.style.visibility = 'hidden';
        };
        image.src = value.url;
    };
    Pet.prototype.resume = function () { this.enabled = true; this.schedule(); };
    Pet.prototype.pause = function () { this.enabled = false; this.reactionRow = null; clearTimeout(this.timer); this.timer = null; };
    root.DeskPet = Pet;
}(this));
