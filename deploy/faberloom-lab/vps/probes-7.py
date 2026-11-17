"""P-03 correcta: compara el Message-ID real de cada ocurrencia leyendo el detalle."""

from __future__ import annotations

import json
import smtplib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from email.message import EmailMessage
from email.utils import make_msgid
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


def main() -> int:
    client = Client()
    client.call("POST", "/api/auth/login", {"username": "labadmin", "password": "LabOnly-Admin-2026"})
    run = uuid.uuid4().hex[:8]
    shared = make_msgid(domain="faberloom.test")
    subject = f"P03-ID-{run}"

    msg = EmailMessage()
    msg["From"] = "piloto-a@faberloom.test"
    msg["To"] = "piloto-a@faberloom.test, piloto-b@faberloom.test"
    msg["Subject"] = subject
    msg["Message-ID"] = shared
    msg.set_content(f"identidad {run}")
    with smtplib.SMTP("127.0.0.1", 3025, timeout=20) as smtp:
        smtp.send_message(msg)

    for account_id in (1, 2):
        client.call("POST", f"/api/admin/accounts/{account_id}/sync")
    time.sleep(8)

    code, body = client.call("GET", f"/api/v1/messages?limit=50&view=all&q={urllib.parse.quote(subject)}")
    all_rows = [r for r in (body.get("items") if isinstance(body, dict) else []) if r.get("subject") == subject]
    # La cuenta 3 es el fixture de P-09 y usa las mismas credenciales que la 1: se mide aparte.
    rows = [r for r in all_rows if r.get("accountId") in (1, 2)]
    duplicadas = [r for r in all_rows if r.get("accountId") not in (1, 2)]

    details = []
    for row in rows:
        code_d, detail = client.call("GET", f"/api/v1/messages/{row['id']}")
        details.append({
            "id": row.get("id"),
            "accountId": row.get("accountId"),
            "messageId": (detail or {}).get("messageId"),
            "uid": (detail or {}).get("uid"),
            "threadId": (detail or {}).get("threadId"),
        })

    ids = {d["id"] for d in details}
    accounts = {d["accountId"] for d in details}
    message_ids = {d["messageId"] for d in details if d["messageId"]}
    expected = shared.strip("<>")
    ok = (
        len(details) == 2
        and len(ids) == 2
        and len(accounts) == 2
        and len(message_ids) == 1
        and all(expected in (mid or "") for mid in message_ids)
    )
    report = {
        "id": "P-03",
        "name": "Misma identidad no colapsa ocurrencias",
        "result": "PASS" if ok else "FAIL",
        "detail": f"filas={len(details)} ids={len(ids)} cuentas={sorted(accounts)} messageIds={message_ids}",
        "evidence": {
            "enviado": shared,
            "ocurrencias": details,
            "hallazgo_duplicado_por_configuracion": {
                "ocurrencias_extra": len(duplicadas),
                "cuentas": sorted({r.get("accountId") for r in duplicadas}),
                "nota": "una segunda configuración con las mismas credenciales duplica cada mensaje; el piloto no debe configurar dos veces el mismo buzón",
            },
        },
    }
    print(report["result"], report["id"], report["detail"])
    open("/opt/faberloom-lab/probes-report-7.json", "w", encoding="utf-8").write(
        json.dumps([report], ensure_ascii=False, indent=2)
    )
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
