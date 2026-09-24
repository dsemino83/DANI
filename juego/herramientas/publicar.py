"""Arma la versión publicable del juego (página única) en la ruta indicada.

Quita el esqueleto <html>/<head>/<body> (lo agrega el visor) e incrusta los
fondos pintados como data: URI, porque el visor no carga imágenes externas
dentro del SVG. Los videos se publican aparte, en recursos/videos/.

Uso:  python3 herramientas/publicar.py /ruta/salida.html
"""
import base64, re, sys

s = open('index.html', encoding='utf-8').read()
s = re.sub(r'<!DOCTYPE html>\s*<html[^>]*>\s*<head>\s*', '', s)
s = re.sub(r'<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*', '', s)
s = s.replace('</head>\n<body>\n', '').replace('</body>\n</html>', '')
for var, ruta in [('FONDO_BANO', 'recursos/fondo-bano.jpg'), ('FONDO_NOCHE', 'recursos/fondo-noche.jpg')]:
    datos = base64.b64encode(open(ruta, 'rb').read()).decode()
    s = s.replace("var %s = '%s';" % (var, ruta), "var %s = 'data:image/jpeg;base64,%s';" % (var, datos))
open(sys.argv[1], 'w', encoding='utf-8').write(s)
