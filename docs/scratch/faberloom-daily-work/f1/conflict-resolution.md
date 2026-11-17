# F1-3 · Conflictos resueltos por escrito

- Contrato: C-FL-05 · Ola O2 · Etapa F1
- Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d`
- Alcance: los cinco conflictos que, sin resolverse, producen pantallas contradictorias
- Nivel: C1-L
- Estado: **READY_FOR_CEO**
- Gate: PC2
- Autor: faberloom-architect · Revisor: pendiente

Regla: un conflicto no se resuelve "en el código". Se escribe aquí, se aplica, y si el CEO decide otra cosa, se cambia este archivo primero.

## 1. Los diales están en dos escalas

**El conflicto.** `DESIGN_MESA.md` declara `ENERGY 3 · RHYTHM 5 · MOTION 2`. El plan exige `ENERGY/RHYTHM/MOTION` en escala 1-3. Una escala no dice cuál es la otra.

**Resolución.** La del documento histórico es 1-5; se normaliza a 1-3 conservando la posición relativa, no el número.

| Dial | Histórico (1-5) | Normalizado (1-3) | Por qué |
|---|---|---|---|
| ENERGY | 3 de 5 | **2** | Está en el medio: ni institucional ni campaña |
| RHYTHM | 5 de 5 | **3** | El máximo de variedad entre zonas: lista densa, detalle en dos columnas, panel angosto |
| MOTION | 2 de 5 | **1** | Casi sin movimiento: solo estados |

**Consecuencia si se aplica al revés.** Tomar los números como si ya fueran 1-3 daría RHYTHM 5, que no existe, y MOTION 2, que promete más movimiento del que el documento pide para una herramienta de trabajo.

**Quién lo confirma.** PC2. Si el CEO prefiere otra normalización, se cambia esta tabla y se revisan las pantallas afectadas.

## 2. ¿Se muestra la versión y la huella?

**El conflicto.** `DESIGN_MESA.md` §3 regla E2 dice que versión, hash, lock y revisión **no se muestran**. El gate de apariencia dice que ninguna pantalla final oculta versión, hash ni destinatarios. Las dos frases son correctas y se contradicen.

**Por qué existe la contradicción.** E2 protege al usuario de vocabulario interno (`artifact_version`, `rowVersion`). El gate protege la aprobación exacta: no se puede aprobar lo que no se ve.

**Resolución propuesta, separando las dos cosas.**

| Qué | En pantalla | Por qué |
|---|---|---|
| Destinatarios (To/Cc/Bcc), asunto, cuerpo, adjuntos | **Sí, siempre, completo** | Sin eso no hay aprobación exacta; es el objeto del consentimiento |
| Versión | **Sí, como `v3`**, solo cuando hay algo que comparar | Es el único caso en que el usuario la necesita para decidir |
| Nombres de estado internos | **No** | `PENDIENTE_CRITERIO` no es idioma de nadie |
| Hash, lock, `artifact_version` | **No en la pantalla** | No aportan a la decisión; la huella vive en la evidencia del ítem |

**Lo que queda abierto para PC2.** Si el CEO quiere la huella visible como garantía de exactitud, se añade como línea de detalle en el panel de aprobación, con el rótulo "huella" y sin hexadecimales completos. No se decide aquí porque cambia lo que el usuario ve al aprobar, y eso es del CEO.

## 3. "Modificable desde estilos" no incluye estructura ni teclado

**El conflicto.** `PREC-06` dice que la apariencia es modificable desde estilos. El gate de apariencia dice que estructura, teclado, arrastre y lectura junto a lista son funciones, no CSS.

**Resolución.** La frontera es exacta:

| Es estilo (cambia con un look) | Es función (no lo toca un look) |
|---|---|
| Colores, tipografía, radios, sombras | Orden de las zonas ①-⑦ |
| Espaciado dentro de los límites de densidad | Navegación por teclado y orden de tabulación |
| Tratamiento de bordes y superficies | Lista y lectura lado a lado |
| Densidad de fila entre 32 y 36 px | Arrastre y redimensión de la ventana flotante |

Un look que esconda un control, cambie el orden de tabulación o mueva el botón de aprobar **no es un look**: es un defecto.

## 4. Dos looks, un solo diff

**El conflicto.** Se piden dos looks propios, y a la vez el diff entre ellos debe limitarse a tema y CSS.

**Resolución.** Los dos looks comparten componentes, textos, estados y comportamiento. Solo cambian los archivos de look y los valores de token que consumen:

```
looks/look-a.module.css
looks/look-b.module.css
appearance.ts        (selección y persistencia)
```

Cualquier cambio en `.tsx` para que un look se vea distinto es un fallo de la separación y se corrige en el look, no en el componente.

## 5. La ventana de 390 px no es una app móvil

**El conflicto.** Se verifica a 390×844, y podría leerse como promesa de aplicación móvil.

**Resolución.** Es una **prueba de reflow**: la pantalla debe seguir siendo usable y sin overflow horizontal en un ancho de teléfono. No se promete app móvil, ni gestos táctiles propios, ni publicación en tiendas. La barra de acciones inferior existe para que el reflow no rompa el acceso, no para anunciar movilidad.

## 6. El dialecto del glosario

**El conflicto.** `DESIGN_MESA.md` escribe en segunda persona rioplatense ("Tenés cambios sin guardar", "asignalo"). La operación del piloto es costarricense.

**Resolución.** Se conservan los **términos** del glosario y se usa conjugación neutra: "Tienes cambios sin guardar", "asígnalo". El glosario manda sobre el vocabulario; el dialecto lo fija el usuario, no el documento de diseño.

**Decidido el 2026-11-17.** "Tienes" queda como forma por defecto. El voseo ("Tenés") se acepta como variante del diccionario, nunca como texto escrito a mano en un componente: si más adelante se elige, entra por el mismo asiento de locale que el resto del copy.

Es una decisión de copy, no de estructura, y por eso se cambia sin tocar un look.

## 7. Qué no se resuelve aquí

- El look elegido: es PC2.
- El umbral de contraste final por token: se mide en la entrega de PC2, no se declara.
- La política de contenido externo del visor: es O4-04.
