(function (root) {
    'use strict';
    var pet = new DeskPet(document.getElementById('pet')), active = false, refreshTimer, refreshRequest;
    var labels = {idle: '休息中', running: '进行中', waiting: '需要你确认', review: '已完成', failed: '遇到问题', unknown: '等待状态', offline: '电脑未连接'};
    var speech = FuukaCompanion.create(), currentActivity, currentEnvironment;
    var messageNode = document.getElementById('pet-message');
    messageNode.onclick = function () { if (isStandby(currentActivity)) paintSpeech(true); };
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
    function text(id, value) { var node = document.getElementById(id); value = String(value); if (node.textContent !== value) node.textContent = value; }
    function hidden(id, value) { var node = document.getElementById(id); if (node.hidden !== value) node.hidden = value; }
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function add(box, tag, cls, text) { var n = document.createElement(tag); n.className = cls; n.textContent = text; box.appendChild(n); return n; }
    function renderOther(value) {
        hidden('other-account', !value || !value.account);
        if (!value || !value.account) {
            otherSignature = '';
            text('other-plan', '');
            text('other-rows', '');
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
    function isStandby(activity) {
        if (!activity) return false;
        if (activity.state === 'idle' || activity.state === 'unknown') return true;
        return activity.state === 'review' && activity.eventAt && Date.now() / 1000 - activity.eventAt >= 60;
    }
    function paintSpeech(force) {
        var now = Date.now() / 1000, date = new Date(), environment = currentEnvironment || {}, presence = environment.presence || {};
        var entry = speech.read({now: now, hour: date.getHours(),
            day: date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate(),
            sittingSeconds: presence.sittingSeconds || 0, away: presence.away === true, weather: environment.weather}, force);
        FuukaCompanion.paint(messageNode, entry);
    }
    function showEnvironment() {
        var environment = currentEnvironment || {}, indoor = environment.indoor, weather = environment.weather;
        hidden('ambient-indoor', !indoor);
        if (indoor) {
            text('room-temperature', Math.round(indoor.temperature));
            text('room-humidity', Math.round(indoor.humidity));
            text('room-pm25', Math.round(indoor.pm25));
        }
        var visible = weather && Date.now() / 1000 - weather.sampledAt < 3600;
        hidden('ambient-weather', !visible);
        if (visible) {
            var code = weather.code, label = code === 0 ? '晴' : code <= 3 ? '多云' : code <= 48 ? '有雾' :
                code <= 67 ? '有雨' : code <= 77 ? '有雪' : code <= 82 ? '阵雨' : code <= 86 ? '阵雪' : '雷雨';
            text('outdoor-weather', Math.round(weather.temperature) + '°C · ' + label);
        }
    }
    function show(state, message, data) {
        currentActivity = data ? data.activity : {state: state};
        currentEnvironment = data ? data.environment : null;
        var idle = isStandby(currentActivity);
        var companionNode = document.getElementById('companion'), className = idle ? 'standby' : '';
        if (companionNode.className !== className) companionNode.className = className;
        hidden('ambient-info', !idle);
        pet.setState(idle ? 'idle' : state); pet.setAmbient(idle);
        if (idle) { showEnvironment(); paintSpeech(false); return; }
        var label = document.getElementById('pet-state'), bubble = document.getElementById('pet-message');
        if (label.textContent !== labels[state]) label.textContent = labels[state] || labels.unknown;
        if (bubble.textContent !== message) { bubble.textContent = message; bubble.scrollTop = 0; }
    }
    function update(data) {
        if (!active) return;
        if (!data || !data.pet || !data.activity) { show('offline', ''); renderOther(null); return; }
        pet.setPet(data.pet);
        renderOther(data.otherAccount);
        var message = data.activity.message || '';
        message = message.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        if (data.pet.state === 'missing_asset') message = '新宠物素材尚未同步';
        show(data.activity.state, message, data);
    }
    root.DeskCompanion = {
        pet: pet,
        update: update,
        resume: function () { if (active) return; active = true; pet.resume(); },
        pause: function () {
            active = false; pet.pause(); clearTimeout(refreshTimer); if (refreshRequest) { refreshRequest.abort(); refreshRequest = null; }
        }
    };
}(this));
