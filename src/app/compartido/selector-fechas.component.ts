import { Component, computed, effect, input, model, signal, untracked } from '@angular/core';
import { environment } from '../../environments/environment';
import { aIso, DIAS_CORTOS, deIso, diaIso, fechaActual, MESES, rangoFechas, sumarDias } from '../core/fechas';
import { IconoComponent } from './icono.component';

/** Celda de un mes */
interface CeldaDia {
  fecha: string;
  numero: number;
  delMes: boolean;
  habilitado: boolean;
  seleccionado: boolean;
  feriado: boolean;
}

/** Un mes visible */
interface MesVisible {
  clave: string;
  titulo: string;
  celdas: CeldaDia[];
  marcados: number;
}

/**
 * Calendario de un mes (con flechas para pasar al siguiente) para marcar
 * UNA o VARIAS fechas con clic.
 * - Nunca permite fechas pasadas (salvo que se indique lo contrario).
 * - Limita por días de la semana, feriados o una lista exacta de fechas.
 * - "Marcar todos los…" selecciona ese día de la semana en todo lo visible.
 * Las fechas pasadas que ya estaban guardadas se muestran, pero no se pueden quitar.
 */
@Component({
  selector: 'app-selector-fechas',
  imports: [IconoComponent],
  template: `
    <div class="rounded-lg border border-slate-200 bg-superficie select-none">
      <!-- Barra superior -->
      <div class="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
        <button type="button" class="btn-fantasma btn-sm" (click)="moverMes(-1)" [disabled]="!puedeRetroceder()" aria-label="Mes anterior">
          <app-icono nombre="anterior" [tamano]="16" />
        </button>
        <span class="min-w-36 text-center text-sm font-semibold text-slate-800">{{ rangoTitulo() }}</span>
        <button type="button" class="btn-fantasma btn-sm" (click)="moverMes(1)" aria-label="Mes siguiente">
          <app-icono nombre="siguiente" [tamano]="16" />
        </button>
        @if (multiple()) {
          <span class="ml-auto text-sm text-slate-500">{{ valor().length }} {{ valor().length === 1 ? 'día marcado' : 'días marcados' }}</span>
        }
      </div>

      <!-- Atajos -->
      @if (multiple()) {
        <div class="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-3 py-2 text-sm">
          @if (diasAtajo().length) { <span class="text-slate-500">Marcar todos los</span> }
          @for (d of diasAtajo(); track d) {
            <button type="button" class="rounded-md border border-slate-200 px-2 py-0.5 text-slate-700 hover:border-marca-500 hover:text-marca-700"
                    (click)="alternarDiaSemana(d)">{{ nombresDia[d] }}</button>
          }
          @if (diasAtajo().length) { <span class="mx-1 h-4 w-px bg-slate-200"></span> }
          <button type="button" class="rounded-md px-2 py-0.5 text-slate-500 hover:text-red-700" (click)="limpiar()" [disabled]="!valor().length">Quitar todos</button>
          <ng-content />
        </div>
      }

      <!-- Meses -->
      <div class="grid gap-x-5 gap-y-4 p-3" [class]="columnas()">
        @for (mes of mesesVisibles(); track mes.clave) {
          <div>
            @if (cantidadMeses() > 1) {
              <p class="mb-1 flex items-baseline justify-between text-sm font-semibold text-slate-800">
                {{ mes.titulo }}
                @if (mes.marcados) { <span class="text-xs font-normal text-marca-600">{{ mes.marcados }}</span> }
              </p>
            }
            <div class="grid grid-cols-7 text-center text-[11px] text-slate-400">
              @for (d of [1,2,3,4,5,6,7]; track d) { <span>{{ cantidadMeses() === 1 ? cortos[d] : cortos[d][0] }}</span> }
            </div>
            <div class="grid grid-cols-7 gap-px">
              @for (c of mes.celdas; track c.fecha) {
                <button type="button" class="rounded tabular-nums transition" [class]="(cantidadMeses() === 1 ? 'h-10 text-sm ' : 'h-7 text-xs ') + claseCelda(c)"
                        [disabled]="!c.habilitado" [title]="tituloCelda(c)" (click)="alternar(c.fecha)">
                  {{ c.delMes ? c.numero : '' }}
                </button>
              }
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class SelectorFechasComponent {
  /** Fechas seleccionadas (two-way binding) */
  readonly valor = model<string[]>([]);
  /** Permite varias fechas (false = una sola) */
  readonly multiple = input(true);
  /** Cantidad de meses visibles (por defecto 1) */
  readonly meses = input(1);
  /** Límite superior opcional */
  readonly max = input<string | null>(null);
  /** Permite elegir fechas pasadas (por defecto NO) */
  readonly permitirPasado = input(false);
  /** Días ISO permitidos (vacío = todos) */
  readonly diasPermitidos = input<number[]>([]);
  /** Fechas bloqueadas (feriados) */
  readonly feriados = input<Set<string>>(new Set());
  /** Si se indica, SOLO estas fechas se pueden marcar (ej. días de clase de un horario) */
  readonly fechasPermitidas = input<Set<string> | null>(null);
  /** Días marcados que se pintan aparte (ej. el laboratorio está ocupado ese día) */
  readonly resaltadas = input<Set<string>>(new Set());
  /** Explicación de los días resaltados (tooltip) */
  readonly textoResaltada = input('');

  protected readonly cortos = DIAS_CORTOS;
  protected readonly nombresDia = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'];
  /** Hoy en la zona horaria de la universidad */
  protected readonly hoy = fechaActual(environment.zonaHoraria);

  /** Primer mes visible */
  protected readonly mesInicial = signal(this.hoy.slice(0, 8) + '01');

  constructor() {
    // Si hay fechas permitidas, empieza en el primer mes que tenga alguna disponible
    effect(() => {
      const permitidas = this.fechasPermitidas();
      untracked(() => {
        const futuras = [...(permitidas ?? [])].filter((f) => this.permitirPasado() || f >= this.hoy).sort();
        const inicio = futuras[0] ?? this.hoy;
        this.mesInicial.set(inicio.slice(0, 8) + '01');
      });
    });
  }

  /** Cantidad efectiva de meses: con fechas permitidas, solo los que las contienen */
  protected readonly cantidadMeses = computed(() => {
    const permitidas = this.fechasPermitidas();
    if (!permitidas?.size) return this.meses();
    const ultima = [...permitidas].sort().at(-1)!;
    const inicio = deIso(this.mesInicial());
    const fin = deIso(ultima);
    const diferencia = (fin.getFullYear() - inicio.getFullYear()) * 12 + fin.getMonth() - inicio.getMonth() + 1;
    return Math.max(1, Math.min(this.meses(), diferencia));
  });

  protected readonly columnas = computed(() => {
    const n = this.cantidadMeses();
    if (n <= 1) return 'grid-cols-1 max-w-md';
    if (n === 2) return 'grid-cols-1 sm:grid-cols-2';
    if (n === 3) return 'grid-cols-1 sm:grid-cols-3';
    return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';
  });

  /** Meses a dibujar */
  protected readonly mesesVisibles = computed<MesVisible[]>(() => {
    const seleccion = new Set(this.valor());
    return Array.from({ length: this.cantidadMeses() }, (_, i) => {
      const primero = this.mesDesplazado(this.mesInicial(), i);
      const fechaPrimero = deIso(primero);
      const inicio = sumarDias(primero, -(diaIso(primero) - 1));
      let celdas = rangoFechas(inicio, sumarDias(inicio, 41)).map((fecha) => ({
        fecha,
        numero: deIso(fecha).getDate(),
        delMes: deIso(fecha).getMonth() === fechaPrimero.getMonth(),
        habilitado: this.habilitada(fecha) && deIso(fecha).getMonth() === fechaPrimero.getMonth(),
        seleccionado: seleccion.has(fecha) && deIso(fecha).getMonth() === fechaPrimero.getMonth(),
        feriado: this.feriados().has(fecha),
      }));
      if (celdas.slice(35).every((c) => !c.delMes)) celdas = celdas.slice(0, 35);
      return {
        clave: primero,
        titulo: `${MESES[fechaPrimero.getMonth()]} ${fechaPrimero.getFullYear()}`,
        celdas,
        marcados: celdas.filter((c) => c.seleccionado).length,
      };
    });
  });

  protected readonly rangoTitulo = computed(() => {
    const meses = this.mesesVisibles();
    if (!meses.length) return '';
    return meses.length === 1 ? meses[0].titulo : `${meses[0].titulo} a ${meses.at(-1)!.titulo}`;
  });

  /** No se navega a meses completamente pasados */
  protected readonly puedeRetroceder = computed(() => this.permitirPasado() || this.mesInicial() > this.hoy.slice(0, 8) + '01');

  /** Días de la semana que tienen atajo */
  protected readonly diasAtajo = computed(() => {
    const dias = this.diasPermitidos();
    const base = dias.length ? dias : [1, 2, 3, 4, 5, 6];
    const permitidas = this.fechasPermitidas();
    return permitidas ? base.filter((d) => [...permitidas].some((f) => diaIso(f) === d)) : base;
  });

  protected claseCelda(c: CeldaDia): string {
    if (!c.delMes) return 'invisible';
    if (c.seleccionado && this.resaltadas().has(c.fecha)) return 'bg-amber-500 font-semibold text-white ring-2 ring-amber-300 hover:bg-amber-600';
    if (c.seleccionado && c.habilitado) return 'bg-marca-600 font-semibold text-white hover:bg-marca-700';
    if (c.seleccionado) return 'bg-marca-100 font-medium text-marca-700';
    if (c.habilitado) return 'text-slate-700 hover:bg-marca-50';
    return c.feriado ? 'text-slate-300 line-through' : 'text-slate-300';
  }

  protected tituloCelda(c: CeldaDia): string {
    if (c.feriado) return 'Feriado';
    if (c.seleccionado && this.resaltadas().has(c.fecha)) return this.textoResaltada();
    if (c.seleccionado && !c.habilitado) return 'Fecha pasada (no se puede cambiar)';
    if (!c.habilitado && c.fecha < this.hoy) return 'Fecha pasada';
    return '';
  }

  /** ¿Se puede elegir esta fecha? */
  habilitada(fecha: string): boolean {
    if (!this.permitirPasado() && fecha < this.hoy) return false;
    const max = this.max();
    if (max && fecha > max) return false;
    const permitidas = this.fechasPermitidas();
    if (permitidas) return permitidas.has(fecha);
    const dias = this.diasPermitidos();
    if (dias.length && !dias.includes(diaIso(fecha))) return false;
    return !this.feriados().has(fecha);
  }

  /** Marca / desmarca una fecha */
  protected alternar(fecha: string): void {
    if (!this.habilitada(fecha)) return;
    if (!this.multiple()) {
      this.valor.set([fecha]);
      return;
    }
    const actual = new Set(this.valor());
    if (actual.has(fecha)) actual.delete(fecha);
    else actual.add(fecha);
    this.valor.set([...actual].sort());
  }

  /** Marca (o quita, si ya estaban todos) ese día de la semana en los meses visibles */
  protected alternarDiaSemana(dia: number): void {
    const fechas = this.mesesVisibles().flatMap((m) => m.celdas)
      .filter((c) => c.delMes && c.habilitado && diaIso(c.fecha) === dia).map((c) => c.fecha);
    const actual = new Set(this.valor());
    const todas = fechas.length > 0 && fechas.every((f) => actual.has(f));
    fechas.forEach((f) => (todas ? actual.delete(f) : actual.add(f)));
    this.valor.set([...actual].sort());
  }

  /** Quita las fechas que se pueden cambiar (las pasadas se conservan) */
  protected limpiar(): void {
    this.valor.set(this.valor().filter((f) => !this.habilitada(f)));
  }

  protected moverMes(delta: number): void {
    const nuevo = this.mesDesplazado(this.mesInicial(), delta);
    if (!this.permitirPasado() && nuevo < this.hoy.slice(0, 8) + '01') return;
    this.mesInicial.set(nuevo);
  }

  private mesDesplazado(primero: string, delta: number): string {
    const fecha = deIso(primero);
    return aIso(new Date(fecha.getFullYear(), fecha.getMonth() + delta, 1));
  }
}
