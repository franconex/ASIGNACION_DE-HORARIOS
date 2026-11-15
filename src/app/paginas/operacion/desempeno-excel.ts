import type { HojaExcel, IndicadorExcel } from '../../core/exportar-excel';
import { DIAS_SEMANA } from '../../core/fechas';
import { LICENCIAS } from '../../core/software.service';
import { TIPOS_TICKET } from '../../core/tickets';
import {
  Dashboard, Detalle, DashSoftware, Fallas, Indicador, Seccion, SECCIONES, TIPOS, TURNOS, UsoLabs,
  textoCategoriaFalla, textoEstadoPc,
} from './desempeno-datos';

/** Todo lo que se cargó del periodo, ya calculado en la página */
export interface FuenteExcel {
  datos: Dashboard;
  detalle: Detalle | null;
  uso: UsoLabs | null;
  fallas: Fallas | null;
  software: DashSoftware | null;
  indicadores: Record<Seccion, Indicador[]>;
  alertas: { texto: string; detalle: string; ir: Seccion }[];
  destacados: { titulo: string; valor: string; nota: string }[];
}

const CATEGORIAS: Record<string, string> = {
  docente: 'Atención a docente', tecnico: 'Técnico', personal: 'Atención personal', laboratorio: 'Abrir / cerrar lab', sistema: 'Cambios de estado',
};

function indicadores(lista: Indicador[]): IndicadorExcel[] {
  return lista.map((k) => ({ texto: k.titulo, valor: k.valor ?? '—', formato: k.formato, detalle: k.nota }));
}

const nombreSeccion = (s: Seccion) => SECCIONES.find((x) => x.clave === s)?.texto ?? s;

/**
 * Orden del reporte: primero el inventario de PCs, después lo que más se
 * pide en los laboratorios (programas) y luego el resto.
 */
const ORDEN_REPORTE: Seccion[] = ['resumen', 'pcs', 'software', 'tickets', 'auxiliares', 'uso'];

/** Hojas del Excel: todas las secciones o solo las pedidas, en el orden del reporte */
export function hojasDesempeno(f: FuenteExcel, secciones: Seccion[]): HojaExcel[] {
  const hojas: HojaExcel[] = [];
  for (const s of ORDEN_REPORTE.filter((x) => secciones.includes(x))) {
    const hoja = HOJAS[s](f);
    if (hoja) hojas.push(hoja);
  }
  return hojas;
}

/** Cuántas PCs hay y en qué estado (lo primero del reporte) */
function inventarioPcs(f: FuenteExcel): IndicadorExcel[] {
  const p = f.datos.pcs;
  const pct = (n: number) => (p.total ? `${Math.round((n / p.total) * 100)} % del total` : '');
  return [
    { texto: 'Total de PCs', valor: p.total, detalle: `${p.total - p.docentes} de alumnos · ${p.docentes} de docente` },
    { texto: 'Activas', valor: p.operativa, detalle: pct(p.operativa) },
    { texto: 'En mantenimiento', valor: p.mantenimiento, detalle: pct(p.mantenimiento) },
    { texto: 'Inactivas', valor: p.inactiva, detalle: pct(p.inactiva) },
    { texto: 'De baja', valor: p.baja, detalle: pct(p.baja) },
    ...(f.detalle ? [{ texto: 'Dadas de baja en el periodo', valor: f.detalle.bajas.length, detalle: `${f.detalle.reactivadas} reactivadas en el periodo` }] : []),
  ];
}

/** Programas que más pidieron los docentes (de más a menos) */
function masPedidos(f: FuenteExcel) {
  return (f.software?.por_software ?? []).filter((s) => s.pedidos)
    .sort((a, b) => b.pedidos - a.pedidos || a.nombre.localeCompare(b.nombre, 'es'));
}

function masInstalados(f: FuenteExcel) {
  return (f.software?.por_software ?? []).filter((s) => s.instalar + s.actualizar)
    .sort((a, b) => b.instalar + b.actualizar - (a.instalar + a.actualizar) || a.nombre.localeCompare(b.nombre, 'es'));
}

/** Tabla del estado de las PCs por laboratorio (va en el resumen y en la hoja de PCs) */
function tablaPcsPorLab(f: FuenteExcel) {
  return {
    titulo: 'PCs por laboratorio', nota: 'Estado actual de las PCs de cada laboratorio y tickets del periodo.', totales: true,
    columnas: [{ titulo: 'Laboratorio' }, { titulo: 'Total PCs', formato: 'entero' as const, sumar: true }, { titulo: 'Activas', formato: 'entero' as const, sumar: true },
               { titulo: 'Mantenimiento', formato: 'entero' as const, sumar: true }, { titulo: 'Inactivas', formato: 'entero' as const, sumar: true },
               { titulo: 'De baja', formato: 'entero' as const, sumar: true }, { titulo: 'Tickets', formato: 'entero' as const, sumar: true },
               { titulo: 'Sin resolver', formato: 'entero' as const, sumar: true }],
    filas: f.datos.por_lab.map((l) => [l.codigo, l.pcs.total, l.pcs.operativa, l.pcs.mantenimiento, l.pcs.inactiva, l.pcs.baja, l.tickets, l.pendientes]),
  };
}

const HOJAS: Record<Seccion, (f: FuenteExcel) => HojaExcel | null> = {
  // 1) Cuántas PCs hay  2) Qué es lo que más se pide  3) Lo que hay que revisar
  resumen: (f) => ({
    nombre: 'Resumen',
    tituloIndicadores: 'Inventario de PCs',
    indicadores: inventarioPcs(f),
    tablas: [
      tablaPcsPorLab(f),
      ...(f.software ? [{
        titulo: 'Programas más pedidos en los laboratorios', nota: 'Lo que los docentes pidieron instalar, de más a menos.', totales: true,
        columnas: [{ titulo: 'Puesto', formato: 'entero' as const }, { titulo: 'Programa' }, { titulo: 'Pedidos', formato: 'entero' as const, sumar: true },
                   { titulo: 'Se instaló', formato: 'entero' as const, sumar: true }, { titulo: 'Laboratorios' }],
        filas: masPedidos(f).slice(0, 15).map((s, i) => [i + 1, s.nombre, s.pedidos, s.instalar, s.labs.join(', ')]),
      }] : []),
      ...(f.uso ? [{
        titulo: 'Lo que más se pide en los laboratorios', nota: 'Peticiones y pedidos con el mismo texto, de más a menos.',
        columnas: [{ titulo: 'Pedido' }, { titulo: 'Tipo' }, { titulo: 'Laboratorio' }, { titulo: 'Veces', formato: 'entero' as const },
                   { titulo: 'Sin resolver', formato: 'entero' as const }, { titulo: 'Quién pidió' }],
        filas: f.uso.pedidos.slice(0, 15).map((p) => [p.descripcion, TIPOS[p.tipo], p.labs, p.veces, p.pendientes, p.solicitantes]),
      }] : []),
      {
        titulo: 'Necesita atención', nota: 'Puntos a revisar en el periodo y en qué hoja está el detalle.',
        columnas: [{ titulo: 'Punto' }, { titulo: 'Detalle' }, { titulo: 'Ver hoja' }],
        filas: f.alertas.map((a) => [a.texto, a.detalle, nombreSeccion(a.ir)]),
      },
      {
        titulo: 'Lo más destacado',
        columnas: [{ titulo: 'Dato' }, { titulo: 'Valor' }, { titulo: 'Detalle' }],
        filas: f.destacados.map((d) => [d.titulo, d.valor, d.nota]),
      },
      // Todos los números clave en un solo lugar (en el orden del reporte)
      {
        titulo: 'Indicadores de cada área',
        columnas: [{ titulo: 'Área' }, { titulo: 'Indicador' }, { titulo: 'Valor' }, { titulo: 'Detalle' }],
        filas: ORDEN_REPORTE.filter((s) => s !== 'resumen').map((s) => SECCIONES.find((x) => x.clave === s)!).flatMap((s) =>
          f.indicadores[s.clave].map((k) => [s.texto, k.titulo, k.valor === null ? '—' : String(k.valor) + (k.formato === 'porcentaje' ? ' %' : k.formato === 'horas' ? ' h' : ''), k.nota])),
      },
    ],
  }),

  tickets: (f) => {
    const d = f.datos, x = f.detalle, u = f.uso;
    return {
      nombre: 'Tickets',
      indicadores: indicadores(f.indicadores.tickets),
      tablas: [
        {
          titulo: 'Tickets por día', nota: 'Tickets registrados cada día y cuántos de ellos ya se resolvieron.', totales: true,
          columnas: [{ titulo: 'Fecha', formato: 'fecha' }, { titulo: 'Día' }, { titulo: 'Tickets', formato: 'entero', sumar: true }, { titulo: 'Resueltos', formato: 'entero', sumar: true }],
          filas: d.por_dia.map((p) => [p.dia, DIAS_SEMANA[new Date(p.dia + 'T00:00:00').getDay() || 7], p.tickets, p.resueltos]),
        },
        {
          titulo: 'Qué se hizo (por tipo de ticket)', nota: 'Un trabajo en 20 PCs cuenta como 20 tickets y 1 trabajo.', totales: true,
          columnas: [{ titulo: 'Tipo' }, { titulo: 'Categoría' }, { titulo: 'Tickets', formato: 'entero', sumar: true }, { titulo: 'Trabajos', formato: 'entero', sumar: true }],
          filas: d.por_tipo.map((t) => [TIPOS[t.tipo], CATEGORIAS[TIPOS_TICKET[t.tipo]?.categoria ?? 'sistema'], t.tickets, t.trabajos]),
        },
        ...(x ? [
          {
            titulo: 'Tickets por turno', totales: true,
            columnas: [{ titulo: 'Turno' }, { titulo: 'Tickets', formato: 'entero' as const, sumar: true }, { titulo: 'Resueltos', formato: 'entero' as const, sumar: true },
                       { titulo: 'Sin resolver', formato: 'entero' as const, sumar: true }, { titulo: 'Tiempo para resolver', formato: 'horas' as const }],
            filas: x.tickets_por_turno.map((t) => [TURNOS[t.turno], t.tickets, t.resueltos, t.tickets - t.resueltos, t.horas_resolucion]),
          },
          {
            titulo: 'Tickets por día de la semana', totales: true,
            columnas: [{ titulo: 'Día' }, { titulo: 'Tickets', formato: 'entero' as const, sumar: true }, { titulo: 'Resueltos', formato: 'entero' as const, sumar: true }],
            filas: x.tickets_por_dia_semana.map((t) => [DIAS_SEMANA[t.dia], t.tickets, t.resueltos]),
          },
          {
            titulo: 'Tiempo para resolver, por tipo', nota: 'Promedio en horas de los tickets que se resolvieron después de registrarlos.',
            columnas: [{ titulo: 'Tipo' }, { titulo: 'Promedio', formato: 'horas' as const }, { titulo: 'Tickets', formato: 'entero' as const }],
            filas: x.resolucion_por_tipo.map((r) => [TIPOS[r.tipo], r.horas, r.tickets]),
          },
        ] : []),
        ...(u ? [
          {
            titulo: 'Trabajo en cada laboratorio', nota: 'Tickets del periodo por laboratorio y tipo de trabajo.',
            columnas: [{ titulo: 'Laboratorio' }, { titulo: 'Tickets', formato: 'entero' as const }, { titulo: 'Trabajo principal' }, { titulo: 'Todos los tipos' }],
            filas: u.actividades_lab.map((l) => [l.codigo, l.total, l.tipos[0] ? TIPOS[l.tipos[0].tipo] : '',
                                                 l.tipos.map((t) => `${TIPOS[t.tipo]}: ${t.tickets}`).join(' · ')]),
          },
          {
            titulo: 'Pedidos más frecuentes', nota: 'Mismo texto = mismo pedido.',
            columnas: [{ titulo: 'Pedido' }, { titulo: 'Tipo' }, { titulo: 'Laboratorio' }, { titulo: 'Veces', formato: 'entero' as const },
                       { titulo: 'Pendientes', formato: 'entero' as const }, { titulo: 'Quién pidió' }, { titulo: 'Último', formato: 'fechaHora' as const }],
            filas: u.pedidos.map((p) => [p.descripcion, TIPOS[p.tipo], p.labs, p.veces, p.pendientes, p.solicitantes, p.ultimo]),
          },
        ] : []),
      ],
    };
  },

  auxiliares: (f) => {
    const d = f.datos, x = f.detalle;
    return {
      nombre: 'Auxiliares y turnos',
      indicadores: indicadores(f.indicadores.auxiliares),
      tablas: [
        {
          titulo: 'Ranking de auxiliares', nota: 'Tickets en los que participó cada uno (registró o colaboró). Abrir o cerrar un laboratorio cuenta como 1 ticket.', totales: true,
          columnas: [{ titulo: 'Puesto', formato: 'entero' }, { titulo: 'Auxiliar' }, { titulo: 'Turno' }, { titulo: 'Tickets', formato: 'entero', sumar: true },
                     { titulo: 'Registró', formato: 'entero', sumar: true }, { titulo: 'Colaboró', formato: 'entero', sumar: true }, { titulo: 'Resolvió', formato: 'entero', sumar: true },
                     { titulo: 'PCs atendidas', formato: 'entero', sumar: true }, { titulo: 'Reportes de turno', formato: 'entero', sumar: true }, { titulo: 'Tareas hechas', formato: 'entero', sumar: true }],
          filas: d.auxiliares.map((a, i) => [i + 1, a.nombre + (a.rol === 'encargado' ? ' (encargado)' : ''), a.turno ? TURNOS[a.turno] : '—',
                                             a.tickets, a.registrados, a.colaboraciones, a.resueltos, a.pcs_atendidas, a.reportes, a.tareas_hechas]),
        },
        ...(x ? [
          {
            titulo: 'Cierres de turno por auxiliar', totales: true,
            columnas: [{ titulo: 'Quién cerró' }, { titulo: 'Cierres', formato: 'entero' as const, sumar: true }, { titulo: 'A tiempo', formato: 'entero' as const, sumar: true },
                       { titulo: 'Con retraso', formato: 'entero' as const, sumar: true }, { titulo: 'Retraso promedio (min)', formato: 'entero' as const },
                       { titulo: 'Retraso máximo (min)', formato: 'entero' as const }, { titulo: 'PCs de baja', formato: 'entero' as const, sumar: true }],
            filas: x.cierres.por_auxiliar.map((a) => [a.nombre, a.cierres, a.a_tiempo, a.con_retraso, a.retraso_promedio, a.retraso_maximo, a.pcs_baja]),
          },
          {
            titulo: 'Cierres por turno', totales: true,
            columnas: [{ titulo: 'Turno' }, { titulo: 'Cierres', formato: 'entero' as const, sumar: true }, { titulo: 'A tiempo', formato: 'entero' as const, sumar: true },
                       { titulo: 'Con retraso', formato: 'entero' as const, sumar: true }, { titulo: 'Sin horario', formato: 'entero' as const, sumar: true },
                       { titulo: 'Retraso promedio (min)', formato: 'entero' as const }],
            filas: x.cierres.por_turno.map((t) => [TURNOS[t.turno], t.cierres, t.a_tiempo, t.con_retraso, t.sin_horario, t.retraso_promedio]),
          },
          {
            titulo: 'Cierres por día', nota: '"Sin horario": cierres de antes de registrar los horarios de turno.', totales: true,
            columnas: [{ titulo: 'Fecha', formato: 'fecha' as const }, { titulo: 'A tiempo', formato: 'entero' as const, sumar: true },
                       { titulo: 'Con retraso', formato: 'entero' as const, sumar: true }, { titulo: 'Sin horario', formato: 'entero' as const, sumar: true }],
            filas: x.cierres.por_dia.filter((c) => c.a_tiempo + c.con_retraso + c.sin_horario).map((c) => [c.dia, c.a_tiempo, c.con_retraso, c.sin_horario]),
          },
          {
            titulo: 'Objetos perdidos por laboratorio',
            nota: `${x.objetos.registrados} encontrados · ${x.objetos.entregados} entregados · ${x.objetos.en_custodia} en custodia ahora.`, totales: true,
            columnas: [{ titulo: 'Laboratorio' }, { titulo: 'Objetos', formato: 'entero' as const, sumar: true }],
            filas: x.objetos.por_lab.map((l) => [l.codigo, l.objetos]),
          },
        ] : []),
      ],
    };
  },

  pcs: (f) => {
    const d = f.datos, x = f.detalle, fx = f.fallas;
    const sw = f.software;
    return {
      nombre: 'PCs y mantenimiento',
      tituloIndicadores: 'Inventario de PCs y mantenimientos',
      // Primero el inventario completo; después los mantenimientos
      indicadores: [
        ...inventarioPcs(f),
        ...(sw ? [
          { texto: 'Mantenimientos preventivos', valor: sw.kpis.preventivos, detalle: `${sw.kpis.pcs_preventivo} PCs revisadas` },
          { texto: 'Mantenimientos correctivos', valor: sw.kpis.correctivos, detalle: `${sw.kpis.reparadas} PCs reparadas` },
        ] : []),
        ...(fx ? [{ texto: 'PCs reparadas 2 o más veces', valor: fx.reincidentes.length, detalle: 'conviene revisarlas' }] : []),
      ],
      tablas: [
        tablaPcsPorLab(f),
        ...(x ? [{
          titulo: 'PCs dadas de baja en el periodo',
          columnas: [{ titulo: 'PC' }, { titulo: 'Laboratorio' }, { titulo: 'Motivo' }, { titulo: 'Quién' }, { titulo: 'Cuándo', formato: 'fechaHora' as const }],
          filas: x.bajas.map((b) => [b.etiqueta, b.lab, b.motivo, b.por, b.en]),
        }] : []),
        ...(fx ? [
          {
            titulo: 'Fallas más repetidas', nota: 'Veces que se marcó cada falla en una ficha de reparación.',
            columnas: [{ titulo: 'Falla' }, { titulo: 'Grupo' }, { titulo: 'Veces', formato: 'entero' as const }, { titulo: 'PCs distintas', formato: 'entero' as const }, { titulo: 'Laboratorios' }],
            filas: fx.fallas.map((a) => [a.falla, textoCategoriaFalla(a.categoria), a.veces, a.pcs, a.labs]),
          },
          {
            titulo: 'Piezas más cambiadas', nota: 'Para saber qué repuestos conviene tener.', totales: true,
            columnas: [{ titulo: 'Pieza' }, { titulo: 'Veces', formato: 'entero' as const, sumar: true }],
            filas: fx.piezas.map((p) => [p.pieza, p.veces]),
          },
          {
            titulo: 'PCs reparadas 2 o más veces',
            columnas: [{ titulo: 'PC' }, { titulo: 'Laboratorio' }, { titulo: 'Estado actual' }, { titulo: 'Reparaciones', formato: 'entero' as const },
                       { titulo: 'Última falla' }, { titulo: 'Última reparación', formato: 'fechaHora' as const }],
            filas: fx.reincidentes.map((r) => [r.etiqueta, r.lab, textoEstadoPc(r.estado), r.veces, r.ultima_falla, r.ultimo]),
          },
        ] : []),
        {
          titulo: 'PCs con más tickets',
          columnas: [{ titulo: 'PC' }, { titulo: 'Laboratorio' }, { titulo: 'Estado' }, { titulo: 'Tickets', formato: 'entero' }, { titulo: 'Último', formato: 'fechaHora' }],
          filas: d.top_pcs.map((p) => [p.etiqueta, p.lab, textoEstadoPc(p.estado), p.tickets, p.ultimo]),
        },
        ...(fx ? [{
          titulo: '"Otras" fallas escritas a mano', nota: 'Las más repetidas conviene agregarlas como botón en la ficha de reparación.',
          columnas: [{ titulo: 'Falla escrita' }, { titulo: 'Veces', formato: 'entero' as const }, { titulo: '¿Ya es botón?' }, { titulo: 'Última vez', formato: 'fechaHora' as const }],
          filas: fx.otras.map((o) => [o.texto, o.veces, o.en_lista ? 'Sí' : 'No', o.ultimo]),
        }] : []),
      ],
    };
  },

  software: (f) => {
    const sw = f.software;
    if (!sw) return null;
    return {
      nombre: 'Software',
      indicadores: indicadores(f.indicadores.software),
      tablas: [
        {
          titulo: 'Programas más pedidos por los docentes', nota: 'De más a menos. "Se instaló" cuenta las instalaciones de ese programa en el periodo.', totales: true,
          columnas: [{ titulo: 'Puesto', formato: 'entero' }, { titulo: 'Programa' }, { titulo: 'Licencia' }, { titulo: 'Pedidos', formato: 'entero', sumar: true },
                     { titulo: 'Se instaló', formato: 'entero', sumar: true }, { titulo: 'Laboratorios' }],
          filas: masPedidos(f).map((s, i) => [i + 1, s.nombre, LICENCIAS[s.licencia].texto, s.pedidos, s.instalar, s.labs.join(', ')]),
        },
        {
          titulo: 'Programas más instalados y actualizados', nota: 'Un trabajo en varias PCs cuenta una vez por laboratorio.', totales: true,
          columnas: [{ titulo: 'Puesto', formato: 'entero' }, { titulo: 'Programa' }, { titulo: 'Instaló', formato: 'entero', sumar: true },
                     { titulo: 'Actualizó', formato: 'entero', sumar: true }, { titulo: 'Laboratorios' }],
          filas: masInstalados(f).map((s, i) => [i + 1, s.nombre, s.instalar, s.actualizar, s.labs.join(', ')]),
        },
        {
          titulo: 'Todo el software trabajado en el periodo', totales: true,
          columnas: [{ titulo: 'Software' }, { titulo: 'Tipo' }, { titulo: 'Licencia' }, { titulo: 'Pedidos de docentes', formato: 'entero', sumar: true },
                     { titulo: 'Instaló', formato: 'entero', sumar: true }, { titulo: 'Actualizó', formato: 'entero', sumar: true },
                     { titulo: 'Desinstaló', formato: 'entero', sumar: true }, { titulo: 'Laboratorios' }],
          filas: sw.por_software.map((s) => [s.nombre, s.tipo === 'iso' ? 'ISO' : 'Programa', LICENCIAS[s.licencia].texto,
                                             s.pedidos, s.instalar, s.actualizar, s.desinstalar, s.labs.join(', ')]),
        },
        {
          titulo: 'Software por laboratorio', totales: true,
          columnas: [{ titulo: 'Laboratorio' }, { titulo: 'Instaló', formato: 'entero', sumar: true }, { titulo: 'Actualizó', formato: 'entero', sumar: true },
                     { titulo: 'Desinstaló', formato: 'entero', sumar: true }, { titulo: 'Pedidos', formato: 'entero', sumar: true }],
          filas: sw.por_lab.map((l) => [l.codigo, l.instalar, l.actualizar, l.desinstalar, l.pedidos]),
        },
        {
          titulo: 'Docentes que más programas pidieron', totales: true,
          columnas: [{ titulo: 'Docente' }, { titulo: 'Pedidos', formato: 'entero', sumar: true }],
          filas: sw.docentes.map((dc) => [dc.nombre, dc.pedidos]),
        },
      ],
    };
  },

  uso: (f) => {
    const u = f.uso, x = f.detalle;
    if (!u) return null;
    const horas = (h: number) => Math.round(h * 10) / 10;
    return {
      nombre: 'Uso de laboratorios',
      indicadores: indicadores(f.indicadores.uso),
      tablas: [
        {
          titulo: 'Horas de uso por laboratorio', totales: true,
          columnas: [{ titulo: 'Laboratorio' }, { titulo: 'Clases', formato: 'horas', sumar: true }, { titulo: 'Cedidas', formato: 'horas', sumar: true },
                     { titulo: 'Eventos', formato: 'horas', sumar: true }, { titulo: 'Total', formato: 'horas', sumar: true }, { titulo: 'Materia que más lo usa' }],
          filas: u.por_lab.map((l) => [l.codigo, l.clase, l.cesion, l.evento, horas(l.clase + l.cesion + l.evento), l.materia_top]),
        },
        {
          titulo: 'Materias que más ocupan los laboratorios', nota: 'En una cesión cuenta la materia de quien viene.',
          columnas: [{ titulo: 'Materia' }, { titulo: 'Horas', formato: 'horas' }, { titulo: 'Clases dictadas', formato: 'entero' },
                     { titulo: 'De ellas cedidas', formato: 'entero' }, { titulo: 'Docentes', formato: 'entero' }, { titulo: 'Laboratorios' }],
          filas: u.materias.map((m) => [m.materia, m.horas, m.sesiones, m.cedidas, m.docentes, m.labs]),
        },
        {
          titulo: 'Eventos y defensas',
          columnas: [{ titulo: 'Evento' }, { titulo: 'Tipo' }, { titulo: 'Horas', formato: 'horas' }, { titulo: 'Días', formato: 'entero' }, { titulo: 'Laboratorios' }],
          filas: u.eventos.map((e) => [e.titulo, e.tipo, e.horas, e.dias, e.labs]),
        },
        ...(x ? [
          {
            titulo: 'Carreras que más usan los laboratorios',
            columnas: [{ titulo: 'Sigla' }, { titulo: 'Carrera' }, { titulo: 'Horas', formato: 'horas' as const }, { titulo: 'Clases', formato: 'entero' as const },
                       { titulo: 'Materias', formato: 'entero' as const }, { titulo: 'Docentes', formato: 'entero' as const }],
            filas: x.carreras.map((c) => [c.carrera, c.nombre, c.horas, c.sesiones, c.materias, c.docentes]),
          },
          {
            titulo: 'Docentes que más usan los laboratorios',
            columnas: [{ titulo: 'Docente' }, { titulo: 'Horas', formato: 'horas' as const }, { titulo: 'Clases', formato: 'entero' as const },
                       { titulo: 'Pedidos a auxiliares', formato: 'entero' as const }, { titulo: 'Materias' }],
            filas: x.docentes.map((dc) => [dc.docente, dc.horas, dc.sesiones, dc.pedidos, dc.materias]),
          },
          {
            titulo: 'Horas de uso por día', totales: true,
            columnas: [{ titulo: 'Fecha', formato: 'fecha' as const }, { titulo: 'Clases', formato: 'horas' as const, sumar: true },
                       { titulo: 'Cedidas', formato: 'horas' as const, sumar: true }, { titulo: 'Eventos', formato: 'horas' as const, sumar: true },
                       { titulo: 'Total', formato: 'horas' as const, sumar: true }],
            filas: x.uso_por_dia.map((p) => [p.dia, p.clase, p.cesion, p.evento, horas(p.clase + p.cesion + p.evento)]),
          },
          {
            titulo: 'Uso por día de la semana', totales: true,
            columnas: [{ titulo: 'Día' }, { titulo: 'Clases', formato: 'horas' as const, sumar: true }, { titulo: 'Cedidas', formato: 'horas' as const, sumar: true },
                       { titulo: 'Eventos', formato: 'horas' as const, sumar: true }],
            filas: x.uso_por_dia_semana.map((p) => [DIAS_SEMANA[p.dia], p.clase, p.cesion, p.evento]),
          },
          {
            titulo: 'Horas pico (por franja del día)',
            columnas: [{ titulo: 'Franja' }, { titulo: 'Clases', formato: 'horas' as const }, { titulo: 'Cedidas', formato: 'horas' as const }, { titulo: 'Eventos', formato: 'horas' as const }],
            filas: x.uso_por_hora.map((p) => [`${String(p.hora).padStart(2, '0')}:00 – ${String(p.hora + 1).padStart(2, '0')}:00`, p.clase, p.cesion, p.evento]),
          },
        ] : []),
      ],
    };
  },
};
