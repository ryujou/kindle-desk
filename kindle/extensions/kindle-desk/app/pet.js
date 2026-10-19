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
        this.node = node; this.state = 'idle'; this.frame = 0; this.draws = 0;
        this.mode = 'native'; this.timer = null; this.enabled = false;
        this.atlasRows = 11; this.name = 'Pet'; this.petId = null; this.loadingId = null;
    }
    Pet.prototype.draw = function () {
        var row = rows[this.state] === undefined ? 0 : rows[this.state];
        this.node.style.backgroundPosition = (this.frame * 100 / 7) + '% ' + (row * 100 / (this.atlasRows - 1)) + '%';
        this.node.setAttribute('data-frame', String(this.frame));
        this.node.setAttribute('data-state', this.state);
        this.node.setAttribute('aria-label', this.name + ' · ' + this.state);
        this.draws++;
        if (this.onDraw) this.onDraw();
    };
    Pet.prototype.schedule = function () {
        var self = this, row = rows[this.state] === undefined ? 0 : rows[this.state];
        clearTimeout(this.timer);
        if (!this.enabled || document.hidden || this.node.style.visibility === 'hidden' || this.mode === 'still' || this.state === 'offline') return;
        this.timer = setTimeout(function () {
            self.frame = (self.frame + 1) % timings[row].length;
            self.draw(); self.schedule();
        }, this.mode === 'eink' ? Math.max(2000, timings[row][this.frame] * 6) : timings[row][this.frame]);
    };
    Pet.prototype.setState = function (state) {
        if (state === this.state) return;
        this.state = state; this.frame = 0; this.draw(); this.schedule();
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
            self.node.style.backgroundImage = 'url("' + value.url + '")';
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
    Pet.prototype.pause = function () { this.enabled = false; clearTimeout(this.timer); this.timer = null; };
    root.DeskPet = Pet;
}(this));
