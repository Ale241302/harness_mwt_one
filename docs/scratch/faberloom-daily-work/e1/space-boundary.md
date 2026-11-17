# O5-01 · Cero experiencia y frontera de espacios

- Contrato: C-FL-04 · Ola O5 · Etapa E1
- Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d` + checkpoint `6b71b07`
- Alcance: espacios existentes, datos heredados fuera de la experiencia, principal/referencia y sin espacio
- Nivel: C1-E (pruebas ejecutadas)
- Estado: **READY_FOR_CEO**
- Gate: PC1, PC2, O3-04

## 1. La frontera que faltaba

Un espacio trae memoria, contexto y archivos. Lo heredado de una base anterior no puede entrar en la experiencia del modelo solo porque el espacio exista: T21 exige inventariarlo **fuera** de la experiencia inicial hasta que una persona lo autorice, y prohíbe un global implícito cuando la sesión no tiene espacio.

| Regla | Cómo queda |
|---|---|
| Lo heredado se conserva | `inheritMemory` guarda el texto como `origin: 'legacy'`; nada se borra |
| Lo heredado no se experimenta | `effectiveMemory` y el ámbito del Space filtran `legacy`; el modelo no lo lee |
| Una persona lo autoriza | `approveInheritedMemory` pasa la entrada a `live` y registra `approvedAt` |
| Importar dos veces no duplica | La importación es idempotente por dueño, espacios y texto |
| Otro dueño no aprueba ni mira | Solo el dueño aprueba; sin lectura del espacio, `effectiveMemory` niega el acceso |
| Sin espacio no hay global | Una sesión fuera de todo Space no instala ámbito: no hereda memoria ni cae a la memoria global |

`listMemory` sigue devolviendo lo heredado para que el panel lo muestre y se cure; la experiencia es la que lo excluye, no el listado.

## 2. Principal y referencias

El ámbito de una sesión ya distingue su Space (principal) y su subárbol de los Spaces ajenos, que solo entran con una concesión explícita de lectura registrada como evento. Consultar un Space de referencia es una decisión separada: no transfiere contenido al principal, no lo activa y no concede escritura. La referencia no es un permiso implícito.

La ruta de modelo no se toca aquí: el agente del Space lleva su proveedor y modelo en el plano de agente, y una ruta distinta por Space es la misma política que ya aplica la composición.

## 3. Evidencia ejecutada

```
vitest spaces + session-agent   173 pruebas (4 nuevas)
tsc -b spaces / session-agent   exit 0
persistence catalog             regenerado y al día
```

| Prueba | Qué demuestra |
|---|---|
| Heredado fuera de experiencia | Aparece en `listMemory`, no en `effectiveMemory` |
| Aprobación | Pasa a `live`, guarda `approvedAt` y entra en `effectiveMemory`; aprobar dos veces se rechaza |
| Importación idempotente | El mismo texto dos veces devuelve el mismo id y una sola fila |
| Frontera de dueño | Otro dueño no aprueba y no puede leer la experiencia del espacio |
| Sesión sin espacio | No se instala ámbito: cero memoria, sin global implícito |
| Ámbito del modelo | Una memoria `legacy` no aparece en el texto del Space |

## 4. Lo que no se hizo

- **El inventario real de la lista del CEO**: el mecanismo de importación existe y está probado con datos sintéticos; cargar los espacios y memorias reales necesita esa lista, que la tarea asigna al CEO.
- **La curación en el panel** (ver, aprobar o descartar heredados) es O5-05, con el filtro común de experiencia y la explicación por respuesta.
- **La separación configuración/contenido/casos/lecciones** como inventario operativo completo es parte de O5-05 y O5-06; aquí queda el límite de experiencia.
