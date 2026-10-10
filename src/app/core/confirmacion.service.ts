import { Injectable, signal } from '@angular/core';

/** Lo que muestra la ventana de confirmación */
export interface Confirmacion {
  titulo: string;
  /** Qué se va a hacer (en una frase) */
  mensaje: string;
  /** Qué pasará después: una línea por punto */
  consecuencias?: string[];
  /** Texto del botón para aceptar (por defecto "Sí, eliminar") */
  aceptar?: string;
  /** Rojo y con aviso de que no se puede deshacer (por defecto true) */
  peligro?: boolean;
}

/**
 * Ventana de confirmación propia (en lugar del confirm() del navegador),
 * para que antes de aceptar se lea claro qué se va a hacer.
 * Uso: if (!(await confirmacion.pedir({ titulo, mensaje }))) return;
 */
@Injectable({ providedIn: 'root' })
export class ConfirmacionService {
  /** Confirmación visible (null = cerrada) */
  readonly actual = signal<Confirmacion | null>(null);
  private responder: ((ok: boolean) => void) | null = null;

  pedir(datos: Confirmacion): Promise<boolean> {
    // Si había otra abierta, se toma como cancelada
    this.responder?.(false);
    this.actual.set({ aceptar: 'Sí, eliminar', peligro: true, ...datos });
    return new Promise<boolean>((resolver) => (this.responder = resolver));
  }

  /** La llama la ventana al elegir */
  responderCon(ok: boolean): void {
    this.responder?.(ok);
    this.responder = null;
    this.actual.set(null);
  }
}
