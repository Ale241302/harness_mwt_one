"""Verifica el laboratorio: dos cuentas, IMAP y SMTP, cero destinos reales.

No contiene credenciales reales. Las cuentas son sintéticas y la contraseña es de laboratorio.
Salida: PASS/FAIL por comprobación. Nivel C1-E sobre el laboratorio, no sobre el producto.
"""

import imaplib
import smtplib
import socket
import sys
from email.message import EmailMessage

HOST = "127.0.0.1"
SMTP_PORT = 3025
IMAP_PORT = 3143
USERS = {"piloto-a@faberloom.test": "lab-only-a", "piloto-b@faberloom.test": "lab-only-b"}

results = []


def check(name, fn):
    try:
        detail = fn()
        results.append((name, "PASS", detail or ""))
    except Exception as exc:  # noqa: BLE001 - el detalle importa
        results.append((name, "FAIL", f"{type(exc).__name__}: {exc}"))


def imap_login(user, password):
    def run():
        conn = imaplib.IMAP4(HOST, IMAP_PORT)
        try:
            conn.login(user.split("@")[0], password)
            typ, _ = conn.select("INBOX", readonly=True)
            return f"login ok, INBOX {typ}"
        finally:
            try:
                conn.logout()
            except Exception:
                pass

    return run


def send_between():
    msg = EmailMessage()
    msg["From"] = "piloto-a@faberloom.test"
    msg["To"] = "piloto-b@faberloom.test"
    msg["Subject"] = "prueba de laboratorio"
    msg.set_content("mensaje sintético del laboratorio FaberLoom")
    with smtplib.SMTP(HOST, SMTP_PORT) as smtp:
        smtp.send_message(msg)
    return "aceptado por el SMTP de prueba"


def recibido():
    conn = imaplib.IMAP4(HOST, IMAP_PORT)
    try:
        conn.login("piloto-b", "lab-only-b")
        conn.select("INBOX", readonly=True)
        typ, data = conn.search(None, "ALL")
        count = len(data[0].split()) if data and data[0] else 0
        if count < 1:
            raise AssertionError("el mensaje no llegó al buzón de destino")
        return f"{count} mensaje(s) en INBOX"
    finally:
        try:
            conn.logout()
        except Exception:
            pass


for user, password in USERS.items():
    check(f"imap:{user}", imap_login(user, password))

check("smtp:envio_interno", send_between)
check("imap:recepcion", recibido)
check("dominio:sin_real", lambda: (_ for _ in ()).throw(AssertionError("dominio real")) if any(not u.endswith("@faberloom.test") for u in USERS) else "todas las cuentas son .test")

width = max(len(name) for name, _, _ in results)
failed = 0
for name, verdict, detail in results:
    if verdict == "FAIL":
        failed += 1
    print(f"{verdict:4}  {name.ljust(width)}  {detail}")

print(f"\n{len(results) - failed}/{len(results)} comprobaciones en verde")
sys.exit(1 if failed else 0)
