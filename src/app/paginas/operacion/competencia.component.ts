import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconoComponent } from '../../compartido/icono.component';
import { ModalComponent } from '../../compartido/modal.component';
import { ConfirmacionService } from '../../core/confirmacion.service';
import { descargarCsv } from '../../core/exportar';
import { NotificacionesService } from '../../core/notificaciones.service';
import { ErrorSistema, SupabaseService } from '../../core/supabase.service';

/** Fila del ranking (fn_ranking_competencia) */
interface FilaRanking {
  id: string;
  nombre: string;
  puntos: number;
  trabajos: number;
  colaboraciones: number;
  por_tipo: Partial<Record<string, number>>;
  cierres: number;
  retrasos: number;
}

interface Periodo {
  id: number;
  desde: string;
  hasta: string;
  nota: string | null;
  puntos: Record<string, number>;
  ranking: FilaRanking[];
  autor?: { nombre_completo: string } | null;
}

/** Tipos de trabajo que suman puntos, en el orden de la tabla */
const TIPOS_PUNTOS: { tipo: string; texto: string; corto: string }[] = [
  { tipo: 'correctivo', texto: 'Mant. correctivo (reparar PC)', corto: 'Correct.' },
  { tipo: 'preventivo', texto: 'Mant. preventivo', corto: 'Prevent.' },
  { tipo: 'programas', texto: 'Programas', corto: 'Progr.' },
  { tipo: 'docente', texto: 'Atención a docente', corto: 'Docente' },
  { tipo: 'personal', texto: 'Atención personal', corto: 'Personal' },
  { tipo: 'apertura_lab', texto: 'Abrir laboratorio', corto: 'Abrir' },
  { tipo: 'cierre_lab', texto: 'Cerrar laboratorio', corto: 'Cerrar' },
];

/**
 * Competencia de auxiliares (admin y encargado), por periodos: cada reunión
 * cierra el periodo en curso, guarda el ranking completo y empieza uno nuevo
 * en 0. Los tickets no se borran. Se cuentan puntos por tipo de trabajo; un
 * trabajo con varias PCs cuenta una sola vez.
 */
@Component({
  selector: 'app-competencia',
  imports: [FormsModule, DatePipe, NgTemplateOutlet, IconoComponent, ModalComponent],
  template: `
    <header class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">Competencia</h1>
        <p class="mt-0.5 text-sm text-slate-600">
          Periodo en curso desde el <b>{{ desde() | date: 'dd/MM/yyyy HH:mm' }}</b>{{ periodos().length ? ' (última reunión)' : '' }} hasta hoy.
          En cada reunión se cierra y todos empiezan en 0.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-secundario" (click)="abrirPuntos()"><app-icono nombre="trofeo" [tamano]="16" /> Puntos</button>
        <button class="btn-secundario" (click)="exportar('periodo-en-curso', ranking())" [disabled]="!ranking().length"><app-icono nombre="descargar" [tamano]="16" /> Exportar</button>
        <button class="btn-primario" (click)="cierre.set({ nota: '' })" [disabled]="!totalPuntos()"><app-icono nombre="check" [tamano]="16" /> Cerrar periodo (reunión)</button>
      </div>
    </header>

    @if (cargando()) {
      <p class="tarjeta py-10 text-center text-sm text-slate-500">Cargando…</p>
    } @else {
      <section class="mb-8">
        <ng-container *ngTemplateOutlet="tabla; context: { $implicit: ranking() }" />
      </section>

      <!-- HISTORIAL DE REUNIONES -->
      <section>
        <h2 class="mb-1 text-lg font-semibold">Historial de reuniones</h2>
        <p class="mb-2 text-sm text-slate-600">Cada periodo cerrado con su ranking completo, tal como quedó ese día.</p>
        <div class="space-y-2">
          @for (p of periodos(); track p.id; let primero = $first) {
            <article class="tarjeta">
              <button type="button" class="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-3 text-left" (click)="abierto.set(abierto() === p.id ? null : p.id)">
                <div class="min-w-48 flex-1">
                  <p class="font-semibold">Del {{ p.desde | date: 'dd/MM/yyyy' }} al {{ p.hasta | date: 'dd/MM/yyyy' }}</p>
                  <p class="text-xs text-slate-500">{{ p.nota || 'Sin nota' }}@if (p.autor) { · cerró {{ p.autor.nombre_completo }} }</p>
                </div>
                @if (p.ranking[0]; as g) { <span class="text-sm">🥇 <b>{{ g.nombre }}</b> ({{ g.puntos }} pts)</span> }
                @if (ultimo(p.ranking); as u) { <span class="text-sm text-rose-700">Menos: {{ u.nombre }} ({{ u.puntos }} pts)</span> }
                <app-icono [nombre]="abierto() === p.id ? 'arriba' : 'abajo'" [tamano]="16" class="text-slate-400" />
              </button>
              @if (abierto() === p.id) {
                <div class="border-t border-slate-100 p-3">
                  <div class="mb-2 flex flex-wrap gap-2">
                    <button class="btn-secundario btn-sm" (click)="exportar('periodo-' + p.desde.slice(0, 10) + '-a-' + p.hasta.slice(0, 10), p.ranking)">
                      <app-icono nombre="descargar" [tamano]="14" /> Exportar
                    </button>
                    @if (primero) {
                      <button class="btn-secundario btn-sm !border-red-200 !text-red-600" (click)="deshacer()" [disabled]="guardando()">
                        <app-icono nombre="restaurar" [tamano]="14" /> Deshacer este cierre
                      </button>
                    }
                  </div>
                  <p class="mb-2 text-xs text-slate-500">Puntos usados: {{ textoPuntos(p.puntos) }}</p>
                  <ng-container *ngTemplateOutlet="tabla; context: { $implicit: p.ranking }" />
                </div>
              }
            </article>
          } @empty {
            <p class="tarjeta py-6 text-center text-sm text-slate-500">Aún no se cerró ningún periodo. Ciérralo el día de la reunión.</p>
          }
        </div>
      </section>
    }

    <!-- TABLA DE RANKING (periodo en curso y cada periodo del historial) -->
    <ng-template #tabla let-filas>
      <div class="tarjeta overflow-x-auto">
        <table class="tabla">
          <thead>
            <tr>
              <th class="w-10">#</th><th>Auxiliar</th><th class="min-w-40">Puntos</th>
              <th class="text-right">Trabajos</th><th class="text-right">Colaboró</th>
              @for (t of tipos; track t.tipo) { <th class="text-right text-xs" [title]="t.texto">{{ t.corto }}</th> }
              <th class="text-right">Cierres turno</th><th class="text-right">Retrasos</th>
            </tr>
          </thead>
          <tbody>
            @for (f of $any(filas); track f.id; let i = $index; let ultimaFila = $last) {
              <tr [class.bg-rose-50]="ultimaFila && $any(filas).length > 1">
                <td class="text-center font-bold" [class]="i < 3 && f.puntos ? 'text-lg' : 'text-slate-400'">{{ i < 3 && f.puntos ? medallas[i] : i + 1 }}</td>
                <td class="font-medium">{{ f.nombre }}</td>
                <td>
                  <span class="flex items-center gap-2">
                    <span class="h-3 rounded-full bg-marca-500" [style.width.%]="(f.puntos / tope($any(filas))) * 80"></span>
                    <b class="tabular-nums">{{ f.puntos }}</b>
                  </span>
                </td>
                <td class="text-right tabular-nums">{{ f.trabajos }}</td>
                <td class="text-right tabular-nums">{{ f.colaboraciones }}</td>
                @for (t of tipos; track t.tipo) { <td class="text-right text-sm tabular-nums text-slate-600">{{ f.por_tipo[t.tipo] || '·' }}</td> }
                <td class="text-right tabular-nums">{{ f.cierres }}</td>
                <td class="text-right tabular-nums" [class.text-rose-600]="f.retrasos">{{ f.retrasos }}</td>
              </tr>
            } @empty {
              <tr><td [attr.colspan]="tipos.length + 7" class="py-6 text-center text-sm text-slate-500">No hay auxiliares.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </ng-template>

    <!-- CERRAR PERIODO -->
    <app-modal [abierto]="!!cierre()" titulo="Cerrar periodo (reunión)" (cerrar)="cierre.set(null)">
      @if (cierre(); as c) {
        <p class="mb-3 text-sm text-slate-600">
          Se guarda el ranking de {{ ranking().length }} auxiliares del {{ desde() | date: 'dd/MM/yyyy' }} a hoy
          @if (ranking()[0]; as g) { (ganador: <b>{{ g.nombre }}</b>, {{ g.puntos }} pts) }
          y empieza un periodo nuevo en 0. Los tickets no se borran.
        </p>
        <label class="etiqueta" for="cierre-nota">Nota de la reunión <span class="font-normal text-slate-400">(opcional)</span></label>
        <textarea id="cierre-nota" class="campo" rows="2" maxlength="300" [(ngModel)]="c.nota" placeholder="Ej: reunión de octubre, se felicitó al ganador"></textarea>
      }
      <ng-container pie>
        <button class="btn-secundario" (click)="cierre.set(null)">Cancelar</button>
        <button class="btn-primario" (click)="cerrarPeriodo()" [disabled]="guardando()">{{ guardando() ? 'Cerrando…' : 'Cerrar periodo' }}</button>
      </ng-container>
    </app-modal>

    <!-- PUNTOS POR TIPO -->
    <app-modal [abierto]="!!edicionPuntos()" titulo="Puntos por tipo de trabajo" (cerrar)="edicionPuntos.set(null)">
      @if (edicionPuntos(); as e) {
        <p class="mb-3 text-sm text-slate-600">Cuánto vale cada trabajo. Un trabajo con varias PCs cuenta una sola vez. Los periodos ya cerrados no cambian.</p>
        <div class="space-y-2">
          @for (t of tiposConColaboracion; track t.tipo) {
            <div class="flex items-center justify-between gap-3">
              <label class="text-sm" [for]="'pts-' + t.tipo">{{ t.texto }}</label>
              <input [id]="'pts-' + t.tipo" type="number" min="0" max="20" class="campo !w-20 text-right" [(ngModel)]="e[t.tipo]">
            </div>
          }
        </div>
      }
      <ng-container pie>
        <button class="btn-secundario" (click)="edicionPuntos.set(null)">Cancelar</button>
        <button class="btn-primario" (click)="guardarPuntos()" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Guardar puntos' }}</button>
      </ng-container>
    </app-modal>
  `,
})
export class CompetenciaComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly notificaciones = inject(NotificacionesService);
  private readonly confirmacion = inject(ConfirmacionService);

  protected readonly tipos = TIPOS_PUNTOS;
  protected readonly tiposConColaboracion = [...TIPOS_PUNTOS, { tipo: 'colaboracion', texto: 'Colaborar en un trabajo de otro', corto: '' }];
  protected readonly medallas = ['🥇', '🥈', '🥉'];

  protected readonly cargando = signal(true);
  protected readonly guardando = signal(false);
  protected readonly desde = signal('');
  protected readonly puntos = signal<Record<string, number>>({});
  protected readonly ranking = signal<FilaRanking[]>([]);
  protected readonly periodos = signal<Periodo[]>([]);
  protected readonly totalPuntos = computed(() => this.ranking().reduce((s, f) => s + f.puntos, 0));
  /** Periodo del historial desplegado */
  protected readonly abierto = signal<number | null>(null);
  protected readonly cierre = signal<{ nota: string } | null>(null);
  protected readonly edicionPuntos = signal<Record<string, number> | null>(null);

  ngOnInit(): void {
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    try {
      const [actual, historial] = await Promise.all([
        this.supabase.rpc<{ desde: string; puntos: Record<string, number>; ranking: FilaRanking[] }>('fn_competencia_actual'),
        this.supabase.cliente.from('periodos_competencia').select('*, autor:perfiles(nombre_completo)').order('hasta', { ascending: false }),
      ]);
      if (historial.error) throw new ErrorSistema(historial.error);
      this.desde.set(actual.desde);
      this.puntos.set(actual.puntos ?? {});
      this.ranking.set(actual.ranking ?? []);
      this.periodos.set((historial.data as unknown as Periodo[]) ?? []);
    } catch (e) {
      this.notificaciones.error(e, 'No se cargó la competencia');
    } finally {
      this.cargando.set(false);
    }
  }

  protected tope(filas: FilaRanking[]): number {
    return Math.max(1, ...filas.map((f) => f.puntos));
  }

  /** Quien tuvo menos puntos (si hay más de uno en el ranking) */
  protected ultimo(filas: FilaRanking[]): FilaRanking | null {
    return filas.length > 1 ? filas[filas.length - 1] : null;
  }

  protected textoPuntos(p: Record<string, number>): string {
    return this.tiposConColaboracion.map((t) => `${t.corto || 'Colaborar'} ${p[t.tipo] ?? 0}`).join(' · ');
  }

  protected async cerrarPeriodo(): Promise<void> {
    const c = this.cierre();
    if (!c) return;
    this.guardando.set(true);
    try {
      await this.supabase.rpc('fn_cerrar_periodo', { p_nota: c.nota.trim() || null });
      this.cierre.set(null);
      this.notificaciones.exito('Periodo cerrado. Empieza uno nuevo en 0.');
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e, 'No se cerró el periodo');
    } finally {
      this.guardando.set(false);
    }
  }

  protected async deshacer(): Promise<void> {
    if (!(await this.confirmacion.pedir({ titulo: '¿Deshacer el último cierre?', mensaje: 'Ese periodo se vuelve a juntar con el periodo en curso.',
      aceptar: 'Sí, deshacer' }))) return;
    this.guardando.set(true);
    try {
      await this.supabase.rpc('fn_deshacer_ultimo_periodo');
      this.abierto.set(null);
      this.notificaciones.exito('Cierre deshecho.');
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e, 'No se deshizo');
    } finally {
      this.guardando.set(false);
    }
  }

  protected abrirPuntos(): void {
    this.edicionPuntos.set({ ...this.puntos() });
  }

  protected async guardarPuntos(): Promise<void> {
    const e = this.edicionPuntos();
    if (!e) return;
    const mal = this.tiposConColaboracion.find((t) => !Number.isInteger(e[t.tipo]) || e[t.tipo] < 0 || e[t.tipo] > 20);
    if (mal) return this.notificaciones.aviso(`${mal.texto}: pon un número entre 0 y 20.`);
    this.guardando.set(true);
    try {
      const cambiados = this.tiposConColaboracion.filter((t) => e[t.tipo] !== this.puntos()[t.tipo]);
      for (const t of cambiados) {
        const { error } = await this.supabase.cliente.from('puntos_tipo').update({ puntos: e[t.tipo] }).eq('tipo', t.tipo);
        if (error) throw new ErrorSistema(error);
      }
      this.edicionPuntos.set(null);
      this.notificaciones.exito('Puntos guardados.');
      await this.cargar();
    } catch (err) {
      this.notificaciones.error(err, 'No se guardaron los puntos');
    } finally {
      this.guardando.set(false);
    }
  }

  protected exportar(nombre: string, filas: FilaRanking[]): void {
    descargarCsv(`competencia-${nombre}.csv`,
      ['Puesto', 'Auxiliar', 'Puntos', 'Trabajos', 'Colaboró', ...TIPOS_PUNTOS.map((t) => t.texto), 'Cierres de turno', 'Retrasos'],
      filas.map((f, i) => [i + 1, f.nombre, f.puntos, f.trabajos, f.colaboraciones, ...TIPOS_PUNTOS.map((t) => f.por_tipo[t.tipo] ?? 0), f.cierres, f.retrasos]));
  }
}
