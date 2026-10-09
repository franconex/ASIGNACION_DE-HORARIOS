import { Component, inject, signal } from '@angular/core';
import { IconoComponent } from '../../compartido/icono.component';
import { AuthService } from '../../core/auth.service';
import { PanelesService } from '../../core/paneles.service';
import { PanelDiaComponent } from './panel-dia.component';
import { PanelSemanaComponent } from './panel-semana.component';

type Vista = 'semana' | 'dia';
const CLAVE_VISTA = 'laboratorios-vista-inicio';

/**
 * Inicio: centro del día. Dos vistas conmutables sobre la misma información:
 *  - Semana: horario tipo colegio de un laboratorio (ver y asignar en huecos).
 *  - Día: un horario y los laboratorios libres/ocupados en vivo.
 * Las acciones rápidas (asignar / evento) están siempre arriba.
 */
@Component({
  selector: 'app-panel',
  imports: [IconoComponent, PanelSemanaComponent, PanelDiaComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <!-- Conmutar Semana / Día -->
      <div class="inline-flex rounded-lg border border-slate-200 bg-superficie p-0.5 text-sm">
        <button class="flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition"
                [class]="vista() === 'semana' ? 'bg-marca-600 text-white' : 'text-slate-600 hover:bg-slate-100'" (click)="cambiar('semana')">
          <app-icono nombre="grilla" [tamano]="15" /> Semana
        </button>
        <button class="flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition"
                [class]="vista() === 'dia' ? 'bg-marca-600 text-white' : 'text-slate-600 hover:bg-slate-100'" (click)="cambiar('dia')">
          <app-icono nombre="hora" [tamano]="15" /> Día
        </button>
      </div>

      <!-- Acciones rápidas -->
      @if (auth.puedeEditar()) {
        <div class="flex gap-2">
          <button class="btn-primario" (click)="paneles.abrirAsignacion()"><app-icono nombre="nuevaClase" [tamano]="16" /> Asignar clase</button>
          <button class="btn-secundario" (click)="paneles.abrirReserva()"><app-icono nombre="evento" [tamano]="16" /> Evento</button>
        </div>
      }
    </div>

    @if (vista() === 'semana') { <app-panel-semana /> } @else { <app-panel-dia /> }
  `,
})
export class PanelComponent {
  protected readonly auth = inject(AuthService);
  protected readonly paneles = inject(PanelesService);

  protected readonly vista = signal<Vista>(this.leerVista());

  protected cambiar(vista: Vista): void {
    this.vista.set(vista);
    try {
      localStorage.setItem(CLAVE_VISTA, vista);
    } catch {
      // Sin almacenamiento: la vista dura solo esta sesión
    }
  }

  private leerVista(): Vista {
    try {
      return localStorage.getItem(CLAVE_VISTA) === 'dia' ? 'dia' : 'semana';
    } catch {
      return 'semana';
    }
  }
}
