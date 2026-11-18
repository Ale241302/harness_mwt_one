# O3-05 · Transición en vivo y estado heredado

- Contrato: C-FL-04 · Ola O3 · Etapa E1
- Revisión: `c7a20b03a1`
- Alcance: clasificar, conservar y no reactivar las rutinas heredadas
- Nivel: C1-E (pruebas ejecutadas)
- Estado: **READY_FOR_CEO**
- Gate: PC1, PC2
- Autor: faberloom-implementer · Revisor: pendiente

## 1. El problema que resuelve

Un proceso que arranca después de un cambio hereda rutinas activas. Si una de ellas manda correo y E1 deniega la escritura, la rutina no puede ejecutarse de verdad: o falla en cada pasada, o peor, queda armada esperando a que alguien habilite el envío. Reactivarla en silencio al arrancar es la forma más fácil de que un correo salga sin que nadie lo apruebe.

## 2. La pasada de transición

`ctx.faberloomRoutines.classifyInherited()` recorre las rutinas **activas** y decide:

| Caso | Qué hace |
|---|---|
| El paso usa `smtp` o `email.send` | **Pausa** la rutina: E1 no envía sin aprobación |
| El paso usa un manejador que esta versión no registra | **Pausa** la rutina |
| Todos los pasos son ejecutables | La deja activa |
| Ya está pausada o en borrador | No la toca |

Cada pausa deja un **aviso interno** al dueño con la razón, y la rutina conserva nombre, versión, definición y espacio. No se borra nada.

## 3. Arranque sin interfaz

El despachador de ejecuciones llama a la pasada **al montarse**, antes de cualquier tick y aunque el temporizador esté apagado. Un host sin UI clasifica igual: la transición no depende de que alguien abra la consola.

La pasada es **idempotente**: al segundo arranque no encuentra rutinas activas incompatibles, no reescribe estado y no repite el aviso.

## 4. Conservar y no reactivar

| Garantía | Cómo |
|---|---|
| Nada se pierde | La rutina se pausa, no se elimina; versiones y definición intactas |
| Nada se reenvía | Una rutina pausada no recibe eventos ni arranca ejecuciones |
| Nada se reactiva solo | Nadie vuelve a poner `active` automáticamente; hace falta una persona |
| Lo pendiente queda trazable | Las ejecuciones heredadas no se tocan: siguen en `waiting`, `needs_review` o `failed` |

## 5. Evidencia ejecutada

```
vitest routines + execution      80 pruebas
tsc --noEmit (ambos)             exit 0
oxlint                           0
```

| Prueba | Qué demuestra |
|---|---|
| Pausa la rutina que envía y conserva la que no | `smtp` → pausada; `agent` → activa |
| Pausa un manejador que ya no existe | Se registra, se activa, desaparece, y la pasada la pausa |
| Idempotente entre arranques | El segundo proceso no vuelve a pausar ni duplica el aviso |
| Ejecuciones intactas | Una ejecución heredada sigue ahí tras la pasada |
| Arranque sin UI | Montar el despachador con `enabled: false` pausa la rutina heredada |

## 6. Lo que O3-05 **no** cierra

| Pendiente | Dueño |
|---|---|
| Contadores reconstruibles por evento y límites que detienen el trabajo | T19-E1 completo, con O5/O7 |
| Restauración de copia sin reactivar memoria, reglas ni rutinas | O5-07A |
| Migración real de datos heredados (no solo clasificar rutinas) | O5-07A; aquí no se migra nada |
| Reanudación de una ejecución `waiting` cuyo paso siguiente envía | Se detiene en `needs_review` al ejecutarse; probado en O3-02C |

## 7. Nota de nombres

El conjunto de manejadores denegados usa **nombres de manejador** (`smtp`, `email.send`), no tipos de nodo del flujo (`smtp.send`). Un nodo `smtp.send` de un Work Flow se compila al manejador `smtp`, y una rutina escribe el manejador. Confundirlos dejaría pasar exactamente las rutinas que hay que pausar; la prueba lo fija.

## 8. Reproducir

```sh
corepack pnpm exec vitest run packages/faberloom/routines/tests/transition.spec.ts --project thread-safe
corepack pnpm exec vitest run packages/faberloom/execution/tests/transition.spec.ts --project thread-safe
```
