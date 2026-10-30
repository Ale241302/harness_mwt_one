Console provider-key vault — deployment copy
=============================================

This directory versions the MWT.ONE console half of the shared provider-key
vault. The harness half is `packages/credentials/credentials-console`.

Files
-----

  harness_provider_key_views.py  Django viewset (copy to backend/apps/core/)
  03_harness_vault.sql           table + tombstone column (run once, and mount
                                 for a fresh database)
  reencrypt_vault.py             re-encrypt existing rows after introducing a
                                 dedicated HARNESS_VAULT_KEY

API
---

  GET    /api/harness/provider-keys/          -> { "keys": [...] }
  POST   /api/harness/provider-keys/          -> { "ref", "updatedAt" }
         body: { "ref": "<NAME>", "value": "<secret>" }
  DELETE /api/harness/provider-keys/<ref>/    -> 204, writes a tombstone

Rows:
  value row      { "ref", "value", "updatedAt" }
  tombstone      { "ref", "deleted": true, "updatedAt" }

The viewset is self-scoped by `request.user.email` and sets `rbac_bypass = True`
(it only touches the caller's rows). A POST revives a tombstone.

Install
-------

1. Copy the view:

     cp harness_provider_key_views.py /opt/consola-mwt-one/backend/apps/core/

2. Register it in `backend/apps/core/harness_urls.py`:

     from .harness_provider_key_views import HarnessProviderKeyViewSet
     router.register(r"provider-keys", HarnessProviderKeyViewSet, basename="harness-provider-keys")

3. Create or upgrade the table:

     docker exec consola-mwt-one-postgres psql -U mwt -d mwt_one -f 03_harness_vault.sql

   For a database created from scratch, also copy the file to
   `/opt/consola-mwt-one/database/03_harness_vault.sql` and mount it in the
   postgres service of docker-compose.yml:

     - ./database/03_harness_vault.sql:/docker-entrypoint-initdb.d/03-harness-vault.sql:ro

4. Encryption key. Without HARNESS_VAULT_KEY the view derives a Fernet key from
   DJANGO_SECRET_KEY. For a dedicated key, append one line to
   `/opt/consola-mwt-one/.env`:

     HARNESS_VAULT_KEY=<Fernet key>

   Generate it without printing:

     KEY=$(docker exec consola-mwt-one-django python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')
     printf 'HARNESS_VAULT_KEY=%s\n' "$KEY" >> /opt/consola-mwt-one/.env

   If rows already exist under the derived key, re-encrypt them before the new
   container starts:

     docker cp reencrypt_vault.py consola-mwt-one-django:/tmp/reencrypt_vault.py
     docker exec -w /app -e PYTHONPATH=/app \
       -e HARNESS_VAULT_KEY="$KEY" -e DJANGO_SETTINGS_MODULE=config.settings \
       consola-mwt-one-django python /tmp/reencrypt_vault.py

   Back up `.env` and the table first (the vault key is required to read the
   rows back).

5. Recreate Django so it reads the environment:

     docker compose up -d --no-deps django

6. Smoke test with an account token:

     GET  https://consola.mwt.one/api/harness/provider-keys/
     POST { "ref": "OPENAI_API_KEY", "value": "sk-test" }
     GET  -> value returned to the owner
     DELETE /api/harness/provider-keys/OPENAI_API_KEY/ -> 204
     GET  -> { "ref": "OPENAI_API_KEY", "deleted": true }

Security
--------

- Only the authenticated owner's email is read or written.
- Values are encrypted at rest with Fernet; responses never echo a value on
  write.
- Tombstones deliberately keep the reference and timestamp, not the secret.
- Rotating HARNESS_VAULT_KEY without re-encrypting makes existing rows
  unreadable; back up the key with the database.
