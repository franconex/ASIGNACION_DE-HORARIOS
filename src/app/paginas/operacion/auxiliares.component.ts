import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconoComponent } from '../../compartido/icono.component';
import { ModalComponent } from '../../compartido/modal.component';
import { CategoriaFalla, FallaPc, HorarioTurno, NOMBRE_ROL, Perfil, RotacionSabado, TurnoCodigo, TurnoProgramado } from '../../core/modelos';
import { CATEGORIAS_FALLA } from '../../core/tickets';
import { NotificacionesService } from '../../core/notificaciones.service';
import { ConfirmacionService } from '../../core/confirmacion.service';
import { OperacionService, turnosDeHoy } from '../../core/operacion.service';
import { environment } from '../../../environments/environment';
import { aMinutos, diaIso, fechaActual, fechaCorta, hhmm } from '../../core/fechas';

const NOMBRE_TURNO: Record<string, string> = { M: 'Mañana', MD: 'Mediodía', T: 'Tarde', N: 'Noche' };

/**
 * Apartado de Auxiliares (admin y encargado): la lista del equipo con su
 * turno de lunes a viernes (se cambia y vale desde hoy) y los turnos de
 * sábado (el sábado, el auxiliar y su turno).
 * Los encargados de auxiliares también rotan y aparecen aquí (pero cierran
 * cualquier turno, no solo el suyo).
 */
@Component({
  selector: 'app-auxiliares',
  imports: [FormsModule, IconoComponent, ModalComponent],
  template: `
    <header class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">Auxiliares</h1>
        <p class="mt-0.5 text-sm text-slate-600">El turno de cada auxiliar y los sábados.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-secundario" (click)="abrirFallas()"><app-icono nombre="mantenimiento" [tamano]="16" /> Lista de fallas</button>
        <button class="btn-secundario" (click)="abrirHorarios()"><app-icono nombre="hora" [tamano]="16" /> Horarios de turno</button>
      </div>
    </header>

    <!-- LISTA DE FALLAS (catálogo de la ficha de reparación) -->
    <app-modal [abierto]="fallasAbierto()" titulo="Lista de fallas" ancho="lg" (cerrar)="fallasAbierto.set(false)">
      <p class="mb-3 text-sm text-slate-600">Las fallas que aparecen como botones en la ficha de reparación. Ocultar una no borra lo ya registrado.</p>
      <div class="mb-4 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
        <div class="min-w-48 flex-1">
          <label class="etiqueta" for="falla-nueva">Nueva falla</label>
          <input id="falla-nueva" class="campo" maxlength="60" [(ngModel)]="fallaNueva.nombre" placeholder="Ej: Cable HDMI suelto" (keydown.enter)="agregarFalla()">
        </div>
        <div>
          <label class="etiqueta" for="falla-cat">Grupo</label>
          <select id="falla-cat" class="campo !w-36" [(ngModel)]="fallaNueva.categoria">
            @for (c of categoriasFalla; track c.valor) { <option [value]="c.valor">{{ c.texto }}</option> }
          </select>
        </div>
        <button class="btn-primario" (click)="agregarFalla()" [disabled]="guardando()"><app-icono nombre="agregar" [tamano]="16" /> Agregar</button>
      </div>
      <div class="max-h-[50vh] space-y-3 overflow-y-auto">
        @for (c of categoriasFalla; track c.valor) {
          @if (fallasDe(c.valor).length) {
            <div>
              <p class="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">{{ c.texto }}</p>
              @for (falla of fallasDe(c.valor); track falla.id) {
                <div class="flex items-center gap-2 border-b border-slate-100 py-1">
                  <span class="flex-1 text-sm" [class.text-slate-400]="!falla.activo" [class.line-through]="!falla.activo">{{ falla.nombre }}</span>
                  <select class="campo !w-32 !py-0.5 text-xs" [ngModel]="falla.categoria" (ngModelChange)="cambiarFalla(falla, { categoria: $event })" aria-label="Grupo">
                    @for (g of categoriasFalla; track g.valor) { <option [value]="g.valor">{{ g.texto }}</option> }
                  </select>
                  <button class="chip cursor-pointer" [class]="falla.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'"
                          (click)="cambiarFalla(falla, { activo: !falla.activo })">{{ falla.activo ? 'Visible' : 'Oculta' }}</button>
                </div>
              }
            </div>
          }
        }
      </div>
      <ng-container pie>
        <button class="btn-secundario" (click)="fallasAbierto.set(false)">Cerrar</button>
      </ng-container>
    </app-modal>

    <!-- HORARIOS DE TURNO (editables) -->
    <app-modal [abierto]="!!edicionHorarios()" titulo="Horarios de turno" ancho="md" (cerrar)="edicionHorarios.set(null)">
      @if (edicionHorarios(); as lista) {
        <p class="mb-3 text-sm text-slate-600">Hora de inicio y fin de cada turno. Se usa para saber cuándo puede cerrar el auxiliar y cuánto retraso tuvo el cierre.</p>
        <div class="space-y-2">
          @for (h of lista; track h.turno) {
            <div class="grid grid-cols-[7rem_1fr_1fr] items-center gap-2">
              <span class="font-medium">{{ nombreTurno[h.turno] }}</span>
              <input type="time" class="campo" [(ngModel)]="h.hora_inicio" [attr.aria-label]="'Inicio ' + nombreTurno[h.turno]">
              <input type="time" class="campo" [(ngModel)]="h.hora_fin" [attr.aria-label]="'Fin ' + nombreTurno[h.turno]">
            </div>
          }
        </div>
        <p class="mt-3 text-xs text-slate-500">Los cierres ya hechos conservan el horario que tenían.</p>
      }
      <ng-container pie>
        <button class="btn-secundario" (click)="edicionHorarios.set(null)">Cancelar</button>
        <button class="btn-primario" (click)="guardarHorarios()" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Guardar horarios' }}</button>
      </ng-container>
    </app-modal>

    <!-- CUENTAS EN ESPERA: el encargado (y el admin) solo las habilita como auxiliar -->
    @if (invitados().length) {
      <section class="tarjeta mb-4 border-l-4 border-l-amber-400 p-3">
        <p class="mb-2 text-sm font-semibold text-amber-900">
          {{ invitados().length }} cuenta(s) entraron con Google y esperan acceso
        </p>
        <div class="space-y-1.5">
          @for (u of invitados(); track u.id) {
            <div class="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50/60 px-2 py-1.5">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ u.nombre_completo }}</p>
                <p class="truncate text-xs text-slate-500">{{ u.correo }}</p>
              </div>
              <button class="btn-primario btn-sm" (click)="habilitar(u)" [disabled]="guardando()">
                <app-icono nombre="check" [tamano]="14" /> Habilitar como auxiliar
              </button>
            </div>
          }
        </div>
      </section>
    }

    <!-- TURNO DE LUNES A VIERNES: se elige y queda guardado al momento -->
    <p class="mb-2 text-sm text-slate-600">Elige el turno de lunes a viernes de cada auxiliar. Se guarda al momento y vale desde hoy.</p>

    <!-- tarjetas en el celular -->
    <div class="mb-8 space-y-2 md:hidden">
      @for (u of activos(); track u.id) {
        <article class="tarjeta p-3">
          <p class="truncate font-medium">{{ u.nombre_completo }}@if (u.rol === 'encargado') { <span class="chip ml-1 bg-marca-50 text-marca-700">{{ nombreRol.encargado }}</span> }</p>
          <p class="mb-2 truncate text-xs text-slate-500">{{ u.correo }}</p>
          <select class="campo" [ngModel]="turnoDe(u.id)" (ngModelChange)="cambiarTurno(u, $event)" [disabled]="guardando()" [attr.aria-label]="'Turno de ' + u.nombre_completo">
            <option [ngValue]="null" disabled>Sin turno</option>
            <option value="M">Mañana</option><option value="MD">Mediodía</option><option value="T">Tarde</option><option value="N">Noche</option>
          </select>
        </article>
      } @empty {
        <p class="tarjeta py-8 text-center text-sm text-slate-500">No hay auxiliares activos.</p>
      }
    </div>

    <!-- tabla en PC -->
    <div class="tarjeta mb-8 hidden overflow-x-auto md:block">
      <table class="tabla">
        <thead><tr><th>Auxiliar</th><th>Turno de lunes a viernes</th></tr></thead>
        <tbody>
          @for (u of activos(); track u.id) {
            <tr>
              <td>
                <p class="font-medium">{{ u.nombre_completo }}@if (u.rol === 'encargado') { <span class="chip ml-1 bg-marca-50 text-marca-700">{{ nombreRol.encargado }}</span> }</p>
                <p class="text-xs text-slate-500">{{ u.correo }}</p>
              </td>
              <td>
                <select class="campo !w-40 !py-1" [ngModel]="turnoDe(u.id)" (ngModelChange)="cambiarTurno(u, $event)" [disabled]="guardando()" [attr.aria-label]="'Turno de ' + u.nombre_completo">
                  <option [ngValue]="null" disabled>Sin turno</option>
                  <option value="M">Mañana</option><option value="MD">Mediodía</option><option value="T">Tarde</option><option value="N">Noche</option>
                </select>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="2" class="py-8 text-center text-sm text-slate-500">No hay auxiliares activos.</td></tr>
          }
        </tbody>
      </table>
    </div>

    <!-- SÁBADOS: el sábado, el auxiliar y su turno -->
    <section>
      <h2 class="mb-1 text-lg font-semibold">Turnos de sábado</h2>
      <p class="mb-2 text-sm text-slate-600">El sábado vale este turno (no el de lunes a viernes). Si un sábado tiene auxiliares aquí, solo ellos cierran turno ese día.</p>
      <div class="tarjeta mb-3 flex flex-wrap items-end gap-3 p-3">
        <div><label class="etiqueta" for="sab-fecha">Sábado</label><input id="sab-fecha" type="date" class="campo !w-44" [(ngModel)]="nueva.fecha"></div>
        <div class="min-w-48 flex-1">
          <label class="etiqueta" for="sab-aux">Auxiliar</label>
          <select id="sab-aux" class="campo" [(ngModel)]="nueva.auxiliarId">
            <option [ngValue]="null">— Elige —</option>
            @for (u of activos(); track u.id) { <option [ngValue]="u.id">{{ u.nombre_completo }}</option> }
          </select>
        </div>
        <div>
          <label class="etiqueta" for="sab-turno">Turno</label>
          <select id="sab-turno" class="campo !w-32" [(ngModel)]="nueva.turno">
            <option [ngValue]="null">—</option>
            <option value="M">Mañana</option><option value="MD">Mediodía</option><option value="T">Tarde</option><option value="N">Noche</option>
          </select>
        </div>
        <button class="btn-primario" (click)="agregarRotacion()" [disabled]="guardando()"><app-icono nombre="agregar" [tamano]="16" /> Agregar</button>
      </div>

      <div class="tarjeta overflow-x-auto">
        <table class="tabla">
          <thead><tr><th>Sábado</th><th>Auxiliar</th><th>Turno</th><th></th></tr></thead>
          <tbody>
            @for (r of rotacion(); track r.id) {
              <tr>
                <td class="font-medium">{{ fechaCorta(r.fecha) }}</td>
                <td>{{ r.auxiliar?.nombre_completo || '—' }}</td>
                <td>
                  <select class="campo !w-32 !py-1" [ngModel]="r.turno" (ngModelChange)="cambiarTurnoSabado(r, $event)" aria-label="Turno del sábado">
                    <option value="M">Mañana</option><option value="MD">Mediodía</option><option value="T">Tarde</option><option value="N">Noche</option>
                  </select>
                </td>
                <td class="text-right"><button class="btn-fantasma btn-sm text-red-600" (click)="eliminarRotacion(r)" aria-label="Quitar"><app-icono nombre="eliminar" [tamano]="15" /></button></td>
              </tr>
            } @empty {
              <tr><td colspan="4" class="py-6 text-center text-sm text-slate-500">Aún no hay sábados asignados.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class AuxiliaresComponent implements OnInit {
  private readonly op = inject(OperacionService);
  private readonly notificaciones = inject(NotificacionesService);
  private readonly confirmacion = inject(ConfirmacionService);

  protected readonly nombreTurno = NOMBRE_TURNO;
  protected readonly nombreRol = NOMBRE_ROL;
  protected readonly auxiliares = signal<Perfil[]>([]);
  protected readonly invitados = signal<Perfil[]>([]);
  protected readonly rotacion = signal<RotacionSabado[]>([]);
  protected readonly turnosProgramados = signal<TurnoProgramado[]>([]);
  protected readonly guardando = signal(false);

  /** Catálogo de fallas */
  protected readonly categoriasFalla = CATEGORIAS_FALLA;
  protected readonly fallasAbierto = signal(false);
  protected fallaNueva: { nombre: string; categoria: CategoriaFalla } = { nombre: '', categoria: 'hardware' };

  /** Horarios de turno en edición (copia; null = cerrado) */
  protected readonly edicionHorarios = signal<HorarioTurno[] | null>(null);

  private readonly hoy = fechaActual(environment.zonaHoraria);
  protected readonly activos = computed(() => this.auxiliares().filter((u) => u.activo));
  protected readonly fechaCorta = fechaCorta;

  /** Sábado que se está cargando: un auxiliar con su turno */
  protected nueva: { fecha: string; auxiliarId: string | null; turno: TurnoCodigo | null } = { fecha: '', auxiliarId: null, turno: null };

  ngOnInit(): void {
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    try {
      const [aux, rot, prog, inv] = await Promise.all([this.op.listarAuxiliares(), this.op.listarRotacion(), this.op.listarTurnosProgramados(),
        this.op.listarInvitados(), this.op.horarios().length ? null : this.op.cargarHorarios()]);
      this.auxiliares.set(aux);
      this.invitados.set(inv);
      this.rotacion.set(rot);
      this.turnosProgramados.set(prog);
    } catch (e) {
      this.notificaciones.error(e, 'No se cargaron los auxiliares');
    }
  }

  /** Pasa una cuenta en espera a auxiliar activo (al entrar completa su nombre y contraseña) */
  protected async habilitar(u: Perfil): Promise<void> {
    if (!(await this.confirmacion.pedir({ titulo: '¿Habilitar esta cuenta?', mensaje: `${u.nombre_completo} (${u.correo}) podrá entrar como auxiliar.`,
      aceptar: 'Sí, habilitar', peligro: false }))) return;
    this.guardando.set(true);
    try {
      await this.op.habilitarUsuario(u.id);
      this.notificaciones.exito(`${u.nombre_completo} ya es auxiliar. Ahora elige su turno en la lista.`);
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e, 'No se habilitó');
    } finally {
      this.guardando.set(false);
    }
  }

  protected fallasDe(categoria: CategoriaFalla): FallaPc[] {
    return this.op.fallas().filter((f) => f.categoria === categoria);
  }

  protected async abrirFallas(): Promise<void> {
    try {
      await this.op.cargarFallas();
      this.fallasAbierto.set(true);
    } catch (e) {
      this.notificaciones.error(e, 'No se cargó la lista de fallas');
    }
  }

  protected async agregarFalla(): Promise<void> {
    // Enter dos veces seguidas no agrega la misma falla dos veces
    if (this.guardando()) return;
    const nombre = this.fallaNueva.nombre.trim();
    if (nombre.length < 2) return this.notificaciones.aviso('Escribe el nombre de la falla.');
    if (this.op.fallas().some((f) => f.nombre.trim().toLowerCase() === nombre.toLowerCase())) {
      return this.notificaciones.aviso('Esa falla ya está en la lista.');
    }
    this.guardando.set(true);
    try {
      await this.op.agregarFalla(nombre, this.fallaNueva.categoria);
      this.fallaNueva = { nombre: '', categoria: this.fallaNueva.categoria };
      this.notificaciones.exito(`"${nombre}" agregada a la lista.`);
    } catch (e) {
      this.notificaciones.error(e, 'No se agregó');
    } finally {
      this.guardando.set(false);
    }
  }

  protected async cambiarFalla(falla: FallaPc, cambios: Partial<Pick<FallaPc, 'categoria' | 'activo'>>): Promise<void> {
    try {
      await this.op.actualizarFalla(falla.id, cambios);
    } catch (e) {
      this.notificaciones.error(e, 'No se guardó');
    }
  }

  protected async abrirHorarios(): Promise<void> {
    try {
      const lista = await this.op.cargarHorarios();
      this.edicionHorarios.set(lista.map((h) => ({ ...h, hora_inicio: hhmm(h.hora_inicio), hora_fin: hhmm(h.hora_fin) })));
    } catch (e) {
      this.notificaciones.error(e, 'No se cargaron los horarios');
    }
  }

  protected async guardarHorarios(): Promise<void> {
    const lista = this.edicionHorarios();
    if (!lista) return;
    const mal = lista.find((h) => !h.hora_inicio || !h.hora_fin || aMinutos(h.hora_fin) <= aMinutos(h.hora_inicio));
    if (mal) return this.notificaciones.aviso(`${NOMBRE_TURNO[mal.turno]}: la hora de fin debe ser después de la de inicio.`);
    this.guardando.set(true);
    try {
      await this.op.guardarHorarios(lista);
      this.edicionHorarios.set(null);
      this.notificaciones.exito('Horarios de turno guardados.');
    } catch (e) {
      this.notificaciones.error(e, 'No se guardaron los horarios');
    } finally {
      this.guardando.set(false);
    }
  }

  /** Turno de lunes a viernes que tiene hoy */
  protected turnoDe(id: string): TurnoCodigo | null {
    return turnosDeHoy(this.turnosProgramados(), id, this.hoy).actual?.turno ?? null;
  }

  /** Cambia el turno desde hoy; los cambios que estaban programados para después se quitan */
  protected async cambiarTurno(u: Perfil, turno: TurnoCodigo): Promise<void> {
    this.guardando.set(true);
    try {
      // Primero se guarda el nuevo; solo si salió bien se quitan los programados para después
      const futuros = this.turnosProgramados().filter((t) => t.perfil_id === u.id && t.desde > this.hoy).map((t) => t.id);
      await this.op.programarTurnos([{ perfil_id: u.id, turno }], this.hoy);
      await this.op.eliminarTurnosProgramados(futuros);
      this.notificaciones.exito(`${u.nombre_completo}: turno ${NOMBRE_TURNO[turno]}.`);
    } catch (e) {
      this.notificaciones.error(e, 'No se cambió el turno');
      // El desplegable vuelve al turno guardado
      this.auxiliares.set([]);
    } finally {
      this.guardando.set(false);
      await this.cargar();
    }
  }

  protected async agregarRotacion(): Promise<void> {
    const { fecha, auxiliarId, turno } = this.nueva;
    if (!fecha) return this.notificaciones.aviso('Elige la fecha del sábado.');
    if (diaIso(fecha) !== 6) return this.notificaciones.aviso('La fecha elegida no es un sábado.');
    if (!auxiliarId) return this.notificaciones.aviso('Elige el auxiliar.');
    if (!turno) return this.notificaciones.aviso('Elige el turno del sábado.');
    this.guardando.set(true);
    try {
      await this.op.guardarRotacion([{ fecha, auxiliar_id: auxiliarId, turno, nota: null }]);
      // Se queda el sábado elegido para agregar al siguiente auxiliar
      this.nueva = { fecha, auxiliarId: null, turno: null };
      this.notificaciones.exito('Auxiliar agregado al sábado.');
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e, 'No se guardó');
    } finally {
      this.guardando.set(false);
    }
  }

  protected async cambiarTurnoSabado(r: RotacionSabado, turno: TurnoCodigo): Promise<void> {
    try {
      await this.op.guardarRotacion([{ fecha: r.fecha, auxiliar_id: r.auxiliar_id, turno, nota: r.nota }]);
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e, 'No se guardó');
      // El desplegable vuelve al turno guardado
      this.rotacion.set([]);
      await this.cargar();
    }
  }

  protected async eliminarRotacion(r: RotacionSabado): Promise<void> {
    if (!(await this.confirmacion.pedir({ titulo: '¿Quitar del sábado?', mensaje: `Se quita a ${r.auxiliar?.nombre_completo || 'este auxiliar'} del sábado ${fechaCorta(r.fecha)}.`, aceptar: 'Sí, quitar' }))) return;
    try {
      await this.op.eliminarRotacion(r.id);
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e);
    }
  }
}
