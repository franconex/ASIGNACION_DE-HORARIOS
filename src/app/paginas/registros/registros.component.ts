import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { MenuSeccionesComponent, SeccionMenu } from '../../compartido/menu-secciones.component';
import { AsignacionesListaComponent } from '../asignaciones/asignaciones-lista.component';
import { CesionesListaComponent } from '../cesiones/cesiones-lista.component';
import { ConflictosComponent } from '../conflictos/conflictos.component';
import { ReservasListaComponent } from '../reservas/reservas-lista.component';

/** Secciones disponibles */
type Pestana = 'asignaciones' | 'cesiones' | 'eventos' | 'conflictos';

/**
 * Registros: primero un menú de tarjetas y, al tocar una, su lista
 * (asignaciones, cesiones, eventos/defensas o conflictos).
 * La sección abierta queda en la URL (?pestana=cesiones): "atrás" vuelve al menú.
 */
@Component({
  selector: 'app-registros',
  imports: [MenuSeccionesComponent, AsignacionesListaComponent, CesionesListaComponent, ReservasListaComponent, ConflictosComponent],
  template: `
    <app-menu-secciones titulo="Registros" subtitulo="Elija qué quiere ver." [secciones]="secciones" [seccionActual]="actual()"
                        (elegir)="cambiar($event)" (volver)="cambiar(null)" />
    @switch (actual()?.clave) {
      @case ('asignaciones') { <app-asignaciones-lista /> }
      @case ('cesiones') { <app-cesiones-lista /> }
      @case ('eventos') { <app-reservas-lista /> }
      @case ('conflictos') { <app-conflictos /> }
    }
  `,
})
export class RegistrosComponent {
  private readonly router = inject(Router);

  /** Sección abierta, desde la URL (?pestana=cesiones) */
  readonly pestana = input<string>();

  protected readonly secciones: SeccionMenu<Pestana>[] = [
    { clave: 'asignaciones', texto: 'Asignaciones', descripcion: 'Clases asignadas a los laboratorios', icono: 'asignacion' },
    { clave: 'cesiones', texto: 'Cesiones', descripcion: 'Horarios cedidos a otro docente', icono: 'ceder' },
    { clave: 'eventos', texto: 'Eventos y defensas', descripcion: 'Eventos, defensas y mantenimientos', icono: 'evento' },
    { clave: 'conflictos', texto: 'Conflictos', descripcion: 'Choques de laboratorio o de docente', icono: 'alerta' },
  ];
  protected readonly actual = computed(() => this.secciones.find((s) => s.clave === this.pestana()) ?? null);

  /** Abre una sección (o vuelve al menú) dejándola en el historial del navegador */
  protected cambiar(clave: string | null): void {
    void this.router.navigate([], { queryParams: { pestana: clave } });
  }
}
