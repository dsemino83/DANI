# Plan de videos con OpenArt (PixVerse V6)

Objetivo: que los 9 pasos se vean como el video de referencia de PixVerse (niño pintado,
baño azul, cepillado natural), con la interfaz del juego encima (reloj, cartel, lista,
consigna y flechas funcionando).

## Proceso

1. **Imagen de arranque por paso** (image2image, Seedream 4.5, ~15 créditos c/u):
   referencia `recursos/referencias/nino-referencia.png` (último cuadro del video de
   PixVerse, sin interfaz). Mismo niño, mismo baño, mismo encuadre, **sin textos ni interfaz**,
   con el cepillo en la zona del paso.
2. **Video por paso** (image2video, PixVerse V6, 5 s, 540p = 50 créditos c/u; 720p = 70):
   la imagen de arranque como primer cuadro y el movimiento del paso.
3. Guardar cada clip como `recursos/videos/<id>.mp4` (y `.webm`); el juego los toma solos.

Costo estimado: 9 × 15 + 9 × 50 ≈ **585 créditos** en 540p (≈ 765 en 720p), más reintentos.

## Texto común (se agrega a cada imagen)

> Same boy, same face, same hair, same blue t-shirt, same blue tiled bathroom with the
> shelf, plant, star towel and bright window as the reference image. Same 2D cartoon
> painterly style and camera framing: close-up of the boy's head and shoulders, centered,
> head top slightly cropped. Absolutely NO text, NO user interface, NO buttons, NO timer,
> NO numbers, NO arrows, NO watermark.

## Pasos

| # | id | Imagen de arranque | Movimiento del video |
|---|----|--------------------|----------------------|
| 1 | dientes-adelante | Teeth closed in a big smile showing front teeth; toothbrush held horizontally with the right hand, bristles on the front teeth. | Brushes the front teeth with small up-and-down strokes, gentle foam, blinks, happy. |
| 2 | muelas-arriba | Mouth open; toothbrush reaching the upper back teeth on the right side of his mouth (viewer's right). | Small circles on the upper back teeth on that side, cheek moves slightly. |
| 3 | muelas-arriba-otro-lado | Mouth open; toothbrush reaching the upper back teeth on the left side of his mouth (viewer's left). | Small circles on the upper back teeth on the other side. |
| 4 | muelas-abajo | Mouth open; toothbrush on the lower back teeth, right side. | Small circles on the lower back teeth. |
| 5 | muelas-abajo-otro-lado | Mouth open; toothbrush on the lower back teeth, left side. | Small circles on the lower back teeth on the other side. |
| 6 | bolsillos | Teeth closed; toothbrush against the outer side teeth next to the right cheek. | Small circles on the side teeth against the cheek. |
| 7 | bolsillos-otro-lado | Teeth closed; toothbrush against the outer side teeth next to the left cheek. | Small circles on the side teeth against the other cheek. |
| 8 | dientes-abajo | Mouth open; toothbrush horizontal on the lower teeth. | Brushes side to side on the lower teeth, foam, blinks. |
| 9 | enjuague | Holding a clear glass of water, cheeks puffed, eyes happily closed, no toothbrush. | Swishes water in the mouth, cheeks puff left and right, then smiles. |

## Resultado (generado el 24/09/2026)

Los 9 videos están en `recursos/videos/<id>.mp4|webm`. Se rehicieron las imágenes de los pasos 3, 5 y 7
(salían con los brazos cruzados o copiaban el texto «PixVerse.ai» de la referencia): para los pasos
«del otro lado» conviene pedir que sostenga el cepillo con UNA sola mano, la del lado correspondiente.
Costo aproximado: 12 imágenes × 15 + 9 videos × 70 ≈ 810 créditos.
