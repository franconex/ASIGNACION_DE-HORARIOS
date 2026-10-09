import { DatePipe } from '@angular/common';
import { Component, computed, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BuscadorComponent, normalizar, OpcionBuscador } from '../../compartido/buscador.component';
import { FichasReparacionComponent } from '../../compartido/fichas-reparacion.component';
import { IconoComponent } from '../../compartido/icono.component';
import { ModalComponent } from '../../compartido/modal.component';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { descargarCsv } from '../../core/exportar';
import { AmbientePc, Atencion, EstadoAtencion, Perfil, SolicitudBaja, TipoAtencion, TurnoCodigo } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { FiltroOperacion, OperacionService } from '../../core/operacion.service';
import {
  ACCIONES_PROGRAMA, CATEGORIAS_TICKET, CategoriaTicket, CHECKLIST_PREVENTIVO, COLOR_CATEGORIA, DetallesTicket,
  PEDIDOS_DOCENTE, RESULTADOS_CORRECTIVO, SUBTIPOS_TECNICO, textoDe, TIPOS_PERSONA, TIPOS_TICKET,
} from '../../core/tickets';
import { LaboratorioCroquisComponent } from '../panel/laboratorio-croquis.component';

const PRIORIDADES: Record<number, { texto: string; clase: string }> = {
  1: { texto: 'Alta', clase: 'bg-red-100 text-red-700' },
  2: { texto: 'Media', clase: 'bg-amber-100 text-amber-800' },
  3: { texto: 'Baja', clase: 'bg-slate-100 text-slate-600' },
};
const ESTADOS: Record<EstadoAtencion, { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente', clase: 'bg-amber-100 text-amber-800' },
  en_proceso: { texto: 'En proceso', clase: 'bg-sky-100 text-sky-700' },
  resuelto: { texto: 'Resuelto', clase: 'bg-emerald-100 text-emerald-700' },
};
/** Tipos que se hacen sobre PCs: laboratorio y PCs obligatorios */
const TIPOS_CON_PC: TipoAtencion[] = ['programas', 'preventivo', 'correctivo'];

/** Tickets creados juntos (mismo lote) se muestran como una sola fila */
interface Grupo {
  clave: string;
  tickets: Atencion[];
  primero: Atencion;
  estado: EstadoAtencion;
  resueltos: number;
}

/** Datos del formulario: un ticket con varias PCs */
interface FormTicket extends Partial<Atencion> {
  categoria: Exclude<CategoriaTicket, 'sistema'>;
  det: DetallesTicket;
  pcs: number[];
  colaboradores: string[];
  /** Mostrar el croquis en atención a docente (opcional) */
  verPcs: boolean;
  /** El docente no está en la lista: se escribe su nombre */
  otroSolicitante: boolean;
}

/**
 * Atenciones (tickets) en 3 categorías, cada tipo con su formulario:
 *  1. Atención a docente: laboratorio, docente y qué pidió.
 *  2. Técnico: programas (qué se instaló), mantenimiento preventivo
 *     (checklist) y correctivo: una FICHA POR PC (fallas, diagnóstico,
 *     corrección, pieza y cómo queda la PC), que cambia su estado.
 *  3. Atención personal: atención académica a una persona.
 * Cada PC marcada se guarda como un ticket, unidos por el mismo lote.
 * Arriba, las solicitudes de baja pendientes (las resuelve admin/encargado).
 */
@Component({
  selector: 'app-atenciones-lista',
  imports: [FormsModule, IconoComponent, ModalComponent, DatePipe, LaboratorioCroquisComponent, BuscadorComponent, FichasReparacionComponent],
  template: `
    <!-- SOLICITUDES DE BAJA -->
    @if (solicitudes().length) {
      <section class="tarjeta mb-4 border-l-4 border-l-rose-500 p-3">
        <h2 class="mb-2 flex items-center gap-2 text-sm font-semibold">
          <app-icono nombre="alerta" [tamano]="16" class="text-rose-600" /> Solicitudes de baja pendientes
          <span class="chip bg-rose-100 text-rose-700">{{ solicitudes().length }}</span>
        </h2>
        <div class="space-y-1.5">
          @for (s of solicitudes(); track s.id) {
            <div class="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span class="font-mono font-semibold">{{ s.pc?.etiqueta }}</span>
              <span class="text-slate-500">{{ s.pc?.ambiente?.codigo }}</span>
              <span class="min-w-40 flex-1">{{ s.motivo }}</span>
              <span class="text-xs text-slate-400">{{ s.autor?.nombre_completo }} · {{ s.solicitado_en | date: 'dd/MM HH:mm' }}</span>
              @if (auth.puedeGestionarAuxiliares()) {
                <button class="btn-sm rounded-lg bg-rose-600 px-3 text-white hover:bg-rose-700" (click)="resolverBaja(s, true)">Dar de baja</button>
                <button class="btn-secundario btn-sm" (click)="resolverBaja(s, false)">Rechazar</button>
              } @else {
                <span class="chip bg-amber-100 text-amber-800">Esperando al encargado</span>
              }
            </div>
          }
        </div>
      </section>
    }

    <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div class="flex flex-wrap items-end gap-2">
        <div>
          <label class="etiqueta">Categoría</label>
          <select class="campo !w-44 !py-1.5" [ngModel]="filtroCategoria()" (ngModelChange)="filtroCategoria.set($event)">
            <option [ngValue]="null">Todas</option>
            @for (c of categorias; track c.valor) { <option [ngValue]="c.valor">{{ c.texto }}</option> }
            <option ngValue="sistema">Cambios de estado</option>
          </select>
        </div>
        <div>
          <label class="etiqueta">Laboratorio</label>
          <select class="campo !w-36 !py-1.5" [(ngModel)]="filtroLab" (ngModelChange)="cargar()">
            <option [ngValue]="null">Todos</option>
            @for (lab of laboratorios(); track lab.id) { <option [ngValue]="lab.id">{{ lab.codigo }}</option> }
          </select>
        </div>
        <div>
          <label class="etiqueta">Tickets de</label>
          <div class="flex rounded-lg bg-slate-100 p-0.5">
            <button type="button" class="rounded-md px-3 py-1 text-sm font-medium transition" [class]="soloMios ? 'bg-superficie text-marca-700 shadow-sm' : 'text-slate-500'"
                    (click)="soloMios = true; cargar()">Míos</button>
            <button type="button" class="rounded-md px-3 py-1 text-sm font-medium transition" [class]="!soloMios ? 'bg-superficie text-marca-700 shadow-sm' : 'text-slate-500'"
                    (click)="soloMios = false; cargar()">Todos</button>
          </div>
        </div>
        <div><label class="etiqueta">Desde</label><input type="date" class="campo !w-40 !py-1.5" [(ngModel)]="desde" (ngModelChange)="cargar()"></div>
        <div><label class="etiqueta">Hasta</label><input type="date" class="campo !w-40 !py-1.5" [(ngModel)]="hasta" (ngModelChange)="cargar()"></div>
      </div>
      <div class="flex gap-2">
        <button class="btn-secundario btn-sm" (click)="exportar()" [disabled]="!lista().length"><app-icono nombre="descargar" [tamano]="15" /> Exportar</button>
        @if (auth.puedeOperar()) {
          <button class="btn-primario" (click)="nuevo()"><app-icono nombre="agregar" [tamano]="16" /> Nuevo ticket</button>
        }
      </div>
    </div>

    <p class="mb-2 text-xs text-slate-500">
      {{ filtrados().length }} ticket(s) en {{ grupos().length }} registro(s)@if (soloMios) { · <b>{{ cuentaMia().registre }}</b> registrados por ti y <b>{{ cuentaMia().colabore }}</b> como colaborador }.
    </p>

    <div class="space-y-2">
      @for (g of grupos(); track g.clave) {
        <div class="tarjeta overflow-hidden">
          <div class="flex flex-wrap items-start gap-3 p-3">
            <div class="w-20 shrink-0 text-xs text-slate-500">
              <p class="font-semibold text-slate-700">{{ g.primero.creado_en | date: 'dd/MM' }}</p>
              <p>{{ g.primero.creado_en | date: 'HH:mm' }}</p>
            </div>
            <div class="min-w-56 flex-1">
              <p class="flex flex-wrap items-center gap-1.5 text-sm">
                <span class="chip" [class]="colorCategoria[tipos[g.primero.tipo].categoria]">{{ tipos[g.primero.tipo].texto }}</span>
                <span class="font-semibold">{{ g.primero.ambiente?.codigo || 'Sin lab' }}</span>
                @if (g.primero.prioridad === 1) { <span class="chip" [class]="prioridades[1].clase">Alta</span> }
              </p>

              @switch (g.primero.tipo) {
                @case ('docente') {
                  <p class="mt-0.5 text-sm"><span class="text-slate-500">Docente:</span> {{ solicitante(g.primero) || '—' }}
                    @if (det(g.primero).pedido) { <span class="chip ml-1 bg-sky-50 text-sky-700">{{ textoDe(pedidos, det(g.primero).pedido) }}</span> }</p>
                  <p class="text-sm"><span class="text-slate-500">Pidió:</span> {{ g.primero.descripcion }}</p>
                }
                @case ('programas') {
                  <p class="mt-0.5 text-sm font-medium">{{ g.primero.descripcion }}</p>
                  @if (solicitante(g.primero)) { <p class="text-xs text-slate-500">Lo pidió {{ solicitante(g.primero) }}</p> }
                }
                @case ('preventivo') {
                  <p class="mt-1 flex flex-wrap gap-1">
                    @for (c of det(g.primero).checklist ?? []; track c) { <span class="chip bg-emerald-50 text-emerald-700">✓ {{ textoDe(checklist, c) }}</span> }
                  </p>
                }
                @case ('correctivo') {
                  @if (fichasDistintas(g)) {
                    <!-- Una ficha distinta por PC -->
                    <div class="mt-1 space-y-0.5">
                      @for (t of g.tickets; track t.id) {
                        <p class="text-sm">
                          <b class="font-mono">{{ t.pc?.etiqueta ?? '—' }}</b> {{ t.descripcion }}
                          @if (det(t).resultado; as r) { <span class="chip ml-1" [class]="claseResultado(r)">{{ textoDe(resultados, r) }}</span> }
                          @if (t.pieza) { <span class="text-xs text-slate-500"> · pieza: {{ t.pieza }}</span> }
                        </p>
                      }
                    </div>
                  } @else {
                    <p class="mt-0.5 text-sm"><span class="text-slate-500">Falla:</span> {{ g.primero.descripcion }}
                      @if (det(g.primero).resultado; as r) { <span class="chip ml-1" [class]="claseResultado(r)">{{ textoDe(resultados, r) }}</span> }</p>
                    @if (det(g.primero).diagnostico) { <p class="text-sm"><span class="text-slate-500">Diagnóstico:</span> {{ det(g.primero).diagnostico }}</p> }
                    @if (g.primero.pieza) { <p class="text-sm"><span class="text-slate-500">Pieza cambiada:</span> {{ g.primero.pieza }}</p> }
                  }
                }
                @case ('personal') {
                  <p class="mt-0.5 text-sm"><span class="text-slate-500">Atendió a:</span> {{ det(g.primero).persona || g.primero.solicitante || '—' }}
                    <span class="text-xs text-slate-500">{{ datosPersona(g.primero) }}</span></p>
                  <p class="text-sm"><span class="text-slate-500">Motivo:</span> {{ g.primero.descripcion }}</p>
                }
                @case ('cambio_estado') {
                  <p class="mt-0.5 text-sm"><span class="text-slate-500">Cambio:</span> {{ g.tickets.length > 1 ? g.tickets.length + ' PCs · ' + g.primero.descripcion.split(': ')[1] : g.primero.descripcion }}</p>
                }
              }
              @if (g.primero.solucion) {
                <p class="text-sm"><span class="text-slate-500">{{ etiquetaSolucion(g.primero.tipo) }}</span> {{ g.primero.solucion }}</p>
              }

              <p class="mt-1 flex flex-wrap items-center gap-1">
                @for (t of g.tickets.slice(0, 8); track t.id) {
                  @if (t.pc?.etiqueta) { <span class="chip bg-slate-100 font-mono text-[11px] text-slate-700">{{ t.pc?.etiqueta }}</span> }
                }
                @if (g.tickets.length > 8) { <span class="chip bg-slate-100 text-slate-600">+{{ g.tickets.length - 8 }}</span> }
                @if (g.tickets.length > 1) { <span class="chip bg-indigo-100 text-indigo-700">{{ g.tickets.length }} PCs · {{ g.tickets.length }} tickets</span> }
                <span class="text-xs text-slate-400">{{ g.primero.autor?.nombre_completo ? 'registró ' + g.primero.autor?.nombre_completo : '' }}</span>
                @if (colaboreEn(g.primero)) {
                  <span class="chip bg-amber-100 text-amber-800">Colaboraste</span>
                }
                @if (g.primero.colaboradores?.length) {
                  <span class="chip bg-indigo-50 text-indigo-700"><app-icono nombre="usuarios" [tamano]="11" /> con {{ nombresColaboradores(g.primero) }}</span>
                }
              </p>
            </div>
            <div class="flex flex-col items-end gap-1.5">
              <span class="chip" [class]="estados[g.estado].clase">
                {{ estados[g.estado].texto }}@if (g.tickets.length > 1 && g.estado !== 'resuelto') { · {{ g.resueltos }}/{{ g.tickets.length }} }
              </span>
              <div class="flex gap-0.5">
                @if (g.primero.tipo === 'cambio_estado') {
                  <!-- Registro automático del cambio de estado: no se edita; solo admin/encargado lo puede borrar -->
                  @if (auth.puedeGestionarAuxiliares()) {
                    <button class="btn-fantasma btn-sm text-red-600" (click)="eliminarGrupo(g)" title="Eliminar"><app-icono nombre="eliminar" [tamano]="15" /></button>
                  }
                } @else if (auth.puedeOperar()) {
                  @if (g.estado !== 'resuelto') {
                    <button class="btn-fantasma btn-sm text-emerald-600" (click)="estadoGrupo(g, 'resuelto')" title="Marcar resuelto"><app-icono nombre="check" [tamano]="15" /></button>
                  }
                  <button class="btn-fantasma btn-sm" (click)="editar(g)" title="Editar"><app-icono nombre="editar" [tamano]="15" /></button>
                  <button class="btn-fantasma btn-sm text-red-600" (click)="eliminarGrupo(g)" title="Eliminar"><app-icono nombre="eliminar" [tamano]="15" /></button>
                }
                @if (g.tickets.length > 1) {
                  <button class="btn-fantasma btn-sm" (click)="alternar(g.clave)" title="Ver cada ticket">
                    <app-icono nombre="siguiente" [tamano]="15" class="transition" [class.rotate-90]="abiertos().has(g.clave)" />
                  </button>
                }
              </div>
            </div>
          </div>

          <!-- Detalle: un ticket por PC -->
          @if (abiertos().has(g.clave)) {
            <div class="grid gap-1 border-t border-slate-200 bg-slate-50 p-2 sm:grid-cols-2 lg:grid-cols-3">
              @for (t of g.tickets; track t.id) {
                <div class="flex items-center gap-2 rounded-md bg-superficie px-2 py-1 text-sm">
                  <span class="font-mono text-xs">{{ t.pc?.etiqueta || '—' }}</span>
                  <span class="chip ml-auto" [class]="estados[t.estado].clase">{{ estados[t.estado].texto }}</span>
                  @if (auth.puedeOperar() && t.tipo !== 'cambio_estado') {
                    @if (t.estado !== 'resuelto') {
                      <button class="btn-fantasma btn-sm text-emerald-600" (click)="estadoTicket(t, 'resuelto')" title="Resuelto"><app-icono nombre="check" [tamano]="14" /></button>
                    }
                  }
                </div>
              }
            </div>
          }
        </div>
      } @empty {
        <p class="tarjeta py-10 text-center text-sm text-slate-500">No hay tickets con esos filtros.</p>
      }
    </div>

    <!-- FORMULARIO -->
    <app-modal [abierto]="!!form()" [titulo]="form()?.id ? 'Editar ticket' : 'Nuevo ticket'" ancho="xl" (cerrar)="form.set(null)">
      @if (form(); as f) {
        <form class="space-y-4" (ngSubmit)="guardar()" id="form-atencion">
          <!-- 1. Categoría -->
          <div>
            <label class="etiqueta"><span class="paso">1</span> ¿Qué tipo de atención?</label>
            <div class="grid gap-2 sm:grid-cols-3">
              @for (c of categorias; track c.valor) {
                <button type="button" class="flex items-start gap-2 rounded-lg border-2 px-3 py-2 text-left transition"
                        [class]="f.categoria === c.valor ? 'border-marca-500 bg-marca-50' : 'border-slate-200 hover:border-slate-300'"
                        [attr.aria-pressed]="f.categoria === c.valor" (click)="elegirCategoria(f, c.valor)">
                  <app-icono [nombre]="c.icono" [tamano]="18" class="mt-0.5 shrink-0 text-marca-600" />
                  <span><span class="block text-sm font-semibold">{{ c.texto }}</span><span class="block text-xs text-slate-500">{{ c.ayuda }}</span></span>
                </button>
              }
            </div>
            @if (f.categoria === 'tecnico') {
              <div class="mt-2 grid gap-2 sm:grid-cols-3">
                @for (t of subtiposTecnico; track t.valor) {
                  <button type="button" class="rounded-lg border px-3 py-1.5 text-left transition"
                          [class]="f.tipo === t.valor ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-300 hover:bg-slate-50'"
                          [attr.aria-pressed]="f.tipo === t.valor" (click)="elegirTipo(f, t.valor)">
                    <span class="block text-sm font-semibold">{{ t.texto }}</span>
                    <span class="block text-xs" [class]="f.tipo === t.valor ? 'text-indigo-100' : 'text-slate-500'">{{ t.ayuda }}</span>
                  </button>
                }
              </div>
            }
          </div>

          <!-- 2. Laboratorio -->
          <div>
            <label class="etiqueta"><span class="paso">2</span> ¿En qué laboratorio?{{ f.tipo === 'personal' ? ' (opcional)' : ' *' }}</label>
            <div class="flex flex-wrap gap-1.5">
              @if (f.tipo === 'personal') {
                <button type="button" class="rounded-lg border-2 px-3 py-1.5 text-sm font-medium transition"
                        [class]="f.ambiente_id === null ? 'border-marca-500 bg-marca-50 text-marca-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'"
                        (click)="elegirLab(f, null)">Ninguno</button>
              }
              @for (lab of laboratorios(); track lab.id) {
                <button type="button" class="rounded-lg border-2 px-3 py-1.5 text-sm font-semibold transition"
                        [class]="f.ambiente_id === lab.id ? 'border-marca-500 bg-marca-50 text-marca-700' : 'border-slate-200 hover:border-slate-300'"
                        [style.border-left]="'5px solid ' + lab.color" (click)="elegirLab(f, lab.id)">{{ lab.codigo }}</button>
              }
            </div>
          </div>

          <!-- 3. Datos propios de cada tipo -->
          <div class="rounded-lg border border-slate-200 p-3">
            <p class="mb-2 text-sm font-semibold"><span class="paso">3</span> {{ tipos[f.tipo ?? 'docente'].texto }}</p>
            @switch (f.tipo) {
              @case ('docente') {
                <div class="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label class="etiqueta">Docente *</label>
                    @if (!f.otroSolicitante) {
                      <app-buscador [opciones]="opcionesDocentes()" [valor]="f.docente_id ?? null" (valorChange)="f.docente_id = $event" placeholder="Buscar docente" />
                      <button type="button" class="mt-1 text-xs text-marca-600 hover:underline" (click)="f.otroSolicitante = true; f.docente_id = null">No está en la lista</button>
                    } @else {
                      <input class="campo" maxlength="120" [(ngModel)]="f.solicitante" name="solicitante" placeholder="Nombre del docente">
                      <button type="button" class="mt-1 text-xs text-marca-600 hover:underline" (click)="f.otroSolicitante = false; f.solicitante = ''">Buscar en la lista</button>
                    }
                  </div>
                  <div>
                    <label class="etiqueta">¿Qué pidió? *</label>
                    <div class="flex flex-wrap gap-1.5">
                      @for (p of pedidos; track p.valor) {
                        <button type="button" class="rounded-full border px-3 py-1 text-xs font-medium transition"
                                [class]="f.det.pedido === p.valor ? 'border-sky-500 bg-sky-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-100'"
                                (click)="f.det.pedido = p.valor">{{ p.texto }}</button>
                      }
                    </div>
                  </div>
                  <div>
                    <label class="etiqueta">Detalle del pedido *</label>
                    <textarea class="campo" rows="2" maxlength="500" [(ngModel)]="f.descripcion" name="descripcion" placeholder="Ej: necesita el proyector conectado a su laptop"></textarea>
                  </div>
                  <div>
                    <label class="etiqueta">Solución</label>
                    <textarea class="campo" rows="2" maxlength="1000" [(ngModel)]="f.solucion" name="solucion" placeholder="¿Qué se hizo?"></textarea>
                  </div>
                </div>
              }
              @case ('programas') {
                <div class="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label class="etiqueta">Acción *</label>
                    <div class="flex flex-wrap gap-1.5">
                      @for (a of acciones; track a.valor) {
                        <button type="button" class="rounded-full border px-3 py-1 text-xs font-medium transition"
                                [class]="f.det.accion === a.valor ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-100'"
                                (click)="f.det.accion = a.valor">{{ a.texto }}</button>
                      }
                    </div>
                  </div>
                  <div>
                    <label class="etiqueta">Programa(s) y versión *</label>
                    <input class="campo" maxlength="200" [(ngModel)]="f.det.programas" name="programas" placeholder="Ej: SPSS 29, Docker Desktop 4.30">
                  </div>
                  <div>
                    <label class="etiqueta">¿Lo pidió un docente? <span class="font-normal text-slate-400">(opcional)</span></label>
                    <app-buscador [opciones]="opcionesDocentes()" [valor]="f.docente_id ?? null" (valorChange)="f.docente_id = $event" placeholder="Buscar docente" />
                  </div>
                  <div>
                    <label class="etiqueta">Observación</label>
                    <textarea class="campo" rows="2" maxlength="1000" [(ngModel)]="f.solucion" name="solucion" placeholder="Ej: licencia activada con la cuenta del laboratorio"></textarea>
                  </div>
                </div>
              }
              @case ('preventivo') {
                <label class="etiqueta">¿Qué se hizo? *</label>
                <div class="mb-3 grid gap-1.5 sm:grid-cols-3">
                  @for (c of checklist; track c.valor) {
                    <label class="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                      <input type="checkbox" class="h-4 w-4 accent-emerald-600" [checked]="(f.det.checklist ?? []).includes(c.valor)" (change)="alternarCheck(f, c.valor)">
                      {{ c.texto }}
                    </label>
                  }
                </div>
                <label class="etiqueta">Observaciones</label>
                <textarea class="campo" rows="2" maxlength="1000" [(ngModel)]="f.solucion" name="solucion" placeholder="Ej: se encontró polvo excesivo en SCPC105"></textarea>
                <p class="mt-1 text-xs text-slate-500">El preventivo no cambia el estado de las PCs.</p>
              }
              @case ('correctivo') {
                @if (!f.id) {
                  <p class="rounded-lg bg-marca-50 px-3 py-2 text-sm text-marca-800">
                    Marca las PCs abajo: se abre <b>una ficha por cada PC</b> para registrar sus fallas, la corrección y cómo queda.
                  </p>
                } @else {
                <div class="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label class="etiqueta">Falla *</label>
                    <textarea class="campo" rows="2" maxlength="500" [(ngModel)]="f.descripcion" name="descripcion" placeholder="Ej: no enciende / pantalla azul al iniciar"></textarea>
                  </div>
                  <div>
                    <label class="etiqueta">Diagnóstico</label>
                    <textarea class="campo" rows="2" maxlength="300" [(ngModel)]="f.det.diagnostico" name="diagnostico" placeholder="Ej: fuente de poder dañada"></textarea>
                  </div>
                  <div class="sm:col-span-2">
                    <label class="etiqueta">Qué se reparó / repuesto</label>
                    <textarea class="campo" rows="2" maxlength="1000" [(ngModel)]="f.solucion" name="solucion" placeholder="Ej: se cambió la fuente por una de 500 W"></textarea>
                  </div>
                </div>
                <p class="mt-2 text-xs text-slate-500">Al editar solo se corrigen los textos. Para cambiar cómo queda la PC, registra un correctivo nuevo o usa el croquis del laboratorio.</p>
                }
              }
              @case ('personal') {
                <div class="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label class="etiqueta">Persona atendida *</label>
                    <input class="campo" maxlength="120" [(ngModel)]="f.det.persona" name="persona" placeholder="Nombre y apellido">
                  </div>
                  <div>
                    <label class="etiqueta">Es…</label>
                    <div class="flex flex-wrap gap-1.5">
                      @for (t of tiposPersona; track t.valor) {
                        <button type="button" class="rounded-full border px-3 py-1 text-xs font-medium transition"
                                [class]="f.det.tipo_persona === t.valor ? 'border-teal-500 bg-teal-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-100'"
                                (click)="f.det.tipo_persona = t.valor">{{ t.texto }}</button>
                      }
                    </div>
                  </div>
                  <div>
                    <label class="etiqueta">Facultad</label>
                    <select class="campo" [(ngModel)]="f.det.facultad" name="facultad">
                      <option [ngValue]="undefined">—</option>
                      @for (c of catalogos.carreras(); track c.id) { <option [ngValue]="c.nombre">{{ c.nombre }}</option> }
                    </select>
                  </div>
                  <div>
                    <label class="etiqueta">Motivo *</label>
                    <textarea class="campo" rows="2" maxlength="500" [(ngModel)]="f.descripcion" name="descripcion" placeholder="Ej: no podía entrar a la plataforma virtual"></textarea>
                  </div>
                  <div class="sm:col-span-2">
                    <label class="etiqueta">Solución</label>
                    <textarea class="campo" rows="2" maxlength="1000" [(ngModel)]="f.solucion" name="solucion" placeholder="¿Cómo se le ayudó?"></textarea>
                  </div>
                </div>
              }
            }
          </div>

          <!-- 4. PCs -->
          @if (f.ambiente_id && f.tipo !== 'personal') {
            @if (requierePcs(f) || f.verPcs) {
              <div>
                <label class="etiqueta flex items-center justify-between">
                  <span><span class="paso">4</span> Marca las PCs{{ requierePcs(f) ? ' *' : ' (opcional)' }}</span>
                  <span class="text-xs font-normal" [class]="f.pcs.length ? 'text-marca-700' : 'text-slate-400'">
                    {{ f.pcs.length ? f.pcs.length + ' PC(s) → ' + f.pcs.length + ' ticket(s)' : requierePcs(f) ? 'Marca al menos una' : 'Ninguna: 1 ticket para el laboratorio' }}
                  </span>
                </label>
                @if (f.tipo === 'correctivo') { <p class="mb-1 text-xs text-slate-500">En un correctivo puedes marcar PCs en mantenimiento, inactivas o de baja (para repararlas).</p> }
                <app-laboratorio-croquis modo="seleccion" [ambienteId]="f.ambiente_id" [seleccion]="f.pcs" (seleccionChange)="f.pcs = $event"
                                         [permitirNoActivas]="f.tipo === 'correctivo'" />
                @if (f.tipo === 'correctivo' && !f.id) {
                  <p class="etiqueta mt-4"><span class="paso">5</span> Ficha de cada PC *</p>
                  <app-fichas-reparacion [pcs]="pcsDe(f)" />
                }
              </div>
            } @else {
              <button type="button" class="btn-fantasma btn-sm text-marca-600" (click)="f.verPcs = true">
                <app-icono nombre="equipo" [tamano]="14" /> Marcar PCs (opcional)
              </button>
            }
          }

          <!-- 5. Colaboradores -->
          <div class="relative">
            <label class="etiqueta"><span class="paso">5</span> Colaboradores (quién más ayudó)</label>
            <button type="button" class="campo flex min-h-10 flex-wrap items-center gap-1.5 text-left" (click)="abrirColaboradores()">
              @for (id of f.colaboradores; track id) {
                <span class="chip bg-indigo-100 text-indigo-800">
                  {{ nombres().get(id) ?? '¿?' }}
                  <span role="button" class="-mr-1 rounded-full px-1 hover:bg-indigo-200" (click)="$event.stopPropagation(); alternarColaborador(f, id)" aria-label="Quitar">×</span>
                </span>
              } @empty {
                <span class="text-slate-400">Nadie más: lo hice solo</span>
              }
              <app-icono nombre="siguiente" [tamano]="14" class="ml-auto text-slate-400 transition" [class.rotate-90]="colabAbierto()" />
            </button>
            @if (colabAbierto()) {
              <div class="fixed inset-0 z-10" (click)="colabAbierto.set(false)"></div>
              <div class="absolute inset-x-0 z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-superficie p-1 shadow-lg">
                <div class="sticky top-0 z-10 bg-superficie p-1">
                  <div class="relative">
                    <app-icono nombre="buscar" [tamano]="15" class="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
                    <input #buscarColab class="campo !py-1.5 !pl-8" placeholder="Escribe un nombre para buscar…" maxlength="40" autocomplete="off"
                           [value]="busquedaColab()" (input)="busquedaColab.set(buscarColab.value)"
                           (keydown.enter)="$event.preventDefault(); elegirPrimero(f)" (keydown.escape)="colabAbierto.set(false)">
                  </div>
                </div>
                @for (grupo of gruposPersonal(); track grupo.titulo) {
                  <p class="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">{{ grupo.titulo }}</p>
                  @for (p of grupo.personas; track p.id) {
                    <label class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-slate-100">
                      <input type="checkbox" class="h-4 w-4 accent-indigo-600" [checked]="f.colaboradores.includes(p.id)" (change)="alternarColaborador(f, p.id)">
                      <span class="flex-1">{{ p.nombre_completo }}</span>
                      @if (p.turno_habitual) { <span class="text-xs text-slate-400">{{ nombreTurno[p.turno_habitual] }}</span> }
                    </label>
                  }
                } @empty {
                  <p class="px-2 py-3 text-sm text-slate-400">
                    {{ busquedaColab().trim() ? 'Nadie se llama "' + busquedaColab().trim() + '". Solo puedes elegir personas de la lista.' : 'No hay otros auxiliares ni encargados activos.' }}
                  </p>
                }
                <div class="sticky bottom-0 border-t border-slate-200 bg-superficie p-1.5 text-right">
                  <button type="button" class="btn-primario btn-sm" (click)="colabAbierto.set(false)">Listo</button>
                </div>
              </div>
            }
          </div>

          <!-- Prioridad -->
          <div class="flex items-center gap-2 text-sm">
            <label class="text-slate-600" for="prioridad">Prioridad</label>
            <select id="prioridad" class="campo !w-32 !py-1" [(ngModel)]="f.prioridad" name="prioridad">
              <option [ngValue]="1">Alta</option><option [ngValue]="2">Media</option><option [ngValue]="3">Baja</option>
            </select>
          </div>
        </form>
      }
      <ng-container pie>
        <button class="btn-secundario" (click)="form.set(null)">Cancelar</button>
        <button class="btn-primario" type="submit" form="form-atencion" [disabled]="guardando()">
          {{ guardando() ? 'Guardando…' : textoGuardar() }}
        </button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .paso { display: inline-flex; width: 1.15rem; height: 1.15rem; margin-right: 0.25rem; align-items: center; justify-content: center;
            border-radius: 9999px; background: var(--color-marca-600); color: white; font-size: 0.7rem; font-weight: 700; }
  `,
})
export class AtencionesListaComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly catalogos = inject(CatalogosService);
  private readonly operacion = inject(OperacionService);
  private readonly notificaciones = inject(NotificacionesService);

  protected readonly tipos = TIPOS_TICKET;
  protected readonly categorias = CATEGORIAS_TICKET;
  protected readonly subtiposTecnico = SUBTIPOS_TECNICO;
  protected readonly colorCategoria = COLOR_CATEGORIA;
  protected readonly pedidos = PEDIDOS_DOCENTE;
  protected readonly acciones = ACCIONES_PROGRAMA;
  protected readonly checklist = CHECKLIST_PREVENTIVO;
  protected readonly resultados = RESULTADOS_CORRECTIVO;
  protected readonly tiposPersona = TIPOS_PERSONA;
  protected readonly textoDe = textoDe;
  protected readonly prioridades = PRIORIDADES;
  protected readonly estados = ESTADOS;

  protected readonly lista = signal<Atencion[]>([]);
  protected readonly solicitudes = signal<SolicitudBaja[]>([]);
  protected readonly filtroCategoria = signal<CategoriaTicket | null>(null);
  /** Auxiliares y encargados activos (para colaboradores) */
  protected readonly personal = signal<Perfil[]>([]);
  /** Los demás, sin quien está registrando */
  protected readonly companeros = computed(() => this.personal().filter((p) => p.id !== this.auth.perfil()?.id));
  /** Texto para buscar colaboradores (solo filtra: no se puede escribir un nombre que no exista) */
  protected readonly busquedaColab = signal('');
  private readonly buscarColab = viewChild<ElementRef<HTMLInputElement>>('buscarColab');
  /** Fichas de reparación del correctivo nuevo */
  private readonly fichas = viewChild(FichasReparacionComponent);
  /** Compañeros agrupados para la lista desplegable, filtrados por la búsqueda */
  protected readonly gruposPersonal = computed(() => {
    const texto = normalizar(this.busquedaColab().trim());
    const lista = this.companeros().filter((p) => !texto || normalizar(p.nombre_completo).includes(texto));
    return [
      { titulo: 'Auxiliares', personas: lista.filter((p) => p.rol === 'auxiliar') },
      { titulo: 'Encargados', personas: lista.filter((p) => p.rol === 'encargado') },
    ].filter((g) => g.personas.length);
  });
  protected readonly colabAbierto = signal(false);
  protected readonly nombreTurno: Record<TurnoCodigo, string> = { M: 'Mañana', MD: 'Mediodía', T: 'Tarde', N: 'Noche' };
  protected readonly nombres = computed(() => new Map(this.personal().map((p) => [p.id, p.nombre_completo])));
  protected readonly form = signal<FormTicket | null>(null);
  protected readonly guardando = signal(false);
  protected readonly abiertos = signal(new Set<string>());
  /** Grupo que se está editando (para saber qué PCs agregar o quitar) */
  private grupoEditado: Grupo | null = null;

  protected filtroLab: number | null = null;
  /** Por defecto, el auxiliar ve sus tickets (los que registró y en los que colaboró) */
  protected soloMios = this.auth.perfil()?.rol === 'auxiliar';
  protected desde = '';
  protected hasta = '';

  protected readonly laboratorios = computed(() => this.catalogos.laboratorios());
  protected readonly opcionesDocentes = computed<OpcionBuscador[]>(() =>
    this.catalogos.docentesActivos().map((d) => ({ id: d.id, texto: `${d.apellidos} ${d.nombres}` })));

  /** Lista filtrada por categoría */
  protected readonly filtrados = computed(() => {
    const c = this.filtroCategoria();
    return c ? this.lista().filter((a) => TIPOS_TICKET[a.tipo]?.categoria === c) : this.lista();
  });

  /** Tickets que registré y en los que colaboré (filtro "Míos") */
  protected readonly cuentaMia = computed(() => {
    const yo = this.auth.perfil()?.id;
    const l = this.filtrados();
    return { registre: l.filter((a) => a.auxiliar_id === yo).length, colabore: l.filter((a) => this.colaboreEn(a)).length };
  });

  /** Tickets agrupados por lote (los sueltos van solos), en el orden de la lista */
  protected readonly grupos = computed<Grupo[]>(() => {
    const mapa = new Map<string, Atencion[]>();
    for (const a of this.filtrados()) {
      const clave = a.lote ?? `id-${a.id}`;
      mapa.set(clave, [...(mapa.get(clave) ?? []), a]);
    }
    return [...mapa].map(([clave, tickets]) => {
      tickets.sort((x, y) => (x.pc?.etiqueta ?? '').localeCompare(y.pc?.etiqueta ?? '', 'es', { numeric: true }));
      const resueltos = tickets.filter((t) => t.estado === 'resuelto').length;
      const estado: EstadoAtencion = resueltos === tickets.length ? 'resuelto'
        : tickets.some((t) => t.estado === 'en_proceso') ? 'en_proceso' : 'pendiente';
      return { clave, tickets, primero: tickets[0], estado, resueltos };
    });
  });

  ngOnInit(): void {
    void this.cargar();
    this.operacion.listarPersonalOperacion().then((l) => this.personal.set(l)).catch(() => this.personal.set([]));
  }

  protected det(a: Atencion): DetallesTicket {
    return (a.detalles ?? {}) as DetallesTicket;
  }

  /** "Estudiante · Medicina" */
  protected datosPersona(a: Atencion): string {
    const d = this.det(a);
    return [textoDe(TIPOS_PERSONA, d.tipo_persona), d.facultad].filter(Boolean).join(' · ');
  }

  protected etiquetaSolucion(tipo: TipoAtencion): string {
    if (tipo === 'correctivo') return 'Reparación:';
    if (tipo === 'cambio_estado') return 'Qué se hizo / motivo:';
    if (tipo === 'docente' || tipo === 'personal') return 'Solución:';
    return 'Observación:';
  }

  /** En un lote de correctivos, ¿cada PC tiene una ficha distinta? */
  protected fichasDistintas(g: Grupo): boolean {
    const p = g.primero;
    return g.tickets.length > 1 && g.tickets.some((t) =>
      t.descripcion !== p.descripcion || this.det(t).resultado !== this.det(p).resultado || (t.pieza ?? '') !== (p.pieza ?? ''));
  }

  protected claseResultado(r: string): string {
    if (r === 'inactiva') return 'bg-slate-200 text-slate-700';
    return r === 'reparada' ? 'bg-emerald-100 text-emerald-700' : r === 'sigue' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-700';
  }

  protected abrirColaboradores(): void {
    this.busquedaColab.set('');
    this.colabAbierto.set(!this.colabAbierto());
    // Foco en el buscador para escribir directo
    setTimeout(() => this.buscarColab()?.nativeElement.focus());
  }

  /** Enter en el buscador: marca al primero que coincide */
  protected elegirPrimero(f: FormTicket): void {
    const primero = this.gruposPersonal()[0]?.personas[0];
    if (!primero) return;
    if (!f.colaboradores.includes(primero.id)) this.alternarColaborador(f, primero.id);
    this.busquedaColab.set('');
  }

  /** ¿Estoy como colaborador (no como quien lo registró)? */
  protected colaboreEn(a: Atencion): boolean {
    const yo = this.auth.perfil()?.id;
    return !!yo && a.auxiliar_id !== yo && (a.colaboradores ?? []).includes(yo);
  }

  protected requierePcs(f: FormTicket): boolean {
    return !!f.tipo && TIPOS_CON_PC.includes(f.tipo);
  }

  protected alternarColaborador(f: FormTicket, id: string): void {
    f.colaboradores = f.colaboradores.includes(id) ? f.colaboradores.filter((c) => c !== id) : [...f.colaboradores, id];
  }

  protected alternarCheck(f: FormTicket, valor: string): void {
    const lista = f.det.checklist ?? [];
    f.det.checklist = lista.includes(valor) ? lista.filter((c) => c !== valor) : [...lista, valor];
  }

  protected nombresColaboradores(a: Atencion): string {
    return (a.colaboradores ?? []).map((id) => this.nombres().get(id)?.split(' ')[0] ?? '¿?').join(', ');
  }

  protected solicitante(a: Atencion): string {
    if (a.docente) return `${a.docente.apellidos} ${a.docente.nombres}`;
    return a.solicitante ?? '';
  }

  protected async cargar(): Promise<void> {
    const filtro: FiltroOperacion = {
      participante: this.soloMios ? this.auth.perfil()?.id : undefined, desde: this.desde || undefined, hasta: this.hasta || undefined, ambienteId: this.filtroLab,
    };
    try {
      const [lista, solicitudes] = await Promise.all([this.operacion.listarAtenciones(filtro), this.operacion.solicitudesBaja()]);
      this.lista.set(lista);
      this.solicitudes.set(solicitudes);
    } catch (e) {
      this.notificaciones.error(e, 'No se cargaron los tickets');
    }
  }

  protected alternar(clave: string): void {
    this.abiertos.update((s) => {
      const n = new Set(s);
      if (!n.delete(clave)) n.add(clave);
      return n;
    });
  }

  protected nuevo(): void {
    this.grupoEditado = null;
    this.colabAbierto.set(false);
    this.form.set({
      categoria: 'docente', tipo: 'docente', det: {}, prioridad: 2, estado: 'resuelto',
      ambiente_id: this.filtroLab, docente_id: null, solicitante: '', descripcion: '', solucion: '',
      turno_trabajo_id: this.operacion.turnoActual()?.id ?? null,
      pcs: [], colaboradores: [], verPcs: false, otroSolicitante: false,
    });
  }

  protected elegirCategoria(f: FormTicket, categoria: FormTicket['categoria']): void {
    f.categoria = categoria;
    this.elegirTipo(f, categoria === 'tecnico' ? (TIPOS_CON_PC.includes(f.tipo!) ? f.tipo! : 'programas') : categoria);
  }

  /** Cambiar de tipo limpia los datos propios del formulario anterior */
  protected elegirTipo(f: FormTicket, tipo: TipoAtencion): void {
    if (f.tipo !== tipo) f.det = {};
    f.tipo = tipo;
    // Fuera de un correctivo, las PCs que no estén activas se desmarcan
    if (tipo !== 'correctivo') {
      const activas = new Set(this.catalogos.pcs().filter((pc) => pc.estado === 'operativa').map((pc) => pc.id));
      f.pcs = f.pcs.filter((id) => activas.has(id));
    }
  }

  protected elegirLab(f: FormTicket, id: number | null): void {
    if (f.ambiente_id !== id) f.pcs = [];
    f.ambiente_id = id;
  }

  /** Edita el grupo completo: datos y PCs */
  protected editar(g: Grupo): void {
    const a = g.primero;
    const categoria = TIPOS_TICKET[a.tipo].categoria;
    this.form.set({
      ...a,
      categoria: categoria === 'sistema' ? 'tecnico' : categoria,
      det: { ...(a.detalles as DetallesTicket) },
      pcs: g.tickets.map((t) => t.pc_id).filter((id): id is number => id !== null),
      colaboradores: [...(a.colaboradores ?? [])],
      verPcs: g.tickets.some((t) => t.pc_id !== null),
      otroSolicitante: !a.docente_id && !!a.solicitante && a.tipo === 'docente',
    });
    this.grupoEditado = g;
  }

  protected textoGuardar(): string {
    const f = this.form();
    if (!f || f.id) return 'Guardar';
    const n = Math.max(f.pcs.length, 1);
    if (f.tipo === 'correctivo') return n > 1 ? `Guardar ${n} fichas` : 'Guardar ficha';
    return n > 1 ? `Guardar ${n} tickets` : 'Guardar ticket';
  }

  /** Valida el formulario según el tipo; devuelve el aviso o null si está bien */
  private validar(f: FormTicket): string | null {
    const d = f.det;
    if (f.tipo !== 'personal' && !f.ambiente_id) return 'Elige el laboratorio.';
    if (this.requierePcs(f) && !f.pcs.length) return 'Marca al menos una PC en el croquis.';
    switch (f.tipo) {
      case 'docente':
        if (!f.docente_id && !f.solicitante?.trim()) return 'Indica el docente.';
        if (!d.pedido) return 'Elige qué pidió el docente.';
        return (f.descripcion?.trim().length ?? 0) < 3 ? 'Escribe el detalle del pedido.' : null;
      case 'programas':
        if (!d.accion) return 'Elige la acción (instalar, actualizar…).';
        return (d.programas?.trim().length ?? 0) < 2 ? 'Escribe qué programa(s).' : null;
      case 'preventivo':
        return d.checklist?.length ? null : 'Marca al menos una tarea del preventivo.';
      case 'correctivo':
        // Nuevo: cada ficha se valida sola; al editar solo hay textos
        if (!f.id) return this.fichas()?.validar() ?? 'Marca al menos una PC en el croquis.';
        return (f.descripcion?.trim().length ?? 0) < 3 ? 'Describe la falla.' : null;
      case 'personal':
        if ((d.persona?.trim().length ?? 0) < 3) return 'Escribe el nombre de la persona atendida.';
        return (f.descripcion?.trim().length ?? 0) < 3 ? 'Escribe el motivo.' : null;
      default:
        return null;
    }
  }

  /** Motivo que se guarda (en programas y preventivo se arma solo) */
  private descripcionDe(f: FormTicket): string {
    const d = f.det;
    if (f.tipo === 'programas') return `${textoDe(ACCIONES_PROGRAMA, d.accion)}: ${d.programas?.trim()}`.slice(0, 500);
    if (f.tipo === 'preventivo') return `Preventivo: ${(d.checklist ?? []).map((c) => textoDe(CHECKLIST_PREVENTIVO, c)).join(', ')}`.slice(0, 500);
    return f.descripcion?.trim() ?? '';
  }

  protected async guardar(): Promise<void> {
    const f = this.form();
    if (!f) return;
    const aviso = this.validar(f);
    if (aviso) {
      this.notificaciones.aviso(aviso);
      return;
    }
    // Correctivo nuevo: las fichas se guardan juntas (un ticket por PC y su cambio de estado)
    if (f.tipo === 'correctivo' && !f.id) {
      await this.guardarFichas(f);
      return;
    }
    // Las PCs solo valen con laboratorio y, en atención a docente, si se abrió el croquis
    if (!f.ambiente_id || f.tipo === 'personal' || (!this.requierePcs(f) && !f.verPcs)) f.pcs = [];
    // Detalles sin espacios sobrantes ni textos vacíos
    const det = Object.fromEntries(Object.entries(f.det)
      .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
      .filter(([, v]) => v !== '' && v !== undefined && v !== null)) as DetallesTicket;
    const comun: Partial<Atencion> = {
      ambiente_id: f.ambiente_id,
      tipo: f.tipo ?? 'docente',
      alcance: f.pcs.length > 1 ? 'grupal' : 'individual',
      descripcion: this.descripcionDe(f),
      solucion: f.solucion?.trim() || null,
      detalles: det as Record<string, unknown>,
      prioridad: f.prioridad ?? 2,
      docente_id: f.tipo === 'docente' || f.tipo === 'programas' ? f.docente_id ?? null : null,
      solicitante: f.tipo === 'personal' ? det.persona ?? null : f.tipo === 'docente' && f.otroSolicitante ? f.solicitante?.trim() || null : null,
      colaboradores: f.colaboradores,
      // Un ticket se registra cuando el trabajo ya se hizo: siempre queda resuelto
      estado: 'resuelto',
      resuelto_por: f.resuelto_por ?? this.auth.perfil()?.id ?? null,
      resuelto_en: f.resuelto_en ?? new Date().toISOString(),
    };

    this.guardando.set(true);
    try {
      let creados: { id: number; pc_id: number | null }[];
      if (f.id && this.grupoEditado) {
        creados = await this.guardarEdicion(this.grupoEditado, f.pcs, comun);
      } else {
        const lote = f.pcs.length > 1 ? crypto.randomUUID() : null;
        const pcs: (number | null)[] = f.pcs.length ? f.pcs : [null];
        creados = await this.operacion.crearAtenciones(pcs.map((pc_id) => ({
          ...comun, pc_id, lote, turno_trabajo_id: f.turno_trabajo_id ?? null,
        })));
      }
      const n = Math.max(f.pcs.length, 1);
      this.notificaciones.exito(f.id ? 'Ticket actualizado.' : n > 1 ? `${n} tickets guardados.` : 'Ticket guardado.');
      this.form.set(null);
      this.grupoEditado = null;
      await Promise.all([this.cargar(), this.catalogos.recargar('ambiente_pcs')]);
    } catch (e) {
      this.notificaciones.error(e, 'No se guardó');
    } finally {
      this.guardando.set(false);
    }
  }

  /** PCs marcadas, en el orden en que se marcaron (para las fichas) */
  protected pcsDe(f: FormTicket): AmbientePc[] {
    const porId = new Map(this.catalogos.pcs().map((pc) => [pc.id, pc]));
    return f.pcs.map((id) => porId.get(id)).filter((pc): pc is AmbientePc => !!pc);
  }

  private async guardarFichas(f: FormTicket): Promise<void> {
    const fichas = this.fichas();
    if (!fichas) return;
    this.guardando.set(true);
    try {
      const n = await this.operacion.registrarReparaciones(fichas.datos(), f.colaboradores, f.prioridad ?? 2);
      const bajas = fichas.datos().filter((x) => x.estado_final === 'baja').length;
      this.notificaciones.exito(`${n === 1 ? 'Ficha guardada' : n + ' fichas guardadas'}.${bajas ? ` ${bajas} PC(s) de baja: saldrán en tu cierre de turno.` : ''}`);
      this.form.set(null);
      this.grupoEditado = null;
      await Promise.all([this.cargar(), this.catalogos.recargar('ambiente_pcs')]);
    } catch (e) {
      this.notificaciones.error(e, 'No se guardaron las fichas');
    } finally {
      this.guardando.set(false);
    }
  }

  /** Actualiza el grupo: cambia los datos comunes, agrega las PCs nuevas y quita las desmarcadas */
  private async guardarEdicion(g: Grupo, pcs: number[], comun: Partial<Atencion>): Promise<{ id: number; pc_id: number | null }[]> {
    const lote = g.primero.lote ?? (pcs.length > 1 ? crypto.randomUUID() : null);
    const actuales = new Map(g.tickets.map((t) => [t.pc_id, t]));
    const quitar = g.tickets.filter((t) => t.pc_id !== null && !pcs.includes(t.pc_id));
    // Si se quitaron todas las PCs, el primer ticket queda como ticket del laboratorio
    const conservar = pcs.length ? g.tickets.filter((t) => t.pc_id !== null && pcs.includes(t.pc_id)) : [g.primero];
    await this.operacion.actualizarAtenciones(conservar.map((t) => t.id), { ...comun, lote, ...(pcs.length ? {} : { pc_id: null }) });
    const nuevas = pcs.filter((id) => !actuales.has(id));
    const creados = await this.operacion.crearAtenciones(nuevas.map((pc_id) => ({ ...comun, pc_id, lote, turno_trabajo_id: g.primero.turno_trabajo_id })));
    const borrar = quitar.filter((t) => !conservar.includes(t)).map((t) => t.id);
    // Ticket sin PC que pasa a tener PCs: se reemplaza por los de cada PC
    if (pcs.length && g.primero.pc_id === null) borrar.push(g.primero.id);
    if (borrar.length) await this.operacion.eliminarAtenciones(borrar);
    else await this.operacion.refrescar();
    return [...conservar.map((t) => ({ id: t.id, pc_id: t.pc_id })), ...creados];
  }

  protected async estadoGrupo(g: Grupo, estado: EstadoAtencion): Promise<void> {
    try {
      await this.operacion.cambiarEstadoAtenciones(g.tickets.map((t) => t.id), estado);
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e);
    }
  }

  protected async estadoTicket(t: Atencion, estado: EstadoAtencion): Promise<void> {
    try {
      await this.operacion.cambiarEstadoAtencion(t, estado);
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e);
    }
  }

  protected async eliminarGrupo(g: Grupo): Promise<void> {
    const texto = g.tickets.length > 1 ? `¿Eliminar estos ${g.tickets.length} tickets?` : '¿Eliminar este ticket?';
    if (!confirm(texto)) return;
    try {
      await this.operacion.eliminarAtenciones(g.tickets.map((t) => t.id));
      this.notificaciones.exito('Eliminado.');
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e);
    }
  }

  /** Admin/encargado: da de baja la PC pedida o rechaza el pedido (con el porqué) */
  protected async resolverBaja(s: SolicitudBaja, aprobar: boolean): Promise<void> {
    let respuesta: string | null = null;
    if (aprobar) {
      if (!confirm(`¿Dar de baja ${s.pc?.etiqueta}?\nMotivo: ${s.motivo}`)) return;
    } else {
      respuesta = prompt(`¿Por qué se rechaza la baja de ${s.pc?.etiqueta}?`)?.trim() || null;
      if (!respuesta) return;
    }
    try {
      await this.operacion.resolverBaja(s.id, aprobar, respuesta);
      this.notificaciones.exito(aprobar ? `${s.pc?.etiqueta} dada de baja.` : 'Solicitud rechazada.');
      await Promise.all([this.cargar(), this.catalogos.recargar('ambiente_pcs')]);
    } catch (e) {
      this.notificaciones.error(e);
    }
  }

  protected exportar(): void {
    const filas = this.filtrados().map((a) => {
      const d = this.det(a);
      const extra = [
        textoDe(PEDIDOS_DOCENTE, d.pedido), d.programas, textoDe(ACCIONES_PROGRAMA, d.accion),
        (d.checklist ?? []).map((c) => textoDe(CHECKLIST_PREVENTIVO, c)).join(' / '), d.diagnostico,
        textoDe(RESULTADOS_CORRECTIVO, d.resultado), d.persona, textoDe(TIPOS_PERSONA, d.tipo_persona), d.facultad,
      ].filter(Boolean).join(' · ');
      return [
        new Date(a.creado_en).toLocaleString('es-BO'),
        TIPOS_TICKET[a.tipo]?.texto ?? a.tipo, a.ambiente?.codigo ?? '', a.pc?.etiqueta ?? '', this.solicitante(a),
        PRIORIDADES[a.prioridad].texto, ESTADOS[a.estado].texto,
        a.descripcion, a.solucion ?? '', extra, a.autor?.nombre_completo ?? '',
        (a.colaboradores ?? []).map((id) => this.nombres().get(id) ?? '').join(', '),
      ];
    });
    descargarCsv('tickets', ['Fecha', 'Tipo', 'Laboratorio', 'PC', 'Docente / persona', 'Prioridad', 'Estado', 'Motivo / falla',
      'Solución', 'Detalles', 'Registró', 'Colaboradores'], filas);
  }
}
