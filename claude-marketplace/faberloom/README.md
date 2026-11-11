# FaberLoom para Claude Code

El mismo producto, del otro lado: un **mod** de Claude Code que reconoce la carpeta de un Space y reporta lo que FaberLoom proyectó ahí.

## Qué hace

El plugin trae el **catálogo** — 145 agentes y 293 skills, sumando el producto y OpenCode — y lo instala en tu propio Claude: `~/.claude/agents` y `~/.claude/skills`, donde quedan como agentes y skills nativos, sin prefijo de plugin. La primera sesión lo hace sola, una vez por versión de catálogo; `/faberloom-install` lo repite cuando quieras. Lo que ya existe no se pisa, así que tus ediciones sobreviven.

El generador los convierte desde el catálogo del producto (`agents-shared/`, `skills-shared/`) y el de OpenCode (`~/.config/opencode`), así que no hay una segunda copia del texto:

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
- **`/mesa`** — la **cola real** de la Mesa leída del storage del producto (`<DSH_HOME>/storages/faberloom_board.json`): ítems abiertos, severidad, estado, Space y vencimiento. Si el storage no existe, cae a la proyección.
- **`/mwt`** — inicia sesión en la consola y guarda un DeviceToken por empresa; `/mwt <clave>` elige la empresa activa. Con eso queda disponible la herramienta `mcp__faberloom__mwt` para consultar clientes, pedidos, expedientes, proformas, inventario y facturas por el MCP de esa empresa.

## MWT.ONE por empresa

El mod repite el flujo de la consola que usa el plugin de DeepSeek Harness: `POST /auth/login/` y `POST /onboarding/device-token`, que devuelve `{key, name, token, mcp_url}` por empresa. Cada llamada va al endpoint que la consola nombró con `Authorization: DeviceToken …`.

Claude Code pide usuario y contraseña en el diálogo de configuración del plugin (`/plugin configure faberloom@faberloom`); la contraseña es `sensitive`, así que se guarda cifrada y nunca entra al chat ni al modelo.

Si preferís un archivo (por ejemplo para una sesión sin interfaz), dejá las credenciales en uno que solo lee tu cuenta:

```json
// %USERPROFILE%\.faberloom\mwt.json
{ "usuario": "tu@correo", "password": "…", "consolaBase": "https://consola.mwt.one/api" }
```

Después: `/mwt` (conecta), `/mwt sondel-s-a` (elige), y el agente usa `mcp__faberloom__mwt` con `{ "name": "expediente_buscar", "input": { "proforma": "2487-2026" } }`.

Los tokens quedan en el store del plugin (`~/.claude`), no en el repositorio.

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
