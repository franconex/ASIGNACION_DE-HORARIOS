-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 39: PCs REALES DE CADA LABORATORIO (hoja "Laboratorios de Computación")
--  - Crea la PC del docente (PCDOCENTEn) y las PCs de estudiantes
--    (SCPCn01…) de LAB-01 a LAB-10, con la misma numeración que fn_generar_pcs.
--  - Pone la capacidad real de cada ambiente (= sillas).
--  - Se puede correr de nuevo: no duplica las PCs que ya existen.
--  Ejecutar en: Supabase > SQL Editor (después de 38).
-- =====================================================================

with datos (codigo, pcs_estudiantes, capacidad) as (values
  ('LAB-01', 20, 30), ('LAB-02', 30, 48), ('LAB-03', 20, 28), ('LAB-04', 12, 24), ('LAB-05', 20, 40),
  ('LAB-06', 25, 40), ('LAB-07', 25, 35), ('LAB-08', 25, 40), ('LAB-09', 30, 45), ('LAB-10', 30, 50)
)
update public.ambientes a set capacidad = d.capacidad, tipo_equipo = 'PC de escritorio'
  from datos d where a.codigo = d.codigo;

-- PC del docente (orden 0: va primero)
insert into public.ambiente_pcs (ambiente_id, etiqueta, estado, orden, es_docente)
select a.id, 'PCDOCENTE' || ltrim(regexp_replace(a.codigo, '\D', '', 'g'), '0'), 'operativa', 0, true
  from public.ambientes a
 where a.codigo in ('LAB-01','LAB-02','LAB-03','LAB-04','LAB-05','LAB-06','LAB-07','LAB-08','LAB-09','LAB-10')
   and not exists (select 1 from public.ambiente_pcs p where p.ambiente_id = a.id and p.es_docente);

-- PCs de estudiantes
with datos (codigo, pcs_estudiantes) as (values
  ('LAB-01', 20), ('LAB-02', 30), ('LAB-03', 20), ('LAB-04', 12), ('LAB-05', 20),
  ('LAB-06', 25), ('LAB-07', 25), ('LAB-08', 25), ('LAB-09', 30), ('LAB-10', 30)
)
insert into public.ambiente_pcs (ambiente_id, etiqueta, estado, orden)
select a.id, 'SCPC' || ltrim(regexp_replace(a.codigo, '\D', '', 'g'), '0') || lpad(n::text, 2, '0'), 'operativa', n
  from datos d
  join public.ambientes a on a.codigo = d.codigo
  cross join lateral generate_series(1, d.pcs_estudiantes) n
 where not exists (select 1 from public.ambiente_pcs p
                    where p.ambiente_id = a.id
                      and p.etiqueta = 'SCPC' || ltrim(regexp_replace(a.codigo, '\D', '', 'g'), '0') || lpad(n::text, 2, '0'));
