import { Component, input, output } from '@angular/core';
import { IconoComponent } from './icono.component';

/**
 * Ventana modal reutilizable. El contenido se proyecta con <ng-content>,
 * y los botones del pie con el atributo [pie]. En el celular ocupa toda la
 * pantalla, con el título fijo arriba y los botones fijos abajo.
 */
@Component({
  selector: 'app-modal',
  imports: [IconoComponent],
  template: `
    @if (abierto()) {
      <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 backdrop-blur-[2px] sm:p-4"
           (mousedown)="alPulsarFondo($event)">
        <div class="tarjeta flex min-h-full w-full flex-col rounded-none border-0 shadow-xl sm:my-8 sm:min-h-0 sm:rounded-lg sm:border"
             [class]="anchos[ancho()]" (mousedown)="$event.stopPropagation()" role="dialog" aria-modal="true" [attr.aria-label]="titulo()">
          <div class="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-200 bg-superficie px-4 py-3 sm:static sm:rounded-t-lg sm:px-5">
            <h2 class="min-w-0 truncate text-base font-semibold text-slate-800">{{ titulo() }}</h2>
            <button class="btn-fantasma btn-sm" (click)="cerrar.emit()" aria-label="Cerrar"><app-icono nombre="cerrar" [tamano]="18" /></button>
          </div>
          <div class="flex-1 px-4 py-4 sm:px-5"><ng-content /></div>
          <div class="sticky bottom-0 z-10 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 empty:hidden sm:static sm:rounded-b-lg sm:px-5">
            <ng-content select="[pie]" />
          </div>
        </div>
      </div>
    }
  `,
})
export class ModalComponent {
  readonly abierto = input(false);
  readonly titulo = input('');
  readonly ancho = input<'sm' | 'md' | 'lg' | 'xl'>('md');
  readonly cerrar = output<void>();

  protected readonly anchos: Record<string, string> = {
    sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl',
  };

  /** Cierra al hacer clic fuera del cuadro */
  protected alPulsarFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrar.emit();
  }
}
