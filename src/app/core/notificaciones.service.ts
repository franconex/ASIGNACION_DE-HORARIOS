import { Injectable, signal } from '@angular/core';
import { ErrorSistema } from './supabase.service';

/** Tipo visual de la notificación */
export type TipoNotificacion = 'exito' | 'error' | 'aviso' | 'info';

export interface Notificacion {
  id: number;
  tipo: TipoNotificacion;
  mensaje: string;
  detalle?: string | null;
}

/**
 * Notificaciones flotantes (toasts) para avisar éxitos y errores.
 */
@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  /** Notificaciones visibles */
  readonly lista = signal<Notificacion[]>([]);
  private contador = 0;

  /** Muestra una notificación que se cierra sola */
  mostrar(tipo: TipoNotificacion, mensaje: string, detalle?: string | null, duracionMs = 5000): void {
    const id = ++this.contador;
    this.lista.update((actual) => [...actual, { id, tipo, mensaje, detalle }]);
    setTimeout(() => this.cerrar(id), tipo === 'error' ? Math.max(duracionMs, 9000) : duracionMs);
  }

  exito(mensaje: string): void { this.mostrar('exito', mensaje); }
  aviso(mensaje: string): void { this.mostrar('aviso', mensaje); }

  /** Muestra un error de cualquier tipo con su sugerencia si existe */
  error(error: unknown, prefijo = ''): void {
    const mensaje = error instanceof Error ? error.message : String(error);
    const sugerencia = error instanceof ErrorSistema ? error.sugerencia : null;
    this.mostrar('error', prefijo ? `${prefijo}: ${mensaje}` : mensaje, sugerencia);
    console.error(error);
  }

  /** Cierra una notificación */
  cerrar(id: number): void {
    this.lista.update((actual) => actual.filter((n) => n.id !== id));
  }
}
