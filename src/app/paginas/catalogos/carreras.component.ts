import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CampoCrud, ColumnaCrud, CrudTablaComponent } from '../../compartido/crud-tabla.component';
import { CatalogosService } from '../../core/catalogos.service';

/** Catálogo de facultades (tabla "carreras") */
@Component({
  selector: 'app-carreras',
  imports: [CrudTablaComponent, FormsModule],
  template: `
    <app-crud-tabla titulo="Facultades" descripcion="Facultades de la universidad. El color se usa en el calendario."
                    tabla="carreras" [filas]="filtradas()" [campos]="campos" [columnas]="columnas" [claveFiltros]="estado()"
                    [valoresNuevos]="{ color: '#2563eb', activo: true }">
      <select filtros class="campo w-full sm:!w-36" [ngModel]="estado()" (ngModelChange)="estado.set($event)" aria-label="Filtrar por estado">
        <option value="">Todas</option>
        <option value="activas">Activas</option>
        <option value="inactivas">Inactivas</option>
      </select>
    </app-crud-tabla>
  `,
})
export class CarrerasComponent {
  protected readonly catalogos = inject(CatalogosService);
  /** '' = todas · 'activas' · 'inactivas' */
  protected readonly estado = signal('');
  protected readonly filtradas = computed(() =>
    this.catalogos.carreras().filter((c) => !this.estado() || c.activo === (this.estado() === 'activas')));

  protected readonly campos: CampoCrud[] = [
    { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, completo: true },
    { clave: 'sigla', etiqueta: 'Sigla', tipo: 'texto' },
    { clave: 'color', etiqueta: 'Color', tipo: 'color' },
    { clave: 'activo', etiqueta: 'Activa', tipo: 'check' },
  ];
  protected readonly columnas: ColumnaCrud[] = [
    { clave: 'color', etiqueta: '', tipo: 'color' },
    { clave: 'nombre', etiqueta: 'Nombre' },
    { clave: 'sigla', etiqueta: 'Sigla', tipo: 'chip' },
    { clave: 'activo', etiqueta: 'Activa', tipo: 'check' },
  ];
}
