# FaberLoom para DeepSeek Harness

FaberLoom es un **harness que crea harness**: cada Space arma su propio conjunto de agentes, skills, contexto y reglas, y lo proyecta como archivos que cualquier cliente puede leer.

Este paquete es el **plugin de FaberLoom para DeepSeek Harness**: convierte la aplicación en el producto completo — barra lateral propia, Spaces, Mesa de trabajo, agentes y skills, rutinas, flujos, memoria, contexto, correo y conexiones — sin instalar nada más.

También existe un **mod para Claude Code** con el mismo catálogo y los mismos datos: [Ale241302/faberloom_mod](https://github.com/Ale241302/faberloom_mod).

---

## Requisitos

- **DeepSeek Harness Desktop 0.2.2 o posterior** (`@deepseek-ai/dsh-desktop`). Probado en `0.2.2-rc.1`.
- No hace falta Node ni pnpm a mano: el panel de complementos instala el paquete.
- Cuenta de MWT.ONE sólo para la parte de empresa.

## Instalar

1. Abrí **DeepSeek Harness**.
2. Sidebar → **Complementos** → **Agregar complemento**.
3. Escribí el paquete con la versión:

```
faberloom@0.1.8-alpha.22
```

4. **Instalar** y después **Habilitar ahora**.
5. Cerrá la aplicación por completo y abrila otra vez.

Al volver, la interfaz es FaberLoom: marca propia, barra lateral con **Trabajo** y **Herramientas** plegables, y las 11 secciones del producto.

### Comprobar que cargó

Complementos → `faberloom` → **Componentes**: deben figurar **33 de 33 corriendo** (incluye `faberloom-session-agent`, `faberloom-view`, `faberloom-board`, `tool-faberloom` y `ui-faberloom`).

Si una entrada falla, la aplicación muestra el error de arranque con el nombre del complemento; el registro de diagnóstico queda en `%APPDATA%\DeepSeekHarness-oficial\logs`.

---

## Qué trae

| Pieza | Qué hace |
|---|---|
| **Espacios** | Proyectos con contexto, memoria, agentes y permisos propios; cada uno con su carpeta y su harness |
| **Mesa de trabajo** | Cola de trabajo con severidades, revisiones y aprobaciones |
| **Agentes y Skills** | Catálogo por owner: agentes con persona, modelo y alcance de herramientas; skills por rol |
| **Rutinas y Flujos** | Tareas programadas y workflows con nodos, estado y reintentos |
| **Memoria y Contexto** | Correcciones y entradas curadas, con versiones y aprobación |
| **Correo** | Borradores, envío y recepción por IMAP/SMTP configurado en Conexiones |
| **Conexiones** | MWT.ONE por empresa (DeviceToken), servidores MCP propios y correo |
| **MCP propio** | Servidor para que otra IA lea y opere el trabajo del owner |
| **SICOP** | Servidor MCP público con 71 herramientas de contratación pública, montado por defecto |

### Catálogo incluido

El paquete viaja con el catálogo base y lo instala en el home del harness la primera vez:

- **36 agentes** en `$DSH_HOME/agents-shared`
- **253 skills** en `$DSH_HOME/skills`
- Catálogos por rol en `catalogs/skills-catalog/<rol>`

Cada entrada se salta si ya existe, así que tus ediciones sobreviven a las actualizaciones.

---

## Configurar

### MWT.ONE

Sidebar → **Conexiones** → usuario y contraseña de la consola → **Conectar MWT.ONE** → elegí la empresa (por ejemplo *Sondel S.A.*).

La consola emite un DeviceToken por empresa; la contraseña sólo se usa en el login y nunca llega al modelo. Los servidores quedan como `mcp__mwt-<empresa>__*`.

### SICOP

Viene montado: `https://sicop.vlinte.work/mcp`, sin credenciales. En **Conexiones** podés pulsar **Probar SICOP** y ver las 71 herramientas. `SICOP_MCP_URL` vacío lo apaga.

### Modelos

Ajustes → **Modelos**: cargá la clave del proveedor (DeepSeek, OpenAI, Anthropic, Google, Kimi). El plugin no incluye inferencia.

---

## Uso diario

1. Creá un **Espacio** y cargá su contexto y sus archivos.
2. Asignale agentes y skills.
3. Abrí una sesión desde el Espacio: el agente usa su contexto, su memoria y sus reglas.
4. Pedile una propuesta de cambio y revisala en la **Mesa**.
5. Automatizá con **Rutinas** y **Flujos**.

FaberLoom proyecta el harness de cada Space en su carpeta (`CLAUDE.md`, `.claude/agents`, `.claude/skills`, `.faberloom/harness.json`), así que el mismo Space funciona también desde Claude Code con el mod.

---

## Relación con otras piezas

| Pieza | Qué es |
|---|---|
| **DeepSeek Harness** | La base: un harness de harnesses donde cada producto compone sus módulos como plugins |
| **FaberLoom (este paquete)** | El producto completo sobre DeepSeek Harness |
| **faberloom_mod** | El mod para Claude Code: catálogo nativo, Mesa, MWT.ONE y SICOP |
| **ECC** | Catálogo de ingeniería (MIT) que aporta parte de las skills |

---

## Notas y límites

- El plugin **no aplica ni publica** cambios: la Mesa revisa y aprueba; publicar requiere montar el módulo de publicación con un repo y un almacén.
- El dueño local del plugin es `anonymous`, el mismo que usan las conexiones y los Spaces.
- Si actualizás el paquete, reinstalá desde Complementos: la aplicación cachea la versión.
- Los avisos de arranque nombran la fase exacta (`view remote mount`, `surface registration`) cuando algo falla.

## Licencia

MIT.
