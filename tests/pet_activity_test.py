import json
import sys
import tempfile
import unittest
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


if __name__ == '__main__':
    unittest.main()
