# Diagnóstico de base común con el upstream

Contrato: C-FL-01 / O0-06 / FM-O0-06 Herramienta: `scripts/faberloom-daily/compare-upstream.ts` (11 pruebas, 0 fallos) Nivel: C1-E sobre lectura de repositorio. No acredita que el producto funcione.

## 1. Lo medido

| Campo | Valor |
|---|---|
| Repositorio | `deepseek-harness/` |
| Rama | `fix/guarda-operadores` |
| HEAD | `0b01ca39365ba04fe89858bcac56e3523896ee4d` |
| `origin/master` | `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720` |
| Base común (`merge-base`) | `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720` |
| Separación | 755 commits por delante, 0 por detrás |
| Diferencia total | 3.695 archivos, +455.619 / −7.549 |
| Objeto histórico `39163dd` | ausente en el clon local |

La base común **es** el HEAD del upstream. No hay commits del upstream sin integrar, así que un futuro `merge` no arrastra trabajo ajeno pendiente: arrastra exactamente lo que el upstream publique después de `0d1f5000`.

## 2. Dónde vive la divergencia

| Área | Archivos |
|---|---:|
| `skills-catalog/` | 682 |
| `packages/client/` | 529 |
| `packages/faberloom/` | 504 |
| `.agents/` | 451 |
| `skills-shared/` | 445 |
| otros paquetes `packages/*` | 431 |
| `apps/` | 155 |
| `snapshots/` | 147 |
| `docs/` | 96 |
| `agents-shared/` | 73 |
| `scripts/` | 59 |
| `gateway/` | 34 |
| **`packages/core/`** | **19** |
| `deploy/` | 4 |

Lectura: el fork no es "un producto FaberLoom colgado del upstream". Es un árbol que arrastra catálogos de skills, agentes y snapshots como material propio. Eso importa para F0-6 por dos motivos:

1. Cualquier actualización del upstream va a chocar contra 3.695 archivos, no contra 500.
2. La separación "propio / núcleo / tokens" no se puede hacer por carpeta sin revisar antes qué de eso se publica, qué se genera y qué es copia.

## 3. Núcleo tocado: sí, y ya está confirmado

19 archivos bajo `packages/core/`, entre ellos:

- `packages/core/agent-loop/src/agent.ts`
- `packages/core/agent/src/runtime-types.ts`
- `packages/core/session/src/known-event-types.ts` (generado)
- `packages/core/tools/tests/gen-tool-catalog.spec.ts`
- varios `package.json` y `README*` de paquetes de núcleo

Consecuencia directa: `AUTH-CORE` no es una precaución futura. El árbol ya contiene modificaciones de núcleo. Cualquier actualización que las pise requiere decisión del CEO con motivo, alternativa de extensión descartada, archivos, snapshots, migración y rollback. No se tocan en F0.

## 4. Tokens y apariencia

`packages/client/ui-theme` y `packages/client/ui-faberloom` acumulan 95 archivos dentro de los 529 de `client`. La matriz de tokens y la clasificación de medidas fijas pertenecen a O2-02 (F1-2), no a O0-06. Aquí solo queda registrado que la superficie visual está modificada y que el inventario de tokens debe hacerse sobre esta revisión, no sobre el upstream.

## 5. Autoría de los 755 commits

| Autor | Commits |
|---|---:|
| Jorge Alejandro Casierra | 723 |
| FaberLoom | 17 |
| Alejandro | 12 |

El historial no distingue con claridad qué se escribió a mano y qué se importó por lote. Por eso la separación propio/núcleo se hará por **contenido y ruta** (arriba), no por autoría.

## 6. Límites de este diagnóstico

- No se ejecutó `fetch`. La referencia del upstream es la que existe localmente; si el upstream publicó después, este informe no lo ve. Declararlo es parte del contrato, no un defecto.
- `39163dd30f703a79079e2d2446545cff3c453738` no existe en este clon. Los conteos históricos que lo citan no se reproducen y no se inventan.
- El árbol estaba sucio al medir: las 3.695 son la diferencia **confirmada** entre ramas, no incluyen los archivos nuevos de O0 que aún no se han confirmado.
- Un diff de 3.695 archivos no se revisó a mano. La atribución archivo por archivo queda para el contrato que la necesite (O7-04), con su propio alcance y evidencia.
- Este informe **no** cierra T14. T14 exige ejecutar la actualización, migrar, restaurar y repetir los recorridos afectados en O7-04.

## 7. Reproducir

```sh
# desde deepseek-harness/
corepack pnpm exec vitest run scripts/faberloom-daily/compare-upstream.spec.ts --project thread-safe
corepack pnpm exec tsx scripts/faberloom-daily/compare-upstream.ts
```
