import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { IconoComponent } from '../../compartido/icono.component';
import { OcupacionDetalleComponent } from '../../compartido/ocupacion-detalle.component';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import {
  aMinutos, DIAS_CORTOS, diaIso, fechaActual, fechaCorta, hhmm, horaActual, rangoFechas, seSolapan, sumarDias,
} from '../../core/fechas';
import { Ambiente, BloqueHorario, Ocupacion } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { OcupacionService } from '../../core/ocupacion.service';
import { PanelesService } from '../../core/paneles.service';

/**
 * Inicio (vista Semana): horario tipo colegio de un laboratorio.
 * - Filas = bloques horarios, columnas = Lunes a Sábado.
 * - Celda ocupada: clase/cesión/evento (clic = detalle para editar/ceder).
 * - Celda vacía: botón "+" para asignar ahí (lab + día + hora precargados).
 */
@Component({
  selector: 'app-panel-semana',
  imports: [FormsModule, IconoComponent, OcupacionDetalleComponent],
  template: `
    <!-- Barra de control -->
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <!-- Selector de laboratorio -->
      <div class="flex items-center gap-2">
        <button class="btn-fantasma btn-sm" (click)="moverLab(-1)" aria-label="Laboratorio anterior"><app-icono nombre="anterior" [tamano]="16" /></button>
        <div>
          <select class="campo !w-48 !py-1.5 font-semibold" [ngModel]="ambienteId()" (ngModelChange)="ambienteId.set(+$event)">
            @for (a of laboratorios(); track a.id) { <option [ngValue]="a.id">{{ a.codigo }}{{ a.nombre ? ' · ' + a.nombre : '' }}</option> }
          </select>
          @if (lab(); as a) {
            <p class="mt-0.5 flex flex-wrap gap-x-3 pl-1 text-xs text-slate-500">
              <span class="inline-flex items-center gap-1"><app-icono nombre="usuarios" [tamano]="11" /> {{ a.capacidad }} puestos</span>
              @if (totalPcs()) { <span class="inline-flex items-center gap-1"><app-icono nombre="equipo" [tamano]="11" /> {{ pcsOperativas() }}/{{ totalPcs() }} PCs</span> }
              @if (a.estado === 'mantenimiento') { <span class="font-medium text-amber-700">En mantenimiento</span> }
            </p>
          }
        </div>
        <button class="btn-fantasma btn-sm" (click)="moverLab(1)" aria-label="Laboratorio siguiente"><app-icono nombre="siguiente" [tamano]="16" /></button>
      </div>

      <!-- Navegación de semana -->
      <div class="flex items-center gap-2">
        @if (lunes() !== lunesHoy) { <button class="btn-secundario btn-sm" (click)="estaSemana()">Esta semana</button> }
        <button class="btn-fantasma btn-sm" (click)="moverSemana(-7)" aria-label="Semana anterior"><app-icono nombre="anterior" [tamano]="16" /></button>
        <span class="text-sm font-semibold tabular-nums">{{ fechaCorta(lunes()) }} – {{ fechaCorta(sumarDias(lunes(), 5)) }}</span>
        <button class="btn-fantasma btn-sm" (click)="moverSemana(7)" aria-label="Semana siguiente"><app-icono nombre="siguiente" [tamano]="16" /></button>
      </div>
    </div>

    <!-- Horario -->
    <div class="tarjeta overflow-x-auto">
      <table class="w-full min-w-[720px] table-fixed border-collapse">
        <thead>
          <tr>
            <th class="w-24 border-b border-slate-200 bg-slate-50 px-2 py-2 text-left text-xs font-semibold text-slate-500">Bloque</th>
            @for (d of dias(); track d) {
              <th class="border-b border-l border-slate-200 px-1 py-2 text-xs font-semibold"
                  [class]="d === hoy ? 'bg-marca-50 text-marca-700' : 'bg-slate-50 text-slate-500'">
                {{ diasCortos[diaIso(d)] }} {{ fechaCorta(d) }}
                @if (esFeriado(d)) { <span class="mt-0.5 block text-[10px] font-normal text-orange-600">Feriado</span> }
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @for (b of bloques(); track b.id) {
            <tr>
              <td class="border-b border-slate-100 px-2 py-1.5 align-top">
                <span class="block text-xs font-semibold text-slate-700">{{ b.nombre }}</span>
                <span class="text-[10px] text-slate-400 tabular-nums">{{ hhmm(b.hora_inicio) }}–{{ hhmm(b.hora_fin) }}</span>
              </td>
              @for (d of dias(); track d) {
                <td class="border-b border-l border-slate-100 p-1 align-top" [class.bg-marca-50/30]="d === hoy">
                  @for (o of ocupacionesEn(d, b); track o.clave) {
                    <button class="mb-1 block w-full overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left leading-tight transition hover:shadow-sm"
                            [style.border-left-color]="colorOcupacion(o)" [style.background]="colorOcupacion(o) + '1f'" (click)="seleccionada.set(o)"
                            [title]="o.titulo + ' · ' + o.detalle">
                      <span class="block truncate text-xs font-semibold text-slate-800">{{ o.titulo }}</span>
                      <span class="block truncate text-[10px] text-slate-500 tabular-nums">{{ hhmm(o.hora_inicio) }}–{{ hhmm(o.hora_fin) }}</span>
                      @if (textoSecundario(o); as t) { <span class="block truncate text-[10px] text-slate-500">{{ t }}</span> }
                    </button>
                  } @empty {
                    @if (puedeAsignar(d, b)) {
                      <button class="flex h-11 w-full items-center justify-center rounded-md text-slate-300 transition hover:bg-emerald-50 hover:text-emerald-600"
                              (click)="asignar(d, b)" [title]="'Asignar una clase el ' + fechaCorta(d) + ' en ' + b.nombre">
                        <app-icono nombre="agregar" [tamano]="16" />
                      </button>
                    } @else {
                      <span class="flex h-11 items-center justify-center text-[10px]" [class]="esPasada(d, b) ? 'text-slate-300' : 'text-emerald-600'">
                        {{ esPasada(d, b) ? '—' : 'Libre' }}
                      </span>
                    }
                  }
                </td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
    @if (cargando()) { <p class="mt-2 text-xs text-slate-500">Cargando…</p> }

    <app-ocupacion-detalle [ocupacion]="seleccionada()" (cerrar)="seleccionada.set(null)" (cambio)="cargar()" />
  `,
})
export class PanelSemanaComponent {
  protected readonly auth = inject(AuthService);
  protected readonly catalogos = inject(CatalogosService);
  private readonly paneles = inject(PanelesService);
  private readonly ocupacionServicio = inject(OcupacionService);
  private readonly notificaciones = inject(NotificacionesService);

  protected readonly hhmm = hhmm;
  protected readonly fechaCorta = fechaCorta;
  protected readonly sumarDias = sumarDias;
  protected readonly diaIso = diaIso;
  protected readonly diasCortos = DIAS_CORTOS;
  protected readonly hoy = fechaActual(environment.zonaHoraria);
  protected readonly lunesHoy = sumarDias(this.hoy, -(diaIso(this.hoy) - 1));
  private readonly ahora = aMinutos(horaActual(environment.zonaHoraria));

  protected readonly laboratorios = computed(() => this.catalogos.laboratorios());
  protected readonly ambienteId = signal<number>(0);
  protected readonly lunes = signal(this.lunesHoy);
  protected readonly ocupaciones = signal<Ocupacion[]>([]);
  protected readonly cargando = signal(false);
  protected readonly seleccionada = signal<Ocupacion | null>(null);

  protected readonly lab = computed(() => this.catalogos.mapaAmbientes().get(this.ambienteId()));
  protected readonly bloques = computed(() => this.catalogos.bloques());
  protected readonly dias = computed(() => rangoFechas(this.lunes(), sumarDias(this.lunes(), 5)));
  private readonly pcs = computed(() => this.catalogos.pcsPorAmbiente().get(this.ambienteId()) ?? []);
  protected readonly totalPcs = computed(() => this.pcs().length);
  protected readonly pcsOperativas = computed(() => this.pcs().filter((pc) => pc.estado === 'operativa').length);

  constructor() {
    // Primer laboratorio por defecto (y si el elegido desaparece)
    effect(() => {
      const labs = this.laboratorios();
      untracked(() => {
        if (labs.length && !labs.some((a) => a.id === this.ambienteId())) this.ambienteId.set(labs[0].id);
      });
    });
    // Recarga al cambiar de lab, de semana, o cuando se guarda algo
    effect(() => {
      this.ambienteId();
      this.lunes();
      this.paneles.cambios();
      untracked(() => void this.cargar());
    });
  }

  async cargar(): Promise<void> {
    if (!this.ambienteId()) return;
    this.cargando.set(true);
    try {
      const datos = await this.ocupacionServicio.ocupaciones(this.lunes(), sumarDias(this.lunes(), 5));
      this.ocupaciones.set(datos.filter((o) => o.ambiente_id === this.ambienteId()));
    } catch (e) {
      this.notificaciones.error(e, 'No se pudo cargar el horario');
    } finally {
      this.cargando.set(false);
    }
  }

  protected moverLab(delta: number): void {
    const labs = this.laboratorios();
    const i = labs.findIndex((a) => a.id === this.ambienteId());
    const siguiente = labs[(i + delta + labs.length) % labs.length];
    if (siguiente) this.ambienteId.set(siguiente.id);
  }

  protected moverSemana(dias: number): void {
    this.lunes.set(sumarDias(this.lunes(), dias));
  }

  protected estaSemana(): void {
    this.lunes.set(this.lunesHoy);
  }

  protected esFeriado(fecha: string): boolean {
    return this.catalogos.conjuntoFeriados().has(fecha);
  }

  protected ocupacionesEn(fecha: string, b: BloqueHorario): Ocupacion[] {
    return this.ocupaciones().filter((o) => o.fecha === fecha && seSolapan(o.hora_inicio, o.hora_fin, b.hora_inicio, b.hora_fin));
  }

  protected colorOcupacion(o: Ocupacion): string {
    if (o.origen === 'reserva') return '#ea580c';
    if (o.origen === 'cesion') return '#9333ea';
    return o.estado === 'reubicada' ? '#6b7fd6' : '#3a5bc4';
  }

  /** Segunda línea del bloque (docente de la clase, o a quién se cedió) */
  protected textoSecundario(o: Ocupacion): string {
    const partes = o.detalle.split(' · ');
    if (o.origen === 'cesion') return `Cedido a ${partes[0]}`;
    if (o.origen === 'reserva') return partes[0] ?? '';
    return partes[0] ?? '';
  }

  /** ¿Ese bloque de ese día ya pasó? */
  protected esPasada(fecha: string, b: BloqueHorario): boolean {
    if (fecha < this.hoy) return true;
    return fecha === this.hoy && aMinutos(b.hora_fin) <= this.ahora;
  }

  protected puedeAsignar(fecha: string, b: BloqueHorario): boolean {
    return this.auth.puedeEditar() && this.lab()?.estado === 'activo' && !this.esPasada(fecha, b);
  }

  protected asignar(fecha: string, b: BloqueHorario): void {
    this.paneles.abrirAsignacion(null, {
      ambienteId: this.ambienteId(), fecha,
      horaInicio: hhmm(b.hora_inicio), horaFin: hhmm(b.hora_fin),
    });
  }
}
