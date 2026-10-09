import { Injectable, signal } from '@angular/core';

/** Modo de color de la interfaz */
export type ModoTema = 'claro' | 'oscuro';

const CLAVE = 'laboratorios-tema';

/**
 * Modo claro / oscuro. Se guarda en el navegador; la primera vez sigue la
 * preferencia del sistema operativo. Aplica la clase "oscuro" en <html>.
 */
@Injectable({ providedIn: 'root' })
export class TemaService {
  readonly modo = signal<ModoTema>(this.leerInicial());

  constructor() {
    this.aplicar(this.modo());
  }

  /** Cambia entre claro y oscuro */
  alternar(): void {
    this.establecer(this.modo() === 'oscuro' ? 'claro' : 'oscuro');
  }

  establecer(modo: ModoTema): void {
    this.modo.set(modo);
    this.aplicar(modo);
    try {
      localStorage.setItem(CLAVE, modo);
    } catch {
      // Sin almacenamiento disponible: el modo dura solo esta sesión
    }
  }

  private aplicar(modo: ModoTema): void {
    document.documentElement.classList.toggle('oscuro', modo === 'oscuro');
  }

  private leerInicial(): ModoTema {
    try {
      const guardado = localStorage.getItem(CLAVE);
      if (guardado === 'claro' || guardado === 'oscuro') return guardado;
    } catch {
      // ignorar
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
  }
}
