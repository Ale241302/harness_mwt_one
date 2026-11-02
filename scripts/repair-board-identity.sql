-- Reparación de identidad de la Mesa (seguimiento de ADR-007).
--
-- Corrige las observaciones que el backfill dejó reportadas: dos claves que no
-- coincidían con la referencia declarada por el ítem y un duplicado vivo de
-- `PF 2520-2026` (dos avisos del mismo expediente). El duplicado más antiguo se
-- marca `SUSTITUIDO`; no se borra ninguna fila ni ningún evento.
--
-- Es una corrida única sobre el tenant de la Mesa. Cada `UPDATE` lleva la clave
-- anterior como guarda y cada evento se inserta solo si no existe, así que
-- repetir el archivo no duplica nada. Antes de aplicarlo, exporta las filas:
--
--   psql ... -At -c "select json_agg(t) from (select id, state, business_key,
--     row_version, payload from mesa_items where tenant_id = '5525986c-…' and
--     (id::text like '85ed32e0%' or id::text like '1967df17%'
--      or id::text like 'c82a12d1%' or id::text like '81264287%'
--      or id::text like '528c898d%')) t;" > mesa-identity-repair.json
--
-- Evidencia de la corrida real: `/opt/mwt/logs/mesa-identity-repair-20261102T182746Z.json`
-- (13 425 bytes). Resultado: 0 claves vivas duplicadas, 460 ítems migrados
-- intactos, `payload.businessKey` sincronizado en las cuatro filas.

BEGIN;

-- 1. PF 2488-2026: la clave era un hash de otra tupla; se recalcula.
UPDATE mesa_items
   SET business_key = 'deb2266c2f9c5762ff13790c6a14a848cbb97cb3f4bf0600eb4d20232148d745',
       row_version = row_version + 1,
       updated_at = now(),
       payload = jsonb_set(payload, '{businessKey}', to_jsonb('deb2266c2f9c5762ff13790c6a14a848cbb97cb3f4bf0600eb4d20232148d745'::text))
 WHERE tenant_id = '5525986c-3b09-4d13-bf8f-43ccaa2deae3'
   AND id::text LIKE '85ed32e0%'
   AND business_key = 'c851cb74cf292c25ccf1564f3131c92a027b765ee57ce32aaa38cada29984fdf';
INSERT INTO mesa_events (tenant_id, item_id, seq, actor, command, from_state, to_state, payload, at)
SELECT i.tenant_id, i.id,
       COALESCE((SELECT MAX(seq) FROM mesa_events e WHERE e.tenant_id = i.tenant_id AND e.item_id = i.id), 0) + 1,
       'ops@mwt.one', 'rekey.repair', i.state, i.state,
       jsonb_build_object('from', 'c851cb74cf292c25ccf1564f3131c92a027b765ee57ce32aaa38cada29984fdf',
                          'to', 'deb2266c2f9c5762ff13790c6a14a848cbb97cb3f4bf0600eb4d20232148d745',
                          'sourceRef', 'PF 2488-2026', 'policy', 'ADR-007', 'reason', 'identity-mismatch'), now()
  FROM mesa_items i
 WHERE i.tenant_id = '5525986c-3b09-4d13-bf8f-43ccaa2deae3'
   AND i.id::text LIKE '85ed32e0%'
   AND NOT EXISTS (SELECT 1 FROM mesa_events e2 WHERE e2.tenant_id = i.tenant_id AND e2.item_id = i.id
                     AND e2.command = 'rekey.repair'
                     AND e2.payload->>'to' = 'deb2266c2f9c5762ff13790c6a14a848cbb97cb3f4bf0600eb4d20232148d745');

-- 2. PRUEBA-CLASIFICADOR-2026-10-29: ítem de prueba descartado; su clave se
--    alinea con la referencia que declara.
UPDATE mesa_items
   SET business_key = '3eda455886f489c05053ba1288b31204d92bebb03e1077c5bf6f340c9e27b26e',
       row_version = row_version + 1,
       updated_at = now(),
       payload = jsonb_set(payload, '{businessKey}', to_jsonb('3eda455886f489c05053ba1288b31204d92bebb03e1077c5bf6f340c9e27b26e'::text))
 WHERE tenant_id = '5525986c-3b09-4d13-bf8f-43ccaa2deae3'
   AND id::text LIKE '1967df17%'
   AND business_key = 'a9ca771bf579ffcba9b170621105787809752ed135f7c86b533c9330d6f9d274';
INSERT INTO mesa_events (tenant_id, item_id, seq, actor, command, from_state, to_state, payload, at)
SELECT i.tenant_id, i.id,
       COALESCE((SELECT MAX(seq) FROM mesa_events e WHERE e.tenant_id = i.tenant_id AND e.item_id = i.id), 0) + 1,
       'ops@mwt.one', 'rekey.repair', i.state, i.state,
       jsonb_build_object('from', 'a9ca771bf579ffcba9b170621105787809752ed135f7c86b533c9330d6f9d274',
                          'to', '3eda455886f489c05053ba1288b31204d92bebb03e1077c5bf6f340c9e27b26e',
                          'sourceRef', 'PRUEBA-CLASIFICADOR-2026-10-29', 'policy', 'ADR-007', 'reason', 'identity-mismatch'), now()
  FROM mesa_items i
 WHERE i.tenant_id = '5525986c-3b09-4d13-bf8f-43ccaa2deae3'
   AND i.id::text LIKE '1967df17%'
   AND NOT EXISTS (SELECT 1 FROM mesa_events e2 WHERE e2.tenant_id = i.tenant_id AND e2.item_id = i.id
                     AND e2.command = 'rekey.repair'
                     AND e2.payload->>'to' = '3eda455886f489c05053ba1288b31204d92bebb03e1077c5bf6f340c9e27b26e');

-- 3. PF 2520-2026: dos avisos vivos del mismo expediente. El más antiguo
--    (`81264287`) pasa a `SUSTITUIDO`; el más reciente (`528c898d`) queda vivo
--    con la clave canónica y registra a quién sustituye.
UPDATE mesa_items
   SET business_key = '9f70a1f282dc5a50a47d7164049f9c7cec488abdc5227b1457f82dbab8da081a',
       state = 'SUSTITUIDO',
       row_version = row_version + 1,
       updated_at = now(),
       payload = jsonb_set(jsonb_set(jsonb_set(payload, '{businessKey}', to_jsonb('9f70a1f282dc5a50a47d7164049f9c7cec488abdc5227b1457f82dbab8da081a'::text)), '{state}', to_jsonb('SUSTITUIDO'::text)), '{status}', to_jsonb('completed'::text))
 WHERE tenant_id = '5525986c-3b09-4d13-bf8f-43ccaa2deae3'
   AND id::text LIKE '81264287%'
   AND business_key = 'PF 2520-2026';
INSERT INTO mesa_events (tenant_id, item_id, seq, actor, command, from_state, to_state, payload, at)
SELECT i.tenant_id, i.id,
       COALESCE((SELECT MAX(seq) FROM mesa_events e WHERE e.tenant_id = i.tenant_id AND e.item_id = i.id), 0) + 1,
       'ops@mwt.one', 'superseded', 'PENDIENTE_CRITERIO', 'SUSTITUIDO',
       jsonb_build_object('reason', 'duplicate-source',
                          'supersededBy', (SELECT id::text FROM mesa_items WHERE tenant_id = i.tenant_id AND id::text LIKE '528c898d%'),
                          'sourceRef', 'PF 2520-2026'), now()
  FROM mesa_items i
 WHERE i.tenant_id = '5525986c-3b09-4d13-bf8f-43ccaa2deae3'
   AND i.id::text LIKE '81264287%'
   AND NOT EXISTS (SELECT 1 FROM mesa_events e2 WHERE e2.tenant_id = i.tenant_id AND e2.item_id = i.id
                     AND e2.command = 'superseded' AND e2.payload->>'reason' = 'duplicate-source');

UPDATE mesa_items
   SET row_version = row_version + 1,
       updated_at = now(),
       payload = jsonb_set(payload, '{supersedesItemId}', to_jsonb((SELECT id::text FROM mesa_items l WHERE l.tenant_id = mesa_items.tenant_id AND l.id::text LIKE '81264287%')))
 WHERE tenant_id = '5525986c-3b09-4d13-bf8f-43ccaa2deae3'
   AND id::text LIKE '528c898d%'
   AND payload->>'supersedesItemId' IS NULL;
INSERT INTO mesa_events (tenant_id, item_id, seq, actor, command, from_state, to_state, payload, at)
SELECT i.tenant_id, i.id,
       COALESCE((SELECT MAX(seq) FROM mesa_events e WHERE e.tenant_id = i.tenant_id AND e.item_id = i.id), 0) + 1,
       'ops@mwt.one', 'supersede.linked', i.state, i.state,
       jsonb_build_object('supersededItemId', (SELECT id::text FROM mesa_items l WHERE l.tenant_id = i.tenant_id AND l.id::text LIKE '81264287%')), now()
  FROM mesa_items i
 WHERE i.tenant_id = '5525986c-3b09-4d13-bf8f-43ccaa2deae3'
   AND i.id::text LIKE '528c898d%'
   AND NOT EXISTS (SELECT 1 FROM mesa_events e2 WHERE e2.tenant_id = i.tenant_id AND e2.item_id = i.id
                     AND e2.command = 'supersede.linked');

-- 4. Invariante: ninguna clave viva duplicada en el tenant.
DO $$
DECLARE dup integer;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT business_key FROM mesa_items
     WHERE tenant_id = '5525986c-3b09-4d13-bf8f-43ccaa2deae3'
       AND state NOT IN ('APROBADO','EJECUTADO','DESCARTADO','SUSTITUIDO')
     GROUP BY business_key HAVING count(*) > 1
  ) d;
  IF dup <> 0 THEN RAISE EXCEPTION 'quedan % claves vivas duplicadas', dup; END IF;
END $$;

COMMIT;
