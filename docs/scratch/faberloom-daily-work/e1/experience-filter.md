# O5-05 · Filtro común de experiencia (núcleo)

- Contrato: C-FL-04 · Ola O5 · Etapa E1
- Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d` + checkpoint `1fdc75ae`
- Alcance de esta entrega: la función que decide abstención, citas, conflictos y faltantes, su conexión al view, la explicación en el panel de Chat y la inspección con modelo real (sesión completa incluida)
- Nivel: C1-E (pruebas deterministas) + C1-I (modelo real, e2e en navegador)
- Estado: **READY_FOR_CEO**
- Gate: PC1, PC2, O5-01

## 1. Una regla, no tres

`shapeExperience(query, candidates, needs)` recibe los hechos que un consumidor ya leyó y devuelve:

| Salida | Cuándo |
|---|---|
| `abstain` | Ningún hecho **aprobado** comparte un término con la pregunta |
| `suggest` | Hay hechos pertinentes; se citan, del más al menos relevante, con su origen |
| `conflicts` | Dos hechos aprobados del mismo tema dicen cosas distintas; se muestran ambos |
| `missing` | La respuesta necesitaba entradas que ningún hecho cubre |

Lo **no aprobado** (lo heredado de O5-01) cuenta como no tener base: no se cita. La comparación ignora mayúsculas y puntuación final, así que dos formas de decir lo mismo no fingen un conflicto. Una pregunta hecha solo de palabras vacías se abstiene.

El filtro no lee almacenes ni llama a un modelo: decide sobre lo que recibe. Eso lo hace comprobable y deja la cita auditable.

## 2. Evidencia ejecutada

```
vitest learning/experience    7 pruebas
vitest learning              30 pruebas
tsc -b learning              exit 0
```

| Prueba | Qué demuestra |
|---|---|
| Sin base | `abstain` y la lista de lo que falta |
| Con base | `suggest` con el hecho citado y su origen |
| Heredado sin aprobar | No se cita aunque coincida |
| Dos fuentes contradictorias | Se muestran ambos valores, no se elige |
| Mismo dicho con puntuación distinta | No hay conflicto falso |
| Faltantes | Solo las entradas que ningún hecho cubre |
| Solo palabras vacías | Se abstiene |

La conexión con la vista está probada aparte:

| Prueba (`view/experience-answer`) | Qué demuestra |
|---|---|
| Memoria viva | Se cita con su origen `memory:<id>` |
| Memoria heredada | No se cita; sin otra base, se abstiene |
| Enseñanzas | Solo las `active`; una revocada queda fuera |
| Space sin acceso | Se abstiene, no falla el panel |

## 3. Conexión con los consumidores

`ctx.faberloomView.experienceFor(spaceId, query)` es el primer consumidor real:

1. Lee `effectiveMemory` del Space y descarta lo heredado (`origin: 'legacy'`).
2. Lee el contexto compartido del Space (`visibility: 'shared'`). Su título es la clave del tema, así que dos entradas del mismo título con cuerpos distintos vuelven como conflicto. Un contexto local o pendiente no cuenta: no está aprobado para el Space.
3. Lee las enseñanzas del Space y solo cita las `active`.
4. Un Space que el actor no puede leer no aporta fuentes: la respuesta se abstiene, no falla.
5. Devuelve la respuesta del filtro con citas, conflictos y faltantes.

El contexto compartido es la única fuente con clave de tema propia; la memoria es texto libre y no declara sobre qué habla, así que el filtro no puede inventarle un tema para declarar un conflicto.

## 4. La explicación en el panel

El panel de Chat dibuja la respuesta del filtro junto a la propuesta (`ExperienceBlock` en `client/ui-faberloom`), con `ctx.faberloomView.experienceFor` como único origen:

| Caso | Qué muestra el panel |
|---|---|
| Sin base | «Sin base: no se propone», el motivo y lo que falta. **No dibuja la propuesta**: el botón vuelve a habilitarse, pero no aparece ningún resultado propuesto |
| Con base | La lista de fuentes, una por hecho, con su familia (memoria, enseñanza, contexto, caso) y su origen (`memory:<id>`, `context:<id>`) |
| Conflicto | La lista de diferencias, con el tema discutido y cada valor con su hecho, más la instrucción de decidir cuál rige antes de ejecutar |

La explicación se limpia cuando cambia la petición o el Space: nunca queda una cita vieja al lado de una petición nueva. Con el Space personal (sin Space elegido) la propuesta no cita experiencia y el panel lo dice.

La captura del panel exige que la pantalla de Chat sea alcanzable: tenía el panel principal pero ninguna fila en la barra, así que ahora tiene su fila («Chat») en el grupo Trabajo. Lo que el panel no hace todavía: editar o revocar el hecho desde la explicación, y llevar la misma explicación a la propuesta de una tarea de la Mesa.

## 4. Inspección con modelo real

Se ejecutó con `deepseek-chat` (temperatura 0) sobre el **texto real del Space** que renderiza el producto (`readSpaceScope` con el servicio de Spaces y la memoria aprobada). Evidencia completa, con el contexto exacto enviado y la respuesta de cada caso: `evidence-O5-05-live.md`.

| Caso | Contexto | Respuesta del modelo | Comprobación |
|---|---|---|---|
| Sin base | Space sin memoria | «No tengo base… faltan cliente, incoterm y la cláusula del flete» | No inventa DDP; pide lo que falta |
| Con base | Una memoria: «Eguisa trabaja DDP y el flete va incluido» | «Incoterm DDP; el flete va incluido… Hecho usado: la memoria…» | Usa y cita el hecho |
| Conflicto | Dos memorias contradictorias sobre el flete | Muestra las dos y dice que se contradicen; no elige | Ambas caras visibles |

Un detalle que la corrida mostró y se corrigió: la memoria se renderizaba en una sola línea unida por `|`, y dos hechos contradictorios se leían como una frase. Ahora cada hecho va en su propia línea, y el ámbito declara junto al listado que dos hechos contradictorios se muestran ambos.

Lo que la prueba compone: el servicio real de Spaces, el renderizador real del ámbito y el modelo real. La sesión completa se comprueba aparte, con persona, herramientas e historial.

## 6. La sesión completa, con modelo real (E2)

`apps/web/tests/experience-session.e2e.ts` arma el producto entero (bundle `faberloom-app`, adaptador real) y recorre los tres casos como tres turnos de una misma conversación, con la persona del agente asignado al Space, el plano de herramientas del agente y el historial de los turnos anteriores. Evidencia: `evidence-O5-05-session.md`; capturas en `e1/visual/session-*.png`.

Lo que compone: persona, herramientas, historial, ámbito y modelo real. Lo que la corrida dejó escrito: con una pregunta genérica el modelo a veces elige un lado; la garantía determinista de «cita y compara» vive en el filtro y en el panel, y la sesión compara cuando la pregunta lo pide.

## 7. Lo que falta para cerrar

- El resto de consumidores del filtro: el ámbito del Space y la propuesta de la Mesa (hoy el panel de Chat es el único que dibuja la explicación).
- **El umbral de relevancia** es por término compartido; una pregunta larga puede pedir un umbral más fino cuando haya casos reales que lo justifiquen.
- La memoria no declara tema: mientras siga siendo texto libre, los conflictos solo se detectan en el contexto curado y en lo que el modelo note al leer.
