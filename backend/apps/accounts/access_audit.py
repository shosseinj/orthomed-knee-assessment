"""Append-only, server-owned access log for one configured account."""

import fcntl
import ipaddress
import json
import logging
import os
import threading
from datetime import datetime, timedelta
from pathlib import Path

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)
_write_lock = threading.Lock()
_recent_views: dict[tuple[str, str, str, str], datetime] = {}


class AccessEventKind:
    PANEL_LOGIN = "panel_login"
    PANEL_VIEW = "panel_view"
    ADMIN_LOGIN = "admin_login"
    ADMIN_VIEW = "admin_view"


def _valid_ip(value: str) -> str | None:
    try:
        return str(ipaddress.ip_address(value.strip()))
    except (AttributeError, ValueError):
        return None


def client_ip(request) -> str | None:
    """The edge Nginx overwrites X-Real-IP; never trust a client-supplied XFF chain."""
    if settings.ACCESS_AUDIT_TRUST_PROXY_IP:
        proxied = _valid_ip(request.META.get("HTTP_X_REAL_IP", ""))
        if proxied:
            return proxied
    return _valid_ip(request.META.get("REMOTE_ADDR", ""))


def approximate_location(ip: str | None) -> dict:
    """Optional offline GeoLite2/GeoIP2 city lookup, with no external request."""
    database_path = settings.GEOIP_CITY_DB_PATH
    if not database_path or not ip or not ipaddress.ip_address(ip).is_global:
        return {}
    if not Path(database_path).is_file():
        return {}
    try:
        import geoip2.database
        from geoip2.errors import AddressNotFoundError

        with geoip2.database.Reader(database_path) as reader:
            result = reader.city(ip)
        return {
            "country_code": (result.country.iso_code or "")[:2],
            "city": (result.city.name or "")[:128],
            "accuracy_radius_km": result.location.accuracy_radius,
        }
    except ImportError:
        logger.warning("GeoIP database configured but geoip2 is unavailable")
    except (AddressNotFoundError, OSError, ValueError):
        # Missing IPs and unavailable databases are normal; the access event still matters.
        pass
    except Exception:
        logger.exception("GeoIP lookup failed")
    return {}


def _write_all(descriptor: int, data: bytes) -> None:
    remaining = memoryview(data)
    while remaining:
        written = os.write(descriptor, remaining)
        if written == 0:
            raise OSError("Incomplete access audit write")
        remaining = remaining[written:]


def _append_bounded(descriptor: int, line: bytes, max_bytes: int) -> None:
    """Keep the newest complete JSON lines if the single log reaches its cap."""
    size = os.fstat(descriptor).st_size
    if size + len(line) > max_bytes:
        keep_bytes = min(max_bytes // 2, max_bytes - len(line))
        start = max(0, size - keep_bytes)
        recent = bytearray()
        offset = start
        while len(recent) < keep_bytes:
            chunk = os.pread(descriptor, keep_bytes - len(recent), offset)
            if not chunk:
                break
            recent.extend(chunk)
            offset += len(chunk)
        if start:
            first_newline = recent.find(b"\n")
            recent = recent[first_newline + 1:] if first_newline >= 0 else bytearray()
        os.ftruncate(descriptor, 0)
        if recent:
            _write_all(descriptor, recent)
    _write_all(descriptor, line)


def record_access(user, kind: str, request, *, path: str = "", client_timezone: str = "") -> bool:
    """Audit failures must never turn a successful app request into an error."""
    try:
        return _record_access(user, kind, request, path=path, client_timezone=client_timezone)
    except Exception:
        try:
            logger.exception("Access audit failed; application request will continue")
        except Exception:
            pass
        return False


def _record_access(user, kind: str, request, *, path: str = "", client_timezone: str = "") -> bool:
    target_phone = settings.ACCESS_AUDIT_PHONE_NUMBER
    if not target_phone or not getattr(user, "is_authenticated", False) or user.phone_number != target_phone:
        return False

    ip = client_ip(request)
    safe_path = (path or request.path)[:255]
    log_path = Path(settings.ACCESS_AUDIT_LOG_PATH)
    now = timezone.now()
    event = {
        "occurred_at": now.isoformat(),
        "kind": kind,
        "user_id": str(user.pk),
        "phone_number": user.phone_number,
        "ip_address": ip,
        "path": safe_path,
        "user_agent": request.META.get("HTTP_USER_AGENT", "")[:512],
        "accept_language": request.META.get("HTTP_ACCEPT_LANGUAGE", "")[:128],
        "client_timezone": client_timezone[:64],
        **approximate_location(ip),
    }
    line = (json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    max_bytes = settings.ACCESS_AUDIT_MAX_BYTES
    if len(line) > max_bytes:
        logger.warning("Access audit event exceeds the log size limit")
        return False
    if not _write_lock.acquire(blocking=False):
        return False
    try:
        if kind == AccessEventKind.PANEL_VIEW:
            # React development remounts may report the same view twice.
            key = (str(log_path), user.phone_number, safe_path, ip or "")
            last_seen = _recent_views.get(key)
            if last_seen and now - last_seen < timedelta(seconds=3):
                return False
        log_path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(log_path, os.O_RDWR | os.O_APPEND | os.O_CREAT, 0o644)
        try:
            # The file lock also protects rollover if another worker is added.
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            _append_bounded(descriptor, line, max_bytes)
        finally:
            os.close(descriptor)
        if kind == AccessEventKind.PANEL_VIEW:
            _recent_views[key] = now
            # Keep this tiny in-memory cache bounded for long-lived workers.
            if len(_recent_views) > 100:
                cutoff = now - timedelta(seconds=3)
                for item, seen in list(_recent_views.items()):
                    if seen < cutoff:
                        del _recent_views[item]
    finally:
        _write_lock.release()
    return True
