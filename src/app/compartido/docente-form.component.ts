import { Component, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogosService } from '../core/catalogos.service';
import { Docente } from '../core/modelos';
import { NotificacionesService } from '../core/notificaciones.service';
import { ErrorSistema, SupabaseService } from '../core/supabase.service';
import { normalizar } from './buscador.component';
import { ModalComponent } from './modal.component';

/** Datos editables de un docente en el modal */
export interface FormDocente {
  id: number | null;
  nombres: string;
  apellidos: string;
  carnet: string;
  telefono: string;
  correo: string;
  activo: boolean;
  carreras: number[];
  materias: number[];
}

/** Formulario vacío para un docente nuevo (con lo que ya se sepa) */
export function docenteNuevo(parcial: Partial<FormDocente> = {}): FormDocente {
  return { id: null, nombres: '', apellidos: '', carnet: '', telefono: '', correo: '', activo: true, carreras: [], materias: [], ...parcial };
}

/** Formulario con los datos de un docente existente */
export function docenteAFormulario(d: Docente): FormDocente {
  return {
    id: d.id, nombres: d.nombres, apellidos: d.apellidos, carnet: d.carnet ?? '', telefono: d.telefono ?? '',
    correo: d.correo ?? '', activo: d.activo,
    carreras: (d.docente_carreras ?? []).map((c) => c.carrera_id),
    materias: (d.docente_materias ?? []).map((m) => m.materia_id),
  };
}

/**
 * Modal para crear o editar un docente con sus facultades. Es el mismo en
 * Configuración → Docentes y en el alta rápida del formulario de asignación.
 * Se abre al recibir datos (null = cerrado) y emite el id guardado.
 */
@Component({
  selector: 'app-docente-form',
  imports: [FormsModule, ModalComponent],
  template: `
    <app-modal [abierto]="!!form()" [titulo]="form()?.id ? 'Editar docente' : 'Nuevo docente'" ancho="lg" (cerrar)="cerrar.emit()">
      @if (form(); as f) {
        <form class="grid gap-3 sm:grid-cols-2" id="form-docente" (ngSubmit)="guardar()">
          <div><label class="etiqueta" for="doc-nombres">Nombres *</label><input id="doc-nombres" name="nombres" maxlength="80" class="campo" [(ngModel)]="f.nombres" autocomplete="off"></div>
          <div><label class="etiqueta" for="doc-apellidos">Apellidos *</label><input id="doc-apellidos" name="apellidos" maxlength="80" class="campo" [(ngModel)]="f.apellidos" autocomplete="off"></div>
          <div><label class="etiqueta" for="doc-carnet">Carnet</label><input id="doc-carnet" name="carnet" maxlength="20" class="campo" [(ngModel)]="f.carnet"></div>
          <div><label class="etiqueta" for="doc-telefono">Teléfono</label><input id="doc-telefono" name="telefono" maxlength="20" class="campo" [(ngModel)]="f.telefono"></div>
          <div><label class="etiqueta" for="doc-correo">Correo</label><input id="doc-correo" name="correo" maxlength="120" class="campo" type="email" [(ngModel)]="f.correo"></div>
          <label class="mt-5 flex items-center gap-2 text-sm"><input type="checkbox" name="activo" class="h-4 w-4 accent-marca-600" [(ngModel)]="f.activo"> Activo</label>

          <div class="sm:col-span-2">
            <span class="etiqueta">Facultades</span>
            <div class="flex flex-wrap gap-1.5">
              @for (c of catalogos.carreras(); track c.id) {
                <button type="button" class="rounded-full border px-3 py-1 text-xs font-medium"
                        [class]="f.carreras.includes(c.id) ? 'border-marca-600 bg-marca-600 text-white' : 'border-slate-300 bg-superficie'"
                        (click)="alternarCarrera(c.id)">{{ c.nombre }}</button>
              }
            </div>
          </div>

          @if (f.materias.length) {
            <div class="sm:col-span-2">
              <span class="etiqueta">Materias que dictó <span class="font-normal text-slate-400">(se anotan solas al registrar sus asignaciones)</span></span>
              <div class="flex flex-wrap gap-1.5">
                @for (m of f.materias; track m) {
                  <span class="chip bg-slate-100 text-slate-700">{{ catalogos.mapaMaterias().get(m)?.nombre }}</span>
                }
              </div>
            </div>
          }
        </form>
      }
      <ng-container pie>
        <button type="button" class="btn-secundario" (click)="cerrar.emit()">Cancelar</button>
        <button type="submit" form="form-docente" class="btn-primario" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
      </ng-container>
    </app-modal>
  `,
})
export class DocenteFormComponent {
  protected readonly catalogos = inject(CatalogosService);
  private readonly supabase = inject(SupabaseService);
  private readonly notificaciones = inject(NotificacionesService);

  /** Docente a editar o crear (null = modal cerrado) */
  readonly datos = input<FormDocente | null>(null);
  readonly cerrar = output<void>();
  /** Id del docente guardado (o del que ya existía con ese nombre) */
  readonly guardado = output<number>();

  /** Copia editable de los datos recibidos */
  protected readonly form = linkedSignal(() => {
    const d = this.datos();
    return d ? { ...d, carreras: [...d.carreras], materias: [...d.materias] } : null;
  });
  protected readonly guardando = signal(false);

  protected alternarCarrera(id: number): void {
    this.form.update((f) => f && {
      ...f, carreras: f.carreras.includes(id) ? f.carreras.filter((c) => c !== id) : [...f.carreras, id],
    });
  }

  /** Guarda el docente y sus facultades (las materias se anotan solas desde las asignaciones) */
  protected async guardar(): Promise<void> {
    const f = this.form();
    if (!f || this.guardando()) return;
    const nombres = f.nombres.trim();
    const apellidos = f.apellidos.trim();
    if (!nombres || !apellidos) {
      this.notificaciones.aviso('Nombres y apellidos son obligatorios.');
      return;
    }
    // Uno nuevo con el mismo nombre que otro ya registrado: se usa el existente
    if (!f.id) {
      const existente = this.catalogos.docentes().find((d) => normalizar(`${d.nombres} ${d.apellidos}`) === normalizar(`${nombres} ${apellidos}`));
      if (existente) {
        this.notificaciones.aviso(`${existente.apellidos} ${existente.nombres} ya estaba registrado.`);
        this.guardado.emit(existente.id);
        return;
      }
    }
    this.guardando.set(true);
    try {
      const docente = (await this.catalogos.guardar('docentes', {
        id: f.id, nombres, apellidos, carnet: f.carnet.trim() || null,
        telefono: f.telefono.trim() || null, correo: f.correo.trim() || null, activo: f.activo,
      })) as unknown as { id: number };
      const cliente = this.supabase.cliente;
      // Reemplaza las facultades: borra y vuelve a insertar
      await this.verificar(cliente.from('docente_carreras').delete().eq('docente_id', docente.id));
      if (f.carreras.length) {
        await this.verificar(cliente.from('docente_carreras').insert(f.carreras.map((carrera_id) => ({ docente_id: docente.id, carrera_id }))));
      }
      await this.catalogos.recargar('docentes');
      this.notificaciones.exito(f.id ? 'Docente guardado.' : `Docente ${apellidos} ${nombres} agregado.`);
      this.guardado.emit(docente.id);
    } catch (e) {
      this.notificaciones.error(e, 'No se guardó el docente');
    } finally {
      this.guardando.set(false);
    }
  }

  /** Lanza error si la operación de Supabase falló */
  private async verificar(operacion: PromiseLike<{ error: unknown }>): Promise<void> {
    const { error } = await operacion;
    if (error) throw new ErrorSistema(error as { message: string });
  }
}
