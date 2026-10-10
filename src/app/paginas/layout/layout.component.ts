import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IconoComponent } from '../../compartido/icono.component';
import { PanelLateralComponent } from '../../compartido/panel-lateral.component';
import { TemaService } from '../../core/tema.service';
import { AuthService } from '../../core/auth.service';
import { NOMBRE_ROL } from '../../core/modelos';
import { CatalogosService } from '../../core/catalogos.service';
import { PanelesService } from '../../core/paneles.service';
import { environment } from '../../../environments/environment';

/** Dónde se recuerda si el menú lateral está achicado */
const CLAVE_MENU = 'laboratorios-menu-colapsado';

function leerColapsado(): boolean {
  try {
    return localStorage.getItem(CLAVE_MENU) === '1';
  } catch {
    return false;
  }
}

/** Elemento del menú lateral */
interface ItemMenu {
  ruta: string;
  texto: string;
  icono: string;
  /** Si está, solo se muestra cuando la función devuelve true */
  visible?: (auth: AuthService) => boolean;
}

/**
 * Estructura principal: menú lateral corto (4 pantallas) + contenido +
 * paneles laterales para los formularios. Carga los catálogos al entrar.
 */
@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconoComponent, PanelLateralComponent],
  template: `
    <div class="flex h-full">
      @if (menuAbierto()) {
        <div class="fixed inset-0 z-30 bg-black/40 lg:hidden" (click)="menuAbierto.set(false)"></div>
      }

      <!-- Menú lateral: en pantalla grande se puede achicar a solo íconos -->
      <aside class="fixed inset-y-0 left-0 z-30 flex w-60 flex-col bg-marca-900 text-white/75 transition-[transform,width] duration-200 lg:static lg:translate-x-0"
             [class.-translate-x-full]="!menuAbierto()" [class.lg:w-16]="colapsado()">
        <div class="flex items-center gap-3 px-5 py-5" [class.lg:flex-col]="colapsado()" [class.lg:px-3]="colapsado()">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white"><app-icono nombre="laboratorio" [tamano]="22" /></div>
          <div class="min-w-0 flex-1" [class.lg:hidden]="colapsado()">
            <p class="leading-tight font-bold text-white">Laboratorios</p>
            <p class="text-xs text-white/55">UPDS · Asignación</p>
          </div>
          <button class="hidden rounded-md p-1.5 hover:bg-white/10 hover:text-white lg:block" (click)="alternarMenu()"
                  [title]="colapsado() ? 'Mostrar el menú' : 'Ocultar el menú'" [attr.aria-label]="colapsado() ? 'Mostrar el menú' : 'Ocultar el menú'"
                  [attr.aria-expanded]="!colapsado()">
            <app-icono [nombre]="colapsado() ? 'siguiente' : 'anterior'" [tamano]="18" />
          </button>
        </div>

        @if (auth.puedeEditar()) {
          <div class="space-y-1.5 px-3 pb-3" [class.lg:px-2]="colapsado()">
            <button class="flex w-full items-center gap-3 rounded-md bg-white/15 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-white/25"
                    [class.lg:justify-center]="colapsado()" [class.lg:px-0]="colapsado()" [title]="colapsado() ? 'Nueva asignación' : ''" (click)="nuevaAsignacion()">
              <app-icono nombre="agregar" [tamano]="18" /> <span [class.lg:hidden]="colapsado()">Nueva asignación</span>
            </button>
            <button class="flex w-full items-center gap-3 rounded-md border border-white/15 px-3 py-2.5 text-sm transition hover:bg-white/10 hover:text-white"
                    [class.lg:justify-center]="colapsado()" [class.lg:px-0]="colapsado()" [title]="colapsado() ? 'Evento o defensa' : ''" (click)="nuevoEvento()">
              <app-icono nombre="evento" [tamano]="18" /> <span [class.lg:hidden]="colapsado()">Evento o defensa</span>
            </button>
          </div>
        }

        <nav class="flex-1 space-y-1 overflow-y-auto px-3" [class.lg:px-2]="colapsado()">
          @for (item of menu(); track item.ruta) {
            <a [routerLink]="item.ruta" routerLinkActive="!bg-white/15 !text-white" [routerLinkActiveOptions]="{ exact: item.ruta === '/' }"
               (click)="menuAbierto.set(false)" [title]="colapsado() ? item.texto : ''" [attr.aria-label]="item.texto"
               class="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition hover:bg-white/10 hover:text-white"
               [class.lg:justify-center]="colapsado()" [class.lg:px-0]="colapsado()">
              <app-icono [nombre]="item.icono" [tamano]="18" /> <span [class.lg:hidden]="colapsado()">{{ item.texto }}</span>
            </a>
          }
        </nav>

        <div class="flex items-center gap-3 border-t border-white/10 p-4" [class.lg:flex-col]="colapsado()" [class.lg:gap-1]="colapsado()" [class.lg:px-2]="colapsado()">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white"
               [title]="(auth.perfil()?.nombre_completo ?? '') + ' · ' + nombreRol()">{{ iniciales() }}</div>
          <div class="min-w-0 flex-1" [class.lg:hidden]="colapsado()">
            <p class="truncate text-sm font-medium text-white">{{ auth.perfil()?.nombre_completo }}</p>
            <p class="text-xs text-white/55">{{ nombreRol() }}</p>
          </div>
          <button class="rounded-md p-2 hover:bg-white/10 hover:text-white" (click)="tema.alternar()"
                  [title]="tema.modo() === 'oscuro' ? 'Modo claro' : 'Modo oscuro'" [attr.aria-label]="tema.modo() === 'oscuro' ? 'Activar modo claro' : 'Activar modo oscuro'">
            <app-icono [nombre]="tema.modo() === 'oscuro' ? 'sol' : 'luna'" [tamano]="18" />
          </button>
          <button class="rounded-md p-2 hover:bg-white/10 hover:text-white" (click)="salir()" title="Cerrar sesión" aria-label="Cerrar sesión"><app-icono nombre="salir" [tamano]="18" /></button>
        </div>
      </aside>

      <!-- Contenido -->
      <div class="flex min-w-0 flex-1 flex-col">
        <header class="flex items-center gap-3 border-b border-slate-200 bg-superficie px-4 py-3 lg:hidden">
          <button class="btn-fantasma btn-sm" (click)="menuAbierto.set(true)" aria-label="Abrir menú"><app-icono nombre="menu" /></button>
          <span class="font-semibold">Laboratorios UPDS</span>
        </header>

        <main class="flex-1 overflow-y-auto p-4 lg:p-6">
          @if (sinConfigurar) {
            <div class="tarjeta flex items-center gap-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <app-icono nombre="alerta" /> Falta configurar Supabase en <code>src/environments/environment.ts</code> (URL y anon key).
            </div>
          } @else if (errorCarga()) {
            <div class="tarjeta border-red-300 bg-red-50 p-4 text-sm text-red-800">
              No se pudieron cargar los datos: {{ errorCarga() }}
              <button class="btn-secundario btn-sm ml-2" (click)="cargar()">Reintentar</button>
            </div>
          } @else if (!catalogos.cargado()) {
            <div class="flex h-64 items-center justify-center text-slate-500">
              <span class="mr-3 h-5 w-5 animate-spin rounded-full border-2 border-marca-500 border-t-transparent"></span>
              Cargando datos…
            </div>
          } @else {
            <router-outlet />
          }
        </main>
      </div>
    </div>

    @if (catalogos.cargado()) { <app-panel-lateral /> }
  `,
})
export class LayoutComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly catalogos = inject(CatalogosService);
  private readonly paneles = inject(PanelesService);
  protected readonly tema = inject(TemaService);
  private readonly router = inject(Router);

  protected readonly menuAbierto = signal(false);
  /** Pantalla grande: menú achicado a solo íconos (se recuerda en este navegador) */
  protected readonly colapsado = signal(leerColapsado());
  protected readonly errorCarga = signal('');
  protected readonly sinConfigurar = environment.supabaseUrl.includes('SU-PROYECTO');

  /** Menú corto; cada ítem puede depender del rol */
  private readonly items: ItemMenu[] = [
    { ruta: '/', texto: 'Inicio', icono: 'panel' },
    { ruta: '/turno', texto: 'Cerrar turno', icono: 'hora', visible: (a) => a.puedeOperar() },
    { ruta: '/horario', texto: 'Horario', icono: 'calendario', visible: (a) => a.esAuxiliar() || a.esEncargado() },
    { ruta: '/atenciones', texto: 'Atenciones', icono: 'registros', visible: (a) => a.puedeOperar() },
    { ruta: '/objetos-perdidos', texto: 'Objetos perdidos', icono: 'objeto', visible: (a) => a.puedeOperar() },
    { ruta: '/desempeno', texto: 'Desempeño', icono: 'grafico', visible: (a) => a.puedeGestionarAuxiliares() },
    { ruta: '/auxiliares', texto: 'Auxiliares', icono: 'usuarios', visible: (a) => a.puedeGestionarAuxiliares() },
    { ruta: '/laboratorios', texto: 'Laboratorios', icono: 'laboratorio' },
    { ruta: '/registros', texto: 'Registros', icono: 'registros' },
    { ruta: '/configuracion', texto: 'Configuración', icono: 'configuracion', visible: (a) => a.esAdmin() },
  ];
  /** Ítems visibles para el rol actual */
  protected readonly menu = computed(() => this.items.filter((i) => !i.visible || i.visible(this.auth)));

  ngOnInit(): void {
    if (!this.sinConfigurar) void this.cargar();
  }

  /** Achica o agranda el menú lateral; el contenido usa el espacio que queda */
  protected alternarMenu(): void {
    this.colapsado.update((c) => !c);
    try {
      localStorage.setItem(CLAVE_MENU, this.colapsado() ? '1' : '0');
    } catch {
      // Sin almacenamiento: solo dura esta sesión
    }
  }

  /** Iniciales del usuario para el avatar */
  protected nombreRol(): string {
    const rol = this.auth.perfil()?.rol;
    return rol ? NOMBRE_ROL[rol] : '';
  }

  protected iniciales(): string {
    return (this.auth.perfil()?.nombre_completo ?? '?').split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  }

  protected async cargar(): Promise<void> {
    this.errorCarga.set('');
    try {
      await this.catalogos.cargarTodo();
    } catch (e) {
      this.errorCarga.set(e instanceof Error ? e.message : String(e));
    }
  }

  protected nuevaAsignacion(): void {
    this.menuAbierto.set(false);
    this.paneles.abrirAsignacion();
  }

  protected nuevoEvento(): void {
    this.menuAbierto.set(false);
    this.paneles.abrirReserva();
  }

  protected async salir(): Promise<void> {
    this.paneles.cerrarTodos();
    await this.auth.cerrarSesion();
    await this.router.navigateByUrl('/login');
  }
}
