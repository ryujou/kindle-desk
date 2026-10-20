/* Fuuka dialogue is original fan writing, informed by her profile and bond stories:
 * https://bluearchive.fandom.com/wiki/Aikiyo_Fuuka
 * https://rojiuragame.com/2024/04/14/【ブルーアーカイブ】キャラクター紹介〜「愛清/ */
(function (root) {
    'use strict';
    var lines = {
        morning: [
            '老师，|早呀，|今天也一起加油。',
            '早上好，老师。|早餐也要记得吃。',
            '新的一天，|从好好吃早餐开始吧。',
            '老师，|今天想吃什么口味的饭团？',
            '早呀，老师。|今天也别太勉强自己。'
        ],
        evening: [
            '老师，|今天也辛苦啦。',
            '晚饭要趁热吃，|工作稍后再说吧。',
            '忙了一天，|晚餐就好好犒劳自己吧。',
            '今天的事情，|慢慢收尾就好。',
            '老师，|今晚想喝点热汤吗？'
        ],
        lunch: [
            '老师，|到饭点了。|别又忙得忘了吃饭。',
            '午饭也要有蔬菜，|不能只吃点心哦。',
            '先好好吃饭，|下午才有精神。',
            '今天也想做一份|让人期待的便当。'
        ],
        night: [
            '老师，|已经很晚了，|早点休息吧。',
            '明天的早餐，|可不能睡过去哦。',
            '厨房要收拾，|老师也该准备休息了。',
            '今天就到这里吧。|晚安，老师。'
        ],
        daily: [
            '老师，|歇一会儿吧，|我陪着你。',
            '今天的便当，|配什么小菜好呢？',
            '看见大家好好吃饭，|就觉得值得了。',
            '老师，|不能又用泡面应付一餐哦。',
            '下次采购食材，|老师愿意一起去吗？',
            '给朱莉的食谱，|还是从简单的开始吧。',
            '今天的食堂，|能平平安安就好了。',
            '希望美食研究会|今天也好好排队……',
            '要是采购车|能一直平安无事就好了。',
            '便当的颜色搭配，|也要好好考虑呢。',
            '嗯……|新菜单再加一道家常菜吧。',
            '料理需要耐心，|老师也不用太着急。',
            '偶尔能这样安静待着，|也很好呢。',
            '老师，|有空也记得喝口水。',
            '能让老师期待下一餐，|我就很开心。',
            '今天想试试|不同的饭团馅料呢。'
        ],
        sitting: [
            '老师，|伸个懒腰，|我陪你等一会儿。',
            '起来走走吧，|回来再慢慢忙。',
            '老师，|趁这个空当活动一下吧。',
            '先去倒杯水吧，|工作等一小会儿。'
        ],
        rain: [
            '老师，|预报有雨，|出门记得带伞。',
            '一会儿可能下雨，|采购时记得带伞。',
            '老师，|把伞带上吧，|别淋湿了。',
            '雨天也要好好吃饭，|出门带上伞哦。'
        ]
    };
    var quotes = [
        {text: '人间有味|是清欢。', author: '苏轼'},
        {text: '心远|地自偏。', author: '陶渊明'},
        {text: '清泉|石上流。', author: '王维'},
        {text: '也无风雨|也无晴。', author: '苏轼'},
        {text: '悠然|见南山。', author: '陶渊明'},
        {text: '海上|生明月。', author: '张九龄'},
        {text: '绿蚁新醅酒，|红泥小火炉。', author: '白居易'},
        {text: '晚来天欲雪，|能饮一杯无？', author: '白居易'}
    ];
    var phrases = {};
    function unpack(raw) {
        var parts = raw.split('|'), text = parts.join('');
        phrases[text] = parts;
        return text;
    }
    Object.keys(lines).forEach(function (kind) { lines[kind] = lines[kind].map(unpack); });
    quotes.forEach(function (quote) { quote.text = unpack(quote.text); });
    function layout(text, measure, width) {
        if (measure(text) <= width) return [text];
        var parts = phrases[text], best = null, score = Infinity;
        if (!parts) return [text];
        for (var i = 1; i < parts.length; i++) {
            var a = parts.slice(0, i).join(''), b = parts.slice(i).join('');
            if (a.replace(/[，。！？、…]/g, '').length < 3 || b.replace(/[，。！？、…]/g, '').length < 3) continue;
            var aw = measure(a), bw = measure(b), cost = Math.max(aw, bw) + Math.abs(aw - bw) * 0.2;
            if (aw <= width && bw <= width && cost < score) { best = [a, b]; score = cost; }
        }
        return best || [text];
    }
    function paint(node, entry) {
        var style = getComputedStyle(node), canvas = document.createElement('canvas'), context = canvas.getContext('2d');
        context.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
        var rows = layout(entry.text, function (text) { return context.measureText(text).width; }, node.clientWidth);
        var text = rows.join('\n');
        if (node.textContent !== text) node.textContent = text;
        node.setAttribute('data-kind', entry.kind);
        node.setAttribute('data-lines', String(rows.length));
    }
    function create(random) {
        random = random || Math.random;
        var current = null, expires = 0, greeted = {}, lastReminder = -Infinity;
        var lastRain = -Infinity, lastSitting = -Infinity, lastText = '', previousQuote = false;
        function pick(list) {
            var candidates = list.filter(function (line) { return (line.text || line) !== lastText; });
            return candidates[Math.floor(random() * candidates.length)];
        }
        function period(hour) {
            return hour >= 6 && hour < 11 ? 'morning' : hour >= 11 && hour < 14 ? 'lunch' :
                hour >= 18 && hour < 23 ? 'evening' : hour >= 23 || hour < 6 ? 'night' : 'daily';
        }
        function read(context, force) {
            var now = context.now, part = period(context.hour), key = context.day + ':' + part;
            var w = context.weather, rain = w && now - w.sampledAt >= 0 && now - w.sampledAt < 3600 && w.forecastRain === true;
            if (current && now < expires && !force && !(current.kind === 'rain' && !rain) &&
                    !(current.kind === 'sitting' && (context.away || context.sittingSeconds < 2700))) return current;
            var kind = 'daily', chosen, author = '';
            if (!force && !context.quoteOnly && now - lastReminder >= 2700) {
                if (rain && now - lastRain >= 10800) {
                    kind = 'rain'; lastRain = lastReminder = now;
                } else if (!context.away && context.sittingSeconds >= 2700 && now - lastSitting >= 3600) {
                    kind = 'sitting'; lastSitting = lastReminder = now;
                }
            }
            if (kind === 'daily') {
                if (!force && !context.quoteOnly && part !== 'daily' && !greeted[key]) {
                    kind = part; greeted[key] = true;
                } else if (context.quoteOnly || (!previousQuote && random() < 0.25)) {
                    kind = 'quote';
                }
            }
            if (kind === 'quote') { chosen = pick(quotes); author = chosen.author; chosen = chosen.text; }
            else chosen = pick(lines[kind]);
            lastText = chosen; previousQuote = kind === 'quote'; expires = now + 1200;
            current = {text: chosen, author: author, kind: kind};
            return current;
        }
        return {read: read};
    }
    root.FuukaCompanion = {create: create, lines: lines, quotes: quotes, layout: layout, paint: paint};
}(typeof module !== 'undefined' ? module.exports : this));
