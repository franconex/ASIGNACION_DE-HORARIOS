import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { AgentePcsService } from '../core/agente-pcs.service';
import { CatalogosService } from '../core/catalogos.service';
import { exportarPdf, SeccionPdf } from '../core/exportar-pdf';
import { cabeceraHoja, escaparHtml, FIRMAS_HOJA, imprimirDocumento, TEXTOS_ESTADO_PC } from '../core/impresion';
import { NotificacionesService } from '../core/notificaciones.service';
import { AmbientePc, ComponentePc, ConexionPc, EquipoPc, EstadoPc } from '../core/modelos';
import { IconoComponent } from './icono.component';
import { ModalComponent } from './modal.component';

/** Color del chip de cada estado de PC */
const CLASES_ESTADO: Record<EstadoPc, string> = {
  operativa: 'bg-emerald-50 text-emerald-700',
  inactiva: 'bg-slate-200 text-slate-600',
  mantenimiento: 'bg-amber-50 text-amber-800',
  baja: 'bg-rose-50 text-rose-700',
};

/** Texto y colores del chip de conexión */
const CONEXIONES: Record<ConexionPc, { texto: string; chip: string; punto: string }> = {
  prendida: { texto: 'Prendida', chip: 'bg-emerald-50 text-emerald-700', punto: 'bg-emerald-500' },
  apagada: { texto: 'Apagada', chip: 'bg-slate-200 text-slate-700', punto: 'bg-slate-700' },
  sin_agente: { texto: 'Sin agente', chip: 'bg-slate-100 text-slate-500', punto: 'bg-slate-400' },
};

/**
 * Ventana "Propiedades" de una figurita (diseño A, ficha clásica): lo que
 * reportó el agente de inventario, ordenado por secciones. En el celular
 * ocupa toda la pantalla con los botones abajo (lo hace app-modal).
 * Si la PC aún no tiene el agente, muestra lo cargado a mano.
 */
@Component({
  selector: 'app-componentes-pc',
  imports: [ModalComponent, IconoComponent, DatePipe, DecimalPipe],
  template: `
    <app-modal [abierto]="!!pc()" [titulo]="'Propiedades · ' + (pc()?.etiqueta ?? '')" ancho="lg" [cerrarConFondo]="true" (cerrar)="cerrar.emit()">
      @if (pc(); as p) {
        <!-- Encabezado: dónde está y cómo está -->
        <div class="mb-4 flex flex-wrap items-center gap-3">
          <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-marca-50 text-marca-700"><app-icono nombre="laboratorio" [tamano]="22" /></span>
          <div class="min-w-0 flex-1">
            <p class="font-semibold">{{ ubicacion() }}</p>
            <p class="truncate text-sm text-slate-500">{{ datos() ? texto(datos()!.equipo.fabricante, datos()!.equipo.modelo, ' ') : 'Datos cargados a mano' }}</p>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <span class="chip inline-flex items-center gap-1.5" [class]="conexiones[conexion()].chip">
              <span class="h-2 w-2 rounded-full" [class]="conexiones[conexion()].punto"></span>{{ conexiones[conexion()].texto }}
            </span>
            <span class="chip" [class]="clasesEstado[p.estado]">{{ textosEstado[p.estado] }}</span>
          </div>
        </div>

        @if (cargando()) {
          <p class="py-8 text-center text-sm text-slate-500">Cargando…</p>
        } @else if (datos(); as d) {
          <div class="mb-3 flex flex-wrap gap-1.5 text-xs">
            @if (d.equipo.en_dominio) {
              <span class="chip bg-emerald-50 text-emerald-700">Dominio {{ d.equipo.dominio }}</span>
            } @else {
              <span class="chip bg-amber-50 text-amber-800">Fuera del dominio</span>
            }
            <span class="chip bg-slate-100 text-slate-600">Inventario {{ d.equipo.inventario_en | date: 'dd/MM/yyyy HH:mm' }} · agente {{ d.equipo.version_agente }}</span>
          </div>

          <!-- Datos generales -->
          <dl class="grid gap-x-6 gap-y-3 rounded-lg bg-slate-50 p-3.5 text-sm sm:grid-cols-2">
            <div><dt class="text-xs text-slate-500">N.º de serie</dt><dd class="font-mono font-semibold">{{ d.equipo.numero_serie || '—' }}</dd></div>
            <div><dt class="text-xs text-slate-500">Windows</dt><dd class="font-semibold">{{ texto(d.equipo.sistema_operativo, d.equipo.arquitectura) }}</dd></div>
            <div class="sm:col-span-2"><dt class="text-xs text-slate-500">Procesador</dt>
              <dd class="font-semibold">{{ d.equipo.procesador || '—' }}@if (d.equipo.nucleos) { <span class="font-normal text-slate-500"> · {{ d.equipo.nucleos }} núcleos / {{ d.equipo.hilos }} hilos</span> }</dd></div>
            <div><dt class="text-xs text-slate-500">Placa madre</dt><dd class="font-semibold">{{ texto(d.equipo.placa_fabricante, d.equipo.placa_modelo, ' ') }}</dd></div>
            <div><dt class="text-xs text-slate-500">Red</dt><dd class="font-mono font-semibold">{{ d.equipo.ip || '—' }}</dd></div>
          </dl>

          <!-- RAM por módulo -->
          @if (grupo('ram').length) {
            <h3 class="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Memoria RAM{{ d.equipo.memoria_total_gb ? ' · ' + (d.equipo.memoria_total_gb | number: '1.0-1') + ' GB' : '' }}
            </h3>
            <div class="space-y-1">
              @for (c of grupo('ram'); track c.id) {
                <div class="flex flex-wrap items-baseline justify-between gap-x-3 rounded-md border border-slate-200 px-3 py-2 text-sm">
                  <span>@if (c.ranura) { <b>{{ c.ranura }}</b> · } {{ capacidad(c.capacidad_gb) }} {{ c.fabricante }} {{ c.descripcion }}</span>
                  <span class="text-xs text-slate-500">{{ c.detalle }}</span>
                </div>
              }
            </div>
          }

          <!-- Discos y video lado a lado (uno debajo del otro en el celular) -->
          <div class="mt-4 grid gap-4 sm:grid-cols-2">
            @for (g of [{ tipo: 'disco', titulo: 'Disco' }, { tipo: 'video', titulo: 'Video' }]; track g.tipo) {
              @if (grupo(g.tipo).length) {
                <div>
                  <h3 class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{{ g.titulo }}</h3>
                  <div class="space-y-1">
                    @for (c of grupo(g.tipo); track c.id) {
                      <div class="rounded-md border border-slate-200 px-3 py-2 text-sm">
                        <b>{{ c.capacidad_gb ? capacidad(c.capacidad_gb) : c.descripcion }}</b>@if (c.capacidad_gb) { · {{ c.descripcion }} }
                        @if (c.detalle) { <br><span class="text-xs text-slate-500">{{ c.detalle }}</span> }
                      </div>
                    }
                  </div>
                </div>
              }
            }
          </div>

          <!-- Red -->
          @if (grupo('red').length) {
            <h3 class="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Red</h3>
            <div class="space-y-1">
              @for (c of grupo('red'); track c.id) {
                <div class="rounded-md border border-slate-200 px-3 py-2 text-sm"><b>{{ c.descripcion }}</b><br><span class="font-mono text-xs text-slate-500">{{ c.detalle }}</span></div>
              }
            </div>
          }
        } @else {
          <!-- Sin agente: lo que se cargó a mano -->
          <p class="mb-3 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            <app-icono nombre="info" [tamano]="16" />
            <span>Esta PC aún no tiene instalado el agente de inventario. Cuando se instale, aquí aparecerán sus componentes reales.</span>
          </p>
          <dl class="grid gap-3 rounded-lg bg-slate-50 p-3.5 text-sm sm:grid-cols-3">
            <div><dt class="text-xs text-slate-500">Procesador</dt><dd class="font-semibold">{{ p.procesador || '—' }}</dd></div>
            <div><dt class="text-xs text-slate-500">RAM</dt><dd class="font-semibold">{{ p.ram || '—' }}</dd></div>
            <div><dt class="text-xs text-slate-500">Almacenamiento</dt><dd class="font-semibold">{{ p.almacenamiento || '—' }}</dd></div>
          </dl>
        }
      }
      <ng-container pie>
        @if (datos()) {
          <!-- Imprimir no se muestra en el celular; el PDF sí -->
          <button class="btn-secundario hidden sm:inline-flex" (click)="imprimirFicha()"><app-icono nombre="imprimir" [tamano]="15" /> Imprimir</button>
          <button class="btn-secundario" [disabled]="generandoPdf()" (click)="exportarFichaPdf()">
            <app-icono nombre="descargar" [tamano]="15" /> {{ generandoPdf() ? 'Generando…' : 'Exportar PDF' }}
          </button>
        }
        @if (permitirCambiarEstado()) {
          <button class="btn-secundario" (click)="cambiarEstado.emit(pc()!)">Cambiar estado</button>
        }
        <button class="btn-primario" (click)="cerrar.emit()">Cerrar</button>
      </ng-container>
    </app-modal>
  `,
})
export class ComponentesPcComponent {
  private readonly agente = inject(AgentePcsService);
  private readonly catalogos = inject(CatalogosService);
  private readonly notificaciones = inject(NotificacionesService);

  /** Figurita a mostrar; null = ventana cerrada */
  readonly pc = input<AmbientePc | null>(null);
  /** Muestra el botón "Cambiar estado" (desde el croquis) */
  readonly permitirCambiarEstado = input(false);
  readonly cerrar = output<void>();
  readonly cambiarEstado = output<AmbientePc>();

  protected readonly conexiones = CONEXIONES;
  protected readonly clasesEstado = CLASES_ESTADO;
  protected readonly textosEstado = TEXTOS_ESTADO_PC;
  protected readonly cargando = signal(false);
  protected readonly generandoPdf = signal(false);
  protected readonly datos = signal<{ equipo: EquipoPc; componentes: ComponentePc[] } | null>(null);

  /** Prendida, apagada o sin agente */
  protected readonly conexion = computed(() => {
    const pc = this.pc();
    return pc ? this.agente.conexion(pc.id) : 'sin_agente';
  });

  /** "LAB-01 · PC 20" (u "Otros") */
  protected readonly ubicacion = computed(() => {
    const pc = this.pc();
    if (!pc) return '';
    const lab = this.catalogos.mapaAmbientes().get(pc.ambiente_id)?.codigo ?? 'Otros';
    const numero = pc.etiqueta.match(/^SCPC\d{1,3}(\d{2})$/i)?.[1];
    return numero ? `${lab} · PC ${Number(numero)}` : lab;
  });

  constructor() {
    // Cada vez que se abre con otra PC, se leen sus componentes
    effect(() => {
      const pc = this.pc();
      this.datos.set(null);
      if (pc) void this.cargar(pc.id);
    });
  }

  /** Lee los componentes; si falla (o no hay agente) muestra los datos manuales */
  private async cargar(pcId: number): Promise<void> {
    this.cargando.set(true);
    try {
      const datos = await this.agente.componentes(pcId);
      if (this.pc()?.id === pcId) this.datos.set(datos);
    } catch {
      this.datos.set(null);
    } finally {
      this.cargando.set(false);
    }
  }

  /** Componentes de un tipo, en orden */
  protected grupo(tipo: string): ComponentePc[] {
    return (this.datos()?.componentes ?? []).filter((c) => c.tipo === tipo);
  }

  /** Une textos ignorando los vacíos */
  protected texto(a: string | null, b: string | null, separador = ' · '): string {
    return [a, b].filter(Boolean).join(separador) || '—';
  }

  /** 8 -> "8 GB"; 1000.2 -> "1 TB" */
  protected capacidad(gigas: number | null): string {
    if (!gigas) return '';
    return gigas >= 1000 ? `${Math.round(gigas / 1000)} TB` : `${Math.round(gigas)} GB`;
  }

  /** Imprime la ficha de esta PC en hoja carta vertical (todo valor se escapa) */
  protected imprimirFicha(): void {
    const ficha = this.datosFicha();
    if (!ficha) return;
    const pares = ficha.secciones[0] as Extract<SeccionPdf, { pares: unknown }>;
    const cuerpo = cabeceraHoja(ficha.titulo)
      + '<h2>Equipo</h2><table><tbody>'
      + pares.pares.map(([etiqueta, valor]) => `<tr><td class="etiqueta">${escaparHtml(etiqueta)}</td><td>${escaparHtml(valor || '—')}</td></tr>`).join('')
      + '</tbody></table>'
      + ficha.secciones.slice(1).map((s) => {
        const tabla = s as Extract<SeccionPdf, { columnas: string[] }>;
        return `<h2>${escaparHtml(tabla.titulo)}</h2><table><thead><tr>${tabla.columnas.map((c) => `<th>${escaparHtml(c)}</th>`).join('')}</tr></thead><tbody>`
          + tabla.filas.map((f) => `<tr>${f.map((v) => (v ? `<td>${escaparHtml(v)}</td>` : '<td class="vacio">—</td>')).join('')}</tr>`).join('')
          + '</tbody></table>';
      }).join('')
      + FIRMAS_HOJA;
    imprimirDocumento(ficha.archivo, cuerpo, 'portrait');
  }

  /** Descarga la ficha como PDF tamaño carta vertical (sirve en el celular) */
  protected async exportarFichaPdf(): Promise<void> {
    const ficha = this.datosFicha();
    if (!ficha) return;
    this.generandoPdf.set(true);
    try {
      await exportarPdf({ ...ficha, orientacion: 'portrait' });
    } catch (e) {
      this.notificaciones.error(e, 'No se pudo generar el PDF');
    } finally {
      this.generandoPdf.set(false);
    }
  }

  /**
   * Lo que llevan la ficha impresa y el PDF: los datos del equipo (primera
   * sección) y una tabla por tipo de componente.
   */
  private datosFicha(): { titulo: string; archivo: string; secciones: SeccionPdf[] } | null {
    const pc = this.pc();
    const d = this.datos();
    if (!pc || !d) return null;
    const e = d.equipo;
    // tabla arma la sección de un tipo de componente (no se agrega si no hay)
    const tabla = (titulo: string, tipo: string, columnas: string[], celdas: (c: ComponentePc) => (string | null)[]): SeccionPdf[] => {
      const items = this.grupo(tipo);
      return items.length ? [{ titulo, columnas, filas: items.map(celdas) }] : [];
    };
    return {
      titulo: `Ficha de PC · ${pc.etiqueta}`,
      archivo: `Ficha ${pc.etiqueta}`,
      secciones: [
        { titulo: 'Equipo', pares: [
          ['Ubicación', this.ubicacion()],
          ['Estado', TEXTOS_ESTADO_PC[pc.estado]],
          ['Dominio', e.en_dominio ? e.dominio : 'Fuera del dominio'],
          ['Fabricante y modelo', this.texto(e.fabricante, e.modelo, ' ')],
          ['N.º de serie', e.numero_serie],
          ['Procesador', (e.procesador ?? '') + (e.nucleos ? ` (${e.nucleos} núcleos / ${e.hilos} hilos)` : '')],
          ['Memoria total', e.memoria_total_gb ? `${Number(e.memoria_total_gb)} GB` : null],
          ['Placa madre', this.texto(e.placa_fabricante, e.placa_modelo, ' ')],
          ['Windows', this.texto(e.sistema_operativo, e.arquitectura)],
          ['Inventario del agente', e.inventario_en ? new Date(e.inventario_en).toLocaleString('es-BO') : null],
        ] },
        ...tabla('Memoria RAM', 'ram', ['Ranura', 'Capacidad', 'Tipo', 'Fabricante', 'N.º de parte', 'N.º de serie'],
          (c) => [c.ranura, this.capacidad(c.capacidad_gb), c.detalle, c.fabricante, c.descripcion, c.numero_serie]),
        ...tabla('Discos', 'disco', ['Modelo', 'Capacidad', 'Tipo', 'N.º de serie'],
          (c) => [c.descripcion, this.capacidad(c.capacidad_gb), c.detalle, c.numero_serie]),
        ...tabla('Video', 'video', ['Tarjeta', 'Driver'], (c) => [c.descripcion, c.detalle]),
        ...tabla('Red', 'red', ['Adaptador', 'MAC e IP'], (c) => [c.descripcion, c.detalle]),
      ],
    };
  }
}
