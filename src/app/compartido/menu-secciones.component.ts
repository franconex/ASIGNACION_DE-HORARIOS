import { Component, input, output } from '@angular/core';
import { IconoComponent } from './icono.component';

/** Una opción del menú de tarjetas */
export interface SeccionMenu<T extends string = string> {
  clave: T;
  texto: string;
  descripcion: string;
  icono: string;
}

/**
 * Menú de una pantalla con varias secciones (Registros, Configuración):
 * sin sección elegida muestra tarjetas grandes, fáciles de tocar en el celular;
 * con una sección elegida muestra su título y un botón para volver al menú.
 */
@Component({
  selector: 'app-menu-secciones',
  imports: [IconoComponent],
  template: `
    @if (seccionActual(); as s) {
      <div class="mb-4 flex items-center gap-2">
        <button class="btn-fantasma -ml-2 !px-2" (click)="volver.emit()" [attr.aria-label]="'Volver a ' + titulo()">
          <app-icono nombre="anterior" [tamano]="20" />
        </button>
        <div class="min-w-0">
          <p class="text-xs text-slate-500">{{ titulo() }}</p>
          <h1 class="flex items-center gap-2 truncate text-xl font-bold sm:text-2xl">
            <app-icono [nombre]="s.icono" [tamano]="20" class="text-marca-600" /> {{ s.texto }}
          </h1>
        </div>
      </div>
    } @else {
      <h1 class="mb-1 text-2xl font-bold">{{ titulo() }}</h1>
      @if (subtitulo()) { <p class="mb-4 text-sm text-slate-500">{{ subtitulo() }}</p> }
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        @for (s of secciones(); track s.clave) {
          <button class="tarjeta group flex items-center gap-4 p-4 text-left transition hover:border-marca-300 hover:shadow-sm active:scale-[0.99]"
                  (click)="elegir.emit(s.clave)">
            <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-marca-50 text-marca-600 transition group-hover:bg-marca-100">
              <app-icono [nombre]="s.icono" [tamano]="24" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block font-semibold text-slate-800">{{ s.texto }}</span>
              <span class="block text-sm text-slate-500">{{ s.descripcion }}</span>
            </span>
            <app-icono nombre="siguiente" [tamano]="18" class="text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-marca-600" />
          </button>
        }
      </div>
    }
  `,
})
export class MenuSeccionesComponent {
  readonly titulo = input.required<string>();
  readonly subtitulo = input('');
  readonly secciones = input.required<SeccionMenu[]>();
  /** Sección abierta (null = se ven las tarjetas) */
  readonly seccionActual = input<SeccionMenu | null>(null);
  readonly elegir = output<string>();
  readonly volver = output<void>();
}
