import sys, openpyxl, json, re
sys.argv_ = sys.argv
exec(open(sys.argv[2]).read().split("sin_doc, sin_mat, pares")[0].replace("wb = openpyxl.load_workbook(sys.argv[1], data_only=True)","wb = openpyxl.load_workbook(sys.argv[1], data_only=True)"))
LABC = {'ENERO2026':'I','FEBRERO2026':'G','MARZO2026':'G','ABRIL2026':'G','MAYO 2026':'F','JUNIO 2026':'G','JULIO 2026':'F','AGOSTO 2026':'F','SEPTIEMBRE 2026':'F','Hoja1':'F','OCTUBRE 2026':'E'}
OBSC = {'ENERO2026':'J','FEBRERO2026':'H','MARZO2026':'I','ABRIL2026':'H','MAYO 2026':'G','JUNIO 2026':'H','JULIO 2026':'G','AGOSTO 2026':'G','SEPTIEMBRE 2026':'G','Hoja1':'G','OCTUBRE 2026':'F'}
filas=[]
for hoja,(t,m,d) in COLS.items():
    ws=wb[hoja]
    for r in range(1, ws.max_row+1):
        tv=ws[f'{t}{r}'].value
        if not tv or str(tv).strip().upper()=='TURNO': continue
        mv=ws[f'{m}{r}'].value; dv=ws[f'{d}{r}'].value
        mk=nm(mv) if mv else ''; dk=n(dv) if dv else ''
        if mk.startswith(('MEDICINA -','MEDICIAN -','MEDICINA DR.')): dk=n(re.sub(r'^MEDICI\w+\s*(-\s*|DR\.)','',mk))
        if not mk: continue
        mat_ = M.get(mk) or ('EVENTO' if mk in EVENTOS else '??'+mk)
        doc_ = ' '.join(D[dk][:2]) if dk in D else ('-' if not dk or dk in IGNORAR_DOC else '??'+dk)
        lab=str(ws[f'{LABC[hoja]}{r}'].value or '').strip(); obs=str(ws[f'{OBSC[hoja]}{r}'].value or '').strip()
        filas.append(dict(h=hoja,r=r,t=str(tv).strip(),m=mat_,d=doc_,lab=lab,obs=obs))
json.dump(filas,open(sys.argv[3],'w'),ensure_ascii=False)
for f in filas:
    if f['m']=='EVENTO': continue
    print(f"{f['h'][:3]}{f['r']:>3} {f['t']:<6} {f['m'][:34]:<34} {f['d'][:20]:<20} {f['lab']:<12} {f['obs'][:150]}")
