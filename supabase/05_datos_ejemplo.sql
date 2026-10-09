-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 05 (OPCIONAL): DATOS DE EJEMPLO tomados del Excel
--  "Horario_Asignacion_Aulas_Octubre_2026.xlsx".
--  Sirve para probar el calendario, las cesiones y la detección de choques.
--  No lo ejecute en producción si ya cargó datos reales.
-- =====================================================================

do $$
declare
  -- Sistemas
  v_sem      bigint;  v_mod     bigint;
  -- Carreras
  v_sis bigint; v_med bigint; v_ind bigint; v_red bigint;
  v_asig bigint;
  v_ces  bigint;
  v_fecha date;
  v_horario bigint;
  c record;
begin
  select id into v_sem from public.sistemas_academicos where codigo = 'SEMESTRAL';
  select id into v_mod from public.sistemas_academicos where codigo = 'MOD_PRES';
  select id into v_sis from public.carreras where sigla = 'SIS';
  select id into v_med from public.carreras where sigla = 'MED';
  select id into v_ind from public.carreras where sigla = 'IND';
  select id into v_red from public.carreras where sigla = 'RED';

  -- Aulas que aparecen en el Excel como destino de reubicaciones
  insert into public.ambientes (codigo, nombre, tipo, capacidad, orden, color) values
    ('B-01', 'Aula B-01 (Medicina)', 'aula', 40, 101, '#94a3b8'),
    ('B-02', 'Aula B-02 (Medicina)', 'aula', 40, 102, '#94a3b8'),
    ('C-11', 'Aula C-11', 'aula', 40, 111, '#94a3b8'),
    ('C-21', 'Aula C-21', 'aula', 40, 121, '#94a3b8'),
    ('C-29', 'Aula C-29', 'aula', 40, 129, '#94a3b8'),
    ('D-10', 'Aula D-10', 'aula', 40, 210, '#94a3b8')
  on conflict (codigo) do nothing;

  -- Docentes
  insert into public.docentes (nombres, apellidos) values
    ('Roger Ivan',        'Paz Vidal'),
    ('Hugo Arnaldo',      'Guzman Centellas'),
    ('Freddy',            'Tinajeros'),
    ('Alex Elder',        'Escobar Peralta'),
    ('Gustavo',           'Tantani Mamani'),
    ('Maria Bertha',      'Colque Torrico'),
    ('Juan Javier',       'Lopez Bonifaz'),
    ('Luis Cristian',     'Torrez La Fuente'),
    ('Luis Adolfo',       'Orozco Jare'),
    ('Pablo Alvaro',      'Moscoso Zeballos'),
    ('Robert Wilson',     'Cruz Claure'),
    ('Edmundo',           'Rivas Vargas'),
    ('Diego',             'Aramayo Acuña'),
    ('Jimmy Nataniel',    'Requena Llorentty'),
    ('Ramiro',            'Sanchez'),
    ('Betty',             'Meneses'),
    ('Emily',             'Dra. (Medicina)'),
    ('Mario',             'Saavedra');

  -- Carreras de cada docente (Hugo Guzman: Sistemas y Medicina)
  insert into public.docente_carreras (docente_id, carrera_id)
  select d.id, v_sis from public.docentes d
  where d.apellidos not in ('Tinajeros', 'Dra. (Medicina)', 'Torrez La Fuente');
  insert into public.docente_carreras (docente_id, carrera_id)
  select id, v_med from public.docentes where apellidos in ('Tinajeros', 'Dra. (Medicina)', 'Guzman Centellas');
  insert into public.docente_carreras (docente_id, carrera_id)
  select id, v_ind from public.docentes where apellidos = 'Torrez La Fuente';

  -- Materias
  insert into public.materias (nombre) values
    ('Taller de Redes'), ('Informática Médica'), ('Informática Médica II'),
    ('Programación Básica'), ('Estructuras Discretas'), ('Sistemas Digitales II'),
    ('Programación Numérica'), ('Dibujo Industrial Computarizado'), ('Circuitos Eléctricos'),
    ('Estructuras de Datos'), ('Programación Web II'), ('Taller de Sistemas Operativos II'),
    ('Redes I'), ('Tecnología Web II'), ('Seguridad Informática'), ('Seguridad en Redes'),
    ('Ingeniería de Software II'), ('MDG I - Proyectos');

  -- ------------------------------------------------------------------
  -- Asignaciones
  -- ------------------------------------------------------------------

  -- TARDE: Taller de Redes - Ivan Paz - LAB-03, L-V 16:00-19:00
  insert into public.asignaciones (sistema_id, fecha_inicio, fecha_fin, docente_id, materia_id, carrera_id, grupo)
  values (v_mod, '2026-10-05', '2026-10-30', (select id from public.docentes where apellidos = 'Paz Vidal'),
          (select id from public.materias where nombre = 'Taller de Redes'), v_red, 'A')
  returning id into v_asig;
  insert into public.asignacion_horarios (asignacion_id, dia_semana, hora_inicio, hora_fin, ambiente_id)
  select v_asig, d, '16:00', '19:00', (select id from public.ambientes where codigo = 'LAB-03')
  from generate_series(1, 5) d;

  -- MEDICINA - Hugo Guzman - LAB-10: Mar 14:15-18:45, Vie 15:00-16:30
  insert into public.asignaciones (sistema_id, fecha_inicio, fecha_fin, docente_id, materia_id, carrera_id)
  values (v_sem, '2026-08-03', '2026-12-12', (select id from public.docentes where apellidos = 'Guzman Centellas'),
          (select id from public.materias where nombre = 'Informática Médica'), v_med)
  returning id into v_asig;
  insert into public.asignacion_horarios (asignacion_id, dia_semana, hora_inicio, hora_fin, ambiente_id) values
    (v_asig, 2, '14:15', '18:45', (select id from public.ambientes where codigo = 'LAB-10')),
    (v_asig, 5, '15:00', '16:30', (select id from public.ambientes where codigo = 'LAB-10'));

  -- MEDICINA - Freddy Tinajeros - LAB-06
  insert into public.asignaciones (sistema_id, fecha_inicio, fecha_fin, docente_id, materia_id, carrera_id)
  values (v_sem, '2026-08-03', '2026-12-12', (select id from public.docentes where apellidos = 'Tinajeros'),
          (select id from public.materias where nombre = 'Informática Médica II'), v_med)
  returning id into v_asig;
  insert into public.asignacion_horarios (asignacion_id, dia_semana, hora_inicio, hora_fin, ambiente_id) values
    (v_asig, 1, '14:15', '20:15', (select id from public.ambientes where codigo = 'LAB-06')),
    (v_asig, 2, '14:15', '20:15', (select id from public.ambientes where codigo = 'LAB-06')),
    (v_asig, 3, '14:15', '18:45', (select id from public.ambientes where codigo = 'LAB-06')),
    (v_asig, 4, '14:15', '19:00', (select id from public.ambientes where codigo = 'LAB-06')),
    (v_asig, 5, '12:00', '17:45', (select id from public.ambientes where codigo = 'LAB-06'));

  -- NOCHE (L-V 19:00-22:00) — materia, docente, ambiente
  insert into public.asignaciones (sistema_id, fecha_inicio, fecha_fin, docente_id, materia_id, carrera_id, grupo)
  select v_mod, '2026-10-05', '2026-10-30', d.id, m.id, v_sis, 'A'
  from (values
          ('Programación Básica',              'Escobar Peralta'),
          ('Programación Web II',              'Cruz Claure'),
          ('Taller de Sistemas Operativos II', 'Rivas Vargas'),
          ('Redes I',                          'Aramayo Acuña'),
          ('Tecnología Web II',                'Requena Llorentty'),
          ('Seguridad Informática',            'Guzman Centellas'),
          ('Seguridad en Redes',               'Paz Vidal'),
          ('Programación Numérica',            'Lopez Bonifaz'),
          ('Ingeniería de Software II',        'Sanchez'),
          ('Estructuras de Datos',             'Moscoso Zeballos')
       ) as x(materia, docente)
  join public.materias m on m.nombre = x.materia
  join public.docentes d on d.apellidos = x.docente;

  insert into public.asignaciones (sistema_id, fecha_inicio, fecha_fin, docente_id, materia_id, carrera_id, grupo)
  values (v_mod, '2026-10-05', '2026-10-30', (select id from public.docentes where apellidos = 'Torrez La Fuente'),
          (select id from public.materias where nombre = 'Dibujo Industrial Computarizado'), v_ind, 'B');

  -- Horarios de noche L-V en su ambiente
  insert into public.asignacion_horarios (asignacion_id, dia_semana, hora_inicio, hora_fin, ambiente_id)
  select a.id, dia, '19:00', '22:00', am.id
  from (values
          ('Programación Básica',              'LAB-08'),
          ('Programación Web II',              'LAB-04'),
          ('Taller de Sistemas Operativos II', 'LAB-07'),
          ('Redes I',                          'LAB-09'),
          ('Tecnología Web II',                'LAB-01'),
          ('Seguridad Informática',            'LAB-10'),
          ('Seguridad en Redes',               'LAB-03'),
          ('Programación Numérica',            'C-21'),
          ('Ingeniería de Software II',        'C-11'),
          ('Dibujo Industrial Computarizado',  'LAB-05')
       ) as x(materia, ambiente)
  join public.materias m     on m.nombre = x.materia
  join public.asignaciones a on a.materia_id = m.id and a.sistema_id = v_mod
  join public.ambientes am   on am.codigo = x.ambiente
  cross join generate_series(1, 5) dia;

  -- Estructuras de Datos (Alvaro Moscoso): Lun desde 20:15, Mié/Jue/Vie 19:00 en LAB-06.
  -- (El martes recibe LAB-03 por cesión de Ivan Paz)
  select a.id into v_asig from public.asignaciones a
  join public.materias m on m.id = a.materia_id where m.nombre = 'Estructuras de Datos';
  insert into public.asignacion_horarios (asignacion_id, dia_semana, hora_inicio, hora_fin, ambiente_id) values
    (v_asig, 1, '20:15', '22:00', (select id from public.ambientes where codigo = 'LAB-06')),
    (v_asig, 3, '19:00', '22:00', (select id from public.ambientes where codigo = 'LAB-06')),
    (v_asig, 4, '19:00', '22:00', (select id from public.ambientes where codigo = 'LAB-06')),
    (v_asig, 5, '19:00', '22:00', (select id from public.ambientes where codigo = 'LAB-06'));

  -- Días marcados del módulo de octubre: los 20 días hábiles (05/10 al 30/10)
  insert into public.asignacion_fechas (asignacion_id, fecha)
  select a.id, g::date
  from public.asignaciones a
  cross join generate_series('2026-10-05'::date, '2026-10-30'::date, interval '1 day') g
  where a.sistema_id = v_mod and extract(isodow from g) between 1 and 5;

  -- ------------------------------------------------------------------
  -- CESIONES repetitivas (todas las fechas de ese día dentro del módulo)
  -- ------------------------------------------------------------------
  -- Cada fila: materia que cede, día, quién recibe, carrera, qué dicta, motivo,
  -- y dónde pasa clase el que cede (nulo = no se reubica)
  for c in
    select * from (values
      ('Programación Básica',              2, 'Dra. (Medicina)',  v_med, 'Medicina - Práctica de laboratorio', 'Cede a Dra. Emily (Medicina)', 'B-02'),
      ('Taller de Sistemas Operativos II', 2, 'Saavedra',         v_sis, 'Clase Ing. Mario Saavedra',          'Cede a Ing. Mario Saavedra',   'D-10'),
      ('Seguridad en Redes',               2, 'Moscoso Zeballos', v_sis, 'Estructuras de Datos',               'Cede a Ing. Alvaro Moscoso',   'C-29'),
      ('Redes I',                          4, 'Moscoso Zeballos', v_sis, 'Estructuras de Datos',               'Cede a Ing. Alvaro Moscoso',   'C-29'),
      ('Seguridad Informática',            4, 'Dra. (Medicina)',  v_med, 'Medicina - Práctica de laboratorio', 'Cede a Dra. Emily (Medicina)', 'B-01'),
      ('Estructuras de Datos',             4, 'Tinajeros',        v_med, 'Informática Médica II',
       'Cede a Dr. Tinajeros (Medicina); pasa en LAB-09 cedido por Aramayo', null)
    ) as t(materia, dia, receptor, carrera, mat_receptor, motivo, destino)
  loop
    -- Horario semanal que se cede
    select h.id into v_horario
    from public.asignacion_horarios h
    join public.asignaciones a on a.id = h.asignacion_id
    join public.materias m on m.id = a.materia_id
    where m.nombre = c.materia and h.dia_semana = c.dia and a.sistema_id = v_mod;

    insert into public.cesiones (asignacion_horario_id, docente_receptor_id, carrera_receptor_id, materia_receptor, motivo)
    values (v_horario, (select id from public.docentes where apellidos = c.receptor), c.carrera, c.mat_receptor, c.motivo)
    returning id into v_ces;

    -- Repetitivo: todos los días "c.dia" del módulo
    for v_fecha in
      select g::date from generate_series('2026-10-05'::date, '2026-10-30'::date, interval '1 day') g
      where extract(isodow from g) = c.dia
    loop
      insert into public.cesion_fechas (cesion_id, fecha) values (v_ces, v_fecha);
      if c.destino is not null then
        insert into public.reubicaciones (asignacion_horario_id, fecha, ambiente_destino_id, motivo, cesion_id)
        values (v_horario, v_fecha, (select id from public.ambientes where codigo = c.destino), c.motivo, v_ces);
      end if;
    end loop;
  end loop;

  -- ------------------------------------------------------------------
  -- Reservas: evento Fortinet (2 días) y una defensa
  -- ------------------------------------------------------------------
  insert into public.reservas (tipo_id, titulo, descripcion, responsable, carrera_id)
  values ((select id from public.tipos_reserva where codigo = 'EVENTO'), 'Capacitación Fortinet',
          'Certificación NSE - Fortinet Academy', 'Ing. Ivan Paz', v_red)
  returning id into v_asig;
  insert into public.reserva_horarios (reserva_id, ambiente_id, fecha, hora_inicio, hora_fin) values
    (v_asig, (select id from public.ambientes where codigo = 'LAB-02'), '2026-10-15', '08:00', '12:00'),
    (v_asig, (select id from public.ambientes where codigo = 'LAB-02'), '2026-10-16', '08:00', '12:00');

  insert into public.reservas (tipo_id, titulo, responsable, carrera_id)
  values ((select id from public.tipos_reserva where codigo = 'DEFENSA'), 'Defensa de grado - Sistemas', 'Dirección de Carrera', v_sis)
  returning id into v_asig;
  insert into public.reserva_horarios (reserva_id, ambiente_id, fecha, hora_inicio, hora_fin) values
    (v_asig, (select id from public.ambientes where codigo = 'LAB-05'), '2026-10-21', '10:30', '12:30');
end $$;
