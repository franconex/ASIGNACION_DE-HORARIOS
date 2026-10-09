import { Component, input, output } from '@angular/core';
import { IconoComponent } from './icono.component';

/**
 * Ventana modal reutilizable. El contenido se proyecta con <ng-content>,
 * y los botones del pie con el atributo [pie].
 */
@Component({
  selector: 'app-modal',
  imports: [IconoComponent],
  template: `
    @if (abierto()) {
      <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-[2px]"
           (mousedown)="alPulsarFondo($event)">
        <div class="tarjeta my-8 w-full shadow-xl" [class]="anchos[ancho()]" (mousedown)="$event.stopPropagation()">
          <div class="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h2 class="text-base font-semibold text-slate-800">{{ titulo() }}</h2>
            <button class="btn-fantasma btn-sm" (click)="cerrar.emit()" aria-label="Cerrar"><app-icono nombre="cerrar" [tamano]="18" /></button>
          </div>
          <div class="px-5 py-4"><ng-content /></div>
          <div class="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 rounded-b-xl empty:hidden">
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
