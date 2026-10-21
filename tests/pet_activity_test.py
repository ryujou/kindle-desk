import json
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'pc'))
from pet_activity import ActivityReader, LatestActivityReader


class ActivityTest(unittest.TestCase):
    def test_public_messages_and_async_question_lifecycle(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'rollout.jsonl'
            path.touch()
            reader = ActivityReader(path)

            def append(kind, payload):
                with path.open('a', encoding='utf-8') as stream:
                    stream.write(json.dumps(dict(type=kind, payload=payload)) + '\n')

            append('event_msg', dict(type='task_started'))
            append('response_item', dict(type='reasoning', content='DO NOT DISPLAY'))
            append('response_item', dict(type='message', role='assistant', phase='commentary',
                                         content=[dict(type='output_text', text='正在测试动画')]))
            self.assertEqual(reader.read()['message'], '正在测试动画')
            append('response_item', dict(type='function_call',name='functions.request_user_input_async',
                  call_id='question-1',arguments=json.dumps(dict(questions=[dict(title='选择哪个布局？')]))))
            append('response_item', dict(type='function_call_output',call_id='question-1',output='submitted'))
            append('event_msg', dict(type='task_complete'))
            self.assertEqual(reader.read()['state'], 'waiting')
            self.assertEqual(reader.read()['message'], '选择哪个布局？')
            append('response_item', dict(type='message',role='user',content=[dict(type='input_text',
                  text='<send_user_message_question_reply>question-1</send_user_message_question_reply>')]))
            self.assertEqual(reader.read()['state'], 'review')
            self.assertEqual(reader.read()['message'], '正在测试动画')

    def test_partial_line_is_read_only_after_completion(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'rollout.jsonl'
            path.write_text('{"type":"event_msg",', encoding='utf-8')
            reader = ActivityReader(path)
            self.assertEqual(reader.read()['state'], 'unknown')
            with path.open('a', encoding='utf-8') as stream:
                stream.write('"payload":{"type":"task_complete"}}\n')
            self.assertEqual(reader.read()['state'], 'review')

    def test_compaction_follows_same_thread_and_recovers_from_abort(self):
        with tempfile.TemporaryDirectory() as directory:
            thread = '01234567-1234-1234-1234-123456789abc'
            path = Path(directory) / ('rollout-2026-10-19T12-00-00-' + thread + '.jsonl')
            path.write_text(json.dumps(dict(type='event_msg', payload=dict(type='turn_aborted'))) + '\n', encoding='utf-8')
            reader = ActivityReader(path)
            self.assertEqual(reader.read()['state'], 'idle')
            continuation = Path(directory) / ('rollout-2026-10-19T19-00-00-' + thread + '_continued.jsonl')
            records = [dict(type='event_msg', timestamp=datetime.now(timezone.utc).isoformat(),
                            payload=dict(type='task_started')),
                       dict(type='response_item', payload=dict(type='message', role='assistant',
                            phase='commentary', content=[dict(type='output_text', text='正在检查设备状态')]))]
            continuation.write_text(''.join(json.dumps(r) + '\n' for r in records), encoding='utf-8')
            unrelated = Path(directory) / 'rollout-2026-10-20T01-00-00-other.jsonl'
            unrelated.write_text('{}\n', encoding='utf-8')
            self.assertEqual(reader.read()['state'], 'running')
            self.assertEqual(reader.read()['message'], '正在检查设备状态')
            self.assertEqual(reader.path, continuation)

    def test_two_compactions_across_midnight_and_reader_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            thread = '01234567-1234-1234-1234-123456789abc'
            paths = [Path(directory) / ('rollout-' + stamp + '-' + thread + suffix + '.jsonl')
                     for stamp, suffix in [('2026-10-19T12-00-00', ''),
                                           ('2026-10-19T23-59-00', '_first'),
                                           ('2026-10-20T00-01-00', '_first_second')]]
            reader = ActivityReader(paths[0])
            for index, path in enumerate(paths):
                records = [dict(type='event_msg', timestamp=datetime.now(timezone.utc).isoformat(),
                                payload=dict(type='task_started')),
                           dict(type='response_item', payload=dict(type='message', role='assistant',
                                phase='commentary', content=[dict(type='output_text', text=f'进度 {index}')]))]
                path.write_text(''.join(json.dumps(r) + '\n' for r in records), encoding='utf-8')
                value = reader.read()
                self.assertEqual((value['state'], value['message']), ('running', f'进度 {index}'))
                self.assertEqual(reader.path, path)
            restarted = ActivityReader(paths[0])
            self.assertEqual(restarted.read()['message'], '进度 2')
            self.assertEqual(restarted.path, paths[-1])
            with paths[-1].open('a', encoding='utf-8') as stream:
                stream.write(json.dumps(dict(type='event_msg', payload=dict(type='task_complete'))) + '\n')
            self.assertEqual(reader.read()['state'], 'review')

    def test_failed_and_aborted_tasks_recover_on_next_turn(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'rollout.jsonl'
            path.touch()
            reader = ActivityReader(path)

            def event(kind):
                with path.open('a', encoding='utf-8') as stream:
                    stream.write(json.dumps(dict(type='event_msg',
                        timestamp=datetime.now(timezone.utc).isoformat(), payload=dict(type=kind))) + '\n')
                return reader.read()['state']

            self.assertEqual(event('task_failed'), 'failed')
            self.assertEqual(event('task_started'), 'running')
            self.assertEqual(event('turn_aborted'), 'idle')
            self.assertEqual(event('turn_started'), 'running')
            self.assertEqual(event('turn_complete'), 'review')


class LatestActivityTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.database = self.root / 'state_5.sqlite'
        self.connection = sqlite3.connect(self.database)
        self.addCleanup(self.connection.close)
        self.connection.execute("""CREATE TABLE threads (
            id TEXT PRIMARY KEY, rollout_path TEXT, archived INTEGER,
            thread_source TEXT, agent_path TEXT, source TEXT,
            recency_at_ms INTEGER, created_at_ms INTEGER, updated_at_ms INTEGER, title TEXT)""")
        self.reader = LatestActivityReader(self.database)

    def add_thread(self, name, recency, message='', **fields):
        path = self.root / (name + '.jsonl')
        path.touch()
        self.append(path, 'event_msg', dict(type='task_started'))
        if message:
            self.append(path, 'response_item', dict(type='message', role='assistant',
                        phase='commentary', content=[dict(type='output_text', text=message)]))
        self.connection.execute('INSERT INTO threads VALUES (?,?,?,?,?,?,?,?,?,?)', (
            name, str(path), fields.get('archived', 0), fields.get('thread_source', 'user'),
            fields.get('agent_path'), fields.get('source', 'vscode'), recency, recency, recency, fields.get('title', name)))
        self.connection.commit()
        return path

    def test_current_conversation_title(self):
        self.add_thread('named', 100, '公开进度', title='天气详情实现')
        self.assertEqual(self.reader.read()['title'], '天气详情实现')

    def append(self, path, kind, payload):
        with path.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(dict(type=kind, timestamp=datetime.now(timezone.utc).isoformat(),
                                         payload=payload)) + '\n')

    def test_new_conversation_switches_without_reader_restart(self):
        self.add_thread('first', 1, '旧任务')
        self.assertEqual(self.reader.read()['message'], '旧任务')
        self.add_thread('second', 2, '新会话公开进度')
        self.assertEqual(self.reader.read()['message'], '新会话公开进度')
        self.assertEqual(self.reader.read()['state'], 'running')

    def test_resume_old_thread_wins_but_background_output_does_not(self):
        old = self.add_thread('first', 1, '旧任务')
        self.add_thread('second', 2, '新任务')
        self.append(old, 'response_item', dict(type='message', role='assistant',
                    phase='final', content=[dict(type='output_text', text='旧任务后台完成')]))
        self.connection.execute("UPDATE threads SET updated_at_ms=99 WHERE id='first'")
        self.connection.commit()
        self.assertEqual(self.reader.read()['message'], '新任务')
        self.connection.execute("UPDATE threads SET recency_at_ms=100 WHERE id='first'")
        self.connection.commit()
        self.assertEqual(self.reader.read()['message'], '旧任务后台完成')

    def test_subagent_archived_and_background_threads_do_not_take_over(self):
        self.add_thread('main', 1, '主会话')
        self.add_thread('child', 2, '子代理', thread_source='subagent', agent_path='/root/child')
        self.add_thread('archived', 3, '已归档', archived=1)
        self.add_thread('background', 4, '后台任务', source='exec')
        self.assertEqual(self.reader.read()['message'], '主会话')

    def test_new_thread_clears_old_question_and_does_not_expose_private_records(self):
        old = self.add_thread('first', 1)
        self.append(old, 'response_item', dict(type='function_call',
                    name='functions.request_user_input_async', call_id='old-question',
                    arguments=json.dumps(dict(questions=[dict(title='旧会话问题')]))))
        self.assertEqual(self.reader.read()['state'], 'waiting')
        new = self.add_thread('second', 2)
        for payload in [
            dict(type='reasoning', content='SECRET REASONING'),
            dict(type='function_call_output', output='SECRET TOOL OUTPUT'),
            dict(type='message', role='user', content=[dict(type='input_text', text='PRIVATE USER TEXT')]),
        ]:
            self.append(new, 'response_item', payload)
        self.assertEqual(self.reader.read()['state'], 'running')
        self.assertEqual(self.reader.read()['message'], '')
        self.append(new, 'response_item', dict(type='message', role='assistant',
                    phase='commentary', content=[dict(type='output_text', text='只显示公开进度')]))
        self.assertEqual(self.reader.read()['message'], '只显示公开进度')

    def test_empty_index_and_missing_rollout_do_not_reuse_old_message(self):
        self.assertEqual(self.reader.read()['message'], '')
        self.add_thread('first', 1, '旧任务')
        self.reader.read()
        missing = self.add_thread('second', 2)
        missing.unlink()
        with self.assertRaises(FileNotFoundError):
            self.reader.read()
        missing.touch()
        self.assertEqual(self.reader.read()['message'], '')
        self.connection.execute('DELETE FROM threads')
        self.connection.commit()
        self.assertEqual(self.reader.read()['state'], 'unknown')

    def test_database_is_read_only_and_missing_database_is_not_created(self):
        missing = self.root / 'absent.sqlite'
        with self.assertRaises(sqlite3.OperationalError):
            LatestActivityReader(missing).read()
        self.assertFalse(missing.exists())
        self.add_thread('main', 1, '公开进度')
        before = list(self.connection.iterdump())
        self.reader.read()
        self.assertEqual(list(self.connection.iterdump()), before)

    def test_compaction_continues_without_restarting_selected_reader(self):
        thread = '01234567-1234-1234-1234-123456789abc'
        self.add_thread('rollout-2026-10-19T12-00-00-' + thread, 1, '压缩前')
        self.reader.read()
        reader = self.reader.reader
        continuation = self.root / ('rollout-2026-10-20T00-01-00-' + thread + '.jsonl')
        self.append(continuation, 'response_item', dict(type='message', role='assistant',
                    phase='commentary', content=[dict(type='output_text', text='压缩后')]))
        self.assertEqual(self.reader.read()['message'], '压缩后')
        self.assertEqual(self.reader.read()['message'], '压缩后')
        self.assertIs(self.reader.reader, reader)
        self.assertEqual(reader.path, continuation)


if __name__ == '__main__':
    unittest.main()
