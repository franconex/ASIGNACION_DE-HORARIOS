import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { GraficoBarrasComponent } from '../../compartido/grafico-barras.component';
import { GraficoLineasComponent } from '../../compartido/grafico-lineas.component';
import { SerieGrafico } from '../../compartido/graficos';
import { IconoComponent } from '../../compartido/icono.component';
import { AuthService } from '../../core/auth.service';
import { exportarExcel } from '../../core/exportar-excel';
import { DIAS_CORTOS, DIAS_SEMANA, fechaCorta, hoyIso, sumarDias } from '../../core/fechas';
import { OperacionService, textoRetraso } from '../../core/operacion.service';
import { CATEGORIAS_FALLA, CategoriaTicket, COLOR_CATEGORIA, TIPOS_TICKET } from '../../core/tickets';
import { CategoriaFalla, EstadoPc, NOMBRE_ROL } from '../../core/modelos';
import { LICENCIAS } from '../../core/software.service';
import { NotificacionesService } from '../../core/notificaciones.service';
import { SupabaseService } from '../../core/supabase.service';
import {
  Dashboard, Detalle, DashSoftware, ESTADOS_PC, Fallas, HorasUso, Indicador, MovimientosPcs,Seccion, SECCIONES, TIPOS, TURNOS, UsoLabs,
  textoCategoriaFalla, textoEstadoPc,
} from './desempeno-datos';
import { hojasDesempeno } from './desempeno-excel';

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

/** Rango máximo de consulta (días) */
const MAXIMO_DIAS = 366;

/** Primer y último día de un mes "AAAA-MM" */
function rangoMes(mes: string): { desde: string; hasta: string } {
  const [a, m] = mes.split('-').map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}` };
}

/**
 * Dashboard de desempeño (admin y encargado). Cada sección responde una
 * pregunta y sigue el mismo orden: números clave → gráficos → tablas de
 * detalle (plegadas). Todo se exporta a Excel: el libro completo o solo la
 * sección que se está viendo.
 */
@Component({
  selector: 'app-desempeno',
  imports: [FormsModule, IconoComponent, DatePipe, DecimalPipe, NgTemplateOutlet, GraficoLineasComponent, GraficoBarrasComponent],
  template: `
    <header class="mb-4">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold">Desempeño</h1>
          <p class="mt-0.5 text-sm text-slate-600">{{ textoPeriodo() }}</p>
        </div>
        <button class="btn-primario btn-sm" (click)="exportar()" [disabled]="!datos() || exportando()"
                title="Un Excel con una hoja por sección">
          <app-icono nombre="descargar" [tamano]="14" /> {{ exportando() === 'todo' ? 'Generando…' : 'Exportar Excel' }}
        </button>
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
      <!-- Encabezado de la sección: qué responde y su exportación -->
      <div class="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 class="text-lg font-semibold">{{ seccionActual().texto }}</h2>
          <p class="text-sm text-slate-500">{{ seccionActual().pregunta }}</p>
        </div>
        @if (seccion() !== 'resumen') {
          <button class="btn-secundario btn-sm" (click)="exportar(seccion())" [disabled]="!!exportando()">
            <app-icono nombre="descargar" [tamano]="14" /> {{ exportando() === seccion() ? 'Generando…' : 'Exportar esta sección' }}
          </button>
        }
      </div>

      <!-- 1) Números clave (iguales a los de la hoja de Excel) -->
      <div class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        @for (k of indicadores()[seccion()]; track k.titulo) {
          @if (k.ir) {
            <button class="tarjeta p-3 text-left transition hover:border-marca-300 hover:shadow-sm" (click)="irA(k.ir)">
              <ng-container *ngTemplateOutlet="tarjetaIndicador; context: { $implicit: k }" />
            </button>
          } @else {
            <div class="tarjeta p-3"><ng-container *ngTemplateOutlet="tarjetaIndicador; context: { $implicit: k }" /></div>
          }
        }
      </div>

      @switch (seccion()) {
        <!-- ================= RESUMEN ================= -->
        @case ('resumen') {
          <div class="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
            <section class="tarjeta p-4">
              <h3 class="mb-3 flex items-center gap-2 font-semibold"><app-icono nombre="alerta" [tamano]="17" class="text-amber-600" /> Necesita atención</h3>
              <ul class="divide-y divide-slate-100">
                @for (a of alertas(); track a.texto) {
                  <li>
                    <button class="flex w-full items-center gap-3 py-2.5 text-left hover:bg-slate-50" (click)="irA(a.ir)">
                      <span class="h-2.5 w-2.5 shrink-0 rounded-full" [class]="a.tono === 'peligro' ? 'bg-rose-500' : 'bg-amber-400'"></span>
                      <span class="min-w-0 flex-1">
                        <span class="block text-sm font-medium">{{ a.texto }}</span>
                        <span class="block truncate text-xs text-slate-500">{{ a.detalle }}</span>
                      </span>
                      <app-icono nombre="siguiente" [tamano]="14" class="text-slate-400" />
                    </button>
                  </li>
                } @empty {
                  <li class="flex items-center gap-2 py-4 text-sm text-emerald-700"><app-icono nombre="ok" [tamano]="18" /> Todo en orden en este periodo.</li>
                }
              </ul>
            </section>
            <section class="tarjeta p-4">
              <h3 class="mb-3 flex items-center gap-2 font-semibold"><app-icono nombre="trofeo" [tamano]="17" class="text-marca-600" /> Lo más destacado</h3>
              <dl class="divide-y divide-slate-100">
                @for (x of destacados(); track x.titulo) {
                  <button class="grid w-full grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 py-2.5 text-left hover:bg-slate-50" (click)="irA(x.ir)">
                    <dt class="text-xs text-slate-500">{{ x.titulo }}</dt>
                    <dd class="min-w-0">
                      <span class="block truncate text-sm font-semibold" [title]="x.valor">{{ x.valor }}</span>
                      <span class="block truncate text-xs text-slate-500">{{ x.nota }}</span>
                    </dd>
                    <app-icono nombre="siguiente" [tamano]="14" class="text-slate-400" />
                  </button>
                } @empty {
                  <p class="py-4 text-sm text-slate-500">Aún no hay datos en este periodo.</p>
                }
              </dl>
            </section>
          </div>
        }

        <!-- ================= TICKETS ================= -->
        @case ('tickets') {
          <section class="tarjeta mb-5 p-4">
            <h3 class="font-semibold">Tickets por día</h3>
            <p class="mb-3 text-xs text-slate-500">{{ diasConTrabajo() }} días con actividad · la línea punteada son los que ya se resolvieron</p>
            <app-grafico-lineas [etiquetas]="diasMes()" [titulos]="titulosMes()" [series]="seriesTicketsDia()" [alto]="220" />
          </section>

          <div class="mb-5 grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
            <section class="tarjeta p-4">
              <h3 class="font-semibold">Qué se hizo</h3>
              <p class="mb-2 text-xs text-slate-500">Tickets por tipo de trabajo</p>
              <div class="mb-3 flex flex-wrap gap-1.5">
                @for (c of porCategoria(); track c.texto) {
                  <span class="chip" [class]="c.clase">{{ c.texto }} · <b class="tabular-nums">{{ c.tickets }}</b></span>
                }
              </div>
              <div class="space-y-2.5">
                @for (t of d.por_tipo; track t.tipo) {
                  <div class="cursor-default" (mousemove)="verTip($event, tipos[t.tipo], [{ color: colorSerie1, texto: 'Tickets', valor: t.tickets }, { texto: 'Trabajos', valor: t.trabajos }])" (mouseleave)="tip.set(null)">
                    <div class="mb-0.5 flex justify-between text-sm"><span>{{ tipos[t.tipo] }}</span><span class="font-semibold tabular-nums">{{ t.tickets }}</span></div>
                    <div class="h-2.5 rounded-r-[4px] bg-[var(--serie-1)]" [style.width.%]="(t.tickets / topeTipo()) * 100"></div>
                  </div>
                } @empty {
                  <p class="py-6 text-center text-sm text-slate-500">Sin tickets en este periodo.</p>
                }
              </div>
            </section>
            <section class="tarjeta p-4">
              <h3 class="font-semibold">Tiempo para resolver</h3>
              <p class="mb-3 text-xs text-slate-500">Promedio en horas, por tipo de ticket</p>
              @if (detalle(); as x) {
                <div class="space-y-2.5">
                  @for (r of x.resolucion_por_tipo; track r.tipo) {
                    <div class="cursor-default" (mousemove)="verTip($event, tipos[r.tipo], [{ color: colorSerie1, texto: 'Promedio', valor: r.horas + ' h' }, { texto: 'Tickets', valor: r.tickets }])" (mouseleave)="tip.set(null)">
                      <div class="mb-0.5 flex justify-between text-sm"><span>{{ tipos[r.tipo] }}</span><span class="font-semibold tabular-nums">{{ r.horas | number: '1.0-1' }} h</span></div>
                      <div class="h-2.5 rounded-r-[4px] bg-[var(--serie-1)]" [style.width.%]="(r.horas / topeResolucion()) * 100"></div>
                    </div>
                  } @empty {
                    <p class="py-4 text-sm text-slate-500">Aún no hay tickets resueltos con tiempo medible.</p>
                  }
                </div>
              }
            </section>
          </div>

          @if (detalle(); as x) {
            <div class="mb-5 grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
              <section class="tarjeta p-4">
                <h3 class="font-semibold">Por turno</h3>
                <p class="mb-3 text-xs text-slate-500">Según la hora en que se registraron</p>
                <app-grafico-barras [etiquetas]="turnosDe(x.tickets_por_turno)" [series]="seriesTicketsTurno()" [alto]="190" />
              </section>
              <section class="tarjeta p-4">
                <h3 class="font-semibold">Por día de la semana</h3>
                <p class="mb-3 text-xs text-slate-500">Qué días hay más trabajo</p>
                <app-grafico-barras [etiquetas]="diasCortos" [titulos]="diasLargos" [series]="seriesTicketsSemana()" [alto]="190" />
              </section>
            </div>
          }

          @if (uso(); as u) {
            <details class="tarjeta plegable mb-3">
              <summary><span>Trabajo en cada laboratorio <span class="contador">{{ u.actividades_lab.length }}</span></span><app-icono nombre="abajo" [tamano]="16" class="flecha" /></summary>
              <div class="space-y-3 border-t border-slate-200 p-4">
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
                  <p class="py-2 text-sm text-slate-500">Sin tickets en laboratorios en este periodo.</p>
                }
              </div>
            </details>

            <details class="tarjeta plegable mb-3">
              <summary><span>Pedidos más frecuentes <span class="contador">{{ pedidosVisibles().length }}</span></span><app-icono nombre="abajo" [tamano]="16" class="flecha" /></summary>
              <div class="border-t border-slate-200">
                <div class="flex gap-1 px-4 pt-3">
                  <button class="rounded-md border px-2 py-1 text-xs" [class]="!soloPeticiones() ? 'border-marca-600 bg-marca-600 text-white' : 'border-slate-200 hover:border-slate-300'"
                          (click)="soloPeticiones.set(false)">Todos</button>
                  <button class="rounded-md border px-2 py-1 text-xs" [class]="soloPeticiones() ? 'border-marca-600 bg-marca-600 text-white' : 'border-slate-200 hover:border-slate-300'"
                          (click)="soloPeticiones.set(true)">Solo de docentes</button>
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
              </div>
            </details>
          }
        }

        <!-- ================= AUXILIARES Y TURNOS ================= -->
        @case ('auxiliares') {
          <section class="tarjeta mb-5 p-4">
            <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 class="font-semibold">Ranking de auxiliares</h3>
                <p class="text-xs text-slate-500">Tickets en los que participó cada uno. Abrir o cerrar un laboratorio cuenta como 1</p>
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
                       { color: 'var(--serie-1)', texto: 'Registró', valor: a.registrados },
                       { color: 'var(--serie-2)', texto: 'Colaboró', valor: a.colaboraciones },
                       { texto: 'Resolvió', valor: a.resueltos },
                       { texto: 'PCs atendidas', valor: a.pcs_atendidas }])"
                     (mouseleave)="tip.set(null)">
                  <span class="text-center text-sm font-bold" [class]="i === 0 && a.tickets ? 'text-amber-600' : 'text-slate-400'">{{ i + 1 }}</span>
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-medium">{{ a.nombre }}</span>
                    <span class="block text-[10px] text-slate-400">{{ a.turno ? turnos[a.turno] : 'Sin turno' }}{{ a.rol === 'encargado' ? ' · ' + nombreRol.encargado : '' }}</span>
                  </span>
                  <span class="flex items-center gap-2">
                    <span class="flex h-5 min-w-0 gap-[2px]" [style.width.%]="(a.tickets / topeAux()) * 85">
                      @if (a.registrados) { <span class="h-full rounded-l-[4px] bg-[var(--serie-1)]" [class.rounded-r-[4px]]="!a.colaboraciones" [style.flex-grow]="a.registrados"></span> }
                      @if (a.colaboraciones) { <span class="h-full rounded-r-[4px] bg-[var(--serie-2)]" [class.rounded-l-[4px]]="!a.registrados" [style.flex-grow]="a.colaboraciones"></span> }
                    </span>
                    <span class="text-sm font-semibold tabular-nums">{{ a.tickets }}</span>
                  </span>
                </div>
              } @empty {
                <p class="py-6 text-center text-sm text-slate-500">No hay auxiliares activos.</p>
              }
            </div>
          </section>

          @if (detalle(); as x) {
            <div class="mb-5 grid gap-5 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
              <section class="tarjeta p-4">
                <h3 class="font-semibold">Cierres de turno por día</h3>
                <p class="mb-3 text-xs text-slate-500">A tiempo y con retraso</p>
                <app-grafico-barras [etiquetas]="diasMes()" [titulos]="titulosMes()" [series]="seriesCierresDia()" [alto]="190" />
              </section>
              <section class="tarjeta p-4">
                <h3 class="font-semibold">Cierres por turno</h3>
                <div class="mb-3 mt-1 flex flex-wrap gap-3 text-xs text-slate-600">
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
          }

          <details class="tarjeta plegable mb-3">
            <summary><span>Detalle por auxiliar <span class="contador">{{ d.auxiliares.length }}</span></span><app-icono nombre="abajo" [tamano]="16" class="flecha" /></summary>
            <div class="overflow-x-auto border-t border-slate-200">
              <table class="tabla">
                <thead>
                  <tr>
                    <th>Auxiliar</th><th>Turno</th><th class="text-right">Tickets</th><th class="text-right">Registró</th><th class="text-right">Colaboró</th><th class="text-right">Resolvió</th>
                    <th class="text-right">PCs</th><th class="text-right">Reportes</th><th class="text-right">Tareas hechas</th>
                  </tr>
                </thead>
                <tbody>
                  @for (a of d.auxiliares; track a.id) {
                    <tr>
                      <td class="font-medium">{{ a.nombre }}</td>
                      <td class="text-sm text-slate-500">{{ a.turno ? turnos[a.turno] : '—' }}@if (a.rol === 'encargado') { <span class="chip ml-1 bg-marca-50 text-marca-700">{{ nombreRol.encargado }}</span> }</td>
                      <td class="text-right font-semibold tabular-nums">{{ a.tickets }}</td>
                      <td class="text-right tabular-nums">{{ a.registrados }}</td>
                      <td class="text-right tabular-nums">{{ a.colaboraciones }}</td>
                      <td class="text-right tabular-nums">{{ a.resueltos }}</td>
                      <td class="text-right tabular-nums">{{ a.pcs_atendidas }}</td>
                      <td class="text-right tabular-nums">{{ a.reportes }}</td>
                      <td class="text-right tabular-nums">{{ a.tareas_hechas }}</td>
                    </tr>
                  }
                </tbody>
              </table>
              <p class="px-4 py-2 text-xs text-slate-400">Un trabajo en 20 PCs cuenta como 20 tickets y 1 trabajo. "Colaboró" son tickets que registró otro.</p>
            </div>
          </details>

          @if (detalle(); as x) {
            <details class="tarjeta plegable mb-3">
              <summary><span>Cierres de turno por auxiliar <span class="contador">{{ x.cierres.por_auxiliar.length }}</span></span><app-icono nombre="abajo" [tamano]="16" class="flecha" /></summary>
              <div class="overflow-x-auto border-t border-slate-200">
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
            </details>

            <details class="tarjeta plegable mb-3">
              <summary>
                <span>Objetos perdidos <span class="contador">{{ x.objetos.registrados }}</span>
                  <span class="ml-1 text-xs font-normal text-slate-500">{{ x.objetos.entregados }} entregados · {{ x.objetos.en_custodia }} en custodia</span></span>
                <app-icono nombre="abajo" [tamano]="16" class="flecha" />
              </summary>
              <div class="space-y-2 border-t border-slate-200 p-4">
                @for (l of x.objetos.por_lab; track l.codigo) {
                  <div class="grid grid-cols-[4.5rem_1fr_2rem] items-center gap-3">
                    <span class="flex items-center gap-1.5 text-sm font-semibold"><span class="h-3 w-1 rounded-full" [style.background]="l.color"></span>{{ l.codigo }}</span>
                    <span class="h-2.5 rounded-r-[4px] bg-[var(--serie-1)]" [style.width.%]="(l.objetos / topeObjetos()) * 100"></span>
                    <span class="text-right text-sm font-semibold tabular-nums">{{ l.objetos }}</span>
                  </div>
                } @empty {
                  <p class="text-sm text-slate-500">No se registraron objetos en este periodo.</p>
                }
              </div>
            </details>
          }
        }

        <!-- ================= PCs Y MANTENIMIENTO ================= -->
        @case ('pcs') {
          <section class="tarjeta mb-5 p-4">
            <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 class="font-semibold">Estado de las PCs por laboratorio</h3>
                <p class="text-xs text-slate-500">{{ d.pcs.total }} PCs en total ({{ d.pcs.docentes }} de docente) · tickets del periodo a la derecha</p>
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
                      @for (e of estadosPc; track e.clave) {
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

          @if (fallas(); as fx) {
            <div class="mb-5 grid gap-5 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
              <section class="tarjeta p-4">
                <h3 class="font-semibold">Fallas más repetidas</h3>
                <p class="mb-2 text-xs text-slate-500">
                  {{ fx.total }} reparaciones ({{ fx.con_ficha }} con ficha): quedaron
                  <b class="text-emerald-700">{{ fx.resultados.activas }} activas</b>,
                  <b class="text-amber-700">{{ fx.resultados.mantenimiento }} en mantenimiento</b> y
                  <b class="text-rose-700">{{ fx.resultados.bajas }} de baja</b>
                </p>
                <div class="mb-3 flex flex-wrap gap-1.5">
                  @for (c of fx.por_categoria; track c.categoria) {
                    <span class="chip bg-slate-100 text-slate-700">{{ textoCategoriaFalla(c.categoria) }} · <b class="tabular-nums">{{ c.veces }}</b></span>
                  }
                </div>
                <div class="space-y-2.5">
                  @for (fa of fx.fallas.slice(0, 10); track fa.falla; let i = $index) {
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
                    <p class="py-6 text-center text-sm text-slate-500">No se registraron piezas cambiadas.</p>
                  }
                </div>
              </section>
            </div>

            <details class="tarjeta plegable mb-3" [open]="fx.reincidentes.length > 0">
              <summary><span>PCs reparadas 2 o más veces <span class="contador" [class.alerta]="fx.reincidentes.length > 0">{{ fx.reincidentes.length }}</span></span><app-icono nombre="abajo" [tamano]="16" class="flecha" /></summary>
              <div class="overflow-x-auto border-t border-slate-200">
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
            </details>
          }

          <details class="tarjeta plegable mb-3">
            <summary><span>PCs con más tickets <span class="contador">{{ d.top_pcs.length }}</span></span><app-icono nombre="abajo" [tamano]="16" class="flecha" /></summary>
            <div class="overflow-x-auto border-t border-slate-200">
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
          </details>

          @if (detalle(); as x) {
            <details class="tarjeta plegable mb-3">
              <summary><span>PCs dadas de baja <span class="contador" [class.peligro]="x.bajas.length > 0">{{ x.bajas.length }}</span>
                <span class="ml-1 text-xs font-normal text-slate-500">{{ x.reactivadas }} reactivadas</span></span><app-icono nombre="abajo" [tamano]="16" class="flecha" /></summary>
              <div class="overflow-x-auto border-t border-slate-200">
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
            </details>
          }

          <!-- PCs que salieron de baja (reparadas o devueltas al croquis) y bajas / reactivaciones por persona -->
          @if (movimientos(); as mv) {
            <details class="tarjeta plegable mb-3">
              <summary><span>PCs reactivadas <span class="contador">{{ mv.reactivadas.length }}</span></span><app-icono nombre="abajo" [tamano]="16" class="flecha" /></summary>
              <div class="overflow-x-auto border-t border-slate-200">
                <table class="tabla">
                  <thead><tr><th>PC</th><th>Laboratorio</th><th>Detalle</th><th>Quién</th><th>Cuándo</th></tr></thead>
                  <tbody>
                    @for (r of mv.reactivadas; track $index) {
                      <tr>
                        <td class="font-mono text-sm font-semibold text-emerald-700">{{ r.etiqueta ?? '—' }}</td>
                        <td>{{ r.lab ?? '—' }}</td>
                        <td class="max-w-72 text-sm">{{ r.detalle || '—' }}</td>
                        <td class="text-sm">{{ r.por ?? '—' }}</td>
                        <td class="text-sm whitespace-nowrap text-slate-500">{{ r.en | date: 'dd/MM HH:mm' }}</td>
                      </tr>
                    } @empty {
                      <tr><td colspan="5" class="py-6 text-center text-sm text-slate-500">Ninguna PC salió de baja en este periodo.</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </details>

            <details class="tarjeta plegable mb-3">
              <summary><span>Bajas y reactivaciones por persona <span class="contador">{{ mv.por_persona.length }}</span></span><app-icono nombre="abajo" [tamano]="16" class="flecha" /></summary>
              <div class="overflow-x-auto border-t border-slate-200">
                <table class="tabla">
                  <thead><tr><th>Quién</th><th class="text-right">PCs dadas de baja</th><th class="text-right">PCs reactivadas</th></tr></thead>
                  <tbody>
                    @for (p of mv.por_persona; track p.nombre) {
                      <tr>
                        <td class="font-medium">{{ p.nombre }}</td>
                        <td class="text-right tabular-nums" [class.text-rose-700]="p.bajas > 0">{{ p.bajas }}</td>
                        <td class="text-right tabular-nums" [class.text-emerald-700]="p.reactivadas > 0">{{ p.reactivadas }}</td>
                      </tr>
                    } @empty {
                      <tr><td colspan="3" class="py-6 text-center text-sm text-slate-500">Nadie dio de baja ni reactivó PCs en este periodo.</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </details>
          }

          @if (fallas(); as fx) {
            <details class="tarjeta plegable mb-3">
              <summary><span>"Otras" fallas escritas a mano <span class="contador">{{ fx.otras.length }}</span></span><app-icono nombre="abajo" [tamano]="16" class="flecha" /></summary>
              <div class="overflow-x-auto border-t border-slate-200">
                <p class="px-4 pt-3 text-xs text-slate-500">Si una se repite mucho, agrégala como botón en la ficha de reparación.</p>
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
            </details>
          }
        }

        <!-- ================= SOFTWARE ================= -->
        @case ('software') {
          @if (software(); as sw) {
            <div class="mb-5 grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
              <section class="tarjeta p-4">
                <h3 class="font-semibold">Más pedidos por docentes</h3>
                <p class="mb-3 text-xs text-slate-500">Lo que pidieron instalar (el pedido; la instalación se cuenta aparte)</p>
                <div class="space-y-2">
                  @for (f of masPedidos(); track f.id) {
                    <div class="grid grid-cols-[10rem_1fr] items-center gap-2">
                      <span class="min-w-0">
                        <span class="block truncate text-sm font-medium" [title]="f.nombre">{{ f.nombre }}</span>
                        <span class="block truncate text-[10px] text-slate-400">{{ f.labs.join(', ') }}</span>
                      </span>
                      <span class="flex items-center gap-2">
                        <span class="h-4 rounded-[4px] bg-sky-500" [style.width.%]="(f.pedidos / topePedidos()) * 85"></span>
                        <span class="text-sm font-semibold tabular-nums">{{ f.pedidos }}</span>
                      </span>
                    </div>
                  } @empty {
                    <p class="py-6 text-center text-sm text-slate-500">Ningún docente pidió programas en este periodo.</p>
                  }
                </div>
              </section>
              <section class="tarjeta p-4">
                <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 class="font-semibold">Más instalados</h3>
                    <p class="text-xs text-slate-500">Un trabajo en varias PCs cuenta una vez por laboratorio</p>
                  </div>
                  <div class="flex gap-3 text-xs text-slate-600">
                    <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-[var(--serie-1)]"></span> Instaló</span>
                    <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-[var(--serie-3)]"></span> Actualizó</span>
                  </div>
                </div>
                <div class="space-y-2">
                  @for (f of masInstalados(); track f.id) {
                    <div class="grid grid-cols-[10rem_1fr] items-center gap-2">
                      <span class="min-w-0">
                        <span class="block truncate text-sm font-medium" [title]="f.nombre">{{ f.nombre }}</span>
                        <span class="block truncate text-[10px] text-slate-400">{{ f.labs.join(', ') }}</span>
                      </span>
                      <span class="flex items-center gap-2">
                        <span class="flex h-4 gap-[2px]" [style.width.%]="((f.instalar + f.actualizar) / topeInstalados()) * 85">
                          @if (f.instalar) { <span class="h-full rounded-l-[4px] bg-[var(--serie-1)]" [class.rounded-r-[4px]]="!f.actualizar" [style.flex-grow]="f.instalar"></span> }
                          @if (f.actualizar) { <span class="h-full rounded-r-[4px] bg-[var(--serie-3)]" [class.rounded-l-[4px]]="!f.instalar" [style.flex-grow]="f.actualizar"></span> }
                        </span>
                        <span class="text-sm font-semibold tabular-nums">{{ f.instalar + f.actualizar }}</span>
                      </span>
                    </div>
                  } @empty {
                    <p class="py-6 text-center text-sm text-slate-500">No se instaló ni actualizó software en este periodo.</p>
                  }
                </div>
              </section>
            </div>

            <details class="tarjeta plegable mb-3">
              <summary><span>Todo el software trabajado <span class="contador">{{ sw.por_software.length }}</span></span><app-icono nombre="abajo" [tamano]="16" class="flecha" /></summary>
              <div class="overflow-x-auto border-t border-slate-200">
                <table class="tabla">
                  <thead><tr><th>Software</th><th>Licencia</th><th class="text-right">Pedidos docentes</th><th class="text-right">Instaló</th><th class="text-right">Actualizó</th><th class="text-right">Desinstaló</th><th>Laboratorios</th></tr></thead>
                  <tbody>
                    @for (f of sw.por_software; track f.id) {
                      <tr>
                        <td class="font-medium">{{ f.nombre }}@if (f.tipo === 'iso') { <span class="chip ml-1 bg-violet-100 text-violet-700">ISO</span> }</td>
                        <td><span class="chip whitespace-nowrap" [class]="licencias[f.licencia].clase">{{ licencias[f.licencia].texto }}</span></td>
                        <td class="text-right tabular-nums">{{ f.pedidos || '·' }}</td>
                        <td class="text-right tabular-nums">{{ f.instalar || '·' }}</td>
                        <td class="text-right tabular-nums">{{ f.actualizar || '·' }}</td>
                        <td class="text-right tabular-nums">{{ f.desinstalar || '·' }}</td>
                        <td class="text-xs text-slate-500">{{ f.labs.join(', ') }}</td>
                      </tr>
                    } @empty {
                      <tr><td colspan="7" class="py-6 text-center text-sm text-slate-500">Aún no hay tickets con software del catálogo en este periodo.</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </details>

            <details class="tarjeta plegable mb-3">
              <summary><span>Software por laboratorio <span class="contador">{{ sw.por_lab.length }}</span></span><app-icono nombre="abajo" [tamano]="16" class="flecha" /></summary>
              <div class="overflow-x-auto border-t border-slate-200">
                <table class="tabla">
                  <thead><tr><th>Lab</th><th class="text-right">Instaló</th><th class="text-right">Actualizó</th><th class="text-right">Desinstaló</th><th class="text-right">Pedidos</th></tr></thead>
                  <tbody>
                    @for (l of sw.por_lab; track l.codigo) {
                      <tr>
                        <td><span class="inline-flex items-center gap-1.5 font-medium"><span class="h-2.5 w-2.5 rounded-full" [style.background]="l.color"></span>{{ l.codigo }}</span></td>
                        <td class="text-right tabular-nums">{{ l.instalar || '·' }}</td>
                        <td class="text-right tabular-nums">{{ l.actualizar || '·' }}</td>
                        <td class="text-right tabular-nums">{{ l.desinstalar || '·' }}</td>
                        <td class="text-right tabular-nums">{{ l.pedidos || '·' }}</td>
                      </tr>
                    } @empty {
                      <tr><td colspan="5" class="py-6 text-center text-sm text-slate-500">Sin trabajo con software en este periodo.</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </details>

            <details class="tarjeta plegable mb-3">
              <summary><span>Docentes que más programas pidieron <span class="contador">{{ sw.docentes.length }}</span></span><app-icono nombre="abajo" [tamano]="16" class="flecha" /></summary>
              <div class="overflow-x-auto border-t border-slate-200">
                <table class="tabla">
                  <thead><tr><th>Docente</th><th class="text-right">Pedidos</th></tr></thead>
                  <tbody>
                    @for (dc of sw.docentes; track dc.nombre) {
                      <tr><td class="font-medium">{{ dc.nombre }}</td><td class="text-right tabular-nums">{{ dc.pedidos }}</td></tr>
                    } @empty {
                      <tr><td colspan="2" class="py-6 text-center text-sm text-slate-500">Sin pedidos de docentes en este periodo.</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </details>

            <button class="mt-2 inline-flex items-center gap-1 text-sm font-medium text-marca-700 hover:underline" (click)="verSoftwareLabs()">
              Ver la lista de programas e ISOs que se manejan <app-icono nombre="siguiente" [tamano]="14" />
            </button>
          } @else {
            <p class="tarjeta py-10 text-center text-sm text-slate-500">Cargando…</p>
          }
        }

        <!-- ================= USO DE LABORATORIOS ================= -->
        @case ('uso') {
          @if (uso(); as u) {
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

            @if (detalle(); as x) {
              <section class="tarjeta mb-5 p-4">
                <h3 class="font-semibold">Horas de uso por día</h3>
                <p class="mb-3 text-xs text-slate-500">Horas de laboratorio ocupadas cada día</p>
                <app-grafico-lineas [etiquetas]="diasMes()" [titulos]="titulosMes()" [series]="seriesUso(x.uso_por_dia)" unidad=" h" [alto]="220" />
              </section>
              <div class="mb-5 grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
                <section class="tarjeta p-4">
                  <h3 class="font-semibold">Por día de la semana</h3>
                  <p class="mb-3 text-xs text-slate-500">Horas en todo el periodo</p>
                  <app-grafico-barras [etiquetas]="diasCortos" [titulos]="diasLargos" [series]="seriesUso(x.uso_por_dia_semana)" unidad=" h" [alto]="190" />
                </section>
                <section class="tarjeta p-4">
                  <h3 class="font-semibold">Horas pico</h3>
                  <p class="mb-3 text-xs text-slate-500">Franjas del día más ocupadas</p>
                  <app-grafico-barras [etiquetas]="horasCortas(x.uso_por_hora)" [titulos]="horasLargas(x.uso_por_hora)" [series]="seriesUso(x.uso_por_hora)" unidad=" h" [alto]="190" />
                </section>
              </div>
            }

            <details class="tarjeta plegable mb-3" open>
              <summary><span>Materias que más ocupan los laboratorios <span class="contador">{{ u.materias.length }}</span></span><app-icono nombre="abajo" [tamano]="16" class="flecha" /></summary>
              <div class="space-y-2.5 border-t border-slate-200 p-4">
                <p class="text-xs text-slate-500">En una cesión cuenta la materia de quien viene.</p>
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
                  <p class="text-sm text-slate-500">Sin clases en este periodo.</p>
                }
              </div>
            </details>

            @if (detalle(); as x) {
              <details class="tarjeta plegable mb-3">
                <summary><span>Carreras que más usan los laboratorios <span class="contador">{{ x.carreras.length }}</span></span><app-icono nombre="abajo" [tamano]="16" class="flecha" /></summary>
                <div class="space-y-2.5 border-t border-slate-200 p-4">
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
                    <p class="text-sm text-slate-500">Sin clases en este periodo.</p>
                  }
                </div>
              </details>

              <details class="tarjeta plegable mb-3">
                <summary><span>Docentes que más usan los laboratorios <span class="contador">{{ x.docentes.length }}</span></span><app-icono nombre="abajo" [tamano]="16" class="flecha" /></summary>
                <div class="space-y-2.5 border-t border-slate-200 p-4">
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
                    <p class="text-sm text-slate-500">Sin clases en este periodo.</p>
                  }
                </div>
              </details>
            }

            <details class="tarjeta plegable mb-3">
              <summary><span>Eventos y defensas <span class="contador">{{ u.eventos.length }}</span></span><app-icono nombre="abajo" [tamano]="16" class="flecha" /></summary>
              <div class="space-y-2.5 border-t border-slate-200 p-4">
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
                  <p class="text-sm text-slate-500">Sin eventos en este periodo.</p>
                }
              </div>
            </details>
          } @else {
            <p class="tarjeta p-10 text-center text-sm text-slate-500">{{ cargando() ? 'Cargando…' : 'Sin datos de uso.' }}</p>
          }
        }
      }
    } @else {
      <p class="tarjeta p-10 text-center text-sm text-slate-500">{{ cargando() ? 'Cargando…' : 'Sin datos.' }}</p>
    }

    <!-- Tarjeta de un número clave -->
    <ng-template #tarjetaIndicador let-k>
      <p class="flex items-center justify-between gap-1 text-xs text-slate-500">
        {{ k.titulo }} @if (k.ir) { <app-icono nombre="siguiente" [tamano]="12" class="text-slate-400" /> }
      </p>
      <p class="truncate font-bold tabular-nums" [title]="'' + (k.valor ?? '—')"
         [class]="(esTexto(k) ? 'text-lg leading-9' : 'text-3xl')
                  + (k.tono === 'alerta' ? ' text-amber-700' : k.tono === 'peligro' ? ' text-rose-700' : k.tono === 'bien' ? ' text-emerald-700' : '')">
        {{ mostrar(k) }}<span class="text-lg">{{ unidad(k) }}</span>
      </p>
      <p class="truncate text-xs text-slate-500" [title]="k.nota">{{ k.nota }}</p>
    </ng-template>

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
    /* Tablas de detalle plegables: título, cantidad y flecha */
    .plegable > summary { display: flex; cursor: pointer; align-items: center; justify-content: space-between; gap: 0.5rem;
                          padding: 0.75rem 1rem; font-weight: 600; list-style: none; user-select: none; }
    .plegable > summary::-webkit-details-marker { display: none; }
    .plegable > summary:hover { background: rgb(148 163 184 / 0.08); }
    .plegable .flecha { color: rgb(148 163 184); transition: transform 0.15s; }
    .plegable[open] .flecha { transform: rotate(180deg); }
    .contador { margin-left: 0.375rem; border-radius: 999px; background: rgb(148 163 184 / 0.18); padding: 0.05rem 0.5rem;
                font-size: 0.75rem; font-weight: 600; font-variant-numeric: tabular-nums; color: rgb(71 85 105); }
    .contador.alerta { background: rgb(251 191 36 / 0.25); color: rgb(146 64 14); }
    .contador.peligro { background: rgb(244 63 94 / 0.18); color: rgb(190 18 60); }
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
  protected readonly nombreRol = NOMBRE_ROL;
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
  /** Cómo se consultó ese periodo (para el texto y el nombre del archivo) */
  private readonly modoConsultado = signal<'mes' | 'rango'>('mes');
  /** "noviembre de 2026" o "del 01/11/2026 al 15/11/2026" */
  private readonly nombrePeriodo = computed(() => {
    const { desde, hasta } = this.periodo();
    return this.modoConsultado() === 'mes'
      ? new Date(desde + 'T00:00:00').toLocaleDateString('es-BO', { month: 'long', year: 'numeric' })
      : `del ${fechaCorta(desde)} al ${fechaCorta(hasta)}`;
  });
  protected readonly textoPeriodo = computed(() =>
    this.modoConsultado() === 'mes' ? `Datos de ${this.nombrePeriodo()}.` : `Datos ${this.nombrePeriodo()}.`);

  /** Sección abierta, desde la URL (?seccion=pcs) */
  readonly seccionUrl = input<string>(undefined, { alias: 'seccion' });
  protected readonly secciones = SECCIONES;
  protected readonly seccion = computed<Seccion>(() => SECCIONES.find((s) => s.clave === this.seccionUrl())?.clave ?? 'resumen');
  protected readonly seccionActual = computed(() => SECCIONES.find((s) => s.clave === this.seccion())!);
  protected readonly datos = signal<Dashboard | null>(null);
  protected readonly cargando = signal(false);
  /** Qué se está exportando (todo o una sección) */
  protected readonly exportando = signal<Seccion | 'todo' | null>(null);
  protected readonly tip = signal<Tooltip | null>(null);

  protected readonly uso = signal<UsoLabs | null>(null);
  protected readonly detalle = signal<Detalle | null>(null);
  /** Bajas y reactivaciones de PCs (por persona y lista de reactivadas) */
  protected readonly movimientos = signal<MovimientosPcs | null>(null);
  protected readonly fallas = signal<Fallas | null>(null);
  protected readonly software = signal<DashSoftware | null>(null);
  protected readonly licencias = LICENCIAS;
  protected readonly masPedidos = computed(() => (this.software()?.por_software ?? []).filter((f) => f.pedidos)
    .sort((a, b) => b.pedidos - a.pedidos || a.nombre.localeCompare(b.nombre, 'es')).slice(0, 10));
  protected readonly masInstalados = computed(() => (this.software()?.por_software ?? []).filter((f) => f.instalar + f.actualizar)
    .sort((a, b) => b.instalar + b.actualizar - (a.instalar + a.actualizar) || a.nombre.localeCompare(b.nombre, 'es')).slice(0, 10));
  protected readonly topePedidos = computed(() => Math.max(1, ...this.masPedidos().map((f) => f.pedidos)));
  protected readonly topeInstalados = computed(() => Math.max(1, ...this.masInstalados().map((f) => f.instalar + f.actualizar)));
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
    return con ? Math.round((c!.a_tiempo / con) * 100) : null;
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
  protected readonly topeAux = computed(() => Math.max(1, ...(this.datos()?.auxiliares ?? []).map((a) => a.tickets)));
  /** Totales por categoría (docente, técnico, personal, cambios de estado) */
  protected readonly porCategoria = computed(() => {
    const textos: Record<CategoriaTicket, string> = {
      docente: 'Atención a docente', tecnico: 'Técnico', personal: 'Atención personal', laboratorio: 'Abrir / cerrar lab',
      sistema: 'Cambios de estado',
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

  /**
   * Números clave de cada sección: 4 por sección, en el mismo orden en la
   * página y en el Excel.
   */
  protected readonly indicadores = computed<Record<Seccion, Indicador[]>>(() => {
    const d = this.datos();
    const x = this.detalle();
    const u = this.uso();
    const fx = this.fallas();
    const sw = this.software();
    const vacio: Record<Seccion, Indicador[]> = { resumen: [], tickets: [], auxiliares: [], pcs: [], software: [], uso: [] };
    if (!d) return vacio;
    const k = d.kpis;
    const v = this.variacion();
    const textoVariacion = v === null ? `periodo anterior: ${k.tickets_anterior}` : `${v >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(v))} % vs periodo anterior (${k.tickets_anterior})`;
    const ticketsKpi: Indicador = { titulo: 'Tickets del periodo', valor: k.tickets, nota: textoVariacion };
    const resueltosKpi: Indicador = { titulo: 'Resueltos', valor: this.pctResueltos(), formato: 'porcentaje', nota: `${k.resueltos} de ${k.tickets} tickets`, tono: this.pctResueltos() >= 80 ? 'bien' : undefined };
    const pendientesKpi: Indicador = { titulo: 'Pendiente ahora', valor: k.pendientes_total, nota: `tickets sin resolver · ${k.tareas_pendientes} tareas de turno`, tono: k.pendientes_total > 0 ? 'alerta' : 'bien' };
    const pcsKpi: Indicador = { titulo: 'PCs activas', valor: d.pcs.operativa, nota: `de ${d.pcs.total} PCs · ${d.pcs.mantenimiento} en mantenimiento` };
    const activos = d.auxiliares.filter((a) => a.tickets > 0).length;
    const lab = this.labMasUsado();
    return {
      resumen: [{ ...ticketsKpi, ir: 'tickets' }, { ...resueltosKpi, ir: 'tickets' }, { ...pendientesKpi, ir: 'tickets' }, { ...pcsKpi, ir: 'pcs' }],
      tickets: [
        { ...ticketsKpi, nota: `${k.trabajos} trabajos · ${textoVariacion}` },
        resueltosKpi,
        pendientesKpi,
        { titulo: 'Tiempo para resolver', valor: k.horas_resolucion, formato: 'horas', nota: 'promedio de los tickets resueltos' },
      ],
      auxiliares: [
        { titulo: 'Auxiliares con trabajo', valor: activos, nota: `de ${d.auxiliares.length} en el equipo` },
        { titulo: 'Cierres de turno', valor: x?.cierres.total ?? null, nota: x ? `${x.cierres.sin_horario} sin horario registrado` : 'cargando…' },
        { titulo: 'Cierres a tiempo', valor: this.pctATiempo(), formato: 'porcentaje',
          nota: x ? `${x.cierres.a_tiempo} de ${x.cierres.a_tiempo + x.cierres.con_retraso} con horario` : '',
          tono: this.pctATiempo() === null ? undefined : this.pctATiempo()! >= 90 ? 'bien' : 'alerta' },
        { titulo: 'Retraso promedio', valor: x?.cierres.retraso_promedio ? this.retraso(x.cierres.retraso_promedio) : null,
          nota: x?.cierres.retraso_maximo ? `máximo: ${this.retraso(x.cierres.retraso_maximo)}` : 'sin retrasos', tono: x?.cierres.con_retraso ? 'alerta' : undefined },
      ],
      pcs: [
        pcsKpi,
        { titulo: 'En mantenimiento', valor: d.pcs.mantenimiento, nota: `${d.pcs.inactiva} inactivas · ${d.pcs.baja} de baja`, tono: d.pcs.mantenimiento > 0 ? 'alerta' : undefined },
        { titulo: 'Mantenimientos hechos', valor: sw ? sw.kpis.preventivos + sw.kpis.correctivos : null,
          nota: sw ? `${sw.kpis.preventivos} preventivos · ${sw.kpis.correctivos} correctivos` : 'cargando…' },
        { titulo: 'PCs reparadas 2+ veces', valor: fx?.reincidentes.length ?? null, nota: 'conviene revisarlas', tono: fx?.reincidentes.length ? 'alerta' : undefined },
      ],
      software: [
        { titulo: 'Pedidos de docentes', valor: sw?.kpis.pedidos ?? null, nota: 'programas que pidieron instalar' },
        { titulo: 'Instalaciones', valor: sw?.kpis.instalaciones ?? null, nota: sw ? `${sw.kpis.programas_distintos} programas distintos` : '' },
        { titulo: 'Actualizaciones', valor: sw?.kpis.actualizaciones ?? null, nota: sw ? `${sw.kpis.desinstalaciones} desinstalaciones` : '' },
        { titulo: 'Más pedido', valor: this.masPedidos()[0]?.nombre ?? '—', nota: this.masPedidos()[0] ? `${this.masPedidos()[0].pedidos} pedidos` : 'sin pedidos' },
      ],
      uso: [
        { titulo: 'Horas de clase', valor: u ? Math.round(u.totales.horas_clase) : null, formato: 'horas', nota: u ? `${u.totales.materias} materias distintas` : '' },
        { titulo: 'Horas cedidas', valor: u ? Math.round(u.totales.horas_cesion) : null, formato: 'horas', nota: 'prestado a otro docente' },
        { titulo: 'Horas de eventos', valor: u ? Math.round(u.totales.horas_evento) : null, formato: 'horas', nota: u ? `${u.totales.eventos} eventos y defensas` : '' },
        { titulo: 'Laboratorio más usado', valor: lab?.codigo ?? '—', nota: lab ? `${Math.round(this.totalLab(lab))} h en el periodo` : 'sin uso' },
      ],
    };
  });

  /** Lo que conviene revisar (cada punto lleva a su sección) */
  protected readonly alertas = computed(() => {
    const d = this.datos();
    const x = this.detalle();
    const fx = this.fallas();
    const lista: { texto: string; detalle: string; ir: Seccion; tono: 'alerta' | 'peligro' }[] = [];
    if (!d) return lista;
    if (d.kpis.pendientes_total) lista.push({ texto: `${d.kpis.pendientes_total} tickets sin resolver`, detalle: `${d.kpis.tareas_pendientes} tareas de turno pendientes`, ir: 'tickets', tono: 'alerta' });
    if (x?.cierres.con_retraso) lista.push({ texto: `${x.cierres.con_retraso} cierres de turno con retraso`, detalle: x.cierres.retraso_promedio ? `en promedio ${this.retraso(x.cierres.retraso_promedio)} tarde` : '', ir: 'auxiliares', tono: 'alerta' });
    if (d.pcs.mantenimiento) lista.push({ texto: `${d.pcs.mantenimiento} PCs en mantenimiento`, detalle: this.labsCon('mantenimiento'), ir: 'pcs', tono: 'alerta' });
    if (d.pcs.inactiva) lista.push({ texto: `${d.pcs.inactiva} PCs inactivas`, detalle: this.labsCon('inactiva'), ir: 'pcs', tono: 'alerta' });
    if (fx?.reincidentes.length) lista.push({ texto: `${fx.reincidentes.length} PCs reparadas 2 o más veces`, detalle: fx.reincidentes.slice(0, 4).map((r) => r.etiqueta).join(', '), ir: 'pcs', tono: 'alerta' });
    if (x?.bajas.length) lista.push({ texto: `${x.bajas.length} PCs dadas de baja`, detalle: x.bajas.slice(0, 4).map((b) => b.etiqueta).join(', '), ir: 'pcs', tono: 'peligro' });
    if (x?.objetos.en_custodia) lista.push({ texto: `${x.objetos.en_custodia} objetos perdidos en custodia`, detalle: 'esperando que los recojan', ir: 'auxiliares', tono: 'alerta' });
    return lista;
  });

  /** Lo más destacado del periodo, en una línea cada uno */
  protected readonly destacados = computed(() => {
    const d = this.datos();
    const u = this.uso();
    const fx = this.fallas();
    const lista: { titulo: string; valor: string; nota: string; ir: Seccion }[] = [];
    if (!d) return lista;
    const aux = [...d.auxiliares].sort((a, b) => b.tickets - a.tickets)[0];
    if (aux?.tickets) lista.push({ titulo: 'Auxiliar con más tickets', valor: aux.nombre, nota: `${aux.tickets} tickets · ${aux.resueltos} resueltos`, ir: 'auxiliares' });
    const dia = [...d.por_dia].sort((a, b) => b.tickets - a.tickets)[0];
    if (dia?.tickets) lista.push({ titulo: 'Día con más trabajo', valor: this.fechaLarga(dia.dia), nota: `${dia.tickets} tickets`, ir: 'tickets' });
    const labTk = [...d.por_lab].sort((a, b) => b.tickets - a.tickets)[0];
    if (labTk?.tickets) lista.push({ titulo: 'Lab. con más tickets', valor: labTk.codigo, nota: `${labTk.tickets} tickets · ${labTk.pendientes} sin resolver`, ir: 'pcs' });
    const lab = this.labMasUsado();
    if (lab) lista.push({ titulo: 'Lab. más usado', valor: lab.codigo, nota: `${Math.round(this.totalLab(lab))} h${lab.materia_top ? ' · ' + lab.materia_top : ''}`, ir: 'uso' });
    if (u?.materias[0]) lista.push({ titulo: 'Materia que más usa', valor: u.materias[0].materia, nota: `${Math.round(u.materias[0].horas)} h · ${u.materias[0].labs}`, ir: 'uso' });
    if (fx?.fallas[0]) lista.push({ titulo: 'Falla más repetida', valor: fx.fallas[0].falla, nota: `${fx.fallas[0].veces} veces en ${fx.fallas[0].pcs} PCs`, ir: 'pcs' });
    const pedido = this.masPedidos()[0];
    if (pedido) lista.push({ titulo: 'Programa más pedido', valor: pedido.nombre, nota: `${pedido.pedidos} pedidos de docentes`, ir: 'software' });
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
    this.modoConsultado.set(this.modo());
    // Cada consulta lleva su número: si se cambia de periodo antes de que llegue, la respuesta vieja se descarta
    const n = ++this.consulta;
    this.cargando.set(true);
    void this.cargarUso(desde, hasta, n);
    void this.cargarDetalle(desde, hasta, n);
    void this.cargarMovimientos(desde, hasta, n);
    void this.cargarFallas(desde, hasta, n);
    void this.cargarSoftware(desde, hasta, n);
    try {
      const datos = await this.supabase.rpc<Dashboard>('fn_dashboard_operacion', { p_desde: desde, p_hasta: hasta });
      if (n === this.consulta) this.datos.set(datos);
    } catch (e) {
      if (n !== this.consulta) return;
      this.datos.set(null);
      this.notificaciones.error(e, 'No se cargó el dashboard');
    } finally {
      if (n === this.consulta) this.cargando.set(false);
    }
  }

  /** Número de la última consulta pedida */
  private consulta = 0;

  private async cargarUso(desde: string, hasta: string, n: number): Promise<void> {
    try {
      const datos = await this.supabase.rpc<UsoLabs>('fn_dashboard_uso', { p_desde: desde, p_hasta: hasta });
      if (n === this.consulta) this.uso.set(datos);
    } catch (e) {
      if (n !== this.consulta) return;
      this.uso.set(null);
      this.notificaciones.error(e, 'No se cargó el uso de laboratorios');
    }
  }

  private async cargarDetalle(desde: string, hasta: string, n: number): Promise<void> {
    try {
      const datos = await this.supabase.rpc<Detalle>('fn_dashboard_detalle', { p_desde: desde, p_hasta: hasta });
      if (n === this.consulta) this.detalle.set(datos);
    } catch (e) {
      if (n !== this.consulta) return;
      this.detalle.set(null);
      this.notificaciones.error(e, 'No se cargó el análisis detallado');
    }
  }

  /** Bajas y reactivaciones de PCs del período */
  private async cargarMovimientos(desde: string, hasta: string, n: number): Promise<void> {
    try {
      const datos = await this.supabase.rpc<MovimientosPcs>('fn_dashboard_pcs_movimientos', { p_desde: desde, p_hasta: hasta });
      if (n === this.consulta) this.movimientos.set(datos);
    } catch (e) {
      if (n !== this.consulta) return;
      this.movimientos.set(null);
      this.notificaciones.error(e, 'No se cargaron las bajas y reactivaciones de PCs');
    }
  }

  private async cargarSoftware(desde: string, hasta: string, n: number): Promise<void> {
    try {
      const datos = await this.supabase.rpc<DashSoftware>('fn_dashboard_software', { p_desde: desde, p_hasta: hasta });
      if (n === this.consulta) this.software.set(datos);
    } catch (e) {
      if (n !== this.consulta) return;
      this.software.set(null);
      this.notificaciones.error(e, 'No se cargó el software');
    }
  }

  private async cargarFallas(desde: string, hasta: string, n: number): Promise<void> {
    try {
      const datos = await this.supabase.rpc<Fallas>('fn_dashboard_fallas', { p_desde: desde, p_hasta: hasta });
      if (n === this.consulta) this.fallas.set(datos);
    } catch (e) {
      if (n !== this.consulta) return;
      this.fallas.set(null);
      this.notificaciones.error(e, 'No se cargaron las fallas');
    }
  }

  protected verSoftwareLabs(): void {
    void this.router.navigate(['/laboratorios'], { queryParams: { vista: 'software' } });
  }

  protected textoCategoriaFalla(c: CategoriaFalla): string {
    return textoCategoriaFalla(c);
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

  /** "SC-107 (3), SC-201 (1)": laboratorios con PCs en ese estado */
  private labsCon(estado: EstadoPc): string {
    return (this.datos()?.por_lab ?? []).filter((l) => l.pcs[estado]).map((l) => `${l.codigo} (${l.pcs[estado]})`).join(', ');
  }

  /** Valor de una tarjeta, con separador de miles */
  protected mostrar(k: Indicador): string {
    if (k.valor === null || k.valor === undefined) return '—';
    if (typeof k.valor === 'number') return k.valor.toLocaleString('es-BO', { maximumFractionDigits: 1 });
    return k.valor;
  }

  /** Valores de texto (un nombre) se muestran más chicos que los números */
  protected esTexto(k: Indicador): boolean {
    return typeof k.valor === 'string';
  }

  protected unidad(k: Indicador): string {
    if (typeof k.valor !== 'number') return '';
    return k.formato === 'porcentaje' ? '%' : k.formato === 'horas' ? ' h' : '';
  }

  /** Clases, cedidas y eventos de una lista de horas de uso */
  protected seriesUso(lista: HorasUso[]): SerieGrafico[] {
    return [
      { nombre: 'Clases', color: SERIE_1, valores: lista.map((x) => x.clase) },
      { nombre: 'Cedidas', color: SERIE_3, valores: lista.map((x) => x.cesion), punteada: true },
      { nombre: 'Eventos', color: SERIE_2, valores: lista.map((x) => x.evento) },
    ];
  }

  protected turnosDe(lista: { turno: keyof typeof TURNOS }[]): string[] {
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

  protected fechaLarga(fecha: string): string {
    return new Date(fecha + 'T00:00:00').toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  protected claseEstado(e: EstadoPc): string {
    return ESTADOS_PC.find((s) => s.clave === e)?.clase ?? '';
  }

  protected textoEstado(e: EstadoPc): string {
    return textoEstadoPc(e);
  }

  /**
   * Excel del periodo: sin sección, el libro completo (una hoja por
   * sección); con sección, solo esa hoja.
   */
  protected async exportar(seccion?: Seccion): Promise<void> {
    const datos = this.datos();
    if (!datos || this.exportando()) return;
    this.exportando.set(seccion ?? 'todo');
    try {
      const secciones = seccion ? [seccion] : SECCIONES.map((s) => s.clave);
      const hojas = hojasDesempeno({
        datos, detalle: this.detalle(), uso: this.uso(), fallas: this.fallas(), software: this.software(),
        indicadores: this.indicadores(), alertas: this.alertas(), destacados: this.destacados(),
      }, secciones);
      if (!hojas.length) {
        this.notificaciones.aviso('Esta sección todavía no tiene datos para exportar.');
        return;
      }
      const { desde, hasta } = this.periodo();
      const periodo = this.modoConsultado() === 'mes' ? desde.slice(0, 7) : `${desde}_a_${hasta}`;
      const nombre = seccion ? SECCIONES.find((s) => s.clave === seccion)!.texto : '';
      await exportarExcel({
        archivo: `Desempeño ${nombre ? nombre + ' ' : ''}${periodo}`,
        titulo: 'Desempeño de laboratorios',
        subtitulo: `Periodo: ${this.nombrePeriodo()}`,
        hojas,
      });
    } catch (e) {
      this.notificaciones.error(e, 'No se pudo generar el Excel');
    } finally {
      this.exportando.set(null);
    }
  }
}
