# Jaula de `run_code` (Code Mode)

`run_code` ejecuta TypeScript arbitrario en un proceso Node hijo con `fs`, `net` y
`child_process` intactos. El sandbox del harness solo restringe escrituras
(`read-only` / `workspace-write` / `danger-full-access`): no limita lecturas ni
red. En el gateway todos los homes cuelgan de `/data/users/<id>` y ahí viven los
tokens MCP de cada inquilino, así que sin esta carpeta un programa escrito por el
modelo puede leer el token de otro inquilino y llamar al MCP con esa identidad,
saltándose política y aprobación.

| Archivo | Qué es |
| --- | --- |
| `node-jail` | Envoltorio `#!/bin/sh` que se configura como `nodeExecutable` de la fila `ptc-runtime` y arranca `node` dentro de `bwrap`. |
| `verify.sh` | Evidencia ejecutable: corre el comprobador dentro de la misma jaula y falla ruidosamente si algo no se cumple. |
| `bwrap-seccomp.json` | Perfil seccomp del contenedor del gateway: el de Docker más una regla que permite a `bwrap` crear sus namespaces. |

## Interfaz de `node-jail`

Se configura como `nodeExecutable` de la fila `ptc-runtime`, así que recibe los
argumentos que el paquete habría pasado a `node` y los reenvía tal cual. Dos
detalles del runtime definen la interfaz:

- El home del inquilino **no** llega por argv (es del paquete) ni por entorno (el
  runtime reemplaza `process.env` por un diccionario vacío antes del spawn).
  Llega por el **directorio de trabajo**: el runtime arranca el hijo en el
  workspace de la sesión, que es `/data/users/<id>` o un subdirectorio suyo. La
  jaula deriva el home de ahí, exige exactamente un nivel bajo `/data/users` y
  rechaza cualquier otro sitio con salida 126.
- `PTC_JAIL_HOME` anula ese cálculo para pruebas manuales; también debe ser
  `/data/users/<id>`.
- `tenants` es un segmento **reservado**: `FABERLOOM_TENANT_HOME=1`
  (`shouldShareTenantHome` en `gateway/tenant-home.mjs`) muda el home a
  `/data/users/tenants/<clave>`, y de ahí el cwd derivaría `/data/users/tenants`,
  que es el directorio de todos los inquilinos. La jaula lo rechaza con salida
  126 en vez de montarlo; con casas compartidas, Code Mode no arranca.
- El canal de control del subproceso llega por el fd 7. **No** pasar
  `--sync-fd 7`: `bwrap` cierra esos descriptores en el hijo antes del exec y el
  canal moriría. Los descriptores heredados que no son `--sync-fd` sí llegan.
- El entorno se hereda a propósito: el marcador `DSH_SUBPROCESS_CONTROL=pipe`
  tiene que llegar al bootstrap. Por eso la jaula no usa `--clearenv` y solo
  añade `HOME`, `PATH`, `TMPDIR` y `DSH_PTC_JAIL`.

Dentro de la jaula: namespaces nuevos (usuario, mount, pid, net, ipc, uts),
`/usr` y `/opt/dsh` en solo lectura, `/proc` propio, `/tmp` efímero y el home del
inquilino como único punto de escritura. `/app` y los homes de los demás
inquilinos no existen ahí dentro.

## Evidencia

```sh
docker exec -it mwt-one-harness-gateway /opt/dsh/bin/verify.sh <inquilino> [<otro>]
```

Imprime `PASS`/`FAIL` por caso y sale ≠0 si alguno falla. Comprueba que escribe en
su home, que no lee ni escribe en otro inquilino, que `/data/users` solo contiene
su propio home, que no resuelve DNS ni abre sockets TCP y que no ve procesos
ajenos. Fuera de la jaula falla: es la señal de que la prueba no está midiendo el
camino de producción.

## Perfil seccomp

`bwrap-seccomp.json` es
`https://raw.githubusercontent.com/moby/profiles/main/seccomp/default.json` (el
perfil por defecto de Docker, 2026-11-24) con **una** entrada añadida al
principio: `clone`, `unshare`, `mount`, `umount2`, `pivot_root` y `setns` en
`SCMP_ACT_ALLOW`. Sin ella el motor niega `clone(CLONE_NEWUSER)` y `bwrap` no
puede crear su namespace de usuario; con ella el kernel sigue exigiendo
`CAP_SYS_ADMIN` para montar, y esa capacidad solo existe dentro del namespace
nuevo, que es la jaula.

Para regenerarlo, vuelve a descargar el perfil y antepón esa entrada. El resto de
reglas del perfil de Docker —`bpf`, `perf_event_open`, `keyctl`, módulos— quedan
intactas.

`docker-compose.yml` añade además `systempaths=unconfined`, porque las entradas
enmascaradas de `/proc` del contenedor impiden montar un procfs nuevo dentro del
namespace de usuario. Es el precio de tener un `/proc` por corrida; sin él,
`--proc /proc` falla con `Operation not permitted` y el caso (d) de `verify.sh`
no se puede cumplir.
