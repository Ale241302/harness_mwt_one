# O4-03 · Bandeja y lectura al lado

- Contrato: C-FL-04 · Ola O4 · Etapa E1
- Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d`
- Alcance: lectura junto a la lista, cuenta y error visibles, estados vacío/carga/error y el look elegido en ambos tamaños
- Nivel: C1-E (componente y comportamiento) + C1-I (build del paquete)
- Estado: **READY_FOR_CEO**
- Gate: PC1, PC2, O2-05, O4-02
- Antislop: `during` (preferencia global), aplicado mientras se escribió el panel

## 1. Una sola lógica, dos disposiciones

El panel de Email deja de abrir la lectura en un modal que tapa la lista. La lectura vive en un panel al lado:

| Ancho | Disposición |
|---|---|
| Ancho (≥ 900 px) | Lista y lectura, una al lado de la otra |
| Angosto (< 900 px) | Una vista a la vez: la lista, y al elegir un correo, la lectura con «Cerrar» para volver |

Los campos del lector (De, Para, Fecha, Adjuntos, Cuerpo) y sus acciones (Responder, Marcar leído, Papelera, Espacio, Rutina, Lección) se declaran **una vez** y los usan las dos disposiciones. No hay un segundo componente de correo ni una copia del flujo.

## 2. Estados

| Estado | Dónde se ve |
|---|---|
| Cargando | La lista muestra su bloque de carga; el lector muestra «Cargando» mientras llega el cuerpo |
| Vacío | La lista dice que no hay correos; el lector invita a elegir una fila |
| Error | La lista muestra el error de carga; el lector muestra el error de esa lectura |
| Cuenta caída | La banda de fallos nombra la cuenta y el motivo; las demás siguen listadas |
| Cuenta del correo | El lector muestra la cuenta en «Para» |

## 3. El look elegido

El panel aplica el look guardado (`faberloom.email.look`) al superficie de Email y ofrece un control para cambiarlo. El look solo asigna variables `--fl-look-*` (radio, separación, altura de fila, superficie, borde); el panel las consume en el reparto y en el lector, así que cambiar de look cambia densidad y pintura sin tocar comportamiento ni duplicar el layout. Un valor inválido en almacenamiento se repara al look por defecto, como fija `appearance.ts`.

## 4. Verificación

```
vitest client/ui-faberloom        265 pruebas (4 nuevas del panel)
bundle del paquete                exit 0
oxlint (líneas nuevas)            0
verify-client-ui-i18n             685 archivos
```

| Prueba | Qué demuestra |
|---|---|
| Lectura al lado | Al elegir una fila aparece la región complementaria con asunto y remitente; «Cerrar» la vacía |
| Estados del lector | Un error de lectura se muestra dentro del panel |
| Cambio de look | La superficie cambia de clase y la elección queda en almacenamiento |
| Tema y estilo | Los escaneos de tema (bordes, radios, scrollbar) pasan con el CSS nuevo |

## 5. Deuda de estilo que apareció

Los escaneos de tema (`elevation`, `corner-shape`, `scrollbar`) estaban rojos desde O2 por el CSS del prototipo: bordes neutros de 1 px donde la casa pide 0,5 px, radios completos sin `corner-shape: round`, y un área con scroll dentro de un diálogo elevado sin rebind de barra. Se corrigieron en el mismo cambio; los escaneos pasan.

## 6. Lo que no se verificó aquí

- La comprobación visual en navegador real a dos anchos y dos looks requiere la composición viva con los buzones del piloto (PC3). El comportamiento, los roles y el cambio de look están probados; el aspecto medido en pantalla queda para esa corrida, con capturas en ambos anchos.
- Dos pruebas de `test:gui` ajenas a este cambio siguen rojas: `ui-theme/apply` (un mock llamado una vez) y `ui-reference/acceptance-real-folder` (espera una carpeta real que no está en este equipo). Se registran para la barrida de la ventana de PR, no se tocan aquí.
