import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconoComponent } from '../../compartido/icono.component';
import { DocenteFormComponent, docenteAFormulario, docenteNuevo, FormDocente } from '../../compartido/docente-form.component';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { Docente } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';

/**
 * Catálogo de docentes con sus carreras (una o varias)
 * y las materias que puede dictar.
 */
@Component({
  selector: 'app-docentes',
  imports: [FormsModule, DocenteFormComponent, IconoComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">Docentes</h2>
        <p class="text-sm text-slate-500">Un docente puede pertenecer a varias carreras y dictar varias materias.</p>
      </div>
      <div class="flex w-full flex-wrap gap-2 sm:w-auto">
        <select class="campo w-full sm:!w-48" [ngModel]="carreraFiltro()" (ngModelChange)="carreraFiltro.set(+$event)">
          <option [ngValue]="0">Todas las carreras</option>
          @for (c of catalogos.carreras(); track c.id) { <option [ngValue]="c.id">{{ c.nombre }}</option> }
        </select>
        <input maxlength="60" class="campo min-w-0 flex-1 sm:!w-60 sm:flex-none" placeholder="Buscar…" [ngModel]="busqueda()" (ngModelChange)="busqueda.set($event)">
        @if (auth.puedeEditar()) { <button class="btn-primario" (click)="nuevo()"><app-icono nombre="agregar" [tamano]="16" /> Nuevo docente</button> }
      </div>
    </div>

    <div class="tarjeta overflow-x-auto">
      <table class="tabla">
        <thead><tr><th>Docente</th><th>Carnet</th><th>Contacto</th><th>Facultades</th><th>Materias</th><th></th></tr></thead>
        <tbody>
          @for (d of filtrados(); track d.id) {
            <tr [class.opacity-50]="!d.activo">
              <td class="font-medium">{{ d.apellidos }} {{ d.nombres }} @if (!d.activo) { <span class="chip bg-slate-200">inactivo</span> }</td>
              <td>{{ d.carnet }}</td>
              <td class="text-xs text-slate-500">{{ d.telefono }}<br>{{ d.correo }}</td>
              <td>
                <div class="flex flex-wrap gap-1">
                  @for (c of d.docente_carreras ?? []; track c.carrera_id) {
                    <span class="color-dinamico chip" [style.background]="colorCarrera(c.carrera_id) + '22'" [style.color]="colorCarrera(c.carrera_id)">{{ siglaCarrera(c.carrera_id) }}</span>
                  }
                </div>
              </td>
              <td class="max-w-xs text-xs text-slate-600">{{ textoMaterias(d) }}</td>
              <td class="text-right whitespace-nowrap">
                @if (auth.puedeEditar()) {
                  <button class="btn-fantasma btn-sm" (click)="editar(d)" title="Editar"><app-icono nombre="editar" [tamano]="16" /></button>
                  <button class="btn-fantasma btn-sm text-red-600" (click)="eliminar(d)" title="Eliminar"><app-icono nombre="eliminar" [tamano]="16" /></button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="py-8 text-center text-slate-500">Sin docentes.</td></tr>
          }
        </tbody>
      </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">{{ filtrados().length }} docente(s)</p>

    <app-docente-form [datos]="form()" (cerrar)="form.set(null)" (guardado)="form.set(null)" />
  `,
})
export class DocentesComponent {
  protected readonly auth = inject(AuthService);
  protected readonly catalogos = inject(CatalogosService);
  private readonly notificaciones = inject(NotificacionesService);

  protected readonly busqueda = signal('');
  protected readonly carreraFiltro = signal(0);
  protected readonly form = signal<FormDocente | null>(null);

  protected readonly filtrados = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    return this.catalogos.docentes().filter((d) =>
      (!this.carreraFiltro() || (d.docente_carreras ?? []).some((c) => c.carrera_id === this.carreraFiltro())) &&
      (!texto || `${d.apellidos} ${d.nombres} ${d.carnet ?? ''}`.toLowerCase().includes(texto)));
  });

  protected colorCarrera(id: number): string {
    return this.catalogos.mapaCarreras().get(id)?.color ?? '#64748b';
  }

  protected siglaCarrera(id: number): string {
    const c = this.catalogos.mapaCarreras().get(id);
    return c?.sigla || c?.nombre || '';
  }

  protected textoMaterias(d: Docente): string {
    return (d.docente_materias ?? []).map((m) => this.catalogos.mapaMaterias().get(m.materia_id)?.nombre).filter(Boolean).join(', ');
  }

  protected nuevo(): void {
    this.form.set(docenteNuevo());
  }

  protected editar(d: Docente): void {
    this.form.set(docenteAFormulario(d));
  }

  protected async eliminar(d: Docente): Promise<void> {
    if (!confirm(`¿Eliminar a ${d.apellidos} ${d.nombres}? Si tiene asignaciones, desactívelo en lugar de eliminarlo.`)) return;
    try {
      await this.catalogos.eliminar('docentes', d.id);
      this.notificaciones.exito('Docente eliminado.');
    } catch (e) {
      this.notificaciones.error(e, 'No se pudo eliminar (¿tiene asignaciones?). Puede marcarlo como inactivo');
    }
  }
}
