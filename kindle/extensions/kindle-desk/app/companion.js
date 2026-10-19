(function (root) {
    'use strict';
    var pet = new DeskPet(document.getElementById('pet')), active = false, timer, deadline, request, refreshTimer, refreshRequest;
    var labels = {idle: '休息中', running: '进行中', waiting: '需要你确认', review: '已完成', failed: '遇到问题', unknown: '等待状态', offline: '电脑未连接'};
    pet.setMode('native');
    pet.node.onclick = function () { pet.cycleAnimation(); };
    pet.onDraw = function (row) {
        if (!window.kindle || !pet.nativeAsset || !active || refreshRequest) return;
        var r = pet.node.getBoundingClientRect();
        var topInset = Math.max(0, Math.min(screen.width, screen.height) - window.innerHeight);
        var xhr = new XMLHttpRequest(); refreshRequest = xhr;
        xhr.open('POST', 'http://127.0.0.1:18766/cgi-bin/pet-draw.sh', true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4 || refreshRequest !== xhr) return;
            refreshRequest = null;
            clearTimeout(refreshTimer);
            if (xhr.status !== 200 || xhr.responseText.indexOf('"ok":true') < 0) {
                document.getElementById('pet-message').textContent = '宠物绘制失败';
            }
        };
        refreshTimer = setTimeout(function () { refreshRequest = null; xhr.abort(); }, 5000);
        xhr.send([pet.nativeAsset, row, pet.frame, Math.round(r.left), Math.round(r.top + topInset), Math.round(r.width), Math.round(r.height)].join(',') + '\n');
    };

    var otherSignature = '';
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function add(box, tag, cls, text) { var n = document.createElement(tag); n.className = cls; n.textContent = text; box.appendChild(n); return n; }
    function renderOther(value) {
        document.getElementById('other-account').hidden = !value || !value.account;
        if (!value || !value.account) {
            otherSignature = '';
            document.getElementById('other-plan').textContent = '';
            document.getElementById('other-rows').textContent = '';
            return;
        }
        var model = DeskModel.derive({schemaVersion: 1, codex: value || {state: 'error'}}, Math.floor(new Date().getTime() / 1000));
        var signature = JSON.stringify([model.account, model.rows, model.quotaState]);
        if (signature === otherSignature) return;
        otherSignature = signature;
        document.getElementById('other-plan').textContent = model.account ? model.account.plan : '';
        var parent = document.getElementById('other-rows'); parent.textContent = '';
        if (!model.rows.length) { parent.textContent = model.quotaState; return; }
        for (var i = 0; i < Math.min(2, model.rows.length); i++) {
            var row = model.rows[i], box = document.createElement('div'); box.className = 'quota-row';
            add(box, 'div', 'quota-label', row.label);
            add(box, 'div', 'quota-value', row.remaining === null ? '—' : row.remaining + '%');
            var track = add(box, 'div', 'quota-track', ''), fill = document.createElement('div');
            fill.style.width = (row.remaining === null ? 0 : row.remaining) + '%'; track.appendChild(fill);
            var reset = '重置时间未提供';
            if (row.waiting) reset = '等待新额度';
            else if (row.resetsAt !== null) {
                var d = new Date((row.resetsAt + 8 * 3600) * 1000);
                reset = (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' 重置';
            }
            add(box, 'div', 'quota-reset', reset); parent.appendChild(box);
        }
    }
    function show(state, message) {
        pet.setState(state);
        var label = document.getElementById('pet-state'), bubble = document.getElementById('pet-message');
        if (label.textContent !== labels[state]) label.textContent = labels[state] || labels.unknown;
        if (bubble.textContent !== message) { bubble.textContent = message; bubble.scrollTop = 0; }
    }
    function load() {
        if (!active) return;
        var xhr = new XMLHttpRequest(); request = xhr;
        function done(ok) {
            if (request !== xhr) return;
            request = null; clearTimeout(deadline);
            if (!ok) { show('offline', ''); renderOther(null); }
            if (active) timer = setTimeout(load, 3000);
        }
        xhr.open('GET', (window.kindle ? 'http://127.0.0.1:18766/' : '') + 'cgi-bin/companion.sh?t=' + new Date().getTime(), true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4 || request !== xhr) return;
            if (xhr.status !== 200) { done(false); return; }
            try {
                var data = JSON.parse(xhr.responseText);
                if (!data.pet || !data.activity) { done(false); return; }
                pet.setPet(data.pet);
                renderOther(data.otherAccount);
                var message = data.activity.message || '';
                message = message.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
                if (data.pet.state === 'missing_asset') message = '新宠物素材尚未同步';
                show(data.activity.state, message);
                done(true);
            } catch (error) { done(false); }
        };
        deadline = setTimeout(function () { done(false); xhr.abort(); }, 6500);
        xhr.send(null);
    }
    root.DeskCompanion = {
        pet: pet,
        resume: function () { if (active) return; active = true; pet.resume(); load(); },
        pause: function () {
            active = false; pet.pause(); clearTimeout(refreshTimer); if (refreshRequest) { refreshRequest.abort(); refreshRequest = null; } clearTimeout(timer); clearTimeout(deadline);
            var pending = request; request = null; if (pending) pending.abort();
        }
    };
}(this));
