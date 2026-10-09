import { AfterViewInit, Component, computed, ElementRef, input, OnDestroy, signal, viewChild } from '@angular/core';
import { numero, SerieGrafico, topeRedondo } from './graficos';

const MARGEN = { arriba: 12, derecha: 84, abajo: 22, izquierda: 34 };

/**
 * Gráfico de líneas (SVG) para series en el tiempo. Al pasar el mouse
 * muestra una guía vertical con el valor de cada serie. Con 2 o más series
 * lleva leyenda y el nombre al final de cada línea; debajo, la tabla de datos.
 */
@Component({
  selector: 'app-grafico-lineas',
  template: `
    @if (series().length > 1) {
      <div class="mb-2 flex flex-wrap gap-3 text-xs text-slate-600">
        @for (s of series(); track s.nombre) {
          <span class="inline-flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden="true"><line x1="1" y1="4" x2="17" y2="4" stroke-width="2" stroke-linecap="round"
              [style.stroke]="s.color" [attr.stroke-dasharray]="s.punteada ? '4 3' : null" /></svg>
            {{ s.nombre }}
          </span>
        }
      </div>
    }
    <div #caja class="relative w-full" [style.height.px]="alto()" (mouseleave)="indice.set(null)">
      @if (ancho() > 0) {
        <svg [attr.width]="ancho()" [attr.height]="alto()" class="block overflow-visible" role="img" [attr.aria-label]="descripcion()">
          <!-- rejilla y eje Y -->
          @for (g of rejilla(); track g.valor) {
            <line [attr.x1]="m.izquierda" [attr.x2]="ancho() - m.derecha" [attr.y1]="g.y" [attr.y2]="g.y"
                  class="stroke-slate-200" stroke-width="1" />
            <text [attr.x]="m.izquierda - 6" [attr.y]="g.y + 3" text-anchor="end" class="fill-slate-400 text-[10px] tabular-nums">{{ g.texto }}</text>
          }
          <!-- etiquetas del eje X -->
          @for (e of etiquetas(); track $index; let i = $index) {
            @if (i % cadaCuanto() === 0) {
              <text [attr.x]="x(i)" [attr.y]="alto() - 6" text-anchor="middle" class="fill-slate-400 text-[10px] tabular-nums">{{ e }}</text>
            }
          }
          <!-- guía del mouse -->
          @if (indice() !== null) {
            <line [attr.x1]="x(indice()!)" [attr.x2]="x(indice()!)" [attr.y1]="m.arriba" [attr.y2]="alto() - m.abajo"
                  class="stroke-slate-300" stroke-width="1" />
          }
          <!-- líneas -->
          @for (s of series(); track s.nombre) {
            <path [attr.d]="trazo(s)" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"
                  [style.stroke]="s.color" [attr.stroke-dasharray]="s.punteada ? '6 4' : null" />
          }
          <!-- puntos en el índice del mouse (con anillo del color de fondo) -->
          @if (indice() !== null) {
            @for (s of series(); track s.nombre) {
              <circle [attr.cx]="x(indice()!)" [attr.cy]="y(s.valores[indice()!] ?? 0)" r="4" stroke-width="2"
                      [style.fill]="s.color" style="stroke: var(--color-superficie)" />
            }
          }
          <!-- nombre al final de cada línea (con 2 o más series) -->
          @if (series().length > 1) {
            @for (r of rotulos(); track r.nombre) {
              <line [attr.x1]="ancho() - m.derecha + 12" [attr.x2]="ancho() - m.derecha + 20" [attr.y1]="r.y" [attr.y2]="r.y"
                    stroke-width="2" [style.stroke]="r.color" />
              <text [attr.x]="ancho() - m.derecha + 24" [attr.y]="r.y + 3" class="fill-slate-600 text-[10px]">{{ r.nombre }}</text>
            }
          }
          <!-- zona para el mouse -->
          <rect [attr.x]="m.izquierda" [attr.y]="m.arriba" [attr.width]="anchoUtil()" [attr.height]="altoUtil()"
                fill="transparent" (mousemove)="mover($event)" (pointerdown)="mover($event)" />
        </svg>
      }
      @if (indice() !== null) {
        <div class="pointer-events-none absolute z-10 min-w-36 rounded-lg border border-slate-200 bg-superficie px-3 py-2 text-xs shadow-lg"
             [style.left.px]="posTip().x" [style.top.px]="posTip().y">
          <p class="mb-1 font-semibold text-slate-800">{{ titulos()?.[indice()!] ?? etiquetas()[indice()!] }}</p>
          @for (s of series(); track s.nombre) {
            <p class="flex items-center gap-1.5 text-slate-600">
              <span class="h-0.5 w-3 rounded" [style.background]="s.color"></span>
              {{ s.nombre }}: <b class="ml-auto pl-2 text-slate-800 tabular-nums">{{ formato(s.valores[indice()!] ?? 0) }}</b>
            </p>
          }
        </div>
      }
    </div>
    <details class="mt-2 text-xs text-slate-500">
      <summary class="cursor-pointer select-none">Ver datos en tabla</summary>
      <div class="mt-1 max-h-56 overflow-auto">
        <table class="tabla">
          <thead><tr><th></th>@for (s of series(); track s.nombre) { <th class="text-right">{{ s.nombre }}</th> }</tr></thead>
          <tbody>
            @for (e of etiquetas(); track $index; let i = $index) {
              <tr><td>{{ titulos()?.[i] ?? e }}</td>@for (s of series(); track s.nombre) { <td class="text-right tabular-nums">{{ formato(s.valores[i] ?? 0) }}</td> }</tr>
            }
          </tbody>
        </table>
      </div>
    </details>
  `,
})
export class GraficoLineasComponent implements AfterViewInit, OnDestroy {
  /** Texto corto de cada punto del eje X (ej. '12') */
  readonly etiquetas = input.required<string[]>();
  /** Texto largo para el tooltip y la tabla (ej. 'lunes 12 de octubre') */
  readonly titulos = input<string[]>();
  readonly series = input.required<SerieGrafico[]>();
  /** Se agrega a los valores (ej. ' h') */
  readonly unidad = input('');
  readonly alto = input(220);

  protected readonly m = MARGEN;
  private readonly caja = viewChild.required<ElementRef<HTMLElement>>('caja');
  protected readonly ancho = signal(0);
  protected readonly indice = signal<number | null>(null);
  private observador?: ResizeObserver;

  protected readonly anchoUtil = computed(() => Math.max(10, this.ancho() - MARGEN.izquierda - MARGEN.derecha));
  protected readonly altoUtil = computed(() => Math.max(10, this.alto() - MARGEN.arriba - MARGEN.abajo));
  private readonly tope = computed(() => topeRedondo(Math.max(0, ...this.series().flatMap((s) => s.valores))));
  protected readonly rejilla = computed(() =>
    [0, this.tope() / 2, this.tope()].map((v) => ({ valor: v, y: this.y(v), texto: numero(v) })));
  /** En meses largos o pantallas angostas se rotula un punto de cada varios */
  protected readonly cadaCuanto = computed(() => Math.max(1, Math.ceil(this.etiquetas().length / Math.max(1, this.anchoUtil() / 28))));
  protected readonly descripcion = computed(() =>
    `Gráfico de líneas: ${this.series().map((s) => s.nombre).join(', ')}`);

  /**
   * Nombres al final de las líneas, separados 12px para que no se encimen:
   * se acomodan de abajo hacia arriba sin pasar la línea base (ahí van las
   * etiquetas del eje X).
   */
  protected readonly rotulos = computed(() => {
    const ultimo = this.etiquetas().length - 1;
    const base = MARGEN.arriba + this.altoUtil();
    const lista = this.series().map((s) => ({ nombre: s.nombre, color: s.color, y: Math.min(base, this.y(s.valores[ultimo] ?? 0)) }))
      .sort((a, b) => b.y - a.y);
    for (let i = 1; i < lista.length; i++) lista[i].y = Math.min(lista[i].y, lista[i - 1].y - 12);
    return lista;
  });

  protected readonly posTip = computed(() => {
    const i = this.indice() ?? 0;
    const x = this.x(i);
    // A la izquierda de la guía si no entra a la derecha
    return { x: x + 170 > this.ancho() ? Math.max(0, x - 170) : x + 12, y: MARGEN.arriba };
  });

  ngAfterViewInit(): void {
    const el = this.caja().nativeElement;
    this.observador = new ResizeObserver(() => this.ancho.set(el.clientWidth));
    this.observador.observe(el);
    this.ancho.set(el.clientWidth);
  }

  ngOnDestroy(): void {
    this.observador?.disconnect();
  }

  protected x(i: number): number {
    const n = this.etiquetas().length;
    return MARGEN.izquierda + (n <= 1 ? this.anchoUtil() / 2 : (i / (n - 1)) * this.anchoUtil());
  }

  protected y(v: number): number {
    return MARGEN.arriba + this.altoUtil() - (v / this.tope()) * this.altoUtil();
  }

  protected trazo(s: SerieGrafico): string {
    return this.etiquetas().map((_, i) => `${i ? 'L' : 'M'}${this.x(i).toFixed(1)},${this.y(s.valores[i] ?? 0).toFixed(1)}`).join(' ');
  }

  protected mover(e: MouseEvent): void {
    const n = this.etiquetas().length;
    if (!n) return;
    const svg = (e.currentTarget as SVGElement).ownerSVGElement!;
    const rel = e.clientX - svg.getBoundingClientRect().left - MARGEN.izquierda;
    this.indice.set(n === 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round((rel / this.anchoUtil()) * (n - 1)))));
  }

  protected formato(v: number): string {
    return numero(v) + this.unidad();
  }
}
