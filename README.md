# Sistema de Asignación de Laboratorios — UPDS

Aplicación web en **Angular 22** + **Supabase** (PostgreSQL) para asignar laboratorios y aulas
con calendario, controlar cesiones entre docentes, eventos y defensas con prioridad, y detectar
choques automáticamente.

## Funcionalidades

El menú tiene solo **4 pantallas**. Todo lo demás se hace con clics y los formularios se abren como **paneles laterales**, sin cambiar de página.

| Pantalla | Qué hace |
|---|---|
| **Laboratorios** | Tarjetas por laboratorio con los bloques del día (libre / ocupado) y el estado **en vivo**, más una vista de **grilla**. **Clic en un laboratorio** abre su panel con la semana completa y las clases asignadas, cada una con sus botones **Ceder** y **Editar**. |
| **Calendario** | Mes / semana / día / agenda, con filtros. Arrastre sobre un horario libre para crear un evento, una defensa o una clase. Clic en una clase: reubicar, suspender, ceder o editar. |
| **Registros** | Pestañas: Asignaciones, Cesiones, Eventos y defensas, y Conflictos. Exporta a Excel. |
| **Configuración** | Pestañas: Laboratorios y aulas, Docentes, Materias, Carreras, Feriados y Usuarios (solo admin). |

### Asignación de una clase
1. Elija el **sistema** con los botones:
   - **Modular presencial / semipresencial**: haga **clic en los días** de clase en el calendario (se ven 2 meses a la vez). Marque el primero y pulse **«Completar 20 días»** (o 4 sábados) para llenar el módulo saltando los feriados.
   - **Semestral**: ponga la **fecha de inicio** y el fin se calcula solo (**6 meses**). Se puede extender unos días, pero **nunca llegar a 7 meses** (lo valida también la base de datos).
2. Carrera, docente, materia y grupo.
3. Horario: días de la semana, bloque (u hora manual) y laboratorio. El sistema **verifica choques al momento** y sugiere los laboratorios **libres en todos esos días**.

### Ceder un laboratorio
Clic en el laboratorio → en la clase, **Ceder** → marque **qué días se va** el docente (solo se habilitan sus días reales de clase; los ya cedidos aparecen bloqueados) → escriba **a qué aula se va** (ej. C-29) → elija **qué docente viene** y **qué materia** viene a dictar → listo.

> El sistema maneja **solo laboratorios**. El aula a la que va el docente que cede es un dato informativo: no se controla su ocupación.

### Eventos y defensas
Tienen **prioridad**: si chocan con clases, el sistema **obliga** a elegir a qué laboratorio se mueve cada docente afectado (o suspender la clase) antes de guardar.

**Roles (4):**
- `admin` — todo, incluida la gestión de usuarios y la asignación de roles.
- `decano` — gestiona los **horarios de clase** (asignaciones, cesiones, eventos y defensas).
- `encargado` — supervisa la **operación** (turnos, atenciones, mantenimiento) y también edita horarios.
- `auxiliar` — abre/cierra su **turno**, registra **atenciones** y **mantenimiento**, y **solo ve** los horarios.

El menú de **operación** tiene tres apartados independientes:
- **Reporte de turno** — cada turno deja sus **novedades** y una lista de **tareas pendientes**; el siguiente turno las ve arriba y las va marcando como hechas.
- **Atenciones** — **tickets**: se elige el laboratorio, el tipo, el **motivo** y la **solución**, y se marcan en el **croquis** las PCs donde se hizo. Cada PC marcada es un ticket (20 PCs = 20 tickets), y en la lista se ven agrupados. La solución es opcional y el estado (resuelto / en proceso / pendiente) se elige aparte. En peticiones, soporte académico, etc. el laboratorio y las PCs son opcionales. Se pueden marcar **colaboradores** (otros auxiliares que ayudaron).
- **Desempeño** (admin y encargado) — dashboard del mes: tickets por día, ranking de auxiliares (registró / colaboró), qué tipo de trabajos se hicieron, PCs por estado en cada laboratorio, detalle por auxiliar y PCs con más tickets. Exporta a Excel.
- **Auxiliares** (admin y encargado) — listado del equipo con su **turno habitual** (se rota cada mes) y la **rotación de sábados**.

En **Laboratorios**, al tocar un laboratorio se abre su **croquis** dibujado como el plano real: la mesa del docente (`PCDOCENTE1`) a la izquierda y mesas de 4 PCs **SCPC** (SCPC + nº de lab + nº de máquina: LAB-01 → `SCPC101`…`SCPC130`, LAB-02 → `SCPC201`…). Se toca una PC para marcarla **activa / inactiva / mantenimiento / de baja**, o **Cambiar varias** para marcar muchas a la vez. **Generar PCs** las crea en lote y luego **Agregar más PCs** sigue la numeración.

### Reglas que valida la base de datos (aunque se escriba directo en Supabase)
- El mismo laboratorio no puede estar ocupado a la misma hora por docentes distintos.
- El mismo docente no puede estar en dos ambientes a la vez. Si coincide en el mismo ambiente y a la misma hora, se toma como grupos fusionados y se permite.
- Un evento o defensa no se guarda si choca con una clase y no se la reubicó.
- Semestral: duración menor a 7 meses. Modular: solo los días permitidos (presencial de lunes a viernes, semipresencial solo sábados).
- Solo se cede en días reales de clase, y el mismo día no se puede ceder dos veces.
- En los feriados no se generan clases.

---

## 1. Base de datos en Supabase (manual)

1. Cree un proyecto en <https://supabase.com>.
2. Vaya a **SQL Editor** y ejecute **en este orden** el contenido de cada archivo de la carpeta `supabase/`:

   | Orden | Archivo | Contenido |
   |---|---|---|
   | 0 | `00_reiniciar.sql` | **Solo si ya instaló una versión anterior:** borra las tablas y funciones del sistema (¡y sus datos!) |
   | 1 | `01_esquema.sql` | Tablas, relaciones e índices |
   | 2 | `02_funciones.sql` | Ocupación, choques, validaciones (triggers) y RPC |
   | 3 | `03_seguridad.sql` | Perfiles, roles, RLS y creación de usuarios |
   | 4 | `04_datos_iniciales.sql` | Sistemas (modular y semestral), bloques horarios, tipos de reserva, LAB-01…LAB-10, carreras y feriados |
   | 5 | `05_datos_ejemplo.sql` | **Opcional:** datos de octubre 2026 tomados del Excel (incluye las cesiones reales) |
   | 6 | `06_ajustes_supabase.sql` | Ajustes de seguridad y rendimiento recomendados por el Advisor de Supabase |
   | 7 | `07_cesion_aula_texto.sql` | Solo laboratorios: en la cesión, el aula a la que va el docente se guarda como texto |
   | 8 | `08_inventario_pcs.sql` | Inventario de PCs por laboratorio |
   | 9 | `09_reubicacion_aula_texto.sql` | Reubicación: el aula destino se guarda como texto |
   | 10 | `10_roles_y_operacion.sql` | **4 roles** (agrega `encargado`), permisos académico/operación, turnos de trabajo, atenciones y generador de PCs `SCPC` |
   | 11 | `11_usuarios_prueba.sql` | **Opcional:** un usuario de prueba por rol (credenciales solo en local, no se incluyen en el repo). Bórralos antes de producción |
   | 12 | `12_tickets_auxiliares_croquis.sql` | Tickets (tipo + alcance), estados de PC (activa/inactiva/mantenimiento/baja), rotación de sábados y asignación de turnos |
   | 13 | `13_croquis_tickets_reporte_turno.sql` | PC docente (`PCDOCENTE1`), generar PCs a continuación de las existentes, tickets con **solución** y **lote** (varias PCs), y **reporte de turno** (novedades + tareas pendientes) |
   | 14 | `14_colaboradores_tickets.sql` | **Colaboradores** en los tickets (otros auxiliares que ayudaron) |
   | 15 | `15_dashboard_desempeno.sql` | Función `fn_dashboard_operacion` para el **dashboard de desempeño** |
   | 16 | `16_google_invitado_limites.sql` | Rol **invitado** para quien entra con Google (sin acceso hasta que el admin le asigne rol) y **límites de largo** en los textos |
   | 17 | `17_cesion_varios_horarios.sql` | **Ceder varios horarios a la vez** (ej. jueves y viernes): cesiones agrupadas por **lote** y `rpc_guardar_cesiones`; el bloque cedido se titula con la materia de quien viene |
   | 18 | `18_dashboard_uso_labs.sql` | Función `fn_dashboard_uso` (**solo admin**): materias y eventos que más ocupan los laboratorios, horas por laboratorio, actividades de auxiliares por laboratorio y pedidos más frecuentes |
   | 19 | `19_eventos_categoria_defensa.sql` | **Evento** con categoría (taller, conferencia, capacitación, otros); **defensa** solo con facultad y descripción (nombre automático) |
   | 20 | `20_evento_mueve_cesion.sql` | Un **evento puede mover una clase cedida**: la cesión respeta la reubicación de ese día |
   | 21 | `21_pcs_baja_tickets_turno.sql` | **Baja de PC con motivo** (quién y cuándo), **tickets solo en PCs activas** y el reporte de turno guarda **en qué turno se hizo** |
   | 22 | `22_estado_pc_controlado.sql` | **Solo admin y encargado cambian el estado de las PCs** (`rpc_cambiar_estado_pcs`); cada cambio deja un **ticket "Cambio de estado de PC"** con quién, de qué estado a cuál y qué se reparó / por qué |
   | 23 | `23_tickets_categorias.sql` | **Tickets en 3 categorías** (atención a docente · técnico: programas, mant. preventivo y correctivo · atención personal) con `detalles` por formulario; tickets viejos migrados; el auxiliar repara (cambia estado) y **solicita la baja**, que aprueba admin/encargado (`solicitudes_baja`, `rpc_resolver_baja`) |
   | 24 | `24_reporte_turno_bloqueo.sql` | Reportes de turno: se **editan** (autor, admin o encargado) pero **no se eliminan si tienen tareas hechas**; una tarea hecha queda fija (solo admin/encargado la desmarca) |
   | 25 | `25_objetos_perdidos.sql` | **Objetos perdidos**: registro con foto, laboratorio, fecha y hora; **entrega con foto** (a quién, cuándo, quién entregó); bucket privado `objetos-perdidos` en Storage |
  | 26 | `26_turnos_programados.sql` | **Turnos por fecha**: el admin/encargado programa el turno de cada auxiliar **a partir de una fecha**; el auxiliar ve su turno **actual** y su **próximo** turno en Reporte de turno |
  | 27 | `27_cerrar_turno_horario.sql` | **Cerrar turno**: el auxiliar cierra y edita su reporte **solo durante su turno**; admin y encargado de auxiliares cierran en cualquier turno. Menú **Horario** para ver turno actual y próximo |
  | 28 | `28_reporte_turno_foto.sql` | **Foto al cerrar turno** (armario de llaves): bucket privado `reportes-turno`; la foto **vence a las 12:00** (La Paz) siguientes y se borra, la descripción y las tareas se quedan |
  | 29 | `29_horarios_turno.sql` | **Horario de cada turno editable** (admin y encargado): Mañana 07:00–12:00, Mediodía 12:00–16:00, Tarde 14:30–18:30, Noche 18:00–22:00. El auxiliar cierra desde que empieza su turno; si cierra tarde, el reporte guarda **los minutos de retraso** |
  | 30 | `30_objetos_perdidos_fotos_9_meses.sql` | **Fotos de objetos perdidos se borran a los 9 meses** de registrado el objeto (la del objeto y la de la entrega); el registro se queda con `fotos_borradas_en` |
  | 31 | `31_pcs_baja_auxiliar.sql` | **Eliminar PCs solo admin y encargado**; cualquier auxiliar **da de baja** (con motivo) y reactiva; **correctivo permitido en PCs de baja**; salir de baja **siempre deja ticket**; el cierre de turno guarda las **PCs que su autor dio de baja en el turno** (`pcs_baja`) |
  | 32 | `32_dashboard_detallado.sql` | **Dashboard detallado** (admin y encargado): uso por día / día de la semana / hora, carreras y docentes, tickets por turno y día, tiempo de resolución, cierres a tiempo y con retraso, PCs dadas de baja y reactivadas, objetos perdidos (`fn_dashboard_detalle`); "Uso de laboratorios" también para el encargado |
  | 33 | `33_fichas_reparacion.sql` | **Ficha de reparación por PC**: catálogo de fallas (`fallas_pc`, lo mantienen admin y encargado), cada PC queda como **correctivo** con sus fallas (varias u "Otra"), diagnóstico, corrección, pieza (opcional) y estado anterior → final (`rpc_registrar_reparaciones`, la usan Atenciones y el croquis); `fn_dashboard_fallas` (fallas más repetidas, "otras", piezas, PCs reincidentes) |
  | 34 | `34_asignacion_reubica_choques.sql` | **Asignar una clase aunque algunos días el laboratorio esté ocupado** (evento planificado u otra clase): esos días la clase se **reubica** a otro laboratorio libre o a un aula, en la misma operación (`rpc_guardar_asignacion` con `reubicaciones`); el calendario los pinta en ámbar |
  | 35 | `35_completar_cuenta.sql` | **Completar la cuenta al recibir un rol**: quien entró con Google, la primera vez que tiene rol confirma su nombre y crea una contraseña (pantalla `/completar-cuenta`), para entrar también con correo y contraseña (`perfiles.cuenta_completa`, `rpc_completar_cuenta`) |
  | 41 | `41_ticket_fuera_de_turno.sql` | **Ticket fuera de turno**: cada ticket guarda si el auxiliar lo registró fuera de su turno del día (sábado incluido, hora de La Paz) en `atenciones.fuera_de_turno`; lo calcula un trigger al crear (no se puede editar) y se recalculó para los tickets ya registrados. Admin y encargado nunca salen fuera de turno |

3. **Primer administrador**
   - **Authentication → Users → Add user**: correo y contraseña, con *Auto Confirm User* marcado.
   - En el SQL Editor (cambie el correo):
     ```sql
     update public.perfiles set rol = 'admin', activo = true, nombre_completo = 'Administrador'
      where correo = 'admin@upds.edu.bo';
     ```
   - Desde la app, el admin crea al resto de los usuarios en **Usuarios**.
4. **Inicio con Google** (las cuentas nuevas entran como **invitado**, sin acceso a nada, y ven una pantalla de espera hasta que el admin les asigna un rol en Configuración → Usuarios; al asignarlo entran solas):
   1. En <https://console.cloud.google.com> → **APIs y servicios → Credenciales → Crear credenciales → ID de cliente OAuth** (tipo *Aplicación web*).
      - *Orígenes de JavaScript autorizados*: `http://localhost:4200` y el dominio de producción.
      - *URI de redireccionamiento autorizados*: `https://<su-proyecto>.supabase.co/auth/v1/callback`.
   2. En Supabase → **Authentication → Sign In / Providers → Google**: actívelo y pegue el *Client ID* y el *Client Secret*.
   3. En Supabase → **Authentication → URL Configuration**: *Site URL* = la URL de la app; en *Redirect URLs* agregue `http://localhost:4200/**` y la de producción.
   4. Deje **activado "Allow new users to sign up"**: si no, Google no puede crear la cuenta la primera vez. Es seguro, porque toda cuenta nueva queda como invitado.

## 2. Configurar y ejecutar el frontend

1. En Supabase, copie **Project Settings → API → Project URL** y la **anon public key**.
2. Péguelos en `src/environments/environment.ts`:
   ```ts
   supabaseUrl: 'https://xxxx.supabase.co',
   supabaseAnonKey: 'eyJ...',
   ```
3. Instale y ejecute:
   ```bash
   npm install
   npm start            # http://localhost:4200
   ```
4. Para producción: `npm run build` genera `dist/sistema-laboratorios/browser`, que se puede publicar en cualquier hosting estático (Netlify, Vercel, Nginx…). Configure el servidor para que todas las rutas apunten a `index.html`.

## Estructura

```
supabase/                    Scripts SQL (ejecución manual)
src/app/core/                Servicios: Supabase, auth, catálogos, ocupación, fechas, modelos
src/app/compartido/          Componentes reutilizables: íconos (Lucide), panel lateral, modal,
                             buscador, calendario de fechas, detalle de ocupación, tabla CRUD
src/app/paginas/             Pantallas: panel (laboratorios), calendario, registros, configuración
                             y los formularios que se abren en panel lateral
```

## Modelo de datos (resumen)

- `asignaciones` (docente + materia + carrera + sistema + fecha inicio/fin) → `asignacion_fechas` (días marcados, solo en modular) y `asignacion_horarios` (día de la semana, horas y ambiente; un día puede tener otro laboratorio u otra hora).
- `cesiones` + `cesion_fechas`: quién recibe y en qué fechas.
- `reubicaciones`: excepción de una clase en una fecha concreta (otro ambiente, otra hora o suspendida). Las crean las cesiones, los eventos o el auxiliar.
- `reservas` + `reserva_horarios`: eventos, defensas o mantenimiento, por ambiente y fecha. Los tipos están en `tipos_reserva`, así que se pueden agregar nuevos tipos sin tocar código.
- `fn_ocupaciones(desde, hasta)` convierte todo en ocupaciones por fecha real. El calendario, las tarjetas y los choques se calculan a partir de esa función.
