# Tareas de Rami

Página de tareas con audios y temporizador, con los mismos fondos que Misión: Dientes Limpios.

- **Primera vez:** pide el nombre y el fondo; el nombre aparece en el saludo de la pantalla principal.
- **Fondos:** «Baño» y «Hotel de monstruos» (los videos de inicio de Superdiente). Se cambian con la ruedita.
- **Acceso directo** a Superdiente arriba a la izquierda (`../juego/`).
- **Tareas:** agregar, editar y borrar. Se guardan en el celular (IndexedDB), con sus audios.
- **Audios:** se pueden subir tantos como se quiera o grabarlos con el micrófono, ordenarlos y escucharlos.
  Al empezar la tarea se decodifican todos y se programan en el reloj de Web Audio uno pegado al otro: suenan sin cortes.
- **Temporizador:** minutos y segundos editables por tarea (0:00 = sin temporizador). Cuenta regresiva con pausa;
  al llegar a 0 aparece la alerta «¡Tiempo!» con alarma y vibración. Si la app quedó en segundo plano, manda un aviso del sistema.
