import { AfterViewInit, Component, computed, ElementRef, input, OnDestroy, signal, viewChild } from '@angular/core';
import { barraRedondeada, numero, SerieGrafico, topeRedondo } from './graficos';

const MARGEN = { arriba: 12, derecha: 8, abajo: 22, izquierda: 34 };
/** Separación entre segmentos apilados (color de fondo) */
const HUECO = 2;

/**
 * Gráfico de barras verticales (SVG). Con varias series las apila (con un
 * hueco de 2px entre segmentos) y muestra leyenda. Al pasar el mouse por
 * una columna muestra el valor de cada serie y el total; debajo, la tabla.
 */
@Component({
  selector: 'app-grafico-barras',
  template: `
    @if (series().length > 1) {
      <div class="mb-2 flex flex-wrap gap-3 text-xs text-slate-600">
        @for (s of series(); track s.nombre) {
          <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm" [style.background]="s.color"></span> {{ s.nombre }}</span>
        }
      </div>
    }
    <div #caja class="relative w-full" [style.height.px]="alto()" (mouseleave)="indice.set(null)">
      @if (ancho() > 0) {
        <svg [attr.width]="ancho()" [attr.height]="alto()" class="block" role="img" [attr.aria-label]="descripcion()">
          @for (g of rejilla(); track g.valor) {
            <line [attr.x1]="m.izquierda" [attr.x2]="ancho() - m.derecha" [attr.y1]="g.y" [attr.y2]="g.y" class="stroke-slate-200" stroke-width="1" />
            <text [attr.x]="m.izquierda - 6" [attr.y]="g.y + 3" text-anchor="end" class="fill-slate-400 text-[10px] tabular-nums">{{ g.texto }}</text>
          }
          @for (c of columnas(); track c.i) {
            @if (indice() === c.i) {
              <rect [attr.x]="c.xBanda" [attr.y]="m.arriba" [attr.width]="banda()" [attr.height]="altoUtil()" class="fill-slate-100" />
            }
            @for (seg of c.segmentos; track seg.serie) {
              <path [attr.d]="seg.d" [style.fill]="seg.color" />
            }
            @if (c.i % cadaCuanto() === 0) {
              <text [attr.x]="c.xCentro" [attr.y]="alto() - 6" text-anchor="middle" class="fill-slate-400 text-[10px]">{{ etiquetas()[c.i] }}</text>
            }
            <!-- zona para el mouse: toda la columna, más grande que la barra -->
            <rect [attr.x]="c.xBanda" [attr.y]="m.arriba" [attr.width]="banda()" [attr.height]="altoUtil()" fill="transparent"
                  (mouseenter)="indice.set(c.i)" (pointerdown)="indice.set(c.i)" />
          }
        </svg>
      }
      @if (indice() !== null) {
        <div class="pointer-events-none absolute z-10 min-w-36 rounded-lg border border-slate-200 bg-superficie px-3 py-2 text-xs shadow-lg"
             [style.left.px]="posTip()" [style.top.px]="m.arriba">
          <p class="mb-1 font-semibold text-slate-800">{{ titulos()?.[indice()!] ?? etiquetas()[indice()!] }}</p>
          @for (s of series(); track s.nombre) {
            <p class="flex items-center gap-1.5 text-slate-600">
              <span class="h-2 w-2 rounded-sm" [style.background]="s.color"></span>
              {{ s.nombre }}: <b class="ml-auto pl-2 text-slate-800 tabular-nums">{{ formato(s.valores[indice()!] ?? 0) }}</b>
            </p>
          }
          @if (series().length > 1) {
            <p class="mt-1 flex border-t border-slate-200 pt-1 text-slate-600">Total: <b class="ml-auto pl-2 text-slate-800 tabular-nums">{{ formato(total(indice()!)) }}</b></p>
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
export class GraficoBarrasComponent implements AfterViewInit, OnDestroy {
  readonly etiquetas = input.required<string[]>();
  readonly titulos = input<string[]>();
  readonly series = input.required<SerieGrafico[]>();
  readonly unidad = input('');
  readonly alto = input(200);

  protected readonly m = MARGEN;
  private readonly caja = viewChild.required<ElementRef<HTMLElement>>('caja');
  protected readonly ancho = signal(0);
  protected readonly indice = signal<number | null>(null);
  private observador?: ResizeObserver;

  protected readonly anchoUtil = computed(() => Math.max(10, this.ancho() - MARGEN.izquierda - MARGEN.derecha));
  protected readonly altoUtil = computed(() => Math.max(10, this.alto() - MARGEN.arriba - MARGEN.abajo));
  protected readonly banda = computed(() => this.anchoUtil() / Math.max(1, this.etiquetas().length));
  private readonly tope = computed(() =>
    topeRedondo(Math.max(0, ...this.etiquetas().map((_, i) => this.total(i)))));
  protected readonly rejilla = computed(() =>
    [0, this.tope() / 2, this.tope()].map((v) => ({ valor: v, y: this.y(v), texto: numero(v) })));
  protected readonly cadaCuanto = computed(() => Math.max(1, Math.ceil(this.etiquetas().length / Math.max(1, this.anchoUtil() / 26))));
  protected readonly descripcion = computed(() => `Gráfico de barras: ${this.series().map((s) => s.nombre).join(', ')}`);

  /** Cada columna con sus segmentos apilados de abajo hacia arriba */
  protected readonly columnas = computed(() => {
    const banda = this.banda();
    const anchoBarra = Math.max(4, Math.min(32, banda * 0.62));
    return this.etiquetas().map((_, i) => {
      const xBanda = MARGEN.izquierda + i * banda;
      const xBarra = xBanda + (banda - anchoBarra) / 2;
      const visibles = this.series().map((s, k) => ({ k, s, v: s.valores[i] ?? 0 })).filter((x) => x.v > 0);
      let base = 0;
      const segmentos = visibles.map((x, j) => {
        const yAbajo = this.y(base);
        base += x.v;
        const yArriba = this.y(base);
        // hueco de 2px entre segmentos; el de arriba lleva la punta redondeada
        const alto = Math.max(1, yAbajo - yArriba - (j > 0 ? HUECO : 0));
        const ultimo = j === visibles.length - 1;
        return { serie: x.k, color: x.s.color, d: barraRedondeada(xBarra, yArriba, anchoBarra, alto, ultimo ? 4 : 0) };
      });
      return { i, xBanda, xCentro: xBanda + banda / 2, segmentos };
    });
  });

  protected readonly posTip = computed(() => {
    const x = MARGEN.izquierda + ((this.indice() ?? 0) + 1) * this.banda();
    return x + 170 > this.ancho() ? Math.max(0, x - this.banda() - 170) : x + 4;
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

  protected total(i: number): number {
    return this.series().reduce((t, s) => t + (s.valores[i] ?? 0), 0);
  }

  private y(v: number): number {
    return MARGEN.arriba + this.altoUtil() - (v / this.tope()) * this.altoUtil();
  }

  protected formato(v: number): string {
    return numero(v) + this.unidad();
  }
}
