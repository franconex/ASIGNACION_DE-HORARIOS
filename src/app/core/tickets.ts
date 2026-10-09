import { TipoAtencion } from './modelos';

/**
 * Tipos de ticket en 3 categorías:
 *  1. Atención a docente
 *  2. Técnico: programas, mantenimiento preventivo y correctivo
 *  3. Atención personal (académica)
 * (+ "cambio de estado de PC", que lo registra el sistema).
 */
export type CategoriaTicket = 'docente' | 'tecnico' | 'personal' | 'sistema';

export const CATEGORIAS_TICKET: { valor: Exclude<CategoriaTicket, 'sistema'>; texto: string; ayuda: string; icono: string }[] = [
  { valor: 'docente', texto: 'Atención a docente', ayuda: 'Lo que pidió un docente en el laboratorio', icono: 'usuarios' },
  { valor: 'tecnico', texto: 'Técnico', ayuda: 'Programas y mantenimiento de las PCs', icono: 'equipo' },
  { valor: 'personal', texto: 'Atención personal', ayuda: 'Atención académica a una persona', icono: 'docente' },
];

export const TIPOS_TICKET: Record<TipoAtencion, { texto: string; corto: string; categoria: CategoriaTicket }> = {
  docente: { texto: 'Atención a docente', corto: 'Docente', categoria: 'docente' },
  programas: { texto: 'Técnico · Programas', corto: 'Programas', categoria: 'tecnico' },
  preventivo: { texto: 'Técnico · Mant. preventivo', corto: 'Mant. preventivo', categoria: 'tecnico' },
  correctivo: { texto: 'Técnico · Mant. correctivo', corto: 'Mant. correctivo', categoria: 'tecnico' },
  personal: { texto: 'Atención personal', corto: 'Personal', categoria: 'personal' },
  cambio_estado: { texto: 'Cambio de estado de PC', corto: 'Cambio de estado', categoria: 'sistema' },
};

/** Subtipos del técnico */
export const SUBTIPOS_TECNICO: { valor: TipoAtencion; texto: string; ayuda: string }[] = [
  { valor: 'programas', texto: 'Programas', ayuda: 'Instalar, actualizar o configurar software' },
  { valor: 'preventivo', texto: 'Mantenimiento preventivo', ayuda: 'Limpieza y revisión de PCs que funcionan' },
  { valor: 'correctivo', texto: 'Mantenimiento correctivo', ayuda: 'Reparar una PC que falla' },
];

export const COLOR_CATEGORIA: Record<CategoriaTicket, string> = {
  docente: 'bg-sky-100 text-sky-800',
  tecnico: 'bg-indigo-100 text-indigo-800',
  personal: 'bg-teal-100 text-teal-800',
  sistema: 'bg-slate-100 text-slate-600',
};

export const PEDIDOS_DOCENTE = [
  { valor: 'instalar_programa', texto: 'Instalar un programa' },
  { valor: 'equipo', texto: 'Equipo / proyector' },
  { valor: 'cuenta', texto: 'Cuenta o acceso' },
  { valor: 'apoyo_clase', texto: 'Apoyo en clase' },
  { valor: 'otro', texto: 'Otro' },
];

export const ACCIONES_PROGRAMA = [
  { valor: 'instalar', texto: 'Instalar' },
  { valor: 'actualizar', texto: 'Actualizar' },
  { valor: 'desinstalar', texto: 'Desinstalar' },
  { valor: 'configurar', texto: 'Configurar' },
];

export const CHECKLIST_PREVENTIVO = [
  { valor: 'limpieza_fisica', texto: 'Limpieza física' },
  { valor: 'temporales', texto: 'Limpieza de temporales' },
  { valor: 'antivirus', texto: 'Antivirus' },
  { valor: 'actualizaciones', texto: 'Actualizaciones' },
  { valor: 'cables', texto: 'Cables y periféricos' },
];

export const RESULTADOS_CORRECTIVO = [
  { valor: 'reparada', texto: 'Reparada', ayuda: 'La PC queda Activa', clase: 'border-emerald-500 bg-emerald-600 text-white' },
  { valor: 'sigue', texto: 'Sigue en mantenimiento', ayuda: 'La PC queda en Mantenimiento', clase: 'border-amber-500 bg-amber-500 text-white' },
  { valor: 'requiere_baja', texto: 'Dar de baja', ayuda: 'La PC queda de baja y sale en tu cierre de turno', clase: 'border-rose-500 bg-rose-600 text-white' },
  { valor: 'inactiva', texto: 'Inactiva', ayuda: 'La PC queda Inactiva', clase: 'border-slate-500 bg-slate-500 text-white dark:border-slate-400 dark:bg-slate-300' },
];

/** Grupos del catálogo de fallas */
export const CATEGORIAS_FALLA: { valor: 'hardware' | 'software' | 'perifericos' | 'red' | 'otro'; texto: string }[] = [
  { valor: 'hardware', texto: 'Hardware' },
  { valor: 'software', texto: 'Software' },
  { valor: 'perifericos', texto: 'Periféricos' },
  { valor: 'red', texto: 'Red' },
  { valor: 'otro', texto: 'Otro' },
];

/** Piezas que se cambian con más frecuencia (la ficha deja escribir otra) */
export const PIEZAS_PC = [
  'Fuente de poder', 'Memoria RAM', 'Disco', 'Placa madre', 'Procesador', 'Ventilador',
  'Teclado', 'Mouse', 'Monitor', 'Cable', 'Tarjeta de red',
];

export const TIPOS_PERSONA = [
  { valor: 'estudiante', texto: 'Estudiante' },
  { valor: 'docente', texto: 'Docente' },
  { valor: 'administrativo', texto: 'Administrativo' },
  { valor: 'otro', texto: 'Otro' },
];

/** Datos propios de cada formulario (columna atenciones.detalles) */
export interface DetallesTicket {
  /** Atención a docente */
  pedido?: string;
  /** Programas */
  programas?: string;
  accion?: string;
  /** Preventivo */
  checklist?: string[];
  /** Correctivo */
  diagnostico?: string;
  resultado?: string;
  /** Atención personal */
  persona?: string;
  tipo_persona?: string;
  facultad?: string;
}

/** Texto de un valor dentro de una lista de opciones */
export function textoDe(lista: { valor: string; texto: string }[], valor: string | undefined | null): string {
  return lista.find((x) => x.valor === valor)?.texto ?? '';
}
