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

| Dato | Ubicación |
|---|---|
| Usuarios | `core.users` (6 registros) |
| Roles (8) | `core.roles`: `superadmin`, `admin`, `manager`, `compras`, `finance`, `operator`, `client_b2b`, `viewer` |
| Asignación | `core.user_roles` |
| Tenant del usuario | `core.users.tenant_uuid` (será `X-MWT-Client-ID`) |

## Cuentas de prueba

Se usan cuentas reales con dos roles distintos para verificar aislamiento:

| Rol | Uso en pruebas |
|---|---|
| `admin` | Ve el conjunto completo de herramientas (referencia) |
| `client_b2b` | Debe ver un subconjunto filtrado; sin acceso a datos de otros clientes |

Las contraseñas **no** se guardan en este repositorio. Se gestionan fuera de git.

## Notas

- El tenant (`X-MWT-Client-ID`) hoy está **vacío** en el gateway → modo global.
  Mapearlo desde `core.users.tenant_uuid` es tarea de E2.
- Antes de cualquier escritura de negocio, probar que un usuario sin permiso
  recibe denegación efectiva (no solo ocultamiento visual).
