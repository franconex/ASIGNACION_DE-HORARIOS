import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BuscadorComponent, OpcionBuscador } from '../../compartido/buscador.component';
import { IconoComponent } from '../../compartido/icono.component';
import { ModalComponent } from '../../compartido/modal.component';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { Docente } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { ErrorSistema, SupabaseService } from '../../core/supabase.service';

/** Datos editables de un docente en el modal */
interface FormDocente {
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

/**
 * Catálogo de docentes con sus carreras (una o varias)
 * y las materias que puede dictar.
 */
@Component({
  selector: 'app-docentes',
  imports: [FormsModule, ModalComponent, BuscadorComponent, IconoComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">Docentes</h2>
        <p class="text-sm text-slate-500">Un docente puede pertenecer a varias carreras y dictar varias materias.</p>
      </div>
      <div class="flex gap-2">
        <select class="campo !w-48" [ngModel]="carreraFiltro()" (ngModelChange)="carreraFiltro.set(+$event)">
          <option [ngValue]="0">Todas las carreras</option>
          @for (c of catalogos.carreras(); track c.id) { <option [ngValue]="c.id">{{ c.nombre }}</option> }
        </select>
        <input maxlength="60" class="campo !w-60" placeholder="Buscar…" [ngModel]="busqueda()" (ngModelChange)="busqueda.set($event)">
        @if (auth.puedeEditar()) { <button class="btn-primario" (click)="nuevo()"><app-icono nombre="agregar" [tamano]="16" /> Nuevo docente</button> }
      </div>
    </div>

    <div class="tarjeta overflow-x-auto">
      <table class="tabla">
        <thead><tr><th>Docente</th><th>Carnet</th><th>Contacto</th><th>Facultades</th><th>Materias</th><th></th></tr></thead>
        <tbody>
          @for (d of filtrados(); track d.id) {
            <tr [class.opacity-50]="!d.activo">
              <td class="font-medium">{{ d.apellidos }} {{ d.nombres }} @if (!d.activo) { <span class="chip bg-slate-200">inactivo</span> }</td>
              <td>{{ d.carnet }}</td>
              <td class="text-xs text-slate-500">{{ d.telefono }}<br>{{ d.correo }}</td>
              <td>
                <div class="flex flex-wrap gap-1">
                  @for (c of d.docente_carreras ?? []; track c.carrera_id) {
                    <span class="chip" [style.background]="colorCarrera(c.carrera_id) + '22'" [style.color]="colorCarrera(c.carrera_id)">{{ siglaCarrera(c.carrera_id) }}</span>
                  }
                </div>
              </td>
              <td class="max-w-xs text-xs text-slate-600">{{ textoMaterias(d) }}</td>
              <td class="text-right whitespace-nowrap">
                @if (auth.puedeEditar()) {
                  <button class="btn-fantasma btn-sm" (click)="editar(d)" title="Editar"><app-icono nombre="editar" [tamano]="16" /></button>
                  <button class="btn-fantasma btn-sm text-red-600" (click)="eliminar(d)" title="Eliminar"><app-icono nombre="eliminar" [tamano]="16" /></button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="py-8 text-center text-slate-500">Sin docentes.</td></tr>
          }
        </tbody>
      </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">{{ filtrados().length }} docente(s)</p>

    <app-modal [abierto]="!!form()" [titulo]="form()?.id ? 'Editar docente' : 'Nuevo docente'" ancho="lg" (cerrar)="form.set(null)">
      @if (form(); as f) {
        <div class="grid gap-3 sm:grid-cols-2">
          <div><label class="etiqueta">Nombres *</label><input maxlength="80" class="campo" [(ngModel)]="f.nombres"></div>
          <div><label class="etiqueta">Apellidos *</label><input maxlength="80" class="campo" [(ngModel)]="f.apellidos"></div>
          <div><label class="etiqueta">Carnet</label><input maxlength="20" class="campo" [(ngModel)]="f.carnet"></div>
          <div><label class="etiqueta">Teléfono</label><input maxlength="20" class="campo" [(ngModel)]="f.telefono"></div>
          <div><label class="etiqueta">Correo</label><input maxlength="120" class="campo" type="email" [(ngModel)]="f.correo"></div>
          <label class="mt-5 flex items-center gap-2 text-sm"><input type="checkbox" class="h-4 w-4 accent-marca-600" [(ngModel)]="f.activo"> Activo</label>

          <div class="sm:col-span-2">
            <label class="etiqueta">Facultades</label>
            <div class="flex flex-wrap gap-1.5">
              @for (c of catalogos.carreras(); track c.id) {
                <button type="button" class="rounded-full border px-3 py-1 text-xs font-medium"
                        [class]="f.carreras.includes(c.id) ? 'border-marca-600 bg-marca-600 text-white' : 'border-slate-300 bg-superficie'"
                        (click)="alternar(f.carreras, c.id)">{{ c.nombre }}</button>
              }
            </div>
          </div>

          <div class="sm:col-span-2">
            <label class="etiqueta">Materias que puede dictar</label>
            <app-buscador [opciones]="opcionesMaterias()" [valor]="null" (valorChange)="agregarMateria($event)"
                          placeholder="Buscar y agregar materia" [permitirCrear]="true" (crear)="crearMateria($event)" />
            <div class="mt-2 flex flex-wrap gap-1.5">
              @for (m of f.materias; track m) {
                <span class="chip bg-marca-50 text-marca-700">
                  {{ catalogos.mapaMaterias().get(m)?.nombre }}
                  <button type="button" class="ml-1 opacity-60 hover:opacity-100" (click)="alternar(f.materias, m)"><app-icono nombre="cerrar" [tamano]="12" /></button>
                </span>
              } @empty { <span class="text-xs text-slate-400">Ninguna todavía (se agregan solas al crear asignaciones).</span> }
            </div>
          </div>
        </div>
      }
      <ng-container pie>
        <button class="btn-secundario" (click)="form.set(null)">Cancelar</button>
        <button class="btn-primario" (click)="guardar()" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
      </ng-container>
    </app-modal>
  `,
})
export class DocentesComponent {
  protected readonly auth = inject(AuthService);
  protected readonly catalogos = inject(CatalogosService);
  private readonly supabase = inject(SupabaseService);
  private readonly notificaciones = inject(NotificacionesService);

  protected readonly busqueda = signal('');
  protected readonly carreraFiltro = signal(0);
  protected readonly form = signal<FormDocente | null>(null);
  protected readonly guardando = signal(false);

  protected readonly filtrados = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    return this.catalogos.docentes().filter((d) =>
      (!this.carreraFiltro() || (d.docente_carreras ?? []).some((c) => c.carrera_id === this.carreraFiltro())) &&
      (!texto || `${d.apellidos} ${d.nombres} ${d.carnet ?? ''}`.toLowerCase().includes(texto)));
  });

  protected readonly opcionesMaterias = computed<OpcionBuscador[]>(() =>
    this.catalogos.materias().map((m) => ({ id: m.id, texto: m.nombre })));

  protected colorCarrera(id: number): string {
    return this.catalogos.mapaCarreras().get(id)?.color ?? '#64748b';
  }

  protected siglaCarrera(id: number): string {
    const c = this.catalogos.mapaCarreras().get(id);
    return c?.sigla || c?.nombre || '';
  }

  protected textoMaterias(d: Docente): string {
    return (d.docente_materias ?? []).map((m) => this.catalogos.mapaMaterias().get(m.materia_id)?.nombre).filter(Boolean).join(', ');
  }

  /** Agrega o quita un id de una lista (en el formulario) */
  protected alternar(lista: number[], id: number): void {
    const i = lista.indexOf(id);
    if (i >= 0) lista.splice(i, 1);
    else lista.push(id);
    this.form.update((f) => (f ? { ...f } : f));
  }

  protected agregarMateria(id: number | null): void {
    const f = this.form();
    if (id && f && !f.materias.includes(id)) this.alternar(f.materias, id);
  }

  protected async crearMateria(nombre: string): Promise<void> {
    try {
      const materia = (await this.catalogos.guardar('materias', { nombre })) as unknown as { id: number };
      this.agregarMateria(materia.id);
    } catch (e) {
      this.notificaciones.error(e);
    }
  }

  protected nuevo(): void {
    this.form.set({ id: null, nombres: '', apellidos: '', carnet: '', telefono: '', correo: '', activo: true, carreras: [], materias: [] });
  }

  protected editar(d: Docente): void {
    this.form.set({
      id: d.id, nombres: d.nombres, apellidos: d.apellidos, carnet: d.carnet ?? '', telefono: d.telefono ?? '',
      correo: d.correo ?? '', activo: d.activo,
      carreras: (d.docente_carreras ?? []).map((c) => c.carrera_id),
      materias: (d.docente_materias ?? []).map((m) => m.materia_id),
    });
  }

  /** Guarda el docente y sincroniza sus carreras y materias */
  protected async guardar(): Promise<void> {
    const f = this.form();
    if (!f) return;
    if (!f.nombres.trim() || !f.apellidos.trim()) {
      this.notificaciones.aviso('Nombres y apellidos son obligatorios.');
      return;
    }
    this.guardando.set(true);
    try {
      const docente = (await this.catalogos.guardar('docentes', {
        id: f.id, nombres: f.nombres.trim(), apellidos: f.apellidos.trim(), carnet: f.carnet.trim() || null,
        telefono: f.telefono.trim() || null, correo: f.correo.trim() || null, activo: f.activo,
      })) as unknown as { id: number };
      const cliente = this.supabase.cliente;
      // Reemplaza relaciones: borra y vuelve a insertar
      await this.verificar(cliente.from('docente_carreras').delete().eq('docente_id', docente.id));
      await this.verificar(cliente.from('docente_materias').delete().eq('docente_id', docente.id));
      if (f.carreras.length) {
        await this.verificar(cliente.from('docente_carreras').insert(f.carreras.map((carrera_id) => ({ docente_id: docente.id, carrera_id }))));
      }
      if (f.materias.length) {
        await this.verificar(cliente.from('docente_materias').insert(f.materias.map((materia_id) => ({ docente_id: docente.id, materia_id }))));
      }
      await this.catalogos.recargar('docentes');
      this.notificaciones.exito('Docente guardado.');
      this.form.set(null);
    } catch (e) {
      this.notificaciones.error(e, 'No se guardó');
    } finally {
      this.guardando.set(false);
    }
  }

  protected async eliminar(d: Docente): Promise<void> {
    if (!confirm(`¿Eliminar a ${d.apellidos} ${d.nombres}? Si tiene asignaciones, desactívelo en lugar de eliminarlo.`)) return;
    try {
      await this.catalogos.eliminar('docentes', d.id);
      this.notificaciones.exito('Docente eliminado.');
    } catch (e) {
      this.notificaciones.error(e, 'No se pudo eliminar (¿tiene asignaciones?). Puede marcarlo como inactivo');
    }
  }

  /** Lanza error si la operación de Supabase falló */
  private async verificar(operacion: PromiseLike<{ error: unknown }>): Promise<void> {
    const { error } = await operacion;
    if (error) throw new ErrorSistema(error as { message: string });
  }
}
