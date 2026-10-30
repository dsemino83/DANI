# Secretos y criptografía — Vault / HSM (preparación)

Estado actual de los secretos y la criptografía, y la **ruta de migración** a Vault y HSM/KMS, sin hacerlos
obligatorios ni cambiar la criptografía actual innecesariamente.

## Secretos — hoy

Todos los secretos se leen **de archivos** (Docker secrets) vía la convención `<NOMBRE>_FILE`, nunca de la
imagen ni del repositorio. El helper `leer()` en `backend/src/config.js` resuelve `<NOMBRE>_FILE` antes que la
variable plana.

Secretos en uso: base de datos (operativa e histórica), OIDC (service account de Keycloak), SMTP, llave
maestra de cifrado (`CREDENCIALES_MASTER_KEY`), token de métricas (`METRICS_TOKEN`), y —si se usa— el secreto
de ZAP. `.gitignore` excluye `.env` y `secrets/*.txt`; no hay secretos reales commiteados.

## Criptografía — hoy

- La clave API del banco se cifra en reposo con AES vía la **llave maestra** (32 bytes), en
  `backend/src/secretos.js`.
- El login al banco cifra la clave con la llave pública RSA del banco (`backend/src/bdv/cliente.js`).
- La cadena de auditoría usa hash encadenado (SHA-256).

## Abstracción para Vault / HSM

La migración se apoya en dos costuras conceptuales, **sin cambiar la criptografía actual**:

- **SecretProvider** — "dame el secreto X". Hoy: archivo (`*_FILE`). Mañana: Vault (lease dinámico, rotación).
  El único punto de lectura es `leer()` en `config.js` y `secretos.js`; un provider Vault se enchufa ahí
  (leer de la API de Vault en vez del archivo) sin tocar el resto del código.
- **CryptoProvider** — "cifrá / firmá con la llave K". Hoy: la llave maestra vive en memoria del proceso.
  Mañana: un HSM/KMS realiza la operación **sin exponer la llave** (la llave nunca sale del HSM). El punto de
  uso es `secretos.js` (cifrar/descifrar) y el login RSA; un provider KMS reemplaza la operación local.

Objetivo de la abstracción: que el día de mañana se cambie **dónde vive la llave y quién hace la operación
criptográfica**, no el formato ni los algoritmos.

## Reglas

- Vault/HSM **no son obligatorios**: el sistema funciona con secretos por archivo.
- Las claves **nunca** se exponen (ni en logs, ni en métricas, ni en trazas).
- No se cambia la criptografía actual sin necesidad.

## Estado

- Secretos por archivo (`*_FILE`): **IMPLEMENTADO**.
- Abstracción SecretProvider/CryptoProvider: **PREPARADO** (documentada la costura; el código concentra la
  lectura de secretos y las operaciones cripto en pocos puntos).
- Vault real / HSM/KMS real: **REQUIERE INFRAESTRUCTURA**. No desplegado.
