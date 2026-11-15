import type { FormatoColumna } from '../../core/exportar-excel';
import { CategoriaFalla, EstadoPc, LicenciaSoftware, Rol, TipoAtencion, TurnoCodigo } from '../../core/modelos';
import { CATEGORIAS_FALLA, TIPOS_TICKET } from '../../core/tickets';

/** Lo que devuelve fn_dashboard_operacion */
export interface ConteoPcs { total: number; operativa: number; inactiva: number; mantenimiento: number; baja: number }
export interface Dashboard {
  kpis: {
    tickets: number; trabajos: number; resueltos: number; en_proceso: number; pendientes: number;
    con_colaboradores: number; horas_resolucion: number | null; tickets_anterior: number;
    reportes: number; tareas_pendientes: number; pendientes_total: number;
  };
  por_dia: { dia: string; tickets: number; resueltos: number }[];
  por_tipo: { tipo: TipoAtencion; tickets: number; trabajos: number }[];
  por_lab: { id: number; codigo: string; color: string; tickets: number; pendientes: number; pcs: ConteoPcs }[];
  auxiliares: {
    id: string; nombre: string; rol: Rol; turno: TurnoCodigo | null;
    /** Tickets en los que participó (registró + colaboró); abrir/cerrar lab cuenta 1 */
    tickets: number; registrados: number; colaboraciones: number;
    resueltos: number; pcs_atendidas: number; reportes: number; tareas_hechas: number;
  }[];
  pcs: ConteoPcs & { docentes: number };
  top_pcs: { etiqueta: string; lab: string; estado: EstadoPc; tickets: number; ultimo: string }[];
}

/** Lo que devuelve fn_dashboard_uso */
export interface UsoLabs {
  totales: { horas_clase: number; horas_cesion: number; horas_evento: number; materias: number; eventos: number };
  materias: { materia: string; horas: number; sesiones: number; docentes: number; cedidas: number; labs: string }[];
  eventos: { titulo: string; tipo: string; horas: number; dias: number; labs: string }[];
  por_lab: { codigo: string; color: string; clase: number; cesion: number; evento: number; materia_top: string | null }[];
  actividades_lab: { codigo: string; color: string; total: number; tipos: { tipo: TipoAtencion; tickets: number }[] }[];
  pedidos: {
    descripcion: string; tipo: TipoAtencion; veces: number; trabajos: number; pendientes: number;
    labs: string | null; solicitantes: string | null; ultimo: string;
  }[];
}

/** Lo que devuelve fn_dashboard_detalle */
export interface HorasUso { clase: number; cesion: number; evento: number }
export interface Detalle {
  uso_por_dia: (HorasUso & { dia: string })[];
  uso_por_dia_semana: (HorasUso & { dia: number })[];
  uso_por_hora: (HorasUso & { hora: number })[];
  carreras: { carrera: string; nombre: string; horas: number; sesiones: number; materias: number; docentes: number }[];
  docentes: { docente: string; horas: number; sesiones: number; materias: string; pedidos: number }[];
  tickets_por_turno: { turno: TurnoCodigo; tickets: number; resueltos: number; horas_resolucion: number | null }[];
  tickets_por_dia_semana: { dia: number; tickets: number; resueltos: number }[];
  resolucion_por_tipo: { tipo: TipoAtencion; horas: number; tickets: number }[];
  cierres: {
    total: number; a_tiempo: number; con_retraso: number; sin_horario: number;
    retraso_promedio: number | null; retraso_maximo: number | null; pcs_baja: number;
    por_dia: { dia: string; a_tiempo: number; con_retraso: number; sin_horario: number }[];
    por_turno: { turno: TurnoCodigo; cierres: number; a_tiempo: number; con_retraso: number; sin_horario: number; retraso_promedio: number | null }[];
    por_auxiliar: {
      nombre: string; cierres: number; a_tiempo: number; con_retraso: number;
      retraso_promedio: number | null; retraso_maximo: number | null; pcs_baja: number;
    }[];
  };
  bajas: { etiqueta: string; lab: string | null; motivo: string | null; por: string | null; en: string }[];
  reactivadas: number;
  objetos: { registrados: number; entregados: number; en_custodia: number; por_lab: { codigo: string; color: string; objetos: number }[] };
}

/** Lo que devuelve fn_dashboard_software */
export interface FilaSoftware {
  id: number; nombre: string; tipo: 'programa' | 'iso'; licencia: LicenciaSoftware;
  pedidos: number; instalar: number; actualizar: number; desinstalar: number; labs: string[];
}
export interface DashSoftware {
  kpis: {
    pedidos: number; instalaciones: number; actualizaciones: number; desinstalaciones: number; programas_distintos: number;
    preventivos: number; pcs_preventivo: number; correctivos: number; reparadas: number;
  };
  por_software: FilaSoftware[];
  por_lab: { codigo: string; color: string; instalar: number; actualizar: number; desinstalar: number; pedidos: number }[];
  docentes: { nombre: string; pedidos: number }[];
}

/** Lo que devuelve fn_dashboard_fallas (fichas de reparación) */
export interface Fallas {
  total: number;
  con_ficha: number;
  fallas: { falla: string; categoria: CategoriaFalla; veces: number; pcs: number; labs: string | null }[];
  por_categoria: { categoria: CategoriaFalla; veces: number }[];
  otras: { texto: string; veces: number; ultimo: string; en_lista: boolean }[];
  piezas: { pieza: string; veces: number }[];
  reincidentes: { etiqueta: string; lab: string | null; estado: EstadoPc; veces: number; ultima_falla: string; ultimo: string }[];
  resultados: { activas: number; mantenimiento: number; inactivas: number; bajas: number; reactivadas: number };
}

/** Secciones del dashboard (una a la vez); cada una responde una pregunta */
export type Seccion = 'resumen' | 'tickets' | 'auxiliares' | 'pcs' | 'software' | 'uso';
export const SECCIONES: { clave: Seccion; texto: string; icono: string; pregunta: string }[] = [
  { clave: 'resumen', texto: 'Resumen', icono: 'panel', pregunta: 'Lo principal del periodo y lo que necesita atención.' },
  { clave: 'tickets', texto: 'Tickets', icono: 'registros', pregunta: '¿Qué trabajo se hizo, cuándo y cuánto tardó?' },
  { clave: 'auxiliares', texto: 'Auxiliares y turnos', icono: 'usuarios', pregunta: '¿Quién hizo el trabajo y cómo se cerraron los turnos?' },
  { clave: 'pcs', texto: 'PCs y mantenimiento', icono: 'equipo', pregunta: '¿Cómo están las PCs, qué fallas tuvieron y qué se reparó?' },
  { clave: 'software', texto: 'Software', icono: 'grilla', pregunta: '¿Qué programas pidieron los docentes y qué se instaló?' },
  { clave: 'uso', texto: 'Uso de laboratorios', icono: 'laboratorio', pregunta: '¿Cuánto se usaron los laboratorios, cuándo y quiénes?' },
];

/** Un número clave de una sección (se muestra en tarjeta y va al Excel) */
export interface Indicador {
  titulo: string;
  valor: number | string | null;
  formato?: FormatoColumna;
  nota: string;
  /** alerta: ámbar · peligro: rojo · bien: verde */
  tono?: 'alerta' | 'peligro' | 'bien';
  ir?: Seccion;
}

/** "Técnico · Programas", "Atención a docente"… */
export const TIPOS: Record<TipoAtencion, string> = Object.fromEntries(
  Object.entries(TIPOS_TICKET).map(([k, v]) => [k, v.texto])) as Record<TipoAtencion, string>;
export const TURNOS: Record<TurnoCodigo, string> = { M: 'Mañana', MD: 'Mediodía', T: 'Tarde', N: 'Noche' };
/** Estados de PC: mismos colores que el croquis (son estados, no series) */
export const ESTADOS_PC: { clave: EstadoPc; texto: string; clase: string }[] = [
  { clave: 'operativa', texto: 'Activas', clase: 'bg-emerald-500' },
  { clave: 'inactiva', texto: 'Inactivas', clase: 'bg-slate-400' },
  { clave: 'mantenimiento', texto: 'Mantenimiento', clase: 'bg-amber-400' },
  { clave: 'baja', texto: 'De baja', clase: 'bg-rose-500' },
];

export function textoCategoriaFalla(c: CategoriaFalla): string {
  return CATEGORIAS_FALLA.find((x) => x.valor === c)?.texto ?? c;
}

export function textoEstadoPc(e: EstadoPc): string {
  return ESTADOS_PC.find((s) => s.clave === e)?.texto ?? e;
}
