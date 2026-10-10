import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconoComponent } from '../../compartido/icono.component';
import { PanelesService } from '../../core/paneles.service';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { fechaCorta, hhmm, hoyIso } from '../../core/fechas';
import { Reserva } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { ConfirmacionService } from '../../core/confirmacion.service';
import { ErrorSistema, SupabaseService } from '../../core/supabase.service';
import { CATEGORIAS_EVENTO } from './reserva-form.component';

/**
 * Lista de eventos, defensas y otras reservas de prioridad alta.
 */
@Component({
  selector: 'app-reservas-lista',
  imports: [FormsModule, IconoComponent],
  template: `
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <select class="campo !w-auto" [ngModel]="tipoId()" (ngModelChange)="tipoId.set(+$event)">
        <option [ngValue]="0">Todos los tipos</option>
        @for (t of catalogos.tiposReserva(); track t.id) { <option [ngValue]="t.id">{{ t.nombre }}</option> }
      </select>
      <select class="campo !w-auto" [ngModel]="soloProximas()" (ngModelChange)="soloProximas.set($event)">
        <option [ngValue]="true">Próximas</option>
        <option [ngValue]="false">Todas</option>
      </select>
      <select class="campo !w-auto" [ngModel]="orden()" (ngModelChange)="orden.set($event)" aria-label="Ordenar">
        <option value="proxima">Fecha más próxima</option>
        <option value="lejana">Fecha más lejana</option>
        <option value="recientes">Registradas recientemente</option>
        <option value="nombre">Nombre (A-Z)</option>
      </select>
      <div class="relative min-w-52 flex-1">
        <app-icono nombre="buscar" [tamano]="16" class="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
        <input maxlength="60" class="campo !pl-9" [ngModel]="busqueda()" (ngModelChange)="busqueda.set($event)" placeholder="Nombre o responsable">
      </div>
      @if (auth.puedeEditar()) {
        @for (t of catalogos.tiposReserva(); track t.id) {
          <button class="btn-secundario" (click)="paneles.abrirReserva(null, { tipoId: t.id })">
            <app-icono [nombre]="t.codigo === 'DEFENSA' ? 'defensa' : t.codigo === 'MANTENIMIENTO' ? 'mantenimiento' : 'evento'" [tamano]="16" class="color-dinamico" [style.color]="t.color" /> {{ t.nombre }}
          </button>
        }
      }
    </div>

    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      @for (r of filtradas(); track r.id) {
        <div class="tarjeta flex flex-col p-4" [style.border-left]="'4px solid ' + (r.tipo?.color ?? '#dc2626')">
          <div class="mb-2 flex items-start justify-between gap-2">
            <div>
              <span class="color-dinamico chip mb-1" [style.background]="(r.tipo?.color ?? '#dc2626') + '22'" [style.color]="r.tipo?.color">{{ r.tipo?.nombre }}{{ textoCategoria(r) }}</span>
              <p class="font-semibold">{{ r.titulo }}</p>
              @if (r.responsable) { <p class="text-xs text-slate-500">{{ r.responsable }}</p> }
            </div>
            @if ((r.reubicaciones?.length ?? 0) > 0) {
              <span class="chip bg-amber-100 text-amber-800" title="Clases reubicadas por esta reserva">{{ r.reubicaciones?.length }} reubicada(s)</span>
            }
          </div>
          <ul class="flex-1 space-y-1 text-sm">
            @for (h of horariosOrdenados(r).slice(0, 4); track $index) {
              <li class="flex items-center gap-2">
                <span class="w-12 font-medium">{{ fechaCorta(h.fecha) }}</span>
                <span class="text-slate-500">{{ hhmm(h.hora_inicio) }}–{{ hhmm(h.hora_fin) }}</span>
                <span class="chip bg-slate-100 font-semibold">{{ catalogos.codigoAmbiente(h.ambiente_id) }}</span>
              </li>
            }
            @if ((r.horarios?.length ?? 0) > 4) { <li class="text-xs text-slate-500">… y {{ (r.horarios?.length ?? 0) - 4 }} más</li> }
          </ul>
          @if (auth.puedeEditar()) {
            <div class="mt-3 flex justify-end gap-1 border-t border-slate-100 pt-2">
              <button class="btn-fantasma btn-sm" (click)="paneles.abrirReserva(r.id)"><app-icono nombre="editar" [tamano]="15" /> Editar</button>
              <button class="btn-fantasma btn-sm text-red-600" (click)="eliminar(r)"><app-icono nombre="eliminar" [tamano]="15" /> Eliminar</button>
            </div>
          }
        </div>
      } @empty {
        <p class="col-span-full py-10 text-center text-slate-500">{{ cargando() ? 'Cargando…' : 'No hay reservas.' }}</p>
      }
    </div>
  `,
})
export class ReservasListaComponent {
  protected readonly auth = inject(AuthService);
  protected readonly catalogos = inject(CatalogosService);
  protected readonly paneles = inject(PanelesService);
  private readonly supabase = inject(SupabaseService);
  private readonly notificaciones = inject(NotificacionesService);
  private readonly confirmacion = inject(ConfirmacionService);

  protected readonly hhmm = hhmm;

  /** " · Taller" (solo eventos con categoría) */
  protected textoCategoria(r: Reserva): string {
    const c = CATEGORIAS_EVENTO.find((x) => x.valor === r.categoria);
    return c ? ` · ${c.texto}` : '';
  }
  protected readonly fechaCorta = fechaCorta;

  protected readonly reservas = signal<Reserva[]>([]);
  protected readonly cargando = signal(false);
  protected readonly tipoId = signal(0);
  protected readonly soloProximas = signal(true);
  protected readonly busqueda = signal('');
  protected readonly orden = signal<'proxima' | 'lejana' | 'recientes' | 'nombre'>('proxima');

  protected readonly filtradas = computed(() => {
    const hoy = hoyIso();
    const texto = this.busqueda().trim().toLowerCase();
    const lista = this.reservas().filter((r) =>
      (!this.tipoId() || r.tipo_id === this.tipoId()) &&
      (!this.soloProximas() || (r.horarios ?? []).some((h) => h.fecha >= hoy)) &&
      (!texto || `${r.titulo} ${r.responsable ?? ''} ${r.categoria ?? ''}`.toLowerCase().includes(texto)));
    const primera = (r: Reserva) => { const h = this.horariosOrdenados(r)[0]; return h ? h.fecha + h.hora_inicio : ''; };
    switch (this.orden()) {
      case 'proxima': return lista.sort((a, b) => primera(a).localeCompare(primera(b)));
      case 'lejana': return lista.sort((a, b) => primera(b).localeCompare(primera(a)));
      case 'nombre': return lista.sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
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
    const { data, error } = await this.supabase.cliente.from('reservas')
      .select('*, tipo:tipos_reserva(*), horarios:reserva_horarios(*), reubicaciones(id)')
      .order('id', { ascending: false });
    this.cargando.set(false);
    if (error) {
      this.notificaciones.error(new ErrorSistema(error));
      return;
    }
    // Ordena por la primera fecha
    const lista = (data ?? []) as Reserva[];
    lista.sort((a, b) => (this.horariosOrdenados(a)[0]?.fecha ?? '').localeCompare(this.horariosOrdenados(b)[0]?.fecha ?? ''));
    this.reservas.set(lista);
  }

  protected horariosOrdenados(r: Reserva) {
    return [...(r.horarios ?? [])].sort((a, b) => (a.fecha + a.hora_inicio).localeCompare(b.fecha + b.hora_inicio));
  }

  protected async eliminar(r: Reserva): Promise<void> {
    if (!(await this.confirmacion.pedir({ titulo: '¿Eliminar este evento?', mensaje: `Se eliminará "${r.titulo}" con todos sus días.`,
      consecuencias: ['Las clases que este evento movió vuelven a su laboratorio.'], aceptar: 'Sí, eliminar el evento' }))) return;
    const { error } = await this.supabase.cliente.from('reservas').delete().eq('id', r.id);
    if (error) {
      this.notificaciones.error(new ErrorSistema(error));
      return;
    }
    this.notificaciones.exito('Reserva eliminada.');
    this.paneles.notificarCambio();
  }
}
