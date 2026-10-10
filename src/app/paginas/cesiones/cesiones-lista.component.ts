import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconoComponent } from '../../compartido/icono.component';
import { PanelesService } from '../../core/paneles.service';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { DIAS_SEMANA, fechaCorta, hhmm, hoyIso } from '../../core/fechas';
import { Cesion } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { ErrorSistema, SupabaseService } from '../../core/supabase.service';

/** Consulta con todas las relaciones necesarias para mostrar una cesión */
export const SELECT_CESION =
  '*, receptor:docentes(id,nombres,apellidos), fechas:cesion_fechas(fecha), ' +
  'horario:asignacion_horarios!cesiones_asignacion_horario_id_fkey(*, asignacion:asignaciones(id, grupo, docente_id, docente:docentes(id,nombres,apellidos), materia:materias(nombre)))';

/**
 * Lista de cesiones: quién cede, a quién, qué días y dónde pasa el que cede.
 */
@Component({
  selector: 'app-cesiones-lista',
  imports: [FormsModule, IconoComponent],
  template: `
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <select class="campo !w-auto" [ngModel]="soloVigentes()" (ngModelChange)="soloVigentes.set($event)">
        <option [ngValue]="true">Vigentes (desde hoy)</option>
        <option [ngValue]="false">Todas</option>
      </select>
      <select class="campo !w-auto" [ngModel]="orden()" (ngModelChange)="orden.set($event)" aria-label="Ordenar">
        <option value="proxima">Fecha más próxima</option>
        <option value="lejana">Fecha más lejana</option>
        <option value="recientes">Registradas recientemente</option>
        <option value="docente">Docente que cede (A-Z)</option>
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
          @for (c of filtradas(); track c.id) {
            <tr>
              <td>
                <p class="font-medium">{{ c.horario?.asignacion?.docente?.apellidos }} {{ c.horario?.asignacion?.docente?.nombres }}</p>
                <p class="text-xs text-slate-500">{{ c.horario?.asignacion?.materia?.nombre }}</p>
              </td>
              <td class="whitespace-nowrap">
                {{ dias[c.horario?.dia_semana ?? 0] }} {{ hhmm(c.horario?.hora_inicio) }}–{{ hhmm(c.horario?.hora_fin) }}
                <span class="chip ml-1 bg-slate-100 font-semibold">{{ catalogos.codigoAmbiente(c.horario?.ambiente_id) }}</span>
              </td>
              <td>
                <p class="font-medium">{{ c.receptor?.apellidos }} {{ c.receptor?.nombres }}</p>
                <p class="text-xs text-slate-500">{{ c.materia_receptor }}</p>
                <p class="text-xs text-slate-400 italic">{{ c.motivo }}</p>
              </td>
              <td>
                <div class="flex max-w-xs flex-wrap gap-1">
                  @for (f of fechasOrdenadas(c).slice(0, 6); track f) {
                    <span class="chip" [class]="f < hoy ? 'bg-slate-100 text-slate-400' : 'bg-purple-100 text-purple-800'">{{ fechaCorta(f) }}</span>
                  }
                  @if ((c.fechas?.length ?? 0) > 6) { <span class="chip bg-slate-100">+{{ (c.fechas?.length ?? 0) - 6 }}</span> }
                </div>
              </td>
              <td>
                @if (c.aula_destino) { <span class="font-medium">{{ c.aula_destino }}</span> }
                @else { <span class="text-sm text-slate-400">Sin indicar</span> }
              </td>
              <td class="text-right whitespace-nowrap">
                @if (auth.puedeEditar()) {
                  <button class="btn-fantasma btn-sm" (click)="paneles.abrirCesion({ id: c.id })" title="Editar"><app-icono nombre="editar" [tamano]="16" /></button>
                  <button class="btn-fantasma btn-sm text-red-600" (click)="eliminar(c)" title="Eliminar"><app-icono nombre="eliminar" [tamano]="16" /></button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="py-10 text-center text-slate-500">{{ cargando() ? 'Cargando…' : 'No hay cesiones.' }}</td></tr>
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

  protected readonly hhmm = hhmm;
  protected readonly fechaCorta = fechaCorta;
  protected readonly dias = DIAS_SEMANA;
  protected readonly hoy = hoyIso();

  protected readonly cesiones = signal<Cesion[]>([]);
  protected readonly cargando = signal(false);
  protected readonly soloVigentes = signal(true);
  protected readonly busqueda = signal('');
  protected readonly orden = signal<'proxima' | 'lejana' | 'recientes' | 'docente'>('proxima');

  protected readonly filtradas = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const lista = this.cesiones().filter((c) => {
      if (this.soloVigentes() && !(c.fechas ?? []).some((f) => f.fecha >= this.hoy)) return false;
      if (!texto) return true;
      const a = c.horario?.asignacion;
      return `${a?.docente?.apellidos} ${a?.docente?.nombres} ${a?.materia?.nombre} ${c.receptor?.apellidos} ${c.receptor?.nombres} ${c.materia_receptor} ${c.motivo}`
        .toLowerCase().includes(texto);
    });
    // Primera fecha que interesa: la próxima (o la última si ya pasaron todas)
    const fechaClave = (c: Cesion) => { const f = this.fechasOrdenadas(c); return f.find((x) => x >= this.hoy) ?? f.at(-1) ?? ''; };
    const docente = (c: Cesion) => `${c.horario?.asignacion?.docente?.apellidos ?? ''} ${c.horario?.asignacion?.docente?.nombres ?? ''}`;
    switch (this.orden()) {
      case 'proxima': return lista.sort((a, b) => fechaClave(a).localeCompare(fechaClave(b)));
      case 'lejana': return lista.sort((a, b) => fechaClave(b).localeCompare(fechaClave(a)));
      case 'docente': return lista.sort((a, b) => docente(a).localeCompare(docente(b), 'es'));
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
    const { data, error } = await this.supabase.cliente.from('cesiones').select(SELECT_CESION).order('id', { ascending: false });
    this.cargando.set(false);
    if (error) {
      this.notificaciones.error(new ErrorSistema(error));
      return;
    }
    this.cesiones.set((data ?? []) as unknown as Cesion[]);
  }

  protected fechasOrdenadas(c: Cesion): string[] {
    return (c.fechas ?? []).map((f) => f.fecha).sort();
  }


  protected async eliminar(c: Cesion): Promise<void> {
    if (!confirm('¿Eliminar esta cesión? El docente volverá a su laboratorio en esas fechas.')) return;
    const { error } = await this.supabase.cliente.from('cesiones').delete().eq('id', c.id);
    if (error) {
      this.notificaciones.error(new ErrorSistema(error));
      return;
    }
    this.notificaciones.exito('Cesión eliminada.');
    this.paneles.notificarCambio();
  }
}
