import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { normalizar } from '../../compartido/buscador.component';
import { IconoComponent } from '../../compartido/icono.component';
import { ModalComponent } from '../../compartido/modal.component';
import { AuthService } from '../../core/auth.service';
import { descargarCsv } from '../../core/exportar';
import { hoyIso, sumarDias } from '../../core/fechas';
import { LicenciaSoftware, Software, TipoSoftware } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { LICENCIAS, MovimientoSoftware, SoftwareService, TIPOS_SOFTWARE } from '../../core/software.service';
import { ACCIONES_PROGRAMA, textoDe } from '../../core/tickets';

/** Qué se hizo con el software en un ticket */
type Accion = 'instalar' | 'actualizar' | 'desinstalar' | 'configurar' | 'pedido';

/**
 * Software que se maneja en los laboratorios: la lista de programas y
 * sistemas operativos / ISOs (con su licencia y para qué carreras) y lo que
 * se pidió e instaló según los tickets.
 */
@Component({
  selector: 'app-software',
  imports: [FormsModule, DatePipe, IconoComponent, ModalComponent],
  // Escape cierra la hoja de filtros del celular
  host: { '(document:keydown.escape)': 'filtrosAbiertos.set(false)' },
  template: `
    <!-- RESUMEN: cada cuadro también filtra con un toque -->
    <div class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <button class="tarjeta p-3 text-left hover:border-marca-300" (click)="tipo.set('programa')">
        <p class="text-xs text-slate-500">Programas</p><p class="text-2xl font-bold">{{ resumen().programas }}</p>
      </button>
      <button class="tarjeta p-3 text-left hover:border-violet-300" (click)="tipo.set('iso')">
        <p class="text-xs text-slate-500"><span class="sm:hidden">ISOs</span><span class="hidden sm:inline">Sistemas operativos / ISOs</span></p><p class="text-2xl font-bold">{{ resumen().isos }}</p>
      </button>
      <button class="tarjeta p-3 text-left hover:border-rose-300" (click)="licencia.set('sin_licencia')">
        <p class="text-xs text-slate-500">Sin licencia</p><p class="text-2xl font-bold text-rose-600">{{ resumen().sinLicencia }}</p>
      </button>
      <button class="tarjeta p-3 text-left hover:border-amber-300" (click)="licencia.set('por_verificar')">
        <p class="text-xs text-slate-500"><span class="sm:hidden">Por verificar</span><span class="hidden sm:inline">Licencia por verificar</span></p><p class="text-2xl font-bold text-amber-600">{{ resumen().porVerificar }}</p>
      </button>
    </div>

    <!-- FILTROS EN EL CELULAR: buscador + botón "Filtros" (abre la hoja de abajo) -->
    <div class="mb-3 flex gap-2 sm:hidden">
      <div class="relative min-w-0 flex-1">
        <app-icono nombre="buscar" [tamano]="16" class="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
        <input class="campo !pl-9" placeholder="Buscar programa…" maxlength="60" aria-label="Buscar programa" [ngModel]="busqueda()" (ngModelChange)="busqueda.set($event)">
      </div>
      <button class="btn-secundario shrink-0" (click)="filtrosAbiertos.set(true)" [attr.aria-label]="'Filtros' + (filtrosActivos() ? ', ' + filtrosActivos() + ' activos' : '')">
        Filtros
        @if (filtrosActivos()) { <span class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-marca-600 px-1 text-[11px] font-semibold text-white">{{ filtrosActivos() }}</span> }
      </button>
    </div>
    <div class="mb-3 flex gap-2 sm:hidden">
      <button class="btn-secundario flex-1" (click)="exportarCatalogo()"><app-icono nombre="descargar" [tamano]="16" /> Exportar</button>
      @if (auth.puedeOperar()) {
        <button class="btn-primario flex-1" (click)="nuevo()"><app-icono nombre="agregar" [tamano]="16" /> Agregar</button>
      }
    </div>

    <!-- FILTROS EN LA PC (los de siempre) -->
    <div class="mb-3 hidden flex-wrap items-end gap-2 sm:flex">
      <div class="relative min-w-56 flex-1">
        <app-icono nombre="buscar" [tamano]="16" class="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
        <input class="campo !pl-9" placeholder="Buscar programa, categoría o carrera…" maxlength="60" [ngModel]="busqueda()" (ngModelChange)="busqueda.set($event)">
      </div>
      <select class="campo !w-auto" [ngModel]="tipo()" (ngModelChange)="tipo.set($event)" aria-label="Tipo">
        <option [ngValue]="null">Programas e ISOs</option>
        <option value="programa">Solo programas</option>
        <option value="iso">Solo sistemas operativos / ISOs</option>
      </select>
      <select class="campo !w-auto" [ngModel]="categoria()" (ngModelChange)="categoria.set($event)" aria-label="Categoría">
        <option [ngValue]="null">Todas las categorías</option>
        @for (c of categorias(); track c) { <option [ngValue]="c">{{ c }}</option> }
      </select>
      <select class="campo !w-auto" [ngModel]="licencia()" (ngModelChange)="licencia.set($event)" aria-label="Licencia">
        <option [ngValue]="null">Todas las licencias</option>
        @for (l of licencias; track l.valor) { <option [ngValue]="l.valor">{{ l.texto }}</option> }
      </select>
      <button class="btn-secundario" (click)="exportarCatalogo()"><app-icono nombre="descargar" [tamano]="16" /> Exportar</button>
      @if (auth.puedeOperar()) {
        <button class="btn-primario" (click)="nuevo()"><app-icono nombre="agregar" [tamano]="16" /> Agregar software</button>
      }
    </div>
    @if (hayFiltros()) {
      <p class="mb-2 text-sm text-slate-500">{{ filtrados().length }} resultado(s) ·
        <button class="text-marca-600 hover:underline" (click)="limpiarFiltros()">Quitar filtros</button></p>
    }

    <!-- LISTA EN EL CELULAR: una tarjeta por programa (no se sale de la pantalla) -->
    <div class="mb-8 space-y-2 sm:hidden">
      @for (s of filtrados(); track s.id) {
        <div class="tarjeta p-3" [class.opacity-50]="!s.activo">
          <div class="flex items-start justify-between gap-2">
            <p class="min-w-0 font-semibold [overflow-wrap:anywhere]">{{ s.nombre }}@if (s.version) { <span class="font-normal text-slate-500"> {{ s.version }}</span> }</p>
            <div class="flex shrink-0 flex-wrap justify-end gap-1">
              @if (s.tipo === 'iso') { <span class="chip bg-violet-100 text-violet-700">ISO</span> }
              <span class="chip whitespace-nowrap" [class]="licenciasInfo[s.licencia].clase">{{ licenciasInfo[s.licencia].texto }}</span>
            </div>
          </div>
          <p class="mt-1 text-sm text-slate-500">{{ textoUso(s) }}</p>
          @if (s.notas) { <p class="mt-1 text-xs text-slate-500">{{ s.notas }}</p> }
          @if (!s.activo || auth.puedeOperar()) {
            <div class="mt-2 flex items-center justify-between gap-2">
              @if (!s.activo) { <span class="chip bg-slate-200 text-slate-600">Oculto</span> } @else { <span></span> }
              @if (auth.puedeOperar()) {
                <button class="btn-fantasma btn-sm" (click)="editar(s)"><app-icono nombre="editar" [tamano]="15" /> Editar</button>
              }
            </div>
          }
        </div>
      } @empty {
        <p class="tarjeta p-6 text-center text-sm text-slate-500">{{ sw.cargado() ? 'Ningún software coincide.' : 'Cargando…' }}</p>
      }
    </div>

    <!-- LISTA EN LA PC: la tabla de siempre -->
    <div class="tarjeta mb-8 hidden overflow-x-auto sm:block">
      <table class="tabla">
        <thead><tr><th class="min-w-56">Software</th><th>Categoría</th><th>Licencia</th><th>Carreras / uso</th><th></th></tr></thead>
        <tbody>
          @for (s of filtrados(); track s.id) {
            <tr [class.opacity-50]="!s.activo">
              <td>
                <p class="font-medium">{{ s.nombre }}@if (s.version) { <span class="text-slate-500"> {{ s.version }}</span> }
                  @if (s.tipo === 'iso') { <span class="chip ml-1 bg-violet-100 text-violet-700">ISO</span> }
                  @if (!s.activo) { <span class="chip ml-1 bg-slate-200 text-slate-600">Oculto</span> }
                </p>
                @if (s.notas) { <p class="text-xs text-slate-500">{{ s.notas }}</p> }
              </td>
              <td class="text-sm text-slate-600">{{ s.categoria || '—' }}</td>
              <td><span class="chip whitespace-nowrap" [class]="licenciasInfo[s.licencia].clase">{{ licenciasInfo[s.licencia].texto }}</span></td>
              <td class="text-sm text-slate-600">{{ s.uso || '—' }}</td>
              <td class="text-right">
                @if (auth.puedeOperar()) { <button class="btn-fantasma btn-sm" (click)="editar(s)" [attr.aria-label]="'Editar ' + s.nombre"><app-icono nombre="editar" [tamano]="15" /></button> }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="py-8 text-center text-sm text-slate-500">{{ sw.cargado() ? 'Ningún software coincide.' : 'Cargando…' }}</td></tr>
          }
        </tbody>
      </table>
    </div>

    <!-- LO QUE SE HIZO CON EL SOFTWARE (tickets) -->
    <section>
      <div class="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 class="text-lg font-semibold">Trabajo con el software</h2>
          <p class="text-sm text-slate-600">Qué pidieron los docentes y qué se instaló, actualizó o desinstaló, en qué laboratorio y quién lo hizo (según los tickets).</p>
        </div>
        <div class="flex flex-wrap gap-1.5">
          @for (p of periodos; track p.dias) {
            <button class="chip cursor-pointer py-1.5" [class]="periodo() === p.dias ? 'bg-marca-600 text-white' : 'bg-slate-200 text-slate-700'" (click)="cambiarPeriodo(p.dias)">{{ p.texto }}</button>
          }
          <button class="btn-secundario btn-sm" (click)="exportarMovimientos()" [disabled]="!movimientos().length"><app-icono nombre="descargar" [tamano]="14" /> Exportar</button>
        </div>
      </div>

      <!-- grid-cols-1 + min-w-0: sin esto la tabla estira la columna y la página se sale a la derecha en el celular -->
      <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <!-- Conteo por programa en el celular: filas que caben en la pantalla -->
        <div class="tarjeta min-w-0 divide-y divide-slate-100 sm:hidden">
          @for (r of porSoftware(); track r.nombre) {
            <div class="px-3 py-2 text-sm">
              <p class="font-medium [overflow-wrap:anywhere]">{{ r.nombre }}</p>
              <p class="text-xs text-slate-500">{{ resumenConteo(r) }}</p>
            </div>
          } @empty {
            <p class="py-6 text-center text-sm text-slate-500">Aún no hay tickets con software del catálogo en este periodo.</p>
          }
        </div>
        <div class="tarjeta hidden min-w-0 overflow-x-auto sm:block">
          <table class="tabla">
            <thead><tr><th>Software</th><th class="text-right">Instaló</th><th class="text-right">Actualizó</th><th class="text-right">Desinstaló</th><th class="text-right">Pedidos docentes</th></tr></thead>
            <tbody>
              @for (r of porSoftware(); track r.nombre) {
                <tr>
                  <td class="font-medium">{{ r.nombre }}</td>
                  <td class="text-right tabular-nums">{{ r.instalar || '·' }}</td>
                  <td class="text-right tabular-nums">{{ r.actualizar || '·' }}</td>
                  <td class="text-right tabular-nums">{{ r.desinstalar || '·' }}</td>
                  <td class="text-right tabular-nums">{{ r.docentes || '·' }}</td>
                </tr>
              } @empty {
                <tr><td colspan="5" class="py-6 text-center text-sm text-slate-500">Aún no hay tickets con software del catálogo en este periodo.</td></tr>
              }
            </tbody>
          </table>
        </div>
        <!-- Línea de tiempo: un punto de color por acción -->
        <div class="tarjeta max-h-[28rem] min-w-0 divide-y divide-slate-100 overflow-y-auto">
          @for (m of movimientos(); track m.id) {
            <div class="flex gap-2.5 px-3 py-2 text-sm">
              <span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" [class]="colorAccion(m)"></span>
              <div class="min-w-0">
              <p class="[overflow-wrap:anywhere]"><span class="font-medium">{{ textoAccion(m) }}</span> · {{ nombresSoftware(m) }}</p>
              <p class="text-xs text-slate-500">
                {{ m.creado_en | date: 'dd/MM/yyyy HH:mm' }} · {{ m.ambiente?.codigo || 'Sin lab' }} · {{ m.autor?.nombre_completo || '—' }}
                @if (pidio(m); as d) { · lo pidió {{ d }} }
              </p>
              </div>
            </div>
          } @empty {
            <p class="py-6 text-center text-sm text-slate-500">Sin movimientos en este periodo.</p>
          }
        </div>
      </div>
    </section>

    <!-- HOJA DE FILTROS DEL CELULAR (sube desde abajo) -->
    @if (filtrosAbiertos()) {
      <div class="fixed inset-0 z-50 sm:hidden">
        <div class="absolute inset-0 bg-black/45" (click)="filtrosAbiertos.set(false)"></div>
        <div class="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-superficie px-4 pb-5 pt-2 shadow-xl" role="dialog" aria-modal="true" aria-label="Filtros">
          <div class="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300"></div>
          <p class="mb-3 text-lg font-semibold">Filtros</p>

          <p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Tipo</p>
          <div class="mb-4 flex flex-wrap gap-1.5">
            @for (t of opcionesTipo; track t.texto) {
              <button class="h-9 rounded-full border px-3 text-sm" [attr.aria-pressed]="tipo() === t.valor"
                      [class]="tipo() === t.valor ? 'border-marca-600 bg-marca-600 font-semibold text-white' : 'border-slate-300'"
                      (click)="tipo.set(t.valor)">{{ t.texto }}</button>
            }
          </div>

          <p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Licencia</p>
          <div class="mb-4 flex flex-wrap gap-1.5">
            <button class="h-9 rounded-full border px-3 text-sm" [attr.aria-pressed]="!licencia()"
                    [class]="!licencia() ? 'border-marca-600 bg-marca-600 font-semibold text-white' : 'border-slate-300'"
                    (click)="licencia.set(null)">Todas</button>
            @for (l of licencias; track l.valor) {
              <button class="h-9 rounded-full border px-3 text-sm" [attr.aria-pressed]="licencia() === l.valor"
                      [class]="licencia() === l.valor ? 'border-marca-600 bg-marca-600 font-semibold text-white' : 'border-slate-300'"
                      (click)="licencia.set(l.valor)">{{ l.texto }}</button>
            }
          </div>

          <label class="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500" for="sw-cat-movil">Categoría</label>
          <select id="sw-cat-movil" class="campo mb-5" [ngModel]="categoria()" (ngModelChange)="categoria.set($event)">
            <option [ngValue]="null">Todas las categorías</option>
            @for (c of categorias(); track c) { <option [ngValue]="c">{{ c }}</option> }
          </select>

          <div class="flex gap-2">
            <button class="btn-secundario flex-1" (click)="limpiarFiltros()">Limpiar</button>
            <button class="btn-primario flex-1" (click)="filtrosAbiertos.set(false)">Ver {{ filtrados().length }} resultado(s)</button>
          </div>
        </div>
      </div>
    }

    <!-- AGREGAR / EDITAR SOFTWARE -->
    <app-modal [abierto]="!!form()" [titulo]="form()?.id ? 'Editar software' : 'Agregar software'" (cerrar)="form.set(null)">
      @if (form(); as f) {
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="sm:col-span-2"><label class="etiqueta" for="sw-nombre">Nombre *</label>
            <input id="sw-nombre" class="campo" maxlength="80" [(ngModel)]="f.nombre" placeholder="Ej: IBM SPSS Statistics 29"></div>
          <div><label class="etiqueta" for="sw-tipo">Tipo</label>
            <select id="sw-tipo" class="campo" [(ngModel)]="f.tipo">
              @for (t of tipos; track t.valor) { <option [value]="t.valor">{{ t.texto }}</option> }
            </select></div>
          <div><label class="etiqueta" for="sw-cat">Categoría</label>
            <input id="sw-cat" class="campo" maxlength="40" [(ngModel)]="f.categoria" list="sw-categorias" placeholder="Ej: Estadística">
            <datalist id="sw-categorias">@for (c of categorias(); track c) { <option [value]="c"></option> }</datalist></div>
          <div><label class="etiqueta" for="sw-version">Versión</label>
            <input id="sw-version" class="campo" maxlength="40" [(ngModel)]="f.version" placeholder="Opcional"></div>
          <div><label class="etiqueta" for="sw-lic">Licencia</label>
            <select id="sw-lic" class="campo" [(ngModel)]="f.licencia">
              @for (l of licencias; track l.valor) { <option [value]="l.valor">{{ l.texto }}</option> }
            </select></div>
          <div class="sm:col-span-2"><label class="etiqueta" for="sw-uso">Carreras / uso</label>
            <input id="sw-uso" class="campo" maxlength="120" [(ngModel)]="f.uso" placeholder="Ej: Ingeniería de Sistemas · Bases de datos"></div>
          <div class="sm:col-span-2"><label class="etiqueta" for="sw-notas">Notas</label>
            <textarea id="sw-notas" class="campo" rows="2" maxlength="300" [(ngModel)]="f.notas"></textarea></div>
          @if (f.id) {
            <label class="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" class="h-4 w-4" [(ngModel)]="f.activo"> Visible en el catálogo (si lo ocultas, ya no aparece al registrar tickets)
            </label>
          }
        </div>
      }
      <ng-container pie>
        <button class="btn-secundario" (click)="form.set(null)">Cancelar</button>
        <button class="btn-primario" (click)="guardar()" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
      </ng-container>
    </app-modal>
  `,
})
export class SoftwareComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly sw = inject(SoftwareService);
  private readonly notificaciones = inject(NotificacionesService);

  protected readonly licenciasInfo = LICENCIAS;
  protected readonly licencias = (Object.keys(LICENCIAS) as LicenciaSoftware[]).map((valor) => ({ valor, texto: LICENCIAS[valor].texto }));
  protected readonly tipos = (Object.keys(TIPOS_SOFTWARE) as TipoSoftware[]).map((valor) => ({ valor, texto: TIPOS_SOFTWARE[valor] }));
  protected readonly periodos = [{ texto: 'Último mes', dias: 30 }, { texto: '3 meses', dias: 90 }, { texto: 'Último año', dias: 365 }, { texto: 'Todo', dias: 0 }];

  protected readonly busqueda = signal('');
  protected readonly tipo = signal<TipoSoftware | null>(null);
  protected readonly categoria = signal<string | null>(null);
  protected readonly licencia = signal<LicenciaSoftware | null>(null);
  protected readonly guardando = signal(false);
  protected readonly form = signal<Partial<Software> | null>(null);
  /** Hoja de filtros del celular */
  protected readonly filtrosAbiertos = signal(false);
  /** Opciones de tipo en la hoja de filtros */
  protected readonly opcionesTipo: { valor: TipoSoftware | null; texto: string }[] = [
    { valor: null, texto: 'Todos' }, { valor: 'programa', texto: 'Programas' }, { valor: 'iso', texto: 'ISOs' },
  ];
  /** Cuántos filtros hay puestos (para el número del botón "Filtros") */
  protected readonly filtrosActivos = computed(() => [this.tipo(), this.categoria(), this.licencia()].filter(Boolean).length);

  protected readonly periodo = signal(30);
  protected readonly movimientos = signal<MovimientoSoftware[]>([]);

  protected readonly categorias = computed(() => [...new Set(this.sw.software().map((s) => s.categoria).filter((c): c is string => !!c))].sort());
  protected readonly resumen = computed(() => {
    const activos = this.sw.activos();
    return {
      programas: activos.filter((s) => s.tipo === 'programa').length,
      isos: activos.filter((s) => s.tipo === 'iso').length,
      sinLicencia: activos.filter((s) => s.licencia === 'sin_licencia').length,
      porVerificar: activos.filter((s) => s.licencia === 'por_verificar').length,
    };
  });
  protected readonly hayFiltros = computed(() => !!(this.busqueda().trim() || this.tipo() || this.categoria() || this.licencia()));

  /** Por nombre; los ocultos al final */
  protected readonly filtrados = computed(() => {
    const texto = normalizar(this.busqueda().trim());
    return this.sw.software()
      .filter((s) => (!texto || normalizar(`${s.nombre} ${s.categoria ?? ''} ${s.uso ?? ''}`).includes(texto))
        && (!this.tipo() || s.tipo === this.tipo()) && (!this.categoria() || s.categoria === this.categoria())
        && (!this.licencia() || s.licencia === this.licencia()))
      .sort((a, b) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre, 'es'));
  });

  /** Conteo por software: cuántas veces se instaló, actualizó, desinstaló o lo pidió un docente */
  protected readonly porSoftware = computed(() => {
    const filas = new Map<string, { nombre: string; instalar: number; actualizar: number; desinstalar: number; docentes: number }>();
    for (const m of this.movimientos()) {
      const accion = this.accion(m);
      for (const nombre of this.listaNombres(m)) {
        const f = filas.get(nombre) ?? { nombre, instalar: 0, actualizar: 0, desinstalar: 0, docentes: 0 };
        if (accion === 'instalar' || accion === 'actualizar' || accion === 'desinstalar') f[accion]++;
        // El pedido del docente no es una instalación: la registra después quien la hace (ticket de Programas)
        if (accion === 'pedido') f.docentes++;
        filas.set(nombre, f);
      }
    }
    return [...filas.values()].sort((a, b) => (b.instalar + b.actualizar + b.desinstalar) - (a.instalar + a.actualizar + a.desinstalar) || a.nombre.localeCompare(b.nombre, 'es'));
  });

  ngOnInit(): void {
    void this.sw.cargar().catch((e) => this.notificaciones.error(e, 'No se cargó el software'));
    void this.cargarMovimientos();
  }

  protected limpiarFiltros(): void {
    this.busqueda.set('');
    this.tipo.set(null);
    this.categoria.set(null);
    this.licencia.set(null);
  }

  protected nuevo(): void {
    this.form.set({ nombre: '', tipo: 'programa', categoria: '', version: '', licencia: 'por_verificar', uso: '', notas: '', activo: true });
  }

  protected editar(s: Software): void {
    this.form.set({ ...s });
  }

  protected async guardar(): Promise<void> {
    const f = this.form();
    if (!f) return;
    const nombre = f.nombre?.trim() ?? '';
    if (nombre.length < 2) return this.notificaciones.aviso('Escribe el nombre del software.');
    const limpio = (v: string | null | undefined) => v?.trim() || null;
    this.guardando.set(true);
    try {
      await this.sw.guardar({ id: f.id, nombre, tipo: f.tipo, categoria: limpio(f.categoria), version: limpio(f.version),
        licencia: f.licencia, uso: limpio(f.uso), notas: limpio(f.notas), activo: f.activo ?? true });
      this.notificaciones.exito(f.id ? 'Software actualizado.' : `«${nombre}» agregado al catálogo.`);
      this.form.set(null);
    } catch (e) {
      this.notificaciones.error(e, 'No se guardó');
    } finally {
      this.guardando.set(false);
    }
  }

  protected cambiarPeriodo(dias: number): void {
    this.periodo.set(dias);
    void this.cargarMovimientos();
  }

  private async cargarMovimientos(): Promise<void> {
    // Si se cambia de periodo antes de que llegue la respuesta, la vieja se descarta
    const n = ++this.consulta;
    try {
      const lista = await this.sw.movimientos(this.periodo() ? sumarDias(hoyIso(), -this.periodo()) : null);
      if (n === this.consulta) this.movimientos.set(lista);
    } catch (e) {
      if (n === this.consulta) this.notificaciones.error(e, 'No se cargaron los movimientos de software');
    }
  }

  private consulta = 0;

  private accion(m: MovimientoSoftware): Accion {
    return m.tipo === 'docente' ? 'pedido' : ((m.detalles.accion as Accion) ?? 'instalar');
  }

  private listaNombres(m: MovimientoSoftware): string[] {
    return (m.detalles.software_ids ?? []).map((id) => this.sw.mapa().get(id)?.nombre ?? '').filter(Boolean);
  }

  protected nombresSoftware(m: MovimientoSoftware): string {
    return this.listaNombres(m).join(', ') || m.detalles.programas || '—';
  }

  /** Color del punto de cada acción en la línea de tiempo */
  protected colorAccion(m: MovimientoSoftware): string {
    const colores: Record<Accion, string> = {
      instalar: 'bg-emerald-600', actualizar: 'bg-amber-500', desinstalar: 'bg-rose-600', configurar: 'bg-slate-500', pedido: 'bg-marca-600',
    };
    return colores[this.accion(m)] ?? 'bg-slate-400';
  }

  /** "Categoría · carreras" de una tarjeta del celular */
  protected textoUso(s: Software): string {
    return [s.categoria, s.uso].filter(Boolean).join(' · ') || 'Sin categoría';
  }

  /** "Instaló 3 · Actualizó 1 · 2 pedidos" para el conteo del celular */
  protected resumenConteo(r: { instalar: number; actualizar: number; desinstalar: number; docentes: number }): string {
    return [
      r.instalar ? `Instaló ${r.instalar}` : '', r.actualizar ? `Actualizó ${r.actualizar}` : '',
      r.desinstalar ? `Desinstaló ${r.desinstalar}` : '', r.docentes ? `${r.docentes} pedido(s) de docentes` : '',
    ].filter(Boolean).join(' · ');
  }

  protected textoAccion(m: MovimientoSoftware): string {
    return m.tipo === 'docente' ? 'Pedido de docente' : textoDe(ACCIONES_PROGRAMA, m.detalles.accion) || 'Programas';
  }

  protected pidio(m: MovimientoSoftware): string {
    return m.docente ? `${m.docente.apellidos} ${m.docente.nombres}` : m.solicitante ?? '';
  }

  protected exportarCatalogo(): void {
    descargarCsv('software.csv', ['Software', 'Tipo', 'Categoría', 'Versión', 'Licencia', 'Carreras / uso', 'Notas'],
      this.filtrados().map((s) => [s.nombre, TIPOS_SOFTWARE[s.tipo], s.categoria ?? '', s.version ?? '', LICENCIAS[s.licencia].texto, s.uso ?? '', s.notas ?? '']));
  }

  protected exportarMovimientos(): void {
    descargarCsv('trabajo-con-software.csv', ['Fecha', 'Acción', 'Software', 'Laboratorio', 'Auxiliar', 'Lo pidió'],
      this.movimientos().map((m) => [m.creado_en.slice(0, 16).replace('T', ' '), this.textoAccion(m), this.nombresSoftware(m),
        m.ambiente?.codigo ?? '', m.autor?.nombre_completo ?? '', this.pidio(m)]));
  }
}
