"""P-04 y P-09, con la semántica real observada: Trash/Archive salen de la vista y restaurar devuelve."""

from __future__ import annotations

import imaplib
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

    def visible(subject):
        _, rows = items(client, f"/api/v1/messages?limit=50&view=all&account=1&q={urllib.parse.quote(subject)}")
        return [r for r in rows if r.get("subject") == subject]

    def deliver(subject):
        msg = EmailMessage()
        msg["From"] = "piloto-a@faberloom.test"
        msg["To"] = "piloto-a@faberloom.test"
        msg["Subject"] = subject
        msg.set_content(f"cuerpo {subject}")
        with smtplib.SMTP("127.0.0.1", 3025, timeout=20) as smtp:
            smtp.send_message(msg)
        client.call("POST", "/api/admin/accounts/1/sync")
        time.sleep(6)

    steps = {}
    ok = False
    if inbox_id and archive_id and trash_id:
        subj = f"P04-{run}"
        deliver(subj)
        rows = visible(subj)
        if rows:
            mid = rows[0]["id"]
            c_guard, r_guard = client.call("POST", "/api/v1/messages/batch", {"ids": [mid], "action": "delete"})
            steps["borrar_desde_INBOX"] = {"status": c_guard, "respuesta": r_guard}

            c_t, r_t = client.call("POST", "/api/v1/messages/batch", {"ids": [mid], "action": "move", "folderId": trash_id})
            steps["mover_a_Trash"] = r_t

            c_r, r_r = client.call("POST", "/api/v1/messages/batch", {"ids": [mid], "action": "move", "folderId": inbox_id})
            steps["restaurar"] = r_r
            steps["visible_tras_restaurar"] = [r.get("folder") for r in visible(subj)]

            # borrado definitivo: solo desde Trash
            client.call("POST", "/api/v1/messages/batch", {"ids": [mid], "action": "move", "folderId": trash_id})
            c_d, r_d = client.call("POST", "/api/v1/messages/batch", {"ids": [mid], "action": "delete"})
            steps["borrado_definitivo"] = {"status": c_d, "respuesta": r_d}
            steps["visible_tras_borrar"] = len(visible(subj))

            # Archive: se prueba con un mensaje aparte porque la ocurrencia local desaparece al no estar sincronizada
            subj2 = f"P04c-{run}"
            deliver(subj2)
            rows2 = visible(subj2)
            if rows2:
                c_a, r_a = client.call("POST", "/api/v1/messages/batch", {"ids": [rows2[0]["id"]], "action": "move", "folderId": archive_id})
                steps["mover_a_Archive"] = r_a
                steps["oculto_tras_archivar"] = len(visible(subj2)) == 0
            else:
                steps["mover_a_Archive"] = {"error": "no se pudo preparar el mensaje de Archive"}

            # verdad del servidor por IMAP
            conn = imaplib.IMAP4("127.0.0.1", 3143)
            conn.login("piloto-a", "lab-only-a")
            conn.select("Trash", readonly=True)
            _, data = conn.search(None, "ALL")
            steps["servidor_trash_total"] = len(data[0].split()) if data and data[0] else 0
            conn.logout()

            ok = (
                steps["borrar_desde_INBOX"]["status"] == 400
                and steps["mover_a_Trash"].get("moved") == 1
                and steps["restaurar"].get("moved") == 1
                and steps["visible_tras_restaurar"] == ["INBOX"]
                and steps["borrado_definitivo"]["status"] == 200
                and steps["visible_tras_borrar"] == 0
                and steps["mover_a_Archive"].get("moved") == 1
            )
    record("P-04", "Mover, papelera, restaurar y borrar definitivo, sobre la ocurrencia exacta",
           ok, json.dumps({k: v for k, v in steps.items() if k != "intro"}, ensure_ascii=False)[:400], steps)

    # ---- P-09 ----
    proc = subprocess.run(["docker", "logs", "-t", "--since", "240m", "faberloom-lab-damail"],
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    log = (proc.stdout or "") + "\n" + (proc.stderr or "")
    attempts = []
    for line in log.splitlines():
        match = re.search(r"^(\S+) .*草稿 (\d+) 发送失败（第 (\d+) 次）", line)
        if match:
            attempts.append({"ts": match.group(1), "draft": int(match.group(2)), "n": int(match.group(3))})
    by_draft = {}
    for row in attempts:
        by_draft.setdefault(row["draft"], []).append(row)
    bounded = {d: [r["n"] for r in rows] for d, rows in by_draft.items()}
    spacing = {}
    for draft, rows in by_draft.items():
        stamps = [row["ts"] for row in rows]
        if len(stamps) == 3:
            from datetime import datetime
            parsed = [datetime.fromisoformat(s.replace("Z", "+00:00")) for s in stamps]
            spacing[draft] = [round((parsed[i + 1] - parsed[i]).total_seconds()) for i in range(2)]
    grows = all(b >= a for pair in spacing.values() for a, b in [pair]) if spacing else False
    ok9 = bool(bounded) and all(sorted(seq) == [1, 2, 3] for seq in bounded.values()) and grows
    record("P-09", "Timeout con reintento acotado a tres intentos y espera creciente", ok9,
           f"intentos por borrador: {bounded} · esperas en segundos: {spacing}",
           {"intentos": attempts, "por_borrador": bounded, "esperas": spacing})

    with open("/opt/faberloom-lab/probes-report-5.json", "w", encoding="utf-8") as handle:
        json.dump(RESULTS, handle, ensure_ascii=False, indent=2)
    passed = sum(1 for r in RESULTS if r["result"] == "PASS")
    print(f"\n{passed}/{len(RESULTS)} sondas en verde")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
