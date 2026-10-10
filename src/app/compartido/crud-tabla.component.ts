import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { CatalogosService, TablaCatalogo } from '../core/catalogos.service';
import { NotificacionesService } from '../core/notificaciones.service';
import { ConfirmacionService } from '../core/confirmacion.service';
import { IconoComponent } from './icono.component';
import { ModalComponent } from './modal.component';

/** Definición de un campo del formulario */
export interface CampoCrud {
  clave: string;
  etiqueta: string;
  tipo: 'texto' | 'numero' | 'color' | 'select' | 'check' | 'fecha' | 'textarea';
  opciones?: { valor: string | number; texto: string }[];
  requerido?: boolean;
  /** Ocupa las dos columnas del formulario */
  completo?: boolean;
  /** No se puede cambiar al editar (ej. clave primaria) */
  soloAlCrear?: boolean;
  ayuda?: string;
}

/** Definición de una columna de la tabla */
export interface ColumnaCrud {
  clave: string;
  etiqueta: string;
  tipo?: 'texto' | 'color' | 'check' | 'chip';
  /** Texto a mostrar (por defecto el valor del campo) */
  formato?: (fila: Record<string, unknown>) => string;
}

/**
 * Tabla CRUD genérica para catálogos simples (carreras, materias, ambientes, feriados).
 * Lista con búsqueda + modal de alta/edición + eliminación.
 */
@Component({
  selector: 'app-crud-tabla',
  imports: [FormsModule, ModalComponent, IconoComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">{{ titulo() }}</h2>
        @if (descripcion()) { <p class="text-sm text-slate-500">{{ descripcion() }}</p> }
      </div>
      <div class="flex w-full flex-wrap gap-2 sm:w-auto">
        <input maxlength="60" class="campo min-w-0 flex-1 sm:!w-60 sm:flex-none" placeholder="Buscar…" [ngModel]="busqueda()" (ngModelChange)="busqueda.set($event)">
        @if (auth.puedeEditar()) { <button class="btn-primario" (click)="nuevo()"><app-icono nombre="agregar" [tamano]="16" /> Nuevo</button> }
      </div>
    </div>

    <div class="tarjeta overflow-x-auto">
      <table class="tabla">
        <thead>
          <tr>
            @for (c of columnas(); track c.clave) {
              <th [attr.aria-sort]="orden()?.clave === c.clave ? (orden()!.asc ? 'ascending' : 'descending') : null">
                <button type="button" class="inline-flex items-center gap-1 hover:text-slate-800" (click)="ordenarPor(c.clave)" [title]="'Ordenar por ' + c.etiqueta">
                  {{ c.etiqueta }}
                  @if (orden()?.clave === c.clave) { <app-icono [nombre]="orden()!.asc ? 'arriba' : 'abajo'" [tamano]="13" /> }
                </button>
              </th>
            }
            <th class="w-32"></th>
          </tr>
        </thead>
        <tbody>
          @for (fila of filtradas(); track fila[clavePrimaria()]) {
            <tr>
              @for (c of columnas(); track c.clave) {
                <td>
                  @switch (c.tipo) {
                    @case ('color') { <span class="inline-block h-4 w-8 rounded" [style.background]="fila[c.clave]"></span> }
                    @case ('check') { <span [class]="fila[c.clave] ? 'text-emerald-600' : 'text-slate-300'"><app-icono [nombre]="fila[c.clave] ? 'check' : 'cerrar'" [tamano]="16" /></span> }
                    @case ('chip') { <span class="chip bg-slate-100 text-slate-700">{{ texto(fila, c) }}</span> }
                    @default { {{ texto(fila, c) }} }
                  }
                </td>
              }
              <td class="text-right whitespace-nowrap">
                @if (auth.puedeEditar()) {
                  <button class="btn-fantasma btn-sm" (click)="editar(fila)" title="Editar"><app-icono nombre="editar" [tamano]="16" /></button>
                  <button class="btn-fantasma btn-sm text-red-600" (click)="eliminar(fila)" title="Eliminar"><app-icono nombre="eliminar" [tamano]="16" /></button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td [attr.colspan]="columnas().length + 1" class="py-8 text-center text-slate-500">Sin registros.</td></tr>
          }
        </tbody>
      </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">{{ filtradas().length }} registro(s)</p>

    <app-modal [abierto]="!!formulario()" [titulo]="editando() ? 'Editar' : 'Nuevo registro'" (cerrar)="formulario.set(null)">
      @if (formulario(); as f) {
        <form class="grid gap-3 sm:grid-cols-2" (ngSubmit)="guardar()" id="form-crud">
          @for (campo of campos(); track campo.clave) {
            <div [class.sm:col-span-2]="campo.completo || campo.tipo === 'textarea'">
              @if (campo.tipo === 'check') {
                <label class="mt-5 flex items-center gap-2 text-sm">
                  <input type="checkbox" class="h-4 w-4 accent-marca-600" [(ngModel)]="f[campo.clave]" [name]="campo.clave"> {{ campo.etiqueta }}
                </label>
              } @else {
                <label class="etiqueta">{{ campo.etiqueta }}{{ campo.requerido ? ' *' : '' }}</label>
                @switch (campo.tipo) {
                  @case ('select') {
                    <select class="campo" [(ngModel)]="f[campo.clave]" [name]="campo.clave">
                      @for (o of campo.opciones ?? []; track o.valor) { <option [ngValue]="o.valor">{{ o.texto }}</option> }
                    </select>
                  }
                  @case ('numero') { <input type="number" class="campo" [(ngModel)]="f[campo.clave]" [name]="campo.clave"> }
                  @case ('color') { <input type="color" class="h-10 w-full cursor-pointer rounded-lg border border-slate-300" [(ngModel)]="f[campo.clave]" [name]="campo.clave"> }
                  @case ('fecha') { <input type="date" class="campo" [(ngModel)]="f[campo.clave]" [name]="campo.clave" [disabled]="!!campo.soloAlCrear && editando()"> }
                  @case ('textarea') { <textarea maxlength="500" class="campo" rows="3" [(ngModel)]="f[campo.clave]" [name]="campo.clave"></textarea> }
                  @default { <input maxlength="120" class="campo" [(ngModel)]="f[campo.clave]" [name]="campo.clave" [disabled]="!!campo.soloAlCrear && editando()"> }
                }
                @if (campo.ayuda) { <p class="mt-1 text-xs text-slate-500">{{ campo.ayuda }}</p> }
              }
            </div>
          }
        </form>
      }
      <ng-container pie>
        <button class="btn-secundario" (click)="formulario.set(null)">Cancelar</button>
        <button class="btn-primario" type="submit" form="form-crud" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
      </ng-container>
    </app-modal>
  `,
})
export class CrudTablaComponent {
  protected readonly auth = inject(AuthService);
  private readonly catalogos = inject(CatalogosService);
  private readonly notificaciones = inject(NotificacionesService);
  private readonly confirmacion = inject(ConfirmacionService);

  readonly titulo = input.required<string>();
  readonly descripcion = input('');
  readonly tabla = input.required<TablaCatalogo>();
  readonly filas = input.required<object[]>();
  readonly campos = input.required<CampoCrud[]>();
  readonly columnas = input.required<ColumnaCrud[]>();
  readonly clavePrimaria = input('id');
  readonly valoresNuevos = input<Record<string, unknown>>({});
  /** true = el catálogo usa su propio modal: la tabla solo avisa que se pidió crear o editar */
  readonly editorPropio = input(false);
  readonly pedirNuevo = output<void>();
  readonly pedirEditar = output<Record<string, unknown>>();

  protected readonly busqueda = signal('');
  protected readonly formulario = signal<Record<string, unknown> | null>(null);
  protected readonly editando = signal(false);
  protected readonly guardando = signal(false);

  /** Columna por la que se ordena (null = el orden en que llegan) */
  protected readonly orden = signal<{ clave: string; asc: boolean } | null>(null);

  /** Filas que contienen el texto buscado en alguna columna, en el orden elegido */
  protected readonly filtradas = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const filas = this.filas() as Record<string, unknown>[];
    const lista = texto ? filas.filter((f) => this.columnas().some((c) => this.texto(f, c).toLowerCase().includes(texto))) : filas;
    const orden = this.orden();
    if (!orden) return lista;
    const signo = orden.asc ? 1 : -1;
    return [...lista].sort((a, b) => {
      const x = a[orden.clave];
      const y = b[orden.clave];
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * signo;
      return String(x ?? '').localeCompare(String(y ?? ''), 'es', { numeric: true }) * signo;
    });
  });

  /** Primer clic: ascendente; segundo: descendente; tercero: sin orden */
  protected ordenarPor(clave: string): void {
    const actual = this.orden();
    if (actual?.clave !== clave) this.orden.set({ clave, asc: true });
    else if (actual.asc) this.orden.set({ clave, asc: false });
    else this.orden.set(null);
  }

  protected texto(fila: Record<string, unknown>, columna: ColumnaCrud): string {
    return columna.formato ? columna.formato(fila) : String(fila[columna.clave] ?? '');
  }

  protected nuevo(): void {
    if (this.editorPropio()) return this.pedirNuevo.emit();
    this.editando.set(false);
    this.formulario.set({ ...this.valoresNuevos() });
  }

  protected editar(fila: Record<string, unknown>): void {
    if (this.editorPropio()) return this.pedirEditar.emit(fila);
    this.editando.set(true);
    this.formulario.set({ ...fila });
  }

  /** Valida requeridos y guarda */
  protected async guardar(): Promise<void> {
    const datos = this.formulario();
    if (!datos) return;
    const faltan = this.campos().filter((c) => c.requerido && (datos[c.clave] === undefined || datos[c.clave] === null || String(datos[c.clave]).trim() === ''));
    if (faltan.length) {
      this.notificaciones.aviso(`Complete: ${faltan.map((c) => c.etiqueta).join(', ')}.`);
      return;
    }
    // Solo se envían los campos del formulario (más la clave)
    const fila: Record<string, unknown> = {};
    for (const c of this.campos()) {
      const valor = datos[c.clave];
      fila[c.clave] = typeof valor === 'string' ? valor.trim() || null : valor;
    }
    if (this.editando() && this.clavePrimaria() === 'id') fila['id'] = datos['id'];
    this.guardando.set(true);
    try {
      await this.catalogos.guardar(this.tabla(), fila, this.clavePrimaria());
      this.notificaciones.exito('Guardado.');
      this.formulario.set(null);
    } catch (e) {
      this.notificaciones.error(e, 'No se guardó');
    } finally {
      this.guardando.set(false);
    }
  }

  protected async eliminar(fila: Record<string, unknown>): Promise<void> {
    if (!(await this.confirmacion.pedir({ titulo: '¿Eliminar este registro?', mensaje: 'Se borrará de la lista.' }))) return;
    try {
      await this.catalogos.eliminar(this.tabla(), fila[this.clavePrimaria()], this.clavePrimaria());
      this.notificaciones.exito('Eliminado.');
    } catch (e) {
      this.notificaciones.error(e, 'No se pudo eliminar');
    }
  }
}
