import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconoComponent } from '../../compartido/icono.component';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { descargarCsv } from '../../core/exportar';
import { DIAS_CORTOS, fechaCorta, hhmm, hoyIso } from '../../core/fechas';
import { Asignacion, AsignacionHorario } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { PanelesService } from '../../core/paneles.service';
import { ErrorSistema, SupabaseService } from '../../core/supabase.service';

/** Horarios agrupados: mismas horas y ambiente, varios días */
export interface GrupoHorario {
  dias: number[];
  horaInicio: string;
  horaFin: string;
  ambienteId: number;
}

/** Agrupa horarios por (hora inicio, hora fin, ambiente) */
export function agruparHorarios(horarios: AsignacionHorario[]): GrupoHorario[] {
  const grupos = new Map<string, GrupoHorario>();
  for (const h of [...horarios].sort((a, b) => a.dia_semana - b.dia_semana)) {
    const clave = `${h.hora_inicio}|${h.hora_fin}|${h.ambiente_id}`;
    const grupo = grupos.get(clave) ?? { dias: [], horaInicio: h.hora_inicio, horaFin: h.hora_fin, ambienteId: h.ambiente_id };
    grupo.dias.push(h.dia_semana);
    grupos.set(clave, grupo);
  }
  return [...grupos.values()];
}

/** Criterios de orden de la lista de asignaciones */
type OrdenAsignaciones = 'inicio_asc' | 'inicio_desc' | 'recientes' | 'materia' | 'docente' | 'grupo';

/**
 * Lista de asignaciones con filtros por sistema, vigencia, carrera, ambiente
 * y grupo, y varios órdenes (fecha, materia, docente…).
 */
@Component({
  selector: 'app-asignaciones-lista',
  imports: [FormsModule, IconoComponent],
  template: `
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <!-- Sistema -->
      <div class="flex rounded-lg border border-slate-300 bg-superficie p-0.5 text-sm">
        <button class="rounded-md px-3 py-1.5" [class]="sistemaId() === 0 ? 'bg-marca-600 text-white' : 'text-slate-600'" (click)="sistemaId.set(0)">Todos</button>
        @for (s of catalogos.sistemas(); track s.id) {
          <button class="rounded-md px-3 py-1.5" [class]="sistemaId() === s.id ? 'text-white' : 'text-slate-600'"
                  [style.background]="sistemaId() === s.id ? s.color : null" (click)="sistemaId.set(s.id)">{{ s.nombre }}</button>
        }
      </div>
      <select class="campo !w-auto" [ngModel]="soloVigentes()" (ngModelChange)="soloVigentes.set($event); cargar()">
        <option [ngValue]="true">Vigentes</option>
        <option [ngValue]="false">Todas (incluye pasadas)</option>
      </select>
      <select class="campo !w-auto" [ngModel]="carreraId()" (ngModelChange)="carreraId.set(+$event)">
        <option [ngValue]="0">Todas las carreras</option>
        @for (c of catalogos.carreras(); track c.id) { <option [ngValue]="c.id">{{ c.nombre }}</option> }
      </select>
      <select class="campo !w-auto" [ngModel]="ambienteId()" (ngModelChange)="ambienteId.set(+$event)">
        <option [ngValue]="0">Todos los ambientes</option>
        @for (a of catalogos.ambientesActivos(); track a.id) { <option [ngValue]="a.id">{{ a.codigo }}</option> }
      </select>
      @if (gruposDisponibles().length) {
        <select class="campo !w-auto" [ngModel]="grupo()" (ngModelChange)="grupo.set($event)" aria-label="Grupo">
          <option value="">Todos los grupos</option>
          @for (g of gruposDisponibles(); track g) { <option [value]="g">Grupo {{ g }}</option> }
        </select>
      }
      <select class="campo !w-auto" [ngModel]="orden()" (ngModelChange)="orden.set($event)" aria-label="Ordenar">
        @for (o of ordenes; track o.valor) { <option [value]="o.valor">{{ o.texto }}</option> }
      </select>
      <div class="relative min-w-52 flex-1">
        <app-icono nombre="buscar" [tamano]="16" class="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
        <input maxlength="60" class="campo !pl-9" placeholder="Materia, docente o grupo" [ngModel]="busqueda()" (ngModelChange)="busqueda.set($event)">
      </div>
      <button class="btn-secundario" (click)="exportar()" [disabled]="!filtradas().length" title="Exportar a Excel"><app-icono nombre="descargar" [tamano]="16" /> Excel</button>
      @if (auth.puedeEditar()) {
        <button class="btn-primario" (click)="paneles.abrirAsignacion()"><app-icono nombre="agregar" [tamano]="16" /> Nueva asignación</button>
      }
    </div>

    <div class="tarjeta overflow-x-auto">
      <table class="tabla">
        <thead>
          <tr><th>Materia</th><th>Docente</th><th>Facultad</th><th>Fechas</th><th>Horarios</th><th class="w-32"></th></tr>
        </thead>
        <tbody>
          @for (a of filtradas(); track a.id) {
            <tr>
              <td>
                <p class="font-medium">{{ a.materia?.nombre }}</p>
                @if (a.grupo) { <p class="text-xs text-slate-500">Grupo {{ a.grupo }}</p> }
                @if (a.observacion) { <p class="text-xs text-amber-700">{{ a.observacion }}</p> }
              </td>
              <td>{{ a.docente?.apellidos }} {{ a.docente?.nombres }}</td>
              <td><span class="color-dinamico chip" [style.background]="(a.carrera?.color ?? '#64748b') + '22'" [style.color]="a.carrera?.color">{{ a.carrera?.sigla || a.carrera?.nombre }}</span></td>
              <td class="whitespace-nowrap">
                <span class="color-dinamico chip" [style.background]="colorSistema(a) + '1a'" [style.color]="colorSistema(a)">{{ nombreSistema(a) }}</span>
                <p class="mt-0.5 text-xs text-slate-500">
                  {{ fechaCorta(a.fecha_inicio) }} – {{ fechaCorta(a.fecha_fin) }}
                  @if (a.fechas?.length) { · {{ a.fechas?.length }} días }
                </p>
              </td>
              <td>
                <div class="flex flex-wrap gap-1">
                  @for (g of grupos(a); track $index) {
                    <span class="chip bg-slate-100 text-slate-700">
                      <b>{{ textoDias(g.dias) }}</b> {{ hhmm(g.horaInicio) }}–{{ hhmm(g.horaFin) }}
                      <span class="color-dinamico rounded bg-superficie px-1 font-semibold" [style.color]="catalogos.mapaAmbientes().get(g.ambienteId)?.color">{{ catalogos.codigoAmbiente(g.ambienteId) }}</span>
                    </span>
                  }
                </div>
              </td>
              <td class="text-right whitespace-nowrap">
                @if (auth.puedeEditar()) {
                  <button class="btn-fantasma btn-sm text-purple-700" (click)="paneles.abrirCesion({ asignacionId: a.id })" title="Ceder"><app-icono nombre="ceder" [tamano]="16" /></button>
                  <button class="btn-fantasma btn-sm" (click)="paneles.abrirAsignacion(a.id)" title="Editar"><app-icono nombre="editar" [tamano]="16" /></button>
                  <button class="btn-fantasma btn-sm text-red-600" (click)="eliminar(a)" title="Eliminar"><app-icono nombre="eliminar" [tamano]="16" /></button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="py-10 text-center text-slate-500">{{ cargando() ? 'Cargando…' : 'No hay asignaciones con esos filtros.' }}</td></tr>
          }
        </tbody>
      </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">{{ filtradas().length }} asignación(es)</p>
  `,
})
export class AsignacionesListaComponent {
  protected readonly auth = inject(AuthService);
  protected readonly catalogos = inject(CatalogosService);
  protected readonly paneles = inject(PanelesService);
  private readonly supabase = inject(SupabaseService);
  private readonly notificaciones = inject(NotificacionesService);

  protected readonly hhmm = hhmm;
  protected readonly fechaCorta = fechaCorta;

  protected readonly sistemaId = signal(0);
  protected readonly soloVigentes = signal(true);
  protected readonly carreraId = signal(0);
  protected readonly ambienteId = signal(0);
  protected readonly busqueda = signal('');
  protected readonly grupo = signal('');
  protected readonly orden = signal<OrdenAsignaciones>('inicio_asc');
  protected readonly ordenes: { valor: OrdenAsignaciones; texto: string }[] = [
    { valor: 'inicio_asc', texto: 'Fecha de inicio: más próxima' },
    { valor: 'inicio_desc', texto: 'Fecha de inicio: más lejana' },
    { valor: 'recientes', texto: 'Registradas recientemente' },
    { valor: 'materia', texto: 'Materia (A-Z)' },
    { valor: 'docente', texto: 'Docente (A-Z)' },
    { valor: 'grupo', texto: 'Grupo' },
  ];
  protected readonly asignaciones = signal<Asignacion[]>([]);
  /** Grupos presentes en lo cargado, para el filtro */
  protected readonly gruposDisponibles = computed(() =>
    [...new Set(this.asignaciones().map((a) => a.grupo?.trim()).filter((g): g is string => !!g))]
      .sort((x, y) => x.localeCompare(y, 'es', { numeric: true })));
  protected readonly cargando = signal(false);

  protected readonly filtradas = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const lista = this.asignaciones().filter((a) =>
      (!this.sistemaId() || a.sistema_id === this.sistemaId()) &&
      (!this.carreraId() || a.carrera_id === this.carreraId()) &&
      (!this.ambienteId() || (a.horarios ?? []).some((h) => h.ambiente_id === this.ambienteId())) &&
      (!this.grupo() || a.grupo?.trim() === this.grupo()) &&
      (!texto || `${a.materia?.nombre} ${a.docente?.apellidos} ${a.docente?.nombres} ${a.grupo ?? ''}`.toLowerCase().includes(texto)));
    const texto2 = (x?: string | null) => x ?? '';
    const docente = (a: Asignacion) => `${texto2(a.docente?.apellidos)} ${texto2(a.docente?.nombres)}`;
    const comparar: Record<OrdenAsignaciones, (a: Asignacion, b: Asignacion) => number> = {
      inicio_asc: (a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio),
      inicio_desc: (a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio),
      recientes: (a, b) => b.id - a.id,
      materia: (a, b) => texto2(a.materia?.nombre).localeCompare(texto2(b.materia?.nombre), 'es'),
      docente: (a, b) => docente(a).localeCompare(docente(b), 'es'),
      grupo: (a, b) => texto2(a.grupo).localeCompare(texto2(b.grupo), 'es', { numeric: true }),
    };
    return [...lista].sort(comparar[this.orden()]);
  });

  constructor() {
    // Carga al iniciar y cuando se guarda algo en un panel
    effect(() => {
      this.paneles.cambios();
      untracked(() => void this.cargar());
    });
  }

  protected async cargar(): Promise<void> {
    this.cargando.set(true);
    let consulta = this.supabase.cliente.from('asignaciones')
      .select('*, docente:docentes(id,nombres,apellidos), materia:materias(id,nombre), carrera:carreras(id,nombre,sigla,color), horarios:asignacion_horarios(*), fechas:asignacion_fechas(fecha)');
    if (this.soloVigentes()) consulta = consulta.gte('fecha_fin', hoyIso());
    const { data, error } = await consulta;
    this.cargando.set(false);
    if (error) {
      this.notificaciones.error(new ErrorSistema(error));
      return;
    }
    const lista = (data ?? []) as Asignacion[];
    lista.sort((a, b) => (a.materia?.nombre ?? '').localeCompare(b.materia?.nombre ?? ''));
    this.asignaciones.set(lista);
  }

  protected grupos(a: Asignacion): GrupoHorario[] {
    return agruparHorarios(a.horarios ?? []);
  }

  protected textoDias(dias: number[]): string {
    return dias.map((d) => DIAS_CORTOS[d]).join(' ');
  }

  protected nombreSistema(a: Asignacion): string {
    return this.catalogos.mapaSistemas().get(a.sistema_id)?.nombre ?? '';
  }

  protected colorSistema(a: Asignacion): string {
    return this.catalogos.mapaSistemas().get(a.sistema_id)?.color ?? '#64748b';
  }

  protected async eliminar(a: Asignacion): Promise<void> {
    if (!confirm(`¿Eliminar la asignación "${a.materia?.nombre}" de ${a.docente?.apellidos}? También se eliminan sus cesiones y reubicaciones.`)) return;
    const { error } = await this.supabase.cliente.from('asignaciones').delete().eq('id', a.id);
    if (error) {
      this.notificaciones.error(new ErrorSistema(error));
      return;
    }
    this.notificaciones.exito('Asignación eliminada.');
    this.paneles.notificarCambio();
  }

  /** Exporta la lista filtrada a CSV (se abre en Excel) */
  protected exportar(): void {
    const filas = this.filtradas().flatMap((a) => this.grupos(a).map((g) => [
      a.materia?.nombre ?? '', a.grupo ?? '', `${a.docente?.apellidos ?? ''} ${a.docente?.nombres ?? ''}`,
      a.carrera?.nombre ?? '', this.nombreSistema(a), `${fechaCorta(a.fecha_inicio)} - ${fechaCorta(a.fecha_fin)}`,
      this.textoDias(g.dias), `${hhmm(g.horaInicio)}-${hhmm(g.horaFin)}`, this.catalogos.codigoAmbiente(g.ambienteId), a.observacion ?? '',
    ]));
    descargarCsv(`asignaciones_${hoyIso()}.csv`,
      ['Materia', 'Grupo', 'Docente', 'Facultad', 'Sistema', 'Fechas', 'Días', 'Horario', 'Ambiente', 'Observación'], filas);
  }
}
