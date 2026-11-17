"""Sondas P-04, P-09 y P-12, corregidas tras el diagnóstico."""

from __future__ import annotations

import imaplib
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
RESULTS: list[dict] = []


def record(pid, name, ok, detail, evidence=None):
    RESULTS.append({"id": pid, "name": name, "result": "PASS" if ok is True else ("FAIL" if ok is False else "NO_VERIFICADO"),
                    "detail": detail, "evidence": evidence or {}})
    print(f"{RESULTS[-1]['result']:14} {pid}  {name}  {detail}")


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


def imap(user, password, action):
    conn = imaplib.IMAP4("127.0.0.1", 3143)
    try:
        conn.login(user, password)
        return action(conn)
    finally:
        conn.logout()


def main():
    client = Client()
    client.call("POST", "/api/auth/login", {"username": "labadmin", "password": "LabOnly-Admin-2026"})
    run = uuid.uuid4().hex[:8]

    # ---------- P-04 ----------
    def asegurar_carpetas(conn):
        creadas = []
        for name in ("Archive", "Trash"):
            typ, _ = conn.create(name)
            creadas.append((name, typ))
        typ, data = conn.list()
        return creadas, [d.decode() for d in data if d]

    creadas, listado = imap("piloto-a", "lab-only-a", asegurar_carpetas)
    client.call("POST", "/api/admin/accounts/1/sync")
    time.sleep(8)
    code, folders = items(client, "/api/v1/folders?account=1")
    by_name = {f.get("path") or f.get("name"): f.get("id") for f in folders}
    inbox_id = by_name.get("INBOX")
    archive_id = by_name.get("Archive")
    trash_id = by_name.get("Trash")

    subj = f"P04-{run}"
    msg = EmailMessage()
    msg["From"] = "piloto-a@faberloom.test"
    msg["To"] = "piloto-a@faberloom.test"
    msg["Subject"] = subj
    msg.set_content(f"mover y restaurar {run}")
    with smtplib.SMTP("127.0.0.1", 3025, timeout=20) as smtp:
        smtp.send_message(msg)
    client.call("POST", "/api/admin/accounts/1/sync")
    time.sleep(6)
    _, rows = items(client, f"/api/v1/messages?limit=50&account=1&q={urllib.parse.quote(subj)}")
    target = next((row for row in rows if row.get("subject") == subj), None)

    detail = {"carpetas_creadas": creadas, "carpetas_visibles": sorted(k for k in by_name if k),
              "inbox": inbox_id, "archive": archive_id, "trash": trash_id}
    moved = trashed = restored = deleted = False
    if target and archive_id and trash_id and inbox_id:
        c1, _ = client.call("POST", "/api/v1/messages/batch", {"ids": [target["id"]], "action": "move", "folderId": archive_id})
        _, after_move = items(client, f"/api/v1/messages?limit=50&account=1&q={urllib.parse.quote(subj)}")
        moved = c1 == 200 and any(r.get("id") == target["id"] and (r.get("folder") or "") == "Archive" for r in after_move)

        c2, _ = client.call("POST", "/api/v1/messages/batch", {"ids": [target["id"]], "action": "move", "folderId": trash_id})
        _, after_trash = items(client, f"/api/v1/messages?limit=50&account=1&q={urllib.parse.quote(subj)}")
        trashed = c2 == 200 and any(r.get("id") == target["id"] and (r.get("folder") or "") == "Trash" for r in after_trash)

        c3, _ = client.call("POST", "/api/v1/messages/batch", {"ids": [target["id"]], "action": "move", "folderId": inbox_id})
        _, after_restore = items(client, f"/api/v1/messages?limit=50&account=1&q={urllib.parse.quote(subj)}")
        restored = c3 == 200 and any(r.get("id") == target["id"] and (r.get("folder") or "") == "INBOX" for r in after_restore)

        subj2 = f"P04b-{run}"
        msg2 = EmailMessage()
        msg2["From"] = "piloto-a@faberloom.test"
        msg2["To"] = "piloto-a@faberloom.test"
        msg2["Subject"] = subj2
        msg2.set_content("borrado definitivo")
        with smtplib.SMTP("127.0.0.1", 3025, timeout=20) as smtp:
            smtp.send_message(msg2)
        client.call("POST", "/api/admin/accounts/1/sync")
        time.sleep(6)
        _, rows2 = items(client, f"/api/v1/messages?limit=50&account=1&q={urllib.parse.quote(subj2)}")
        t2 = next((row for row in rows2 if row.get("subject") == subj2), None)
        if t2:
            client.call("POST", "/api/v1/messages/batch", {"ids": [t2["id"]], "action": "move", "folderId": trash_id})
            c4, r4 = client.call("POST", "/api/v1/messages/batch", {"ids": [t2["id"]], "action": "delete"})
            _, after_del = items(client, f"/api/v1/messages?limit=50&account=1&q={urllib.parse.quote(subj2)}")
            deleted = c4 == 200 and not any(r.get("id") == t2["id"] for r in after_del)
            detail["delete_respuesta"] = r4
        detail.update({"move": moved, "trash": trashed, "restore": restored, "delete": deleted})
    record("P-04", "Mover, papelera, restaurar y borrar sobre la ocurrencia exacta",
           bool(moved and trashed and restored and deleted),
           f"move={moved} trash={trashed} restore={restored} delete={deleted}", detail)

    # ---------- P-09 ----------
    _, accounts = items(client, "/api/admin/accounts")
    timeout_acc = next((a for a in accounts if a.get("email") == "timeout@faberloom.test"), None)
    detail9 = {}
    ok9 = False
    if timeout_acc:
        acc_id = timeout_acc["id"]
        _, draft = client.call("POST", "/api/v1/drafts", {
            "mode": "new", "accountId": acc_id, "to": ["piloto-b@faberloom.test"],
            "subject": f"P09-{run}", "body": f"timeout {run}"})
        did = draft.get("id")
        c_send, _ = client.call("POST", f"/api/v1/drafts/{did}/send", {"revision": 0})
        estados = []
        for _ in range(24):
            time.sleep(8)
            _, state = client.call("GET", f"/api/v1/drafts/{did}")
            estado = (state or {}).get("status")
            estados.append(estado)
            if estado == "failed":
                break
        log = subprocess.run(["docker", "logs", "--since", "10m", "faberloom-lab-damail"],
                             capture_output=True, text=True).stdout
        intentos = sum(1 for line in log.splitlines() if f"草稿 {did} " in line and "失败" in line)
        _, b_rows = items(client, "/api/v1/messages?limit=100&account=2")
        detail9 = {"send": c_send, "transiciones": [e for i, e in enumerate(estados) if i == 0 or e != estados[i - 1]],
                   "intentos_registrados": intentos, "status_final": estados[-1] if estados else None,
                   "mensajes_en_B": len(b_rows)}
        ok9 = c_send == 200 and estados and estados[-1] == "failed" and intentos == 3
    record("P-09", "Timeout con reintento acotado, no ciego",
           bool(ok9), f"status={detail9.get('status_final')} intentos={detail9.get('intentos_registrados')}", detail9)

    # ---------- P-12 ----------
    c_ai, ai_state = client.call("GET", "/api/admin/ai/channels/status")
    c_sem, semantic = client.call("POST", "/api/v1/search/semantic", {"q": "prueba", "limit": 3})
    env = subprocess.run(["docker", "exec", "faberloom-lab-damail", "sh", "-lc", "env"],
                         capture_output=True, text=True).stdout
    suspicious = [line.split("=")[0] for line in env.splitlines()
                  if any(tag in line.upper() for tag in ("API_KEY", "OPENAI", "ANTHROPIC", "DEEPSEEK", "GEMINI"))]
    conns = subprocess.run(["docker", "exec", "faberloom-lab-damail", "sh", "-lc",
                            "(ss -tn 2>/dev/null || netstat -tn 2>/dev/null) || true"],
                           capture_output=True, text=True).stdout.splitlines()
    egress_tls = [line for line in conns if ":443" in line or ":80 " in line]
    detail12 = {"ai_status": c_ai, "channels": ai_state, "semantic_status": c_sem,
                "semantic_error": str(semantic)[:160], "env_con_claves": suspicious,
                "conexiones_tls_salientes": len(egress_tls)}
    record("P-12", "Sin proveedor de IA configurado y sin egreso TLS",
           c_sem >= 400 and not suspicious and not egress_tls,
           f"semantic={c_sem} claves={suspicious} tls_saliente={len(egress_tls)}", detail12)

    with open("/opt/faberloom-lab/probes-report-3.json", "w", encoding="utf-8") as handle:
        json.dump(RESULTS, handle, ensure_ascii=False, indent=2)
    passed = sum(1 for r in RESULTS if r["result"] == "PASS")
    print(f"\n{passed}/{len(RESULTS)} sondas en verde")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
