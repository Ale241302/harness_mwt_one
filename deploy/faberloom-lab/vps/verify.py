"""Verifica el laboratorio en el VPS. Cuentas sinteticas, dominio .test."""
import imaplib, smtplib, sys
from email.message import EmailMessage

HOST, SMTP_PORT, IMAP_PORT = "127.0.0.1", 3025, 3143
USERS = {"piloto-a@faberloom.test": "lab-only-a", "piloto-b@faberloom.test": "lab-only-b"}
results = []

def check(name, fn):
    try:
        results.append((name, "PASS", fn() or ""))
    except Exception as exc:
        results.append((name, "FAIL", f"{type(exc).__name__}: {exc}"))

def imap_login(user, password):
    def run():
        conn = imaplib.IMAP4(HOST, IMAP_PORT)
        try:
            conn.login(user.split("@")[0], password)
            typ, _ = conn.select("INBOX", readonly=True)
            return f"login ok, INBOX {typ}"
        finally:
            try: conn.logout()
            except Exception: pass
    return run

def send_between():
    msg = EmailMessage()
    msg["From"] = "piloto-a@faberloom.test"
    msg["To"] = "piloto-b@faberloom.test"
    msg["Subject"] = "prueba de laboratorio VPS"
    msg.set_content("mensaje sintetico del laboratorio FaberLoom en el VPS")
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
        if count < 1: raise AssertionError("el mensaje no llego")
        return f"{count} mensaje(s) en INBOX"
    finally:
        try: conn.logout()
        except Exception: pass

for user, password in USERS.items():
    check(f"imap:{user}", imap_login(user, password))
check("smtp:envio_interno", send_between)
check("imap:recepcion", recibido)
check("dominio:sin_real", lambda: "todas las cuentas son .test" if all(u.endswith("@faberloom.test") for u in USERS) else (_ for _ in ()).throw(AssertionError("dominio real")))

width = max(len(n) for n, _, _ in results)
failed = 0
for name, verdict, detail in results:
    if verdict == "FAIL": failed += 1
    print(f"{verdict:4}  {name.ljust(width)}  {detail}")
print(f"\n{len(results)-failed}/{len(results)} comprobaciones en verde")
sys.exit(1 if failed else 0)
