-- =====================================================================
--  Script 42: CESIONES Y REUBICACIONES EN UNA SOLA LISTA
--  - Una reubicación (la clase se va a otro laboratorio/aula porque el suyo
--    está ocupado) se muestra igual que una cesión: "Ambiente cedido".
--  - fn_cedidos_por_reubicacion devuelve, por cada día reubicado, quién se
--    va, a dónde, y quién ocupa su laboratorio en ese horario (viene).
--  Ejecutar en: Supabase > SQL Editor (después de 41).
-- =====================================================================

create or replace function public.fn_cedidos_por_reubicacion(p_desde date default null)
returns table (
  reubicacion_id        bigint,
  asignacion_horario_id bigint,
  asignacion_id         bigint,
  fecha                 date,
  dia_semana            smallint,
  hora_inicio           time,
  hora_fin              time,
  ambiente_id           bigint,
  docente               text,
  materia               text,
  destino               text,
  motivo                text,
  reserva_id            bigint,
  viene_titulo          text,
  viene_detalle         text
)
language sql stable set search_path = public as $$
  select r.id, h.id, a.id, r.fecha, h.dia_semana, h.hora_inicio, h.hora_fin, h.ambiente_id,
         trim(d.apellidos || ' ' || d.nombres), m.nombre,
         coalesce(am.codigo, nullif(r.aula_destino, '')),
         r.motivo, r.reserva_id,
         o.titulo, o.detalle
  from public.reubicaciones r
  join public.asignacion_horarios h on h.id = r.asignacion_horario_id
  join public.asignaciones a        on a.id = h.asignacion_id
  join public.docentes d            on d.id = a.docente_id
  join public.materias m            on m.id = a.materia_id
  left join public.ambientes am     on am.id = r.ambiente_destino_id
  left join lateral (
    select x.titulo, x.detalle
    from public.fn_ocupaciones(r.fecha, r.fecha) x
    where x.ambiente_id = h.ambiente_id
      and x.asignacion_horario_id is distinct from h.id
      and x.hora_inicio < h.hora_fin and h.hora_inicio < x.hora_fin
    order by x.prioridad desc, x.hora_inicio
    limit 1
  ) o on true
  where p_desde is null or r.fecha >= p_desde;
$$;

grant execute on function public.fn_cedidos_por_reubicacion(date) to authenticated;
