import { computed, inject, Injectable, signal } from '@angular/core';
import { Session } from '@supabase/supabase-js';
import { Perfil } from './modelos';
import { SupabaseService } from './supabase.service';

/**
 * Manejo de sesión y rol del usuario actual.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService);

  /** Sesión de Supabase (null = sin sesión) */
  readonly sesion = signal<Session | null>(null);
  /** Perfil del usuario (rol, nombre…) */
  readonly perfil = signal<Perfil | null>(null);
  /** true cuando ya se leyó la sesión guardada */
  readonly listo = signal(false);

  readonly esAdmin = computed(() => this.perfil()?.rol === 'admin');
  readonly esEncargado = computed(() => this.perfil()?.rol === 'encargado');
  readonly esAuxiliar = computed(() => this.perfil()?.rol === 'auxiliar');
  readonly esDecano = computed(() => this.perfil()?.rol === 'decano');
  /** Entró pero aún no tiene rol: solo ve la pantalla de espera */
  readonly esInvitado = computed(() => this.perfil()?.rol === 'invitado');
  /** Ya tiene rol pero falta que confirme su nombre y cree su contraseña */
  readonly debeCompletarCuenta = computed(() => !!this.perfil() && !this.esInvitado() && !this.perfil()!.cuenta_completa);

  /** Edición ACADÉMICA (horarios de clase, cesiones, eventos, catálogos): admin, decano, encargado */
  readonly puedeEditar = computed(() => ['admin', 'decano', 'encargado'].includes(this.perfil()?.rol ?? ''));
  /** OPERACIÓN (turnos, atenciones, inventario de PCs): admin, encargado, auxiliar */
  readonly puedeOperar = computed(() => ['admin', 'encargado', 'auxiliar'].includes(this.perfil()?.rol ?? ''));
  /** Gestión de auxiliares (listado, turnos, rotación): admin, encargado */
  readonly puedeGestionarAuxiliares = computed(() => ['admin', 'encargado'].includes(this.perfil()?.rol ?? ''));

  private inicializacion: Promise<void> | null = null;

  /** Carga la sesión guardada (se llama desde los guards) */
  inicializar(): Promise<void> {
    if (!this.inicializacion) {
      this.inicializacion = (async () => {
        const { data } = await this.supabase.cliente.auth.getSession();
        await this.aplicarSesion(data.session);
        // Escucha cambios (login, logout, renovación de token)
        this.supabase.cliente.auth.onAuthStateChange((_evento, sesion) => {
          if (sesion?.user.id !== this.sesion()?.user.id) void this.aplicarSesion(sesion);
          else this.sesion.set(sesion);
        });
        this.listo.set(true);
      })();
    }
    return this.inicializacion;
  }

  /** Guarda la sesión y carga el perfil correspondiente */
  private async aplicarSesion(sesion: Session | null): Promise<void> {
    this.sesion.set(sesion);
    if (!sesion) {
      this.perfil.set(null);
      return;
    }
    const { data } = await this.supabase.cliente.from('perfiles').select('*').eq('id', sesion.user.id).maybeSingle();
    this.perfil.set((data as Perfil) ?? null);
  }

  /** Vuelve a leer el perfil (ej. para ver si el admin ya asignó un rol) */
  async recargarPerfil(): Promise<void> {
    await this.aplicarSesion(this.sesion());
  }

  /** Inicia sesión con Google: va a Google y vuelve a la app ya con sesión */
  async iniciarConGoogle(): Promise<void> {
    const { error } = await this.supabase.cliente.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
    });
    if (error) throw new Error(error.message);
  }

  /** Inicia sesión con correo y contraseña */
  async iniciarSesion(correo: string, password: string): Promise<void> {
    const { data, error } = await this.supabase.cliente.auth.signInWithPassword({ email: correo.trim(), password });
    if (error) {
      throw new Error(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message);
    }
    await this.aplicarSesion(data.session);
    const perfil = this.perfil();
    if (!perfil || !perfil.activo) {
      await this.cerrarSesion();
      throw new Error('Su usuario no está activo. Solicite al administrador que lo habilite.');
    }
  }

  /** Crea la contraseña (para entrar también con correo) y guarda el nombre */
  async completarCuenta(nombre: string, password: string): Promise<void> {
    const { error } = await this.supabase.cliente.auth.updateUser({ password });
    if (error) {
      throw new Error(error.code === 'weak_password' ? 'La contraseña es muy débil. Use al menos 8 caracteres con letras y números.'
        : error.code === 'reauthentication_needed' ? 'Por seguridad, cierre sesión y vuelva a entrar antes de crear la contraseña.'
        : error.message);
    }
    const { error: errorPerfil } = await this.supabase.cliente.rpc('rpc_completar_cuenta', { p_nombre: nombre });
    if (errorPerfil) throw new Error(errorPerfil.message);
    await this.recargarPerfil();
  }

  /** Cierra la sesión */
  async cerrarSesion(): Promise<void> {
    await this.supabase.cliente.auth.signOut();
    this.sesion.set(null);
    this.perfil.set(null);
  }
}
