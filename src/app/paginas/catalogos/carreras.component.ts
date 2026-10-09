import { Component, inject } from '@angular/core';
import { CampoCrud, ColumnaCrud, CrudTablaComponent } from '../../compartido/crud-tabla.component';
import { CatalogosService } from '../../core/catalogos.service';

/** Catálogo de facultades (tabla "carreras") */
@Component({
  selector: 'app-carreras',
  imports: [CrudTablaComponent],
  template: `
    <app-crud-tabla titulo="Facultades" descripcion="Facultades de la universidad. El color se usa en el calendario."
                    tabla="carreras" [filas]="catalogos.carreras()" [campos]="campos" [columnas]="columnas"
                    [valoresNuevos]="{ color: '#2563eb', activo: true }" />
  `,
})
export class CarrerasComponent {
  protected readonly catalogos = inject(CatalogosService);

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
