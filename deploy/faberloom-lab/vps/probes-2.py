"""Sondas P-04, P-09, P-11 y P-12 contra el laboratorio del VPS."""

from __future__ import annotations

import hashlib
import hmac
import json
import smtplib
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from email.message import EmailMessage
from http.cookiejar import CookieJar

BASE = "http://127.0.0.1:8787"
SMTP = ("127.0.0.1", 3025)
RESULTS: list[dict] = []


def record(pid, name, ok, detail, evidence=None):
    RESULTS.append({"id": pid, "name": name, "result": "PASS" if ok is True else ("FAIL" if ok is False else "NO_VERIFICADO"),
                    "detail": detail, "evidence": evidence or {}})
    print(f"{RESULTS[-1]['result']:14} {pid}  {name}  {detail}")


class Client:
    def __init__(self, default_headers=None):
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.default_headers = default_headers or {}

    def call(self, method, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        hdrs = {"Accept": "application/json", **self.default_headers, **(headers or {})}
        if data:
            hdrs["Content-Type"] = "application/json"
        if method != "GET":
            hdrs["x-damail"] = "1"
        req = urllib.request.Request(f"{BASE}{path}", data=data, headers=hdrs, method=method)
        try:
            with self.opener.open(req, timeout=60) as response:
                return response.status, json.loads(response.read() or b"null")
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            try:
                return exc.code, json.loads(payload or b"null")
            except json.JSONDecodeError:
                return exc.code, {"raw": payload[:200].decode("utf-8", "replace")}


def items(client, path):
    code, body = client.call("GET", path)
    if isinstance(body, dict):
        for key in ("items", "messages", "data"):
            if isinstance(body.get(key), list):
                return code, body[key]
    return code, body if isinstance(body, list) else []


def send_mail(to, subject, text, message_id=None):
    msg = EmailMessage()
    msg["From"] = "piloto-a@faberloom.test"
    msg["To"] = to
    msg["Subject"] = subject
    if message_id:
        msg["Message-ID"] = message_id
    msg.set_content(text)
    with smtplib.SMTP(*SMTP, timeout=20) as smtp:
        smtp.send_message(msg)


def main():
    client = Client()
    client.call("POST", "/api/auth/login", {"username": "labadmin", "password": "LabOnly-Admin-2026"})
    run = uuid.uuid4().hex[:8]

    # ---------- P-04 carpetas y restauración ----------
    subj = f"P04-{run}"
    send_mail("piloto-a@faberloom.test", subj, f"mover y restaurar {run}")
    client.call("POST", "/api/admin/accounts/1/sync")
    time.sleep(6)
    code, folders = items(client, "/api/v1/folders?account=1")
    by_name = {f.get("path") or f.get("name"): f.get("id") for f in folders}
    inbox_id = by_name.get("INBOX")
    target_name = next((n for n in by_name if n and n.upper().endswith("ARCHIVE")), None)
    code, rows = items(client, f"/api/v1/messages?limit=50&account=1&q={urllib.parse.quote(subj)}")
    msg = next((r for r in rows if r.get("subject") == subj), None)
    detail = {"carpetas": sorted([n for n in by_name if n])[:8], "inbox": inbox_id, "archive": target_name}
    moved = restored = deleted = False
    if msg and target_name:
        target_id = by_name[target_name]
        c_move, r_move = client.call("POST", "/api/v1/messages/batch", {"ids": [msg["id"]], "action": "move", "folderId": target_id})
        _, again = items(client, f"/api/v1/messages?limit=50&account=1&q={urllib.parse.quote(subj)}")
        moved = c_move == 200 and any(r.get("id") == msg["id"] and (r.get("folder") or "").endswith("Archive") for r in again)
        c_del, r_del = client.call("POST", "/api/v1/messages/batch", {"ids": [msg["id"]], "action": "delete"})
        _, after_del = items(client, f"/api/v1/messages?limit=50&account=1&q={urllib.parse.quote(subj)}")
        deleted = c_del == 200 and not any(r.get("id") == msg["id"] for r in after_del)
        # restaurar: mover de vuelta a INBOX desde la carpeta destino
        c_rest, r_rest = client.call("POST", "/api/v1/messages/batch", {"ids": [msg["id"]], "action": "move", "folderId": inbox_id})
        _, after_rest = items(client, f"/api/v1/messages?limit=50&account=1&q={urllib.parse.quote(subj)}")
        restored = c_rest == 200 and any(r.get("id") == msg["id"] for r in after_rest)
        detail.update({"move": c_move, "delete": c_del, "restore": c_rest, "restaurado": restored})
    record("P-04", "Mover, borrar y restaurar sobre la ocurrencia exacta",
           bool(moved and deleted and restored), f"move={moved} delete={deleted} restore={restored}", detail)

    # ---------- P-09 timeout sin reintento ciego ----------
    c_acc, acc = client.call("POST", "/api/admin/accounts", {
        "name": "timeout@faberloom.test", "email": "timeout@faberloom.test",
        "imapHost": "127.0.0.1", "imapPort": 3143, "imapSecure": False,
        "smtpHost": "127.0.0.1", "smtpPort": 3026, "smtpSecure": False,
        "username": "piloto-a", "secret": "lab-only-a", "syncSinceDays": 0, "pollIntervalSec": 60,
    })
    acc_id = acc.get("id") if isinstance(acc, dict) else None
    detail9 = {"crear_cuenta": c_acc, "cuenta": acc_id}
    sent_ok = False
    if acc_id:
        c_d, draft = client.call("POST", "/api/v1/drafts", {
            "mode": "new", "accountId": acc_id, "to": ["piloto-b@faberloom.test"],
            "subject": f"P09-{run}", "body": f"timeout {run}"})
        did = draft.get("id") if isinstance(draft, dict) else None
        if did:
            c_s, send_res = client.call("POST", f"/api/v1/drafts/{did}/send", {"revision": 0})
            time.sleep(25)
            _, state = client.call("GET", f"/api/v1/drafts/{did}")
            # contar intentos de envío en el log en la ventana
            log = subprocess.run(["docker", "logs", "--since", "2m", "faberloom-lab-damail"],
                                 capture_output=True, text=True).stdout
            attempts = sum(1 for line in log.splitlines() if "P09-" in line or "335" in line or "ECONNREFUSED" in line)
            detail9.update({"send": c_s, "estado": (state or {}).get("status"),
                            "lastError": str((state or {}).get("lastError"))[:160],
                            "lineas_log_relacionadas": attempts})
            sent_ok = c_s in (200, 202) and (state or {}).get("status") in ("failed",) and attempts <= 6
    record("P-09", "Fallo de transporte se registra y no reintenta sin control",
           sent_ok, f"estado={detail9.get('estado')} lineas={detail9.get('lineas_log_relacionadas')}", detail9)

    # ---------- P-11 webhooks: firma y entrega ----------
    detail11 = {}
    webhook_ok = False
    subprocess.run(["docker", "rm", "-f", "faberloom-lab-hook"], capture_output=True)
    subprocess.run(["docker", "run", "-d", "--name", "faberloom-lab-hook",
                    "--network", "container:faberloom-lab-greenmail",
                    "python:3.12-alpine", "python", "-c",
                    "import http.server,sys\n"
                    "class H(http.server.BaseHTTPRequestHandler):\n"
                    "    def do_POST(self):\n"
                    "        n=int(self.headers.get('content-length') or 0)\n"
                    "        body=self.rfile.read(n)\n"
                    "        open('/tmp/hook.log','ab').write(self.headers.get('x-damail-signature','').encode()+b'|'+body+b'\\n')\n"
                    "        self.send_response(200); self.end_headers(); self.wfile.write(b'ok')\n"
                    "    def log_message(self,*a): pass\n"
                    "http.server.HTTPServer(('127.0.0.1',8899),H).serve_forever()\n"],
                   capture_output=True)
    time.sleep(3)
    secret = f"secreto-{run}"
    c_ch, channel = client.call("POST", "/api/admin/channels", {
        "name": f"hook-{run}", "type": "webhook",
        "config": {"url": "http://127.0.0.1:8899/hook", "secret": secret},
        "events": ["message.received"]})
    detail11 = {"crear_canal": c_ch, "canal": channel if c_ch != 201 else {k: v for k, v in (channel or {}).items() if k != "config"}}
    if c_ch in (200, 201):
        send_mail("piloto-a@faberloom.test", f"P11-{run}", f"evento webhook {run}")
        client.call("POST", "/api/admin/accounts/1/sync")
        time.sleep(20)
        log = subprocess.run(["docker", "exec", "faberloom-lab-hook", "cat", "/tmp/hook.log"],
                             capture_output=True, text=True).stdout.strip().splitlines()
        verified = False
        if log:
            sig, payload = log[-1].split("|", 1)
            expected = "sha256=" + hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
            verified = sig == expected
        detail11.update({"entregas": len(log), "firma_valida": verified,
                         "evento": json.loads(log[-1].split("|", 1)[1]).get("event") if log else None})
        webhook_ok = len(log) >= 1 and verified
    record("P-11", "Webhook firmado y entregado", webhook_ok,
           f"entregas={detail11.get('entregas')} firma={detail11.get('firma_valida')}", detail11)

    # ---------- P-12 IA y destinos ----------
    detail12 = {}
    c_ai, ai_state = client.call("GET", "/api/admin/ai/channels/status")
    c_sem, semantic = client.call("POST", "/api/v1/search/semantic", {"q": "prueba", "limit": 3})
    env = subprocess.run(["docker", "exec", "faberloom-lab-damail", "sh", "-lc", "env"],
                         capture_output=True, text=True).stdout
    suspicious = [line.split("=")[0] for line in env.splitlines()
                  if any(tag in line.upper() for tag in ("API_KEY", "OPENAI", "ANTHROPIC", "DEEPSEEK", "GEMINI"))]
    conns = subprocess.run(["docker", "exec", "faberloom-lab-damail", "sh", "-lc",
                            "(ss -tn 2>/dev/null || netstat -tn 2>/dev/null) | grep -v '127.0.0.1' || true"],
                           capture_output=True, text=True).stdout.strip().splitlines()
    outbound = [line for line in conns if "172." in line or "10." in line or ":443" in line]
    detail12 = {"ai_status": c_ai, "channels": ai_state, "semantic_status": c_sem,
                "semantic_error": str(semantic)[:160], "env_con_claves": suspicious,
                "conexiones_no_loopback": len(outbound)}
    record("P-12", "Sin proveedor de IA configurado y sin salida a modelos",
           c_sem >= 400 and not suspicious and len(outbound) == 0,
           f"semantic={c_sem} claves={suspicious} conexiones={len(outbound)}", detail12)

    with open("/opt/faberloom-lab/probes-report-2.json", "w", encoding="utf-8") as handle:
        json.dump(RESULTS, handle, ensure_ascii=False, indent=2)
    passed = sum(1 for r in RESULTS if r["result"] == "PASS")
    print(f"\n{passed}/{len(RESULTS)} sondas en verde")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
