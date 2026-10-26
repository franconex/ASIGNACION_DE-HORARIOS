import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { ComponentesPcComponent } from '../../compartido/componentes-pc.component';
import { IconoComponent } from '../../compartido/icono.component';
import { AgentePcsService } from '../../core/agente-pcs.service';
import { CatalogosService } from '../../core/catalogos.service';
import { AmbientePc } from '../../core/modelos';

/**
 * Debajo de las tarjetas de laboratorios: "Otros", las PCs con el agente
 * que no son de ningún laboratorio (nombre que no sigue SCPC…, PCs
 * personales o docentes). Cada una dice si está prendida y si está fuera
 * del dominio. No se muestra nada si no hay ninguna.
 */
@Component({
  selector: 'app-pcs-otros',
  imports: [IconoComponent, ComponentesPcComponent],
  template: `
    @if (agente.disponible() && otras().length) {
      <!-- min-w-0: sin esto, en el celular el texto largo estira la tarjeta y la página se sale a la derecha -->
      <section class="tarjeta mt-6 min-w-0 p-4" style="border-top: 3px solid #64748b">
        <h2 class="mb-1 flex items-center gap-2 font-semibold">
          <app-icono nombre="equipo" [tamano]="16" /> Otros <span class="font-normal text-slate-400">({{ otras().length }})</span>
        </h2>
        <p class="mb-3 text-xs text-slate-500">PCs con el agente que no son de ningún laboratorio. Toca una para ver sus propiedades.</p>
        <div class="grid grid-cols-1 gap-1.5 md:grid-cols-2">
          @for (pc of otras(); track pc.id) {
            <!-- Toda la fila es el botón: cómodo para el dedo en el celular -->
            <button type="button" class="flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
                    (click)="verComponentes.set(pc)" (contextmenu)="$event.preventDefault(); verComponentes.set(pc)">
              <span class="h-2.5 w-2.5 shrink-0 rounded-full" [class]="agente.conexion(pc.id) === 'prendida' ? 'bg-emerald-500' : 'bg-slate-700'"></span>
              <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span class="truncate text-sm font-semibold">{{ pc.etiqueta }}</span>
                  <span class="text-xs" [class]="agente.conexion(pc.id) === 'prendida' ? 'text-emerald-700' : 'text-slate-500'">
                    {{ agente.conexion(pc.id) === 'prendida' ? 'Prendida' : 'Apagada' }}
                  </span>
                  @if (agente.fueraDeDominio(pc.id)) {
                    <span class="chip bg-amber-50 text-amber-800">Fuera del dominio</span>
                  }
                </span>
                <!-- En el celular los datos van en varias líneas en vez de cortarse -->
                <span class="block text-xs text-slate-500 sm:truncate">{{ caracteristicas(pc) || 'Sin datos' }}</span>
              </span>
              <app-icono nombre="siguiente" [tamano]="16" class="shrink-0 text-slate-400" />
            </button>
          }
        </div>
      </section>
    }

    <app-componentes-pc [pc]="verComponentes()" (cerrar)="verComponentes.set(null)" />
  `,
})
export class PcsOtrosComponent {
  protected readonly agente = inject(AgentePcsService);
  private readonly catalogos = inject(CatalogosService);

  protected readonly verComponentes = signal<AmbientePc | null>(null);

  /** Figuritas del ambiente OTROS */
  protected readonly otras = computed(() => {
    const id = this.agente.otrosId();
    return id ? (this.catalogos.pcsPorAmbiente().get(id) ?? []) : [];
  });

  constructor() {
    // Mientras se ve la página, prendida / apagada llega en vivo
    this.agente.activar();
    inject(DestroyRef).onDestroy(() => this.agente.desactivar());
  }

  protected caracteristicas(pc: AmbientePc): string {
    return [pc.procesador, pc.ram, pc.almacenamiento].filter(Boolean).join(' · ');
  }
}
