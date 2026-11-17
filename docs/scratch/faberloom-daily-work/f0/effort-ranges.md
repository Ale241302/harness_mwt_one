# Rangos de esfuerzo y topes para PC1

Contrato: C-FL-01 / O1-04 / FM-O1-04 Autor de la estimación: Alejandro, sobre el inventario y el baseline de hoy. Naturaleza: **rango con incertidumbre**, no un compromiso de fecha. El tope lo aprueba el CEO (decisión 11 del acta: si excede, se reduce alcance, no calidad ni reglas de aprobación).

## 1. Supuestos

- Una persona implementando, con agentes asistidos, pruebas y evidencia por contrato.
- Jornada efectiva de 4,5 días por semana. Se convierte dividiendo por 4,5.
- Cada contrato incluye su prueba, su control negativo y su expediente. Sin eso no hay rango, hay deseo.
- No incluye esperas por autorizaciones, accesos, revisiones del CEO ni ventanas de despliegue.
- No incluye tiempo de la revisión independiente, que ocurre en otra sesión y no se solapa.

## 2. Base independiente del motor (E1 + E2)

| Bloque | Contratos | Jornadas | Semanas |
|---|---:|---:|---:|
| O3 autoridad, identidad y transición | 6 | 9-16 | 2-3,5 |
| O4 dos buzones, navegación, visor, adjuntos | 5 | 8-14 | 1,8-3 |
| O5 asignación, iteración, memoria, operación, PC3 | 10 | 15-26 | 3,3-5,8 |
| O6 snapshot, aprobación, transporte, conciliación | 7 | 12-20 | 2,7-4,4 |
| O7 correo diario, actualización final, PC4 | 5 | 9-15 | 2-3,3 |
| **Subtotal** | **33** | **53-91** | **12-20** |

Este bloque se paga con cualquier alternativa. Cambiar de motor no lo reduce, porque es autoridad, identidad, memoria, aprobación y conciliación de FaberLoom, no del motor.

## 3. Delta por alternativa

| Alternativa | Qué añade | Jornadas | Semanas |
|---|---|---:|---:|
| **DaMail** | Adaptador + mediador de credencial + instalación + backup coordinado + operación del producto | 8-13 | 1,8-3 |
| **Hostinger** | Adaptador + mediador + construcción propia de borradores si el OpenAPI no los tiene | 9-16 | 2-3,5 |
| **Extensión propia** | Cerrar identidad y autoridad, poner el baseline en verde, snapshot e intentos | 8-15 | 1,8-3,3 |

Nota incómoda: el delta de la extensión propia **no es cero** y no es el más barato, porque arrastra 212-213 fallos medidos. Tampoco es el más caro. La diferencia entre alternativas es menor que el bloque común: elegir mal el motor no duplica el proyecto, pero elegir por apariencia sí retrasa E1.

## 4. Resto del alcance

| Bloque | Contratos | Jornadas | Semanas | Cuándo |
|---|---:|---:|---:|---|
| O2 F1 looks y PC2 | 6 | 10-18 | 2,2-4 | En paralelo con O0/O1 |
| O8A expedientes | 3 | 4-7 | 0,9-1,6 | Tras PC4 |
| O8B reglas S3 | 4 | 5-9 | 1,1-2 | Tras PC4 |
| O8C curación E4 | 3 | 4-7 | 0,9-1,6 | Tras PC3 |
| O9 semana + O10 mes | 4 | 6-10 | 1,3-2,2 | Con datos reales |
| O11 plan de terceros | 4 | 6-12 | 1,3-2,7 | Preparación temprana |

## 5. Total y qué significa

| Escenario | Jornadas | Semanas |
|---|---:|---:|
| Mínimo (todo entra por la puerta angosta, sin sorpresas) | 88 | ~20 |
| Máximo (actualización costosa, identidad más profunda, terceros completo) | 155 | ~34 |

El rango no es un presupuesto: es la evidencia de que **no se puede prometer una fecha sin recortar alcance**. Si el CEO fija un tope menor, la decisión 11 obliga a elegir qué ola sale del piloto, no a bajar pruebas ni a aprobar sin evidencia.

## 6. Incertidumbres que mueven el rango

1. **Identidad y propiedad** (O3-04): 64 fallos de `NO_ACCESS` pueden ser un cambio de modelo o una regresión localizada. Hasta diagnosticarlo, el rango de O3 es ancho.
2. **Actualización a un SHA objetivo** (O7-04): 3.695 archivos de divergencia y 19 de núcleo tocado. Puede ser mecánico o puede exigir `AUTH-CORE` y migración.
3. **F1**: la superficie visual acumula 95 archivos modificados en `client`. La adaptación puede ser de tokens o de estructura.
4. **Conciliación** (O6-04): depende de lo que el motor exponga. DaMail tiene cola; Hostinger devuelve `204`; la extensión propia no tiene nada.
5. **Operación**: añadir DaMail a un host con 52 contenedores al inventariar (56 al cerrar) y 5,6 de carga es riesgo real de capacidad, no una línea de plan.

## 7. Topes que PC1 debe fijar

- Jornadas autorizadas y qué se recorta si se agotan.
- Fecha de la semana real (T24), que depende de PC4 y del despliegue.
- Umbral del mes: no se fija aquí, se fija en PC6 con datos reales.
- Qué alternativa queda descartada con evidencia y cuál queda como plan B documentado.

Sin estos cuatro números, PC1 no está firmada aunque el CEO tenga preferencia.
