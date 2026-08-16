"""Voxly max-bridge — FastAPI sidecar for personal MAX (PyMax)."""

from __future__ import annotations

import asyncio
import base64
import hmac
import io
import logging
import os
import re
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
SAAS_API_URL = (os.environ.get("SAAS_API_URL") or "http://saas-api:3002").rstrip("/")
SESSION_DIR = Path(os.environ.get("MAX_SESSION_DIR") or "/data/max-sessions")
SESSION_DIR.mkdir(parents=True, exist_ok=True)

# Outbound media cap (mirrors gramjs-bridge OUTBOUND_MEDIA_MAX_BYTES).
OUTBOUND_MEDIA_MAX_BYTES = 20 * 1024 * 1024

try:
    from pymax import WebClient  # type: ignore

    PYMAX_AVAILABLE = True
except Exception as exc:  # pragma: no cover - optional at build/dev
    WebClient = None  # type: ignore
    PYMAX_AVAILABLE = False
    logger.warning("PyMax not available: %s", exc)

app = FastAPI(title="Voxly MAX bridge", version="0.1.0")


def _service_token_env_name(service: str) -> str:
    suffix = re.sub(r"[^A-Z0-9]+", "_", (service or "").upper()).strip("_")
    return f"VOXLY_TOKEN_{suffix}"


def resolve_service_token(target_service: str) -> str:
    """Outbound: token to reach target_service (per-service, fallback shared)."""
    return (
        os.environ.get(_service_token_env_name(target_service), "").strip()
        or os.environ.get("VOXLY_SERVICE_TOKEN", "").strip()
    )


def _self_tokens() -> list:
    """Inbound: accept our per-service token or the shared token (migration)."""
    out = []
    per = os.environ.get(_service_token_env_name("max-bridge"), "").strip()
    if per:
        out.append(per)
    shared = os.environ.get("VOXLY_SERVICE_TOKEN", "").strip()
    if shared:
        out.append(shared)
    return out


def require_auth(authorization: Optional[str]) -> None:
    candidates = _self_tokens()
    if not candidates:
        raise HTTPException(503, detail="service token not configured")
    presented = ""
    if authorization and authorization.startswith("Bearer "):
        presented = authorization[len("Bearer "):].strip()
    # constant-time compare against each candidate; no early exit.
    # Compare bytes to avoid compare_digest TypeError on non-ASCII input.
    presented_b = presented.encode("utf-8", "ignore")
    ok = False
    for c in candidates:
        ok = hmac.compare_digest(presented_b, c.encode("utf-8", "ignore")) or ok
    if not presented or not ok:
        raise HTTPException(401, detail="Unauthorized")


async def saas_fetch(path: str, method: str = "GET", json_body: Any = None) -> dict:
    headers = {
        "Authorization": f"Bearer {resolve_service_token('saas-api')}",
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


def _unwrap_max_user(obj: Any) -> Any:
    """PyMax WebClient.me is often a wrapper; User lives on .contact."""
    if obj is None:
        return None
    contact = getattr(obj, "contact", None)
    return contact if contact is not None else obj


def _user_id_int(user: Any) -> Optional[int]:
    u = _unwrap_max_user(user)
    if u is None:
        return None
    raw = (
        getattr(u, "id", None)
        or getattr(u, "user_id", None)
        or getattr(u, "userId", None)
    )
    try:
        return int(raw) if raw is not None else None
    except Exception:
        return None


def _phone_digits(raw: Any) -> str:
    return "".join(ch for ch in str(raw or "") if ch.isdigit())


def _phones_likely_same(a: Any, b: Any) -> bool:
    """Exact digits or last-10 match (INC-113 owner-phone leak guard)."""
    da = _phone_digits(a)
    db = _phone_digits(b)
    if not da or not db or len(da) < 10 or len(db) < 10:
        return False
    if da == db:
        return True
    return da[-10:] == db[-10:]


def _is_bot_user(user: Any) -> bool:
    """Best-effort: PyMax User has no is_bot in 2.3–2.4."""
    u = _unwrap_max_user(user)
    if u is None:
        return False
    if getattr(u, "is_bot", None) is True:
        return True
    for o in getattr(u, "options", None) or []:
        s = str(getattr(o, "value", o) or "").upper()
        if "BOT" in s and "ONEME" not in s:
            return True
    return False


def _find_chat(client: Any, chat_id: Any) -> Any:
    if chat_id is None:
        return None
    try:
        want = int(chat_id)
    except Exception:
        return None
    for c in list(getattr(client, "chats", None) or []):
        try:
            if int(getattr(c, "id", 0)) == want:
                return c
        except Exception:
            continue
    return None


def _peer_user_id_from_chat(chat: Any, me_id: Optional[int]) -> Optional[int]:
    """Other participant in a DIALOG (not me)."""
    if chat is None:
        return None
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
        if uid_i == 0:
            continue
        return uid_i
    return None


def profile_from_me(me: Any) -> tuple[Optional[str], Optional[str], Optional[str]]:
    u = _unwrap_max_user(me)
    if u is None:
        return None, None, None
    uid = _user_id_int(u)
    max_user_id = str(uid) if uid is not None else None
    first_name, username = _user_display_name(u)
    if not first_name:
        first_name = getattr(u, "first_name", None) or getattr(u, "name", None)
        if first_name is not None:
            first_name = str(first_name).strip() or None
    if not username:
        username = getattr(u, "username", None) or getattr(u, "nick", None)
        if username is not None:
            username = str(username).strip() or None
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
    peerUserId: str = Field("", description="MAX peer / chat id")
    text: str = ""
    replyTo: Optional[str] = None
    mediaBase64: Optional[str] = None
    mimeType: Optional[str] = None
    fileName: Optional[str] = None
    # Phase 5.2 write-first: no prior dialog — resolve the peer from this E.164 phone
    # (search_by_phone → import_contacts) before sending. Used only when peerUserId is empty.
    resolvePhone: Optional[str] = None


class MediaBody(BaseModel):
    botId: str
    fileId: str


class ReadBody(BaseModel):
    botId: str
    peerUserId: str
    messageIds: list[str] = Field(default_factory=list)


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


async def _resolve_dialog_chat_id(
    client: Any, me_id: Optional[int], user_id: int
) -> Optional[int]:
    """USER id → DIALOG chat id (send_message needs the chat, not the user).

    PyMax get_chat_id is a LOCAL sync formula: chat_id = me ^ user (XOR).
    add_contact runs first (network) so a never-chatted contact becomes
    addressable. Returns None only when the id cannot be computed.
    """
    get_chat_id_fn = getattr(client, "get_chat_id", None)
    if not callable(get_chat_id_fn):
        return None

    if me_id is None:
        try:
            me = await resolve_me(client)
            me_id = _user_id_int(me)
        except Exception as exc:
            logger.info("resolve_me for dialog chat failed: %s", exc)
            return None
    if me_id is None:
        return None

    add_fn = getattr(client, "add_contact", None)
    if callable(add_fn):
        try:
            await add_fn(user_id)
        except Exception as exc:
            logger.info(
                "add_contact user=%s failed (continuing): %s", user_id, exc
            )

    try:
        result = get_chat_id_fn(me_id, user_id)
        if asyncio.iscoroutine(result):
            result = await result
        return int(result) if result is not None else None
    except Exception as exc:
        logger.info(
            "get_chat_id me=%s user=%s failed: %s", me_id, user_id, exc
        )
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


def _attach_type_name(attach: Any) -> str:
    t = getattr(attach, "type", None)
    if t is None:
        return type(attach).__name__.upper()
    return str(getattr(t, "value", t) or type(attach).__name__).upper()


def _crm_type_for_attach(type_name: str) -> Optional[str]:
    if "PHOTO" in type_name:
        return "photo"
    if "VIDEO" in type_name:
        return "video"
    if "AUDIO" in type_name or "VOICE" in type_name:
        return "voice"
    if "STICKER" in type_name:
        return "sticker"
    if "FILE" in type_name or "DOCUMENT" in type_name:
        return "document"
    return None


def _placeholder_for_crm_type(crm_type: str, file_name: Optional[str] = None) -> str:
    if crm_type == "photo":
        return "[фото]"
    if crm_type == "video":
        return "[видео]"
    if crm_type == "voice":
        return "[голосовое]"
    if crm_type == "audio":
        return "[аудио]"
    if crm_type == "sticker":
        return "[стикер]"
    if file_name:
        return f"[файл: {file_name}]"
    return "[файл]"


def _extract_inbound_attachments(msg: Any, chat_id: Any) -> list[dict[str, Any]]:
    """Serialize PyMax message.attaches for CRM ChatMessage.attachments."""
    attaches = getattr(msg, "attaches", None) or []
    mid = getattr(msg, "id", None) or getattr(msg, "message_id", None)
    if mid is None or chat_id is None:
        return []
    mid_s = str(mid)
    chat_s = str(chat_id)
    out: list[dict[str, Any]] = []
    for attach in attaches:
        type_name = _attach_type_name(attach)
        crm_type = _crm_type_for_attach(type_name)
        if not crm_type:
            continue
        native_id: Any = None
        file_name: Optional[str] = None
        mime: Optional[str] = None
        url: Optional[str] = None
        size: Optional[int] = None
        kind_key = crm_type
        if crm_type == "photo":
            native_id = getattr(attach, "photo_id", None)
            url = getattr(attach, "base_url", None)
            mime = "image/jpeg"
            kind_key = "photo"
        elif crm_type == "video":
            native_id = getattr(attach, "video_id", None)
            mime = "video/mp4"
            kind_key = "video"
        elif crm_type == "voice":
            native_id = getattr(attach, "audio_id", None)
            url = getattr(attach, "url", None)
            mime = "audio/ogg"
            kind_key = "audio"
        elif crm_type == "sticker":
            native_id = getattr(attach, "sticker_id", None)
            url = getattr(attach, "url", None) or getattr(attach, "lottie_url", None)
            mime = "image/webp"
            kind_key = "sticker"
        else:
            native_id = getattr(attach, "file_id", None)
            name = getattr(attach, "name", None)
            file_name = str(name).strip() if name else None
            size_raw = getattr(attach, "size", None)
            try:
                size = int(size_raw) if size_raw is not None else None
            except Exception:
                size = None
            if file_name and "." in file_name:
                ext = file_name.rsplit(".", 1)[-1].lower()
                if ext in ("pdf",):
                    mime = "application/pdf"
                elif ext in ("doc", "docx"):
                    mime = "application/msword"
                elif ext in ("png", "jpg", "jpeg", "webp", "gif"):
                    mime = f"image/{'jpeg' if ext in ('jpg', 'jpeg') else ext}"
                    crm_type = "photo"
            kind_key = "file"
        if native_id is None and not url:
            continue
        # All id segments as strings — avoid JSON number precision loss.
        file_id = (
            f"max:{chat_s}:{mid_s}:{kind_key}:"
            f"{native_id if native_id is not None else 'url'}"
        )
        item: dict[str, Any] = {
            "type": crm_type,
            "fileId": file_id,
        }
        if file_name:
            item["fileName"] = file_name
        if mime:
            item["mimeType"] = mime
        if size is not None:
            item["fileSize"] = size
        if isinstance(url, str) and url.strip():
            item["url"] = url.strip()
        out.append(item)
    return out


def _message_text(msg: Any, attachments: Optional[list[dict[str, Any]]] = None) -> str:
    text = getattr(msg, "text", None) or ""
    if not isinstance(text, str):
        text = str(text or "")
    text = text.strip()
    if text:
        return text
    atts = attachments if attachments is not None else _extract_inbound_attachments(
        msg, getattr(msg, "chat_id", None) or getattr(msg, "peer_id", None)
    )
    if atts:
        first = atts[0]
        return _placeholder_for_crm_type(
            str(first.get("type") or "document"),
            first.get("fileName") if isinstance(first.get("fileName"), str) else None,
        )
    attaches = getattr(msg, "attaches", None) or []
    if attaches:
        kinds: list[str] = []
        for a in attaches:
            kinds.append(_attach_type_name(a))
        return f"[media:{','.join(kinds[:3])}]" if kinds else "[media]"
    return ""


def _parse_max_file_id(file_id: str) -> Optional[dict[str, str]]:
    # max:{chatId}:{messageId}:{kind}:{nativeId}
    if not file_id.startswith("max:"):
        return None
    parts = file_id.split(":")
    if len(parts) < 5:
        return None
    return {
        "chatId": parts[1],
        "messageId": parts[2],
        "kind": parts[3],
        "nativeId": ":".join(parts[4:]),
    }


def _is_placeholder_native(native: str) -> bool:
    """Outbound CRM fileIds use nativeId=out|local until real attach id is known."""
    return native in ("out", "local")


def _crm_kind_matches(kind: str, crm_type: Optional[str]) -> bool:
    if not crm_type:
        return False
    if kind == "photo":
        return crm_type == "photo"
    if kind == "video":
        return crm_type == "video"
    if kind == "file":
        return crm_type == "document"
    if kind == "audio":
        return crm_type == "voice"
    if kind == "sticker":
        return crm_type == "sticker"
    return False


def _native_id_from_attach(attach: Any, crm_type: str) -> Optional[str]:
    if crm_type == "photo":
        v = getattr(attach, "photo_id", None)
    elif crm_type == "video":
        v = getattr(attach, "video_id", None)
    elif crm_type == "voice":
        v = getattr(attach, "audio_id", None)
    elif crm_type == "sticker":
        v = getattr(attach, "sticker_id", None)
    else:
        v = getattr(attach, "file_id", None)
    return str(v) if v is not None else None


async def _url_for_attach(
    client: Any,
    chat_id: int,
    message_id: str,
    attach: Any,
    crm_type: str,
) -> tuple[Optional[str], str]:
    """Resolve CDN URL + default mime for one PyMax attach."""
    mime = "application/octet-stream"
    url: Optional[str] = None
    try:
        mid: Any = int(message_id)
    except Exception:
        mid = message_id

    if crm_type == "photo":
        mime = "image/jpeg"
        url = getattr(attach, "base_url", None)
    elif crm_type == "video":
        mime = "video/mp4"
        native = _native_id_from_attach(attach, "video")
        get_video = getattr(client, "get_video_by_id", None)
        if callable(get_video) and native:
            try:
                info = await get_video(
                    chat_id=chat_id,
                    message_id=mid,
                    video_id=int(native),
                )
                url = getattr(info, "url", None) if info is not None else None
            except Exception:
                url = None
        if not url:
            url = getattr(attach, "url", None) or getattr(attach, "base_url", None)
    elif crm_type == "document":
        native = _native_id_from_attach(attach, "document")
        get_file = getattr(client, "get_file_by_id", None)
        if callable(get_file) and native:
            try:
                info = await get_file(
                    chat_id=chat_id,
                    message_id=mid,
                    file_id=int(native),
                )
                url = getattr(info, "url", None) if info is not None else None
            except Exception:
                url = None
        if not url:
            url = getattr(attach, "url", None)
        name = getattr(attach, "name", None)
        if isinstance(name, str) and name.lower().endswith(
            (".mp4", ".mov", ".webm", ".mkv")
        ):
            mime = "video/mp4"
    elif crm_type == "voice":
        mime = "audio/ogg"
        url = getattr(attach, "url", None)
    elif crm_type == "sticker":
        mime = "image/webp"
        url = getattr(attach, "url", None) or getattr(attach, "lottie_url", None)
    return (str(url) if url else None), mime


async def _resolve_media_from_message(
    client: Any,
    chat_id: int,
    message_id: str,
    kind: str,
) -> tuple[Optional[str], str]:
    """Outbound fileIds end with :out — resolve real attach from the sent message."""
    msg = await _get_message_any(client, chat_id, message_id)
    if msg is None:
        return None, "application/octet-stream"
    attaches = list(getattr(msg, "attaches", None) or [])
    if not attaches:
        return None, "application/octet-stream"

    preferred: list[Any] = []
    fallback: list[Any] = []
    for a in attaches:
        crm = _crm_type_for_attach(_attach_type_name(a))
        if _crm_kind_matches(kind, crm):
            preferred.append(a)
        elif kind in ("video", "file") and crm in ("video", "document"):
            # Outbound may store Video as File (octet-stream mime) or vice versa.
            fallback.append(a)
        elif crm in ("photo", "video", "document", "voice", "sticker"):
            fallback.append(a)

    for a in preferred + fallback:
        crm = _crm_type_for_attach(_attach_type_name(a)) or "document"
        url, mime = await _url_for_attach(client, chat_id, message_id, a, crm)
        if url:
            if kind == "video" or (
                isinstance(getattr(a, "name", None), str)
                and str(a.name).lower().endswith((".mp4", ".mov", ".webm", ".mkv"))
            ):
                if not mime.startswith("video/"):
                    mime = "video/mp4"
            return url, mime
    return None, "application/octet-stream"


def _classify_outbound_upload(
    mime: str, name: str
) -> tuple[str, str]:
    """Return (crm_type, effective_mime). Prefer extension when browser sends octet-stream."""
    mime_l = (mime or "application/octet-stream").lower()
    name_l = (name or "").lower()
    if mime_l.startswith("image/") and not mime_l.endswith("svg+xml"):
        return "photo", mime_l
    if mime_l.startswith("video/") or name_l.endswith(
        (".mp4", ".mov", ".webm", ".mkv")
    ):
        return "video", mime_l if mime_l.startswith("video/") else "video/mp4"
    if mime_l.startswith("audio/") and (
        "ogg" in mime_l or name_l.endswith(".ogg")
    ):
        return "voice", mime_l if "ogg" in mime_l else "audio/ogg"
    if name_l.endswith((".jpg", ".jpeg", ".png", ".gif", ".webp")):
        ext = name_l.rsplit(".", 1)[-1]
        return "photo", f"image/{'jpeg' if ext in ('jpg', 'jpeg') else ext}"
    return "document", mime_l


def _attachment_meta_from_send_result(
    result: Any, chat_id: Any, fallback: dict[str, Any]
) -> dict[str, Any]:
    """Prefer real native attach id from send_message result (inbound-compatible fileId)."""
    meta = dict(fallback)
    kind = {
        "photo": "photo",
        "video": "video",
        "voice": "audio",
        "document": "file",
    }.get(str(meta.get("type")), "file")
    mid = getattr(result, "id", None) if result is not None else None
    attaches = list(getattr(result, "attaches", None) or []) if result is not None else []
    for a in attaches:
        crm = _crm_type_for_attach(_attach_type_name(a))
        if not crm:
            continue
        if not _crm_kind_matches(kind, crm) and not (
            kind in ("video", "file") and crm in ("video", "document")
        ):
            continue
        native = _native_id_from_attach(a, crm)
        if not native:
            continue
        kind_key = (
            "file"
            if crm == "document"
            else ("audio" if crm == "voice" else crm)
        )
        # Keep CRM type=video when we uploaded a video even if MAX stored FILE.
        if str(meta.get("type")) == "video" or crm == "video":
            meta["type"] = "video"
            if not str(meta.get("mimeType") or "").startswith("video/"):
                meta["mimeType"] = "video/mp4"
        elif crm == "voice":
            meta["type"] = "voice"
        elif crm == "photo":
            meta["type"] = "photo"
        else:
            meta["type"] = "document"
        meta["fileId"] = f"max:{chat_id}:{mid}:{kind_key}:{native}"
        name = getattr(a, "name", None)
        if isinstance(name, str) and name.strip() and not meta.get("fileName"):
            meta["fileName"] = name.strip()
        return meta
    if mid is not None:
        meta["fileId"] = f"max:{chat_id}:{mid}:{kind}:out"
    else:
        meta["fileId"] = f"max:{chat_id}:out:{kind}:local"
    return meta


# okcdn.ru signs CDN URLs with srcAg=CHROME — default httpx UA → HTTP 400
# (regular MAX video files). Do not send Origin (also → 400). Circle/voice use
# oneme.ru and tolerate either UA; Chrome is safe for both.
_MAX_CDN_HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
}


async def _http_get_bytes(url: str) -> tuple[bytes, Optional[str]]:
    async with httpx.AsyncClient(
        timeout=60.0,
        follow_redirects=True,
        headers=_MAX_CDN_HTTP_HEADERS,
    ) as client:
        res = await client.get(url)
        res.raise_for_status()
        ctype = res.headers.get("content-type")
        return res.content, ctype


async def _get_message_any(client: Any, chat_id: int, message_id: str) -> Any:
    get_msg = getattr(client, "get_message", None)
    if not callable(get_msg):
        return None
    try:
        mid_int = int(message_id)
    except Exception:
        mid_int = None
    # PyMax WebClient get_message expects int; try int then str.
    for mid in (mid_int, message_id):
        if mid is None:
            continue
        try:
            msg = await get_msg(chat_id=chat_id, message_id=mid)
            if msg is not None:
                return msg
        except Exception:
            continue
    return None


async def _download_max_attachment(client: Any, file_id: str) -> dict[str, Any]:
    parsed = _parse_max_file_id(file_id)
    if not parsed:
        raise HTTPException(400, detail="invalid max fileId")
    chat_id = int(parsed["chatId"])
    message_id = parsed["messageId"]
    kind = parsed["kind"]
    native = parsed["nativeId"]

    # CRM outbound stores max:{chat}:{mid}:{kind}:out — resolve via message.attaches
    # (native "out" is not a MAX video_id/file_id; int("out") would 502 → UI «скачать»).
    if message_id == "out" or kind == "out":
        # Legacy max:{chat}:out:{kind}:local — no real message id to fetch.
        raise HTTPException(
            404, detail="outbound MAX media preview unavailable (no message id)"
        )
    if _is_placeholder_native(native):
        url, mime = await _resolve_media_from_message(client, chat_id, message_id, kind)
        if not url:
            raise HTTPException(404, detail="outbound MAX media URL not available")
        data, ctype = await _http_get_bytes(str(url))
        if not data:
            raise HTTPException(404, detail="MAX media empty")
        return {
            "ok": True,
            "dataBase64": base64.b64encode(data).decode("ascii"),
            "mimeType": (ctype.split(";")[0].strip() if ctype else mime) or mime,
            "fileId": file_id,
        }

    url: Optional[str] = None
    mime = "application/octet-stream"
    if kind == "photo":
        mime = "image/jpeg"
        msg = await _get_message_any(client, chat_id, message_id)
        for a in getattr(msg, "attaches", None) or []:
            if _crm_type_for_attach(_attach_type_name(a)) != "photo":
                continue
            pid = getattr(a, "photo_id", None)
            if native != "url" and pid is not None and str(pid) != str(native):
                continue
            url = getattr(a, "base_url", None)
            if url:
                break
        if not url and msg is not None:
            for a in getattr(msg, "attaches", None) or []:
                if _crm_type_for_attach(_attach_type_name(a)) == "photo":
                    url = getattr(a, "base_url", None)
                    if url:
                        break
    elif kind == "file":
        get_file = getattr(client, "get_file_by_id", None)
        if callable(get_file) and native != "url":
            try:
                mid: Any = int(message_id)
            except Exception:
                mid = message_id
            try:
                info = await get_file(
                    chat_id=chat_id,
                    message_id=mid,
                    file_id=int(native),
                )
                url = getattr(info, "url", None) if info is not None else None
            except Exception:
                url = None
            mime = "application/octet-stream"
    elif kind == "video":
        mime = "video/mp4"
        get_video = getattr(client, "get_video_by_id", None)
        if callable(get_video) and native != "url":
            try:
                mid = int(message_id)
            except Exception:
                mid = message_id
            try:
                info = await get_video(
                    chat_id=chat_id,
                    message_id=mid,
                    video_id=int(native),
                )
                url = getattr(info, "url", None) if info is not None else None
            except Exception:
                url = None
    elif kind in ("audio", "sticker"):
        mime = "audio/ogg" if kind == "audio" else "image/webp"
        msg = await _get_message_any(client, chat_id, message_id)
        for a in getattr(msg, "attaches", None) or []:
            crm = _crm_type_for_attach(_attach_type_name(a))
            if (kind == "audio" and crm == "voice") or (
                kind == "sticker" and crm == "sticker"
            ):
                url = getattr(a, "url", None) or getattr(a, "lottie_url", None)
                if url:
                    break
    else:
        raise HTTPException(400, detail=f"unsupported max media kind: {kind}")

    if not url:
        msg = await _get_message_any(client, chat_id, message_id)
        for a in getattr(msg, "attaches", None) or []:
            for attr in ("photo_id", "file_id", "video_id", "audio_id", "sticker_id"):
                if str(getattr(a, attr, None)) == str(native):
                    url = (
                        getattr(a, "base_url", None)
                        or getattr(a, "url", None)
                        or getattr(a, "lottie_url", None)
                    )
                    break
            if url:
                break

    # Last resort: treat as outbound-style lookup by message attaches.
    if not url:
        url, mime_fallback = await _resolve_media_from_message(
            client, chat_id, message_id, kind
        )
        if url and mime == "application/octet-stream":
            mime = mime_fallback

    if not url:
        raise HTTPException(404, detail="MAX media URL not available")

    data, ctype = await _http_get_bytes(str(url))
    if not data:
        raise HTTPException(404, detail="MAX media empty")

    return {
        "ok": True,
        "dataBase64": base64.b64encode(data).decode("ascii"),
        "mimeType": (ctype.split(";")[0].strip() if ctype else mime) or mime,
        "fileId": file_id,
    }


def _is_session_auth_error(exc: BaseException) -> bool:
    """True when MAX/PyMax reports login/session token death (needs restore or re-QR)."""
    text = str(exc) or ""
    err_code = getattr(exc, "error", None)
    msg = getattr(exc, "message", None)
    parts = " ".join(str(p) for p in (text, err_code, msg) if p)
    return bool(
        re.search(
            r"token has expired|FAIL_LOGIN_TOKEN|FAIL_LOGOUT_ALL|login.?token|session.*(expired|invalid)|unauthorized",
            parts,
            re.I,
        )
    )


def _is_rate_limit_error(exc: BaseException) -> bool:
    """True when MAX/PyMax reports a rate limit / flood (transient — retry after backoff)."""
    text = str(exc) or ""
    err_code = getattr(exc, "error", None)
    msg = getattr(exc, "message", None)
    parts = " ".join(str(p) for p in (text, err_code, msg) if p).lower()
    return any(
        token in parts
        for token in (
            "rate limit",
            "rate-limit",
            "too many requests",
            "flood",
            "slow down",
            "429",
            "limit exceeded",
            "превышен",
        )
    )


SESSION_AUTH_RU = (
    "Сессия MAX истекла. Откройте /dashboard/ai/max → Показать QR "
    "и заново привяжите устройство (Devices в MAX)."
)


async def _drop_live_client(bot_id: str) -> None:
    """Forget in-memory client so the next ensure restores from session DB."""
    task = listener_tasks.pop(bot_id, None)
    if task and not task.done():
        task.cancel()
    ct = client_tasks.pop(bot_id, None)
    if ct and not ct.done():
        ct.cancel()
    client = live_clients.pop(bot_id, None)
    await close_client(client)


async def _ensure_live_client(bot_id: str, *, force_restore: bool = False) -> Any:
    if force_restore:
        await _drop_live_client(bot_id)
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

        # PyMax 2.3+/2.4: callback(event, client) — see Message docstring / Dispatcher._call.
        async def on_msg(message: Any, event_client: Any = None) -> None:
            try:
                api = event_client if event_client is not None else client
                # Outgoing messages from the connected MAX app are CRM events too.
                # Do not feed them through inbound/AI; forward as operator outbound.
                is_outgoing = bool(
                    getattr(message, "out", False) or getattr(message, "is_out", False)
                )
                sender = getattr(message, "sender", None)
                # CRITICAL: client.me is often a wrapper — User is on .contact (INC-113).
                me_user = _unwrap_max_user(getattr(api, "me", None))
                me_id = _user_id_int(me_user)
                me_phone = _phone_digits(getattr(me_user, "phone", None) if me_user else None)
                try:
                    sender_id = int(sender) if sender is not None else None
                except Exception:
                    sender_id = None
                if (
                    not is_outgoing
                    and me_id is not None
                    and sender_id is not None
                    and sender_id == me_id
                ):
                    return

                peer = (
                    getattr(message, "chat_id", None)
                    or getattr(message, "peer_id", None)
                    or getattr(getattr(message, "chat", None), "id", None)
                    or sender_id
                )
                if peer is None:
                    return
                try:
                    peer_i = int(peer)
                except Exception:
                    peer_i = None
                # Channels/groups use negative ids; never create CRM leads from them.
                if peer_i is not None and peer_i < 0:
                    logger.info(
                        "skip non-private inbound (negative chat id) botId=%s chat=%s",
                        bot_id,
                        peer,
                    )
                    return

                chat_obj = getattr(message, "chat", None) or _find_chat(api, peer)
                chat_type = _chat_type_value(chat_obj) if chat_obj is not None else ""
                if chat_type and chat_type != "DIALOG":
                    logger.info(
                        "skip non-dialog inbound type=%s botId=%s chat=%s",
                        chat_type,
                        bot_id,
                        peer,
                    )
                    return

                mid = getattr(message, "id", None) or getattr(message, "message_id", None)
                attachments = _extract_inbound_attachments(message, peer)
                text = _message_text(message, attachments)
                # Message.sender is user id (int), not a profile object.
                username = None
                first_name = None
                if sender is not None and not isinstance(sender, (int, str)):
                    username = getattr(sender, "username", None)
                    first_name = getattr(sender, "first_name", None) or getattr(sender, "name", None)
                phone: Optional[str] = None
                link: Optional[str] = None
                # Peer user id ≠ chat id (DIALOG chat_id is often a separate snowflake).
                peer_uid: Optional[int] = None
                if sender_id is not None and (me_id is None or sender_id != me_id):
                    peer_uid = sender_id
                if peer_uid is None:
                    peer_uid = _peer_user_id_from_chat(chat_obj, me_id)
                # Never treat chat_id as user id when it is not the other participant.
                if peer_uid is None:
                    logger.info(
                        "skip inbound without peer user botId=%s chat=%s",
                        bot_id,
                        peer,
                    )
                    return
                if me_id is not None and peer_uid == me_id:
                    return

                # Enrich peer profile for CRM merge-by-phone (DIALOG only).
                try:
                    get_user = getattr(api, "get_user", None)
                    if callable(get_user):
                        user = await get_user(peer_uid)
                        if user is not None:
                            if _is_bot_user(user):
                                logger.info(
                                    "skip bot MAX message botId=%s peerUser=%s chat=%s",
                                    bot_id,
                                    peer_uid,
                                    peer,
                                )
                                return
                            got_id = _user_id_int(user)
                            if (
                                not is_outgoing
                                and me_id is not None
                                and got_id is not None
                                and got_id == me_id
                            ):
                                return
                            fn, un = _user_display_name(user)
                            if fn and not first_name:
                                first_name = fn
                            if un and not username:
                                username = un
                            ph = getattr(user, "phone", None)
                            if ph is not None and str(ph).strip():
                                phone = str(ph).strip()
                            lk = _user_link(user)
                            if lk:
                                link = lk
                except Exception:
                    logger.debug("inbound get_user failed peer=%s", peer_uid, exc_info=True)

                # Never attach the connected account's own phone onto a peer lead.
                if phone and me_phone and _phones_likely_same(phone, me_phone):
                    phone = None

                # Strip ephemeral download URLs before persisting descriptors in control DB.
                attachments_out = [
                    {k: v for k, v in a.items() if k != "url"} for a in attachments
                ]
                await saas_fetch(
                    "/api/internal/max/outbound" if is_outgoing else "/api/internal/max/inbound",
                    method="POST",
                    json_body={
                        "botId": bot_id,
                        # Conversation key = chat id (send/read). Profile id = maxUserId.
                        "peerId": str(peer),
                        "maxUserId": str(peer_uid),
                        "chatType": chat_type or "DIALOG",
                        # MUST be string — MAX ids exceed JS Number.MAX_SAFE_INTEGER.
                        "text": text,
                        "messageId": str(mid) if mid is not None else None,
                        "username": username,
                        "firstName": first_name,
                        "phone": phone,
                        "selfPhone": me_phone or None,
                        "maxLink": link,
                        "attachments": attachments_out,
                    },
                )
                logger.info(
                    "%s forwarded botId=%s chat=%s peerUser=%s mid=%s attaches=%s",
                    "outbound" if is_outgoing else "inbound",
                    bot_id,
                    peer,
                    peer_uid,
                    mid,
                    len(attachments_out),
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
    me_user = _unwrap_max_user(getattr(client, "me", None))
    me_id = _user_id_int(me_user)
    me_phone_digits = _phone_digits(getattr(me_user, "phone", None) if me_user else None)
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
        # DIALOG chat_id ≠ user id (INC-113) — never use chat_id as profile id.
        try:
            if int(chat_id) < 0:
                continue
        except Exception:
            pass
        peer_user_id = _peer_user_id_from_chat(chat, me_id)

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
                if user is not None and _is_bot_user(user):
                    continue
                uid_got = _user_id_int(user)
                if me_id is not None and uid_got is not None and uid_got == me_id:
                    continue
                fn, un = _user_display_name(user)
                if fn:
                    first_name = fn
                if un:
                    username = un
                link = _user_link(user)
                ph = getattr(user, "phone", None)
                if ph is not None and str(ph).strip():
                    phone = str(ph).strip()
                    if me_phone_digits and _phones_likely_same(phone, me_phone_digits):
                        # Self / Saved-style — never sync as a lead.
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
                        atts = _extract_inbound_attachments(msg, chat_id)
                        text = _message_text(msg, atts)
                        messages_out.append(
                            {
                                # String id — MAX snowflakes exceed JS safe integer.
                                "id": str(mid),
                                "out": out,
                                "text": text,
                                "date": date_sec,
                                "attachments": [
                                    {k: v for k, v in a.items() if k != "url"}
                                    for a in atts
                                ],
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

    return {
        "ok": True,
        "dialogs": dialogs_out,
        "totalPrivate": len(private),
        # saas-api belt: never apply this phone onto peer Persons (INC-113).
        "selfPhone": me_phone_digits or None,
        "selfMaxUserId": str(me_id) if me_id is not None else None,
    }


@app.post("/messages/send")
async def messages_send(
    body: SendBody,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    require_auth(authorization)

    text = (body.text or "").strip()
    media_b64 = (body.mediaBase64 or "").strip()
    if not text and not media_b64:
        raise HTTPException(400, detail="text or mediaBase64 required")

    peer_raw = (body.peerUserId or "").strip()
    resolve_phone = (body.resolvePhone or "").strip()
    if not peer_raw and not resolve_phone:
        raise HTTPException(400, detail="peerUserId or resolvePhone required")

    # Phase 5.2 write-first: resolve peer by phone when CRM has no prior MAX dialog.
    if not peer_raw:
        resolver = await _ensure_live_client(body.botId)
        resolved = await _resolve_user_by_phone(resolver, resolve_phone)
        if resolved.get("error") == "bad_phone":
            raise HTTPException(400, detail="resolvePhone is not a valid phone")
        if not resolved.get("exists") or not resolved.get("userId"):
            raise HTTPException(
                404,
                detail="Контакт не найден в MAX по номеру телефона — написать первым нельзя.",
            )
        # Never write to ourselves: search_by_phone falls back to client.me on a
        # phone match, which would send the CRM reply into Saved Messages (INC-113).
        me_id = _user_id_int(getattr(resolver, "me", None))
        if me_id is not None and str(resolved["userId"]) == str(me_id):
            raise HTTPException(
                409,
                detail=(
                    "Телефон в карточке совпадает с номером подключённого MAX-аккаунта "
                    "— отправка самому себе заблокирована."
                ),
            )
        peer_raw = str(resolved["userId"])
        logger.info(
            "write-first resolved peer botId=%s peer=%s", body.botId, peer_raw
        )
        # MAX send_message requires a DIALOG chat id, not a bare user id:
        # passing the user id straight yields `common.finder User … not.found`.
        # Convert user → dialog chat via get_chat_id(me, user); add_contact
        # first so a never-chatted contact becomes addressable.
        dialog_chat = await _resolve_dialog_chat_id(
            resolver, me_id, int(peer_raw)
        )
        if dialog_chat is not None:
            logger.info(
                "write-first dialog chat botId=%s user=%s chat=%s",
                body.botId,
                peer_raw,
                dialog_chat,
            )
            peer_raw = str(dialog_chat)

    try:
        chat_id: Any
        try:
            chat_id = int(peer_raw)
        except Exception:
            chat_id = peer_raw

        attachments_arg: Optional[list[Any]] = None
        attachment_meta: Optional[dict[str, Any]] = None
        if media_b64:
            if len(media_b64) > OUTBOUND_MEDIA_MAX_BYTES * 4 // 3 + 8:
                raise HTTPException(
                    413,
                    detail=f"media too large (max {OUTBOUND_MEDIA_MAX_BYTES} bytes)",
                )
            raw = base64.b64decode(media_b64.split(",")[-1], validate=False)
            if not raw:
                raise HTTPException(400, detail="empty media")
            if len(raw) > OUTBOUND_MEDIA_MAX_BYTES:
                raise HTTPException(
                    413,
                    detail=f"media too large (max {OUTBOUND_MEDIA_MAX_BYTES} bytes)",
                )
            name = (body.fileName or "file.bin").strip() or "file.bin"
            crm_type, mime = _classify_outbound_upload(
                body.mimeType or "application/octet-stream", name
            )
            try:
                from pymax.files import File, Photo, Video, Voice  # type: ignore
            except Exception as exc:
                raise HTTPException(
                    501, detail=f"PyMax files API unavailable: {exc}"
                ) from exc

            upload_obj: Any
            if crm_type == "photo":
                upload_obj = Photo(raw=raw, name=name)
            elif crm_type == "video":
                upload_obj = Video(raw=raw, name=name)
            elif crm_type == "voice":
                upload_obj = Voice(
                    raw=raw,
                    name=name if name.endswith(".ogg") else f"{name}.ogg",
                )
            else:
                upload_obj = File(raw=raw, name=name)
            attachments_arg = [upload_obj]
            attachment_meta = {
                "type": crm_type,
                "fileName": name,
                "mimeType": mime,
                "fileSize": len(raw),
            }

        kwargs: dict[str, Any] = {"chat_id": chat_id}
        if text:
            kwargs["text"] = text
        if attachments_arg is not None:
            kwargs["attachments"] = attachments_arg

        last_exc: Optional[BaseException] = None
        result: Any = None
        for attempt in range(2):
            client = await _ensure_live_client(
                body.botId, force_restore=attempt > 0
            )
            send_fn = getattr(client, "send_message", None)
            if send_fn is None:
                raise HTTPException(501, detail="PyMax client has no send_message")
            try:
                result = send_fn(**kwargs)
                if asyncio.iscoroutine(result):
                    result = await result
                last_exc = None
                break
            except HTTPException:
                raise
            except Exception as exc:
                last_exc = exc
                if _is_rate_limit_error(exc):
                    wait_s = 1 + attempt * 4  # 1s → 5s
                    logger.warning(
                        "send rate-limited botId=%s attempt=%s waiting %ss: %s",
                        body.botId,
                        attempt,
                        wait_s,
                        exc,
                    )
                    await asyncio.sleep(wait_s)
                    continue
                if attempt == 0 and _is_session_auth_error(exc):
                    logger.warning(
                        "send auth error botId=%s — drop+restore once: %s",
                        body.botId,
                        exc,
                    )
                    await _drop_live_client(body.botId)
                    continue
                raise

        if last_exc is not None:
            raise last_exc

        # Prefer real attach id from send result; else max:…:out (resolved on media GET).
        if attachment_meta is not None:
            attachment_meta = _attachment_meta_from_send_result(
                result, chat_id, attachment_meta
            )

        logger.info(
            "message sent chat_id=%s text_len=%s media=%s fileId=%s",
            chat_id,
            len(text),
            bool(media_b64),
            (attachment_meta or {}).get("fileId"),
        )
        out: dict[str, Any] = {"ok": True, "chatId": str(chat_id)}
        if attachment_meta and attachment_meta.get("fileId"):
            out["attachment"] = attachment_meta
        return out
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("send failed")
        if _is_session_auth_error(exc):
            await _drop_live_client(body.botId)
            raise HTTPException(401, detail=SESSION_AUTH_RU) from exc
        raise HTTPException(502, detail=str(exc)) from exc


@app.post("/messages/media")
async def messages_media(
    body: MediaBody,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    """Download inbound MAX attachment for CRM signed-url preview."""
    require_auth(authorization)
    client = await _ensure_live_client(body.botId)
    try:
        return await _download_max_attachment(client, body.fileId)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("media download failed fileId=%s", body.fileId)
        raise HTTPException(502, detail=str(exc)) from exc


@app.post("/messages/read")
async def messages_read(
    body: ReadBody,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    """Mark MAX messages read in the native app (PyMax read_message)."""
    require_auth(authorization)
    client = await _ensure_live_client(body.botId)
    read_fn = getattr(client, "read_message", None)
    if not callable(read_fn):
        return {"ok": False, "error": "read_message unsupported", "marked": 0}

    try:
        chat_id = int(body.peerUserId)
    except Exception as exc:
        raise HTTPException(400, detail="peerUserId must be numeric chat id") from exc

    marked = 0
    # Prod WebClient validates message_id as number ("Expected number"); pass int.
    # IDs are stored as decimal strings (safe — never JSON-number in JS).
    for raw in body.messageIds[-20:]:
        mid = str(raw).strip()
        if mid.startswith("max:"):
            mid = mid.split(":", 1)[1]
        if not mid or not mid.isdigit():
            continue
        try:
            await read_fn(message_id=int(mid), chat_id=chat_id)
            marked += 1
        except Exception:
            logger.debug("read_message failed chat=%s mid=%s", chat_id, mid, exc_info=True)
    return {"ok": True, "marked": marked}


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
    if not _self_tokens():
        logger.warning("no service token set (VOXLY_TOKEN_MAX_BRIDGE / VOXLY_SERVICE_TOKEN) — bridge will reject calls")
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
