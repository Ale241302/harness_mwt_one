# Punto de control · olas O3 y O4

- Contrato: C-FL-04 · Etapas E1 · PC1/PC2
- Revisión medida: `0b01ca39365ba04fe89858bcac56e3523896ee4d` + cambios sin commitear
- Estado: **READY_FOR_CEO**
- Fecha: 2026-11-17

## 1. Qué queda cerrado

| Ítem | Evidencia |
|---|---|
| O3-01 censo de vías | `authority-census.md` |
| O3-02A/B/C autoridad, montaje y vías cerradas | `authority-fail-closed.md`, `authority-mounted.md`, `write-denied.md` |
| O3-03 autoenvío y avisos internos | `no-auto-send.md` |
| O3-04 identidad de correo | `identity.md` |
| O3-05 transición sin reactivar | `transition.md` |
| O3-06 custodia, destinos y copias | `custody.md` |
| Gate O3: T10-E1 y seguridad | `t10-surfaces.md`, `gate-security-review.md` |
| O4-01 dos cuentas | `accounts.md` |
| O4-02 backlog, búsqueda e identidad | `search-limits.md` |
| O4-03 bandeja y lectura al lado | `panel-layout.md` |
| O4-04 visor aislado | `hostile-viewer.md` |
| O4-05 adjuntos con límites | `attachments.md` |

## 2. Defectos que la ola encontró y cerró

| Defecto | Dónde estaba | Cómo se cerró |
|---|---|---|
| La guarda de versión no corría en el panel | `sendDraft` opcional y el remoto no lo pasaba | Versión obligatoria en toda la cadena; prueba del caso ausente |
| La política de destinos era un archivo | `egress-policy.json` sin lector | Comprobación en `imap`, `smtp`, `sendMail` y `probe` |
| El receptor escribía flags pese a su README | `markSeen`/`moveToTrash` ejecutaban `STORE`/`COPY` | Rechazo `WRITE_NOT_APPROVED`; servidor byte-idéntico |
| `notices` fuera del typecheck del host | Falta en `tsconfig.host.json` | Referencia, catálogo y página regenerados |
| El párrafo partido llevaba rojo desde F0 | 57 documentos de scratch | Unificado sin cambiar contenido; gate verde |
| Deuda de tema desde O2 | Bordes de 1 px, radios sin `corner-shape`, scrollbar sin rebind | Corregida; escaneos de tema verdes |

## 3. Evidencia de la última corrida

```
packages/faberloom        1.752: 1.751 pasan, 1 omitida
client/ui-faberloom + ui-theme   392 de 393 (fallo previo en ui-theme/apply)
tsc -b host / client      exit 0
doc budgets / wrap / links / closure / plan / catálogo / i18n   PASS
```

## 4. Abierto, con dueño

| Pendiente | Dueño |
|---|---|
| Rotar credenciales expuestas y retirar copias 3-5 | CEO |
| Objeto de aprobación del mensaje exacto; habilitar el adaptador `mail.send` | E2 |
| Subagente con modelo real y canario en prompt | E2 |
| T7 en navegador real (red y eventos) y aspecto a dos anchos y dos looks | PC3 |
| Aviso de truncamiento del Markdown de adjuntos | O6 |
| Barrida de `ui-theme/apply` y `ui-reference/acceptance-real-folder` | ventana de PR |

Los dos últimos no los tocó esta ola: el primero falla aislado y el segundo espera una carpeta real que no está en este equipo.

## 5. Estado del repositorio

Todo el trabajo está **sin commitear** sobre `fix/guarda-operadores`: 64 archivos modificados y 99 entradas entre modificadas y nuevas. Lo nuevo incluye el paquete `notices`, el prototipo F1, `deploy/faberloom-lab` y los documentos de scratch. El `.env` del laboratorio está ignorado por `.gitignore` y solo lleva valores sintéticos; el journal del espejo se revirtió porque su única diferencia era un puerto efímero.
