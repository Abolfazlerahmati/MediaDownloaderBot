"""SSRF protection for every server-initiated request.

Rules enforced:
* only http/https, no userinfo (``user:pass@host``), standard ports only;
* the destination host must resolve exclusively to public IP addresses
  (loopback, private, link-local, multicast, reserved and unspecified are refused);
* redirects are followed manually and each hop is validated again;
* responses are size-capped and time-limited.

Known residual risk: DNS can change between validation and connection (rebinding).
Deployments should additionally restrict worker egress with network policy - see docs.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

import httpx

from mediabot.errors import UnsafeDestinationError

ALLOWED_SCHEMES = frozenset({"http", "https"})
ALLOWED_PORTS = frozenset({None, 80, 443})
BLOCKED_SUFFIXES = (".local", ".localhost", ".internal", ".lan", ".home.arpa", ".intranet", ".corp", ".arpa")
_HOST_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")


@dataclass(frozen=True)
class SplitUrl:
    scheme: str
    host: str
    port: int | None
    path: str
    query: str
    raw: str


def is_public_ip(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return not (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast
        or ip.is_reserved or ip.is_unspecified or not ip.is_global
    )


def is_valid_public_hostname(host: str) -> bool:
    """Syntactic check for a DNS name that may be used as a platform domain."""
    host = host.lower().rstrip(".")
    if not _HOST_RE.match(host):
        return False
    if host == "localhost" or host.endswith(BLOCKED_SUFFIXES):
        return False
    return True


def split_and_validate_syntax(url: str) -> SplitUrl:
    if len(url) > 2048:
        raise UnsafeDestinationError("URL is too long")
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError as exc:
        raise UnsafeDestinationError("malformed URL") from exc
    if parts.scheme.lower() not in ALLOWED_SCHEMES:
        raise UnsafeDestinationError("scheme not allowed")
    if parts.username is not None or parts.password is not None:
        raise UnsafeDestinationError("credentials in URL are not allowed")
    if not parts.hostname:
        raise UnsafeDestinationError("missing host")
    if port not in ALLOWED_PORTS:
        raise UnsafeDestinationError("non-standard port not allowed")
    return SplitUrl(
        scheme=parts.scheme.lower(),
        host=parts.hostname.lower().rstrip("."),
        port=port,
        path=parts.path,
        query=parts.query,
        raw=url,
    )


async def resolve_host(host: str) -> list[str]:
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UnsafeDestinationError("host does not resolve") from exc
    addresses = sorted({info[4][0] for info in infos})
    if not addresses:
        raise UnsafeDestinationError("host does not resolve")
    return addresses


async def ensure_public_destination(url: str, *, allow_private: bool = False) -> SplitUrl:
    """Validate syntax and that every resolved address is public."""
    split = split_and_validate_syntax(url)
    if allow_private:  # test-only escape hatch, never enabled by configuration
        return split
    if _is_ip_literal(split.host):
        if not is_public_ip(split.host):
            raise UnsafeDestinationError("IP literal is not public")
        return split
    if not is_valid_public_hostname(split.host):
        raise UnsafeDestinationError("host name is not allowed")
    for address in await resolve_host(split.host):
        if not is_public_ip(address):
            raise UnsafeDestinationError("host resolves to a non-public address")
    return split


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


async def safe_fetch(
    url: str,
    *,
    max_bytes: int,
    timeout_seconds: float,
    allowed_content_types: tuple[str, ...],
    max_redirects: int = 3,
    allow_private: bool = False,
) -> tuple[bytes, str]:
    """GET ``url`` with SSRF checks on every hop. Returns (body, content_type)."""
    current = url
    async with httpx.AsyncClient(
        follow_redirects=False,
        timeout=httpx.Timeout(timeout_seconds),
        headers={"User-Agent": "MediaDownloaderBot/1.0"},
    ) as client:
        for _ in range(max_redirects + 1):
            await ensure_public_destination(current, allow_private=allow_private)
            async with client.stream("GET", current) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise UnsafeDestinationError("redirect without location")
                    current = urljoin(current, location)
                    continue
                if response.status_code >= 400:
                    raise UnsafeDestinationError(f"upstream status {response.status_code}")
                content_type = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
                if content_type not in allowed_content_types:
                    raise UnsafeDestinationError("unexpected content type")
                declared = response.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > max_bytes:
                    raise UnsafeDestinationError("response too large")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > max_bytes:
                        raise UnsafeDestinationError("response too large")
                return bytes(body), content_type
        raise UnsafeDestinationError("too many redirects")
