(function (root) {
    'use strict';
    function number(value) { return typeof value === 'number' && isFinite(value); }
    function percent(value) { return number(value) && value >= 0 && value <= 100 ? value : null; }
    function fresh(timestamp, now, age) { return number(timestamp) && timestamp <= now + 60 && now - timestamp <= age; }
    function period(minutes) {
        if (minutes === 10080) return '每周';
        if (minutes === 1440) return '24 小时';
        return minutes % 60 === 0 ? minutes / 60 + ' 小时' : minutes + ' 分钟';
    }
    function derive(snapshot, now) {
        var result = { computer: null, computerState: '电脑未连接', account: null, quotaState: '额度未获取', rows: [], quotaAt: null };
        if (!snapshot || snapshot.schemaVersion !== 1) return result;
        var pc = snapshot.computer;
        if (pc && fresh(pc.sampledAt, now, 45)) {
            result.computerState = '电脑在线';
            result.computer = {
                cpu: percent(pc.cpuPercent), ram: percent(pc.memoryPercent), gpu: percent(pc.gpuPercent),
                used: number(pc.memoryUsedGiB) && pc.memoryUsedGiB >= 0 ? pc.memoryUsedGiB : null,
                total: number(pc.memoryTotalGiB) && pc.memoryTotalGiB > 0 ? pc.memoryTotalGiB : null,
                temperature: number(pc.gpuTemperatureC) ? pc.gpuTemperatureC : null,
                sampledAt: pc.sampledAt
            };
        } else if (pc) result.computerState = '电脑数据已过期';
        var q = snapshot.codex;
        if (!q) return result;
        if (q.account && typeof q.account.key === 'string' && q.account.key) {
            result.account = { key: q.account.key, label: typeof q.account.label === 'string' ? q.account.label : '当前账号', plan: q.account.plan === 'pro' ? 'Pro' : q.account.plan === 'plus' ? 'Plus' : '套餐未知' };
        }
        var states = { switching: '账号切换中', loading: '正在获取额度', signed_out: 'Codex 未登录', error: '额度获取失败', unsupported: '额度不可用' };
        if (q.state !== 'ready') { result.quotaState = states[q.state] || '额度未获取'; if (q.state === 'signed_out') result.account = null; return result; }
        // An account update and its quota snapshot may arrive in different host events.
        if (!result.account || q.quotaAccountKey !== result.account.key) { result.quotaState = '正在获取当前账号额度'; return result; }
        if (!fresh(q.fetchedAt, now, 600)) { result.quotaState = '额度已过期'; return result; }
        result.quotaAt = q.fetchedAt;
        if (Object.prototype.toString.call(q.buckets) !== '[object Array]') return result;
        for (var i = 0; i < q.buckets.length; i++) {
            var bucket = q.buckets[i];
            if (!bucket || typeof bucket.id !== 'string') continue;
            var windows = [bucket.primary, bucket.secondary];
            for (var j = 0; j < windows.length; j++) {
                var win = windows[j];
                if (!win || !number(win.windowDurationMins) || win.windowDurationMins <= 0) continue;
                var used = percent(win.usedPercent);
                var reset = number(win.resetsAt) ? win.resetsAt : null;
                var waiting = reset !== null && reset <= now;
                result.rows.push({ bucket: typeof bucket.label === 'string' ? bucket.label : bucket.id, label: period(win.windowDurationMins), remaining: waiting || used === null ? null : Math.round((100 - used) * 10) / 10, resetsAt: reset, waiting: waiting });
            }
        }
        result.quotaState = result.rows.length ? '剩余额度' : '未返回额度周期';
        return result;
    }
    var model = { derive: derive, period: period };
    if (typeof module !== 'undefined' && module.exports) module.exports = model;
    root.DeskModel = model;
}(this));
