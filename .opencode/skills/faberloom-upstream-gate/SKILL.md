---
name: faberloom-upstream-gate
description: Diagnostica la base común con deepseek-harness, separa cambios propios de núcleo y tokens, y prepara una actualización sin arrastrar efectos. Usar al actualizar el fork, al atribuir un archivo o antes de tocar packages/core.
---

# Compuerta de upstream

## Qué se mide antes de decidir

```sh
corepack pnpm exec tsx scripts/faberloom-daily/compare-upstream.ts
```

Devuelve: HEAD, referencia upstream, `merge-base`, commits por delante y por detrás, archivos y
líneas de diferencia, y el reparto por área. Si falta un objeto histórico, lo declara; no lo
estima.

## Separación obligatoria

| Capa | Ejemplos | Regla |
|---|---|---|
| Núcleo | `packages/core/**`, generados | Tocar exige `AUTH-CORE`: motivo, extensión descartada, snapshots, migración, rollback |
| Propio | `packages/faberloom/**`, `gateway/**` | Se actualiza con el flujo normal |
| Tokens y apariencia | `packages/client/ui-theme`, `ui-faberloom` | Matriz de tokens sobre la revisión medida, no sobre el upstream |
| Lastre | catálogos de skills, snapshots, agentes | Se decide qué se publica y qué se genera; no se arrastra por inercia |

Un archivo generado (`known-event-types.ts`, catálogos) no se edita a mano. Se cambia el
generador y se regenera.

## Actualización

1. Identifica SHA objetivo y composición candidata.
2. Ejecuta T14-E1 y todo caso afectado **en aislado**, antes de tocar el servidor.
3. Migra y restaura sin reactivar rutinas, permisos ni efectos.
4. Repite recepción, identidad, iteración, memoria, autorización, envío, conciliación y
   conversión.
5. Solo entonces, `AUTH-DEPLOY` con SHA, imagen, ventana y rollback.

## Rechazos

- Actualizar producción para "ver si pasa".
- Declarar compatibilidad porque "solo se documentó que algo se rompe".
- Reutilizar pruebas de una revisión anterior sin revalidar los casos afectados.
- Presentar un diagnóstico de F0-6 como cierre de T14. No lo es.
