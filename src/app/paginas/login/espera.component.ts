import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IconoComponent } from '../../compartido/icono.component';
import { AuthService } from '../../core/auth.service';

/** Cada cuánto se revisa si el admin ya asignó el rol */
const REVISAR_CADA_MS = 15000;

/**
 * Pantalla del invitado: entró con Google pero todavía no tiene rol.
 * No puede hacer nada; cada 15 s se revisa su perfil y, apenas el admin le
 * asigna un rol, entra solo al sistema con lo que ese rol le permite.
 */
@Component({
  selector: 'app-espera',
  imports: [IconoComponent],
  template: `
    <div class="flex min-h-full items-center justify-center bg-gradient-to-br from-marca-900 via-marca-700 to-marca-500 p-4">
      <div class="tarjeta w-full max-w-md p-6 text-center">
        <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <app-icono nombre="hora" [tamano]="30" />
        </div>
        <h1 class="text-xl font-bold">Tu cuenta está en espera</h1>
        <p class="mt-2 text-sm text-slate-600">
          Hola <b>{{ auth.perfil()?.nombre_completo }}</b>. Ya estás registrado, pero un administrador
          todavía tiene que asignarte un rol (auxiliar, encargado, decano…).
        </p>
        <p class="mt-1 text-sm text-slate-600">Avisa a tu encargado. Cuando te asignen el rol, entrarás automáticamente.</p>

        <div class="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span class="text-slate-500">Cuenta:</span> <span class="font-medium">{{ auth.perfil()?.correo }}</span>
        </div>

        <p class="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400">
          <span class="h-2 w-2 animate-pulse rounded-full bg-amber-500"></span>
          {{ revisando() ? 'Revisando…' : 'Se revisa solo cada 15 segundos' }}
        </p>

        <div class="mt-5 flex justify-center gap-2">
          <button class="btn-primario" (click)="revisar()" [disabled]="revisando()"><app-icono nombre="repetir" [tamano]="16" /> Revisar ahora</button>
          <button class="btn-secundario" (click)="salir()"><app-icono nombre="salir" [tamano]="16" /> Cerrar sesión</button>
        </div>
      </div>
    </div>
  `,
})
export class EsperaComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly revisando = signal(false);
  private intervalo: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.intervalo = setInterval(() => void this.revisar(), REVISAR_CADA_MS);
  }

  ngOnDestroy(): void {
    if (this.intervalo) clearInterval(this.intervalo);
  }

  /** Relee el perfil: si ya tiene rol entra al sistema; si lo desactivaron vuelve al login */
  protected async revisar(): Promise<void> {
    this.revisando.set(true);
    try {
      await this.auth.recargarPerfil();
      const perfil = this.auth.perfil();
      if (!perfil?.activo) await this.salir();
      else if (!this.auth.esInvitado()) await this.router.navigateByUrl('/');
    } finally {
      this.revisando.set(false);
    }
  }

  protected async salir(): Promise<void> {
    await this.auth.cerrarSesion();
    await this.router.navigateByUrl('/login');
  }
}
