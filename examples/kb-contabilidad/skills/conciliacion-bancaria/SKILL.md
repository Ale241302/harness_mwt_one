---
name: conciliacion-bancaria
description: "Úsala cuando el usuario quiera conciliar un extracto bancario contra la contabilidad, localizar partidas no identificadas o declarar cerrada la conciliación de una cuenta. Ejemplo: 'concilia el banco de marzo' o 'cuadra la cuenta 572'."
whenToUse: "Hay un extracto bancario de un periodo y el saldo del libro mayor de la misma cuenta y periodo no coincide."
---

# Conciliación bancaria

Cuadra el saldo del extracto de una cuenta bancaria con el saldo del libro mayor del mismo periodo, y deja por escrito la causa de cada diferencia que quede.

## Antes de empezar

- Identifica cuenta contable (por ejemplo `572`), banco, moneda y periodo: `<cuenta>`, `<periodo>`, `<moneda>`.
- Consigue las dos fuentes completas del periodo: el extracto bancario tal como lo emitió el banco, y los movimientos del libro mayor de esa cuenta.
- Comprueba que el saldo inicial del extracto coincide con el saldo inicial del libro. Si no coincide, para y dilo: arrastrar una diferencia anterior convierte la conciliación en una suma sin sentido.
- Nunca ajustes un movimiento para forzar el cuadre. Un ajuste sin justificante es un error, no una solución.

## Procedimiento

1. Ordena los dos lados por fecha y, dentro de la fecha, por importe. Cuenta los movimientos de cada lado y anota los recuentos antes de comparar.
2. Empareja movimiento contra movimiento cuando coincidan fecha, importe y referencia. Marca cada pareja con la referencia del extracto; deja sin marcar lo que no empareje.
3. Agrupa las diferencias en las cuatro causas que siempre aparecen: cheques y transferencias emitidos y no cobrados todavía, cargos del banco que aún no están en el libro (comisiones, intereses, cuotas), abonos del banco que aún no están en el libro, y errores de importe o de cuenta en uno de los dos lados.
4. Para cada diferencia sin emparejar, busca la referencia en el otro lado por importe exacto antes de darla por no identificada: muchas diferencias son un movimiento contabilizado con otra fecha de la que el banco aplicó.
5. Clasifica cada diferencia que siga sin pareja y escribe, por diferencia, la fecha, el importe, la referencia de banco, la causa y lo que falta para cerrarla.
6. Calcula el saldo conciliado de las dos formas y compara: saldo del libro más los abonos del banco no contabilizados menos los cargos del banco no contabilizados, frente a saldo del extracto menos los cobros pendientes de abono. Los dos números tienen que ser iguales.
7. Si los dos saldos conciliados coinciden, declara la conciliación cerrada y deja el detalle de las diferencias clasificadas. Si no coinciden, la diferencia entre esos dos números es un error de emparejamiento: vuelve al paso 4 con esa cifra exacta, no con el total.

## Qué entregas

- La línea de cabecera: cuenta, banco, periodo, saldo del libro, saldo del extracto y los dos saldos conciliados.
- La tabla de diferencias clasificadas: fecha, importe, referencia, causa y qué falta.
- El recuento de movimientos emparejados por lado, para que se pueda volver a comprobar.
- El asiento que propones para los cargos y abonos del banco que sí corresponden al periodo, si el usuario pide contabilizarlos.

## Límites

- No contabilices los cargos del banco ni los intereses: propone el asiento y deja que una persona lo apruebe.
- No marques como cobrado un movimiento que el banco solo ha anunciado. La fecha de valor del banco no es la fecha de abono.
- Si el extracto cubre una cuenta que el libro lleva por moneda distinta, para y pide el tipo de cambio aplicado y su justificante.
