---
name: iva-declaraciones
description: "Úsala cuando el usuario quiera preparar, revisar o cuadrar una declaración de IVA de un periodo, o comprobar las cuotas soportadas y repercutidas del libro registro. Ejemplo: 'prepara el IVA de <periodo>' o 'cuadra el IVA soportado del trimestre'."
whenToUse: "Hay que liquidar el IVA de un periodo a partir del libro registro de facturas emitidas y recibidas."
---

# Declaraciones de IVA

Prepara la liquidación de IVA de un periodo desde los libros registro, con cada cifra trazable a los documentos que la componen.

## Antes de empezar

- Fija el periodo y el modelo que toca: `<periodo>`, `<modelo>`, y la fecha límite de presentación.
- Consigue los libros registro del periodo: facturas emitidas y facturas recibidas, sin huecos y sin duplicados.
- Comprueba que los dos libros están completos: cuenta las facturas y compara el número con el del periodo anterior para detectar un libro a medio cargar.
- Comprueba el régimen aplicable (general, simplificado y sus límites, criterio de caja, operaciones exentas): el resultado cambia por completo, y elegir régimen no es una decisión del cálculo.

## Procedimiento

1. Recorre el libro de emitidas y agrupa por tipo impositivo: base y cuota repercutida por tipo. Separa las exentas, las no sujetas y las de exportación, que van con base y sin cuota.
2. Recorre el libro de recibidas y agrupa igual: base y cuota soportada por tipo. Separa lo deducible de lo no deducible y, de lo deducible, lo que está en duda.
3. Suma las bases y las cuotas de cada grupo y presenta el cuadro base más cuota por tipo en los dos lados.
4. Resta del IVA repercutido el IVA soportado deducible del periodo, añadiendo o quitando lo que arrastre de periodos anteriores: el resultado es el saldo de la liquidación.
5. Si el saldo es a devolver o a compensar, dilo como resultado del cálculo y no como una decisión: la forma de resolverlo (compensar, devolver, solicitar) la elige el usuario y depende del régimen y de los plazos.
6. Revisa las facturas que rompen el patrón antes de dar la cifra por buena: cuota que no es base por tipo, mismo número de factura repetido, proveedor con varias series de numeración, factura de otro periodo incluida en este.
7. Comprueba que cada partida del cuadro sale de una factura concreta. Una diferencia entre la suma de bases y la suma de cuotas de la cuenta de IVA del mayor es un hallazgo que se reporta, no algo que se cuadre a mano.

## Qué entregas

- El cuadro de la liquidación: base y cuota repercutida por tipo, base y cuota soportada deducible por tipo, y el saldo.
- El número de facturas que compone cada grupo, para que se pueda volver a contar.
- La lista de partidas dudosas o no deducibles, con el documento y el motivo.
- Los datos que faltan antes de poder presentar, si falta alguno (`<NIF>`, `<epígrafe>`, cuenta corriente de la devolución).

## Límites

- No presentes ni envíes nada. Esta skill prepara la liquidación; la presentación la hace una persona en el canal oficial.
- No inventes una cuota que falta en un documento: marca la factura como incompleta y pide el original.
- No compensa cuotas de otro periodo o de otra sociedad sin que el usuario lo confirme por escrito.
