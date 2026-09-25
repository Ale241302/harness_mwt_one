# Estrategia de repositorios git

English | [中文](git-strategy.zh.md)

Actualizado el 20 de septiembre de 2026.

## Remotos

| Remoto | URL | Uso |
|---|---|---|
| `origin` | `https://github.com/deepseek-ai/deepseek-harness` | Upstream de DeepSeek. Solo `fetch`; `push` no habilitado |
| `fork` | `https://github.com/Ale241302/harness_mwt_one` | Nuestro repositorio. `push` aquí |

Rama principal: `main`. Tags relevantes: `faberloom-0.1.0` (primer corte del
producto), `deploy-2026-09-14` y `deploy-2026-09-15` (hitos de despliegue).

## Qué es este repositorio

**Un fork del código de DeepSeek Harness con la capa de producto y la capa de
despliegue.** En `main` conviven:

- la fuente del harness (`packages/`, `apps/`, `vendor/`, …) tal como se compila;
- la capa de integración de MWT.ONE: `gateway/` (login + supervisión de `dsh`
  por usuario), `Dockerfile`, `docker-compose.yml`, `nginx/`, `skills-catalog/`,
  `scripts/` y la documentación operativa (`README.mwt-one.md`, `MANIFEST.md`,
  `docs/`).

El fork se materializó en la rama `feat/faberloom-native` y se fusionó a `main`
con historial no relacionado respecto de la rama de despliegue previa; a partir
de ahí `main` es la única fuente.

## Cómo se construye el harness

El harness **no se consume desde npm**. El `Dockerfile` (etapa 1) lo construye
desde el tarball de fuente `vendor/deepseek-harness-src.tgz`, que
`scripts/push-to-vps.ps1` genera con `git archive` del árbol del fork. El SHA
real del fork se inyecta como `DSH_FORK_SHA` (build arg) para que la imagen no
quede con un commit sintético sin trazabilidad.

Versión fijada del fork: **`0.1.6-alpha.1`** (`package.json`). Cualquier versión
anterior citada (`0.1.5-rc.2`) es histórica y ya no aplica.

## Actualizaciones del harness

- El fork se actualiza desde `upstream` en la rama de trabajo, no con `merge`
  directo sobre `main` sin pruebas.
- Una actualización se prueba en entorno aislado, se registra en `MANIFEST.md`
  (motor, plugins, esquema) y se promueve con `scripts/update-harness.sh`, que
  etiqueta la imagen anterior, reconstruye y revierte si el healthcheck falla.
- `vendor/deepseek-harness-src.tgz` es un artefacto generado (ignorado por git);
  no se versiona.
