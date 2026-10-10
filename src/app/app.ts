import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmacionComponent } from './compartido/confirmacion.component';
import { NotificacionesComponent } from './compartido/notificaciones.component';

/**
 * Componente raíz: rutas + notificaciones y ventana de confirmación globales.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NotificacionesComponent, ConfirmacionComponent],
  template: `<router-outlet /><app-notificaciones /><app-confirmacion />`,
})
export class App {}
