"""Unit tests: python3 -m unittest discover -s tools/browser-qa -v"""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import browser_qa as qa


class InputTests(unittest.TestCase):
    def test_keys(self):
        self.assertEqual(qa.key_info("KeyW"), ("w", 87))
        self.assertEqual(qa.key_info("Digit3"), ("3", 51))
        self.assertEqual(qa.key_info("ShiftLeft"), ("Shift", 16))
        self.assertEqual(qa.key_info("Space"), (" ", 32))
        with self.assertRaises(qa.QaError):
            qa.key_info("unknown")

    def test_mobile(self):
        self.assertEqual(qa.parse_mobile("390x844"), (390, 844))
        self.assertEqual(qa.parse_mobile("800X600"), (800, 600))
        self.assertIsNone(qa.parse_mobile(None))
        for invalid in ("foo", "10x20", "390", "10000x300"):
            with self.subTest(invalid=invalid), self.assertRaises(qa.QaError):
                qa.parse_mobile(invalid)

    def test_safe_session_name(self):
        self.assertEqual(qa.own_path("qa_01").name, "qa_01")
        for invalid in ("../qa", ".hidden", "a/b", "a b", "A" * 70):
            with self.subTest(invalid=invalid), self.assertRaises(qa.QaError):
                qa.own_path(invalid)

    def test_local_url(self):
        self.assertEqual(qa.local_url("index_debug.html?type=new", 1111),
                         "http://127.0.0.1:1111/index_debug.html?type=new")
        self.assertEqual(qa.local_url("http://example.invalid", 1111),
                         "http://example.invalid")
        self.assertEqual(qa.local_url("data:text/html,ok", 1111), "data:text/html,ok")

    def test_only_owned_process_may_be_killed(self):
        with patch.object(qa, "owned_pid", return_value=False):
            with patch.object(qa.os, "killpg") as kill:
                self.assertFalse(qa.stop_pid(123, "test-profile"))
                kill.assert_not_called()

    def test_session_marker_required(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(qa.QaError):
                qa.read_session(Path(directory))
            (Path(directory) / ".browser-qa-owned").touch()
            qa.write_json(Path(directory) / "session.json", {"pages": {}})
            self.assertEqual(qa.read_session(Path(directory)), {"pages": {}})


class FakeWS:
    def __init__(self, messages):
        self.messages = list(messages)
        self.sent = []

    def send(self, message):
        self.sent.append(json.loads(message))

    def recv(self, timeout):
        if not self.messages:
            raise TimeoutError
        return json.dumps(self.messages.pop(0))


class ProtocolTests(unittest.TestCase):
    def fake_cdp(self, messages):
        client = qa.CDP.__new__(qa.CDP)
        client.ws = FakeWS(messages)
        client.id = 0
        client.sessions = {}
        return client

    def test_discards_unsolicited_events(self):
        client = self.fake_cdp([
            {"method": "Page.loadEventFired", "params": {"timestamp": 7}},
            {"id": 1, "result": {"ok": True}},
        ])
        self.assertEqual(client.call("Test.ping"), {"ok": True})
        self.assertEqual(client.ws.sent[0]["method"], "Test.ping")

    def test_cdp_reports_protocol_error(self):
        client = self.fake_cdp([{"id": 1, "error": {"message": "denied"}}])
        with self.assertRaisesRegex(qa.QaError, "denied"):
            client.call("Page.navigate")

    def test_eval_reports_page_exception(self):
        client = self.fake_cdp([{
            "id": 1, "result": {"exceptionDetails": {
                "text": "Uncaught", "exception": {"description": "ReferenceError: missing"}
            }}
        }])
        client.sessions["page"] = "session"
        with self.assertRaisesRegex(qa.QaError, "ReferenceError"):
            client.evaluate("page", "missing()")

    def test_eval_returns_serialized_value(self):
        client = self.fake_cdp([{"id": 1, "result": {
            "result": {"type": "object", "value": {"fps": 60}}
        }}])
        client.sessions["page"] = "session"
        self.assertEqual(client.evaluate("page", "({fps:60})"), {"fps": 60})

    def test_key_event(self):
        client = self.fake_cdp([{"id": 1, "result": {}}])
        client.sessions["page"] = "session"
        client.key("page", "KeyD", True)
        request = client.ws.sent[0]
        self.assertEqual(request["method"], "Input.dispatchKeyEvent")
        self.assertEqual(request["params"]["code"], "KeyD")
        self.assertEqual(request["params"]["windowsVirtualKeyCode"], 68)
        self.assertEqual(request["sessionId"], "session")


if __name__ == "__main__":
    unittest.main()
