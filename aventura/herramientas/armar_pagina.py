"""Arma una página web de un solo archivo con todo el juego adentro.

Uso:  python3 aventura/herramientas/armar_pagina.py
Genera aventura/publicar/misiones-de-rami.html: se puede abrir con doble clic,
subir a cualquier hosting (GitHub Pages, Netlify…) o mandar por mensaje.
"""
import pathlib, re

RAIZ = pathlib.Path(__file__).resolve().parent.parent
html = (RAIZ / 'index.html').read_text(encoding='utf-8')
for nombre in ('escenarios.js', 'motor.js', 'app.js'):
    codigo = (RAIZ / nombre).read_text(encoding='utf-8').replace('</script', '<\\/script')
    etiqueta = f'<script src="{nombre}"></script>'
    assert etiqueta in html, nombre
    html = html.replace(etiqueta, f'<script>\n/* {nombre} */\n{codigo}\n</script>')
salida = RAIZ / 'publicar' / 'misiones-de-rami.html'
salida.parent.mkdir(exist_ok=True)
salida.write_text(html, encoding='utf-8')
print(f'{salida} ({len(html.encode()) // 1024} KB)')
