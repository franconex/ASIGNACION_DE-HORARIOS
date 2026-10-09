import { Component, effect, ElementRef, inject, input } from '@angular/core';
import {
  ArrowLeftRight, Ban, Camera, ChartColumn, Handshake, Package, Trophy, BookOpen, Building2, CalendarCheck, CalendarDays, CalendarPlus, CalendarRange, Check,
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleCheck, Copy, ClipboardList, Clock, Cpu, Download, Eye, GraduationCap, Info,
  KeyRound, LayoutGrid, Layers, List, Lock, LogOut, MapPin, Menu, Monitor, Palette, Pencil, Plus, Repeat,
  RotateCcw, School, Search, Settings, Shuffle, Star, Sun, Moon, Table2, TriangleAlert, Trash2, User, Users, Wrench, X,
} from 'lucide';

/** Nodo de ícono de Lucide: [etiqueta, atributos] */
type NodoIcono = [string, Record<string, string | number>][];

/** Íconos disponibles en el sistema (nombre en español -> ícono Lucide) */
const ICONOS: Record<string, NodoIcono> = {
  panel: LayoutGrid as NodoIcono, calendario: CalendarDays as NodoIcono, registros: ClipboardList as NodoIcono,
  configuracion: Settings as NodoIcono, usuarios: Users as NodoIcono, salir: LogOut as NodoIcono,
  menu: Menu as NodoIcono, cerrar: X as NodoIcono, agregar: Plus as NodoIcono, editar: Pencil as NodoIcono,
  eliminar: Trash2 as NodoIcono, ceder: ArrowLeftRight as NodoIcono, reubicar: Shuffle as NodoIcono,
  evento: Star as NodoIcono, defensa: GraduationCap as NodoIcono, mantenimiento: Wrench as NodoIcono,
  alerta: TriangleAlert as NodoIcono, check: Check as NodoIcono, ok: CircleCheck as NodoIcono,
  anterior: ChevronLeft as NodoIcono, siguiente: ChevronRight as NodoIcono, buscar: Search as NodoIcono,
  descargar: Download as NodoIcono, laboratorio: Monitor as NodoIcono, aula: School as NodoIcono,
  materia: BookOpen as NodoIcono, docente: User as NodoIcono, hora: Clock as NodoIcono, ubicacion: MapPin as NodoIcono,
  suspender: Ban as NodoIcono, nuevaClase: CalendarPlus as NodoIcono, restaurar: RotateCcw as NodoIcono,
  carrera: Building2 as NodoIcono, asignacion: CalendarCheck as NodoIcono, info: Info as NodoIcono,
  capas: Layers as NodoIcono, equipo: Cpu as NodoIcono, rango: CalendarRange as NodoIcono, repetir: Repeat as NodoIcono,
  clave: KeyRound as NodoIcono, color: Palette as NodoIcono, grilla: Table2 as NodoIcono, lista: List as NodoIcono,
  grafico: ChartColumn as NodoIcono, trofeo: Trophy as NodoIcono,
  ver: Eye as NodoIcono, candado: Lock as NodoIcono, sol: Sun as NodoIcono, luna: Moon as NodoIcono,
  objeto: Package as NodoIcono, camara: Camera as NodoIcono, entregar: Handshake as NodoIcono,
  arriba: ChevronUp as NodoIcono, abajo: ChevronDown as NodoIcono, copiar: Copy as NodoIcono,
};

/**
 * Ícono SVG profesional (Lucide). Uso: <app-icono nombre="ceder" [tamano]="16" />
 * Hereda el color del texto (currentColor).
 */
@Component({
  selector: 'app-icono',
  host: { class: 'inline-flex shrink-0 items-center justify-center', 'aria-hidden': 'true' },
  template: '',
})
export class IconoComponent {
  private readonly elemento = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly nombre = input.required<string>();
  readonly tamano = input(18);
  readonly grosor = input(2);

  constructor() {
    // Dibuja el SVG cada vez que cambia el nombre o el tamaño
    effect(() => {
      const nodo = ICONOS[this.nombre()];
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      const atributos: Record<string, string> = {
        width: String(this.tamano()), height: String(this.tamano()), viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', 'stroke-width': String(this.grosor()), 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      };
      Object.entries(atributos).forEach(([k, v]) => svg.setAttribute(k, v));
      for (const [etiqueta, attrs] of nodo ?? []) {
        const hijo = document.createElementNS(ns, etiqueta);
        Object.entries(attrs).forEach(([k, v]) => hijo.setAttribute(k, String(v)));
        svg.appendChild(hijo);
      }
      this.elemento.nativeElement.replaceChildren(svg);
    });
  }
}
