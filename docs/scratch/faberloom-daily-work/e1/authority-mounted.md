# O3-02B · Autoridad y mediador montados en la composición

- Contrato: C-FL-04 · Ola O3 · Etapa E1
- Revisión: `c7a20b03a1`
- Alcance: composición del producto, arranque condicionado y denegación por defecto
- Nivel: C1-E (pruebas ejecutadas) + C1-L (composición revisada)
- Estado: **READY_FOR_CEO**
- Gate: PC1, PC2
- Autor: faberloom-implementer · Revisor: pendiente

## 1. Qué se montó

La fila `faberloom-access` del perfil **monta dos servicios**, no uno:

| Servicio | Qué expone | Antes | Ahora |
|---|---|---|---|
| `faberloomAccess` | Grants y firmas CEO | montado | montado |
| `faberloomCredentials` | Custodia del secreto de una conexión | no existía | **montado por la misma fila** |

El montaje es explícito en el constructor de la autoridad: una composición que carga `@deepseek-ai/dsh-faberloom-access` obtiene la autoridad y la custodia, o ninguna de las dos. No hay una segunda fila que se pueda olvidar.

## 2. Que sin ellos no arranque la capacidad de envío

Dos mecanismos, y el segundo es el que se prueba:

1. **Inyección declarada.** El adaptador de correo declara `inject = ['faberloomBoard', 'faberloomConnections', 'faberloomAccess', 'faberloomCredentials']`. Si la fila de autoridad no está, Cordis no carga el adaptador: la capacidad no existe.
2. **Guardia explícita.** Aunque el adaptador se aplicara a mano, `apply` comprueba los dos servicios y, si falta alguno, advierte y **no registra el adaptador**:

   > `faberloom: mail.send stays unregistered because faberloomAccess and faberloomCredentials are not mounted`

Esto es denegación por defecto en el arranque: no hay un adaptador sin guardia esperando a que alguien lo llame.

## 3. Evidencia ejecutada

```
vitest packages/faberloom/access packages/faberloom/effects-mail   47 pruebas
tsc --noEmit (ambos paquetes)                                     exit 0
oxlint                                                            exit 0
verify-package-dependencies                                       64 paquetes conformes
```

| Prueba | Qué demuestra |
|---|---|
| `mounts credential custody with the authority` | Al cargar la autoridad, `ctx.faberloomCredentials` existe y guarda |
| `registers the adapter on the board and removes it with the fiber` | Con autoridad y mediador, el adaptador se registra y se retira al disponer |
| `does not start the send capability without the authority and the mediator` | Sin ellos, **cero** adaptadores y un aviso explícito |
| `no accepted effect type` (existente) | Se conserva la regla A-05: tipo no aceptado, adaptador no registrado |

## 4. Cambios de composición

| Archivo | Cambio |
|---|---|
| `packages/bundle/faberloom-app/cordis.patch.yml` | La fila de autoridad declara que monta los dos servicios |
| `packages/faberloom/effects-mail/src/index.ts` | `inject` con autoridad y mediador, más la guardia |
| `packages/faberloom/effects-mail/{package.json,tsconfig.json}` | Dependencia y referencia de proyecto a `access` |
| `packages/faberloom/access/src/index.ts` | La autoridad monta el mediador |
| `packages/faberloom/access/README.md` | El contrato de la fila dice los dos servicios |

## 5. Límites declarados

- **El transporte sigue leyendo su propia credencial.** `connections.sendMail` resuelve el secreto de su almacén y el mediador no se interpone en esa llamada: `withSecret` no tiene llamadores. Es el hallazgo S-5 de `gate-security-review.md`, aceptado para el piloto porque el código en proceso ya ejecuta con los permisos del proceso; el mediador impide que la clave llegue al modelo, a un log, a un error o a un aviso. Endurecer el transporte con `withSecret` queda como trabajo de E2, sin gate asignado hoy.
- **Las vías de flujo, rutina, herramienta, aviso e invitación se cerraron en O3-02C** (ver `write-denied.md`), no por montar la autoridad.
- **El autoenvío por racha se retiró en O3-03** (`no-auto-send.md`).

## 6. Reproducir

```sh
corepack pnpm exec vitest run packages/faberloom/access packages/faberloom/effects-mail --project thread-safe
corepack pnpm exec tsc --noEmit -p packages/faberloom/effects-mail/tsconfig.json
```
