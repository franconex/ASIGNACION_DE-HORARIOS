import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IconoComponent } from '../../compartido/icono.component';
import { AuthService } from '../../core/auth.service';

/**
 * Pantalla de inicio de sesión.
 */
@Component({
  selector: 'app-login',
  imports: [FormsModule, IconoComponent],
  template: `
    <div class="flex min-h-full items-center justify-center bg-gradient-to-br from-marca-900 via-marca-700 to-marca-500 dark:from-[#0b1222] dark:via-marca-900 dark:to-marca-300 p-4">
      <div class="w-full max-w-sm">
        <div class="mb-6 text-center text-white">
          <div class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur"><app-icono nombre="laboratorio" [tamano]="28" /></div>
          <h1 class="text-2xl font-bold">Laboratorios UPDS</h1>
          <p class="text-sm text-white/70">Asignación de laboratorios y ambientes</p>
        </div>

        <div class="tarjeta space-y-4 p-6">
          <button type="button" class="flex w-full items-center justify-center gap-3 rounded-md border border-slate-300 bg-superficie px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                  (click)="conGoogle()" [disabled]="cargando()">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
            </svg>
            Continuar con Google
          </button>

          <div class="flex items-center gap-3 text-xs text-slate-400">
            <span class="h-px flex-1 bg-slate-200"></span> o con correo y contraseña <span class="h-px flex-1 bg-slate-200"></span>
          </div>

        <form class="space-y-4" (ngSubmit)="ingresar()">
          <div>
            <label class="etiqueta" for="correo">Correo</label>
            <input id="correo" class="campo" type="email" name="correo" [(ngModel)]="correo" required autocomplete="username" maxlength="120">
          </div>
          <div>
            <label class="etiqueta" for="password">Contraseña</label>
            <input id="password" class="campo" type="password" name="password" [(ngModel)]="password" required autocomplete="current-password" maxlength="72">
          </div>
          <button class="btn-primario w-full" type="submit" [disabled]="cargando()">
            {{ cargando() ? 'Ingresando…' : 'Ingresar' }}
          </button>
        </form>
          @if (error()) {
            <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error() }}</p>
          }
        </div>
        <p class="mt-4 text-center text-xs text-white/60">Universidad Privada Domingo Savio</p>
      </div>
    </div>
  `,
})
export class LoginComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected correo = '';
  protected password = '';
  protected readonly cargando = signal(false);
  protected readonly error = signal('');

  /** Si vuelve de Google con un usuario desactivado, lo avisa y cierra la sesión */
  async ngOnInit(): Promise<void> {
    if (this.auth.sesion() && !this.auth.perfil()?.activo) {
      this.error.set('Su usuario está desactivado. Solicite al administrador que lo habilite.');
      await this.auth.cerrarSesion();
    }
  }

  /** Va a Google; al volver, los guards llevan al sistema o a la espera de rol */
  protected async conGoogle(): Promise<void> {
    this.cargando.set(true);
    this.error.set('');
    try {
      await this.auth.iniciarConGoogle();
    } catch (e) {
      this.cargando.set(false);
      this.error.set(e instanceof Error ? e.message : 'No se pudo conectar con Google.');
    }
  }

  /** Valida credenciales y entra al sistema */
  protected async ingresar(): Promise<void> {
    if (!this.correo || !this.password) {
      this.error.set('Ingrese correo y contraseña.');
      return;
    }
    this.cargando.set(true);
    this.error.set('');
    try {
      await this.auth.iniciarSesion(this.correo, this.password);
      await this.router.navigateByUrl(this.auth.esInvitado() ? '/espera' : '/');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo iniciar sesión.');
    } finally {
      this.cargando.set(false);
    }
  }
}
