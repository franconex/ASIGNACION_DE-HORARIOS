import { Component, computed, effect, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconoComponent } from './icono.component';

/** Corta una lista a la página pedida (página 1 = la primera) */
export function paginar<T>(lista: T[], pagina: number, porPagina: number): T[] {
  return lista.slice((pagina - 1) * porPagina, pagina * porPagina);
}

/**
 * Paginación para tablas: "Mostrando 21–40 de 80", anterior/siguiente,
 * números de página y cuántas filas mostrar. Si la lista se achica (por un
 * filtro) y la página ya no existe, vuelve a la última que hay.
 */
@Component({
  selector: 'app-paginador',
  imports: [FormsModule, IconoComponent],
  template: `
    <div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
      <p class="text-xs">
        @if (total()) { Mostrando <b>{{ desde() }}–{{ hasta() }}</b> de <b>{{ total() }}</b> {{ nombre() }} } @else { 0 {{ nombre() }} }
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <label class="flex items-center gap-1 text-xs">
          Mostrar
          <select class="campo !w-20 !py-1" [ngModel]="porPagina()" (ngModelChange)="cambiarTamano(+$event)" aria-label="Filas por página">
            @for (n of tamanos; track n) { <option [ngValue]="n">{{ n }}</option> }
          </select>
        </label>
        @if (paginas() > 1) {
          <nav class="flex items-center gap-0.5" aria-label="Páginas">
            <button type="button" class="btn-fantasma btn-sm" [disabled]="pagina() === 1" (click)="ir(pagina() - 1)" aria-label="Página anterior">
              <app-icono nombre="anterior" [tamano]="15" />
            </button>
            @for (p of numeros(); track $index) {
              @if (p === 0) {
                <span class="px-1 text-slate-400">…</span>
              } @else {
                <button type="button" class="h-8 min-w-8 rounded-md px-2 text-sm tabular-nums transition"
                        [class]="p === pagina() ? 'bg-marca-600 font-semibold text-white' : 'hover:bg-slate-100'"
                        [attr.aria-current]="p === pagina() ? 'page' : null" (click)="ir(p)">{{ p }}</button>
              }
            }
            <button type="button" class="btn-fantasma btn-sm" [disabled]="pagina() === paginas()" (click)="ir(pagina() + 1)" aria-label="Página siguiente">
              <app-icono nombre="siguiente" [tamano]="15" />
            </button>
          </nav>
        }
      </div>
    </div>
  `,
})
export class PaginadorComponent {
  readonly total = input.required<number>();
  readonly pagina = model(1);
  readonly porPagina = model(20);
  /** Qué se cuenta: "registro(s)", "docente(s)"… */
  readonly nombre = input('registro(s)');

  protected readonly tamanos = [10, 20, 50, 100];
  protected readonly paginas = computed(() => Math.max(1, Math.ceil(this.total() / this.porPagina())));
  protected readonly desde = computed(() => (this.pagina() - 1) * this.porPagina() + 1);
  protected readonly hasta = computed(() => Math.min(this.total(), this.pagina() * this.porPagina()));

  /** 1 … 4 5 [6] 7 8 … 12  (0 = puntos suspensivos) */
  protected readonly numeros = computed(() => {
    const n = this.paginas();
    const p = this.pagina();
    if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
    const medio = [p - 1, p, p + 1].filter((x) => x > 1 && x < n);
    return [1, ...(medio[0] > 2 ? [0] : []), ...medio, ...(medio.at(-1)! < n - 1 ? [0] : []), n];
  });

  constructor() {
    // Si un filtro deja menos páginas, no quedarse en una página vacía
    effect(() => {
      if (this.pagina() > this.paginas()) this.pagina.set(this.paginas());
    });
  }

  protected ir(p: number): void {
    this.pagina.set(Math.min(Math.max(1, p), this.paginas()));
  }

  protected cambiarTamano(n: number): void {
    this.porPagina.set(n);
    this.pagina.set(1);
  }
}
