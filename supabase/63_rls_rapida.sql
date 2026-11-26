-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 63: RLS RÁPIDA (arregla "canceling statement due to statement timeout")
--  - Las políticas llamaban fn_puede_ver(), fn_puede_operar(), auth.uid()…
--    UNA VEZ POR FILA (cada llamada consulta perfiles). Con el límite de 8 s
--    del rol authenticated, el dashboard de Desempeño se cortaba.
--  - Se reescriben todas las políticas de public envolviendo esas llamadas
--    sin argumentos en (select …): Postgres las evalúa una sola vez por
--    consulta. El resultado (quién ve / edita qué) es exactamente el mismo.
--  - Es idempotente: se puede volver a ejecutar sin problema.
--  Ejecutar en: Supabase > SQL Editor (después de 62).
-- =====================================================================

do $$
declare
  p record;
  -- llamadas sin argumentos que no estén ya dentro de un SELECT
  v_patron constant text := '(?<!SELECT )\m(fn_\w+\(\)|auth\.uid\(\))';
  v_q text;
  v_w text;
  v_sql text;
begin
  for p in
    select c.relname as tabla, pol.polname as nombre,
           pg_get_expr(pol.polqual, pol.polrelid) as q,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as w
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
  loop
    v_q := regexp_replace(p.q, v_patron, '(SELECT \1)', 'g');
    v_w := regexp_replace(p.w, v_patron, '(SELECT \1)', 'g');
    if v_q is distinct from p.q or v_w is distinct from p.w then
      v_sql := format('alter policy %I on public.%I', p.nombre, p.tabla);
      if v_q is not null then v_sql := v_sql || format(' using (%s)', v_q); end if;
      if v_w is not null then v_sql := v_sql || format(' with check (%s)', v_w); end if;
      execute v_sql;
    end if;
  end loop;
end $$;
