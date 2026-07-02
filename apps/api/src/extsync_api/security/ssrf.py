"""SSRF guard for outbound, user-supplied URLs (currently: webhook targets).

A developer fully controls their webhook URL, and the worker makes a server-side
HTTP request to it. Without this guard a developer could point a webhook at an
internal address - cloud metadata (169.254.169.254), MinIO, Redis, the isolated
signing service, or any RFC1918 host - and use the platform as an SSRF proxy
(at minimum a response-code/timing oracle for internal port scanning).

We allow only http/https URLs whose hostname resolves EXCLUSIVELY to public IPs.
Because DNS can change between webhook creation and delivery (rebinding), call
`assert_safe_public_url` at BOTH points. It performs a DNS lookup, so callers in
async code should run it via `asyncio.to_thread`.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse


class UnsafeUrlError(ValueError):
    """Raised when a URL is not safe to fetch server-side."""


def _ip_is_public(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return not (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


def resolve_safe_public_url(url: str) -> list[str]:
    """Validate `url` is an http(s) URL resolving ONLY to public IPs, and return the
    resolved public IPs (sorted). The caller should CONNECT to one of these IPs while
    carrying the original Host header + TLS SNI - re-resolving the hostname at connect
    time (httpx's default) reopens the DNS-rebinding TOCTOU this guard exists to close.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise UnsafeUrlError("ה-URL של ה-webhook חייב להשתמש ב-http או https")
    host = parsed.hostname
    if not host:
        raise UnsafeUrlError("כתובת ה-webhook אינה תקינה")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UnsafeUrlError("לא ניתן לאמת את כתובת ה-webhook (DNS)") from exc
    addrs = {info[4][0] for info in infos}
    if not addrs:
        raise UnsafeUrlError("לא ניתן לאמת את כתובת ה-webhook (DNS)")
    for ip in addrs:
        if not _ip_is_public(ip):
            raise UnsafeUrlError(
                "כתובת ה-webhook מצביעה על כתובת רשת פנימית - אסור מטעמי אבטחה"
            )
    return sorted(addrs)


def assert_safe_public_url(url: str) -> None:
    """Raise UnsafeUrlError unless `url` is an http(s) URL that resolves only to
    public IP addresses. Prefer resolve_safe_public_url + pinning the connection to the
    returned IP; this thin wrapper is for creation-time validation only."""
    resolve_safe_public_url(url)
