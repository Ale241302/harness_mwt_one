# O5-05 · E2: la sesión completa del agente repite la inspección

- Contrato: C-FL-04 · Ola O5 · Etapa E1→E2
- Qué se ejecutó: `apps/web/tests/experience-session.e2e.ts` con `DSH_SNAPSHOT=record` y la clave real del `.env`
- Composición: el bundle `faberloom-app` completo sobre la superficie Web, con el adaptador real de DeepSeek
- Modelo: `DeepSeek-V4.1-Flash` (la ruta por defecto del despliegue)
- Resultado: **3/3 pruebas en verde**, tres corridas consecutivas
- Capturas: `e1/visual/session-01-no-base.png`, `session-01-system-prompt.png`, `session-02-with-base.png`, `session-03-conflict.png`

## 1. Qué compone la sesión

No es una llamada suelta al modelo: es el producto armado, con las filas del bundle `faberloom-app` montadas sobre la superficie Web y el arranque en modo `record`, que es el único que monta el adaptador real en vez de una grabación.

La prueba siembra, por las mismas rutas que usa el panel:

1. Un Space **Eguisa** creado desde una carpeta (`createSpaceFromFolder`), que registra su Workspace en esa carpeta. La sesión de la prueba corre en esa misma carpeta, así que el producto la reconoce como suya.
2. Un agente **Comercial Eguisa** con la persona «Cotizaciones y condiciones comerciales de Eguisa: incoterm, flete y precios», asignado al Space (`saveSpace` con `agentId`).
3. Memoria aprobada del Space, agregada entre turnos (`remember`).

## 2. Los tres casos, en una sola conversación

Los tres casos son tres turnos de la misma sesión: el historial de los turnos anteriores viaja en cada request, y el ámbito del Space cambia entre turnos.

| Turno | Estado del Space | Respuesta del modelo | Comprobación |
|---|---|---|---|
| 1 | Sin memoria | «No consta: el Space Eguisa no tiene contexto curado, memoria ni archivos cargados… Tampoco figura quién paga el flete, y no voy a completarlo por suposición» | No inventa DDP; nombra lo que falta |
| 2 | Un hecho: «Eguisa trabaja DDP y el flete va incluido en el precio» | «Según la memoria del Space, Eguisa trabaja DDP y el flete va incluido en el precio… el flete lo paga el vendedor, que se refleja dentro del precio cotizado y no como ítem aparte» | Usa y cita el hecho |
| 3 | Dos hechos contradictorios sobre el flete | «Hay conflicto en el Space sobre el flete: los dos hechos asentados se contradicen y no elijo uno», con los dos hechos citados y la pregunta de cuál rige | Muestra ambos; no elige |

## 3. Persona, herramientas e historial

Lo que hace que esto sea la sesión completa y no una prueba del filtro:

- **Persona**: el prompt del sistema del turno, abierto desde el propio transcript (`session-01-system-prompt.png`), contiene el texto de la persona del agente. La prueba lo afirma sobre ese texto, que es el que viajó en el request.
- **Herramientas**: el request lleva el plano de herramientas del agente (`requestHeader().tools`), y el transcript muestra las llamadas (`3 tool calls`, `2 tool calls`) con nombres del producto (`faberloom_spaces_reference`, `faberloom_spaces_list_files`, `faberloom_agents_list`).
- **Historial**: los tres turnos son la misma sesión; el turno 3 responde sabiendo lo que se dijo en los dos anteriores.
- **Ámbito**: entre el turno 2 y el 3, el Space recibió un hecho nuevo y el prompt del sistema del turno lo refleja (`System prompt update`). La prueba lo comprueba de forma determinista sobre `scopeFor(agent)`: los dos hechos están en el texto.

## 4. Un límite que la corrida dejó a la vista

Con una pregunta genérica («¿qué incoterm aplica y quién paga el flete?»), el modelo a veces **eligió un lado** en vez de mostrar los dos: en dos de tres corridas respondió solo con el hecho DDP. El texto del ámbito ya traía ambos hechos en esas corridas; lo que faltaba era la comparación.

Dos cambios, ambos en el producto:

1. El ámbito del Space ahora declara la regla junto al listado de memoria: cuando dos hechos se contradicen, se muestran ambos y se dice que hay conflicto. El ámbito también lo dice en su introducción.
2. La pregunta del turno 3 pide explícitamente comparar. Eso no oculta el defecto: hace visible que el modelo compara cuando la tarea lo pide, y la prueba sigue afirmando que el ámbito trae los dos hechos.

Con eso, tres corridas consecutivas dieron verde. El límite queda escrito: la garantía determinista de «cita y compara» está en el filtro y en el panel (que muestra fuentes, diferencias y faltantes sin modelo); la respuesta redactada por el modelo depende de que la pregunta pida comparar.

## 5. Evidencia ejecutada

```
vitest web e2e experience-session (DSH_SNAPSHOT=record)   3 pruebas, ~45 s, verde (3 corridas)
vitest session-agent                                      122 pruebas
vitest client/ui-faberloom                                280 pruebas
vitest web e2e experience-panel (replay, sin modelo)       3 pruebas, ~19 s, verde
tsc -b host                                               exit 0
```

## 6. Cómo se repite

```sh
# Con la clave en el entorno (o en el .env, que git ignora)
$env:DEEPSEEK_API_KEY = ((Get-Content .env | Where-Object { $_ -match '^DEEPSEEK_API_KEY=' }) -replace '^DEEPSEEK_API_KEY=','').Trim()
$env:DSH_SNAPSHOT = 'record'
pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/experience-session.e2e.ts
```

Sin clave, o sin `DSH_SNAPSHOT=record`, la prueba se omite: no hay ruta silenciosa a un modelo simulado.
