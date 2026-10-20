(function (root) {
    'use strict';
    function Panel(options) {
        var self = this;
        this.pet = options.pet; this.onChange = options.onChange; this.key = 'kindle-desk-care-preview-v1';
        this.allowed = false; this.paused = false; this.reply = null; this.error = '';
        this.state = null; this.lastEvaluation = 0;
        try {
            var raw = root.localStorage.getItem(this.key);
            this.state = raw === null ? DeskCare.create(this.now()) : JSON.parse(raw);
            if (!DeskCare.valid(this.state)) throw new Error('Invalid care state');
            this.state = DeskCare.evaluate(this.state, this.now());
            if (raw === null) root.localStorage.setItem(this.key, JSON.stringify(this.state));
        } catch (error) { this.state = null; this.error = '陪伴存档无法读取，原记录已保留。'; }
        this.menu = document.createElement('div'); this.menu.className = 'care-menu'; this.menu.hidden = true;
        this.menu.setAttribute('role', 'group'); this.menu.setAttribute('aria-label', '照料风香');
        function button(label, action) {
            var node = document.createElement('button'); node.type = 'button'; node.textContent = label;
            node.setAttribute('data-care', action); node.onclick = function () { self.act(action); };
            self.menu.appendChild(node); return node;
        }
        button('摸摸头', 'pat'); button('送点心', 'snack'); this.restButton = button('一起休息', 'rest');
        this.notice = document.createElement('p'); this.notice.setAttribute('role', 'status'); this.menu.appendChild(this.notice);
        var close = document.createElement('button'); close.type = 'button'; close.className = 'care-close';
        close.textContent = '收起'; close.onclick = function () { self.close(true); }; this.menu.appendChild(close);
        options.surface.appendChild(this.menu);
        this.pet.node.setAttribute('aria-haspopup', 'true'); this.pet.node.setAttribute('aria-expanded', 'false');
        this.pet.node.setAttribute('aria-label', '风香，短按切换动作，长按打开照料');
        this.pet.node.setAttribute('role', 'button'); this.pet.node.tabIndex = 0;
        this.pet.node.oncontextmenu = function (e) { e.preventDefault(); };
        this.pet.node.onclick = function (e) {
            e.preventDefault();
            if (self.suppressClick) { self.suppressClick = false; return; }
            if (!self.menu.hidden) self.close(false);
            else self.pet.cycleAnimation();
        };
        function start(x, y) {
            self.cancelPress(); self.suppressClick = false;
            if (self.paused || !self.allowed) return;
            self.press = {x: x, y: y};
            self.hold = setTimeout(function () {
                if (!self.press || !self.allowed) return;
                self.suppressClick = true; self.open();
            }, 600);
        }
        function move(x, y) {
            if (self.press && (Math.abs(x - self.press.x) > 12 || Math.abs(y - self.press.y) > 12)) {
                self.suppressClick = true; self.cancelPress();
            }
        }
        if (root.PointerEvent) {
            this.pet.node.addEventListener('pointerdown', function (e) { if (e.isPrimary && e.button === 0) start(e.clientX, e.clientY); });
            document.addEventListener('pointermove', function (e) { move(e.clientX, e.clientY); });
            document.addEventListener('pointerup', function () { self.cancelPress(); });
            this.pet.node.addEventListener('pointerleave', function () { if (self.press) { self.suppressClick = true; self.cancelPress(); } });
            document.addEventListener('pointercancel', function () { self.suppressClick = true; self.cancelPress(); });
        } else {
            this.pet.node.addEventListener('touchstart', function (e) { if (e.touches.length === 1) start(e.touches[0].clientX, e.touches[0].clientY); });
            document.addEventListener('touchmove', function (e) { if (e.touches.length) move(e.touches[0].clientX, e.touches[0].clientY); });
            document.addEventListener('touchend', function () { self.cancelPress(); });
            document.addEventListener('touchcancel', function () { self.suppressClick = true; self.cancelPress(); });
        }
        this.pet.node.onkeydown = function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) self.open(); }
        };
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') self.close(true); });
        document.addEventListener('click', function (e) {
            if (!self.menu.hidden && e.target !== self.pet.node && !self.menu.contains(e.target)) self.close(false);
        });
        root.addEventListener('blur', function () { self.suppressClick = true; self.cancelPress(); self.close(false); });
    }
    Panel.prototype.now = function () { return Date.now() / 1000; };
    Panel.prototype.cancelPress = function () { clearTimeout(this.hold); this.hold = null; this.press = null; };
    Panel.prototype.save = function (next) {
        try { root.localStorage.setItem(this.key, JSON.stringify(next)); }
        catch (error) { this.error = '保存失败，请检查浏览器存储后重试。'; return false; }
        this.state = next; this.error = ''; return true;
    };
    Panel.prototype.observePet = function (value) {
        var local = DeskCare.localPet(value);
        if (!this.state || !local || JSON.stringify(local) === JSON.stringify(this.state.lastPet)) return;
        var next = DeskCare.evaluate(this.state, this.now()); next.lastPet = local;
        if (!this.save(next)) this.onChange();
    };
    Panel.prototype.restorePet = function () { if (this.state && this.state.lastPet) this.pet.setPet(this.state.lastPet); };
    Panel.prototype.context = function (allowed) {
        var wasAllowed = this.allowed;
        this.allowed = allowed && !this.paused;
        if (this.state && this.now() - this.lastEvaluation >= 60) {
            this.state = DeskCare.evaluate(this.state, this.now()); this.lastEvaluation = this.now();
        }
        if (!this.allowed) { if (this.press) this.suppressClick = true; this.cancelPress(); this.close(false); this.reply = null; clearTimeout(this.replyTimer); if (wasAllowed) this.pet.cancelReaction(); }
        this.pet.setResting(this.allowed && this.state && this.state.resting);
    };
    Panel.prototype.open = function () {
        if (!this.allowed || !this.pet.petId || this.pet.node.style.visibility === 'hidden') return;
        this.notice.textContent = this.error;
        this.restButton.textContent = this.state && this.state.resting ? '起身活动' : '一起休息';
        var buttons = this.menu.querySelectorAll('[data-care]');
        for (var i = 0; i < buttons.length; i++) buttons[i].disabled = !this.state;
        this.menu.hidden = false; this.pet.node.setAttribute('aria-expanded', 'true');
    };
    Panel.prototype.close = function (focus) {
        var wasOpen = !this.menu.hidden; this.menu.hidden = true; this.pet.node.setAttribute('aria-expanded', 'false');
        if (focus && wasOpen) this.pet.node.focus();
    };
    Panel.prototype.act = function (action) {
        if (!this.allowed || !this.state) return;
        var result = DeskCare.act(this.state, action, this.now()), self = this;
        if (!this.save(result.state)) { this.notice.textContent = this.error; this.onChange(); return; }
        this.close(true); this.reply = FuukaCompanion.careEntry(result.kind); clearTimeout(this.replyTimer);
        this.pet.setResting(this.state.resting);
        if (result.row !== null) this.pet.playOnce(result.row);
        this.replyTimer = setTimeout(function () { self.reply = null; self.onChange(); }, 8000);
        this.onChange();
    };
    Panel.prototype.entry = function () {
        if (!this.allowed) return null;
        if (this.error) return FuukaCompanion.careEntry(this.state ? 'careSaveError' : 'careReadError');
        if (this.reply) return this.reply;
        return this.state && this.state.resting ? FuukaCompanion.careEntry('careRest') : null;
    };
    Panel.prototype.mood = function () { return this.state ? DeskCare.mood(this.state, new Date(this.now() * 1000).getHours()) : 'calm'; };
    Panel.prototype.advance = function (seconds) {
        if (!this.state) return;
        var next = DeskCare.evaluate(this.state, this.now() + seconds);
        if (seconds > 0) {
            ['firstMetAt', 'lastEvaluatedAt', 'lastPatAt', 'lastSnackAt'].forEach(function (key) {
                if (next[key] !== null) next[key] = Math.max(0, next[key] - seconds);
            });
        }
        this.save(next);
        this.reply = null; clearTimeout(this.replyTimer); this.onChange();
    };
    Panel.prototype.pause = function () {
        this.paused = true; this.allowed = false; this.suppressClick = true; this.cancelPress(); this.close(false);
        this.reply = null; clearTimeout(this.replyTimer);
    };
    Panel.prototype.resume = function () { this.paused = false; };
    root.DeskCarePanel = Panel;
}(this));
