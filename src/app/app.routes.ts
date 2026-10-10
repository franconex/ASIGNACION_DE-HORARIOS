import { Routes } from '@angular/router';
import { exigirCuentaPendiente, exigirGestionAuxiliares, exigirInvitado, exigirOperacion, exigirSesion, soloSinSesion } from './core/guards';

/**
 * Rutas del sistema: 3 pantallas. Asignar, ceder y eventos se hacen desde
 * Inicio (la grilla del día) y se abren como paneles laterales.
 */
export const routes: Routes = [
  {
    path: 'login',
    canActivate: [soloSinSesion],
    loadComponent: () => import('./paginas/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'espera',
    title: 'Esperando rol',
    canActivate: [exigirInvitado],
    loadComponent: () => import('./paginas/login/espera.component').then((m) => m.EsperaComponent),
  },
  {
    path: 'completar-cuenta',
    title: 'Completar cuenta',
    canActivate: [exigirCuentaPendiente],
    loadComponent: () => import('./paginas/login/completar-cuenta.component').then((m) => m.CompletarCuentaComponent),
  },
  {
    path: '',
    canActivate: [exigirSesion],
    loadComponent: () => import('./paginas/layout/layout.component').then((m) => m.LayoutComponent),
    children: [
      { path: '', title: 'Inicio', loadComponent: () => import('./paginas/panel/panel.component').then((m) => m.PanelComponent) },
      { path: 'turno', title: 'Cerrar turno', canActivate: [exigirOperacion], loadComponent: () => import('./paginas/operacion/turno.component').then((m) => m.TurnoComponent) },
      { path: 'horario', title: 'Mi horario', canActivate: [exigirOperacion], loadComponent: () => import('./paginas/operacion/horario.component').then((m) => m.HorarioComponent) },
      { path: 'atenciones', title: 'Atenciones', canActivate: [exigirOperacion], loadComponent: () => import('./paginas/operacion/atenciones.component').then((m) => m.AtencionesComponent) },
      { path: 'objetos-perdidos', title: 'Objetos perdidos', canActivate: [exigirOperacion], loadComponent: () => import('./paginas/operacion/objetos-perdidos.component').then((m) => m.ObjetosPerdidosComponent) },
      { path: 'desempeno', title: 'Desempeño', canActivate: [exigirGestionAuxiliares], loadComponent: () => import('./paginas/operacion/desempeno.component').then((m) => m.DesempenoComponent) },
      { path: 'auxiliares', title: 'Auxiliares', canActivate: [exigirGestionAuxiliares], loadComponent: () => import('./paginas/operacion/auxiliares.component').then((m) => m.AuxiliaresComponent) },
      { path: 'laboratorios', title: 'Laboratorios', loadComponent: () => import('./paginas/laboratorios/laboratorios.component').then((m) => m.LaboratoriosComponent) },
      { path: 'registros', title: 'Registros', loadComponent: () => import('./paginas/registros/registros.component').then((m) => m.RegistrosComponent) },
      { path: 'configuracion', title: 'Configuración', loadComponent: () => import('./paginas/configuracion/configuracion.component').then((m) => m.ConfiguracionComponent) },
    ],
  },
  { path: '**', redirectTo: '' },
];
