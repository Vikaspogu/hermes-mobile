import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]


def _load_plugin():
    spec = importlib.util.spec_from_file_location(
        "hermes_pwa_plugin", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)]
    )
    assert spec is not None and spec.loader is not None
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["hermes_pwa_plugin"] = module
    spec.loader.exec_module(module)
    return module


plugin = _load_plugin()


class ApprovalSurfaceTest(unittest.TestCase):
    def _fire(self, **kwargs):
        with mock.patch.object(plugin, "claim_push_dedupe", return_value=True), mock.patch.object(
            plugin, "record_pending_approval"
        ) as record, mock.patch.object(plugin, "send_web_push_to_enabled", return_value=1) as send:
            plugin._on_pre_approval_request(**kwargs)
        return record, send

    def test_telegram_session_approval_reaches_pwa(self) -> None:
        record, send = self._fire(
            surface="gateway", session_key="agent:main:telegram:dm:1", command="rm -rf x", description="d"
        )
        record.assert_called_once()
        send.assert_called_once()

    def test_cli_approval_is_still_ignored(self) -> None:
        record, send = self._fire(surface="cli", session_key="s1", command="rm -rf x", description="d")
        record.assert_not_called()
        send.assert_not_called()


if __name__ == "__main__":
    unittest.main()
