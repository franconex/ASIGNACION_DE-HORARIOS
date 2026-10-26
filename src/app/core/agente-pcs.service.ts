import { computed, Injectable, inject, signal } from '@angular/core';
import { AlertaPc, ComponentePc, ConexionPc, EquipoPc } from './modelos';
import { ErrorSistema, SupabaseService } from './supabase.service';

/** Sin latido en este tiempo, la PC se considera apagada (igual que agente_pcs_config; el agente avisa cada 5 min) */
const MINUTOS_APAGADA = 12;
/** Cada cuánto se leen los latidos mientras se mira una vista con PCs */
const SEGUNDOS_LATIDOS = 120;
/** Cada cuánto se releen equipos y alertas (cambian poco) */
const SEGUNDOS_COMPLETO = 600;

/** Texto de cada tipo de alerta */
export const TEXTOS_ALERTA: Record<AlertaPc['tipo'], string> = {
  fuera_de_dominio: 'Fuera del dominio',
  nombre_no_reconocido: 'Nombre no reconocido',
  laboratorio_no_valido: 'Laboratorio no válido',
  nombre_duplicado: 'Nombre duplicado',
  cambio_hardware: 'Cambio de hardware',
  agente_detenido: 'Agente sin señal',
};

/**
 * Datos del agente de inventario de PCs (script 56): si cada PC está
 * prendida, sus componentes, las PCs de OTROS y las alertas.
 *
 * Para gastar poco del plan gratis de Supabase:
 *  - Cada 2 min solo se lee pc_latidos (2 columnas, ~12 KB con 250 PCs).
 *  - Equipos y alertas se releen cada 10 min.
 *  - Con la pestaña oculta o sin vistas abiertas no se consulta nada.
 * Si el script 56 aún no se aplicó, todo queda vacío y la app sigue igual.
 */
@Injectable({ providedIn: 'root' })
export class AgentePcsService {
  private readonly supabase = inject(SupabaseService);

  /** false si las tablas del agente no existen todavía */
  readonly disponible = signal(false);
  /** Equipo -> figurita */
  readonly equipos = signal<Pick<EquipoPc, 'id' | 'pc_id' | 'nombre_equipo' | 'numero_serie'>[]>([]);
  /** Último latido de cada equipo (equipo_id -> fecha ISO) */
  readonly latidos = signal<Map<number, string>>(new Map());
  readonly alertas = signal<AlertaPc[]>([]);
  /** id del ambiente OTROS (PCs que no son de ningún laboratorio) */
  readonly otrosId = signal<number | null>(null);
  /** Hora actual, para recalcular prendida/apagada sin recargar */
  readonly ahora = signal(Date.now());

  /** Último latido de cada figurita (pc_id -> fecha ISO) */
  private readonly latidoPorPc = computed(() => {
    const latidos = this.latidos();
    const mapa = new Map<number, string>();
    for (const equipo of this.equipos()) {
      const latido = latidos.get(equipo.id);
      if (equipo.pc_id && latido) mapa.set(equipo.pc_id, latido);
    }
    return mapa;
  });

  private usuarios = 0;
  private temporizador: ReturnType<typeof setInterval> | null = null;
  private ultimaCargaCompleta = 0;

  /** Una vista que muestra PCs empieza a usar el estado (se refresca solo) */
  activar(): void {
    this.usuarios++;
    if (this.usuarios > 1) return;
    void this.cargar();
    this.temporizador = setInterval(() => {
      // Sin el script 56, o con la pestaña oculta, no se consulta nada
      if (!this.disponible() || document.visibilityState !== 'visible') return;
      this.ahora.set(Date.now());
      void (Date.now() - this.ultimaCargaCompleta >= SEGUNDOS_COMPLETO * 1000 ? this.cargar() : this.cargarLatidos());
    }, SEGUNDOS_LATIDOS * 1000);
  }

  /** La vista se cerró: si nadie más mira, deja de refrescar */
  desactivar(): void {
    this.usuarios = Math.max(0, this.usuarios - 1);
    if (this.usuarios === 0 && this.temporizador) {
      clearInterval(this.temporizador);
      this.temporizador = null;
    }
  }

  /** Lee equipos, latidos, alertas abiertas y el ambiente OTROS */
  async cargar(): Promise<void> {
    const cliente = this.supabase.cliente;
    const [equipos, alertas, otros] = await Promise.all([
      cliente.from('pc_equipos').select('id, pc_id, nombre_equipo, numero_serie'),
      cliente.from('pc_alertas').select('id, equipo_id, tipo, detalle, creada_en, equipo:pc_equipos(nombre_equipo, pc_id)')
        .eq('resuelta', false).order('creada_en', { ascending: false }),
      cliente.from('ambientes').select('id').eq('codigo', 'OTROS').maybeSingle(),
    ]);
    // Sin el script 56 las tablas no existen: se deja todo vacío sin molestar
    if (equipos.error) {
      this.disponible.set(false);
      return;
    }
    this.disponible.set(true);
    this.ultimaCargaCompleta = Date.now();
    this.equipos.set(equipos.data ?? []);
    this.alertas.set((alertas.data ?? []) as unknown as AlertaPc[]);
    this.otrosId.set((otros.data as { id: number } | null)?.id ?? null);
    await this.cargarLatidos();
  }

  /** Lee solo los latidos (lo único que cambia seguido) */
  private async cargarLatidos(): Promise<void> {
    const { data, error } = await this.supabase.cliente.from('pc_latidos').select('equipo_id, ultimo_latido');
    if (error) return;
    this.ahora.set(Date.now());
    this.latidos.set(new Map((data ?? []).map((l) => [l.equipo_id as number, l.ultimo_latido as string])));
  }

  /** ¿La figurita está prendida, apagada o no tiene agente? */
  conexion(pcId: number): ConexionPc {
    const latido = this.latidoPorPc().get(pcId);
    if (!latido) return 'sin_agente';
    return this.ahora() - new Date(latido).getTime() <= MINUTOS_APAGADA * 60_000 ? 'prendida' : 'apagada';
  }

  /** Número de serie de la máquina de una figurita (null si no tiene agente) */
  numeroSerie(pcId: number): string | null {
    return this.equipos().find((e) => e.pc_id === pcId)?.numero_serie ?? null;
  }

  /** Último aviso de la PC (para "apagada · último aviso…") */
  ultimoLatido(pcId: number): string | null {
    return this.latidoPorPc().get(pcId) ?? null;
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

  /** Marca una alerta como revisada y recarga */
  async resolverAlerta(id: number): Promise<void> {
    await this.supabase.rpc('rpc_resolver_alerta_pc', { p_id: id });
    await this.cargar();
  }
}
