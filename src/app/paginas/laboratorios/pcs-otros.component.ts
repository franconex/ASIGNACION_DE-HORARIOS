import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { ComponentesPcComponent } from '../../compartido/componentes-pc.component';
import { IconoComponent } from '../../compartido/icono.component';
import { AgentePcsService, TEXTOS_ALERTA } from '../../core/agente-pcs.service';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { AmbientePc } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';

/**
 * Debajo de las tarjetas de laboratorios:
 *  - "Otros": PCs que reportó el agente pero no son de ningún laboratorio
 *    (nombre que no sigue SCPC…, PCs personales o docentes).
 *  - Alertas abiertas del agente (fuera de dominio, duplicados, cambios de hardware…).
 * No se muestra nada mientras el script 56 no esté aplicado.
 */
@Component({
  selector: 'app-pcs-otros',
  imports: [IconoComponent, ComponentesPcComponent, DatePipe],
  template: `
    @if (agente.disponible() && (otras().length || agente.alertas().length)) {
      <!-- grid-cols-1 + min-w-0: sin esto, en el celular la columna se estira con el texto largo y la página se sale a la derecha -->
      <div class="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <!-- PCs en OTROS -->
        <section class="tarjeta min-w-0 p-4" style="border-top: 3px solid #64748b">
          <h2 class="mb-1 flex items-center gap-2 font-semibold">
            <app-icono nombre="equipo" [tamano]="16" /> Otros <span class="font-normal text-slate-400">({{ otras().length }})</span>
          </h2>
          <p class="mb-3 text-xs text-slate-500">PCs con el agente que no son de ningún laboratorio. Toca una para ver sus propiedades.</p>
          <div class="space-y-1.5">
            @for (pc of otras(); track pc.id) {
              <!-- Toda la fila es el botón: cómodo para el dedo en el celular -->
              <button type="button" class="flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
                      (click)="verComponentes.set(pc)" (contextmenu)="$event.preventDefault(); verComponentes.set(pc)">
                <span class="h-2.5 w-2.5 shrink-0 rounded-full" [class]="agente.conexion(pc.id) === 'prendida' ? 'bg-emerald-500' : 'bg-slate-700'"></span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-2">
                    <span class="truncate text-sm font-semibold">{{ pc.etiqueta }}</span>
                    <span class="shrink-0 text-xs" [class]="agente.conexion(pc.id) === 'prendida' ? 'text-emerald-700' : 'text-slate-500'">
                      {{ agente.conexion(pc.id) === 'prendida' ? 'Prendida' : 'Apagada' }}
                    </span>
                  </span>
                  <!-- En el celular los datos van en varias líneas en vez de cortarse -->
                  <span class="block text-xs text-slate-500 sm:truncate">{{ caracteristicas(pc) || 'Sin datos' }}</span>
                </span>
                <app-icono nombre="siguiente" [tamano]="16" class="shrink-0 text-slate-400" />
              </button>
            } @empty {
              <p class="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">No hay PCs fuera de los laboratorios.</p>
            }
          </div>
        </section>

        <!-- Alertas abiertas -->
        <section class="tarjeta min-w-0 p-4" style="border-top: 3px solid #f59e0b">
          <h2 class="mb-1 flex items-center gap-2 font-semibold">
            <app-icono nombre="alerta" [tamano]="16" /> Alertas de PCs <span class="font-normal text-slate-400">({{ agente.alertas().length }})</span>
          </h2>
          <p class="mb-3 text-xs text-slate-500">Las de dominio, nombre y laboratorio se cierran solas cuando la PC se corrige.</p>
          <div class="space-y-1.5">
            @for (a of agente.alertas(); track a.id) {
              <div class="flex min-w-0 items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2">
                <div class="min-w-0 flex-1">
                  <p class="text-sm"><b class="break-all">{{ a.equipo?.nombre_equipo ?? '—' }}</b> · <span class="text-amber-800">{{ textos[a.tipo] }}</span></p>
                  <p class="break-words text-xs text-slate-600">{{ a.detalle }}</p>
                  <p class="text-[11px] text-slate-500">{{ a.creada_en | date: 'dd/MM/yyyy HH:mm' }}</p>
                </div>
                @if (auth.puedeOperar()) {
                  <button type="button" class="btn-fantasma flex h-10 w-10 shrink-0 items-center justify-center" [disabled]="resolviendo() === a.id"
                          (click)="resolver(a.id)" title="Marcar como revisada" aria-label="Marcar como revisada">
                    <app-icono nombre="check" [tamano]="18" />
                  </button>
                }
              </div>
            } @empty {
              <p class="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">Sin alertas.</p>
            }
          </div>
        </section>
      </div>
    }

    <app-componentes-pc [pc]="verComponentes()" (cerrar)="verComponentes.set(null)" />
  `,
})
export class PcsOtrosComponent {
  protected readonly agente = inject(AgentePcsService);
  protected readonly auth = inject(AuthService);
  private readonly catalogos = inject(CatalogosService);
  private readonly notificaciones = inject(NotificacionesService);

  protected readonly textos = TEXTOS_ALERTA;
  protected readonly verComponentes = signal<AmbientePc | null>(null);
  protected readonly resolviendo = signal<number | null>(null);

  /** Figuritas del ambiente OTROS */
  protected readonly otras = computed(() => {
    const id = this.agente.otrosId();
    return id ? (this.catalogos.pcsPorAmbiente().get(id) ?? []) : [];
  });

  constructor() {
    // Mientras se ve la página, el estado de las PCs se refresca solo
    this.agente.activar();
    inject(DestroyRef).onDestroy(() => this.agente.desactivar());
  }

  protected caracteristicas(pc: AmbientePc): string {
    return [pc.procesador, pc.ram, pc.almacenamiento].filter(Boolean).join(' · ');
  }

  /** Marca la alerta como revisada (queda a nombre de quien la marcó) */
  protected async resolver(id: number): Promise<void> {
    this.resolviendo.set(id);
    try {
      await this.agente.resolverAlerta(id);
    } catch (e) {
      this.notificaciones.error(e, 'No se pudo marcar');
    } finally {
      this.resolviendo.set(null);
    }
  }
}
