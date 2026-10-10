import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { GraficoBarrasComponent } from '../../compartido/grafico-barras.component';
import { GraficoLineasComponent } from '../../compartido/grafico-lineas.component';
import { SerieGrafico } from '../../compartido/graficos';
import { IconoComponent } from '../../compartido/icono.component';
import { AuthService } from '../../core/auth.service';
import { descargarCsv } from '../../core/exportar';
import { DIAS_CORTOS, DIAS_SEMANA, fechaCorta, hoyIso, sumarDias } from '../../core/fechas';
import { OperacionService, textoRetraso } from '../../core/operacion.service';
import { CATEGORIAS_FALLA, CategoriaTicket, COLOR_CATEGORIA, TIPOS_TICKET } from '../../core/tickets';
import { CategoriaFalla, EstadoPc, TipoAtencion, TurnoCodigo } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { SupabaseService } from '../../core/supabase.service';

/** Lo que devuelve fn_dashboard_operacion */
interface ConteoPcs { total: number; operativa: number; inactiva: number; mantenimiento: number; baja: number }
interface Dashboard {
  kpis: {
    tickets: number; trabajos: number; resueltos: number; en_proceso: number; pendientes: number;
    con_colaboradores: number; horas_resolucion: number | null; tickets_anterior: number;
    reportes: number; tareas_pendientes: number; pendientes_total: number;
  };
  por_dia: { dia: string; tickets: number; resueltos: number }[];
  por_tipo: { tipo: TipoAtencion; tickets: number; trabajos: number }[];
  por_lab: { id: number; codigo: string; color: string; tickets: number; pendientes: number; pcs: ConteoPcs }[];
  auxiliares: {
    id: string; nombre: string; rol: string; turno: TurnoCodigo | null;
    registrados: number; trabajos: number; colaboraciones: number; participaciones: number;
    resueltos: number; pcs_atendidas: number; reportes: number; tareas_hechas: number;
  }[];
  pcs: ConteoPcs & { docentes: number };
  top_pcs: { etiqueta: string; lab: string; estado: EstadoPc; tickets: number; ultimo: string }[];
}

/** Lo que devuelve fn_dashboard_uso (solo admin) */
interface UsoLabs {
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

/** Lo que devuelve fn_dashboard_detalle (admin y encargado) */
interface HorasUso { clase: number; cesion: number; evento: number }
interface Detalle {
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

/** Lo que devuelve fn_dashboard_fallas (fichas de reparación) */
interface Fallas {
  total: number;
  con_ficha: number;
  fallas: { falla: string; categoria: CategoriaFalla; veces: number; pcs: number; labs: string | null }[];
  por_categoria: { categoria: CategoriaFalla; veces: number }[];
  otras: { texto: string; veces: number; ultimo: string; en_lista: boolean }[];
  piezas: { pieza: string; veces: number }[];
  reincidentes: { etiqueta: string; lab: string | null; estado: EstadoPc; veces: number; ultima_falla: string; ultimo: string }[];
  resultados: { activas: number; mantenimiento: number; inactivas: number; bajas: number; reactivadas: number };
}

/** Colores de las series (validados para daltonismo, en claro y oscuro) */
const SERIE_1 = 'var(--serie-1)';
const SERIE_2 = 'var(--serie-2)';
const SERIE_3 = 'var(--serie-3)';
/** Estados de un cierre (a tiempo / con retraso): siempre con su nombre al lado */
const COLOR_A_TIEMPO = '#10b981';
const COLOR_RETRASO = '#f59e0b';
/** Cierres viejos, de antes de que se guardara el horario del turno */
const COLOR_SIN_HORARIO = '#94a3b8';

interface Tooltip { x: number; y: number; titulo: string; filas: { color?: string; texto: string; valor: string | number }[] }

/** "Técnico · Programas", "Atención a docente"… */
const TIPOS: Record<TipoAtencion, string> = Object.fromEntries(
  Object.entries(TIPOS_TICKET).map(([k, v]) => [k, v.texto])) as Record<TipoAtencion, string>;
const TURNOS: Record<TurnoCodigo, string> = { M: 'Mañana', MD: 'Mediodía', T: 'Tarde', N: 'Noche' };
/** Estados de PC: mismos colores que el croquis (son estados, no series) */
const ESTADOS_PC: { clave: EstadoPc; texto: string; clase: string }[] = [
  { clave: 'operativa', texto: 'Activas', clase: 'bg-emerald-500' },
  { clave: 'inactiva', texto: 'Inactivas', clase: 'bg-slate-400' },
  { clave: 'mantenimiento', texto: 'Mantenimiento', clase: 'bg-amber-400' },
  { clave: 'baja', texto: 'De baja', clase: 'bg-rose-500' },
];

/** Secciones del dashboard (una a la vez, para no mostrar todo junto) */
type Seccion = 'resumen' | 'tickets' | 'auxiliares' | 'pcs' | 'uso';
const SECCIONES: { clave: Seccion; texto: string; icono: string }[] = [
  { clave: 'resumen', texto: 'Resumen', icono: 'panel' },
  { clave: 'tickets', texto: 'Tickets', icono: 'registros' },
  { clave: 'auxiliares', texto: 'Auxiliares y turnos', icono: 'usuarios' },
  { clave: 'pcs', texto: 'PCs y fallas', icono: 'equipo' },
  { clave: 'uso', texto: 'Uso de laboratorios', icono: 'laboratorio' },
];
/** Rango máximo de consulta (días) */
const MAXIMO_DIAS = 366;

/** Primer y último día de un mes "AAAA-MM" */
function rangoMes(mes: string): { desde: string; hasta: string } {
  const [a, m] = mes.split('-').map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}` };
}

/**
 * Dashboard de desempeño (admin y encargado): qué se hizo en el mes, quién
 * hizo más tickets, en qué laboratorios y el estado de las PCs. Todo sale de
 * una sola función de Supabase (fn_dashboard_operacion).
 */
@Component({
  selector: 'app-desempeno',
  imports: [FormsModule, IconoComponent, DatePipe, DecimalPipe, GraficoLineasComponent, GraficoBarrasComponent],
  template: `
    <header class="mb-4">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold">Desempeño</h1>
          <p class="mt-0.5 text-sm text-slate-600">{{ textoPeriodo() }}</p>
        </div>
        <button class="btn-secundario btn-sm" (click)="exportar()" [disabled]="!datos()"><app-icono nombre="descargar" [tamano]="14" /> Exportar</button>
      </div>

      <!-- Periodo -->
      <div class="tarjeta mt-3 flex flex-wrap items-end gap-2 p-3">
        <div class="flex rounded-lg border border-slate-300 bg-superficie p-0.5 text-sm">
          <button class="rounded-md px-3 py-1.5" [class]="modo() === 'mes' ? 'bg-marca-600 text-white' : 'text-slate-600'" (click)="usarMes()">Por mes</button>
          <button class="rounded-md px-3 py-1.5" [class]="modo() === 'rango' ? 'bg-marca-600 text-white' : 'text-slate-600'" (click)="usarRango()">Entre fechas</button>
        </div>
        @if (modo() === 'mes') {
          <div class="flex items-end gap-1">
            <button class="btn-secundario btn-sm !py-2" (click)="moverMes(-1)" aria-label="Mes anterior"><app-icono nombre="anterior" [tamano]="16" /></button>
            <input type="month" class="campo !w-44 !py-1.5" [ngModel]="mes()" (ngModelChange)="cambiarMes($event)" aria-label="Mes">
            <button class="btn-secundario btn-sm !py-2" (click)="moverMes(1)" [disabled]="mes() >= mesActual" aria-label="Mes siguiente"><app-icono nombre="siguiente" [tamano]="16" /></button>
          </div>
          <button class="btn-fantasma btn-sm" (click)="cambiarMes(mesActual)" [disabled]="mes() === mesActual">Este mes</button>
        } @else {
          <div>
            <label class="etiqueta" for="desempeno-desde">Desde</label>
            <input id="desempeno-desde" type="date" class="campo !py-1.5" [ngModel]="desde()" (ngModelChange)="desde.set($event)" [max]="hasta()">
          </div>
          <div>
            <label class="etiqueta" for="desempeno-hasta">Hasta</label>
            <input id="desempeno-hasta" type="date" class="campo !py-1.5" [ngModel]="hasta()" (ngModelChange)="hasta.set($event)" [min]="desde()">
          </div>
          <div class="flex flex-wrap gap-1">
            @for (a of atajos; track a.texto) {
              <button class="btn-fantasma btn-sm" (click)="aplicarAtajo(a.dias)">{{ a.texto }}</button>
            }
          </div>
          <button class="btn-primario btn-sm !py-2" (click)="cargar()" [disabled]="!!errorRango() || cargando()">Ver</button>
          @if (errorRango()) { <p class="w-full text-xs text-red-700">{{ errorRango() }}</p> }
        }
        @if (cargando()) { <span class="ml-auto self-center text-xs text-slate-500">Cargando…</span> }
      </div>

      <!-- Secciones -->
      <nav class="sticky top-0 z-20 -mx-4 mt-3 flex gap-1.5 overflow-x-auto bg-fondo px-4 py-2 sm:mx-0 sm:px-0" aria-label="Secciones del dashboard">
        @for (s of secciones; track s.clave) {
          <button class="flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition"
                  [class]="seccion() === s.clave ? 'border-marca-600 bg-marca-600 text-white' : 'border-slate-300 bg-superficie text-slate-600 hover:border-marca-300'"
                  [attr.aria-pressed]="seccion() === s.clave" (click)="irA(s.clave)">
            <app-icono [nombre]="s.icono" [tamano]="15" /> {{ s.texto }}
          </button>
        }
      </nav>
    </header>

    @if (datos(); as d) {
      @switch (seccion()) {
        @case ('resumen') {
          <!-- RESUMEN: lo más importante de cada área, en un vistazo -->
          <p class="mb-3 text-sm text-slate-500">Toque un indicador para ver su detalle.</p>
          <button class="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-700 hover:text-marca-700" (click)="irA('tickets')">Tickets <app-icono nombre="siguiente" [tamano]="14" /></button>
      <div class="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div class="tarjeta p-3">
          <p class="text-xs text-slate-500">Tickets del periodo</p>
          <p class="text-3xl font-bold tabular-nums">{{ d.kpis.tickets }}</p>
          <p class="text-xs" [class]="variacion() === null ? 'text-slate-400' : variacion()! >= 0 ? 'text-emerald-700' : 'text-rose-700'">
            @if (variacion() !== null) { {{ variacion()! >= 0 ? '▲' : '▼' }} {{ variacion()! | number: '1.0-0' }}% vs periodo anterior ({{ d.kpis.tickets_anterior }}) }
            @else { Periodo anterior: {{ d.kpis.tickets_anterior }} }
          </p>
        </div>
        <div class="tarjeta p-3">
          <p class="text-xs text-slate-500">Trabajos registrados</p>
          <p class="text-3xl font-bold tabular-nums">{{ d.kpis.trabajos }}</p>
          <p class="text-xs text-slate-500">{{ d.kpis.con_colaboradores }} hechos en equipo</p>
        </div>
        <div class="tarjeta p-3">
          <p class="text-xs text-slate-500">Resueltos</p>
          <p class="text-3xl font-bold tabular-nums">{{ pctResueltos() }}<span class="text-lg">%</span></p>
          <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200" role="meter" [attr.aria-valuenow]="pctResueltos()" aria-valuemin="0" aria-valuemax="100">
            <div class="h-full rounded-full bg-emerald-500" [style.width.%]="pctResueltos()"></div>
          </div>
          <p class="mt-1 text-xs text-slate-500">{{ d.kpis.resueltos }} de {{ d.kpis.tickets }}</p>
        </div>
        <div class="tarjeta p-3">
          <p class="text-xs text-slate-500">Pendiente ahora</p>
          <p class="text-3xl font-bold tabular-nums" [class.text-amber-700]="d.kpis.pendientes_total > 0">{{ d.kpis.pendientes_total }}</p>
          <p class="text-xs text-slate-500">tickets · {{ d.kpis.tareas_pendientes }} tareas de turno</p>
        </div>
        <div class="tarjeta p-3">
          <p class="text-xs text-slate-500">Tiempo para resolver</p>
          <p class="text-3xl font-bold tabular-nums">{{ d.kpis.horas_resolucion ?? '—' }}<span class="text-lg">{{ d.kpis.horas_resolucion !== null ? ' h' : '' }}</span></p>
          <p class="text-xs text-slate-500">promedio (tickets resueltos después)</p>
        </div>
        <div class="tarjeta p-3">
          <p class="text-xs text-slate-500">PCs activas</p>
          <p class="text-3xl font-bold tabular-nums">{{ d.pcs.operativa }}<span class="text-lg text-slate-400">/{{ d.pcs.total }}</span></p>
          <p class="text-xs text-slate-500">{{ d.pcs.mantenimiento }} en mant. · {{ d.pcs.baja }} de baja</p>
        </div>
      </div>
          <div class="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            @for (k of resumenExtra(); track k.titulo) {
              <button class="tarjeta p-3 text-left transition hover:border-marca-300" (click)="irA(k.seccion)">
                <p class="text-xs text-slate-500">{{ k.titulo }}</p>
                <p class="text-3xl font-bold tabular-nums" [class]="k.alerta ? 'text-amber-700' : ''">{{ k.valor }}</p>
                <p class="flex items-center justify-between gap-1 text-xs text-slate-500">{{ k.nota }} <app-icono nombre="siguiente" [tamano]="12" class="text-slate-400" /></p>
              </button>
            }
          </div>
      <!-- TICKETS POR DÍA -->
      <section class="tarjeta mb-5 p-4">
        <h2 class="font-semibold">Tickets por día</h2>
        <p class="mb-3 text-xs text-slate-500">{{ d.kpis.tickets }} tickets en {{ diasConTrabajo() }} días con actividad; la línea punteada son los que ya se resolvieron</p>
        <app-grafico-lineas [etiquetas]="diasMes()" [titulos]="titulosMes()" [series]="seriesTicketsDia()" [alto]="220" />
      </section>
        }

        @case ('tickets') {
      <!-- TICKETS POR DÍA -->
      <section class="tarjeta mb-5 p-4">
        <h2 class="font-semibold">Tickets por día</h2>
        <p class="mb-3 text-xs text-slate-500">{{ d.kpis.tickets }} tickets en {{ diasConTrabajo() }} días con actividad; la línea punteada son los que ya se resolvieron</p>
        <app-grafico-lineas [etiquetas]="diasMes()" [titulos]="titulosMes()" [series]="seriesTicketsDia()" [alto]="220" />
      </section>
          <div class="mb-5">
        <!-- POR TIPO -->
        <section class="tarjeta p-4">
          <h2 class="font-semibold">Qué se hizo</h2>
          <p class="mb-2 text-xs text-slate-500">Tickets por categoría y tipo de trabajo</p>
          <div class="mb-3 flex flex-wrap gap-1.5">
            @for (c of porCategoria(); track c.texto) {
              <span class="chip" [class]="c.clase">{{ c.texto }} · <b class="tabular-nums">{{ c.tickets }}</b></span>
            }
          </div>
          <div class="space-y-2.5">
            @for (t of d.por_tipo; track t.tipo) {
              <div class="cursor-default" (mousemove)="verTip($event, tipos[t.tipo], [{ color: 'var(--serie-1)', texto: 'Tickets', valor: t.tickets }, { texto: 'Trabajos', valor: t.trabajos }])" (mouseleave)="tip.set(null)">
                <div class="mb-0.5 flex justify-between text-sm"><span>{{ tipos[t.tipo] }}</span><span class="font-semibold tabular-nums">{{ t.tickets }}</span></div>
                <div class="h-2.5 rounded-r-[4px] bg-[var(--serie-1)]" [style.width.%]="(t.tickets / topeTipo()) * 100"></div>
              </div>
            } @empty {
              <p class="py-6 text-center text-sm text-slate-500">Sin tickets en este periodo.</p>
            }
          </div>
        </section>
          </div>
      @if (detalle(); as x) {
        <div class="mb-5 grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
          <section class="tarjeta p-4">
            <h2 class="font-semibold">Tickets por turno</h2>
            <p class="mb-3 text-xs text-slate-500">Según la hora en que se registraron y el horario de cada turno</p>
            <app-grafico-barras [etiquetas]="turnosDe(x.tickets_por_turno)" [series]="seriesTicketsTurno()" [alto]="190" />
          </section>
          <section class="tarjeta p-4">
            <h2 class="font-semibold">Tickets por día de la semana</h2>
            <p class="mb-3 text-xs text-slate-500">Qué días hay más trabajo</p>
            <app-grafico-barras [etiquetas]="diasCortos" [titulos]="diasLargos" [series]="seriesTicketsSemana()" [alto]="190" />
          </section>
        </div>

        <section class="tarjeta mb-5 p-4">
          <h2 class="font-semibold">Tiempo para resolver, por tipo de ticket</h2>
          <p class="mb-3 text-xs text-slate-500">Promedio en horas, solo tickets que se resolvieron después de registrarlos</p>
          <div class="grid gap-x-8 gap-y-2.5 md:grid-cols-2 [&>*]:min-w-0">
            @for (r of x.resolucion_por_tipo; track r.tipo) {
              <div class="cursor-default" (mousemove)="verTip($event, tipos[r.tipo], [{ color: colorSerie1, texto: 'Promedio', valor: r.horas + ' h' }, { texto: 'Tickets', valor: r.tickets }])" (mouseleave)="tip.set(null)">
                <div class="mb-0.5 flex justify-between text-sm"><span>{{ tipos[r.tipo] }}</span><span class="font-semibold tabular-nums">{{ r.horas | number: '1.0-1' }} h</span></div>
                <div class="h-2.5 rounded-r-[4px] bg-[var(--serie-1)]" [style.width.%]="(r.horas / topeResolucion()) * 100"></div>
              </div>
            } @empty {
              <p class="py-4 text-sm text-slate-500 md:col-span-2">Aún no hay tickets resueltos con tiempo medible en este periodo.</p>
            }
          </div>
          <p class="mt-3 text-xs text-slate-500">
            Por turno:
            @for (t of x.tickets_por_turno; track t.turno; let ultimo = $last) {
              <b class="text-slate-700">{{ turnos[t.turno] }}</b> {{ t.horas_resolucion !== null ? (t.horas_resolucion | number: '1.0-1') + ' h' : '—' }}{{ ultimo ? '' : ' · ' }}
            }
          </p>
        </section>
      }
      <!-- PCs CON MÁS TICKETS -->
      <section>
        <h2 class="mb-2 font-semibold">PCs con más tickets</h2>
        <div class="tarjeta overflow-x-auto">
          <table class="tabla">
            <thead><tr><th>PC</th><th>Laboratorio</th><th>Estado</th><th class="text-right">Tickets</th><th>Último</th></tr></thead>
            <tbody>
              @for (p of d.top_pcs; track p.etiqueta) {
                <tr>
                  <td class="font-mono text-sm font-semibold">{{ p.etiqueta }}</td>
                  <td>{{ p.lab }}</td>
                  <td><span class="inline-flex items-center gap-1.5 text-sm"><span class="h-2.5 w-2.5 rounded-sm" [class]="claseEstado(p.estado)"></span>{{ textoEstado(p.estado) }}</span></td>
                  <td class="text-right font-semibold tabular-nums">{{ p.tickets }}</td>
                  <td class="text-sm text-slate-500">{{ p.ultimo | date: 'dd/MM HH:mm' }}</td>
                </tr>
              } @empty {
                <tr><td colspan="5" class="py-6 text-center text-sm text-slate-500">Ninguna PC tuvo tickets en este periodo.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
        }

        @case ('auxiliares') {
          <div class="mb-5">
        <!-- RANKING DE AUXILIARES -->
        <section class="tarjeta p-4">
          <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 class="flex items-center gap-2 font-semibold"><app-icono nombre="trofeo" [tamano]="17" /> Ranking de auxiliares</h2>
              <p class="text-xs text-slate-500">Tickets en los que participó cada uno</p>
            </div>
            <div class="flex gap-3 text-xs text-slate-600">
              <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-[var(--serie-1)]"></span> Registró</span>
              <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-[var(--serie-2)]"></span> Colaboró</span>
            </div>
          </div>
          <div class="space-y-2.5">
            @for (a of d.auxiliares; track a.id; let i = $index) {
              <div class="grid cursor-default grid-cols-[1.5rem_9rem_1fr] items-center gap-2 rounded-md px-1 py-0.5 hover:bg-slate-100/60"
                   (mousemove)="verTip($event, a.nombre, [
                     { color: 'var(--serie-1)', texto: 'Registró', valor: a.registrados + ' tickets (' + a.trabajos + ' trabajos)' },
                     { color: 'var(--serie-2)', texto: 'Colaboró', valor: a.colaboraciones },
                     { texto: 'Resolvió', valor: a.resueltos },
                     { texto: 'PCs atendidas', valor: a.pcs_atendidas }])"
                   (mouseleave)="tip.set(null)">
                <span class="text-center text-sm font-bold" [class]="i === 0 && a.participaciones ? 'text-amber-600' : 'text-slate-400'">{{ i + 1 }}</span>
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium">{{ a.nombre }}</span>
                  <span class="block text-[10px] text-slate-400">{{ a.turno ? turnos[a.turno] : a.rol }}</span>
                </span>
                <span class="flex items-center gap-2">
                  <span class="flex h-5 min-w-0 gap-[2px]" [style.width.%]="(a.participaciones / topeAux()) * 85">
                    @if (a.registrados) { <span class="h-full rounded-l-[4px] bg-[var(--serie-1)]" [class.rounded-r-[4px]]="!a.colaboraciones" [style.flex-grow]="a.registrados"></span> }
                    @if (a.colaboraciones) { <span class="h-full rounded-r-[4px] bg-[var(--serie-2)]" [class.rounded-l-[4px]]="!a.registrados" [style.flex-grow]="a.colaboraciones"></span> }
                  </span>
                  <span class="text-sm font-semibold tabular-nums">{{ a.participaciones }}</span>
                </span>
              </div>
            } @empty {
              <p class="py-6 text-center text-sm text-slate-500">No hay auxiliares activos.</p>
            }
          </div>
        </section>
          </div>
      <!-- DETALLE POR AUXILIAR -->
      <section class="mb-5">
        <h2 class="mb-2 font-semibold">Detalle por auxiliar</h2>
        <div class="tarjeta overflow-x-auto">
          <table class="tabla">
            <thead>
              <tr>
                <th>Auxiliar</th><th>Turno</th><th class="text-right">Participó</th><th class="text-right">Registró</th>
                <th class="text-right">Trabajos</th><th class="text-right">Colaboró</th><th class="text-right">Resolvió</th>
                <th class="text-right">PCs</th><th class="text-right">Reportes</th><th class="text-right">Tareas hechas</th>
              </tr>
            </thead>
            <tbody>
              @for (a of d.auxiliares; track a.id) {
                <tr>
                  <td class="font-medium">{{ a.nombre }}</td>
                  <td class="text-sm text-slate-500">{{ a.turno ? turnos[a.turno] : '—' }}</td>
                  <td class="text-right font-semibold tabular-nums">{{ a.participaciones }}</td>
                  <td class="text-right tabular-nums">{{ a.registrados }}</td>
                  <td class="text-right tabular-nums">{{ a.trabajos }}</td>
                  <td class="text-right tabular-nums">{{ a.colaboraciones }}</td>
                  <td class="text-right tabular-nums">{{ a.resueltos }}</td>
                  <td class="text-right tabular-nums">{{ a.pcs_atendidas }}</td>
                  <td class="text-right tabular-nums">{{ a.reportes }}</td>
                  <td class="text-right tabular-nums">{{ a.tareas_hechas }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="mt-1 text-xs text-slate-400">Un trabajo en 20 PCs cuenta como 20 tickets y 1 trabajo. "Colaboró" son tickets que registró otro.</p>
      </section>
          @if (detalle(); as x) {
            <h2 class="mt-6 mb-3 flex items-center gap-2 text-lg font-semibold"><app-icono nombre="hora" [tamano]="18" /> Cierres de turno</h2>
        <div class="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <div class="tarjeta p-3">
            <p class="text-xs text-slate-500">Cierres del periodo</p>
            <p class="text-3xl font-bold tabular-nums">{{ x.cierres.total }}</p>
            <p class="text-xs text-slate-500">{{ x.cierres.sin_horario }} sin horario registrado</p>
          </div>
          <div class="tarjeta p-3">
            <p class="text-xs text-slate-500">A tiempo</p>
            <p class="text-3xl font-bold tabular-nums">{{ pctATiempo() }}<span class="text-lg">%</span></p>
            <p class="text-xs text-slate-500">{{ x.cierres.a_tiempo }} de {{ x.cierres.a_tiempo + x.cierres.con_retraso }} con horario</p>
          </div>
          <div class="tarjeta p-3">
            <p class="text-xs text-slate-500">Con retraso</p>
            <p class="text-3xl font-bold tabular-nums" [class.text-amber-700]="x.cierres.con_retraso > 0">{{ x.cierres.con_retraso }}</p>
            <p class="text-xs text-slate-500">cierres después de la hora de fin</p>
          </div>
          <div class="tarjeta p-3">
            <p class="text-xs text-slate-500">Retraso promedio</p>
            <p class="text-3xl font-bold tabular-nums">{{ x.cierres.retraso_promedio !== null ? retraso(x.cierres.retraso_promedio) : '—' }}</p>
            <p class="text-xs text-slate-500">máximo: {{ x.cierres.retraso_maximo ? retraso(x.cierres.retraso_maximo) : '—' }}</p>
          </div>
          <div class="tarjeta p-3">
            <p class="text-xs text-slate-500">PCs dadas de baja</p>
            <p class="text-3xl font-bold tabular-nums" [class.text-rose-700]="x.bajas.length > 0">{{ x.bajas.length }}</p>
            <p class="text-xs text-slate-500">{{ x.reactivadas }} reactivadas en este periodo</p>
          </div>
        </div>

        <div class="mb-5 grid gap-5 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
          <section class="tarjeta p-4">
            <h3 class="font-semibold">Cierres por día</h3>
            <p class="mb-3 text-xs text-slate-500">A tiempo y con retraso ("sin horario": cierres de antes de registrar los horarios de turno)</p>
            <app-grafico-barras [etiquetas]="diasMes()" [titulos]="titulosMes()" [series]="seriesCierresDia()" [alto]="190" />
          </section>
          <section class="tarjeta p-4">
            <h3 class="font-semibold">Por turno</h3>
            <p class="mb-2 text-xs text-slate-500">Cierres y retraso promedio de cada turno</p>
            <div class="mb-3 flex flex-wrap gap-3 text-xs text-slate-600">
              <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-emerald-500"></span> A tiempo</span>
              <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-amber-500"></span> Con retraso</span>
              <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-slate-400"></span> Sin horario</span>
            </div>
            <div class="space-y-2.5">
              @for (t of x.cierres.por_turno; track t.turno) {
                <div>
                  <div class="mb-0.5 flex justify-between text-sm">
                    <span>{{ turnos[t.turno] }}</span>
                    <span class="tabular-nums"><b>{{ t.cierres }}</b> cierres · <span [class.text-amber-700]="t.con_retraso > 0">{{ t.con_retraso }} tarde</span>{{ t.retraso_promedio ? ' · ' + retraso(t.retraso_promedio) : '' }}</span>
                  </div>
                  <div class="flex h-2.5 gap-[2px] [&>span:last-child]:rounded-r-[4px]" [style.width.%]="(t.cierres / topeCierresTurno()) * 100">
                    @if (t.a_tiempo) { <span class="h-full bg-emerald-500" [style.flex-grow]="t.a_tiempo" title="A tiempo"></span> }
                    @if (t.con_retraso) { <span class="h-full bg-amber-500" [style.flex-grow]="t.con_retraso" title="Con retraso"></span> }
                    @if (t.sin_horario) { <span class="h-full bg-slate-400" [style.flex-grow]="t.sin_horario" title="Sin horario"></span> }
                  </div>
                </div>
              }
            </div>
          </section>
        </div>

        <section class="mb-5">
          <h3 class="mb-2 font-semibold">Cierres por auxiliar</h3>
          <div class="tarjeta overflow-x-auto">
            <table class="tabla">
              <thead>
                <tr><th>Quién cerró</th><th class="text-right">Cierres</th><th class="text-right">A tiempo</th><th class="text-right">Con retraso</th>
                    <th class="text-right">Retraso prom.</th><th class="text-right">Retraso máx.</th><th class="text-right">PCs de baja</th></tr>
              </thead>
              <tbody>
                @for (a of x.cierres.por_auxiliar; track a.nombre) {
                  <tr>
                    <td class="font-medium">{{ a.nombre }}</td>
                    <td class="text-right font-semibold tabular-nums">{{ a.cierres }}</td>
                    <td class="text-right tabular-nums">{{ a.a_tiempo }}</td>
                    <td class="text-right tabular-nums" [class.text-amber-700]="a.con_retraso > 0">{{ a.con_retraso }}</td>
                    <td class="text-right tabular-nums">{{ a.retraso_promedio ? retraso(a.retraso_promedio) : '—' }}</td>
                    <td class="text-right tabular-nums">{{ a.retraso_maximo ? retraso(a.retraso_maximo) : '—' }}</td>
                    <td class="text-right tabular-nums" [class.text-rose-700]="a.pcs_baja > 0">{{ a.pcs_baja }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="py-6 text-center text-sm text-slate-500">No hubo cierres de turno en este periodo.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>
        <!-- OBJETOS PERDIDOS -->
        <section class="tarjeta mb-5 p-4">
          <h3 class="flex items-center gap-2 font-semibold"><app-icono nombre="objeto" [tamano]="17" /> Objetos perdidos</h3>
          <p class="mb-3 text-xs text-slate-500">
            <b class="text-slate-700">{{ x.objetos.registrados }}</b> encontrados en este periodo ·
            <b class="text-slate-700">{{ x.objetos.entregados }}</b> entregados ·
            <b class="text-slate-700">{{ x.objetos.en_custodia }}</b> en custodia ahora
          </p>
          <div class="space-y-2">
            @for (l of x.objetos.por_lab; track l.codigo) {
              <div class="grid grid-cols-[4.5rem_1fr_2rem] items-center gap-3">
                <span class="flex items-center gap-1.5 text-sm font-semibold"><span class="h-3 w-1 rounded-full" [style.background]="l.color"></span>{{ l.codigo }}</span>
                <span class="h-2.5 rounded-r-[4px] bg-[var(--serie-1)]" [style.width.%]="(l.objetos / topeObjetos()) * 100"></span>
                <span class="text-right text-sm font-semibold tabular-nums">{{ l.objetos }}</span>
              </div>
            } @empty {
              <p class="py-2 text-sm text-slate-500">No se registraron objetos en este periodo.</p>
            }
          </div>
        </section>
          }
        }

        @case ('pcs') {
      <!-- PCs POR LABORATORIO -->
      <section class="tarjeta mb-5 p-4">
        <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 class="font-semibold">Laboratorios: PCs y tickets</h2>
            <p class="text-xs text-slate-500">{{ d.pcs.total }} PCs en total ({{ d.pcs.docentes }} de docente)</p>
          </div>
          <div class="flex flex-wrap gap-3 text-xs text-slate-600">
            @for (e of estadosPc; track e.clave) {
              <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm" [class]="e.clase"></span> {{ e.texto }}</span>
            }
          </div>
        </div>
        <div class="space-y-2">
          @for (l of d.por_lab; track l.id) {
            <div class="grid cursor-default grid-cols-[4.5rem_1fr_6.5rem] items-center gap-3 rounded-md px-1 py-0.5 hover:bg-slate-100/60"
                 (mousemove)="verTipLab($event, l)" (mouseleave)="tip.set(null)">
              <span class="flex items-center gap-1.5 text-sm font-semibold"><span class="h-3 w-1 rounded-full" [style.background]="l.color"></span>{{ l.codigo }}</span>
              @if (l.pcs.total) {
                <span class="flex h-4 gap-[2px]" [style.width.%]="(l.pcs.total / topeLab()) * 100">
                  @for (e of estadosPc; track e.clave; let ultimo = $last) {
                    @if (l.pcs[e.clave]) {
                      <span class="h-full first:rounded-l-[2px] last:rounded-r-[4px]" [class]="e.clase" [style.flex-grow]="l.pcs[e.clave]"></span>
                    }
                  }
                </span>
              } @else {
                <span class="text-xs text-slate-400">Sin PCs cargadas</span>
              }
              <span class="text-right text-xs text-slate-500 tabular-nums">
                <b class="text-slate-700">{{ l.pcs.total }}</b> PCs · <b class="text-slate-700">{{ l.tickets }}</b> tk
              </span>
            </div>
          }
        </div>
      </section>
          @if (detalle(); as x) {
        <!-- PCs DADAS DE BAJA -->
        <section class="mb-5">
          <h3 class="mb-2 font-semibold">PCs dadas de baja en este periodo</h3>
          <div class="tarjeta overflow-x-auto">
            <table class="tabla">
              <thead><tr><th>PC</th><th>Laboratorio</th><th>Motivo</th><th>Quién</th><th>Cuándo</th></tr></thead>
              <tbody>
                @for (b of x.bajas; track b.etiqueta + b.en) {
                  <tr>
                    <td class="font-mono text-sm font-semibold">{{ b.etiqueta }}</td>
                    <td>{{ b.lab ?? '—' }}</td>
                    <td class="max-w-72 text-sm">{{ b.motivo || '—' }}</td>
                    <td class="text-sm">{{ b.por ?? '—' }}</td>
                    <td class="text-sm whitespace-nowrap text-slate-500">{{ b.en | date: 'dd/MM HH:mm' }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="5" class="py-6 text-center text-sm text-slate-500">Ninguna PC se dio de baja en este periodo.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>
          }
        @if (fallas(); as fx) {
          <h2 class="mt-6 mb-3 flex items-center gap-2 text-lg font-semibold"><app-icono nombre="mantenimiento" [tamano]="18" /> Fallas de PCs</h2>
          <div class="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <div class="tarjeta p-3">
              <p class="text-xs text-slate-500">Correctivos del periodo</p>
              <p class="text-3xl font-bold tabular-nums">{{ fx.total }}</p>
              <p class="text-xs text-slate-500">{{ fx.con_ficha }} con ficha de fallas</p>
            </div>
            <div class="tarjeta p-3">
              <p class="text-xs text-slate-500">Quedaron activas</p>
              <p class="text-3xl font-bold tabular-nums text-emerald-700">{{ fx.resultados.activas }}</p>
              <p class="text-xs text-slate-500">{{ fx.resultados.reactivadas }} venían de baja</p>
            </div>
            <div class="tarjeta p-3">
              <p class="text-xs text-slate-500">Siguen en mantenimiento</p>
              <p class="text-3xl font-bold tabular-nums" [class.text-amber-700]="fx.resultados.mantenimiento > 0">{{ fx.resultados.mantenimiento }}</p>
              <p class="text-xs text-slate-500">{{ fx.resultados.inactivas }} quedaron inactivas</p>
            </div>
            <div class="tarjeta p-3">
              <p class="text-xs text-slate-500">Dadas de baja</p>
              <p class="text-3xl font-bold tabular-nums" [class.text-rose-700]="fx.resultados.bajas > 0">{{ fx.resultados.bajas }}</p>
              <p class="text-xs text-slate-500">desde una ficha</p>
            </div>
            <div class="tarjeta p-3">
              <p class="text-xs text-slate-500">PCs reincidentes</p>
              <p class="text-3xl font-bold tabular-nums" [class.text-amber-700]="fx.reincidentes.length > 0">{{ fx.reincidentes.length }}</p>
              <p class="text-xs text-slate-500">reparadas 2 o más veces</p>
            </div>
          </div>

          <div class="mb-5 grid gap-5 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
            <section class="tarjeta p-4">
              <h3 class="font-semibold">Fallas más repetidas</h3>
              <p class="mb-2 text-xs text-slate-500">Veces que se marcó cada falla en una ficha</p>
              <div class="mb-3 flex flex-wrap gap-1.5">
                @for (c of fx.por_categoria; track c.categoria) {
                  <span class="chip bg-slate-100 text-slate-700">{{ textoCategoriaFalla(c.categoria) }} · <b class="tabular-nums">{{ c.veces }}</b></span>
                }
              </div>
              <div class="space-y-2.5">
                @for (fa of fx.fallas; track fa.falla; let i = $index) {
                  <div class="cursor-default" (mousemove)="verTip($event, fa.falla, [
                         { color: colorSerie1, texto: 'Veces', valor: fa.veces },
                         { texto: 'PCs distintas', valor: fa.pcs },
                         { texto: 'Grupo', valor: textoCategoriaFalla(fa.categoria) },
                         { texto: 'Laboratorios', valor: fa.labs ?? '—' }])" (mouseleave)="tip.set(null)">
                    <div class="mb-0.5 flex justify-between gap-2 text-sm">
                      <span class="truncate"><span class="mr-1 text-slate-400 tabular-nums">{{ i + 1 }}.</span>{{ fa.falla }} <span class="text-xs text-slate-400">· {{ fa.labs }}</span></span>
                      <span class="shrink-0 font-semibold tabular-nums">{{ fa.veces }}</span>
                    </div>
                    <div class="h-2.5 rounded-r-[4px] bg-[var(--serie-1)]" [style.width.%]="(fa.veces / topeFalla()) * 100"></div>
                  </div>
                } @empty {
                  <p class="py-6 text-center text-sm text-slate-500">Aún no hay fichas de reparación en este periodo.</p>
                }
              </div>
            </section>

            <section class="tarjeta p-4">
              <h3 class="font-semibold">Piezas más cambiadas</h3>
              <p class="mb-3 text-xs text-slate-500">Para saber qué repuestos conviene tener</p>
              <div class="space-y-2.5">
                @for (pz of fx.piezas; track pz.pieza) {
                  <div>
                    <div class="mb-0.5 flex justify-between text-sm"><span>{{ pz.pieza }}</span><span class="font-semibold tabular-nums">{{ pz.veces }}</span></div>
                    <div class="h-2.5 rounded-r-[4px] bg-[var(--serie-2)]" [style.width.%]="(pz.veces / topePieza()) * 100"></div>
                  </div>
                } @empty {
                  <p class="py-6 text-center text-sm text-slate-500">No se registraron piezas cambiadas en este periodo.</p>
                }
              </div>
            </section>
          </div>

          <div class="mb-5 grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
            <section>
              <h3 class="mb-2 font-semibold">PCs reincidentes</h3>
              <div class="tarjeta overflow-x-auto">
                <table class="tabla">
                  <thead><tr><th>PC</th><th>Lab.</th><th>Estado</th><th class="text-right">Reparaciones</th><th>Última falla</th></tr></thead>
                  <tbody>
                    @for (r of fx.reincidentes; track r.etiqueta) {
                      <tr>
                        <td class="font-mono text-sm font-semibold">{{ r.etiqueta }}</td>
                        <td>{{ r.lab ?? '—' }}</td>
                        <td><span class="inline-flex items-center gap-1.5 text-sm"><span class="h-2.5 w-2.5 rounded-sm" [class]="claseEstado(r.estado)"></span>{{ textoEstado(r.estado) }}</span></td>
                        <td class="text-right font-semibold tabular-nums">{{ r.veces }}</td>
                        <td class="max-w-56 truncate text-sm" [title]="r.ultima_falla">{{ r.ultima_falla }}</td>
                      </tr>
                    } @empty {
                      <tr><td colspan="5" class="py-6 text-center text-sm text-slate-500">Ninguna PC se reparó más de una vez en este periodo.</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>
            <section>
              <h3 class="mb-2 font-semibold">"Otras" fallas más escritas</h3>
              <div class="tarjeta overflow-x-auto">
                <table class="tabla">
                  <thead><tr><th>Falla escrita</th><th class="text-right">Veces</th><th>Agregar a la lista</th></tr></thead>
                  <tbody>
                    @for (o of fx.otras; track o.texto) {
                      <tr>
                        <td class="max-w-56 truncate text-sm" [title]="o.texto">{{ o.texto }}</td>
                        <td class="text-right font-semibold tabular-nums">{{ o.veces }}</td>
                        <td>
                          @if (o.en_lista || agregadas().has(o.texto.toLowerCase())) {
                            <span class="chip bg-emerald-100 text-emerald-700">Ya está en la lista</span>
                          } @else {
                            <span class="flex items-center gap-1">
                              <select #grupo class="campo !w-28 !py-0.5 text-xs" aria-label="Grupo">
                                @for (c of categoriasFalla; track c.valor) { <option [value]="c.valor" [selected]="c.valor === 'otro'">{{ c.texto }}</option> }
                              </select>
                              <button class="btn-secundario btn-sm" (click)="agregarOtra(o.texto, $any(grupo.value))"><app-icono nombre="agregar" [tamano]="13" /> Agregar</button>
                            </span>
                          }
                        </td>
                      </tr>
                    } @empty {
                      <tr><td colspan="3" class="py-6 text-center text-sm text-slate-500">Nadie usó "Otra" en este periodo.</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        }
        }

        @case ('uso') {
    @if (uso(); as u) {

      <div class="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div class="tarjeta p-3">
          <p class="text-xs text-slate-500">Horas de clase</p>
          <p class="text-3xl font-bold tabular-nums">{{ u.totales.horas_clase | number: '1.0-0' }}<span class="text-lg"> h</span></p>
          <p class="text-xs text-slate-500">{{ u.totales.materias }} materias distintas</p>
        </div>
        <div class="tarjeta p-3">
          <p class="text-xs text-slate-500">Horas cedidas</p>
          <p class="text-3xl font-bold tabular-nums">{{ u.totales.horas_cesion | number: '1.0-0' }}<span class="text-lg"> h</span></p>
          <p class="text-xs text-slate-500">laboratorio prestado a otro docente</p>
        </div>
        <div class="tarjeta p-3">
          <p class="text-xs text-slate-500">Horas de eventos</p>
          <p class="text-3xl font-bold tabular-nums">{{ u.totales.horas_evento | number: '1.0-0' }}<span class="text-lg"> h</span></p>
          <p class="text-xs text-slate-500">{{ u.totales.eventos }} eventos y defensas</p>
        </div>
        <div class="tarjeta p-3">
          <p class="text-xs text-slate-500">Laboratorio más usado</p>
          <p class="text-3xl font-bold">{{ labMasUsado()?.codigo ?? '—' }}</p>
          <p class="text-xs text-slate-500">{{ labMasUsado() ? (totalLab(labMasUsado()!) | number: '1.0-0') + ' h en el periodo' : 'Sin uso' }}</p>
        </div>
      </div>

      @if (detalle(); as x) {
        <section class="tarjeta mb-5 p-4">
          <h3 class="font-semibold">Horas de uso por día</h3>
          <p class="mb-3 text-xs text-slate-500">Horas de laboratorio ocupadas cada día, por clases, cedidas y eventos</p>
          <app-grafico-lineas [etiquetas]="diasMes()" [titulos]="titulosMes()" [series]="seriesUso(x.uso_por_dia)" unidad=" h" [alto]="230" />
        </section>
        <div class="mb-5 grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
          <section class="tarjeta p-4">
            <h3 class="font-semibold">Uso por día de la semana</h3>
            <p class="mb-3 text-xs text-slate-500">Horas en todo el periodo</p>
            <app-grafico-barras [etiquetas]="diasCortos" [titulos]="diasLargos" [series]="seriesUso(x.uso_por_dia_semana)" unidad=" h" [alto]="200" />
          </section>
          <section class="tarjeta p-4">
            <h3 class="font-semibold">Horas pico</h3>
            <p class="mb-3 text-xs text-slate-500">Horas de laboratorio usadas en cada franja del día (todo el periodo)</p>
            <app-grafico-barras [etiquetas]="horasCortas(x.uso_por_hora)" [titulos]="horasLargas(x.uso_por_hora)" [series]="seriesUso(x.uso_por_hora)" unidad=" h" [alto]="200" />
          </section>
        </div>
      }

      <div class="mb-5 grid gap-5 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <!-- MATERIAS -->
        <section class="tarjeta p-4">
          <h3 class="font-semibold">Materias que más ocupan los laboratorios</h3>
          <p class="mb-3 text-xs text-slate-500">Horas en laboratorio. En una cesión cuenta la materia de quien viene.</p>
          <div class="space-y-2.5">
            @for (m of u.materias; track m.materia; let i = $index) {
              <div class="cursor-default" (mousemove)="verTip($event, m.materia, [
                     { color: colorClase, texto: 'Horas', valor: m.horas },
                     { texto: 'Clases dictadas', valor: m.sesiones },
                     { texto: 'De ellas cedidas', valor: m.cedidas },
                     { texto: 'Docentes', valor: m.docentes },
                     { texto: 'Laboratorios', valor: m.labs }])" (mouseleave)="tip.set(null)">
                <div class="mb-0.5 flex justify-between gap-2 text-sm">
                  <span class="truncate"><span class="mr-1 text-slate-400 tabular-nums">{{ i + 1 }}.</span>{{ m.materia }} <span class="text-xs text-slate-400">· {{ m.labs }}</span></span>
                  <span class="shrink-0 font-semibold tabular-nums">{{ m.horas | number: '1.0-1' }} h</span>
                </div>
                <div class="h-2.5 rounded-r-[4px]" [style.background]="colorClase" [style.width.%]="(m.horas / topeMateria()) * 100"></div>
              </div>
            } @empty {
              <p class="py-6 text-center text-sm text-slate-500">Sin clases en este periodo.</p>
            }
          </div>
        </section>

        <!-- EVENTOS -->
        <section class="tarjeta p-4">
          <h3 class="font-semibold">Eventos y defensas</h3>
          <p class="mb-3 text-xs text-slate-500">Los que más horas ocuparon laboratorios</p>
          <div class="space-y-2.5">
            @for (e of u.eventos; track e.titulo + e.tipo) {
              <div class="cursor-default" (mousemove)="verTip($event, e.titulo, [
                     { color: colorEvento, texto: 'Horas', valor: e.horas },
                     { texto: 'Días', valor: e.dias },
                     { texto: 'Laboratorios', valor: e.labs }])" (mouseleave)="tip.set(null)">
                <div class="mb-0.5 flex justify-between gap-2 text-sm">
                  <span class="truncate">{{ e.titulo }} <span class="chip ml-1 bg-orange-100 text-[10px] text-orange-800 capitalize">{{ e.tipo }}</span></span>
                  <span class="shrink-0 font-semibold tabular-nums">{{ e.horas | number: '1.0-1' }} h</span>
                </div>
                <div class="h-2.5 rounded-r-[4px]" [style.background]="colorEvento" [style.width.%]="(e.horas / topeEvento()) * 100"></div>
              </div>
            } @empty {
              <p class="py-6 text-center text-sm text-slate-500">Sin eventos en este periodo.</p>
            }
          </div>
        </section>
      </div>

      @if (detalle(); as x) {
        <div class="mb-5 grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
          <!-- CARRERAS -->
          <section class="tarjeta p-4">
            <h3 class="font-semibold">Carreras que más usan los laboratorios</h3>
            <p class="mb-3 text-xs text-slate-500">Horas de clase y cedidas</p>
            <div class="space-y-2.5">
              @for (c of x.carreras; track c.nombre) {
                <div class="cursor-default" (mousemove)="verTip($event, c.nombre, [
                       { color: colorClase, texto: 'Horas', valor: c.horas },
                       { texto: 'Clases', valor: c.sesiones },
                       { texto: 'Materias', valor: c.materias },
                       { texto: 'Docentes', valor: c.docentes }])" (mouseleave)="tip.set(null)">
                  <div class="mb-0.5 flex justify-between gap-2 text-sm">
                    <span class="truncate" [title]="c.nombre">{{ c.carrera }} <span class="text-xs text-slate-400">· {{ c.materias }} materias</span></span>
                    <span class="shrink-0 font-semibold tabular-nums">{{ c.horas | number: '1.0-1' }} h</span>
                  </div>
                  <div class="h-2.5 rounded-r-[4px]" [style.background]="colorClase" [style.width.%]="(c.horas / topeCarrera()) * 100"></div>
                </div>
              } @empty {
                <p class="py-6 text-center text-sm text-slate-500">Sin clases en este periodo.</p>
              }
            </div>
          </section>
          <!-- DOCENTES -->
          <section class="tarjeta p-4">
            <h3 class="font-semibold">Docentes que más usan los laboratorios</h3>
            <p class="mb-3 text-xs text-slate-500">Horas de clase y cedidas, y pedidos que hicieron a los auxiliares</p>
            <div class="space-y-2.5">
              @for (dc of x.docentes; track dc.docente; let i = $index) {
                <div class="cursor-default" (mousemove)="verTip($event, dc.docente, [
                       { color: colorClase, texto: 'Horas', valor: dc.horas },
                       { texto: 'Clases', valor: dc.sesiones },
                       { texto: 'Pedidos a auxiliares', valor: dc.pedidos },
                       { texto: 'Materias', valor: dc.materias }])" (mouseleave)="tip.set(null)">
                  <div class="mb-0.5 flex justify-between gap-2 text-sm">
                    <span class="truncate"><span class="mr-1 text-slate-400 tabular-nums">{{ i + 1 }}.</span>{{ dc.docente }}</span>
                    <span class="shrink-0 font-semibold tabular-nums">{{ dc.horas | number: '1.0-1' }} h</span>
                  </div>
                  <div class="h-2.5 rounded-r-[4px]" [style.background]="colorClase" [style.width.%]="(dc.horas / topeDocente()) * 100"></div>
                </div>
              } @empty {
                <p class="py-6 text-center text-sm text-slate-500">Sin clases en este periodo.</p>
              }
            </div>
          </section>
        </div>
      }

      <!-- HORAS POR LABORATORIO -->
      <section class="tarjeta mb-5 p-4">
        <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 class="font-semibold">Horas de uso por laboratorio</h3>
            <p class="text-xs text-slate-500">Y la materia que más lo ocupa</p>
          </div>
          <div class="flex flex-wrap gap-3 text-xs text-slate-600">
            <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm" [style.background]="colorClase"></span> Clases</span>
            <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm" [style.background]="colorCesion"></span> Cedidas</span>
            <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm" [style.background]="colorEvento"></span> Eventos</span>
          </div>
        </div>
        <div class="space-y-2">
          @for (l of u.por_lab; track l.codigo) {
            <div class="grid cursor-default grid-cols-[4.5rem_1fr_minmax(5rem,12rem)] items-center gap-3 rounded-md px-1 py-0.5 hover:bg-slate-100/60"
                 (mousemove)="verTip($event, l.codigo, [
                   { color: colorClase, texto: 'Clases', valor: l.clase + ' h' },
                   { color: colorCesion, texto: 'Cedidas', valor: l.cesion + ' h' },
                   { color: colorEvento, texto: 'Eventos', valor: l.evento + ' h' },
                   { texto: 'Materia principal', valor: l.materia_top ?? '—' }])" (mouseleave)="tip.set(null)">
              <span class="flex items-center gap-1.5 text-sm font-semibold"><span class="h-3 w-1 rounded-full" [style.background]="l.color"></span>{{ l.codigo }}</span>
              @if (totalLab(l)) {
                <span class="flex h-4 gap-[2px]" [style.width.%]="(totalLab(l) / topeHorasLab()) * 100">
                  @if (l.clase) { <span class="h-full first:rounded-l-[2px] last:rounded-r-[4px]" [style.background]="colorClase" [style.flex-grow]="l.clase"></span> }
                  @if (l.cesion) { <span class="h-full first:rounded-l-[2px] last:rounded-r-[4px]" [style.background]="colorCesion" [style.flex-grow]="l.cesion"></span> }
                  @if (l.evento) { <span class="h-full first:rounded-l-[2px] last:rounded-r-[4px]" [style.background]="colorEvento" [style.flex-grow]="l.evento"></span> }
                </span>
              } @else {
                <span class="text-xs text-slate-400">Sin uso en este periodo</span>
              }
              <span class="truncate text-right text-xs text-slate-500">
                <b class="text-slate-700 tabular-nums">{{ totalLab(l) | number: '1.0-0' }} h</b>{{ l.materia_top ? ' · ' + l.materia_top : '' }}
              </span>
            </div>
          }
        </div>
      </section>

      <div class="mb-5 grid gap-5 xl:grid-cols-[1fr_1.4fr] [&>*]:min-w-0">
        <!-- ACTIVIDADES DE AUXILIARES POR LAB -->
        <section class="tarjeta p-4">
          <h3 class="font-semibold">Qué hacen los auxiliares en cada laboratorio</h3>
          <p class="mb-3 text-xs text-slate-500">Tickets del periodo por tipo, del laboratorio con más trabajo al de menos</p>
          <div class="space-y-3">
            @for (l of u.actividades_lab; track l.codigo) {
              <div>
                <div class="mb-1 flex items-center justify-between text-sm">
                  <span class="flex items-center gap-1.5 font-semibold"><span class="h-3 w-1 rounded-full" [style.background]="l.color"></span>{{ l.codigo }}</span>
                  <span class="text-xs text-slate-500 tabular-nums"><b class="text-slate-700">{{ l.total }}</b> tickets</span>
                </div>
                <div class="flex flex-wrap gap-1">
                  @for (t of l.tipos; track t.tipo; let primero = $first) {
                    <span class="chip" [class]="primero ? 'bg-marca-100 font-semibold text-marca-700' : 'bg-slate-100 text-slate-600'">{{ tipos[t.tipo] }} · {{ t.tickets }}</span>
                  }
                </div>
              </div>
            } @empty {
              <p class="py-6 text-center text-sm text-slate-500">Sin tickets en laboratorios en este periodo.</p>
            }
          </div>
        </section>

        <!-- PEDIDOS MÁS FRECUENTES -->
        <section class="tarjeta p-4">
          <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 class="font-semibold">Peticiones y pedidos más frecuentes</h3>
              <p class="text-xs text-slate-500">Mismo texto = mismo pedido</p>
            </div>
            <div class="flex gap-1">
              <button class="rounded-md border px-2 py-1 text-xs" [class]="!soloPeticiones() ? 'border-marca-600 bg-marca-600 text-white' : 'border-slate-200 hover:border-slate-300'"
                      (click)="soloPeticiones.set(false)">Todos</button>
              <button class="rounded-md border px-2 py-1 text-xs" [class]="soloPeticiones() ? 'border-marca-600 bg-marca-600 text-white' : 'border-slate-200 hover:border-slate-300'"
                      (click)="soloPeticiones.set(true)">Solo de docentes</button>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="tabla">
              <thead><tr><th>Pedido</th><th>Tipo</th><th>Lab.</th><th class="text-right">Veces</th><th class="text-right">Pend.</th><th>Último</th></tr></thead>
              <tbody>
                @for (p of pedidosVisibles(); track p.tipo + p.descripcion) {
                  <tr>
                    <td class="max-w-64">
                      <p class="truncate font-medium" [title]="p.descripcion">{{ p.descripcion }}</p>
                      @if (p.solicitantes) { <p class="truncate text-xs text-slate-500">Pidió: {{ p.solicitantes }}</p> }
                    </td>
                    <td class="text-sm whitespace-nowrap">{{ tipos[p.tipo] }}</td>
                    <td class="text-sm">{{ p.labs ?? '—' }}</td>
                    <td class="text-right font-semibold tabular-nums">{{ p.veces }}</td>
                    <td class="text-right tabular-nums" [class.text-amber-700]="p.pendientes > 0">{{ p.pendientes }}</td>
                    <td class="text-sm whitespace-nowrap text-slate-500">{{ p.ultimo | date: 'dd/MM HH:mm' }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="6" class="py-6 text-center text-sm text-slate-500">{{ soloPeticiones() ? 'Sin pedidos de docentes en este periodo.' : 'Sin tickets en este periodo.' }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      </div>
    }
          @else { <p class="tarjeta p-10 text-center text-sm text-slate-500">{{ cargando() ? 'Cargando…' : 'Sin datos de uso.' }}</p> }
        }
      }
    } @else {
      <p class="tarjeta p-10 text-center text-sm text-slate-500">{{ cargando() ? 'Cargando…' : 'Sin datos.' }}</p>
    }

    <!-- Tooltip -->
    @if (tip(); as t) {
      <div class="pointer-events-none fixed z-50 min-w-40 rounded-lg border border-slate-200 bg-superficie px-3 py-2 text-xs shadow-lg"
           [style.left.px]="t.x + 14" [style.top.px]="t.y + 14">
        <p class="mb-1 font-semibold text-slate-800">{{ t.titulo }}</p>
        @for (f of t.filas; track f.texto) {
          <p class="flex items-center gap-1.5 text-slate-600">
            @if (f.color) { <span class="h-2 w-2 rounded-sm" [style.background]="f.color"></span> }
            {{ f.texto }}: <b class="ml-auto pl-2 text-slate-800 tabular-nums">{{ f.valor }}</b>
          </p>
        }
      </div>
    }
  `,
  styles: `
    :host { --serie-1: #2a78d6; --serie-2: #eb6834; --serie-3: #1baf7a; }
    :host-context(.oscuro) { --serie-1: #3987e5; --serie-2: #d95926; --serie-3: #199e70; }
  `,
})
export class DesempenoComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly supabase = inject(SupabaseService);
  private readonly op = inject(OperacionService);
  private readonly notificaciones = inject(NotificacionesService);

  protected readonly tipos = TIPOS;
  protected readonly turnos = TURNOS;
  protected readonly estadosPc = ESTADOS_PC;
  protected readonly mesActual = hoyIso().slice(0, 7);

  protected readonly mes = signal(this.mesActual);
  /** Por mes, o entre dos fechas cualquiera */
  protected readonly modo = signal<'mes' | 'rango'>('mes');
  protected readonly desde = signal(sumarDias(hoyIso(), -6));
  protected readonly hasta = signal(hoyIso());
  protected readonly atajos = [
    { texto: 'Últimos 7 días', dias: 7 },
    { texto: '30 días', dias: 30 },
    { texto: '90 días', dias: 90 },
  ];
  protected readonly errorRango = computed(() => {
    if (!this.desde() || !this.hasta()) return 'Elija las dos fechas.';
    if (this.hasta() < this.desde()) return 'La fecha «hasta» debe ser posterior a «desde».';
    const dias = (Date.parse(this.hasta()) - Date.parse(this.desde())) / 86_400_000 + 1;
    return dias > MAXIMO_DIAS ? 'El rango puede ser de hasta un año.' : '';
  });
  /** Periodo que se consultó (el que muestran los datos) */
  protected readonly periodo = signal(rangoMes(this.mesActual));
  protected readonly textoPeriodo = computed(() => {
    const { desde, hasta } = this.periodo();
    return this.modo() === 'mes'
      ? `Tickets, auxiliares, PCs y uso de laboratorios de ${new Date(desde + 'T00:00:00').toLocaleDateString('es-BO', { month: 'long', year: 'numeric' })}.`
      : `Del ${fechaCorta(desde)} al ${fechaCorta(hasta)}.`;
  });

  /** Sección abierta, desde la URL (?seccion=pcs) */
  readonly seccionUrl = input<string>(undefined, { alias: 'seccion' });
  protected readonly secciones = SECCIONES;
  protected readonly seccion = computed<Seccion>(() => SECCIONES.find((s) => s.clave === this.seccionUrl())?.clave ?? 'resumen');
  protected readonly datos = signal<Dashboard | null>(null);
  protected readonly cargando = signal(false);
  protected readonly tip = signal<Tooltip | null>(null);

  /** Uso de laboratorios y análisis detallado (admin y encargado) */
  protected readonly uso = signal<UsoLabs | null>(null);
  protected readonly detalle = signal<Detalle | null>(null);
  protected readonly fallas = signal<Fallas | null>(null);
  protected readonly categoriasFalla = CATEGORIAS_FALLA;
  /** "Otras" que se agregaron a la lista en esta sesión */
  protected readonly agregadas = signal<Set<string>>(new Set());
  protected readonly topeFalla = computed(() => Math.max(1, ...(this.fallas()?.fallas ?? []).map((f) => f.veces)));
  protected readonly topePieza = computed(() => Math.max(1, ...(this.fallas()?.piezas ?? []).map((p) => p.veces)));
  protected readonly soloPeticiones = signal(false);
  /** Clases, cedidas y eventos: azul, aguamarina (además punteada) y naranja */
  protected readonly colorClase = SERIE_1;
  protected readonly colorCesion = SERIE_3;
  protected readonly colorEvento = SERIE_2;
  protected readonly colorSerie1 = SERIE_1;
  protected readonly diasCortos = DIAS_CORTOS.slice(1);
  protected readonly diasLargos = DIAS_SEMANA.slice(1);

  /** Eje X de los gráficos del mes: número de día y fecha larga */
  protected readonly diasMes = computed(() => (this.datos()?.por_dia ?? []).map((p) => this.diaNum(p.dia)));
  protected readonly titulosMes = computed(() => (this.datos()?.por_dia ?? []).map((p) => this.fechaLarga(p.dia)));
  protected readonly seriesTicketsDia = computed<SerieGrafico[]>(() => {
    const dias = this.datos()?.por_dia ?? [];
    return [
      { nombre: 'Tickets', color: SERIE_1, valores: dias.map((p) => p.tickets) },
      { nombre: 'Resueltos', color: SERIE_2, valores: dias.map((p) => p.resueltos), punteada: true },
    ];
  });
  protected readonly seriesTicketsTurno = computed<SerieGrafico[]>(() => {
    const t = this.detalle()?.tickets_por_turno ?? [];
    return [
      { nombre: 'Resueltos', color: SERIE_1, valores: t.map((x) => x.resueltos) },
      { nombre: 'Sin resolver', color: SERIE_2, valores: t.map((x) => x.tickets - x.resueltos) },
    ];
  });
  protected readonly seriesTicketsSemana = computed<SerieGrafico[]>(() => {
    const t = this.detalle()?.tickets_por_dia_semana ?? [];
    return [
      { nombre: 'Resueltos', color: SERIE_1, valores: t.map((x) => x.resueltos) },
      { nombre: 'Sin resolver', color: SERIE_2, valores: t.map((x) => x.tickets - x.resueltos) },
    ];
  });
  protected readonly seriesCierresDia = computed<SerieGrafico[]>(() => {
    const c = this.detalle()?.cierres.por_dia ?? [];
    return [
      { nombre: 'A tiempo', color: COLOR_A_TIEMPO, valores: c.map((x) => x.a_tiempo) },
      { nombre: 'Con retraso', color: COLOR_RETRASO, valores: c.map((x) => x.con_retraso) },
      ...(c.some((x) => x.sin_horario) ? [{ nombre: 'Sin horario', color: COLOR_SIN_HORARIO, valores: c.map((x) => x.sin_horario) }] : []),
    ];
  });
  protected readonly pctATiempo = computed(() => {
    const c = this.detalle()?.cierres;
    const con = c ? c.a_tiempo + c.con_retraso : 0;
    return con ? Math.round((c!.a_tiempo / con) * 100) : 0;
  });
  protected readonly topeResolucion = computed(() => Math.max(1, ...(this.detalle()?.resolucion_por_tipo ?? []).map((r) => r.horas)));
  protected readonly topeCierresTurno = computed(() => Math.max(1, ...(this.detalle()?.cierres.por_turno ?? []).map((t) => t.cierres)));
  protected readonly topeObjetos = computed(() => Math.max(1, ...(this.detalle()?.objetos.por_lab ?? []).map((l) => l.objetos)));
  protected readonly topeCarrera = computed(() => Math.max(1, ...(this.detalle()?.carreras ?? []).map((c) => c.horas)));
  protected readonly topeDocente = computed(() => Math.max(1, ...(this.detalle()?.docentes ?? []).map((d) => d.horas)));
  protected readonly topeMateria = computed(() => Math.max(1, ...(this.uso()?.materias ?? []).map((m) => m.horas)));
  protected readonly topeEvento = computed(() => Math.max(1, ...(this.uso()?.eventos ?? []).map((e) => e.horas)));
  protected readonly topeHorasLab = computed(() => Math.max(1, ...(this.uso()?.por_lab ?? []).map((l) => this.totalLab(l))));
  protected readonly labMasUsado = computed(() => {
    const labs = (this.uso()?.por_lab ?? []).filter((l) => this.totalLab(l) > 0);
    return labs.length ? labs.reduce((a, b) => (this.totalLab(b) > this.totalLab(a) ? b : a)) : null;
  });
  protected readonly pedidosVisibles = computed(() =>
    (this.uso()?.pedidos ?? []).filter((p) => !this.soloPeticiones() || p.tipo === 'docente').slice(0, 10));

  protected readonly variacion = computed(() => {
    const k = this.datos()?.kpis;
    return k && k.tickets_anterior ? ((k.tickets - k.tickets_anterior) / k.tickets_anterior) * 100 : null;
  });
  protected readonly pctResueltos = computed(() => {
    const k = this.datos()?.kpis;
    return k?.tickets ? Math.round((k.resueltos / k.tickets) * 100) : 0;
  });
  protected readonly topeAux = computed(() => Math.max(1, ...(this.datos()?.auxiliares ?? []).map((a) => a.participaciones)));
  /** Totales por categoría (docente, técnico, personal, cambios de estado) */
  protected readonly porCategoria = computed(() => {
    const textos: Record<CategoriaTicket, string> = {
      docente: 'Atención a docente', tecnico: 'Técnico', personal: 'Atención personal', sistema: 'Cambios de estado',
    };
    const totales = new Map<CategoriaTicket, number>();
    for (const t of this.datos()?.por_tipo ?? []) {
      const c = TIPOS_TICKET[t.tipo]?.categoria ?? 'sistema';
      totales.set(c, (totales.get(c) ?? 0) + t.tickets);
    }
    return [...totales].map(([c, tickets]) => ({ texto: textos[c], tickets, clase: COLOR_CATEGORIA[c] }));
  });
  protected readonly topeTipo = computed(() => Math.max(1, ...(this.datos()?.por_tipo ?? []).map((t) => t.tickets)));
  protected readonly topeLab = computed(() => Math.max(1, ...(this.datos()?.por_lab ?? []).map((l) => l.pcs.total)));
  protected readonly diasConTrabajo = computed(() => (this.datos()?.por_dia ?? []).filter((p) => p.tickets).length);

  /** Indicadores de las otras áreas para el resumen (cada uno lleva a su sección) */
  protected readonly resumenExtra = computed(() => {
    const x = this.detalle();
    const u = this.uso();
    const f = this.fallas();
    const lista: { titulo: string; valor: string | number; nota: string; seccion: Seccion; alerta?: boolean }[] = [];
    if (x) {
      lista.push({ titulo: 'Cierres a tiempo', valor: `${this.pctATiempo()}%`, nota: `${x.cierres.total} cierres de turno`, seccion: 'auxiliares' });
      lista.push({ titulo: 'Cierres con retraso', valor: x.cierres.con_retraso, nota: x.cierres.retraso_promedio ? `prom. ${this.retraso(x.cierres.retraso_promedio)}` : 'sin retrasos', seccion: 'auxiliares', alerta: x.cierres.con_retraso > 0 });
    }
    if (u) {
      lista.push({ titulo: 'Horas de clase', valor: Math.round(u.totales.horas_clase), nota: `${u.totales.materias} materias`, seccion: 'uso' });
      lista.push({ titulo: 'Lab. más usado', valor: this.labMasUsado()?.codigo ?? '—', nota: this.labMasUsado() ? `${Math.round(this.totalLab(this.labMasUsado()!))} h` : 'sin uso', seccion: 'uso' });
    }
    if (f) lista.push({ titulo: 'PCs reincidentes', valor: f.reincidentes.length, nota: `${f.total} reparaciones`, seccion: 'pcs', alerta: f.reincidentes.length > 0 });
    if (x) lista.push({ titulo: 'PCs dadas de baja', valor: x.bajas.length, nota: `${x.objetos.en_custodia} objetos en custodia`, seccion: 'pcs', alerta: x.bajas.length > 0 });
    return lista;
  });

  ngOnInit(): void {
    void this.cargar();
  }

  protected cambiarMes(mes: string): void {
    if (!mes) return;
    this.mes.set(mes);
    void this.cargar();
  }

  protected usarMes(): void {
    this.modo.set('mes');
    void this.cargar();
  }

  protected usarRango(): void {
    // Arranca con el periodo que se está viendo
    this.desde.set(this.periodo().desde);
    this.hasta.set(this.periodo().hasta > hoyIso() ? hoyIso() : this.periodo().hasta);
    this.modo.set('rango');
  }

  /** Últimos N días hasta hoy */
  protected aplicarAtajo(dias: number): void {
    this.hasta.set(hoyIso());
    this.desde.set(sumarDias(hoyIso(), -(dias - 1)));
    void this.cargar();
  }

  /** Abre una sección y la deja en la URL (el botón atrás vuelve a la anterior) */
  protected irA(seccion: Seccion): void {
    this.tip.set(null);
    void this.router.navigate([], { queryParams: { seccion: seccion === 'resumen' ? null : seccion } });
  }

  protected moverMes(delta: number): void {
    const [a, m] = this.mes().split('-').map(Number);
    const f = new Date(a, m - 1 + delta, 1);
    this.cambiarMes(`${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`);
  }

  protected async cargar(): Promise<void> {
    if (this.modo() === 'rango' && this.errorRango()) return;
    const { desde, hasta } = this.modo() === 'mes' ? rangoMes(this.mes()) : { desde: this.desde(), hasta: this.hasta() };
    this.periodo.set({ desde, hasta });
    this.cargando.set(true);
    void this.cargarUso(desde, hasta);
    void this.cargarDetalle(desde, hasta);
    void this.cargarFallas(desde, hasta);
    try {
      this.datos.set(await this.supabase.rpc<Dashboard>('fn_dashboard_operacion', { p_desde: desde, p_hasta: hasta }));
    } catch (e) {
      this.datos.set(null);
      this.notificaciones.error(e, 'No se cargó el dashboard');
    } finally {
      this.cargando.set(false);
    }
  }

  private async cargarUso(desde: string, hasta: string): Promise<void> {
    try {
      this.uso.set(await this.supabase.rpc<UsoLabs>('fn_dashboard_uso', { p_desde: desde, p_hasta: hasta }));
    } catch (e) {
      this.uso.set(null);
      this.notificaciones.error(e, 'No se cargó el uso de laboratorios');
    }
  }

  private async cargarDetalle(desde: string, hasta: string): Promise<void> {
    try {
      this.detalle.set(await this.supabase.rpc<Detalle>('fn_dashboard_detalle', { p_desde: desde, p_hasta: hasta }));
    } catch (e) {
      this.detalle.set(null);
      this.notificaciones.error(e, 'No se cargó el análisis detallado');
    }
  }

  private async cargarFallas(desde: string, hasta: string): Promise<void> {
    try {
      this.fallas.set(await this.supabase.rpc<Fallas>('fn_dashboard_fallas', { p_desde: desde, p_hasta: hasta }));
    } catch (e) {
      this.fallas.set(null);
      this.notificaciones.error(e, 'No se cargaron las fallas');
    }
  }

  protected textoCategoriaFalla(c: CategoriaFalla): string {
    return CATEGORIAS_FALLA.find((x) => x.valor === c)?.texto ?? c;
  }

  /** Convierte una "Otra" muy repetida en botón de la ficha */
  protected async agregarOtra(texto: string, categoria: CategoriaFalla): Promise<void> {
    try {
      if (!this.op.fallas().length) await this.op.cargarFallas();
      await this.op.agregarFalla(texto.slice(0, 60), categoria);
      this.agregadas.update((s) => new Set(s).add(texto.toLowerCase()));
      this.notificaciones.exito(`"${texto}" ya aparece como botón en la ficha de reparación.`);
    } catch (e) {
      this.notificaciones.error(e, 'No se agregó a la lista');
    }
  }

  /** Clases, cedidas y eventos de una lista de horas de uso */
  protected seriesUso(lista: HorasUso[]): SerieGrafico[] {
    return [
      { nombre: 'Clases', color: SERIE_1, valores: lista.map((x) => x.clase) },
      { nombre: 'Cedidas', color: SERIE_3, valores: lista.map((x) => x.cesion), punteada: true },
      { nombre: 'Eventos', color: SERIE_2, valores: lista.map((x) => x.evento) },
    ];
  }

  protected turnosDe(lista: { turno: TurnoCodigo }[]): string[] {
    return lista.map((t) => TURNOS[t.turno]);
  }

  protected horasCortas(lista: { hora: number }[]): string[] {
    return lista.map((h) => String(h.hora));
  }

  protected horasLargas(lista: { hora: number }[]): string[] {
    const dos = (n: number) => String(n).padStart(2, '0');
    return lista.map((h) => `${dos(h.hora)}:00 – ${dos(h.hora + 1)}:00`);
  }

  /** 85 -> '1 h 25 min' */
  protected retraso(minutos: number): string {
    return textoRetraso(minutos);
  }

  protected totalLab(l: UsoLabs['por_lab'][number]): number {
    return l.clase + l.cesion + l.evento;
  }

  protected verTip(e: MouseEvent, titulo: string, filas: Tooltip['filas']): void {
    // Evita salirse de la pantalla por la derecha
    const x = Math.min(e.clientX, window.innerWidth - 220);
    this.tip.set({ x, y: e.clientY, titulo, filas });
  }

  protected verTipLab(e: MouseEvent, l: Dashboard['por_lab'][number]): void {
    this.verTip(e, l.codigo, [
      ...ESTADOS_PC.map((s) => ({ texto: s.texto, valor: l.pcs[s.clave] })),
      { texto: 'Tickets del periodo', valor: l.tickets },
      { texto: 'Sin resolver', valor: l.pendientes },
    ]);
  }

  protected diaNum(fecha: string): string {
    return String(Number(fecha.slice(8, 10)));
  }

  protected esFinde(fecha: string): boolean {
    return new Date(fecha + 'T00:00:00').getDay() === 0;
  }

  protected fechaLarga(fecha: string): string {
    return new Date(fecha + 'T00:00:00').toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  protected claseEstado(e: EstadoPc): string {
    return ESTADOS_PC.find((s) => s.clave === e)?.clase ?? '';
  }

  protected textoEstado(e: EstadoPc): string {
    return ESTADOS_PC.find((s) => s.clave === e)?.texto ?? e;
  }

  protected exportar(): void {
    const d = this.datos();
    if (!d) return;
    const filas = d.auxiliares.map((a) => [
      a.nombre, a.turno ? TURNOS[a.turno] : '', a.participaciones, a.registrados, a.trabajos,
      a.colaboraciones, a.resueltos, a.pcs_atendidas, a.reportes, a.tareas_hechas,
    ]);
    const { desde, hasta } = this.periodo();
    descargarCsv(this.modo() === 'mes' ? `desempeno-${this.mes()}` : `desempeno-${desde}-a-${hasta}`,
      ['Auxiliar', 'Turno', 'Participó', 'Registró', 'Trabajos', 'Colaboró', 'Resolvió', 'PCs atendidas', 'Reportes de turno', 'Tareas hechas'], filas);
  }
}
