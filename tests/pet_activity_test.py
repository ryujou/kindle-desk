import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'pc'))
from pet_activity import ActivityReader


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


if __name__ == '__main__':
    unittest.main()
