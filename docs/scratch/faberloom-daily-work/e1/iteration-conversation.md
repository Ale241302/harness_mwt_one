# O5-03 · Conversación única por origen

- Contrato: C-FL-04 · Ola O5 · Etapa E1
- Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d` + checkpoint `475eb83`
- Alcance: una conversación por origen, flotante/pantalla completa, borrador, concurrencia y recuperación de vínculo
- Nivel: C1-E (componente y lógica) · C1-I (build)
- Estado: **READY_FOR_CEO**
- Gate: PC1, PC2, O4-03, O5-01

## 1. Una conversación por origen

Abrir el chat de una tarea creaba siempre una sesión nueva: el mismo intento podía tener tres conversaciones y ninguna sabía de las otras. Ahora el gesto calcula una **clave de origen** estable y recuerda a qué sesión pertenece:

| Origen | Clave |
|---|---|
| Intento de iteración | `faberloom.chat.binding.iteration.<itemId>.<iterationId>` |
| Tarea sin intento | La clave que el llamador aporte en `originId`; sin ella, no hay reutilización |

Al reabrir, si la sesión existe se abre tal cual: no se crea otra ni se vuelve a inyectar el prompt. Dos pestañas comparten el almacenamiento y llegan a la misma conversación.

## 2. Recuperación y fallo de vínculo

- **Reinicio**: la sesión vive en el host; el vínculo vive en el almacenamiento del navegador. Si el host conserva la sesión, reabrir la encuentra.
- **Vínculo roto**: si la sesión del vínculo ya no existe, se crea una nueva y **se repara el vínculo**, en vez de abrir un chat vacío o fallar.
- **Fallo de adjunción del intento**: el chat sigue siendo un chat normal; el error no bloquea la conversación.
- **Almacenamiento bloqueado**: sin almacenamiento, el gesto mantiene el comportamiento anterior (sesión nueva) sin romper la pantalla.

## 3. Ventana, borrador y concurrencia

Lo que ya estaba y sigue cubierto por sus pruebas:

| Escenario | Dónde |
|---|---|
| Flotante y pantalla completa | `task-chat-window.tsx` y su prueba de componente |
| Mover y redimensionar por puntero y teclado | La misma prueba |
| Borrador que sobrevive a cerrar y reabrir | La misma prueba |
| Escape devuelve el foco al lanzador | La misma prueba |
| Bloqueo del intento entre pestañas (`lockBy`, `lockUntil`) | `boardIteration` en las pruebas de la vista |
| Expiración y reanudación del intento | Pruebas de iteración de la vista |

## 4. Evidencia ejecutada

```
vitest task-chat               13 pruebas (4 nuevas de origen y vínculo)
vitest task-chat-window        7 pruebas (ventana, borrador, teclado)
tsc -b client                  exit 0
```

| Prueba | Qué demuestra |
|---|---|
| Mismo intento, dos aperturas | Una sesión, un prompt, dos `open` |
| Intentos distintos del mismo ítem | Dos conversaciones separadas |
| Vínculo a una sesión perdida | Crea otra y repara el vínculo |
| Tarea sin origen | Sigue creando una sesión por gesto |
| Ventana | Flotante, completa, mover, redimensionar, borrador y foco |

## 5. Lo que no se hizo

- **Persistencia de geometría entre recargas**: el tamaño y la posición viven en el estado de la ventana; sobreviven a cerrar y reabrir dentro de la sesión del navegador, no a una recarga completa. No estaba en la aceptación de T12-E1 y queda para la pasada visual de PC3.
- **Chat por correo o por tarea de la Mesa**: hoy solo la iteración abre chat desde el producto; el vínculo por `originId` está listo para cuando esas entradas lo usen.
- **Videollamada de pruebas en dos pestañas reales**: la lógica y el almacenamiento compartido están probados; la observación con dos navegadores es PC3.
