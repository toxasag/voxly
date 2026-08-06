"""Voxly max-bridge — FastAPI sidecar for personal MAX (PyMax)."""

from __future__ import annotations

import asyncio
import io
import logging
import os
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
    status: str = "preparing"  # preparing|qr_ready|waiting_password|authorized|error
    tenant_id: str = ""
    name: str = "default"
    qr_url: Optional[str] = None
    error: Optional[str] = None
    bot_id: Optional[str] = None
    user: Optional[dict] = None
    password_future: Optional[asyncio.Future] = field(default=None, repr=False)
    task: Optional[asyncio.Task] = field(default=None, repr=False)
    client: Any = field(default=None, repr=False)


# key = f"{tenantId}:{name}"
qr_states: dict[str, QrState] = {}
# botInstanceId → live client
live_clients: dict[str, Any] = {}
# botInstanceId → asyncio task listening for messages
listener_tasks: dict[str, asyncio.Task] = {}


def qr_key(tenant_id: str, name: str) -> str:
    return f"{tenant_id}:{name}"


def session_path(bot_id: str) -> Path:
    d = SESSION_DIR / bot_id
    d.mkdir(parents=True, exist_ok=True)
    return d


class BridgeQrHandler:
    """PyMax QrHandler: only surfaces qr_url to HTTP state (does not confirm)."""

    def __init__(self, state: QrState) -> None:
        self.state = state

    async def show_qr(self, qr_url: str) -> None:
        self.state.qr_url = qr_url
        self.state.status = "qr_ready"
        logger.info("QR ready for %s/%s", self.state.tenant_id, self.state.name)


class BridgePasswordProvider:
    """Waits for POST /auth/qr/password to resolve 2FA."""

    def __init__(self, state: QrState) -> None:
        self.state = state

    async def get_password(self, hint: str | None = None) -> str:
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
    prev = qr_states.get(key)
    if prev and prev.task and not prev.task.done():
        prev.task.cancel()

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
        raise HTTPException(400, detail="No pending password challenge")
    state.status = "processing_password"
    state.password_future.set_result(body.password)
    return {"ok": True, "status": state.status}


async def _run_qr_login(state: QrState) -> None:
    assert WebClient is not None
    work = session_path(f"pending-{state.tenant_id}-{state.name}")
    qr_handler = BridgeQrHandler(state)
    password_provider = BridgePasswordProvider(state)

    client = None
    try:
        # Prefer qr_provider + password provider if supported by installed PyMax.
        kwargs: dict[str, Any] = {
            "work_dir": str(work),
            "session_name": "web.db",
            "qr_provider": qr_handler,
        }
        try:
            from pymax import QrAuthFlow  # type: ignore

            kwargs["auth_flow"] = QrAuthFlow(qr_handler, password_provider)
        except Exception:
            pass

        client = WebClient(**kwargs)
        state.client = client

        # start() runs auth + event loop; on success session is on disk.
        start = getattr(client, "start", None)
        if start is None:
            raise RuntimeError("PyMax WebClient has no start()")

        # Run blocking/async start; many versions expose async start.
        result = start()
        if asyncio.iscoroutine(result):
            await result

        me = None
        for attr in ("me", "get_me", "get_self"):
            fn = getattr(client, attr, None)
            if fn is None:
                continue
            try:
                me = await fn() if asyncio.iscoroutinefunction(fn) else fn
                if asyncio.iscoroutine(me):
                    me = await me
                break
            except Exception:
                continue

        max_user_id = None
        username = None
        first_name = None
        if me is not None:
            max_user_id = str(
                getattr(me, "id", None)
                or getattr(me, "user_id", None)
                or getattr(me, "userId", None)
                or ""
            ) or None
            username = getattr(me, "username", None) or getattr(me, "nick", None)
            first_name = getattr(me, "first_name", None) or getattr(me, "name", None)

        upsert = await saas_fetch(
            "/api/internal/max/bots/upsert",
            method="POST",
            json_body={
                "tenantId": state.tenant_id,
                "name": state.name,
                "maxUserId": max_user_id,
                "username": username,
                "firstName": first_name,
                "sessionReady": True,
            },
        )
        bot_id = str(upsert.get("botId") or "")
        if not bot_id:
            raise RuntimeError("bots/upsert did not return botId")

        # Move pending session dir → bot_id
        final_dir = session_path(bot_id)
        for src in work.glob("*"):
            dest = final_dir / src.name
            if dest.exists():
                dest.unlink()
            src.replace(dest)

        state.bot_id = bot_id
        state.user = {
            "id": max_user_id or bot_id,
            "username": username,
            "firstName": first_name,
        }
        state.status = "authorized"
        live_clients[bot_id] = client
        _ensure_listener(bot_id, client)
        logger.info("MAX authorized botId=%s user=%s", bot_id, max_user_id)
    except asyncio.CancelledError:
        state.status = "error"
        state.error = "cancelled"
        raise
    except Exception as exc:
        logger.exception("QR login failed")
        state.status = "error"
        state.error = str(exc)
        if client is not None:
            try:
                stop = getattr(client, "stop", None) or getattr(client, "disconnect", None)
                if stop:
                    r = stop()
                    if asyncio.iscoroutine(r):
                        await r
            except Exception:
                pass


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
            # decorator form: @client.on_message
            try:
                maybe = handler(on_msg)
                if asyncio.iscoroutine(maybe):
                    await maybe
                logger.info("Attached on_message for %s", bot_id)
            except TypeError:
                # register form: add_message_handler(cb)
                handler(on_msg)
                logger.info("Registered add_message_handler for %s", bot_id)
    except Exception:
        logger.exception("listener setup failed botId=%s", bot_id)


@app.post("/messages/send")
async def messages_send(
    body: SendBody,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    require_auth(authorization)
    client = live_clients.get(body.botId)
    if client is None:
        # Try restore from session
        restored = await _restore_bot(body.botId)
        if not restored:
            raise HTTPException(404, detail="MAX session not connected")
        client = live_clients.get(body.botId)
    if client is None:
        raise HTTPException(404, detail="MAX session not connected")

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
    client = live_clients.pop(bot_id, None)
    if client is not None:
        try:
            stop = getattr(client, "stop", None) or getattr(client, "disconnect", None)
            if stop:
                r = stop()
                if asyncio.iscoroutine(r):
                    await r
        except Exception:
            pass
    # Wipe session files
    d = SESSION_DIR / bot_id
    if d.exists():
        for f in d.glob("*"):
            try:
                f.unlink()
            except OSError:
                pass
        try:
            d.rmdir()
        except OSError:
            pass
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
    try:
        client = WebClient(work_dir=str(d), session_name="web.db")
        start = getattr(client, "start", None)
        if start:
            result = start()
            if asyncio.iscoroutine(result):
                await result
        live_clients[bot_id] = client
        _ensure_listener(bot_id, client)
        logger.info("Restored MAX session botId=%s", bot_id)
        return True
    except Exception:
        logger.exception("Failed to restore bot %s", bot_id)
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
