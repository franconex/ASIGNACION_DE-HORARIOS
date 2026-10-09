import { Component, inject } from '@angular/core';
import { NotificacionesService } from '../core/notificaciones.service';
import { IconoComponent } from './icono.component';

/**
 * Pila de notificaciones flotantes (esquina inferior derecha).
 */
@Component({
  selector: 'app-notificaciones',
  imports: [IconoComponent],
  template: `
    <div class="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-full max-w-sm flex-col gap-2">
      @for (n of servicio.lista(); track n.id) {
        <div class="pointer-events-auto flex gap-3 rounded-xl border p-3 text-sm shadow-lg"
             [class]="estilos[n.tipo]">
          <app-icono [nombre]="iconos[n.tipo]" [tamano]="18" />
          <div class="flex-1">
            <p class="font-medium">{{ n.mensaje }}</p>
            @if (n.detalle) { <p class="mt-1 text-xs opacity-80">{{ n.detalle }}</p> }
          </div>
          <button class="opacity-60 hover:opacity-100" (click)="servicio.cerrar(n.id)" aria-label="Cerrar"><app-icono nombre="cerrar" [tamano]="15" /></button>
        </div>
      }
    </div>
  `,
})
export class NotificacionesComponent {
  protected readonly servicio = inject(NotificacionesService);

  /** Colores por tipo */
  protected readonly estilos: Record<string, string> = {
    exito: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    error: 'border-red-200 bg-red-50 text-red-900',
    aviso: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
  };
  /** Íconos por tipo */
  protected readonly iconos: Record<string, string> = { exito: 'ok', error: 'alerta', aviso: 'info', info: 'info' };
}
