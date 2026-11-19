# Auditoría FaberLoom · 2026-11-19

Leí la tarea completa: `1_TAREA_BASE_FaberLoom_v1.2.md`, `2_TAREA_DETALLADA_FaberLoom_v1.0.md`, `3_ACTA_DECISIONES_CEO_v1.1.md`, `LEEME.txt`, los 13 documentos de `discusion/` y los 16 de `tasks/` (plan, todo, file-map, traceability, evidence-assignments, authorizations, contratos, apariencia, motor y evidencias).

## 1. Las olas no están cerradas

`tasks/README.md` dice: «Implementación de las olas: sin iniciar». Los checkboxes de `tasks/todo.md` están vacíos. Lo que existe en `deepseek-harness` es trabajo real, pero no está registrado contra los contratos O0-O11 ni tiene los cierres que el plan exige.

| Ola | Qué pide el plan | Qué hay hoy | Veredicto |
|---|---|---|---|
| O0 | Inventario, laboratorio, baseline, matriz | Inventario preliminar del VPS (`tasks/evidence/`), sin autorización demostrada | Abierta |
| O1 | Comparar motores y PC1 | No hay comparación ni motor elegido | Abierta |
| O2 | Dos looks y PC2 | Hay looks A/B en el panel de correo, sin ficha ni PC2 | Parcial, no declarable |
| O3 | Autoridad, transición, identidad | Hay controles de envío y borradores; el autoenvío y la reactivación automática siguen en el código | Abierta, con riesgo |
| O4 | Dos buzones, navegación, visor | Bandeja, lectura, adjuntos, búsqueda, HTML aislado y errores por cuenta funcionan | Avance real, sin evidencia T1/T17/T22 |
| O5 | Asignación, iteración, memoria, PC3 | Espacios, tarjeta de Space, chat flotante, memoria y lecciones existen | Avance real, sin T2/T3/T9/T12 |

Conclusión: no se puede decir «hice hasta la ola 5». Se puede decir «hay piezas de O3, O4 y O5 funcionando, sin los cierres del plan».

## 2. Los siete botones

Los siete estaban cableados. Cuatro se retiraron por decisión de producto.

| Botón | Qué hacía | Estado |
|---|---|---|
| Crear tarea | `openTaskEntry({ kind: 'email' })`, creaba un ítem en la Mesa | Funcionaba; retirado |
| Marcar leído | `emailMarkSeen(uid)` → flag IMAP por cuenta | Funciona; se queda |
| Papelera | `emailTrash(uid, from, subject)` → mueve y crea candidato de lección | Funciona; se queda |
| Space | Modal + `spaceFromEmail` (crea Space y sesión) | Funcionaba; retirado del lector |
| Rutina | Modal de diseñador con `routineChat`/`routineFromEmail` | Funcionaba; retirado |
| Aprender | `learnFromEmail(uid)`: extraía cliente, OC, PO, SKU, tallas, cantidad y precio | Funcionaba; retirado |
| Responder | Abría el modal de redacción | Funciona; ahora abre el panel derecho |

El lector conserva **Marcar leído, Papelera y Responder**. La lista conserva los iconos de leído y papelera. Space, Rutina, Aprender y Crear tarea se resuelven desde la conversación.

## 3. ¿Puede el chat flotante crear Space, Work Flow y Rutina?

Sí, con distinto nivel de prueba.

- **Space**: sí. Además de las tools, la tarjeta del flotante ya crea el Space, mueve la sesión y abre el chat del Space. Probado en e2e.
- **Work Flow**: sí. El perfil `faberloom` monta `tool-faberloom` con `workflowTools: true`; el prompt del sistema ordena crear el grafo, disparador, nodos, conexiones, validar y activar. Las tools `faberloom_workflows_*` incluyen `create`, `set_trigger`, `add_node`, `connect`, `validate`, `activate`, `run_now` y `propose`. Prueba de composición: `workflows-tools.integration.spec.ts` (4/4 con rutinas).
- **Rutina**: sí. `faberloom_routines_create/update/activate/pause/list` se registran siempre; `routines-tools.integration.spec.ts` pasa.
- **Space, Work Flow y Rutina desde el chat**: falta la prueba con modelo real. Las tools existen y están montadas; lo que no está probado es que el modelo elija usarlas con una frase del CEO. Eso es una prueba de comportamiento, no de código.

## 4. Aprender a responder y crear borradores

Lo que existe:

- Al enviar un borrador, `sendEmailDraft` guarda una enseñanza con el texto enviado; si el texto difiere del borrador de la IA, la marca como corrección.
- El redactor con IA (`emailDraftWithAi`) usa las últimas enseñanzas de correo.
- El flotante tiene `faberloom_memory_teach`, `faberloom_memory_teachings`, `faberloom_memory_retrieve` y `faberloom_memory_revoke`.

Lo que falta y no se debe afirmar:

- No hay un agente en segundo plano que, al llegar correo nuevo, aplique la experiencia y cree el borrador solo. La rutina de correo en vivo lo instruye, pero su montaje y sus efectos reales no están verificados (hechos 30-32, DC-1/DC-2).
- El filtro de enseñanzas del redactor no separa candidatas de activas (hecho 27). Una lección revocada puede seguir influyendo.
- El borrador creado por la tool `faberloom_email_draft` no guarda cuenta de salida ni `Message-ID` de origen; por eso la lista muestra «Primary account» y no la fuente. Es el siguiente arreglo del modelo de borrador.
- Hoy la respuesta automática al pulsar Responder solo se dispara si ya hay voz aprendida. Sin experiencia, el panel se abre vacío y espera, como manda la decisión 3b.

## 5. Borrar un tipo de correo y que se siga borrando

Piezas existentes:

- La papelera crea un candidato de enseñanza con alcance global (hecho 26).
- La rutina en vivo instruye: «si es SPAM o coincide con un patrón que el usuario siempre descarta, usa `faberloom_mail_trash`».
- `faberloom_mail_trash` existe como tool del agente.

Lo que impide prometerlo hoy:

- El candidato no es una regla activa. La base exige aprobación humana de la lección y, para automatismos, historial real de 10 ejecuciones y ≥70 % (regla 3b, N8/PC5-A).
- La rutina puede reactivarse sola (hecho 30) y su estado real en el VPS no está inventariado.
- No hay una prueba de que el patrón aprendido se consulte al llegar el siguiente correo.

Para que «si borro publicidad, la próxima publicidad se borra sola» sea verdad hacen falta tres cosas: aprobar la lección de descarte, una regla S3 con su historial y el ejecutor que la aplique antes de mostrar el correo. No es un botón; es N8.

## 6. Lo que se hizo en esta sesión

- Se retiraron del lector Crear tarea, Space, Rutina y Aprender, y el icono de Space de la lista.
- La vista de borradores muestra **De, Para, Asunto y Estado**. «De» es la cuenta desde la que sale.
- El borrador guarda la cuenta de salida; el envío resuelve el SMTP por esa cuenta y cae al primario solo si no existe (con `via` en el resultado).
- Responder abre el mismo panel de dos columnas que la bandeja: lista a la izquierda, correo a enviar a la derecha, con De, Para, CC, Asunto, adjuntos y cuerpo.
- El panel derecho tiene un botón flotante para pedirle a la IA un cambio sobre la respuesta.
- Si hay voz aprendida, la respuesta se redacta al abrir; si no, se abre vacía.
- Se actualizaron los e2e y las pruebas de componente.

## 7. Límites que no se tocaron

- **Adjuntos reales**: el panel acepta archivos y anota sus nombres, pero el envío todavía no adjunta los bytes. El camino SMTP ya soporta adjuntos; falta persistirlos en el borrador y pasarlos al snapshot aprobado.
- **Hilo al enviar**: se guarda `inReplyTo`, pero `sendMail` no escribe `In-Reply-To` ni `References`; la respuesta puede no agruparse en el hilo del destinatario.
- **CC/BCC**: la interfaz recoge CC, pero el modelo de envío actual no transporta CC ni BCC.
- **Borradores del agente**: `faberloom_email_draft` no recibe cuenta ni `Message-ID` de origen, así que un borrador creado por la rutina aparece sin «De» y sin fuente.

## 8. Verificación

- `tsc` de `ui-faberloom`: limpio.
- `oxlint` de los paquetes tocados: limpio.
- `verify-client-ui-i18n`: 687 archivos, limpio.
- `gen-cordis-api --check`: 107 artefactos al día.
- `registration.client.spec.tsx` + `appearance-tokens`: 143/143.
- `workflows-tools.integration.spec.ts` + `routines-tools.integration.spec.ts`: 4/4.
- `email-panel.e2e.ts`: 8/8, con capturas nuevas (`email-drafts.png`, `email-reply-pane.png`).
- `test:gui` completo: 6179 pasan; quedan dos fallos ajenos al correo (`ui-theme` por `HTMLCanvasElement.getContext` y `ui-reference` por el listado de carpetas), que fallan igual aislados.

## 9. Siguiente trabajo, en orden

1. Extender `faberloom_email_draft` con `account` e `inReplyTo` (o `uid`) para que los borradores del agente digan de dónde salen.
2. Un filtro común de enseñanzas por estado (activa/aprobada, espacio, vigencia) en redactor, sugerencias, contexto y rutinas.
3. Probar con modelo real una frase del CEO que cree un Work Flow y una Rutina desde el flotante.
4. Convertir la lección de descarte en regla visible y aprobable, con su ejecutor y su historial; no activarla por un clic de papelera.
5. Cerrar O3 (retirar autoenvío y reactivación) antes de cualquier promesa de «agente vivo».
