import { computed, Injectable, signal } from '@angular/core';

/** Datos para prellenar una asignación nueva */
export interface PrellenadoAsignacion {
  ambienteId?: number | null;
  dia?: number | null;
  fecha?: string | null;
  horaInicio?: string | null;
  horaFin?: string | null;
}

/** Datos para prellenar una reserva nueva */
export interface PrellenadoReserva {
  tipoId?: number | null;
  ambienteId?: number | null;
  fecha?: string | null;
  horaInicio?: string | null;
  horaFin?: string | null;
}

/** Pestaña con la que se abre el detalle de un laboratorio */
export type PestanaLaboratorio = 'croquis' | 'horario';

/** Panel lateral abierto (formularios y detalle de laboratorio) */
export type Panel =
  | { tipo: 'laboratorio'; ambienteId: number; fecha: string; pestana?: PestanaLaboratorio }
  | { tipo: 'asignacion'; id?: number | null; prellenado?: PrellenadoAsignacion }
  | { tipo: 'reserva'; id?: number | null; prellenado?: PrellenadoReserva }
  | { tipo: 'cesion'; id?: number | null; asignacionId?: number | null; horarioId?: number | null; fecha?: string | null };

/**
 * Paneles laterales: cualquier pantalla puede abrir un formulario sin
 * cambiar de página. Los paneles se apilan (ej. laboratorio -> ceder) y al
 * cerrar el de arriba se vuelve al anterior.
 */
@Injectable({ providedIn: 'root' })
export class PanelesService {
  /** Pila de paneles abiertos */
  readonly pila = signal<Panel[]>([]);
  /** Panel visible (el de arriba) */
  readonly actual = computed(() => this.pila().at(-1) ?? null);
  /** Aumenta cada vez que se guarda algo: las pantallas lo observan para recargar */
  readonly cambios = signal(0);

  /** Abre un panel encima de los actuales */
  abrir(panel: Panel): void {
    this.pila.update((p) => [...p, panel]);
  }

  abrirLaboratorio(ambienteId: number, fecha: string, pestana: PestanaLaboratorio = 'horario'): void {
    this.abrir({ tipo: 'laboratorio', ambienteId, fecha, pestana });
  }

  abrirAsignacion(id?: number | null, prellenado?: PrellenadoAsignacion): void {
    this.abrir({ tipo: 'asignacion', id, prellenado });
  }

  abrirReserva(id?: number | null, prellenado?: PrellenadoReserva): void {
    this.abrir({ tipo: 'reserva', id, prellenado });
  }

  abrirCesion(datos: { id?: number | null; asignacionId?: number | null; horarioId?: number | null; fecha?: string | null }): void {
    this.abrir({ tipo: 'cesion', ...datos });
  }

  /** Cierra el panel de arriba */
  cerrar(): void {
    this.pila.update((p) => p.slice(0, -1));
  }

  /** Cierra todos los paneles */
  cerrarTodos(): void {
    this.pila.set([]);
  }

  /** Avisa que se guardó algo y cierra el panel de arriba */
  guardado(): void {
    this.cambios.update((c) => c + 1);
    this.cerrar();
  }

  /** Avisa que algo cambió sin cerrar paneles */
  notificarCambio(): void {
    this.cambios.update((c) => c + 1);
  }
}
