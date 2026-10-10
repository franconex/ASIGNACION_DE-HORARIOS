import { Component, computed, effect, inject, input, OnInit, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BuscadorComponent, OpcionBuscador } from '../../compartido/buscador.component';
import { IconoComponent } from '../../compartido/icono.component';
import { SelectorFechasComponent } from '../../compartido/selector-fechas.component';
import { CatalogosService } from '../../core/catalogos.service';
import { DIAS_CORTOS, DIAS_SEMANA, diaIso, fechaCorta, hhmm, hoyIso, rangoFechas } from '../../core/fechas';
import { Asignacion, AsignacionHorario, CandidatoChoque, Cesion, Choque } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { OcupacionService } from '../../core/ocupacion.service';
import { PanelesService } from '../../core/paneles.service';
import { ErrorSistema, SupabaseService } from '../../core/supabase.service';
import { SELECT_CESION } from './cesiones-lista.component';

/** Consulta de asignaciones con lo necesario para ceder */
const SELECT_ASIGNACION =
  '*, docente:docentes(id,nombres,apellidos), materia:materias(id,nombre), horarios:asignacion_horarios(*), fechas:asignacion_fechas(fecha)';

/**
 * Cesión de laboratorio (panel lateral).
 * La asignación llega elegida desde el laboratorio; se marcan uno o varios
 * horarios (ej. jueves y viernes) y en el calendario los días a ceder
 * (únicamente días reales de clase de esos horarios), se elige quién recibe
 * y, opcionalmente, dónde pasa clase el que cede. Los horarios cedidos juntos
 * forman un lote y se editan juntos.
 */
@Component({
  selector: 'app-cesion-form',
  imports: [FormsModule, BuscadorComponent, SelectorFechasComponent, IconoComponent],
  template: `
    <div class="flex h-full flex-col">
      <header class="flex items-center justify-between border-b border-slate-200 px-6 py-4">
        <div class="flex items-center gap-3">
          <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-50 text-purple-600"><app-icono nombre="ceder" /></span>
          <h2 class="text-lg font-bold">{{ id() ? 'Editar cesión' : 'Ceder laboratorio' }}</h2>
        </div>
        <button class="btn-fantasma" (click)="paneles.cerrar()" aria-label="Cerrar"><app-icono nombre="cerrar" /></button>
      </header>

      <div class="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <!-- Clase que se cede -->
        <section>
          @if (asignacionElegida(); as a) {
            <div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <p class="text-sm text-slate-500">Cede</p>
                  <p class="font-semibold">{{ a.materia?.nombre }}{{ a.grupo ? ' · Gr. ' + a.grupo : '' }}</p>
                  <p class="text-sm text-slate-600">{{ a.docente?.apellidos }} {{ a.docente?.nombres }}</p>
                </div>
                @if (!id()) { <button class="btn-fantasma btn-sm" (click)="elegirAsignacion(null)">Cambiar</button> }
              </div>
              <p class="mt-3 mb-1.5 text-xs text-slate-500">Horarios que cede <span class="text-slate-400">(puede elegir varios)</span></p>
              <div class="flex flex-wrap gap-2">
                @for (h of horariosOrdenados(); track h.id) {
                  <button type="button" class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition"
                          [class]="horarioIds().includes(h.id) ? 'border-purple-600 bg-purple-600 text-white' : 'border-slate-300 bg-superficie hover:border-purple-400'"
                          [attr.aria-pressed]="horarioIds().includes(h.id)" (click)="alternarHorario(h.id)">
                    @if (horarioIds().includes(h.id)) { <app-icono nombre="ok" [tamano]="14" /> }
                    <b>{{ diasCortos[h.dia_semana] }}</b> {{ hhmm(h.hora_inicio) }}–{{ hhmm(h.hora_fin) }} · {{ catalogos.codigoAmbiente(h.ambiente_id) }}
                  </button>
                }
              </div>
            </div>
          } @else {
            <label class="etiqueta">¿Qué clase se cede?</label>
            <app-buscador [opciones]="opcionesAsignaciones()" [valor]="asignacionId()" (valorChange)="elegirAsignacion($event)"
                          placeholder="Buscar por materia o docente" />
          }
        </section>

        @if (horariosElegidos().length) {
          <div class="grid gap-5 lg:grid-cols-2">
            <!-- Días -->
            <section>
              <h3 class="mb-1 font-semibold">¿Qué días se va?</h3>
              <p class="mb-2 text-sm text-slate-500">Solo se pueden marcar los {{ textoDiasElegidos() }} con clase.</p>
              <app-selector-fechas [valor]="fechas()" (valorChange)="fechas.set($event); programarVerificacion()"
                                   [fechasPermitidas]="fechasDeClase()" [feriados]="catalogos.conjuntoFeriados()" />
              @if (yaCedidas().length) {
                <p class="mt-2 flex items-start gap-1.5 text-sm text-purple-800">
                  <app-icono nombre="info" [tamano]="15" />
                  <span>Ya cedidos:
                    @for (c of yaCedidas(); track c.horarioId + c.fecha; let ultimo = $last) { <b>{{ fechaCorta(c.fecha) }}</b> a {{ c.receptor }}{{ ultimo ? '.' : ', ' }} }
                  </span>
                </p>
              }
            </section>

            <section class="space-y-4">
              <!-- A qué aula se va -->
              <div>
                <label class="etiqueta" for="aula-destino">¿A qué aula se va {{ asignacionElegida()?.docente?.nombres?.split(' ')?.[0] ?? 'el docente' }}?</label>
                <input id="aula-destino" class="campo" [ngModel]="aulaDestino()" (ngModelChange)="aulaDestino.set($event)" placeholder="Ej: C-29" maxlength="30">
              </div>

              <!-- Quién viene -->
              <div>
                <label class="etiqueta">¿Qué docente viene al laboratorio? *</label>
                <app-buscador [opciones]="opcionesDocentes()" [valor]="receptorId()" (valorChange)="receptorId.set($event); programarVerificacion()"
                              placeholder="Buscar docente" [permitirCrear]="true" (crear)="crearDocente($event)" />
              </div>
              <div>
                <label class="etiqueta" for="materia-viene">¿Qué materia viene a dictar?</label>
                <input maxlength="120" id="materia-viene" class="campo" list="lista-materias" [ngModel]="materiaReceptor()" (ngModelChange)="materiaReceptor.set($event)"
                       placeholder="Escriba o elija una materia">
                <datalist id="lista-materias">
                  @for (m of catalogos.materias(); track m.id) { <option [value]="m.nombre"></option> }
                </datalist>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="etiqueta">Facultad <span class="font-normal text-slate-400">(opcional)</span></label>
                  <select class="campo" [ngModel]="carreraReceptorId()" (ngModelChange)="carreraReceptorId.set($event)">
                    <option [ngValue]="null">Sin indicar</option>
                    @for (c of catalogos.carreras(); track c.id) { <option [ngValue]="c.id">{{ c.nombre }}</option> }
                  </select>
                </div>
                <div>
                  <label class="etiqueta">Nota <span class="font-normal text-slate-400">(opcional)</span></label>
                  <input maxlength="200" class="campo" [ngModel]="motivo()" (ngModelChange)="motivo.set($event)" placeholder="Ej: práctica de Medicina">
                </div>
              </div>

              <!-- Verificación -->
              @if (verificando()) {
                <p class="text-sm text-slate-500">Verificando…</p>
              } @else if (choques().length) {
                <div class="rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  <p class="flex items-center gap-1 font-semibold"><app-icono nombre="alerta" [tamano]="14" /> {{ choques().length }} choque(s)</p>
                  <ul class="mt-1 list-disc space-y-1 pl-5 text-xs">
                    @for (c of choques().slice(0, 5); track $index) { <li>{{ c.mensaje }}</li> }
                  </ul>
                </div>
              } @else if (fechas().length && receptorId()) {
                <p class="flex items-center gap-1.5 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"><app-icono nombre="ok" [tamano]="16" /> Sin choques en {{ fechas().length }} día(s).</p>
              }
            </section>
          </div>
        }
      </div>

      <footer class="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3">
        @if (id()) {
          <button class="btn-secundario !border-red-300 !text-red-600 mr-auto" (click)="eliminar()" [disabled]="guardando()">
            <app-icono nombre="eliminar" [tamano]="16" /> Eliminar</button>
        }
        <button class="btn-secundario" (click)="paneles.cerrar()">Cancelar</button>
        <button class="btn-primario" [disabled]="!puedeGuardar() || guardando()" (click)="guardar()">
          <app-icono nombre="ceder" [tamano]="16" /> {{ guardando() ? 'Guardando…' : 'Ceder ' + fechas().length + (fechas().length === 1 ? ' día' : ' días') }}
        </button>
      </footer>
    </div>
  `,
})
export class CesionFormComponent implements OnInit {
  protected readonly catalogos = inject(CatalogosService);
  protected readonly paneles = inject(PanelesService);
  private readonly ocupacion = inject(OcupacionService);
  private readonly supabase = inject(SupabaseService);
  private readonly notificaciones = inject(NotificacionesService);

  readonly id = input<number | null | undefined>(null);
  readonly asignacionInicial = input<number | null | undefined>(null);
  readonly horarioInicial = input<number | null | undefined>(null);
  readonly fechaInicial = input<string | null | undefined>(null);

  /** Lote que se edita (cesiones guardadas juntas) */
  private readonly lote = signal<string | null>(null);
  /** Cesiones del lote que se edita (una por horario) */
  private readonly cesionesLote = signal<Cesion[]>([]);

  protected readonly diasCortos = DIAS_CORTOS;
  protected readonly diasLargos = DIAS_SEMANA;
  protected readonly hhmm = hhmm;

  protected readonly asignaciones = signal<Asignacion[]>([]);
  protected readonly asignacionId = signal<number | null>(null);
  protected readonly horarioIds = signal<number[]>([]);
  protected readonly receptorId = signal<number | null>(null);
  protected readonly carreraReceptorId = signal<number | null>(null);
  protected readonly materiaReceptor = signal('');
  protected readonly motivo = signal('');
  protected readonly fechas = signal<string[]>([]);
  /** Aula a la que se va el docente que cede (solo texto) */
  protected readonly aulaDestino = signal('');

  /** Días de los horarios elegidos ya cedidos en OTRA cesión */
  protected readonly yaCedidas = signal<{ horarioId: number; fecha: string; receptor: string }[]>([]);
  protected readonly choques = signal<Choque[]>([]);
  protected readonly verificando = signal(false);
  protected readonly guardando = signal(false);
  private temporizador?: ReturnType<typeof setTimeout>;
  private version = 0;

  protected readonly asignacionElegida = computed(() => this.asignaciones().find((a) => a.id === this.asignacionId()));
  protected readonly horariosOrdenados = computed(() =>
    [...(this.asignacionElegida()?.horarios ?? [])].sort((a, b) => a.dia_semana - b.dia_semana || a.hora_inicio.localeCompare(b.hora_inicio)));
  protected readonly horariosElegidos = computed<AsignacionHorario[]>(() =>
    this.horariosOrdenados().filter((h) => this.horarioIds().includes(h.id)));

  /** "jueves y viernes" */
  protected readonly textoDiasElegidos = computed(() => {
    const dias = [...new Set(this.horariosElegidos().map((h) => DIAS_SEMANA[h.dia_semana].toLowerCase()))];
    return dias.length > 1 ? `${dias.slice(0, -1).join(', ')} y ${dias.at(-1)}` : (dias[0] ?? '');
  });

  /** Días reales de clase de cada horario elegido (los únicos que se pueden ceder) */
  private readonly fechasPorHorario = computed(() => {
    const mapa = new Map<number, Set<string>>();
    const a = this.asignacionElegida();
    if (!a) return mapa;
    const feriados = this.catalogos.conjuntoFeriados();
    const modular = this.catalogos.mapaSistemas().get(a.sistema_id)?.modo_fechas === 'dias';
    const base = modular ? (a.fechas ?? []).map((f) => f.fecha) : rangoFechas(a.fecha_inicio, a.fecha_fin);
    for (const h of this.horariosElegidos()) {
      const cedidas = new Set(this.yaCedidas().filter((c) => c.horarioId === h.id).map((c) => c.fecha));
      mapa.set(h.id, new Set(base.filter((f) => diaIso(f) === h.dia_semana && !feriados.has(f) && !cedidas.has(f))));
    }
    return mapa;
  });

  protected readonly fechasDeClase = computed(() => new Set([...this.fechasPorHorario().values()].flatMap((f) => [...f])));

  /** Días marcados repartidos por horario (lo que se guarda) */
  private readonly fechasElegidasPorHorario = computed(() =>
    this.horariosElegidos().map((h) => ({
      horario: h,
      fechas: this.fechas().filter((f) => this.fechasPorHorario().get(h.id)?.has(f)),
    })).filter((g) => g.fechas.length));

  protected readonly opcionesAsignaciones = computed<OpcionBuscador[]>(() =>
    this.asignaciones().map((a) => ({
      id: a.id,
      texto: `${a.materia?.nombre}${a.grupo ? ' (' + a.grupo + ')' : ''} — ${a.docente?.apellidos} ${a.docente?.nombres}`,
      subtexto: (a.horarios ?? []).map((h) => `${DIAS_CORTOS[h.dia_semana]} ${hhmm(h.hora_inicio)} ${this.catalogos.codigoAmbiente(h.ambiente_id)}`).join(' · '),
    })));

  protected readonly opcionesDocentes = computed<OpcionBuscador[]>(() =>
    this.catalogos.docentesActivos()
      .filter((d) => d.id !== this.asignacionElegida()?.docente_id)
      .map((d) => ({ id: d.id, texto: `${d.apellidos} ${d.nombres}` })));

  protected readonly puedeGuardar = computed(() =>
    this.fechasElegidasPorHorario().length > 0 && !!this.receptorId() && this.fechas().length > 0 &&
    !this.choques().length && !this.verificando());

  constructor() {
    // Al elegir horarios, carga los días que ya fueron cedidos en otras cesiones
    effect(() => {
      const ids = this.horarioIds();
      const lote = this.lote();
      untracked(() => void this.cargarYaCedidas(ids, lote));
    });
  }

  private async cargarYaCedidas(horarioIds: number[], lote: string | null): Promise<void> {
    if (!horarioIds.length) {
      this.yaCedidas.set([]);
      return;
    }
    let consulta = this.supabase.cliente.from('cesiones')
      .select('id, asignacion_horario_id, receptor:docentes(nombres,apellidos), fechas:cesion_fechas(fecha)')
      .in('asignacion_horario_id', horarioIds);
    if (lote) consulta = consulta.neq('lote', lote);
    const { data } = await consulta;
    if (horarioIds !== this.horarioIds()) return;
    const filas = (data ?? []) as unknown as {
      asignacion_horario_id: number; receptor: { nombres: string; apellidos: string } | null; fechas: { fecha: string }[];
    }[];
    this.yaCedidas.set(filas.flatMap((c) => c.fechas.map((f) => ({
      horarioId: c.asignacion_horario_id, fecha: f.fecha,
      receptor: `${c.receptor?.apellidos ?? ''} ${c.receptor?.nombres ?? ''}`.trim(),
    }))).sort((x, y) => x.fecha.localeCompare(y.fecha)));
    this.depurarFechas();
  }

  /** Quita de la selección los días que ya no se pueden ceder (horario quitado o ya cedido) */
  private depurarFechas(): void {
    const permitidas = this.fechasDeClase();
    if (this.fechas().some((f) => !permitidas.has(f))) {
      this.fechas.update((f) => f.filter((x) => permitidas.has(x)));
    }
    this.programarVerificacion();
  }

  async ngOnInit(): Promise<void> {
    await this.cargarAsignaciones();
    if (this.id()) {
      await this.cargarCesion(this.id()!);
    } else if (this.asignacionInicial()) {
      this.asignacionId.set(this.asignacionInicial()!);
      const horarios = this.asignacionElegida()?.horarios ?? [];
      const inicial = this.horarioInicial() ?? (horarios.length === 1 ? horarios[0].id : null);
      this.horarioIds.set(inicial ? [inicial] : []);
      if (this.fechaInicial() && this.fechasDeClase().has(this.fechaInicial()!)) this.fechas.set([this.fechaInicial()!]);
    } else if (this.horarioInicial()) {
      const a = this.asignaciones().find((x) => x.horarios?.some((h) => h.id === this.horarioInicial()));
      if (a) {
        this.asignacionId.set(a.id);
        this.horarioIds.set([this.horarioInicial()!]);
        if (this.fechaInicial()) this.fechas.set([this.fechaInicial()!]);
      }
    }
    this.programarVerificacion();
  }

  /** Asignaciones vigentes (o la de la cesión que se edita) */
  private async cargarAsignaciones(): Promise<void> {
    let consulta = this.supabase.cliente.from('asignaciones').select(SELECT_ASIGNACION);
    if (!this.id()) consulta = consulta.gte('fecha_fin', hoyIso());
    const { data, error } = await consulta;
    if (error) {
      this.notificaciones.error(new ErrorSistema(error));
      return;
    }
    this.asignaciones.set(((data ?? []) as Asignacion[]).sort((a, b) => (a.materia?.nombre ?? '').localeCompare(b.materia?.nombre ?? '')));
  }

  /** Carga la cesión y las demás de su lote (los otros horarios cedidos junto con ella) */
  private async cargarCesion(id: number): Promise<void> {
    const { data, error } = await this.supabase.cliente.from('cesiones').select(SELECT_CESION).eq('id', id).single();
    if (error) {
      this.notificaciones.error(new ErrorSistema(error));
      return;
    }
    const c = data as unknown as Cesion;
    const { data: delLote, error: errorLote } = await this.supabase.cliente.from('cesiones').select(SELECT_CESION).eq('lote', c.lote);
    if (errorLote) {
      this.notificaciones.error(new ErrorSistema(errorLote));
      return;
    }
    const cesiones = (delLote ?? [c]) as unknown as Cesion[];
    this.cesionesLote.set(cesiones);
    this.lote.set(c.lote);
    this.asignacionId.set(c.horario?.asignacion?.id ?? null);
    this.horarioIds.set(cesiones.map((x) => x.asignacion_horario_id));
    this.receptorId.set(c.docente_receptor_id);
    this.carreraReceptorId.set(c.carrera_receptor_id);
    this.materiaReceptor.set(c.materia_receptor ?? '');
    this.motivo.set(c.motivo);
    this.fechas.set([...new Set(cesiones.flatMap((x) => (x.fechas ?? []).map((f) => f.fecha)))].sort());
    this.aulaDestino.set(c.aula_destino ?? '');
  }

  protected elegirAsignacion(id: number | null): void {
    this.asignacionId.set(id);
    const horarios = this.asignacionElegida()?.horarios ?? [];
    this.horarioIds.set(horarios.length === 1 ? [horarios[0].id] : []);
    this.fechas.set([]);
    this.programarVerificacion();
  }

  /** Marca o desmarca un horario (se pueden ceder varios a la vez) */
  protected alternarHorario(id: number): void {
    this.horarioIds.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    this.depurarFechas();
  }

  /** Crea un docente rápido (ej. "Dra. Emily") desde el buscador */
  protected async crearDocente(texto: string): Promise<void> {
    const partes = texto.split(/\s+/);
    const nombres = partes.length > 1 ? partes.slice(1).join(' ') : partes[0];
    const apellidos = partes.length > 1 ? partes[0] : '(completar)';
    try {
      const docente = await this.catalogos.guardar('docentes', { nombres, apellidos });
      this.receptorId.set((docente as unknown as { id: number }).id);
      this.notificaciones.aviso(`Docente "${texto}" creado. Complete sus datos luego en Configuración.`);
      this.programarVerificacion();
    } catch (e) {
      this.notificaciones.error(e);
    }
  }

  protected programarVerificacion(): void {
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => void this.verificar(), 350);
  }

  /** Verifica que el docente que viene no tenga otra clase a esa hora (el laboratorio queda para él) */
  private async verificar(): Promise<void> {
    const grupos = this.fechasElegidasPorHorario();
    if (!grupos.length || !this.receptorId()) {
      this.choques.set([]);
      return;
    }
    const version = ++this.version;
    this.verificando.set(true);
    try {
      // Una verificación por horario: cada uno ignora su propia cesión (al editar) y su clase
      const resultados = await Promise.all(grupos.map(({ horario: h, fechas }) => {
        const ignorar = {
          cesion_id: this.cesionesLote().find((c) => c.asignacion_horario_id === h.id)?.id ?? null,
          asignacion_horario_ids: this.horarioIds(),
        };
        const candidatos: CandidatoChoque[] = fechas.map((fecha) => ({
          fecha, hora_inicio: h.hora_inicio, hora_fin: h.hora_fin, ambiente_id: h.ambiente_id, docente_id: this.receptorId(),
        }));
        return this.ocupacion.verificarChoques(candidatos, ignorar);
      }));
      if (version !== this.version) return;
      this.choques.set(resultados.flat());
    } catch (e) {
      this.notificaciones.error(e, 'No se pudo verificar');
    } finally {
      if (version === this.version) this.verificando.set(false);
    }
  }

  protected async guardar(): Promise<void> {
    if (!this.puedeGuardar()) return;
    this.guardando.set(true);
    try {
      await this.ocupacion.guardarCesiones({
        lote: this.lote(),
        horarios: this.fechasElegidasPorHorario().map((g) => ({ asignacion_horario_id: g.horario.id, fechas: g.fechas })),
        docente_receptor_id: this.receptorId(),
        carrera_receptor_id: this.carreraReceptorId(),
        materia_receptor: this.materiaReceptor().trim(),
        motivo: this.motivo().trim(),
        aula_destino: this.aulaDestino().trim(),
      });
      this.notificaciones.exito(`Cedido: ${this.fechas().length} ${this.fechas().length === 1 ? 'día' : 'días'}.`);
      this.paneles.guardado();
    } catch (e) {
      this.notificaciones.error(e, 'No se guardó');
    } finally {
      this.guardando.set(false);
    }
  }

  protected fechaCorta = fechaCorta;

  /** Elimina por completo lo que se está editando (por si se cargó mal) */
  protected async eliminar(): Promise<void> {
    const id = this.id();
    if (!id || !confirm('¿Eliminar esta cesión con todas sus fechas?\n\nEl docente vuelve a su laboratorio esos días.')) return;
    this.guardando.set(true);
    try {
      await this.ocupacion.eliminarCesion(id);
      this.notificaciones.exito('Cesión eliminada.');
      this.paneles.guardado();
    } catch (e) {
      this.notificaciones.error(e, 'No se eliminó');
    } finally {
      this.guardando.set(false);
    }
  }
}
