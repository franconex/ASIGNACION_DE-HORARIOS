import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotificacionesComponent } from './compartido/notificaciones.component';

/**
 * Componente raíz: rutas + notificaciones globales.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NotificacionesComponent],
  template: `<router-outlet /><app-notificaciones />`,
})
export class App {}
