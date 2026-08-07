"""Voxly max-bridge — FastAPI sidecar for personal MAX (PyMax)."""

from __future__ import annotations

import asyncio
import io
import logging
import os
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import httpx
import qrcode
from fastapi import FastAPI, Header, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

logger = logging.getLogger("max-bridge")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

PORT = int(os.environ.get("MAX_BRIDGE_PORT", "3010"))
SERVICE_TOKEN = os.environ.get("VOXLY_SERVICE_TOKEN", "")
SAAS_API_URL = (os.environ.get("SAAS_API_URL") or "http://saas-api:3002").rstrip("/")
SESSION_DIR = Path(os.environ.get("MAX_SESSION_DIR") or "/data/max-sessions")
SESSION_DIR.mkdir(parents=True, exist_ok=True)

try:
    from pymax import WebClient  # type: ignore

    PYMAX_AVAILABLE = True
except Exception as exc:  # pragma: no cover - optional at build/dev
    WebClient = None  # type: ignore
    PYMAX_AVAILABLE = False
    logger.warning("PyMax not available: %s", exc)

app = FastAPI(title="Voxly MAX bridge", version="0.1.0")


def require_auth(authorization: Optional[str]) -> None:
    if not SERVICE_TOKEN:
        raise HTTPException(503, detail="VOXLY_SERVICE_TOKEN not configured")
    if not authorization or authorization != f"Bearer {SERVICE_TOKEN}":
        raise HTTPException(401, detail="Unauthorized")


async def saas_fetch(path: str, method: str = "GET", json_body: Any = None) -> dict:
    headers = {
        "Authorization": f"Bearer {SERVICE_TOKEN}",
        "X-Voxly-Service": "max-bridge",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.request(
            method,
            f"{SAAS_API_URL}{path}",
            headers=headers,
            json=json_body,
        )
        data = res.json() if res.content else {}
        if res.status_code >= 400:
            raise HTTPException(
                res.status_code,
                detail=data.get("error") or data.get("detail") or res.text,
            )
        return data if isinstance(data, dict) else {"ok": True, "data": data}


@dataclass
class QrState:
    status: str = "preparing"  # preparing|qr_ready|waiting_password|processing_password|authorized|error
    tenant_id: str = ""
    name: str = "default"
    qr_url: Optional[str] = None
    error: Optional[str] = None
    password_hint: Optional[str] = None
    bot_id: Optional[str] = None
    user: Optional[dict] = None
    password_future: Optional[asyncio.Future] = field(default=None, repr=False)
    task: Optional[asyncio.Task] = field(default=None, repr=False)
    start_task: Optional[asyncio.Task] = field(default=None, repr=False)
    client: Any = field(default=None, repr=False)


# key = f"{tenantId}:{name}"
qr_states: dict[str, QrState] = {}
# botInstanceId → live client
live_clients: dict[str, Any] = {}
# botInstanceId → asyncio task running client.start() (never returns until disconnect)
client_tasks: dict[str, asyncio.Task] = {}
# botInstanceId → asyncio task listening for messages
listener_tasks: dict[str, asyncio.Task] = {}

CLIENT_READY_TIMEOUT_SEC = 180.0


def qr_key(tenant_id: str, name: str) -> str:
    return f"{tenant_id}:{name}"


def session_path(bot_id: str) -> Path:
    d = SESSION_DIR / bot_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def wipe_session_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)
    path.mkdir(parents=True, exist_ok=True)


async def close_client(client: Any) -> None:
    if client is None:
        return
    try:
        stop = getattr(client, "stop", None) or getattr(client, "close", None) or getattr(
            client, "disconnect", None
        )
        if stop:
            result = stop()
            if asyncio.iscoroutine(result):
                await result
    except Exception:
        logger.debug("close_client ignored error", exc_info=True)


async def cancel_qr_state(prev: Optional[QrState]) -> None:
    if not prev:
        return
    if prev.password_future and not prev.password_future.done():
        prev.password_future.cancel()
    if prev.start_task and not prev.start_task.done():
        prev.start_task.cancel()
    if prev.task and not prev.task.done():
        prev.task.cancel()
        try:
            await prev.task
        except (asyncio.CancelledError, Exception):
            pass
    await close_client(prev.client)


def bind_client_ready(client: Any) -> asyncio.Event:
    """Register on_start BEFORE calling client.start() — start() never returns until disconnect."""
    ready = asyncio.Event()

    @client.on_start()
    async def _on_start(_c: Any) -> None:
        ready.set()

    return ready


async def wait_client_ready(
    client: Any,
    ready: asyncio.Event,
    start_task: asyncio.Task,
    timeout: float,
) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if ready.is_set():
            return
        if start_task.done():
            exc = start_task.exception()
            if exc:
                raise exc
            raise RuntimeError("MAX client exited before ready")
        await asyncio.sleep(0.05)
    start_task.cancel()
    await close_client(client)
    raise TimeoutError(
        f"MAX login timed out after {int(timeout)}s — отсканируйте QR заново"
    )


async def resolve_me(client: Any, attempts: int = 8, delay: float = 0.25) -> Any:
    """PyMax may fire on_start before client.me / get_me is populated."""
    for i in range(max(1, attempts)):
        me = getattr(client, "me", None)
        if callable(me):
            try:
                me = me()
                if asyncio.iscoroutine(me):
                    me = await me
            except Exception:
                me = None
        if me is None:
            for attr in ("get_me", "get_self"):
                fn = getattr(client, attr, None)
                if fn is None:
                    continue
                try:
                    me = await fn() if asyncio.iscoroutinefunction(fn) else fn()
                    if asyncio.iscoroutine(me):
                        me = await me
                    break
                except Exception:
                    me = None
        if me is not None:
            return me
        if i + 1 < attempts:
            await asyncio.sleep(delay)
    return None


def profile_from_me(me: Any) -> tuple[Optional[str], Optional[str], Optional[str]]:
    if me is None:
        return None, None, None
    raw_id = (
        getattr(me, "id", None)
        or getattr(me, "user_id", None)
        or getattr(me, "userId", None)
    )
    max_user_id = str(raw_id).strip() if raw_id is not None and str(raw_id).strip() else None
    username = getattr(me, "username", None) or getattr(me, "nick", None)
    first_name = getattr(me, "first_name", None) or getattr(me, "name", None)
    if username is not None:
        username = str(username) or None
    if first_name is not None:
        first_name = str(first_name) or None
    return max_user_id, username, first_name


class BridgeQrHandler:
    """PyMax QrHandler: only surfaces qr_url to HTTP state (does not confirm)."""

    def __init__(self, state: QrState) -> None:
        self.state = state

    async def show_qr(self, qr_url: str) -> None:
        self.state.qr_url = qr_url
        self.state.error = None
        self.state.status = "qr_ready"
        logger.info("QR ready for %s/%s", self.state.tenant_id, self.state.name)


class BridgePasswordProvider:
    """Waits for POST /auth/qr/password to resolve 2FA."""

    def __init__(self, state: QrState) -> None:
        self.state = state

    async def get_password(self, hint: str | None = None) -> str:
        # Re-entry after wrong password: surface clear UI error.
        if self.state.status == "processing_password":
            self.state.error = (
                "Неверный пароль 2FA. Проверьте облачный пароль MAX "
                f"(подсказка: {hint or self.state.password_hint or '—'}) "
                "или нажмите «Показать QR» и отсканируйте снова."
            )
        self.state.password_hint = hint
        self.state.status = "waiting_password"
        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        self.state.password_future = fut
        logger.info("Waiting for 2FA password (hint=%s)", hint)
        return await fut


class QrStartBody(BaseModel):
    tenantId: str
    name: str = "default"


class QrPasswordBody(BaseModel):
    tenantId: str
    name: str = "default"
    password: str = ""


class SendBody(BaseModel):
    botId: str
    peerUserId: str = Field(..., description="MAX peer / chat id")
    text: str
    replyTo: Optional[str] = None


class ConnectBody(BaseModel):
    botId: str


class DeleteBody(BaseModel):
    tenantId: str
    botId: str


class PrivateDialogsBody(BaseModel):
    botId: str
    dialogLimit: int = 0  # 0 = all private DIALOG chats
    messageLimit: int = 30


class ByPhoneBody(BaseModel):
    botId: str
    phone: str
    tenantId: Optional[str] = None


def _chat_type_value(chat: Any) -> str:
    t = getattr(chat, "type", None)
    if t is None:
        return ""
    return str(getattr(t, "value", t) or "").upper()


def _user_display_name(user: Any) -> tuple[Optional[str], Optional[str]]:
    """Return (firstName, username-ish) from PyMax User.names / link."""
    if user is None:
        return None, None
    first: Optional[str] = None
    username: Optional[str] = None
    names = getattr(user, "names", None) or []
    for n in names:
        fn = getattr(n, "first_name", None) or getattr(n, "name", None)
        if fn and not first:
            first = str(fn).strip() or None
        ln = getattr(n, "last_name", None)
        if ln and not first:
            first = str(ln).strip() or None
    link = getattr(user, "link", None)
    if isinstance(link, str) and link.strip():
        # e.g. https://max.ru/u/xxx or @handle — keep trailing segment as handle hint
        part = link.rstrip("/").split("/")[-1].lstrip("@")
        if part and part.lower() not in ("u", "user", "max.ru"):
            username = part
    return first, username


def _normalize_max_phone(raw: str) -> str:
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if not digits:
        return ""
    return f"+{digits}"


def _user_link(user: Any) -> Optional[str]:
    """Public MAX profile URL only when PyMax returns it — never invent from phone."""
    link = getattr(user, "link", None)
    if link is None:
        return None
    s = str(link).strip()
    if not s:
        return None
    if s.startswith("http://") or s.startswith("https://"):
        if "max.ru" in s.lower():
            return s
        return None
    # Relative /u/xxx → https://max.ru/u/xxx
    if s.startswith("/") or s.startswith("u/") or s.startswith("@"):
        path = s.lstrip("@").lstrip("/")
        if path.lower().startswith("max.ru/"):
            return f"https://{path}"
        return f"https://max.ru/{path}"
    return None


def _user_profile_dict(user: Any) -> dict[str, Any]:
    """Serialize PyMax User for CRM enrich. No birthday field in maxapi-python User."""
    if user is None:
        return {"exists": False}
    uid = getattr(user, "id", None)
    first: Optional[str] = None
    last: Optional[str] = None
    names = getattr(user, "names", None) or []
    for n in names:
        fn = getattr(n, "first_name", None)
        ln = getattr(n, "last_name", None)
        full = getattr(n, "name", None)
        if fn and not first:
            first = str(fn).strip() or None
        if ln and not last:
            last = str(ln).strip() or None
        if full and not first:
            first = str(full).strip() or None
    _, username = _user_display_name(user)
    link = _user_link(user)
    phone_raw = getattr(user, "phone", None)
    phone: Optional[str] = None
    if phone_raw is not None and str(phone_raw).strip():
        phone = _normalize_max_phone(str(phone_raw)) or None
    about = getattr(user, "description", None)
    about_s = str(about).strip() if about is not None and str(about).strip() else None
    return {
        "exists": True,
        "userId": str(uid) if uid is not None else None,
        "firstName": first,
        "lastName": last,
        "username": username,
        "link": link,
        "phone": phone,
        "about": about_s,
        # Honest: PyMax User has no birthday in ≥2.3 / 2.4
        "birthday": None,
    }


async def _enrich_profile_link(client: Any, profile: dict[str, Any]) -> dict[str, Any]:
    """If search/import returned userId without public link, try get_user once."""
    if profile.get("link") or not profile.get("userId"):
        return profile
    get_user = getattr(client, "get_user", None)
    if not callable(get_user):
        return profile
    try:
        uid = int(str(profile["userId"]))
    except Exception:
        return profile
    try:
        user = await get_user(uid)
        fuller = _user_profile_dict(user)
        if fuller.get("link"):
            profile["link"] = fuller["link"]
        if not profile.get("firstName") and fuller.get("firstName"):
            profile["firstName"] = fuller["firstName"]
        if not profile.get("lastName") and fuller.get("lastName"):
            profile["lastName"] = fuller["lastName"]
        if not profile.get("about") and fuller.get("about"):
            profile["about"] = fuller["about"]
        if not profile.get("username") and fuller.get("username"):
            profile["username"] = fuller["username"]
    except Exception:
        logger.debug("get_user after by-phone failed uid=%s", profile.get("userId"), exc_info=True)
    return profile


def _me_profile_if_phone_match(client: Any, phone_e164: str) -> Optional[dict[str, Any]]:
    """search_by_phone often misses the logged-in account itself — use client.me."""
    want = "".join(ch for ch in _normalize_max_phone(phone_e164) if ch.isdigit())
    if len(want) < 10:
        return None
    me = getattr(client, "me", None)
    me_user = getattr(me, "contact", None) or me
    if me_user is None:
        return None
    me_phone = "".join(
        ch for ch in str(getattr(me_user, "phone", "") or "") if ch.isdigit()
    )
    if not me_phone or me_phone != want:
        # Also accept national/E.164 suffix match (11 vs 10 digits).
        if not me_phone or not (
            me_phone.endswith(want[-10:]) or want.endswith(me_phone[-10:])
        ):
            return None
    profile = _user_profile_dict(me_user)
    if profile.get("exists"):
        return profile
    return None


async def _resolve_user_by_phone(client: Any, phone_e164: str) -> dict[str, Any]:
    """PyMax search_by_phone, then import_contacts fallback. Never invent profile links."""
    phone = _normalize_max_phone(phone_e164)
    if len(phone) < 11:  # + + ≥10 digits
        return {"exists": False, "error": "bad_phone"}

    self_profile = _me_profile_if_phone_match(client, phone)
    if self_profile:
        return self_profile

    search = getattr(client, "search_by_phone", None)
    if callable(search):
        try:
            user = await search(phone)
            if user is not None:
                return await _enrich_profile_link(client, _user_profile_dict(user))
        except Exception as exc:
            # Not found / privacy → try import_contacts; other errors still fall through
            logger.info(
                "search_by_phone miss/err phone_set=%s err=%s",
                bool(phone),
                exc,
            )

    import_fn = getattr(client, "import_contacts", None)
    if callable(import_fn):
        try:
            ContactInfo = None
            try:
                from pymax.types import ContactInfo as _CI  # type: ignore

                ContactInfo = _CI
            except Exception:
                try:
                    from pymax.types.domain import ContactInfo as _CI  # type: ignore

                    ContactInfo = _CI
                except Exception:
                    ContactInfo = None
            if ContactInfo is None:
                return {"exists": False, "error": "ContactInfo unavailable"}
            # Probe name must never stick on CRM (same idea as GramJS Voxly/Check).
            contacts = [
                ContactInfo(phone=phone, first_name="Voxly", last_name="Check")
            ]
            users = await import_fn(contacts)
            if users:
                # Prefer exact phone match when server returns several
                want = phone.lstrip("+")
                chosen = None
                for u in users:
                    ph = getattr(u, "phone", None)
                    if ph is not None and "".join(
                        ch for ch in str(ph) if ch.isdigit()
                    ) == want:
                        chosen = u
                        break
                if chosen is None:
                    chosen = users[0]
                profile = _user_profile_dict(chosen)
                # Drop probe names if API echoed them
                fn = (profile.get("firstName") or "").strip()
                ln = (profile.get("lastName") or "").strip()
                if fn.lower() == "voxly" and ln.lower() == "check":
                    profile["firstName"] = None
                    profile["lastName"] = None
                return await _enrich_profile_link(client, profile)
            return {"exists": False}
        except Exception as exc:
            logger.exception("import_contacts failed")
            return {"exists": False, "error": str(exc)}

    return {"exists": False, "error": "search_by_phone unavailable"}


def _message_text(msg: Any) -> str:
    text = getattr(msg, "text", None) or ""
    if not isinstance(text, str):
        text = str(text or "")
    text = text.strip()
    if text:
        return text
    attaches = getattr(msg, "attaches", None) or []
    if attaches:
        kinds: list[str] = []
        for a in attaches:
            k = getattr(a, "type", None) or type(a).__name__
            kinds.append(str(k))
        return f"[media:{','.join(kinds[:3])}]" if kinds else "[media]"
    return ""


async def _ensure_live_client(bot_id: str) -> Any:
    client = live_clients.get(bot_id)
    if client is not None:
        return client
    restored = await _restore_bot(bot_id)
    if not restored:
        raise HTTPException(404, detail="MAX session not connected")
    client = live_clients.get(bot_id)
    if client is None:
        raise HTTPException(404, detail="MAX session not connected")
    return client


@app.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "service": "max-bridge",
        "pymax": PYMAX_AVAILABLE,
        "sessions": len(live_clients),
        "timestamp": time.time(),
    }


@app.post("/auth/qr/start")
async def auth_qr_start(
    body: QrStartBody,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    require_auth(authorization)
    if not PYMAX_AVAILABLE:
        raise HTTPException(
            503,
            detail="PyMax (maxapi-python) not installed in max-bridge image",
        )

    name = (body.name or "default").strip() or "default"
    key = qr_key(body.tenantId, name)
    await cancel_qr_state(qr_states.get(key))

    # Stale pending session → FAIL_LOGIN_TOKEN / silent reconnect without QR.
    wipe_session_dir(session_path(f"pending-{body.tenantId}-{name}"))

    state = QrState(status="preparing", tenant_id=body.tenantId, name=name)
    qr_states[key] = state
    state.task = asyncio.create_task(_run_qr_login(state))
    return {"ok": True, "status": state.status, "name": name}


@app.get("/auth/qr/status")
async def auth_qr_status(
    tenantId: str = Query(...),
    name: str = Query("default"),
    authorization: Optional[str] = Header(default=None),
) -> dict:
    require_auth(authorization)
    key = qr_key(tenantId, (name or "default").strip() or "default")
    state = qr_states.get(key)
    if not state:
        return {"ok": True, "status": "unknown", "qr": None, "user": None}
    return {
        "ok": True,
        "status": state.status,
        "botId": state.bot_id,
        "qr": state.qr_url,
        "error": state.error,
        "passwordHint": state.password_hint,
        "user": state.user,
    }


@app.get("/auth/qr/png")
async def auth_qr_png(
    tenantId: str = Query(...),
    name: str = Query("default"),
    authorization: Optional[str] = Header(default=None),
) -> Response:
    require_auth(authorization)
    key = qr_key(tenantId, (name or "default").strip() or "default")
    state = qr_states.get(key)
    if not state or not state.qr_url:
        raise HTTPException(404, detail="QR not ready")
    img = qrcode.make(state.qr_url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(
        content=buf.getvalue(),
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )


@app.post("/auth/qr/password")
async def auth_qr_password(
    body: QrPasswordBody,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    require_auth(authorization)
    key = qr_key(body.tenantId, (body.name or "default").strip() or "default")
    state = qr_states.get(key)
    if not state or not state.password_future or state.password_future.done():
        raise HTTPException(
            400,
            detail=(
                "Нет активного запроса пароля 2FA. "
                "Нажмите «Показать QR» и отсканируйте код в MAX заново."
            ),
        )
    state.error = None
    state.status = "processing_password"
    state.password_future.set_result(body.password)
    return {"ok": True, "status": state.status}


async def _run_qr_login(state: QrState) -> None:
    assert WebClient is not None
    work = session_path(f"pending-{state.tenant_id}-{state.name}")
    wipe_session_dir(work)
    qr_handler = BridgeQrHandler(state)
    password_provider = BridgePasswordProvider(state)

    client = None
    start_task: Optional[asyncio.Task] = None
    try:
        kwargs: dict[str, Any] = {
            "work_dir": str(work),
            "session_name": "web.db",
        }
        try:
            from pymax import QrAuthFlow  # type: ignore

            kwargs["auth_flow"] = QrAuthFlow(qr_handler, password_provider)
        except Exception:
            kwargs["qr_provider"] = qr_handler

        client = WebClient(**kwargs)
        state.client = client

        start = getattr(client, "start", None)
        if start is None:
            raise RuntimeError("PyMax WebClient has no start()")

        ready = bind_client_ready(client)
        result = start()
        if not asyncio.iscoroutine(result):
            raise RuntimeError("PyMax start() is not awaitable")
        start_task = asyncio.create_task(result)
        state.start_task = start_task
        await wait_client_ready(client, ready, start_task, CLIENT_READY_TIMEOUT_SEC)

        me = await resolve_me(client)
        max_user_id, username, first_name = profile_from_me(me)
        if not max_user_id:
            logger.warning(
                "MAX profile id missing after on_start for %s/%s — upsert with empty maxUserId",
                state.tenant_id,
                state.name,
            )

        upsert = await saas_fetch(
            "/api/internal/max/bots/upsert",
            method="POST",
            json_body={
                "tenantId": state.tenant_id,
                "name": state.name,
                # Always string — Zod/API reject JSON null for maxUserId.
                "maxUserId": max_user_id or "",
                "username": username,
                "firstName": first_name,
                "sessionReady": True,
            },
        )
        bot_id = str(upsert.get("botId") or "")
        if not bot_id:
            raise RuntimeError("bots/upsert did not return botId")

        # Move pending session dir → bot_id (session already written by PyMax).
        final_dir = session_path(bot_id)
        wipe_session_dir(final_dir)
        for src in work.glob("*"):
            dest = final_dir / src.name
            if dest.exists():
                if dest.is_dir():
                    shutil.rmtree(dest, ignore_errors=True)
                else:
                    dest.unlink()
            src.replace(dest)

        state.bot_id = bot_id
        state.error = None
        state.user = {
            "id": max_user_id or bot_id,
            "username": username,
            "firstName": first_name,
        }
        state.status = "authorized"
        live_clients[bot_id] = client
        if start_task is not None:
            client_tasks[bot_id] = start_task
        _ensure_listener(bot_id, client)
        logger.info("MAX authorized botId=%s user=%s", bot_id, max_user_id)

        # Keep the login task alive with the connection loop.
        if start_task is not None:
            await start_task
    except asyncio.CancelledError:
        state.status = "error"
        state.error = "cancelled"
        if start_task and not start_task.done():
            start_task.cancel()
        await close_client(client)
        raise
    except Exception as exc:
        logger.exception("QR login failed")
        state.status = "error"
        state.error = str(exc)
        if start_task and not start_task.done():
            start_task.cancel()
        await close_client(client)


def _ensure_listener(bot_id: str, client: Any) -> None:
    prev = listener_tasks.get(bot_id)
    if prev and not prev.done():
        return
    listener_tasks[bot_id] = asyncio.create_task(_listen_inbound(bot_id, client))


async def _listen_inbound(bot_id: str, client: Any) -> None:
    """Attach message handler if PyMax exposes one; otherwise poll is N/A."""
    try:
        # Common decorator / register patterns across PyMax versions.
        handler = getattr(client, "on_message", None) or getattr(client, "add_message_handler", None)

        async def on_msg(message: Any) -> None:
            try:
                # Skip outgoing if flagged
                if getattr(message, "out", False) or getattr(message, "is_out", False):
                    return
                peer = (
                    getattr(message, "chat_id", None)
                    or getattr(message, "peer_id", None)
                    or getattr(getattr(message, "chat", None), "id", None)
                    or getattr(getattr(message, "sender", None), "id", None)
                )
                if peer is None:
                    return
                text = (
                    getattr(message, "text", None)
                    or getattr(message, "body", None)
                    or getattr(message, "content", None)
                    or ""
                )
                if not isinstance(text, str):
                    text = str(text or "")
                mid = getattr(message, "id", None) or getattr(message, "message_id", None)
                sender = getattr(message, "sender", None)
                username = getattr(sender, "username", None) if sender else None
                first_name = (
                    getattr(sender, "first_name", None) or getattr(sender, "name", None)
                    if sender
                    else None
                )
                phone: Optional[str] = None
                link: Optional[str] = None
                # Enrich peer profile for CRM merge-by-phone (DIALOG chats).
                try:
                    peer_uid = int(sender) if sender is not None else None
                    if peer_uid is None:
                        try:
                            peer_uid = int(peer)
                        except Exception:
                            peer_uid = None
                    get_user = getattr(client, "get_user", None)
                    if callable(get_user) and peer_uid is not None:
                        user = await get_user(peer_uid)
                        if user is not None:
                            fn, un = _user_display_name(user)
                            if fn and not first_name:
                                first_name = fn
                            if un and not username:
                                username = un
                            ph = getattr(user, "phone", None)
                            if ph is not None and str(ph).strip():
                                phone = str(ph).strip()
                            lk = getattr(user, "link", None)
                            if isinstance(lk, str) and lk.strip():
                                link = lk.strip()
                except Exception:
                    logger.debug("inbound get_user failed peer=%s", peer, exc_info=True)

                await saas_fetch(
                    "/api/internal/max/inbound",
                    method="POST",
                    json_body={
                        "botId": bot_id,
                        "peerId": str(peer),
                        "text": text,
                        "messageId": mid,
                        "username": username,
                        "firstName": first_name,
                        "phone": phone,
                        "maxLink": link,
                    },
                )
            except Exception:
                logger.exception("inbound handle failed botId=%s", bot_id)

        if handler is None:
            # Try decorator-style registration used by some builds
            on = getattr(client, "on", None)
            if callable(on):
                try:
                    on("message")(on_msg)  # type: ignore
                    logger.info("Registered on('message') for %s", bot_id)
                    return
                except Exception:
                    pass
            logger.warning(
                "No message handler API on PyMax client for %s — inbound may need library-specific wiring",
                bot_id,
            )
            return

        if callable(handler):
            # PyMax: @client.on_message() → handler()(callback)
            try:
                decorated = handler()
                if callable(decorated):
                    maybe = decorated(on_msg)
                    if asyncio.iscoroutine(maybe):
                        await maybe
                    logger.info("Attached on_message() for %s", bot_id)
                    return
            except TypeError:
                pass
            try:
                handler(on_msg)
                logger.info("Registered add_message_handler for %s", bot_id)
            except Exception:
                logger.exception("Failed to attach on_message for %s", bot_id)
    except Exception:
        logger.exception("listener setup failed botId=%s", bot_id)


@app.post("/users/by-phone")
async def users_by_phone(
    body: ByPhoneBody,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    """Resolve MAX user by phone via PyMax search_by_phone (+ import_contacts fallback).

    Never invents a max.ru link from the phone number. Birthday is not available
    on maxapi-python User (2.3.x / 2.4.x).
    """
    require_auth(authorization)
    if not PYMAX_AVAILABLE:
        raise HTTPException(503, detail="PyMax not available")

    bot_id = (body.botId or "").strip()
    phone = (body.phone or "").strip()
    if not bot_id:
        raise HTTPException(400, detail="botId required")
    if not phone:
        raise HTTPException(400, detail="phone required")

    client = await _ensure_live_client(bot_id)
    resolved = await _resolve_user_by_phone(client, phone)
    if resolved.get("error") == "bad_phone":
        raise HTTPException(400, detail="phone required")
    return {"ok": True, "botId": bot_id, **resolved}


@app.post("/crm/private-dialogs")
async def crm_private_dialogs(
    body: PrivateDialogsBody,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    """Export private DIALOG chats + recent messages for CRM history sync."""
    require_auth(authorization)
    if not PYMAX_AVAILABLE:
        raise HTTPException(503, detail="PyMax not available")

    bot_id = (body.botId or "").strip()
    if not bot_id:
        raise HTTPException(400, detail="botId required")

    message_limit = max(1, min(int(body.messageLimit or 30), 80))
    dialog_limit = int(body.dialogLimit or 0)
    if dialog_limit < 0:
        dialog_limit = 0

    client = await _ensure_live_client(bot_id)
    me = getattr(client, "me", None)
    # PyMax WebClient.me is often a wrapper; User lives on .contact
    me_user = getattr(me, "contact", None) or me
    me_id_raw = getattr(me_user, "id", None) if me_user is not None else None
    try:
        me_id: Optional[int] = int(me_id_raw) if me_id_raw is not None else None
    except Exception:
        me_id = None
    me_phone_digits = "".join(
        ch for ch in str(getattr(me_user, "phone", "") or "") if ch.isdigit()
    )
    if me_id is not None:
        logger.info("private-dialogs me_id=%s botId=%s", me_id, bot_id)

    fetch_chats = getattr(client, "fetch_chats", None)
    chats: list[Any] = []
    seen_chat_ids: set[int] = set()
    try:
        # Also take login/sync cache
        for c in list(getattr(client, "chats", None) or []):
            cid = getattr(c, "id", None)
            if cid is None or int(cid) in seen_chat_ids:
                continue
            seen_chat_ids.add(int(cid))
            chats.append(c)

        if callable(fetch_chats):
            # marker = pagination timestamp in ms (not chat id)
            marker: Optional[int] = None
            for _ in range(25):
                batch = await fetch_chats(marker=marker) if marker is not None else await fetch_chats()
                if not batch:
                    break
                oldest_ms: Optional[int] = None
                new_count = 0
                for c in batch:
                    cid = getattr(c, "id", None)
                    if cid is None:
                        continue
                    cid_i = int(cid)
                    if cid_i not in seen_chat_ids:
                        seen_chat_ids.add(cid_i)
                        chats.append(c)
                        new_count += 1
                    ev = int(
                        getattr(c, "last_event_time", 0)
                        or getattr(c, "modified", 0)
                        or 0
                    )
                    if ev > 0 and (oldest_ms is None or ev < oldest_ms):
                        oldest_ms = ev
                if new_count == 0 or oldest_ms is None:
                    break
                if marker is not None and oldest_ms >= marker:
                    break
                marker = oldest_ms
                if dialog_limit > 0:
                    dialogs_so_far = sum(1 for c in chats if _chat_type_value(c) == "DIALOG")
                    if dialogs_so_far >= dialog_limit:
                        break
                await asyncio.sleep(0.08)
    except Exception as exc:
        logger.exception("fetch_chats failed botId=%s", bot_id)
        raise HTTPException(502, detail=f"fetch_chats_failed: {exc}") from exc

    dialogs_out: list[dict[str, Any]] = []
    fetch_history = getattr(client, "fetch_history", None)
    get_user = getattr(client, "get_user", None)

    private = [c for c in chats if _chat_type_value(c) == "DIALOG"]
    # Prefer recently active
    private.sort(
        key=lambda c: int(getattr(c, "last_event_time", 0) or getattr(c, "modified", 0) or 0),
        reverse=True,
    )
    # Do not pre-slice: self/system dialogs are filtered below; slice after fill.

    for chat in private:
        if dialog_limit > 0 and len(dialogs_out) >= dialog_limit:
            break

        chat_id = getattr(chat, "id", None)
        if chat_id is None:
            continue
        try:
            if int(chat_id) == 0:
                continue
        except Exception:
            pass

        # Peer user id = other participant (not me); CRM key stays chat_id to match inbound.
        peer_user_id: Optional[int] = None
        candidate_ids: list[int] = []
        participants = getattr(chat, "participants", None) or {}
        if isinstance(participants, dict):
            for uid in participants.keys():
                try:
                    candidate_ids.append(int(uid))
                except Exception:
                    continue
        owner = getattr(chat, "owner", None)
        if owner is not None:
            try:
                oid = int(owner)
                if oid not in candidate_ids:
                    candidate_ids.append(oid)
            except Exception:
                pass
        for uid_i in candidate_ids:
            if me_id is not None and uid_i == me_id:
                continue
            peer_user_id = uid_i
            break

        # Skip self / system shells (no other participant)
        if peer_user_id is None:
            continue
        if me_id is not None and peer_user_id == me_id:
            continue

        first_name: Optional[str] = getattr(chat, "title", None)
        username: Optional[str] = None
        phone: Optional[str] = None
        link: Optional[str] = None
        if peer_user_id is not None and callable(get_user):
            try:
                user = await get_user(peer_user_id)
                uid_got = getattr(user, "id", None) if user is not None else None
                try:
                    if me_id is not None and uid_got is not None and int(uid_got) == me_id:
                        continue
                except Exception:
                    pass
                fn, un = _user_display_name(user)
                if fn:
                    first_name = fn
                if un:
                    username = un
                link = _user_link(user)
                ph = getattr(user, "phone", None)
                if ph is not None and str(ph).strip():
                    phone = str(ph).strip()
                    ph_digits = "".join(ch for ch in phone if ch.isdigit())
                    if me_phone_digits and ph_digits and ph_digits.endswith(me_phone_digits[-10:]):
                        continue
            except Exception:
                logger.debug("get_user failed chat=%s peer=%s", chat_id, peer_user_id, exc_info=True)

        messages_out: list[dict[str, Any]] = []
        if callable(fetch_history):
            try:
                hist = await fetch_history(chat_id=int(chat_id), backward=message_limit)
                if hist:
                    # Oldest → newest for CRM insert order
                    ordered = list(hist)
                    ordered.sort(key=lambda m: int(getattr(m, "time", 0) or 0))
                    for msg in ordered[-message_limit:]:
                        mid = getattr(msg, "id", None)
                        if mid is None:
                            continue
                        sender = getattr(msg, "sender", None)
                        out = False
                        if me_id is not None and sender is not None:
                            try:
                                out = int(sender) == int(me_id)
                            except Exception:
                                out = False
                        ts = int(getattr(msg, "time", 0) or 0)
                        # PyMax times are ms; expose unix seconds for CRM
                        date_sec = int(ts / 1000) if ts > 10_000_000_000 else ts
                        text = _message_text(msg)
                        messages_out.append(
                            {
                                "id": int(mid) if str(mid).isdigit() else mid,
                                "out": out,
                                "text": text,
                                "date": date_sec,
                            }
                        )
            except Exception:
                logger.exception("fetch_history failed chat=%s botId=%s", chat_id, bot_id)

        # Skip empty shells (no history) — same contract as WA open chats with messages
        if not messages_out:
            continue

        dialogs_out.append(
            {
                "chatId": str(chat_id),
                "userId": str(peer_user_id) if peer_user_id is not None else str(chat_id),
                "username": username,
                "firstName": first_name,
                "phone": phone,
                "link": link,
                "messages": messages_out,
            }
        )
        await asyncio.sleep(0.05)

    return {"ok": True, "dialogs": dialogs_out, "totalPrivate": len(private)}


@app.post("/messages/send")
async def messages_send(
    body: SendBody,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    require_auth(authorization)
    client = await _ensure_live_client(body.botId)

    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, detail="text required")

    send_fn = (
        getattr(client, "send_message", None)
        or getattr(client, "send_text", None)
        or getattr(client, "send", None)
    )
    if send_fn is None:
        raise HTTPException(501, detail="PyMax client has no send_message")

    try:
        # Prefer chat_id / peer kwargs across versions
        try:
            result = send_fn(body.peerUserId, text)
        except TypeError:
            result = send_fn(chat_id=body.peerUserId, text=text)
        if asyncio.iscoroutine(result):
            await result
    except Exception as exc:
        logger.exception("send failed")
        raise HTTPException(502, detail=str(exc)) from exc

    return {"ok": True}


@app.post("/sessions/connect")
async def sessions_connect(
    body: ConnectBody,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    require_auth(authorization)
    ok = await _restore_bot(body.botId)
    if not ok:
        raise HTTPException(404, detail="session not found or restore failed")
    return {"ok": True, "botId": body.botId}


@app.post("/accounts/delete")
async def accounts_delete(
    body: DeleteBody,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    require_auth(authorization)
    bot_id = body.botId
    task = listener_tasks.pop(bot_id, None)
    if task and not task.done():
        task.cancel()
    ct = client_tasks.pop(bot_id, None)
    if ct and not ct.done():
        ct.cancel()
    client = live_clients.pop(bot_id, None)
    await close_client(client)
    # Wipe session files
    d = SESSION_DIR / bot_id
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
    await saas_fetch(
        "/api/internal/max/bots/delete",
        method="POST",
        json_body={"tenantId": body.tenantId, "botId": bot_id},
    )
    return {"ok": True, "botId": bot_id, "sessionCleared": True}


async def _restore_bot(bot_id: str) -> bool:
    if bot_id in live_clients:
        return True
    if not PYMAX_AVAILABLE or WebClient is None:
        return False
    d = session_path(bot_id)
    if not any(d.glob("*.db")) and not any(d.iterdir()):
        logger.warning("No session files for bot %s", bot_id)
        return False
    start_task: Optional[asyncio.Task] = None
    client = None
    try:
        client = WebClient(work_dir=str(d), session_name="web.db")
        start = getattr(client, "start", None)
        if start is None:
            return False
        ready = bind_client_ready(client)
        result = start()
        if not asyncio.iscoroutine(result):
            raise RuntimeError("PyMax start() is not awaitable")
        start_task = asyncio.create_task(result)
        await wait_client_ready(client, ready, start_task, CLIENT_READY_TIMEOUT_SEC)
        live_clients[bot_id] = client
        client_tasks[bot_id] = start_task
        _ensure_listener(bot_id, client)
        logger.info("Restored MAX session botId=%s", bot_id)
        return True
    except Exception:
        logger.exception("Failed to restore bot %s", bot_id)
        if start_task and not start_task.done():
            start_task.cancel()
        await close_client(client)
        return False


@app.on_event("startup")
async def on_startup() -> None:
    if not SERVICE_TOKEN:
        logger.warning("VOXLY_SERVICE_TOKEN empty — bridge will reject calls")
    if not PYMAX_AVAILABLE:
        logger.warning("PyMax missing — QR/send will return 503 until installed")
        return
    try:
        data = await saas_fetch("/api/internal/max/bots/active")
        for bot in data.get("bots") or []:
            bot_id = str(bot.get("botId") or "")
            if bot_id:
                asyncio.create_task(_restore_bot(bot_id))
    except Exception:
        logger.exception("Failed to list active MAX bots on startup")


@app.exception_handler(HTTPException)
async def http_exc_handler(_request, exc: HTTPException):
    detail = exc.detail
    if isinstance(detail, dict):
        return JSONResponse(status_code=exc.status_code, content={"ok": False, **detail})
    return JSONResponse(
        status_code=exc.status_code,
        content={"ok": False, "error": str(detail)},
    )
