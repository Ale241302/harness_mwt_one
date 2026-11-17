---
name: faberloom-wave
description: Prepara el encargo de una ola de FaberLoom Web con su alcance, dependencias, archivos permitidos, casos T y contratos C-FL. Usar al abrir o retomar una ola o cuando haya que decir qué se puede tocar y qué no.
---

# Preparar una ola

Fuentes normativas, en este orden: `../FaberLoom_tarea_2026-11-16/tasks/plan.md` (olas y gates),
`todo.md` (contratos), `file-map.md` (archivos), `evidence-assignments.md` (dueño, nivel, prueba),
`authorizations.md` (puertas humanas).

## Qué devuelve un encargo

Un encargo incompleto se devuelve sin ejecutar. Debe traer:

1. Ola y etapa (`O<n>`, `F0`/`F1`/`E1`-`E5`).
2. Los contratos `C-FL-*` y los checks `O<n>-<nn>` que cubre.
3. Los casos `T<n>` con su parte exacta (`-F1`, `-E1`, `-E2`, `-E4`). Una parte no cierra el caso.
4. Archivos permitidos, copiados literalmente de `file-map.md`. Nada de "y lo que haga falta".
5. Archivos prohibidos del contrato.
6. Dependencias que deben estar `CLOSED` antes de empezar.
7. Pruebas exigidas y su control negativo.
8. Gate humano o autorización que el contrato no puede sustituir.
9. Nivel de evidencia previo (`C1-L`, `C1-E`, `C1-I`, `OBSERVADO_REAL`).
10. Handoff esperado.

## Orden de trabajo

- Verifica primero si la ola está abierta por una dependencia. Si lo está, dilo y no empieces por
  la mitad.
- Lee `AGENTS.md` y el contrato antes de escribir.
- Un archivo nuevo del mapa es una propuesta, no una autorización. Confirma que no existe ya.
- No mezcles motor, UI, memoria y despliegue en la misma rebanada.

## Rechazos que debes aplicar

- Un contrato que pide tocar `packages/core/**` sin `AUTH-CORE`.
- Un contrato que ejecuta tests o builds sin laboratorio aislado.
- Un contrato que promete un efecto S3/S4 sin aprobación registrada.
- Un cierre que se apoya en "ya funcionaba antes".

## Salida

Encargo listo para pegar en `.opencode/README.md` con los diez campos, más la lista de lo que
queda bloqueado y por qué. Si algo no se puede decidir en esta ola, se registra como pendiente
con su gate; no se rellena con una suposición.
