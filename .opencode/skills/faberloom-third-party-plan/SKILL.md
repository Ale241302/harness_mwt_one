---
name: faberloom-third-party-plan
description: Construye la matriz N9 y el plan previo a que FaberLoom lo use otra persona o empresa, sin habilitar terceros. Usar al preparar E5, al responder si el sistema está "listo para otros" o al revisar multiusuario.
---

# Plan para terceros, no habilitación

Este plan produce un documento y un verificador. Nunca emite `TERCEROS_LISTOS`.

## Las preguntas de N9

| Tema | Qué debe quedar respondido |
|---|---|
| Modo soportado | Instalación única del dueño, o multiempresa. Si no se ofrece, `NOT_APPLICABLE_APPROVED` con el disparador |
| Aislamiento | Cómo se separan usuarios, empresas, memorias y buzones. Qué se probó y qué no |
| Credenciales | Quién las custodia, cómo se rotan, cuánto duran, qué pasa ante incidente |
| Retención | Qué se guarda, dónde, cuánto tiempo, cómo se elimina y quién lo verifica |
| Sincronización | Si se ofrece, con qué pruebas futuras; si no, decisión explícita |
| Responsabilidad | Quién responde por un envío, una escritura y una fuga |
| Soporte | Qué se promete y qué no |

## Reglas

- La matriz se ejecuta antes de publicar. Una intención no es una matriz.
- Ninguna credencial compartida, ninguna llave de un tercero en el repositorio, ningún buzón
  ajeno.
- Lo que no se ofrece se declara fuera de alcance con condición y disparador, no se deja como
  pendiente implícito.
- El material publicado no contiene secretos, correo real ni metadatos operativos.
- Un "sí" en la matriz exige prueba en el modo declarado, sobre una revisión identificada.

## Salida

`docs/scratch/faberloom-daily-work/before-third-parties.md` con la matriz, las decisiones
`NOT_APPLICABLE_APPROVED`, los riesgos abiertos y la lista de lo que falta antes de publicar.
Más `scripts/faberloom-daily/third-parties.json` y su verificador, que falla si aparece una
promesa sin prueba.

## Prohibición

Un agente no aprueba publicación ni uso por terceros. Eso es `AUTH-PUBLISH-THIRD-PARTIES`, y no
está otorgada por este plan.
