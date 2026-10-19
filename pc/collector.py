"""Windows performance service and per-user Codex quota reader (standard library only)."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'kindle/extensions/kindle-desk/app'
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


def empty_quota(state='loading', account=None):
    return dict(state=state, account=account, quotaAccountKey=None, fetchedAt=None, buckets=[])


def window(value):
    if not isinstance(value, dict):
        return None
    return {k: value.get(k) for k in ('usedPercent', 'windowDurationMins', 'resetsAt')}


def buckets(result):
    values = result.get('rateLimitsByLimitId')
    if not values:
        single = result.get('rateLimits')
        values = {single.get('limitId') or 'codex': single} if single else {}
    return [dict(id=k, label=v.get('limitName') or ('Codex' if k == 'codex' else k),
                 primary=window(v.get('primary')), secondary=window(v.get('secondary')))
            for k, v in values.items()]


class Rpc:
    def __init__(self, command):
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, text=True, encoding='utf-8',
                                        creationflags=NO_WINDOW)
        self.messages = queue.Queue()
        self.serial = 0
        self.changed = False
        threading.Thread(target=self.read, daemon=True).start()

    def read(self):
        for line in self.process.stdout:
            try:
                self.messages.put(json.loads(line))
            except ValueError:
                self.messages.put({'invalid': True})
        self.messages.put({'closed': True})

    def send(self, message):
        self.process.stdin.write(json.dumps(message) + '\n')
        self.process.stdin.flush()

    def call(self, method, params=None):
        self.serial += 1
        request = dict(id=self.serial, method=method)
        if params is not None:
            request['params'] = params
        self.send(request)
        deadline = time.monotonic() + 20
        while True:
            message = self.messages.get(timeout=max(.01, deadline - time.monotonic()))
            if message.get('closed') or message.get('invalid'):
                raise RuntimeError('Codex RPC stream closed or invalid')
            if message.get('method') == 'account/updated':
                self.changed = True
            if message.get('id') != self.serial:
                continue
            if 'error' in message:
                # Do not forward remote diagnostics which may contain account information.
                raise RuntimeError('Codex RPC error ' + str(message['error'].get('code')))
            return message['result']

    def __enter__(self):
        try:
            self.call('initialize', {'clientInfo': {'name': 'kindle_desk', 'version': '1.0'},
                                     'capabilities': {'experimentalApi': True}})
            self.send({'method': 'initialized'})
            return self
        except (OSError, RuntimeError, queue.Empty):
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *_):
        if self.process.poll() is None:
            self.process.terminate()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()


def identity(account):
    if not account or account.get('type') != 'chatgpt':
        return None
    # Email remains in this user's process; the LAN receives only an opaque key and alias.
    return (account.get('id') or account.get('email'), account.get('planType'))


class QuotaReader:
    def __init__(self, command, publish, rpc_factory=Rpc):
        self.command, self.publish, self.rpc_factory = command, publish, rpc_factory
        self.current = None
        self.accounts = {}
        self.value = empty_quota()
        self.next_fetch = 0

    def account_alias(self, ident):
        if ident not in self.accounts:
            self.accounts[ident] = dict(key=uuid.uuid4().hex, label='账号 ' + str(len(self.accounts) + 1), plan=ident[1])
        return self.accounts[ident]

    def poll(self):
        # A fresh app-server loads the desktop user's currently saved login, avoiding
        # a long-running secondary app-server retaining the previous account in memory.
        with self.rpc_factory(self.command) as rpc:
            account = rpc.call('account/read', {'refreshToken': False}).get('account')
            rpc.changed = False
            ident = identity(account)
            if not ident or not ident[0]:
                self.current = None
                self.value = empty_quota('signed_out' if account is None else 'unsupported')
                self.publish(self.value)
                return
            alias = self.account_alias(ident)
            if ident != self.current:
                self.current = ident
                self.value = empty_quota('switching', alias)
                self.next_fetch = 0
                self.publish(self.value)
            if time.monotonic() < self.next_fetch:
                self.publish(self.value)
                return
            result = rpc.call('account/rateLimits/read')
            candidate = dict(state='ready', account=alias, quotaAccountKey=alias['key'],
                             fetchedAt=int(time.time()), buckets=buckets(result))
            notified = rpc.changed
        # Reopen against saved auth after the network operation: an in-flight response
        # belonging to the old login must not be assigned to the newly selected login.
        with self.rpc_factory(self.command) as check:
            after = identity(check.call('account/read', {'refreshToken': False}).get('account'))
        plans = {v.get('planType') for v in (result.get('rateLimitsByLimitId') or {}).values() if v.get('planType')}
        if after != ident or notified or (plans and plans != {ident[1]}):
            self.current = None
            self.value = empty_quota('switching')
        else:
            self.value = candidate
            self.next_fetch = time.monotonic() + 300
        self.publish(self.value)


class MemoryStatus(ctypes.Structure):
    _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [
        (name, ctypes.c_ulonglong) for name in ('total', 'available', 'pageTotal', 'pageAvailable',
                                             'virtualTotal', 'virtualAvailable', 'extended')]


class Performance:
    def __init__(self):
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.previous = self.cpu_times()
        self.gpu = shutil.which('nvidia-smi')
        self.gpu_error = None

    def cpu_times(self):
        idle, kernel, user = ctypes.c_ulonglong(), ctypes.c_ulonglong(), ctypes.c_ulonglong()
        if not self.kernel.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
            raise ctypes.WinError(ctypes.get_last_error())
        return idle.value, kernel.value + user.value

    def sample(self):
        current = self.cpu_times()
        idle, total = current[0] - self.previous[0], current[1] - self.previous[1]
        self.previous = current
        mem = MemoryStatus()
        mem.length = ctypes.sizeof(mem)
        if not self.kernel.GlobalMemoryStatusEx(ctypes.byref(mem)):
            raise ctypes.WinError(ctypes.get_last_error())
        gpu, temperature = None, None
        self.gpu_error = None
        if self.gpu:
            try:
                raw = subprocess.run([self.gpu, '--id=0', '--query-gpu=utilization.gpu,temperature.gpu',
                                      '--format=csv,noheader,nounits'], capture_output=True, text=True,
                                     timeout=3, check=True, creationflags=NO_WINDOW).stdout.strip().split(',')
                gpu, temperature = float(raw[0]), float(raw[1])
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                self.gpu_error = type(error).__name__
        return dict(sampledAt=int(time.time()), cpuPercent=round(100 * (1 - idle / total), 1) if total else None,
                    memoryPercent=round(100 * (1 - mem.available / mem.total), 1),
                    memoryUsedGiB=round((mem.total - mem.available) / 2**30, 2),
                    memoryTotalGiB=round(mem.total / 2**30, 2), gpuPercent=gpu, gpuTemperatureC=temperature)


class State:
    def __init__(self):
        self.computer = None
        self.quota = empty_quota()
        self.quota_received = 0
        self.companion = None
        self.companion_received = 0
        self.refresh_id = 0
        self.refresh_done = {"current": 0, "other": 0}
        self.performance_error = None
        self.gpu_error = None
        self.lock = threading.Lock()

    def snapshot(self):
        with self.lock:
            quota = self.quota if time.monotonic() - self.quota_received < 45 else empty_quota('error')
            return dict(schemaVersion=1, demo=False, generatedAt=int(time.time()), computer=self.computer, codex=quota)


def make_handler(state):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, value, code=200):
            self.body(json.dumps(value, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8', code)

        def body(self, body, content_type, code=200):
            self.send_response(code)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = self.path.split('?')[0]
            if path in ('/snapshot', '/cgi-bin/snapshot.sh'):
                self.reply(state.snapshot())
            elif path in ('/companion', '/cgi-bin/companion.sh'):
                with state.lock:
                    value = state.companion if time.monotonic() - state.companion_received < 15 else None
                self.reply(value or {'pet': {'state': 'unavailable'}, 'activity': {'state': 'offline', 'message': '电脑未连接'}})
            elif path.startswith('/pets/') and path[6:] in {p.name for p in (APP / 'pets').glob('*.png')}:
                self.body((APP / path[1:]).read_bytes(), 'image/png')
            elif path in ('/quota-refresh', '/cgi-bin/quota-refresh.sh'):
                with state.lock:
                    self.reply(dict(id=state.refresh_id, pending=any(v < state.refresh_id for v in state.refresh_done.values())))
            elif path == '/health':
                self.reply(dict(service='KindleDesk', computer=state.computer is not None,
                                quotaState=state.snapshot()['codex']['state'],
                                performanceError=state.performance_error, gpuError=state.gpu_error))
            elif path in ('/', '/index.html', '/style.css', '/app.js', '/model.js', '/pet.js', '/companion.js'):
                filename = 'index.html' if path == '/' else path[1:]
                mime = 'text/html' if filename.endswith('.html') else 'text/css' if filename.endswith('.css') else 'text/javascript'
                self.body((APP / filename).read_bytes(), mime + '; charset=utf-8')
            else:
                self.reply({'error': 'not_found'}, 404)

        def do_POST(self):
            if self.path in ('/quota-refresh', '/cgi-bin/quota-refresh.sh'):
                with state.lock:
                    if all(v >= state.refresh_id for v in state.refresh_done.values()):
                        state.refresh_id += 1
                    self.reply(dict(ok=True, id=state.refresh_id))
                return
            if self.path in ('/cgi-bin/refresh.sh', '/cgi-bin/exit.sh'):
                self.reply({'ok': True, 'simulated': True})
                return
            if self.path not in ('/quota', '/companion', '/refresh-done') or self.client_address[0] != '127.0.0.1':
                self.reply({'error': 'not_allowed'}, 403)
                return
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 65536:
                    raise ValueError('size')
                value = json.loads(self.rfile.read(size))
                if self.path == '/refresh-done':
                    if value.get('worker') not in ('current', 'other') or not isinstance(value.get('id'), int):
                        raise ValueError('refresh')
                    with state.lock:
                        state.refresh_done[value['worker']] = min(value['id'], state.refresh_id)
                    self.reply({'ok': True})
                    return
                if self.path == '/companion':
                    if not isinstance(value, dict) or not isinstance(value.get('pet'), dict) or not isinstance(value.get('activity'), dict):
                        raise ValueError('companion')
                    with state.lock:
                        state.companion = value
                        state.companion_received = time.monotonic()
                    self.reply({'ok': True})
                    return
                if not isinstance(value, dict) or value.get('state') not in ('ready', 'switching', 'loading', 'signed_out', 'error', 'unsupported'):
                    raise ValueError('state')
            except (ValueError, TypeError):
                self.reply({'error': 'invalid_quota'}, 400)
                return
            with state.lock:
                state.quota = value
                state.quota_received = time.monotonic()
            self.reply({'ok': True})
    return Handler


def serve(host, port):
    state, stop = State(), threading.Event()
    performance = Performance()
    server = ThreadingHTTPServer((host, port), make_handler(state))

    def sample():
        while not stop.wait(1 if state.computer is None else 15):
            try:
                value = performance.sample()
                with state.lock:
                    state.computer, state.performance_error = value, None
                    state.gpu_error = performance.gpu_error
            except OSError as error:
                with state.lock:
                    state.computer, state.performance_error = None, type(error).__name__

    def control():
        # The Windows service wrapper owns stdin; EOF also stops an orphaned child.
        sys.stdin.readline()
        stop.set()
        server.shutdown()

    threading.Thread(target=sample, daemon=True).start()
    threading.Thread(target=control, daemon=True).start()
    try:
        server.serve_forever(poll_interval=.25)
    finally:
        stop.set()
        server.server_close()


def wait_for_quota_refresh(port, worker, completed):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    base = 'http://127.0.0.1:%d' % port
    try:
        if completed:
            req = urllib.request.Request(base + '/refresh-done', data=json.dumps(dict(worker=worker, id=completed)).encode(), headers={'Content-Type': 'application/json'})
            with opener.open(req, timeout=3) as response:
                response.read()
        for _ in range(15):
            with opener.open(base + '/quota-refresh', timeout=3) as response:
                value = json.load(response)
            if value['id'] > completed:
                return value['id']
            time.sleep(1)
    except OSError as error:
        if sys.stderr:
            print('Refresh signal unavailable: ' + type(error).__name__, file=sys.stderr, flush=True)
        time.sleep(1)
    return completed


def companion_worker(port, rollout=None):
    from ccswitch_quota import OtherAccountReader
    from pet_selection import selection
    from pet_activity import ActivityReader
    other = OtherAccountReader()
    def read_other():
        refresh_id = 0
        while True:
            try:
                other.poll()
            except (OSError, ValueError, RuntimeError, KeyError) as error:
                other.value = dict(state='error', account=dict(key='cc-switch-other', label='另一个账号', plan=''), buckets=[])
                if sys.stderr:
                    print('Other account quota failed: ' + type(error).__name__, file=sys.stderr, flush=True)
            requested = wait_for_quota_refresh(port, 'other', refresh_id)
            if requested != refresh_id:
                other.next_fetch = 0
            refresh_id = requested
    threading.Thread(target=read_other, daemon=True).start()
    home = Path.home() / '.codex'
    activity = ActivityReader(rollout) if rollout else None
    manifest_path = APP / 'pets/manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    while True:
        value = dict(pet=selection(home, manifest), activity=activity.read() if activity else dict(state='unknown', message=''), otherAccount=other.value)
        req = urllib.request.Request('http://127.0.0.1:%d/companion' % port,
                                     data=json.dumps(value).encode(), headers={'Content-Type': 'application/json'})
        try:
            with opener.open(req, timeout=3) as response:
                response.read()
        except OSError as error:
            if sys.stderr:
                print('Companion publish failed: ' + type(error).__name__, file=sys.stderr, flush=True)
        time.sleep(3)


def quota_worker(codex, port, rollout=None):
    threading.Thread(target=companion_worker, args=(port, rollout), daemon=True).start()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def publish(value):
        req = urllib.request.Request('http://127.0.0.1:%d/quota' % port,
                                     data=json.dumps(value).encode(), headers={'Content-Type': 'application/json'})
        with opener.open(req, timeout=3) as response:
            response.read()

    reader = QuotaReader([codex, 'app-server', '--stdio'], publish)
    refresh_id = 0
    while True:
        try:
            reader.poll()
        except (OSError, RuntimeError, queue.Empty) as error:
            reader.current = None
            reader.value = empty_quota('error')
            try:
                publish(reader.value)
            except OSError:
                # SCM may be stopped or restarting; the normal next sampling tick reconnects.
                pass
            if sys.stderr:
                print('Quota read failed: ' + type(error).__name__, file=sys.stderr, flush=True)
        requested = wait_for_quota_refresh(port, 'current', refresh_id)
        if requested != refresh_id:
            reader.next_fetch = 0
        refresh_id = requested


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('serve', 'quota'))
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=18768)
    parser.add_argument('--codex', default=shutil.which('codex'))
    parser.add_argument('--rollout', type=Path, help='Optional Codex session JSONL; public messages only')
    args = parser.parse_args()
    if args.rollout and not args.rollout.is_file():
        parser.error('--rollout must be an existing JSONL file')
    if args.mode == 'serve':
        serve(args.host, args.port)
    elif not args.codex:
        parser.error('codex.exe was not found')
    else:
        quota_worker(args.codex, args.port, args.rollout)
