import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconoComponent } from '../../compartido/icono.component';
import { OcupacionDetalleComponent } from '../../compartido/ocupacion-detalle.component';
import { CatalogosService } from '../../core/catalogos.service';
import { fechaLarga, hhmm, hoyIso, sumarDias } from '../../core/fechas';
import { Conflicto, Ocupacion } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { OcupacionService } from '../../core/ocupacion.service';

/**
 * Vista de conflictos existentes en un rango de fechas.
 * Normalmente está vacía (la base no deja guardar choques), pero pueden
 * aparecer si se cambian fechas de un periodo, feriados o estados de ambientes.
 * Permite abrir cada clase para moverla o editarla.
 */
@Component({
  selector: 'app-conflictos',
  imports: [FormsModule, OcupacionDetalleComponent, IconoComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <p class="text-sm text-slate-500">Choques de laboratorio o de docente en el rango elegido (normalmente vacío: el sistema no deja guardar choques).</p>
      <div class="flex flex-wrap items-end gap-2">
        <div>
          <label class="etiqueta">Desde</label>
          <input type="date" class="campo" [ngModel]="desde()" (ngModelChange)="desde.set($event)">
        </div>
        <div>
          <label class="etiqueta">Hasta</label>
          <input type="date" class="campo" [ngModel]="hasta()" (ngModelChange)="hasta.set($event)">
        </div>
        <button class="btn-primario" (click)="cargar()" [disabled]="cargando()">{{ cargando() ? 'Buscando…' : 'Buscar' }}</button>
      </div>
    </div>

    @if (!cargando() && buscado() && !conflictos().length) {
      <div class="tarjeta p-10 text-center">
        <app-icono nombre="ok" [tamano]="40" class="text-emerald-500" />
        <p class="mt-2 font-semibold">Sin conflictos</p>
        <p class="text-sm text-slate-500">No hay choques entre {{ fechaLarga(desde()) }} y {{ fechaLarga(hasta()) }}.</p>
      </div>
    }

    <div class="space-y-4">
      @for (grupo of porFecha(); track grupo.fecha) {
        <div>
          <h2 class="mb-2 text-sm font-semibold text-slate-600 capitalize">{{ fechaLarga(grupo.fecha) }}</h2>
          <div class="space-y-2">
            @for (c of grupo.items; track $index) {
              <div class="tarjeta border-l-4 p-4" [class]="c.tipo_choque === 'ambiente' ? 'border-l-red-500' : 'border-l-amber-500'">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <span class="chip mb-1" [class]="c.tipo_choque === 'ambiente' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'">
                      {{ c.tipo_choque === 'ambiente' ? 'Choque de laboratorio' : 'Choque de docente' }} · {{ hhmm(c.hora_inicio) }}–{{ hhmm(c.hora_fin) }}
                    </span>
                    <p class="text-sm">{{ c.mensaje }}</p>
                  </div>
                </div>
                <div class="mt-3 grid gap-2 sm:grid-cols-2">
                  @for (lado of [ladoA(c), ladoB(c)]; track lado.clave) {
                    <button class="rounded-lg border border-slate-200 p-2 text-left text-sm hover:border-marca-500 hover:bg-marca-50"
                            (click)="abrir(c.fecha, lado.clave)">
                      <p class="font-medium">{{ lado.titulo }} <span class="chip bg-slate-100">{{ catalogos.codigoAmbiente(lado.ambiente) }}</span></p>
                      <p class="text-xs text-slate-500">{{ lado.detalle }}</p>
                      <p class="mt-1 text-xs font-medium text-marca-600">Abrir para mover / editar →</p>
                    </button>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      }
    </div>

    <app-ocupacion-detalle [ocupacion]="seleccionada()" (cerrar)="seleccionada.set(null)" (cambio)="cargar()" />
  `,
})
export class ConflictosComponent implements OnInit {
  protected readonly catalogos = inject(CatalogosService);
  private readonly ocupacion = inject(OcupacionService);
  private readonly notificaciones = inject(NotificacionesService);

  protected readonly hhmm = hhmm;
  protected readonly fechaLarga = fechaLarga;

  protected readonly desde = signal(hoyIso());
  protected readonly hasta = signal(sumarDias(hoyIso(), 60));
  protected readonly conflictos = signal<Conflicto[]>([]);
  protected readonly cargando = signal(false);
  protected readonly buscado = signal(false);
  protected readonly seleccionada = signal<Ocupacion | null>(null);

  /** Conflictos agrupados por fecha */
  protected readonly porFecha = computed(() => {
    const grupos = new Map<string, Conflicto[]>();
    for (const c of this.conflictos()) grupos.set(c.fecha, [...(grupos.get(c.fecha) ?? []), c]);
    return [...grupos.entries()].map(([fecha, items]) => ({ fecha, items }));
  });

  ngOnInit(): void {
    void this.cargar();
  }

  protected async cargar(): Promise<void> {
    if (!this.desde() || !this.hasta() || this.hasta() < this.desde()) {
      this.notificaciones.aviso('Revise el rango de fechas.');
      return;
    }
    this.cargando.set(true);
    try {
      this.conflictos.set(await this.ocupacion.conflictos(this.desde(), this.hasta()));
      this.buscado.set(true);
    } catch (e) {
      this.notificaciones.error(e);
    } finally {
      this.cargando.set(false);
    }
  }

  protected ladoA(c: Conflicto) {
    return { clave: c.clave_a, titulo: c.titulo_a, detalle: c.detalle_a, ambiente: c.ambiente_a };
  }

  protected ladoB(c: Conflicto) {
    return { clave: c.clave_b, titulo: c.titulo_b, detalle: c.detalle_b, ambiente: c.ambiente_b };
  }

  /** Busca la ocupación completa y abre su detalle */
  protected async abrir(fecha: string, clave: string): Promise<void> {
    try {
      const ocupaciones = await this.ocupacion.ocupaciones(fecha, fecha);
      this.seleccionada.set(ocupaciones.find((o) => o.clave === clave) ?? null);
    } catch (e) {
      this.notificaciones.error(e);
    }
  }
}
