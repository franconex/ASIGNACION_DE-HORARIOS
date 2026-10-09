-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 01: ESQUEMA (tablas, relaciones, índices)
--  Ejecutar en: Supabase > SQL Editor (en orden: 01, 02, 03, 04)
-- =====================================================================
--  Modelo general:
--   * Catálogos: carreras, docentes, materias, ambientes (labs/aulas),
--     sistemas académicos, bloques horarios fijos, feriados, tipos de reserva.
--   * Asignación: docente + materia + carrera + sistema + fechas.
--       - Modular (presencial / semipresencial): se marcan los DÍAS exactos
--         de clase en un calendario (tabla asignacion_fechas).
--       - Semestral: fecha de inicio y fin (6 meses, máximo < 7 meses).
--     Cada asignación tiene uno o varios HORARIOS: día de semana,
--     hora inicio/fin y ambiente (un docente puede pasar el lunes en
--     LAB-06 y el martes en LAB-03).
--   * Excepciones por fecha concreta:
--       - cesiones   : el docente cede su ambiente a otro docente
--                      en una o varias fechas (cesion_fechas).
--       - reubicaciones: una clase de una fecha concreta se pasa en
--                      otro ambiente / otra hora (o se suspende).
--   * Reservas de prioridad alta (eventos, defensas, mantenimiento…)
--     con sus horarios por fecha y ambiente (reserva_horarios).
-- =====================================================================


-- ---------------------------------------------------------------------
-- Función genérica para mantener la columna actualizado_en
-- ---------------------------------------------------------------------
create or replace function public.fn_set_actualizado_en()
returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- PERFILES (usuarios del sistema, enlazados a auth.users de Supabase)
-- ---------------------------------------------------------------------
create table public.perfiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  nombre_completo text        not null,
  correo          text        not null unique,
  rol             text        not null default 'auxiliar'
                  check (rol in ('admin', 'auxiliar', 'decano')),
  activo          boolean     not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);
comment on table public.perfiles is 'Usuarios del sistema con su rol (admin, auxiliar, decano).';

-- ---------------------------------------------------------------------
-- CARRERAS
-- ---------------------------------------------------------------------
create table public.carreras (
  id             bigint generated always as identity primary key,
  nombre         text        not null unique,
  sigla          text,
  color          text        not null default '#64748b',
  activo         boolean     not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- DOCENTES (pueden pertenecer a una o más carreras)
-- ---------------------------------------------------------------------
create table public.docentes (
  id             bigint generated always as identity primary key,
  nombres        text        not null,
  apellidos      text        not null,
  carnet         text        unique,
  telefono       text,
  correo         text,
  activo         boolean     not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index docentes_busqueda_idx on public.docentes (lower(apellidos), lower(nombres));

create table public.docente_carreras (
  docente_id bigint not null references public.docentes(id) on delete cascade,
  carrera_id bigint not null references public.carreras(id) on delete cascade,
  primary key (docente_id, carrera_id)
);
create index docente_carreras_carrera_idx on public.docente_carreras (carrera_id);

-- ---------------------------------------------------------------------
-- MATERIAS (catálogo general) y materias que puede dictar cada docente
-- ---------------------------------------------------------------------
create table public.materias (
  id             bigint generated always as identity primary key,
  nombre         text        not null unique,
  sigla          text,
  requiere_laboratorio boolean not null default true,
  activo         boolean     not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.docente_materias (
  docente_id bigint not null references public.docentes(id) on delete cascade,
  materia_id bigint not null references public.materias(id) on delete cascade,
  primary key (docente_id, materia_id)
);
create index docente_materias_materia_idx on public.docente_materias (materia_id);

-- ---------------------------------------------------------------------
-- AMBIENTES (laboratorios, aulas, auditorios…)
-- ---------------------------------------------------------------------
create table public.ambientes (
  id             bigint generated always as identity primary key,
  codigo         text        not null unique,          -- LAB-01, C-29, B-02…
  nombre         text,
  tipo           text        not null default 'laboratorio'
                 check (tipo in ('laboratorio', 'aula', 'auditorio', 'otro')),
  capacidad      integer     not null default 0 check (capacidad >= 0),
  tipo_equipo    text,                                  -- modelo / tipo de PCs
  ubicacion      text,
  estado         text        not null default 'activo'
                 check (estado in ('activo', 'mantenimiento', 'baja')),
  color          text        not null default '#2563eb',
  orden          integer     not null default 0,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- SISTEMAS ACADÉMICOS
--   modo_fechas = 'dias'  -> se eligen los días exactos (modular)
--   modo_fechas = 'rango' -> fecha inicio + fin (semestral)
-- ---------------------------------------------------------------------
create table public.sistemas_academicos (
  id              bigint generated always as identity primary key,
  codigo          text     not null unique,              -- SEMESTRAL, MOD_PRES, MOD_SEMI
  nombre          text     not null,
  dias_permitidos smallint[] not null default '{1,2,3,4,5}', -- 1=lunes … 7=domingo (ISO)
  modo_fechas     text     not null default 'dias' check (modo_fechas in ('dias', 'rango')),
  meses_duracion  integer,                                -- duración sugerida (semestral: 6)
  meses_maximo    integer,                                -- tope que NO se alcanza (semestral: 7)
  dias_sugeridos  integer,                                -- días de clase sugeridos (modular: 20)
  color           text     not null default '#0ea5e9',
  activo          boolean  not null default true
);

-- ---------------------------------------------------------------------
-- BLOQUES HORARIOS FIJOS (plantillas para elegir rápido)
-- ---------------------------------------------------------------------
create table public.bloques_horario (
  id          bigint generated always as identity primary key,
  nombre      text     not null unique,
  turno       text     not null check (turno in ('M', 'MD', 'T', 'N')),
  hora_inicio time     not null,
  hora_fin    time     not null,
  orden       integer  not null default 0,
  check (hora_fin > hora_inicio)
);

-- ---------------------------------------------------------------------
-- FERIADOS (en estas fechas no se generan clases)
-- ---------------------------------------------------------------------
create table public.feriados (
  fecha       date primary key,
  descripcion text not null
);

-- ---------------------------------------------------------------------
-- ASIGNACIONES: docente + materia + carrera + sistema + fechas
-- ---------------------------------------------------------------------
create table public.asignaciones (
  id             bigint generated always as identity primary key,
  sistema_id     bigint      not null references public.sistemas_academicos(id),
  docente_id     bigint      not null references public.docentes(id),
  materia_id     bigint      not null references public.materias(id),
  carrera_id     bigint      not null references public.carreras(id),
  grupo          text,
  fecha_inicio   date        not null,  -- modular: primer día marcado; semestral: inicio
  fecha_fin      date        not null,  -- modular: último día marcado; semestral: fin
  observacion    text,
  creado_por     uuid        default auth.uid() references public.perfiles(id) on delete set null,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check (fecha_fin >= fecha_inicio)
);
create index asignaciones_fechas_idx  on public.asignaciones (fecha_inicio, fecha_fin);
create index asignaciones_sistema_idx on public.asignaciones (sistema_id);
create index asignaciones_docente_idx on public.asignaciones (docente_id);
create index asignaciones_materia_idx on public.asignaciones (materia_id);
create index asignaciones_carrera_idx on public.asignaciones (carrera_id);

-- Días exactos de clase (solo sistemas modulares, marcados en el calendario)
create table public.asignacion_fechas (
  asignacion_id bigint not null references public.asignaciones(id) on delete cascade,
  fecha         date   not null,
  primary key (asignacion_id, fecha)
);
create index asignacion_fechas_fecha_idx on public.asignacion_fechas (fecha);

-- Horarios semanales de cada asignación (día + horas + ambiente)
create table public.asignacion_horarios (
  id             bigint generated always as identity primary key,
  asignacion_id  bigint   not null references public.asignaciones(id) on delete cascade,
  dia_semana     smallint not null check (dia_semana between 1 and 7),
  hora_inicio    time     not null,
  hora_fin       time     not null,
  ambiente_id    bigint   not null references public.ambientes(id),
  check (hora_fin > hora_inicio)
);
create index asignacion_horarios_asig_idx     on public.asignacion_horarios (asignacion_id);
create index asignacion_horarios_ambiente_idx on public.asignacion_horarios (ambiente_id, dia_semana);

-- ---------------------------------------------------------------------
-- CESIONES: un docente cede su ambiente (de un horario) a otro docente
-- ---------------------------------------------------------------------
create table public.cesiones (
  id                    bigint generated always as identity primary key,
  asignacion_horario_id bigint      not null references public.asignacion_horarios(id) on delete cascade,
  docente_receptor_id   bigint      not null references public.docentes(id),
  carrera_receptor_id   bigint      references public.carreras(id),
  materia_receptor      text,       -- qué dicta quien recibe (texto libre: ej. "Medicina - Anatomía")
  motivo                text        not null,
  creado_por            uuid        default auth.uid() references public.perfiles(id) on delete set null,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now()
);
create index cesiones_horario_idx  on public.cesiones (asignacion_horario_id);
create index cesiones_receptor_idx on public.cesiones (docente_receptor_id);

-- Fechas concretas de cada cesión (un día, varios o repetitivo)
create table public.cesion_fechas (
  cesion_id             bigint not null references public.cesiones(id) on delete cascade,
  fecha                 date   not null,
  primary key (cesion_id, fecha)
);
create index cesion_fechas_fecha_idx on public.cesion_fechas (fecha);

-- ---------------------------------------------------------------------
-- TIPOS DE RESERVA y RESERVAS (eventos, defensas…) — prioridad alta
-- ---------------------------------------------------------------------
create table public.tipos_reserva (
  id        bigint generated always as identity primary key,
  codigo    text    not null unique,      -- EVENTO, DEFENSA, MANTENIMIENTO
  nombre    text    not null,
  prioridad integer not null default 100, -- mayor = más prioridad (clases = 10)
  color     text    not null default '#dc2626'
);

create table public.reservas (
  id             bigint generated always as identity primary key,
  tipo_id        bigint      not null references public.tipos_reserva(id),
  titulo         text        not null,
  descripcion    text,
  responsable    text,
  carrera_id     bigint      references public.carreras(id),
  creado_por     uuid        default auth.uid() references public.perfiles(id) on delete set null,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index reservas_tipo_idx on public.reservas (tipo_id);

-- Cada fila: un ambiente ocupado en una fecha y rango de horas
create table public.reserva_horarios (
  id          bigint generated always as identity primary key,
  reserva_id  bigint not null references public.reservas(id) on delete cascade,
  ambiente_id bigint not null references public.ambientes(id),
  fecha       date   not null,
  hora_inicio time   not null,
  hora_fin    time   not null,
  check (hora_fin > hora_inicio)
);
create index reserva_horarios_reserva_idx on public.reserva_horarios (reserva_id);
create index reserva_horarios_fecha_idx   on public.reserva_horarios (fecha, ambiente_id);

-- ---------------------------------------------------------------------
-- REUBICACIONES: una clase de una fecha concreta se mueve de ambiente,
-- cambia de hora o se suspende (ambiente_destino_id nulo = suspendida).
-- Se generan al ceder (el docente que cede pasa en otro lado) o al crear
-- un evento/defensa que choca con la clase (reubicación obligatoria).
-- ---------------------------------------------------------------------
create table public.reubicaciones (
  id                    bigint generated always as identity primary key,
  asignacion_horario_id bigint      not null references public.asignacion_horarios(id) on delete cascade,
  fecha                 date        not null,
  ambiente_destino_id   bigint      references public.ambientes(id),
  hora_inicio           time,       -- nulo = misma hora del horario
  hora_fin              time,
  motivo                text        not null,
  reserva_id            bigint      references public.reservas(id) on delete cascade,
  cesion_id             bigint      references public.cesiones(id) on delete cascade,
  creado_por            uuid        default auth.uid() references public.perfiles(id) on delete set null,
  creado_en             timestamptz not null default now(),
  unique (asignacion_horario_id, fecha),
  check ((hora_inicio is null) = (hora_fin is null)),
  check (hora_fin is null or hora_fin > hora_inicio)
);
create index reubicaciones_fecha_idx   on public.reubicaciones (fecha, ambiente_destino_id);
create index reubicaciones_reserva_idx on public.reubicaciones (reserva_id);
create index reubicaciones_cesion_idx  on public.reubicaciones (cesion_id);

-- ---------------------------------------------------------------------
-- Triggers de actualizado_en
-- ---------------------------------------------------------------------
create trigger trg_perfiles_actualizado     before update on public.perfiles     for each row execute function public.fn_set_actualizado_en();
create trigger trg_carreras_actualizado     before update on public.carreras     for each row execute function public.fn_set_actualizado_en();
create trigger trg_docentes_actualizado     before update on public.docentes     for each row execute function public.fn_set_actualizado_en();
create trigger trg_materias_actualizado     before update on public.materias     for each row execute function public.fn_set_actualizado_en();
create trigger trg_ambientes_actualizado    before update on public.ambientes    for each row execute function public.fn_set_actualizado_en();
create trigger trg_asignaciones_actualizado before update on public.asignaciones for each row execute function public.fn_set_actualizado_en();
create trigger trg_cesiones_actualizado     before update on public.cesiones     for each row execute function public.fn_set_actualizado_en();
create trigger trg_reservas_actualizado     before update on public.reservas     for each row execute function public.fn_set_actualizado_en();
