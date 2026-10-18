"""/cron-runs: silent cron runs are dropped server-side so they can't push real runs out of the list."""

import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import plugin_api as m  # noqa: E402


class CronRunsTest(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp())
        (self.home / "cron").mkdir()
        (self.home / "cron" / "jobs.json").write_text(json.dumps({"jobs": [{"id": "abc", "name": "morning"}]}))
        c = sqlite3.connect(self.home / "state.db")
        c.execute("create table sessions(id text, title text, started_at real, source text)")
        c.execute("create table messages(id integer primary key, session_id text, role text, content text)")
        for i in range(5):  # odd runs are [SILENT]
            sid = f"cron_abc_2026101{i}_080000"
            c.execute("insert into sessions values(?,?,?,?)", (sid, None, 100 + i, "cron"))
            text = "[SILENT] nothing" if i % 2 else f"real {i}"
            c.execute("insert into messages(session_id,role,content) values(?,?,?)", (sid, "assistant", text))
        c.execute("insert into sessions values('tui1','t',999,'tui')")
        c.commit()
        c.close()
        self._orig = m._profile_home
        m._profile_home = lambda _p: self.home

    def tearDown(self):
        m._profile_home = self._orig

    def ids(self, **kw):
        args = {"profile": "default", "limit": 50, "before": None, "include_silent": False, "job_id": None, **kw}
        return [r["session_id"] for r in m._cron_runs(**args)["runs"]]

    def test_drops_silent_newest_first(self):
        res = m._cron_runs("default", 50, None, False, None)
        self.assertEqual([r["session_id"] for r in res["runs"]],
                         ["cron_abc_20261014_080000", "cron_abc_20261012_080000", "cron_abc_20261010_080000"])
        self.assertEqual(res["runs"][0]["job_name"], "morning")
        self.assertIsNone(res["next_cursor"])

    def test_include_silent(self):
        self.assertEqual(len(self.ids(include_silent=True)), 5)

    def test_cursor_paging(self):
        res = m._cron_runs("default", 1, None, False, None)
        self.assertEqual(res["next_cursor"], 104)
        self.assertEqual(self.ids(before=104)[0], "cron_abc_20261012_080000")

    def test_job_filter(self):
        self.assertEqual(self.ids(job_id="zzz"), [])
        self.assertEqual(len(self.ids(job_id="abc")), 3)


if __name__ == "__main__":
    unittest.main()
