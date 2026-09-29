"""Genera las dos versiones de un solo archivo a partir de pagina.html y los .js:

- Conversor-VALO.html: para abrir localmente (datos en el navegador). Trae todo adentro.
- compartido/conversor-valo-compartido.html: la página que se publica en claude.ai con la base
  compartida. Sin <html>/<head>/<body> (los agrega la publicación), SheetJS desde cdnjs y sin la
  tabla de bancos embebida (vive en la base: maestros/bancos y maestros/bancosOriginales).

Uso: python3 construir.py   (volver a ejecutarlo después de modificar pagina.html o algún .js)
"""
import os
import re

CARPETA = os.path.dirname(os.path.abspath(__file__))
SHEETJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"


def leer(nombre):
    with open(os.path.join(CARPETA, nombre), encoding="utf-8") as f:
        return f.read()


def escribir(nombre, html):
    destino = os.path.join(CARPETA, nombre)
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with open(destino, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    print("Generado:", destino, f"({len(html.encode('utf-8')) // 1024} KB)")


def script_en_linea(nombre):
    return "<script>\n" + leer(nombre).replace("</script", "<\\/script") + "\n</script>"


fuente = leer("pagina.html")

# Versión local: todo embebido.
local = re.sub(r'<script src="([^"?]+)(?:\?[^"]*)?"></script>', lambda m: script_en_linea(m.group(1)), fuente)
escribir("Conversor-VALO.html", local)


# Versión compartida (claude.ai).
def script_compartido(m):
    src = m.group(1)
    if src.startswith("vendor/xlsx"):
        return f'<script src="{SHEETJS_CDN}"></script>'
    if src in ("bancos-iniciales.js", "bancos-meli-iniciales.js"):
        return ""
    return script_en_linea(src)


titulo = re.search(r"<title>.*?</title>", fuente, re.S).group(0)
estilo = re.search(r"<style>.*?</style>", fuente, re.S).group(0)
cuerpo = re.search(r"<body>(.*)</body>", fuente, re.S).group(1)
cuerpo = re.sub(r'<script src="([^"?]+)(?:\?[^"]*)?"></script>', script_compartido, cuerpo)
escribir(os.path.join("compartido", "conversor-valo-compartido.html"), titulo + "\n" + estilo + "\n" + cuerpo.strip() + "\n")
