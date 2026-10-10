"""Genera la carga de asignaciones 2026 a partir de filas.json (Excel normalizado).
Simula choques de laboratorio y de docente antes de producir el SQL."""
import json, sys, re, datetime as dt
from collections import defaultdict

filas = json.load(open(sys.argv[1]))
SALIDA_SQL = sys.argv[2]

D = dt.date
def fecha(s): return D.fromisoformat(s)
def hm(s): h, m = map(int, s.split(':')); return h * 60 + m
def txt(mins): return f'{mins // 60:02d}:{mins % 60:02d}'

FERIADOS = {fecha(x) for x in ['2026-01-01','2026-01-22','2026-02-16','2026-02-17','2026-04-03','2026-05-01','2026-06-04',
            '2026-06-21','2026-08-06','2026-11-02','2026-12-25','2027-01-01','2027-01-22','2027-02-08','2027-02-09']}
MESES = {'ENE':1,'FEB':2,'MAR':3,'ABR':4,'MAY':5,'JUN':6,'JUL':7,'AGO':8,'HOJ':9,'OCT':10}
BLOQUE = {'M':('07:30','10:30'), 'MD':('10:30','13:30'), 'T':('16:00','19:00'), 'N':('19:00','22:00'),
          'SAB-M':('07:30','10:30'), 'SAB-T':('16:00','19:00')}
L, Ma, X, J, V, S = 1, 2, 3, 4, 5, 6

def lab(s):
    m = re.search(r'LAB\s*-?\s*0?(\d+)', str(s).upper())
    return f'LAB-{int(m.group(1)):02d}' if m else None

CARRERA_RED = {'Redes I','Redes II','Redes III','Redes IV','Taller de Redes','Seguridad en Redes','Redes Inalámbricas y Móviles',
  'Tecnologías Inalámbricas','Sistemas de Radiocomunicación I','Sistemas de Radiocomunicación II','Medios de Transmisión',
  'Antenas y Propagación','Instalación y Certificación de Redes','Sistemas de Comunicación Óptica','Comunicaciones Digitales I',
  'Fundamentos de Sistemas de Comunicación','Análisis de Sistemas y Señales','Sistemas Digitales I','Sistemas Digitales II',
  'Electrónica II','Circuitos Eléctricos II','Campos Electromagnéticos','Modalidad de Grado - Examen de Grado Redes'}
CARRERA_OTRA = {'Trading':'COM','Investigación de Mercado I':'COM','Investigación Operativa I':'COM','Cálculo I':'COM',
  'Estadística Descriptiva':'COM','Planificación de Marketing':'MKT','Diseño Gráfico':'CCS','Herramientas Digitales':'CCS',
  'Derecho Administrativo y Regulatorio':'DER','Derecho de Hidrocarburos':'DER','Deontología':'DER','Dibujo Computarizado':'IND'}
def carrera(materia, turno):
    if materia == 'Estadística Inferencial' and turno.startswith('SAB'): return 'COM'
    return CARRERA_OTRA.get(materia) or ('RED' if materia in CARRERA_RED else 'SIS')

# ---------------------------------------------------------------------------
# Notas del Excel interpretadas fila por fila (clave: HOJA-fila)
#   dias: días en el lab base (lista) o {día: lab}   reub: {día: destino}
#   reub_f: {fecha: destino}   hora: (inicio, fin)   fechas: lista explícita
#   desde: {día: fecha}  (ese día solo desde esa fecha)   grupo, lab, skip
# Destino: 'LAB-04' (otro laboratorio) o texto (aula).
# ---------------------------------------------------------------------------
AULA = 'Aula (según Excel)'
O = {
 # ENERO
 'ENE-2': dict(reub={L:'D08'}), 'ENE-9': dict(reub_f={'2026-01-15':'C04'}),
 'ENE-12': dict(dias=[L,Ma,J,V]), 'ENE-13': dict(dias=[L,Ma,X,J]), 'ENE-14': dict(dias=[L,Ma,J,V]),
 'ENE-15': dict(dias=[L,Ma,J,V]), 'ENE-16': dict(dias=[L,Ma,J]), 'ENE-17': dict(dias=[L,Ma,J,V]),
 'ENE-18': dict(reub_f={'2026-01-16':'PG02 (posgrado)','2026-01-23':'PG02 (posgrado)'}),
 'ENE-19': dict(dias=[L,Ma,J,V]), 'ENE-20': dict(dias=[Ma,X,J,V]),
 'ENE-23': dict(dias={X:'LAB-01', V:'LAB-03'}), 'ENE-24': dict(dias={X:'LAB-04'}), 'ENE-25': dict(dias={X:'LAB-05'}),
 'ENE-26': dict(dias={X:'LAB-06', V:'LAB-06'}), 'ENE-27': dict(dias={L:'LAB-10', X:'LAB-07'}), 'ENE-29': dict(dias={X:'LAB-09'}),
 # FEBRERO
 'FEB-5': dict(dias=[L,X,V]), 'FEB-6': dict(dias={Ma:'LAB-04', J:'LAB-04'}),
 'FEB-7': dict(dias={L:'LAB-05', Ma:'LAB-06', X:'LAB-05', V:'LAB-05'}), 'FEB-8': dict(dias={Ma:'LAB-05', J:'LAB-05'}),
 'FEB-9': dict(dias=[L,X,J,V]), 'FEB-10': dict(dias=[L,X,V]), 'FEB-11': dict(dias={Ma:'LAB-07', J:'LAB-07'}),
 'FEB-12': dict(dias=[L,Ma,X,J]), 'FEB-13': dict(dias={Ma:'LAB-09', J:'LAB-09', V:'LAB-08'}), 'FEB-14': dict(dias=[L,X,V]),
 'FEB-24': dict(hora=('12:30','15:00')),
 'FEB-33': dict(reub_desde={X:('C27','2026-02-16'), V:('C27','2026-02-16')}),
 'FEB-34': dict(dias={X:'LAB-01', V:'LAB-01'}, desde={X:'2026-02-16', V:'2026-02-16'}),
 'FEB-35': dict(reub_f={'2026-02-12':'D13','2026-02-18':'D13','2026-02-20':'D13'}),
 'FEB-36': dict(lab='LAB-03', fechas=['2026-02-12','2026-02-18','2026-02-20']),
 'FEB-39': dict(reub={J:'D05'}), 'FEB-40': dict(dias=[L,X,V]), 'FEB-41': dict(dias={Ma:'LAB-07', J:'LAB-07'}),
 'FEB-42': dict(reub={Ma:'D05'}), 'FEB-44': dict(reub={J:'C09'}),
 # MARZO
 'MAR-7': dict(reub={X:'LAB-10', J:'LAB-10'}), 'MAR-11': dict(reub={V:'C12'}), 'MAR-12': dict(dias=[L,Ma,V]),
 'MAR-18': dict(dias=[L,X,V], hora=('10:30','12:30')),
 'MAR-19': dict(hora=('12:30','15:00'), reub={X:'LAB-10', J:'LAB-10'}),
 'MAR-20': dict(reub={L:'LAB-03', X:'LAB-03', J:'LAB-03'}),
 'MAR-30': dict(hora=('16:00','19:00')),
 # ABRIL
 'ABR-3': dict(reub={Ma:'D-04'}), 'ABR-5': dict(reub={J:'Biblioteca (sala de audiencia)'}), 'ABR-6': dict(reub={J:'D-04'}),
 'ABR-7': dict(reub={X:'LAB-10', J:'LAB-07'}), 'ABR-9': dict(reub={J:'D14'}),
 'ABR-10': dict(reub={X:'Biblioteca (sala audiovisual)'}), 'ABR-11': dict(reub={L:'Biblioteca (sala audiovisual)'}),
 'ABR-12': dict(reub={X:'D14'}), 'ABR-13': dict(dias={L:'LAB-09', X:'LAB-08', J:'LAB-03'}),
 'ABR-15': dict(grupo='D'), 'ABR-16': dict(reub={Ma:'LAB-04'}),
 'ABR-23': dict(hora=('12:30','15:00')), 'ABR-24': dict(hora=('12:30','15:00')),
 'ABR-25': dict(grupo='B', reub={Ma:'LAB-02'}),
 'ABR-29': dict(dias=[L,X,V]), 'ABR-34': dict(dias=[L,X,V]),
 'ABR-38': dict(reub={V:'C11'}), 'ABR-40': dict(reub={Ma:'C11'}), 'ABR-41': dict(reub={X:'C11'}), 'ABR-43': dict(reub={J:'C11'}),
 'ABR-50': dict(dias={Ma:'LAB-03', X:'LAB-04', J:'LAB-06', V:'LAB-01'}),
 'ABR-52': dict(fechas=['2026-04-11','2026-04-25','2026-05-02']), 'ABR-54': dict(fechas=['2026-04-11','2026-04-25','2026-05-02']),
 'ABR-55': dict(fechas=['2026-04-11','2026-04-25','2026-05-02']), 'ABR-56': dict(fechas=['2026-04-11','2026-04-25','2026-05-02']),
 'ABR-58': dict(fechas=['2026-04-11','2026-04-25','2026-05-02']), 'ABR-59': dict(fechas=['2026-04-11','2026-04-25','2026-05-02']),
 # MAYO
 'MAY-1': dict(reub={V:'B-08'}), 'MAY-2': dict(dias={L:'LAB-08', X:'LAB-09', J:'LAB-07', V:'LAB-10'}),
 'MAY-3': dict(reub={L:'C-16'}, reub_f={'2026-05-28':'C-02'}), 'MAY-4': dict(reub={X:'C-25'}, reub_f={'2026-05-29':'C-02'}),
 'MAY-5': dict(reub={J:AULA}), 'MAY-6': dict(reub={X:'Biblioteca (sala audiovisual)', J:'Biblioteca (sala audiovisual)'}),
 'MAY-9': dict(grupo='B'), 'MAY-10': dict(reub_f={'2026-05-21':'C-02','2026-05-26':'C-02'}),
 'MAY-15': dict(hora=('12:30','15:00')), 'MAY-16': dict(reub={X:'LAB-04', J:'LAB-04'}),
 'MAY-17': dict(hora=('12:30','15:00'), reub={L:'LAB-04', X:'LAB-10'}),
 'MAY-27': dict(hora=('09:00','12:00'), fechas=['2026-05-09','2026-05-16','2026-05-23','2026-05-30']), 'MAY-28': dict(hora=('08:00','11:30')),
 'MAY-34': dict(dias=[L,Ma,J,V]), 'MAY-35': dict(reub={Ma:'C-25'}), 'MAY-36': dict(reub={J:'C-25'}),
 'MAY-37': dict(reub={L:'B-22'}), 'MAY-38': dict(dias={L:'LAB-06', Ma:'LAB-10', X:'LAB-09', V:'LAB-02'}),
 'MAY-40': dict(reub={Ma:'B-22'}), 'MAY-42': dict(reub={X:'C-28'}), 'MAY-45': dict(reub={X:'C-01'}),
 'MAY-46': dict(dias={X:'LAB-08'}), 'MAY-47': dict(dias={Ma:'LAB-01', J:'LAB-04'}),
 # JUNIO
 'JUN-2': dict(reub={X:'Biblioteca (sala audiovisual)', J:'Biblioteca (sala audiovisual)'}),
 'JUN-5': dict(dias=[L,Ma,J,V]), 'JUN-6': dict(dias={L:'LAB-05', Ma:'LAB-05', X:'LAB-04', V:'LAB-05'}),
 'JUN-14': dict(reub={Ma:'LAB-05'}), 'JUN-16': dict(dias=[L,X,V]), 'JUN-17': dict(reub={L:AULA}),
 'JUN-20': dict(hora=('12:30','15:00'), reub={L:'LAB-04'}),
 'JUN-29': dict(reub={Ma:'C25'}), 'JUN-30': dict(dias={Ma:'LAB-06', J:'LAB-10'}), 'JUN-31': dict(reub={V:'C25'}),
 'JUN-32': dict(reub={J:'C25'}), 'JUN-33': dict(skip='laboratorio ilegible ("q")'), 'JUN-34': dict(reub={Ma:'D-14'}),
 'JUN-37': dict(reub_f={'2026-06-16':'C24'}), 'JUN-38': dict(reub={J:'D14'}),
 'JUN-39': dict(dias={V:'LAB-03'}), 'JUN-40': dict(dias={Ma:'LAB-01', J:'LAB-04'}),
 'JUN-44': dict(fechas=['2026-07-04'], hora=('08:00','11:30')),
 # JULIO
 'JUL-1': dict(reub={L:'C19'}), 'JUL-3': dict(reub={X:'C19'}), 'JUL-6': dict(reub_f={'2026-07-10':AULA}), 'JUL-7': dict(reub={J:'C19'}),
 'JUL-21': dict(hora=('12:30','15:00')),
 'JUL-33': dict(reub={Ma:'C25', J:'C27'}), 'JUL-35': dict(reub={X:'C27', V:'A06'}), 'JUL-36': dict(reub={X:'A05', V:'A05'}),
 'JUL-37': dict(dias=[Ma,J]), 'JUL-39': dict(reub={Ma:'D01', J:'D01'}), 'JUL-40': dict(reub={X:'C25', V:'C25'}),
 'JUL-42': dict(reub={Ma:'A06', J:'A06'}), 'JUL-43': dict(dias={Ma:'LAB-10', J:'LAB-10', V:'LAB-03'}),
 'JUL-44': dict(dias={L:'LAB-05', X:'LAB-05', V:'LAB-05'}), 'JUL-45': dict(dias={Ma:'LAB-07', J:'LAB-07'}),
 'JUL-46': dict(dias={L:'LAB-09', X:'LAB-03', J:'LAB-01'}), 'JUL-47': dict(dias={Ma:'LAB-09', J:'LAB-09', V:'LAB-09'}),
 'JUL-48': dict(skip='"Miérc pasa en Lab6" choca con Programación Web I (Román) en LAB-06'),
 'JUL-50': dict(dias={X:'LAB-08', V:'LAB-08'}), 'JUL-51': dict(dias={Ma:'LAB-01'}),
 # AGOSTO
 'AGO-7': dict(reub={J:'D04'}), 'AGO-8': dict(reub={Ma:'D04'}), 'AGO-10': dict(reub={J:'C02'}),
 'AGO-17': dict(lab='LAB-04'), 'AGO-19': dict(hora=('12:30','15:00'), reub={J:'D04'}), 'AGO-20': dict(reub={Ma:'D04'}),
 'AGO-35': dict(reub={L:'Virtual'}), 'AGO-36': dict(dias=[L,X,V]),
 'AGO-38': dict(dias={L:'LAB-03', X:'LAB-06', V:'LAB-06'}), 'AGO-40': dict(reub={Ma:'B02'}), 'AGO-41': dict(reub={J:'D16'}),
 'AGO-42': dict(reub={J:'B01'}),
 'AGO-52': dict(fechas=['2026-08-08','2026-08-15','2026-08-22','2026-08-29'], hora=('08:00','11:30')),
 # SEPTIEMBRE (hoja "Hoja1", la versión más completa)
 'HOJ-2': dict(reub={V:'A05'}), 'HOJ-8': dict(reub={Ma:'D04'}), 'HOJ-9': dict(reub={J:'D04'}),
 'HOJ-11': dict(reub={Ma:'C14'}), 'HOJ-12': dict(reub={J:'C14'}), 'HOJ-15': dict(reub={J:'C14'}),
 'HOJ-17': dict(reub_f={'2026-09-22':'A-11'}),
 'HOJ-32': dict(reub={V:'A02'}), 'HOJ-34': dict(reub={L:'A02'}), 'HOJ-36': dict(reub={X:'A02'}),
 'HOJ-37': dict(reub={L:('LAB-03','19:00','20:30')}), 'HOJ-38': dict(reub_f={'2026-09-10':'B09'}),
 'HOJ-39': dict(reub={Ma:'B02'}), 'HOJ-43': dict(reub={J:'B01'}),
 # OCTUBRE
 'OCT-7': dict(reub={V:'A05'}), 'OCT-8': dict(reub={J:'B01'}), 'OCT-9': dict(reub={Ma:'B01'}),
 'OCT-34': dict(reub={Ma:'C29'}), 'OCT-37': dict(dias={L:'LAB-06', Ma:'LAB-03', X:'LAB-06', V:'LAB-06'}),
 'OCT-38': dict(reub={Ma:'D10'}), 'OCT-39': dict(reub={Ma:'B02'}),
 'OCT-41': dict(skip='Hugo Guzmán ya tiene Seguridad Informática a la misma hora en LAB-05 (fila 36)'),
}

# ---------------------------------------------------------------------------
# Medicina: SEMESTRAL, horario más reciente de cada semestre
# ---------------------------------------------------------------------------
SEM1 = ('2026-02-02', '2026-08-01'); SEM2 = ('2026-08-03', '2027-02-02')
MEDICINA = [
 (SEM1, 'Freddy Tinajeros', [(L,'12:45','15:00','LAB-07'),(Ma,'12:45','15:00','LAB-09'),(X,'12:45','15:00','LAB-07'),
   (X,'15:00','16:30','LAB-06'),(X,'18:00','20:15','LAB-07'),(J,'12:45','15:00','LAB-08'),(J,'18:00','19:30','LAB-08'),(V,'13:30','15:00','LAB-08')]),
 (SEM1, 'Emily Arteaga', [(X,'07:15','12:45','LAB-05'),(J,'08:45','14:45','LAB-05'),(S,'08:00','11:00','LAB-10')]),
 (SEM1, 'Mauren Salvatierra', [(L,'10:15','11:45','LAB-10'),(L,'15:00','16:30','LAB-02'),(Ma,'10:15','11:45','LAB-10'),(Ma,'13:30','16:30','LAB-02')]),
 (SEM1, 'Hugo Guzmán', [(L,'10:15','16:30','LAB-06'),(Ma,'13:30','16:30','LAB-06'),(X,'10:15','15:00','LAB-06'),(X,'15:00','16:30','LAB-07'),
   (J,'10:15','16:30','LAB-06'),(V,'10:15','16:30','LAB-06')]),
 (SEM1, 'Wilmer Campos', [(L,'12:00','15:00','LAB-10'),(Ma,'12:00','15:00','LAB-10'),(V,'12:00','15:00','LAB-10')]),
 (SEM2, 'Wilmer Campos', [(d,'12:00','14:15','LAB-10') for d in (L,Ma,X,J,V)]),
 (SEM2, 'Freddy Tinajeros', [(L,'14:15','20:15','LAB-06'),(Ma,'14:15','20:15','LAB-06'),(X,'11:00','12:00','LAB-06'),(X,'14:15','18:45','LAB-06'),
   (J,'14:15','21:00','LAB-06'),(V,'12:00','17:45','LAB-06')]),
 (SEM2, 'Hugo Guzmán', [(L,'11:00','12:45','LAB-09'),(Ma,'11:00','14:15','LAB-09'),(Ma,'14:15','18:45','LAB-10'),(V,'11:00','14:15','LAB-09'),(V,'15:00','16:30','LAB-10')]),
 (SEM2, 'Emily Arteaga', [(Ma,'07:15','13:30','LAB-08'),(Ma,'18:45','21:45','LAB-08'),(J,'08:45','11:45','LAB-07'),(J,'18:45','21:45','LAB-10'),(S,'12:45','17:15','LAB-09')]),
]

def dias_rango(a, b):
    d = a
    while d <= b:
        yield d; d += dt.timedelta(days=1)

asig = []      # asignaciones a crear
omitidas = []  # (clave, motivo)
for f in filas:
    hoja = f['h'][:3].upper()
    if hoja == 'SEP': continue            # se usa "Hoja1", la versión completa de septiembre
    clave = f"{hoja}-{f['r']}"
    o = O.get(clave, {})
    if f['m'] == 'EVENTO': continue
    if f['m'] == 'Medicina (laboratorio)': continue   # va como semestral
    if o.get('skip'): omitidas.append((clave, f"{f['m']} · {f['d']}: {o['skip']}")); continue
    if f['m'].startswith('??') or f['d'].startswith('??') or f['d'] == '-':
        omitidas.append((clave, f"{f['m']} · {f['d']}: sin docente")); continue
    base = o.get('lab') or lab(f['lab'])
    sab = f['t'].replace(' ', '').startswith('SAB')
    dias = o.get('dias') or ([S] if sab else [L, Ma, X, J, V])
    mapa = dias if isinstance(dias, dict) else {d: base for d in dias}
    if any(v is None for v in mapa.values()):
        omitidas.append((clave, f"{f['m']} · {f['d']}: sin laboratorio ({f['lab'] or 'vacío'})")); continue
    turno = f['t'].replace(' ', '')
    turno = 'SAB-M' if turno.startswith('SAB-M') else 'SAB-T' if turno.startswith('SAB') else turno
    hi, hf = o.get('hora') or BLOQUE[turno]
    mes = MESES[hoja]
    if o.get('fechas'):
        fechas = [fecha(x) for x in o['fechas']]
    else:
        fechas = [d for d in dias_rango(D(2026, mes, 1), D(2026, mes + 1, 1) - dt.timedelta(days=1))]
    fechas = [d for d in fechas if d.isoweekday() in mapa and d not in FERIADOS
              and (d.isoweekday() not in o.get('desde', {}) or d >= fecha(o['desde'][d.isoweekday()]))]
    if not fechas: omitidas.append((clave, f"{f['m']} · {f['d']}: sin fechas")); continue
    asig.append(dict(clave=clave, sistema='MOD_SEMI' if sab else 'MOD_PRES', docente=f['d'], materia=f['m'],
                     carrera=carrera(f['m'], turno), grupo=o.get('grupo'), fechas=fechas,
                     horarios=[(d, hm(hi), hm(hf), l) for d, l in sorted(mapa.items())],
                     obs=(f['obs'][:240] if f['obs'] else None), o=o, fila=f))

for (ini, fin), doc, hs in MEDICINA:
    asig.append(dict(clave=f"MED-{doc}-{ini[:7]}", sistema='SEMESTRAL', docente=doc, materia='Medicina (laboratorio)',
                     carrera='MED', grupo=None, inicio=fecha(ini), fin=fecha(fin), fechas=None,
                     horarios=[(d, hm(a), hm(b), l) for d, a, b, l in hs], obs=None, o={}, fila=None))

# ---------------------------------------------------------------------------
# Ocupaciones día a día (como fn_ocupaciones) + reubicaciones
# ---------------------------------------------------------------------------
reubs = {}   # (clave, idx_horario, fecha) -> (destino_lab|None, aula|None, hi, hf, motivo)
def ocurrencias(a):
    if a['sistema'] == 'SEMESTRAL':
        fechas = [d for d in dias_rango(a['inicio'], a['fin']) if d not in FERIADOS]
    else:
        fechas = a['fechas']
    for d in fechas:
        for i, (dow, hi, hf, l) in enumerate(a['horarios']):
            if d.isoweekday() == dow: yield d, i, hi, hf, l

# Reubicaciones explícitas de las notas
for a in asig:
    o = a['o']
    for d, i, hi, hf, l in ocurrencias(a):
        dest = o.get('reub_f', {}).get(d.isoformat()) or o.get('reub', {}).get(d.isoweekday())
        if not dest and d.isoweekday() in o.get('reub_desde', {}):
            dd, desde = o['reub_desde'][d.isoweekday()]
            if d >= fecha(desde): dest = dd
        if dest:
            if isinstance(dest, tuple): reubs[(a['clave'], i, d)] = (dest[0], None, hm(dest[1]), hm(dest[2]), 'Según Excel: ' + (a['obs'] or ''))
            elif dest.startswith('LAB-'): reubs[(a['clave'], i, d)] = (dest, None, hi, hf, 'Según Excel: ' + (a['obs'] or ''))
            else: reubs[(a['clave'], i, d)] = (None, dest, None, None, 'Según Excel: ' + (a['obs'] or ''))

def efectivas():
    """(fecha, ini, fin, lab, docente, clave, idx) de lo que ocupa un laboratorio, aplicando reubicaciones."""
    out = []
    for a in asig:
        for d, i, hi, hf, l in ocurrencias(a):
            r = reubs.get((a['clave'], i, d))
            if r:
                if r[0] is None: continue
                l, hi, hf = r[0], r[2], r[3]
            out.append((d, hi, hf, l, a['docente'], a['clave'], i))
    return out

# Medicina se queda el laboratorio: la otra clase se acorta o se va al aula
med = defaultdict(list)
for d, hi, hf, l, doc, cl, i in efectivas():
    if cl.startswith('MED-'): med[d].append((hi, hf, l, doc))
recortes = 0; movidas = 0
for a in asig:
    if a['clave'].startswith('MED-'): continue
    for d, i, hi, hf, l in list(ocurrencias(a)):
        r = reubs.get((a['clave'], i, d))
        if r and r[0] is None: continue
        if r: l, hi, hf = r[0], r[2], r[3]
        for mhi, mhf, ml, mdoc in med[d]:
            if not (hi < mhf and mhi < hf) or (ml != l and mdoc != a['docente']): continue
            if hi < mhi and mhi - hi >= 45: hf = mhi
            elif hf > mhf and hf - mhf >= 45 and hi >= mhi: hi = mhf
            else:
                reubs[(a['clave'], i, d)] = (None, AULA, None, None, 'Medicina usa el laboratorio (según Excel)'); movidas += 1; break
            reubs[(a['clave'], i, d)] = (l, None, hi, hf, f'Cede el laboratorio a Medicina desde/hasta las {txt(mhi if hf == mhi else mhf)}'); recortes += 1

# Recortes que se repiten en TODAS las fechas de un horario: se aplican al horario mismo
grupos = defaultdict(list)
for (cl, i, d), r in reubs.items(): grupos[(cl, i)].append((d, r))
plegados = 0
for a in asig:
    if a['clave'].startswith('MED-'): continue
    for i, h in enumerate(a['horarios']):
        fechas_h = [d for d, j, *_ in ocurrencias(a) if j == i]
        rs = dict(grupos.get((a['clave'], i), []))
        if not fechas_h or len(rs) != len(fechas_h): continue
        valores = {(r[0], r[2], r[3]) for r in rs.values()}
        if len(valores) == 1:
            l2, hi2, hf2 = valores.pop()
            if l2 == h[3] and hi2 is not None:
                a['horarios'][i] = (h[0], hi2, hf2, h[3])
                for d in rs: del reubs[(a['clave'], i, d)]
                plegados += 1
print('Horarios ajustados por Medicina (recorte fijo):', plegados)

# Choques que quedan
choques = []
por_dia = defaultdict(list)
for e in efectivas(): por_dia[e[0]].append(e)
for d, lista in por_dia.items():
    for x in range(len(lista)):
        for y in range(x + 1, len(lista)):
            a, b = lista[x], lista[y]
            if a[1] < b[2] and b[1] < a[2] and (a[3] == b[3] or a[4] == b[4]) and a[5] != b[5]:
                choques.append((d, a, b))
print(f"{len(asig)} asignaciones ({sum(1 for a in asig if a['sistema']=='SEMESTRAL')} de Medicina) · {len(reubs)} reubicaciones "
      f"({recortes} recortes y {movidas} movidas por Medicina) · {len(omitidas)} filas omitidas · {len(choques)} choques")
vistos = set()
for d, a, b in sorted(choques):
    k = (a[5], b[5])
    if k in vistos: continue
    vistos.add(k)
    print(f"  CHOQUE {d} {'lab' if a[3]==b[3] else 'docente'}: {a[5]} {txt(a[1])}-{txt(a[2])} {a[3]} {a[4]}  <>  {b[5]} {txt(b[1])}-{txt(b[2])} {b[3]} {b[4]}")
print('OMITIDAS:'); [print('  ', c, m) for c, m in omitidas]

json.dump(dict(asig=[{**{k: v for k, v in a.items() if k not in ('o', 'fila')},
                      'fechas': [x.isoformat() for x in a['fechas']] if a['fechas'] else None,
                      'inicio': a.get('inicio').isoformat() if a.get('inicio') else min(a['fechas']).isoformat(),
                      'fin': a.get('fin').isoformat() if a.get('fin') else max(a['fechas']).isoformat()} for a in asig],
               reubs=[[k[0], k[1], k[2].isoformat(), *v] for k, v in reubs.items()],
               omitidas=omitidas, choques=len(choques)), open(SALIDA_SQL, 'w'), ensure_ascii=False, default=str)
