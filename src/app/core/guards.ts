import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Exige sesión iniciada con perfil activo y con rol (el invitado va a la espera) */
export const exigirSesion: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.inicializar();
  if (!auth.perfil()?.activo) return router.createUrlTree(['/login']);
  if (auth.esInvitado()) return router.createUrlTree(['/espera']);
  return auth.debeCompletarCuenta() ? router.createUrlTree(['/completar-cuenta']) : true;
};

/** Pantalla para poner nombre y contraseña: solo para quien recién recibió un rol */
export const exigirCuentaPendiente: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.inicializar();
  if (!auth.perfil()?.activo) return router.createUrlTree(['/login']);
  return auth.debeCompletarCuenta() ? true : router.createUrlTree(['/']);
};

/** Pantalla de espera: solo para el invitado (sin rol todavía) */
export const exigirInvitado: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.inicializar();
  if (!auth.perfil()?.activo) return router.createUrlTree(['/login']);
  return auth.esInvitado() ? true : router.createUrlTree(['/']);
};

/** Edición académica: admin, decano, encargado */
export const exigirEdicion: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.inicializar();
  return auth.puedeEditar() ? true : router.createUrlTree(['/']);
};

/** Operación de auxiliares: admin, encargado, auxiliar */
export const exigirOperacion: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.inicializar();
  return auth.puedeOperar() ? true : router.createUrlTree(['/']);
};

/** Gestión de auxiliares: admin, encargado */
export const exigirGestionAuxiliares: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.inicializar();
  return auth.puedeGestionarAuxiliares() ? true : router.createUrlTree(['/']);
};

/** Solo administrador */
export const exigirAdmin: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.inicializar();
  return auth.esAdmin() ? true : router.createUrlTree(['/']);
};

/** Si ya hay sesión, el login redirige al inicio */
export const soloSinSesion: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.inicializar();
  return auth.perfil()?.activo ? router.createUrlTree(['/']) : true;
};
