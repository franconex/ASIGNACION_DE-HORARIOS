import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { ComponentesPcComponent } from '../../compartido/componentes-pc.component';
import { FichasReparacionComponent } from '../../compartido/fichas-reparacion.component';
import { IconoComponent } from '../../compartido/icono.component';
import { AgentePcsService } from '../../core/agente-pcs.service';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { exportarPdf } from '../../core/exportar-pdf';
import { cabeceraHoja, escaparHtml, FIRMAS_HOJA, imprimirDocumento, TEXTOS_ESTADO_PC } from '../../core/impresion';
import { AmbientePc, ConexionPc, EstadoPc } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { OperacionService } from '../../core/operacion.service';

/** PCs por mesa y mesas por fila (como el plano de los laboratorios) */
const PCS_POR_MESA = 4;
const MESAS_POR_FILA = 4;
/** El croquis llega hasta 40 filas y 40 columnas (igual que en la base) */
const MAX_LINEAS = 40;
/** Motivo con que queda de baja una PC quitada del croquis */
const MOTIVO_BAJA_CROQUIS = 'Quitada del croquis del laboratorio';
/** Detalle con que vuelve a Activa una PC de baja puesta otra vez en el croquis */
const MOTIVO_DEVUELTA_CROQUIS = 'Devuelta al croquis del laboratorio';

/** Casilla del croquis: [fila, columna] */
type Casilla = [number, number];
type Casilla2 = { f: number; c: number };
/**
 * Acomodo de un laboratorio: tamaño de la cuadrícula, casilla de cada PC
 * (null: sin ubicar) y fila de la PC docente dentro de su zona.
 */
interface Acomodo {
  filas: number; columnas: number; pos: Record<number, Casilla | null>; docente: number;
  /** Lugares vacíos: puesto de la mesa sin PC (no corta la mesa y tiene el tamaño de un puesto) */
  huecos: Casilla[];
}

function clonarAcomodo(a: Acomodo): Acomodo {
  return { filas: a.filas, columnas: a.columnas, pos: { ...a.pos }, docente: a.docente, huecos: a.huecos.map((h) => [h[0], h[1]] as Casilla) };
}

/** ¿Hay un lugar vacío en la casilla? */
function hayHueco(a: Acomodo, f: number, c: number): boolean {
  return a.huecos.some((h) => h[0] === f && h[1] === c);
}

/** Quita el lugar vacío de la casilla (si lo hay) */
function sacarHueco(a: Acomodo, f: number, c: number): void {
  a.huecos = a.huecos.filter((h) => h[0] !== f || h[1] !== c);
}

/**
 * Quita las columnas vacías de la derecha y las filas vacías de abajo (la
 * fila de la PC docente cuenta como usada). Las vacías del medio quedan:
 * son pasillos.
 */
function recortarFinal(a: Acomodo, hayDocente: boolean): void {
  const usadas = [...Object.values(a.pos).filter((p): p is Casilla => !!p), ...a.huecos];
  const ultimaCol = Math.max(-1, ...usadas.map((p) => p[1]));
  const ultimaFila = Math.max(-1, hayDocente ? a.docente : -1, ...usadas.map((p) => p[0]));
  a.columnas = Math.max(1, ultimaCol + 1);
  a.filas = Math.max(1, ultimaFila + 1);
  a.docente = Math.min(a.docente, a.filas - 1);
}

/**
 * Arma el plano de una vez: mesas de `porMesa` PCs (una debajo de otra),
 * `mesasFila` mesas por fila y una columna de pasillo cada `pasilloCada`
 * mesas (0: sin pasillo). Entre filas de mesas queda una fila libre.
 */
function acomodoPlantilla(pcs: AmbientePc[], porMesa: number, mesasFila: number, pasilloCada: number): Acomodo {
  const mesas = Math.max(1, Math.ceil(pcs.length / porMesa));
  const enFila = Math.min(mesasFila, mesas);
  const filasMesas = Math.ceil(mesas / mesasFila);
  const pasillos = pasilloCada > 0 ? Math.floor((enFila - 1) / pasilloCada) : 0;
  const pos: Record<number, Casilla | null> = {};
  pcs.forEach((pc, i) => {
    const mesa = Math.floor(i / porMesa);
    const mc = mesa % mesasFila;
    pos[pc.id] = [Math.floor(mesa / mesasFila) * (porMesa + 1) + (i % porMesa), mc + (pasilloCada > 0 ? Math.floor(mc / pasilloCada) : 0)];
  });
  return { filas: filasMesas * (porMesa + 1) - 1, columnas: enFila + pasillos, pos, docente: 0, huecos: [] };
}

/** Quita la fila o columna k (vacía) y corre las de después */
function quitarLinea(a: Acomodo, tipo: 'col' | 'fila', k: number): void {
  const i = tipo === 'col' ? 1 : 0;
  for (const id of Object.keys(a.pos).map(Number)) {
    const p = a.pos[id];
    if (p && p[i] > k) a.pos[id] = i ? [p[0], p[1] - 1] : [p[0] - 1, p[1]];
  }
  // Los lugares vacíos de esa línea se van; los de después se corren
  a.huecos = a.huecos.filter((h) => h[i] !== k).map((h) => (h[i] > k ? (i ? [h[0], h[1] - 1] : [h[0] - 1, h[1]]) : h) as Casilla);
  if (i) a.columnas--;
  else {
    a.filas--;
    if (a.docente > k) a.docente--;
  }
}

/** Color de la pantalla, ícono y texto de cada estado */
const ESTADOS: Record<EstadoPc, { texto: string; pantalla: string; punto: string; icono: string | null }> = {
  operativa: { texto: 'Activa', pantalla: 'bg-emerald-500 border-emerald-600', punto: 'bg-emerald-500', icono: null },
  inactiva: { texto: 'Inactiva', pantalla: 'bg-slate-400 border-slate-500', punto: 'bg-slate-400', icono: 'suspender' },
  mantenimiento: { texto: 'Mantenimiento', pantalla: 'bg-amber-400 border-amber-500', punto: 'bg-amber-400', icono: 'mantenimiento' },
  baja: { texto: 'De baja', pantalla: 'bg-rose-500 border-rose-600', punto: 'bg-rose-500', icono: 'cerrar' },
};
const OPCIONES: { estado: EstadoPc; clase: string }[] = [
  { estado: 'operativa', clase: 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100' },
  { estado: 'inactiva', clase: 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200' },
  { estado: 'mantenimiento', clase: 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100' },
  { estado: 'baja', clase: 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100' },
];

/** Punto y texto de la conexión que reporta el agente de inventario */
const CONEXIONES: Record<ConexionPc, { texto: string; punto: string }> = {
  prendida: { texto: 'Prendida', punto: 'bg-emerald-500 ring-emerald-100' },
  apagada: { texto: 'Apagada', punto: 'bg-slate-700 ring-slate-200' },
  sin_agente: { texto: 'Sin agente', punto: '' },
};

/** Columnas de la lista de PCs (hoja impresa y PDF) */
const COLUMNAS_LISTA = ['N.º', 'PC', 'Estado', 'Conexión', 'Procesador', 'RAM', 'Almacenamiento', 'N.º de serie'];

/** ¿Es la PC de la mesa del docente? */
export function esPcDocente(pc: AmbientePc): boolean {
  return pc.es_docente || /^PC\s*DOCENTE/i.test(pc.etiqueta);
}

/**
 * Croquis del laboratorio dibujado como el plano real: mesa del docente a la
 * izquierda y mesas de 4 PCs en filas. Cada PC es un monitor con el color de
 * su estado. Dos modos:
 *  - 'estado': todos ven el estado y el último cambio de cada PC; el personal
 *    de operación cambia el estado (una o varias PCs) llenando una FICHA DE
 *    REPARACIÓN por PC (fallas, corrección, pieza): queda como mantenimiento
 *    correctivo. Dar de baja también; la baja sale en su cierre de turno.
 *  - 'seleccion': dentro de un ticket, se marcan las PCs donde se hizo la tarea.
 *    Solo se marcan PCs ACTIVAS (una en mantenimiento o inactiva se puede
 *    pasar a Activa ahí mismo); con permitirNoActivas (correctivo) también
 *    las que fallan y las de baja (para repararlas).
 */
@Component({
  selector: 'app-laboratorio-croquis',
  imports: [IconoComponent, NgTemplateOutlet, DatePipe, FichasReparacionComponent, ComponentesPcComponent],
  // El menú del clic derecho se cierra al hacer clic en cualquier lado o con Escape
  // La hoja de acciones del celular NO se cierra con el clic del documento (lo dispara el mismo dedo al soltar)
  host: { '(document:click)': 'cerrarMenus()', '(document:keydown.escape)': 'cerrarMenus(); hojaAcciones.set(null)', '(document:keydown)': 'teclaEdicion($event)' },
  template: `
    <div class="relative" #raiz>
      <!-- Barra: leyenda + acciones -->
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          @for (o of opciones; track o.estado) {
            <span class="inline-flex items-center gap-1">
              <span class="h-2.5 w-2.5 rounded-sm" [class]="estados[o.estado].punto"></span>
              {{ estados[o.estado].texto }} <b class="text-slate-700">{{ cuenta()[o.estado] }}</b>
            </span>
          }
          <!-- Prendidas / apagadas según el agente (solo si alguna PC lo tiene) -->
          @if (cuentaConexion().prendida + cuentaConexion().apagada) {
            <span class="mx-1 h-3 w-px bg-slate-300"></span>
            <span class="inline-flex items-center gap-1"><span class="h-2 w-2 rounded-full" [class]="conexiones.prendida.punto"></span> Prendidas <b class="text-slate-700">{{ cuentaConexion().prendida }}</b></span>
            <span class="inline-flex items-center gap-1"><span class="h-2 w-2 rounded-full" [class]="conexiones.apagada.punto"></span> Apagadas <b class="text-slate-700">{{ cuentaConexion().apagada }}</b></span>
          }
        </div>
        @if (editando()) {
          <!-- Acomodar el croquis: deshacer, plantilla, recortar, cancelar y guardar -->
          <div class="flex flex-wrap gap-1.5">
            <button type="button" class="btn-secundario btn-sm" (click)="deshacer()" [disabled]="!historial().length" title="Deshacer (Ctrl+Z)">
              <app-icono nombre="deshacer" [tamano]="14" /><span class="hidden sm:inline">Deshacer</span>
            </button>
            <button type="button" class="btn-sm" [class]="modoHueco() ? 'btn-primario' : 'btn-secundario'"
                    (click)="alternarModoHueco()" [attr.aria-pressed]="modoHueco()"
                    title="Marcar puestos de la mesa sin PC: no cortan la mesa y guardan el espacio">
              <span class="inline-block h-3 w-3.5 rounded-[3px] border-2 border-dashed border-current"></span> Lugar vacío
            </button>
            <button type="button" class="btn-sm" [class]="verPlantilla() ? 'btn-primario' : 'btn-secundario'"
                    (click)="verPlantilla.set(!verPlantilla()); menuCab.set(null); modoHueco.set(false)" title="Armar el plano de una vez">
              <app-icono nombre="grilla" [tamano]="14" /> Plantilla
            </button>
            <button type="button" class="btn-secundario btn-sm" (click)="salirEdicion()" [disabled]="guardandoCroquis()">Cancelar</button>
            <button type="button" class="btn-primario btn-sm" (click)="guardarCroquis()" [disabled]="!historial().length || guardandoCroquis()">
              {{ guardandoCroquis() ? 'Guardando…' : 'Guardar' }}
            </button>
          </div>
        } @else if (todasLasPcs().length) {
          <div class="flex flex-wrap gap-1.5">
            @if (modo() === 'estado' && puedeAcomodar() && alumnos().length) {
              <button type="button" class="btn-secundario btn-sm" (click)="entrarEdicion()" title="Mover las PCs arrastrándolas">
                <app-icono nombre="mover" [tamano]="14" /> Acomodar
              </button>
            }
            @if (modo() === 'seleccion') {
              <button type="button" class="btn-secundario btn-sm" (click)="todas()">Todas las activas ({{ activas().length }})</button>
              <button type="button" class="btn-secundario btn-sm" (click)="emitir([])" [disabled]="!seleccion().length">Limpiar</button>
            } @else if (puedeCambiar()) {
              <button type="button" class="btn-sm" [class]="multiple() ? 'btn-primario' : 'btn-secundario'" (click)="alternarMultiple()"
                      title="Marcar varias PCs y cambiarles el estado juntas">
                <app-icono nombre="capas" [tamano]="14" /> {{ multiple() ? 'Terminar selección' : 'Cambiar varias' }}
              </button>
            }
            <!-- Lista de PCs del laboratorio en hoja carta: imprimir (solo PC) o exportar PDF (PC y celular) -->
            @if (modo() === 'estado') {
              <div class="relative" (click)="$event.stopPropagation()">
                <button type="button" class="btn-secundario btn-sm" (click)="opcionesImpresion.set(!opcionesImpresion())"
                        [attr.aria-expanded]="opcionesImpresion()" title="Imprimir o exportar a PDF la lista de PCs de este laboratorio">
                  <app-icono nombre="descargar" [tamano]="14" />
                  <span class="hidden sm:inline">Imprimir / PDF</span><span class="sm:hidden">Exportar PDF</span>
                </button>
                @if (opcionesImpresion()) {
                  <div class="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-slate-200 bg-superficie p-3 text-sm shadow-lg">
                    <p class="mb-2 font-semibold">Lista de PCs (hoja carta)</p>
                    <label class="flex min-h-9 items-center gap-2">
                      <input type="checkbox" [checked]="incluirDocente()" (change)="incluirDocente.set(!incluirDocente())"> Incluir PC docente
                    </label>
                    <label class="flex min-h-9 items-center gap-2">
                      <input type="checkbox" [checked]="soloActivas()" (change)="soloActivas.set(!soloActivas())"> Solo PCs activas
                    </label>
                    <div class="mt-2 flex gap-1.5">
                      <!-- Imprimir no se muestra en el celular -->
                      <button type="button" class="btn-secundario btn-sm hidden flex-1 sm:inline-flex" (click)="imprimirLista()">
                        <app-icono nombre="imprimir" [tamano]="14" /> Imprimir
                      </button>
                      <button type="button" class="btn-primario btn-sm flex-1" [disabled]="generandoPdf()" (click)="exportarListaPdf()">
                        <app-icono nombre="descargar" [tamano]="14" /> {{ generandoPdf() ? 'Generando…' : 'Exportar PDF' }}
                      </button>
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>

      @if (!todasLasPcs().length) {
        <p class="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          Este laboratorio aún no tiene PCs. Créalas con <b>Generar PCs</b> en el inventario.
        </p>
      } @else {
        @if (editando()) {
          @if (verPlantilla()) {
            <!-- Plantilla: arma todo el plano y después se corrige a mano -->
            <div class="mb-2 flex flex-wrap items-end gap-3 rounded-lg bg-slate-100 px-3 py-2 text-xs">
              <label class="flex flex-col gap-1 text-slate-600">PCs por mesa
                <input type="number" min="1" max="10" class="campo h-9 w-20" [value]="plantillaPorMesa()" (input)="plantillaPorMesa.set(numero1($event, 1, 10))">
              </label>
              <label class="flex flex-col gap-1 text-slate-600">Mesas por fila
                <input type="number" min="1" max="20" class="campo h-9 w-20" [value]="plantillaMesasFila()" (input)="plantillaMesasFila.set(numero1($event, 1, 20))">
              </label>
              <label class="flex flex-col gap-1 text-slate-600">Pasillo cada (0 = sin pasillo)
                <input type="number" min="0" max="20" class="campo h-9 w-20" [value]="plantillaPasillo()" (input)="plantillaPasillo.set(numero1($event, 0, 20))">
              </label>
              <button type="button" class="btn-primario btn-sm" (click)="aplicarPlantilla()">Aplicar</button>
            </div>
          } @else if (modoHueco()) {
            <p class="mb-2 rounded-lg border border-marca-300 bg-marca-50 px-3 py-1 text-xs text-marca-700">
              <b>Lugar vacío:</b> toca una casilla para dejar un puesto sin PC dentro de la mesa (no la corta); tócalo otra vez para quitarlo.
            </p>
          } @else if (menuCab(); as m) {
            <!-- Insertar o quitar la columna / fila tocada en el borde -->
            <div class="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm">
              <b class="mr-1">{{ m.tipo === 'col' ? 'Columna ' + letra(m.k) : 'Fila ' + (m.k + 1) }}</b>
              <button type="button" class="btn-secundario btn-sm" (click)="insertar(m.tipo, m.k, true)">{{ m.tipo === 'col' ? '← Insertar antes' : '↑ Insertar arriba' }}</button>
              <!-- En la última no hace falta: al final se crece soltando una PC en la franja ＋ -->
              @if (m.k < (m.tipo === 'col' ? acomodo().columnas : acomodo().filas) - 1) {
                <button type="button" class="btn-secundario btn-sm" (click)="insertar(m.tipo, m.k, false)">{{ m.tipo === 'col' ? 'Insertar después →' : '↓ Insertar abajo' }}</button>
              }
              <button type="button" class="btn-secundario btn-sm" (click)="quitar(m.tipo, m.k)" [disabled]="!lineaVacia(m.tipo, m.k)"
                      [title]="lineaVacia(m.tipo, m.k) ? 'Quitar' : 'Primero saca las PCs de aquí'">Quitar</button>
              <button type="button" class="btn-fantasma btn-sm ml-auto" (click)="menuCab.set(null)" aria-label="Cerrar"><app-icono nombre="cerrar" [tamano]="14" /></button>
            </div>
          } @else if (elegidaPc(); as e) {
            <!-- Solo cuando se tocó una PC: dónde tocar ahora -->
            <p class="mb-2 truncate rounded-lg border border-marca-300 bg-marca-50 px-3 py-1 text-xs text-marca-700">
              <b>{{ e.etiqueta }}</b> elegida: toca a dónde va.
            </p>
          }
        }
        <!-- PLANO: cuadrícula de filas × columnas; las PCs seguidas en una columna forman una mesa -->
        <div class="plano overflow-x-auto rounded-xl border-2 border-slate-300 bg-slate-50 p-1.5 sm:p-3">
          @let v = vista();
          <!-- Columnas: zona del docente | números de fila (al editar) | mesas. Filas: pizarra | casillas | puerta -->
          <div class="grid gap-x-1.5 gap-y-1 sm:min-w-[560px] sm:gap-x-4" [style.grid-template-columns]="editando() ? 'auto auto 1fr' : 'auto 1fr'">
            <!-- Zona del docente: fondo, pizarra, casillas (la PC docente se mueve solo aquí) y puerta -->
            <div class="pointer-events-none rounded-lg border border-dashed border-slate-300 bg-superficie/70" style="grid-column: 1; grid-row: 1 / 4"></div>
            <div class="relative flex w-12 flex-col items-center gap-1 px-1 pt-1 sm:w-28 sm:px-2 sm:pt-2" style="grid-column: 1; grid-row: 1">
              <span class="w-full rounded bg-slate-700 py-1 text-center text-[8px] font-semibold tracking-wide text-superficie sm:text-[10px]">PIZARRA</span>
              <span class="hidden text-[10px] font-semibold uppercase text-slate-400 sm:inline">Docente</span>
            </div>
            <div #zonaDocente class="rejilla relative grid px-1 sm:px-2" style="grid-column: 1; grid-row: 2" [style.grid-template-rows]="v.plantillaFilas">
              @if (editando() && docente()) {
                @for (f of v.indicesFila; track f) {
                  <div class="z-0 rounded-md border border-dashed"
                       [class]="(f >= acomodo().filas ? 'border-marca-300 bg-marca-50/60' : 'border-slate-300/70 bg-superficie/60')
                                + (elegida() === docente()?.id ? ' cursor-pointer hover:border-marca-500 hover:bg-marca-50' : '')"
                       [attr.data-docente]="f" [style.grid-row]="f + 1" style="grid-column: 1"
                       (click)="tocarCeldaDocente(f)"></div>
                }
              }
              @if (docente(); as pc) {
                <div class="relative z-[2] flex items-center" [style.grid-row]="acomodo().docente + 1" style="grid-column: 1">
                  <ng-container *ngTemplateOutlet="monitor; context: { $implicit: pc, docente: true }" />
                </div>
              } @else {
                <span class="self-center text-center text-[10px] text-slate-400" style="grid-row: 1">Sin PC docente</span>
              }
              @if (destino(); as d) {
                @if (d !== 'bandeja' && d.c < 0) {
                  <div class="pointer-events-none z-[3] rounded-md border-2 border-marca-500 bg-marca-500/15" [style.grid-row]="d.f + 1" style="grid-column: 1"></div>
                }
              }
            </div>
            <span class="relative pb-1 text-center text-[10px] text-slate-400 sm:pb-2" style="grid-column: 1; grid-row: 3">Puerta ▾</span>

            <!-- Mesas de alumnos -->
                @if (editando()) {
                  <!-- Letras de las columnas y números de las filas (se tocan para insertar o quitar) -->
                  <div class="rejilla grid self-end" style="grid-column: 3; grid-row: 1" [style.grid-template-columns]="v.plantillaColumnas">
                    @for (c of v.indicesCol; track c) {
                      @if (c < acomodo().columnas) {
                        <button type="button" class="min-h-6 rounded text-[11px] font-semibold transition"
                                [class]="menuCab()?.tipo === 'col' && menuCab()?.k === c ? 'bg-marca-100 text-marca-700' : 'text-slate-400 hover:bg-slate-200'"
                                (click)="tocarCabecera('col', c); modoHueco.set(false)">{{ letra(c) }}</button>
                      } @else { <span></span> }
                    }
                  </div>
                  <div class="rejilla grid" style="grid-column: 2; grid-row: 2" [style.grid-template-rows]="v.plantillaFilas">
                    @for (f of v.indicesFila; track f) {
                      @if (f < acomodo().filas) {
                        <button type="button" class="min-w-6 rounded px-1 text-[11px] font-semibold transition"
                                [class]="menuCab()?.tipo === 'fila' && menuCab()?.k === f ? 'bg-marca-100 text-marca-700' : 'text-slate-400 hover:bg-slate-200'"
                                (click)="tocarCabecera('fila', f); modoHueco.set(false)">{{ f + 1 }}</button>
                      } @else { <span></span> }
                    }
                  </div>
                }
                <div #rejilla class="rejilla relative grid" [style.grid-column]="editando() ? 3 : 2" style="grid-row: 2"
                     [style.grid-template-columns]="v.plantillaColumnas" [style.grid-template-rows]="v.plantillaFilas">
                  @if (editando()) {
                    @for (celda of v.celdas; track celda.f + '-' + celda.c) {
                      <div class="z-0 flex items-center justify-center rounded-md border border-dashed text-sm"
                           [class]="(celda.nueva ? 'border-marca-300 bg-marca-50/60 text-marca-300' : 'border-slate-300/70 bg-superficie/60')
                                    + (elegida() || modoHueco() ? ' cursor-pointer hover:border-marca-500 hover:bg-marca-50' : '')"
                           [attr.data-f]="celda.f" [attr.data-c]="celda.c"
                           [style.grid-row]="celda.f + 1" [style.grid-column]="celda.c + 1"
                           (click)="tocarCelda(celda.f, celda.c)">{{ celda.nueva ? '＋' : '' }}</div>
                    }
                  }
                  @for (m of v.mesas; track m.c + '-' + m.desde) {
                    <div class="pointer-events-none z-[1] -m-0.5 rounded-md border-2 border-slate-300 bg-superficie shadow-sm sm:-m-1"
                         [style.grid-column]="m.c + 1" [style.grid-row]="(m.desde + 1) + ' / ' + (m.hasta + 2)"></div>
                  }
                  <!-- Lugares vacíos: puesto de la mesa sin PC (al editar no tapan la casilla: se toca a través) -->
                  @for (h of v.huecos; track h.f + '-' + h.c) {
                    <div class="pointer-events-none relative z-[2] flex items-center justify-center rounded-md border-2 border-dashed border-slate-300 text-[9px] text-slate-400 sm:text-[10px]"
                         [class.border-marca-300]="modoHueco()"
                         [style.grid-row]="h.f + 1" [style.grid-column]="h.c + 1">vacío</div>
                  }
                  @for (u of v.ubicadas; track u.pc.id) {
                    <div class="relative z-[2] flex items-center" [style.grid-row]="u.f + 1" [style.grid-column]="u.c + 1">
                      <ng-container *ngTemplateOutlet="monitor; context: { $implicit: u.pc, docente: false }" />
                    </div>
                  }
                  @if (destino(); as d) {
                    @if (d !== 'bandeja' && d.c >= 0) {
                      <div class="pointer-events-none z-[3] rounded-md border-2 border-marca-500 bg-marca-500/15"
                           [class.border-dashed]="hayOtraEn(d.f, d.c)"
                           [style.grid-row]="d.f + 1" [style.grid-column]="d.c + 1"></div>
                    }
                  }
                </div>
          </div>
        </div>

        <!-- PCs sin casilla en el plano (nuevas o sacadas al acomodar): siguen a mano para cambiarles el estado -->
        @if (editando() || vista().sinUbicar.length) {
          <!-- Al acomodar queda pegada abajo de la pantalla aunque se desplace el plano -->
          <div #bandeja class="z-20 mt-2 rounded-lg border-2 border-dashed px-2 py-1.5 transition"
               [class]="(destino() === 'bandeja' ? 'border-marca-500 bg-marca-50' : 'border-slate-300 bg-superficie')
                        + (editando() ? ' sticky -bottom-5 shadow-[0_-6px_16px_-6px_rgb(15_23_42/0.25)]' : '')"
               (click)="tocarBandeja()">
            <p class="mb-1 text-[11px] font-semibold text-slate-500">
              Sin ubicar ({{ vista().sinUbicar.length }})
              @if (editando()) { <span class="font-normal">· la que sacas del plano se pone <b class="text-rose-600">roja (de baja)</b>; una roja puesta en el plano vuelve a <b class="text-emerald-600">Activa</b></span> }
            </p>
            <div class="flex min-h-11 gap-1 overflow-x-auto">
              @for (pc of vista().sinUbicar; track pc.id) {
                <div class="w-14 shrink-0 sm:w-24"><ng-container *ngTemplateOutlet="monitor; context: { $implicit: pc, docente: false }" /></div>
              } @empty {
                <span class="self-center text-[11px] text-slate-400">Vacía</span>
              }
            </div>
          </div>
        }

        <!-- PCs de baja: no van en el plano; siguen a mano para verlas o repararlas -->
        @if (!editando() && deBaja().length) {
          <div class="mt-2 rounded-lg border border-rose-200 bg-rose-50/50 px-2 py-1.5">
            <p class="mb-1 text-[11px] font-semibold text-rose-700">De baja ({{ deBaja().length }}) <span class="font-normal">· fuera del plano</span></p>
            <div class="flex min-h-11 gap-1 overflow-x-auto">
              @for (pc of deBaja(); track pc.id) {
                <div class="w-14 shrink-0 sm:w-24"><ng-container *ngTemplateOutlet="monitor; context: { $implicit: pc, docente: esDocente(pc) }" /></div>
              }
            </div>
          </div>
        }
      }

      <!-- Pista solo en pantallas táctiles chicas -->
      @if (todasLasPcs().length && !editando()) {
        <p class="mt-1.5 flex items-center gap-1 text-[11px] text-slate-500 sm:hidden">
          <app-icono nombre="info" [tamano]="12" /> Mantén presionada una PC para ver sus propiedades.
        </p>
      }

      @if (modo() === 'seleccion' && noDisponibles()) {
        <p class="mt-2 flex items-start gap-1.5 text-xs text-slate-500">
          <app-icono nombre="info" [tamano]="13" />
          <span>{{ noDisponibles() }} PC(s) no se pueden marcar.
            Toca una en mantenimiento o inactiva para pasarla a Activa. Las de baja solo admiten un mantenimiento correctivo.</span>
        </p>
      }

      <!-- Cambio de estado: ficha de reparación por PC (queda como mantenimiento correctivo) -->
      @if (!editando() && porCambiar(); as c) {
        <div class="mt-3 rounded-lg border-2 border-marca-300 bg-marca-50/60 p-3">
          <p class="mb-1 flex items-center gap-2 text-sm font-semibold">
            <app-icono nombre="mantenimiento" [tamano]="15" />
            Ficha de reparación · {{ c.pcs.length === 1 ? c.pcs[0].etiqueta : c.pcs.length + ' PCs' }}
          </p>
          <p class="mb-2 text-xs text-slate-600">
            Llena la ficha de cada PC: queda como <b>mantenimiento correctivo</b> a tu nombre. Si queda de baja, sale en tu cierre de turno.
          </p>
          <div class="rounded-lg bg-superficie p-2">
            <app-fichas-reparacion [pcs]="c.pcs" [estadoInicial]="c.estado" />
          </div>
          <div class="mt-2 flex justify-end gap-1.5">
            <button type="button" class="btn-secundario btn-sm" (click)="porCambiar.set(null)">Cancelar</button>
            <button type="button" class="btn-primario btn-sm" [disabled]="guardando()" (click)="confirmarCambio()">
              {{ guardando() ? 'Guardando…' : c.pcs.length > 1 ? 'Guardar ' + c.pcs.length + ' fichas' : 'Guardar ficha' }}
            </button>
          </div>
        </div>
      }

      <!-- Una PC: cambio de estado -->
      @if (modo() === 'estado' && !multiple() && activa(); as pc) {
        <div class="mt-3 rounded-lg border border-slate-200 bg-superficie p-3 shadow-sm">
          <div class="mb-2 flex items-center gap-2">
            <span class="h-3 w-3 rounded-sm" [class]="estados[pc.estado].punto"></span>
            <span class="font-semibold">{{ pc.etiqueta }}</span>
            <span class="text-xs text-slate-500">{{ estados[pc.estado].texto }}</span>
            <button class="btn-fantasma btn-sm ml-auto" (click)="activa.set(null)" aria-label="Cerrar"><app-icono nombre="cerrar" [tamano]="14" /></button>
          </div>
          @if (caracteristicas(pc)) { <p class="mb-2 text-xs text-slate-500">{{ caracteristicas(pc) }}</p> }
          <!-- Conexión según el agente + botón de componentes -->
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p class="flex items-center gap-1.5 text-xs text-slate-600">
              @switch (conexion(pc)) {
                @case ('prendida') { <span class="h-2 w-2 rounded-full" [class]="conexiones.prendida.punto"></span> <b>Prendida</b> }
                @case ('apagada') { <span class="h-2 w-2 rounded-full" [class]="conexiones.apagada.punto"></span> <b>Apagada</b> desde {{ agente.ultimoLatido(pc.id) | date: 'dd/MM HH:mm' }} }
                @default { <span class="text-slate-400">Sin agente de inventario</span> }
              }
            </p>
            <button type="button" class="btn-secundario btn-sm" (click)="verComponentes.set(pc)">
              <app-icono nombre="equipo" [tamano]="14" /> Ver propiedades
            </button>
          </div>
          @if (pc.notas) { <p class="mb-2 text-xs text-slate-500">{{ pc.notas }}</p> }
          @if (pc.estado_en) {
            <p class="mb-2 rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
              <b>Último cambio:</b> {{ pc.cambio?.nombre_completo ?? '—' }} · {{ pc.estado_en | date: 'dd/MM/yyyy HH:mm' }}<br>
              {{ pc.estado_detalle }}
            </p>
          } @else if (pc.estado === 'baja' && pc.motivo_baja) {
            <p class="mb-2 text-xs text-rose-700"><b>Motivo de baja:</b> {{ pc.motivo_baja }}</p>
          }
          @if (bajaPendiente().has(pc.id)) {
            <p class="mb-2 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700">Baja solicitada: esperando al administrador o al encargado.</p>
          }
          @if (puedeCambiar()) {
            <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              @for (o of opciones; track o.estado) {
                <button class="rounded-lg border-2 px-2 py-2 text-xs font-semibold transition disabled:opacity-40" [class]="o.clase"
                        (click)="pedirCambio([pc], o.estado)"
                        [disabled]="pc.estado === o.estado || guardando()">
                  {{ estados[o.estado].texto }}
                </button>
              }
            </div>
          }
        </div>
      }

      <!-- Varias PCs: cambio de estado en lote -->
      @if (modo() === 'estado' && multiple()) {
        <div class="mt-3 rounded-lg border border-marca-300 bg-marca-50 p-3">
          <p class="mb-2 text-sm">
            @if (marcadas().length) { <b>{{ marcadas().length }}</b> PC(s) marcadas. Cambiar todas a: }
            @else { Toca las PCs que quieres cambiar. }
          </p>
          <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            @for (o of opciones; track o.estado) {
              <button class="rounded-lg border-2 px-2 py-2 text-xs font-semibold transition disabled:opacity-40" [class]="o.clase"
                      (click)="cambiarMarcadas(o.estado)" [disabled]="!marcadas().length || guardando()">{{ estados[o.estado].texto }}</button>
            }
          </div>
        </div>
      }

      <!-- Menú del clic derecho sobre una PC (como en Windows) -->
      @if (menu(); as m) {
        <div class="absolute z-30 min-w-48 rounded-lg border border-slate-200 bg-superficie py-1 text-sm shadow-lg"
             [style.left.px]="m.x" [style.top.px]="m.y" role="menu" (click)="$event.stopPropagation()">
          <p class="truncate border-b border-slate-100 px-3 pb-1.5 pt-1 text-xs font-semibold text-slate-500">{{ m.pc.etiqueta }}</p>
          <button type="button" role="menuitem" class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-100"
                  (click)="verComponentes.set(m.pc); menu.set(null)">
            <app-icono nombre="equipo" [tamano]="15" /> Ver propiedades
          </button>
          @if (modo() === 'estado' && !multiple()) {
            <button type="button" role="menuitem" class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-100"
                    (click)="activa.set(m.pc); menu.set(null)">
              <app-icono nombre="mantenimiento" [tamano]="15" /> Cambiar estado
            </button>
          }
        </div>
      }
    </div>

    <!-- Una PC dibujada como monitor -->
    <ng-template #monitor let-pc let-docente="docente">
      <button type="button"
              class="group relative flex w-full flex-col items-center gap-0.5 rounded-md border px-0.5 py-1 text-left transition sm:flex-row sm:gap-1.5 sm:px-1.5"
              [class]="marcada(pc) ? 'border-marca-500 bg-marca-50 ring-2 ring-marca-500' : 'border-transparent hover:border-slate-300 hover:bg-slate-100'"
              [class.cursor-default]="false"
              [class.opacity-50]="modo() === 'seleccion' && !seleccionable(pc) && !marcada(pc)"
              [class.cursor-not-allowed]="modo() === 'seleccion' && pc.estado === 'baja'"
              [class.opacity-25]="arrastrandoId() === pc.id" [class.cursor-grab]="editando()"
              [style.touch-action]="editando() ? 'none' : null"
              (click)="alTocar(pc)" (contextmenu)="abrirMenu($event, pc)"
              (pointerdown)="iniciarPulsacion($event, pc)" (pointermove)="moverPulsacion($event)"
              (pointerup)="cancelarPulsacion()" (pointercancel)="cancelarPulsacion()" (pointerleave)="cancelarPulsacion()"
              [style.-webkit-touch-callout]="'none'" [style.user-select]="'none'"
              [title]="pc.etiqueta + ' · ' + info(pc).texto + ' · ' + conexiones[conexion(pc)].texto + ' (clic derecho o mantener presionado: propiedades)'">
        <!-- pantalla -->
        <span class="relative flex h-6 w-8 shrink-0 items-center justify-center rounded-[3px] border-2 text-white sm:h-7 sm:w-9" [class]="info(pc).pantalla">
          @if (info(pc).icono; as ic) { <app-icono [nombre]="ic" [tamano]="13" [grosor]="2.5" /> }
          <span class="absolute -bottom-[5px] left-1/2 h-[3px] w-3 -translate-x-1/2 rounded-sm bg-slate-400"></span>
          <!-- punto de prendida / apagada (no se dibuja si la PC no tiene agente) -->
          @if (conexion(pc) !== 'sin_agente') {
            <span class="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full ring-2" [class]="conexiones[conexion(pc)].punto"></span>
          }
        </span>
        <span class="min-w-0 pt-0.5 text-center leading-tight sm:pt-0 sm:text-left">
          <span class="block text-xs font-bold text-slate-800 sm:text-sm">{{ docente ? 'DOC' : numero(pc) }}</span>
          <span class="hidden truncate text-[9px] text-slate-500 sm:block">{{ pc.etiqueta }}</span>
        </span>
        @if (marcada(pc)) {
          <span class="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-marca-600 text-white">
            <app-icono nombre="check" [tamano]="10" [grosor]="3" />
          </span>
        }
      </button>
    </ng-template>

    <!-- Celular: menú que sube desde abajo al mantener presionada una PC -->
    @if (hojaAcciones(); as pc) {
      <div class="fixed inset-0 z-50">
        <div class="absolute inset-0 bg-black/45" (click)="hojaAcciones.set(null)"></div>
        <div class="absolute inset-x-0 bottom-0 rounded-t-2xl bg-superficie px-3 pb-5 pt-2 shadow-xl" role="dialog" aria-modal="true" [attr.aria-label]="'Acciones de ' + pc.etiqueta">
          <div class="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300"></div>
          <div class="mb-2 flex items-center gap-2 px-2">
            <span class="h-3 w-3 shrink-0 rounded-sm" [class]="estados[pc.estado].punto"></span>
            <p class="min-w-0 flex-1 truncate text-base font-semibold">{{ pc.etiqueta }}</p>
            <span class="text-xs text-slate-500">{{ estados[pc.estado].texto }} · {{ conexiones[conexion(pc)].texto }}</span>
          </div>
          <button type="button" class="flex min-h-13 w-full items-center gap-3 rounded-xl px-3 text-left text-base hover:bg-slate-100 active:bg-slate-200"
                  (click)="verComponentes.set(pc); hojaAcciones.set(null)">
            <app-icono nombre="equipo" [tamano]="20" class="text-marca-600" /> Ver propiedades
          </button>
          @if (modo() === 'estado' && puedeCambiar()) {
            <button type="button" class="flex min-h-13 w-full items-center gap-3 rounded-xl px-3 text-left text-base hover:bg-slate-100 active:bg-slate-200"
                    (click)="multiple.set(false); activa.set(pc); hojaAcciones.set(null)">
              <app-icono nombre="mantenimiento" [tamano]="20" class="text-marca-600" /> Cambiar estado
            </button>
          }
          <button type="button" class="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 text-base font-medium"
                  (click)="hojaAcciones.set(null)">Cancelar</button>
        </div>
      </div>
    }

    <!-- Ventana con los componentes que reportó el agente -->
    <app-componentes-pc [pc]="verComponentes()" (cerrar)="verComponentes.set(null)"
                        [permitirCambiarEstado]="modo() === 'estado' && puedeCambiar()"
                        (cambiarEstado)="verComponentes.set(null); multiple.set(false); activa.set($event)" />
  `,
  styles: `
    .plano { background-image: radial-gradient(circle, rgb(148 163 184 / 0.25) 1px, transparent 1px); background-size: 14px 14px; }
    /* Casillas del croquis: alto fijo; en el celular más juntas */
    .rejilla { --alto-celda: 2.9rem; row-gap: 0.25rem; column-gap: 0.5rem; }
    @media (min-width: 640px) { .rejilla { --alto-celda: 2.5rem; row-gap: 0.375rem; column-gap: 1.25rem; } }
  `,
})
export class LaboratorioCroquisComponent {
  private readonly catalogos = inject(CatalogosService);
  private readonly auth = inject(AuthService);
  private readonly notificaciones = inject(NotificacionesService);
  private readonly operacion = inject(OperacionService);
  protected readonly agente = inject(AgentePcsService);

  readonly ambienteId = input.required<number>();
  readonly modo = input<'estado' | 'seleccion'>('estado');
  /** PCs marcadas (modo selección) */
  readonly seleccion = input<number[]>([]);
  readonly seleccionChange = output<number[]>();
  /** Selección para un correctivo: también PCs en mantenimiento o inactivas */
  readonly permitirNoActivas = input(false);

  protected readonly estados = ESTADOS;
  protected readonly conexiones = CONEXIONES;
  /** PC cuya ventana de propiedades está abierta */
  protected readonly verComponentes = signal<AmbientePc | null>(null);
  /** Menú del clic derecho: PC y posición dentro del croquis */
  protected readonly menu = signal<{ pc: AmbientePc; x: number; y: number } | null>(null);
  private readonly raiz = viewChild.required<ElementRef<HTMLElement>>('raiz');
  /** Celular: PC cuyo menú de acciones (desde abajo) está abierto */
  protected readonly hojaAcciones = signal<AmbientePc | null>(null);
  /** Mantener presionado: temporizador, dónde empezó el dedo y si fue táctil */
  private temporizadorPulsacion: ReturnType<typeof setTimeout> | null = null;
  private inicioPulsacion = { x: 0, y: 0 };
  private punteroTactil = false;
  /** El clic que llega al soltar después de mantener presionado no debe marcar la PC */
  private ignorarClic = false;
  /** Panel de opciones de "Imprimir lista" */
  protected readonly opcionesImpresion = signal(false);
  protected readonly incluirDocente = signal(true);
  protected readonly soloActivas = signal(false);
  protected readonly generandoPdf = signal(false);
  protected readonly opciones = OPCIONES;
  protected readonly mesasPorFila = MESAS_POR_FILA;
  protected readonly activa = signal<AmbientePc | null>(null);
  protected readonly multiple = signal(false);
  protected readonly marcadas = signal<number[]>([]);
  protected readonly guardando = signal(false);
  /** Cambio de estado esperando la ficha de reparación de cada PC */
  protected readonly porCambiar = signal<{ pcs: AmbientePc[]; estado: EstadoPc; despues?: () => void } | null>(null);
  private readonly fichas = viewChild(FichasReparacionComponent);
  /** PCs con una solicitud de baja pendiente */
  protected readonly bajaPendiente = signal<Set<number>>(new Set());

  protected readonly todasLasPcs = computed(() => this.catalogos.pcsPorAmbiente().get(this.ambienteId()) ?? []);
  /** PCs de baja: no se dibujan en el plano (van en su propia tira, debajo) */
  protected readonly deBaja = computed(() => this.todasLasPcs().filter((pc) => pc.estado === 'baja'));
  /** PC docente del plano (si está de baja, la zona del docente queda vacía) */
  protected readonly docente = computed(() => this.todasLasPcs().find((pc) => esPcDocente(pc) && pc.estado !== 'baja') ?? null);
  /** PCs de alumnos que van en el plano (sin las de baja) */
  protected readonly maquinas = computed(() => this.todasLasPcs().filter((pc) => !esPcDocente(pc) && pc.estado !== 'baja'));
  /** Todas las PCs de alumnos, también las de baja (al acomodar se pueden volver a poner) */
  protected readonly alumnos = computed(() => this.todasLasPcs().filter((pc) => !esPcDocente(pc)));
  protected readonly esDocente = esPcDocente;
  /** PCs que se pueden marcar en un ticket */
  protected readonly activas = computed(() => this.todasLasPcs().filter((pc) => this.seleccionable(pc)));
  protected readonly noDisponibles = computed(() => this.todasLasPcs().length - this.activas().length);

  /**
   * Acomodo guardado del laboratorio. Si nunca se acomodó, se arma con la
   * regla de siempre (mesas de 4 PCs, 4 mesas por fila).
   */
  protected readonly acomodoGuardado = computed<Acomodo>(() => {
    const lab = this.catalogos.mapaAmbientes().get(this.ambienteId());
    const pcs = this.maquinas();
    if (!lab?.croquis_filas || !lab.croquis_columnas) return acomodoPlantilla(pcs, PCS_POR_MESA, MESAS_POR_FILA, 0);
    const filas = lab.croquis_filas, columnas = lab.croquis_columnas;
    const pos: Record<number, Casilla | null> = {};
    for (const pc of pcs) {
      const f = pc.croquis_fila, c = pc.croquis_columna;
      pos[pc.id] = f !== null && c !== null && f < filas && c < columnas ? [f, c] : null;
    }
    const filaDocente = this.docente()?.croquis_fila ?? 0;
    // Lugares vacíos dentro de la cuadrícula y que no pisan una PC
    const conPc = new Set(Object.values(pos).filter((p): p is Casilla => !!p).map((p) => p[0] + '-' + p[1]));
    const huecos: Casilla[] = [];
    for (const h of Array.isArray(lab.croquis_huecos) ? lab.croquis_huecos : []) {
      const f = Number(h?.[0]), c = Number(h?.[1]);
      if (Number.isInteger(f) && Number.isInteger(c) && f >= 0 && c >= 0 && f < filas && c < columnas
          && !conPc.has(f + '-' + c) && !huecos.some((x) => x[0] === f && x[1] === c)) huecos.push([f, c]);
    }
    return { filas, columnas, pos, docente: Math.min(Math.max(0, filaDocente), filas - 1), huecos };
  });

  // ---- Acomodar el croquis (arrastrar las PCs) ----
  protected readonly editando = signal(false);
  /** Acomodo que se está editando (null: se muestra el guardado) */
  private readonly borrador = signal<Acomodo | null>(null);
  protected readonly acomodo = computed(() => this.borrador() ?? this.acomodoGuardado());
  /** Acomodos anteriores para Deshacer */
  protected readonly historial = signal<Acomodo[]>([]);
  /** Lo deshecho, para Rehacer (Ctrl+Y) */
  private readonly futuro = signal<Acomodo[]>([]);
  /** PC elegida con un toque (luego se toca a dónde va) */
  protected readonly elegida = signal<number | null>(null);
  protected readonly elegidaPc = computed(() => this.todasLasPcs().find((pc) => pc.id === this.elegida()) ?? null);
  /** Columna o fila tocada en el borde (insertar / quitar) */
  protected readonly menuCab = signal<{ tipo: 'col' | 'fila'; k: number } | null>(null);
  protected readonly verPlantilla = signal(false);
  /** Modo "Lugar vacío": tocar una casilla pone o quita un lugar vacío */
  protected readonly modoHueco = signal(false);
  protected readonly plantillaPorMesa = signal(PCS_POR_MESA);
  protected readonly plantillaMesasFila = signal(MESAS_POR_FILA);
  protected readonly plantillaPasillo = signal(0);
  protected readonly guardandoCroquis = signal(false);
  /** Casilla (o la bandeja) sobre la que está la PC arrastrada */
  protected readonly destino = signal<Casilla2 | 'bandeja' | null>(null, {
    equal: (a, b) => a === b || (typeof a === 'object' && typeof b === 'object' && a?.f === b?.f && a?.c === b?.c),
  });
  protected readonly arrastrandoId = signal<number | null>(null);
  private readonly rejilla = viewChild<ElementRef<HTMLElement>>('rejilla');
  private readonly bandeja = viewChild<ElementRef<HTMLElement>>('bandeja');
  private readonly zonaDocente = viewChild<ElementRef<HTMLElement>>('zonaDocente');
  private arrastre: { pc: AmbientePc; el: HTMLElement; x: number; y: number; activo: boolean; fantasma: HTMLElement | null } | null = null;
  /** El clic que llega justo después de soltar un arrastre no cuenta */
  private finArrastre = 0;
  private readonly alMover = (e: PointerEvent) => this.moverArrastre(e);
  private readonly alSoltar = () => this.soltarArrastre(true);
  private readonly alCancelar = () => this.soltarArrastre(false);

  /** Lo que se dibuja: casillas, mesas, PCs ubicadas y sin ubicar */
  protected readonly vista = computed(() => {
    const a = this.acomodo();
    const ed = this.editando();
    // Al editar se agrega una franja ＋ a la derecha y abajo para crecer arrastrando
    const columnas = a.columnas + (ed && a.columnas < MAX_LINEAS ? 1 : 0);
    const filas = a.filas + (ed && a.filas < MAX_LINEAS ? 1 : 0);
    const ocupada = new Set<string>();
    const ubicadas: { pc: AmbientePc; f: number; c: number }[] = [];
    const sinUbicar: AmbientePc[] = [];
    // Al acomodar también entran las de baja (en "Sin ubicar", en rojo) para poder devolverlas al plano
    for (const pc of ed ? this.alumnos() : this.maquinas()) {
      const p = a.pos[pc.id];
      if (p) {
        ubicadas.push({ pc, f: p[0], c: p[1] });
        ocupada.add(p[0] + '-' + p[1]);
      } else sinUbicar.push(pc);
    }
    // Los lugares vacíos cuentan como puesto de la mesa (no la cortan)
    const huecos = a.huecos.map(([f, c]) => ({ f, c }));
    for (const h of huecos) ocupada.add(h.f + '-' + h.c);
    // Mesa = PCs (o lugares vacíos) seguidos en una misma columna
    const mesas: { c: number; desde: number; hasta: number }[] = [];
    for (let c = 0; c < a.columnas; c++) {
      let desde: number | null = null;
      for (let f = 0; f <= a.filas; f++) {
        const hay = f < a.filas && ocupada.has(f + '-' + c);
        if (hay && desde === null) desde = f;
        if (!hay && desde !== null) {
          mesas.push({ c, desde, hasta: f - 1 });
          desde = null;
        }
      }
    }
    const celdas: { f: number; c: number; nueva: boolean }[] = [];
    if (ed) for (let f = 0; f < filas; f++) for (let c = 0; c < columnas; c++) celdas.push({ f, c, nueva: f >= a.filas || c >= a.columnas });
    // Tamaño de columnas y filas: las mesas llenan el ancho (como antes); fuera de la
    // edición, una columna vacía (pasillo) o una fila vacía entre mesas queda angosta
    const colUsada = new Set([...ubicadas, ...huecos].map((u) => u.c));
    const filaUsada = new Set([...ubicadas, ...huecos].map((u) => u.f));
    if (this.docente()) filaUsada.add(a.docente);
    // Al editar, las vacías y la franja ＋ quedan algo más anchas para poder soltar ahí (sin mucho scroll)
    const plantillaColumnas = Array.from({ length: columnas }, (_, c) =>
      colUsada.has(c) ? 'minmax(2.25rem, 1fr)' : !ed ? '1.25rem' : c >= a.columnas ? '1.75rem' : '1.5rem').join(' ');
    const plantillaFilas = Array.from({ length: filas }, (_, f) =>
      filaUsada.has(f) ? 'var(--alto-celda)' : ed ? '1.5rem' : '0.5rem').join(' ');
    return {
      filas, columnas, ubicadas, sinUbicar, huecos, mesas, celdas, plantillaColumnas, plantillaFilas,
      indicesCol: Array.from({ length: columnas }, (_, i) => i),
      indicesFila: Array.from({ length: filas }, (_, i) => i),
    };
  });


  /** 0 -> "A" */
  protected letra(k: number): string {
    return k < 26 ? String.fromCharCode(65 + k) : 'A' + String.fromCharCode(65 + k - 26);
  }

  protected numero1(evento: Event, min: number, max: number): number {
    const n = Math.round(Number((evento.target as HTMLInputElement).value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  }

  /** Acomodar: admin y encargado */
  protected puedeAcomodar(): boolean {
    return this.auth.puedeGestionarAuxiliares();
  }

  protected entrarEdicion(): void {
    this.multiple.set(false);
    this.marcadas.set([]);
    this.activa.set(null);
    this.menu.set(null);
    this.porCambiar.set(null);
    this.borrador.set(clonarAcomodo(this.acomodoGuardado()));
    this.historial.set([]);
    this.futuro.set([]);
    this.editando.set(true);
  }

  protected salirEdicion(): void {
    this.editando.set(false);
    this.borrador.set(null);
    this.historial.set([]);
    this.futuro.set([]);
    this.elegida.set(null);
    this.menuCab.set(null);
    this.verPlantilla.set(false);
    this.modoHueco.set(false);
  }

  /**
   * PCs que estaban en el plano guardado y ahora se sacaron (y no están de
   * baja): quitarlas del croquis es darlas de baja.
   */
  private quitadasDelPlano(): AmbientePc[] {
    const antes = this.acomodoGuardado().pos;
    const ahora = this.acomodo().pos;
    return this.maquinas().filter((pc) => antes[pc.id] && !ahora[pc.id]);
  }

  /** PCs de baja que al acomodar se volvieron a poner en el plano: quedan Activas */
  private devueltasAlPlano(): AmbientePc[] {
    const ahora = this.acomodo().pos;
    return this.alumnos().filter((pc) => pc.estado === 'baja' && ahora[pc.id]);
  }

  /**
   * Estado con que se dibuja la PC. Mientras se acomoda se ve cómo quedará:
   * roja si se quitó del plano y verde si una de baja se volvió a poner.
   */
  private estadoVisto(pc: AmbientePc): EstadoPc {
    if (!this.editando() || esPcDocente(pc)) return pc.estado;
    const ahora = this.acomodo().pos[pc.id];
    if (pc.estado === 'baja') return ahora ? 'operativa' : 'baja';
    return this.acomodoGuardado().pos[pc.id] && !ahora ? 'baja' : pc.estado;
  }

  /**
   * Guarda el acomodo, sin pedir fichas:
   *  - las PCs quitadas del plano quedan de baja (motivo por defecto),
   *  - las de baja que se pusieron en el plano vuelven a Activa.
   * Ambas cosas dejan su ticket a nombre de quien guardó y salen en su
   * cierre de turno y en Desempeño.
   */
  protected async guardarCroquis(): Promise<void> {
    const quitadas = this.quitadasDelPlano();
    const devueltas = this.devueltasAlPlano();
    const a = this.acomodo();
    const posiciones = this.alumnos()
      .map((pc) => ({ pc, p: a.pos[pc.id] }))
      .filter((x): x is { pc: AmbientePc; p: Casilla } => !!x.p)
      .map(({ pc, p }) => ({ pc_id: pc.id, fila: p[0], columna: p[1] }));
    const sueltas = this.maquinas().filter((pc) => !a.pos[pc.id]).length - quitadas.length;
    this.guardandoCroquis.set(true);
    let cambiaronEstados = false;
    try {
      // 1) Quitadas: de baja con el motivo por defecto
      if (quitadas.length) {
        await this.operacion.cambiarEstadoPcs(quitadas.map((pc) => pc.id), 'baja', MOTIVO_BAJA_CROQUIS);
        cambiaronEstados = true;
      }
      // 2) Devueltas al plano: vuelven a Activa (antes de guardar, porque el plano no acepta PCs de baja)
      if (devueltas.length) {
        await this.operacion.cambiarEstadoPcs(devueltas.map((pc) => pc.id), 'operativa', MOTIVO_DEVUELTA_CROQUIS);
        cambiaronEstados = true;
      }
      // 3) Guardar el acomodo
      await this.catalogos.guardarCroquis(this.ambienteId(), a.filas, a.columnas, posiciones, this.docente() ? a.docente : null,
        a.huecos.filter(([f, c]) => f < a.filas && c < a.columnas && !posiciones.some((p) => p.fila === f && p.columna === c)));
      void this.cargarSolicitudes();
      this.salirEdicion();
      this.notificaciones.exito('Croquis guardado.'
        + (quitadas.length ? ` ${quitadas.length} PC(s) de baja.` : '')
        + (devueltas.length ? ` ${devueltas.length} PC(s) otra vez activas.` : '')
        + (quitadas.length || devueltas.length ? ' Saldrán en tu cierre de turno.' : '')
        + (sueltas > 0 ? ` ${sueltas} PC(s) quedaron sin ubicar.` : ''));
    } catch (e) {
      // Si algún estado ya cambió, se recargan las PCs para que el plano muestre lo real
      if (cambiaronEstados) await this.catalogos.recargar('ambiente_pcs').catch(() => undefined);
      this.notificaciones.error(e, 'No se guardó el croquis');
    } finally {
      this.guardandoCroquis.set(false);
    }
  }

  /** Ctrl+Z deshace y Ctrl+Y (o Ctrl+Shift+Z) rehace mientras se acomoda */
  protected teclaEdicion(evento: KeyboardEvent): void {
    if (!this.editando() || !(evento.ctrlKey || evento.metaKey) || this.arrastre?.activo) return;
    // En los números de la plantilla, Ctrl+Z es del cuadro de texto
    if ((evento.target as HTMLElement | null)?.closest('input, textarea, select')) return;
    const tecla = evento.key.toLowerCase();
    if (tecla === 'z' && !evento.shiftKey) {
      evento.preventDefault();
      this.deshacer();
    } else if (tecla === 'y' || (tecla === 'z' && evento.shiftKey)) {
      evento.preventDefault();
      this.rehacer();
    }
  }

  protected rehacer(): void {
    const f = this.futuro();
    if (!f.length) return;
    this.historial.update((h) => [...h, this.acomodo()]);
    this.borrador.set(f[f.length - 1]);
    this.futuro.set(f.slice(0, -1));
    this.elegida.set(null);
  }

  protected deshacer(): void {
    const h = this.historial();
    if (!h.length) return;
    this.futuro.update((f) => [...f, this.acomodo()]);
    this.borrador.set(h[h.length - 1]);
    this.historial.set(h.slice(0, -1));
    this.elegida.set(null);
  }

  /** Aplica un cambio al borrador guardando el estado anterior para Deshacer */
  private cambiar(fn: (a: Acomodo) => void): void {
    const actual = this.acomodo();
    const copia = clonarAcomodo(actual);
    fn(copia);
    recortarFinal(copia, !!this.docente()); // así el plano no crece de más
    this.historial.update((h) => [...h.slice(-49), actual]);
    this.futuro.set([]);
    this.borrador.set(copia);
  }

  /** Lleva una PC a una casilla (si hay otra PC ahí, intercambian) o la saca del plano (null) */
  private moverPc(id: number, destino: Casilla | null): void {
    const a = this.acomodo();
    const origen = a.pos[id] ?? null;
    if (destino ? origen?.[0] === destino[0] && origen?.[1] === destino[1] : !origen) return;
    this.cambiar((b) => {
      if (destino) {
        const [f, c] = destino;
        b.filas = Math.max(b.filas, f + 1); // soltó en la franja ＋ de abajo
        b.columnas = Math.max(b.columnas, c + 1); // soltó en la franja ＋ de la derecha
        const otra = Object.keys(b.pos).map(Number).find((k) => k !== id && b.pos[k]?.[0] === f && b.pos[k]?.[1] === c);
        if (otra !== undefined) b.pos[otra] = origen;
        sacarHueco(b, f, c); // la PC ocupa el lugar vacío
      }
      b.pos[id] = destino;
    });
  }

  protected hayOtraEn(f: number, c: number): boolean {
    const id = this.arrastrandoId();
    const pos = this.acomodo().pos;
    return Object.keys(pos).some((k) => +k !== id && pos[+k]?.[0] === f && pos[+k]?.[1] === c);
  }

  protected tocarCabecera(tipo: 'col' | 'fila', k: number): void {
    const m = this.menuCab();
    this.menuCab.set(m?.tipo === tipo && m.k === k ? null : { tipo, k });
    this.verPlantilla.set(false);
  }

  protected lineaVacia(tipo: 'col' | 'fila', k: number): boolean {
    const a = this.acomodo();
    if (tipo === 'fila' && this.docente() && a.docente === k) return false;
    const i = tipo === 'col' ? 1 : 0;
    return !Object.values(a.pos).some((p) => p?.[i] === k);
  }

  protected insertar(tipo: 'col' | 'fila', k: number, antes: boolean): void {
    const a = this.acomodo();
    if ((tipo === 'col' ? a.columnas : a.filas) >= MAX_LINEAS) {
      this.notificaciones.aviso(`El croquis llega hasta ${MAX_LINEAS} ${tipo === 'col' ? 'columnas' : 'filas'}.`);
      return;
    }
    const desde = antes ? k : k + 1;
    const i = tipo === 'col' ? 1 : 0;
    this.cambiar((b) => {
      for (const id of Object.keys(b.pos).map(Number)) {
        const p = b.pos[id];
        if (p && p[i] >= desde) b.pos[id] = i ? [p[0], p[1] + 1] : [p[0] + 1, p[1]];
      }
      b.huecos = b.huecos.map((h) => (h[i] >= desde ? (i ? [h[0], h[1] + 1] : [h[0] + 1, h[1]]) : h) as Casilla);
      if (i) b.columnas++;
      else {
        b.filas++;
        if (b.docente >= desde) b.docente++;
      }
    });
    // La columna / fila elegida se corrió un lugar
    if (antes) this.menuCab.set({ tipo, k: k + 1 });
  }

  protected quitar(tipo: 'col' | 'fila', k: number): void {
    const a = this.acomodo();
    if (!this.lineaVacia(tipo, k) || (tipo === 'col' ? a.columnas : a.filas) <= 1) return;
    this.cambiar((b) => quitarLinea(b, tipo, k));
    this.menuCab.set(null);
  }

  protected aplicarPlantilla(): void {
    const nuevo = acomodoPlantilla(this.maquinas(), this.plantillaPorMesa(), this.plantillaMesasFila(), this.plantillaPasillo());
    nuevo.docente = Math.min(this.acomodo().docente, nuevo.filas - 1); // la PC docente se queda donde estaba
    if (nuevo.filas > MAX_LINEAS || nuevo.columnas > MAX_LINEAS) {
      this.notificaciones.aviso(`Así el croquis pasa de ${MAX_LINEAS} filas o columnas. Prueba con más mesas por fila o más PCs por mesa.`);
      return;
    }
    this.cambiar((b) => Object.assign(b, nuevo));
    this.verPlantilla.set(false);
    this.elegida.set(null);
  }

  /** Editando: tocar una PC la elige; si ya había otra elegida, se intercambian */
  private tocarEnEdicion(pc: AmbientePc): void {
    this.modoHueco.set(false);
    const yo = this.elegida();
    const idDocente = this.docente()?.id;
    // La PC docente no se intercambia con las de alumnos: solo cambia cuál está elegida
    if (!yo || yo === pc.id || pc.id === idDocente || yo === idDocente) {
      this.elegida.set(yo === pc.id ? null : pc.id);
      return;
    }
    const pos = this.acomodo().pos;
    const suya = pos[pc.id] ?? null;
    const mia = pos[yo] ?? null;
    this.elegida.set(null);
    if (suya) this.moverPc(yo, suya);
    else if (!mia) this.elegida.set(pc.id); // las dos sin ubicar: solo cambia la elegida
    else this.cambiar((b) => { b.pos[pc.id] = mia; b.pos[yo] = null; });
  }

  protected tocarCelda(f: number, c: number): void {
    if (this.modoHueco()) {
      if (Date.now() - this.finArrastre < 350) return;
      this.alternarHueco(f, c);
      return;
    }
    const id = this.elegida();
    if (!id || id === this.docente()?.id || Date.now() - this.finArrastre < 350) return;
    this.elegida.set(null);
    this.moverPc(id, [f, c]);
  }

  /** Pone o quita un lugar vacío en una casilla sin PC */
  private alternarHueco(f: number, c: number): void {
    if (this.hayOtraEn(f, c)) return;
    if (!hayHueco(this.acomodo(), f, c) && (f >= MAX_LINEAS || c >= MAX_LINEAS)) return;
    this.cambiar((b) => {
      if (hayHueco(b, f, c)) sacarHueco(b, f, c);
      else {
        b.huecos.push([f, c]);
        b.filas = Math.max(b.filas, f + 1); // tocó la franja ＋ de abajo
        b.columnas = Math.max(b.columnas, c + 1); // tocó la franja ＋ de la derecha
      }
    });
  }

  protected alternarModoHueco(): void {
    this.modoHueco.set(!this.modoHueco());
    this.elegida.set(null);
    this.menuCab.set(null);
    this.verPlantilla.set(false);
  }

  protected tocarBandeja(): void {
    const id = this.elegida();
    if (!this.editando() || !id || id === this.docente()?.id || Date.now() - this.finArrastre < 350) return;
    this.elegida.set(null);
    this.moverPc(id, null);
  }

  /** Casilla de la zona del docente: solo recibe a la PC docente */
  protected tocarCeldaDocente(f: number): void {
    if (this.elegida() !== this.docente()?.id || Date.now() - this.finArrastre < 350) return;
    this.elegida.set(null);
    this.moverDocente(f);
  }

  /** Sube o baja la PC docente dentro de su zona */
  private moverDocente(f: number): void {
    if (this.acomodo().docente === f) return;
    this.cambiar((b) => {
      b.docente = f;
      b.filas = Math.max(b.filas, f + 1); // soltó en la franja ＋ de abajo
    });
  }

  /** Editando: el ratón o el dedo empieza a arrastrar una PC (arranca al moverse unos píxeles) */
  private iniciarArrastre(evento: PointerEvent, pc: AmbientePc): void {
    if (evento.button > 0) return;
    this.soltarArrastre(false);
    this.arrastre = { pc, el: evento.currentTarget as HTMLElement, x: evento.clientX, y: evento.clientY, activo: false, fantasma: null };
    document.addEventListener('pointermove', this.alMover);
    document.addEventListener('pointerup', this.alSoltar);
    document.addEventListener('pointercancel', this.alCancelar);
  }

  private moverArrastre(evento: PointerEvent): void {
    const a = this.arrastre;
    if (!a) return;
    if (!a.activo) {
      if (Math.hypot(evento.clientX - a.x, evento.clientY - a.y) < 6) return;
      a.activo = true;
      this.elegida.set(null);
      this.menuCab.set(null);
      // Copia de la PC que sigue al puntero
      const f = a.el.cloneNode(true) as HTMLElement;
      Object.assign(f.style, {
        position: 'fixed', zIndex: '100', pointerEvents: 'none', margin: '0',
        width: a.el.offsetWidth + 'px', height: a.el.offsetHeight + 'px',
        transform: 'translate(-50%, -50%) scale(1.1) rotate(-3deg)',
        background: 'var(--color-superficie, #fff)', border: '2px solid var(--color-marca-500, #2747a8)',
        borderRadius: '8px', boxShadow: '0 10px 24px rgb(15 23 42 / .25)',
      });
      document.body.appendChild(f);
      a.fantasma = f;
      this.arrastrandoId.set(a.pc.id);
      navigator.vibrate?.(10);
    }
    evento.preventDefault();
    a.fantasma!.style.left = evento.clientX + 'px';
    a.fantasma!.style.top = evento.clientY + 'px';
    this.destino.set(this.calcularDestino(evento.clientX, evento.clientY));
  }

  /** Casilla (o bandeja) debajo del puntero; en el hueco entre casillas se mantiene la anterior */
  private calcularDestino(x: number, y: number): Casilla2 | 'bandeja' | null {
    const dentro = (r: DOMRect) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    // La PC docente solo va a las casillas de su zona (c = -1)
    if (this.arrastre?.pc.id === this.docente()?.id) {
      const zona = this.zonaDocente()?.nativeElement;
      if (!zona) return null;
      for (const celda of Array.from(zona.querySelectorAll<HTMLElement>('[data-docente]'))) {
        if (dentro(celda.getBoundingClientRect())) return { f: Number(celda.dataset['docente']), c: -1 };
      }
      return dentro(zona.getBoundingClientRect()) ? this.destino() : null;
    }
    const bandeja = this.bandeja()?.nativeElement;
    if (bandeja && dentro(bandeja.getBoundingClientRect())) return 'bandeja';
    const rejilla = this.rejilla()?.nativeElement;
    if (!rejilla) return null;
    for (const celda of Array.from(rejilla.querySelectorAll<HTMLElement>('[data-f]'))) {
      if (dentro(celda.getBoundingClientRect())) return { f: Number(celda.dataset['f']), c: Number(celda.dataset['c']) };
    }
    return dentro(rejilla.getBoundingClientRect()) ? this.destino() : null;
  }

  private soltarArrastre(aplicar: boolean): void {
    document.removeEventListener('pointermove', this.alMover);
    document.removeEventListener('pointerup', this.alSoltar);
    document.removeEventListener('pointercancel', this.alCancelar);
    const a = this.arrastre;
    this.arrastre = null;
    if (!a?.activo) return;
    a.fantasma?.remove();
    this.finArrastre = Date.now();
    const d = this.destino();
    this.destino.set(null);
    this.arrastrandoId.set(null);
    if (!aplicar || !d) return;
    if (d !== 'bandeja' && d.c < 0) this.moverDocente(d.f);
    else this.moverPc(a.pc.id, d === 'bandeja' ? null : [d.f, d.c]);
  }

  protected readonly cuenta = computed(() => {
    const r: Record<EstadoPc, number> = { operativa: 0, inactiva: 0, mantenimiento: 0, baja: 0 };
    for (const pc of this.todasLasPcs()) r[pc.estado]++;
    return r;
  });

  /** Cuántas PCs del laboratorio están prendidas o apagadas según el agente */
  protected readonly cuentaConexion = computed(() => {
    const r: Record<ConexionPc, number> = { prendida: 0, apagada: 0, sin_agente: 0 };
    for (const pc of this.todasLasPcs()) r[this.agente.conexion(pc.id)]++;
    return r;
  });

  /** Color, ícono y texto del estado de la PC */
  protected info(pc: AmbientePc) {
    return ESTADOS[this.estadoVisto(pc)];
  }

  /**
   * Clic derecho (o mantener presionado en el celular) sobre una PC: abre
   * el menú donde se hizo clic, sin salirse del croquis.
   */
  protected abrirMenu(evento: MouseEvent, pc: AmbientePc): void {
    evento.preventDefault();
    evento.stopPropagation();
    if (this.editando()) return;
    // Android también avisa "clic derecho" al mantener presionado: ahí va el menú de abajo
    if (this.punteroTactil) {
      this.abrirHojaAcciones(pc);
      return;
    }
    const caja = this.raiz().nativeElement.getBoundingClientRect();
    const anchoMenu = 200;
    const altoMenu = 110;
    this.menu.set({
      pc,
      x: Math.max(0, Math.min(evento.clientX - caja.left, caja.width - anchoMenu)),
      y: Math.max(0, Math.min(evento.clientY - caja.top, caja.height - altoMenu)),
    });
  }

  /**
   * El dedo toca una PC: si se queda quieto medio segundo, se abre el menú de
   * abajo. Funciona también en iPhone, que no avisa "clic derecho".
   */
  protected iniciarPulsacion(evento: PointerEvent, pc: AmbientePc): void {
    this.punteroTactil = evento.pointerType !== 'mouse';
    this.ignorarClic = false;
    this.cancelarPulsacion();
    if (this.editando()) {
      this.iniciarArrastre(evento, pc);
      return;
    }
    if (!this.punteroTactil) return;
    this.inicioPulsacion = { x: evento.clientX, y: evento.clientY };
    this.temporizadorPulsacion = setTimeout(() => this.abrirHojaAcciones(pc), 500);
  }

  /** Si el dedo se mueve (está desplazando el croquis), no es "mantener presionado" */
  protected moverPulsacion(evento: PointerEvent): void {
    if (!this.temporizadorPulsacion) return;
    if (Math.hypot(evento.clientX - this.inicioPulsacion.x, evento.clientY - this.inicioPulsacion.y) > 10) this.cancelarPulsacion();
  }

  /** El dedo se levantó o salió antes de tiempo */
  protected cancelarPulsacion(): void {
    if (this.temporizadorPulsacion) clearTimeout(this.temporizadorPulsacion);
    this.temporizadorPulsacion = null;
  }

  /** Abre el menú de abajo (con una vibración corta si el celular la permite) */
  private abrirHojaAcciones(pc: AmbientePc): void {
    this.cancelarPulsacion();
    this.ignorarClic = true;
    this.menu.set(null);
    if (this.hojaAcciones()?.id !== pc.id) navigator.vibrate?.(15);
    this.hojaAcciones.set(pc);
  }

  /** Toque normal: lo de siempre, salvo que venga de soltar tras mantener presionado */
  protected alTocar(pc: AmbientePc): void {
    if (this.ignorarClic) {
      this.ignorarClic = false;
      return;
    }
    if (this.editando()) {
      if (Date.now() - this.finArrastre > 350) this.tocarEnEdicion(pc);
      return;
    }
    this.tocar(pc);
  }

  /** Cierra el menú del clic derecho y el panel de impresión (clic fuera o Escape) */
  protected cerrarMenus(): void {
    this.menu.set(null);
    this.opcionesImpresion.set(false);
  }

  /**
   * Imprime la lista de PCs del laboratorio en hoja carta horizontal:
   * resumen de totales, una fila por PC y líneas para firmar.
   */
  protected imprimirLista(): void {
    this.opcionesImpresion.set(false);
    const datos = this.datosLista();
    const cuerpo = cabeceraHoja(datos.titulo)
      + `<div class="resumen">${datos.totales.map(([texto, n]) => `<span>${escaparHtml(texto)}: <b>${n}</b></span>`).join('')}</div>`
      + `<table><thead><tr>${COLUMNAS_LISTA.map((c) => `<th>${escaparHtml(c)}</th>`).join('')}</tr></thead><tbody>`
      + datos.filas.map((fila) => '<tr>' + fila.map((valor, i) =>
          !valor ? '<td class="vacio">—</td>' : i === 1 ? `<td><b>${escaparHtml(valor)}</b></td>` : `<td>${escaparHtml(valor)}</td>`).join('') + '</tr>').join('')
      + '</tbody></table>' + FIRMAS_HOJA;
    imprimirDocumento(datos.archivo, cuerpo, 'landscape');
  }

  /** Descarga la misma lista como PDF tamaño carta horizontal (sirve en el celular) */
  protected async exportarListaPdf(): Promise<void> {
    this.generandoPdf.set(true);
    try {
      const datos = this.datosLista();
      await exportarPdf({
        archivo: datos.archivo, titulo: datos.titulo, orientacion: 'landscape',
        resumen: datos.totales.map(([texto, n]) => `${texto}: ${n}`).join('   ·   '),
        secciones: [{ columnas: COLUMNAS_LISTA, filas: datos.filas }],
      });
      this.opcionesImpresion.set(false);
    } catch (e) {
      this.notificaciones.error(e, 'No se pudo generar el PDF');
    } finally {
      this.generandoPdf.set(false);
    }
  }

  /** Lo que llevan la hoja impresa y el PDF: título, totales y una fila por PC */
  private datosLista(): { titulo: string; archivo: string; totales: [string, number][]; filas: (string | null)[][] } {
    const lab = this.catalogos.mapaAmbientes().get(this.ambienteId());
    const nombreLab = lab ? `${lab.codigo}${lab.nombre ? ' (' + lab.nombre + ')' : ''}` : 'Laboratorio';
    // La lista es el inventario completo: también las PCs de baja
    const docente = this.todasLasPcs().find(esPcDocente);
    const lista = [...(this.incluirDocente() && docente ? [docente] : []), ...this.todasLasPcs().filter((pc) => !esPcDocente(pc))]
      .filter((pc) => !this.soloActivas() || pc.estado === 'operativa');
    const cuenta = (estado: EstadoPc) => lista.filter((pc) => pc.estado === estado).length;
    return {
      titulo: `Inventario de PCs · ${nombreLab}`,
      archivo: `Inventario ${lab?.codigo ?? 'laboratorio'}`,
      totales: [
        ['Total', lista.length], ['Activas', cuenta('operativa')], ['Inactivas', cuenta('inactiva')],
        ['Mantenimiento', cuenta('mantenimiento')], ['De baja', cuenta('baja')],
        ['Con agente', lista.filter((pc) => this.conexion(pc) !== 'sin_agente').length],
      ],
      filas: lista.map((pc) => [
        esPcDocente(pc) ? 'Doc.' : this.numero(pc), pc.etiqueta, TEXTOS_ESTADO_PC[pc.estado], CONEXIONES[this.conexion(pc)].texto,
        pc.procesador, pc.ram, pc.almacenamiento, this.agente.numeroSerie(pc.id),
      ]),
    };
  }

  /** Prendida, apagada o sin agente */
  protected conexion(pc: AmbientePc): ConexionPc {
    return this.agente.conexion(pc.id);
  }

  constructor() {
    void this.cargarSolicitudes();
    // Mientras el croquis está abierto, el estado de las PCs se refresca solo
    this.agente.activar();
    inject(DestroyRef).onDestroy(() => {
      this.agente.desactivar();
      this.soltarArrastre(false);
    });
  }

  private async cargarSolicitudes(): Promise<void> {
    try {
      this.bajaPendiente.set(new Set((await this.operacion.solicitudesBaja()).map((s) => s.pc_id)));
    } catch {
      this.bajaPendiente.set(new Set());
    }
  }

  /** ¿Se puede marcar en un ticket? Activas; en un correctivo, todas (también las de baja, para repararlas) */
  protected seleccionable(pc: AmbientePc): boolean {
    return pc.estado === 'operativa' || this.permitirNoActivas();
  }

  /** Cambiar el estado: personal de operación */
  protected puedeCambiar(): boolean {
    return this.auth.puedeOperar();
  }

  /** Dar de baja (o reactivar una dada de baja): todo el personal de operación */
  protected puedeDarDeBaja(): boolean {
    return this.auth.puedeOperar();
  }

  /** "SCPC107" -> "07" */
  protected numero(pc: AmbientePc): string {
    return pc.etiqueta.match(/(\d{2})$/)?.[1] ?? pc.etiqueta;
  }

  protected caracteristicas(pc: AmbientePc): string {
    return [pc.procesador, pc.ram, pc.almacenamiento].filter(Boolean).join(' · ');
  }

  protected marcada(pc: AmbientePc): boolean {
    if (this.editando()) return this.elegida() === pc.id;
    if (this.modo() === 'seleccion') return this.seleccion().includes(pc.id);
    if (this.multiple()) return this.marcadas().includes(pc.id);
    return this.activa()?.id === pc.id;
  }

  protected tocar(pc: AmbientePc): void {
    if (this.modo() === 'seleccion') {
      const actual = this.seleccion();
      // Desmarcar siempre se puede; marcar, solo PCs activas
      if (actual.includes(pc.id)) {
        this.emitir(actual.filter((id) => id !== pc.id));
        return;
      }
      if (this.seleccionable(pc)) {
        this.emitir([...actual, pc.id]);
        return;
      }
      void this.activarYMarcar(pc);
      return;
    }
    if (this.multiple()) {
      this.marcadas.update((m) => (m.includes(pc.id) ? m.filter((id) => id !== pc.id) : [...m, pc.id]));
      return;
    }
    this.activa.set(this.activa()?.id === pc.id ? null : pc);
  }

  protected emitir(ids: number[]): void {
    this.seleccionChange.emit(ids);
  }

  protected todas(): void {
    this.emitir(this.activas().map((pc) => pc.id));
  }

  /** PC en mantenimiento o inactiva: se ofrece pasarla a Activa y marcarla */
  private async activarYMarcar(pc: AmbientePc): Promise<void> {
    if (pc.estado === 'baja') {
      this.notificaciones.aviso(`${pc.etiqueta} está de baja: no se le pueden registrar tickets.`);
      return;
    }
    // Pasa a Activa (pide qué se reparó) y luego la marca en el ticket
    this.pedirCambio([pc], 'operativa', () => this.emitir([...this.seleccion(), pc.id]));
  }

  /** Todo cambio de estado abre la ficha de reparación de cada PC */
  protected pedirCambio(pcs: AmbientePc[], estado: EstadoPc, despues?: () => void): void {
    if (!this.puedeCambiar() || !pcs.length) return;
    this.porCambiar.set({ pcs, estado, despues });
  }

  /** Guarda las fichas: un correctivo por PC con su cambio de estado */
  protected async confirmarCambio(): Promise<void> {
    const c = this.porCambiar();
    const fichas = this.fichas();
    if (!c || !fichas) return;
    const aviso = fichas.validar();
    if (aviso) {
      this.notificaciones.aviso(aviso);
      return;
    }
    this.guardando.set(true);
    try {
      const datos = fichas.datos();
      await this.operacion.registrarReparaciones(datos);
      await Promise.all([this.catalogos.recargar('ambiente_pcs'), this.cargarSolicitudes()]);
      this.activa.set(null);
      this.marcadas.set([]);
      this.porCambiar.set(null);
      const bajas = datos.filter((x) => x.estado_final === 'baja').length;
      this.notificaciones.exito(`${datos.length === 1 ? c.pcs[0].etiqueta : datos.length + ' PCs'}: ficha guardada como correctivo.${bajas ? ' La baja saldrá en tu cierre de turno.' : ''}`);
      c.despues?.();
    } catch (e) {
      this.notificaciones.error(e, 'No se guardó');
    } finally {
      this.guardando.set(false);
    }
  }

  protected alternarMultiple(): void {
    this.multiple.update((m) => !m);
    this.marcadas.set([]);
    this.activa.set(null);
  }

  protected cambiarMarcadas(estado: EstadoPc): void {
    const ids = new Set(this.marcadas());
    this.pedirCambio(this.todasLasPcs().filter((pc) => ids.has(pc.id)), estado);
  }
}
