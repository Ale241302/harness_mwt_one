# Estrategia de repositorios git

Verificado/definido el 14 de septiembre de 2026.

## Remotos

| Remoto | URL | Uso |
|---|---|---|
| `origin` | `https://github.com/Ale241302/harness_mwt_one` | Nuestro repositorio. `push` aquí. Hoy vacío |
| `upstream` | `https://github.com/deepseek-ai/deepseek-harness` | Solo referencia (`fetch`). `push` deshabilitado |

Rama principal: `main`. Tag de la línea base desplegada: `deploy-2026-09-14`.

## Por qué no se fusiona `upstream` aquí

`harness-mwt-one` es la **capa de integración** (gateway de login + supervisión de
`dsh` por usuario + futuros módulos de FaberLoom), no un fork del código de
DeepSeek Harness. El harness se consume como **versión fijada** (`dsh 0.1.5-rc.2`)
mediante npm en el `Dockerfile`.

Fusionar `upstream` en este repo crearía **historiales no relacionados** y
conflictos en todo, justo lo que se quiere evitar. Por eso:

- `upstream` queda **solo para consultar** (`git fetch upstream`), nunca `merge`.
- Las actualizaciones del harness se gestionan como **bump de versión** en
  `Dockerfile` + `MANIFEST.md`, probadas en entorno de prueba antes de promover (E8).

## Si en el futuro hay que modificar el código del harness

No meterlo en `origin`. Crear un **fork separado** (p. ej.
`Ale241302/deepseek-harness`) con su propio `upstream`, y trabajar en ramas de
modificación. Así se puede `git pull upstream` sin tocar nuestro producto.

## Flujo de trabajo propuesto

1. Rama de trabajo desde `main` (`feat/...`, `fix/...`).
2. Commit y PR hacia `main` en `origin`.
3. Tag de versión cuando corresponde.
4. Despliegue al VPS con `scripts/push-to-vps.ps1 -Deploy`.

## Estado actual

- `main` local con commit `ab6530b` y tag `deploy-2026-09-14`.
- `origin` configurado; **pendiente** el primer `push` (requiere credencial/token
  de GitHub del titular de la cuenta).
