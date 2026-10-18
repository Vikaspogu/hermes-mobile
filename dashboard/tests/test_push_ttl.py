import os
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import push_common  # noqa: E402


class PushTtlTest(unittest.TestCase):
    def test_push_is_queued_for_sleeping_devices(self) -> None:
        send = mock.Mock()
        fake = types.SimpleNamespace(webpush=send)
        with mock.patch.dict(sys.modules, {"pywebpush": fake}), mock.patch.dict(
            os.environ, {"HERMES_PWA_VAPID_PRIVATE_KEY": "k"}
        ):
            push_common.send_web_push_record({"endpoint": "https://push.example/x", "keys": {"p256dh": "a", "auth": "b"}}, {})
        self.assertGreater(send.call_args.kwargs["ttl"], 0)


if __name__ == "__main__":
    unittest.main()
