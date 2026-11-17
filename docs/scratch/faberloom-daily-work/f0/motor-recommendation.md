# Recomendación de motor

Contrato: C-FL-03 / O1-03 / FM-O1-03 Estado: **recomendación condicional**. No es PC1 y no habilita construir el adaptador.

## 1. Qué recomiendo

**DaMail es el candidato que debe pasar al ensayo acotado**, no el motor elegido.

Motivos, en orden de peso:

1. Es el único de los tres que ya tiene **borradores con revisión** (`DM-02`). Sin borradores, la aprobación exacta de FaberLoom tiene que inventar el artefacto intermedio, y eso es exactamente lo que hoy hace mal la extensión propia.
2. Tiene **cola de envío con estado desconocido** y copia a Enviados (`DM-03`). La conciliación del punto 5 del plan se apoya en eso; Hostinger solo devuelve `204` (`H-03`).
3. La **IA viene apagada por base de datos** (`DM-04`), que es la condición que el plan exige y que no se satisface con una variable inexistente.
4. Sus **API keys tienen scopes** y buzones restringidos (`DM-05`), que es la base de la separación lectura/escritura que exige E1/E2.

## 2. Lo que esta recomendación NO dice

- No dice que DaMail esté listo. Falta todo el ensayo (§3).
- No dice que sea más barato. DaMail añade un producto, un PostgreSQL y un backup coordinado a un host que ya está al 54 % de disco y 5,6 de carga con 52 contenedores al inventariar (56 al cerrar, cuatro del laboratorio).
- No dice que Hostinger sea mala opción. Hostinger es más liviana de operar y tiene tokens restringibles, pero **no tiene borradores en su OpenAPI** (`H-05`) y su envío no reporta entrega (`H-03`).
- No descarta la extensión propia por gusto. La descarta **hoy** un baseline: 212-213 pruebas fallidas y 64 fallos de propiedad en la Mesa (`FL-01`, `FL-02`). Eso no es una preferencia, es una deuda medida.

## 3. Condiciones que bloquean la elección

Estas ocho no son "detalles a revisar". Mientras una esté abierta, PC1 no puede firmar DaMail.

| # | Condición | Cómo se cierra |
|---:|---|---|
| 1 | Aprobar en la web de DaMail **no** es aprobar en FaberLoom | Mediador de credencial en backend; la cookie web no se reutiliza |
| 2 | La clave con `send` **no tiene tope horario** | El mediador impone límite y Allow List antes de emitir |
| 3 | `getDraft`/`listDrafts` podrían filtrar por buzón y no por creador (`DM-02`) | Prueba de aislamiento con dos usuarios y dos buzones |
| 4 | Es **single-tenant**: usuarios web ven todos los buzones (`DM-05`) | Piloto de un dueño; terceros exigen instalación separada (N9) |
| 5 | Adjuntos por MCP no son arbitrarios (`DM-10`) | Probar el límite real y el camino REST |
| 6 | `SEND_DELAY_SEC`, tamaño de adjunto, Graph 4 MB, truncamiento de 30.000 caracteres y sincronización de 90 días deben quedar explícitos (`DM-03`, `DM-07`, `DM-12`) | Fijarlos en configuración y declararlos al CEO |
| 7 | Backup coordinado de PostgreSQL + `app-data` + secreto (`DM-11`) | Ensayo de restauración, no solo de copia |
| 8 | Versión `latest` sin digest (`DM-11`) | Fijar versión y digest antes de instalar |

**Estado tras las sondas del 2026-11-16.** Cerradas con evidencia: la 3 (P-01: una clave con alcance de la cuenta A no lee la B), la 7 (P-14: respaldo restaurado en base limpia) y la 8 (P-14: imagen fijada por digest). Siguen abiertas la 1, 2, 4, 5 y 6.

Se añade una novena, medida con P-09: **el motor no guarda el texto del error de envío en el borrador**. El estado pasa a `failed`, pero `lastError` queda nulo y el detalle solo existe en el log del contenedor. El adaptador de FaberLoom tiene que registrar ese error por su cuenta o la conciliación de un fallo dependerá de leer logs ajenos.

## 4. Conflicto con una decisión cerrada

La decisión 4b del acta dice: "Por IMAP o por conector MCP (usa el conector de Hostinger)". Adoptar DaMail como motor **no cumple** esa frase: DaMail es un producto de correo, no el conector de Hostinger.

Si el CEO confirma DaMail, hace falta una enmienda explícita del tipo: *"El motor es DaMail; Hostinger queda como proveedor de buzones por IMAP/SMTP, no como conector MCP"*. Sin esa enmienda, PC1 con DaMail contradice una decisión cerrada, y este plan no reabre decisiones cerradas por conveniencia.

## 5. Alternativa que se descartó al medir

El inventario encontró mailcow en el servidor y planteé una cuarta opción: extensión propia sobre IMAP de mailcow, sin producto nuevo. **La medición del 2026-11-16 la descarta para este piloto**: los dos buzones responden en `imap.hostinger.com` y mailcow no sirve `muitowork.com`. La opción "propia sobre IMAP" seguiría existiendo, pero contra los servidores de Hostinger con credenciales IMAP, no contra el mailcow local. Queda registrada como evaluada y descartada por evidencia, no por olvido.

## 6. Qué haría falta para cambiar esta recomendación

- Que Hostinger demuestre borradores y aprobación por API en cuenta de prueba. Entonces su menor costo operativo pesa más.
- Que la extensión propia cierre identidad y autoridad y baje el baseline a cero. Entonces no hay motivo para añadir un producto.
- Que DaMail falle la barrera negativa o la conciliación en laboratorio. Entonces se descarta aunque el CEO la prefiera, porque el plan prohíbe cerrar con un fallo dentro del alcance.
