# FaberLoom para Claude Code

El mismo producto, del otro lado: un **mod** de Claude Code que reconoce la carpeta de un Space y reporta lo que FaberLoom proyectó ahí.

## Qué hace

El plugin trae el **catálogo base** del producto — 36 agentes y 253 skills — más el mod.

Los agentes se instalan como subagentes de Claude Code y las skills como skills: los invocás con el selector de subagentes y con `/skill`, y Claude los usa solo cuando la tarea lo pide. El generador los convierte desde el catálogo del producto (`agents-shared/`, `skills-shared/`), así que no hay una segunda copia del texto:

```bash
pnpm exec tsx scripts/build-claude-mod.ts
```

Además, FaberLoom escribe la proyección de cada Space o Workspace dentro de su propia carpeta:

| Archivo | Qué contiene |
|---|---|
| `CLAUDE.md` | Las instrucciones del ámbito, con sus agentes, skills, flujos y reglas |
| `.claude/agents/<slug>.md` | Un subagente por agente del catálogo |
| `.claude/skills/<nombre>/SKILL.md` | Las skills del catálogo |
| `.faberloom/harness.json` | El manifiesto: qué se escribió y cuándo |

Claude Code ya carga esos tres primeros por su cuenta: los agentes aparecen como subagentes y las skills como skills. El mod agrega lo que el folder no puede mostrar solo:

- **Línea de estado** bajo el prompt: `FaberLoom · <Space> · N agentes · N skills`, actualizada al terminar cada turno.
- **`/faberloom`** — el informe del ámbito: título, fecha de proyección, agentes y skills.
- **`/agentes`** — cada agente con la ruta de su definición.
- **`/skills`** — cada skill con su `SKILL.md`.
- **`/mesa`** — flujos, rutinas, memoria y contexto registrados en la proyección.

Y trae **SICOP** como servidor MCP público (`.mcp.json`): las herramientas de contratación pública, sin identidad ni configuración.

## Requisitos

- Claude Code **2.1.287 o posterior** (los mods llegaron ahí; la app de escritorio a partir de 2.1.286).
- La carpeta abierta debe ser la de un Space o Workspace de FaberLoom. Fuera de una, `/faberloom` lo dice y no inventa.

## Instalar

Desde este repositorio:

```bash
claude plugin marketplace add C:\Users\ale13\OneDrive\Documents\DeepSeek-Harnees\deepseek-harness\claude-marketplace
claude plugin install faberloom@faberloom
```

O para una sola sesión, sin instalar:

```bash
claude --plugin-dir ./claude-marketplace/faberloom
```

Comprobar que cargó: `/plugin` → pestaña **Installed**, o la línea `1 mod active · faberloom` bajo las pestañas.

## Qué no hace

- No lee la cola de la Mesa ni escribe en el producto: eso vive en la aplicación FaberLoom y su MCP. `/mesa` reporta lo que la proyección registró.
- No configura MWT.ONE: el MCP por empresa lo monta el plugin de FaberLoom en DeepSeek Harness, no este mod.
- No reemplaza la interfaz de Claude Code: dibuja una línea de estado y responde comandos.

## Pruebas

```bash
cd claude-marketplace/faberloom
claude plugin test
```

Las pruebas cubren el lector del manifiesto y la línea de estado; no necesitan sesión ni red.

## Versión

`0.1.0`, probado contra Claude Code 2.1.287. Los eventos y métodos de los mods cambian entre versiones: si algo deja de cargar, mirá `.claude-plugin/types/claude-code/index.d.ts`, que Claude Code escribe para tu versión.
