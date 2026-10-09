import { Component } from '@angular/core';
import { AtencionesListaComponent } from './atenciones-lista.component';

/** Página de Atenciones (tickets): encabezado + la lista con alta, estados y export. */
@Component({
  selector: 'app-atenciones',
  imports: [AtencionesListaComponent],
  template: `
    <header class="mb-4">
      <h1 class="text-2xl font-bold">Atenciones</h1>
      <p class="mt-0.5 text-sm text-slate-600">Atención a docentes, trabajos técnicos (programas y mantenimiento preventivo o correctivo) y atención personal.</p>
    </header>
    <app-atenciones-lista />
  `,
})
export class AtencionesComponent {}
