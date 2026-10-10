import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { environment } from '../../../environments/environment';
import { fechaActual, fechaCorta, fechaLarga, hhmm } from '../../core/fechas';
import { RotacionSabado, TurnoCodigo, TurnoProgramado } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { OperacionService, turnosDeHoy } from '../../core/operacion.service';

const NOMBRE_TURNO: Record<TurnoCodigo, string> = { M: 'Mañana', MD: 'Mediodía', T: 'Tarde', N: 'Noche' };

/**
 * Horario del auxiliar: su turno actual y el próximo, con la fecha en que
 * empieza, y los sábados que le tocan (con quién comparte cada uno).
 * Los turnos los programa el admin o el encargado en Auxiliares.
 */
@Component({
  selector: 'app-horario',
  imports: [],
  template: `
    <header class="mb-4">
      <h1 class="text-2xl font-bold">Mi horario</h1>
      <p class="mt-0.5 text-sm text-slate-600">Tu turno de hoy y el que te toca desde la fecha programada.</p>
    </header>

    @if (cargando()) {
      <p class="tarjeta py-10 text-center text-sm text-slate-500">Cargando…</p>
    } @else if (!auth.esAuxiliar() && !auth.esEncargado()) {
      <p class="tarjeta py-10 text-center text-sm text-slate-500">El horario de turnos es de los auxiliares.</p>
    } @else {
      <section class="grid gap-3 sm:grid-cols-2">
        <article class="tarjeta border-t-4 border-t-marca-600 p-5">
          <p class="text-xs font-semibold tracking-wide text-slate-500 uppercase">Turno actual</p>
          @if (horario().actual; as t) {
            <p class="mt-1 text-3xl font-bold text-marca-700">{{ nombre(t.turno) }}</p>
            <p class="mt-1 text-sm text-slate-600">{{ horarioDe(t.turno) }}</p>
            <p class="mt-2 text-xs text-slate-500">Desde el {{ fechaLarga(t.desde) }}</p>
          } @else {
            <p class="mt-1 text-lg font-semibold text-slate-500">Sin turno asignado</p>
          }
        </article>

        <article class="tarjeta border-t-4 border-t-amber-500 p-5">
          <p class="text-xs font-semibold tracking-wide text-slate-500 uppercase">Próximo turno</p>
          @if (horario().proximo; as t) {
            <p class="mt-1 text-3xl font-bold text-slate-800">{{ nombre(t.turno) }}</p>
            <p class="mt-1 text-sm text-slate-600">{{ horarioDe(t.turno) }}</p>
            <p class="mt-2 text-xs text-slate-500">A partir del {{ fechaLarga(t.desde) }}</p>
          } @else {
            <p class="mt-1 text-lg font-semibold text-slate-500">Aún no hay un cambio programado</p>
          }
        </article>
      </section>

      <section class="mt-6">
        <h2 class="mb-1 text-lg font-semibold">Mis sábados</h2>
        <p class="mb-2 text-sm text-slate-600">El sábado vale este turno, no el de lunes a viernes.</p>
        <div class="space-y-2">
          @for (s of misSabados(); track s.id) {
            <article class="tarjeta flex flex-wrap items-center gap-3 border-l-4 p-3"
                     [class]="s.fecha === hoy() ? 'border-l-emerald-500' : 'border-l-indigo-500'">
              <div class="min-w-0 flex-1">
                <p class="font-semibold capitalize">{{ fechaLarga(s.fecha) }}
                  @if (s.fecha === hoy()) { <span class="chip ml-1 bg-emerald-100 text-emerald-700 normal-case">Hoy</span> }
                </p>
                @if (s.turno) { <p class="text-sm text-slate-600">{{ nombre(s.turno) }} · {{ horarioDe(s.turno) }}</p> }
                @if (companerosDe(s); as otros) { <p class="text-xs text-slate-500">Con {{ otros }}</p> }
                @if (s.nota) { <p class="text-xs text-slate-500">{{ s.nota }}</p> }
              </div>
            </article>
          } @empty {
            <p class="tarjeta py-6 text-center text-sm text-slate-500">No tienes sábados asignados próximamente.</p>
          }
        </div>
      </section>

      <section class="mt-6">
        <h2 class="mb-2 text-lg font-semibold">Historial de mis turnos</h2>
        <div class="tarjeta overflow-x-auto">
          <table class="tabla">
            <thead><tr><th>A partir del</th><th>Turno</th><th>Horario</th><th>Estado</th></tr></thead>
            <tbody>
              @for (t of misTurnos(); track t.id) {
                <tr>
                  <td class="font-medium">{{ fechaCorta(t.desde) }}</td>
                  <td>{{ nombre(t.turno) }}</td>
                  <td class="text-sm text-slate-500">{{ horarioDe(t.turno) }}</td>
                  <td>
                    @if (t.id === horario().actual?.id) { <span class="chip bg-emerald-100 text-emerald-700">Vigente</span> }
                    @else if (t.id === horario().proximo?.id) { <span class="chip bg-amber-100 text-amber-800">Próximo</span> }
                    @else if (t.desde < hoy()) { <span class="chip bg-slate-200 text-slate-600">Anterior</span> }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="4" class="py-6 text-center text-sm text-slate-500">Aún no tienes turnos programados.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
})
export class HorarioComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly op = inject(OperacionService);
  private readonly notificaciones = inject(NotificacionesService);

  protected readonly cargando = signal(true);
  private readonly programados = signal<TurnoProgramado[]>([]);
  /** Rotación de sábados de todos (para saber con quién me toca) */
  private readonly rotacion = signal<RotacionSabado[]>([]);
  protected readonly hoy = signal(fechaActual(environment.zonaHoraria));
  protected readonly fechaCorta = fechaCorta;
  protected readonly fechaLarga = fechaLarga;

  /** Mis turnos (más reciente primero) */
  protected readonly misTurnos = computed(() => {
    const id = this.auth.perfil()?.id;
    return this.programados().filter((t) => t.perfil_id === id).sort((a, b) => b.desde.localeCompare(a.desde));
  });
  /** Mis sábados de hoy en adelante (el más cercano primero) */
  protected readonly misSabados = computed(() => {
    const id = this.auth.perfil()?.id;
    return this.rotacion().filter((r) => r.auxiliar_id === id && r.fecha >= this.hoy())
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  });
  /** Turno vigente y próximo, según la fecha de hoy */
  protected readonly horario = computed(() => {
    const id = this.auth.perfil()?.id ?? '';
    return turnosDeHoy(this.programados(), id, this.hoy());
  });

  ngOnInit(): void {
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    try {
      const [programados, rotacion] = await Promise.all([
        this.op.listarTurnosProgramados(), this.op.listarRotacion(), this.op.cargarHorarios(),
      ]);
      this.programados.set(programados);
      this.rotacion.set(rotacion);
    } catch (e) {
      this.notificaciones.error(e, 'No se cargó el horario');
    } finally {
      this.cargando.set(false);
    }
  }

  protected nombre(turno: TurnoCodigo): string {
    return NOMBRE_TURNO[turno];
  }

  /** Nombres de los demás que están ese mismo sábado ('' si voy solo) */
  protected companerosDe(s: RotacionSabado): string {
    return this.rotacion().filter((r) => r.fecha === s.fecha && r.auxiliar_id !== s.auxiliar_id)
      .map((r) => `${r.auxiliar?.nombre_completo ?? '¿?'}${r.turno && r.turno !== s.turno ? ` (${NOMBRE_TURNO[r.turno]})` : ''}`).join(', ');
  }

  /** '07:00 – 12:00' según los horarios configurados */
  protected horarioDe(turno: TurnoCodigo): string {
    const h = this.op.horarios().find((x) => x.turno === turno);
    return h ? `${hhmm(h.hora_inicio)} – ${hhmm(h.hora_fin)}` : '';
  }
}
