import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { IconoComponent } from '../../compartido/icono.component';
import { OcupacionDetalleComponent } from '../../compartido/ocupacion-detalle.component';
import { LaboratorioCroquisComponent } from './laboratorio-croquis.component';
import { LaboratorioEquiposComponent } from './laboratorio-equipos.component';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { DIAS_CORTOS, diaIso, fechaCorta, hhmm, hoyIso, rangoFechas, seSolapan, sumarDias } from '../../core/fechas';
import { Asignacion, BloqueHorario, Ocupacion } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { OcupacionService } from '../../core/ocupacion.service';
import { PanelesService, PestanaLaboratorio } from '../../core/paneles.service';
import { ErrorSistema, SupabaseService } from '../../core/supabase.service';

/**
 * Detalle de un laboratorio (panel lateral):
 * - Semana del laboratorio (días × bloques).
 * - Asignaciones que lo usan, con botones Ceder / Editar.
 * - Botones para asignar una clase o registrar un evento en este laboratorio.
 */
@Component({
  selector: 'app-laboratorio-detalle',
  imports: [IconoComponent, OcupacionDetalleComponent, LaboratorioCroquisComponent, LaboratorioEquiposComponent],
  template: `
    <div class="flex h-full flex-col">
      <!-- Encabezado -->
      <header class="border-b border-slate-200 px-6 py-4" [style.border-top]="'4px solid ' + (ambiente()?.color ?? '#2563eb')">
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-3">
            <span class="flex h-11 w-11 items-center justify-center rounded-xl text-white" [style.background]="ambiente()?.color">
              <app-icono [nombre]="ambiente()?.tipo === 'laboratorio' ? 'laboratorio' : 'aula'" [tamano]="22" />
            </span>
            <div>
              <h2 class="text-xl font-bold">{{ ambiente()?.codigo }}</h2>
              <p class="flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                <span class="inline-flex items-center gap-1"><app-icono nombre="usuarios" [tamano]="12" /> {{ ambiente()?.capacidad }} puestos</span>
                @if (totalPcs()) { <span class="inline-flex items-center gap-1"><app-icono nombre="equipo" [tamano]="12" /> {{ pcsOperativas() }}/{{ totalPcs() }} PCs operativas</span> }
                @else if (ambiente()?.tipo_equipo) { <span class="inline-flex items-center gap-1"><app-icono nombre="equipo" [tamano]="12" /> {{ ambiente()?.tipo_equipo }}</span> }
                @if (ambiente()?.ubicacion) { <span class="inline-flex items-center gap-1"><app-icono nombre="ubicacion" [tamano]="12" /> {{ ambiente()?.ubicacion }}</span> }
              </p>
            </div>
          </div>
          <button class="btn-fantasma" (click)="paneles.cerrar()" aria-label="Cerrar"><app-icono nombre="cerrar" /></button>
        </div>
        @if (auth.puedeEditar()) {
          <div class="mt-3 flex flex-wrap gap-2">
            <button class="btn-primario btn-sm" (click)="paneles.abrirAsignacion(null, { ambienteId: ambienteId() })"><app-icono nombre="nuevaClase" [tamano]="15" /> Asignar clase aquí</button>
            <button class="btn-secundario btn-sm" (click)="paneles.abrirReserva(null, { ambienteId: ambienteId(), fecha: fecha() })"><app-icono nombre="evento" [tamano]="15" /> Evento / defensa aquí</button>
          </div>
        }
        <!-- Pestañas -->
        <nav class="mt-3 -mb-4 flex gap-1">
          @for (t of pestanas; track t.valor) {
            <button class="flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition"
                    [class]="pestana() === t.valor ? 'border-marca-600 text-marca-700' : 'border-transparent text-slate-500 hover:text-slate-700'"
                    (click)="pestana.set(t.valor)">
              <app-icono [nombre]="t.icono" [tamano]="15" /> {{ t.texto }}
            </button>
          }
        </nav>
      </header>

      <div class="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        @if (pestana() === 'croquis') {
          <!-- Croquis de las PCs (plano del laboratorio) -->
          <section>
            <app-laboratorio-croquis [ambienteId]="ambienteId()" />
            @if (auth.puedeOperar()) {
              <p class="mt-2 text-xs text-slate-500">Toca una PC para cambiar su estado, o usa <b>Cambiar varias</b> para marcar muchas a la vez.</p>
            }
          </section>

          <!-- Inventario de PCs del laboratorio -->
          <app-laboratorio-equipos [ambienteId]="ambienteId()" />
        } @else {
        <!-- Semana -->
        <section>
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-slate-700">Semana del {{ fechaCorta(lunes()) }} al {{ fechaCorta(sumarDias(lunes(), 5)) }}</h3>
            <div class="flex gap-1">
              <button class="btn-fantasma btn-sm" (click)="moverSemana(-7)" aria-label="Semana anterior"><app-icono nombre="anterior" [tamano]="16" /></button>
              <button class="btn-fantasma btn-sm" (click)="moverSemana(7)" aria-label="Semana siguiente"><app-icono nombre="siguiente" [tamano]="16" /></button>
            </div>
          </div>
          <div class="overflow-x-auto rounded-xl border border-slate-200">
            <table class="w-full min-w-[640px] table-fixed text-xs">
              <thead class="bg-slate-50 text-slate-500">
                <tr>
                  <th class="w-20 px-2 py-1.5 text-left font-semibold">Bloque</th>
                  @for (d of diasSemana(); track d) {
                    <th class="px-1 py-1.5 font-semibold" [class.text-marca-600]="d === hoy">{{ diasCortos[diaIso(d)] }} {{ fechaCorta(d) }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (b of catalogos.bloques(); track b.id) {
                  <tr class="border-t border-slate-100">
                    <td class="px-2 py-1 align-top">
                      <span class="block font-semibold text-slate-700">{{ b.nombre }}</span>
                      <span class="text-[10px] text-slate-400">{{ hhmm(b.hora_inicio) }}–{{ hhmm(b.hora_fin) }}</span>
                    </td>
                    @for (d of diasSemana(); track d) {
                      <td class="p-0.5 align-top">
                        @for (o of ocupacionesEn(d, b); track o.clave) {
                          <button class="mb-0.5 block w-full rounded border-l-[3px] px-1 py-0.5 text-left leading-tight hover:brightness-95"
                                  [style.border-left-color]="o.color" [style.background]="o.color + '1f'" (click)="seleccionada.set(o)"
                                  [title]="o.titulo + ' · ' + o.detalle">
                            <span class="block truncate font-semibold">{{ o.titulo }}</span>
                            <span class="block truncate text-[10px] text-slate-500">{{ hhmm(o.hora_inicio) }}–{{ hhmm(o.hora_fin) }}</span>
                          </button>
                        } @empty {
                          @if (auth.puedeEditar()) {
                            <button class="block h-8 w-full rounded text-[10px] text-emerald-600 hover:bg-emerald-50"
                                    (click)="paneles.abrirReserva(null, { ambienteId: ambienteId(), fecha: d, horaInicio: hhmm(b.hora_inicio), horaFin: hhmm(b.hora_fin) })"
                                    title="Libre: clic para registrar un evento">Libre</button>
                          } @else {
                            <span class="block py-2 text-center text-[10px] text-emerald-600">Libre</span>
                          }
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <!-- Asignaciones del laboratorio -->
        <section>
          <h3 class="mb-2 text-sm font-semibold text-slate-700">Clases asignadas en {{ ambiente()?.codigo }} <span class="font-normal text-slate-400">({{ asignaciones().length }})</span></h3>
          <div class="space-y-2">
            @for (a of asignaciones(); track a.id) {
              <div class="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3 hover:border-slate-300">
                <span class="h-10 w-1 shrink-0 rounded-full" [style.background]="a.carrera?.color"></span>
                <div class="min-w-48 flex-1">
                  <p class="font-semibold">{{ a.materia?.nombre }}{{ a.grupo ? ' · Gr. ' + a.grupo : '' }}</p>
                  <p class="text-sm text-slate-600">{{ a.docente?.apellidos }} {{ a.docente?.nombres }}</p>
                  <p class="mt-1 flex flex-wrap gap-1">
                    <span class="chip" [style.background]="colorSistema(a) + '1a'" [style.color]="colorSistema(a)">{{ textoFechas(a) }}</span>
                    @for (h of a.horarios ?? []; track h.id) {
                      <span class="chip bg-slate-100 text-slate-700">{{ diasCortos[h.dia_semana] }} {{ hhmm(h.hora_inicio) }}–{{ hhmm(h.hora_fin) }}</span>
                    }
                  </p>
                </div>
                @if (auth.puedeEditar()) {
                  <div class="flex gap-1.5">
                    <button class="btn-secundario btn-sm !border-purple-300 !text-purple-700 hover:!bg-purple-50" (click)="ceder(a)">
                      <app-icono nombre="ceder" [tamano]="14" /> Ceder
                    </button>
                    <button class="btn-secundario btn-sm" (click)="paneles.abrirAsignacion(a.id)"><app-icono nombre="editar" [tamano]="14" /> Editar</button>
                  </div>
                }
              </div>
            } @empty {
              <p class="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{{ cargando() ? 'Cargando…' : 'Sin clases asignadas vigentes.' }}</p>
            }
          </div>
        </section>

        }
      </div>
    </div>

    <app-ocupacion-detalle [ocupacion]="seleccionada()" (cerrar)="seleccionada.set(null)" (cambio)="cargar()" />
  `,
})
export class LaboratorioDetalleComponent {
  protected readonly auth = inject(AuthService);
  protected readonly catalogos = inject(CatalogosService);
  protected readonly paneles = inject(PanelesService);
  private readonly ocupacion = inject(OcupacionService);
  private readonly supabase = inject(SupabaseService);
  private readonly notificaciones = inject(NotificacionesService);

  readonly ambienteId = input.required<number>();
  readonly fecha = input.required<string>();
  readonly pestanaInicial = input<PestanaLaboratorio>('horario');

  protected readonly pestanas: { valor: PestanaLaboratorio; texto: string; icono: string }[] = [
    { valor: 'croquis', texto: 'Croquis de PCs', icono: 'equipo' },
    { valor: 'horario', texto: 'Horario y clases', icono: 'calendario' },
  ];
  protected readonly pestana = signal<PestanaLaboratorio>('horario');

  protected readonly hhmm = hhmm;
  protected readonly fechaCorta = fechaCorta;
  protected readonly sumarDias = sumarDias;
  protected readonly diaIso = diaIso;
  protected readonly diasCortos = DIAS_CORTOS;
  protected readonly hoy = hoyIso();

  protected readonly lunes = signal(hoyIso());
  protected readonly ocupaciones = signal<Ocupacion[]>([]);
  protected readonly asignaciones = signal<Asignacion[]>([]);
  protected readonly cargando = signal(false);
  protected readonly seleccionada = signal<Ocupacion | null>(null);

  protected readonly ambiente = computed(() => this.catalogos.mapaAmbientes().get(this.ambienteId()));
  protected readonly diasSemana = computed(() => rangoFechas(this.lunes(), sumarDias(this.lunes(), 5)));

  /** PCs del laboratorio para el resumen del encabezado */
  private readonly pcs = computed(() => this.catalogos.pcsPorAmbiente().get(this.ambienteId()) ?? []);
  protected readonly totalPcs = computed(() => this.pcs().length);
  protected readonly pcsOperativas = computed(() => this.pcs().filter((pc) => pc.estado === 'operativa').length);

  constructor() {
    effect(() => {
      const inicial = this.pestanaInicial();
      untracked(() => this.pestana.set(inicial));
    });
    // Semana de la fecha recibida
    effect(() => {
      const fecha = this.fecha();
      untracked(() => this.lunes.set(sumarDias(fecha, -(diaIso(fecha) - 1))));
    });
    // Recarga al abrir y cada vez que se guarda algo en otro panel
    effect(() => {
      this.paneles.cambios();
      this.ambienteId();
      untracked(() => void this.cargar());
    });
  }

  /** Carga la semana y las asignaciones del laboratorio */
  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const [ocupaciones, respuesta] = await Promise.all([
        this.ocupacion.ocupaciones(this.lunes(), sumarDias(this.lunes(), 5)),
        this.supabase.cliente.from('asignaciones')
          .select('*, docente:docentes(id,nombres,apellidos), materia:materias(id,nombre), carrera:carreras(id,nombre,color), horarios:asignacion_horarios!inner(*)')
          .eq('horarios.ambiente_id', this.ambienteId())
          .gte('fecha_fin', hoyIso()),
      ]);
      if (respuesta.error) throw new ErrorSistema(respuesta.error);
      this.ocupaciones.set(ocupaciones.filter((o) => o.ambiente_id === this.ambienteId()));
      const lista = (respuesta.data ?? []) as Asignacion[];
      lista.forEach((a) => a.horarios?.sort((x, y) => x.dia_semana - y.dia_semana));
      lista.sort((a, b) => (a.horarios?.[0]?.hora_inicio ?? '').localeCompare(b.horarios?.[0]?.hora_inicio ?? ''));
      this.asignaciones.set(lista);
    } catch (e) {
      this.notificaciones.error(e);
    } finally {
      this.cargando.set(false);
    }
  }

  protected moverSemana(dias: number): void {
    this.lunes.set(sumarDias(this.lunes(), dias));
    void this.cargar();
  }

  protected ocupacionesEn(fecha: string, b: BloqueHorario): Ocupacion[] {
    return this.ocupaciones().filter((o) => o.fecha === fecha && seSolapan(o.hora_inicio, o.hora_fin, b.hora_inicio, b.hora_fin));
  }

  protected colorSistema(a: Asignacion): string {
    return this.catalogos.mapaSistemas().get(a.sistema_id)?.color ?? '#64748b';
  }

  /** "Modular · 05/10–30/10" o "Semestral · 03/08–12/12" */
  protected textoFechas(a: Asignacion): string {
    const s = this.catalogos.mapaSistemas().get(a.sistema_id);
    return `${s?.nombre ?? ''} · ${fechaCorta(a.fecha_inicio)}–${fechaCorta(a.fecha_fin)}`;
  }

  /** Abre la cesión con la asignación y su horario en este laboratorio */
  protected ceder(a: Asignacion): void {
    // Prefiere el horario del día que se está viendo; si no, el primero en este laboratorio
    const enEsteLab = (a.horarios ?? []).filter((h) => h.ambiente_id === this.ambienteId());
    const horario = enEsteLab.find((h) => h.dia_semana === diaIso(this.fecha())) ?? enEsteLab[0];
    this.paneles.abrirCesion({ asignacionId: a.id, horarioId: horario?.id ?? null, fecha: this.fecha() >= this.hoy ? this.fecha() : null });
  }
}
