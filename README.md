# Sistema de Validación de Tickets

## Breve descripción del proyecto

Este proyecto consiste en un sistema y web orientado a la validación automatizada de tickets mediante códigos QR (como los de facturas ARCA/AFIP). Utiliza un microcontrolador ESP32 conectado a un escáner QR (GM65), una pantalla LCD I2C y botones físicos para confirmar o cancelar la entrega del ticket. Todo esto se comunica en tiempo real con una API backend desarrollada en Node.js y una base de datos local para llevar el registro y evitar la reutilización de códigos.

## el diagrama de bloques esta en el archivo de drive que comparte el grupo con el profesor link(https://docs.google.com/document/d/1iNZiMFNOItrqVSI3LIKi-OrVv0SkiQohIEM4Ge5YpTg/edit?usp=sharing)

# Deploy

Este documento detalla los pasos necesarios para desplegar y poner en funcionamiento el backend y la base de datos del **Sistema de Validación de Tickets** en el equipo servidor (netbook) y sincronizarlo con el dispositivo ESP32.

---

Manual de Usuario e Instrucciones de Deploy

1. Requisitos de Hardware

   ESP32 NodeMCU-32S.

   Lector de códigos QR GM65 (conectado a los pines RX: 16, TX: 17).

   Pantalla LCD 16x2 con módulo I2C (pines SDA: 21, SCL: 22).

   Dos botones táctiles conectados a los pines 4 (Confirmar) y 5 (Cancelar / Reinicio por presión prolongada).

2. Despliegue y Ejecución del Servidor (Backend en Netbook)

   Conéctate a la red Wi-Fi de la escuela PEINE-3. La netbook actúa como servidor con la IP fija 10.56.2.19. (o puede cambiar si estas cambiadno en ecomputdora )

   Abre la terminal en la carpeta del proyecto e instala las dependencias (si aún no lo hiciste):
   Bash

   npm install

   Inicia la API ejecutando el script principal de Node.js:
   Bash

   node index.js

   El servidor deberá quedar a la escucha en http://10.56.2.19:3000.

3. Configuración y Subida del Firmware (ESP32)

   Abre el código en el Arduino IDE.

   Verifica que el dispositivo esté apuntando a la IP correcta del servidor en el código:
   C++

   const char* WIFI_SSID = "PEINE-3";
   const char* WIFI_PASSWORD = "etecPeine3";
   const char\* API_URL = "[http://10.56.2.19:3000/validar?url=](http://10.56.2.19:3000/validar?url=)";

   Selecciona la placa ESP32 Dev Module, conéctala por USB a la netbook y sube el código a 115200 baudios.

4. Modo de Uso Operativo

   En espera: La pantalla LCD mostrará "SISTEMA TICKETS / Esperando QR...".

   Validación: Escanea un código QR con el GM65. El sistema consultará la API automáticamente.

   Confirmación / Cancelación: Presiona el Botón 4 para confirmar la entrega del ticket válido, o el Botón 5 para cancelar.

   Reinicio del sistema: Puedes reiniciar la ESP32 de forma remota escribiendo la letra r en el Monitor Serie (a 115200 baudios) o manteniendo presionado el Botón 5 durante 3 segundos directamente desde el gabinete.

## Ejecucion con Docker Compose

### Requisitos
- Docker y Docker Compose instalados.

### Levantar el proyecto desde cero
```bash
docker compose up -d --build
```

### Servicios y puertos
- **API / Web (`app-tickets`):** `http://localhost:3001` (interno puerto `3000`, `node:18-alpine`)
- **Base de datos (`pb-tickets`):** `http://localhost:8091/_/` (interno puerto `8090`, PocketBase)

### Variables de entorno
- `PORT`: puerto interno de la API (por defecto `3000`).
- `POCKETBASE_URL`: URL de conexion a PocketBase (en Compose: `http://pocketbase:8090`).

### Persistencia
- Los datos y migraciones de PocketBase se persisten en `./pb_data` y `./pb_migrations` montados como volumenes en el contenedor `pb-tickets`.

### Detener los servicios
```bash
docker compose down
```
