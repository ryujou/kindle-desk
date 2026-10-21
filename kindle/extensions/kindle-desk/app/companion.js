(function (root) {
    'use strict';
    var latest = {}, disconnected = false, page = '', origin, signature = '';
    var labels = {running: '进行中', waiting: '需要确认', review: '已完成', failed: '遇到问题', idle: '休息中', unknown: '状态未知', offline: '电脑离线'};
    function node(id) { return document.getElementById(id); }
    function number(v) { return typeof v === 'number' && isFinite(v); }
    function fresh(at, limit) { var now = Date.now() / 1000; return number(at) && at > 0 && at <= now + 60 && now - at <= limit; }
    function time(at) {
        if (!number(at) || at <= 0) return '时间未知';
        var d = new Date((at + 28800) * 1000);
        function pad(n) { return n < 10 ? '0' + n : String(n); }
        return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
    }
    function age(at, limit) {
        if (!number(at) || at <= 0) return '时间未知';
        var minutes = Math.max(0, Math.floor((Date.now() / 1000 - at) / 60));
        return (fresh(at, limit) ? '' : '已过期 · ') + (minutes ? minutes + ' 分钟前' : fresh(at, limit) ? '刚刚' : Math.max(0, Math.floor(Date.now() / 1000 - at)) + ' 秒前');
    }
    var weatherLabels = {
        0: '晴', 1: '晴间多云', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇',
        51: '轻毛毛雨', 53: '中等毛毛雨', 55: '浓毛毛雨', 56: '轻冻毛毛雨', 57: '强冻毛毛雨',
        61: '小雨', 63: '中雨', 65: '大雨', 66: '轻冻雨', 67: '强冻雨',
        71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
        80: '小阵雨', 81: '中阵雨', 82: '强阵雨', 85: '小阵雪', 86: '中到大阵雪',
        95: '雷暴', 96: '雷暴伴小冰雹', 99: '雷暴伴大冰雹'
    };
    function weather(code) {
        return number(code) && weatherLabels[code] || '天气未提供';
    }
    function temperature(v) { return number(v) ? Math.round(v) + '℃' : '未提供'; }
    function add(parent, tag, cls, value) {
        var e = document.createElement(tag); e.className = cls || '';
        if (value !== undefined) e.textContent = value;
        parent.appendChild(e); return e;
    }
    function render() {
        if (!page) return;
        var c = latest.companion || {}, a = c.activity || {}, env = c.environment || {};
        var w = env.weather, q = page === 'other' ? c.otherAccount : latest.codex;
        var model = DeskModel.derive({schemaVersion: 1, codex: q}, Date.now() / 1000);
        var notice = (latest.demo ? '演示数据 · ' : '') + (disconnected ? '电脑离线 · 保留最近数据 · ' : '');
        notice += page === 'weather' ? '天气更新于 ' + time(w && w.sampledAt) + ' · ' + age(w && w.sampledAt, 3600) :
            '当前电脑任务 · ' + (disconnected || !fresh(a.sampledAt, 30) ? '任务状态未同步 · ' : '') + '采样于 ' + time(a.sampledAt) + ' · 可滚动阅读';
        node('details-notice').textContent = notice;
        var next = JSON.stringify([page, page === 'weather' ? w : a, page === 'weather' ? null : model]);
        if (signature === next) return;
        signature = next;
        var box = node('details-content'), scroll = box.scrollTop; box.textContent = '';
        if (page === 'weather') {
            node('details-title').textContent = '天气详情';
            if (!w) { add(box, 'p', '', '尚未收到天气数据'); return; }
            add(box, 'div', 'weather-now', temperature(w.temperature) + ' · ' + weather(w.code));
            var today = w.today || {};
            add(box, 'div', 'weather-range', (today.at ? time(today.at).split(' ')[0] : '日期未提供') +
                '　最高 ' + temperature(today.maximum) + '　最低 ' + temperature(today.minimum));
            var hours = (w.hours || []).filter(function (h) { return h.at >= Date.now() / 1000; }).slice(0, 6);
            if (!hours.length) { add(box, 'p', '', '暂无后续逐小时预报'); return; }
            var table = add(box, 'table', 'forecast'), head = add(table, 'thead'), row = add(head, 'tr');
            ['时间（北京时间）', '天气', '温度', '降雨概率'].forEach(function (s) { add(row, 'th', '', s); });
            var body = add(table, 'tbody');
            hours.forEach(function (h) {
                var r = add(body, 'tr');
                [time(h.at), weather(h.code), temperature(h.temperature), number(h.rainProbability) ? Math.round(h.rainProbability) + '%' : '未提供']
                    .forEach(function (s) { add(r, 'td', '', s); });
            });
        } else {
            node('details-title').textContent = '任务与额度';
            var copy = add(box, 'div', 'task-copy');
            add(copy, 'h3', '', a.title || '尚未收到任务');
            add(copy, 'div', 'task-meta', (labels[a.state] || '状态未知') + ' · 最近事件 ' + time(a.eventAt));
            add(copy, 'div', 'task-message', a.message || '暂无公开进度消息');
            var quota = add(box, 'div', 'task-quota');
            add(quota, 'h3', '', (page === 'other' ? '另一账号' : '当前账号') + ' · ' + (model.account ? model.account.plan : '未登录'));
            add(quota, 'div', 'task-meta', '额度更新于 ' + time(q && q.fetchedAt));
            if (!model.rows.length) add(quota, 'p', '', model.quotaState);
            model.rows.forEach(function (r) {
                var entry = add(quota, 'div', 'detail-quota-row');
                add(entry, 'div', '', r.label);
                add(entry, 'strong', '', r.remaining === null ? '—' : '剩余 ' + r.remaining + '%');
                add(entry, 'small', '', r.waiting ? '等待新额度' : '重置于 ' + time(r.resetsAt));
            });
        }
        box.scrollTop = scroll;
    }
    function close() {
        if (!page) return;
        page = ''; node('details').hidden = true; node('desk').className = ''; signature = '';
        if (root.DeskCompanion) root.DeskCompanion.detail(false);
        if (origin) origin.focus();
        if (root.DeskDetails.onChange) root.DeskDetails.onChange();
    }
    function open(kind, element) {
        page = kind; origin = element; signature = ''; node('desk').className = 'detail-open'; node('details').hidden = false;
        if (root.DeskCompanion) root.DeskCompanion.detail(true);
        node('details-content').scrollTop = 0; render(); node('details-back').focus();
        if (root.DeskDetails.onChange) root.DeskDetails.onChange();
    }
    function bind(id, kind) {
        var e = node(id);
        e.onclick = function () { open(kind, e); };
        e.onkeydown = function (event) { if (event.keyCode === 13 || event.keyCode === 32) { event.preventDefault(); open(kind, e); } };
    }
    bind('ambient-weather', 'weather'); bind('task-open', 'task'); bind('other-task-open', 'other');
    node('details-back').onclick = close;
    node('details').onkeydown = function (event) { if (event.keyCode === 27) close(); };
    root.DeskDetails = {
        fresh: fresh, age: age, time: time, weather: weather, labels: labels, close: close,
        update: function (data, offline) {
            disconnected = !!offline;
            if (data) {
                if (data.computer !== undefined) latest.computer = data.computer;
                if (data.codex !== undefined) latest.codex = data.codex;
                if (data.companion) {
                    var prior = latest.companion || {}, env = data.companion.environment || {}, old = prior.environment || {};
                    latest.companion = {activity: data.companion.activity, otherAccount: data.companion.otherAccount,
                        environment: {weather: env.weather || old.weather, indoor: env.indoor || old.indoor}};
                }
                if (data.demo !== undefined) latest.demo = data.demo;
            }
            render();
        }
    };
}(this));

(function (root) {
    'use strict';
    var pet = new DeskPet(document.getElementById('pet')), active = false, refreshTimer, refreshRequest;
    var labels = {idle: '休息中', running: '进行中', waiting: '需要你确认', review: '已完成', failed: '遇到问题', unknown: '等待状态', offline: '电脑未连接'};
    var speech = FuukaCompanion.create(), currentActivity, currentEnvironment, detailOpen = false, lastData;
    var messageNode = document.getElementById('pet-message');
    messageNode.onclick = function () { if (isStandby(currentActivity)) paintSpeech(true); };
    pet.setMode('native');
    pet.node.onclick = function () { pet.cycleAnimation(); };
    pet.onDraw = function (row) {
        if (!window.kindle || !pet.nativeAsset || !active || detailOpen || refreshRequest) return;
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
    function weatherIcon(code) {
        var cloud = 'M7 21h18a5 5 0 0 0 0-10h-1a8 8 0 0 0-15 2 4 4 0 0 0-2 8Z';
        var sun = 'M16 10a6 6 0 1 0 0 12 6 6 0 1 0 0-12 M16 2v4 M16 26v4 M2 16h4 M26 16h4 M6 6l3 3 M23 23l3 3 M6 26l3-3 M23 9l3-3';
        if (code === 0 || code === 1) return sun;
        if (code === 2) return 'M8 15a5 5 0 1 1 9-4 M10 1v3 M1 10h3 M3 3l3 3 M18 3l-3 3 ' + cloud;
        if (code === 3) return cloud;
        if (code === 45 || code === 48) return cloud + ' M3 25h26 M6 29h20';
        var rainLevel = {51:1,53:2,55:3,56:1,57:3,61:1,63:2,65:3,66:1,67:3,80:1,81:2,82:3};
        var snowLevel = {71:1,73:2,75:3,77:1,85:1,86:3};
        var marks = '', i, x, level = rainLevel[code] || snowLevel[code];
        if (level) {
            for (i = 0; i < level; i++) {
                x = 16 + (i - (level - 1) / 2) * 8;
                if (snowLevel[code]) marks += ' M' + x + ' 24v6 M' + (x - 3) + ' 27h6';
                else marks += ' M' + x + ' 24l-2 ' + (code < 60 ? 2 : 6);
            }
            if ([56,57,66,67].indexOf(code) >= 0) marks += ' M3 25l3-3 3 3-3 3Z';
            return cloud + marks;
        }
        if ([95,96,99].indexOf(code) >= 0) return cloud + ' M17 22l-4 5h5l-3 4' +
            (code === 95 ? '' : code === 96 ? ' M23 25h3v3h-3Z' : ' M23 24h5v5h-5Z M5 25h3v3H5Z');
        return 'M8 16h16';
    }
    function showEnvironment() {
        var environment = currentEnvironment || {}, indoor = environment.indoor, weather = environment.weather;
        hidden('ambient-indoor', !indoor);
        if (indoor) {
            text('room-temperature', Math.round(indoor.temperature));
            text('room-humidity', Math.round(indoor.humidity));
            text('room-pm25', Math.round(indoor.pm25));
        }
        var visible = !!weather;
        hidden('ambient-weather', false);
        var icon = document.querySelector('#ambient-weather svg path'), shape = weatherIcon(weather && weather.code);
        if (icon.getAttribute('d') !== shape) icon.setAttribute('d', shape);
        if (!visible) text('outdoor-weather', '天气未提供');
        if (visible) {
            var label = DeskDetails.weather(weather.code);
            text('outdoor-weather', Math.round(weather.temperature) + '℃ · ' + label);
        }
        var ageText = (indoor ? '室内 ' + DeskDetails.age(indoor.sampledAt, 180) : '室内未提供') + ' · ' +
            (weather ? '天气 ' + DeskDetails.age(weather.sampledAt, 3600) : '天气未提供');
        text('environment-age', ageText.replace(/已过期 · /g, '过期 ').replace(/ 分钟前/g, '分前').replace(/ 秒前/g, '秒前'));
    }
    function show(state, message, data) {
        currentActivity = data ? data.activity : {state: state};
        var env = data && data.environment || {}, prior = currentEnvironment || {};
        currentEnvironment = {presence: env.presence, indoor: env.indoor || prior.indoor, weather: env.weather || prior.weather};
        var idle = state === 'offline' || isStandby(currentActivity);
        var companionNode = document.getElementById('companion'), className = idle ? 'standby' : '';
        if (companionNode.className !== className) companionNode.className = className;
        hidden('ambient-info', !idle);
        if (pet.state !== state && (state === 'running' || state === 'waiting' || state === 'failed' || state === 'review' || state === 'offline')) pet.cancelReaction();
        pet.setState(state === 'offline' ? 'offline' : idle ? 'idle' : state); pet.setAmbient(idle && state !== 'offline');
        if (detailOpen) pet.pause();
        if (idle) { showEnvironment(); if (state === 'offline') text('pet-message', message); else paintSpeech(false); return; }
        var label = document.getElementById('pet-state'), bubble = document.getElementById('pet-message');
        if (label.textContent !== labels[state]) label.textContent = labels[state] || labels.unknown;
        if (bubble.textContent !== message) { bubble.textContent = message; bubble.scrollTop = 0; }
    }
    function update(data) {
        if (!active) return;
        if (!data || !data.pet || !data.activity) {
            show('offline', '电脑暂时断开了。恢复连接后，我会继续同步。');
            showEnvironment();
            renderOther(lastData && lastData.otherAccount); return;
        }
        lastData = data;
        pet.setPet(data.pet);
        renderOther(data.otherAccount);
        var message = data.activity.message || '';
        message = message.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        if (data.pet.state === 'missing_asset') message = '新宠物素材尚未同步';
        var state = DeskDetails.fresh(data.activity.sampledAt, 30) ? data.activity.state : 'unknown';
        var notices = {waiting: '老师，有个问题需要你在电脑上确认。', review: '这次任务完成了，老师可以查看结果啦。',
            failed: '任务遇到问题了，老师看看详情吧。'};
        if (state === 'unknown') { show('offline', '任务状态暂未同步，请查看详情中的更新时间。', data); return; }
        show(state, notices[state] || message, data);
    }
    root.DeskCompanion = {
        pet: pet,
        update: update,
        detail: function (open) { detailOpen = open; if (open) pet.pause(); else if (active) pet.resume(); },
        resume: function () { if (active) return; active = true; pet.resume(); },
        pause: function () {
            active = false; pet.pause(); clearTimeout(refreshTimer); if (refreshRequest) { refreshRequest.abort(); refreshRequest = null; }
        }
    };
}(this));
