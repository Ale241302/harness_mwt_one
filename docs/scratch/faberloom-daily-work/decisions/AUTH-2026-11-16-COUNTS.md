# AUTH-2026-11-16-COUNTS · Conteos, roles y dominios

```yaml
authorization_id: AUTH-2026-11-16-COUNTS
tipo: lectura de metadatos agregados de usuarios y correo
solicitante: Alejandro (CEO)
aprobador_humano: Alejandro (CEO)
fecha_hora: 2026-11-16, sesión de trabajo
estado: OTORGADA_POR_INSTRUCCION_EXPRESA
firma: instrucción expresa del CEO en la sesión; sin firma manuscrita
declaracion: "Autorizar conteos y roles de usuarios y de mailcow (cierra los 4 desconocidos de O0-03)"
alcance: cantidad de registros, nombres de campos, histograma de roles y nombres de dominio
servicios_cuentas: gateway del harness; contenedor de dovecot de mailcow
datos_permitidos: conteos, nombres de campo, roles agregados, nombres de dominio
datos_excluidos: correos, nombres de personas, identificadores, tokens, contenidos
red_destinos: SSH de solo lectura al servidor del CEO
ventana_vigencia: una consulta de metadatos
volumen_costo: ninguno
recuperacion: no aplica (solo lectura)
custodia: server-inventory.md §12
```

## Resultado

- 11 usuarios: 3 `admin`, 1 `manager`, 6 `client_b2b`, 1 `marluvas`.
- Los registros guardan `consolaAccess` y `consolaRefresh` junto al usuario: tokens de la Consola dentro del mismo archivo que se copia cuatro veces.
- Índice de tokens MCP: 3 entradas con campos `dir` y `email`.
- mailcow sirve diez dominios; **no** sirve `muitowork.com`, que es de Hostinger.
- No hay colas durables en `/data`: el despachador vive en memoria y el trabajo en curso no sobrevive a un reinicio como cola.

## Prohibición que se mantuvo

No se imprimió ni registró un solo correo, nombre de persona o token. Solo agregados.
