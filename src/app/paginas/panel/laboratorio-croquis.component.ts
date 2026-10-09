import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FichasReparacionComponent } from '../../compartido/fichas-reparacion.component';
import { IconoComponent } from '../../compartido/icono.component';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { AmbientePc, EstadoPc } from '../../core/modelos';
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
  imports: [IconoComponent, NgTemplateOutlet, DatePipe, FichasReparacionComponent],
  template: `
    <div>
      <!-- Barra: leyenda + acciones -->
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          @for (o of opciones; track o.estado) {
            <span class="inline-flex items-center gap-1">
              <span class="h-2.5 w-2.5 rounded-sm" [class]="estados[o.estado].punto"></span>
              {{ estados[o.estado].texto }} <b class="text-slate-700">{{ cuenta()[o.estado] }}</b>
            </span>
          }
        </div>
        @if (maquinas().length || docente()) {
          <div class="flex gap-1.5">
            @if (modo() === 'seleccion') {
              <button type="button" class="btn-secundario btn-sm" (click)="todas()">Todas las activas ({{ activas().length }})</button>
              <button type="button" class="btn-secundario btn-sm" (click)="emitir([])" [disabled]="!seleccion().length">Limpiar</button>
            } @else if (puedeCambiar()) {
              <button type="button" class="btn-sm" [class]="multiple() ? 'btn-primario' : 'btn-secundario'" (click)="alternarMultiple()"
                      title="Marcar varias PCs y cambiarles el estado juntas">
                <app-icono nombre="capas" [tamano]="14" /> {{ multiple() ? 'Terminar selección' : 'Cambiar varias' }}
              </button>
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
    </div>

    <!-- Una PC dibujada como monitor -->
    <ng-template #monitor let-pc let-docente="docente">
      <button type="button"
              class="group relative flex w-full flex-col items-center gap-0.5 rounded-md border px-0.5 py-1 text-left transition sm:flex-row sm:gap-1.5 sm:px-1.5"
              [class]="marcada(pc) ? 'border-marca-500 bg-marca-50 ring-2 ring-marca-500' : 'border-transparent hover:border-slate-300 hover:bg-slate-100'"
              [class.cursor-default]="false"
              [class.opacity-50]="modo() === 'seleccion' && !seleccionable(pc) && !marcada(pc)"
              [class.cursor-not-allowed]="modo() === 'seleccion' && pc.estado === 'baja'"
              (click)="tocar(pc)" [title]="pc.etiqueta + ' · ' + info(pc).texto">
        <!-- pantalla -->
        <span class="relative flex h-6 w-8 shrink-0 items-center justify-center rounded-[3px] border-2 text-white sm:h-7 sm:w-9" [class]="info(pc).pantalla">
          @if (info(pc).icono; as ic) { <app-icono [nombre]="ic" [tamano]="13" [grosor]="2.5" /> }
          <span class="absolute -bottom-[5px] left-1/2 h-[3px] w-3 -translate-x-1/2 rounded-sm bg-slate-400"></span>
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

  readonly ambienteId = input.required<number>();
  readonly modo = input<'estado' | 'seleccion'>('estado');
  /** PCs marcadas (modo selección) */
  readonly seleccion = input<number[]>([]);
  readonly seleccionChange = output<number[]>();
  /** Selección para un correctivo: también PCs en mantenimiento o inactivas */
  readonly permitirNoActivas = input(false);

  protected readonly estados = ESTADOS;
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

  /** Color, ícono y texto del estado de la PC */
  protected info(pc: AmbientePc) {
    return ESTADOS[pc.estado];
  }

  constructor() {
    void this.cargarSolicitudes();
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
