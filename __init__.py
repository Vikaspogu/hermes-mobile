from __future__ import annotations

import logging
import os
import re
from typing import Any

from .push_common import (
    approval_push_payload,
    claim_push_dedupe,
    clear_pending_approval,
    cron_complete_push_payload,
    record_pending_approval,
    send_web_push_to_enabled,
    turn_complete_push_payload,
)

logger = logging.getLogger(__name__)

_PWA_TURN_COMPLETE_PLATFORMS = {"tui", "pwa", "desktop", "web"}
_APPROVAL_PUSH_TTL_SECONDS = 10 * 60
_TURN_COMPLETE_TTL_SECONDS = 6 * 60 * 60
_CRON_COMPLETE_TTL_SECONDS = 6 * 60 * 60
# Upstream cron session ids: cron_<job_id>_<YYYYmmdd_HHMMSS> (cron/scheduler.py run_job).
_CRON_SESSION_RE = re.compile(r"^cron_([0-9A-Za-z]+)_\d{8}_\d{6}$")


def _approval_surface(kwargs: dict[str, Any]) -> str:
    return str(kwargs.get("surface") or "gateway").strip().lower()


def _is_gateway_approval(kwargs: dict[str, Any]) -> bool:
    """Only gateway approvals can be answered by PWA approval.respond.

    Hermes also fires approval hooks for local CLI prompts. Those observer
    events are not backed by the gateway approval queue, so surfacing them in
    the mobile PWA creates stale cards that return 4009 "no pending approval".
    """
    return _approval_surface(kwargs) == "gateway"


def _notification_profile(kwargs: dict[str, Any]) -> str:
    value = kwargs.get("profile") or os.environ.get("HERMES_PROFILE") or "default"
    return str(value or "default")


def _on_pre_approval_request(**kwargs: Any) -> None:
    """Observe Hermes approval requests.

    Phase 0/Phase A only builds the safe payload contract. Phase B/G will attach
    the Web Push sender. This hook must never block or break approval flow.
    """
    try:
        if not _is_gateway_approval(kwargs):
            logger.debug(
                "Hermes PWA approval hook ignored non-gateway surface: %s",
                _approval_surface(kwargs),
            )
            return
        profile = _notification_profile(kwargs)
        kwargs = {**kwargs, "profile": profile}
        payload = approval_push_payload(**kwargs)
        dedupe_key = str(payload.get("tag") or "")
        if not claim_push_dedupe(dedupe_key, ttl_seconds=_APPROVAL_PUSH_TTL_SECONDS):
            logger.debug(
                "Hermes PWA approval push deduped: key=%s profile=%s",
                dedupe_key,
                profile,
            )
            return
        record_pending_approval(**kwargs)
        sent = send_web_push_to_enabled(payload, profile=profile)
        logger.debug(
            "Hermes PWA approval push sent: tag=%s profile=%s devices=%s",
            payload.get("tag"),
            payload.get("profile"),
            sent,
        )
    except Exception as exc:  # pragma: no cover - defensive observer hook
        logger.debug("Hermes PWA approval hook ignored error: %s", exc)


def _on_post_approval_response(**kwargs: Any) -> None:
    """Remove approval recovery records once Hermes has a decision/timeout."""
    try:
        if not _is_gateway_approval(kwargs):
            return
        clear_pending_approval(**kwargs)
    except Exception as exc:  # pragma: no cover - defensive observer hook
        logger.debug("Hermes PWA approval clear hook ignored error: %s", exc)


def _is_silent_cron_response(text: str) -> bool:
    try:
        from gateway.response_filters import is_autonomous_silence_response
    except Exception:  # pragma: no cover - outside Hermes (tests); upstream owns the real rule
        return text.strip().upper().startswith("[SILENT]")
    return bool(is_autonomous_silence_response(text))


def _cron_job_name(job_id: str) -> str:
    try:
        from cron.jobs import get_job  # upstream: honors the active profile's cron store

        return str((get_job(job_id) or {}).get("name") or "")
    except Exception:
        return ""


def _send_cron_complete_push(kwargs: dict[str, Any]) -> None:
    """One content-free push per cron execution (cron turns have platform="cron")."""
    response = str(kwargs.get("assistant_response") or "")
    if not response.strip() or _is_silent_cron_response(response):
        return
    session_id = str(kwargs.get("session_id") or "")
    match = _CRON_SESSION_RE.match(session_id)
    job_name = _cron_job_name(match.group(1)) if match else ""
    profile = _notification_profile(kwargs)
    payload = cron_complete_push_payload(
        session_id=session_id,
        turn_id=kwargs.get("turn_id"),
        job_name=job_name,
        profile=profile,
    )
    if not claim_push_dedupe(payload["dedupe_key"], ttl_seconds=_CRON_COMPLETE_TTL_SECONDS):
        return
    sent = send_web_push_to_enabled(payload, profile=profile)
    logger.info(
        "Hermes PWA cron push sent: session=%s job=%s devices=%s",
        session_id,
        job_name or "?",
        sent,
    )


def _on_post_llm_call(**kwargs: Any) -> None:
    """Send one low-noise answer-ready push after PWA/TUI turns complete."""
    try:
        platform = str(kwargs.get("platform") or "").lower()
        if platform == "cron":
            _send_cron_complete_push(kwargs)
            return
        if platform not in _PWA_TURN_COMPLETE_PLATFORMS:
            return
        if not str(kwargs.get("assistant_response") or "").strip():
            return
        profile = _notification_profile(kwargs)
        payload = turn_complete_push_payload(**{**kwargs, "profile": profile})
        dedupe_key = str(payload.get("dedupe_key") or "")
        if not claim_push_dedupe(dedupe_key, ttl_seconds=_TURN_COMPLETE_TTL_SECONDS):
            return
        sent = send_web_push_to_enabled(payload, profile=profile)
        logger.debug(
            "Hermes PWA turn-complete push sent: tag=%s dedupe=%s profile=%s devices=%s",
            payload.get("tag"),
            dedupe_key,
            payload.get("profile"),
            sent,
        )
    except Exception as exc:  # pragma: no cover - defensive observer hook
        logger.debug("Hermes PWA turn-complete hook ignored error: %s", exc)


def register(ctx: Any) -> None:
    ctx.register_hook("pre_approval_request", _on_pre_approval_request)
    ctx.register_hook("post_approval_response", _on_post_approval_response)
    ctx.register_hook("post_llm_call", _on_post_llm_call)
