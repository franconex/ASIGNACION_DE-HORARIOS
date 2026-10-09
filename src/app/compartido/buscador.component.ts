import { Component, computed, ElementRef, HostListener, inject, input, model, output, signal } from '@angular/core';
import { IconoComponent } from './icono.component';

/** Opción del buscador */
export interface OpcionBuscador {
  id: number;
  texto: string;
  subtexto?: string;
  /** Opciones destacadas aparecen primero (ej. materias que dicta el docente) */
  destacado?: boolean;
}

/**
 * Selector con búsqueda por texto (para listas largas: docentes, materias…).
 * Permite crear un elemento nuevo si no existe (evento "crear").
 */
@Component({
  selector: 'app-buscador',
  imports: [IconoComponent],
  template: `
    <div class="relative">
      <input maxlength="80" class="campo pr-8" [placeholder]="placeholder()" [disabled]="deshabilitado()"
             [value]="abierto() ? texto() : textoSeleccionado()"
             (focus)="abrir()" (input)="texto.set($any($event.target).value); abierto.set(true); resaltado.set(0)"
             (keydown)="teclado($event)">
      @if (valor() && !deshabilitado()) {
        <button type="button" class="absolute top-1/2 right-2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                (click)="seleccionar(null)" aria-label="Quitar"><app-icono nombre="cerrar" [tamano]="15" /></button>
      }
      @if (abierto()) {
        <ul class="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-superficie py-1 shadow-lg">
          @for (o of filtradas(); track o.id; let i = $index) {
            <li>
              <button type="button" class="flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm"
                      [class]="i === resaltado() ? 'bg-marca-50' : 'hover:bg-slate-50'"
                      (mousedown)="$event.preventDefault(); seleccionar(o.id)">
                @if (o.destacado) { <span class="text-amber-500">★</span> }
                <span class="flex-1">
                  <span class="block">{{ o.texto }}</span>
                  @if (o.subtexto) { <span class="block text-xs text-slate-500">{{ o.subtexto }}</span> }
                </span>
              </button>
            </li>
          } @empty {
            <li class="px-3 py-2 text-sm text-slate-500">Sin resultados</li>
          }
          @if (permitirCrear() && texto().trim() && !coincidenciaExacta()) {
            <li class="border-t border-slate-100">
              <button type="button" class="w-full px-3 py-2 text-left text-sm font-medium text-marca-700 hover:bg-marca-50"
                      (mousedown)="$event.preventDefault(); crearNuevo()">+ Crear "{{ texto().trim() }}"</button>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class BuscadorComponent {
  private readonly elemento = inject(ElementRef);

  readonly opciones = input<OpcionBuscador[]>([]);
  readonly valor = model<number | null>(null);
  readonly placeholder = input('Buscar…');
  readonly deshabilitado = input(false);
  readonly permitirCrear = input(false);
  /** Se emite con el texto escrito cuando se pide crear un elemento nuevo */
  readonly crear = output<string>();

  protected readonly texto = signal('');
  protected readonly abierto = signal(false);
  protected readonly resaltado = signal(0);

  /** Texto del elemento seleccionado */
  protected readonly textoSeleccionado = computed(() => {
    const id = this.valor();
    return this.opciones().find((o) => o.id === id)?.texto ?? '';
  });

  /** Opciones que coinciden con lo escrito (sin importar tildes) */
  protected readonly filtradas = computed(() => {
    const busqueda = normalizar(this.texto().trim());
    const palabras = busqueda.split(/\s+/).filter(Boolean);
    return this.opciones()
      .filter((o) => {
        const contenido = normalizar(`${o.texto} ${o.subtexto ?? ''}`);
        return palabras.every((p) => contenido.includes(p));
      })
      .sort((a, b) => Number(!!b.destacado) - Number(!!a.destacado))
      .slice(0, 60);
  });

  protected readonly coincidenciaExacta = computed(() =>
    this.opciones().some((o) => normalizar(o.texto) === normalizar(this.texto().trim())));

  protected abrir(): void {
    this.texto.set('');
    this.abierto.set(true);
    this.resaltado.set(0);
  }

  /** Elige una opción (null = limpiar) */
  protected seleccionar(id: number | null): void {
    this.valor.set(id);
    this.abierto.set(false);
  }

  protected crearNuevo(): void {
    this.crear.emit(this.texto().trim());
    this.abierto.set(false);
  }

  /** Navegación con flechas, Enter y Escape */
  protected teclado(evento: KeyboardEvent): void {
    const total = this.filtradas().length;
    if (evento.key === 'ArrowDown') { this.resaltado.set(Math.min(this.resaltado() + 1, total - 1)); evento.preventDefault(); }
    else if (evento.key === 'ArrowUp') { this.resaltado.set(Math.max(this.resaltado() - 1, 0)); evento.preventDefault(); }
    else if (evento.key === 'Enter') {
      evento.preventDefault();
      const opcion = this.filtradas()[this.resaltado()];
      if (opcion) this.seleccionar(opcion.id);
    } else if (evento.key === 'Escape') this.abierto.set(false);
  }

  /** Cierra la lista al hacer clic fuera */
  @HostListener('document:mousedown', ['$event'])
  protected clicFuera(evento: MouseEvent): void {
    if (!this.elemento.nativeElement.contains(evento.target)) this.abierto.set(false);
  }
}

/** Minúsculas y sin tildes para comparar */
export function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
