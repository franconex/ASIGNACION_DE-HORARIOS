import { Component, effect, ElementRef, inject, viewChild } from '@angular/core';
import { ConfirmacionService } from '../core/confirmacion.service';
import { IconoComponent } from './icono.component';

/**
 * Ventana de alerta para confirmar acciones (sobre todo eliminar): dice qué
 * se va a hacer, qué pasará después y si se puede deshacer. Va una sola vez
 * en la raíz de la app y se abre con ConfirmacionService.pedir().
 */
@Component({
  selector: 'app-confirmacion',
  imports: [IconoComponent],
  host: { '(document:keydown.escape)': 'cancelar()' },
  template: `
    @if (servicio.actual(); as c) {
      <div class="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]" (mousedown)="cancelar()">
        <div class="tarjeta w-full max-w-md overflow-hidden shadow-2xl" role="alertdialog" aria-modal="true"
             aria-labelledby="confirmacion-titulo" aria-describedby="confirmacion-mensaje" (mousedown)="$event.stopPropagation()">
          <div class="flex gap-3 p-5">
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                  [class]="c.peligro ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'">
              <app-icono [nombre]="c.peligro ? 'eliminar' : 'alerta'" [tamano]="22" />
            </span>
            <div class="min-w-0 flex-1">
              <h2 id="confirmacion-titulo" class="text-lg font-semibold text-slate-800">{{ c.titulo }}</h2>
              <p id="confirmacion-mensaje" class="mt-1 text-sm text-slate-600">{{ c.mensaje }}</p>
              @if (c.consecuencias?.length) {
                <ul class="mt-3 space-y-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                  @for (linea of c.consecuencias; track $index) {
                    <li class="flex gap-2"><span class="text-slate-400">•</span><span>{{ linea }}</span></li>
                  }
                </ul>
              }
              @if (c.peligro) {
                <p class="mt-3 flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  <app-icono nombre="alerta" [tamano]="16" /> Esta acción no se puede deshacer.
                </p>
              }
            </div>
          </div>
          <div class="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 sm:flex-row sm:justify-end">
            <button #botonCancelar class="btn-secundario justify-center" (click)="cancelar()">Cancelar</button>
            <button class="justify-center" [class]="c.peligro ? 'btn-primario !bg-red-600 hover:!bg-red-700' : 'btn-primario'" (click)="servicio.responderCon(true)">
              @if (c.peligro) { <app-icono nombre="eliminar" [tamano]="16" /> } {{ c.aceptar }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class ConfirmacionComponent {
  protected readonly servicio = inject(ConfirmacionService);
  private readonly botonCancelar = viewChild<ElementRef<HTMLButtonElement>>('botonCancelar');

  constructor() {
    // El foco empieza en Cancelar: un Enter apurado no borra nada
    effect(() => this.botonCancelar()?.nativeElement.focus());
  }

  protected cancelar(): void {
    if (this.servicio.actual()) this.servicio.responderCon(false);
  }
}
