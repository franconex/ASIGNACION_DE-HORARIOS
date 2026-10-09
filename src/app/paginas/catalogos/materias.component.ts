import { Component, inject } from '@angular/core';
import { CampoCrud, ColumnaCrud, CrudTablaComponent } from '../../compartido/crud-tabla.component';
import { CatalogosService } from '../../core/catalogos.service';

/** Catálogo general de materias */
@Component({
  selector: 'app-materias',
  imports: [CrudTablaComponent],
  template: `
    <app-crud-tabla titulo="Materias" descripcion="Catálogo general de materias. La carrera se indica en cada asignación."
                    tabla="materias" [filas]="catalogos.materias()" [campos]="campos" [columnas]="columnas"
                    [valoresNuevos]="{ requiere_laboratorio: true, activo: true }" />
  `,
})
export class MateriasComponent {
  protected readonly catalogos = inject(CatalogosService);

  protected readonly campos: CampoCrud[] = [
    { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, completo: true },
    { clave: 'sigla', etiqueta: 'Sigla', tipo: 'texto' },
    { clave: 'requiere_laboratorio', etiqueta: 'Requiere laboratorio', tipo: 'check' },
    { clave: 'activo', etiqueta: 'Activa', tipo: 'check' },
  ];
  protected readonly columnas: ColumnaCrud[] = [
    { clave: 'nombre', etiqueta: 'Nombre' },
    { clave: 'sigla', etiqueta: 'Sigla' },
    { clave: 'requiere_laboratorio', etiqueta: 'Laboratorio', tipo: 'check' },
    { clave: 'activo', etiqueta: 'Activa', tipo: 'check' },
  ];
}
