"""Read the other CC Switch OAuth account's quota without changing the active login."""
import base64
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path


def claims(token):
    part = token.split('.')[1]
    return json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)))


class OtherAccountReader:
    def __init__(self):
        self.path = Path.home() / '.cc-switch/codex_oauth_auth.json'
        self.current = None
        self.token = None
        self.expires = 0
        self.next_fetch = 0
        self.value = None

    def poll(self):
        if not self.path.exists():
            self.value = None
            return
        saved = json.loads(self.path.read_text(encoding='utf-8'))
        live = json.loads((Path.home() / '.codex/auth.json').read_text(encoding='utf-8'))
        current = live.get('tokens', {}).get('account_id')
        candidates = [(key, a) for key, a in saved['accounts'].items()
                      if a.get('chatgpt_account_id', a['account_id']) != current]
        if not current or len(candidates) != 1:
            self.value = None
            return
        key, account = candidates[0]
        if key != self.current:
            self.current, self.token, self.expires, self.next_fetch = key, None, 0, 0
            self.value = dict(state='loading', account=dict(key='cc-switch-other', label='另一个账号', plan=''), buckets=[])
        if time.time() < self.next_fetch:
            return
        self.next_fetch = time.time() + 300
        try:
            if not self.token or time.time() > self.expires - 60:
                form = urllib.parse.urlencode(dict(grant_type='refresh_token', refresh_token=account['refresh_token'],
                    client_id='app_EMoamEEZ73f0CkXaXp7hrann', scope='openid profile email')).encode()
                request = urllib.request.Request('https://auth.openai.com/oauth/token', data=form,
                    headers={'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'cc-switch-codex-oauth'})
                with urllib.request.urlopen(request, timeout=15) as response:
                    tokens = json.load(response)
                # OAuth may rotate the refresh token. Preserve CC Switch's latest other fields.
                latest = json.loads(self.path.read_text(encoding='utf-8'))
                if latest['accounts'][key]['refresh_token'] != account['refresh_token']:
                    raise RuntimeError('CC Switch account changed during refresh')
                for field in ('refresh_token', 'id_token'):
                    if tokens.get(field):
                        latest['accounts'][key][field] = tokens[field]
                latest['accounts'][key]['token_updated_at_ms'] = int(time.time() * 1000)
                self.path.write_text(json.dumps(latest, ensure_ascii=False, indent=2), encoding='utf-8')
                self.token = tokens['access_token']
                self.expires = time.time() + tokens.get('expires_in', 3600)
            account_id = account.get('chatgpt_account_id', account['account_id'])
            token_account = claims(self.token).get('https://api.openai.com/auth', {}).get('chatgpt_account_id')
            if token_account != account_id:
                raise RuntimeError('Quota account mismatch')
            request = urllib.request.Request('https://chatgpt.com/backend-api/wham/usage',
                headers={'Authorization': 'Bearer ' + self.token, 'ChatGPT-Account-Id': account_id, 'User-Agent': 'codex-cli'})
            with urllib.request.urlopen(request, timeout=15) as response:
                data = json.load(response)
            def window(value):
                if not value:
                    return None
                return dict(usedPercent=value.get('used_percent'),
                    windowDurationMins=value['limit_window_seconds'] // 60 if value.get('limit_window_seconds') else None,
                    resetsAt=value.get('reset_at'))
            limit = data.get('rate_limit') or {}
            plan = data.get('plan_type') or claims(self.token).get('https://api.openai.com/auth', {}).get('chatgpt_plan_type', '')
            self.value = dict(state='ready', account=dict(key='cc-switch-other', label='另一个账号', plan=plan),
                quotaAccountKey='cc-switch-other', fetchedAt=int(time.time()),
                buckets=[dict(id='codex', label='Codex', primary=window(limit.get('primary_window')), secondary=window(limit.get('secondary_window')))])
        except (OSError, ValueError, RuntimeError, KeyError):
            self.value = dict(state='error', account=dict(key='cc-switch-other', label='另一个账号', plan=''), buckets=[])
            raise
