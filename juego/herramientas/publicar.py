"""Arma la versión publicable del juego (página única) en la ruta indicada.

Quita el esqueleto <html>/<head>/<body> (lo agrega el visor). Los fondos ya
vienen incrustados en index.html (ver incrustar_fondos.py); los videos se
publican aparte, en recursos/videos/.

Uso:  python3 herramientas/publicar.py /ruta/salida.html
"""
import re, sys

s = open('index.html', encoding='utf-8').read()
s = re.sub(r'<!DOCTYPE html>\s*<html[^>]*>\s*<head>\s*', '', s)
s = re.sub(r'<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*', '', s)
s = s.replace('</head>\n<body>\n', '').replace('</body>\n</html>', '')
open(sys.argv[1], 'w', encoding='utf-8').write(s)
