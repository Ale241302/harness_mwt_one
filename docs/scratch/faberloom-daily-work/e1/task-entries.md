# O5-04 · Tres entradas y Mesa (servicio)

- Contrato: C-FL-04 · Ola O5 · Etapa E1
- Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d` + checkpoint `72ebbfb`
- Alcance: el servicio de entrada única, los tres gestos y su evidencia
- Nivel: C1-E (servicio, componente y pruebas)
- Estado: **READY_FOR_CEO**
- Gate: PC1, PC2, O5-03

## 1. Una entrada, tres orígenes

`openTaskEntry(input)` crea la tarea en la Mesa desde cualquiera de las tres entradas y resuelve **una sola vez**:

| Entrada | Referencia | Evidencia | Clave |
|---|---|---|---|
| Correo | `accountRef:uid` | `mail:<cuenta>:<uid>` | `entry:email:<ref>` |
| Ítem de la Mesa | id del ítem | `board:<id>` | `entry:item:<ref>` |
| Aviso | id del aviso | `notice:<id>` | `entry:notice:<ref>` |
| Desde cero | id de pestaña, o ninguno | la propia entrada | `entry:scratch:<ref o uuid>` |

La clave viaja como `idempotencyKey` al tablero, que ya devuelve el ítem existente para la misma clave: un doble clic, una recarga o el mismo correo abierto dos veces resuelven a **un ítem con un historial**, no a dos. Sin `ref` en un correo, ítem o aviso la entrada se rechaza: una tarea sin origen real no es una tarea.

La prioridad se mapea a la severidad del tablero (`high` → `HIGH`), y el espacio y la cuenta viajan como referencias del ítem. La entrada no lee el buzón ni mueve nada: registra el ítem y su evidencia.

## 2. Evidencia ejecutada

```
vitest view/task-entry       5 pruebas
vitest client/ui-faberloom   137 pruebas (2 nuevas de los gestos)
tsc -b host / client         exit 0
catálogo Cordis              al día
```

| Prueba | Qué demuestra |
|---|---|
| Correo | Evidencia `mail:cuenta:uid`, severidad y referencias mapeadas |
| Mismo correo, dos veces | Misma clave y mismo ítem |
| Ítem y aviso | Cada uno con su referencia y su evidencia |
| Desde cero | Con id de pestaña es idempotente; sin id, cada gesto es una tarea nueva |
| Rechazos | Sin referencia, sin título o identidad de solo lectura |

## 3. Los tres gestos

| Entrada | Dónde | Qué llama |
|---|---|---|
| Correo | Acciones del lector | `kind: 'email'`, referencia del mensaje, cuenta |
| Ítem de la Mesa | Detalle del ítem | `kind: 'item'`, id y espacio |
| Desde cero | Cabecera de la Mesa → «Nueva tarea» | `kind: 'scratch'`, título escrito por la persona |

Cada gesto usa el mismo servicio, así que la clave y la evidencia son las mismas; el ítem creado aparece en la Mesa como cualquier otro, con su historial. La casilla de recordar asignación no participa: abrir tarea y asignarla son decisiones separadas.

## 4. Intento de pasada visual (bloqueada)

Se preparó un e2e real del panel sobre la composición del producto (`apps/web/tests/email-panel.e2e.ts`) con un receptor IMAP de fixture. En el primer arranque apareció un conflicto de composición: `sidebar.brand.mark` declarado dos veces porque el sidebar de serie seguía montado. Se corrigió el overlay desactivando `ui-sidebar`, como hace el producto.

La corrida no llegó a completarse: el servidor del harness se reinicia durante el e2e y el proceso muere antes de abrir el navegador. La prueba y el overlay se retiraron para no dejar una suite rota. La pasada visual sigue pendiente y no se declara hecha:

```sh
# cuando el entorno esté estable
pnpm --filter @deepseek-ai/dsh-client-ui-faberloom run bundle
pnpm --filter @deepseek-ai/dsh-web-frontend run build
$env:DSH_SNAPSHOT='replay'; pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/email-panel.e2e.ts
```

Lo que el e2e mediría: lectura al lado a 1440 px, una vista a 420 px, cambio de look en la superficie, «Crear tarea» desde el correo y desde cero, y un solo ítem por entrada.

## 5. Lo que falta para cerrar del todo

- **La pasada visual** de los tres gestos a dos looks y tamaños (PC3), como el resto de la ola.
- **El historial visible** ya existe en el detalle del tablero; la entrada nueva aparece con el evento de envío y su evidencia.
- La reapertura del ítem desde el gesto del correo muestra el mensaje de creado; abrir el ítem concreto desde el panel de correo pediría una navegación entre paneles que no está en esta entrega.
