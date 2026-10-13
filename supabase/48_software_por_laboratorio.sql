-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 48: SOFTWARE (PROGRAMAS E ISOs) POR LABORATORIO
--  - software: catálogo de programas y sistemas operativos / ISOs, con
--    categoría, versión, tipo de licencia y para qué carreras se usa.
--  - laboratorio_software: qué tiene instalado cada laboratorio.
--  - Los tickets de "Programas" (y "Atención a docente → Instalar un
--    programa") eligen el software del catálogo (detalles.software_ids);
--    al guardarlos se actualiza solo el inventario del laboratorio:
--    instalar / actualizar lo agrega o renueva su fecha, desinstalar lo
--    quita.
--  - Carga inicial: el Excel "Cantidad y programas en Laboratorios de
--    Computo UPDS-SCZ" (hojas Programas y Programas x Carrera) y los
--    sistemas operativos / ISOs más conocidos.
--  - Ven todos los usuarios; editan admin, encargado y auxiliares.
--  Ejecutar en: Supabase > SQL Editor (después de 47).
-- =====================================================================

-- 1) Catálogo
create table if not exists public.software (
  id        bigint generated always as identity primary key,
  nombre    text not null check (char_length(btrim(nombre)) between 2 and 80),
  tipo      text not null default 'programa' check (tipo in ('programa', 'iso')),
  categoria text check (categoria is null or char_length(categoria) <= 40),
  version   text check (version is null or char_length(version) <= 40),
  licencia  text not null default 'por_verificar'
            check (licencia in ('gratuita', 'educativa', 'suscripcion', 'comercial', 'sin_licencia', 'por_verificar')),
  uso       text check (uso is null or char_length(uso) <= 120),
  notas     text check (notas is null or char_length(notas) <= 300),
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);
create unique index if not exists software_nombre_unico on public.software (lower(btrim(nombre)));

-- 2) Software instalado en cada laboratorio
create table if not exists public.laboratorio_software (
  ambiente_id     bigint not null references public.ambientes (id) on delete cascade,
  software_id     bigint not null references public.software (id) on delete cascade,
  version         text check (version is null or char_length(version) <= 40),
  instalado_en    timestamptz not null default now(),
  actualizado_en  timestamptz,
  actualizado_por uuid references public.perfiles (id) on delete set null,
  atencion_id     bigint references public.atenciones (id) on delete set null,
  primary key (ambiente_id, software_id)
);
create index if not exists laboratorio_software_software on public.laboratorio_software (software_id);

alter table public.software enable row level security;
alter table public.laboratorio_software enable row level security;

drop policy if exists software_ver on public.software;
create policy software_ver on public.software for select to authenticated using (public.fn_puede_ver());
drop policy if exists software_crear on public.software;
create policy software_crear on public.software for insert to authenticated with check (public.fn_puede_operar());
drop policy if exists software_editar on public.software;
create policy software_editar on public.software for update to authenticated
  using (public.fn_puede_operar()) with check (public.fn_puede_operar());
-- No se borra: se oculta con activo = false (los tickets lo siguen nombrando)
revoke delete on public.software from anon, authenticated;

drop policy if exists laboratorio_software_ver on public.laboratorio_software;
create policy laboratorio_software_ver on public.laboratorio_software for select to authenticated using (public.fn_puede_ver());
drop policy if exists laboratorio_software_crear on public.laboratorio_software;
create policy laboratorio_software_crear on public.laboratorio_software for insert to authenticated with check (public.fn_puede_operar());
drop policy if exists laboratorio_software_editar on public.laboratorio_software;
create policy laboratorio_software_editar on public.laboratorio_software for update to authenticated
  using (public.fn_puede_operar()) with check (public.fn_puede_operar());
drop policy if exists laboratorio_software_quitar on public.laboratorio_software;
create policy laboratorio_software_quitar on public.laboratorio_software for delete to authenticated using (public.fn_puede_operar());

-- 3) Los tickets mantienen el inventario del laboratorio
create or replace function public.fn_trg_ticket_software()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_accion text := new.detalles->>'accion';
begin
  if new.ambiente_id is null or jsonb_typeof(new.detalles->'software_ids') is distinct from 'array' then
    return new;
  end if;
  -- Atención a docente: solo cuando pidió instalar un programa
  if new.tipo = 'docente' then
    if new.detalles->>'pedido' is distinct from 'instalar_programa' then return new; end if;
    v_accion := 'instalar';
  elsif new.tipo <> 'programas' then
    return new;
  end if;

  if v_accion in ('instalar', 'actualizar') then
    insert into public.laboratorio_software (ambiente_id, software_id, actualizado_en, actualizado_por, atencion_id)
    select new.ambiente_id, s.id, now(), new.auxiliar_id, new.id
      from public.software s
     where s.id in (select (x)::bigint from jsonb_array_elements_text(new.detalles->'software_ids') x)
    on conflict (ambiente_id, software_id) do update
      set actualizado_en = now(), actualizado_por = excluded.actualizado_por, atencion_id = excluded.atencion_id;
  elsif v_accion = 'desinstalar' then
    delete from public.laboratorio_software
     where ambiente_id = new.ambiente_id
       and software_id in (select (x)::bigint from jsonb_array_elements_text(new.detalles->'software_ids') x);
  end if;
  return new;
end $$;
revoke execute on function public.fn_trg_ticket_software() from anon, authenticated, public;

drop trigger if exists trg_atenciones_software on public.atenciones;
create trigger trg_atenciones_software
  after insert on public.atenciones
  for each row execute function public.fn_trg_ticket_software();

-- 4) Carga inicial
-- Programas que están en el Excel (80)
insert into public.software (nombre, tipo, categoria, licencia, uso) values
  ('7-Zip', 'programa', 'Utilidades', 'gratuita', null),
  ('Adobe Acrobat Reader', 'programa', 'Ofimática', 'gratuita', 'Todas las carreras'),
  ('Adobe Creative Cloud', 'programa', 'Diseño y modelado', 'suscripcion', 'Comunicación Social'),
  ('Adobe Illustrator', 'programa', 'Diseño y modelado', 'sin_licencia', null),
  ('Adobe Photoshop', 'programa', 'Diseño y modelado', 'sin_licencia', null),
  ('Android Studio', 'programa', 'Programación', 'gratuita', 'Sistemas · Aplicaciones móviles'),
  ('Apache HTTP Server', 'programa', 'Programación', 'gratuita', 'Sistemas · Bases de datos'),
  ('ApowerREC', 'programa', 'Multimedia', 'gratuita', null),
  ('Arduino IDE', 'programa', 'Electrónica', 'gratuita', 'Redes · Programación de circuitos'),
  ('Aspen Plus', 'programa', 'Diseño y modelado', 'sin_licencia', null),
  ('AutoCAD', 'programa', 'Diseño y modelado', 'educativa', 'Ingeniería Industrial'),
  ('Autodesk Access', 'programa', 'Utilidades', 'gratuita', null),
  ('balenaEtcher', 'programa', 'Utilidades', 'gratuita', null),
  ('Brave', 'programa', 'Navegadores', 'gratuita', null),
  ('ChatGPT (aplicación)', 'programa', 'Utilidades', 'gratuita', null),
  ('Circuit Wizard', 'programa', 'Electrónica', 'por_verificar', 'Redes · Circuitos'),
  ('Cisco Packet Tracer', 'programa', 'Redes', 'gratuita', 'Redes'),
  ('Code::Blocks', 'programa', 'Programación', 'gratuita', 'Sistemas · Programación'),
  ('ContXH32', 'programa', 'Utilidades', 'por_verificar', null),
  ('Crocodile Clips', 'programa', 'Electrónica', 'gratuita', 'Redes · Simulación electrónica'),
  ('DBeaver', 'programa', 'Bases de datos', 'gratuita', 'Sistemas · Bases de datos'),
  ('DelfiNET', 'programa', 'Bases de datos', 'gratuita', 'Empresariales · Bases de datos'),
  ('DobotVisionStudio', 'programa', 'Electrónica', 'gratuita', 'Redes · Robótica'),
  ('EaseUS RecExperts', 'programa', 'Multimedia', 'gratuita', null),
  ('Enterprise Architect', 'programa', 'Diseño y modelado', 'sin_licencia', 'Sistemas · Diagramas'),
  ('Epi Info 7.2', 'programa', 'Estadística', 'gratuita', null),
  ('FileMaker Pro 19', 'programa', 'Bases de datos', 'por_verificar', null),
  ('FileZilla', 'programa', 'Redes', 'gratuita', 'Redes · FTP'),
  ('Flowgorithm', 'programa', 'Programación', 'gratuita', 'Sistemas · Diagramas de flujo'),
  ('Git', 'programa', 'Programación', 'gratuita', 'Sistemas · Programación'),
  ('GitHub Desktop', 'programa', 'Programación', 'gratuita', 'Sistemas · Programación'),
  ('GNS3', 'programa', 'Redes', 'gratuita', 'Redes · Emulador'),
  ('Google Chrome', 'programa', 'Navegadores', 'gratuita', 'Todas las carreras'),
  ('Honeygain', 'programa', 'Utilidades', 'gratuita', null),
  ('IBM SPSS Statistics', 'programa', 'Estadística', 'sin_licencia', 'Empresariales · Estadística'),
  ('IBM SPSS Statistics 21', 'programa', 'Estadística', 'sin_licencia', 'Empresariales · Estadística'),
  ('IBM SPSS Statistics 23', 'programa', 'Estadística', 'sin_licencia', 'Empresariales · Estadística'),
  ('IntelliJ IDEA', 'programa', 'Programación', 'gratuita', 'Sistemas · Programación'),
  ('Laragon', 'programa', 'Programación', 'gratuita', 'Sistemas · Bases de datos'),
  ('Lazarus IDE', 'programa', 'Programación', 'gratuita', null),
  ('Logisim', 'programa', 'Electrónica', 'gratuita', 'Redes · Simulación lógica'),
  ('Logisim Evolution', 'programa', 'Electrónica', 'gratuita', 'Redes · Simulación lógica'),
  ('Microsoft Office 2016', 'programa', 'Ofimática', 'por_verificar', 'Todas las carreras'),
  ('Microsoft SQL Server 2019', 'programa', 'Bases de datos', 'gratuita', 'Sistemas · Programación'),
  ('MindManager', 'programa', 'Ofimática', 'sin_licencia', null),
  ('Minitab', 'programa', 'Estadística', 'sin_licencia', 'Ingeniería Industrial · Estadística'),
  ('Mozilla Firefox', 'programa', 'Navegadores', 'gratuita', 'Todas las carreras'),
  ('MySQL Server', 'programa', 'Bases de datos', 'gratuita', 'Sistemas · Bases de datos'),
  ('NetBeans + JDK', 'programa', 'Programación', 'gratuita', 'Sistemas · Aplicaciones'),
  ('Node.js', 'programa', 'Programación', 'gratuita', 'Sistemas · Programación'),
  ('Notepad++', 'programa', 'Programación', 'gratuita', null),
  ('OpenBoard', 'programa', 'Ofimática', 'gratuita', null),
  ('Oracle VirtualBox', 'programa', 'Virtualización', 'gratuita', 'Sistemas · Redes'),
  ('Passware Kit Forensic 2022', 'programa', 'Seguridad y forense', 'por_verificar', null),
  ('PostgreSQL', 'programa', 'Bases de datos', 'gratuita', 'Sistemas · Bases de datos'),
  ('Postman', 'programa', 'Programación', 'gratuita', 'Sistemas · Programación'),
  ('Proteus + librerías', 'programa', 'Electrónica', 'sin_licencia', 'Redes · Simulación electrónica'),
  ('PSeInt', 'programa', 'Programación', 'gratuita', 'Sistemas · Diagramas de flujo'),
  ('Pulsar', 'programa', 'Programación', 'gratuita', null),
  ('PuTTY', 'programa', 'Redes', 'gratuita', 'Redes · Emulador de terminal'),
  ('Python', 'programa', 'Programación', 'gratuita', 'Sistemas · Programación'),
  ('QuickTime', 'programa', 'Multimedia', 'gratuita', 'Reproductor multimedia'),
  ('Snowflake (cliente)', 'programa', 'Bases de datos', 'gratuita', 'Sistemas · Bases de datos en la nube'),
  ('StarUML', 'programa', 'Diseño y modelado', 'gratuita', 'Sistemas · Diagramas'),
  ('Tableau Public', 'programa', 'Estadística', 'gratuita', null),
  ('UltiMaker Cura', 'programa', 'Diseño y modelado', 'gratuita', 'Redes · Impresión 3D'),
  ('Unity', 'programa', 'Programación', 'gratuita', 'Grupo de investigación · Redes y Sistemas'),
  ('Vectorworks', 'programa', 'Diseño y modelado', 'educativa', 'Ingeniería Industrial'),
  ('Visual Studio Code', 'programa', 'Programación', 'gratuita', 'Sistemas · Programación'),
  ('Visual Studio Community 2012', 'programa', 'Programación', 'gratuita', 'Sistemas · Programación'),
  ('Visual Studio Community 2022', 'programa', 'Programación', 'gratuita', 'Sistemas · Programación'),
  ('VMware VIX', 'programa', 'Virtualización', 'gratuita', null),
  ('VMware Workstation', 'programa', 'Virtualización', 'gratuita', 'Sistemas · Virtualización'),
  ('WinRAR', 'programa', 'Utilidades', 'gratuita', 'Todas las carreras'),
  ('Wireshark', 'programa', 'Redes', 'gratuita', 'Redes · Analizador de tráfico'),
  ('Wondershare Filmora', 'programa', 'Multimedia', 'sin_licencia', null),
  ('XAMPP', 'programa', 'Programación', 'gratuita', 'Sistemas · Páginas web'),
  ('XMind', 'programa', 'Ofimática', 'gratuita', 'Mapas conceptuales'),
  ('ZinjaI', 'programa', 'Programación', 'gratuita', 'Sistemas · Programación'),
  ('Zoom', 'programa', 'Comunicación', 'gratuita', 'Videoconferencias (PC docente)')
on conflict do nothing;

-- Sistemas operativos e ISOs (44)
insert into public.software (nombre, tipo, categoria, licencia) values
  ('Windows 11', 'iso', 'Windows', 'comercial'),
  ('Windows 10', 'iso', 'Windows', 'comercial'),
  ('Windows Server 2025', 'iso', 'Windows', 'comercial'),
  ('Windows Server 2022', 'iso', 'Windows', 'comercial'),
  ('Windows Server 2019', 'iso', 'Windows', 'comercial'),
  ('Ubuntu Desktop', 'iso', 'Linux', 'gratuita'),
  ('Ubuntu Server', 'iso', 'Linux', 'gratuita'),
  ('Kubuntu', 'iso', 'Linux', 'gratuita'),
  ('Xubuntu', 'iso', 'Linux', 'gratuita'),
  ('Lubuntu', 'iso', 'Linux', 'gratuita'),
  ('Debian', 'iso', 'Linux', 'gratuita'),
  ('Linux Mint', 'iso', 'Linux', 'gratuita'),
  ('Fedora Workstation', 'iso', 'Linux', 'gratuita'),
  ('Fedora Server', 'iso', 'Linux', 'gratuita'),
  ('Rocky Linux', 'iso', 'Linux', 'gratuita'),
  ('AlmaLinux', 'iso', 'Linux', 'gratuita'),
  ('CentOS Stream', 'iso', 'Linux', 'gratuita'),
  ('Red Hat Enterprise Linux', 'iso', 'Linux', 'comercial'),
  ('openSUSE Leap', 'iso', 'Linux', 'gratuita'),
  ('Arch Linux', 'iso', 'Linux', 'gratuita'),
  ('Manjaro', 'iso', 'Linux', 'gratuita'),
  ('Pop!_OS', 'iso', 'Linux', 'gratuita'),
  ('Zorin OS', 'iso', 'Linux', 'gratuita'),
  ('elementary OS', 'iso', 'Linux', 'gratuita'),
  ('Alpine Linux', 'iso', 'Linux', 'gratuita'),
  ('Raspberry Pi OS', 'iso', 'Linux', 'gratuita'),
  ('Kali Linux', 'iso', 'Seguridad', 'gratuita'),
  ('Parrot Security OS', 'iso', 'Seguridad', 'gratuita'),
  ('Tails', 'iso', 'Seguridad', 'gratuita'),
  ('Metasploitable 2', 'iso', 'Seguridad', 'gratuita'),
  ('Proxmox VE', 'iso', 'Servidores y virtualización', 'gratuita'),
  ('VMware ESXi', 'iso', 'Servidores y virtualización', 'comercial'),
  ('TrueNAS', 'iso', 'Servidores y virtualización', 'gratuita'),
  ('pfSense', 'iso', 'Redes', 'gratuita'),
  ('OPNsense', 'iso', 'Redes', 'gratuita'),
  ('MikroTik RouterOS (CHR)', 'iso', 'Redes', 'gratuita'),
  ('FreeBSD', 'iso', 'Unix', 'gratuita'),
  ('ChromeOS Flex', 'iso', 'Otros', 'gratuita'),
  ('Android-x86', 'iso', 'Otros', 'gratuita'),
  ('Hiren''s BootCD PE', 'iso', 'Herramientas de rescate', 'gratuita'),
  ('Clonezilla Live', 'iso', 'Herramientas de rescate', 'gratuita'),
  ('GParted Live', 'iso', 'Herramientas de rescate', 'gratuita'),
  ('SystemRescue', 'iso', 'Herramientas de rescate', 'gratuita'),
  ('Medicat', 'iso', 'Herramientas de rescate', 'gratuita')
on conflict do nothing;

-- Qué tiene instalado cada laboratorio (332 instalaciones)
insert into public.laboratorio_software (ambiente_id, software_id)
select am.id, s.id from (values
  ('LAB-01', array['Adobe Acrobat Reader', 'Apache HTTP Server', 'Arduino IDE', 'ChatGPT (aplicación)', 'Cisco Packet Tracer', 'Enterprise Architect', 'Epi Info 7.2', 'FileMaker Pro 19', 'Flowgorithm', 'Git', 'Google Chrome', 'IBM SPSS Statistics', 'Laragon', 'Lazarus IDE', 'Logisim', 'Microsoft Office 2016', 'Microsoft SQL Server 2019', 'Mozilla Firefox', 'NetBeans + JDK', 'OpenBoard', 'Oracle VirtualBox', 'PSeInt', 'Passware Kit Forensic 2022', 'PostgreSQL', 'Proteus + librerías', 'PuTTY', 'Python', 'QuickTime', 'StarUML', 'Vectorworks', 'Visual Studio Code', 'Visual Studio Community 2012', 'WinRAR', 'XAMPP', 'ZinjaI', 'Zoom']),
  ('LAB-02', array['Adobe Acrobat Reader', 'Apache HTTP Server', 'Arduino IDE', 'Cisco Packet Tracer', 'ContXH32', 'DelfiNET', 'Enterprise Architect', 'Google Chrome', 'Honeygain', 'IBM SPSS Statistics 23', 'Laragon', 'Logisim', 'Microsoft Office 2016', 'Microsoft SQL Server 2019', 'Minitab', 'Mozilla Firefox', 'NetBeans + JDK', 'Oracle VirtualBox', 'PSeInt', 'PostgreSQL', 'Proteus + librerías', 'Python', 'QuickTime', 'StarUML', 'Vectorworks', 'Visual Studio Code', 'Visual Studio Community 2022', 'WinRAR', 'XAMPP', 'ZinjaI']),
  ('LAB-03', array['Adobe Acrobat Reader', 'Apache HTTP Server', 'Arduino IDE', 'Cisco Packet Tracer', 'DobotVisionStudio', 'Enterprise Architect', 'GNS3', 'Google Chrome', 'Laragon', 'Logisim', 'Logisim Evolution', 'Microsoft Office 2016', 'Microsoft SQL Server 2019', 'Minitab', 'Mozilla Firefox', 'MySQL Server', 'NetBeans + JDK', 'Notepad++', 'Oracle VirtualBox', 'PSeInt', 'PostgreSQL', 'Proteus + librerías', 'PuTTY', 'Python', 'StarUML', 'UltiMaker Cura', 'VMware Workstation', 'Visual Studio Code', 'Visual Studio Community 2022', 'WinRAR', 'Wireshark', 'XAMPP', 'ZinjaI', 'Zoom']),
  ('LAB-04', array['Adobe Acrobat Reader', 'Adobe Illustrator', 'Apache HTTP Server', 'Arduino IDE', 'Aspen Plus', 'Circuit Wizard', 'Cisco Packet Tracer', 'Crocodile Clips', 'DBeaver', 'Enterprise Architect', 'Git', 'GitHub Desktop', 'Google Chrome', 'IBM SPSS Statistics 21', 'Laragon', 'Logisim', 'Microsoft Office 2016', 'Microsoft SQL Server 2019', 'Minitab', 'Mozilla Firefox', 'NetBeans + JDK', 'Node.js', 'Oracle VirtualBox', 'PSeInt', 'PostgreSQL', 'Proteus + librerías', 'Python', 'QuickTime', 'Snowflake (cliente)', 'StarUML', 'Tableau Public', 'Unity', 'Visual Studio Code', 'Visual Studio Community 2022', 'WinRAR', 'Wireshark', 'XAMPP', 'XMind', 'ZinjaI']),
  ('LAB-05', array['Adobe Acrobat Reader', 'Adobe Creative Cloud', 'Android Studio', 'Apache HTTP Server', 'Arduino IDE', 'AutoCAD', 'Autodesk Access', 'Cisco Packet Tracer', 'Code::Blocks', 'Enterprise Architect', 'FileZilla', 'Flowgorithm', 'Git', 'Google Chrome', 'Laragon', 'Logisim', 'Logisim Evolution', 'Microsoft Office 2016', 'Microsoft SQL Server 2019', 'MindManager', 'Minitab', 'Mozilla Firefox', 'MySQL Server', 'NetBeans + JDK', 'Node.js', 'Oracle VirtualBox', 'PSeInt', 'PostgreSQL', 'Postman', 'Proteus + librerías', 'Pulsar', 'Python', 'Snowflake (cliente)', 'StarUML', 'Vectorworks', 'Visual Studio Code', 'Visual Studio Community 2022', 'WinRAR', 'XAMPP', 'ZinjaI', 'balenaEtcher']),
  ('LAB-06', array['Adobe Acrobat Reader', 'Apache HTTP Server', 'Arduino IDE', 'Cisco Packet Tracer', 'Enterprise Architect', 'FileZilla', 'Google Chrome', 'Laragon', 'Logisim', 'Microsoft Office 2016', 'Microsoft SQL Server 2019', 'Mozilla Firefox', 'NetBeans + JDK', 'Oracle VirtualBox', 'PSeInt', 'PostgreSQL', 'Proteus + librerías', 'Python', 'StarUML', 'VMware Workstation', 'Visual Studio Code', 'Visual Studio Community 2022', 'WinRAR', 'XAMPP', 'ZinjaI']),
  ('LAB-07', array['7-Zip', 'Adobe Acrobat Reader', 'Adobe Illustrator', 'Adobe Photoshop', 'Apache HTTP Server', 'Arduino IDE', 'Cisco Packet Tracer', 'DBeaver', 'EaseUS RecExperts', 'Enterprise Architect', 'GNS3', 'Git', 'Google Chrome', 'IBM SPSS Statistics 23', 'Laragon', 'Logisim', 'Microsoft Office 2016', 'Microsoft SQL Server 2019', 'Mozilla Firefox', 'NetBeans + JDK', 'Oracle VirtualBox', 'PSeInt', 'PostgreSQL', 'Proteus + librerías', 'Python', 'StarUML', 'VMware VIX', 'Visual Studio Code', 'Visual Studio Community 2022', 'WinRAR', 'Wireshark', 'XAMPP', 'ZinjaI']),
  ('LAB-08', array['Adobe Acrobat Reader', 'Apache HTTP Server', 'Arduino IDE', 'Cisco Packet Tracer', 'Enterprise Architect', 'Google Chrome', 'Laragon', 'Logisim', 'Microsoft Office 2016', 'Microsoft SQL Server 2019', 'Mozilla Firefox', 'NetBeans + JDK', 'Oracle VirtualBox', 'PSeInt', 'PostgreSQL', 'Proteus + librerías', 'Python', 'StarUML', 'Visual Studio Code', 'Visual Studio Community 2022', 'WinRAR', 'XAMPP', 'ZinjaI']),
  ('LAB-09', array['Adobe Acrobat Reader', 'Android Studio', 'Apache HTTP Server', 'ApowerREC', 'Arduino IDE', 'Brave', 'Circuit Wizard', 'Cisco Packet Tracer', 'Enterprise Architect', 'Git', 'Google Chrome', 'IBM SPSS Statistics 23', 'IntelliJ IDEA', 'Laragon', 'Logisim', 'Microsoft Office 2016', 'Microsoft SQL Server 2019', 'Minitab', 'Mozilla Firefox', 'NetBeans + JDK', 'Node.js', 'Oracle VirtualBox', 'PSeInt', 'PostgreSQL', 'Proteus + librerías', 'Pulsar', 'Python', 'StarUML', 'VMware Workstation', 'Vectorworks', 'Visual Studio Code', 'Visual Studio Community 2022', 'WinRAR', 'Wondershare Filmora', 'XAMPP', 'ZinjaI']),
  ('LAB-10', array['Adobe Acrobat Reader', 'Android Studio', 'Apache HTTP Server', 'ApowerREC', 'Arduino IDE', 'Brave', 'Cisco Packet Tracer', 'Enterprise Architect', 'Git', 'Google Chrome', 'IBM SPSS Statistics 23', 'IntelliJ IDEA', 'Laragon', 'Logisim', 'Microsoft Office 2016', 'Microsoft SQL Server 2019', 'Minitab', 'Mozilla Firefox', 'NetBeans + JDK', 'Node.js', 'Oracle VirtualBox', 'PSeInt', 'PostgreSQL', 'Proteus + librerías', 'Pulsar', 'Python', 'StarUML', 'VMware Workstation', 'Vectorworks', 'Visual Studio Code', 'Visual Studio Community 2022', 'WinRAR', 'Wondershare Filmora', 'XAMPP', 'ZinjaI'])
) as x(codigo, programas)
cross join lateral unnest(x.programas) p(nombre)
join public.ambientes am on am.codigo = x.codigo
join public.software s on lower(s.nombre) = lower(p.nombre)
on conflict do nothing;

-- En la hoja "Programas x Carrera" pero sin laboratorio asignado
insert into public.software (nombre, tipo, categoria, licencia, uso) values
  ('Microsoft Teams', 'programa', 'Comunicación', 'gratuita', 'Videoconferencias (PC docente)')
on conflict do nothing;

-- 5) Aviso del linter (script 47): search_path fijo
alter function public.fn_unidad_ticket(text, uuid, bigint) set search_path = public;
