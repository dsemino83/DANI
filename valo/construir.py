"""Genera Conversor-VALO.html: la página completa en un solo archivo (sin dependencias externas).

Uso: python3 construir.py   (volver a ejecutarlo después de modificar index.html, app.js, motor.js o bancos-iniciales.js)
"""
import os
import re

CARPETA = os.path.dirname(os.path.abspath(__file__))


def leer(nombre):
    with open(os.path.join(CARPETA, nombre), encoding="utf-8") as f:
        return f.read()


def en_linea(match):
    codigo = leer(match.group(1)).replace("</script", "<\\/script")
    return "<script>\n" + codigo + "\n</script>"


html = re.sub(r'<script src="([^"]+)"></script>', en_linea, leer("index.html"))
destino = os.path.join(CARPETA, "Conversor-VALO.html")
with open(destino, "w", encoding="utf-8", newline="\n") as f:
    f.write(html)
print("Generado:", destino, f"({len(html.encode('utf-8')) // 1024} KB)")
