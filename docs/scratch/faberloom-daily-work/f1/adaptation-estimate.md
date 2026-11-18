# F1-3 · Estimación de la adaptación inicial

- Contrato: C-FL-05 · Ola O2 · Etapa F1
- Revisión: `0e0bf42a53`
- Alcance: costo de llevar la superficie actual a la estructura común con dos looks
- Nivel: C1-L (estimación sobre inventario medido, no sobre intuición)
- Estado: **READY_FOR_CEO**
- Gate: PC2
- Autor: faberloom-architect · Revisor: pendiente

## 1. Base medida

| Dato | Valor | De dónde sale |
|---|---:|---|
| Archivos modificados en `client` | 95 | `f0/effort-ranges.md` §6 |
| Tamaño de `panels.tsx` | 467 KB, ~9.800 líneas | Medido en el paquete |
| Valores en píxeles en los seis CSS | 699 | `f1/token-map.md` §4 |
| Fuera de la escala declarada | 140 | Ídem |
| Tokens usados y no declarados | 7 | Ídem §2 |
| Tokens declarados | 443 | Ídem §1 |

La estimación de F1 en PC1 es **10-18 jornadas**. Esto la descompone.

## 2. Descomposición

| Ítem | Qué incluye | Jornadas |
|---|---|---:|
| O2-01 | Ficha de referencias, dirección y conflictos | 0,5-1 |
| O2-02 | Inventario de tokens, medidas fijas y test de tokens | 0,5-1 |
| O2-03 | Estructura común: lista más lectura, propuesta, aprobación completa, entrada desde cero | 4-7 |
| O2-04 | Dos looks completos, persistencia y recuperación del look válido | 2-4 |
| O2-06 | Ventana de iteración movible y redimensionable, con foco y borrador local | 1,5-3 |
| O2-05 | Verificación en navegador, tres tamaños más zoom 200 %, informe y PC2 | 1-2 |
| **Total** | | **10-18** |

## 3. Supuestos

1. La estructura nueva vive en archivos nuevos (`email-layout.tsx`, `email-store.ts`, `looks/*`), no dentro de `panels.tsx`. Si hay que descomponer `panels.tsx` primero, se suman 3-5 jornadas.
2. Los iconos existentes alcanzan; no se dibuja un set nuevo.
3. Los dos looks se diferencian con tokens y CSS, sin componentes paralelos.
4. El prototipo usa fixtures rotulados, no datos reales ni integración con el motor.
5. La verificación se hace con el navegador del entorno, sin dispositivo físico.

## 4. Qué haría subir el costo

| Riesgo | Efecto |
|---|---|
| `panels.tsx` no se puede extender sin descomponerlo | +3-5 jornadas y una revisión de regresión |
| La lectura junto a lista exige estado compartido con el board | +2-3 jornadas, porque toca la identidad que hoy falla (O3-04) |
| El look oscuro necesita contraste distinto por token y no por componente | +1-2 jornadas de medición |
| Aparece un requisito de teclado que el componente actual no soporta | +1-2 jornadas |

## 5. Qué no incluye este número

- Integración con el motor de correo: es E1.
- Visor de contenido externo: es O4-04.
- Pruebas de seguridad integrada: no las cierra PC2.
- Publicación o despliegue.

## 6. Cómo se recalcula

Al terminar O2-03 se mide lo real contra esta tabla y se corrige el rango. Una estimación que no se revisa al pasar el primer tercio es una promesa, no un plan.
