import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CampoCrud, ColumnaCrud, CrudTablaComponent } from '../../compartido/crud-tabla.component';
import { FormMateria, materiaAFormulario, MateriaFormComponent, materiaNueva } from '../../compartido/materia-form.component';
import { Materia } from '../../core/modelos';
import { CatalogosService } from '../../core/catalogos.service';
import { NotificacionesService } from '../../core/notificaciones.service';
import { ErrorSistema, SupabaseService } from '../../core/supabase.service';

/** -1 = materias que todavía no se dictan en ninguna facultad */
const SIN_FACULTAD = -1;

/**
 * Catálogo general de materias. La materia no tiene facultad propia: la
 * facultad sale de sus asignaciones (dónde se dicta), y por eso se puede
 * filtrar por facultad, por si requiere laboratorio y por estado.
 */
@Component({
  selector: 'app-materias',
  imports: [CrudTablaComponent, MateriaFormComponent, FormsModule],
  template: `
    <app-crud-tabla titulo="Materias" descripcion="Catálogo general de materias. La facultad sale de las asignaciones donde se dicta."
                    tabla="materias" [filas]="filtradas()" [campos]="campos" [columnas]="columnas" [claveFiltros]="claveFiltros()"
                    [editorPropio]="true" (pedirNuevo)="form.set(nueva())" (pedirEditar)="form.set(aFormulario($event))">
      <ng-container filtros>
        <select class="campo w-full sm:!w-52" [ngModel]="facultad()" (ngModelChange)="facultad.set(+$event)" aria-label="Filtrar por facultad">
          <option [ngValue]="0">Todas las facultades</option>
          @for (c of catalogos.carreras(); track c.id) { <option [ngValue]="c.id">{{ c.nombre }}</option> }
          <option [ngValue]="sinFacultad">Sin facultad (sin asignaciones)</option>
        </select>
        <select class="campo w-[calc(50%-0.25rem)] sm:!w-40" [ngModel]="laboratorio()" (ngModelChange)="laboratorio.set($event)" aria-label="Filtrar por laboratorio">
          <option value="">Con y sin laboratorio</option>
          <option value="si">Requiere laboratorio</option>
          <option value="no">No requiere</option>
        </select>
        <select class="campo w-[calc(50%-0.25rem)] sm:!w-32" [ngModel]="estado()" (ngModelChange)="estado.set($event)" aria-label="Filtrar por estado">
          <option value="">Todas</option>
          <option value="activas">Activas</option>
          <option value="inactivas">Inactivas</option>
        </select>
      </ng-container>
    </app-crud-tabla>
    <app-materia-form [datos]="form()" (cerrar)="form.set(null)" (guardado)="form.set(null)" />
  `,
})
export class MateriasComponent {
  protected readonly catalogos = inject(CatalogosService);
  private readonly supabase = inject(SupabaseService);
  private readonly notificaciones = inject(NotificacionesService);
  /** Materia abierta en el modal (null = cerrado); el modal es el mismo del alta rápida */
  protected readonly form = signal<FormMateria | null>(null);
  protected readonly nueva = () => materiaNueva();
  protected aFormulario(fila: Record<string, unknown>): FormMateria {
    return materiaAFormulario(fila as unknown as Materia);
  }

  protected readonly sinFacultad = SIN_FACULTAD;
  /** Filtros: facultad (0 = todas), laboratorio ('' | 'si' | 'no') y estado ('' | 'activas' | 'inactivas') */
  protected readonly facultad = signal(0);
  protected readonly laboratorio = signal('');
  protected readonly estado = signal('');
  protected readonly claveFiltros = computed(() => `${this.facultad()}|${this.laboratorio()}|${this.estado()}`);

  /** Facultades donde se dicta cada materia (materia_id -> ids de facultad) */
  private readonly facultadesPorMateria = signal(new Map<number, Set<number>>());

  protected readonly filtradas = computed(() => {
    const f = this.facultad();
    const lab = this.laboratorio();
    const estado = this.estado();
    const mapa = this.facultadesPorMateria();
    return this.catalogos.materias().filter((m) =>
      (!f || (f === SIN_FACULTAD ? !mapa.get(m.id)?.size : !!mapa.get(m.id)?.has(f))) &&
      (!lab || m.requiere_laboratorio === (lab === 'si')) &&
      (!estado || m.activo === (estado === 'activas')));
  });

  constructor() {
    // Se relee al cambiar las materias (alta o edición)
    effect(() => {
      this.catalogos.materias();
      untracked(() => void this.cargarFacultades());
    });
  }

  private async cargarFacultades(): Promise<void> {
    const { data, error } = await this.supabase.cliente.from('asignaciones').select('materia_id, carrera_id');
    if (error) return this.notificaciones.error(new ErrorSistema(error), 'No se cargaron las facultades de las materias');
    const mapa = new Map<number, Set<number>>();
    for (const a of (data ?? []) as { materia_id: number; carrera_id: number | null }[]) {
      if (a.carrera_id === null) continue;
      if (!mapa.has(a.materia_id)) mapa.set(a.materia_id, new Set());
      mapa.get(a.materia_id)!.add(a.carrera_id);
    }
    this.facultadesPorMateria.set(mapa);
  }

  /** "MED, ODO" (siglas de las facultades donde se dicta) */
  private textoFacultades(id: number): string {
    return [...(this.facultadesPorMateria().get(id) ?? [])]
      .map((c) => { const x = this.catalogos.mapaCarreras().get(c); return x?.sigla || x?.nombre || ''; })
      .filter(Boolean).sort().join(', ');
  }

  protected readonly campos: CampoCrud[] = [
    { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, completo: true },
    { clave: 'sigla', etiqueta: 'Sigla', tipo: 'texto' },
    { clave: 'requiere_laboratorio', etiqueta: 'Requiere laboratorio', tipo: 'check' },
    { clave: 'activo', etiqueta: 'Activa', tipo: 'check' },
  ];
  protected readonly columnas: ColumnaCrud[] = [
    { clave: 'nombre', etiqueta: 'Nombre' },
    { clave: 'sigla', etiqueta: 'Sigla' },
    { clave: 'facultades', etiqueta: 'Facultades', formato: (fila) => this.textoFacultades(fila['id'] as number) || '—' },
    { clave: 'requiere_laboratorio', etiqueta: 'Laboratorio', tipo: 'check' },
    { clave: 'activo', etiqueta: 'Activa', tipo: 'check' },
  ];
}
