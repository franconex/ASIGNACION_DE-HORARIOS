import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconoComponent } from '../../compartido/icono.component';
import { ModalComponent } from '../../compartido/modal.component';
import { CategoriaFalla, FallaPc, HorarioTurno, NOMBRE_ROL, Perfil, RotacionSabado, TurnoCodigo, TurnoProgramado } from '../../core/modelos';
import { CATEGORIAS_FALLA } from '../../core/tickets';
import { NotificacionesService } from '../../core/notificaciones.service';
import { OperacionService, turnosDeHoy } from '../../core/operacion.service';
import { environment } from '../../../environments/environment';
import { aMinutos, fechaActual, fechaCorta, hhmm } from '../../core/fechas';

const NOMBRE_TURNO: Record<string, string> = { M: 'Mañana', MD: 'Mediodía', T: 'Tarde', N: 'Noche' };

/**
 * Apartado de Auxiliares (admin y encargado): el equipo con su turno actual
 * y próximo. Para cada uno se elige el turno y la fecha en que empieza a
 * correr; y los turnos de sábado (uno o varios auxiliares por sábado).
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
        <p class="mt-0.5 text-sm text-slate-600">Pon la fecha en que empiezan los nuevos turnos, elige el turno de cada auxiliar y guarda.</p>
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

    <!-- FECHA ÚNICA + GUARDAR -->
    <div class="tarjeta mb-3 flex flex-wrap items-end gap-3 p-3">
      <div>
        <label class="etiqueta" for="turnos-desde">Los nuevos turnos empiezan el</label>
        <input id="turnos-desde" type="date" class="campo !w-44" [(ngModel)]="desde">
      </div>
      <button class="btn-primario" (click)="guardarTurnos()" [disabled]="guardando()">
        <app-icono nombre="check" [tamano]="16" /> {{ guardando() ? 'Guardando…' : 'Guardar turnos' }}
      </button>
      <p class="text-xs text-slate-500">Solo se guardan los auxiliares a los que les elegiste un turno.</p>
    </div>

    <!-- LISTADO Y TURNOS: tarjetas en el celular -->
    <div class="mb-8 space-y-2 md:hidden">
      @for (u of auxiliares(); track u.id) {
        <article class="tarjeta p-3">
          <div class="mb-2 flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="truncate font-medium">{{ u.nombre_completo }}@if (u.rol === 'encargado') { <span class="chip ml-1 bg-marca-50 text-marca-700">{{ nombreRol.encargado }}</span> }</p>
              <p class="truncate text-xs text-slate-500">{{ u.correo }}</p>
            </div>
            <span class="chip shrink-0" [class]="u.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'">{{ u.activo ? 'Activo' : 'Inactivo' }}</span>
          </div>
          <dl class="mb-2 grid grid-cols-2 gap-2 text-sm">
            <div><dt class="text-xs text-slate-500">Turno actual</dt><dd>{{ textoTurno(u.id, 'actual') }}</dd></div>
            <div><dt class="text-xs text-slate-500">Próximo turno</dt><dd>{{ textoTurno(u.id, 'proximo') }}</dd></div>
          </dl>
          <div class="flex items-center gap-2">
            <select class="campo min-w-0 flex-1" [ngModel]="elegidos()[u.id] ?? null" (ngModelChange)="elegir(u.id, $event)" [attr.aria-label]="'Nuevo turno de ' + u.nombre_completo">
              <option [ngValue]="null">Nuevo turno: sin cambio</option>
              <option value="M">Mañana</option><option value="MD">Mediodía</option>
              <option value="T">Tarde</option><option value="N">Noche</option>
            </select>
            <button class="chip shrink-0 cursor-pointer py-1.5" [class]="u.sabado_rotativo ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600'"
                    (click)="alternarSabado(u)">Sábado: {{ u.sabado_rotativo ? 'Sí' : 'No' }}</button>
          </div>
        </article>
      } @empty {
        <p class="tarjeta py-8 text-center text-sm text-slate-500">No hay auxiliares. El administrador los crea en Configuración → Usuarios.</p>
      }
    </div>

    <!-- LISTADO Y TURNOS: tabla en PC -->
    <div class="tarjeta mb-8 hidden overflow-x-auto md:block">
      <table class="tabla">
        <thead>
          <tr><th>Auxiliar</th><th>Turno actual</th><th>Próximo turno</th><th>Nuevo turno</th><th>Sábado rotativo</th><th>Estado</th></tr>
        </thead>
        <tbody>
          @for (u of auxiliares(); track u.id) {
            <tr>
              <td>
                <p class="font-medium">{{ u.nombre_completo }}@if (u.rol === 'encargado') { <span class="chip ml-1 bg-marca-50 text-marca-700">{{ nombreRol.encargado }}</span> }</p>
                <p class="text-xs text-slate-500">{{ u.correo }}</p>
              </td>
              <td>{{ textoTurno(u.id, 'actual') }}</td>
              <td>{{ textoTurno(u.id, 'proximo') }}</td>
              <td>
                <select class="campo !w-36 !py-1" [ngModel]="elegidos()[u.id] ?? null" (ngModelChange)="elegir(u.id, $event)" aria-label="Nuevo turno">
                  <option [ngValue]="null">Sin cambio</option>
                  <option value="M">Mañana</option><option value="MD">Mediodía</option>
                  <option value="T">Tarde</option><option value="N">Noche</option>
                </select>
              </td>
              <td>
                <button class="chip cursor-pointer" [class]="u.sabado_rotativo ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600'"
                        (click)="alternarSabado(u)">{{ u.sabado_rotativo ? 'Sí' : 'No' }}</button>
              </td>
              <td><span class="chip" [class]="u.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'">{{ u.activo ? 'Activo' : 'Inactivo' }}</span></td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="py-8 text-center text-sm text-slate-500">No hay auxiliares. El administrador los crea en Configuración → Usuarios.</td></tr>
          }
        </tbody>
      </table>
      <p class="px-3 py-2 text-xs text-slate-400">Para crear o desactivar cuentas, usa Configuración → Usuarios (solo admin).</p>
    </div>

    <!-- ROTACIÓN DE SÁBADOS: uno o varios auxiliares por sábado, cada uno con su turno -->
    <section>
      <h2 class="mb-1 text-lg font-semibold">Turnos de sábado</h2>
      <p class="mb-2 text-sm text-slate-600">El sábado vale este turno (no el de lunes a viernes). Si un sábado tiene auxiliares aquí, solo ellos cierran turno ese día.</p>
      <div class="tarjeta mb-3 space-y-3 p-3">
        <div class="flex flex-wrap items-end gap-3">
          <div><label class="etiqueta" for="sab-fecha">Sábado</label><input id="sab-fecha" type="date" class="campo !w-44" [(ngModel)]="nueva.fecha"></div>
          <div>
            <label class="etiqueta" for="sab-turno">Turno</label>
            <select id="sab-turno" class="campo !w-32" [(ngModel)]="nueva.turno">
              <option [ngValue]="null">—</option>
              <option value="M">Mañana</option><option value="MD">Mediodía</option><option value="T">Tarde</option><option value="N">Noche</option>
            </select>
          </div>
          <div class="min-w-48 flex-1"><label class="etiqueta" for="sab-nota">Nota</label><input id="sab-nota" maxlength="200" class="campo" [(ngModel)]="nueva.nota" placeholder="Opcional"></div>
        </div>
        <div>
          <p class="etiqueta">Auxiliares ({{ nueva.auxiliares.length }} elegidos)</p>
          <div class="flex flex-wrap gap-1.5">
            @for (u of auxiliares(); track u.id) {
              @if (u.activo) {
                <button type="button" class="chip cursor-pointer py-1.5"
                        [class]="nueva.auxiliares.includes(u.id) ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'"
                        (click)="alternarAuxiliarSabado(u.id)">{{ u.nombre_completo }}</button>
              }
            }
          </div>
        </div>
        <button class="btn-primario" (click)="agregarRotacion()" [disabled]="guardando()"><app-icono nombre="agregar" [tamano]="16" /> Agregar al sábado</button>
      </div>

      <div class="tarjeta overflow-x-auto">
        <table class="tabla">
          <thead><tr><th>Sábado</th><th>Auxiliar</th><th>Turno</th><th>Nota</th><th></th></tr></thead>
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
                <td class="text-sm text-slate-500">{{ r.nota || '—' }}</td>
                <td class="text-right"><button class="btn-fantasma btn-sm text-red-600" (click)="eliminarRotacion(r)" aria-label="Quitar"><app-icono nombre="eliminar" [tamano]="15" /></button></td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="py-6 text-center text-sm text-slate-500">Aún no hay sábados asignados.</td></tr>
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

  protected readonly nombreTurno = NOMBRE_TURNO;
  protected readonly nombreRol = NOMBRE_ROL;
  protected readonly auxiliares = signal<Perfil[]>([]);
  protected readonly rotacion = signal<RotacionSabado[]>([]);
  protected readonly turnosProgramados = signal<TurnoProgramado[]>([]);
  protected readonly guardando = signal(false);

  /** Catálogo de fallas */
  protected readonly categoriasFalla = CATEGORIAS_FALLA;
  protected readonly fallasAbierto = signal(false);
  protected fallaNueva: { nombre: string; categoria: CategoriaFalla } = { nombre: '', categoria: 'hardware' };

  /** Horarios de turno en edición (copia; null = cerrado) */
  protected readonly edicionHorarios = signal<HorarioTurno[] | null>(null);

  /** Fecha en que empiezan los nuevos turnos (una sola para todos) */
  protected desde = '';
  /** Turno nuevo elegido por auxiliar (los que no están, no cambian) */
  protected readonly elegidos = signal<Record<string, TurnoCodigo>>({});

  protected readonly fechaCorta = fechaCorta;
  /** Sábado que se está cargando: uno o varios auxiliares con el mismo turno */
  protected nueva: { fecha: string; auxiliares: string[]; turno: TurnoCodigo | null; nota: string } =
    { fecha: '', auxiliares: [], turno: null, nota: '' };

  ngOnInit(): void {
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    try {
      const [aux, rot, prog] = await Promise.all([this.op.listarAuxiliares(), this.op.listarRotacion(), this.op.listarTurnosProgramados()]);
      this.auxiliares.set(aux);
      this.rotacion.set(rot);
      this.turnosProgramados.set(prog);
    } catch (e) {
      this.notificaciones.error(e, 'No se cargaron los auxiliares');
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

  protected elegir(perfilId: string, turno: TurnoCodigo | null): void {
    this.elegidos.update((e) => {
      const copia = { ...e };
      if (turno) copia[perfilId] = turno;
      else delete copia[perfilId];
      return copia;
    });
  }

  /** Texto del turno vigente o del próximo de un auxiliar, con la fecha en que empieza */
  protected textoTurno(perfilId: string, cual: 'actual' | 'proximo'): string {
    const { actual, proximo } = turnosDeHoy(this.turnosProgramados(), perfilId, fechaActual(environment.zonaHoraria));
    const t = cual === 'actual' ? actual : proximo;
    if (!t) return cual === 'actual' ? 'Sin turno' : '—';
    return `${NOMBRE_TURNO[t.turno]} · desde ${fechaCorta(t.desde)}`;
  }

  /** Guarda de una vez los turnos elegidos, todos desde la misma fecha */
  protected async guardarTurnos(): Promise<void> {
    const filas = Object.entries(this.elegidos()).map(([perfil_id, turno]) => ({ perfil_id, turno }));
    if (!this.desde) return this.notificaciones.aviso('Pon la fecha en que empiezan los nuevos turnos.');
    if (!filas.length) return this.notificaciones.aviso('Elige el nuevo turno de al menos un auxiliar.');
    this.guardando.set(true);
    try {
      await this.op.programarTurnos(filas, this.desde);
      this.elegidos.set({});
      this.notificaciones.exito(filas.length === 1 ? 'Turno guardado.' : `${filas.length} turnos guardados.`);
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e, 'No se programó el turno');
    } finally {
      this.guardando.set(false);
    }
  }

  protected async alternarSabado(u: Perfil): Promise<void> {
    try {
      await this.op.asignarTurno(u.id, (u.turno_habitual ?? null) as TurnoCodigo | null, !u.sabado_rotativo);
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e);
    }
  }

  protected alternarAuxiliarSabado(id: string): void {
    const l = this.nueva.auxiliares;
    this.nueva.auxiliares = l.includes(id) ? l.filter((x) => x !== id) : [...l, id];
  }

  protected async agregarRotacion(): Promise<void> {
    const { fecha, auxiliares, turno } = this.nueva;
    if (!fecha) return this.notificaciones.aviso('Elige la fecha del sábado.');
    if (new Date(fecha + 'T00:00:00').getDay() !== 6) return this.notificaciones.aviso('La fecha elegida no es un sábado.');
    if (!turno) return this.notificaciones.aviso('Elige el turno del sábado.');
    if (!auxiliares.length) return this.notificaciones.aviso('Elige al menos un auxiliar.');
    this.guardando.set(true);
    try {
      const nota = this.nueva.nota.trim() || null;
      await this.op.guardarRotacion(auxiliares.map((auxiliar_id) => ({ fecha, auxiliar_id, turno, nota })));
      this.nueva = { fecha, auxiliares: [], turno: null, nota: '' };
      this.notificaciones.exito(auxiliares.length === 1 ? 'Auxiliar agregado al sábado.' : `${auxiliares.length} auxiliares agregados al sábado.`);
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
    }
  }

  protected async eliminarRotacion(r: RotacionSabado): Promise<void> {
    if (!confirm(`¿Quitar a ${r.auxiliar?.nombre_completo || 'este auxiliar'} del sábado ${fechaCorta(r.fecha)}?`)) return;
    try {
      await this.op.eliminarRotacion(r.id);
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e);
    }
  }
}
