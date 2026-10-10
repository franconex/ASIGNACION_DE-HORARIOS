import { Component, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogosService } from '../core/catalogos.service';
import { Materia } from '../core/modelos';
import { NotificacionesService } from '../core/notificaciones.service';
import { normalizar } from './buscador.component';
import { ModalComponent } from './modal.component';

/** Datos editables de una materia en el modal */
export interface FormMateria {
  id: number | null;
  nombre: string;
  sigla: string;
  requiere_laboratorio: boolean;
  activo: boolean;
}

/** Formulario para una materia nueva (con el nombre si ya se escribió) */
export function materiaNueva(nombre = ''): FormMateria {
  return { id: null, nombre, sigla: '', requiere_laboratorio: true, activo: true };
}

/** Formulario con los datos de una materia existente */
export function materiaAFormulario(m: Materia): FormMateria {
  return { id: m.id, nombre: m.nombre, sigla: m.sigla ?? '', requiere_laboratorio: m.requiere_laboratorio, activo: m.activo };
}

/**
 * Modal para crear o editar una materia. Es el mismo en Configuración →
 * Materias y en el alta rápida del formulario de asignación.
 * Se abre al recibir datos (null = cerrado) y emite el id guardado.
 */
@Component({
  selector: 'app-materia-form',
  imports: [FormsModule, ModalComponent],
  template: `
    <app-modal [abierto]="!!form()" [titulo]="form()?.id ? 'Editar materia' : 'Nueva materia'" (cerrar)="cerrar.emit()">
      @if (form(); as f) {
        <form class="grid gap-3 sm:grid-cols-2" id="form-materia" (ngSubmit)="guardar()">
          <div class="sm:col-span-2">
            <label class="etiqueta" for="mat-nombre">Nombre *</label>
            <input id="mat-nombre" name="nombre" maxlength="120" class="campo" [(ngModel)]="f.nombre" autocomplete="off">
          </div>
          <div>
            <label class="etiqueta" for="mat-sigla">Sigla</label>
            <input id="mat-sigla" name="sigla" maxlength="120" class="campo" [(ngModel)]="f.sigla">
          </div>
          <div></div>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" name="requiere_laboratorio" class="h-4 w-4 accent-marca-600" [(ngModel)]="f.requiere_laboratorio"> Requiere laboratorio
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" name="activo" class="h-4 w-4 accent-marca-600" [(ngModel)]="f.activo"> Activa
          </label>
        </form>
      }
      <ng-container pie>
        <button type="button" class="btn-secundario" (click)="cerrar.emit()">Cancelar</button>
        <button type="submit" form="form-materia" class="btn-primario" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
      </ng-container>
    </app-modal>
  `,
})
export class MateriaFormComponent {
  private readonly catalogos = inject(CatalogosService);
  private readonly notificaciones = inject(NotificacionesService);

  /** Materia a editar o crear (null = modal cerrado) */
  readonly datos = input<FormMateria | null>(null);
  readonly cerrar = output<void>();
  /** Id de la materia guardada (o de la que ya existía con ese nombre) */
  readonly guardado = output<number>();

  protected readonly form = linkedSignal(() => {
    const d = this.datos();
    return d ? { ...d } : null;
  });
  protected readonly guardando = signal(false);

  protected async guardar(): Promise<void> {
    const f = this.form();
    if (!f || this.guardando()) return;
    const nombre = f.nombre.trim();
    if (!nombre) {
      this.notificaciones.aviso('Escriba el nombre de la materia.');
      return;
    }
    // Otra materia con el mismo nombre (aunque cambien tildes o mayúsculas)
    const existente = this.catalogos.materias().find((m) => m.id !== f.id && normalizar(m.nombre) === normalizar(nombre));
    if (existente) {
      if (f.id) {
        this.notificaciones.aviso(`Ya existe la materia "${existente.nombre}".`);
        return;
      }
      this.notificaciones.aviso(`"${existente.nombre}" ya existía.`);
      this.guardado.emit(existente.id);
      return;
    }
    this.guardando.set(true);
    try {
      const materia = (await this.catalogos.guardar('materias', {
        id: f.id, nombre, sigla: f.sigla.trim() || null, requiere_laboratorio: f.requiere_laboratorio, activo: f.activo,
      })) as unknown as { id: number };
      this.notificaciones.exito(f.id ? 'Materia guardada.' : `Materia "${nombre}" agregada.`);
      this.guardado.emit(materia.id);
    } catch (e) {
      this.notificaciones.error(e, 'No se guardó la materia');
    } finally {
      this.guardando.set(false);
    }
  }
}
