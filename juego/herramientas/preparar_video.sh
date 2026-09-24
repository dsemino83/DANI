#!/bin/bash
# Prepara un clip de PixVerse para el juego: bucle ida y vuelta (sin salto), sin audio,
# 960x720, en MP4 (H.264) y WebM (VP9).
# Uso: herramientas/preparar_video.sh origen.mp4 id-del-paso
set -e
FF=${FFMPEG:-ffmpeg}
src="$1"; id="$2"; out="recursos/videos"
filtro="[0:v]scale=960:720,setsar=1,split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0,fps=24[v]"
"$FF" -hide_banner -loglevel error -i "$src" -filter_complex "$filtro" -map "[v]" -an \
  -c:v libx264 -pix_fmt yuv420p -crf 26 -preset slow -movflags +faststart "$out/$id.mp4" -y
"$FF" -hide_banner -loglevel error -i "$src" -filter_complex "$filtro" -map "[v]" -an \
  -c:v libvpx-vp9 -b:v 900k -row-mt 1 "$out/$id.webm" -y
echo "$id: $(stat -c%s "$out/$id.mp4") bytes mp4, $(stat -c%s "$out/$id.webm") bytes webm"
