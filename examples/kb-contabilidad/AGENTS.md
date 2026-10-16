# KB de Contabilidad

Carpeta KB portable: se instala en FaberLoom y deja las skills y los agentes de contabilidad disponibles para este usuario.

## Qué contiene

- `skills/`: procedimientos que el modelo invoca cuando la tarea los pide (conciliación bancaria, asientos, IVA y cierre mensual).
- `agents/`: los tres agentes del equipo contable, cada uno con su responsabilidad, sus skills y su prompt.
- `routines/`: las dos rutinas de trabajo periódicas, en el formato de definición del producto.
- `workflows/`: un flujo con nodos y aristas para el alta de facturas.
- `context/`: la política contable del equipo, en texto que una persona lee y pega en el Contexto del espacio.
- `kb.json`: el manifiesto de la carpeta (nombre, versión, autor y contenido).

## Cómo se instala

1. Abre el panel Skills y pulsa «Elegir carpeta».
2. Elige la carpeta `skills/` de esta KB, no la raíz: el instalador busca un `SKILL.md` en la carpeta elegida o en sus hijas directas, y la raíz de la KB no tiene ninguno.
3. Elige el destino Global para que quede disponible solo para tu usuario.
4. Pulsa «Instalar» y revisa el informe por candidato.

Los pasos, los destinos y los casos de rechazo están en [`docs/faberloom/kb-structure.md`](../../docs/faberloom/kb-structure.md).

## Reglas de esta KB

- Los importes, las fechas y los identificadores se escriben entre `< >` (`<NIF>`, `<periodo>`, `<cuenta>`): aquí no hay datos de ninguna empresa.
- Ninguna skill ni ningún agente inventa un asiento, un saldo o una declaración: todo sale del extracto, del libro o de la herramienta que se cita.
- Lo que no se puede verificar no se registra; se deja en el banco de trabajo como tarea pendiente para una persona.
