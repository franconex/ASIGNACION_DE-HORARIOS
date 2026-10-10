import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IconoComponent } from '../../compartido/icono.component';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { aMinutos, hhmm, horaActual } from '../../core/fechas';
import { environment } from '../../../environments/environment';
import { PcBajaCierre, ReporteTurno, RotacionSabado, TareaReporte, TurnoCodigo, TurnoProgramado } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { ConfirmacionService } from '../../core/confirmacion.service';
import { OperacionService, textoRetraso, turnoDeLaHora, turnoDelDia } from '../../core/operacion.service';
import { fechaActual } from '../../core/fechas';

const TURNOS: { valor: TurnoCodigo; texto: string }[] = [
  { valor: 'M', texto: 'Mañana' },
  { valor: 'MD', texto: 'Mediodía' },
  { valor: 'T', texto: 'Tarde' },
  { valor: 'N', texto: 'Noche' },
];
const NOMBRE_TURNO: Record<TurnoCodigo, string> = { M: 'Mañana', MD: 'Mediodía', T: 'Tarde', N: 'Noche' };

/** Datos de un reporte en edición (solo tareas pendientes: las hechas no se tocan) */
interface EdicionReporte {
  id: number;
  turno: TurnoCodigo;
  novedades: string;
  tareas: { id?: number; descripcion: string; ambiente_id: number | null }[];
}

/** Hora actual 'HH:MM' de La Paz */
function horaLaPaz(): string {
  return horaActual(environment.zonaHoraria);
}

/**
 * Cerrar turno: al terminar su turno, el auxiliar deja las novedades y
 * la lista de tareas pendientes. Las tareas quedan arriba para el siguiente
 * turno, que las va marcando como hechas. Cada reporte guarda el turno que
 * se reporta y el turno en que realmente se hizo (por la hora de La Paz).
 * Un reporte se puede editar (su autor, admin o encargado), pero si ya tiene
 * tareas hechas no se puede eliminar; una tarea hecha queda fija.
 */
@Component({
  selector: 'app-turno',
  imports: [FormsModule, IconoComponent, DatePipe, RouterLink],
  template: `
    <header class="mb-4">
      <h1 class="text-2xl font-bold">Cerrar turno</h1>
      <p class="mt-0.5 text-sm text-slate-600">Al terminar tu turno, deja las novedades y las tareas pendientes para el siguiente. Las tareas se tachan cuando alguien las hace.</p>
    </header>

    <div class="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
      <!-- TAREAS PENDIENTES (de todos los turnos) -->
      <section class="tarjeta p-4">
        <h2 class="mb-3 flex items-center gap-2 font-semibold">
          <app-icono nombre="alerta" [tamano]="18" class="text-amber-600" /> Tareas pendientes
          <span class="chip bg-amber-100 text-amber-800">{{ pendientes().length }}</span>
        </h2>
        <div class="space-y-1.5">
          @for (t of pendientes(); track t.id) {
            <label class="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-2.5 transition hover:border-emerald-300 hover:bg-emerald-50/50">
              <input type="checkbox" class="mt-0.5 h-5 w-5 shrink-0 accent-emerald-600" [disabled]="!auth.puedeOperar()" (change)="marcar(t, true)">
              <span class="min-w-0 flex-1">
                <span class="block text-sm">
                  @if (t.ambiente?.codigo) { <span class="chip mr-1 bg-marca-50 text-marca-700">{{ t.ambiente?.codigo }}</span> }
                  {{ t.descripcion }}
                </span>
                <span class="text-[11px] text-slate-400">
                  Dejó {{ t.reporte?.autor?.nombre_completo || '—' }} · {{ nombreTurno[t.reporte?.turno ?? 'M'] }} {{ t.creado_en | date: 'dd/MM HH:mm' }}
                </span>
              </span>
            </label>
          } @empty {
            <p class="rounded-lg border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
              <app-icono nombre="ok" [tamano]="20" class="mb-1 text-emerald-600" /><br>No hay tareas pendientes.
            </p>
          }
        </div>
        @if (op.pendientes().length) {
          <a routerLink="/atenciones" class="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            <app-icono nombre="registros" [tamano]="15" /> Además hay <b>{{ op.pendientes().length }}</b> ticket(s) sin resolver en Atenciones →
          </a>
        }
      </section>

      <!-- NUEVO REPORTE -->
      @if (auth.puedeOperar()) {
        <section class="tarjeta p-4">
          <h2 class="mb-3 flex items-center gap-2 font-semibold"><app-icono nombre="editar" [tamano]="18" /> Cerrar turno</h2>

          @if (auth.esAuxiliar()) {
            @if (miTurno(); as mio) {
              <p class="mb-3 rounded-lg bg-marca-50 px-3 py-2 text-sm text-marca-700">
                Tu turno{{ hoyDia().sabado ? ' de este sábado' : '' }} es <b>{{ nombreTurno[mio] }}</b> ({{ rangoDe(mio) }}).
                @if (!enTurno()) {
                  Podrás cerrarlo desde las {{ inicioDe(mio) }}.
                } @else if (retraso() > 0) {
                  <span class="font-semibold text-amber-700">Tu turno terminó a las {{ finDe(mio) }}: el cierre quedará con {{ textoRetraso(retraso()) }} de retraso.</span>
                } @else {
                  Estás en tu turno: puedes cerrarlo.
                }
              </p>
            } @else {
              <p class="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {{ hoyDia().sabado ? 'Hoy no estás en la rotación del sábado.' : 'No tienes turno asignado. Pide al encargado que lo programe en Auxiliares.' }}
              </p>
            }
          }

          @if (auth.esEncargado() && miTurno(); as mio) {
            <p class="mb-3 rounded-lg bg-marca-50 px-3 py-2 text-sm text-marca-700">
              Tu turno{{ hoyDia().sabado ? ' de este sábado' : '' }} es <b>{{ nombreTurno[mio] }}</b> ({{ rangoDe(mio) }}). Como encargado de auxiliares puedes cerrar cualquier turno.
            </p>
          }

          @if (!auth.esAuxiliar()) {
          <label class="etiqueta">¿De qué turno es el reporte?</label>
          <div class="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 sm:grid-cols-4">
            @for (t of turnos; track t.valor) {
              <button type="button" class="rounded-md py-1.5 text-sm font-medium transition"
                      [class]="turno() === t.valor ? 'bg-superficie text-marca-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'"
                      (click)="turno.set(t.valor); cargarMisBajas()">
                {{ t.texto }}@if (t.valor === turnoAhora()) { <span class="text-[10px] text-slate-400"> · ahora</span> }
                <span class="block text-[10px] font-normal text-slate-400">{{ rangoDe(t.valor) }}</span>
              </button>
            }
          </div>
          @if (retraso() > 0) {
            <p class="-mt-2 mb-3 flex items-center gap-1 text-xs text-amber-700">
              <app-icono nombre="alerta" [tamano]="13" /> Este turno terminó a las {{ finDe(turno()) }}: el cierre quedará con {{ textoRetraso(retraso()) }} de retraso.
            </p>
          }
          }

          @if (puedeCerrar()) {
          <label class="etiqueta">Novedades / observaciones</label>
          <textarea maxlength="2000" class="campo mb-3" rows="3" [(ngModel)]="novedades" placeholder="Ej: se cortó la luz 15 min en el bloque B; el proyector del LAB-05 parpadea."></textarea>

          <label class="etiqueta">Tareas pendientes para el siguiente turno</label>
          <div class="space-y-1.5">
            @for (t of tareas(); track $index) {
              <div class="flex items-center gap-1.5">
                <select class="campo !w-28 !px-2 !py-1.5" [ngModel]="t.ambiente_id" (ngModelChange)="cambiarTarea($index, { ambiente_id: $event })">
                  <option [ngValue]="null">Sin lab</option>
                  @for (lab of catalogos.laboratorios(); track lab.id) { <option [ngValue]="lab.id">{{ lab.codigo }}</option> }
                </select>
                <input maxlength="300" class="campo !py-1.5" [ngModel]="t.descripcion" (ngModelChange)="cambiarTarea($index, { descripcion: $event })"
                       (keydown.enter)="$event.preventDefault(); agregarTarea()" placeholder="Ej: terminar de instalar SPSS en SCPC105–SCPC110">
                <button type="button" class="btn-fantasma btn-sm text-red-600" (click)="quitarTarea($index)" aria-label="Quitar"><app-icono nombre="cerrar" [tamano]="15" /></button>
              </div>
            }
          </div>
          <button type="button" class="btn-fantasma btn-sm mt-1.5 text-marca-600" (click)="agregarTarea()"><app-icono nombre="agregar" [tamano]="14" /> Agregar tarea</button>

          <div class="mt-4 rounded-lg border p-3" [class]="misBajas().length ? 'border-rose-200 bg-rose-50' : 'border-slate-200'">
            <p class="text-sm font-medium" [class]="misBajas().length ? 'text-rose-800' : 'text-slate-600'">
              PCs que diste de baja en este turno: {{ misBajas().length }}
            </p>
            @for (p of misBajas(); track p.etiqueta + p.en) {
              <p class="mt-1 text-xs text-rose-800"><b>{{ p.etiqueta }}</b>{{ p.lab ? ' (' + p.lab + ')' : '' }} — {{ p.motivo || 'sin motivo' }}</p>
            }
            <p class="mt-1 text-[11px] text-slate-500">Se agregan solas al cierre; no hace falta escribirlas.</p>
          </div>

          <label class="etiqueta mt-4">Foto del armario de llaves <span class="font-normal text-slate-400">(se borra a las 12:00; la descripción se queda)</span></label>
          <label class="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-slate-300 p-3 hover:border-marca-400">
            @if (vistaFoto()) {
              <img [src]="vistaFoto()" alt="Vista previa" class="h-20 w-20 rounded-md object-cover">
              <span class="text-sm text-slate-600">Toca para cambiar la foto</span>
            } @else {
              <span class="flex h-20 w-20 items-center justify-center rounded-md bg-slate-100 text-slate-400"><app-icono nombre="camara" [tamano]="26" /></span>
              <span class="text-sm text-slate-600">Tomar o elegir foto</span>
            }
            <input type="file" accept="image/*" capture="environment" class="sr-only" (change)="elegirFoto($event)">
          </label>
          @if (foto()) {
            <button type="button" class="btn-fantasma btn-sm mt-1 text-red-600" (click)="quitarFoto()"><app-icono nombre="cerrar" [tamano]="14" /> Quitar foto</button>
          }

          <div class="mt-4 flex justify-end">
            <button class="btn-primario" (click)="guardar()" [disabled]="guardando()">
              <app-icono nombre="check" [tamano]="16" /> {{ guardando() ? 'Guardando…' : 'Cerrar turno' }}
            </button>
          </div>
          }
        </section>
      }
    </div>

    <!-- REPORTES ANTERIORES -->
    <section class="mt-6">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-lg font-semibold">Reportes anteriores</h2>
        <div class="flex gap-1">
          <button class="rounded-md border px-2 py-1 text-xs" [class]="!filtroTurno() ? 'border-marca-600 bg-marca-600 text-white' : 'border-slate-200 hover:border-slate-300'"
                  (click)="filtroTurno.set(null)">Todos</button>
          @for (t of turnos; track t.valor) {
            <button class="rounded-md border px-2 py-1 text-xs" [class]="filtroTurno() === t.valor ? 'border-marca-600 bg-marca-600 text-white' : 'border-slate-200 hover:border-slate-300'"
                    (click)="filtroTurno.set(t.valor)">{{ t.texto }}</button>
          }
        </div>
      </div>
      <div class="space-y-2">
        @for (r of reportesFiltrados(); track r.id) {
          <article class="tarjeta border-l-4 border-l-marca-500 p-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="chip bg-marca-50 text-marca-700">
                Turno {{ nombreTurno[r.turno].toLowerCase() }}@if (r.hora_inicio_turno && r.hora_fin_turno) { · {{ hhmm(r.hora_inicio_turno) }}–{{ hhmm(r.hora_fin_turno) }} }
              </span>
              @if (r.minutos_retraso) {
                <span class="chip bg-amber-100 text-amber-800">Turno cerrado con {{ textoRetraso(r.minutos_retraso) }} de retraso</span>
              } @else if (r.minutos_retraso === 0) {
                <span class="chip bg-emerald-100 text-emerald-700">Cerrado a tiempo</span>
              }
              <span class="text-sm font-semibold">{{ r.creado_en | date: 'EEEE dd/MM/yyyy HH:mm' }}</span>
              <span class="text-sm text-slate-500">· {{ r.autor?.nombre_completo || '—' }}</span>
              <span class="ml-auto flex items-center gap-0.5">
                @if (tieneHechas(r)) {
                  <span class="mr-1 inline-flex items-center gap-1 text-[11px] text-slate-400" title="Tiene tareas hechas: no se puede eliminar">
                    <app-icono nombre="ok" [tamano]="12" /> con tareas hechas
                  </span>
                }
                @if (puedeEditar(r) && edicion()?.id !== r.id) {
                  <button class="btn-fantasma btn-sm" (click)="editar(r)" title="Editar reporte"><app-icono nombre="editar" [tamano]="14" /></button>
                }
                @if (puedeBorrar(r)) {
                  <button class="btn-fantasma btn-sm text-red-600" (click)="eliminar(r)" title="Eliminar reporte"><app-icono nombre="eliminar" [tamano]="14" /></button>
                }
              </span>
            </div>
            @if (edicion()?.id === r.id) {
              <!-- Edición del reporte (las tareas hechas no se tocan) -->
              @if (edicion(); as e) {
                <div class="mt-2 space-y-2 rounded-lg border border-marca-200 bg-marca-50/50 p-3">
                  @if (!auth.esAuxiliar()) {
                  <div class="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1">
                    @for (t of turnos; track t.valor) {
                      <button type="button" class="rounded-md py-1 text-sm font-medium transition"
                              [class]="e.turno === t.valor ? 'bg-superficie text-marca-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'"
                              (click)="cambiarEdicion({ turno: t.valor })">{{ t.texto }}</button>
                    }
                  </div>
                  }
                  <textarea maxlength="2000" class="campo" rows="3" [ngModel]="e.novedades" (ngModelChange)="cambiarEdicion({ novedades: $event })" placeholder="Novedades / observaciones"></textarea>
                  @for (t of hechasDe(r); track t.id) {
                    <p class="flex items-center gap-2 text-sm text-slate-400" title="Tarea hecha: ya no se modifica">
                      <app-icono nombre="ok" [tamano]="13" class="text-emerald-600" />
                      <span class="line-through">@if (t.ambiente?.codigo) { <b>{{ t.ambiente?.codigo }}:</b> } {{ t.descripcion }}</span>
                    </p>
                  }
                  @for (t of e.tareas; track $index) {
                    <div class="flex items-center gap-1.5">
                      <select class="campo !w-28 !px-2 !py-1.5" [ngModel]="t.ambiente_id" (ngModelChange)="cambiarTareaEdicion($index, { ambiente_id: $event })">
                        <option [ngValue]="null">Sin lab</option>
                        @for (lab of catalogos.laboratorios(); track lab.id) { <option [ngValue]="lab.id">{{ lab.codigo }}</option> }
                      </select>
                      <input maxlength="300" class="campo !py-1.5" [ngModel]="t.descripcion" (ngModelChange)="cambiarTareaEdicion($index, { descripcion: $event })" placeholder="Tarea pendiente">
                      <button type="button" class="btn-fantasma btn-sm text-red-600" (click)="quitarTareaEdicion($index)" aria-label="Quitar"><app-icono nombre="cerrar" [tamano]="15" /></button>
                    </div>
                  }
                  <div class="flex items-center justify-between">
                    <button type="button" class="btn-fantasma btn-sm text-marca-600" (click)="agregarTareaEdicion()"><app-icono nombre="agregar" [tamano]="14" /> Agregar tarea</button>
                    <div class="flex gap-1.5">
                      <button type="button" class="btn-secundario btn-sm" (click)="edicion.set(null)">Cancelar</button>
                      <button type="button" class="btn-primario btn-sm" [disabled]="guardando()" (click)="guardarEdicion(r)">{{ guardando() ? 'Guardando…' : 'Guardar cambios' }}</button>
                    </div>
                  </div>
                </div>
              }
            } @else {
            @if (r.novedades) { <p class="mt-1.5 text-sm whitespace-pre-line">{{ r.novedades }}</p> }
            @if (r.pcs_baja?.length) {
              <div class="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
                <p class="font-semibold">PCs dadas de baja en el turno ({{ r.pcs_baja!.length }})</p>
                @for (p of r.pcs_baja; track p.etiqueta + p.en) {
                  <p><b>{{ p.etiqueta }}</b>{{ p.lab ? ' (' + p.lab + ')' : '' }} — {{ p.motivo || 'sin motivo' }} · {{ p.en | date: 'HH:mm' }}</p>
                }
              </div>
            }
            @if (r.foto_path && urlsFotos().get(r.foto_path); as url) {
              <a [href]="url" target="_blank" rel="noopener" class="mt-2 inline-flex items-center gap-2 text-xs text-slate-500">
                <img [src]="url" alt="Foto del armario de llaves" class="h-20 w-20 rounded-md object-cover">
                <span>Foto del cierre · se borra {{ r.foto_expira | date: 'dd/MM' }} a las 12:00</span>
              </a>
            }
            @if (r.tareas?.length) {
              <ul class="mt-2 space-y-1">
                @for (t of r.tareas; track t.id) {
                  <li class="flex items-start gap-2 text-sm">
                    <button class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border disabled:cursor-not-allowed"
                            [class]="t.hecha ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'"
                            [disabled]="!auth.puedeOperar() || (t.hecha && !auth.puedeGestionarAuxiliares())" (click)="marcar(t, !t.hecha)"
                            [title]="t.hecha ? (auth.puedeGestionarAuxiliares() ? 'Desmarcar' : 'Tarea hecha') : 'Marcar como hecha'">
                      @if (t.hecha) { <app-icono nombre="check" [tamano]="11" [grosor]="3" /> }
                    </button>
                    <span [class.line-through]="t.hecha" [class.text-slate-400]="t.hecha">
                      @if (t.ambiente?.codigo) { <b>{{ t.ambiente?.codigo }}:</b> }
                      {{ t.descripcion }}
                    </span>
                    @if (t.hecha) { <span class="text-[11px] whitespace-nowrap text-emerald-700">✓ {{ t.ejecutor?.nombre_completo }}</span> }
                  </li>
                }
              </ul>
            }
            }
          </article>
        } @empty {
          <p class="tarjeta p-6 text-center text-sm text-slate-500">{{ filtroTurno() ? 'No hay reportes de ese turno.' : 'Aún no hay reportes de turno.' }}</p>
        }
      </div>
    </section>
  `,
})
export class TurnoComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly op = inject(OperacionService);
  protected readonly catalogos = inject(CatalogosService);
  private readonly notificaciones = inject(NotificacionesService);
  private readonly confirmacion = inject(ConfirmacionService);

  protected readonly turnos = TURNOS;
  protected readonly nombreTurno = NOMBRE_TURNO;

  protected readonly reportes = signal<ReporteTurno[]>([]);
  protected readonly pendientes = signal<TareaReporte[]>([]);
  protected readonly guardando = signal(false);
  /** Turnos programados de todo el personal (se filtra el propio en miTurno) */
  private readonly programados = signal<TurnoProgramado[]>([]);
  /** Rotación de sábados (el sábado manda sobre el turno de lunes a viernes) */
  private readonly rotacion = signal<RotacionSabado[]>([]);

  /** Turno de hoy del auxiliar o del encargado (también rota), sábado incluido; el admin no tiene turno */
  protected readonly hoyDia = computed(() => {
    const id = this.auth.perfil()?.id;
    if (!id || !(this.auth.esAuxiliar() || this.auth.esEncargado())) return { turno: null, sabado: false };
    return turnoDelDia(this.programados(), this.rotacion(), id, fechaActual(environment.zonaHoraria));
  });
  protected readonly miTurno = computed<TurnoCodigo | null>(() => this.hoyDia().turno);
  /** El auxiliar cierra y edita desde que empieza su turno (después de la hora de fin, con retraso); admin y encargado siempre */
  protected readonly enTurno = computed(() => {
    if (!this.auth.esAuxiliar()) return true;
    const mio = this.miTurno();
    return !!mio && aMinutos(this.ahora()) >= aMinutos(this.inicioDe(mio) || '00:00');
  });
  /** Minutos que ya pasaron desde el fin del turno elegido (0 si aún no termina) */
  protected readonly retraso = computed(() => {
    const fin = this.finDe(this.turno());
    return fin ? Math.max(0, aMinutos(this.ahora()) - aMinutos(fin)) : 0;
  });
  protected readonly puedeCerrar = computed(() => this.auth.puedeOperar() && this.enTurno());

  /** Hora actual de La Paz (se actualiza cada minuto) */
  protected readonly ahora = signal(horaLaPaz());
  /** Turno que corre ahora según los horarios configurados */
  protected readonly turnoAhora = computed<TurnoCodigo>(() => turnoDeLaHora(this.op.horarios(), this.ahora()) ?? 'M');
  /** Turno del reporte: el del auxiliar (si es auxiliar) o el que corre ahora */
  protected readonly turno = signal<TurnoCodigo>('M');
  protected readonly textoRetraso = textoRetraso;
  protected readonly hhmm = hhmm;
  protected readonly filtroTurno = signal<TurnoCodigo | null>(null);
  /** Reporte que se está editando */
  protected readonly edicion = signal<EdicionReporte | null>(null);
  protected readonly reportesFiltrados = computed(() =>
    this.reportes().filter((r) => !this.filtroTurno() || r.turno === this.filtroTurno()));
  private readonly reloj = setInterval(() => this.ahora.set(horaLaPaz()), 60_000);
  protected novedades = '';
  /** PCs que el usuario dio de baja desde que empezó el turno elegido (saldrán en el cierre) */
  protected readonly misBajas = signal<PcBajaCierre[]>([]);
  /** Foto del cierre elegida y su vista previa */
  protected readonly foto = signal<File | null>(null);
  protected readonly vistaFoto = signal<string | null>(null);
  /** Enlaces temporales de las fotos vigentes (ruta -> url) */
  protected readonly urlsFotos = signal<Map<string, string>>(new Map());
  protected readonly tareas = signal<{ descripcion: string; ambiente_id: number | null }[]>([{ descripcion: '', ambiente_id: null }]);
  private readonly tareasValidas = computed(() =>
    this.tareas().map((t) => ({ ...t, descripcion: t.descripcion.trim() })).filter((t) => t.descripcion));

  ngOnInit(): void {
    void this.cargar();
    void this.op.refrescar();
  }

  ngOnDestroy(): void {
    clearInterval(this.reloj);
  }

  private async cargar(): Promise<void> {
    // Fotos vencidas (después de las 12:00): se borran; si falla, se reintenta la próxima vez
    await this.op.limpiarFotosReporte().catch((e) => console.error(e));
    try {
      const [reportes, pendientes, programados, rotacion] = await Promise.all([
        this.op.listarReportes(), this.op.tareasPendientes(), this.op.listarTurnosProgramados(), this.op.listarRotacion(),
        this.op.cargarHorarios(),
      ]);
      this.reportes.set(reportes);
      this.pendientes.set(pendientes);
      this.programados.set(programados);
      this.rotacion.set(rotacion);
      this.turno.set(this.miTurno() ?? this.turnoAhora());
      await this.cargarMisBajas();
      const ahora = Date.now();
      const vigentes = reportes.filter((r) => r.foto_path && r.foto_expira && new Date(r.foto_expira).getTime() > ahora)
        .map((r) => r.foto_path!);
      this.urlsFotos.set(await this.op.firmarFotosReporte(vigentes));
    } catch (e) {
      this.notificaciones.error(e, 'No se cargaron los reportes');
    }
  }

  /** Bajas que irán en el cierre: desde el inicio del turno elegido, hoy (La Paz) */
  protected async cargarMisBajas(): Promise<void> {
    const inicio = this.inicioDe(this.turno()) || '00:00';
    try {
      this.misBajas.set(await this.op.misBajasDesde(`${fechaActual(environment.zonaHoraria)}T${inicio}:00-04:00`));
    } catch {
      this.misBajas.set([]);
    }
  }

  protected inicioDe(turno: TurnoCodigo): string {
    return hhmm(this.op.horarios().find((h) => h.turno === turno)?.hora_inicio);
  }

  protected finDe(turno: TurnoCodigo): string {
    return hhmm(this.op.horarios().find((h) => h.turno === turno)?.hora_fin);
  }

  /** '07:00 – 12:00' */
  protected rangoDe(turno: TurnoCodigo): string {
    const inicio = this.inicioDe(turno);
    return inicio ? `${inicio} – ${this.finDe(turno)}` : '';
  }

  protected elegirFoto(evento: Event): void {
    const archivo = (evento.target as HTMLInputElement).files?.[0] ?? null;
    if (!archivo) return;
    if (!archivo.type.startsWith('image/')) {
      this.notificaciones.aviso('Elige una imagen.');
      return;
    }
    this.quitarFoto();
    this.foto.set(archivo);
    this.vistaFoto.set(URL.createObjectURL(archivo));
  }

  protected quitarFoto(): void {
    const vista = this.vistaFoto();
    if (vista) URL.revokeObjectURL(vista);
    this.foto.set(null);
    this.vistaFoto.set(null);
  }

  protected agregarTarea(): void {
    this.tareas.update((l) => [...l, { descripcion: '', ambiente_id: null }]);
  }

  protected quitarTarea(i: number): void {
    this.tareas.update((l) => (l.length > 1 ? l.filter((_, j) => j !== i) : [{ descripcion: '', ambiente_id: null }]));
  }

  protected cambiarTarea(i: number, cambio: Partial<{ descripcion: string; ambiente_id: number | null }>): void {
    this.tareas.update((l) => l.map((t, j) => (j === i ? { ...t, ...cambio } : t)));
  }

  protected async guardar(): Promise<void> {
    if (!this.puedeCerrar()) {
      const mio = this.miTurno();
      this.notificaciones.aviso(mio ? `Podrás cerrar tu turno desde las ${this.inicioDe(mio)}.` : 'No tienes turno asignado.');
      return;
    }
    const tareas = this.tareasValidas();
    if (tareas.some((t) => t.descripcion.length < 3)) {
      this.notificaciones.aviso('Cada tarea debe tener al menos 3 letras.');
      return;
    }
    if (!this.novedades.trim() && !tareas.length) {
      this.notificaciones.aviso('Escribe alguna novedad o al menos una tarea pendiente.');
      return;
    }
    this.guardando.set(true);
    try {
      await this.op.crearReporte(this.turno(), this.novedades, tareas, this.foto());
      this.novedades = '';
      this.quitarFoto();
      this.tareas.set([{ descripcion: '', ambiente_id: null }]);
      this.notificaciones.exito('Turno cerrado: reporte guardado.');
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e, 'No se guardó el reporte');
    } finally {
      this.guardando.set(false);
    }
  }

  protected async marcar(t: TareaReporte, hecha: boolean): Promise<void> {
    try {
      await this.op.marcarTarea(t.id, hecha);
      if (hecha) this.notificaciones.exito('Tarea hecha.');
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e);
    }
  }

  /** Quien gestiona auxiliares edita cualquier reporte; el auxiliar, el suyo mientras está en su turno */
  protected puedeEditar(r: ReporteTurno): boolean {
    if (!this.auth.puedeOperar()) return false;
    if (this.auth.puedeGestionarAuxiliares()) return true;
    return r.auxiliar_id === this.auth.perfil()?.id && this.puedeCerrar() && r.turno === this.miTurno()
      && r.fecha === fechaActual(environment.zonaHoraria);
  }

  /** ...y eliminarlo, solo si ninguna de sus tareas está hecha */
  protected puedeBorrar(r: ReporteTurno): boolean {
    return this.puedeEditar(r) && !this.tieneHechas(r);
  }

  protected tieneHechas(r: ReporteTurno): boolean {
    return (r.tareas ?? []).some((t) => t.hecha);
  }

  protected hechasDe(r: ReporteTurno): TareaReporte[] {
    return (r.tareas ?? []).filter((t) => t.hecha);
  }

  // ----- Edición de un reporte -----

  protected editar(r: ReporteTurno): void {
    this.edicion.set({
      id: r.id, turno: r.turno, novedades: r.novedades ?? '',
      tareas: (r.tareas ?? []).filter((t) => !t.hecha).map((t) => ({ id: t.id, descripcion: t.descripcion, ambiente_id: t.ambiente_id })),
    });
  }

  protected cambiarEdicion(cambio: Partial<EdicionReporte>): void {
    this.edicion.update((e) => (e ? { ...e, ...cambio } : e));
  }

  protected cambiarTareaEdicion(i: number, cambio: Partial<{ descripcion: string; ambiente_id: number | null }>): void {
    this.edicion.update((e) => (e ? { ...e, tareas: e.tareas.map((t, j) => (j === i ? { ...t, ...cambio } : t)) } : e));
  }

  protected agregarTareaEdicion(): void {
    this.edicion.update((e) => (e ? { ...e, tareas: [...e.tareas, { descripcion: '', ambiente_id: null }] } : e));
  }

  protected quitarTareaEdicion(i: number): void {
    this.edicion.update((e) => (e ? { ...e, tareas: e.tareas.filter((_, j) => j !== i) } : e));
  }

  protected async guardarEdicion(r: ReporteTurno): Promise<void> {
    const e = this.edicion();
    if (!e) return;
    const tareas = e.tareas.map((t) => ({ ...t, descripcion: t.descripcion.trim() })).filter((t) => t.descripcion);
    if (tareas.some((t) => t.descripcion.length < 3)) {
      this.notificaciones.aviso('Cada tarea debe tener al menos 3 letras.');
      return;
    }
    if (!e.novedades.trim() && !tareas.length && !this.tieneHechas(r)) {
      this.notificaciones.aviso('El reporte necesita alguna novedad o tarea.');
      return;
    }
    this.guardando.set(true);
    try {
      await this.op.actualizarReporte(r, e.turno, e.novedades, tareas);
      this.edicion.set(null);
      this.notificaciones.exito('Reporte actualizado.');
      await this.cargar();
    } catch (err) {
      this.notificaciones.error(err, 'No se guardó');
    } finally {
      this.guardando.set(false);
    }
  }

  protected async eliminar(r: ReporteTurno): Promise<void> {
    if (!(await this.confirmacion.pedir({ titulo: '¿Eliminar este reporte de turno?', mensaje: 'Se borra el cierre de turno.',
      consecuencias: ['También se borran sus tareas pendientes.'], aceptar: 'Sí, eliminar el reporte' }))) return;
    try {
      await this.op.eliminarReporte(r.id);
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e);
    }
  }
}
