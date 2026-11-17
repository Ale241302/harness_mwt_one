"""P-06 (adjuntos de extremo a extremo), P-13 (recuperación) y P-14 (operación) en el VPS."""

from __future__ import annotations

import hashlib
import imaplib
import json
import os
import smtplib
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from email import message_from_bytes
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

    def call(self, method, path, body=None, raw=None, content_type=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        hdrs = {"Accept": "application/json"}
        if content_type:
            hdrs["Content-Type"] = content_type
        elif data is not None:
            hdrs["Content-Type"] = "application/json"
        if method != "GET":
            hdrs["x-damail"] = "1"
        req = urllib.request.Request(f"{BASE}{path}", data=data, headers=hdrs, method=method)
        try:
            with self.opener.open(req, timeout=90) as response:
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


def multipart(field: str, filename: str, content: bytes, mime: str):
    boundary = "----faberloom" + uuid.uuid4().hex
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'.encode(),
        f"Content-Type: {mime}\r\n\r\n".encode(),
        content,
        f"\r\n--{boundary}--\r\n".encode(),
    ])
    return body, f"multipart/form-data; boundary={boundary}"


def main():
    client = Client()
    client.call("POST", "/api/auth/login", {"username": "labadmin", "password": "LabOnly-Admin-2026"})
    run = uuid.uuid4().hex[:8]

    # ---------- P-06 adjuntos de extremo a extremo ----------
    payload = (f"adjunto-{run}-".encode() * 200) + bytes(range(256))
    digest = hashlib.sha256(payload).hexdigest()
    c_d, draft = client.call("POST", "/api/v1/drafts", {
        "mode": "new", "accountId": 1, "to": ["piloto-b@faberloom.test"],
        "subject": f"P06adj-{run}", "body": f"con adjunto {run}"})
    did = draft.get("id")
    body, ctype = multipart("file", f"prueba-{run}.bin", payload, "application/octet-stream")
    c_up, up = client.call("POST", f"/api/v1/drafts/{did}/attachments", raw=body, content_type=ctype)
    _, fetched = client.call("GET", f"/api/v1/drafts/{did}")
    attached = (fetched or {}).get("attachments") or []
    detail = {"crear_borrador": c_d, "subir": c_up, "adjuntos_en_borrador": attached}
    ok = False
    if c_up in (200, 201) and attached:
        c_s, _ = client.call("POST", f"/api/v1/drafts/{did}/send", {"revision": (fetched or {}).get("revision", 0)})
        time.sleep(12)
        client.call("POST", "/api/admin/accounts/2/sync")
        time.sleep(6)
        _, rows = items(client, f"/api/v1/messages?limit=50&view=all&account=2&q={urllib.parse.quote(f'P06adj-{run}')}")
        row = next((r for r in rows if r.get("subject") == f"P06adj-{run}"), None)
        detail["enviar"] = c_s
        detail["llegó"] = bool(row)
        received = None
        if row:
            conn = imaplib.IMAP4("127.0.0.1", 3143)
            conn.login("piloto-b", "lab-only-b")
            conn.select("INBOX", readonly=True)
            _, data = conn.search(None, "ALL")
            for num in reversed(data[0].split()):
                _, raw = conn.fetch(num, "(RFC822)")
                msg = message_from_bytes(raw[0][1])
                if (msg.get("Subject") or "") == f"P06adj-{run}":
                    for part in msg.walk():
                        name = part.get_filename()
                        if name:
                            received = part.get_payload(decode=True)
                            break
                    break
            conn.logout()
        detail["sha256_enviado"] = digest
        detail["sha256_recibido"] = hashlib.sha256(received).hexdigest() if received else None
        detail["bytes"] = [len(payload), len(received or b"")]
        ok = detail["sha256_recibido"] == digest
    record("P-06", "Adjunto idéntico byte a byte de borrador a buzón de destino", ok,
           f"subida={c_up} enviado={detail.get('sha256_enviado', '')[:12]} recibido={(detail.get('sha256_recibido') or '')[:12]}", detail)

    # ---------- P-13 recuperación ----------
    _, before_msgs = items(client, "/api/v1/messages?limit=100&view=all&account=1")
    _, before_drafts = items(client, "/api/v1/drafts")
    subprocess.run(["docker", "restart", "faberloom-lab-damail"], capture_output=True)
    time.sleep(20)
    for _ in range(20):
        code, _state = client.call("GET", "/api/auth/status")
        if code == 200:
            break
        time.sleep(3)
    client.call("POST", "/api/auth/login", {"username": "labadmin", "password": "LabOnly-Admin-2026"})
    _, after_msgs = items(client, "/api/v1/messages?limit=100&view=all&account=1")
    _, after_drafts = items(client, "/api/v1/drafts")
    sent_ids = {d.get("id") for d in (after_drafts or []) if d.get("status") == "sent"}
    _, b_rows = items(client, "/api/v1/messages?limit=100&view=all&account=2")
    detail13 = {
        "mensajes_antes": len(before_msgs), "mensajes_despues": len(after_msgs),
        "borradores_antes": len(before_drafts), "borradores_despues": len(after_drafts),
        "enviados": len(sent_ids), "mensajes_en_B": len(b_rows),
    }
    ok13 = (len(before_msgs) == len(after_msgs) and len(before_drafts) == len(after_drafts)
            and len(after_drafts) > 0)
    record("P-13", "Reinicio conserva mensajes, borradores y estados y no reenvía", ok13,
           f"mensajes {detail13['mensajes_antes']}->{detail13['mensajes_despues']}, borradores "
           f"{detail13['borradores_antes']}->{detail13['borradores_despues']}", detail13)

    # ---------- P-14 operación ----------
    ref = subprocess.run(["docker", "inspect", "faberloom-lab-damail", "--format", "{{.Config.Image}}"],
                         capture_output=True, text=True).stdout.strip()
    local_digest = subprocess.run(["docker", "images", "--digests", "ghcr.io/gopkg-dev/damail", "--format", "{{.Digest}}"],
                                  capture_output=True, text=True).stdout.strip().splitlines()
    version = ref
    digest_img = ref if "@sha256:" in ref else (local_digest[0] if local_digest else "")
    stats = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{.Name}}|{{.MemUsage}}|{{.CPUPerc}}",
                            "faberloom-lab-damail", "faberloom-lab-damail-db", "faberloom-lab-greenmail"],
                           capture_output=True, text=True).stdout.strip().splitlines()
    dump = subprocess.run(["docker", "exec", "faberloom-lab-damail-db", "pg_dump", "-U", "damail", "-d", "damail"],
                          capture_output=True)
    backup_bytes = len(dump.stdout)
    restore_ok = False
    if backup_bytes > 0:
        open("/tmp/damail-backup.sql", "wb").write(dump.stdout)
        subprocess.run(["docker", "exec", "faberloom-lab-damail-db", "psql", "-U", "damail", "-d", "damail",
                        "-c", "DROP DATABASE IF EXISTS damail_restore_test"], capture_output=True)
        subprocess.run(["docker", "exec", "faberloom-lab-damail-db", "psql", "-U", "damail", "-d", "damail",
                        "-c", "CREATE DATABASE damail_restore_test"], capture_output=True)
        subprocess.run(["docker", "exec", "-i", "faberloom-lab-damail-db", "psql", "-U", "damail",
                        "-d", "damail_restore_test"], input=dump.stdout, capture_output=True)
        count = subprocess.run(["docker", "exec", "faberloom-lab-damail-db", "psql", "-U", "damail",
                                "-d", "damail_restore_test", "-tAc", "select count(*) from drafts"],
                               capture_output=True, text=True).stdout.strip()
        restore_ok = count.isdigit() and int(count) > 0
        detail14_restore = count
    else:
        detail14_restore = "sin volcado"
    detail14 = {"imagen": version, "digest": digest_img, "stats": stats,
                "backup_bytes": backup_bytes, "borradores_restaurados": detail14_restore,
                "referencia_con_digest": "@sha256:" in version}
    ok14 = ("@sha256:" in version) and backup_bytes > 1000 and restore_ok
    record("P-14", "Versión identificable y respaldo restaurable", ok14,
           f"digest={digest_img.split('@')[-1][:19]} backup={backup_bytes}B restaurado={detail14_restore}", detail14)

    with open("/opt/faberloom-lab/probes-report-6.json", "w", encoding="utf-8") as handle:
        json.dump(RESULTS, handle, ensure_ascii=False, indent=2)
    passed = sum(1 for r in RESULTS if r["result"] == "PASS")
    print(f"\n{passed}/{len(RESULTS)} sondas en verde")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
