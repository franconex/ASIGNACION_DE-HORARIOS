import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BuscadorComponent, OpcionBuscador } from '../../compartido/buscador.component';
import { IconoComponent } from '../../compartido/icono.component';
import { SelectorFechasComponent } from '../../compartido/selector-fechas.component';
import { CatalogosService } from '../../core/catalogos.service';
import { DIAS_CORTOS, diaIso, fechaCorta, fechaLarga, hhmm, hoyIso, rangoFechas, seSolapan } from '../../core/fechas';
import { Ambiente, Asignacion, CandidatoChoque, Choque, Reserva } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { OcupacionService } from '../../core/ocupacion.service';
import { PanelesService, PrellenadoReserva } from '../../core/paneles.service';
import { ErrorSistema, SupabaseService } from '../../core/supabase.service';

/** Clase que choca con la reserva y debe reubicarse (agrupada por horario) */
interface ClaseAfectada {
  clave: string;
  asignacionHorarioId: number;
  horaInicio: string;
  horaFin: string;
  ambienteId: number;
  titulo: string;
  detalle: string;
  /** Es una cesión: el docente que recibió el laboratorio también se mueve */
  cedida: boolean;
  /** Todas las fechas del evento donde esta clase choca */
  fechas: string[];
  /** Laboratorios libres en TODAS esas fechas */
  opciones: Ambiente[];
}

/** Categorías de evento */
export const CATEGORIAS_EVENTO = [
  { valor: 'taller', texto: 'Taller', ayuda: 'Práctica guiada: los asistentes trabajan en las PCs' },
  { valor: 'conferencia', texto: 'Conferencia', ayuda: 'Exposición o charla a un grupo' },
  { valor: 'capacitacion', texto: 'Capacitación', ayuda: 'Formación de docentes, personal o estudiantes' },
  { valor: 'otros', texto: 'Otros', ayuda: 'Cualquier otro uso: explíquelo en la descripción' },
] as const;

/** A dónde se manda al docente (igual para todos los días del evento) */
type Destino =
  | { modo: 'lab'; ambienteId: number }
  | { modo: 'aula'; aula: string }
  | { modo: 'suspender' };

/**
 * Formulario de evento / defensa (prioridad alta).
 * - Evento: categoría (taller, conferencia, capacitación, otros), nombre,
 *   responsable y descripción.
 * - Defensa: solo facultad y descripción (el nombre se arma solo).
 * Si choca con clases (o cesiones, que ocupan el lugar de la clase), OBLIGA a
 * elegir a dónde se mueve cada una (o suspenderla) antes de guardar; el
 * destino se elige una vez y vale para todos los días del evento. Choques
 * con otras reservas no se pueden forzar.
 */
@Component({
  selector: 'app-reserva-form',
  imports: [FormsModule, BuscadorComponent, SelectorFechasComponent, IconoComponent],
  template: `
    <div class="flex h-full flex-col">
      <header class="flex items-center justify-between border-b border-slate-200 px-6 py-4">
        <div class="flex items-center gap-3">
          <span class="flex h-9 w-9 items-center justify-center rounded-lg text-white" [style.background]="tipoActual()?.color ?? '#dc2626'">
            <app-icono [nombre]="iconoTipo()" />
          </span>
          <h2 class="text-lg font-bold">{{ id() ? 'Editar' : 'Nuevo' }} {{ tipoActual()?.nombre?.toLowerCase() ?? 'evento' }}</h2>
        </div>
        <button class="btn-fantasma" (click)="paneles.cerrar()" aria-label="Cerrar"><app-icono nombre="cerrar" /></button>
      </header>

      <div class="grid flex-1 gap-4 overflow-y-auto bg-slate-50 p-5 lg:grid-cols-5">
        <div class="space-y-4 lg:col-span-3">
          <!-- Datos -->
          <section class="tarjeta p-5">
            <div class="mb-4 flex flex-wrap gap-2">
              @for (t of catalogos.tiposReserva(); track t.id) {
                <button type="button" class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition"
                        [class]="tipoId() === t.id ? 'text-white' : 'bg-superficie text-slate-700 hover:bg-slate-50'"
                        [style.background]="tipoId() === t.id ? t.color : null" [style.border-color]="t.color"
                        (click)="cambiarTipo(t.id)"><app-icono [nombre]="iconoDe(t.codigo)" [tamano]="15" /> {{ t.nombre }}</button>
              }
            </div>
            @if (esEvento()) {
              <label class="etiqueta">Categoría *</label>
              <div class="mb-4 grid gap-2 sm:grid-cols-2">
                @for (c of categorias; track c.valor) {
                  <button type="button" class="rounded-lg border px-3 py-2 text-left transition"
                          [class]="categoria() === c.valor ? 'border-marca-600 bg-marca-50 ring-1 ring-marca-600' : 'border-slate-300 bg-superficie hover:border-marca-400'"
                          [attr.aria-pressed]="categoria() === c.valor" (click)="categoria.set(c.valor)">
                    <span class="block text-sm font-semibold">{{ c.texto }}</span>
                    <span class="block text-xs text-slate-500">{{ c.ayuda }}</span>
                  </button>
                }
              </div>
            }
            <div class="grid gap-3 sm:grid-cols-2">
              @if (esDefensa()) {
                <div class="sm:col-span-2">
                  <label class="etiqueta">Facultad *</label>
                  <select class="campo" [ngModel]="carreraId()" (ngModelChange)="carreraId.set($event)">
                    <option [ngValue]="null" disabled>Seleccione…</option>
                    @for (c of catalogos.carreras(); track c.id) { <option [ngValue]="c.id">{{ c.nombre }}</option> }
                  </select>
                </div>
              } @else {
                <div class="sm:col-span-2">
                  <label class="etiqueta">Nombre *</label>
                  <input maxlength="150" class="campo" [ngModel]="titulo()" (ngModelChange)="titulo.set($event)" placeholder="Ej: Capacitación Fortinet">
                </div>
                <div class="sm:col-span-2">
                  <label class="etiqueta">Responsable</label>
                  <input maxlength="120" class="campo" [ngModel]="responsable()" (ngModelChange)="responsable.set($event)" placeholder="Persona o unidad">
                </div>
              }
              <div class="sm:col-span-2">
                <label class="etiqueta">Descripción{{ categoria() === 'otros' && esEvento() ? ' *' : '' }}</label>
                <textarea maxlength="1000" class="campo" rows="2" [ngModel]="descripcion()" (ngModelChange)="descripcion.set($event)"
                          [placeholder]="esDefensa() ? 'Ej: Defensa de Juan Pérez, tribunal…' : categoria() === 'otros' ? 'Explique de qué se trata' : 'Opcional'"></textarea>
              </div>
            </div>
          </section>

          <!-- Horario y ambientes -->
          <section class="tarjeta p-5">
            <h2 class="mb-3 font-semibold">Horario y laboratorios</h2>
            <div class="mb-4">
              <label class="etiqueta">En el horario de una clase <span class="font-normal text-slate-400">(opcional: toma su laboratorio, día y hora)</span></label>
              <app-buscador [opciones]="opcionesClases()" [valor]="claseHorarioId()" (valorChange)="elegirClase($event)"
                            placeholder="Buscar por materia, docente o laboratorio" />
            </div>
            <div class="flex flex-wrap items-end gap-3">
              <div class="w-52">
                <label class="etiqueta">Bloque</label>
                <select class="campo" [ngModel]="bloque()" (ngModelChange)="elegirBloque($event)">
                  @for (b of catalogos.bloques(); track b.id) { <option [value]="'' + b.id">{{ b.nombre }} ({{ hhmm(b.hora_inicio) }}–{{ hhmm(b.hora_fin) }})</option> }
                  <option value="otro">Horario manual…</option>
                </select>
              </div>
              <div class="w-28">
                <label class="etiqueta">Inicio</label>
                <input type="time" class="campo" [ngModel]="horaInicio()" (ngModelChange)="horaInicio.set($event); bloque.set('otro'); programarVerificacion()">
              </div>
              <div class="w-28">
                <label class="etiqueta">Fin</label>
                <input type="time" class="campo" [ngModel]="horaFin()" (ngModelChange)="horaFin.set($event); bloque.set('otro'); programarVerificacion()">
              </div>
            </div>

            <div class="mt-4">
              <label class="etiqueta">Laboratorios * <span class="font-normal text-slate-400">(puede elegir varios)</span></label>
              <div class="flex flex-wrap gap-1.5">
                @for (a of ambientesVisibles(); track a.id) {
                  <button type="button" class="rounded-lg border px-3 py-1.5 text-sm font-medium transition"
                          [class]="ambientes().includes(a.id) ? 'border-marca-600 bg-marca-600 text-white' : 'border-slate-300 bg-superficie hover:border-marca-500'"
                          (click)="alternarAmbiente(a.id)">{{ a.codigo }}</button>
                }
              </div>
            </div>
          </section>

          <!-- Resultado de la verificación -->
          <section class="tarjeta p-5">
            <div class="mb-2 flex items-center justify-between">
              <h2 class="font-semibold">Disponibilidad</h2>
              @if (verificando()) { <span class="text-xs text-slate-500">Verificando…</span> }
            </div>

            @if (bloqueantes().length) {
              <div class="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                <p class="flex items-center gap-1 font-semibold"><app-icono nombre="suspender" [tamano]="15" /> No se puede reservar (cambie fecha, hora o ambiente):</p>
                <ul class="mt-1 list-disc space-y-1 pl-5 text-xs">
                  @for (c of bloqueantes(); track $index) {
                    <li>{{ c.mensaje }}</li>
                  }
                </ul>
              </div>
            }

            @if (afectadas().length) {
              <div class="rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p class="flex items-center gap-1 text-sm font-semibold text-amber-900"><app-icono nombre="alerta" [tamano]="15" /> {{ afectadas().length }} clase(s) afectada(s): el evento tiene prioridad.</p>
                <p class="mb-3 text-xs text-amber-800">Elija <b>una sola vez</b> a dónde va cada docente (un laboratorio libre o escriba el aula) y se aplica a <b>todos los días</b> del evento. Las clases <b>cedidas</b> también se mueven: va el docente que recibió el laboratorio. También puede suspender.</p>
                <div class="space-y-2">
                  @for (c of afectadas(); track c.clave) {
                    <div class="rounded-lg bg-superficie p-3 text-sm shadow-xs">
                      <div class="flex flex-wrap items-baseline justify-between gap-2">
                        <p>
                          @if (c.cedida) { <span class="chip mr-1 bg-purple-100 text-purple-800">Cedida</span> }
                          <b>{{ c.titulo }}</b> <span class="text-slate-500">· {{ c.detalle }}</span>
                        </p>
                        <p class="text-xs text-slate-600">{{ hhmm(c.horaInicio) }}–{{ hhmm(c.horaFin) }} · {{ catalogos.codigoAmbiente(c.ambienteId) }}</p>
                      </div>
                      <p class="mt-0.5 text-xs text-slate-500">{{ c.fechas.length }} día(s): {{ listaFechas(c) }}</p>
                      <div class="mt-2 flex flex-wrap items-center gap-1.5">
                        @for (a of opcionesDisponibles(c); track a.id) {
                          <button type="button" class="chip cursor-pointer border px-2.5 py-1"
                                  [class]="esLab(c, a.id) ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'"
                                  (click)="elegirLab(c, a.id)">{{ a.codigo }}</button>
                        } @empty {
                          <span class="text-xs text-slate-500">Sin laboratorios libres todos esos días.</span>
                        }
                        <span class="mx-1 text-xs text-slate-400">o</span>
                        <input maxlength="30" class="campo !w-32 !py-1 !text-xs" placeholder="Aula (ej: C-29)"
                               [class.!border-marca-600]="esAula(c)"
                               [ngModel]="aulaDe(c)" [ngModelOptions]="{ standalone: true }" (ngModelChange)="escribirAula(c, $event)">
                        <button type="button" class="chip cursor-pointer border px-2.5 py-1"
                                [class]="esSuspender(c) ? 'border-red-600 bg-red-600 text-white' : 'border-red-300 bg-superficie text-red-700'"
                                (click)="elegirSuspender(c)">Suspender</button>
                      </div>
                    </div>
                  }
                </div>
              </div>
            }

            @if (!verificando() && !bloqueantes().length && !afectadas().length) {
              @if (horarios().length) {
                <p class="flex items-center gap-1.5 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"><app-icono nombre="ok" [tamano]="16" /> Todo libre: {{ horarios().length }} reserva(s) de ambiente sin choques.</p>
              } @else {
                <p class="text-sm text-slate-500">Elija fechas, horario y ambientes.</p>
              }
            }
          </section>
        </div>

        <!-- Fechas -->
        <div class="space-y-4 lg:col-span-2">
          <section class="tarjeta p-5">
            <h2 class="mb-1 font-semibold">{{ esDefensa() ? 'Fecha' : 'Fechas' }}</h2>
            <p class="mb-3 text-xs text-slate-500">
              {{ esDefensa() ? 'Elija el día de la defensa.' : 'Clic en los días del evento (puede durar varios días). Clic en la cabecera para marcar todos los lunes, martes…' }}
            </p>
            <app-selector-fechas [valor]="fechas()" (valorChange)="fechas.set($event); programarVerificacion()"
                                 [multiple]="!esDefensa()" [feriados]="catalogos.conjuntoFeriados()" [diasPermitidos]="[1,2,3,4,5,6]" />
          </section>

          <div class="tarjeta p-4 text-sm">
            <p><b>{{ horarios().length }}</b> reserva(s) de ambiente
              @if (afectadas().length) { · <b>{{ afectadasResueltas() }}/{{ afectadas().length }}</b> clases reubicadas }
            </p>
          </div>

        </div>
      </div>

      <footer class="flex justify-end gap-2 border-t border-slate-200 bg-superficie px-6 py-3">
        <button class="btn-secundario" (click)="paneles.cerrar()">Cancelar</button>
        <button class="btn-primario" [disabled]="!puedeGuardar() || guardando()" (click)="guardar()">
          <app-icono nombre="check" [tamano]="16" /> {{ guardando() ? 'Guardando…' : 'Guardar' }}
        </button>
      </footer>
    </div>
  `,
})
export class ReservaFormComponent implements OnInit {
  protected readonly catalogos = inject(CatalogosService);
  private readonly ocupacion = inject(OcupacionService);
  private readonly supabase = inject(SupabaseService);
  private readonly notificaciones = inject(NotificacionesService);
  protected readonly paneles = inject(PanelesService);

  /** id a editar (null = nueva) y datos para prellenar */
  readonly id = input<number | null | undefined>(null);
  readonly prellenado = input<PrellenadoReserva | undefined>(undefined);

  protected readonly hhmm = hhmm;
  protected readonly fechaLarga = fechaLarga;
  protected readonly fechaCorta = fechaCorta;

  protected readonly tipoId = signal(0);
  protected readonly titulo = signal('');
  protected readonly responsable = signal('');
  protected readonly carreraId = signal<number | null>(null);
  protected readonly descripcion = signal('');
  protected readonly categoria = signal<string | null>(null);
  protected readonly categorias = CATEGORIAS_EVENTO;
  protected readonly bloque = signal('otro');
  protected readonly horaInicio = signal('08:00');
  protected readonly horaFin = signal('12:00');
  protected readonly ambientes = signal<number[]>([]);
  protected readonly fechas = signal<string[]>([]);
  /** Clases vigentes (para tomar el horario de una) */
  private readonly clases = signal<Asignacion[]>([]);
  /** Horario de clase elegido como base del evento */
  protected readonly claseHorarioId = signal<number | null>(null);

  protected readonly bloqueantes = signal<Choque[]>([]);
  protected readonly afectadas = signal<ClaseAfectada[]>([]);
  /** clave de clase afectada -> destino (lab, aula por texto o suspender) */
  protected readonly elecciones = signal<Record<string, Destino>>({});
  protected readonly verificando = signal(false);
  protected readonly guardando = signal(false);
  private temporizador?: ReturnType<typeof setTimeout>;
  private version = 0;

  protected readonly tipoActual = computed(() => this.catalogos.tiposReserva().find((t) => t.id === this.tipoId()));
  protected readonly esDefensa = computed(() => this.tipoActual()?.codigo === 'DEFENSA');
  protected readonly esEvento = computed(() => this.tipoActual()?.codigo === 'EVENTO');

  /** Datos mínimos según el tipo: evento (categoría + nombre), defensa (facultad), otros (nombre) */
  protected readonly datosCompletos = computed(() => {
    if (this.esDefensa()) return !!this.carreraId();
    if (!this.titulo().trim()) return false;
    if (this.esEvento()) return !!this.categoria() && (this.categoria() !== 'otros' || !!this.descripcion().trim());
    return true;
  });
  protected readonly iconoTipo = computed(() => this.iconoDe(this.tipoActual()?.codigo));

  /** Ícono según el tipo de reserva */
  protected iconoDe(codigo: string | undefined): string {
    return codigo === 'DEFENSA' ? 'defensa' : codigo === 'MANTENIMIENTO' ? 'mantenimiento' : 'evento';
  }

  protected readonly ambientesVisibles = computed(() => this.catalogos.laboratorios());

  /** Una opción por horario de clase: "Informática Médica II — Tinajeros" / "Jue 14:15–19:00 · LAB-06" */
  protected readonly opcionesClases = computed<OpcionBuscador[]>(() =>
    this.clases().flatMap((a) => [...(a.horarios ?? [])]
      .sort((x, y) => x.dia_semana - y.dia_semana || x.hora_inicio.localeCompare(y.hora_inicio))
      .map((h) => ({
        id: h.id,
        texto: `${a.materia?.nombre}${a.grupo ? ' (' + a.grupo + ')' : ''} — ${a.docente?.apellidos} ${a.docente?.nombres}`,
        subtexto: `${DIAS_CORTOS[h.dia_semana]} ${hhmm(h.hora_inicio)}–${hhmm(h.hora_fin)} · ${this.catalogos.codigoAmbiente(h.ambiente_id)}`,
      })))
      .sort((x, y) => x.texto.localeCompare(y.texto)));

  /** Combinación fechas × ambientes con el mismo horario */
  protected readonly horarios = computed(() => {
    if (!this.horaInicio() || !this.horaFin() || this.horaFin() <= this.horaInicio()) return [];
    return this.fechas().flatMap((fecha) => this.ambientes().map((ambiente_id) => ({
      fecha, ambiente_id, hora_inicio: this.horaInicio(), hora_fin: this.horaFin(),
    })));
  });

  protected readonly afectadasResueltas = computed(() =>
    this.afectadas().filter((c) => this.resuelta(c)).length);

  protected readonly puedeGuardar = computed(() =>
    !!this.tipoId() && this.datosCompletos() && this.horarios().length > 0 && !this.verificando() &&
    !this.bloqueantes().length && this.afectadasResueltas() === this.afectadas().length);

  async ngOnInit(): Promise<void> {
    void this.cargarClases();
    if (this.id()) {
      await this.cargarReserva(this.id()!);
    } else {
      const p = this.prellenado() ?? {};
      this.tipoId.set(p.tipoId ?? (this.catalogos.tiposReserva()[0]?.id ?? 0));
      if (p.fecha) this.fechas.set([p.fecha]);
      if (p.horaInicio && p.horaFin) {
        this.horaInicio.set(p.horaInicio);
        this.horaFin.set(p.horaFin);
      }
      this.bloque.set(this.bloqueDe(this.horaInicio(), this.horaFin()));
      if (p.ambienteId) {
        const id = p.ambienteId;
        this.ambientes.set([id]);
      }
    }
    this.programarVerificacion();
  }

  /** Carga una reserva existente */
  private async cargarReserva(id: number): Promise<void> {
    const { data, error } = await this.supabase.cliente.from('reservas')
      .select('*, horarios:reserva_horarios(*), reubicaciones(*)').eq('id', id).single();
    if (error) {
      this.notificaciones.error(new ErrorSistema(error));
      return;
    }
    const r = data as Reserva;
    this.tipoId.set(r.tipo_id);
    this.titulo.set(r.titulo);
    this.responsable.set(r.responsable ?? '');
    this.carreraId.set(r.carrera_id);
    this.descripcion.set(r.descripcion ?? '');
    this.categoria.set(r.categoria);
    const horarios = r.horarios ?? [];
    this.fechas.set([...new Set(horarios.map((h) => h.fecha))].sort());
    this.ambientes.set([...new Set(horarios.map((h) => h.ambiente_id))]);
    if (horarios[0]) {
      this.horaInicio.set(hhmm(horarios[0].hora_inicio));
      this.horaFin.set(hhmm(horarios[0].hora_fin));
    }
    this.bloque.set(this.bloqueDe(this.horaInicio(), this.horaFin()));
    // Reubicaciones ya hechas por esta reserva (un destino por clase)
    const elecciones: Record<string, Destino> = {};
    for (const re of r.reubicaciones ?? []) {
      const clave = String(re.asignacion_horario_id);
      if (elecciones[clave]) continue;
      if (re.ambiente_destino_id) elecciones[clave] = { modo: 'lab', ambienteId: re.ambiente_destino_id };
      else if (re.aula_destino) elecciones[clave] = { modo: 'aula', aula: re.aula_destino };
      else elecciones[clave] = { modo: 'suspender' };
    }
    this.elecciones.set(elecciones);
  }

  private async cargarClases(): Promise<void> {
    const { data } = await this.supabase.cliente.from('asignaciones')
      .select('id, grupo, sistema_id, fecha_inicio, fecha_fin, materia:materias(nombre), docente:docentes(nombres,apellidos), horarios:asignacion_horarios(*), fechas:asignacion_fechas(fecha)')
      .gte('fecha_fin', hoyIso());
    this.clases.set((data ?? []) as unknown as Asignacion[]);
  }

  /**
   * Toma laboratorio, horas y día de una clase. Si los días marcados no son
   * de esa clase, propone su próxima fecha de clase.
   */
  protected elegirClase(horarioId: number | null): void {
    this.claseHorarioId.set(horarioId);
    const a = this.clases().find((x) => x.horarios?.some((h) => h.id === horarioId));
    const h = a?.horarios?.find((x) => x.id === horarioId);
    if (!a || !h) return;
    this.horaInicio.set(hhmm(h.hora_inicio));
    this.horaFin.set(hhmm(h.hora_fin));
    this.bloque.set(this.bloqueDe(this.horaInicio(), this.horaFin()));
    this.ambientes.set([h.ambiente_id]);
    const feriados = this.catalogos.conjuntoFeriados();
    const modular = this.catalogos.mapaSistemas().get(a.sistema_id)?.modo_fechas === 'dias';
    const base = modular ? (a.fechas ?? []).map((f) => f.fecha).sort() : rangoFechas(a.fecha_inicio, a.fecha_fin);
    const deClase = base.filter((f) => f >= hoyIso() && diaIso(f) === h.dia_semana && !feriados.has(f));
    const validas = this.fechas().filter((f) => deClase.includes(f));
    this.fechas.set(validas.length ? validas : deClase.slice(0, 1));
    this.programarVerificacion();
  }

  protected cambiarTipo(id: number): void {
    this.tipoId.set(id);
    if (this.esDefensa() && this.fechas().length > 1) {
      this.fechas.set(this.fechas().slice(0, 1));
      this.programarVerificacion();
    }
  }

  protected elegirBloque(valor: string): void {
    this.bloque.set(valor);
    const b = this.catalogos.bloques().find((x) => String(x.id) === valor);
    if (b) {
      this.horaInicio.set(hhmm(b.hora_inicio));
      this.horaFin.set(hhmm(b.hora_fin));
      this.programarVerificacion();
    }
  }

  private bloqueDe(inicio: string, fin: string): string {
    const b = this.catalogos.bloques().find((x) => hhmm(x.hora_inicio) === inicio && hhmm(x.hora_fin) === fin);
    return b ? String(b.id) : 'otro';
  }

  protected alternarAmbiente(id: number): void {
    this.ambientes.update((lista) => (lista.includes(id) ? lista.filter((a) => a !== id) : [...lista, id]));
    this.programarVerificacion();
  }

  // ------------------------------------------------------------------
  // Verificación y reubicación obligatoria
  // ------------------------------------------------------------------

  protected programarVerificacion(): void {
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => void this.verificar(), 400);
  }

  /** Separa los choques en bloqueantes y clases afectadas, y busca opciones */
  private async verificar(): Promise<void> {
    const horarios = this.horarios();
    const version = ++this.version;
    if (!horarios.length) {
      this.bloqueantes.set([]);
      this.afectadas.set([]);
      return;
    }
    const ignorar = { reserva_id: this.id() ?? null };
    this.verificando.set(true);
    try {
      const choques = await this.ocupacion.verificarChoques(horarios as CandidatoChoque[], ignorar);
      // Clases y cesiones (ocupan el lugar de la clase) se pueden mover; lo demás bloquea
      const movible = (c: Choque) => (c.origen === 'clase' || c.origen === 'cesion') && !!c.asignacion_horario_id;
      const bloqueantes = choques.filter((c) => !movible(c));
      // Agrupa por clase (horario): una fila, con todas sus fechas afectadas
      const porHorario = new Map<number, Choque[]>();
      choques.filter(movible)
        .forEach((c) => porHorario.set(c.asignacion_horario_id!, [...(porHorario.get(c.asignacion_horario_id!) ?? []), c]));

      const afectadas = await Promise.all([...porHorario.entries()].map(async ([hid, lista]) => {
        const fechas = [...new Set(lista.map((c) => c.fecha))].sort();
        const base = lista[0];
        return {
          clave: String(hid),
          asignacionHorarioId: hid,
          horaInicio: base.ocupacion_inicio,
          horaFin: base.ocupacion_fin,
          ambienteId: base.ambiente_id,
          titulo: base.titulo,
          detalle: base.detalle,
          cedida: lista.some((c) => c.origen === 'cesion'),
          fechas,
          // Laboratorios libres en TODAS las fechas de esta clase (mismo destino siempre)
          opciones: await this.ocupacion.ambientesLibresFechas(fechas, base.ocupacion_inicio, base.ocupacion_fin,
            { ...ignorar, asignacion_horario_id: hid }),
        };
      }));
      if (version !== this.version) return;
      afectadas.sort((a, b) => (a.fechas[0] + a.horaInicio).localeCompare(b.fechas[0] + b.horaInicio));
      this.bloqueantes.set(bloqueantes);
      this.afectadas.set(afectadas);
      // Conserva solo elecciones que siguen siendo válidas
      this.elecciones.update((actual) => {
        const nuevas: Record<string, Destino> = {};
        for (const c of afectadas) {
          const e = actual[c.clave];
          if (!e) continue;
          if (e.modo === 'suspender' || e.modo === 'aula') nuevas[c.clave] = e;
          else if (e.ambienteId && c.opciones.some((a) => a.id === e.ambienteId)) nuevas[c.clave] = e;
        }
        return nuevas;
      });
    } catch (e) {
      this.notificaciones.error(e, 'No se pudo verificar');
    } finally {
      if (version === this.version) this.verificando.set(false);
    }
  }

  /**
   * Opciones reales para una clase afectada: libres, menos los ambientes que
   * ocupa esta misma reserva ese día y los ya elegidos por otras clases a la misma hora.
   */
  protected opcionesDisponibles(c: ClaseAfectada): Ambiente[] {
    const fechas = new Set(c.fechas);
    // Laboratorios que este evento ocupa en alguna de esas fechas a esa hora
    const ocupadosPorReserva = new Set(this.horarios()
      .filter((h) => fechas.has(h.fecha) && seSolapan(h.hora_inicio, h.hora_fin, c.horaInicio, c.horaFin))
      .map((h) => h.ambiente_id));
    // Laboratorios ya elegidos por otra clase afectada que comparte día y hora
    const elegidosPorOtras = new Set(this.afectadas()
      .filter((o) => o.clave !== c.clave && o.fechas.some((f) => fechas.has(f)) && seSolapan(o.horaInicio, o.horaFin, c.horaInicio, c.horaFin))
      .map((o) => { const e = this.elecciones()[o.clave]; return e?.modo === 'lab' ? e.ambienteId : 0; })
      .filter((id) => !!id));
    return c.opciones.filter((a) => !ocupadosPorReserva.has(a.id) && !elegidosPorOtras.has(a.id));
  }

  protected listaFechas(c: ClaseAfectada): string {
    return c.fechas.map((f) => fechaCorta(f)).join(', ');
  }

  /** ¿La elección de esta clase es válida? (lab, aula con texto, o suspender) */
  protected resuelta(c: ClaseAfectada): boolean {
    const e = this.elecciones()[c.clave];
    if (!e) return false;
    if (e.modo === 'lab') return !!e.ambienteId;
    if (e.modo === 'aula') return !!e.aula.trim();
    return true;
  }

  protected esLab(c: ClaseAfectada, id: number): boolean {
    const e = this.elecciones()[c.clave];
    return e?.modo === 'lab' && e.ambienteId === id;
  }

  protected esAula(c: ClaseAfectada): boolean {
    return this.elecciones()[c.clave]?.modo === 'aula';
  }

  protected esSuspender(c: ClaseAfectada): boolean {
    return this.elecciones()[c.clave]?.modo === 'suspender';
  }

  protected aulaDe(c: ClaseAfectada): string {
    const e = this.elecciones()[c.clave];
    return e?.modo === 'aula' ? e.aula : '';
  }

  protected elegirLab(c: ClaseAfectada, ambienteId: number): void {
    this.elecciones.update((e) => ({ ...e, [c.clave]: { modo: 'lab', ambienteId } }));
  }

  protected elegirSuspender(c: ClaseAfectada): void {
    this.elecciones.update((e) => ({ ...e, [c.clave]: { modo: 'suspender' } }));
  }

  protected escribirAula(c: ClaseAfectada, texto: string): void {
    this.elecciones.update((e) => {
      const nuevas = { ...e };
      if (texto && texto.trim()) nuevas[c.clave] = { modo: 'aula', aula: texto };
      else if (nuevas[c.clave]?.modo === 'aula') delete nuevas[c.clave];
      return nuevas;
    });
  }

  /** Guarda la reserva y las reubicaciones en una sola operación */
  protected async guardar(): Promise<void> {
    if (!this.puedeGuardar()) return;
    this.guardando.set(true);
    try {
      await this.ocupacion.guardarReserva({
        id: this.id() ?? null,
        tipo_id: this.tipoId(),
        // La defensa arma su nombre en el servidor ("Defensa de grado - <facultad>")
        titulo: this.esDefensa() ? '' : this.titulo().trim(),
        responsable: this.esDefensa() ? '' : this.responsable().trim(),
        carrera_id: this.esDefensa() ? this.carreraId() : null,
        categoria: this.esEvento() ? this.categoria() : null,
        descripcion: this.descripcion().trim(),
        horarios: this.horarios(),
        reubicaciones: this.afectadas().flatMap((c) => {
          const e = this.elecciones()[c.clave];
          return c.fechas.map((fecha) => ({
            asignacion_horario_id: c.asignacionHorarioId,
            fecha,
            ambiente_destino_id: e.modo === 'lab' ? e.ambienteId : null,
            aula_destino: e.modo === 'aula' ? e.aula.trim() : null,
          }));
        }),
      });
      const movidas = this.afectadas().length;
      this.notificaciones.exito(movidas ? `Guardado. ${movidas} clase(s) reubicada(s).` : 'Guardado.');
      this.paneles.guardado();
    } catch (e) {
      this.notificaciones.error(e, 'No se guardó');
    } finally {
      this.guardando.set(false);
    }
  }
}
