/**
 * Modelos (interfaces) que reflejan las tablas y funciones de Supabase.
 * Los nombres de columnas vienen de la base (snake_case); las propiedades
 * propias del frontend usan camelCase.
 */

/** 'invitado' = entró con Google y espera que el admin le asigne un rol */
export type Rol = 'admin' | 'auxiliar' | 'decano' | 'encargado' | 'invitado';

/** Código de turno de trabajo */
export type TurnoCodigo = 'M' | 'MD' | 'T' | 'N';

/** Perfil del usuario del sistema */
export interface Perfil {
  id: string;
  nombre_completo: string;
  correo: string;
  rol: Rol;
  activo: boolean;
  /** Ya confirmó su nombre y creó contraseña (se pide al recibir un rol) */
  cuenta_completa: boolean;
  /** Turno habitual del auxiliar (solo informativo) */
  turno_habitual?: TurnoCodigo | null;
  /** Participa de la rotación del sábado */
  sabado_rotativo?: boolean;
}

export interface Carrera {
  id: number;
  nombre: string;
  sigla: string | null;
  color: string;
  activo: boolean;
}

export interface Docente {
  id: number;
  nombres: string;
  apellidos: string;
  carnet: string | null;
  telefono: string | null;
  correo: string | null;
  activo: boolean;
  /** Relaciones embebidas (opcionales según la consulta) */
  docente_carreras?: { carrera_id: number }[];
  docente_materias?: { materia_id: number }[];
}

export interface Materia {
  id: number;
  nombre: string;
  sigla: string | null;
  requiere_laboratorio: boolean;
  activo: boolean;
}

export type TipoAmbiente = 'laboratorio' | 'aula' | 'auditorio' | 'otro';
export type EstadoAmbiente = 'activo' | 'mantenimiento' | 'baja';

export interface Ambiente {
  id: number;
  codigo: string;
  nombre: string | null;
  tipo: TipoAmbiente;
  capacidad: number;
  tipo_equipo: string | null;
  ubicacion: string | null;
  estado: EstadoAmbiente;
  color: string;
  orden: number;
}

export type EstadoPc = 'operativa' | 'inactiva' | 'mantenimiento' | 'baja';

/** Una PC del inventario de un laboratorio */
export interface AmbientePc {
  id: number;
  ambiente_id: number;
  etiqueta: string;
  procesador: string | null;
  ram: string | null;
  almacenamiento: string | null;
  estado: EstadoPc;
  notas: string | null;
  orden: number;
  /** PC de la mesa del docente (PCDOCENTE1…) */
  es_docente: boolean;
  /** Solo si está de baja: por qué, cuándo y quién */
  motivo_baja: string | null;
  baja_en: string | null;
  baja_por: string | null;
  /** Último cambio de estado: quién, cuándo y qué se reparó / por qué */
  estado_por: string | null;
  estado_en: string | null;
  estado_detalle: string | null;
  cambio?: { nombre_completo: string } | null;
}

export interface SistemaAcademico {
  id: number;
  codigo: string;
  nombre: string;
  dias_permitidos: number[];
  /** 'dias' = se marcan los días (modular); 'rango' = inicio y fin (semestral) */
  modo_fechas: 'dias' | 'rango';
  meses_duracion: number | null;
  meses_maximo: number | null;
  dias_sugeridos: number | null;
  color: string;
  activo: boolean;
}

export interface BloqueHorario {
  id: number;
  nombre: string;
  turno: 'M' | 'MD' | 'T' | 'N';
  hora_inicio: string;
  hora_fin: string;
  orden: number;
}

export interface Feriado {
  fecha: string;
  descripcion: string;
}

export interface TipoReserva {
  id: number;
  codigo: string;
  nombre: string;
  prioridad: number;
  color: string;
}

export interface AsignacionHorario {
  id: number;
  asignacion_id: number;
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
  ambiente_id: number;
}

export interface Asignacion {
  id: number;
  sistema_id: number;
  docente_id: number;
  materia_id: number;
  carrera_id: number;
  grupo: string | null;
  fecha_inicio: string;
  fecha_fin: string;
  observacion: string | null;
  horarios?: AsignacionHorario[];
  /** Días marcados (solo modular) */
  fechas?: { fecha: string }[];
  docente?: Docente;
  materia?: Materia;
  carrera?: Carrera;
}

export interface Cesion {
  id: number;
  asignacion_horario_id: number;
  docente_receptor_id: number;
  carrera_receptor_id: number | null;
  materia_receptor: string | null;
  motivo: string;
  /** Aula a la que se va el docente que cede (texto) */
  aula_destino: string | null;
  /** Cesiones guardadas juntas (varios horarios de la misma clase) */
  lote: string;
  fechas?: { fecha: string }[];
  receptor?: Docente;
  horario?: AsignacionHorario & { asignacion?: Asignacion };
}

export interface ReservaHorario {
  id?: number;
  reserva_id?: number;
  ambiente_id: number;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
}

export interface Reserva {
  id: number;
  tipo_id: number;
  titulo: string;
  descripcion: string | null;
  responsable: string | null;
  carrera_id: number | null;
  /** Solo eventos: taller, conferencia, capacitacion u otros */
  categoria: string | null;
  horarios?: ReservaHorario[];
  reubicaciones?: Reubicacion[];
  tipo?: TipoReserva;
}

export interface Reubicacion {
  id: number;
  asignacion_horario_id: number;
  fecha: string;
  ambiente_destino_id: number | null;
  /** Aula (texto libre) a la que va el docente; no se controla su ocupación */
  aula_destino: string | null;
  hora_inicio: string | null;
  hora_fin: string | null;
  motivo: string;
  reserva_id: number | null;
  cesion_id: number | null;
}

// ---------------------------------------------------------------------
//  OPERACIÓN DE AUXILIARES: turnos, atenciones y mantenimiento
// ---------------------------------------------------------------------

export type EstadoTurno = 'abierto' | 'cerrado';

/** Jornada de trabajo del grupo de auxiliares (se abre y se cierra) */
export interface TurnoTrabajo {
  id: number;
  fecha: string;
  turno: TurnoCodigo;
  es_sabado_rotativo: boolean;
  estado: EstadoTurno;
  auxiliar_apertura_id: string | null;
  abierto_en: string;
  notas_apertura: string | null;
  auxiliar_cierre_id: string | null;
  cerrado_en: string | null;
  notas_cierre: string | null;
  /** Relaciones embebidas (opcionales según la consulta) */
  apertura?: { nombre_completo: string } | null;
  cierre?: { nombre_completo: string } | null;
}

/** Tipo de ticket (atención) */
/** Tipos de ticket (ver core/tickets.ts: categorías y formularios) */
export type TipoAtencion =
  | 'docente' | 'programas' | 'preventivo' | 'correctivo' | 'personal'
  /** Abrir / cerrar el laboratorio (con todas sus PCs) */
  | 'apertura_lab' | 'cierre_lab'
  /** Automático: lo deja el sistema al cambiar el estado de una PC */
  | 'cambio_estado';
export type EstadoAtencion = 'pendiente' | 'en_proceso' | 'resuelto';
/** Un ticket es individual (una PC/persona) o grupal (todo el lab / varios) */
export type AlcanceAtencion = 'individual' | 'grupal';

/** Ticket: pedido de un docente o trabajo del día (lo no resuelto es el pase de turno) */
export interface Atencion {
  id: number;
  turno_trabajo_id: number | null;
  ambiente_id: number | null;
  pc_id: number | null;
  docente_id: number | null;
  solicitante: string | null;
  tipo: TipoAtencion;
  alcance: AlcanceAtencion;
  /** Motivo del ticket */
  descripcion: string;
  /** Qué se hizo para resolverlo */
  solucion: string | null;
  /** Tickets creados juntos (una tarea en varias PCs) comparten el lote */
  lote: string | null;
  /** Otros auxiliares que ayudaron (ids de perfiles) */
  colaboradores: string[];
  /** Datos propios del formulario de cada tipo (DetallesTicket) */
  detalles: Record<string, unknown>;
  /** 1 = alta · 2 = media · 3 = baja */
  prioridad: number;
  estado: EstadoAtencion;
  auxiliar_id: string | null;
  creado_en: string;
  resuelto_por: string | null;
  resuelto_en: string | null;
  /** Ficha de reparación (correctivo): fallas del catálogo, otra falla, pieza y estados */
  fallas?: number[];
  falla_otra?: string | null;
  pieza?: string | null;
  estado_anterior?: EstadoPc | null;
  estado_final?: EstadoPc | null;
  /** Relaciones embebidas */
  ambiente?: { codigo: string } | null;
  pc?: { etiqueta: string } | null;
  docente?: { nombres: string; apellidos: string } | null;
  autor?: { nombre_completo: string } | null;
}

/** Tarea pendiente que deja un reporte de turno */
export interface TareaReporte {
  id: number;
  reporte_id: number;
  ambiente_id: number | null;
  descripcion: string;
  hecha: boolean;
  hecha_por: string | null;
  hecha_en: string | null;
  creado_en: string;
  /** Relaciones embebidas */
  ambiente?: { codigo: string } | null;
  ejecutor?: { nombre_completo: string } | null;
  reporte?: { turno: TurnoCodigo; fecha: string; autor?: { nombre_completo: string } | null } | null;
}

/** Reporte que deja cada turno: novedades y tareas pendientes */
/** Objeto encontrado en un laboratorio (con foto) y su entrega (con foto) */
export interface ObjetoPerdido {
  id: number;
  nombre: string;
  descripcion: string | null;
  ambiente_id: number;
  encontrado_en: string;
  encontrado_por: string | null;
  /** null cuando la foto ya se borró por antigüedad (9 meses) */
  foto_path: string | null;
  fotos_borradas_en?: string | null;
  estado: 'en_custodia' | 'entregado';
  entregado_a: string | null;
  entregado_documento: string | null;
  entregado_en: string | null;
  entregado_por: string | null;
  foto_entrega_path: string | null;
  observacion_entrega: string | null;
  /** Relaciones embebidas */
  ambiente?: { codigo: string; color: string } | null;
  encontro?: { nombre_completo: string } | null;
  entrego?: { nombre_completo: string } | null;
}

/** Pedido de un auxiliar para dar de baja una PC (lo resuelve admin/encargado) */
export interface SolicitudBaja {
  id: number;
  pc_id: number;
  atencion_id: number | null;
  motivo: string;
  estado: 'pendiente' | 'aprobada' | 'rechazada';
  solicitado_por: string | null;
  solicitado_en: string;
  respuesta: string | null;
  pc?: { etiqueta: string; ambiente?: { codigo: string } | null } | null;
  autor?: { nombre_completo: string } | null;
}

export interface ReporteTurno {
  id: number;
  fecha: string;
  turno: TurnoCodigo;
  /** Turno en que se hizo el reporte (por la hora de La Paz) */
  turno_realizado: TurnoCodigo | null;
  auxiliar_id: string | null;
  novedades: string | null;
  creado_en: string;
  /** PCs que el autor dio de baja durante el turno (las pone la base al cerrar) */
  pcs_baja?: PcBajaCierre[];
  /** Horario que tenía el turno al cerrarse y minutos de retraso del cierre */
  hora_inicio_turno?: string | null;
  hora_fin_turno?: string | null;
  minutos_retraso?: number | null;
  /** Foto del cierre (armario de llaves); se borra a las 12:00 siguientes */
  foto_path?: string | null;
  foto_expira?: string | null;
  /** Relaciones embebidas */
  autor?: { nombre_completo: string } | null;
  tareas?: TareaReporte[];
}

/** Falla del catálogo para la ficha de reparación */
export type CategoriaFalla = 'hardware' | 'software' | 'perifericos' | 'red' | 'otro';
export interface FallaPc {
  id: number;
  nombre: string;
  categoria: CategoriaFalla;
  activo: boolean;
  orden: number;
}

/** Una ficha de reparación de una PC (lo que se manda a rpc_registrar_reparaciones) */
export interface FichaReparacion {
  pc_id: number;
  fallas: number[];
  falla_otra: string;
  diagnostico: string;
  correccion: string;
  pieza: string;
  estado_final: EstadoPc | null;
}

/** PC dada de baja que aparece en un cierre de turno */
export interface PcBajaCierre {
  etiqueta: string;
  lab: string | null;
  motivo: string | null;
  en: string;
}

/** Hora de inicio y fin de un turno (editable por admin y encargado) */
export interface HorarioTurno {
  turno: TurnoCodigo;
  /** 'HH:MM:SS' */
  hora_inicio: string;
  hora_fin: string;
}

/** Turno de un auxiliar a partir de una fecha (el vigente es el más reciente que ya llegó) */
export interface TurnoProgramado {
  id: number;
  perfil_id: string;
  turno: TurnoCodigo;
  /** 'YYYY-MM-DD' */
  desde: string;
  /** Relación embebida */
  perfil?: { nombre_completo: string } | null;
}

/** Sábado de la rotación mensual (quién cubre y en qué turno) */
export interface RotacionSabado {
  id: number;
  fecha: string;
  auxiliar_id: string | null;
  turno: TurnoCodigo | null;
  nota: string | null;
  /** Relación embebida */
  auxiliar?: { nombre_completo: string } | null;
}

/** Fila devuelta por fn_ocupaciones */
export interface Ocupacion {
  clave: string;
  origen: 'clase' | 'cesion' | 'reserva';
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  ambiente_id: number;
  docente_id: number | null;
  asignacion_id: number | null;
  asignacion_horario_id: number | null;
  cesion_id: number | null;
  reserva_id: number | null;
  reserva_horario_id: number | null;
  reubicacion_id: number | null;
  carrera_id: number | null;
  titulo: string;
  detalle: string;
  color: string;
  prioridad: number;
  estado: string;
}

/** Fila devuelta por fn_verificar_choques */
export interface Choque {
  indice: number;
  tipo_choque: 'ambiente' | 'docente';
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  ambiente_id: number;
  docente_id: number | null;
  clave: string;
  origen: 'clase' | 'cesion' | 'reserva';
  titulo: string;
  detalle: string;
  asignacion_id: number | null;
  asignacion_horario_id: number | null;
  reserva_id: number | null;
  prioridad: number;
  mensaje: string;
  /** Horario completo de la ocupación existente */
  ocupacion_inicio: string;
  ocupacion_fin: string;
}

/** Fila devuelta por fn_conflictos */
export interface Conflicto {
  tipo_choque: 'ambiente' | 'docente';
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  ambiente_id: number | null;
  docente_id: number | null;
  clave_a: string; origen_a: string; titulo_a: string; detalle_a: string; ambiente_a: number;
  asignacion_a: number | null; horario_a: number | null; cesion_a: number | null; reserva_a: number | null;
  clave_b: string; origen_b: string; titulo_b: string; detalle_b: string; ambiente_b: number;
  asignacion_b: number | null; horario_b: number | null; cesion_b: number | null; reserva_b: number | null;
  mensaje: string;
}

/** Fila devuelta por fn_estado_ambientes */
export interface EstadoVivoAmbiente {
  ambiente_id: number;
  ocupado: boolean;
  titulo: string | null;
  detalle: string | null;
  origen: string | null;
  hora_inicio: string | null;
  hora_fin: string | null;
}

/** Candidato para fn_verificar_choques */
export interface CandidatoChoque {
  fecha?: string;
  dia_semana?: number;
  desde?: string;
  hasta?: string;
  hora_inicio: string;
  hora_fin: string;
  ambiente_id?: number | null;
  docente_id?: number | null;
}

/** Qué ignorar al verificar choques (lo que se está editando) */
export interface IgnorarChoque {
  asignacion_id?: number | null;
  reserva_id?: number | null;
  cesion_id?: number | null;
  asignacion_horario_ids?: number[];
  asignacion_horario_id?: number | null;
}
