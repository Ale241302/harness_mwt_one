import base64
import hashlib
import os

import django
from cryptography.fernet import Fernet
from django.conf import settings

django.setup()

from django.db import connection  # noqa: E402  (Django setup must run first)

new_key = os.environ["HARNESS_VAULT_KEY"].strip()
if new_key == "":
    raise SystemExit("HARNESS_VAULT_KEY missing")

old = Fernet(base64.urlsafe_b64encode(
    hashlib.sha256(f"harness-provider-vault:{settings.SECRET_KEY}".encode()).digest()
))
new = Fernet(new_key.encode("ascii"))

migrated = 0
with connection.cursor() as cursor:
    cursor.execute(
        "SELECT owner_email, ref, ciphertext FROM core.harness_provider_keys "
        "WHERE deleted = false AND ciphertext <> ''"
    )
    rows = cursor.fetchall()
    for owner_email, ref, ciphertext in rows:
        try:
            value = old.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
        except Exception:
            continue
        cursor.execute(
            "UPDATE core.harness_provider_keys SET ciphertext = %s "
            "WHERE owner_email = %s AND ref = %s",
            [new.encrypt(value.encode("utf-8")).decode("ascii"), owner_email, ref],
        )
        migrated += 1
print(f"reencrypted={migrated} candidates={len(rows)}")
