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

Claude Code ya carga esos tres primeros por su cuenta: los agentes aparecen como subagentes y las skills como skills. El mod agrega lo que la carpeta no puede mostrar sola:

| Comando | Qué hace |
|---|---|
| **Línea de estado** | Bajo el prompt: `FaberLoom · <Space> · N agentes · N skills · N flujos · N memoria`, actualizada al terminar cada turno |
| `/faberloom` | El informe del ámbito: título, fecha de proyección, agentes, skills, flujos, rutinas, memoria y contexto |
| `/agentes` | Cada agente del Space con la ruta de su definición |
| `/faberloom-skills` | Cada skill del Space con su `SKILL.md` |
| `/workspaces` | El árbol de Spaces —cada uno con la carpeta y las conversaciones del Workspace que refleja— y, al final, los Workspaces que ningún Space refleja. Lee `storages/faberloom_spaces.json` y `storages/workspace.json` |
| `/mesa` | La **cola real** de la Mesa, leída del storage del producto (`<DSH_HOME>/storages/faberloom_board.json`): ítems abiertos, severidad, estado, Space y vencimiento. Si el storage no existe, cae a la proyección |
| `/mwt` | Inicia sesión en la consola y guarda un DeviceToken por empresa; `/mwt <clave>` elige la empresa activa |
| `/faberloom-install` | Reinstala el catálogo en `~/.claude` |

`/skills` ya existe en Claude Code, por eso la lista del Space es `/faberloom-skills`.

## Servidores MCP

| Servidor | Qué aporta | Credenciales |
|---|---|---|
| **SICOP** (`.mcp.json`) | 71 herramientas de contratación pública de Costa Rica: procedimientos, ofertas, adjudicaciones, contratos, proveedores, precios, sanciones y series | Ninguna: es público |
| **MWT.ONE por empresa** | 183 herramientas de la consola: expedientes, clientes, pedidos, proformas, inventario, pagos, finanzas y correo | Usuario y contraseña de la consola |

SICOP queda como `plugin:faberloom:sicop`; las herramientas se llaman `mcp__plugin_faberloom_sicop__<herramienta>`. Antes de la primera consulta conviene cargar la skill `sicop-contratacion-publica`, que fija cómo se reporta cada cifra.

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

El endpoint de empresa publica herramientas de negocio y de la consola, no un protocolo de buzón: el correo IMAP de FaberLoom vive en el producto y no se lee desde acá. Para el correo de la cuenta están las herramientas `correo_*` de la consola (`correo_mensaje_listar`, `correo_mensaje_obtener`, `correo_envio_crear`).

## Lo que vive en FaberLoom, no en el mod

| Función | Dónde se opera | Cómo la ve Claude |
|---|---|---|
| **Correo IMAP/SMTP** | FaberLoom → **Conexiones**, y el asistente flotante sobre cada correo con sus **borradores** | El buzón del producto no se expone al mod. El correo de la consola se consulta con `correo_mensaje_listar` y se responde con `correo_envio_crear`, del MCP de la empresa |
| **Mesa de trabajo** | FaberLoom → **Mesa de trabajo**: cola, severidades, revisiones y aprobaciones | `/mesa` lee la cola real |
| **Rutinas y flujos** | FaberLoom → **Rutinas** y **Flujos** | `/faberloom` los lista |
| **Memoria y contexto** | FaberLoom → **Memoria** y **Contexto** | `/faberloom` cuenta las entradas; el contenido viaja en la proyección |
| **Agentes y skills** | FaberLoom → **Agentes y Skills** | Se instalan como nativos en `~/.claude` |

## Requisitos

- Claude Code **2.1.287 o posterior** (los mods llegaron ahí; la app de escritorio a partir de 2.1.286).
- La carpeta abierta debe ser la de un Space o Workspace de FaberLoom. Fuera de una, `/faberloom` lo dice y no inventa.

## Instalar

Desde el marketplace de GitHub:

```bash
claude plugin marketplace add Ale241302/faberloom_mod
claude plugin install faberloom@faberloom
```

Para una sola sesión, sin instalar:

```bash
git clone https://github.com/Ale241302/faberloom_mod
claude --plugin-dir ./faberloom_mod/faberloom
```

Comprobar que cargó: `claude plugin list` debe decir `faberloom@faberloom · enabled`, o en `/plugin` la pestaña **Installed** con `1 mod active · faberloom`.

Actualizar: `claude plugin update faberloom@faberloom`.

## Qué no hace

- No escribe en el producto: lee el storage y la proyección, y llama al MCP de la empresa activa.
- No trae modelo ni llave: la inferencia la paga tu cuenta de Claude.
- No reemplaza la interfaz de FaberLoom: dibuja una línea de estado y responde comandos.

## Pruebas

```bash
cd faberloom
claude plugin test
```

Las pruebas cubren el lector del manifiesto, el árbol de Workspaces, la cola de la Mesa y la línea de estado; no necesitan sesión ni red.

## Versión

`0.2.4`, catálogo `0.2.1`, probado contra Claude Code 2.1.287. Los eventos y métodos de los mods cambian entre versiones: si algo deja de cargar, mirá `.claude-plugin/types/claude-code/index.d.ts`, que Claude Code escribe para tu versión.
