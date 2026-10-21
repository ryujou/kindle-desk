"""Read public Codex rollout activity; never forward reasoning or tool output."""
import json
import re
import sqlite3
import time
from datetime import datetime
from pathlib import Path


class LatestActivityReader:
    """Follow the user's most recently started/resumed main conversation."""
    def __init__(self, database):
        self.database = Path(database)
        self.selected_path = None
        self.reader = None

    def read(self):
        connection = sqlite3.connect(self.database.resolve().as_uri() + '?mode=ro', uri=True)
        try:
            row = connection.execute("""
                SELECT rollout_path, title FROM threads
                WHERE archived = 0 AND thread_source = 'user'
                    AND agent_path IS NULL AND source IN ('vscode', 'cli')
                ORDER BY recency_at_ms DESC, created_at_ms DESC, id DESC
                LIMIT 1
            """).fetchone()
        finally:
            connection.close()
        path = Path(row[0]) if row else None
        if path != self.selected_path:
            self.selected_path = path
            self.reader = ActivityReader(path) if path else None
        if self.reader is None:
            return dict(state='unknown', title='当前 Codex 任务', message='',
                        sampledAt=int(time.time()), eventAt=0, source='local-rollout')
        value = self.reader.read()
        value['title'] = row[1] or '当前 Codex 任务'
        return value


class ActivityReader:
    def __init__(self, path):
        self.path = Path(path)
        self.offset = 0
        self.state = 'unknown'
        self.message = ''
        self.pending = {}
        self.updated = 0

    def consume(self, record):
        value = record.get('payload', {})
        kind = value.get('type')
        stamp = record.get('timestamp')
        if stamp:
            self.updated = datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp()
        if record.get('type') == 'event_msg':
            if kind in ('task_started', 'turn_started'):
                self.state = 'running'
                self.message = ''
            elif kind in ('task_complete', 'turn_complete'):
                self.state = 'review'
            elif kind == 'turn_aborted':
                self.state = 'idle'
                self.message = ''
                self.pending.clear()
            elif kind == 'task_failed':
                self.state = 'failed'
            return
        if record.get('type') != 'response_item':
            return
        if kind == 'message':
            content = '\n'.join(c.get('text', '') for c in value.get('content', [])
                                if c.get('type') in ('output_text', 'input_text', 'text'))
            if value.get('role') == 'assistant' and value.get('phase', value.get('channel')) in ('commentary', 'final_answer', 'final'):
                self.message = content.strip()
            elif value.get('role') == 'user':
                # Structured async replies identify questions; acknowledgement tools do not.
                if '<send_user_message_question_reply>' in content:
                    for key in list(self.pending):
                        if key in content:
                            del self.pending[key]
                elif '<hook_prompt' not in content and '<environment_context>' not in content:
                    self.pending.clear()
        elif kind == 'function_call' and value.get('name', '').split('.')[-1] in ('request_user_input', 'request_user_input_async'):
            try:
                args = json.loads(value.get('arguments', '{}'))
            except ValueError:
                return
            questions = args.get('questions', [])
            if questions:
                self.pending[value['call_id']] = {
                    'text': '\n'.join(q.get('title') or q.get('question', '') for q in questions),
                    'async': value['name'].endswith('_async')}
        elif kind == 'function_call_output':
            key = value.get('call_id')
            if key in self.pending and not self.pending[key]['async']:
                del self.pending[key]

    def read(self):
        # Compaction continues the same thread in a new rollout file.
        thread = re.search(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', self.path.name)
        if thread:
            latest = max(self.path.parent.glob('*' + thread.group() + '*.jsonl'),
                         key=lambda path: path.name, default=self.path)
            if latest.name > self.path.name:
                self.__init__(latest)
        with self.path.open('rb') as stream:
            stream.seek(self.offset)
            while True:
                start = stream.tell()
                line = stream.readline()
                if not line or not line.endswith(b'\n'):
                    self.offset = start
                    break
                self.offset = stream.tell()
                self.consume(json.loads(line))
        state = 'waiting' if self.pending else self.state
        if time.time() - self.updated > 300 and state == 'running':
            state = 'unknown'
        question = next(iter(self.pending.values()), {}).get('text', '')
        return dict(state=state, title='当前 Codex 任务', message=question or self.message,
                    sampledAt=int(time.time()), eventAt=self.updated, source='local-rollout')
