# O4-03 · Bandeja y lectura al lado

- Contrato: C-FL-04 · Ola O4 · Etapa E1
- Revisión: `32fc221910` (panel de tres zonas) + rediseño del 2026-11-18 (carpetas, vistas y paginador)
- Alcance: rail de vistas, cuentas y carpetas; lista paginada; lector; estados; el look en ambos anchos
- Nivel: C1-E (pruebas del componente) + C1-I (producto ensamblado en navegador real, con dos cuentas y una caída)
- Estado: **CLOSED** (revisión independiente PASS, `reviews/O4-review-round-2.md`); el rediseño del 18 exige un delta de revisión antes de heredar esta firma
- Gate: PC1, PC2, O2-05, O4-02
- Autor: faberloom-qa · Revisor: PASS 2026-11-18 · O4-review-round-2
- Antislop: `during` (preferencia global), aplicado mientras se escribió el panel

## 1. Cuatro zonas, como un gestor de correo

| Zona | Qué contiene |
|---|---|
| Rail | Vistas (Bandeja, No leídos, Marcados, Enviados, Borradores), cuentas y, bajo cada cuenta, sus carpetas del servidor (Inbox, Sent, Trash, Junk y las demás) |
| Barra | Búsqueda en el buzón (Enter), selector Bandeja/Borradores, cambio de look y correo nuevo |
| Lista | Una fila por correo, como botón: avatar con iniciales, remitente, asunto, dirección y fecha; el no leído lleva punto y peso |
| Lector | Encabezado con remitente, cuenta y fecha; cuerpo como texto; acciones (tarea, marcar leído, papelera, espacio, rutina, lección, responder) |

El paginador ocupa el pie de la lista: `Anterior`, `Página X de Y`, el total del buzón y `Siguiente`. No hay «Mostrar más»: la ventana es una página de 50 y el servidor la sirve por posición.

Una cuenta que no responde **no desaparece**: aparece en el rail con su nombre y la banda nombra el motivo con un botón `Reintentar`. Con dos cuentas y una caída, la lista muestra la sana y la banda la caída.

## 2. Estados

| Estado | Dónde se ve |
|---|---|
| Cargando | La lista muestra su bloque de carga; el lector, «Cargando» mientras llega el cuerpo |
| Vacío | La lista dice que no hay correos; el lector invita a elegir |
| Error | La lista muestra el error de carga; el lector, el error de esa lectura |
| Cuenta caída | La banda nombra la cuenta y el motivo, con `Reintentar`; las demás siguen listadas |
| Cuenta del correo | El lector muestra la cuenta junto a la fecha |

## 3. El look elegido

El panel aplica el look guardado (`faberloom.email.look`) y ofrece el control para cambiarlo. El look solo asigna variables `--fl-look-*`; el panel las consume en densidad y pintura. Un valor inválido en almacenamiento se repara al look por defecto, como fija `appearance.ts`. Cambiar de look no toca comportamiento, textos ni datos.

## 4. Verificación

```
vitest packages/client/ui-faberloom            281 pruebas, 23 archivos (13 del panel)
vitest apps/web/tests/email-panel.e2e.ts       3 pruebas en Chromium sobre el producto
tsc --noEmit (client)                          exit 0
verify-client-ui-i18n                          686 archivos, 0 cadenas fijas
```

| Prueba | Qué demuestra |
|---|---|
| Lectura al lado | Al elegir una fila aparece la región complementaria con asunto y remitente; «Close» la vacía |
| Estados del lector | Un error de lectura se muestra dentro del panel |
| Cambio de look | La superficie cambia de clase y la elección queda en almacenamiento |
| Cuenta caída | Con dos cuentas y una rechazada, el rail nombra la caída y la banda muestra su motivo con `Reintentar` |
| No leído | El punto aparece en la fila no leída y no en la leída; el contador del rail cuenta lo pendiente |
| Paginador | El pie muestra `Página X de Y` y el total; `Siguiente` pide la página 2 y `Anterior` vuelve |
| Carpetas | El rail lista las carpetas del servidor por cuenta; elegir una pide esa carpeta |
| Teclado nativo | Las filas son botones: Enter y Espacio abren por semántica del navegador; no hay listbox propio ni traspaso de foco al lector |
| Dos anchos, dos looks | `email-wide-look-a/b.png` y `email-narrow-list/reader-a/b.png`, sin desbordamiento horizontal |
| Contraste (A5) | Seis pares medidos en cada look (cuerpo, remitente, dirección, contador, remitente y asunto no leídos), todos ≥ 4,5:1 |
| Tarea desde el correo y desde cero | Dos clics en el mismo correo suman una sola tarea; el título desde cero es único por corrida |

Capturas en `e1/visual/`: las seis del panel y `email-hostile.png`, del aislamiento del visor.

## 5. Lo que no se verificó aquí

- Los buzones reales y la lectura con las dos cuentas del piloto: es PC3 y exige `AUTH-REAL-READ`. Aquí el receptor es un fixture y el resto es el producto ensamblado.
- El visor hostil en navegador real vive en `hostile-viewer.md`; su captura es `email-hostile.png`.
- El rediseño del 18 (carpetas, vistas y paginador) no tiene revisión independiente propia: la firma de esta página cubre la revisión `32fc221910`, y el delta se revisa antes de heredarla.
- Dos pruebas de `test:gui` ajenas siguen rojas (`ui-theme/apply`, `ui-reference/acceptance-real-folder`); se registran para la barrida de la ventana de PR.
