"""Sondas P-01 a P-14 contra el laboratorio FaberLoom en el VPS.

No toca buzones reales: solo GreenMail en 127.0.0.1 y DaMail en 127.0.0.1:8787.
Escribe un informe JSON en /opt/faberloom-lab/probes-report.json.
"""

from __future__ import annotations

import json
import smtplib
import sys
import time
import urllib.error
import urllib.request
import uuid
from email.message import EmailMessage
from email.utils import make_msgid
from http.cookiejar import CookieJar

BASE = "http://127.0.0.1:8787"
SMTP = ("127.0.0.1", 3025)
ADMIN = ("labadmin", "LabOnly-Admin-2026")
RESULTS: list[dict] = []


def record(pid: str, name: str, ok: bool | None, detail: str, evidence: dict | None = None) -> None:
    RESULTS.append(
        {
            "id": pid,
            "name": name,
            "result": "PASS" if ok is True else ("FAIL" if ok is False else "NO_VERIFICADO"),
            "detail": detail,
            "evidence": evidence or {},
        }
    )
    print(f"{RESULTS[-1]['result']:14} {pid}  {name}  {detail}")


class Client:
    def __init__(self, default_headers=None) -> None:
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.default_headers = default_headers or {}

    def call(self, method: str, path: str, body=None, headers=None, raw=False):
        data = None
        hdrs = {"Accept": "application/json", **self.default_headers}
        if body is not None:
            data = json.dumps(body).encode()
            hdrs["Content-Type"] = "application/json"
        if method != "GET":
            hdrs["x-damail"] = "1"
        hdrs.update(headers or {})
        req = urllib.request.Request(f"{BASE}{path}", data=data, headers=hdrs, method=method)
        try:
            with self.opener.open(req, timeout=60) as response:
                payload = response.read()
                return response.status, (payload if raw else json.loads(payload or b"null"))
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            try:
                parsed = json.loads(payload or b"null")
            except json.JSONDecodeError:
                parsed = {"raw": payload[:200].decode("utf-8", "replace")}
            return exc.code, parsed

    def login(self) -> None:
        code, body = self.call("POST", "/api/auth/login", {"username": ADMIN[0], "password": ADMIN[1]})
        if code != 200:
            raise SystemExit(f"login fallo: {code} {body}")


def send_mail(sender: str, to: list[str], subject: str, body: str, message_id: str | None = None) -> str:
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    if message_id:
        msg["Message-ID"] = message_id
    msg.set_content(body)
    with smtplib.SMTP(*SMTP, timeout=20) as smtp:
        smtp.send_message(msg)
    return msg["Message-ID"] if msg["Message-ID"] else ""


def sync_all(client: Client) -> None:
    for account_id in (1, 2):
        client.call("POST", f"/api/admin/accounts/{account_id}/sync")
    time.sleep(6)


def items(client: Client, path: str):
    code, body = client.call("GET", path)
    if isinstance(body, dict):
        for key in ("items", "messages", "data"):
            if isinstance(body.get(key), list):
                return code, body[key], body
        return code, [], body
    if isinstance(body, list):
        return code, body, {}
    return code, [], body


def find_by_subject(client: Client, subject: str, account: int | None = None):
    query = f"/api/v1/messages?limit=50&q={urllib.parse.quote(subject)}"
    if account:
        query += f"&account={account}"
    code, rows, _ = items(client, query)
    return [row for row in rows if (row.get("subject") or "") == subject]


def main() -> int:
    import urllib.parse  # noqa: F401  (usado por find_by_subject)

    client = Client()
    client.login()
    run = uuid.uuid4().hex[:8]

    # ---------- P-02 dos buzones ----------
    subj_a = f"P02-A-{run}"
    subj_b = f"P02-B-{run}"
    send_mail("piloto-a@faberloom.test", ["piloto-a@faberloom.test"], subj_a, f"cuerpo A {run}")
    send_mail("piloto-b@faberloom.test", ["piloto-b@faberloom.test"], subj_b, f"cuerpo B {run}")
    sync_all(client)

    in_a = find_by_subject(client, subj_a, 1)
    in_a_foreign = find_by_subject(client, subj_b, 1)
    in_b = find_by_subject(client, subj_b, 2)
    in_b_foreign = find_by_subject(client, subj_a, 2)

    body_ok = False
    if in_a:
        code, detail = client.call("GET", f"/api/v1/messages/{in_a[0]['id']}?format=text")
        body_ok = isinstance(detail, dict) and f"cuerpo A {run}" in json.dumps(detail, ensure_ascii=False)

    record(
        "P-02",
        "Dos buzones sin mezcla",
        bool(in_a) and bool(in_b) and not in_a_foreign and not in_b_foreign and body_ok,
        f"A={len(in_a)} B={len(in_b)} A_ve_B={len(in_a_foreign)} B_ve_A={len(in_b_foreign)} cuerpo={body_ok}",
        {"subj_a": in_a[0] if in_a else None, "subj_b": in_b[0] if in_b else None},
    )

    # ---------- P-03 identidad ----------
    shared_id = make_msgid(domain="faberloom.test")
    subj_s = f"P03-SHARED-{run}"
    send_mail("piloto-a@faberloom.test", ["piloto-a@faberloom.test", "piloto-b@faberloom.test"], subj_s, f"compartido {run}", shared_id)
    sync_all(client)
    rows_s = find_by_subject(client, subj_s)
    accounts = sorted({row.get("accountId") for row in rows_s})
    ids = {row.get("id") for row in rows_s}
    msg_ids = {row.get("messageId") for row in rows_s}
    record(
        "P-03",
        "Misma identidad no colapsa ocurrencias",
        len(rows_s) == 2 and len(ids) == 2 and len(accounts) == 2 and len(msg_ids) == 1,
        f"filas={len(rows_s)} ids={len(ids)} cuentas={accounts} messageId_distintos={len(msg_ids)}",
        {"rows": [{k: r.get(k) for k in ("id", "accountId", "messageId", "folderId")} for r in rows_s]},
    )

    # ---------- P-05 búsqueda y límites ----------
    marker = f"MARCADOR{run}UNICO"
    subj_m = f"P05-{run}"
    send_mail("piloto-a@faberloom.test", ["piloto-a@faberloom.test"], subj_m, f"texto con {marker} dentro")
    sync_all(client)
    code, hits, _ = items(client, f"/api/v1/messages?limit=50&q={marker}")
    code2, miss, _ = items(client, f"/api/v1/messages?limit=50&q=NOEXISTE{run}")
    record(
        "P-05",
        "Búsqueda encuentra el marcador y no inventa",
        len(hits) >= 1 and all(marker in json.dumps(h, ensure_ascii=False) or h.get("subject") == subj_m for h in hits) and len(miss) == 0,
        f"hits={len(hits)} falsos_positivos={len(miss)}",
        {"hits": [h.get("subject") for h in hits]},
    )

    # ---------- P-01 alcance de credencial ----------
    code, key_body = client.call("POST", "/api/admin/api-keys", {"name": f"probe-{run}", "scopes": ["read", "draft"], "accountIds": [1]})
    key = key_body.get("key") if isinstance(key_body, dict) else None
    scoped = Client(default_headers={"Authorization": f"Bearer {key}"} if key else {})

    def key_call(method, path, body=None):
        return scoped.call(method, path, body)

    scope_ok = False
    detail_scope = {}
    if key:
        c1, own, _ = items(scoped, "/api/v1/messages?limit=50&account=1")
        c2, foreign, raw2 = items(scoped, "/api/v1/messages?limit=50&account=2")
        c3, draft_try = key_call("POST", "/api/v1/drafts", {"mode": "new", "accountId": 2, "subject": "prohibido", "body": "x"})
        foreign_subjects = [row.get("subject") for row in foreign if row.get("accountId") == 2]
        scope_ok = c1 == 200 and len(own) >= 1 and not foreign_subjects and c3 in (403, 404)
        detail_scope = {"own": len(own), "foreign_status": c2, "foreign_rows": len(foreign), "draft_otra_cuenta": c3}
    record(
        "P-01",
        "Credencial de A no alcanza B",
        scope_ok,
        json.dumps(detail_scope, ensure_ascii=False) if key else "no se pudo emitir la clave",
        detail_scope,
    )

    # ---------- P-06 borrador y adjuntos ----------
    draft_body = f"cuerpo revisado {run}"
    code, draft = client.call(
        "POST",
        "/api/v1/drafts",
        {
            "mode": "new",
            "accountId": 1,
            "to": ["piloto-b@faberloom.test"],
            "cc": ["cc@faberloom.test"],
            "bcc": ["bcc@faberloom.test"],
            "subject": f"P06-{run}",
            "body": draft_body,
        },
    )
    draft_id = draft.get("id") if isinstance(draft, dict) else None
    same = False
    detail_draft = {}
    if draft_id:
        code, fetched = client.call("GET", f"/api/v1/drafts/{draft_id}")
        same = all(
            [
                fetched.get("subject") == f"P06-{run}",
                (fetched.get("body") or "").strip() == draft_body,
                "piloto-b@faberloom.test" in json.dumps(fetched.get("to") or ""),
                "cc@faberloom.test" in json.dumps(fetched.get("cc") or ""),
                "bcc@faberloom.test" in json.dumps(fetched.get("bcc") or ""),
            ]
        )
        detail_draft = {
            "subject": fetched.get("subject"),
            "body_coincide": (fetched.get("body") or "").strip() == draft_body,
            "to": fetched.get("to"),
            "cc": fetched.get("cc"),
            "bcc": fetched.get("bcc"),
            "revision": fetched.get("revision"),
            "status": fetched.get("status"),
        }
    record("P-06", "Borrador con To/Cc/Bcc y cuerpo", same, f"draft_id={draft_id}", detail_draft)

    # ---------- P-07 barrera negativa: sin aprobación no sale ----------
    inbox_b_before = len([1 for _ in items(client, "/api/v1/messages?limit=100&account=2")[1]])
    time.sleep(15)
    inbox_b_after = len([1 for _ in items(client, "/api/v1/messages?limit=100&account=2")[1]])
    drafts_left = items(client, "/api/v1/drafts")[1]
    still_draft = any(d.get("id") == draft_id and (d.get("status") or "") in ("draft", "pending", "") for d in drafts_left)
    record(
        "P-07",
        "Borrador sin aprobación no envía",
        inbox_b_after == inbox_b_before and still_draft,
        f"INBOX B {inbox_b_before}->{inbox_b_after}, sigue en borrador={still_draft}",
        {"drafts": [{"id": d.get("id"), "status": d.get("status")} for d in drafts_left][:5]},
    )

    # ---------- P-08 carrera de aprobación ----------
    race_ok = False
    detail_race = {}
    if draft_id:
        c_sub, submitted = client.call("POST", f"/api/v1/drafts/{draft_id}/submit", {"note": "revision"})
        revision = (submitted or {}).get("revision") if isinstance(submitted, dict) else None
        c_patch, patched = client.call("PATCH", f"/api/v1/drafts/{draft_id}", {"body": draft_body + " CAMBIADO"})
        stale_send_code, stale_send = client.call(
            "POST", f"/api/v1/drafts/{draft_id}/send", {"revision": revision if revision is not None else 0}
        )
        fresh_revision = (patched or {}).get("revision") if isinstance(patched, dict) else None
        detail_race = {
            "submit": c_sub,
            "revision_enviada": revision,
            "patch": c_patch,
            "revision_tras_cambio": fresh_revision,
            "send_con_version_vieja": stale_send_code,
            "respuesta": stale_send,
        }
        race_ok = c_sub in (200, 201) and c_patch in (200, 201) and stale_send_code >= 400
    record(
        "P-08",
        "Cambiar el cuerpo invalida la aprobación vieja",
        race_ok,
        f"send con revisión vieja -> {detail_race.get('send_con_version_vieja')}",
        detail_race,
    )

    # ---------- P-10 conciliación: aceptación != entrega ----------
    recon_ok = False
    detail_recon = {}
    if draft_id:
        code, current = client.call("GET", f"/api/v1/drafts/{draft_id}")
        live_revision = (current or {}).get("revision", 0)
        c_send, sent = client.call("POST", f"/api/v1/drafts/{draft_id}/send", {"revision": live_revision})
        time.sleep(10)
        code, after = client.call("GET", f"/api/v1/drafts/{draft_id}")
        sync_all(client)
        landed = find_by_subject(client, f"P06-{run}", 2)
        delivered = find_by_subject(client, f"P06-{run}")
        detail_recon = {
            "send_status": c_send,
            "campo_status": (after or {}).get("status"),
            "enviado_a_greenmail": len(landed),
            "ocurrencias": len(delivered),
            "claves": sorted((after or {}).keys())[:25] if isinstance(after, dict) else [],
        }
        recon_ok = c_send in (200, 201, 202) and (after or {}).get("status") not in (None, "draft")
    record(
        "P-10",
        "Aceptación, entrega y estado distinguibles",
        recon_ok,
        f"status={detail_recon.get('campo_status')} llegó={detail_recon.get('enviado_a_greenmail')}",
        detail_recon,
    )

    with open("/opt/faberloom-lab/probes-report.json", "w", encoding="utf-8") as handle:
        json.dump(RESULTS, handle, ensure_ascii=False, indent=2)

    passed = sum(1 for r in RESULTS if r["result"] == "PASS")
    print(f"\n{passed}/{len(RESULTS)} sondas en verde")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
