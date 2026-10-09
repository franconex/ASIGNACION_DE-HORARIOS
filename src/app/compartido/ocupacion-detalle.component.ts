import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { CatalogosService } from '../core/catalogos.service';
import { fechaLarga, hhmm } from '../core/fechas';
import { Ambiente, Ocupacion } from '../core/modelos';
import { NotificacionesService } from '../core/notificaciones.service';
import { OcupacionService } from '../core/ocupacion.service';
import { PanelesService } from '../core/paneles.service';
import { SupabaseService, ErrorSistema } from '../core/supabase.service';
import { IconoComponent } from './icono.component';
import { ModalComponent } from './modal.component';

/**
 * Detalle de una ocupación (clase, cesión o reserva) con acciones rápidas:
 * reubicar/suspender la clase ese día, ceder ese día, editar, etc.
 */
@Component({
  selector: 'app-ocupacion-detalle',
  imports: [ModalComponent, FormsModule, IconoComponent],
  template: `
    <app-modal [abierto]="!!ocupacion()" [titulo]="tituloModal()" (cerrar)="cerrar.emit()" ancho="md">
      @if (ocupacion(); as o) {
        <div class="space-y-4">
          <!-- Encabezado -->
          <div class="flex items-start gap-3">
            <span class="mt-1 h-10 w-1.5 shrink-0 rounded-full" [style.background]="o.color"></span>
            <div>
              <p class="text-lg font-semibold">{{ o.titulo }}</p>
              <p class="text-sm text-slate-600">{{ o.detalle }}</p>
            </div>
          </div>

          <dl class="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
            <div><dt class="etiqueta">Ambiente</dt><dd class="font-medium">{{ catalogos.codigoAmbiente(o.ambiente_id) }}</dd></div>
            <div><dt class="etiqueta">Fecha</dt><dd class="font-medium capitalize">{{ fechaLarga(o.fecha) }}</dd></div>
            <div><dt class="etiqueta">Horario</dt><dd class="font-medium">{{ hhmm(o.hora_inicio) }} – {{ hhmm(o.hora_fin) }}</dd></div>
            <div><dt class="etiqueta">Tipo</dt>
              <dd><span class="chip" [class]="estiloEstado[o.estado] || 'bg-slate-200 text-slate-700'">{{ textoEstado[o.estado] || o.estado }}</span></dd>
            </div>
          </dl>

          <!-- Formulario de reubicación (solo clases) -->
          @if (modoReubicar()) {
            <div class="space-y-3 rounded-lg border border-marca-100 bg-marca-50/50 p-3">
              <p class="text-sm font-semibold">Reubicar la clase solo este día</p>
              <div>
                <label class="etiqueta">Ambiente libre</label>
                @if (cargandoLibres()) {
                  <p class="text-sm text-slate-500">Buscando ambientes libres…</p>
                } @else {
                  <div class="flex flex-wrap gap-1.5">
                    @for (a of libres(); track a.id) {
                      <button type="button" class="chip cursor-pointer border px-2.5 py-1"
                              [class]="destino() === a.id ? 'border-marca-600 bg-marca-600 text-white' : 'border-slate-300 bg-superficie hover:border-marca-500'"
                              (click)="destino.set(a.id)">{{ a.codigo }}</button>
                    } @empty {
                      <p class="text-sm text-red-700">No hay ambientes libres en ese horario.</p>
                    }
                    <button type="button" class="chip cursor-pointer border px-2.5 py-1"
                            [class]="destino() === 0 ? 'border-red-600 bg-red-600 text-white' : 'border-red-300 bg-superficie text-red-700'"
                            (click)="destino.set(0)">Suspender clase</button>
                  </div>
                }
              </div>
              <div>
                <label class="etiqueta">Motivo</label>
                <input maxlength="200" class="campo" [(ngModel)]="motivo" placeholder="Ej: mantenimiento de equipos">
              </div>
            </div>
          }
        </div>
      }

      <div pie class="flex w-full flex-wrap justify-end gap-2">
        @if (ocupacion(); as o) {
          @if (auth.puedeEditar()) {
            @if (o.origen === 'clase') {
              @if (modoReubicar()) {
                <button class="btn-secundario" (click)="modoReubicar.set(false)">Cancelar</button>
                <button class="btn-primario" [disabled]="destino() === null || !motivo.trim() || guardando()" (click)="guardarReubicacion()">
                  {{ guardando() ? 'Guardando…' : 'Guardar reubicación' }}
                </button>
              } @else {
                @if (o.reubicacion_id) {
                  <button class="btn-secundario" (click)="quitarReubicacion()"><app-icono nombre="restaurar" [tamano]="15" /> Volver a su ambiente</button>
                }
                <button class="btn-secundario" (click)="abrirReubicar()"><app-icono nombre="reubicar" [tamano]="15" /> Reubicar / suspender</button>
                <button class="btn-secundario !border-orange-300 !text-orange-700" (click)="crearEvento(o)" title="Evento en el horario de esta clase (el docente se reubica)">
                  <app-icono nombre="evento" [tamano]="15" /> Evento aquí</button>
                <button class="btn-secundario !border-purple-300 !text-purple-700" (click)="ceder(o)">
                  <app-icono nombre="ceder" [tamano]="15" /> Ceder</button>
                <button class="btn-primario" (click)="editar(o)"><app-icono nombre="editar" [tamano]="15" /> Editar</button>
              }
            }
            @if (o.origen === 'cesion') {
              <button class="btn-primario" (click)="editar(o)"><app-icono nombre="editar" [tamano]="15" /> Editar cesión</button>
            }
            @if (o.origen === 'reserva') {
              <button class="btn-primario" (click)="editar(o)"><app-icono nombre="editar" [tamano]="15" /> Editar</button>
            }
          } @else {
            <button class="btn-secundario" (click)="cerrar.emit()">Cerrar</button>
          }
        }
      </div>
    </app-modal>
  `,
})
export class OcupacionDetalleComponent {
  protected readonly auth = inject(AuthService);
  protected readonly catalogos = inject(CatalogosService);
  private readonly ocupacionServicio = inject(OcupacionService);
  private readonly supabase = inject(SupabaseService);
  private readonly notificaciones = inject(NotificacionesService);
  protected readonly paneles = inject(PanelesService);

  /** Ocupación a mostrar (null = cerrado) */
  readonly ocupacion = input<Ocupacion | null>(null);
  readonly cerrar = output<void>();
  /** Se emite cuando algo cambió y hay que recargar */
  readonly cambio = output<void>();

  protected readonly fechaLarga = fechaLarga;
  protected readonly hhmm = hhmm;

  protected readonly modoReubicar = signal(false);
  protected readonly libres = signal<Ambiente[]>([]);
  protected readonly cargandoLibres = signal(false);
  /** id del ambiente destino; 0 = suspender; null = sin elegir */
  protected readonly destino = signal<number | null>(null);
  protected readonly guardando = signal(false);
  protected motivo = '';

  protected readonly textoEstado: Record<string, string> = {
    normal: 'Clase', reubicada: 'Clase reubicada', cedida: 'Ambiente cedido',
    evento: 'Evento', defensa: 'Defensa', mantenimiento: 'Mantenimiento',
  };
  protected readonly estiloEstado: Record<string, string> = {
    normal: 'bg-marca-100 text-marca-700', reubicada: 'bg-amber-100 text-amber-800',
    cedida: 'bg-purple-100 text-purple-800', evento: 'bg-red-100 text-red-700',
    defensa: 'bg-orange-100 text-orange-700', mantenimiento: 'bg-slate-200 text-slate-700',
  };

  protected readonly tituloModal = computed(() => {
    const o = this.ocupacion();
    return o ? `${this.catalogos.codigoAmbiente(o.ambiente_id)} · ${hhmm(o.hora_inicio)}–${hhmm(o.hora_fin)}` : '';
  });

  constructor() {
    // Reinicia el formulario cada vez que se abre otra ocupación
    effect(() => {
      this.ocupacion();
      this.modoReubicar.set(false);
      this.destino.set(null);
      this.motivo = '';
    });
  }

  /** Busca ambientes libres para mover la clase ese día */
  protected async abrirReubicar(): Promise<void> {
    const o = this.ocupacion();
    if (!o) return;
    this.modoReubicar.set(true);
    this.cargandoLibres.set(true);
    try {
      const libres = await this.ocupacionServicio.ambientesLibres(o.fecha, o.hora_inicio, o.hora_fin,
        { asignacion_horario_id: o.asignacion_horario_id });
      this.libres.set(libres.filter((a) => a.id !== o.ambiente_id));
    } catch (e) {
      this.notificaciones.error(e);
    } finally {
      this.cargandoLibres.set(false);
    }
  }

  /** Guarda la reubicación (o suspensión) de la clase */
  protected async guardarReubicacion(): Promise<void> {
    const o = this.ocupacion();
    if (!o || this.destino() === null) return;
    this.guardando.set(true);
    try {
      await this.ocupacionServicio.reubicarClase({
        asignacion_horario_id: o.asignacion_horario_id,
        fecha: o.fecha,
        ambiente_destino_id: this.destino() || null,
        motivo: this.motivo.trim(),
      });
      this.notificaciones.exito(this.destino() ? 'Clase reubicada.' : 'Clase suspendida para ese día.');
      this.cambio.emit();
      this.paneles.notificarCambio();
      this.cerrar.emit();
    } catch (e) {
      this.notificaciones.error(e);
    } finally {
      this.guardando.set(false);
    }
  }

  /** Elimina la reubicación: la clase vuelve a su ambiente original */
  protected async quitarReubicacion(): Promise<void> {
    const o = this.ocupacion();
    if (!o?.reubicacion_id) return;
    if (!confirm('¿Devolver la clase a su ambiente original ese día?')) return;
    const { error } = await this.supabase.cliente.from('reubicaciones').delete().eq('id', o.reubicacion_id);
    if (error) {
      this.notificaciones.error(new ErrorSistema(error));
      return;
    }
    this.notificaciones.exito('La clase volvió a su ambiente.');
    this.cambio.emit();
    this.paneles.notificarCambio();
    this.cerrar.emit();
  }

  /** Cierra el detalle y abre la cesión de esa clase en ese día */
  protected ceder(o: Ocupacion): void {
    this.cerrar.emit();
    this.paneles.abrirCesion({ asignacionId: o.asignacion_id, horarioId: o.asignacion_horario_id, fecha: o.fecha });
  }

  /** Cierra el detalle y abre un evento con el laboratorio, día y horas de esta clase */
  protected crearEvento(o: Ocupacion): void {
    this.cerrar.emit();
    this.paneles.abrirReserva(null, {
      ambienteId: o.ambiente_id, fecha: o.fecha, horaInicio: hhmm(o.hora_inicio), horaFin: hhmm(o.hora_fin),
      tipoId: this.catalogos.tiposReserva().find((t) => t.codigo === 'EVENTO')?.id,
    });
  }

  /** Cierra el detalle y abre el formulario que corresponde (asignación, cesión o reserva) */
  protected editar(o: Ocupacion): void {
    this.cerrar.emit();
    if (o.origen === 'clase') this.paneles.abrirAsignacion(o.asignacion_id);
    else if (o.origen === 'cesion') this.paneles.abrirCesion({ id: o.cesion_id });
    else this.paneles.abrirReserva(o.reserva_id);
  }
}
