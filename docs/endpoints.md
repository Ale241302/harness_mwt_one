# Endpoints y topología · harness-mwt-one

Verificado en el VPS el 14 de septiembre de 2026.

## Principio de identidad (decidido)

Quien inicia sesión en el harness obtiene **sus roles y permisos** de la consola
y con ellos interactúa con el MCP de MWT.ONE. **Cualquier usuario de la consola
puede conectarse por defecto**, con el alcance que su rol permita; el MCP filtra
las herramientas por rol (RBAC). Un rol `client_b2b` ve un subconjunto distinto
al de `admin`.

El gateway **no guarda el JWT** del usuario: propaga su identidad por cabeceras y
el MCP resuelve rol/permisos. No se usa una credencial administrativa compartida
como sustituto de la identidad.

## Topología

```
Navegador
  └─ https://harness.mwt.one  (Cloudflare → mwt-nginx:443)
        └─ harness-gateway:8080
              ├─ POST /login → consola /api/auth/login/  (identidad + rol)
              ├─ un proceso dsh por usuario (DSH_HOME propio)
              └─ MCP con la identidad del usuario

Clientes externos (Claude/Cowork)
  └─ https://mcp.mwt.one → Authentik/ContextForge → consola-mwt-one-mcp:8765
```

## Endpoints

| Servicio | URL | Transporte |
|---|---|---|
| Harness (UI) | `https://harness.mwt.one` | HTTPS |
| Health del gateway | `https://harness.mwt.one/healthz` | JSON |
| Login de consola | `https://consola.mwt.one/api/auth/login/` | JSON |
| MCP interno (usado por el harness) | `http://consola-mwt-one-mcp:8765/mcp` | Streamable HTTP |
| MCP externo canónico (producto) | `https://mcp.mwt.one` | OAuth (Authentik) |
| IdP | `https://idp.mwt.one` | Authentik |
| Consola | `https://consola.mwt.one` | HTTPS |

## Cabeceras por camino

| Camino | Cabeceras |
|---|---|
| Harness → MCP interno | `X-Forwarded-User-Email`, `X-MWT-Gateway-Key`, `Authorization: Bearer dsh-gateway` (solo evita el challenge OAuth; no es JWT), opcional `X-MWT-Client-ID` |
| Cliente externo → `mcp.mwt.one` | OAuth de Authentik; `X-MWT-Client-ID` por tenant (Ola 6) |

## Decisión de camino canónico

- **Identidad del harness:** camino interno `consola-mwt-one-mcp:8765` con
  identidad por cabecera (email → rol resuelto por el MCP). Operativo hoy.
- **Canónico de producto** para clientes externos: `https://mcp.mwt.one`
  (Authentik + ContextForge), que ya propaga tenant (`X-MWT-Client-ID`).
- **Convergencia prevista (E2):** que el gateway obtenga/renueve token OAuth por
  usuario para usar `mcp.mwt.one` también desde el harness, sin cambiar el
  principio de identidad. Hasta entonces no se mezclan ambos caminos sin
  registrar cuál usó cada llamada.

## Datos de identidad

| Dato | Fuente verificada |
|---|---|
| Usuarios | `core.users` (6 registros) |
| Roles (8) | `core.roles`: `superadmin`, `admin`, `manager`, `compras`, `finance`, `operator`, `client_b2b`, `viewer` |
| Rol efectivo | `core.users.role`; `core.user_roles` solo tenía 1 fila, no usar como fuente |
| Rol, nombre y permisos | respuesta del login: `user.role`, `user.role_name`, `user.permissions` (`modules`, `actions`, `read_only`) |
| Tenant del usuario | `user.legal_entity_ids` del login (**no** `core.users.tenant_uuid`, que está NULL) |

## Evidencia de pruebas (14 sep 2026)

### Login (`https://consola.mwt.one/api/auth/login/`)

| Cuenta | Rol | Permisos | `legal_entity_ids` |
|---|---|---|---|
| `alejandro@muitowork.com` | `admin` | modules, actions | 3 |
| `alvaro@muitowork.com` | `admin` | modules, actions | 3 |
| `compras2@sondelsa.com` | `client_b2b` | modules, actions, `read_only` | 1 (`c588c410-…`) |
| `logistica2@sondelsa.com` | `client_b2b` | modules, actions, `read_only` | 1 (`c588c410-…`) |

Las cuatro cuentas inician sesión correctamente. Las contraseñas no se guardan aquí.

### RBAC del MCP (identidad por cabecera, con handshake de sesión)

| Identidad | Herramientas visibles |
|---|---|
| `alejandro@muitowork.com` (admin) | **175** |
| `compras2@sondelsa.com` (client_b2b) | **44** |

El filtrado por rol funciona de punta a punta: misma puerta, distinto conjunto
según la identidad del login. `client_b2b` no recibe las herramientas de gestión.

## Notas

- El tenant (`X-MWT-Client-ID`) hoy está **vacío** en el gateway → modo global.
  El valor correcto por usuario es su `legal_entity_ids` del login; mapearlo es E2.
- `core.users.tenant_uuid` existe pero está NULL: no usarlo como fuente sin poblarlo.
- Antes de cualquier escritura de negocio, probar que un usuario sin permiso
  recibe denegación efectiva (no solo ocultamiento visual).
