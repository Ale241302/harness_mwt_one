"""P-04 con vista completa y P-09 medido sobre el log con marcas de tiempo."""

from __future__ import annotations

import json
import re
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


def main():
    client = Client()
    client.call("POST", "/api/auth/login", {"username": "labadmin", "password": "LabOnly-Admin-2026"})
    run = uuid.uuid4().hex[:8]

    _, folders = items(client, "/api/v1/folders?account=1")
    ids = {(f.get("path") or f.get("name")): f.get("id") for f in folders}
    inbox_id, archive_id, trash_id = ids.get("INBOX"), ids.get("Archive"), ids.get("Trash")

    def lookup(subject):
        _, rows = items(client, f"/api/v1/messages?limit=50&view=all&account=1&q={urllib.parse.quote(subject)}")
        return next((r for r in rows if r.get("subject") == subject), None)

    def folder_of(msg_id):
        _, rows = items(client, "/api/v1/messages?limit=100&view=all&account=1")
        row = next((r for r in rows if r.get("id") == msg_id), None)
        return (row or {}).get("folder")

    def deliver(subject, text):
        msg = EmailMessage()
        msg["From"] = "piloto-a@faberloom.test"
        msg["To"] = "piloto-a@faberloom.test"
        msg["Subject"] = subject
        msg.set_content(text)
        with smtplib.SMTP("127.0.0.1", 3025, timeout=20) as smtp:
            smtp.send_message(msg)
        client.call("POST", "/api/admin/accounts/1/sync")
        time.sleep(6)

    detail = {"inbox": inbox_id, "archive": archive_id, "trash": trash_id}
    ok = False
    if inbox_id and archive_id and trash_id:
        subj = f"P04-{run}"
        deliver(subj, f"mover {run}")
        target = lookup(subj)
        steps = {}
        if target:
            client.call("POST", "/api/v1/messages/batch", {"ids": [target["id"]], "action": "move", "folderId": archive_id})
            steps["archive"] = folder_of(target["id"])
            client.call("POST", "/api/v1/messages/batch", {"ids": [target["id"]], "action": "move", "folderId": trash_id})
            steps["trash"] = folder_of(target["id"])
            client.call("POST", "/api/v1/messages/batch", {"ids": [target["id"]], "action": "move", "folderId": inbox_id})
            steps["restored"] = folder_of(target["id"])
            subj2 = f"P04b-{run}"
            deliver(subj2, "borrar definitivo")
            t2 = lookup(subj2)
            if t2:
                client.call("POST", "/api/v1/messages/batch", {"ids": [t2["id"]], "action": "move", "folderId": trash_id})
                c_del, r_del = client.call("POST", "/api/v1/messages/batch", {"ids": [t2["id"]], "action": "delete"})
                steps["delete"] = folder_of(t2["id"])
                steps["delete_respuesta"] = r_del
            detail["pasos"] = steps
            ok = (steps.get("archive") == "Archive" and steps.get("trash") == "Trash"
                  and steps.get("restored") == "INBOX" and steps.get("delete") is None)
    record("P-04", "Mover, papelera, restaurar y borrar sobre la ocurrencia exacta", ok,
           json.dumps(detail.get("pasos"), ensure_ascii=False) if detail.get("pasos") else "no se pudo preparar", detail)

    # ---- P-09: intentos acotados y espaciados, medidos con -t ----
    log = subprocess.run(["docker", "logs", "-t", "--since", "30m", "faberloom-lab-damail"],
                         capture_output=True, text=True).stdout
    attempts = []
    for line in log.splitlines():
        match = re.search(r"^(\S+) .*草稿 (\d+) 发送失败（第 (\d+) 次）", line)
        if match:
            attempts.append({"ts": match.group(1), "draft": int(match.group(2)), "n": int(match.group(3))})
    by_draft: dict[int, list[dict]] = {}
    for row in attempts:
        by_draft.setdefault(row["draft"], []).append(row)
    bounded = {d: [r["n"] for r in rows] for d, rows in by_draft.items()}
    ok9 = bool(bounded) and all(max(seq) == 3 and len(seq) == 3 for seq in bounded.values())
    record("P-09", "Timeout con reintento acotado (3 intentos, no ciego)", ok9,
           f"borradores con fallo y sus intentos: {bounded}",
           {"intentos": attempts[-9:], "por_borrador": bounded})

    with open("/opt/faberloom-lab/probes-report-4.json", "w", encoding="utf-8") as handle:
        json.dump(RESULTS, handle, ensure_ascii=False, indent=2)
    passed = sum(1 for r in RESULTS if r["result"] == "PASS")
    print(f"\n{passed}/{len(RESULTS)} sondas en verde")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
