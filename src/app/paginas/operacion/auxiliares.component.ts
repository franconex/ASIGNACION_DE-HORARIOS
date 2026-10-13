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
import { aMinutos, diaIso, fechaActual, fechaCorta, fechaLarga, hhmm, sumarDias } from '../../core/fechas';
import { CatalogosService } from '../../core/catalogos.service';

const NOMBRE_TURNO: Record<string, string> = { M: 'Mañana', MD: 'Mediodía', T: 'Tarde', N: 'Noche' };
/** Orden de los turnos: también es el orden de "Rotar todos" (el último vuelve al primero) */
const ORDEN_TURNOS: TurnoCodigo[] = ['M', 'MD', 'T', 'N'];

/**
 * Apartado de Auxiliares (admin y encargado): un tablero con una columna por
 * turno donde se mueve a cada persona (o se rotan todos de una vez) desde
 * una fecha; y los sábados, que se reparten solos entre quienes rotan.
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
        <p class="mt-0.5 text-sm text-slate-600">Elige desde cuándo, mueve a cada persona a su turno (o usa Rotar todos) y guarda.</p>
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

    <!-- TABLERO DE TURNOS: una columna por turno; se mueve a las personas entre columnas -->
    <section class="tarjeta mb-8 p-3">
      <div class="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <p class="etiqueta">Los turnos empiezan el</p>
          <div class="flex flex-wrap items-center gap-1.5">
            @for (a of atajosFecha(); track a.texto) {
              <button type="button" class="chip cursor-pointer py-1.5" [class]="desde() === a.fecha ? 'bg-marca-600 text-white' : 'bg-slate-200 text-slate-700'"
                      (click)="desde.set(a.fecha)">{{ a.texto }}</button>
            }
            <input type="date" class="campo !w-40 !py-1" [ngModel]="desde()" (ngModelChange)="$event && desde.set($event)" aria-label="Fecha en que empiezan los turnos">
          </div>
        </div>
        <div class="ml-auto flex flex-wrap gap-2">
          <button class="btn-secundario" (click)="rotarTodos()" title="Mañana → Mediodía → Tarde → Noche → Mañana">
            <app-icono nombre="repetir" [tamano]="16" /> Rotar todos
          </button>
          @if (cambios().length) {
            <button class="btn-fantasma" (click)="deshacer()"><app-icono nombre="restaurar" [tamano]="16" /> Deshacer</button>
          }
          <button class="btn-primario" (click)="guardarTurnos()" [disabled]="guardando() || !cambios().length">
            <app-icono nombre="check" [tamano]="16" />
            {{ guardando() ? 'Guardando…' : cambios().length ? 'Guardar ' + cambios().length + (cambios().length === 1 ? ' cambio' : ' cambios') : 'Sin cambios' }}
          </button>
        </div>
      </div>

      <p class="mb-2 text-sm" [class]="seleccionado() ? 'font-medium text-marca-700' : 'text-slate-500'">
        @if (seleccionado(); as id) { Ahora toca la columna del nuevo turno de {{ nombres().get(id) }}. }
        @else { Toca a una persona y luego la columna de su nuevo turno. En la PC también puedes arrastrarla. }
      </p>

      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        @for (c of columnas; track c.turno) {
          <div class="min-h-28 rounded-lg border-2 p-2 transition"
               [class]="seleccionado() ? 'cursor-pointer border-dashed border-marca-400 bg-marca-50/40 hover:bg-marca-50' : 'border-slate-200'"
               (click)="moverA(c.turno)" (dragover)="$event.preventDefault()" (drop)="$event.preventDefault(); moverA(c.turno)">
            <p class="mb-2 flex items-baseline justify-between gap-2">
              <span class="font-semibold">{{ c.texto }}</span>
              <span class="text-xs text-slate-500">{{ horarioDe(c.turno) }} · {{ enColumna(c.turno).length }}</span>
            </p>
            <div class="flex flex-wrap gap-1.5">
              @for (u of enColumna(c.turno); track u.id) {
                <button type="button" draggable="true" class="chip cursor-pointer py-1.5 text-sm"
                        [class]="seleccionado() === u.id ? 'bg-marca-600 text-white ring-2 ring-marca-300' : cambiado(u.id) ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'"
                        (dragstart)="seleccionado.set(u.id)" (click)="$event.stopPropagation(); elegirPersona(u.id)"
                        [attr.aria-pressed]="seleccionado() === u.id" [title]="u.nombre_completo">
                  {{ nombreCorto(u.nombre_completo) }}
                  @if (cambiado(u.id)) { <span class="text-[10px] opacity-75">antes: {{ textoTurnoBase(u.id) }}</span> }
                </button>
              } @empty {
                <p class="text-xs text-slate-400">Nadie</p>
              }
            </div>
          </div>
        }
      </div>

      @if (enColumna(null).length) {
        <div class="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 p-2">
          <span class="text-xs font-semibold text-slate-500">Sin turno:</span>
          @for (u of enColumna(null); track u.id) {
            <button type="button" draggable="true" class="chip cursor-pointer py-1.5 text-sm"
                    [class]="seleccionado() === u.id ? 'bg-marca-600 text-white ring-2 ring-marca-300' : 'bg-white text-slate-700 ring-1 ring-slate-200'"
                    (dragstart)="seleccionado.set(u.id)" (click)="elegirPersona(u.id)" [title]="u.nombre_completo">{{ nombreCorto(u.nombre_completo) }}</button>
          }
        </div>
      }
      @if (!activos().length) {
        <p class="py-6 text-center text-sm text-slate-500">No hay auxiliares activos.</p>
      }
      <p class="mt-2 text-xs text-slate-400">Los cambios (en amarillo) no se guardan hasta que tocas Guardar. Quien no cambia sigue con su turno.</p>
    </section>

    <!-- ASIGNACIONES DE TURNO GUARDADAS: para corregir o borrar una que se puso mal -->
    <section class="mb-8">
      <h2 class="mb-1 text-lg font-semibold">Asignaciones de turno</h2>
      <p class="mb-2 text-sm text-slate-600">Cada vez que guardas turnos queda una asignación con su fecha de inicio. Si te equivocaste, bórrala completa o quita solo a una persona: vuelve a valer el turno que tenía antes.</p>
      <div class="space-y-2">
        @for (g of asignaciones(); track g.desde) {
          <article class="tarjeta p-3">
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p class="font-semibold">
                <span class="capitalize">Desde el {{ fechaLarga(g.desde) }}</span>
                <span class="chip ml-1" [class]="g.estado === 'vigente' ? 'bg-emerald-100 text-emerald-700' : g.estado === 'proxima' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-600'">
                  {{ g.estado === 'vigente' ? 'Vigente' : g.estado === 'proxima' ? 'Próxima' : 'Anterior' }}
                </span>
                <span class="ml-1 text-xs font-normal text-slate-500">{{ g.turnos.length }} persona(s)</span>
              </p>
              <button class="btn-secundario btn-sm !border-red-200 !text-red-600" (click)="eliminarAsignacion(g.desde, g.turnos)" [disabled]="guardando()">
                <app-icono nombre="eliminar" [tamano]="15" /> Eliminar toda la asignación
              </button>
            </div>
            <div class="flex flex-wrap gap-1.5">
              @for (t of g.turnos; track t.id) {
                <span class="chip gap-1 bg-slate-100 py-1 text-slate-700">
                  {{ t.perfil?.nombre_completo || '¿?' }} · <b>{{ nombreTurno[t.turno] }}</b>
                  <button class="ml-0.5 rounded-full p-0.5 text-red-600 hover:bg-red-100" (click)="eliminarTurno(t)" [disabled]="guardando()"
                          [attr.aria-label]="'Quitar a ' + (t.perfil?.nombre_completo || 'esta persona') + ' de esta asignación'" title="Quitar solo a esta persona">
                    <app-icono nombre="eliminar" [tamano]="13" />
                  </button>
                </span>
              }
            </div>
          </article>
        } @empty {
          <p class="tarjeta py-6 text-center text-sm text-slate-500">Aún no hay turnos asignados.</p>
        }
      </div>
    </section>

    <!-- ROTACIÓN DE SÁBADOS: uno o varios auxiliares por sábado, cada uno con su turno -->
    <section>
      <h2 class="mb-1 text-lg font-semibold">Turnos de sábado</h2>
      <p class="mb-2 text-sm text-slate-600">Marca quiénes rotan, elige cuántos sábados y el sistema los reparte por turnos. El sábado vale este turno (no el de lunes a viernes) y solo ellos cierran turno ese día.</p>
      <div class="tarjeta mb-3 space-y-4 p-3">
        <div>
          <p class="etiqueta">Quiénes rotan los sábados <span class="font-normal text-slate-400">(toca para cambiar)</span></p>
          <div class="flex flex-wrap gap-1.5">
            @for (u of activos(); track u.id) {
              <button type="button" class="chip cursor-pointer py-1.5"
                      [class]="u.sabado_rotativo ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'"
                      (click)="alternarSabado(u)">{{ u.nombre_completo }}</button>
            }
          </div>
        </div>

        <div class="flex flex-wrap items-end gap-3">
          <div><label class="etiqueta" for="gen-desde">Desde el sábado</label>
            <input id="gen-desde" type="date" class="campo !w-44" [ngModel]="genDesde()" (ngModelChange)="genDesde.set($event)"></div>
          <div><label class="etiqueta" for="gen-cant">Cuántos sábados</label>
            <input id="gen-cant" type="number" min="1" max="12" class="campo !w-24" [ngModel]="genCantidad()" (ngModelChange)="genCantidad.set(+$event || 1)"></div>
          <div>
            <p class="etiqueta">Turnos de cada sábado</p>
            <div class="flex flex-wrap gap-1.5">
              @for (c of columnas; track c.turno) {
                <button type="button" class="chip cursor-pointer py-1.5"
                        [class]="genTurnos().includes(c.turno) ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'"
                        (click)="alternarTurnoSabado(c.turno)">{{ c.texto }}</button>
              }
            </div>
          </div>
        </div>

        @if (propuesta().length) {
          <div class="rounded-lg bg-slate-50 p-2">
            <p class="mb-1 text-xs font-semibold text-slate-500">Así quedan (se reparte por turnos, empezando por quien hace más que no trabaja un sábado):</p>
            <ul class="space-y-1 text-sm">
              @for (p of propuesta(); track p.fecha) {
                <li class="flex flex-wrap gap-x-2">
                  <span class="w-28 font-medium">{{ fechaCorta(p.fecha) }}</span>
                  @if (p.motivo) { <span class="text-slate-400">{{ p.motivo }} — se salta</span> }
                  @else {
                    @for (a of p.filas; track a.auxiliar_id) { <span>{{ nombres().get(a.auxiliar_id) }} <span class="text-slate-500">({{ nombreTurno[a.turno] }})</span></span> }
                  }
                </li>
              }
            </ul>
          </div>
        }
        <button class="btn-primario" (click)="generarSabados()" [disabled]="guardando() || !filasPropuesta().length">
          <app-icono nombre="calendario" [tamano]="16" /> Guardar {{ sabadosPropuestos() }} sábado(s)
        </button>

        <details class="border-t border-slate-100 pt-3">
          <summary class="cursor-pointer text-sm font-medium text-marca-700">Agregar un sábado a mano</summary>
          <div class="mt-3 space-y-3">
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
                @for (u of activos(); track u.id) {
                  <button type="button" class="chip cursor-pointer py-1.5"
                          [class]="nueva.auxiliares.includes(u.id) ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'"
                          (click)="alternarAuxiliarSabado(u.id)">{{ u.nombre_completo }}</button>
                }
              </div>
            </div>
            <button class="btn-secundario" (click)="agregarRotacion()" [disabled]="guardando()"><app-icono nombre="agregar" [tamano]="16" /> Agregar al sábado</button>
          </div>
        </details>
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
  private readonly confirmacion = inject(ConfirmacionService);
  private readonly catalogos = inject(CatalogosService);

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
  protected readonly columnas = ORDEN_TURNOS.map((turno) => ({ turno, texto: NOMBRE_TURNO[turno] }));

  /** Fecha en que empiezan los nuevos turnos (una sola para todos); por defecto el lunes próximo */
  protected readonly desde = signal(sumarDias(this.hoy, 8 - diaIso(this.hoy)));
  protected readonly atajosFecha = computed(() => [
    { texto: 'Hoy', fecha: this.hoy },
    { texto: 'Mañana', fecha: sumarDias(this.hoy, 1) },
    { texto: 'Lunes próximo', fecha: sumarDias(this.hoy, 8 - diaIso(this.hoy)) },
  ]);
  /** Turno movido en el tablero (solo los que se tocaron) */
  protected readonly movidos = signal<Record<string, TurnoCodigo>>({});
  /** Persona tocada que espera su columna */
  protected readonly seleccionado = signal<string | null>(null);

  protected readonly activos = computed(() => this.auxiliares().filter((u) => u.activo));
  protected readonly nombres = computed(() => new Map(this.auxiliares().map((u) => [u.id, u.nombre_completo])));
  /** Turno que cada uno tendría en la fecha elegida si no se cambia nada */
  protected readonly base = computed(() => {
    const desde = this.desde();
    return new Map(this.activos().map((u) => [u.id, turnosDeHoy(this.turnosProgramados(), u.id, desde).actual?.turno ?? null]));
  });
  /** Lo que se va a guardar: los movidos que quedan en un turno distinto al que tenían */
  protected readonly cambios = computed(() => {
    const base = this.base();
    return Object.entries(this.movidos())
      .filter(([id, turno]) => base.has(id) && base.get(id) !== turno)
      .map(([perfil_id, turno]) => ({ perfil_id, turno }));
  });

  /** Sábados: desde qué sábado, cuántos y qué turnos tiene cada uno */
  protected readonly genDesde = signal('');
  protected readonly genCantidad = signal(4);
  protected readonly genTurnos = signal<TurnoCodigo[]>(['M']);
  /** Quienes rotan, empezando por quien hace más que no trabaja un sábado */
  private readonly rotativos = computed(() => {
    const ultimo = new Map<string, string>();
    for (const r of this.rotacion()) {
      if (r.auxiliar_id && r.fecha > (ultimo.get(r.auxiliar_id) ?? '')) ultimo.set(r.auxiliar_id, r.fecha);
    }
    return this.activos().filter((u) => u.sabado_rotativo)
      .sort((a, b) => (ultimo.get(a.id) ?? '').localeCompare(ultimo.get(b.id) ?? '') || a.nombre_completo.localeCompare(b.nombre_completo, 'es'));
  });
  /** Reparto propuesto: se saltan feriados y sábados que ya tienen gente */
  protected readonly propuesta = computed(() => {
    const desde = this.genDesde();
    const gente = this.rotativos();
    const turnos = ORDEN_TURNOS.filter((t) => this.genTurnos().includes(t));
    if (!desde || diaIso(desde) !== 6 || !gente.length || !turnos.length) return [];
    const ocupados = new Set(this.rotacion().map((r) => r.fecha));
    const feriados = this.catalogos.mapaFeriados();
    const cantidad = Math.min(Math.max(this.genCantidad(), 1), 12);
    let siguiente = 0;
    return Array.from({ length: cantidad }, (_, i) => {
      const fecha = sumarDias(desde, i * 7);
      const motivo = feriados.has(fecha) ? `Feriado: ${feriados.get(fecha)}` : ocupados.has(fecha) ? 'Ya tiene auxiliares' : '';
      // Nadie repite en el mismo sábado: si hay menos personas que turnos, se llenan los primeros
      const filas = motivo ? [] : turnos.slice(0, gente.length).map((turno) => ({ fecha, turno, auxiliar_id: gente[siguiente++ % gente.length].id, nota: null }));
      return { fecha, motivo, filas };
    });
  });
  protected readonly filasPropuesta = computed(() => this.propuesta().flatMap((p) => p.filas));
  protected readonly sabadosPropuestos = computed(() => this.propuesta().filter((p) => p.filas.length).length);

  protected readonly fechaCorta = fechaCorta;
  protected readonly fechaLarga = fechaLarga;

  /** Turnos guardados agrupados por fecha de inicio (la más nueva primero) */
  protected readonly asignaciones = computed(() => {
    const hoy = fechaActual(environment.zonaHoraria);
    const mapa = new Map<string, TurnoProgramado[]>();
    for (const t of this.turnosProgramados()) mapa.set(t.desde, [...(mapa.get(t.desde) ?? []), t]);
    // Vigente = la fecha más reciente que ya empezó
    const vigente = [...mapa.keys()].filter((d) => d <= hoy).sort().at(-1);
    return [...mapa].sort(([a], [b]) => b.localeCompare(a)).map(([desde, turnos]) => ({
      desde,
      turnos: turnos.sort((x, y) => (x.perfil?.nombre_completo ?? '').localeCompare(y.perfil?.nombre_completo ?? '', 'es')),
      estado: desde > hoy ? 'proxima' : desde === vigente ? 'vigente' : 'anterior',
    }));
  });
  /** Sábado que se está cargando: uno o varios auxiliares con el mismo turno */
  protected nueva: { fecha: string; auxiliares: string[]; turno: TurnoCodigo | null; nota: string } =
    { fecha: '', auxiliares: [], turno: null, nota: '' };

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
      // Los sábados nuevos siguen después del último cargado
      const ultimo = rot.map((r) => r.fecha).filter((f) => f >= this.hoy).sort().at(-1);
      this.genDesde.set(ultimo ? sumarDias(ultimo, 7) : sumarDias(this.hoy, ((6 - diaIso(this.hoy) + 7) % 7) || 7));
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
      this.notificaciones.exito(`${u.nombre_completo} ya es auxiliar. Ponle su turno en el tablero.`);
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

  /** Turno con el que aparece en el tablero */
  private turnoEnTablero(id: string): TurnoCodigo | null {
    return this.movidos()[id] ?? this.base().get(id) ?? null;
  }

  protected enColumna(turno: TurnoCodigo | null): Perfil[] {
    return this.activos().filter((u) => this.turnoEnTablero(u.id) === turno);
  }

  protected cambiado(id: string): boolean {
    return this.cambios().some((c) => c.perfil_id === id);
  }

  protected textoTurnoBase(id: string): string {
    const t = this.base().get(id);
    return t ? NOMBRE_TURNO[t] : 'sin turno';
  }

  protected horarioDe(turno: TurnoCodigo): string {
    const h = this.op.horarios().find((x) => x.turno === turno);
    return h ? `${hhmm(h.hora_inicio)}–${hhmm(h.hora_fin)}` : '';
  }

  /** Nombre y primer apellido, para que entren más en cada columna */
  protected nombreCorto(nombre: string): string {
    return nombre.split(' ').slice(0, 2).join(' ');
  }

  protected elegirPersona(id: string): void {
    this.seleccionado.update((actual) => (actual === id ? null : id));
  }

  /** Lleva a la persona tocada (o arrastrada) a la columna */
  protected moverA(turno: TurnoCodigo): void {
    const id = this.seleccionado();
    if (!id) return;
    this.movidos.update((m) => ({ ...m, [id]: turno }));
    this.seleccionado.set(null);
  }

  /** Todos pasan al turno siguiente: Mañana → Mediodía → Tarde → Noche → Mañana */
  protected rotarTodos(): void {
    const movidos: Record<string, TurnoCodigo> = {};
    for (const u of this.activos()) {
      const actual = this.turnoEnTablero(u.id);
      if (actual) movidos[u.id] = ORDEN_TURNOS[(ORDEN_TURNOS.indexOf(actual) + 1) % ORDEN_TURNOS.length];
    }
    this.movidos.set(movidos);
    this.seleccionado.set(null);
  }

  protected deshacer(): void {
    this.movidos.set({});
    this.seleccionado.set(null);
  }

  /** Guarda de una vez los turnos cambiados, todos desde la misma fecha */
  protected async guardarTurnos(): Promise<void> {
    const filas = this.cambios();
    if (!this.desde()) return this.notificaciones.aviso('Elige la fecha en que empiezan los turnos.');
    if (!filas.length) return this.notificaciones.aviso('No moviste a nadie de turno.');
    this.guardando.set(true);
    try {
      await this.op.programarTurnos(filas, this.desde());
      this.movidos.set({});
      this.notificaciones.exito(`${filas.length === 1 ? 'Turno guardado' : `${filas.length} turnos guardados`} desde el ${fechaLarga(this.desde())}.`);
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e, 'No se programó el turno');
    } finally {
      this.guardando.set(false);
    }
  }

  /** Borra toda la asignación de una fecha (por si se guardó mal) */
  protected async eliminarAsignacion(desde: string, turnos: TurnoProgramado[]): Promise<void> {
    if (!(await this.confirmacion.pedir({ titulo: '¿Eliminar toda la asignación de turnos?', mensaje: `Se borra la asignación desde el ${fechaLarga(desde)} (${turnos.length} persona(s)).`,
      consecuencias: ['Cada uno vuelve al turno que tenía antes de esa fecha.'], aceptar: 'Sí, eliminar la asignación' }))) return;
    await this.borrarTurnos(turnos.map((t) => t.id), 'Asignación eliminada.');
  }

  /** Quita solo a una persona de una asignación */
  protected async eliminarTurno(t: TurnoProgramado): Promise<void> {
    if (!(await this.confirmacion.pedir({ titulo: '¿Quitar este turno?', mensaje: `Se quita a ${t.perfil?.nombre_completo || 'esta persona'} de la asignación del ${fechaLarga(t.desde)}.`,
      consecuencias: ['Vuelve al turno que tenía antes de esa fecha.'], aceptar: 'Sí, quitar' }))) return;
    await this.borrarTurnos([t.id], 'Turno quitado.');
  }

  private async borrarTurnos(ids: number[], mensaje: string): Promise<void> {
    this.guardando.set(true);
    try {
      await this.op.eliminarTurnosProgramados(ids);
      this.notificaciones.exito(mensaje);
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e, 'No se eliminó');
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

  protected alternarTurnoSabado(turno: TurnoCodigo): void {
    this.genTurnos.update((l) => (l.includes(turno) ? l.filter((t) => t !== turno) : [...l, turno]));
  }

  /** Guarda el reparto propuesto de los sábados */
  protected async generarSabados(): Promise<void> {
    const filas = this.filasPropuesta();
    if (!filas.length) return this.notificaciones.aviso('No hay sábados para repartir.');
    this.guardando.set(true);
    try {
      await this.op.guardarRotacion(filas);
      this.notificaciones.exito(`${this.sabadosPropuestos()} sábado(s) repartidos.`);
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e, 'No se guardaron los sábados');
    } finally {
      this.guardando.set(false);
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
    if (!(await this.confirmacion.pedir({ titulo: '¿Quitar del sábado?', mensaje: `Se quita a ${r.auxiliar?.nombre_completo || 'este auxiliar'} del sábado ${fechaCorta(r.fecha)}.`, aceptar: 'Sí, quitar' }))) return;
    try {
      await this.op.eliminarRotacion(r.id);
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e);
    }
  }
}
