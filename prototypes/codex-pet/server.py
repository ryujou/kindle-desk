"""Isolated PC simulator: actual app files, selectable snapshots and public activity."""
import json
import sys
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'pc'))
from pet_selection import selection

APP = ROOT / 'kindle/extensions/kindle-desk/app'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
from environment import presence_status, fetch_weather, LOCATION_FILE


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(Path(__file__).parent), **kwargs)

    def log_message(self, *_):
        pass

    def reply(self, value, code=200):
        body = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if urlparse(self.path).path != '/location':
            self.reply({'error': 'not_found'}, 404)
            return
        try:
            value = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            latitude, longitude = float(value['latitude']), float(value['longitude'])
            if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                raise ValueError('Invalid coordinates')
        except (KeyError, ValueError, TypeError):
            self.reply({'error': 'invalid_coordinates'}, 400)
            return
        LOCATION_FILE.parent.mkdir(parents=True, exist_ok=True)
        LOCATION_FILE.write_text(json.dumps(dict(latitude=latitude, longitude=longitude)), encoding='utf-8')
        self.reply({'ok': True})

    def do_GET(self):
        url = urlparse(self.path)
        if url.path.startswith('/shared/'):
            name = url.path.removeprefix('/shared/')
            if name not in ('model.js', 'pet.js', 'standby.js', 'care.js', 'care-panel.js', 'care.css'):
                self.reply({'error': 'not_found'}, 404)
                return
            body = (APP / name).read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/css; charset=utf-8' if name.endswith('.css') else 'application/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif url.path.startswith('/pets/'):
            name = url.path.removeprefix('/pets/')
            asset = APP / 'pets' / name
            if '/' in name or '\\' in name or not name.endswith('.png') or not asset.is_file():
                self.reply({'error': 'not_found'}, 404)
                return
            body = asset.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif url.path == '/weather':
            q = parse_qs(url.query)
            try:
                latitude, longitude = float(q['latitude'][0]), float(q['longitude'][0])
                if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                    raise ValueError('Invalid coordinates')
            except (KeyError, ValueError):
                self.reply({'error': 'invalid_coordinates'}, 400)
                return
            try:
                self.reply(fetch_weather(latitude, longitude))
            except (OSError, ValueError, KeyError) as error:
                self.reply({'error': type(error).__name__}, 502)
        elif url.path == '/pet':
            manifest_file = APP / 'pets/manifest.json'
            manifest = json.loads(manifest_file.read_text(encoding='utf-8')) if manifest_file.exists() else {}
            self.reply(selection(Path.home() / '.codex', manifest))
        elif url.path == '/snapshot':
            q = {k: v[0] for k, v in parse_qs(url.query).items()}
            now = int(time.time())
            if q.get('source') == 'live':
                try:
                    with opener.open('http://127.0.0.1:18768/snapshot', timeout=3) as response:
                        data = json.load(response)
                    with opener.open('http://127.0.0.1:18768/companion', timeout=3) as response:
                        companion = json.load(response)
                    data['environment'] = companion.get('environment')
                    data['activity'] = companion.get('activity')
                    data['presence'] = presence_status()
                    self.reply(data)
                except (OSError, ValueError) as error:
                    self.reply({'error': type(error).__name__}, 503)
                return
            state = q.get('state', 'waiting')
            plan = q.get('plan', 'plus')
            periods = q.get('periods', 'both')
            demos = {
                'waiting': '你更喜欢哪一种动画速度？请在电脑端选择流畅预览或墨水屏节奏。',
                'running': '正在检查宠物动画、额度周期和横屏布局，随后运行仿真测试。',
                'review': '仿真测试已完成，可以查看结果。',
                'idle': '当前没有正在执行的任务。',
                'failed': '设备连接中断，请检查 Kindle 的 Wi-Fi 连接。',
                'long': '正在核对本次界面更新：先检查宠物的每一帧是否完整显示，再检查账号切换后额度是否属于当前账号。对于没有返回的额度周期，界面应隐藏对应栏目。接下来会测试暂停、恢复、离线和返回阅读。',
            }
            if state == 'offline':
                self.reply({'error': 'offline'}, 503)
                return
            primary = dict(usedPercent=28, windowDurationMins=300, resetsAt=now+7200)
            secondary = dict(usedPercent=59, windowDurationMins=10080, resetsAt=now+86400*3)
            self.reply(dict(schemaVersion=1, demo=True, generatedAt=now,
                computer=dict(sampledAt=now, cpuPercent=24, memoryPercent=29,
                              memoryUsedGiB=37, memoryTotalGiB=128, gpuPercent=9, gpuTemperatureC=41),
                activity=None if state == 'none' else dict(state='unknown' if state == 'stale' else 'running' if state == 'long' else state, title='Kindle 桌面',
                              message=demos.get(state, ''), sampledAt=now, eventAt=now-3600 if state == 'stale' else now, source='demo'),
                codex=dict(state='ready', account=dict(key='demo-'+plan,label='演示账号',plan=plan),
                           quotaAccountKey='demo-'+plan,fetchedAt=now,
                           buckets=[dict(id='codex',label='Codex',
                             primary=primary if periods in ('both','five') else None,
                             secondary=secondary if periods in ('both','week') else None)])))
        else:
            super().do_GET()


if __name__ == '__main__':
    from http.server import HTTPServer
    HTTPServer(('127.0.0.1', 18770), Handler).serve_forever()
