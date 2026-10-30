"""MWT.ONE · apps.core.harness_provider_key_views — bóveda de claves de proveedor.

El harness de escritorio y el harness del VPS son instalaciones distintas: cada
una guarda sus claves de modelo en su propio `DSH_HOME`. Esta vista es el punto
común por cuenta: el harness sube aquí cada clave que el usuario escribe, baja
las que escribió en el otro equipo y propaga también los borrados mediante una
lápida (`deleted = true`) que el otro equipo aplica como `unset`.

Seguridad:
  · Sólo el dueño autenticado lee o escribe sus filas (`owner_email`).
  · El valor se guarda cifrado con Fernet. La clave sale de
    `HARNESS_VAULT_KEY`; si no está definida se deriva de `DJANGO_SECRET_KEY`.
  · La respuesta de escritura nunca devuelve el valor.
"""
import os
import re

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import connection
from rest_framework import viewsets
from rest_framework.response import Response

#: Referencias admitidas: las que el harness deriva para una ruta
#: (`OPENAI_API_KEY`) o las que declara un perfil (`PROXY_USER_KEY`).
REF_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,128}$")

#: Tope de una clave; las claves de proveedor quedan muy por debajo.
MAX_VALUE_CHARS = 8192


def _viewer_email(request):
    """Correo canónico (minúsculas) del usuario autenticado."""
    return (getattr(request.user, "email", "") or "").strip().lower()


def _vault_cipher():
    """Cifrador Fernet de la bóveda, o `None` si no hay secreto utilizable."""
    configured = os.environ.get("HARNESS_VAULT_KEY", "").strip()
    if configured:
        return Fernet(configured.encode("ascii"))
    secret = getattr(settings, "SECRET_KEY", "") or ""
    if secret == "" or secret == "change-me-in-prod":
        return None
    # Derivación estable: el `SECRET_KEY` ya es el secreto de mayor valor del
    # despliegue; la etiqueta separa esta clave de cualquier otro uso.
    import base64
    import hashlib

    digest = hashlib.sha256(f"harness-provider-vault:{secret}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


class HarnessProviderKeyViewSet(viewsets.ViewSet):
    """Claves de proveedor por cuenta, cifradas y compartidas entre harnesses.

    Rutas (prefijo `/api/harness/`):
      · `GET    /api/harness/provider-keys/`          → claves y lápidas del usuario.
      · `POST   /api/harness/provider-keys/`          → crea o reemplaza una clave.
      · `DELETE /api/harness/provider-keys/<ref>/`    → marca la clave como borrada.
    """

    #: La vista sólo toca lo del propio usuario; no requiere módulo en el RBAC.
    rbac_bypass = True
    lookup_field = "ref"
    lookup_value_regex = r"[A-Za-z0-9_.-]{1,128}"

    def list(self, request):
        email = _viewer_email(request)
        if not email:
            return Response({"detail": "La identidad no tiene correo."}, status=400)
        cipher = _vault_cipher()
        if cipher is None:
            return Response(
                {"detail": "La bóveda de claves no tiene secreto configurado (HARNESS_VAULT_KEY)."},
                status=503,
            )
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT ref, ciphertext, deleted, updated_at "
                "  FROM core.harness_provider_keys "
                " WHERE owner_email = %s "
                " ORDER BY ref",
                [email],
            )
            rows = cursor.fetchall()
        keys = []
        for ref, ciphertext, deleted, updated_at in rows:
            if deleted:
                # La lápida viaja sin valor: el otro harness la aplica como unset.
                keys.append({"ref": ref, "deleted": True, "updatedAt": updated_at.isoformat()})
                continue
            try:
                value = cipher.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
            except (InvalidToken, ValueError):
                # Una fila cifrada con otra clave de bóveda se omite; el harness
                # la reemplaza la próxima vez que el usuario escriba esa clave.
                continue
            keys.append({
                "ref": ref,
                "value": value,
                "updatedAt": updated_at.isoformat(),
            })
        return Response({"keys": keys})

    def create(self, request):
        email = _viewer_email(request)
        if not email:
            return Response({"detail": "La identidad no tiene correo."}, status=400)
        data = request.data or {}
        ref = str(data.get("ref", "")).strip()
        value = data.get("value")
        if not REF_PATTERN.match(ref):
            return Response({"detail": "ref inválida."}, status=400)
        if not isinstance(value, str) or value == "" or len(value) > MAX_VALUE_CHARS:
            return Response({"detail": "value debe ser una cadena no vacía."}, status=400)
        cipher = _vault_cipher()
        if cipher is None:
            return Response(
                {"detail": "La bóveda de claves no tiene secreto configurado (HARNESS_VAULT_KEY)."},
                status=503,
            )
        ciphertext = cipher.encrypt(value.encode("utf-8")).decode("ascii")
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO core.harness_provider_keys (owner_email, ref, ciphertext, deleted, updated_at)
                VALUES (%s, %s, %s, false, now())
                ON CONFLICT (owner_email, ref)
                DO UPDATE SET ciphertext = excluded.ciphertext, deleted = false, updated_at = now()
                RETURNING updated_at
                """,
                [email, ref, ciphertext],
            )
            updated_at = cursor.fetchone()[0]
        return Response({"ref": ref, "updatedAt": updated_at.isoformat()}, status=201)

    def destroy(self, request, ref=None):
        email = _viewer_email(request)
        if not email:
            return Response({"detail": "La identidad no tiene correo."}, status=400)
        normalized = str(ref or "").strip()
        if not REF_PATTERN.match(normalized):
            return Response({"detail": "ref inválida."}, status=400)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO core.harness_provider_keys (owner_email, ref, ciphertext, deleted, updated_at)
                VALUES (%s, %s, '', true, now())
                ON CONFLICT (owner_email, ref)
                DO UPDATE SET ciphertext = '', deleted = true, updated_at = now()
                """,
                [email, normalized],
            )
        return Response(status=204)
