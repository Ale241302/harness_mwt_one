---
name: faberloom-mail-lab
description: Prepara y ejecuta el laboratorio de correo de FaberLoom con dos cuentas de prueba, servidores falsos y cero credenciales reales. Usar al probar recepción, envío, aprobación o conciliación sin tocar buzones reales.
---

# Laboratorio de correo

## Regla cero

Ninguna prueba de este laboratorio usa un buzón operativo. Ni los dos buzones del CEO, ni el
servidor de producción. Un destino operativo debe ser rechazado por el propio ejecutor, y ese
rechazo es una prueba, no una precaución.

## Qué necesita el laboratorio

1. Dos cuentas de prueba con nombres distintos, para detectar confusión de identidad.
2. Servidor de entrada falso (GreenMail o equivalente) y salida falsa.
3. Red acotada: solo loopback. Sin egreso a internet.
4. Rechazo explícito de destinos operativos por lista y por resolución de dominio.
5. Discos y colas propios. Nada compartido con producción.
6. Un guion de arranque y otro de limpieza que borre volúmenes y verifique que no quedan colas.

Instalar o ejecutar cualquiera de esos servicios exige `AUTH-LAB-SERVICE` registrada. Sin ella,
el laboratorio se diseña y no se levanta.

## Casos mínimos

- Recepción en dos cuentas con cursores independientes y caída de una sola.
- Identidad: mismo asunto y remitente en buzones distintos no se confunden.
- Adjuntos: PDF textual, escaneado, planilla, corrupto, grande y no soportado.
- Búsqueda con límites visibles y backlog de más de una página.
- Aprobación exacta y cambio de un byte después de aprobar.
- Envío simulado, timeout, respuesta perdida y conciliación.
- Restauración sin reenvío.

## Rótulos

Cada resultado sintético se marca como simulado en el informe. Un fixture nunca cuenta como
ejecución productiva. Una captura sin comportamiento no prueba nada.

## Prohibiciones

- No se copian recursos ni interfaces de DaMail, Spark, Gmail o Roundcube.
- No se reutiliza el Compose de producción.
- No se conecta el laboratorio a la base, la memoria o la cola reales.
- No se escribe en MWT.ONE desde el laboratorio.
