"""P-09 medido en una sola corrida: transiciones, intentos y esperas del mismo borrador."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from http.cookiejar import CookieJar

BASE = "http://127.0.0.1:8787"
FIXTURE = 3


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


def log_lines() -> list[str]:
    proc = subprocess.run(
        ["docker", "logs", "-t", "--since", "240m", "faberloom-lab-damail"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    return ((proc.stdout or "") + "\n" + (proc.stderr or "")).splitlines()


def main() -> int:
    client = Client()
    client.call("POST", "/api/auth/login", {"username": "labadmin", "password": "LabOnly-Admin-2026"})
    client.call("PATCH", f"/api/admin/accounts/{FIXTURE}", {"enabled": True})
    time.sleep(2)

    code, draft = client.call("POST", "/api/v1/drafts", {
        "mode": "new", "accountId": FIXTURE, "to": ["piloto-b@faberloom.test"],
        "subject": "P09-cerrado", "body": "puerto SMTP cerrado"})
    did = draft.get("id")
    others_before = len([1 for _ in client.call("GET", "/api/v1/messages?limit=100&view=all&account=2")[1]])

    send_code, _ = client.call("POST", f"/api/v1/drafts/{did}/send", {"revision": 0})
    transitions = []
    for _ in range(80):
        time.sleep(6)
        _, state = client.call("GET", f"/api/v1/drafts/{did}")
        status = (state or {}).get("status")
        if not transitions or transitions[-1] != status:
            transitions.append(status)
        if status == "failed":
            break

    attempts = []
    for line in log_lines():
        match = re.search(rf"^(\S+) .*草稿 {did} 发送失败（第 (\d+) 次）", line)
        if match:
            attempts.append({"ts": match.group(1), "n": int(match.group(2))})

    waits = []
    if len(attempts) == 3:
        stamps = [datetime.fromisoformat(a["ts"].replace("Z", "+00:00")) for a in attempts]
        waits = [round((stamps[i + 1] - stamps[i]).total_seconds()) for i in range(2)]

    _, final_state = client.call("GET", f"/api/v1/drafts/{did}")
    others_after = len([1 for _ in client.call("GET", "/api/v1/messages?limit=100&view=all&account=2")[1]])

    client.call("PATCH", f"/api/admin/accounts/{FIXTURE}", {"enabled": False})

    ok = (
        send_code == 200
        and transitions[-1:] == ["failed"]
        and [a["n"] for a in attempts] == [1, 2, 3]
        and waits == [60, 120]
        and others_after == others_before
    )
    report = {
        "id": "P-09",
        "name": "Timeout con reintento acotado a tres intentos y espera creciente",
        "result": "PASS" if ok else "FAIL",
        "detail": f"transiciones={transitions} intentos={[a['n'] for a in attempts]} esperas={waits} estado_final={(final_state or {}).get('status')}",
        "evidence": {
            "borrador": did,
            "send_status": send_code,
            "transiciones": transitions,
            "estado_final": (final_state or {}).get("status"),
            "intentos": attempts,
            "esperas_segundos": waits,
            "mensajes_en_destino_antes": others_before,
            "mensajes_en_destino_despues": others_after,
            "error_registrado": str((final_state or {}).get("lastError"))[:200],
        },
    }
    print(report["result"], report["detail"])
    open("/opt/faberloom-lab/probes-report-8.json", "w", encoding="utf-8").write(json.dumps([report], ensure_ascii=False, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
