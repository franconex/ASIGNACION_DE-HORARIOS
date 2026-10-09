import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BuscadorComponent, normalizar, OpcionBuscador } from '../../compartido/buscador.component';
import { IconoComponent } from '../../compartido/icono.component';
import { SelectorFechasComponent } from '../../compartido/selector-fechas.component';
import { CatalogosService } from '../../core/catalogos.service';
import {
  DIAS_CORTOS, DIAS_SEMANA, diaIso, fechaActual, fechaCorta, fechaLarga, hhmm, rangoFechas, seSolapan, sumarDias,
  sumarMeses, textoDuracion,
} from '../../core/fechas';
import { environment } from '../../../environments/environment';
import { Ambiente, Asignacion, CandidatoChoque, Choque, SistemaAcademico } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { OcupacionService } from '../../core/ocupacion.service';
import { PanelesService, PrellenadoAsignacion } from '../../core/paneles.service';
import { ErrorSistema, SupabaseService } from '../../core/supabase.service';
import { agruparHorarios } from './asignaciones-lista.component';

/** Una fila de horario: varios días de la semana con la misma hora y ambiente */
interface FilaHorario {
  clave: number;
  dias: number[];
  /** id del bloque fijo o 'otro' para horario manual */
  bloque: string;
  horaInicio: string;
  horaFin: string;
  ambienteId: number | null;
  /** id existente de asignacion_horarios por día (al editar) */
  ids: Record<number, number>;
}

let contadorFilas = 0;

/**
 * Formulario de asignación (se abre en panel lateral).
 * 1) Sistema con botones: modular -> se marcan los días en el calendario;
 *    semestral -> fecha de inicio y el fin se calcula (6 meses, máximo < 7).
 * 2) Facultad, docente, materia y grupo. En semestral (por ahora) la
 *    facultad es siempre Medicina y no se usa grupo.
 * 3) Horarios (días de la semana, bloque u hora manual, laboratorio) con
 *    verificación de choques en vivo y sugerencia de laboratorios libres.
 */
@Component({
  selector: 'app-asignacion-form',
  imports: [FormsModule, BuscadorComponent, SelectorFechasComponent, IconoComponent],
  template: `
    <div class="flex h-full flex-col">
      <!-- Encabezado -->
      <header class="flex items-center justify-between border-b border-slate-200 px-6 py-4">
        <div class="flex items-center gap-3">
          <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-marca-50 text-marca-600"><app-icono nombre="asignacion" /></span>
          <h2 class="text-lg font-bold">{{ id() ? 'Editar asignación' : 'Nueva asignación' }}</h2>
        </div>
        <button class="btn-fantasma" (click)="paneles.cerrar()" aria-label="Cerrar"><app-icono nombre="cerrar" /></button>
      </header>

      <div class="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <!-- 1. Sistema y fechas -->
        <section>
          <h3 class="mb-2 text-sm font-semibold text-slate-700">1. Sistema y días de clase</h3>
          <div class="mb-3 grid gap-2 sm:grid-cols-3">
            @for (s of catalogos.sistemas(); track s.id) {
              <button type="button" class="flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-left text-sm transition"
                      [style.border-color]="sistemaId() === s.id ? s.color : null"
                      [style.background]="sistemaId() === s.id ? s.color + '12' : null"
                      [class]="sistemaId() === s.id ? 'font-semibold' : 'border-slate-200 hover:border-slate-300'"
                      (click)="cambiarSistema(s)">
                <span class="flex h-8 w-8 items-center justify-center rounded-lg text-white" [style.background]="s.color">
                  <app-icono [nombre]="s.modo_fechas === 'rango' ? 'rango' : 'calendario'" [tamano]="16" />
                </span>
                <span>
                  <span class="block">{{ s.nombre }}</span>
                  <span class="block text-xs font-normal text-slate-500">{{ s.modo_fechas === 'rango' ? 'Inicio + ' + s.meses_duracion + ' meses' : 'Marcar días en calendario' }}</span>
                </span>
              </button>
            }
          </div>

          @if (sistema(); as s) {
            @if (s.modo_fechas === 'dias') {
              <app-selector-fechas [valor]="fechasMarcadas()" (valorChange)="cambiarFechas($event)"
                                   [diasPermitidos]="s.dias_permitidos" [feriados]="catalogos.conjuntoFeriados()">
                @if (primerDiaFuturo() && s.dias_sugeridos) {
                  <button type="button" class="ml-auto rounded-md bg-marca-50 px-2 py-0.5 font-medium text-marca-700 hover:bg-marca-100" (click)="completarDias(s)">
                    Completar {{ s.dias_sugeridos }} días desde el {{ fechaCorta(primerDiaFuturo()!) }}
                  </button>
                }
              </app-selector-fechas>
              @if (fechasMarcadas().length) {
                <p class="mt-2 text-xs text-slate-600">
                  <b>{{ fechasMarcadas().length }}</b> día(s) de clase, del <span class="capitalize">{{ fechaLarga(fechasMarcadas()[0]) }}</span>
                  al <span class="capitalize">{{ fechaLarga(fechasMarcadas()[fechasMarcadas().length - 1]) }}</span>.
                </p>
              } @else {
                <p class="mt-2 text-xs text-slate-500">Haga clic en los días que se pasará clase. Marque el primero y use «Completar» para llenar el módulo.</p>
              }
            } @else {
              <div class="grid gap-3 sm:grid-cols-3">
                <div>
                  <label class="etiqueta">Fecha de inicio</label>
                  <input type="date" class="campo" [ngModel]="fechaInicio()" (ngModelChange)="cambiarInicio($event, s)" [min]="id() ? '' : hoy">
                </div>
                <div>
                  <label class="etiqueta">Fecha de fin</label>
                  <input type="date" class="campo" [ngModel]="fechaFin()" (ngModelChange)="fechaFin.set($event); programarVerificacion()"
                         [min]="fechaInicio()" [max]="finMaximo()">
                </div>
                <div class="flex flex-col justify-end">
                  @if (fechaInicio() && fechaFin()) {
                    <p class="rounded-lg px-3 py-2 text-sm" [class]="errorRango() ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-700'">
                      <app-icono nombre="hora" [tamano]="14" /> {{ textoDuracion(fechaInicio(), fechaFin()) }}
                    </p>
                  }
                </div>
              </div>
              <p class="mt-1 text-xs" [class]="errorRango() ? 'text-red-700' : 'text-slate-500'">
                {{ errorRango() || 'Se calcula ' + s.meses_duracion + ' meses automáticamente. Puede extender unos días, sin llegar a ' + s.meses_maximo + ' meses (máximo ' + (finMaximo() ? fechaCorta(finMaximo()) : '—') + ').' }}
              </p>
            }
          }
        </section>

        <!-- 2. Docente y materia -->
        <section>
          <h3 class="mb-2 text-sm font-semibold text-slate-700">2. Docente y materia</h3>
          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <label class="etiqueta">Facultad *</label>
              <select class="campo" [ngModel]="facultadId()" (ngModelChange)="carreraId.set(+$event)" [disabled]="esSemestral()"
                      [title]="esSemestral() ? 'En semestral la facultad es Medicina' : ''">
                <option [ngValue]="0" disabled>Seleccione…</option>
                @for (c of catalogos.carreras(); track c.id) { <option [ngValue]="c.id">{{ c.nombre }}</option> }
              </select>
            </div>
            <div>
              <label class="etiqueta">Docente *</label>
              <app-buscador [opciones]="opcionesDocentes()" [valor]="docenteId()" (valorChange)="docenteId.set($event); programarVerificacion()"
                            placeholder="Buscar por apellido o nombre" />
            </div>
            <div>
              <label class="etiqueta">Materia * <span class="font-normal normal-case text-slate-400">(★ = ya la dicta)</span></label>
              <app-buscador [opciones]="opcionesMaterias()" [valor]="materiaId()" (valorChange)="materiaId.set($event)"
                            placeholder="Buscar materia" [permitirCrear]="true" (crear)="crearMateria($event)" />
            </div>
            <div class="grid grid-cols-3 gap-3">
              @if (usaGrupo()) {
                <div>
                  <label class="etiqueta">Grupo</label>
                  <input class="campo" [ngModel]="grupo()" (ngModelChange)="grupo.set($event)" placeholder="A" maxlength="10">
                </div>
              }
              <div [class]="usaGrupo() ? 'col-span-2' : 'col-span-3'">
                <label class="etiqueta">Observación</label>
                <input maxlength="300" class="campo" [ngModel]="observacion()" (ngModelChange)="observacion.set($event)" placeholder="Opcional">
              </div>
            </div>
          </div>
        </section>

        <!-- 3. Horarios -->
        <section>
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-slate-700">3. Horario y laboratorio</h3>
            @if (verificando()) {
              <span class="flex items-center gap-2 text-xs text-slate-500">
                <span class="h-3 w-3 animate-spin rounded-full border-2 border-marca-500 border-t-transparent"></span>Verificando…
              </span>
            }
          </div>

          <div class="space-y-3">
            @for (f of filas(); track f.clave; let i = $index) {
              <div class="rounded-xl border p-4" [class]="choquesDeFila(i).length || erroresInternos()[i] ? 'border-red-300 bg-red-50/40' : 'border-slate-200'">
                <div class="flex flex-wrap items-end gap-3">
                  <div>
                    <label class="etiqueta">Días</label>
                    <div class="flex gap-1">
                      @for (d of [1,2,3,4,5,6]; track d) {
                        <button type="button" class="h-9 w-9 rounded-lg border text-xs font-semibold transition disabled:opacity-25"
                                [class]="f.dias.includes(d) ? 'border-marca-600 bg-marca-600 text-white' : 'border-slate-300 bg-superficie text-slate-600 hover:border-marca-500'"
                                [disabled]="!diasDisponibles().includes(d)" [title]="diasLargos[d]" (click)="alternarDia(i, d)">{{ diasCortos[d] }}</button>
                      }
                    </div>
                  </div>
                  <div class="w-44">
                    <label class="etiqueta">Bloque</label>
                    <select class="campo" [ngModel]="f.bloque" (ngModelChange)="elegirBloque(i, $event)">
                      @for (b of catalogos.bloques(); track b.id) {
                        <option [value]="'' + b.id">{{ b.nombre }} ({{ hhmm(b.hora_inicio) }}–{{ hhmm(b.hora_fin) }})</option>
                      }
                      <option value="otro">Horario manual…</option>
                    </select>
                  </div>
                  <div class="w-28">
                    <label class="etiqueta">Inicio</label>
                    <input type="time" class="campo" [ngModel]="f.horaInicio" (ngModelChange)="cambiarHora(i, 'horaInicio', $event)">
                  </div>
                  <div class="w-28">
                    <label class="etiqueta">Fin</label>
                    <input type="time" class="campo" [ngModel]="f.horaFin" (ngModelChange)="cambiarHora(i, 'horaFin', $event)">
                  </div>
                  <div class="min-w-40 flex-1">
                    <label class="etiqueta">Laboratorio</label>
                    <select class="campo" [ngModel]="f.ambienteId" (ngModelChange)="actualizarFila(i, { ambienteId: +$event })">
                      <option [ngValue]="null" disabled>Seleccione…</option>
                      @for (a of laboratorios(); track a.id) { <option [ngValue]="a.id">{{ a.codigo }}, {{ a.capacidad }} puestos</option> }
                    </select>
                  </div>
                  @if (filas().length > 1) {
                    <button type="button" class="btn-fantasma text-red-600" (click)="quitarFila(i)" title="Quitar horario"><app-icono nombre="eliminar" [tamano]="16" /></button>
                  }
                </div>

                @if (f.dias.length) {
                  <p class="mt-2 text-xs text-slate-500">{{ fechasDeFila(f).length }} clase(s) en este horario.</p>
                }

                @if (libresDeFila(i); as libres) {
                  <div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <span class="text-slate-500">Laboratorios libres todos esos días:</span>
                    @for (a of libres; track a.id) {
                      <button type="button" class="chip cursor-pointer border"
                              [class]="f.ambienteId === a.id ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'"
                              (click)="actualizarFila(i, { ambienteId: a.id })">{{ a.codigo }}</button>
                    } @empty {
                      <span class="font-medium text-red-700">ningún laboratorio libre en ese horario.</span>
                    }
                  </div>
                }

                @if (erroresInternos()[i]) {
                  <p class="mt-2 flex items-center gap-1 text-sm text-red-700"><app-icono nombre="alerta" [tamano]="14" /> {{ erroresInternos()[i] }}</p>
                }
                @if (choquesDeFila(i).length) {
                  <div class="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">
                    <p class="flex items-center gap-1 font-semibold"><app-icono nombre="alerta" [tamano]="14" /> Choques ({{ choquesDeFila(i).length }})</p>
                    <ul class="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                      @for (c of choquesDeFila(i).slice(0, 4); track $index) { <li>{{ c.mensaje }}</li> }
                    </ul>
                    @if (choquesDeFila(i).length > 4) { <p class="mt-1 text-xs">… y {{ choquesDeFila(i).length - 4 }} más.</p> }
                    <p class="mt-1 text-xs">Elija un laboratorio libre, cambie el horario o, luego, registre una cesión.</p>
                  </div>
                }
              </div>
            }
          </div>
          <button type="button" class="btn-secundario mt-3" (click)="agregarFila()"><app-icono nombre="agregar" [tamano]="16" /> Otro horario</button>
          <p class="mt-1 text-xs text-slate-500">Use otro horario cuando un día tenga distinta hora o laboratorio (ej. lunes desde 20:15).</p>
        </section>
      </div>

      <!-- Pie -->
      <footer class="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3">
        <p class="text-xs text-slate-500">{{ motivoNoGuardar() }}</p>
        <div class="flex gap-2">
          <button class="btn-secundario" (click)="paneles.cerrar()">Cancelar</button>
          <button class="btn-primario" [disabled]="!puedeGuardar() || guardando()" (click)="guardar()">
            <app-icono nombre="check" [tamano]="16" /> {{ guardando() ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </footer>
    </div>
  `,
})
export class AsignacionFormComponent implements OnInit {
  protected readonly catalogos = inject(CatalogosService);
  protected readonly paneles = inject(PanelesService);
  private readonly ocupacion = inject(OcupacionService);
  private readonly supabase = inject(SupabaseService);
  private readonly notificaciones = inject(NotificacionesService);

  /** id a editar (null = nueva) y datos para prellenar */
  readonly id = input<number | null | undefined>(null);
  readonly prellenado = input<PrellenadoAsignacion | undefined>(undefined);

  protected readonly hhmm = hhmm;
  protected readonly fechaCorta = fechaCorta;
  protected readonly fechaLarga = fechaLarga;
  protected readonly textoDuracion = textoDuracion;
  protected readonly diasCortos = DIAS_CORTOS;
  protected readonly diasLargos = DIAS_SEMANA;
  /** Hoy en la zona horaria de la universidad (no se permiten fechas pasadas) */
  protected readonly hoy = fechaActual(environment.zonaHoraria);

  // Campos
  protected readonly sistemaId = signal(0);
  protected readonly fechasMarcadas = signal<string[]>([]);
  protected readonly fechaInicio = signal('');
  protected readonly fechaFin = signal('');
  protected readonly carreraId = signal(0);
  protected readonly docenteId = signal<number | null>(null);
  protected readonly materiaId = signal<number | null>(null);
  protected readonly grupo = signal('');
  protected readonly observacion = signal('');
  protected readonly filas = signal<FilaHorario[]>([]);

  // Verificación
  protected readonly choques = signal<Choque[]>([]);
  private mapaCandidatos: number[] = [];
  protected readonly libres = signal<Map<number, Ambiente[]>>(new Map());
  protected readonly verificando = signal(false);
  protected readonly guardando = signal(false);
  private temporizador?: ReturnType<typeof setTimeout>;
  private versionVerificacion = 0;

  protected readonly sistema = computed(() => this.catalogos.mapaSistemas().get(this.sistemaId()));
  protected readonly esSemestral = computed(() => this.sistema()?.codigo === 'SEMESTRAL');
  /** En semestral no se usa grupo */
  protected readonly usaGrupo = computed(() => !this.esSemestral());
  private readonly medicinaId = computed(() => this.catalogos.carreras().find((c) => normalizar(c.nombre) === 'medicina')?.id ?? null);
  /** Facultad que se guarda: en semestral siempre Medicina (por ahora); en modular, la elegida */
  protected readonly facultadId = computed(() => (this.esSemestral() ? this.medicinaId() ?? this.carreraId() : this.carreraId()));
  protected readonly laboratorios = computed(() => this.catalogos.ambientes().filter((a) => a.estado === 'activo' && a.tipo === 'laboratorio'));

  /** Primer día marcado que todavía no pasó (desde ahí se completa el módulo) */
  protected readonly primerDiaFuturo = computed(() => this.fechasMarcadas().find((f) => f >= this.hoy) ?? null);

  /** Último fin permitido en semestral (un día antes de cumplir meses_maximo) */
  protected readonly finMaximo = computed(() => {
    const s = this.sistema();
    return s?.meses_maximo && this.fechaInicio() ? sumarDias(sumarMeses(this.fechaInicio(), s.meses_maximo), -1) : '';
  });

  protected readonly errorRango = computed(() => {
    if (this.sistema()?.modo_fechas !== 'rango' || !this.fechaInicio() || !this.fechaFin()) return '';
    if (this.fechaFin() < this.fechaInicio()) return 'La fecha de fin debe ser posterior al inicio.';
    if (this.finMaximo() && this.fechaFin() > this.finMaximo()) return `No puede llegar a ${this.sistema()?.meses_maximo} meses: el fin máximo es ${fechaCorta(this.finMaximo())}.`;
    return '';
  });

  /** Fechas base de clase (sin filtrar por día de la semana de cada horario) */
  protected readonly fechasBase = computed(() => {
    const s = this.sistema();
    if (!s) return [];
    const feriados = this.catalogos.conjuntoFeriados();
    if (s.modo_fechas === 'dias') return this.fechasMarcadas().filter((f) => !feriados.has(f));
    if (!this.fechaInicio() || !this.fechaFin() || this.errorRango()) return [];
    return rangoFechas(this.fechaInicio(), this.fechaFin()).filter((f) => s.dias_permitidos.includes(diaIso(f)) && !feriados.has(f));
  });

  /** Días de la semana que se pueden elegir en los horarios */
  protected readonly diasDisponibles = computed(() => {
    const s = this.sistema();
    if (!s) return [];
    if (s.modo_fechas === 'dias') return [...new Set(this.fechasMarcadas().map(diaIso))].sort();
    return s.dias_permitidos;
  });

  protected readonly opcionesDocentes = computed<OpcionBuscador[]>(() =>
    this.catalogos.docentesActivos().map((d) => ({
      id: d.id,
      texto: `${d.apellidos} ${d.nombres}`,
      subtexto: (d.docente_carreras ?? []).map((c) => this.catalogos.mapaCarreras().get(c.carrera_id)?.sigla).filter(Boolean).join(', '),
      destacado: !!this.facultadId() && (d.docente_carreras ?? []).some((c) => c.carrera_id === this.facultadId()),
    })));

  protected readonly opcionesMaterias = computed<OpcionBuscador[]>(() => {
    const docente = this.docenteId() ? this.catalogos.mapaDocentes().get(this.docenteId()!) : undefined;
    const dicta = new Set((docente?.docente_materias ?? []).map((m) => m.materia_id));
    return this.catalogos.materias().filter((m) => m.activo).map((m) => ({ id: m.id, texto: m.nombre, destacado: dicta.has(m.id) }));
  });

  /** Choques internos entre horarios del mismo formulario */
  protected readonly erroresInternos = computed(() => {
    const filas = this.filas();
    const errores: Record<number, string> = {};
    filas.forEach((f, i) => {
      if (f.horaInicio && f.horaFin && f.horaFin <= f.horaInicio) errores[i] = 'La hora de fin debe ser mayor a la de inicio.';
      filas.forEach((g, j) => {
        if (j <= i) return;
        const comunes = f.dias.filter((d) => g.dias.includes(d));
        if (comunes.length && f.horaInicio && g.horaInicio && seSolapan(f.horaInicio, f.horaFin, g.horaInicio, g.horaFin)) {
          errores[j] = `Se superpone con el horario ${i + 1} el ${comunes.map((d) => DIAS_SEMANA[d].toLowerCase()).join(', ')}.`;
        }
      });
    });
    return errores;
  });

  protected readonly motivoNoGuardar = computed(() => {
    if (!this.sistema()) return 'Elija el sistema.';
    if (this.sistema()!.modo_fechas === 'dias' && !this.fechasMarcadas().length) return 'Marque los días de clase en el calendario.';
    if (this.sistema()!.modo_fechas === 'rango' && (!this.fechaInicio() || !this.fechaFin() || this.errorRango())) return 'Revise las fechas de inicio y fin.';
    if (!this.facultadId() || !this.docenteId() || !this.materiaId()) return 'Complete facultad, docente y materia.';
    if (this.filas().some((f) => !f.dias.length || !f.ambienteId || !f.horaInicio || !f.horaFin)) return 'Cada horario necesita días, horas y laboratorio.';
    if (this.filas().some((f) => !this.fechasDeFila(f).length)) return 'Un horario no tiene ninguna clase en las fechas elegidas.';
    if (Object.keys(this.erroresInternos()).length) return 'Corrija los horarios superpuestos.';
    if (this.choques().length) return 'Hay choques: elija otro laboratorio u horario.';
    return '';
  });
  protected readonly puedeGuardar = computed(() => !this.motivoNoGuardar() && !this.verificando());

  async ngOnInit(): Promise<void> {
    if (this.id()) {
      await this.cargarAsignacion(this.id()!);
      return;
    }
    // Nueva: modular presencial por defecto y prellenado desde panel/calendario
    const p = this.prellenado() ?? {};
    const porDefecto = this.catalogos.sistemas().find((s) => s.codigo === 'MOD_PRES') ?? this.catalogos.sistemas()[0];
    const fila = this.nuevaFila();
    if (p.horaInicio && p.horaFin) {
      fila.horaInicio = p.horaInicio;
      fila.horaFin = p.horaFin;
      fila.bloque = this.bloqueDe(p.horaInicio, p.horaFin);
    }
    if (p.ambienteId) fila.ambienteId = p.ambienteId;
    this.filas.set([fila]);
    // Por ahora todas las clases son de Medicina: se elige sola (se puede cambiar)
    if (this.medicinaId()) this.carreraId.set(this.medicinaId()!);
    if (porDefecto) this.cambiarSistema(porDefecto);
    if (p.fecha && p.fecha >= this.hoy && porDefecto?.dias_permitidos.includes(diaIso(p.fecha))) this.cambiarFechas([p.fecha]);
    else if (p.dia) this.actualizarFila(0, { dias: [p.dia] });
  }

  /** Carga una asignación existente */
  private async cargarAsignacion(id: number): Promise<void> {
    const { data, error } = await this.supabase.cliente.from('asignaciones')
      .select('*, horarios:asignacion_horarios(*), fechas:asignacion_fechas(fecha)').eq('id', id).single();
    if (error) {
      this.notificaciones.error(new ErrorSistema(error));
      return;
    }
    const a = data as Asignacion;
    this.sistemaId.set(a.sistema_id);
    this.fechasMarcadas.set((a.fechas ?? []).map((f) => f.fecha).sort());
    this.fechaInicio.set(a.fecha_inicio);
    this.fechaFin.set(a.fecha_fin);
    this.carreraId.set(a.carrera_id);
    this.docenteId.set(a.docente_id);
    this.materiaId.set(a.materia_id);
    this.grupo.set(a.grupo ?? '');
    this.observacion.set(a.observacion ?? '');
    const horarios = a.horarios ?? [];
    this.filas.set(agruparHorarios(horarios).map((g) => {
      const ids: Record<number, number> = {};
      horarios.filter((h) => h.hora_inicio === g.horaInicio && h.hora_fin === g.horaFin && h.ambiente_id === g.ambienteId)
        .forEach((h) => (ids[h.dia_semana] = h.id));
      return {
        clave: ++contadorFilas, dias: g.dias, horaInicio: hhmm(g.horaInicio), horaFin: hhmm(g.horaFin),
        bloque: this.bloqueDe(hhmm(g.horaInicio), hhmm(g.horaFin)), ambienteId: g.ambienteId, ids,
      };
    }));
    this.programarVerificacion();
  }

  // ------------------------------------------------------------------
  // Sistema y fechas
  // ------------------------------------------------------------------

  protected cambiarSistema(s: SistemaAcademico): void {
    this.sistemaId.set(s.id);
    if (s.modo_fechas === 'dias') {
      // Conserva solo los días que el nuevo sistema permite
      this.fechasMarcadas.update((f) => f.filter((x) => s.dias_permitidos.includes(diaIso(x))));
    } else if (!this.fechaInicio()) {
      this.cambiarInicio(this.hoy, s);
    }
    this.ajustarDiasDeFilas();
    this.programarVerificacion();
  }

  /** Al marcar días: los horarios toman los días de la semana presentes */
  protected cambiarFechas(fechas: string[]): void {
    this.fechasMarcadas.set(fechas);
    this.ajustarDiasDeFilas();
    this.programarVerificacion();
  }

  /** Semestral: al elegir inicio, el fin se calcula con la duración del sistema */
  protected cambiarInicio(inicio: string, s: SistemaAcademico): void {
    this.fechaInicio.set(inicio);
    if (inicio && s.meses_duracion) this.fechaFin.set(sumarDias(sumarMeses(inicio, s.meses_duracion), -1));
    this.programarVerificacion();
  }

  /** Marca N días permitidos a partir del primer día marcado que no pasó (los pasados se conservan) */
  protected completarDias(s: SistemaAcademico): void {
    const feriados = this.catalogos.conjuntoFeriados();
    const pasados = this.fechasMarcadas().filter((f) => f < this.hoy);
    const resultado: string[] = [...pasados];
    let fecha = this.primerDiaFuturo()!;
    for (let i = 0; i < 400 && resultado.length < (s.dias_sugeridos ?? 20); i++) {
      if (s.dias_permitidos.includes(diaIso(fecha)) && !feriados.has(fecha)) resultado.push(fecha);
      fecha = sumarDias(fecha, 1);
    }
    this.cambiarFechas(resultado.sort());
  }

  /** Quita días no disponibles y, si un horario no tiene días, le pone todos */
  private ajustarDiasDeFilas(): void {
    const disponibles = this.diasDisponibles();
    this.filas.update((filas) => filas.map((f, i) => {
      let dias = f.dias.filter((d) => disponibles.includes(d));
      if (!dias.length && i === 0 && this.sistema()?.modo_fechas === 'dias') dias = [...disponibles];
      return { ...f, dias };
    }));
  }

  // ------------------------------------------------------------------
  // Horarios
  // ------------------------------------------------------------------

  private nuevaFila(): FilaHorario {
    const bloque = this.catalogos.bloques().find((b) => b.turno === 'N') ?? this.catalogos.bloques()[0];
    return {
      clave: ++contadorFilas, dias: [], bloque: bloque ? String(bloque.id) : 'otro',
      horaInicio: bloque ? hhmm(bloque.hora_inicio) : '19:00', horaFin: bloque ? hhmm(bloque.hora_fin) : '22:00',
      ambienteId: null, ids: {},
    };
  }

  protected agregarFila(): void {
    this.filas.update((f) => [...f, this.nuevaFila()]);
  }

  protected quitarFila(indice: number): void {
    this.filas.update((f) => f.filter((_, i) => i !== indice));
    this.programarVerificacion();
  }

  protected actualizarFila(indice: number, cambios: Partial<FilaHorario>): void {
    this.filas.update((f) => f.map((fila, i) => (i === indice ? { ...fila, ...cambios } : fila)));
    this.programarVerificacion();
  }

  protected alternarDia(indice: number, dia: number): void {
    const fila = this.filas()[indice];
    const dias = fila.dias.includes(dia) ? fila.dias.filter((d) => d !== dia) : [...fila.dias, dia].sort();
    this.actualizarFila(indice, { dias });
  }

  protected elegirBloque(indice: number, valor: string): void {
    const bloque = this.catalogos.bloques().find((b) => String(b.id) === valor);
    if (bloque) this.actualizarFila(indice, { bloque: valor, horaInicio: hhmm(bloque.hora_inicio), horaFin: hhmm(bloque.hora_fin) });
    else this.actualizarFila(indice, { bloque: 'otro' });
  }

  protected cambiarHora(indice: number, campo: 'horaInicio' | 'horaFin', valor: string): void {
    const fila = { ...this.filas()[indice], [campo]: valor };
    this.actualizarFila(indice, { [campo]: valor, bloque: this.bloqueDe(fila.horaInicio, fila.horaFin) });
  }

  private bloqueDe(inicio: string, fin: string): string {
    const bloque = this.catalogos.bloques().find((b) => hhmm(b.hora_inicio) === inicio && hhmm(b.hora_fin) === fin);
    return bloque ? String(bloque.id) : 'otro';
  }

  /** Fechas reales de clase de un horario */
  protected fechasDeFila(f: FilaHorario): string[] {
    return this.fechasBase().filter((d) => f.dias.includes(diaIso(d)));
  }

  protected choquesDeFila(indice: number): Choque[] {
    return this.choques().filter((c) => this.mapaCandidatos[c.indice] === indice);
  }

  protected libresDeFila(indice: number): Ambiente[] | null {
    return this.libres().get(this.filas()[indice]?.clave) ?? null;
  }

  // ------------------------------------------------------------------
  // Verificación en vivo
  // ------------------------------------------------------------------

  protected programarVerificacion(): void {
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => void this.verificar(), 400);
  }

  /** Consulta choques y laboratorios libres de cada horario */
  private async verificar(): Promise<void> {
    const version = ++this.versionVerificacion;
    const ignorar = { asignacion_id: this.id() ?? null };
    const candidatos: CandidatoChoque[] = [];
    this.mapaCandidatos = [];
    const validas = this.filas().map((f) => !!f.horaInicio && !!f.horaFin && f.horaFin > f.horaInicio);

    this.filas().forEach((f, i) => {
      if (!validas[i]) return;
      for (const fecha of this.fechasDeFila(f)) {
        candidatos.push({ fecha, hora_inicio: f.horaInicio, hora_fin: f.horaFin, ambiente_id: f.ambienteId, docente_id: this.docenteId() });
        this.mapaCandidatos.push(i);
      }
    });

    this.verificando.set(true);
    try {
      const libresPorFila = new Map<number, Ambiente[]>();
      const consultasLibres = this.filas().map(async (f, i) => {
        const fechas = this.fechasDeFila(f);
        if (!validas[i] || !fechas.length) return;
        libresPorFila.set(f.clave, await this.ocupacion.ambientesLibresFechas(fechas, f.horaInicio, f.horaFin, ignorar));
      });
      const [choques] = await Promise.all([this.ocupacion.verificarChoques(candidatos, ignorar), ...consultasLibres]);
      if (version !== this.versionVerificacion) return;
      this.choques.set(choques);
      this.libres.set(libresPorFila);
    } catch (e) {
      this.notificaciones.error(e, 'No se pudo verificar la disponibilidad');
    } finally {
      if (version === this.versionVerificacion) this.verificando.set(false);
    }
  }

  // ------------------------------------------------------------------
  // Guardado
  // ------------------------------------------------------------------

  protected async crearMateria(nombre: string): Promise<void> {
    try {
      const materia = await this.catalogos.guardar('materias', { nombre });
      this.materiaId.set((materia as unknown as { id: number }).id);
      this.notificaciones.exito(`Materia "${nombre}" creada.`);
    } catch (e) {
      this.notificaciones.error(e);
    }
  }

  protected async guardar(): Promise<void> {
    if (!this.puedeGuardar()) return;
    this.guardando.set(true);
    try {
      const modoDias = this.sistema()!.modo_fechas === 'dias';
      const horarios = this.filas().flatMap((f) => f.dias.map((dia) => ({
        id: f.ids[dia] ?? null, dia_semana: dia, hora_inicio: f.horaInicio, hora_fin: f.horaFin, ambiente_id: f.ambienteId,
      })));
      await this.ocupacion.guardarAsignacion({
        id: this.id() ?? null,
        sistema_id: this.sistemaId(),
        fechas: modoDias ? this.fechasMarcadas() : null,
        fecha_inicio: modoDias ? null : this.fechaInicio(),
        fecha_fin: modoDias ? null : this.fechaFin(),
        carrera_id: this.facultadId(), docente_id: this.docenteId(), materia_id: this.materiaId(),
        grupo: this.usaGrupo() ? this.grupo().trim() : '', observacion: this.observacion().trim(), horarios,
      });
      await this.vincularDocente();
      this.notificaciones.exito('Asignación guardada.');
      this.paneles.guardado();
    } catch (e) {
      this.notificaciones.error(e, 'No se guardó');
    } finally {
      this.guardando.set(false);
    }
  }

  /** Registra que el docente dicta esa materia y pertenece a esa facultad */
  private async vincularDocente(): Promise<void> {
    const docenteId = this.docenteId()!;
    const docente = this.catalogos.mapaDocentes().get(docenteId);
    const cliente = this.supabase.cliente;
    const tareas: PromiseLike<unknown>[] = [];
    if (!docente?.docente_materias?.some((m) => m.materia_id === this.materiaId())) {
      tareas.push(cliente.from('docente_materias').upsert({ docente_id: docenteId, materia_id: this.materiaId() }, { ignoreDuplicates: true }));
    }
    if (!docente?.docente_carreras?.some((c) => c.carrera_id === this.facultadId())) {
      tareas.push(cliente.from('docente_carreras').upsert({ docente_id: docenteId, carrera_id: this.facultadId() }, { ignoreDuplicates: true }));
    }
    if (tareas.length) {
      await Promise.all(tareas);
      await this.catalogos.recargar('docentes');
    }
  }
}
