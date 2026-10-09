import { Component, inject, input, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IconoComponent } from '../../compartido/icono.component';
import { AsignacionesListaComponent } from '../asignaciones/asignaciones-lista.component';
import { CesionesListaComponent } from '../cesiones/cesiones-lista.component';
import { ConflictosComponent } from '../conflictos/conflictos.component';
import { ReservasListaComponent } from '../reservas/reservas-lista.component';

/** Pestañas disponibles */
type Pestana = 'asignaciones' | 'cesiones' | 'eventos' | 'conflictos';

/**
 * Registros en una sola pantalla con pestañas:
 * asignaciones, cesiones, eventos/defensas y conflictos.
 */
@Component({
  selector: 'app-registros',
  imports: [IconoComponent, AsignacionesListaComponent, CesionesListaComponent, ReservasListaComponent, ConflictosComponent],
  template: `
    <h1 class="mb-4 text-2xl font-bold">Registros</h1>
    <nav class="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
      @for (p of pestanas; track p.clave) {
        <button class="-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition"
                [class]="activa() === p.clave ? 'border-marca-600 text-marca-700' : 'border-transparent text-slate-500 hover:text-slate-800'"
                (click)="cambiar(p.clave)">
          <app-icono [nombre]="p.icono" [tamano]="16" /> {{ p.texto }}
        </button>
      }
    </nav>
    @switch (activa()) {
      @case ('asignaciones') { <app-asignaciones-lista /> }
      @case ('cesiones') { <app-cesiones-lista /> }
      @case ('eventos') { <app-reservas-lista /> }
      @case ('conflictos') { <app-conflictos /> }
    }
  `,
})
export class RegistrosComponent implements OnInit {
  private readonly router = inject(Router);

  /** Pestaña inicial desde la URL (?pestana=cesiones) */
  readonly pestana = input<string>();
  protected readonly activa = signal<Pestana>('asignaciones');

  protected readonly pestanas: { clave: Pestana; texto: string; icono: string }[] = [
    { clave: 'asignaciones', texto: 'Asignaciones', icono: 'asignacion' },
    { clave: 'cesiones', texto: 'Cesiones', icono: 'ceder' },
    { clave: 'eventos', texto: 'Eventos y defensas', icono: 'evento' },
    { clave: 'conflictos', texto: 'Conflictos', icono: 'alerta' },
  ];

  ngOnInit(): void {
    const inicial = this.pestanas.find((p) => p.clave === this.pestana());
    if (inicial) this.activa.set(inicial.clave);
  }

  /** Cambia de pestaña y la deja en la URL */
  protected cambiar(clave: Pestana): void {
    this.activa.set(clave);
    void this.router.navigate([], { queryParams: { pestana: clave }, replaceUrl: true });
  }
}
