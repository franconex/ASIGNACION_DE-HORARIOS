import { Component, computed, effect, HostListener, inject, OnDestroy, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { IconoComponent } from '../../compartido/icono.component';
import { ModalComponent } from '../../compartido/modal.component';
import { OcupacionDetalleComponent } from '../../compartido/ocupacion-detalle.component';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import {
  aIso, aMinutos, DIAS_CORTOS, DIAS_SEMANA, deIso, diaIso, fechaActual, fechaLarga, hhmm, horaActual, MESES, rangoFechas, sumarDias,
} from '../../core/fechas';
import { Ambiente, Ocupacion } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { OcupacionService } from '../../core/ocupacion.service';
import { PanelesService } from '../../core/paneles.service';
import { TemaService } from '../../core/tema.service';

/** Horario visible del día (la universidad trabaja de 07:00 a 22:00) */
const INICIO_DIA = 7 * 60;
const FIN_DIA = 22 * 60;
/** Píxeles por minuto en la grilla (60 px por hora) */
const PX_MINUTO = 1.25;
/** Las selecciones se ajustan a cuartos de hora */
const PASO = 15;
/** Con el dedo: tiempo que hay que mantener presionado para empezar a seleccionar */
const ESPERA_TACTIL = 350;
/** Con el dedo: cuánto puede moverse antes de considerarse un desplazamiento */
const TOLERANCIA_TACTIL = 10;

/** Celda del calendario mensual */
interface DiaMes {
  fecha: string;
  numero: number;
  delMes: boolean;
  especial: boolean;
}

/** Tramo de un laboratorio (selección o espacio libre) */
interface Tramo {
  ambienteId: number;
  inicio: number;
  fin: number;
}

/**
 * Inicio (vista Día): el día completo en una sola grilla.
 * - Columnas = laboratorios, filas = horas (07:00–22:00).
 * - Se ve todo lo agendado (clases con materia y docente, cesiones, eventos).
 * - Arrastrar (o tocar) sobre un espacio libre abre "asignar clase / evento".
 * - Shift + clic extiende la selección hasta esa hora.
 * - Clic en el nombre de un laboratorio: su semana, ceder, asignar.
 * - Calendario para cambiar de día y "¿libre a qué hora?" para comparar.
 */
@Component({
  selector: 'app-panel-dia',
  imports: [FormsModule, IconoComponent, OcupacionDetalleComponent, ModalComponent],
  template: `
    <div class="flex flex-col gap-5 xl:flex-row">
      <!-- Columna de control -->
      <aside class="grid w-full shrink-0 gap-4 sm:grid-cols-2 xl:sticky xl:top-0 xl:flex xl:w-64 xl:flex-col xl:self-start">
        <!-- Calendario del mes -->
        <section class="tarjeta p-3">
          <div class="mb-1 flex items-center justify-between">
            <button class="btn-fantasma btn-sm" (click)="moverMes(-1)" aria-label="Mes anterior"><app-icono nombre="anterior" [tamano]="16" /></button>
            <span class="text-sm font-semibold">{{ tituloMes() }}</span>
            <button class="btn-fantasma btn-sm" (click)="moverMes(1)" aria-label="Mes siguiente"><app-icono nombre="siguiente" [tamano]="16" /></button>
          </div>
          <div class="grid grid-cols-7 text-center text-[11px] text-slate-400">
            @for (d of [1,2,3,4,5,6,7]; track d) { <span>{{ diasCortos[d][0] }}</span> }
          </div>
          <div class="grid grid-cols-7 gap-px">
            @for (d of diasDelMes(); track d.fecha) {
              <button class="relative h-8 rounded text-sm tabular-nums transition" [class]="claseDia(d)" (click)="irAFecha(d.fecha)"
                      [disabled]="!d.delMes" [attr.aria-label]="d.fecha" [attr.aria-pressed]="d.fecha === fecha()"
                      [title]="catalogos.motivoNoLaborable(d.fecha) ?? ''">
                {{ d.delMes ? d.numero : '' }}
                @if (d.especial && d.delMes) {
                  <span class="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full" [class]="d.fecha === fecha() ? 'bg-white' : 'bg-orange-500'"></span>
                }
              </button>
            }
          </div>
          <div class="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span class="flex items-center gap-2">
              <span class="flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-orange-500"></span> Evento o cesión</span>
              <span class="flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-sm bg-red-100 ring-1 ring-red-300"></span> Feriado</span>
            </span>
            @if (fecha() !== hoy()) { <button class="font-medium text-marca-700 hover:underline" (click)="irAFecha(hoy())">Ir a hoy</button> }
          </div>
        </section>

        <div class="flex flex-col gap-4">
          <!-- ¿Libre a qué hora? -->
          <section class="tarjeta p-3">
            <h2 class="mb-2 text-sm font-semibold">¿Libre a qué hora?</h2>
            <div class="flex flex-wrap gap-1.5">
              <button class="rounded-md border px-2 py-1 text-sm" [class]="hora() === null ? 'border-marca-600 bg-marca-600 text-white' : 'border-slate-200 hover:border-slate-300'"
                      (click)="hora.set(null)">Todo el día</button>
              @if (esHoy()) {
                <button class="rounded-md border px-2 py-1 text-sm" [class]="hora() === horaAhora() ? 'border-marca-600 bg-marca-600 text-white' : 'border-slate-200 hover:border-slate-300'"
                        (click)="hora.set(horaAhora())">Ahora</button>
              }
              @for (b of catalogos.bloques(); track b.id) {
                <button class="rounded-md border px-2 py-1 text-sm tabular-nums" [title]="b.nombre"
                        [class]="hora() === hhmm(b.hora_inicio) ? 'border-marca-600 bg-marca-600 text-white' : 'border-slate-200 hover:border-slate-300'"
                        (click)="hora.set(hhmm(b.hora_inicio))">{{ hhmm(b.hora_inicio) }}</button>
              }
            </div>
            <label class="mt-3 flex items-center gap-2 text-sm text-slate-600">
              Otra hora
              <input type="time" class="campo !w-28 !py-1" [ngModel]="hora() ?? ''" (ngModelChange)="hora.set($event || null)" min="07:00" max="22:00">
            </label>
          </section>

          <!-- Leyenda -->
          <section class="tarjeta p-3">
            <ul class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600 xl:grid-cols-1">
              <li class="flex items-center gap-2"><span class="h-2.5 w-4 rounded-sm" style="background: #3a5bc4"></span> Clase</li>
              <li class="flex items-center gap-2"><span class="h-2.5 w-4 rounded-sm" style="background: #9333ea"></span> Cedido a otro docente</li>
              <li class="flex items-center gap-2"><span class="h-2.5 w-4 rounded-sm" style="background: #ea580c"></span> Evento o defensa</li>
              <li class="flex items-center gap-2"><span class="h-2.5 w-4 rounded-sm bg-slate-200"></span> Hora pasada</li>
            </ul>
          </section>
        </div>
      </aside>

      <!-- Día -->
      <section class="min-w-0 flex-1">
        <header class="mb-3">
          <h1 class="text-2xl font-semibold tracking-tight">{{ tituloDia() }}</h1>
          @if (noLaborable(); as motivo) {
            <p class="mt-1 inline-flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-sm font-medium text-red-700">
              <app-icono nombre="suspender" [tamano]="15" /> {{ motivo }}. No se asignan clases ni eventos este día.
            </p>
          }
          <p class="mt-0.5 text-slate-600">
            @if (cargando()) { Cargando… }
            @else if (hora()) {
              <b class="text-emerald-700">{{ libresALaHora() }}</b> de {{ laboratorios().length }} laboratorios libres a las {{ hora() }}.
            } @else {
              <b class="text-emerald-700">{{ sinUso() }}</b> de {{ laboratorios().length }} laboratorios sin nada agendado.
            }
            @if (auth.puedeEditar() && !esPasado() && !noLaborable()) {
              <span class="text-slate-500">{{ tactil ? 'Toque, o mantenga presionado y deslice,' : 'Arrastre' }} para asignar; sobre una clase podrá crear un evento (reubica al docente).</span>
            }
            @if (totalConflictos()) {
              <span class="ml-1 inline-flex items-center gap-1 rounded bg-red-50 px-1.5 text-sm text-red-700">
                <app-icono nombre="alerta" [tamano]="13" /> {{ totalConflictos() }} conflicto(s): revise Registros
              </span>
            }
          </p>
        </header>

        <!-- Grilla: laboratorios arriba, horas a la izquierda -->
        <div class="tarjeta max-h-[calc(100dvh-9rem)] overflow-auto overscroll-contain">
          <div class="grid min-w-max" [style.grid-template-columns]="columnasGrilla()">
            <!-- Encabezado -->
            <div class="sticky top-0 left-0 z-30 border-b border-slate-200 bg-superficie"></div>
            @for (a of laboratorios(); track a.id) {
              <button class="sticky top-0 z-20 border-b border-l border-slate-200 bg-superficie px-2 py-2 text-left hover:bg-slate-50"
                      (click)="abrirLaboratorio(a)" [title]="'Ver la semana de ' + a.codigo + ', ceder o asignar'">
                <span class="flex items-center gap-1.5 font-semibold">
                  <span class="h-2 w-2 shrink-0 rounded-full" [style.background]="a.color"></span>{{ a.codigo }}
                </span>
                <span class="mt-0.5 block truncate text-[13px]" [class]="claseEstado(a)">{{ textoEstado(a) }}</span>
              </button>
            }

            <!-- Columna de horas -->
            <div class="sticky left-0 z-10 border-r border-slate-200 bg-superficie" [style.height.px]="altoGrilla">
              @for (h of horas; track h; let primera = $first; let ultima = $last) {
                <span class="absolute right-2 text-xs text-slate-500 tabular-nums"
                      [class]="primera ? 'translate-y-0.5' : ultima ? '-translate-y-full' : '-translate-y-1/2'"
                      [style.top.px]="(h - inicioDia) * px">{{ etiquetaHora(h) }}</span>
              }
            </div>

            <!-- Columnas de laboratorios -->
            @for (a of laboratorios(); track a.id) {
              <div class="relative touch-pan-x touch-pan-y border-l border-slate-200 select-none [-webkit-touch-callout:none]" [style.height.px]="altoGrilla"
                   [style.background-image]="fondoHoras" [style.background-size]="'100% ' + 60 * px + 'px'"
                   [class.cursor-crosshair]="puedeSeleccionar(a)" (pointerdown)="iniciarSeleccion($event, a)" (contextmenu)="puedeSeleccionar(a) && $event.preventDefault()">
                <!-- Horas pasadas -->
                @if (minutosPasados() > inicioDia) {
                  <div class="pointer-events-none absolute inset-x-0 top-0 bg-slate-100/80" [style.height.px]="(minutosPasados() - inicioDia) * px"></div>
                }
                @if (noLaborable()) {
                  <div class="pointer-events-none absolute inset-0 bg-slate-100/60"></div>
                }
                @if (a.estado === 'mantenimiento') {
                  <div class="pointer-events-none absolute inset-0 flex items-start justify-center bg-slate-100/80 pt-8 text-xs text-slate-500">En mantenimiento</div>
                }

                <!-- Ocupaciones -->
                @for (o of ocupacionesDe(a.id); track o.clave) {
                  <button class="absolute inset-x-1 overflow-hidden rounded-md border-l-[3px] px-2 py-1 text-left text-[13px] leading-snug transition hover:z-10 hover:shadow-md"
                          [style.top.px]="(aMinutos(o.hora_inicio) - inicioDia) * px + 1"
                          [style.height.px]="(aMinutos(o.hora_fin) - aMinutos(o.hora_inicio)) * px - 2"
                          [style.border-left-color]="colorOcupacion(o)" [style.background]="colorOcupacion(o) + (tema.modo() === 'oscuro' ? '3a' : '1c')"
                          (pointerdown)="$event.stopPropagation()" (click)="seleccionada.set(o)"
                          [title]="hhmm(o.hora_inicio) + '–' + hhmm(o.hora_fin) + '\\n' + lineasOcupacion(o).join('\\n')">
                    <span class="block font-medium tabular-nums text-slate-500">{{ hhmm(o.hora_inicio) }}–{{ hhmm(o.hora_fin) }}</span>
                    @for (linea of lineasOcupacion(o); track $index; let primera = $first) {
                      <span class="block truncate" [class]="primera ? 'font-semibold text-slate-800' : 'text-slate-600'">{{ linea }}</span>
                    }
                  </button>
                }

                <!-- Selección en curso -->
                @if (seleccion(); as s) {
                  @if (s.ambienteId === a.id) {
                    <div class="pointer-events-none absolute inset-x-1 z-10 flex items-center justify-center rounded-md border-2 border-dashed text-sm font-semibold tabular-nums"
                         [class]="seleccionPisaClase() ? 'border-amber-500 bg-amber-100/80 text-amber-900' : 'border-emerald-600 bg-emerald-100/80 text-emerald-800'"
                         [style.top.px]="(s.inicio - inicioDia) * px" [style.height.px]="(s.fin - s.inicio) * px">
                      {{ etiquetaMinutos(s.inicio) }}–{{ etiquetaMinutos(s.fin) }}
                    </div>
                  }
                }

                <!-- Hora consultada y hora actual -->
                @if (hora(); as h) {
                  <div class="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-slate-900" [style.top.px]="(aMinutos(h) - inicioDia) * px"></div>
                }
                @if (esHoy() && minutosAhora() > inicioDia && minutosAhora() < finDia) {
                  <div class="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-red-500" [style.top.px]="(minutosAhora() - inicioDia) * px"></div>
                }
              </div>
            }
          </div>
        </div>
      </section>
    </div>

    <app-ocupacion-detalle [ocupacion]="seleccionada()" (cerrar)="seleccionada.set(null)" (cambio)="cargar()" />

    <!-- ¿Qué registrar en el tramo elegido? -->
    <app-modal [abierto]="!!porRegistrar()" titulo="Registrar en este horario" ancho="sm" (cerrar)="cerrarRegistrar()">
      @if (porRegistrar(); as s) {
        <p class="mb-4 text-slate-700">
          <b>{{ catalogos.codigoAmbiente(s.ambienteId) }}</b>, <span class="capitalize">{{ fechaLarga(fecha()) }}</span>,
          de <b class="tabular-nums">{{ etiquetaMinutos(s.inicio) }}</b> a <b class="tabular-nums">{{ etiquetaMinutos(s.fin) }}</b>.
        </p>
        @if (soloEvento()) {
          <p class="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <app-icono nombre="alerta" [tamano]="16" />
            Ese horario tiene clase. Como el evento tiene prioridad, al continuar podrás <b>mover al docente a otro laboratorio o aula</b> (o suspender su clase ese día).
          </p>
          <button class="btn-primario w-full justify-start" (click)="registrar('evento')"><app-icono nombre="evento" [tamano]="16" /> Crear evento o defensa aquí</button>
        } @else {
          <div class="grid gap-2">
            <button class="btn-primario justify-start" (click)="registrar('clase')"><app-icono nombre="nuevaClase" [tamano]="16" /> Asignar una clase</button>
            <button class="btn-secundario justify-start" (click)="registrar('evento')"><app-icono nombre="evento" [tamano]="16" /> Evento o defensa</button>
          </div>
        }
      }
    </app-modal>
  `,
})
export class PanelDiaComponent implements OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly catalogos = inject(CatalogosService);
  protected readonly paneles = inject(PanelesService);
  protected readonly tema = inject(TemaService);
  private readonly ocupacionServicio = inject(OcupacionService);
  private readonly notificaciones = inject(NotificacionesService);

  protected readonly hhmm = hhmm;
  protected readonly aMinutos = aMinutos;
  protected readonly fechaLarga = fechaLarga;
  protected readonly diasCortos = DIAS_CORTOS;
  protected readonly inicioDia = INICIO_DIA;
  protected readonly finDia = FIN_DIA;
  protected readonly px = PX_MINUTO;
  protected readonly altoGrilla = (FIN_DIA - INICIO_DIA) * PX_MINUTO;
  /** Horas que se rotulan a la izquierda */
  protected readonly horas = Array.from({ length: 16 }, (_, i) => INICIO_DIA + i * 60);
  /** Líneas de cada hora en el fondo de las columnas */
  protected readonly fondoHoras = 'linear-gradient(to bottom, var(--color-slate-200) 1px, transparent 1px)';
  /** En pantallas táctiles se toca en vez de arrastrar */
  protected readonly tactil = window.matchMedia?.('(pointer: coarse)').matches ?? false;

  protected readonly hoy = signal(fechaActual(environment.zonaHoraria));
  protected readonly horaAhora = signal(horaActual(environment.zonaHoraria));
  protected readonly fecha = signal(this.hoy());
  protected readonly mesVisible = signal(this.hoy().slice(0, 8) + '01');
  /** Hora consultada (null = todo el día) */
  protected readonly hora = signal<string | null>(null);
  protected readonly ocupaciones = signal<Ocupacion[]>([]);
  protected readonly diasEspeciales = signal<Set<string>>(new Set());
  protected readonly cargando = signal(false);
  protected readonly seleccionada = signal<Ocupacion | null>(null);
  protected readonly totalConflictos = signal(0);
  /** Selección que se está arrastrando */
  protected readonly seleccion = signal<Tramo | null>(null);
  /** Selección terminada, esperando qué registrar */
  protected readonly porRegistrar = signal<Tramo | null>(null);
  /** El tramo elegido pisa una o más clases: solo se puede crear un evento (reubica) */
  protected readonly soloEvento = signal(false);

  /**
   * movio: la selección se extendió más allá del minuto inicial.
   * activo: con el dedo, ya se mantuvo presionado y se está seleccionando (no desplazando).
   */
  private arrastre: {
    columna: HTMLElement; ambiente: Ambiente; origen: number; movio: boolean;
    activo: boolean; x: number; y: number; espera?: ReturnType<typeof setTimeout>;
  } | null = null;

  /** Mientras se selecciona con el dedo, la grilla no debe desplazarse */
  private readonly bloquearDesplazamiento = (evento: TouchEvent): void => {
    if (this.arrastre?.activo) evento.preventDefault();
  };

  private readonly temporizador = setInterval(() => {
    this.horaAhora.set(horaActual(environment.zonaHoraria));
    this.hoy.set(fechaActual(environment.zonaHoraria));
  }, 30_000);

  protected readonly esHoy = computed(() => this.fecha() === this.hoy());
  /** Feriado o domingo: el día se ve, pero no se puede asignar nada */
  protected readonly noLaborable = computed(() => this.catalogos.motivoNoLaborable(this.fecha()));
  protected readonly esPasado = computed(() => this.fecha() < this.hoy());
  protected readonly minutosAhora = computed(() => aMinutos(this.horaAhora()));
  /** Hasta qué minuto del día la grilla está en el pasado */
  protected readonly minutosPasados = computed(() => (this.esPasado() ? FIN_DIA : this.esHoy() ? Math.min(FIN_DIA, this.minutosAhora()) : 0));

  protected readonly laboratorios = computed(() => this.catalogos.laboratorios());
  protected readonly columnasGrilla = computed(() => `3.5rem repeat(${this.laboratorios().length}, minmax(10rem, 1fr))`);

  protected readonly tituloDia = computed(() => {
    const f = deIso(this.fecha());
    const texto = `${DIAS_SEMANA[diaIso(this.fecha())]} ${f.getDate()} de ${MESES[f.getMonth()].toLowerCase()}`;
    return this.esHoy() ? `Hoy, ${texto.toLowerCase()}` : texto;
  });

  protected readonly tituloMes = computed(() => {
    const f = deIso(this.mesVisible());
    return `${MESES[f.getMonth()]} ${f.getFullYear()}`;
  });

  protected readonly diasDelMes = computed<DiaMes[]>(() => {
    const primero = this.mesVisible();
    const mes = deIso(primero).getMonth();
    const inicio = sumarDias(primero, -(diaIso(primero) - 1));
    const especiales = this.diasEspeciales();
    const dias = rangoFechas(inicio, sumarDias(inicio, 41)).map((fecha) => ({
      fecha, numero: deIso(fecha).getDate(), delMes: deIso(fecha).getMonth() === mes, especial: especiales.has(fecha),
    }));
    return dias.slice(35).every((d) => !d.delMes) ? dias.slice(0, 35) : dias;
  });

  /** Ocupaciones del día por laboratorio, ordenadas por hora */
  private readonly porAmbiente = computed(() => {
    const mapa = new Map<number, Ocupacion[]>();
    for (const o of this.ocupaciones()) mapa.set(o.ambiente_id, [...(mapa.get(o.ambiente_id) ?? []), o]);
    mapa.forEach((lista) => lista.sort((x, y) => x.hora_inicio.localeCompare(y.hora_inicio)));
    return mapa;
  });

  protected readonly libresALaHora = computed(() => this.laboratorios().filter((a) => this.libreA(a)).length);
  protected readonly sinUso = computed(() => this.laboratorios().filter((a) => !this.ocupacionesDe(a.id).length).length);

  constructor() {
    document.addEventListener('touchmove', this.bloquearDesplazamiento, { passive: false });
    effect(() => {
      this.fecha();
      this.paneles.cambios();
      untracked(() => void this.cargar());
    });
    effect(() => {
      const mes = this.mesVisible();
      this.paneles.cambios();
      untracked(() => void this.cargarMes(mes));
    });
  }

  ngOnDestroy(): void {
    document.removeEventListener('touchmove', this.bloquearDesplazamiento);
    this.cancelarSeleccion();
    clearInterval(this.temporizador);
  }

  // ------------------------------------------------------------------
  // Carga de datos
  // ------------------------------------------------------------------

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.ocupaciones.set(await this.ocupacionServicio.ocupaciones(this.fecha(), this.fecha()));
      void this.contarConflictos();
    } catch (e) {
      this.notificaciones.error(e, 'No se pudo cargar la ocupación');
    } finally {
      this.cargando.set(false);
    }
  }

  private async cargarMes(primero: string): Promise<void> {
    const f = deIso(primero);
    const ultimo = aIso(new Date(f.getFullYear(), f.getMonth() + 1, 0));
    try {
      const datos = await this.ocupacionServicio.ocupaciones(primero, ultimo);
      this.diasEspeciales.set(new Set(datos.filter((o) => o.origen !== 'clase' || o.estado === 'reubicada').map((o) => o.fecha)));
    } catch {
      this.diasEspeciales.set(new Set());
    }
  }

  private async contarConflictos(): Promise<void> {
    try {
      this.totalConflictos.set((await this.ocupacionServicio.conflictos(this.hoy(), sumarDias(this.hoy(), 60))).length);
    } catch {
      this.totalConflictos.set(0);
    }
  }

  // ------------------------------------------------------------------
  // Navegación de días
  // ------------------------------------------------------------------

  protected irAFecha(fecha: string): void {
    this.fecha.set(fecha);
    if (fecha.slice(0, 8) + '01' !== this.mesVisible()) this.mesVisible.set(fecha.slice(0, 8) + '01');
    if (fecha !== this.hoy() && this.hora() === this.horaAhora()) this.hora.set(null);
  }

  protected moverMes(delta: number): void {
    const f = deIso(this.mesVisible());
    this.mesVisible.set(aIso(new Date(f.getFullYear(), f.getMonth() + delta, 1)));
  }

  protected claseDia(d: DiaMes): string {
    if (!d.delMes) return 'invisible';
    if (d.fecha === this.fecha()) return 'bg-marca-600 font-semibold text-white';
    if (this.catalogos.conjuntoFeriados().has(d.fecha)) return 'bg-red-50 font-medium text-red-400 line-through hover:bg-red-100';
    if (diaIso(d.fecha) === 7) return 'text-slate-300 hover:bg-slate-100';
    if (d.fecha === this.hoy()) return 'font-semibold text-marca-700 ring-1 ring-marca-300 ring-inset hover:bg-marca-50';
    return (d.fecha < this.hoy() ? 'text-slate-400' : 'text-slate-700') + ' hover:bg-slate-100';
  }

  // ------------------------------------------------------------------
  // Datos por laboratorio
  // ------------------------------------------------------------------

  protected ocupacionesDe(id: number): Ocupacion[] {
    return this.porAmbiente().get(id) ?? [];
  }

  private ocupacionA(a: Ambiente, minuto: number): Ocupacion | undefined {
    return this.ocupacionesDe(a.id).find((o) => aMinutos(o.hora_inicio) <= minuto && minuto < aMinutos(o.hora_fin));
  }

  private libreA(a: Ambiente): boolean {
    const h = this.hora();
    return a.estado === 'activo' && !!h && !this.ocupacionA(a, aMinutos(h));
  }

  /** Estado bajo el nombre del laboratorio */
  protected textoEstado(a: Ambiente): string {
    if (a.estado === 'mantenimiento') return 'Mantenimiento';
    const h = this.hora();
    if (h) {
      const o = this.ocupacionA(a, aMinutos(h));
      return o ? `Ocupado hasta ${hhmm(o.hora_fin)}` : `Libre a las ${h}`;
    }
    const n = this.ocupacionesDe(a.id).length;
    return n ? `${n} en agenda` : 'Libre todo el día';
  }

  protected claseEstado(a: Ambiente): string {
    if (a.estado === 'mantenimiento') return 'text-slate-500';
    if (this.hora()) return this.libreA(a) ? 'font-medium text-emerald-700' : 'text-slate-500';
    return this.ocupacionesDe(a.id).length ? 'text-slate-500' : 'font-medium text-emerald-700';
  }

  protected colorOcupacion(o: Ocupacion): string {
    if (o.origen === 'reserva') return '#ea580c';
    if (o.origen === 'cesion') return '#9333ea';
    return o.estado === 'reubicada' ? '#6b7fd6' : '#3a5bc4';
  }

  /**
   * Líneas de texto de cada bloque. En una cesión manda quien viene: su
   * materia y su nombre; al final, en pequeño, quién cedió y a qué aula se fue.
   */
  protected lineasOcupacion(o: Ocupacion): string[] {
    const partes = o.detalle.split(' · ');
    if (o.origen === 'cesion') {
      const receptor = partes[0];
      const cedente = (partes[1] ?? '').replace('cedido por ', '');
      const aula = cedente.match(/\(se va a (.+)\)$/)?.[1];
      const titular = cedente.replace(/\s*\(se va a .+\)$/, '');
      return [o.titulo, receptor, aula ? `Cedido por ${titular} (→ ${aula})` : `Cedido por ${titular}`];
    }
    if (o.origen === 'reserva') return [o.titulo, partes.slice(0, 2).join(', ')];
    return [o.titulo, partes[0], partes.slice(1).join(', ')].filter(Boolean);
  }

  protected etiquetaHora(minutos: number): string {
    return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:00`;
  }

  protected etiquetaMinutos(minutos: number): string {
    return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
  }

  protected abrirLaboratorio(a: Ambiente): void {
    this.paneles.abrirLaboratorio(a.id, this.fecha());
  }

  // ------------------------------------------------------------------
  // Selección de un tramo libre (arrastrar con mouse o tocar)
  // ------------------------------------------------------------------

  protected puedeSeleccionar(a: Ambiente): boolean {
    return this.auth.puedeEditar() && a.estado === 'activo' && !this.esPasado() && !this.noLaborable();
  }

  /** ¿La selección en curso pisa una clase? (se marca distinto: irá como evento) */
  protected seleccionPisaClase(): boolean {
    const s = this.seleccion();
    if (!s) return false;
    return this.ocupacionesDe(s.ambienteId).some((o) => o.origen !== 'reserva' && aMinutos(o.hora_inicio) < s.fin && s.inicio < aMinutos(o.hora_fin));
  }

  /** Minuto del día según la posición vertical del puntero, ajustado a 15 min */
  private minutoEn(evento: PointerEvent, columna: HTMLElement): number {
    const y = evento.clientY - columna.getBoundingClientRect().top;
    const minuto = INICIO_DIA + Math.floor(y / PX_MINUTO / PASO) * PASO;
    return Math.min(FIN_DIA - PASO, Math.max(INICIO_DIA, minuto));
  }

  protected iniciarSeleccion(evento: PointerEvent, a: Ambiente): void {
    if (!this.puedeSeleccionar(a) || evento.button !== 0) return;
    const columna = evento.currentTarget as HTMLElement;
    const minuto = this.minutoEn(evento, columna);
    // Shift + clic: extiende la selección actual de ese mismo lab hasta aquí
    const actual = this.seleccion();
    if (evento.shiftKey && actual && actual.ambienteId === a.id) {
      evento.preventDefault();
      const ancla = minuto >= actual.fin ? actual.inicio : actual.fin;
      this.seleccion.set({ ambienteId: a.id, inicio: Math.min(ancla, minuto), fin: Math.max(ancla, minuto + PASO) });
      this.arrastre = { columna, ambiente: a, origen: ancla, movio: true, activo: true, x: evento.clientX, y: evento.clientY };
      return;
    }
    const arrastre: NonNullable<typeof this.arrastre> = { columna, ambiente: a, origen: minuto, movio: false, activo: false, x: evento.clientX, y: evento.clientY };
    this.arrastre = arrastre;
    if (evento.pointerType === 'mouse') {
      evento.preventDefault();
      arrastre.activo = true;
      this.seleccion.set({ ambienteId: a.id, inicio: minuto, fin: minuto + PASO });
      return;
    }
    // Con el dedo: deslizar desplaza la grilla; mantener presionado empieza a seleccionar
    arrastre.espera = setTimeout(() => {
      if (this.arrastre !== arrastre) return;
      arrastre.activo = true;
      this.seleccion.set({ ambienteId: a.id, inicio: minuto, fin: minuto + PASO });
      navigator.vibrate?.(15);
    }, ESPERA_TACTIL);
  }

  @HostListener('document:pointermove', ['$event'])
  protected moverSeleccion(evento: PointerEvent): void {
    const arrastre = this.arrastre;
    if (!arrastre) return;
    if (!arrastre.activo) {
      // El dedo se movió antes de terminar la espera: es un desplazamiento, no una selección
      if (Math.hypot(evento.clientX - arrastre.x, evento.clientY - arrastre.y) > TOLERANCIA_TACTIL) this.cancelarSeleccion();
      return;
    }
    if (evento.pointerType !== 'mouse') this.desplazarEnBorde(evento, arrastre.columna);
    const minuto = this.minutoEn(evento, arrastre.columna);
    const { origen, ambiente } = arrastre;
    if (minuto !== origen) arrastre.movio = true;
    this.seleccion.set({ ambienteId: ambiente.id, inicio: Math.min(origen, minuto), fin: Math.max(origen, minuto) + PASO });
  }

  /** Con el dedo cerca del borde de la grilla, la desplaza para poder seguir seleccionando */
  private desplazarEnBorde(evento: PointerEvent, columna: HTMLElement): void {
    const contenedor = columna.closest<HTMLElement>('.overflow-auto');
    if (!contenedor) return;
    const caja = contenedor.getBoundingClientRect();
    const margen = 48;
    if (evento.clientY < caja.top + margen + 50) contenedor.scrollBy(0, -12); // 50: encabezado fijo
    else if (evento.clientY > caja.bottom - margen) contenedor.scrollBy(0, 12);
  }

  @HostListener('document:pointerup', ['$event'])
  protected terminarSeleccion(evento: PointerEvent): void {
    const arrastre = this.arrastre;
    this.arrastre = null;
    if (!arrastre) return;
    clearTimeout(arrastre.espera);
    const actual = this.seleccion();
    this.seleccion.set(null);
    // Clic o toque sin arrastrar: bloque libre de ese momento o, si cae sobre una clase, su horario (para un evento)
    const tramo = arrastre.movio && actual ? actual
      : (this.tramoSugerido(arrastre.ambiente, arrastre.origen) ?? this.tramoClaseEn(arrastre.ambiente, arrastre.origen));
    if (tramo) this.validarYOfrecer(arrastre.ambiente, tramo);
    else this.notificaciones.aviso('Ese horario no está disponible.');
  }

  /** Horario de la clase que cubre ese minuto (para proponer un evento encima) */
  private tramoClaseEn(a: Ambiente, minuto: number): Tramo | null {
    const o = this.ocupacionesDe(a.id).find((x) => x.origen !== 'reserva' && aMinutos(x.hora_inicio) <= minuto && minuto < aMinutos(x.hora_fin));
    return o ? { ambienteId: a.id, inicio: aMinutos(o.hora_inicio), fin: aMinutos(o.hora_fin) } : null;
  }

  @HostListener('document:pointercancel')
  protected cancelarSeleccion(): void {
    clearTimeout(this.arrastre?.espera);
    this.arrastre = null;
    this.seleccion.set(null);
  }

  /** Bloque estándar que contiene el minuto; si no entra, el tramo libre que lo contiene */
  private tramoSugerido(a: Ambiente, minuto: number): Tramo | null {
    const hueco = this.tramosLibres(a).find((t) => t.inicio <= minuto && minuto < t.fin);
    if (!hueco) return null;
    const bloque = this.catalogos.bloques().find((b) => aMinutos(b.hora_inicio) <= minuto && minuto < aMinutos(b.hora_fin));
    if (bloque && aMinutos(bloque.hora_inicio) >= hueco.inicio && aMinutos(bloque.hora_fin) <= hueco.fin) {
      return { ambienteId: a.id, inicio: aMinutos(bloque.hora_inicio), fin: aMinutos(bloque.hora_fin) };
    }
    return hueco;
  }

  /** Tramos libres del día (descontando lo agendado y la hora ya pasada) */
  private tramosLibres(a: Ambiente): Tramo[] {
    const resultado: Tramo[] = [];
    let cursor = this.esHoy() ? Math.max(INICIO_DIA, Math.ceil(this.minutosAhora() / PASO) * PASO) : INICIO_DIA;
    for (const o of this.ocupacionesDe(a.id)) {
      const ini = aMinutos(o.hora_inicio);
      if (ini > cursor) resultado.push({ ambienteId: a.id, inicio: cursor, fin: ini });
      cursor = Math.max(cursor, aMinutos(o.hora_fin));
    }
    if (cursor < FIN_DIA) resultado.push({ ambienteId: a.id, inicio: cursor, fin: FIN_DIA });
    return resultado;
  }

  /** Revisa que el tramo no esté en el pasado ni choque, y pregunta qué registrar */
  private validarYOfrecer(a: Ambiente, tramo: Tramo): void {
    if (this.esHoy() && tramo.inicio < this.minutosAhora()) {
      this.notificaciones.aviso('Ese horario ya pasó. Elija una hora posterior.');
      return;
    }
    const cruces = this.ocupacionesDe(a.id).filter((o) => aMinutos(o.hora_inicio) < tramo.fin && tramo.inicio < aMinutos(o.hora_fin));
    // Otro evento no se puede pisar; una clase o una cesión sí (el evento la mueve)
    const bloqueante = cruces.find((o) => o.origen === 'reserva');
    if (bloqueante) {
      this.notificaciones.aviso(`${a.codigo} tiene ${bloqueante.titulo} de ${hhmm(bloqueante.hora_inicio)} a ${hhmm(bloqueante.hora_fin)}. Elija otro horario.`);
      return;
    }
    // Si pisa clases o cesiones, se permite pero únicamente como evento (las reubica por prioridad)
    this.soloEvento.set(cruces.length > 0);
    this.porRegistrar.set(tramo);
  }

  /** Cierra el modal de "qué registrar" */
  protected cerrarRegistrar(): void {
    this.porRegistrar.set(null);
    this.soloEvento.set(false);
  }

  /** Abre el formulario elegido con el laboratorio, día y horas */
  protected registrar(que: 'clase' | 'evento'): void {
    const s = this.porRegistrar();
    if (!s) return;
    this.porRegistrar.set(null);
    this.soloEvento.set(false);
    const datos = {
      ambienteId: s.ambienteId, fecha: this.fecha(),
      horaInicio: this.etiquetaMinutos(s.inicio), horaFin: this.etiquetaMinutos(s.fin),
    };
    if (que === 'clase') this.paneles.abrirAsignacion(null, datos);
    else this.paneles.abrirReserva(null, { ...datos, tipoId: this.catalogos.tiposReserva().find((t) => t.codigo === 'EVENTO')?.id });
  }
}
