import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconoComponent } from '../../compartido/icono.component';
import { ModalComponent } from '../../compartido/modal.component';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { AmbientePc, EstadoPc } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { SupabaseService } from '../../core/supabase.service';

/** Texto y color de cada estado de PC */
const ESTADOS: Record<EstadoPc, { texto: string; clase: string }> = {
  operativa: { texto: 'Activa', clase: 'bg-emerald-50 text-emerald-700' },
  inactiva: { texto: 'Inactiva', clase: 'bg-slate-200 text-slate-600' },
  mantenimiento: { texto: 'Mantenimiento', clase: 'bg-amber-50 text-amber-800' },
  baja: { texto: 'De baja', clase: 'bg-rose-50 text-rose-700' },
};

/**
 * Inventario de PCs de un laboratorio (dentro del detalle del laboratorio):
 * resumen por estado + lista de equipos con alta / edición / baja.
 * Cambiar el estado pide qué se reparó o por qué (queda en un ticket); dar
 * de baja solo lo hacen el administrador y el encargado.
 */
@Component({
  selector: 'app-laboratorio-equipos',
  imports: [FormsModule, IconoComponent, ModalComponent],
  template: `
    <section>
      <div class="mb-2 flex items-center justify-between gap-2">
        <button type="button" class="flex items-center gap-1 text-sm font-semibold text-slate-700" (click)="abierto.set(!abierto())">
          <app-icono nombre="siguiente" [tamano]="14" class="transition" [class.rotate-90]="abierto()" />
          Inventario detallado <span class="font-normal text-slate-400">({{ pcs().length }})</span>
        </button>
        @if (auth.puedeOperar()) {
          <div class="flex gap-1.5">
            <button class="btn-secundario btn-sm" (click)="generar()" [disabled]="generando()" title="Crea PCs SCPC siguiendo la numeración, más la PC docente">
              <app-icono nombre="repetir" [tamano]="14" /> {{ generando() ? 'Generando…' : pcs().length ? 'Agregar más PCs' : 'Generar PCs' }}
            </button>
            <button class="btn-secundario btn-sm" (click)="nuevo()"><app-icono nombre="agregar" [tamano]="14" /> PC manual</button>
          </div>
        }
      </div>

      <!-- Resumen por estado -->
      @if (pcs().length) {
        <div class="mb-2 flex flex-wrap gap-1.5 text-xs">
          <span class="chip bg-emerald-50 text-emerald-700">{{ cuenta().operativa }} activas</span>
          <span class="chip bg-slate-200 text-slate-600">{{ cuenta().inactiva }} inactivas</span>
          <span class="chip bg-amber-50 text-amber-800">{{ cuenta().mantenimiento }} en mantenimiento</span>
          <span class="chip bg-rose-50 text-rose-700">{{ cuenta().baja }} de baja</span>
        </div>
      }

      @if (abierto()) {
      <div class="space-y-1.5">
        @for (pc of pcs(); track pc.id) {
          <div class="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:border-slate-300">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><app-icono nombre="equipo" [tamano]="16" /></span>
            <div class="min-w-32 flex-1">
              <p class="text-sm font-semibold">{{ pc.etiqueta }}@if (pc.es_docente) { <span class="chip ml-1 bg-marca-50 text-marca-700">docente</span> }</p>
              <p class="text-xs text-slate-500">{{ caracteristicas(pc) || 'Sin características registradas' }}</p>
              @if (pc.notas) { <p class="text-xs text-slate-400">{{ pc.notas }}</p> }
              @if (pc.estado !== 'operativa' && pc.estado_detalle) { <p class="text-xs" [class]="pc.estado === 'baja' ? 'text-rose-700' : 'text-amber-800'">{{ estados[pc.estado].texto }}: {{ pc.estado_detalle }}</p> }
              @else if (pc.estado === 'baja' && pc.motivo_baja) { <p class="text-xs text-rose-700">Baja: {{ pc.motivo_baja }}</p> }
              @if (pc.estado_en) { <p class="text-[11px] text-slate-400">Cambió {{ pc.cambio?.nombre_completo ?? '—' }}</p> }
            </div>
            <span class="chip" [class]="estados[pc.estado].clase">{{ estados[pc.estado].texto }}</span>
            @if (auth.puedeOperar()) {
              <div class="flex gap-1">
                <button class="btn-fantasma btn-sm" (click)="editar(pc)" title="Editar"><app-icono nombre="editar" [tamano]="15" /></button>
                @if (auth.puedeGestionarAuxiliares()) {
                  <button class="btn-fantasma btn-sm text-red-600" (click)="eliminar(pc)" title="Eliminar del inventario"><app-icono nombre="eliminar" [tamano]="15" /></button>
                }
              </div>
            }
          </div>
        } @empty {
          <p class="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            Aún no hay PCs registradas en este laboratorio.
          </p>
        }
      </div>
      }
    </section>

    <!-- Alta / edición de una PC -->
    <app-modal [abierto]="!!formulario()" [titulo]="editando() ? 'Editar PC' : 'Nueva PC'" ancho="sm" (cerrar)="formulario.set(null)">
      @if (formulario(); as f) {
        <form class="grid gap-3 sm:grid-cols-2" (ngSubmit)="guardar()" id="form-pc">
          <div class="sm:col-span-2">
            <label class="etiqueta">Etiqueta *</label>
            <input maxlength="30" class="campo" [(ngModel)]="f.etiqueta" name="etiqueta" placeholder="Ej: PC-01">
          </div>
          <div>
            <label class="etiqueta">Procesador</label>
            <input maxlength="60" class="campo" [(ngModel)]="f.procesador" name="procesador" placeholder="Ej: Core i5">
          </div>
          <div>
            <label class="etiqueta">RAM</label>
            <input maxlength="60" class="campo" [(ngModel)]="f.ram" name="ram" placeholder="Ej: 8 GB">
          </div>
          <div>
            <label class="etiqueta">Almacenamiento</label>
            <input maxlength="60" class="campo" [(ngModel)]="f.almacenamiento" name="almacenamiento" placeholder="Ej: 256 GB SSD">
          </div>
          <div>
            <label class="etiqueta">Estado *</label>
            <select class="campo" [(ngModel)]="f.estado" name="estado" [disabled]="estadoOriginal === 'baja' && !auth.puedeGestionarAuxiliares()">
              <option value="operativa">Activa</option>
              <option value="inactiva">Inactiva</option>
              <option value="mantenimiento">Mantenimiento</option>
              <option value="baja" [disabled]="!auth.puedeGestionarAuxiliares()">De baja{{ auth.puedeGestionarAuxiliares() ? '' : ' (solo encargado)' }}</option>
            </select>
          </div>
          @if (cambiaEstado(f)) {
            <div class="sm:col-span-2">
              <label class="etiqueta">{{ f.estado === 'operativa' ? '¿Qué se reparó?' : f.estado === 'baja' ? 'Motivo de la baja' : 'Motivo del cambio' }} *</label>
              <textarea maxlength="300" class="campo" rows="2" [(ngModel)]="detalle" name="detalle" placeholder="Queda en un ticket a tu nombre"></textarea>
            </div>
          }
          <label class="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" [(ngModel)]="f.es_docente" name="es_docente"> Es la PC de la mesa del docente
          </label>
          <div class="sm:col-span-2">
            <label class="etiqueta">Notas</label>
            <textarea maxlength="500" class="campo" rows="2" [(ngModel)]="f.notas" name="notas" placeholder="Ej: sin mouse, pantalla con rayas…"></textarea>
          </div>
        </form>
      }
      <ng-container pie>
        <button class="btn-secundario" (click)="formulario.set(null)">Cancelar</button>
        <button class="btn-primario" type="submit" form="form-pc" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
      </ng-container>
    </app-modal>
  `,
})
export class LaboratorioEquiposComponent {
  protected readonly auth = inject(AuthService);
  private readonly catalogos = inject(CatalogosService);
  private readonly notificaciones = inject(NotificacionesService);
  private readonly supabase = inject(SupabaseService);

  readonly ambienteId = input.required<number>();

  protected readonly estados = ESTADOS;
  protected readonly formulario = signal<Partial<AmbientePc> | null>(null);
  /** Estado con el que se abrió el formulario (para saber si cambió) */
  protected estadoOriginal: EstadoPc = 'operativa';
  /** Qué se reparó / por qué, si cambia el estado */
  protected detalle = '';
  protected readonly editando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly generando = signal(false);
  /** Lista detallada plegada: el croquis ya muestra las PCs */
  protected readonly abierto = signal(false);

  /** PCs de este laboratorio */
  protected readonly pcs = computed(() => this.catalogos.pcsPorAmbiente().get(this.ambienteId()) ?? []);

  /** Conteo por estado para el resumen */
  protected readonly cuenta = computed(() => {
    const r = { operativa: 0, inactiva: 0, mantenimiento: 0, baja: 0 };
    for (const pc of this.pcs()) r[pc.estado]++;
    return r;
  });

  /** ¿Se eligió otro estado? (solo admin/encargado pueden) */
  protected cambiaEstado(f: Partial<AmbientePc>): boolean {
    return this.auth.puedeOperar() && (f.estado ?? 'operativa') !== this.estadoOriginal;
  }

  protected caracteristicas(pc: AmbientePc): string {
    return [pc.procesador, pc.ram, pc.almacenamiento].filter(Boolean).join(' · ');
  }

  protected nuevo(): void {
    this.editando.set(false);
    const orden = (this.pcs().at(-1)?.orden ?? this.pcs().length) + 1;
    this.estadoOriginal = 'operativa';
    this.detalle = '';
    this.formulario.set({ ambiente_id: this.ambienteId(), estado: 'operativa', orden, es_docente: false });
  }

  /** Crea en lote las PCs del laboratorio con nomenclatura SCPC (SCPC + nº lab + nº máquina) */
  protected async generar(): Promise<void> {
    const lab = this.catalogos.mapaAmbientes().get(this.ambienteId());
    const num = (lab?.codigo.replace(/\D/g, '') || String(this.ambienteId())).replace(/^0+/, '') || String(this.ambienteId());
    const pregunta = this.pcs().length
      ? `¿Cuántas PCs nuevas agregar? Seguirán la numeración (SCPC${num}…).`
      : `¿Cuántas PCs de alumnos tiene este laboratorio? Se crearán SCPC${num}01, SCPC${num}02… y la PCDOCENTE${num}.`;
    const texto = prompt(pregunta, this.pcs().length ? '1' : '30');
    if (texto === null) return;
    const cantidad = Number(texto);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100) {
      this.notificaciones.aviso('Escriba un número entre 1 y 100.');
      return;
    }
    this.generando.set(true);
    try {
      const creadas = await this.supabase.rpc<number>('fn_generar_pcs', { p_ambiente_id: this.ambienteId(), p_cantidad: cantidad });
      await this.catalogos.recargar('ambiente_pcs');
      this.notificaciones.exito(`${creadas} PC(s) creadas.`);
    } catch (e) {
      this.notificaciones.error(e, 'No se generaron');
    } finally {
      this.generando.set(false);
    }
  }

  protected editar(pc: AmbientePc): void {
    this.editando.set(true);
    this.estadoOriginal = pc.estado;
    this.detalle = '';
    this.formulario.set({ ...pc });
  }

  protected async guardar(): Promise<void> {
    const datos = this.formulario();
    if (!datos) return;
    if (!datos.etiqueta?.trim()) {
      this.notificaciones.aviso('Escriba la etiqueta de la PC (ej: PC-01).');
      return;
    }
    const cambia = this.cambiaEstado(datos);
    if (cambia && this.detalle.trim().length < 3) {
      this.notificaciones.aviso(datos.estado === 'operativa' ? 'Escriba qué se reparó.' : 'Escriba el motivo del cambio de estado.');
      return;
    }
    const fila: Record<string, unknown> = {
      ...(datos.id ? { id: datos.id } : {}),
      ambiente_id: this.ambienteId(),
      etiqueta: datos.etiqueta.trim(),
      procesador: datos.procesador?.trim() || null,
      ram: datos.ram?.trim() || null,
      almacenamiento: datos.almacenamiento?.trim() || null,
      notas: datos.notas?.trim() || null,
      orden: datos.orden ?? 0,
      es_docente: !!datos.es_docente,
    };
    this.guardando.set(true);
    try {
      // El estado no se guarda aquí: una PC nueva entra activa y el cambio va por la función (deja ticket)
      if (!datos.id) fila['estado'] = 'operativa';
      const guardada = (await this.catalogos.guardar('ambiente_pcs', fila)) as unknown as { id: number };
      if (cambia) {
        await this.supabase.rpc('rpc_cambiar_estado_pcs', { p_ids: [guardada.id], p_estado: datos.estado, p_detalle: this.detalle.trim(), p_ticket: true });
        await this.catalogos.recargar('ambiente_pcs');
      }
      this.notificaciones.exito('Guardado.');
      this.formulario.set(null);
    } catch (e) {
      this.notificaciones.error(e, 'No se guardó');
    } finally {
      this.guardando.set(false);
    }
  }

  /** Eliminar del inventario: solo admin y encargado (el resto la da de baja) */
  protected async eliminar(pc: AmbientePc): Promise<void> {
    if (!this.auth.puedeGestionarAuxiliares()) {
      this.notificaciones.aviso('Solo el administrador o el encargado pueden eliminar una PC. Si ya no sirve, dala de baja desde el croquis.');
      return;
    }
    if (!confirm(`¿Eliminar ${pc.etiqueta} del inventario?\n\nSe borra para siempre. Si solo ya no funciona, mejor dala de baja (queda el historial).`)) return;
    try {
      await this.catalogos.eliminar('ambiente_pcs', pc.id);
      this.notificaciones.exito('Eliminado.');
    } catch (e) {
      this.notificaciones.error(e, 'No se pudo eliminar');
    }
  }
}
