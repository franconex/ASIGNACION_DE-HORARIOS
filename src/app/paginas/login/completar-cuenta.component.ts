import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IconoComponent } from '../../compartido/icono.component';
import { AuthService } from '../../core/auth.service';

/** Largo mínimo de la contraseña nueva */
const MINIMO_CLAVE = 8;

/**
 * Primera entrada después de recibir un rol: el usuario confirma su nombre y
 * crea una contraseña, para poder entrar también con correo y contraseña.
 */
@Component({
  selector: 'app-completar-cuenta',
  imports: [FormsModule, IconoComponent],
  template: `
    <div class="flex min-h-full items-center justify-center bg-gradient-to-br from-marca-900 via-marca-700 to-marca-500 p-4 dark:from-[#0b1222] dark:via-marca-900 dark:to-marca-300">
      <div class="tarjeta w-full max-w-md p-6">
        <div class="mb-5 text-center">
          <div class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <app-icono nombre="clave" [tamano]="26" />
          </div>
          <h1 class="text-xl font-bold">¡Ya tiene acceso como <span class="capitalize">{{ auth.perfil()?.rol }}</span>!</h1>
          <p class="mt-1 text-sm text-slate-600">Antes de empezar, confirme su nombre y cree una contraseña. Así también podrá entrar con su correo y contraseña.</p>
        </div>

        <form class="space-y-4" (ngSubmit)="guardar()">
          <div>
            <label class="etiqueta" for="cuenta-correo">Correo (será su usuario)</label>
            <input id="cuenta-correo" class="campo" type="email" name="correo" [value]="auth.perfil()?.correo" disabled autocomplete="username">
          </div>
          <div>
            <label class="etiqueta" for="cuenta-nombre">Nombre completo</label>
            <input id="cuenta-nombre" class="campo" name="nombre" [(ngModel)]="nombre" required minlength="3" maxlength="120" autocomplete="name">
          </div>
          <div>
            <label class="etiqueta" for="cuenta-clave">Contraseña nueva</label>
            <div class="relative">
              <input id="cuenta-clave" class="campo pr-10" [type]="verClave() ? 'text' : 'password'" name="password" [(ngModel)]="password"
                     required [minlength]="minimo" maxlength="72" autocomplete="new-password">
              <button type="button" class="absolute inset-y-0 right-0 px-3 text-slate-500 hover:text-slate-700" (click)="verClave.set(!verClave())"
                      [attr.aria-label]="verClave() ? 'Ocultar contraseña' : 'Mostrar contraseña'"><app-icono nombre="ver" [tamano]="16" /></button>
            </div>
            <p class="mt-1 text-xs text-slate-500">Mínimo {{ minimo }} caracteres.</p>
          </div>
          <div>
            <label class="etiqueta" for="cuenta-clave2">Repita la contraseña</label>
            <input id="cuenta-clave2" class="campo" [type]="verClave() ? 'text' : 'password'" name="password2" [(ngModel)]="password2"
                   required maxlength="72" autocomplete="new-password">
          </div>

          @if (error()) {
            <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error() }}</p>
          }

          <button class="btn-primario w-full" type="submit" [disabled]="guardando()">
            {{ guardando() ? 'Guardando…' : 'Guardar y entrar' }}
          </button>
          <button class="btn-fantasma w-full" type="button" (click)="salir()" [disabled]="guardando()">
            <app-icono nombre="salir" [tamano]="16" /> Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  `,
})
export class CompletarCuentaComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly minimo = MINIMO_CLAVE;
  protected nombre = '';
  protected password = '';
  protected password2 = '';
  protected readonly verClave = signal(false);
  protected readonly guardando = signal(false);
  protected readonly error = signal('');

  ngOnInit(): void {
    // Propone el nombre que vino de Google (o del registro)
    this.nombre = this.auth.perfil()?.nombre_completo ?? '';
  }

  protected async guardar(): Promise<void> {
    const nombre = this.nombre.trim();
    if (nombre.length < 3) return this.error.set('Escriba su nombre completo.');
    if (this.password.length < MINIMO_CLAVE) return this.error.set(`La contraseña debe tener al menos ${MINIMO_CLAVE} caracteres.`);
    if (this.password !== this.password2) return this.error.set('Las contraseñas no coinciden.');

    this.guardando.set(true);
    this.error.set('');
    try {
      await this.auth.completarCuenta(nombre, this.password);
      await this.router.navigateByUrl('/');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo guardar. Intente de nuevo.');
    } finally {
      this.guardando.set(false);
    }
  }

  protected async salir(): Promise<void> {
    await this.auth.cerrarSesion();
    await this.router.navigateByUrl('/login');
  }
}
