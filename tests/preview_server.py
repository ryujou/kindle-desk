"""Serve the actual Kindle app with synthetic snapshots, never account credentials."""
import json
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

APP = Path(__file__).resolve().parents[1] / 'kindle/extensions/kindle-desk/app'
SCENARIO = 'plus'


def sample(scenario):
    stamp = int(time.time())
    pro = scenario in ('pro', 'switching', 'mismatch', 'multi', 'single')
    key = 'demo-pro' if pro else 'demo-plus'
    result = {
        'schemaVersion': 1, 'demo': True, 'generatedAt': stamp,
        'computer': {'sampledAt': stamp, 'cpuPercent': 24, 'memoryPercent': 58,
                     'memoryUsedGiB': 18.6, 'memoryTotalGiB': 32, 'gpuPercent': 36, 'gpuTemperatureC': 46},
        'codex': {'state': 'ready', 'account': {'key': key, 'label': '演示账号 B' if pro else '演示账号 A', 'plan': 'pro' if pro else 'plus'},
                  'quotaAccountKey': key, 'fetchedAt': stamp,
                  'buckets': [{'id': 'codex', 'label': 'Codex', 'primary': {'usedPercent': 12 if pro else 28, 'windowDurationMins': 300, 'resetsAt': stamp + 7200},
                               'secondary': {'usedPercent': 23 if pro else 59, 'windowDurationMins': 10080, 'resetsAt': stamp + 86400 * 3}}]}}
    quota = result['codex']
    if scenario == 'pro':
        quota['buckets'][0]['primary'] = quota['buckets'][0]['secondary']
        quota['buckets'][0]['secondary'] = None
    if scenario == 'switching':
        quota['state'] = 'switching'
        quota['buckets'] = []
    elif scenario == 'mismatch':
        quota['quotaAccountKey'] = 'demo-plus'
    elif scenario == 'signed_out':
        quota.update(state='signed_out', account=None, buckets=[])
    elif scenario == 'stale':
        quota['fetchedAt'] -= 601
        result['computer']['sampledAt'] -= 46
    elif scenario == 'reset':
        quota['buckets'][0]['primary']['resetsAt'] = stamp - 1
    elif scenario == 'single':
        quota['buckets'][0]['secondary'] = None
    elif scenario == 'multi':
        quota['buckets'].append({'id': 'extra', 'label': '独立额度桶', 'primary': {'usedPercent': 60, 'windowDurationMins': 60, 'resetsAt': stamp + 3600}, 'secondary': None})
    elif scenario == 'low':
        quota['buckets'][0]['primary']['usedPercent'] = 96
    return result


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP), **kwargs)

    def json(self, body, code=200):
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        global SCENARIO
        target = urlparse(self.path)
        if target.path == '/scenario':
            name = parse_qs(target.query).get('name', ['plus'])[0]
            if name not in ('plus', 'pro', 'switching', 'mismatch', 'signed_out', 'offline', 'stale', 'reset', 'single', 'multi', 'low', 'invalid'):
                self.json({'error': 'unknown scenario'}, 400)
                return
            SCENARIO = name
            self.json({'scenario': SCENARIO})
        elif target.path == '/cgi-bin/snapshot.sh':
            if SCENARIO == 'offline':
                self.json({'error': 'offline'})
            elif SCENARIO == 'invalid':
                self.json({'schemaVersion': 99})
            else:
                self.json(sample(SCENARIO))
        elif target.path == '/cgi-bin/quota-refresh.sh':
            self.json({'id': 1, 'pending': False})
        elif target.path == '/cgi-bin/companion.sh':
            self.json({'pet': {'state': 'off'}, 'activity': {'state': 'idle', 'message': '演示数据：未加载宠物素材'}, 'otherAccount': sample('pro')['codex']})
        elif target.path == '/preview':
            data = (Path(__file__).parent / 'preview.html').read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()

    def do_POST(self):
        self.json({'ok': self.path in ('/cgi-bin/exit.sh', '/cgi-bin/refresh.sh', '/cgi-bin/quota-refresh.sh'), 'simulated': True})


if __name__ == '__main__':
    print('Kindle app preview: http://127.0.0.1:18767/preview', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 18767), Handler).serve_forever()
