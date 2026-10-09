import { Component, computed, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { IconoComponent } from '../../compartido/icono.component';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { fechaActual } from '../../core/fechas';
import { Ambiente } from '../../core/modelos';
import { PanelesService } from '../../core/paneles.service';
import { AmbientesComponent } from '../catalogos/ambientes.component';

/** Texto y color de cada estado de laboratorio */
const ESTADOS: Record<string, { texto: string; clase: string }> = {
  activo: { texto: 'Activo', clase: 'bg-emerald-50 text-emerald-700' },
  mantenimiento: { texto: 'Mantenimiento', clase: 'bg-amber-50 text-amber-800' },
  baja: { texto: 'De baja', clase: 'bg-slate-100 text-slate-500' },
};

/**
 * Apartado de laboratorios: directorio de tarjetas (toca una para ver su
 * horario, sus clases y su inventario de PCs) y, para editores, la tabla de
 * gestión (alta, edición, capacidad, color, estado).
 */
@Component({
  selector: 'app-laboratorios',
  imports: [IconoComponent, AmbientesComponent],
  template: `
    <header class="mb-4">
      <h1 class="text-2xl font-semibold tracking-tight">Laboratorios</h1>
      <p class="mt-0.5 text-slate-600">Toque un laboratorio para ver el croquis de sus PCs, su horario y sus clases.</p>
    </header>

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      @for (a of laboratorios(); track a.id) {
        <button class="tarjeta flex flex-col p-4 text-left transition hover:border-marca-300 hover:shadow-md"
                [style.border-top]="'3px solid ' + a.color" (click)="abrir(a)">
          <div class="flex items-start justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" [style.background]="a.color">
                <app-icono nombre="laboratorio" [tamano]="18" />
              </span>
              <div class="min-w-0">
                <p class="truncate font-semibold">{{ a.codigo }}</p>
                @if (a.nombre) { <p class="truncate text-xs text-slate-500">{{ a.nombre }}</p> }
              </div>
            </div>
            <span class="chip" [class]="estados[a.estado].clase">{{ estados[a.estado].texto }}</span>
          </div>

          <p class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
            <span class="inline-flex items-center gap-1"><app-icono nombre="usuarios" [tamano]="12" /> {{ a.capacidad }} puestos</span>
            @if (totalPcs(a.id)) {
              <span class="inline-flex items-center gap-1"><app-icono nombre="equipo" [tamano]="12" /> {{ pcsOperativas(a.id) }}/{{ totalPcs(a.id) }} PCs operativas</span>
            } @else if (a.tipo_equipo) {
              <span class="inline-flex items-center gap-1"><app-icono nombre="equipo" [tamano]="12" /> {{ a.tipo_equipo }}</span>
            }
            @if (a.ubicacion) { <span class="inline-flex items-center gap-1"><app-icono nombre="ubicacion" [tamano]="12" /> {{ a.ubicacion }}</span> }
          </p>
        </button>
      } @empty {
        <p class="tarjeta col-span-full p-8 text-center text-sm text-slate-500">No hay laboratorios cargados.</p>
      }
    </div>

    @if (auth.puedeEditar()) {
      <section class="mt-8 border-t border-slate-200 pt-6">
        <app-ambientes />
      </section>
    }
  `,
})
export class LaboratoriosComponent {
  protected readonly auth = inject(AuthService);
  protected readonly catalogos = inject(CatalogosService);
  private readonly paneles = inject(PanelesService);

  protected readonly estados = ESTADOS;
  private readonly hoy = fechaActual(environment.zonaHoraria);

  protected readonly laboratorios = computed(() => this.catalogos.laboratorios());

  protected totalPcs(id: number): number {
    return this.catalogos.pcsPorAmbiente().get(id)?.length ?? 0;
  }

  protected pcsOperativas(id: number): number {
    return (this.catalogos.pcsPorAmbiente().get(id) ?? []).filter((pc) => pc.estado === 'operativa').length;
  }

  protected abrir(a: Ambiente): void {
    this.paneles.abrirLaboratorio(a.id, this.hoy, 'croquis');
  }
}
