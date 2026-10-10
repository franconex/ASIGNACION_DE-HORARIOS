import { Component, inject, signal } from '@angular/core';
import { CampoCrud, ColumnaCrud, CrudTablaComponent } from '../../compartido/crud-tabla.component';
import { FormMateria, materiaAFormulario, MateriaFormComponent, materiaNueva } from '../../compartido/materia-form.component';
import { Materia } from '../../core/modelos';
import { CatalogosService } from '../../core/catalogos.service';

/** Catálogo general de materias */
@Component({
  selector: 'app-materias',
  imports: [CrudTablaComponent, MateriaFormComponent],
  template: `
    <app-crud-tabla titulo="Materias" descripcion="Catálogo general de materias. La carrera se indica en cada asignación."
                    tabla="materias" [filas]="catalogos.materias()" [campos]="campos" [columnas]="columnas"
                    [editorPropio]="true" (pedirNuevo)="form.set(nueva())" (pedirEditar)="form.set(aFormulario($event))" />
    <app-materia-form [datos]="form()" (cerrar)="form.set(null)" (guardado)="form.set(null)" />
  `,
})
export class MateriasComponent {
  protected readonly catalogos = inject(CatalogosService);
  /** Materia abierta en el modal (null = cerrado); el modal es el mismo del alta rápida */
  protected readonly form = signal<FormMateria | null>(null);
  protected readonly nueva = () => materiaNueva();
  protected aFormulario(fila: Record<string, unknown>): FormMateria {
    return materiaAFormulario(fila as unknown as Materia);
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
    { clave: 'requiere_laboratorio', etiqueta: 'Laboratorio', tipo: 'check' },
    { clave: 'activo', etiqueta: 'Activa', tipo: 'check' },
  ];
}
