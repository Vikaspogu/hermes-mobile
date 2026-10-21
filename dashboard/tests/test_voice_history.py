"""voice_history — persist + resume unit checks (real sqlite, temp home)."""

from __future__ import annotations

import sqlite3
import sys

from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import voice_history  # noqa: E402

SCHEMA = """
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, started_at REAL NOT NULL,
  ended_at REAL, end_reason TEXT, message_count INTEGER DEFAULT 0, title TEXT
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
  role TEXT NOT NULL, content TEXT, timestamp REAL NOT NULL
);
"""

CALL = {
    "callId": "abcd1234-5678-90ef-ghij-klmnopqrstuv",
    "profile": "my-bot",
    "startedAt": 1710000000.0,
    "endedAt": 1710000100.0,
    "messages": [
        {"who": "user", "text": "qué tiempo hace hoy?", "at": 1710000001.0},
        {"who": "bot", "text": "Soleado, 22°C.", "at": 1710000005.0},  # client sends 'bot', not 'assistant' 
        {"who": "system", "text": "debe ignorarse", "at": 1710000003.0},
    ],
}


def _make_state_db(home: Path, profile: str = "my-bot") -> Path:
    prof = home / ".hermes" / "profiles" / profile
    prof.mkdir(parents=True)
    db = prof / "state.db"
    conn = sqlite3.connect(db)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()
    return db


def _fake_http(status: int, detail: str):
    class E(Exception):
        def __init__(self, *args: object, **kwargs: object) -> None:
            self.status_code = status
            self.detail = detail
            super().__init__(detail)
    return E


def demo() -> None:
    import tempfile

    tmp = Path(tempfile.mkdtemp())
    voice_history._PROFILES_ROOT = tmp / ".hermes" / "profiles"
    voice_history._REGISTRY_PATH = tmp / "voice_threads.json"
    db = _make_state_db(tmp)
    voice_history.HTTPException = _fake_http(400, "test")

    # 1. save_call inserta session + 2 mensajes válidos (ignora 'system')
    res = voice_history.save_call(dict(CALL))
    assert res == {"ok": True, "sessionId": "voice-abcd1234-5678-90ef-ghij-klmnopqrstuv", "inserted": 2, "saved": True}, res
    conn = sqlite3.connect(db)
    rows = conn.execute("SELECT id, source, message_count, title FROM sessions").fetchall()
    assert rows == [("voice-abcd1234-5678-90ef-ghij-klmnopqrstuv", "voice", 2, "qué tiempo hace hoy?")], rows
    msgs = conn.execute("SELECT role, content FROM messages ORDER BY id").fetchall()
    assert msgs == [("user", "qué tiempo hace hoy?"), ("assistant", "Soleado, 22°C.")], msgs
    conn.close()

    # 2. idempotencia por callId: re-save no duplica
    res2 = voice_history.save_call(dict(CALL))
    assert res2["inserted"] == 0 and res2["saved"] is True, res2
    conn = sqlite3.connect(db)
    n = conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
    assert n == 2, n
    conn.close()

    # 3. título duplicado → sufijo (2)
    call2 = dict(CALL)
    call2["callId"] = "zzzz1234-5678-90ef-ghij-klmnopqrstuv"
    voice_history.save_call(call2)
    conn = sqlite3.connect(db)
    titles = sorted(r[0] for r in conn.execute("SELECT title FROM sessions"))
    assert titles == ["qué tiempo hace hoy?", "qué tiempo hace hoy? (2)"], titles
    conn.close()

    # 4. callId inválido → 400
    bad = dict(CALL)
    bad["callId"] = "../escape"
    try:
        voice_history.save_call(bad)
        raise AssertionError("debió rechazar callId inválido")
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 400, exc

    # 5. remember_thread + registry roundtrip
    voice_history.remember_thread("my-bot", "thread_abc", "voice-abcd1234", "es", "gpt-5.1-codex", started_at=123.0)
    reg = voice_history._load_registry()
    assert reg["my-bot"]["threadId"] == "thread_abc" and reg["my-bot"]["sessionId"] == "voice-abcd1234", reg

    print("voice_history: OK")


if __name__ == "__main__":
    demo()
