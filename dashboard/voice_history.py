"""voice_history — persist Live Voice calls as real Hermes sessions.

Every voice call becomes a durable Hermes session row plus plain user/assistant
message rows in the profile's `state.db` (the same store `/api/sessions` and
FTS search read), so calls show up in the PWA Sessions list, are searchable,
and can be resumed in chat like any other session.

Writes are insert-only, keyed by `callId` (idempotent), with WAL busy-timeout
retries. This module never updates or deletes rows it did not create.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import sqlite3
import threading
import time
from pathlib import Path

try:
    from fastapi import APIRouter, HTTPException, Request
except ImportError:  # pragma: no cover - Hermes dashboard provides FastAPI
    APIRouter = None
    HTTPException = None
    Request = None

router = APIRouter() if APIRouter else None
_log = logging.getLogger("hermes.plugins.hermes-pwa.voice")

_PLUGIN_ROOT = Path(__file__).resolve().parent.parent
_REGISTRY_PATH = _PLUGIN_ROOT / "voice_threads.json"
_REGISTRY_LOCK = threading.Lock()

_PROFILES_ROOT = Path.home() / ".hermes" / "profiles"
_PROFILE_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

_CALL_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
_MAX_TEXT = 20_000
_MAX_MESSAGES = 1_000
_MAX_TITLE = 80
_TITLE_FALLBACK = "Voice call"


def _profile_state_db(profile: str | None) -> Path | None:
    """state.db for a named profile, or the Hermes default home when empty."""
    if not profile:
        return Path.home() / ".hermes" / "state.db"
    if not _PROFILE_RE.fullmatch(profile):
        return None
    home = _PROFILES_ROOT / profile
    if not home.is_dir():
        return None
    return home.resolve() / "state.db"


def _load_registry() -> dict:
    try:
        return json.loads(_REGISTRY_PATH.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - missing/corrupt file → fresh registry
        return {}


def _save_registry(data: dict) -> None:
    try:
        _REGISTRY_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:  # noqa: BLE001
        _log.warning("voice: no se pudo guardar voice_threads.json: %s", exc)


def remember_thread(
    profile: str,
    thread_id: str,
    session_id: str,
    language: str = "es",
    model: str | None = None,
    started_at: float | None = None,
) -> None:
    """Record the active voice thread for a profile (used by 'Continue last call')."""
    with _REGISTRY_LOCK:
        data = _load_registry()
        data[profile] = {
            "threadId": thread_id,
            "sessionId": session_id,
            "language": language,
            "model": model,
            "startedAt": started_at if started_at is not None else time.time(),
        }
        _save_registry(data)


def _unique_title(conn: sqlite3.Connection, title: str) -> str:
    base = title.strip()[:_MAX_TITLE] or _TITLE_FALLBACK
    candidate = base
    n = 2
    while conn.execute("SELECT 1 FROM sessions WHERE title = ?", (candidate,)).fetchone():
        candidate = f"{base} ({n})"
        n += 1
    return candidate


def _dedupe_messages(messages: list[dict]) -> list[tuple[str, str, float]]:
    """Normalize [{who,text,at}] → [(role, text, timestamp)], rejecting garbage."""
    out: list[tuple[str, str, float]] = []
    for item in messages[:_MAX_MESSAGES]:
        who = str(item.get("who") or "").strip().lower()
        # the PWA voice client labels model turns 'bot', not 'assistant' —
        # accepting only 'assistant' silently dropped every model reply
        role = "user" if who == "user" else "assistant" if who in ("assistant", "bot") else ""
        text = str(item.get("text") or "").strip()[:_MAX_TEXT]
        if not role or not text:
            continue
        try:
            at = float(item.get("at") or 0.0)
        except (TypeError, ValueError):
            at = 0.0
        if at <= 0:
            at = time.time()
        out.append((role, text, at))
    return out


def save_call(body: dict) -> dict:
    """Insert a voice-call session + messages into state.db (idempotent by callId)."""
    call_id = str(body.get("callId") or "").strip()
    if not _CALL_ID_RE.fullmatch(call_id):
        raise HTTPException(status_code=400, detail="callId inválido o ausente")
    profile = str(body.get("profile") or "").strip()
    db_path = _profile_state_db(profile or None)
    if db_path is None:
        raise HTTPException(status_code=400, detail=f"perfil '{profile}' no existe")
    if not db_path.is_file():
        raise HTTPException(status_code=404, detail="state.db no encontrado (¿gateway no inicializado?)")

    msgs = _dedupe_messages(body.get("messages") or [])
    if not msgs:
        return {"ok": True, "sessionId": f"voice-{call_id}", "inserted": 0, "saved": False}

    started_at = float(body.get("startedAt") or msgs[0][2])
    ended_at = float(body.get("endedAt") or msgs[-1][2])

    first_user = next((t for role, t, _ in msgs if role == "user"), "")
    title = first_user[:_MAX_TITLE]

    session_id = f"voice-{call_id}"
    # ponytail: WAL single-writer gateway puede mantener el lock; timeout corto + reintentos
    conn = sqlite3.connect(db_path, timeout=30.0)
    try:
        cur = conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,))
        exists = cur.fetchone() is not None
        if exists:
            conn.close()
            return {"ok": True, "sessionId": session_id, "inserted": 0, "saved": True}
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            """INSERT INTO sessions (id, source, started_at, ended_at, end_reason, message_count, title)
               VALUES (?, 'voice', ?, ?, 'voice_call_end', ?, ?)""",
            (session_id, started_at, ended_at, len(msgs), _unique_title(conn, title) if title else None),
        )
        conn.executemany(
            """INSERT INTO messages (session_id, role, content, timestamp)
               VALUES (?, ?, ?, ?)""",
            [(session_id, role, text, at) for role, text, at in msgs],
        )
        conn.commit()
    finally:
        conn.close()

    with _REGISTRY_LOCK:
        data = _load_registry()
        entry = data.get(profile) or {}
        if entry.get("sessionId") == session_id:
            entry["endedAt"] = ended_at
            entry["title"] = title or _TITLE_FALLBACK
            _save_registry(data)
    return {"ok": True, "sessionId": session_id, "inserted": len(msgs), "saved": True}


if router is not None:
    from push_common import _require_dashboard_auth  # noqa: E402

    @router.get("/threads")
    async def voice_threads(request: Request) -> dict:
        _require_dashboard_auth(request)
        with _REGISTRY_LOCK:
            return {"ok": True, "profiles": _load_registry()}

    @router.post("/call/save")
    async def voice_call_save(request: Request) -> dict:
        _require_dashboard_auth(request)
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            body = {}
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="JSON object esperado")
        return await asyncio.to_thread(save_call, body)


