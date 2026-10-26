import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { ComponentesPcComponent } from '../../compartido/componentes-pc.component';
import { FichasReparacionComponent } from '../../compartido/fichas-reparacion.component';
import { IconoComponent } from '../../compartido/icono.component';
import { AgentePcsService } from '../../core/agente-pcs.service';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { exportarPdf } from '../../core/exportar-pdf';
import { cabeceraHoja, escaparHtml, FIRMAS_HOJA, imprimirDocumento, TEXTOS_ESTADO_PC } from '../../core/impresion';
import { AmbientePc, ConexionPc, EstadoPc } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { OperacionService } from '../../core/operacion.service';

/** PCs por mesa y mesas por fila (como el plano de los laboratorios) */
const PCS_POR_MESA = 4;
const MESAS_POR_FILA = 4;

/** Color de la pantalla, ícono y texto de cada estado */
const ESTADOS: Record<EstadoPc, { texto: string; pantalla: string; punto: string; icono: string | null }> = {
  operativa: { texto: 'Activa', pantalla: 'bg-emerald-500 border-emerald-600', punto: 'bg-emerald-500', icono: null },
  inactiva: { texto: 'Inactiva', pantalla: 'bg-slate-400 border-slate-500', punto: 'bg-slate-400', icono: 'suspender' },
  mantenimiento: { texto: 'Mantenimiento', pantalla: 'bg-amber-400 border-amber-500', punto: 'bg-amber-400', icono: 'mantenimiento' },
  baja: { texto: 'De baja', pantalla: 'bg-rose-500 border-rose-600', punto: 'bg-rose-500', icono: 'cerrar' },
};
const OPCIONES: { estado: EstadoPc; clase: string }[] = [
  { estado: 'operativa', clase: 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100' },
  { estado: 'inactiva', clase: 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200' },
  { estado: 'mantenimiento', clase: 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100' },
  { estado: 'baja', clase: 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100' },
];

/** Punto y texto de la conexión que reporta el agente de inventario */
const CONEXIONES: Record<ConexionPc, { texto: string; punto: string }> = {
  prendida: { texto: 'Prendida', punto: 'bg-emerald-500 ring-emerald-100' },
  apagada: { texto: 'Apagada', punto: 'bg-slate-700 ring-slate-200' },
  sin_agente: { texto: 'Sin agente', punto: '' },
};

/** Columnas de la lista de PCs (hoja impresa y PDF) */
const COLUMNAS_LISTA = ['N.º', 'PC', 'Estado', 'Conexión', 'Procesador', 'RAM', 'Almacenamiento', 'N.º de serie'];

/** ¿Es la PC de la mesa del docente? */
export function esPcDocente(pc: AmbientePc): boolean {
  return pc.es_docente || /^PC\s*DOCENTE/i.test(pc.etiqueta);
}

/**
 * Croquis del laboratorio dibujado como el plano real: mesa del docente a la
 * izquierda y mesas de 4 PCs en filas. Cada PC es un monitor con el color de
 * su estado. Dos modos:
 *  - 'estado': todos ven el estado y el último cambio de cada PC; el personal
 *    de operación cambia el estado (una o varias PCs) llenando una FICHA DE
 *    REPARACIÓN por PC (fallas, corrección, pieza): queda como mantenimiento
 *    correctivo. Dar de baja también; la baja sale en su cierre de turno.
 *  - 'seleccion': dentro de un ticket, se marcan las PCs donde se hizo la tarea.
 *    Solo se marcan PCs ACTIVAS (una en mantenimiento o inactiva se puede
 *    pasar a Activa ahí mismo); con permitirNoActivas (correctivo) también
 *    las que fallan y las de baja (para repararlas).
 */
@Component({
  selector: 'app-laboratorio-croquis',
  imports: [IconoComponent, NgTemplateOutlet, DatePipe, FichasReparacionComponent, ComponentesPcComponent],
  // El menú del clic derecho se cierra al hacer clic en cualquier lado o con Escape
  // La hoja de acciones del celular NO se cierra con el clic del documento (lo dispara el mismo dedo al soltar)
  host: { '(document:click)': 'cerrarMenus()', '(document:keydown.escape)': 'cerrarMenus(); hojaAcciones.set(null)' },
  template: `
    <div class="relative" #raiz>
      <!-- Barra: leyenda + acciones -->
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          @for (o of opciones; track o.estado) {
            <span class="inline-flex items-center gap-1">
              <span class="h-2.5 w-2.5 rounded-sm" [class]="estados[o.estado].punto"></span>
              {{ estados[o.estado].texto }} <b class="text-slate-700">{{ cuenta()[o.estado] }}</b>
            </span>
          }
          <!-- Prendidas / apagadas según el agente (solo si alguna PC lo tiene) -->
          @if (cuentaConexion().prendida + cuentaConexion().apagada) {
            <span class="mx-1 h-3 w-px bg-slate-300"></span>
            <span class="inline-flex items-center gap-1"><span class="h-2 w-2 rounded-full" [class]="conexiones.prendida.punto"></span> Prendidas <b class="text-slate-700">{{ cuentaConexion().prendida }}</b></span>
            <span class="inline-flex items-center gap-1"><span class="h-2 w-2 rounded-full" [class]="conexiones.apagada.punto"></span> Apagadas <b class="text-slate-700">{{ cuentaConexion().apagada }}</b></span>
          }
        </div>
        @if (maquinas().length || docente()) {
          <div class="flex flex-wrap gap-1.5">
            @if (modo() === 'seleccion') {
              <button type="button" class="btn-secundario btn-sm" (click)="todas()">Todas las activas ({{ activas().length }})</button>
              <button type="button" class="btn-secundario btn-sm" (click)="emitir([])" [disabled]="!seleccion().length">Limpiar</button>
            } @else if (puedeCambiar()) {
              <button type="button" class="btn-sm" [class]="multiple() ? 'btn-primario' : 'btn-secundario'" (click)="alternarMultiple()"
                      title="Marcar varias PCs y cambiarles el estado juntas">
                <app-icono nombre="capas" [tamano]="14" /> {{ multiple() ? 'Terminar selección' : 'Cambiar varias' }}
              </button>
            }
            <!-- Lista de PCs del laboratorio en hoja carta: imprimir (solo PC) o exportar PDF (PC y celular) -->
            @if (modo() === 'estado') {
              <div class="relative" (click)="$event.stopPropagation()">
                <button type="button" class="btn-secundario btn-sm" (click)="opcionesImpresion.set(!opcionesImpresion())"
                        [attr.aria-expanded]="opcionesImpresion()" title="Imprimir o exportar a PDF la lista de PCs de este laboratorio">
                  <app-icono nombre="descargar" [tamano]="14" />
                  <span class="hidden sm:inline">Imprimir / PDF</span><span class="sm:hidden">Exportar PDF</span>
                </button>
                @if (opcionesImpresion()) {
                  <div class="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-slate-200 bg-superficie p-3 text-sm shadow-lg">
                    <p class="mb-2 font-semibold">Lista de PCs (hoja carta)</p>
                    <label class="flex min-h-9 items-center gap-2">
                      <input type="checkbox" [checked]="incluirDocente()" (change)="incluirDocente.set(!incluirDocente())"> Incluir PC docente
                    </label>
                    <label class="flex min-h-9 items-center gap-2">
                      <input type="checkbox" [checked]="soloActivas()" (change)="soloActivas.set(!soloActivas())"> Solo PCs activas
                    </label>
                    <div class="mt-2 flex gap-1.5">
                      <!-- Imprimir no se muestra en el celular -->
                      <button type="button" class="btn-secundario btn-sm hidden flex-1 sm:inline-flex" (click)="imprimirLista()">
                        <app-icono nombre="imprimir" [tamano]="14" /> Imprimir
                      </button>
                      <button type="button" class="btn-primario btn-sm flex-1" [disabled]="generandoPdf()" (click)="exportarListaPdf()">
                        <app-icono nombre="descargar" [tamano]="14" /> {{ generandoPdf() ? 'Generando…' : 'Exportar PDF' }}
                      </button>
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>

      @if (!maquinas().length && !docente()) {
        <p class="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          Este laboratorio aún no tiene PCs. Créalas con <b>Generar PCs</b> en el inventario.
        </p>
      } @else {
        <!-- PLANO -->
        <!-- En el celular el plano se compacta (solo el número de cada PC) para que entren todas las mesas -->
        <div class="plano overflow-x-auto rounded-xl border-2 border-slate-300 bg-slate-50 p-1.5 sm:p-3">
          <div class="flex gap-1.5 sm:min-w-[560px] sm:gap-4">
            <!-- Zona del docente -->
            <div class="flex w-12 shrink-0 flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-superficie/70 p-1 sm:w-28 sm:p-2">
              <span class="w-full rounded bg-slate-700 py-1 text-center text-[8px] font-semibold tracking-wide text-superficie sm:text-[10px]">PIZARRA</span>
              <span class="hidden text-[10px] font-semibold uppercase text-slate-400 sm:inline">Docente</span>
              @if (docente(); as pc) {
                <ng-container *ngTemplateOutlet="monitor; context: { $implicit: pc, docente: true }" />
              } @else {
                <span class="py-3 text-center text-[10px] text-slate-400">Sin PC docente</span>
              }
              <span class="mt-auto text-[10px] text-slate-400">Puerta ▾</span>
            </div>

            <!-- Mesas de alumnos -->
            <div class="min-w-0 flex-1 space-y-3 sm:space-y-6">
              @for (fila of filas(); track $index) {
                <div class="grid gap-1.5 sm:gap-3" [style.grid-template-columns]="'repeat(' + mesasPorFila + ', minmax(0, 1fr))'">
                  @for (mesa of fila; track $index) {
                    <div class="flex flex-col gap-1 rounded-md border-2 border-slate-300 bg-superficie p-0.5 shadow-sm sm:gap-1.5 sm:p-1.5">
                      @for (pc of mesa; track pc.id) {
                        <ng-container *ngTemplateOutlet="monitor; context: { $implicit: pc, docente: false }" />
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        </div>
      }

      <!-- Pista solo en pantallas táctiles chicas -->
      @if (maquinas().length || docente()) {
        <p class="mt-1.5 flex items-center gap-1 text-[11px] text-slate-500 sm:hidden">
          <app-icono nombre="info" [tamano]="12" /> Mantén presionada una PC para ver sus propiedades.
        </p>
      }

      @if (modo() === 'seleccion' && noDisponibles()) {
        <p class="mt-2 flex items-start gap-1.5 text-xs text-slate-500">
          <app-icono nombre="info" [tamano]="13" />
          <span>{{ noDisponibles() }} PC(s) no se pueden marcar.
            Toca una en mantenimiento o inactiva para pasarla a Activa. Las de baja solo admiten un mantenimiento correctivo.</span>
        </p>
      }

      <!-- Cambio de estado: ficha de reparación por PC (queda como mantenimiento correctivo) -->
      @if (porCambiar(); as c) {
        <div class="mt-3 rounded-lg border-2 border-marca-300 bg-marca-50/60 p-3">
          <p class="mb-1 flex items-center gap-2 text-sm font-semibold">
            <app-icono nombre="mantenimiento" [tamano]="15" />
            Ficha de reparación · {{ c.pcs.length === 1 ? c.pcs[0].etiqueta : c.pcs.length + ' PCs' }}
          </p>
          <p class="mb-2 text-xs text-slate-600">
            Llena la ficha de cada PC: queda como <b>mantenimiento correctivo</b> a tu nombre. Si queda de baja, sale en tu cierre de turno.
          </p>
          <div class="rounded-lg bg-superficie p-2">
            <app-fichas-reparacion [pcs]="c.pcs" [estadoInicial]="c.estado" />
          </div>
          <div class="mt-2 flex justify-end gap-1.5">
            <button type="button" class="btn-secundario btn-sm" (click)="porCambiar.set(null)">Cancelar</button>
            <button type="button" class="btn-primario btn-sm" [disabled]="guardando()" (click)="confirmarCambio()">
              {{ guardando() ? 'Guardando…' : c.pcs.length > 1 ? 'Guardar ' + c.pcs.length + ' fichas' : 'Guardar ficha' }}
            </button>
          </div>
        </div>
      }

      <!-- Una PC: cambio de estado -->
      @if (modo() === 'estado' && !multiple() && activa(); as pc) {
        <div class="mt-3 rounded-lg border border-slate-200 bg-superficie p-3 shadow-sm">
          <div class="mb-2 flex items-center gap-2">
            <span class="h-3 w-3 rounded-sm" [class]="estados[pc.estado].punto"></span>
            <span class="font-semibold">{{ pc.etiqueta }}</span>
            <span class="text-xs text-slate-500">{{ estados[pc.estado].texto }}</span>
            <button class="btn-fantasma btn-sm ml-auto" (click)="activa.set(null)" aria-label="Cerrar"><app-icono nombre="cerrar" [tamano]="14" /></button>
          </div>
          @if (caracteristicas(pc)) { <p class="mb-2 text-xs text-slate-500">{{ caracteristicas(pc) }}</p> }
          <!-- Conexión según el agente + botón de componentes -->
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p class="flex items-center gap-1.5 text-xs text-slate-600">
              @switch (conexion(pc)) {
                @case ('prendida') { <span class="h-2 w-2 rounded-full" [class]="conexiones.prendida.punto"></span> <b>Prendida</b> }
                @case ('apagada') { <span class="h-2 w-2 rounded-full" [class]="conexiones.apagada.punto"></span> <b>Apagada</b> desde {{ agente.ultimoLatido(pc.id) | date: 'dd/MM HH:mm' }} }
                @default { <span class="text-slate-400">Sin agente de inventario</span> }
              }
            </p>
            <button type="button" class="btn-secundario btn-sm" (click)="verComponentes.set(pc)">
              <app-icono nombre="equipo" [tamano]="14" /> Ver propiedades
            </button>
          </div>
          @if (pc.notas) { <p class="mb-2 text-xs text-slate-500">{{ pc.notas }}</p> }
          @if (pc.estado_en) {
            <p class="mb-2 rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
              <b>Último cambio:</b> {{ pc.cambio?.nombre_completo ?? '—' }} · {{ pc.estado_en | date: 'dd/MM/yyyy HH:mm' }}<br>
              {{ pc.estado_detalle }}
            </p>
          } @else if (pc.estado === 'baja' && pc.motivo_baja) {
            <p class="mb-2 text-xs text-rose-700"><b>Motivo de baja:</b> {{ pc.motivo_baja }}</p>
          }
          @if (bajaPendiente().has(pc.id)) {
            <p class="mb-2 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700">Baja solicitada: esperando al administrador o al encargado.</p>
          }
          @if (puedeCambiar()) {
            <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              @for (o of opciones; track o.estado) {
                <button class="rounded-lg border-2 px-2 py-2 text-xs font-semibold transition disabled:opacity-40" [class]="o.clase"
                        (click)="pedirCambio([pc], o.estado)"
                        [disabled]="pc.estado === o.estado || guardando()">
                  {{ estados[o.estado].texto }}
                </button>
              }
            </div>
          }
        </div>
      }

      <!-- Varias PCs: cambio de estado en lote -->
      @if (modo() === 'estado' && multiple()) {
        <div class="mt-3 rounded-lg border border-marca-300 bg-marca-50 p-3">
          <p class="mb-2 text-sm">
            @if (marcadas().length) { <b>{{ marcadas().length }}</b> PC(s) marcadas. Cambiar todas a: }
            @else { Toca las PCs que quieres cambiar. }
          </p>
          <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            @for (o of opciones; track o.estado) {
              <button class="rounded-lg border-2 px-2 py-2 text-xs font-semibold transition disabled:opacity-40" [class]="o.clase"
                      (click)="cambiarMarcadas(o.estado)" [disabled]="!marcadas().length || guardando()">{{ estados[o.estado].texto }}</button>
            }
          </div>
        </div>
      }

      <!-- Menú del clic derecho sobre una PC (como en Windows) -->
      @if (menu(); as m) {
        <div class="absolute z-30 min-w-48 rounded-lg border border-slate-200 bg-superficie py-1 text-sm shadow-lg"
             [style.left.px]="m.x" [style.top.px]="m.y" role="menu" (click)="$event.stopPropagation()">
          <p class="truncate border-b border-slate-100 px-3 pb-1.5 pt-1 text-xs font-semibold text-slate-500">{{ m.pc.etiqueta }}</p>
          <button type="button" role="menuitem" class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-100"
                  (click)="verComponentes.set(m.pc); menu.set(null)">
            <app-icono nombre="equipo" [tamano]="15" /> Ver propiedades
          </button>
          @if (modo() === 'estado' && !multiple()) {
            <button type="button" role="menuitem" class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-100"
                    (click)="activa.set(m.pc); menu.set(null)">
              <app-icono nombre="mantenimiento" [tamano]="15" /> Cambiar estado
            </button>
          }
        </div>
      }
    </div>

    <!-- Una PC dibujada como monitor -->
    <ng-template #monitor let-pc let-docente="docente">
      <button type="button"
              class="group relative flex w-full flex-col items-center gap-0.5 rounded-md border px-0.5 py-1 text-left transition sm:flex-row sm:gap-1.5 sm:px-1.5"
              [class]="marcada(pc) ? 'border-marca-500 bg-marca-50 ring-2 ring-marca-500' : 'border-transparent hover:border-slate-300 hover:bg-slate-100'"
              [class.cursor-default]="false"
              [class.opacity-50]="modo() === 'seleccion' && !seleccionable(pc) && !marcada(pc)"
              [class.cursor-not-allowed]="modo() === 'seleccion' && pc.estado === 'baja'"
              (click)="alTocar(pc)" (contextmenu)="abrirMenu($event, pc)"
              (pointerdown)="iniciarPulsacion($event, pc)" (pointermove)="moverPulsacion($event)"
              (pointerup)="cancelarPulsacion()" (pointercancel)="cancelarPulsacion()" (pointerleave)="cancelarPulsacion()"
              [style.-webkit-touch-callout]="'none'" [style.user-select]="'none'"
              [title]="pc.etiqueta + ' · ' + info(pc).texto + ' · ' + conexiones[conexion(pc)].texto + ' (clic derecho o mantener presionado: propiedades)'">
        <!-- pantalla -->
        <span class="relative flex h-6 w-8 shrink-0 items-center justify-center rounded-[3px] border-2 text-white sm:h-7 sm:w-9" [class]="info(pc).pantalla">
          @if (info(pc).icono; as ic) { <app-icono [nombre]="ic" [tamano]="13" [grosor]="2.5" /> }
          <span class="absolute -bottom-[5px] left-1/2 h-[3px] w-3 -translate-x-1/2 rounded-sm bg-slate-400"></span>
          <!-- punto de prendida / apagada (no se dibuja si la PC no tiene agente) -->
          @if (conexion(pc) !== 'sin_agente') {
            <span class="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full ring-2" [class]="conexiones[conexion(pc)].punto"></span>
          }
        </span>
        <span class="min-w-0 pt-0.5 text-center leading-tight sm:pt-0 sm:text-left">
          <span class="block text-xs font-bold text-slate-800 sm:text-sm">{{ docente ? 'DOC' : numero(pc) }}</span>
          <span class="hidden truncate text-[9px] text-slate-500 sm:block">{{ pc.etiqueta }}</span>
        </span>
        @if (marcada(pc)) {
          <span class="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-marca-600 text-white">
            <app-icono nombre="check" [tamano]="10" [grosor]="3" />
          </span>
        }
      </button>
    </ng-template>

    <!-- Celular: menú que sube desde abajo al mantener presionada una PC -->
    @if (hojaAcciones(); as pc) {
      <div class="fixed inset-0 z-50">
        <div class="absolute inset-0 bg-black/45" (click)="hojaAcciones.set(null)"></div>
        <div class="absolute inset-x-0 bottom-0 rounded-t-2xl bg-superficie px-3 pb-5 pt-2 shadow-xl" role="dialog" aria-modal="true" [attr.aria-label]="'Acciones de ' + pc.etiqueta">
          <div class="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300"></div>
          <div class="mb-2 flex items-center gap-2 px-2">
            <span class="h-3 w-3 shrink-0 rounded-sm" [class]="estados[pc.estado].punto"></span>
            <p class="min-w-0 flex-1 truncate text-base font-semibold">{{ pc.etiqueta }}</p>
            <span class="text-xs text-slate-500">{{ estados[pc.estado].texto }} · {{ conexiones[conexion(pc)].texto }}</span>
          </div>
          <button type="button" class="flex min-h-13 w-full items-center gap-3 rounded-xl px-3 text-left text-base hover:bg-slate-100 active:bg-slate-200"
                  (click)="verComponentes.set(pc); hojaAcciones.set(null)">
            <app-icono nombre="equipo" [tamano]="20" class="text-marca-600" /> Ver propiedades
          </button>
          @if (modo() === 'estado' && puedeCambiar()) {
            <button type="button" class="flex min-h-13 w-full items-center gap-3 rounded-xl px-3 text-left text-base hover:bg-slate-100 active:bg-slate-200"
                    (click)="multiple.set(false); activa.set(pc); hojaAcciones.set(null)">
              <app-icono nombre="mantenimiento" [tamano]="20" class="text-marca-600" /> Cambiar estado
            </button>
          }
          <button type="button" class="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 text-base font-medium"
                  (click)="hojaAcciones.set(null)">Cancelar</button>
        </div>
      </div>
    }

    <!-- Ventana con los componentes que reportó el agente -->
    <app-componentes-pc [pc]="verComponentes()" (cerrar)="verComponentes.set(null)"
                        [permitirCambiarEstado]="modo() === 'estado' && puedeCambiar()"
                        (cambiarEstado)="verComponentes.set(null); multiple.set(false); activa.set($event)" />
  `,
  styles: `
    .plano { background-image: radial-gradient(circle, rgb(148 163 184 / 0.25) 1px, transparent 1px); background-size: 14px 14px; }
  `,
})
export class LaboratorioCroquisComponent {
  private readonly catalogos = inject(CatalogosService);
  private readonly auth = inject(AuthService);
  private readonly notificaciones = inject(NotificacionesService);
  private readonly operacion = inject(OperacionService);
  protected readonly agente = inject(AgentePcsService);

  readonly ambienteId = input.required<number>();
  readonly modo = input<'estado' | 'seleccion'>('estado');
  /** PCs marcadas (modo selección) */
  readonly seleccion = input<number[]>([]);
  readonly seleccionChange = output<number[]>();
  /** Selección para un correctivo: también PCs en mantenimiento o inactivas */
  readonly permitirNoActivas = input(false);

  protected readonly estados = ESTADOS;
  protected readonly conexiones = CONEXIONES;
  /** PC cuya ventana de propiedades está abierta */
  protected readonly verComponentes = signal<AmbientePc | null>(null);
  /** Menú del clic derecho: PC y posición dentro del croquis */
  protected readonly menu = signal<{ pc: AmbientePc; x: number; y: number } | null>(null);
  private readonly raiz = viewChild.required<ElementRef<HTMLElement>>('raiz');
  /** Celular: PC cuyo menú de acciones (desde abajo) está abierto */
  protected readonly hojaAcciones = signal<AmbientePc | null>(null);
  /** Mantener presionado: temporizador, dónde empezó el dedo y si fue táctil */
  private temporizadorPulsacion: ReturnType<typeof setTimeout> | null = null;
  private inicioPulsacion = { x: 0, y: 0 };
  private punteroTactil = false;
  /** El clic que llega al soltar después de mantener presionado no debe marcar la PC */
  private ignorarClic = false;
  /** Panel de opciones de "Imprimir lista" */
  protected readonly opcionesImpresion = signal(false);
  protected readonly incluirDocente = signal(true);
  protected readonly soloActivas = signal(false);
  protected readonly generandoPdf = signal(false);
  protected readonly opciones = OPCIONES;
  protected readonly mesasPorFila = MESAS_POR_FILA;
  protected readonly activa = signal<AmbientePc | null>(null);
  protected readonly multiple = signal(false);
  protected readonly marcadas = signal<number[]>([]);
  protected readonly guardando = signal(false);
  /** Cambio de estado esperando la ficha de reparación de cada PC */
  protected readonly porCambiar = signal<{ pcs: AmbientePc[]; estado: EstadoPc; despues?: () => void } | null>(null);
  private readonly fichas = viewChild(FichasReparacionComponent);
  /** PCs con una solicitud de baja pendiente */
  protected readonly bajaPendiente = signal<Set<number>>(new Set());

  protected readonly todasLasPcs = computed(() => this.catalogos.pcsPorAmbiente().get(this.ambienteId()) ?? []);
  protected readonly docente = computed(() => this.todasLasPcs().find(esPcDocente) ?? null);
  protected readonly maquinas = computed(() => this.todasLasPcs().filter((pc) => !esPcDocente(pc)));
  /** PCs que se pueden marcar en un ticket */
  protected readonly activas = computed(() => this.todasLasPcs().filter((pc) => this.seleccionable(pc)));
  protected readonly noDisponibles = computed(() => this.todasLasPcs().length - this.activas().length);

  /** Mesas de 4 PCs agrupadas en filas de 4 mesas */
  protected readonly filas = computed(() => {
    const mesas: AmbientePc[][] = [];
    const lista = this.maquinas();
    for (let i = 0; i < lista.length; i += PCS_POR_MESA) mesas.push(lista.slice(i, i + PCS_POR_MESA));
    const filas: AmbientePc[][][] = [];
    for (let i = 0; i < mesas.length; i += MESAS_POR_FILA) filas.push(mesas.slice(i, i + MESAS_POR_FILA));
    return filas;
  });

  protected readonly cuenta = computed(() => {
    const r: Record<EstadoPc, number> = { operativa: 0, inactiva: 0, mantenimiento: 0, baja: 0 };
    for (const pc of this.todasLasPcs()) r[pc.estado]++;
    return r;
  });

  /** Cuántas PCs del laboratorio están prendidas o apagadas según el agente */
  protected readonly cuentaConexion = computed(() => {
    const r: Record<ConexionPc, number> = { prendida: 0, apagada: 0, sin_agente: 0 };
    for (const pc of this.todasLasPcs()) r[this.agente.conexion(pc.id)]++;
    return r;
  });

  /** Color, ícono y texto del estado de la PC */
  protected info(pc: AmbientePc) {
    return ESTADOS[pc.estado];
  }

  /**
   * Clic derecho (o mantener presionado en el celular) sobre una PC: abre
   * el menú donde se hizo clic, sin salirse del croquis.
   */
  protected abrirMenu(evento: MouseEvent, pc: AmbientePc): void {
    evento.preventDefault();
    evento.stopPropagation();
    // Android también avisa "clic derecho" al mantener presionado: ahí va el menú de abajo
    if (this.punteroTactil) {
      this.abrirHojaAcciones(pc);
      return;
    }
    const caja = this.raiz().nativeElement.getBoundingClientRect();
    const anchoMenu = 200;
    const altoMenu = 110;
    this.menu.set({
      pc,
      x: Math.max(0, Math.min(evento.clientX - caja.left, caja.width - anchoMenu)),
      y: Math.max(0, Math.min(evento.clientY - caja.top, caja.height - altoMenu)),
    });
  }

  /**
   * El dedo toca una PC: si se queda quieto medio segundo, se abre el menú de
   * abajo. Funciona también en iPhone, que no avisa "clic derecho".
   */
  protected iniciarPulsacion(evento: PointerEvent, pc: AmbientePc): void {
    this.punteroTactil = evento.pointerType !== 'mouse';
    this.ignorarClic = false;
    this.cancelarPulsacion();
    if (!this.punteroTactil) return;
    this.inicioPulsacion = { x: evento.clientX, y: evento.clientY };
    this.temporizadorPulsacion = setTimeout(() => this.abrirHojaAcciones(pc), 500);
  }

  /** Si el dedo se mueve (está desplazando el croquis), no es "mantener presionado" */
  protected moverPulsacion(evento: PointerEvent): void {
    if (!this.temporizadorPulsacion) return;
    if (Math.hypot(evento.clientX - this.inicioPulsacion.x, evento.clientY - this.inicioPulsacion.y) > 10) this.cancelarPulsacion();
  }

  /** El dedo se levantó o salió antes de tiempo */
  protected cancelarPulsacion(): void {
    if (this.temporizadorPulsacion) clearTimeout(this.temporizadorPulsacion);
    this.temporizadorPulsacion = null;
  }

  /** Abre el menú de abajo (con una vibración corta si el celular la permite) */
  private abrirHojaAcciones(pc: AmbientePc): void {
    this.cancelarPulsacion();
    this.ignorarClic = true;
    this.menu.set(null);
    if (this.hojaAcciones()?.id !== pc.id) navigator.vibrate?.(15);
    this.hojaAcciones.set(pc);
  }

  /** Toque normal: lo de siempre, salvo que venga de soltar tras mantener presionado */
  protected alTocar(pc: AmbientePc): void {
    if (this.ignorarClic) {
      this.ignorarClic = false;
      return;
    }
    this.tocar(pc);
  }

  /** Cierra el menú del clic derecho y el panel de impresión (clic fuera o Escape) */
  protected cerrarMenus(): void {
    this.menu.set(null);
    this.opcionesImpresion.set(false);
  }

  /**
   * Imprime la lista de PCs del laboratorio en hoja carta horizontal:
   * resumen de totales, una fila por PC y líneas para firmar.
   */
  protected imprimirLista(): void {
    this.opcionesImpresion.set(false);
    const datos = this.datosLista();
    const cuerpo = cabeceraHoja(datos.titulo)
      + `<div class="resumen">${datos.totales.map(([texto, n]) => `<span>${escaparHtml(texto)}: <b>${n}</b></span>`).join('')}</div>`
      + `<table><thead><tr>${COLUMNAS_LISTA.map((c) => `<th>${escaparHtml(c)}</th>`).join('')}</tr></thead><tbody>`
      + datos.filas.map((fila) => '<tr>' + fila.map((valor, i) =>
          !valor ? '<td class="vacio">—</td>' : i === 1 ? `<td><b>${escaparHtml(valor)}</b></td>` : `<td>${escaparHtml(valor)}</td>`).join('') + '</tr>').join('')
      + '</tbody></table>' + FIRMAS_HOJA;
    imprimirDocumento(datos.archivo, cuerpo, 'landscape');
  }

  /** Descarga la misma lista como PDF tamaño carta horizontal (sirve en el celular) */
  protected async exportarListaPdf(): Promise<void> {
    this.generandoPdf.set(true);
    try {
      const datos = this.datosLista();
      await exportarPdf({
        archivo: datos.archivo, titulo: datos.titulo, orientacion: 'landscape',
        resumen: datos.totales.map(([texto, n]) => `${texto}: ${n}`).join('   ·   '),
        secciones: [{ columnas: COLUMNAS_LISTA, filas: datos.filas }],
      });
      this.opcionesImpresion.set(false);
    } catch (e) {
      this.notificaciones.error(e, 'No se pudo generar el PDF');
    } finally {
      this.generandoPdf.set(false);
    }
  }

  /** Lo que llevan la hoja impresa y el PDF: título, totales y una fila por PC */
  private datosLista(): { titulo: string; archivo: string; totales: [string, number][]; filas: (string | null)[][] } {
    const lab = this.catalogos.mapaAmbientes().get(this.ambienteId());
    const nombreLab = lab ? `${lab.codigo}${lab.nombre ? ' (' + lab.nombre + ')' : ''}` : 'Laboratorio';
    const docente = this.docente();
    const lista = [...(this.incluirDocente() && docente ? [docente] : []), ...this.maquinas()]
      .filter((pc) => !this.soloActivas() || pc.estado === 'operativa');
    const cuenta = (estado: EstadoPc) => lista.filter((pc) => pc.estado === estado).length;
    return {
      titulo: `Inventario de PCs · ${nombreLab}`,
      archivo: `Inventario ${lab?.codigo ?? 'laboratorio'}`,
      totales: [
        ['Total', lista.length], ['Activas', cuenta('operativa')], ['Inactivas', cuenta('inactiva')],
        ['Mantenimiento', cuenta('mantenimiento')], ['De baja', cuenta('baja')],
        ['Con agente', lista.filter((pc) => this.conexion(pc) !== 'sin_agente').length],
      ],
      filas: lista.map((pc) => [
        esPcDocente(pc) ? 'Doc.' : this.numero(pc), pc.etiqueta, TEXTOS_ESTADO_PC[pc.estado], CONEXIONES[this.conexion(pc)].texto,
        pc.procesador, pc.ram, pc.almacenamiento, this.agente.numeroSerie(pc.id),
      ]),
    };
  }

  /** Prendida, apagada o sin agente */
  protected conexion(pc: AmbientePc): ConexionPc {
    return this.agente.conexion(pc.id);
  }

  constructor() {
    void this.cargarSolicitudes();
    // Mientras el croquis está abierto, el estado de las PCs se refresca solo
    this.agente.activar();
    inject(DestroyRef).onDestroy(() => this.agente.desactivar());
  }

  private async cargarSolicitudes(): Promise<void> {
    try {
      this.bajaPendiente.set(new Set((await this.operacion.solicitudesBaja()).map((s) => s.pc_id)));
    } catch {
      this.bajaPendiente.set(new Set());
    }
  }

  /** ¿Se puede marcar en un ticket? Activas; en un correctivo, todas (también las de baja, para repararlas) */
  protected seleccionable(pc: AmbientePc): boolean {
    return pc.estado === 'operativa' || this.permitirNoActivas();
  }

  /** Cambiar el estado: personal de operación */
  protected puedeCambiar(): boolean {
    return this.auth.puedeOperar();
  }

  /** Dar de baja (o reactivar una dada de baja): todo el personal de operación */
  protected puedeDarDeBaja(): boolean {
    return this.auth.puedeOperar();
  }

  /** "SCPC107" -> "07" */
  protected numero(pc: AmbientePc): string {
    return pc.etiqueta.match(/(\d{2})$/)?.[1] ?? pc.etiqueta;
  }

  protected caracteristicas(pc: AmbientePc): string {
    return [pc.procesador, pc.ram, pc.almacenamiento].filter(Boolean).join(' · ');
  }

  protected marcada(pc: AmbientePc): boolean {
    if (this.modo() === 'seleccion') return this.seleccion().includes(pc.id);
    if (this.multiple()) return this.marcadas().includes(pc.id);
    return this.activa()?.id === pc.id;
  }

  protected tocar(pc: AmbientePc): void {
    if (this.modo() === 'seleccion') {
      const actual = this.seleccion();
      // Desmarcar siempre se puede; marcar, solo PCs activas
      if (actual.includes(pc.id)) {
        this.emitir(actual.filter((id) => id !== pc.id));
        return;
      }
      if (this.seleccionable(pc)) {
        this.emitir([...actual, pc.id]);
        return;
      }
      void this.activarYMarcar(pc);
      return;
    }
    if (this.multiple()) {
      this.marcadas.update((m) => (m.includes(pc.id) ? m.filter((id) => id !== pc.id) : [...m, pc.id]));
      return;
    }
    this.activa.set(this.activa()?.id === pc.id ? null : pc);
  }

  protected emitir(ids: number[]): void {
    this.seleccionChange.emit(ids);
  }

  protected todas(): void {
    this.emitir(this.activas().map((pc) => pc.id));
  }

  /** PC en mantenimiento o inactiva: se ofrece pasarla a Activa y marcarla */
  private async activarYMarcar(pc: AmbientePc): Promise<void> {
    if (pc.estado === 'baja') {
      this.notificaciones.aviso(`${pc.etiqueta} está de baja: no se le pueden registrar tickets.`);
      return;
    }
    // Pasa a Activa (pide qué se reparó) y luego la marca en el ticket
    this.pedirCambio([pc], 'operativa', () => this.emitir([...this.seleccion(), pc.id]));
  }

  /** Todo cambio de estado abre la ficha de reparación de cada PC */
  protected pedirCambio(pcs: AmbientePc[], estado: EstadoPc, despues?: () => void): void {
    if (!this.puedeCambiar() || !pcs.length) return;
    this.porCambiar.set({ pcs, estado, despues });
  }

  /** Guarda las fichas: un correctivo por PC con su cambio de estado */
  protected async confirmarCambio(): Promise<void> {
    const c = this.porCambiar();
    const fichas = this.fichas();
    if (!c || !fichas) return;
    const aviso = fichas.validar();
    if (aviso) {
      this.notificaciones.aviso(aviso);
      return;
    }
    this.guardando.set(true);
    try {
      const datos = fichas.datos();
      await this.operacion.registrarReparaciones(datos);
      await Promise.all([this.catalogos.recargar('ambiente_pcs'), this.cargarSolicitudes()]);
      this.activa.set(null);
      this.marcadas.set([]);
      this.porCambiar.set(null);
      const bajas = datos.filter((x) => x.estado_final === 'baja').length;
      this.notificaciones.exito(`${datos.length === 1 ? c.pcs[0].etiqueta : datos.length + ' PCs'}: ficha guardada como correctivo.${bajas ? ' La baja saldrá en tu cierre de turno.' : ''}`);
      c.despues?.();
    } catch (e) {
      this.notificaciones.error(e, 'No se guardó');
    } finally {
      this.guardando.set(false);
    }
  }

  protected alternarMultiple(): void {
    this.multiple.update((m) => !m);
    this.marcadas.set([]);
    this.activa.set(null);
  }

  protected cambiarMarcadas(estado: EstadoPc): void {
    const ids = new Set(this.marcadas());
    this.pedirCambio(this.todasLasPcs().filter((pc) => ids.has(pc.id)), estado);
  }
}
