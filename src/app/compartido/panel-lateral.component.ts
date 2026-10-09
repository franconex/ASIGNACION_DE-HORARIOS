import { Component, computed, HostListener, inject } from '@angular/core';
import { PanelesService } from '../core/paneles.service';
import { AsignacionFormComponent } from '../paginas/asignaciones/asignacion-form.component';
import { CesionFormComponent } from '../paginas/cesiones/cesion-form.component';
import { LaboratorioDetalleComponent } from '../paginas/panel/laboratorio-detalle.component';
import { ReservaFormComponent } from '../paginas/reservas/reserva-form.component';

/**
 * Contenedor de los paneles laterales (se desliza desde la derecha).
 * Muestra el panel de arriba de la pila: laboratorio, asignación, cesión o reserva.
 */
@Component({
  selector: 'app-panel-lateral',
  imports: [AsignacionFormComponent, CesionFormComponent, ReservaFormComponent, LaboratorioDetalleComponent],
  template: `
    @if (paneles.actual(); as p) {
      <div class="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" (click)="paneles.cerrar()"></div>
      <aside class="panel-entrada fixed inset-y-0 right-0 z-40 flex w-full flex-col bg-superficie shadow-2xl" [class]="ancho()">
        @if (paneles.pila().length > 1) {
          <button class="absolute top-0 left-0 z-10 -translate-x-full rounded-l-lg bg-superficie px-2 py-1 text-xs text-slate-600 shadow"
                  (click)="paneles.cerrar()">← Volver</button>
        }
        <!-- La clave fuerza a recrear el componente al cambiar de panel -->
        @for (panel of [p]; track paneles.pila().length) {
          @switch (panel.tipo) {
            @case ('laboratorio') {
              @if (panel.tipo === 'laboratorio') { <app-laboratorio-detalle class="h-full" [ambienteId]="panel.ambienteId" [fecha]="panel.fecha" [pestanaInicial]="panel.pestana ?? 'horario'" /> }
            }
            @case ('asignacion') {
              @if (panel.tipo === 'asignacion') { <app-asignacion-form class="h-full" [id]="panel.id" [prellenado]="panel.prellenado" /> }
            }
            @case ('reserva') {
              @if (panel.tipo === 'reserva') { <app-reserva-form class="h-full" [id]="panel.id" [prellenado]="panel.prellenado" /> }
            }
            @case ('cesion') {
              @if (panel.tipo === 'cesion') {
                <app-cesion-form class="h-full" [id]="panel.id" [asignacionInicial]="panel.asignacionId"
                                 [horarioInicial]="panel.horarioId" [fechaInicial]="panel.fecha" />
              }
            }
          }
        }
      </aside>
    }
  `,
  styles: `
    .panel-entrada { animation: entrar 0.18s ease-out; }
    @keyframes entrar { from { transform: translateX(40px); opacity: 0.4; } to { transform: none; opacity: 1; } }
  `,
})
export class PanelLateralComponent {
  protected readonly paneles = inject(PanelesService);

  /** Ancho según el tipo de panel */
  protected readonly ancho = computed(() => (this.paneles.actual()?.tipo === 'cesion' ? 'max-w-4xl' : 'max-w-5xl'));

  /** Escape cierra el panel de arriba (si no hay un modal abierto encima) */
  @HostListener('document:keydown.escape')
  protected alPresionarEscape(): void {
    if (this.paneles.actual() && !document.querySelector('app-modal .fixed')) this.paneles.cerrar();
  }
}
