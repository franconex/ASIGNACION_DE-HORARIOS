# Carga de datos reales 2026 (ya aplicada en producción el 2026-10-10)

Origen: `ASIGNACIONES DE LABORATORIOS - ENERO 2026.xlsx` (enero a octubre 2026; septiembre desde la hoja "Hoja1").

1. `normalizar.py` → facultades, docentes y materias sin duplicados (ver `../36_datos_reales_catalogos.sql`).
2. `filas.py` → filas de clase de cada mes, con nombres normalizados.
3. `asignaciones.py` → arma las asignaciones, interpreta las notas del Excel fila por fila (diccionario `O`),
   aplica "Medicina se queda el laboratorio" (recorta o reubica la otra clase) y **simula todos los choques**
   antes de generar la carga.

Reglas usadas:
- Medicina = SEMESTRAL, materia "Medicina (laboratorio)": 1er semestre 02/02/2026 → 01/08/2026, 2do 03/08/2026 → 02/02/2027,
  con el horario más reciente de cada doctor en cada semestre.
- Modular presencial: cada fila = lunes a viernes del mes, sin feriados, en el bloque del turno
  (M 07:30–10:30 · MD 10:30–13:30 · T 16:00–19:00 · N 19:00–22:00; si la nota trae hora, esa).
- Sábados = Modular semipresencial (fechas de la nota o todos los sábados del mes).
- Eventos (defensas, capacitaciones, maestrías, talleres) no se cargaron.

Resultado: 286 asignaciones (9 de Medicina), 1263 horarios, 5046 días, 501 reubicaciones, 0 choques.
