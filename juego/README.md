# Misión: Dientes Limpios — juego paso a paso

Juego educativo infantil en una sola página (`index.html`, sin dependencias): primer plano frontal del niño en un baño azul desenfocado y 8 pasos guiados de cepillado.

El estilo sigue el video de referencia: formato 4:3, piel cálida, pelo castaño oscuro, ojos grandes con pestañas marcadas, puño grande sobre el cepillo, flechas curvas bajo el mentón, parpadeo e interfaz de vidrio esmerilado. `capturas/demo-paso2.mp4` muestra 5 s del paso 2 en movimiento y `capturas/demo-superdiente.mp4` la entrada de Superdiente, cómo habla y el festejo al agarrar el cepillo.

![Mosaico de pantallas](capturas/mosaico.png)

## Flujo
1. **Inicio**: título, «¡Vamos a cepillarnos paso a paso!» y botón **Comenzar**.
1. **Tu misión**: Superdiente (muela con capa roja, aura dorada y haz de luz) saluda y pide «¡Agarrá tu cepillo de dientes para empezar!». Al tocar el cepillo (o la flecha), vuela hacia la mano del niño y empieza el paso 1.
2. **8 pasos de 20 s** cada uno: dientes de arriba, de abajo, parte de adelante, parte de atrás (arriba y abajo), molares (arriba y abajo) y enjuague.
   - Reloj circular, píldora «n/8» con el nombre del paso, lista vertical de progreso y flechas ‹ ›.
   - Consigna con botón de altavoz: se lee en voz alta (voz del navegador, `es-AR`).
   - El cepillo se mueve como indica el paso (lado a lado, arriba-abajo, adelante-atrás o en círculos) y hay flechas guía que laten.
   - Manchitas de sarro que se van limpiando mientras corre el reloj; al terminar, «¡Muy bien!» con destellos y avance automático.
3. **Final**: «¡Lo hiciste!», racha de días (guardada en el navegador) y **Volver al inicio**.

## Para animadores
Todo el dibujo es SVG generado por código: el brazo se recalcula en cada fotograma para seguir la mano, así que basta con mover el cepillo (`colocarProp`). Las posiciones y los movimientos de cada paso están en la tabla `PASOS`.

Capturas: `cd juego && NODE_PATH="$(npm root -g)" node herramientas/capturas.js`

## Superdiente en SVGator

`herramientas/superdiente_svgator.py` convierte el dibujo de Superdiente al formato de proyecto de SVGator y le agrega la animación en capas (bucle de 2,4 s):
- **principal:** vuela subiendo y bajando, con estirado/aplastado y balanceo;
- **secundaria:** capa que flamea con retraso, saludo del brazo, llama de la varita;
- **ambiente:** aura que respira, haz de luz que titila, líneas de velocidad, destellos escalonados y parpadeo.

El proyecto ya está creado en la cuenta de SVGator («Superdiente — Misión: Dientes Limpios»). Para exportarlo como SVG animado hace falta el plan Starter de SVGator; el archivo exportado va en `recursos/superdiente-animado.svg`.

## Fondos pintados (OpenArt)

`recursos/fondo-bano.jpg` (baño, pasos y misión) y `recursos/fondo-noche.jpg` (inicio y final) se generaron con OpenArt (Seedream 4.5) tomando como referencia un cuadro del video de PixVerse. Las versiones actuales son las del plan Free y traen la marca de agua de OpenArt; para quitarla, descargá las mismas imágenes sin marca desde OpenArt (plan pago), reemplazá estos dos archivos con el mismo nombre y corré `python3 herramientas/incrustar_fondos.py`. Los fondos van incrustados dentro de `index.html`, así se ven aunque el archivo se abra suelto (por ejemplo, en la vista previa de la app).

## Videos por escena (formato del video de referencia)

Si existe `recursos/videos/<escena>.mp4` (o `.webm`), el juego lo reproduce en bucle debajo de la interfaz y oculta el dibujo; si no existe, se usa el dibujo animado. Nombres: `mision`, `paso1` … `paso8`. Pensado para clips de 5 s generados con PixVerse V6 (OpenArt) a partir de las capturas del juego.

Por ahora están integrados los dos videos de referencia tal como vinieron: `paso2` (PixVerse, «Dientes de abajo») y `mision` (DomoAI, Superdiente). Traen su propia interfaz y marca de agua dibujadas; la interfaz del juego va encima.
