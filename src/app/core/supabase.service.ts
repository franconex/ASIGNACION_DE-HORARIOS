import { Injectable } from '@angular/core';
import { createClient, PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

/**
 * Cliente único de Supabase para toda la aplicación.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  /** Cliente de Supabase (auth + base de datos) */
  readonly cliente: SupabaseClient = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  /**
   * Ejecuta una función RPC y devuelve sus datos o lanza un error legible.
   * @param nombreFuncion nombre de la función en Postgres
   * @param parametros parámetros de la función
   */
  async rpc<T>(nombreFuncion: string, parametros: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.cliente.rpc(nombreFuncion, parametros);
    if (error) throw new ErrorSistema(error);
    return data as T;
  }
}

/**
 * Error con mensaje en español a partir de un error de Postgres/PostgREST.
 */
export class ErrorSistema extends Error {
  /** Sugerencia que manda la base (campo HINT) */
  readonly sugerencia: string | null;

  constructor(error: PostgrestError | { message: string; hint?: string | null; code?: string }) {
    super(traducirError(error));
    this.sugerencia = error.hint ?? null;
  }
}

/** Traduce códigos de error comunes a mensajes entendibles */
function traducirError(error: { message: string; code?: string }): string {
  switch (error.code) {
    case '23505': return 'Ya existe un registro con esos datos (valor duplicado).';
    case '23503': return 'No se puede completar: el registro está siendo usado por otros datos.';
    case '42501': return 'No tiene permisos para realizar esta acción.';
    case 'PGRST301': return 'Su sesión expiró. Vuelva a iniciar sesión.';
    default:
      // Errores técnicos de la API (relaciones, columnas): no se muestran tal cual
      if (error.code?.startsWith('PGRST')) return 'No se pudo cargar la información. Intente de nuevo; si sigue igual, avise al administrador.';
      return error.message;
  }
}
