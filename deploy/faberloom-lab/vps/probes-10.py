"""P-06 completo en una sola corrida: borrador, campos, adjunto, envío y bytes en destino."""

from __future__ import annotations

import hashlib
import imaplib
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from email import message_from_bytes
from http.cookiejar import CookieJar

BASE = "http://127.0.0.1:8787"


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
            return exc.code, json.loads(exc.read() or b"null")


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


def main() -> int:
    client = Client()
    client.call("POST", "/api/auth/login", {"username": "labadmin", "password": "LabOnly-Admin-2026"})
    run = uuid.uuid4().hex[:8]
    subject = f"P06-{run}"
    body_text = f"cuerpo revisado {run}"
    payload = (f"adjunto-{run}-".encode() * 200) + bytes(range(256))

    _, draft = client.call("POST", "/api/v1/drafts", {
        "mode": "new", "accountId": 1,
        "to": ["piloto-b@faberloom.test"],
        "cc": ["cc@faberloom.test"],
        "bcc": ["bcc@faberloom.test"],
        "subject": subject,
        "body": body_text,
    })
    did = draft.get("id")

    raw_body, ctype = multipart("file", f"prueba-{run}.bin", payload, "application/octet-stream")
    upload_code, _ = client.call("POST", f"/api/v1/drafts/{did}/attachments", raw=raw_body, content_type=ctype)

    _, revisado = client.call("GET", f"/api/v1/drafts/{did}")
    adjuntos = (revisado or {}).get("attachments") or []
    revision = (revisado or {}).get("revision", 0)

    send_code, _ = client.call("POST", f"/api/v1/drafts/{did}/send", {"revision": revision})
    time.sleep(12)
    client.call("POST", "/api/admin/accounts/2/sync")
    time.sleep(6)

    recibido = None
    conn = imaplib.IMAP4("127.0.0.1", 3143)
    conn.login("piloto-b", "lab-only-b")
    conn.select("INBOX", readonly=True)
    _, data = conn.search(None, "ALL")
    for num in reversed(data[0].split()):
        _, raw = conn.fetch(num, "(RFC822)")
        message = message_from_bytes(raw[0][1])
        if (message.get("Subject") or "") == subject:
            for part in message.walk():
                if part.get_filename():
                    recibido = part.get_payload(decode=True)
                    break
            break
    conn.logout()

    _, despues = client.call("GET", f"/api/v1/drafts/{did}")

    ok = (
        upload_code in (200, 201)
        and (revisado or {}).get("subject") == subject
        and ((revisado or {}).get("body") or "").strip() == body_text
        and "piloto-b@faberloom.test" in json.dumps((revisado or {}).get("to") or "")
        and "cc@faberloom.test" in json.dumps((revisado or {}).get("cc") or "")
        and "bcc@faberloom.test" in json.dumps((revisado or {}).get("bcc") or "")
        and send_code in (200, 201, 202)
        and recibido is not None
        and hashlib.sha256(recibido).hexdigest() == hashlib.sha256(payload).hexdigest()
    )

    report = {
        "id": "P-06",
        "name": "Borrador y adjunto idénticos de extremo a extremo",
        "result": "PASS" if ok else "FAIL",
        "detail": (
            f"subida={upload_code} enviar={send_code} estado_tras_enviar={(despues or {}).get('status')} "
            f"bytes={len(payload)}->{len(recibido) if recibido else 0} "
            f"sha256_igual={hashlib.sha256(recibido).hexdigest() == hashlib.sha256(payload).hexdigest() if recibido else False}"
        ),
        "evidence": {
            "borrador": did,
            "subject": (revisado or {}).get("subject"),
            "body_coincide": ((revisado or {}).get("body") or "").strip() == body_text,
            "to": (revisado or {}).get("to"),
            "cc": (revisado or {}).get("cc"),
            "bcc": (revisado or {}).get("bcc"),
            "revision_revisada": revision,
            "estado_tras_enviar": (despues or {}).get("status"),
            "adjunto_en_borrador": adjuntos,
            "bytes_enviado": len(payload),
            "bytes_recibido": len(recibido) if recibido else 0,
            "sha256_enviado": hashlib.sha256(payload).hexdigest(),
            "sha256_recibido": hashlib.sha256(recibido).hexdigest() if recibido else None,
            "verificado_en": "IMAP sobre el buzon de destino, no en la respuesta del envio",
        },
    }
    print(report["result"], report["detail"])
    open("/opt/faberloom-lab/probes-report-10.json", "w", encoding="utf-8").write(
        json.dumps([report], ensure_ascii=False, indent=2)
    )
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
