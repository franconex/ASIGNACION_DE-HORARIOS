import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconoComponent } from '../../compartido/icono.component';
import { PanelesService } from '../../core/paneles.service';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { DIAS_SEMANA, fechaCorta, hhmm, hoyIso } from '../../core/fechas';
import { Cesion } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { ConfirmacionService } from '../../core/confirmacion.service';
import { ErrorSistema, SupabaseService } from '../../core/supabase.service';
import { CedidoPorReubicacion, OcupacionService } from '../../core/ocupacion.service';

/** Consulta con todas las relaciones necesarias para mostrar una cesión */
export const SELECT_CESION =
  '*, receptor:docentes(id,nombres,apellidos), fechas:cesion_fechas(fecha), ' +
  'horario:asignacion_horarios!cesiones_asignacion_horario_id_fkey(*, asignacion:asignaciones(id, grupo, docente_id, docente:docentes(id,nombres,apellidos), materia:materias(nombre)))';

/**
 * Fila de la lista: una cesión, o una clase reubicada porque su laboratorio
 * estaba ocupado (se muestra igual: el ambiente fue cedido).
 */
interface FilaCedido {
  clave: string;
  cesion: Cesion | null;
  /** Asignación del que se va (para editar la reubicación) */
  asignacionId: number | null;
  seVa: string;
  seVaMateria: string;
  dia: number;
  horaInicio: string;
  horaFin: string;
  ambienteId: number;
  viene: string;
  vieneMateria: string;
  motivo: string;
  fechas: string[];
  aula: string | null;
  id: number;
}

/**
 * Lista de ambientes cedidos: quién se va, a quién deja el laboratorio, qué
 * días y a dónde va. Incluye las cesiones y las clases reubicadas.
 */
@Component({
  selector: 'app-cesiones-lista',
  imports: [FormsModule, IconoComponent],
  template: `
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <select class="campo !w-auto" [ngModel]="soloVigentes()" (ngModelChange)="soloVigentes.set($event); cargar()">
        <option [ngValue]="true">Vigentes (desde hoy)</option>
        <option [ngValue]="false">Todas</option>
      </select>
      <select class="campo !w-auto" [ngModel]="orden()" (ngModelChange)="orden.set($event)" aria-label="Ordenar">
        <option value="proxima">Fecha más próxima</option>
        <option value="lejana">Fecha más lejana</option>
        <option value="recientes">Registradas recientemente</option>
        <option value="docente">Docente que cede (A-Z)</option>
      </select>
      <select class="campo !w-auto" [ngModel]="tipo()" (ngModelChange)="tipo.set($event)" aria-label="Tipo">
        <option value="todos">Cesiones y reubicaciones</option>
        <option value="cesion">Solo cesiones</option>
        <option value="reubicacion">Solo reubicaciones</option>
      </select>
      <div class="relative min-w-52 flex-1">
        <app-icono nombre="buscar" [tamano]="16" class="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
        <input maxlength="60" class="campo !pl-9" placeholder="Docente, materia, motivo…" [ngModel]="busqueda()" (ngModelChange)="busqueda.set($event)">
      </div>
      @if (auth.puedeEditar()) {
        <button class="btn-primario" (click)="paneles.abrirCesion({})"><app-icono nombre="ceder" [tamano]="16" /> Nueva cesión</button>
      }
    </div>

    <div class="tarjeta overflow-x-auto">
      <table class="tabla">
        <thead>
          <tr><th>Se va</th><th>Horario</th><th>Viene</th><th>Días</th><th>Se va al aula</th><th></th></tr>
        </thead>
        <tbody>
          @for (f of filtradas(); track f.clave) {
            <tr>
              <td>
                <p class="font-medium">{{ f.seVa }}</p>
                <p class="text-xs text-slate-500">{{ f.seVaMateria }}</p>
              </td>
              <td class="whitespace-nowrap">
                {{ dias[f.dia] }} {{ hhmm(f.horaInicio) }}–{{ hhmm(f.horaFin) }}
                <span class="chip ml-1 bg-slate-100 font-semibold">{{ catalogos.codigoAmbiente(f.ambienteId) }}</span>
              </td>
              <td>
                <p class="font-medium">{{ f.viene || '—' }}</p>
                <p class="text-xs text-slate-500">{{ f.vieneMateria }}</p>
                <p class="text-xs text-slate-400 italic">{{ f.motivo }}</p>
              </td>
              <td>
                <div class="flex max-w-xs flex-wrap gap-1">
                  @for (d of f.fechas.slice(0, 6); track d) {
                    <span class="chip" [class]="d < hoy ? 'bg-slate-100 text-slate-400' : 'bg-purple-100 text-purple-800'">{{ fechaCorta(d) }}</span>
                  }
                  @if (f.fechas.length > 6) { <span class="chip bg-slate-100">+{{ f.fechas.length - 6 }}</span> }
                </div>
              </td>
              <td>
                @if (f.aula) { <span class="font-medium">{{ f.aula }}</span> }
                @else if (f.cesion) { <span class="text-sm text-slate-400">Sin indicar</span> }
                @else { <span class="text-sm text-red-600">Clase suspendida</span> }
              </td>
              <td class="text-right whitespace-nowrap">
                @if (auth.puedeEditar()) {
                  @if (f.cesion; as c) {
                    <button class="btn-fantasma btn-sm" (click)="paneles.abrirCesion({ id: c.id })" title="Editar"><app-icono nombre="editar" [tamano]="16" /></button>
                    <button class="btn-fantasma btn-sm text-red-600" (click)="eliminar(c)" title="Eliminar"><app-icono nombre="eliminar" [tamano]="16" /></button>
                  } @else if (f.asignacionId) {
                    <button class="btn-fantasma btn-sm" (click)="paneles.abrirAsignacion(f.asignacionId)" title="Editar la clase que se va (sus días reubicados)"><app-icono nombre="editar" [tamano]="16" /></button>
                  }
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="py-10 text-center text-slate-500">{{ cargando() ? 'Cargando…' : 'No hay ambientes cedidos.' }}</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class CesionesListaComponent {
  protected readonly auth = inject(AuthService);
  protected readonly catalogos = inject(CatalogosService);
  protected readonly paneles = inject(PanelesService);
  private readonly supabase = inject(SupabaseService);
  private readonly notificaciones = inject(NotificacionesService);
  private readonly confirmacion = inject(ConfirmacionService);
  private readonly ocupacion = inject(OcupacionService);

  protected readonly hhmm = hhmm;
  protected readonly fechaCorta = fechaCorta;
  protected readonly dias = DIAS_SEMANA;
  protected readonly hoy = hoyIso();

  protected readonly cesiones = signal<Cesion[]>([]);
  protected readonly reubicaciones = signal<CedidoPorReubicacion[]>([]);
  protected readonly tipo = signal<'todos' | 'cesion' | 'reubicacion'>('todos');
  protected readonly cargando = signal(false);
  protected readonly soloVigentes = signal(true);
  protected readonly busqueda = signal('');
  protected readonly orden = signal<'proxima' | 'lejana' | 'recientes' | 'docente'>('proxima');

  /** Cesiones y reubicaciones con la misma forma */
  private readonly filas = computed<FilaCedido[]>(() => {
    const cesiones: FilaCedido[] = this.cesiones().map((c) => ({
      clave: `S-${c.id}`, cesion: c, asignacionId: c.horario?.asignacion?.id ?? null,
      seVa: `${c.horario?.asignacion?.docente?.apellidos ?? ''} ${c.horario?.asignacion?.docente?.nombres ?? ''}`.trim(),
      seVaMateria: c.horario?.asignacion?.materia?.nombre ?? '',
      dia: c.horario?.dia_semana ?? 0, horaInicio: c.horario?.hora_inicio ?? '', horaFin: c.horario?.hora_fin ?? '',
      ambienteId: c.horario?.ambiente_id ?? 0,
      viene: `${c.receptor?.apellidos ?? ''} ${c.receptor?.nombres ?? ''}`.trim(), vieneMateria: c.materia_receptor ?? '',
      motivo: c.motivo ?? '', fechas: this.fechasOrdenadas(c), aula: c.aula_destino, id: c.id,
    }));
    // Reubicaciones: una fila por horario, destino y quién viene (con todas sus fechas)
    const grupos = new Map<string, FilaCedido>();
    for (const r of this.reubicaciones()) {
      const clave = `R-${r.asignacion_horario_id}|${r.destino ?? ''}|${r.viene_titulo ?? ''}|${r.viene_detalle ?? ''}`;
      const fila = grupos.get(clave) ?? {
        clave, cesion: null, asignacionId: r.asignacion_id, seVa: r.docente, seVaMateria: r.materia,
        dia: r.dia_semana, horaInicio: r.hora_inicio, horaFin: r.hora_fin, ambienteId: r.ambiente_id,
        viene: r.viene_detalle?.split(' · ')[0] ?? '', vieneMateria: r.viene_titulo ?? '',
        motivo: r.motivo, fechas: [], aula: r.destino, id: r.reubicacion_id,
      };
      fila.fechas.push(r.fecha);
      fila.id = Math.max(fila.id, r.reubicacion_id);
      grupos.set(clave, fila);
    }
    for (const fila of grupos.values()) fila.fechas.sort();
    return [...cesiones, ...grupos.values()];
  });

  protected readonly filtradas = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const lista = this.filas().filter((f) => {
      if (this.tipo() === 'cesion' && !f.cesion) return false;
      if (this.tipo() === 'reubicacion' && f.cesion) return false;
      if (this.soloVigentes() && !f.fechas.some((x) => x >= this.hoy)) return false;
      if (!texto) return true;
      return `${f.seVa} ${f.seVaMateria} ${f.viene} ${f.vieneMateria} ${f.motivo} ${f.aula ?? ''}`.toLowerCase().includes(texto);
    });
    // Primera fecha que interesa: la próxima (o la última si ya pasaron todas)
    const fechaClave = (f: FilaCedido) => f.fechas.find((x) => x >= this.hoy) ?? f.fechas.at(-1) ?? '';
    switch (this.orden()) {
      case 'proxima': return lista.sort((a, b) => fechaClave(a).localeCompare(fechaClave(b)));
      case 'lejana': return lista.sort((a, b) => fechaClave(b).localeCompare(fechaClave(a)));
      case 'docente': return lista.sort((a, b) => a.seVa.localeCompare(b.seVa, 'es'));
      default: return lista.sort((a, b) => b.id - a.id);
    }
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
    try {
      const [{ data, error }, reubicaciones] = await Promise.all([
        this.supabase.cliente.from('cesiones').select(SELECT_CESION).order('id', { ascending: false }),
        // Solo desde hoy si se ven las vigentes (la lista completa puede ser larga)
        this.ocupacion.cedidosPorReubicacion(this.soloVigentes() ? this.hoy : null),
      ]);
      if (error) throw new ErrorSistema(error);
      this.cesiones.set((data ?? []) as unknown as Cesion[]);
      this.reubicaciones.set(reubicaciones);
    } catch (e) {
      this.notificaciones.error(e);
    } finally {
      this.cargando.set(false);
    }
  }

  protected fechasOrdenadas(c: Cesion): string[] {
    return (c.fechas ?? []).map((f) => f.fecha).sort();
  }


  protected async eliminar(c: Cesion): Promise<void> {
    if (!(await this.confirmacion.pedir({ titulo: '¿Eliminar esta cesión?', mensaje: 'Se eliminará la cesión con sus fechas.',
      consecuencias: ['El docente vuelve a su laboratorio en esas fechas.'], aceptar: 'Sí, eliminar la cesión' }))) return;
    const { error } = await this.supabase.cliente.from('cesiones').delete().eq('id', c.id);
    if (error) {
      this.notificaciones.error(new ErrorSistema(error));
      return;
    }
    this.notificaciones.exito('Cesión eliminada.');
    this.paneles.notificarCambio();
  }
}
