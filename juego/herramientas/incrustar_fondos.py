"""Incrusta los fondos pintados dentro de index.html (como data: URI).

Así el juego muestra los fondos aunque se abra el archivo suelto, sin la
carpeta recursos/ (por ejemplo, en la vista previa de archivos de la app).
Para cambiar un fondo: reemplazá el .jpg en recursos/ y volvé a correr:

    python3 herramientas/incrustar_fondos.py
"""
import base64, re

FONDOS = {'FONDO_BANO': 'recursos/fondo-bano.jpg', 'FONDO_NOCHE': 'recursos/fondo-noche.jpg'}

s = open('index.html', encoding='utf-8').read()
for var, ruta in FONDOS.items():
    datos = base64.b64encode(open(ruta, 'rb').read()).decode()
    s, n = re.subn(r"var %s = '[^']*';" % var, "var %s = 'data:image/jpeg;base64,%s'; // %s" % (var, datos, ruta), s)
    assert n == 1, var
open('index.html', 'w', encoding='utf-8').write(s)
print('Fondos incrustados en index.html')
