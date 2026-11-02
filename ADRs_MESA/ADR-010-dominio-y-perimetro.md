# ADR-010 · Dominio `muitowork.com` y perímetro de la VPS

**Estado:** aceptado · **Fecha:** 2/11/2026 · **Decisión:** cierre del incidente de a2hosting
**Relacionado:** `ADR-008` (respaldo y copia externa), `ADR-006` (Mesa central)

## Contexto

La cuenta de a2hosting que servía `muitowork.com` quedó suspendida. Cloudflare
seguía proxeando el apex a `68.66.226.85`, así que el sitio público respondía
`302 → /cgi-sys/suspendedpage.cgi`, y el FTP y el IMAP de esa cuenta devolvían
`530`. En Hostinger la cuenta activa es sólo de correo (MX, SPF y DKIM ya
apuntaban ahí); el sitio no tenía dónde servirse.

La VPS ya publica la plataforma en `:3100` (`mwt-builder-nginx`) para
`builder.muito.work`, y el certificado self-signed compartido lo acepta Cloudflare
porque la zona no está en Full (strict).

## Decisión

1. **El apex se sirve desde la VPS.** `muitowork.com` y `www.muitowork.com`
   apuntan a `187.77.218.102`, proxeados. El bloque vive en
   `/opt/mwt/nginx/builder.conf` (montado en el contenedor `mwt-nginx`), con el
   mismo upstream `host.docker.internal:3100` y el mismo certificado que
   `builder.muito.work`. El archivo original queda en `builder.conf.bak-<UTC>`.
2. **Se borran los registros que apuntaban al servidor suspendido:**
   `autoconfig`, `autodiscover`, `_autodiscover._tcp` (SRV), `cpanel`, `whm`,
   `webdisk`, `cpcontacts`, `cpcalendars`, `webmail`, `ranawalkreact` y
   `www.ranawalkreact`. Los valores anteriores están en
   `/root/muitowork-dns-20261102T193612Z.json`. (`mail` y `smtp` también se
   borraron y luego se recrearon como CNAME a Hostinger; ver más abajo.)
3. **El correo no se toca:** siguen `MX` a `mx1`/`mx2.hostinger.com`, el `SPF`
   con `_spf.mail.hostinger.com`, el `DMARC` y los tres CNAME de DKIM de
   Hostinger. Los clientes usan `imap.hostinger.com:993` y
   `smtp.hostinger.com:465`; ya no existe un `mail.<dominio>` que prometa otra cosa.
4. **`ftp.muitowork.com` pasa a la VPS con un SFTP aislado** en el puerto 2223
   (`ADR-008`), en lugar de apuntar a la cuenta suspendida.

### Nombres de vanidad del correo

`mail.muitowork.com` (CNAME a `imap.hostinger.com`) y `smtp.muitowork.com` (CNAME a
`smtp.hostinger.com`) existen para que un cliente se configure con el dominio. **No
sirven con validación de certificado**: Hostinger presenta un certificado cuyo
`subjectAltName` cubre `hostinger.com` y sus TLD, no `muitowork.com`. Medido:

| Comprobación | Resultado |
|---|---|
| `openssl s_client -connect imap.hostinger.com:993 -servername mail.muitowork.com` | `Verify return code: 62 (hostname mismatch)` |
| `IMAP4_SSL('mail.muitowork.com', 993)` con `check_hostname=True` | `CERTIFICATE_VERIFY_FAILED: Hostname mismatch` |
| `smtp.muitowork.com:465` | mismo `62 (hostname mismatch)` |

Un cliente acepta la excepción una vez o rechaza la conexión; cada rotación del
certificado de Hostinger vuelve a preguntar. Los nombres correctos son
`imap.hostinger.com:993` y `smtp.hostinger.com:465`, que sí validan.

Para retirarlos:

```sh
# con el token de /root/.cloudflare
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/080955670fa7ef05d7888daead9b93b9/dns_records/<id>"
```

## Consecuencias

- `https://muitowork.com` responde 200 con la plataforma; la página de suspendido
  desapareció. Verificado por `https://www.muitowork.com` también.
- Cloudflare queda con 15 registros: apex, `www`, `ftp`, `mail`, `smtp`,
  `localhost`, dos `MX`, dos `TXT` del apex, `_dmarc`, el DKIM por selector y los
  tres CNAME de Hostinger.
- El certificado del origen sigue siendo self-signed. Si alguien pasa la zona a
  **Full (strict)**, el sitio devuelve 526: hace falta un certificado válido en el
  origen (Let's Encrypt por DNS-01 con el token que ya vive en
  `/root/.cloudflare`) o volver a Full.
- `ranawalkreact.muitowork.com` se borró con el resto. Si esa aplicación vuelve a
  usarse, se recrea el registro y se le da su propio vhost; no se reutiliza el
  apex.
- El token de Cloudflare usado es el `Edit zone DNS` que ya existía en
  `/root/.cloudflare` (permiso de zona DNS, sin lectura de ajustes: el modo SSL no
  se puede leer ni cambiar con él).

## Verificación

| Hecho | Dato |
|---|---|
| DNS del apex | `1.1.1.1` y `8.8.8.8` devuelven las IPs de Cloudflare; el borde sirve el sitio, no a2 |
| `https://muitowork.com` | `200` con el título `MWT Builder · Plataforma Corporativa`, sin rastro de `suspended` |
| `https://www.muitowork.com` | `200` |
| Origen local | `curl -H 'Host: muitowork.com' http://127.0.0.1/` → `200`, 498 bytes |
| Registros | 13, ninguno apunta a `68.66.226.85` |
| Respaldo DNS | `/root/muitowork-dns-20261102T193612Z.json` (8 645 bytes) |

## Riesgos residuales

- El modo SSL de la zona no se puede leer con este token; el sitio funciona hoy,
  pero un cambio manual a Full (strict) lo rompería sin aviso.
- El token tiene alcance de DNS sobre **todas** las zonas de la cuenta. Conviene
  crear uno dedicado a `muitowork.com` y rotar el compartido.
- El segundo factor del buzón de Hostinger se activa en hPanel, que no está
  automatizado aquí.
