# O3-01 · Censo de productores y vías montadas

- Contrato: C-FL-04 · Ola O3 · Etapa E1
- Revisión: `2f6eee258e`
- Alcance: quién puede producir un efecto externo, por dónde y con qué control
- Nivel: C1-L (lectura de código de la revisión, sin ejecutar servicios)
- Estado: **READY_FOR_CEO**
- Gate: PC1 (firmada), PC2 (decidido el 2026-11-17), O0-03 (cerrado)
- Autor: faberloom-architect · Revisor: pendiente

## 1. Cómo se hizo

Dos barridos sobre `packages/faberloom/**/src`:

1. Toda llamada que puede escribir en el mundo: `sendMail(`, `sendSmtp(`, `sendDraft(`.
2. Toda consulta a la autoridad: `faberloomAccess`, `access.check`, `authorize(`.

Después se leyó cada sitio para saber **qué lo dispara** y **qué comprueba antes**. Nada se marcó como controlado por su nombre: se marcó por lo que hace antes de llegar al cable.

## 2. Las nueve vías que pueden enviar correo

| # | Vía | Archivo:línea | Qué la dispara | Qué comprueba hoy | Veredicto E1 |
|---:|---|---|---|---|---|
| 1 | Adaptador de efecto de la Mesa | `effects-mail/src/index.ts:100` | Un despacho aprobado de la Mesa | Cuerpo aprobado del ítem; acción declarada | **Aceptable en diseño**, pendiente de la identidad de la Mesa |
| 2 | Paso de flujo `email.send` | `handlers/src/index.ts:337` | Paso de un flujo o rutina | Nada | **Denegar** |
| 3 | Paso `smtp.send` | `handlers/src/steps.ts:180` | Paso de un flujo o rutina | Nada | **Denegar** |
| 4 | Envío de prueba del flujo | `handlers/src/steps.ts:281` | Prueba de flujo desde el editor | Nada | **Denegar** |
| 5 | Herramienta del agente `mail.send` | `tool-faberloom/src/index.ts:3438` | El agente decide enviar | **Grant de autonomía**, no aprobación del mensaje | **Denegar sin aprobación exacta** |
| 6 | Envío de borrador desde la vista | `view/src/index.ts:5045` | Botón de la persona | Nada más que el actor sea el dueño | **Aceptable** si el mensaje es el revisado; hoy no compara versión |
| 7 | **Autoenvío tras racha de borradores limpios** | `view/src/index.ts:5124-5128` | Política activada y `cleanSends >= threshold` | Nada: se envía sin persona | **Retirar** |
| 8 | Aviso por correo de rutina en revisión | `execution/src/index.ts:561` | Una ejecución entra en revisión | Nada | **Sustituir por aviso interno** |
| 9 | Invitación al compartir | `shares/src/index.ts:340` | Crear un grant de Space o flujo | Nada | **Sustituir por aviso interno** |
| 10 | Envío de un borrador por id | `connections/src/index.ts:342-347` | Llamada de 6 o 7 | Estado del borrador | Librería; hereda el veredicto de quien la llama |

`connections.sendMail` es el transporte: no decide, ejecuta. Todo lo que decide mal lo hace por encima.

## 3. Hallazgos, con su consecuencia

**H-1 · La autoridad existe y casi nadie la consulta.** `ctx.faberloomAccess` se consulta en la herramienta del agente, en `mcp.call` y en el tablero. Ninguno de los pasos de flujo, ni el autoenvío, ni los avisos, ni las invitaciones pasan por ella. Ocultar un botón no es un control.

**H-2 · `mcp.call` falla abierto.** `handlers/src/steps.ts:259` comprueba `if (access !== undefined)`. Sin el servicio montado, la llamada procede sin decisión. La regla de E1 es lo contrario: sin autoridad montada, no se ejecuta.

**H-3 · El autoenvío premia la costumbre.** Con la política activa, el sistema manda sin persona después de tres borradores aceptados sin editar. Es exactamente el efecto que O3-03 retira: la aprobación no se hereda por racha.

**H-4 · Dos correos automáticos más, fuera del piloto de envío.** El aviso de rutina en revisión y la invitación al compartir salen por SMTP sin que nadie apruebe. Deben convertirse en avisos internos persistentes: el aviso no es el correo.

**H-5 · El grant no es una aprobación.** `mail.send` pide un grant de autonomía, que autoriza *una acción* para un dueño y agente, no *un mensaje*. Un grant vigente permite enviar cualquier texto.

**H-6 · El envío de la vista no compara versión.** Manda el borrador guardado sin comprobar que sea el que la persona vio. Es la mitad de la aprobación exacta que exige el efecto 8.

**H-7 · El adaptador de la Mesa sí parte de lo aprobado.** Es la única vía que lee el cuerpo aprobado del ítem antes de enviar. Su problema no es el envío: es la identidad del ítem, que hoy falla en 212 pruebas.

## 4. Lo que esto obliga a construir

| Pieza | Qué resuelve | Hallazgos |
|---|---|---|
| O3-02A/B | Autoridad con denegación por defecto y mediador de credenciales, montada en todas las vías | H-1, H-2 || O3-03 | Retirar autoenvío, reactivaciones y avisos por correo; avisos internos persistentes | H-3, H-4 |
| O3-02C | Probar cada vía montada: UI, API, tool, MCP, shell, HTTP, navegador, subagente, flujo, rutina | H-1 |
| O3-04 | Identidad de ocurrencia, hilo, propuesta e intento | H-7 |
| Efecto 8 | Aprobación de la versión exacta que se envía | H-6 |

Estado: **O3-02A** (custodia), **O3-02B** (montaje y arranque condicionado), **O3-03** (autoenvío retirado, avisos internos), **O3-02C** (escritura denegada en las seis vías), **O3-04** (identidad de correo con `UIDVALIDITY`), **O3-05** (transición sin reactivar) y **O3-06** (destinos, canarios y copias) están hechos; ver `authority-fail-closed.md`, `authority-mounted.md`, `no-auto-send.md`, `write-denied.md`, `identity.md`, `transition.md` y `custody.md`. El censo ya solo permite tres archivos con acceso a un emisor: transporte, adaptador de la Mesa y envío manual.

Queda abierto del gate O3: nada en E1. T10-E1 y la revisión de seguridad están en `t10-surfaces.md` y `gate-security-review.md`; lo que resta pertenece a E2 (aprobación del mensaje exacto, habilitar el adaptador y probar un subagente con modelo real) y al CEO (rotación de credenciales y copias).

## 5. Control negativo

El censo se hizo buscando **quién puede escribir**, no quién dice que controla. Un archivo con la palabra `approval` y sin `access.check` en el camino de envío se clasificó como sin control. Eso es lo que convierte esto en un censo y no en un inventario de intenciones.

## 6. Limitaciones

- Es lectura de código: no se ejecutó ninguna vía. Que una llame a `access.check` no prueba que la decisión sea correcta; eso es O3-02C.
- `mcp-server` expone herramientas propias; este censo cubre las que envían correo, no todas las de escritura. Las de escritura de expedientes entran en O5.
- El tablero tiene su propio modelo de aprobación, hoy roto por la identidad (O3-04). No se declara sano por leer el adaptador.
