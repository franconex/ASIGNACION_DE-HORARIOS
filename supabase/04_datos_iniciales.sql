-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 04: DATOS INICIALES (catálogos base obligatorios)
-- =====================================================================

-- Bloques horarios fijos (también aplican a sábados)
insert into public.bloques_horario (nombre, turno, hora_inicio, hora_fin, orden) values
  ('Mañana',     'M',  '07:30', '10:30', 1),
  ('Medio día',  'MD', '10:30', '13:30', 2),
  ('Tarde 1',    'T',  '13:30', '16:00', 3),
  ('Tarde 2',    'T',  '16:00', '19:00', 4),
  ('Noche',      'N',  '19:00', '22:00', 5);

-- Sistemas académicos (días ISO: 1 = lunes … 6 = sábado)
--   Modular: se marcan los días en el calendario (sugerido: 20 días hábiles / 4 sábados)
--   Semestral: inicio + 6 meses automáticos; se puede extender, pero sin llegar a 7 meses
insert into public.sistemas_academicos (codigo, nombre, dias_permitidos, modo_fechas, meses_duracion, meses_maximo, dias_sugeridos, color) values
  ('MOD_PRES',  'Modular presencial',      '{1,2,3,4,5}',   'dias',  null, null, 20,   '#2563eb'),
  ('MOD_SEMI',  'Modular semipresencial',  '{6}',           'dias',  null, null, 4,    '#d97706'),
  ('SEMESTRAL', 'Semestral',               '{1,2,3,4,5,6}', 'rango', 6,    7,    null, '#0891b2');

-- Tipos de reserva (prioridad mayor que las clases = 10)
insert into public.tipos_reserva (codigo, nombre, prioridad, color) values
  ('EVENTO',        'Evento',        100, '#dc2626'),
  ('DEFENSA',       'Defensa',       100, '#ea580c'),
  ('MANTENIMIENTO', 'Mantenimiento',  90, '#475569');

-- Laboratorios actuales (ajuste capacidad y equipos desde la app)
insert into public.ambientes (codigo, nombre, tipo, capacidad, tipo_equipo, orden, color) values
  ('LAB-01', 'Laboratorio 1',  'laboratorio', 30, 'PC de escritorio', 1,  '#2563eb'),
  ('LAB-02', 'Laboratorio 2',  'laboratorio', 30, 'PC de escritorio', 2,  '#0891b2'),
  ('LAB-03', 'Laboratorio 3',  'laboratorio', 30, 'PC de escritorio', 3,  '#059669'),
  ('LAB-04', 'Laboratorio 4',  'laboratorio', 30, 'PC de escritorio', 4,  '#65a30d'),
  ('LAB-05', 'Laboratorio 5',  'laboratorio', 30, 'PC de escritorio', 5,  '#ca8a04'),
  ('LAB-06', 'Laboratorio 6',  'laboratorio', 30, 'PC de escritorio', 6,  '#ea580c'),
  ('LAB-07', 'Laboratorio 7',  'laboratorio', 30, 'PC de escritorio', 7,  '#dc2626'),
  ('LAB-08', 'Laboratorio 8',  'laboratorio', 30, 'PC de escritorio', 8,  '#db2777'),
  ('LAB-09', 'Laboratorio 9',  'laboratorio', 30, 'PC de escritorio', 9,  '#9333ea'),
  ('LAB-10', 'Laboratorio 10', 'laboratorio', 30, 'PC de escritorio', 10, '#4f46e5');

-- Carreras (agregue o edite desde la app)
insert into public.carreras (nombre, sigla, color) values
  ('Ingeniería de Sistemas',     'SIS', '#2563eb'),
  ('Ingeniería Industrial',      'IND', '#ca8a04'),
  ('Ingeniería en Redes y Telecomunicaciones', 'RED', '#059669'),
  ('Medicina',                   'MED', '#dc2626'),
  ('Derecho',                    'DER', '#7c3aed'),
  ('Psicología',                 'PSI', '#db2777'),
  ('Administración de Empresas', 'ADM', '#0d9488'),
  ('Contaduría Pública',         'CON', '#64748b'),
  ('Ingeniería Comercial',       'COM', '#ea580c'),
  ('Ciencias de la Comunicación','CCS', '#0891b2'),
  ('Ciencias de la Educación',   'EDU', '#65a30d');

-- Feriados nacionales de Bolivia 2026 (revise y complete)
insert into public.feriados (fecha, descripcion) values
  ('2026-01-01', 'Año Nuevo'),
  ('2026-01-22', 'Día del Estado Plurinacional'),
  ('2026-02-16', 'Carnaval'),
  ('2026-02-17', 'Carnaval'),
  ('2026-04-03', 'Viernes Santo'),
  ('2026-05-01', 'Día del Trabajo'),
  ('2026-06-04', 'Corpus Christi'),
  ('2026-06-21', 'Año Nuevo Andino'),
  ('2026-08-06', 'Día de la Independencia'),
  ('2026-11-02', 'Todos Santos'),
  ('2026-12-25', 'Navidad')
on conflict (fecha) do nothing;

-- =====================================================================
--  PRIMER ADMINISTRADOR
--  1) Supabase > Authentication > Users > "Add user" (correo + contraseña,
--     marque "Auto Confirm User").
--  2) Ejecute esta línea cambiando el correo:
--
--  update public.perfiles set rol = 'admin', activo = true, nombre_completo = 'Administrador'
--   where correo = 'admin@upds.edu.bo';
--
--  Desde ahí el admin crea a los auxiliares y al decano desde la app.
-- =====================================================================
