"""Account-race and HTTP tests without changing any real login."""
import importlib.util
import json
from pathlib import Path
import threading
import time
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

spec = importlib.util.spec_from_file_location('collector', Path(__file__).resolve().parents[1] / 'pc/collector.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


def account(plan):
    return {'type': 'chatgpt', 'email': plan + '@example.test', 'planType': plan}


def limits(plan):
    return {'rateLimitsByLimitId': {'codex': {'planType': plan, 'primary':
        {'usedPercent': 42, 'windowDurationMins': 10080, 'resetsAt': int(time.time()) + 800}, 'secondary': None}}}


class FakeRpc:
    def __init__(self, owner):
        self.owner = owner
        self.changed = False
    def __enter__(self): return self
    def __exit__(self, *_): pass
    def call(self, method, params=None):
        if method == 'account/read':
            return {'account': account(self.owner.plan) if self.owner.plan else None}
        result = limits(self.owner.plan)
        if self.owner.switch_during_fetch:
            self.owner.plan = 'pro'
        if self.owner.fail_fetch:
            raise RuntimeError('simulated failure')
        return result


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.plan = 'plus'
        self.switch_during_fetch = self.fail_fetch = False
        self.sent = []
        self.reader = c.QuotaReader([], lambda x: self.sent.append(x), lambda _: FakeRpc(self))

    def test_plus_pro_signout(self):
        self.reader.poll()
        plus = self.sent[-1]
        self.assertEqual(plus['account']['plan'], 'plus')
        self.assertNotIn('email', json.dumps(plus))
        self.plan = 'pro'
        self.reader.poll()
        self.assertEqual(self.sent[-2]['state'], 'switching')
        self.assertEqual(self.sent[-2]['buckets'], [])
        pro = self.sent[-1]
        self.assertNotEqual(plus['account']['key'], pro['account']['key'])
        self.assertEqual(pro['quotaAccountKey'], pro['account']['key'])
        self.plan = None
        self.reader.poll()
        self.assertEqual(self.sent[-1]['state'], 'signed_out')
        self.assertIsNone(self.sent[-1]['account'])

    def test_switch_during_network_discards_old_response(self):
        self.switch_during_fetch = True
        self.reader.poll()
        self.assertEqual(self.sent[-1]['state'], 'switching')
        self.assertEqual(self.sent[-1]['buckets'], [])

    def test_multiple_buckets_keep_actual_windows(self):
        data = limits('pro')
        data['rateLimitsByLimitId']['extra'] = {'limitName': 'Extra', 'primary': {'usedPercent': 2, 'windowDurationMins': 60, 'resetsAt': 123}}
        values = c.buckets(data)
        self.assertEqual(len(values), 2)
        self.assertEqual(values[0]['primary']['windowDurationMins'], 10080)
        self.assertIsNone(values[0]['secondary'])

    def test_worker_heartbeat_expiry(self):
        state = c.State()
        state.quota = {'state': 'ready'}
        state.quota_received = time.monotonic() - 46
        self.assertEqual(state.snapshot()['codex']['state'], 'error')

    def test_combined_companion_heartbeat(self):
        state = c.State()
        value = {'pet': {'state': 'ready'}, 'activity': {'state': 'running'}}
        state.companion = value
        state.companion_received = time.monotonic()
        self.assertEqual(state.snapshot()['companion'], value)
        self.assertNotIn('computer', state.snapshot(include_panel=False))
        self.assertNotIn('codex', state.snapshot(include_panel=False))
        state.companion_received -= 16
        self.assertEqual(state.snapshot()['companion']['activity']['state'], 'offline')

    def test_http_snapshot_static_and_local_bridge(self):
        state = c.State()
        server = ThreadingHTTPServer(('127.0.0.1', 0), c.make_handler(state))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = 'http://127.0.0.1:' + str(server.server_port)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            self.reader.publish = lambda value: opener.open(urllib.request.Request(base + '/quota', data=json.dumps(value).encode())).close()
            self.reader.poll()
            with opener.open(base + '/cgi-bin/snapshot.sh') as response:
                value = json.load(response)
            self.assertEqual(value['codex']['account']['plan'], 'plus')
            self.assertFalse(value['demo'])
            companion = {'pet': {'state': 'off'}, 'activity': {'state': 'idle'}}
            with opener.open(urllib.request.Request(base + '/companion', data=json.dumps(companion).encode())) as response:
                self.assertTrue(json.load(response)['ok'])
            with opener.open(base + '/snapshot') as response:
                self.assertEqual(json.load(response)['companion'], companion)
            with opener.open(base + '/snapshot?panel=0&t=123') as response:
                partial = json.load(response)
            self.assertEqual(partial['companion'], companion)
            self.assertNotIn('computer', partial)
            self.assertNotIn('codex', partial)
            with opener.open(base + '/') as response:
                self.assertIn(b'model.js', response.read())
            with opener.open(urllib.request.Request(base + '/cgi-bin/refresh.sh', data=b'')) as response:
                self.assertTrue(json.load(response)['simulated'])
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
