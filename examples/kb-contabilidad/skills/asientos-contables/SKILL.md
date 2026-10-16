---
name: asientos-contables
description: "Úsala cuando el usuario quiera registrar, proponer o revisar un asiento contable a partir de una factura, un recibo, una nómina o un apunte de banco. Ejemplo: 'contabiliza esta factura' o 'prepara el asiento de la nómina de <periodo>'."
whenToUse: "Existe un documento o un hecho económico con importe, fecha y contraparte, y hace falta su registro por partida doble."
---

# Asientos contables

Convierte un documento en un asiento por partida doble: cuentas, importes, fecha, concepto y justificante, con el cuadre comprobado.

## Antes de empezar

- Reúne el documento completo: emisor, receptor, `<NIF>`, fecha de emisión, base, cuota, total y forma de pago. Si falta la cuota o la base, calcula la que falte a partir de la otra y del tipo, y dilo.
- Confirma el plan de cuentas en uso y el criterio de la casa para las cuentas que se repiten (clientes, proveedores, IVA soportado y repercutido, gasto por naturaleza).
- Comprueba que la operación no está ya contabilizada: busca por número de documento, proveedor y fecha antes de proponer nada.

## Procedimiento

1. Escribe el hecho en una frase con sus tres datos ciertos: fecha del hecho, contraparte e importe total.
2. Elige las cuentas de la operación y decide la cuenta de gasto o ingreso por naturaleza del bien o servicio, no por el nombre del proveedor.
3. Separa base y cuota. Con tipos distintos aplicados al mismo documento, separa una línea por tipo; no uses un tipo medio.
4. Monta el asiento con una línea por cuenta y firma: a cada debe le corresponde un haber del mismo importe total.
5. Comprueba el cuadre sumando debe y haber, y comprueba que el total del asiento es el total del documento. Los dos números tienen que coincidir al céntimo.
6. Comprueba el IVA: la cuota registrada tiene que ser igual a la cuota del documento, y el tipo aplicado tiene que ser uno de los admitidos para esa operación.
7. Comprueba la fecha: usa la fecha del hecho. Para una factura recibida en otro periodo, dilo y propone el criterio del equipo en lugar de elegir en silencio.
8. Deja el asiento con su justificante referenciado: número de documento, emisor y fecha. Un asiento sin justificante no se registra.

## Qué entregas

- El asiento en líneas `cuenta | concepto | debe | haber`, con los totales de las dos columnas.
- La referencia del justificante y el importe del documento original, para poder cotejarlos.
- La lista de datos que has tenido que suponer, si has tenido que suponer alguno, y por qué.
- Un aviso explícito cuando el asiento afecta a un periodo ya declarado.

## Límites

- No registres un asiento con el cuadre roto ni con una cuenta que no exista en el plan: devuélvelo al usuario con la diferencia exacta.
- No combines dos documentos en un asiento salvo que el criterio del equipo lo pida; dilo y sepáralos si hay duda.
- No decidas por tu cuenta el tratamiento de una operación dudosa (permuta, arrendamiento financiero, operación intragrupo): propon las dos lecturas y pide la decisión.
