# Volumen real de los dos buzones

Contrato: C-FL-02 / O0-07 / FM-O0-07 Revisión del producto: `0b01ca39365ba04fe89858bcac56e3523896ee4d` Nivel: `OBSERVADO_REAL` (metadatos de buzón). No es C1-E ni C1-I. Autorización: `AUTH-2026-11-16-F0-7`, ampliada por instrucción expresa del CEO del 2026-11-16.

## 1. Qué se midió y qué no

- Servidor: `imap.hostinger.com:993`, TLS, sesión de solo lectura (`EXAMINE`).
- Consultas: `STATUS (MESSAGES UIDNEXT SIZE)` por carpeta y `SEARCH SINCE` para el conteo de 90 días. Ninguna descarga de cuerpo, asunto, remitente ni adjunto.
- **No** se marcó, movió, borró ni respondió nada. `EXAMINE` no modifica flags.
- **No** se midieron formatos de adjunto: exige leer cabeceras MIME y eso entra en contenido. Se declara como no medido.
- Las credenciales no se escribieron en ningún archivo, log ni evidencia. Se usaron desde el entorno del proceso y se descartaron al terminar.

## 2. Resultado

### Cuenta A

| Carpeta | Mensajes | Tamaño | Últimos 90 días |
|---|---:|---:|---:|
| INBOX | 2.639 | 467,0 MB | 467 |
| INBOX.Mesa-Backups | 200 | 119,6 MB | 200 |
| INBOX.Sent | 124 | 223,8 MB | 7 |
| INBOX.Trash | 92 | 2,1 MB | — |
| INBOX.Drafts | 6 | 1,4 MB | — |
| INBOX.Junk | 3 | 0,03 MB | — |
| **Total** | **3.064** | **813,9 MB** | **674** |

### Cuenta B

| Carpeta | Mensajes | Tamaño | Últimos 90 días |
|---|---:|---:|---:|
| INBOX | 3.002 | 612,1 MB | 229 |
| INBOX.Sent | 221 | 114,5 MB | 25 |
| INBOX.Trash | 14 | 3,6 MB | — |
| INBOX.Junk | 0 | 0 | — |
| INBOX.Drafts | 0 | 0 | — |
| **Total** | **3.237** | **730,3 MB** | **254** |

### Conjunto

| Métrica | Valor |
|---|---:|
| Mensajes totales | **6.301** |
| Tamaño total | **1,51 GiB** |
| Mensajes de los últimos 90 días | **928** (~10,3 por día) |
| Carpetas | 11 |
| Errores de medición | 0 |

## 3. Tres hallazgos que cambian decisiones

1. **Los buzones no están en el mailcow del VPS.** Responden en `imap.hostinger.com`. La infraestructura mailcow del servidor sirve otros dominios, no estos dos. Esto **corrige** una hipótesis del inventario anterior y cambia la comparación de motores: la vía "IMAP directo contra mailcow" que planteé como alternativa no aplica a los buzones del piloto. La decisión 4b ("usa el conector de Hostinger") sí aplica, y Hostinger es el proveedor de estos buzones.
2. **Existe una copia de la Mesa dentro de un buzón**: `INBOX.Mesa-Backups`, 200 mensajes, 119,6 MB, todos de los últimos 90 días. Es una quinta copia de datos que el inventario no tenía. Entra en `T18`/`R2-18` como destino de copia a inventariar, y no se toca.
3. **El volumen es manejable**: 928 mensajes en 90 días no justifican por sí solos un motor nuevo. Lo que duele no es el volumen, es el tiempo de resolución por mensaje. Eso sostiene la decisión de construir sobre un motor existente en vez de escribirlo.

## 4. Consecuencia para el plan

- `O0-07` queda con evidencia real: universo (todas las carpetas de las dos cuentas), ventana (histórico completo para cantidad y tamaño; 90 días para el ritmo) y consulta sin contenido.
- El dimensionamiento de memoria y búsqueda ya tiene una base: ~1,5 GiB de correo, 6.301 mensajes, 11 carpetas.
- La conversión de adjuntos sigue sin medirse: no se leyó ningún MIME. Ese dato falta y se declara.

## 5. Reproducir

El guion vive fuera del repositorio (`%TEMP%\opencode\imap-aggregates.py`), lee las credenciales de variables de entorno y no las imprime. Cualquier repetición exige autorización vigente; las contraseñas usadas quedaron expuestas en la conversación y **deben rotarse**.
