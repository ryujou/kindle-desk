(function () {
    'use strict';
    var active = false, clockTimer, pollTimer, deadline, request = null, snapshot = null, page = 0, accountKey = null, lastMinute = '', transportMessage = '';
    var manualRequest = null, manualTimer, manualUntil = 0;
    var fullTimer, fullDebounce, fullRequest = null, refreshWarning = '';
    var FULL_REFRESH_MS = 10 * 60 * 1000;
    function endpoint(name) { return (window.kindle ? 'http://127.0.0.1:18766/' : '') + 'cgi-bin/' + name + '.sh'; }
    function el(id) { return document.getElementById(id); }
    function text(id, value) { var node = el(id); if (node.textContent !== value) node.textContent = value; }
    function now() { return Math.floor(new Date().getTime() / 1000); }
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    function china(timestamp) { return new Date(timestamp * 1000 + 8 * 3600000); }
    function shortTime(timestamp) { var d = china(timestamp); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
    function dateLabel(timestamp) { var d = china(timestamp); return d.getUTCFullYear() + '/' + pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate()); }
    function fit() {
        var w = window.innerWidth, h = window.innerHeight, portrait = w < h;
        var scale = Math.min((portrait ? h : w) / 1000, (portrait ? w : h) / 740);
        var x = (w - (portrait ? 740 : 1000) * scale) / 2, y = (h - (portrait ? 1000 : 740) * scale) / 2;
        var transform = 'translate(' + (portrait ? w - x : x) + 'px,' + y + 'px) ' + (portrait ? 'rotate(90deg) ' : '') + 'scale(' + scale + ')';
        el('desk').style.webkitTransform = transform; el('desk').style.transform = transform;
    }
    function drawClock(hour, minute) {
        var ctx = el('dial').getContext('2d'), i, angle;
        ctx.setTransform(2, 0, 0, 2, 0, 0);
        ctx.clearRect(0, 0, 310, 310); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 310, 310);
        ctx.save(); ctx.translate(155, 155); ctx.strokeStyle = '#111'; ctx.fillStyle = '#111'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 151, 0, Math.PI * 2); ctx.stroke();
        for (i = 0; i < 60; i++) { angle = i * Math.PI / 30; ctx.save(); ctx.rotate(angle); ctx.lineWidth = i % 5 ? 1.5 : 3; ctx.beginPath(); ctx.moveTo(0, -139); ctx.lineTo(0, i % 5 ? -133 : -124); ctx.stroke(); ctx.restore(); }
        ctx.font = '24px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('12', 0, -106); ctx.fillText('3', 106, 0); ctx.fillText('6', 0, 106); ctx.fillText('9', -106, 0);
        function hand(a, length, width) { ctx.save(); ctx.rotate(a); ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(0, -length); ctx.stroke(); ctx.restore(); }
        hand((hour % 12 + minute / 60) * Math.PI / 6, 78, 8); hand(minute * Math.PI / 30, 111, 4);
        ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    function updateClock() {
        var timestamp = now(), d = china(timestamp), key = dateLabel(timestamp) + ' ' + shortTime(timestamp);
        if (key !== lastMinute) { lastMinute = key; text('time', shortTime(timestamp)); text('date', dateLabel(timestamp) + '　' + ['周日','周一','周二','周三','周四','周五','周六'][d.getUTCDay()]); drawClock(d.getUTCHours(), d.getUTCMinutes()); }
    }
    function resetLabel(row) { if (row.waiting) return '周期已到 · 等待新额度'; if (row.resetsAt === null) return '重置时间未提供'; return dateLabel(row.resetsAt) + ' ' + shortTime(row.resetsAt) + ' 重置'; }
    function metric(name, value) {
        var node = el(name), label = value === null ? '—' : Math.round(value) + '%';
        if (node.textContent !== label) { node.textContent = value === null ? '—' : String(Math.round(value)); if (value !== null) { var unit = document.createElement('span'); unit.textContent = '%'; node.appendChild(unit); } }
        el(name + '-bar').style.width = (value === null ? 0 : value) + '%';
    }
    var quotaSignature = '';
    function render() {
        var model = DeskModel.derive(snapshot, now()), pc = model.computer, account = model.account;
        var key = account ? account.key : null;
        if (key !== accountKey) { accountKey = key; page = 0; quotaSignature = ''; queueFullRefresh(); }
        text('connection', transportMessage === '电脑未配置' ? transportMessage : model.computerState);
        metric('cpu', pc ? pc.cpu : null); metric('ram', pc ? pc.ram : null); metric('gpu', pc ? pc.gpu : null);
        text('memory', pc && pc.used !== null && pc.total !== null ? '内存 ' + pc.used.toFixed(1) + ' / ' + pc.total + ' GiB' : '内存 —');
        text('temperature', pc && pc.temperature !== null ? '显卡 ' + Math.round(pc.temperature) + ' °C' : '显卡温度 —');
        text('plan', account ? account.plan : ''); text('account', account ? account.label : '账号未确认'); text('quota-state', model.quotaState);
        var totalPages = Math.max(1, Math.ceil(model.rows.length / 2)); page = Math.min(page, totalPages - 1);
        var rows = model.rows.slice(page * 2, page * 2 + 2), shape = [];
        for (var r = 0; r < rows.length; r++) shape.push([rows[r].bucket, rows[r].label]);
        var signature = JSON.stringify([shape, model.quotaState, page]);
        if (signature !== quotaSignature) {
            quotaSignature = signature; var parent = el('quota-rows'); parent.textContent = '';
            if (!rows.length) { var empty = document.createElement('div'); empty.className = 'quota-empty'; var title = document.createElement('strong'); title.textContent = model.quotaState; empty.appendChild(title); parent.appendChild(empty); }
            for (var i = 0; i < rows.length; i++) {
                var row = rows[i], box = document.createElement('div'); box.className = 'quota-row';
                var label = document.createElement('div'); label.className = 'quota-label'; label.textContent = row.bucket + ' · ' + row.label; box.appendChild(label);
                var value = document.createElement('div'); value.className = 'quota-value'; value.textContent = row.remaining === null ? '—' : String(row.remaining); if (row.remaining !== null) { var percent = document.createElement('span'); percent.textContent = '%'; value.appendChild(percent); } box.appendChild(value);
                var track = document.createElement('div'), fill = document.createElement('div'); track.className = 'quota-track'; fill.style.width = (row.remaining === null ? 0 : row.remaining) + '%'; track.appendChild(fill); box.appendChild(track);
                var reset = document.createElement('div'); reset.className = 'quota-reset'; reset.textContent = resetLabel(row); box.appendChild(reset); parent.appendChild(box);
            }
        }
        var boxes = el('quota-rows').querySelectorAll('.quota-row');
        for (var k = 0; k < rows.length; k++) {
            var currentRow = rows[k], currentBox = boxes[k];
            var valueNode = currentBox.querySelector('.quota-value'), valueText = currentRow.remaining === null ? '—' : currentRow.remaining + '%';
            if (valueNode.textContent !== valueText) { valueNode.textContent = currentRow.remaining === null ? '—' : String(currentRow.remaining); if (currentRow.remaining !== null) { var unitNode = document.createElement('span'); unitNode.textContent = '%'; valueNode.appendChild(unitNode); } }
            var width = (currentRow.remaining === null ? 0 : currentRow.remaining) + '%', fillNode = currentBox.querySelector('.quota-track div');
            if (fillNode.style.width !== width) fillNode.style.width = width;
            var resetNode = currentBox.querySelector('.quota-reset'), resetText = resetLabel(currentRow);
            if (resetNode.textContent !== resetText) resetNode.textContent = resetText;
        }
        el('next').hidden = totalPages === 1; text('next', (page + 1) + '/' + totalPages + '　下一组');
        text('message', refreshWarning || transportMessage);
    }
    function fullRefresh() {
        clearTimeout(fullDebounce);
        if (!active || fullRequest) return;
        var xhr = new XMLHttpRequest(); fullRequest = xhr;
        xhr.open('POST', endpoint('refresh'), true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4 || fullRequest !== xhr) return;
            fullRequest = null;
            var ok = false;
            try { ok = xhr.status === 200 && JSON.parse(xhr.responseText).ok === true; } catch (error) { ok = false; }
            refreshWarning = ok ? '' : '全刷未完成 · 需检查设备刷新支持';
            if (active) render();
        };
        xhr.send('');
        clearTimeout(fullTimer); fullTimer = setTimeout(fullRefresh, FULL_REFRESH_MS);
    }
    function queueFullRefresh() { if (!active) return; clearTimeout(fullDebounce); fullDebounce = setTimeout(fullRefresh, 400); }
    function finish(xhr, message) {
        if (request !== xhr) return;
        clearTimeout(deadline); request = null; el('refresh').disabled = manualUntil > 0;
        if (message) { snapshot = null; transportMessage = message; }
        render(); if (active) pollTimer = setTimeout(load, 15000);
    }
    function load() {
        if (!active || request) return;
        clearTimeout(pollTimer); var xhr = new XMLHttpRequest(); request = xhr; el('refresh').disabled = true;
        xhr.open('GET', endpoint('snapshot') + '?t=' + new Date().getTime(), true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4 || request !== xhr) return;
            if (xhr.status !== 200) { finish(xhr, '电脑离线 · 等待重新连接'); return; }
            try {
                var data = JSON.parse(xhr.responseText);
                if (data.error) { finish(xhr, data.error === 'not_configured' ? '电脑未配置' : '电脑离线 · 等待重新连接'); return; }
                if (data.schemaVersion !== 1) { finish(xhr, '电脑数据格式不支持'); return; }
                snapshot = data; transportMessage = data.demo === true ? '演示数据 · 未接入真实账号' : '';
            } catch (error) { finish(xhr, '电脑数据格式错误'); return; }
            finish(xhr, '');
        };
        deadline = setTimeout(function () { if (request === xhr) { finish(xhr, '连接超时 · 时钟继续运行'); xhr.abort(); } }, 7000);
        xhr.send(null);
    }
    function manualRefresh() {
        if (!active || manualUntil) return;
        manualUntil = new Date().getTime() + 90000;
        el('refresh').disabled = true; text('refresh', '查询额度…');
        checkManual('POST');
    }
    function endManual(message) {
        manualUntil = 0; clearTimeout(manualTimer); manualRequest = null;
        text('refresh', '刷新数据'); el('refresh').disabled = false;
        if (message) { transportMessage = message; render(); }
        else { load(); DeskCompanion.pause(); DeskCompanion.resume(); }
    }
    function checkManual(method) {
        if (!active || !manualUntil) return;
        var xhr = new XMLHttpRequest(); manualRequest = xhr;
        xhr.open(method, endpoint('quota-refresh'), true);
        manualTimer = setTimeout(function () { xhr.abort(); endManual('额度刷新超时'); }, 7000);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4 || manualRequest !== xhr) return;
            clearTimeout(manualTimer); manualRequest = null;
            var data;
            try { data = JSON.parse(xhr.responseText); } catch (error) { data = {}; }
            if (xhr.status !== 200 || data.error) { endManual('额度刷新失败'); return; }
            if (method === 'GET' && data.pending === false) { endManual(''); return; }
            if (new Date().getTime() > manualUntil) { endManual('额度查询超时，请稍后再试'); return; }
            manualTimer = setTimeout(function () { checkManual('GET'); }, 2000);
        };
        xhr.send(null);
    }
    function tick() { if (!active) return; updateClock(); render(); clockTimer = setTimeout(tick, 60000 - new Date().getTime() % 60000 + 20); }
    function pause() { if (window.kindle && window.kindle.device && typeof window.kindle.device.setSensitivity === 'function') window.kindle.device.setSensitivity(false); clearTimeout(manualTimer); manualUntil = 0; var manual = manualRequest; manualRequest = null; if (manual) manual.abort(); text('refresh', '刷新数据'); DeskCompanion.pause(); active = false; clearTimeout(clockTimer); clearTimeout(pollTimer); clearTimeout(deadline); clearTimeout(fullTimer); clearTimeout(fullDebounce); var pending = request; request = null; if (pending) pending.abort(); var repaint = fullRequest; fullRequest = null; if (repaint) repaint.abort(); el('refresh').disabled = manualUntil > 0; }
    function enter() { if (active) return; if (window.kindle && window.kindle.device && typeof window.kindle.device.setSensitivity === 'function') window.kindle.device.setSensitivity(false); active = true; DeskCompanion.resume(); snapshot = null; el('closed').hidden = true; fit(); tick(); load(); queueFullRefresh(); }
    el('next').onclick = function () { var count = Math.max(1, Math.ceil(DeskModel.derive(snapshot, now()).rows.length / 2)); page = (page + 1) % count; render(); queueFullRefresh(); };
    el('refresh').onclick = manualRefresh;
    el('clean').onclick = fullRefresh;
    el('exit').onclick = function () {
        pause(); snapshot = null; el('closed').hidden = false;
        text('close-message', window.kindle ? '正在返回原系统…' : '浏览器测试：绘制和数据轮询已停止。');
        var xhr = new XMLHttpRequest(), exitDeadline;
        function failed() { if (window.kindle) text('close-message', '退出未完成，请重启 Kindle。'); }
        xhr.open('POST', endpoint('exit'), true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            var ok = false;
            try { ok = xhr.status === 200 && JSON.parse(xhr.responseText).ok === true; } catch (error) { ok = false; }
            if (!ok) { clearTimeout(exitDeadline); failed(); }
        };
        exitDeadline = setTimeout(failed, 5000);
        xhr.send('');
    };
    el('resume').onclick = enter; window.onresize = fit; window.onunload = pause;
    if (window.kindle && window.kindle.appmgr) {
        window.kindle.appmgr.ongo = function () {
            window.kindle.device.setOrientation('landscapeLeft');
            enter();
        };
        window.kindle.appmgr.onpause = pause; window.kindle.appmgr.onstop = pause;
        fit(); updateClock(); render();
    } else enter();
    document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); else enter(); });
}());
