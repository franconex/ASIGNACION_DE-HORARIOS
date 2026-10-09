import { Component, inject } from '@angular/core';
import { CampoCrud, ColumnaCrud, CrudTablaComponent } from '../../compartido/crud-tabla.component';
import { CatalogosService } from '../../core/catalogos.service';
import { fechaLarga } from '../../core/fechas';

/** Feriados: en estas fechas no se generan clases */
@Component({
  selector: 'app-feriados',
  imports: [CrudTablaComponent],
  template: `
    <app-crud-tabla titulo="Feriados" descripcion="En estas fechas no se generan clases ni se pueden marcar en el calendario."
                    tabla="feriados" clavePrimaria="fecha" [filas]="catalogos.feriados()" [campos]="campos" [columnas]="columnas" />
  `,
})
export class FeriadosComponent {
  protected readonly catalogos = inject(CatalogosService);

  protected readonly campos: CampoCrud[] = [
    { clave: 'fecha', etiqueta: 'Fecha', tipo: 'fecha', requerido: true, soloAlCrear: true },
    { clave: 'descripcion', etiqueta: 'Descripción', tipo: 'texto', requerido: true },
  ];
  protected readonly columnas: ColumnaCrud[] = [
    { clave: 'fecha', etiqueta: 'Fecha', formato: (f) => fechaLarga(String(f['fecha'])) },
    { clave: 'descripcion', etiqueta: 'Descripción' },
  ];
}
