---
name: cierre-mensual
description: "Úsala cuando el usuario quiera cerrar el mes contable, revisar si un cierre está completo o preparar la documentación de cierre de un periodo. Ejemplo: 'cierra <periodo>' o 'qué falta para cerrar el mes'."
whenToUse: "Termina un periodo contable y hay que dejar el balance y la cuenta de resultados en estado de cierre."
---

# Cierre mensual

Deja el periodo cerrado con la lista de comprobaciones hecha, cada pendiente con nombre y dueño, y el resultado del mes verificado.

## Antes de empezar

- Fija el periodo y su fecha de corte: `<periodo>`, `<fecha de corte>`.
- Confirma el alcance: qué sociedades, qué cuentas bancarias y qué almacenes entran en este cierre.
- Pide la lista de comprobaciones del equipo. Si el equipo no tiene una escrita, usa la de esta skill y dilo.

## Procedimiento

1. Corta el periodo: comprueba que no entra ningún documento con fecha posterior a la fecha de corte, y que las entradas posteriores quedan en el periodo siguiente.
2. Concilia todas las cuentas bancarias del alcance con la skill `conciliacion-bancaria` y anota el estado de cada una.
3. Cuadra los saldos de las cuentas de deudores y acreedores con sus listados auxiliares, uno por uno. Un descuadre aquí contamina el balance entero.
4. Cuadra el IVA: compara la cuenta de IVA del mayor con la liquidación del periodo (skill `iva-declaraciones`) y anota la diferencia si la hay.
5. Revisa existencias y periodificaciones: inventario final declarado, gastos e ingresos anticipados, y consumos pendientes de registrar.
6. Registra las amortizaciones del periodo y comprueba que la dotación coincide con la del cuadro de amortización.
7. Revisa las cuentas que no deberían tener saldo a estas alturas: cuentas de tránsito, cuentas 555 y 556, cuentas de anticipos ya aplicados. Cada saldo que quede se explica o se traspasa.
8. Cierra con la comprobación de resultado: compara el resultado del mes con el del mes anterior y explica cualquier variación por encima del umbral que acuerde el equipo; una variación sin explicación no se cierra.
9. Deja el acta del cierre: qué se ha comprobado, qué ha quedado pendiente, quién lo tiene y cuándo se espera.

## Qué entregas

- El estado de las comprobaciones: hecha, con diferencia o pendiente, una por línea.
- La lista de pendientes con importe, dueño y efecto esperado sobre el resultado si no se resuelve.
- El resultado del periodo con la comparación contra el periodo anterior y la explicación de la variación.
- El acta en texto, lista para pegar en el banco de trabajo como tarea de revisión.

## Límites

- No cierres el periodo con una comprobación pendiente salvo que el usuario lo autorice; en ese caso deja escrito qué se cierra y qué queda abierto.
- No ajustes con un asiento genérico de cuadre. Cada ajuste lleva su justificante y su explicación.
- No comuniques el resultado a nadie fuera del equipo: esta skill produce el acta, no la publica.
