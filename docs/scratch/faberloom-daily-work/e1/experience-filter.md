# O5-05 · Filtro común de experiencia (núcleo)

- Contrato: C-FL-04 · Ola O5 · Etapa E1
- Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d` + checkpoint `1fdc75ae`
- Alcance de esta entrega: la función que decide abstención, citas, conflictos y faltantes, su conexión al view y la inspección con modelo real
- Nivel: C1-E (pruebas deterministas) + C1-I (modelo real)
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
2. Lee las enseñanzas del Space y solo cita las `active`.
3. Un Space que el actor no puede leer no aporta fuentes: la respuesta se abstiene, no falla.
4. Devuelve la respuesta del filtro con citas, conflictos y faltantes.

El panel todavía no dibuja esa explicación; el remoto está listo para que la muestra junto a la propuesta.

## 4. Inspección con modelo real

Se ejecutó con `deepseek-chat` (temperatura 0) sobre el **texto real del Space** que renderiza el producto (`readSpaceScope` con el servicio de Spaces y la memoria aprobada). Evidencia completa, con el contexto exacto enviado y la respuesta de cada caso: `evidence-O5-05-live.md`.

| Caso | Contexto | Respuesta del modelo | Comprobación |
|---|---|---|---|
| Sin base | Space sin memoria | «No tengo base… faltan cliente, incoterm y la cláusula del flete» | No inventa DDP; pide lo que falta |
| Con base | Una memoria: «Eguisa trabaja DDP y el flete va incluido» | «Incoterm DDP; el flete va incluido… Hecho usado: la memoria…» | Usa y cita el hecho |
| Conflicto | Dos memorias contradictorias sobre el flete | Muestra las dos y dice que se contradicen; no elige | Ambas caras visibles |

Un detalle que la corrida mostró y se corrigió: la memoria se renderizaba en una sola línea unida por `|`, y dos hechos contradictorios se leían como una frase. Ahora cada hecho va en su propia línea.

Lo que la prueba compone: el servicio real de Spaces, el renderizador real del ámbito y el modelo real. Lo que no compone: la persona y las tools del agente de sesión, que no cambian el contrato de experiencia.

## 5. Lo que falta para cerrar

- **La superficie de explicación en el panel** (citas, conflictos, faltantes junto a la propuesta) y el resto de consumidores: ámbito del Space y propuesta de la Mesa.
- **El umbral de relevancia** es por término compartido; una pregunta larga puede pedir un umbral más fino cuando haya casos reales que lo justifiquen.
- La sesión completa del agente (persona + tools + historial) repite esta inspección en E2.
