import { computed, Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { ComponentePc, ConexionPc, EquipoPc } from './modelos';
import { ErrorSistema, SupabaseService } from './supabase.service';

/** Cada cuánto se releen equipos y estados por si se perdió algún aviso (respaldo) */
const SEGUNDOS_RESPALDO = 600;

/** Fila de pc_conexion (script 57): prendida o apagada y desde cuándo */
interface FilaConexion {
  equipo_id: number;
  prendida: boolean;
  cambio_en: string;
}

/**
 * Datos del agente de inventario de PCs (scripts 56 y 57): si cada PC está
 * prendida, sus componentes, si está en el dominio y las PCs de OTROS.
 *
 * Prendida / apagada llega AL INSTANTE por Supabase Realtime: la base solo
 * envía un mensaje cuando una PC cambia de estado, así que la página no
 * pregunta cada rato (casi no gasta transferencia). Cada 10 minutos, con la
 * pestaña visible, se relee todo por si se perdió algún aviso.
 * Si los scripts aún no se aplicaron, todo queda vacío y la app sigue igual.
 */
@Injectable({ providedIn: 'root' })
export class AgentePcsService {
  private readonly supabase = inject(SupabaseService);

  /** false si las tablas del agente no existen todavía */
  readonly disponible = signal(false);
  /** Equipo -> figurita */
  readonly equipos = signal<Pick<EquipoPc, 'id' | 'pc_id' | 'nombre_equipo' | 'numero_serie' | 'en_dominio'>[]>([]);
  /** Estado de cada equipo (equipo_id -> prendida y desde cuándo) */
  readonly estados = signal<Map<number, FilaConexion>>(new Map());
  /** id del ambiente OTROS (PCs que no son de ningún laboratorio) */
  readonly otrosId = signal<number | null>(null);

  /** Estado de cada figurita (pc_id -> fila de conexión) */
  private readonly estadoPorPc = computed(() => {
    const estados = this.estados();
    const mapa = new Map<number, FilaConexion>();
    for (const equipo of this.equipos()) {
      const estado = estados.get(equipo.id);
      if (equipo.pc_id && estado) mapa.set(equipo.pc_id, estado);
    }
    return mapa;
  });

  private usuarios = 0;
  private temporizador: ReturnType<typeof setInterval> | null = null;
  private canal: RealtimeChannel | null = null;

  /** Una vista que muestra PCs empieza a usar el estado (escucha los cambios en vivo) */
  activar(): void {
    this.usuarios++;
    if (this.usuarios > 1) return;
    void this.cargar().then(() => this.escuchar());
    // Respaldo cada 10 minutos, solo con la pestaña visible
    this.temporizador = setInterval(() => {
      if (this.disponible() && document.visibilityState === 'visible') void this.cargar();
    }, SEGUNDOS_RESPALDO * 1000);
  }

  /** La vista se cerró: si nadie más mira, deja de escuchar */
  desactivar(): void {
    this.usuarios = Math.max(0, this.usuarios - 1);
    if (this.usuarios > 0) return;
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
    if (this.canal) void this.supabase.cliente.removeChannel(this.canal);
    this.canal = null;
  }

  /** Lee equipos, estados y el ambiente OTROS */
  async cargar(): Promise<void> {
    const cliente = this.supabase.cliente;
    const [equipos, estados, otros] = await Promise.all([
      cliente.from('pc_equipos').select('id, pc_id, nombre_equipo, numero_serie, en_dominio'),
      cliente.from('pc_conexion').select('equipo_id, prendida, cambio_en'),
      cliente.from('ambientes').select('id').eq('codigo', 'OTROS').maybeSingle(),
    ]);
    // Sin los scripts las tablas no existen: se deja todo vacío sin molestar
    if (equipos.error) {
      this.disponible.set(false);
      return;
    }
    this.disponible.set(true);
    this.equipos.set(equipos.data ?? []);
    this.estados.set(new Map(((estados.data ?? []) as FilaConexion[]).map((e) => [e.equipo_id, e])));
    this.otrosId.set((otros.data as { id: number } | null)?.id ?? null);
  }

  /** Se suscribe a los cambios de pc_conexion: llegan solos, al instante */
  private escuchar(): void {
    if (!this.disponible() || this.canal || this.usuarios === 0) return;
    this.canal = this.supabase.cliente
      .channel('pc-conexion')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pc_conexion' }, (cambio) => {
        if (cambio.eventType === 'DELETE') {
          const id = (cambio.old as Partial<FilaConexion>).equipo_id;
          this.estados.update((m) => { const copia = new Map(m); if (id) copia.delete(id); return copia; });
          return;
        }
        const fila = cambio.new as FilaConexion;
        this.estados.update((m) => new Map(m).set(fila.equipo_id, fila));
        // Equipo nuevo (primera vez que se reporta): hay que traer su figurita
        if (!this.equipos().some((e) => e.id === fila.equipo_id)) void this.cargar();
      })
      .subscribe();
  }

  /** ¿La figurita está prendida, apagada o no tiene agente? */
  conexion(pcId: number): ConexionPc {
    const estado = this.estadoPorPc().get(pcId);
    if (!estado) return 'sin_agente';
    return estado.prendida ? 'prendida' : 'apagada';
  }

  /** Desde cuándo está apagada (o prendida) la PC */
  ultimoLatido(pcId: number): string | null {
    return this.estadoPorPc().get(pcId)?.cambio_en ?? null;
  }

  /** ¿La máquina de la figurita está fuera del dominio? (false si no tiene agente) */
  fueraDeDominio(pcId: number): boolean {
    const equipo = this.equipos().find((e) => e.pc_id === pcId);
    return !!equipo && !equipo.en_dominio;
  }

  /** Número de serie de la máquina de una figurita (null si no tiene agente) */
  numeroSerie(pcId: number): string | null {
    return this.equipos().find((e) => e.pc_id === pcId)?.numero_serie ?? null;
  }

  /** Datos completos y componentes de la máquina de una figurita (null si no tiene agente) */
  async componentes(pcId: number): Promise<{ equipo: EquipoPc; componentes: ComponentePc[] } | null> {
    const { data: equipo, error } = await this.supabase.cliente.from('pc_equipos').select('*').eq('pc_id', pcId).maybeSingle();
    if (error) throw new ErrorSistema(error);
    if (!equipo) return null;
    const { data: componentes, error: errorComponentes } = await this.supabase.cliente.from('pc_componentes')
      .select('*').eq('equipo_id', equipo.id).order('tipo').order('orden');
    if (errorComponentes) throw new ErrorSistema(errorComponentes);
    return { equipo: equipo as EquipoPc, componentes: (componentes ?? []) as ComponentePc[] };
  }
}
