import { Component, inject } from '@angular/core';
import { CampoCrud, ColumnaCrud, CrudTablaComponent } from '../../compartido/crud-tabla.component';
import { CatalogosService } from '../../core/catalogos.service';

/** Catálogo de laboratorios */
@Component({
  selector: 'app-ambientes',
  imports: [CrudTablaComponent],
  template: `
    <app-crud-tabla titulo="Administrar laboratorios"
                    descripcion="Alta, edición y estado de los laboratorios. Use «En mantenimiento» para bloquearlo un tiempo o «De baja» para retirarlo."
                    tabla="ambientes" [filas]="catalogos.ambientes()" [campos]="campos" [columnas]="columnas"
                    [valoresNuevos]="{ tipo: 'laboratorio', estado: 'activo', capacidad: 30, color: '#2563eb', orden: 0 }" />
  `,
})
export class AmbientesComponent {
  protected readonly catalogos = inject(CatalogosService);

  protected readonly campos: CampoCrud[] = [
    { clave: 'codigo', etiqueta: 'Código', tipo: 'texto', requerido: true, ayuda: 'Ej: LAB-11' },
    { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto' },
    {
      clave: 'estado', etiqueta: 'Estado', tipo: 'select', requerido: true, opciones: [
        { valor: 'activo', texto: 'Activo' }, { valor: 'mantenimiento', texto: 'En mantenimiento' }, { valor: 'baja', texto: 'De baja' },
      ],
    },
    { clave: 'capacidad', etiqueta: 'Capacidad (puestos)', tipo: 'numero', requerido: true },
    { clave: 'tipo_equipo', etiqueta: 'Equipos (nota general)', tipo: 'texto', ayuda: 'El detalle de cada PC se agrega al abrir el laboratorio desde Inicio.' },
    { clave: 'ubicacion', etiqueta: 'Ubicación', tipo: 'texto' },
    { clave: 'orden', etiqueta: 'Orden en pantalla', tipo: 'numero' },
    { clave: 'color', etiqueta: 'Color', tipo: 'color' },
  ];
  protected readonly columnas: ColumnaCrud[] = [
    { clave: 'color', etiqueta: '', tipo: 'color' },
    { clave: 'codigo', etiqueta: 'Código' },
    { clave: 'capacidad', etiqueta: 'Capacidad' },
    { clave: 'pcs', etiqueta: 'PCs', formato: (fila) => this.resumenPcs(Number(fila['id'])) },
    { clave: 'tipo_equipo', etiqueta: 'Equipos' },
    { clave: 'ubicacion', etiqueta: 'Ubicación' },
    { clave: 'estado', etiqueta: 'Estado', tipo: 'chip' },
  ];

  /** "28/30" operativas/total; "—" si no hay PCs cargadas en el laboratorio */
  protected resumenPcs(ambienteId: number): string {
    const pcs = this.catalogos.pcs().filter((p) => p.ambiente_id === ambienteId);
    if (!pcs.length) return '—';
    return `${pcs.filter((p) => p.estado === 'operativa').length}/${pcs.length}`;
  }
}
