# Tareas de Rami

Página de tareas con audios y temporizador, con los mismos fondos que Misión: Dientes Limpios.

- **Primera vez:** pide el nombre y el fondo; el nombre aparece en el saludo de la pantalla principal.
- **Fondos:** «Baño» y «Hotel de monstruos» (los videos de inicio de Superdiente). Se cambian con la ruedita.
- **Acceso directo** a Superdiente arriba a la izquierda (`../juego/`).
- **Tareas:** agregar, editar y borrar. Se guardan en el celular (IndexedDB), con sus audios.
- **Audios:** se pueden subir tantos como se quiera o grabarlos con el micrófono, ordenarlos y escucharlos.
  Al empezar la tarea se decodifican todos y se programan en el reloj de Web Audio uno pegado al otro: suenan sin cortes.
- **Pantalla de la tarea:** al tocar ▶ se abre una pantalla aparte con el nombre de la tarea, los audios y la cuenta regresiva.
- **Atrás y salir:** siempre visibles arriba. Atrás cierra la ventana abierta o vuelve a la lista (también con el botón atrás del celular); salir muestra «¡Hasta la próxima!».
- **Momento de cada audio:** primero se pone el tiempo y después, en cada audio, el reloj: «Al empezar» (en cadena, sin pausas) o «Cuando falten X» (por ejemplo, cuando falten 0:10). Los programados suenan exactamente en ese momento, medidos con el reloj de audio; si dos coinciden, suenan uno atrás del otro.
- **Temporizador:** el conteo arranca justo cuando empieza el segundo audio de «Al empezar» (con un solo audio, cuando termina; sin audios, al tocar Empezar). minutos y segundos editables por tarea (0:00 = sin temporizador). Cuenta regresiva con pausa;
  al llegar a 0 aparece la alerta «¡Tiempo!» con alarma y vibración. Si la app quedó en segundo plano, manda un aviso del sistema.
