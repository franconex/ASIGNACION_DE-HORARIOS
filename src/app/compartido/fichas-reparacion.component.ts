import { Component, computed, effect, inject, input, OnInit, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogosService } from '../core/catalogos.service';
import { AmbientePc, EstadoPc, FallaPc, FichaReparacion } from '../core/modelos';
import { NotificacionesService } from '../core/notificaciones.service';
import { OperacionService } from '../core/operacion.service';
import { CATEGORIAS_FALLA, PIEZAS_PC } from '../core/tickets';
import { IconoComponent } from './icono.component';

/** Ficha en edición: además, si se eligió "Otra" falla / pieza */
interface FichaEdicion extends FichaReparacion {
  otra: boolean;
  piezaOtra: boolean;
}

const ESTADOS: { valor: EstadoPc; texto: string; clase: string; punto: string }[] = [
  { valor: 'operativa', texto: 'Activa', clase: 'border-emerald-500 bg-emerald-600 text-white', punto: 'bg-emerald-500' },
  { valor: 'mantenimiento', texto: 'Mantenimiento', clase: 'border-amber-500 bg-amber-500 text-white', punto: 'bg-amber-400' },
  { valor: 'inactiva', texto: 'Inactiva', clase: 'border-slate-500 bg-slate-500 text-white dark:border-slate-400 dark:bg-slate-300', punto: 'bg-slate-400' },
  { valor: 'baja', texto: 'De baja', clase: 'border-rose-500 bg-rose-600 text-white', punto: 'bg-rose-500' },
];

/**
 * Ficha de reparación: una tarjeta por PC con sus fallas (del catálogo,
 * varias, o "Otra"), diagnóstico, corrección, pieza cambiada (opcional) y
 * cómo queda la PC. Se usa en el correctivo de Atenciones y al cambiar el
 * estado en el croquis. El que la contiene llama a validar() y datos().
 */
@Component({
  selector: 'app-fichas-reparacion',
  imports: [FormsModule, IconoComponent],
  template: `
    @if (!pcs().length) {
      <p class="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">Marca las PCs en el croquis: aparecerá una ficha por cada una.</p>
    }
    <div class="space-y-2">
      @for (x of lista(); track x.pc.id) {
        @let f = x.f;
        @let error = intentado() ? errorDe(x.pc, f) : null;
        <article class="rounded-xl border-2 transition" [class]="error ? 'border-rose-300' : abierta() === x.pc.id ? 'border-marca-300' : 'border-slate-200'">
          <button type="button" class="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left" (click)="abierta.set(abierta() === x.pc.id ? null : x.pc.id)"
                  [attr.aria-expanded]="abierta() === x.pc.id">
            <span class="font-mono text-sm font-semibold">{{ x.pc.etiqueta }}</span>
            <span class="text-xs text-slate-500">{{ labDe(x.pc) }}</span>
            <span class="inline-flex items-center gap-1 text-xs text-slate-600">
              <span class="h-2.5 w-2.5 rounded-sm" [class]="estado(x.pc.estado).punto"></span>{{ estado(x.pc.estado).texto }}
              @if (f.estado_final && f.estado_final !== x.pc.estado) {
                → <span class="h-2.5 w-2.5 rounded-sm" [class]="estado(f.estado_final).punto"></span>{{ estado(f.estado_final).texto }}
              }
            </span>
            <span class="min-w-0 flex-1 truncate text-xs text-slate-500">{{ resumen(f) }}</span>
            @if (error) { <span class="text-xs font-semibold text-rose-700">Falta completar</span> }
            @else if (intentado()) { <app-icono nombre="check" [tamano]="15" class="text-emerald-600" /> }
            <app-icono [nombre]="abierta() === x.pc.id ? 'arriba' : 'abajo'" [tamano]="15" class="text-slate-400" />
          </button>

          @if (abierta() === x.pc.id) {
            <div class="space-y-3 border-t border-slate-200 px-3 py-3">
              <!-- Fallas -->
              <div>
                <p class="etiqueta">Falla(s) * <span class="font-normal text-slate-400">(puedes elegir varias)</span></p>
                @if (!categoriasConFallas().length) { <p class="mb-1.5 text-xs text-slate-400">Cargando lista de fallas…</p> }
                @for (c of categoriasConFallas(); track c.valor) {
                  <div class="mb-1.5 flex flex-wrap items-center gap-1">
                    <span class="w-full shrink-0 text-[11px] text-slate-400 sm:w-20">{{ c.texto }}</span>
                    @for (falla of c.fallas; track falla.id) {
                      <button type="button" class="rounded-full border px-2.5 py-0.5 text-xs transition"
                              [class]="f.fallas.includes(falla.id) ? 'border-marca-500 bg-marca-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-100'"
                              [attr.aria-pressed]="f.fallas.includes(falla.id)" (click)="alternarFalla(f, falla.id)">{{ falla.nombre }}</button>
                    }
                  </div>
                }
                <div class="flex flex-wrap items-center gap-1.5">
                  <button type="button" class="rounded-full border px-2.5 py-0.5 text-xs transition"
                          [class]="f.otra ? 'border-marca-500 bg-marca-600 text-white' : 'border-dashed border-slate-400 text-slate-600 hover:bg-slate-100'"
                          [attr.aria-pressed]="f.otra" (click)="f.otra = !f.otra">+ Otra…</button>
                  @if (f.otra) {
                    <input class="campo !w-72 !py-1 text-sm" maxlength="120" [ngModelOptions]="{ standalone: true }" [(ngModel)]="f.falla_otra" placeholder="Ej: cable HDMI suelto" aria-label="Otra falla">
                  }
                </div>
              </div>

              <div>
                <label class="etiqueta" [attr.for]="'diag-' + x.pc.id">Diagnóstico <span class="font-normal text-slate-400">(qué se encontró)</span></label>
                <input [id]="'diag-' + x.pc.id" class="campo" maxlength="300" [ngModelOptions]="{ standalone: true }" [(ngModel)]="f.diagnostico" placeholder="Ej: la fuente no entrega voltaje">
              </div>

              <!-- Estado final -->
              <div>
                <p class="etiqueta">¿Cómo queda la PC? *</p>
                <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  @for (e of estados; track e.valor) {
                    <button type="button" class="rounded-lg border-2 px-2 py-1 text-sm font-medium transition"
                            [class]="f.estado_final === e.valor ? e.clase : 'border-slate-200 hover:border-slate-300'"
                            [attr.aria-pressed]="f.estado_final === e.valor" (click)="f.estado_final = e.valor">
                      {{ e.texto }}@if (e.valor === x.pc.estado) { <span class="text-[10px] opacity-70"> · ahora</span> }
                    </button>
                  }
                </div>
              </div>

              <div>
                <label class="etiqueta" [attr.for]="'corr-' + x.pc.id">{{ etiquetaCorreccion(f) }}</label>
                <textarea [id]="'corr-' + x.pc.id" class="campo" rows="2" maxlength="1000" [ngModelOptions]="{ standalone: true }" [(ngModel)]="f.correccion" [placeholder]="ejemploCorreccion(f)"></textarea>
              </div>

              <!-- Pieza (opcional) -->
              <div class="flex flex-wrap items-end gap-2">
                <div>
                  <label class="etiqueta" [attr.for]="'pieza-' + x.pc.id">Pieza cambiada <span class="font-normal text-slate-400">(opcional)</span></label>
                  <select [id]="'pieza-' + x.pc.id" class="campo !w-48" [ngModelOptions]="{ standalone: true }" [ngModel]="f.piezaOtra ? '__otra' : f.pieza" (ngModelChange)="elegirPieza(f, $event)">
                    <option value="">Ninguna</option>
                    @for (p of piezas; track p) { <option [value]="p">{{ p }}</option> }
                    <option value="__otra">Otra…</option>
                  </select>
                </div>
                @if (f.piezaOtra) {
                  <input class="campo !w-56" maxlength="60" [ngModelOptions]="{ standalone: true }" [(ngModel)]="f.pieza" placeholder="¿Qué pieza?" aria-label="Otra pieza">
                }
              </div>

              @if (error) {
                <p class="flex items-center gap-1.5 text-sm text-rose-700"><app-icono nombre="alerta" [tamano]="15" /> {{ error }}</p>
              }
              @if (pcs().length > 1) {
                <button type="button" class="btn-secundario btn-sm" (click)="copiarATodas(x.pc.id)">
                  <app-icono nombre="copiar" [tamano]="14" /> Copiar esta ficha {{ pcs().length === 2 ? 'a la otra PC' : 'a las otras ' + (pcs().length - 1) + ' PCs' }}
                </button>
              }
            </div>
          }
        </article>
      }
    </div>
  `,
})
export class FichasReparacionComponent implements OnInit {
  readonly pcs = input.required<AmbientePc[]>();
  /** Estado final con que empieza cada ficha nueva (ej. 'baja' al dar de baja) */
  readonly estadoInicial = input<EstadoPc | null>(null);

  private readonly op = inject(OperacionService);
  private readonly catalogos = inject(CatalogosService);
  private readonly notificaciones = inject(NotificacionesService);

  protected readonly estados = ESTADOS;
  protected readonly piezas = PIEZAS_PC;
  /** Fichas por PC: se conservan si la PC se desmarca y se vuelve a marcar */
  private readonly porPc = signal<Map<number, FichaEdicion>>(new Map());
  protected readonly abierta = signal<number | null>(null);
  /** Después de intentar guardar se muestran los errores de cada ficha */
  protected readonly intentado = signal(false);

  protected readonly lista = computed(() => {
    const mapa = this.porPc();
    return this.pcs().filter((pc) => mapa.has(pc.id)).map((pc) => ({ pc, f: mapa.get(pc.id)! }));
  });
  /** Fallas activas agrupadas por categoría */
  protected readonly categoriasConFallas = computed(() =>
    CATEGORIAS_FALLA.map((c) => ({ ...c, fallas: this.op.fallas().filter((f) => f.activo && f.categoria === c.valor) }))
      .filter((c) => c.fallas.length));

  constructor() {
    // Una ficha nueva por cada PC marcada; la primera se abre sola
    effect(() => {
      const pcs = this.pcs();
      const inicial = this.estadoInicial();
      untracked(() => {
        const mapa = new Map(this.porPc());
        let cambio = false;
        for (const pc of pcs) {
          if (!mapa.has(pc.id)) {
            mapa.set(pc.id, this.nueva(pc.id, inicial));
            cambio = true;
          }
        }
        if (cambio) this.porPc.set(mapa);
        const abierta = this.abierta();
        if (pcs.length && (abierta === null || !pcs.some((pc) => pc.id === abierta))) this.abierta.set(pcs[0].id);
      });
    });
  }

  ngOnInit(): void {
    if (!this.op.fallas().length) {
      this.op.cargarFallas().catch((e) => this.notificaciones.error(e, 'No se cargó la lista de fallas'));
    }
  }

  private nueva(pcId: number, estado: EstadoPc | null): FichaEdicion {
    return { pc_id: pcId, fallas: [], falla_otra: '', diagnostico: '', correccion: '', pieza: '', estado_final: estado, otra: false, piezaOtra: false };
  }

  /** Revisa todas las fichas; abre la primera con error y devuelve el aviso (o null) */
  validar(): string | null {
    this.intentado.set(true);
    if (!this.lista().length) return 'Marca al menos una PC en el croquis.';
    for (const { pc, f } of this.lista()) {
      const error = this.errorDe(pc, f);
      if (error) {
        this.abierta.set(pc.id);
        return `${pc.etiqueta}: ${error}`;
      }
    }
    return null;
  }

  /** Fichas listas para guardar, en el orden de las PCs */
  datos(): FichaReparacion[] {
    return this.lista().map(({ f }) => ({
      pc_id: f.pc_id,
      fallas: f.fallas,
      falla_otra: f.otra ? f.falla_otra.trim() : '',
      diagnostico: f.diagnostico.trim(),
      correccion: f.correccion.trim(),
      pieza: f.pieza.trim(),
      estado_final: f.estado_final,
    }));
  }

  /** Mismas reglas que rpc_registrar_reparaciones */
  protected errorDe(pc: AmbientePc, f: FichaEdicion): string | null {
    const otra = f.otra ? f.falla_otra.trim() : '';
    if (!f.fallas.length && !otra) return 'Elige al menos una falla (o escribe la falla en "Otra").';
    if (f.otra && otra.length < 3) return 'Describe la otra falla (al menos 3 letras).';
    if (!f.estado_final) return 'Elige cómo queda la PC.';
    const corr = f.correccion.trim().length;
    if (f.estado_final === 'operativa' && corr < 3) return 'Escribe qué se corrigió para dejarla Activa.';
    if (f.estado_final === 'baja' && corr < 3) return 'Escribe el motivo de la baja.';
    if (f.piezaOtra && f.pieza.trim().length < 2) return 'Escribe qué pieza se cambió (o elige "Ninguna").';
    void pc;
    return null;
  }

  protected alternarFalla(f: FichaEdicion, id: number): void {
    f.fallas = f.fallas.includes(id) ? f.fallas.filter((x) => x !== id) : [...f.fallas, id];
  }

  protected elegirPieza(f: FichaEdicion, valor: string): void {
    f.piezaOtra = valor === '__otra';
    f.pieza = f.piezaOtra ? '' : valor;
  }

  protected copiarATodas(origenId: number): void {
    const mapa = this.porPc();
    const o = mapa.get(origenId);
    if (!o) return;
    const nuevo = new Map(mapa);
    for (const pc of this.pcs()) {
      if (pc.id !== origenId) nuevo.set(pc.id, { ...o, pc_id: pc.id, fallas: [...o.fallas] });
    }
    this.porPc.set(nuevo);
    const otras = this.pcs().length - 1;
    this.notificaciones.exito(`Ficha copiada a ${otras === 1 ? 'la otra PC' : otras + ' PCs'}. Revisa la que sea distinta.`);
  }

  protected estado(e: EstadoPc) {
    return ESTADOS.find((x) => x.valor === e)!;
  }

  protected labDe(pc: AmbientePc): string {
    return this.catalogos.laboratorios().find((l) => l.id === pc.ambiente_id)?.codigo ?? '';
  }

  /** "No enciende, Fuente…" para la cabecera de la ficha cerrada */
  protected resumen(f: FichaEdicion): string {
    const nombres = this.op.fallas().filter((x: FallaPc) => f.fallas.includes(x.id)).map((x) => x.nombre);
    if (f.otra && f.falla_otra.trim()) nombres.push(f.falla_otra.trim());
    return nombres.join(', ');
  }

  protected etiquetaCorreccion(f: FichaEdicion): string {
    if (f.estado_final === 'baja') return 'Motivo de la baja *';
    if (f.estado_final === 'operativa') return 'Qué se corrigió *';
    return 'Qué se hizo';
  }

  protected ejemploCorreccion(f: FichaEdicion): string {
    if (f.estado_final === 'baja') return 'Ej: placa madre quemada, no tiene reparación';
    if (f.estado_final === 'operativa') return 'Ej: se cambió la fuente por una de 500 W';
    return 'Ej: se pidió el repuesto, queda en revisión';
  }
}
