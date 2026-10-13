import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Software, TipoSoftware } from '../core/modelos';
import { NotificacionesService } from '../core/notificaciones.service';
import { SoftwareService } from '../core/software.service';
import { normalizar } from './buscador.component';
import { IconoComponent } from './icono.component';

/**
 * Elegir uno o varios programas / ISOs del catálogo para un ticket. Si no
 * está en la lista, se agrega al catálogo en el momento.
 */
@Component({
  selector: 'app-selector-software',
  imports: [FormsModule, IconoComponent],
  template: `
    <div class="space-y-2">
      @if (elegidos().length) {
        <div class="flex flex-wrap gap-1.5">
          @for (s of elegidos(); track s.id) {
            <span class="chip gap-1 py-1" [class]="s.tipo === 'iso' ? 'bg-violet-100 text-violet-800' : 'bg-indigo-100 text-indigo-800'">
              {{ s.nombre }}
              <button type="button" class="-mr-1 rounded-full px-1 hover:bg-white/60" (click)="quitar(s.id)" [attr.aria-label]="'Quitar ' + s.nombre">×</button>
            </span>
          }
        </div>
      }

      <div class="flex flex-wrap items-center gap-1.5">
        @for (t of filtrosTipo; track t.valor) {
          <button type="button" class="rounded-full border px-2.5 py-0.5 text-xs transition"
                  [class]="tipo() === t.valor ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-100'"
                  (click)="tipo.set(t.valor)">{{ t.texto }}</button>
        }
      </div>

      <div class="relative">
        <app-icono nombre="buscar" [tamano]="15" class="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
        <input class="campo !pl-9" [ngModel]="texto()" (ngModelChange)="texto.set($event)" maxlength="80"
               [placeholder]="tipo() === 'iso' ? 'Buscar sistema operativo / ISO (ej: Windows 11, Ubuntu)' : 'Buscar programa (ej: Python, SPSS)'"
               aria-label="Buscar software" (keydown.enter)="$event.preventDefault(); elegirPrimero()">
      </div>

      @if (resultados().length) {
        <ul class="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          @for (s of resultados(); track s.id) {
            <li>
              <button type="button" class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50" (click)="agregar(s.id)">
                <span class="min-w-0 flex-1 truncate">{{ s.nombre }}</span>
                <span class="chip" [class]="s.tipo === 'iso' ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-500'">{{ s.tipo === 'iso' ? 'ISO' : s.categoria || 'Programa' }}</span>
              </button>
            </li>
          }
        </ul>
      } @else if (texto().trim().length >= 2) {
        <div class="rounded-lg border border-dashed border-slate-300 p-2 text-sm">
          <p class="mb-1.5 text-slate-500">No está en el catálogo.</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-secundario btn-sm" (click)="crear('programa')" [disabled]="creando()">
              <app-icono nombre="agregar" [tamano]="14" /> Agregar «{{ texto().trim() }}» como programa
            </button>
            <button type="button" class="btn-secundario btn-sm" (click)="crear('iso')" [disabled]="creando()">
              <app-icono nombre="agregar" [tamano]="14" /> Como ISO
            </button>
          </div>
        </div>
      } @else {
        <p class="text-xs text-slate-500">Escribe para buscar en el catálogo de software.</p>
      }
    </div>
  `,
})
export class SelectorSoftwareComponent implements OnInit {
  private readonly sw = inject(SoftwareService);
  private readonly notificaciones = inject(NotificacionesService);

  readonly seleccion = input<number[]>([]);
  readonly seleccionChange = output<number[]>();

  protected readonly filtrosTipo: { valor: TipoSoftware | null; texto: string }[] = [
    { valor: null, texto: 'Todo' }, { valor: 'programa', texto: 'Programas' }, { valor: 'iso', texto: 'Sistemas operativos / ISOs' },
  ];
  protected readonly tipo = signal<TipoSoftware | null>(null);
  protected readonly texto = signal('');
  protected readonly creando = signal(false);

  protected readonly elegidos = computed(() => this.seleccion().map((id) => this.sw.mapa().get(id)).filter((s): s is Software => !!s));

  protected readonly resultados = computed(() => {
    const texto = normalizar(this.texto().trim());
    const elegidos = new Set(this.seleccion());
    const tipo = this.tipo();
    const base = this.sw.activos().filter((s) => !elegidos.has(s.id) && (!tipo || s.tipo === tipo));
    // Sin texto: se listan las ISOs (son pocas); los programas se buscan
    if (!texto) return tipo === 'iso' ? base.slice(0, 50) : [];
    return base.filter((s) => normalizar(`${s.nombre} ${s.categoria ?? ''}`).includes(texto))
      // Primero lo que empieza con el texto
      .sort((a, b) => Number(!normalizar(a.nombre).startsWith(texto)) - Number(!normalizar(b.nombre).startsWith(texto)))
      .slice(0, 12);
  });

  ngOnInit(): void {
    void this.sw.asegurar().catch((e) => this.notificaciones.error(e, 'No se cargó el catálogo de software'));
  }

  protected agregar(id: number): void {
    this.seleccionChange.emit([...this.seleccion(), id]);
    this.texto.set('');
  }

  /** Enter elige el primer resultado (y no envía el formulario del ticket) */
  protected elegirPrimero(): void {
    const primero = this.resultados()[0];
    if (primero) this.agregar(primero.id);
  }

  protected quitar(id: number): void {
    this.seleccionChange.emit(this.seleccion().filter((x) => x !== id));
  }

  /** Agrega al catálogo lo que no estaba (la licencia queda por verificar) */
  protected async crear(tipo: TipoSoftware): Promise<void> {
    const nombre = this.texto().trim();
    this.creando.set(true);
    try {
      const nuevo = await this.sw.guardar({ nombre, tipo, licencia: 'por_verificar' });
      this.agregar(nuevo.id);
      this.notificaciones.exito(`«${nombre}» se agregó al catálogo de software.`);
    } catch (e) {
      this.notificaciones.error(e, 'No se agregó');
    } finally {
      this.creando.set(false);
    }
  }
}
