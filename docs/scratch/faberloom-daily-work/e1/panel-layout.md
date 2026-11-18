# O4-03 · Bandeja y lectura al lado

- Contrato: C-FL-04 · Ola O4 · Etapa E1
- Revisión: `3c68b6505a` (se actualiza al commit de cierre)
- Alcance: rail de vistas y cuentas, lista de correo y lector; estados; el look elegido en ambos anchos
- Nivel: C1-E (pruebas ejecutadas) + C1-I (producto ensamblado en navegador real)
- Estado: **READY_FOR_CEO**
- Gate: PC1, PC2, O2-05, O4-02
- Antislop: `during` (preferencia global), aplicado mientras se escribió el panel

## 1. Tres zonas, no una tabla

| Zona | Qué contiene |
|---|---|
| Rail | Vistas (Bandeja, Borradores) y cuentas, cada una con su contador; el contador es lo no leído, o el total cuando todo está leído |
| Lista | Una fila por correo, como botón dentro de la lista: avatar con iniciales, remitente, asunto, dirección y fecha; el no leído lleva punto y peso |
| Lector | Encabezado con remitente, cuenta y fecha; cuerpo como texto; acciones (tarea, marcar leído, papelera, espacio, rutina, lección, responder) |

Lo que la evidencia anterior describía como campos «De / Para / Fecha» ya no existe: el lector abre con quién escribió y cuándo, y el cuerpo se lee como texto, sin etiqueta de formulario ni caja de edición. Esta página sustituye esa descripción.

La lista se busca por rol (`list` con nombre «Inbox»), no por tabla. Al pasar el ratón o enfocar una fila, su fecha cede el sitio a las acciones de esa fila; nada se superpone al texto.

## 2. Estados

| Estado | Dónde se ve |
|---|---|
| Cargando | La lista muestra su bloque de carga; el lector, «Cargando» mientras llega el cuerpo |
| Vacío | La lista dice que no hay correos; el lector invita a elegir |
| Error | La lista muestra el error de carga; el lector, el error de esa lectura |
| Cuenta caída | La banda de fallos nombra la cuenta y el motivo; las demás siguen listadas |
| Cuenta del correo | El lector muestra la cuenta junto a la fecha |

## 3. El look elegido

El panel aplica el look guardado (`faberloom.email.look`) y ofrece el control para cambiarlo. El look solo asigna variables `--fl-look-*`; el panel las consume en densidad y pintura. Un valor inválido en almacenamiento se repara al look por defecto, como fija `appearance.ts`. Cambiar de look no toca comportamiento, textos ni datos.

## 4. Verificación

```
vitest packages/client/ui-faberloom            281 pruebas, 23 archivos (13 del panel)
vitest apps/web/tests/email-panel.e2e.ts       2 pruebas en Chromium sobre el producto
tsc --noEmit (client)                          exit 0
verify-client-ui-i18n                          686 archivos, 0 cadenas fijas
```

| Prueba | Qué demuestra |
|---|---|
| Lectura al lado | Al elegir una fila aparece la región complementaria con asunto y remitente; «Close» la vacía |
| Estados del lector | Un error de lectura se muestra dentro del panel |
| Cambio de look | La superficie cambia de clase y la elección queda en almacenamiento |
| Teclado | Enter abre y lleva el foco al título; Escape cierra y vuelve a la fila (`f1/captures/keyboard.json`) |
| Dos anchos, dos looks | `email-wide-look-a/b.png` y `email-narrow-list/reader-a/b.png`, sin desbordamiento horizontal |
| Tarea desde el correo y desde cero | Una tarea por gesto; el título desde cero es único por corrida |

Capturas en `e1/visual/`: las seis del panel y `email-hostile.png`, del aislamiento del visor.

## 5. Lo que no se verificó aquí

- Los buzones reales y la lectura con las dos cuentas del piloto: es PC3 y exige `AUTH-REAL-READ`. Aquí el receptor es un fixture y el resto es el producto ensamblado.
- El visor hostil en navegador real vive en `hostile-viewer.md`; su captura es `email-hostile.png`.
- Dos pruebas de `test:gui` ajenas siguen rojas (`ui-theme/apply`, `ui-reference/acceptance-real-folder`); se registran para la barrida de la ventana de PR.
