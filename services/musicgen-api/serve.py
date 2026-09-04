"""Bind the API to loopback and the Tailscale address only — never 0.0.0.0.

uvicorn takes one --host; we pre-bind one socket per address and hand both to a
single Server, so one model serves both interfaces. The Tailscale address is read
from MUSICGEN_TAILSCALE_IP and skipped (with a log line) when it is not present on
this machine, so the service still starts on loopback.
"""
from __future__ import annotations

import asyncio
import os
import socket
import subprocess

import uvicorn
from pathlib import Path

# Same env file the app reads (token, port, Tailscale address) — outside the repo.
_ENV = Path(os.environ.get("MUSICGEN_API_ENV_FILE", Path.home() / "ai/musicgen-api/musicgen-api.env"))
if _ENV.exists():
    for _line in _ENV.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip().strip('"'))

PORT = int(os.environ.get("MUSICGEN_API_PORT", "8765"))
LOOPBACK = "127.0.0.1"
TAILSCALE = os.environ.get("MUSICGEN_TAILSCALE_IP", "100.65.5.120")


def local_addresses() -> set[str]:
    out = subprocess.run(["ifconfig"], capture_output=True, text=True).stdout
    return {line.split()[1] for line in out.splitlines() if line.strip().startswith("inet ")}


def bind(host: str) -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((host, PORT))
    sock.listen(128)
    sock.setblocking(False)
    return sock


async def main() -> None:
    hosts = [LOOPBACK]
    if TAILSCALE and TAILSCALE in local_addresses():
        hosts.append(TAILSCALE)
    else:
        print(f'{{"level": "WARNING", "msg": "tailscale address {TAILSCALE} not present; binding loopback only"}}', flush=True)
    sockets = [bind(h) for h in hosts]
    print(f'{{"level": "INFO", "msg": "binding", "hosts": {hosts}, "port": {PORT}}}', flush=True)
    config = uvicorn.Config("app:app", log_level="warning", access_log=False, timeout_keep_alive=30, workers=1)
    server = uvicorn.Server(config)
    await server.serve(sockets=sockets)


if __name__ == "__main__":
    asyncio.run(main())
