# Diagnóstico de los fallos de la Mesa

Contrato: C-FL-07 · O0-05 (baseline) Fecha: 2026-11-16 · **Corregido el 2026-11-17**

## Aviso: este diagnóstico era falso

El 2026-11-16 este documento concluyó que la Mesa tenía un modelo de propiedad roto: 212 pruebas fallaban con `NOT_FOUND` y `NO_ACCESS`, y parecía que la identidad canónica estaba mal construida.

**No era así.** El 2026-11-17 se encontró la causa real:

> La máquina de trabajo corre el gateway desplegado, que define `FABERLOOM_BOARD_REMOTE=on` junto con URL, tenant y token. La suite unitaria heredaba esa variable, el board entraba en modo remoto y cada operación consultaba una API central que no estaba levantada. De ahí los `NOT_FOUND` y `NO_ACCESS`.

Evidencia:

| Corrida | Resultado |
|---|---|
| Con el entorno heredado | 1.485 pasan, 212 fallan |
| Con la variable limpia | 330 de 330 en `packages/faberloom/board` |
| Después del aislamiento, con la variable puesta a propósito | **1.712–1.713 pasan, 0–1 falla según la red, 1 omitida** |

El aislamiento vive en `scripts/test-invariants.ts`: la lane unitaria borra las cinco variables de activación del despliegue antes de cualquier prueba.

## Por qué el diagnóstico anterior parecía razonable

1. Los errores llegaban desde `requireItem` y desde los guards de propiedad, con la forma exacta de un modelo de identidad roto.
2. El paquete es nuevo en el fork (40 archivos, 20.358 líneas), así que no había upstream que bisecar.
3. La suite pasaba de forma intermitente: al apagar el gateway o al correr desde otra terminal, el número cambiaba. Se interpretó como prueba inestable, no como dependencia del entorno.

Ese tercer punto era la pista: una suite que cambia según la terminal no es una suite inestable, es una suite que lee algo que no debería.

## El único fallo real de la lista

`checks-mwt` aprobaba con `{ id }`, que el board clasifica como `agent`. PROP-09 exige una persona y el guard responde `HUMAN_ACTION_REQUIRED`. La prueba estaba desactualizada; se corrigió a `{ id, kind: 'human' }`. El guard no se tocó.

## Lo que esto cambia en el plan

- **E1 no arranca roto.** El producto pasa sus pruebas; lo que faltaba era una condición de prueba válida.
- **`O3-04` no es una refactorización de identidad de la Mesa.** Lo que sí faltaba de identidad era el correo: `UIDVALIDITY` y la cuenta en la clave de ocurrencia, hecho y documentado en `e1/identity.md`.
- **La línea base de O0-05 se corrige**: B6 pasa. El baseline anterior no se borra: se anota como medición contaminada por el entorno.

## Lección que se queda

Un fallo que depende de la terminal del operador no es un fallo del producto. Antes de atribuir 212 errores al código, se compara la corrida con el entorno limpio. Es la misma regla que se aplicó al laboratorio: primero se aísla, después se diagnostica.
