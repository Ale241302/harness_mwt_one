"""P-13 con antes y después del reinicio: mensajes, borradores enviados y reenvíos."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from http.cookiejar import CookieJar

BASE = "http://127.0.0.1:8787"


class Client:
    def __init__(self):
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        hdrs = {"Accept": "application/json"}
        if data:
            hdrs["Content-Type"] = "application/json"
        if method != "GET":
            hdrs["x-damail"] = "1"
        req = urllib.request.Request(f"{BASE}{path}", data=data, headers=hdrs, method=method)
        try:
            with self.opener.open(req, timeout=60) as response:
                return response.status, json.loads(response.read() or b"null")
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read() or b"null")


def snapshot(client):
    _, msgs = client.call("GET", "/api/v1/messages?limit=200&view=all&account=1")
    _, drafts = client.call("GET", "/api/v1/drafts")
    _, b_msgs = client.call("GET", "/api/v1/messages?limit=200&view=all&account=2")
    sent = sorted(d["id"] for d in (drafts or []) if d.get("status") == "sent")
    return {
        "mensajes_cuenta_1": len(msgs or []),
        "borradores": len(drafts or []),
        "borradores_enviados": sent,
        "mensajes_cuenta_2": len(b_msgs or []),
    }


def count_send_lines(draft_ids) -> dict[int, int]:
    proc = subprocess.run(
        ["docker", "logs", "--since", "120m", "faberloom-lab-damail"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    text = (proc.stdout or "") + "\n" + (proc.stderr or "")
    counts = {}
    for did in draft_ids:
        counts[did] = len(re.findall(rf"草稿 {did} 已通过", text))
    return counts


def main() -> int:
    client = Client()
    client.call("POST", "/api/auth/login", {"username": "labadmin", "password": "LabOnly-Admin-2026"})
    before = snapshot(client)
    sends_before = count_send_lines(before["borradores_enviados"])

    subprocess.run(["docker", "restart", "faberloom-lab-damail"], capture_output=True)
    for _ in range(40):
        time.sleep(3)
        code, _ = client.call("GET", "/api/auth/status")
        if code == 200:
            break
    client.call("POST", "/api/auth/login", {"username": "labadmin", "password": "LabOnly-Admin-2026"})
    time.sleep(8)

    after = snapshot(client)
    sends_after = count_send_lines(before["borradores_enviados"])

    reintentos = {did: sends_after.get(did, 0) - sends_before.get(did, 0) for did in before["borradores_enviados"]}
    ok = (
        before["mensajes_cuenta_1"] == after["mensajes_cuenta_1"]
        and before["borradores"] == after["borradores"]
        and before["borradores_enviados"] == after["borradores_enviados"]
        and before["mensajes_cuenta_2"] == after["mensajes_cuenta_2"]
        and before["borradores_enviados"]
        and all(v == 0 for v in reintentos.values())
    )
    report = {
        "id": "P-13",
        "name": "Reinicio conserva mensajes, borradores y estados y no reenvía",
        "result": "PASS" if ok else "FAIL",
        "detail": (
            f"mensajes {before['mensajes_cuenta_1']}->{after['mensajes_cuenta_1']} · "
            f"borradores {before['borradores']}->{after['borradores']} · "
            f"enviados {len(before['borradores_enviados'])}->{len(after['borradores_enviados'])} · "
            f"reenvíos {sum(reintentos.values())}"
        ),
        "evidence": {
            "antes": before,
            "despues": after,
            "envios_por_borrador_antes": sends_before,
            "envios_por_borrador_despues": sends_after,
            "reenvios_por_borrador": reintentos,
            "nota": "los envíos se cuentan con las líneas de log del propio motor, no con el estado del borrador",
        },
    }
    print(report["result"], report["detail"])
    open("/opt/faberloom-lab/probes-report-9.json", "w", encoding="utf-8").write(json.dumps([report], ensure_ascii=False, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
