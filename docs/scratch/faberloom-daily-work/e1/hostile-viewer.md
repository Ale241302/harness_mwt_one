# O4-04 · Visor aislado y política de recursos

- Contrato: C-FL-04 · Ola O4 · Etapa E1
- Revisión: `3c68b6505a`
- Alcance: HTML legítimo y hostil en el lector, DOM, eventos y red sin salir de política
- Nivel: C1-E (pruebas ejecutadas) + C1-L (análisis del marco)
- Estado: **READY_FOR_CEO**
- Gate: PC1, PC2, O4-03

## 1. Qué puede hacer el correo de un tercero

El cuerpo HTML lo escribe quien envía. Sin control, dentro de un visor puede:

| Intento | Qué busca |
|---|---|
| `script`, `onerror`, `javascript:` | Ejecutar código en la sesión del dueño |
| `form`, `input`, `button` | Parecer una aprobación y capturar datos |
| `img src="https://…"` | Confirmar que el correo se abrió (píxel de seguimiento) |
| `link`, `@font-face`, `video` | Traer recursos y medir la lectura |
| `base href` | Reescribir a dónde apuntan los enlaces relativos |
| `position: fixed`, `z-index` alto | Tapar o sustituir controles reales |
| `iframe`, `object` | Cargar otra página dentro del marco |

## 2. Tres capas, no una

| Capa | Qué detiene |
|---|---|
| `sandbox=""` en el marco | Scripts, formularios, plugins, popups, navegación del padre y origen propio |
| Sanitizado antes de `srcDoc` | Elementos activos, manejadores `on*`, formularios y controles, `base`, recursos remotos (`src`, `srcset`, `poster`), enlaces con destino |
| CSP dentro del documento | Cualquier petición: `default-src 'none'`, imágenes solo `data:`, estilos solo en línea, sin fuentes, medios, marcos ni conexiones |

El sanitizado conserva lo legítimo: tablas, estilos en línea, imágenes ya incrustadas como `data:` (los adjuntos `cid:` se inlinean antes) y el texto de los enlaces, que pierde el destino. Un enlace interno (`#seccion`) sí se conserva.

`position: fixed` y `z-index` quedan confinados al marco: no pueden cubrir un control de la aplicación porque viven en otro documento y otra capa.

## 3. Contenido externo es dato

El visor no interpreta el correo como instrucciones: lo pinta. Los campos de aprobación, las acciones y el envío viven fuera del marco, en la aplicación; un formulario dibujado dentro del correo no es un control y no puede aprobar nada. El modelo tampoco recibe el HTML del cuerpo: la herramienta de lectura entrega texto y adjuntos convertidos a Markdown.

## 4. Evidencia ejecutada

```
vitest safe-email              4 pruebas
vitest client/ui-faberloom     281 pruebas (incluye la del marco)
+ apps/web/tests/email-panel.e2e.ts   caso hostil en Chromium sobre el producto
oxlint (código nuevo)          0
```

| Prueba | Qué demuestra |
|---|---|
| HTML legítimo | Párrafos, estilos, imagen `data:` y tabla sobreviven; la CSP está presente |
| HTML hostil | `script`, `on*`, `form`, `input`, `button`, `javascript:` desaparecen; el texto queda |
| Recursos remotos | `base`, `link`, `iframe`, `object`, `video`, imágenes y `srcset` remotos no llegan al documento; los enlaces pierden destino |
| Anclas internas | `#detalle` se conserva; un enlace externo pierde el `href` |
| Marco del panel | `srcdoc` lleva CSP, conserva el texto, no contiene `https://` del atacante, y el `sandbox` está vacío |
| **Navegador real (T7)** | Sobre el producto ensamblado, un correo con script, formulario, imagen de seguimiento, enlace e iframe: el texto legítimo se lee, `srcdoc` no contiene `<script>`, `<form>` ni `tracker.example`, el `sandbox` está vacío, **no se observa ninguna petición al origen hostil** y `window.__pwned` sigue indefinido. Captura: `e1/visual/email-hostile.png` |

## 5. Lo que no se verificó

- La red se observa en el navegador (peticiones del documento y del marco), no a nivel de sistema operativo. El aislamiento del proceso es del navegador; el `sandbox` vacío es la garantía declarada.
- El buzón real: aquí el cuerpo hostil viene de un fixture. Leer el HTML real de un tercero ocurre con PC3, y el aislamiento no cambia por la cuenta.
- E2 añade editor HTML y vista de adjuntos: esas superficies repiten T7 cuando existan.
