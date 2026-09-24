"""Genera el proyecto de SVGator de Superdiente (JSON) a partir del mismo dibujo del juego.

Uso:  python3 herramientas/superdiente_svgator.py > superdiente-svgator.json
El JSON resultante es el `document` que recibe create_project/replace_project del MCP de SVGator.

Animación (bucle de 2,4 s, personalidad "Playful"):
  primaria  – vuelo: sube y baja con estirado/aplastado y balanceo;
  secundaria– capa que flamea con retraso, saludo del brazo, varita que chispea;
  ambiente  – aura que respira, haz de luz que titila, destellos escalonados, parpadeo.
"""
import json, re, math, sys

DUR = 2400
SUAVE = {"type": "cubic-bezier", "value": {"from": {"x": 0.45, "y": 0}, "to": {"x": 0.55, "y": 1}}}
REBOTE = {"type": "cubic-bezier", "value": {"from": {"x": 0.34, "y": 1.3}, "to": {"x": 0.64, "y": 1}}}

def color(h, a=1):
    h = h.lstrip('#'); return {"type": "color", "value": {"r": int(h[0:2], 16), "g": int(h[2:4], 16), "b": int(h[4:6], 16), "a": a}}

def r1(v): return round(v, 1)

def nodos(d, dx=0, dy=0):
    """Convierte un atributo d (M L H V C Q Z, absolutos o relativos) a nodos de SVGator."""
    toks = re.findall(r'[MLHVCQZmlhvcqz]|-?\d*\.?\d+(?:e-?\d+)?', d)
    i, cmd = 0, None
    x = y = sx = sy = 0
    subtrazos, nodos_ = [], []
    def num():
        nonlocal i; v = float(toks[i]); i += 1; return v
    def agrega(px, py, c_in=None):
        n = {"x": r1(px + dx), "y": r1(py + dy), "type": "corner"}
        if c_in: n["start"] = {"x": r1(c_in[0] + dx), "y": r1(c_in[1] + dy)}
        nodos_.append(n)
    def sale(cx, cy):
        nodos_[-1]["end"] = {"x": r1(cx + dx), "y": r1(cy + dy)}
    while i < len(toks):
        t = toks[i]
        if re.match(r'[A-Za-z]', t): cmd = t; i += 1
        rel = cmd.islower(); C = cmd.upper()
        if C == 'Z':
            if nodos_:
                if (abs(nodos_[-1]["x"] - (sx + dx)) > .05 or abs(nodos_[-1]["y"] - (sy + dy)) > .05):
                    agrega(sx, sy)
                subtrazos.append(nodos_); nodos_ = []
            x, y = sx, sy; continue
        if C == 'M':
            nx, ny = num(), num()
            if rel: nx += x; ny += y
            if nodos_: subtrazos.append(nodos_); nodos_ = []
            x, y, sx, sy = nx, ny, nx, ny; agrega(x, y); cmd = 'l' if rel else 'L'; continue
        if C == 'L':
            nx, ny = num(), num()
            if rel: nx += x; ny += y
            x, y = nx, ny; agrega(x, y); continue
        if C == 'H':
            nx = num(); x = nx + x if rel else nx; agrega(x, y); continue
        if C == 'V':
            ny = num(); y = ny + y if rel else ny; agrega(x, y); continue
        if C == 'C':
            a = [num() for _ in range(6)]
            if rel: a = [a[k] + (x if k % 2 == 0 else y) for k in range(6)]
            sale(a[0], a[1]); x, y = a[4], a[5]; agrega(x, y, (a[2], a[3])); continue
        if C == 'Q':
            a = [num() for _ in range(4)]
            if rel: a = [a[k] + (x if k % 2 == 0 else y) for k in range(4)]
            c1 = (x + 2 / 3 * (a[0] - x), y + 2 / 3 * (a[1] - y))
            c2 = (a[2] + 2 / 3 * (a[0] - a[2]), a[3] + 2 / 3 * (a[1] - a[3]))
            sale(*c1); x, y = a[2], a[3]; agrega(x, y, c2); continue
        raise ValueError(cmd)
    if nodos_: subtrazos.append(nodos_)
    # SVGator solo respeta los puntos de control en nodos de tipo "cusp"
    for ns in subtrazos:
        for n in ns:
            if "start" in n or "end" in n: n["type"] = "cusp"
    return subtrazos

def circulo_d(cx, cy, rx, ry=None):
    ry = ry or rx; k = 0.5523
    return (f"M{cx+rx} {cy}C{cx+rx} {cy+ry*k} {cx+rx*k} {cy+ry} {cx} {cy+ry}C{cx-rx*k} {cy+ry} {cx-rx} {cy+ry*k} {cx-rx} {cy}"
            f"C{cx-rx} {cy-ry*k} {cx-rx*k} {cy-ry} {cx} {cy-ry}C{cx+rx*k} {cy-ry} {cx+rx} {cy-ry*k} {cx+rx} {cy}Z")

def forma(titulo, d, relleno=None, trazo=None, ancho=0, dx=0, dy=0, opacidad=1):
    """Un <path> por subtrazo; si hay varios, se agrupan."""
    partes = []
    for k, ns in enumerate(nodos(d, dx, dy)):
        el = {"type": "path", "title": titulo if k == 0 else f"{titulo} {k+1}",
              "properties": {"shape": {"path": ns},
                             "fill": {"paint": relleno or {"type": "none"}, "opacity": 1, "rule": False},
                             "stroke": {"paint": trazo or {"type": "none"}, "opacity": 1, "width": ancho,
                                        "lineCap": "round", "lineJoin": "round", "miterLimit": 4, "dashOffset": 0, "dashArray": []},
                             "compositing": {"opacity": opacidad}}}
        partes.append(el)
    return partes[0] if len(partes) == 1 else grupo(titulo, 0, 0, partes)

def tr(ox, oy):
    return {"origin": {"x": r1(ox), "y": r1(oy), "type": "corner"}, "translate": {"x": 0, "y": 0},
            "scale": {"x": 1, "y": 1}, "skew": {"x": 0, "y": 0}, "rotate": 0, "autoRotate": False}

def grupo(titulo, ox, oy, hijos, animadores=None):
    g = {"type": "g", "title": titulo, "properties": {"transform": tr(ox, oy)}, "children": hijos}
    if animadores: g["animators"] = animadores
    return g

def claves(pares, easing=SUAVE):
    return {"disabled": False, "keys": [{"time": t, "value": v, "easing": easing} for t, v in pares]}

AZ, BL = color('#1F5FC0'), color('#FFFFFF')
CUERPO = ('M-110-70C-110-150-50-165 0-135C50-165 110-150 110-70C110-20 98 20 90 60C80 120 72 160 45 160'
          'C18 160 20 100 0 100C-20 100-18 160-45 160C-72 160-80 120-90 60C-98 20-110-20-110-70Z')

def brazo(titulo, d, dx, dy):
    return [forma(titulo + ' borde', d, trazo=AZ, ancho=32, dx=dx, dy=dy),
            forma(titulo, d, trazo=BL, ancho=20, dx=dx, dy=dy)]

def puno(cx, cy, dx, dy):
    return forma('Puño', circulo_d(cx, cy, 23), relleno=BL, trazo=AZ, ancho=6, dx=dx, dy=dy)

def destello(titulo, x, y, r, t0):
    d = f"M0 {-r}Q0 0 {r} 0Q0 0 0 {r}Q0 0 {-r} 0Q0 0 0 {-r}Z"
    t1, t2 = (t0 + 400) % DUR, (t0 + 800) % DUR
    ks = sorted([(0, None)] + [(t0, .3), (t1, 1.15), (t2, .3)], key=lambda p: p[0])
    # escala y opacidad escalonadas, bucle sin salto
    esc = [(t0, {"x": .3, "y": .3}), (t0 + 400, {"x": 1.15, "y": 1.15}), (t0 + 800, {"x": .3, "y": .3})]
    op = [(t0, 0), (t0 + 400, 1), (t0 + 800, 0)]
    if t0 > 0: esc = [(0, {"x": .3, "y": .3})] + esc; op = [(0, 0)] + op
    esc.append((DUR, {"x": .3, "y": .3})); op.append((DUR, 0))
    return grupo(titulo, x, y, [forma(titulo + ' forma', d, relleno=color('#FFF3B0'), trazo=BL, ancho=2)],
                 {"transform": {"scale": claves(esc, REBOTE)}, "compositing": {"opacity": claves(op)}})

def superdiente():
    aura = grupo('Aura', 0, 0, [{
        "type": "path", "title": "Aura círculo",
        "properties": {"shape": {"path": nodos(circulo_d(0, 0, 260))[0]},
                       "fill": {"paint": {"type": "radial-gradient", "value": {"center": {"x": .5, "y": .5}, "radius": .5, "stops": [
                           {"color": {"r": 255, "g": 247, "b": 200, "a": .95}, "offset": 0},
                           {"color": {"r": 255, "g": 226, "b": 122, "a": .55}, "offset": .45},
                           {"color": {"r": 255, "g": 210, "b": 63, "a": 0}, "offset": 1}], "spread": "pad", "fixed": False}},
                                "opacity": 1, "rule": False}}}],
        {"transform": {"scale": claves([(0, {"x": .92, "y": .92}), (1200, {"x": 1.08, "y": 1.08}), (DUR, {"x": .92, "y": .92})])},
         "compositing": {"opacity": claves([(0, .75), (1200, 1), (DUR, .75)])}})
    haz = grupo('Haz de luz', 0, 130, [{
        "type": "path", "title": "Haz forma",
        "properties": {"shape": {"path": nodos('M-56 0L56 0L22 250L-22 250Z')[0]},
                       "fill": {"paint": {"type": "linear-gradient", "value": {"from": {"x": .5, "y": 0}, "to": {"x": .5, "y": 1}, "stops": [
                           {"color": {"r": 255, "g": 243, "b": 176, "a": .95}, "offset": 0},
                           {"color": {"r": 255, "g": 210, "b": 63, "a": 0}, "offset": 1}], "spread": "pad", "fixed": False}},
                                "opacity": 1, "rule": False}}}],
        {"transform": {"scale": claves([(t, {"x": 1 + (.06 if k % 2 else 0), "y": (1, .78, 1.06, .82)[k % 4]})
                                        for k, t in enumerate(range(0, DUR + 1, 300))])}})
    lineas = grupo('Líneas de velocidad', 0, 0, [
        forma('Líneas', 'M-104-204Q0-236 104-204M-60-238Q0-254 60-238M-150-120Q-162-150-150-176M150-120Q162-150 150-176',
              trazo=BL, ancho=6)],
        {"compositing": {"opacity": claves([(0, .3), (1200, .9), (DUR, .3)])}})
    capa = grupo('Capa', 0, -40, [
        forma('Capa izquierda', 'M-90-40Q-150 50-142 176L-124 154L-112 182Q-98 94-86 10Z', relleno=color('#E53935'), trazo=color('#A61C1C'), ancho=4, dy=40),
        forma('Capa derecha', 'M90-40Q150 50 142 176L124 154L112 182Q98 94 86 10Z', relleno=color('#E53935'), trazo=color('#A61C1C'), ancho=4, dy=40),
        forma('Puntas amarillas', 'M-142 176L-124 154L-136 200ZM-124 154L-112 182L-116 204ZM142 176L124 154L136 200ZM124 154L112 182L116 204Z', relleno=color('#FFC53D'), dy=40)],
        {"transform": {"skew": claves([(t, {"x": 7 if k % 2 == 0 else -7, "y": 0}) for k, t in enumerate(range(0, DUR + 1, 600))]),
                       "scale": claves([(t, {"x": 1 if k % 2 == 0 else 1.06, "y": 1}) for k, t in enumerate(range(0, DUR + 1, 300))])}})
    brazo_izq = grupo('Brazo saludo', -96, 0,
        brazo('Brazo izquierdo', 'M-96 0Q-150-12-160-70', 96, 0) + [puno(-162, -84, 96, 0)],
        {"transform": {"rotate": claves([(0, 0), (300, -28), (600, 12), (900, -28), (1200, 0), (DUR, 0)])}})
    llama = grupo('Llama varita', 90, -206, [
        forma('Brillo llama', circulo_d(186, -206, 30), relleno=color('#FFD66B'), dx=-186, dy=206, opacidad=.55),
        forma('Llama', circulo_d(186, -206, 17), relleno=color('#FFB02E'), trazo=color('#F07C1A'), ancho=4, dx=-186, dy=206),
        forma('Chispa', circulo_d(180, -212, 6), relleno=color('#FFF1B8'), dx=-186, dy=206)],
        {"transform": {"scale": claves([(t, {"x": s, "y": s}) for t, s in zip(range(0, DUR + 1, 300), (.85, 1.2, .9, 1.25, .85, 1.2, .9, 1.25, .85))])}})
    brazo_der = grupo('Brazo varita', 96, 0, [
        forma('Vara borde', 'M160-80L184-196', trazo=AZ, ancho=16, dx=-96),
        forma('Vara', 'M160-80L184-196', trazo=color('#6FB6FF'), ancho=8, dx=-96),
        llama] + brazo('Brazo derecho', 'M96 0Q150-12 160-70', -96, 0) + [puno(160, -80, -96, 0)],
        {"transform": {"rotate": claves([(0, 0), (1200, -9), (DUR, 0)])}})
    ojos = grupo('Ojos', 0, -40, [
        forma('Ojo izq', circulo_d(-38, -40, 14, 19), relleno=color('#1B2F5E'), dy=40),
        forma('Ojo der', circulo_d(38, -40, 14, 19), relleno=color('#1B2F5E'), dy=40),
        forma('Brillo ojo izq', circulo_d(-33, -48, 5.5), relleno=BL, dy=40),
        forma('Brillo ojo der', circulo_d(43, -48, 5.5), relleno=BL, dy=40)],
        {"transform": {"scale": claves([(0, {"x": 1, "y": 1}), (1900, {"x": 1, "y": 1}), (1970, {"x": 1.05, "y": .08}),
                                        (2060, {"x": 1, "y": 1}), (DUR, {"x": 1, "y": 1})])}})
    cuerpo = [
        forma('Borde blanco', CUERPO, trazo=BL, ancho=30),
        forma('Cuerpo', CUERPO, relleno=BL, trazo=AZ, ancho=9),
        forma('Sombra celeste', 'M84-120Q104-86 96-30', trazo=color('#BCD9F7'), ancho=10),
        forma('Brillos', 'M74-128Q104-96 98-38M-82-104Q-62-134-30-130', trazo=BL, ancho=12),
        ojos,
        forma('Rubor', circulo_d(-66, -8, 18, 10) + circulo_d(66, -8, 18, 10), relleno=color('#FFB3C1'), opacidad=.85),
        forma('Boca', 'M-28-10Q0 34 28-10Z', relleno=color('#8E2433'), trazo=AZ, ancho=4),
        forma('Lengua', circulo_d(0, 10, 12, 6), relleno=color('#FF7A8A')),
    ]
    diente = grupo('Superdiente', 300, 340,
        [aura, haz, lineas, capa, brazo_izq] + cuerpo + [brazo_der],
        {"transform": {
            "origin": claves([(0, {"x": 300, "y": 340, "type": "corner"}), (1200, {"x": 300, "y": 312, "type": "corner"}),
                              (DUR, {"x": 300, "y": 340, "type": "corner"})]),
            "rotate": claves([(0, -3), (1200, 3), (DUR, -3)]),
            "scale": claves([(0, {"x": 1.04, "y": .96}), (600, {"x": .97, "y": 1.04}), (1200, {"x": 1, "y": 1}),
                             (1800, {"x": .98, "y": 1.02}), (DUR, {"x": 1.04, "y": .96})])}})
    destellos = [destello('Destello 1', 110, 150, 16, 0), destello('Destello 2', 500, 290, 12, 600),
                 destello('Destello 3', 100, 420, 11, 1200), destello('Destello 4', 470, 480, 14, 1500)]
    return {"type": "svg", "title": "Superdiente",
            "animation": {"duration": DUR, "direction": 1, "iterations": 0, "fill": 1, "alternate": False, "speed": 1},
            "properties": {"shape": {"position": {"x": 0, "y": 0}, "size": {"width": 600, "height": 700}, "bgColor": {"type": "none"}}},
            "children": [diente] + destellos}

if __name__ == '__main__':
    json.dump(superdiente(), sys.stdout, ensure_ascii=False, separators=(',', ':'))
