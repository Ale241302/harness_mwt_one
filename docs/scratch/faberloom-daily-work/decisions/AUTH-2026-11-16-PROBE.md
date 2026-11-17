# AUTH-2026-11-16-PROBE · Sonda real contra Hostinger

```yaml
authorization_id: AUTH-2026-11-16-PROBE
tipo: permiso de sonda acotada
solicitante: Alejandro (CEO)
aprobador_humano: Alejandro (CEO)
fecha_hora: 2026-11-16, sesión de trabajo
estado: OTORGADA_POR_INSTRUCCION_EXPRESA
declaracion: "Sonda Hostinger real"; sigue sin cuenta de prueba ni token de API
evidencia: respuesta del CEO en la conversación de trabajo del 2026-11-16
alcance: llamadas acotadas de lectura y una de envío a cuenta de prueba
servicios_cuentas: cuenta de prueba de Hostinger (no identificada todavía)
datos_permitidos: metadatos de buzón, carpetas, mensajes de prueba propios
datos_excluidos: buzones reales del CEO, contenido de terceros
red_destinos: api.mail.hostinger.com; sin otros destinos
ventana_vigencia: una ventana, a declarar antes de la primera llamada
volumen_costo: no declarado todavía; obligatorio antes de la primera llamada
recuperacion: cuenta de prueba desechable
custodia: pendiente
```

## Estado real

**El permiso existe; la sonda no.** Faltan la cuenta de prueba, la clave y los topes de volumen y costo que el permiso exige declarar **antes** de la primera llamada.

Regla que se mantiene: el `204` de `sendEmail` no se registra como entrega. Sin conciliación, la sonda de envío no prueba nada útil.

## Consecuencia

`O1-02` sigue `BLOCKED`, y con ella el caso ejecutado de `O1-01`. La comparación de motores queda en C1-L/C2 y una recomendación condicional.
