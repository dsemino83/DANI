# Alertas de movimientos por chat de Teams (Power Automate)

El Home Banking manda las **alertas de movimientos** (las de cada hora o cada 30 minutos; **no** el extracto diario) por correo al cliente y, justo después, llama a un flujo de Power Automate que publica el **mismo contenido** por chat de Teams a los **oficiales** de la cartera de ese cliente que lo tengan activado.

- La llamada la hace el backend **una vez por tarea** (por cliente y turno), **después** del correo al cliente.
- Qué oficiales reciben: los de la cartera del cliente con el check **"Recibir las alertas de movimientos por chat de Teams"** activado en *Cartera de oficiales*.
- Destinatario de Teams: el usuario del oficial. Si no contiene `@valo`, se le agrega el dominio (`HB_CHAT_DOMINIO`, por defecto `@valo.ar`): `jperez` → `jperez@valo.ar`.
- Solo se llama al flujo si está configurada la URL (`HB_POWERAUTOMATE_URL`); si no, se manda solo el correo.

## El flujo (3 pasos)

1. **Disparador — "Cuando se recibe una solicitud HTTP"** (*When a HTTP request is received*).
   - Método: `POST`.
   - Esquema JSON del cuerpo: pegá el contenido de [`esquema-alerta.json`](esquema-alerta.json).
   - Al guardar, Power Automate genera la **URL del flujo** (lleva una firma `sig=`): es **secreta**. Va en el backend como `HB_POWERAUTOMATE_URL` (idealmente por `HB_POWERAUTOMATE_URL_FILE`, un secreto de Docker).

2. **"Para cada" (*Apply to each*) sobre `destinatarios`** → dentro, **"Publicar mensaje en un chat o canal"** (*Post message in a chat or channel*, Microsoft Teams):
   - **Publicar como:** Bot de flujo (*Flow bot*).
   - **Publicar en:** Chat con Flow bot (*Chat with Flow bot*).
   - **Destinatario:** el elemento actual (`@{items('Apply_to_each')}`).
   - **Mensaje:** el cuerpo HTML de la alerta. Como Teams admite HTML limitado, conviene una tarjeta simple, por ejemplo:

     ```
     <b>@{triggerBody()?['asunto']}</b><br>
     Cliente: @{triggerBody()?['cliente']} (CUIT @{triggerBody()?['cuit']})<br>
     @{triggerBody()?['html']}
     ```

     Si preferís texto plano, usá `@{triggerBody()?['texto']}`.

3. **"Respuesta" (*Response*)** con código `200` (opcional pero recomendado, así el backend confirma el envío).

> Alternativa: en vez de chat 1 a 1, se puede publicar en un **canal** fijo del equipo; en ese caso el paso 2 no itera `destinatarios` y publica una sola vez. El backend igual manda la lista de `destinatarios` por si se quiere mencionar a cada oficial.

## Cuerpo que envía el backend

`POST` con `Content-Type: application/json` y este cuerpo (mismo contenido que el correo al cliente):

```json
{
  "cliente": "ACME SA",
  "cuit": "30700000001",
  "asunto": "Alerta de movimientos · ACME SA · 22/10/2026 09:30 a 10:00",
  "titulo": "Alerta de movimientos de 09:30:01 a 10:00:00",
  "html": "<div>…el mismo HTML del correo…</div>",
  "texto": "…la misma versión en texto…",
  "destinatarios": ["jperez@valo.ar", "mlopez@valo.ar"]
}
```

## Probar el flujo sin el backend

```sh
curl -X POST "$HB_POWERAUTOMATE_URL" -H 'content-type: application/json' \
  -d '{"cliente":"ACME SA","cuit":"30700000001","asunto":"Prueba","titulo":"Prueba","html":"<b>hola</b>","texto":"hola","destinatarios":["tuusuario@valo.ar"]}'
```

Tiene que llegar el mensaje al chat del Flow bot del destinatario.

## Seguridad

- La URL del flujo es un secreto (incluye la firma `sig=`): no se commitea, va por `HB_POWERAUTOMATE_URL_FILE`.
- El flujo solo publica mensajes de Teams; no recibe datos sensibles del banco más allá del detalle de movimientos que ya va en el correo al cliente.
- Conviene restringir el disparador (IP permitidas del backend) desde la configuración del flujo.
