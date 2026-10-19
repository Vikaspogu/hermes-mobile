"""Mount regression: protected plugin routes must require auth, not a `request` query param.

_require_dashboard_auth's `request` parameter was missing its `Request` annotation,
so FastAPI read it as a required query parameter and every protected route answered
422 ({"loc": ["query", "request"]}) — this is why the dashboard Mobile tab showed
"Diagnostics failed" after the mount fix in PR #5.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import plugin_api as m  # noqa: E402


class PluginApiMountTest(unittest.TestCase):
    def test_diagnostics_requires_auth_not_request_query_param(self):
        app = FastAPI()
        app.include_router(m.router, prefix="/api/plugins/hermes-pwa")
        resp = TestClient(app).get("/api/plugins/hermes-pwa/diagnostics")
        self.assertEqual(resp.status_code, 401, resp.text)


if __name__ == "__main__":
    unittest.main()
