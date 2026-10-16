# Instalar un harness

Un harness es una **carpeta** —o el mismo contenido en un **`.zip`**— que trae el juego completo de un equipo: skills, agentes, reglas, comandos y scripts. Instalarlo lo pone en la casa del usuario (`<DSH_HOME>`, `~/.dsh`), que es donde **toda** sesión de **todo** Workspace y Espacio ya lo lee, sin tocar el despliegue ni reinstalar la aplicación.

El motor es [`scripts/install-harness.mjs`](../../scripts/install-harness.mjs): recorre el origen, reconoce cada pieza por su carpeta y la escribe en la raíz donde el producto la lee.

```
node scripts/install-harness.mjs <carpeta-o-zip> [--home <dir>] [--replace] [--dry-run]
```

Ejemplos reales, ejecutados con este motor: `mwt-one-harness` (893 skills, 36 agentes, 299 scripts, 0 rechazados) y `ECC` (292 skills, 68 agentes, 94 comandos, 296 scripts, 0 rechazados).

## Qué trae un harness y dónde va

| En el harness | Se instala en | Quién lo lee |
|---|---|---|
| `skills/<nombre>/SKILL.md`, `skills-shared/…`, `skills-catalog/<rol>/…`, o un `SKILL.md` en la raíz | `<home>/skills/<nombre>/` | El proveedor de skills, en cada sesión; el agente las ve y las invoca por su `description` |
| `agents/<id>/preset.yml` (carpeta de plantilla), `agents-shared/…` | `<home>/.agent-presets/<id>/` | El descubrimiento de presets, en el siguiente arranque; aparece en el panel de Agentes |
| `agents/<id>.md`, `agents-shared/<id>.md` (agente Markdown con `name` y `description`) | `<home>/.agent-presets/<id>/` con `preset.yml` y una composición cuya **persona es el cuerpo del archivo** | Igual que el anterior: el catálogo no guarda prompt, así que el cuerpo se convierte en la persona |
| `rules/*.md`, `.agents/rules/*.md`, y un `AGENTS.md` en la raíz | Un bloque gestionado dentro de `<home>/AGENTS.md` | La cadena de instrucciones: es el `AGENTS.md` del usuario, que entra en la **primera petición de cada sesión** |
| `commands/*.md` | `<home>/commands/` (copiado tal cual) | El propio CLI que los lea; el producto registra sus comandos por código, así que aquí queda el archivo a mano |
| `scripts/**` | `<home>/scripts/**` | El agente, por el sistema de archivos; es lo que sus reglas invocan |
| `hooks/**`, `mcp-configs/**` | `<home>/hooks/`, `<home>/mcp-configs/` | Nadie todavía: se copian y el instalador lo dice. Los hooks del producto se enganchan por `settings` de cada CLI, y los servidores MCP tienen su registro propio en el panel de Conexiones |

## Reglas: el bloque gestionado

Las reglas no se copian como archivos sueltos: se escriben **dentro** del `AGENTS.md` del usuario, entre dos marcas:

```
<!-- faberloom-harness:begin -->
…las reglas…
<!-- faberloom-harness:end -->
```

Una reinstalación con `--replace` reemplaza **el bloque** y no toca nada más del archivo, así que lo que el usuario haya escrito a mano sobrevive. Sin `--replace`, un bloque existente se respeta y el instalador lo reporta como omitido.

## Repetir, reemplazar y ensayar

El instalador es idempotente: lo que ya está y no cambia se **omite** y se reporta; `--replace` reescribe la pieza entera (la carpeta de la skill, la plantilla del agente, el bloque de reglas). `--dry-run` recorre el origen y dice exactamente qué haría, sin escribir nada: es la forma de revisar un harness antes de instalarlo.

El código de salida es `0` cuando instaló o no había nada que hacer, `1` cuando alguna pieza se rechazó —y la línea de rechazo nombra el motivo: nombre fuera de kebab-case, agente sin `preset.yml`, Markdown sin `name` y `description`— y `2` cuando el origen no se puede leer.

## El `.zip`

Cuando el origen acaba en `.zip`, el instalador lo descomprime en una carpeta temporal con la herramienta del sistema (`tar -xf`, que en Windows 10+ es bsdtar, o `unzip`) y sigue desde dentro. Si el archivo empaqueta **una sola** carpeta raíz, esa es la del harness; si empaqueta los archivos sueltos, se usa la raíz del temporal. No hace falta ninguna dependencia nueva.

## Lo que el panel hará con esto

El bloque actual de «Instalar skill / Elegir carpeta / Destino / Reemplazar» se retira y en su lugar va **un solo botón, «Instalar harness»**, junto a las pestañas Agentes y Skills: abre el selector de carpetas —y una opción para un `.zip`—, y al aceptar llama a este mismo motor y muestra el informe por pieza. El destino deja de preguntarse: skills, agentes y reglas van **siempre a la casa del usuario**, que es lo que significa «global pero solo para él»; lo que sí se conserva es la casilla de reemplazar.

Mientras ese botón no esté montado, el bloque de skills sigue siendo la única vía de instalación desde el panel, así que no se retira antes: la retirada y el botón van en el mismo cambio.
