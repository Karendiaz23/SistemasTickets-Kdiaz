const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

// URL de tu servidor PocketBase (corre localmente en el puerto 8090)
const POCKETBASE_URL = 'http://127.0.0.1:8090';

process.on('uncaughtException', (err) => {
 console.error('💥 Error No Controlado:', err);
});

process.on('unhandledRejection', (reason, promise) => {
 console.error('💥 Promesa rechazada no controlada:', reason);
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Función para obtener la hora local exacta de Argentina (UTC-3) para mostrar en el LCD
function obtenerHoraLocalArgentina() {
  const ahora = new Date();
  const opciones = {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };
  return new Intl.DateTimeFormat('es-AR', opciones).format(ahora);
}

// Función para extraer el CAE de la URL de ARCA
function obtenerCAE(url) {
 if (!url) return null;

 if (url.includes('p=')) {
   try {
     const base64Data = url.split('p=')[1].split('&')[0];
     const decodedData = Buffer.from(base64Data, 'base64').toString('utf-8');
    
     const matchCodAut = decodedData.match(/"codAut":\s*(\d+)/);
     if (matchCodAut) return matchCodAut[1];

     const match14 = decodedData.match(/\b\d{14}\b/);
     if (match14) return match14[0];
   } catch (e) {
     console.log('Error decodificando Base64:', e.message);
   }
 }

 const matchDirect = url.match(/\b\d{14}\b/);
 if (matchDirect) return matchDirect[0];

 return null;
}

// Ruta de validación para la ESP32 / QR usando PocketBase
app.get('/validar', async (req, res) => {
 const urlQr = req.query.url;
 const esConfirmacion = req.query.entregar === 'true';

 console.log("\n==============================================");
 console.log(`📩 Nueva Petición [${esConfirmacion ? 'CONFIRMACIÓN BOTÓN' : 'CONSULTA QR'}]`);
 console.log("URL recibida:", urlQr);

 const cae = obtenerCAE(urlQr);

 if (!cae) {
   console.log("❌ Error: No se pudo extraer CAE de la URL.");
   return res.status(400).json({ valido: false, error: "URL inválida o sin CAE." });
 }

 console.log(`🔍 CAE Extraído: ${cae}`);

 try {
   // 1. Consultar en PocketBase si el ticket ya fue registrado
   const responseCheck = await fetch(`${POCKETBASE_URL}/api/collections/tickets/records?filter=(cae='${cae}')`);
   const dataCheck = await responseCheck.json();

   if (dataCheck.items && dataCheck.items.length > 0) {
     const fila = dataCheck.items[0];
     // Mostramos la hora de creación que ya tiene PocketBase guardada
     const fechaGuardada = fila.created ? fila.created.replace('T', ' ').substring(11, 19) : 'Registrado';
     console.log(`⚠️ RECHAZADO: Ticket CAE ${cae} ya utilizado el ${fila.fecha || fechaGuardada}`);
     return res.status(409).json({
       valido: false,
       estado: "YA_UTILIZADO",
       mensaje: "El ticket ya fue entregado previamente.",
       cae: cae,
       fecha_registro: fila.fecha || fechaGuardada
     });
   }

   const horaActual = obtenerHoraLocalArgentina();

   if (esConfirmacion) {
     // 2. Guardar en PocketBase (mandamos solo el CAE y la hora formateada)
     const payload = {
       cae: String(cae),
       fecha: horaActual
     };

     const responseInsert = await fetch(`${POCKETBASE_URL}/api/collections/tickets/records`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify(payload)
     });
     

     const responseText = await responseInsert.text();

     if (!responseInsert.ok) {
       console.error("❌ Error de PocketBase al guardar:", responseText);
       throw new Error('No se pudo guardar el registro en PocketBase');
     }

     const nuevoTicket = JSON.parse(responseText);
     console.log(`✅ ÉXITO: Ticket CAE ${cae} guardado en PocketBase a las ${horaActual}`);
     
     return res.status(200).json({
       valido: true,
       estado: "ENTREGADO",
       mensaje: "Pedido entregado y registrado con éxito.",
       cae: cae,
       hora: horaActual,             
       fecha_hora: horaActual,
       fecha_registro: horaActual 
     });
   } else {
     console.log(`🟢 VÁLIDO: Ticket CAE ${cae} disponible para entregar.`);
     return res.status(200).json({
       valido: true,
       estado: "DISPONIBLE",
       mensaje: "Ticket válido. Presione el botón para entregar.",
       cae: cae,
       hora: horaActual,
       fecha_hora: horaActual,
       fecha_registro: horaActual
     });
   }

 } catch (error) {
   console.error("Error de comunicación con PocketBase:", error.message);
   return res.status(500).json({ valido: false, error: "Error de base de datos" });
 }
});

// Ruta para historial
app.get('/historial', async (req, res) => {
 try {
   const response = await fetch(`${POCKETBASE_URL}/api/collections/tickets/records?sort=-created`);
   const data = await response.json();
   res.json({ total: data.totalItems || 0, tickets: data.items || [] });
 } catch (err) {
   console.error("Error al obtener historial:", err.message);
   res.status(500).json({ error: err.message });
 }
});

const server = app.listen(PORT, '0.0.0.0', () => {
 console.log(`==============================================`);
 console.log(` Servidor API activo en http://localhost:${PORT}`);
 console.log(` Conectado a PocketBase (${POCKETBASE_URL})`);
 console.log(`==============================================`);
});

server.on('error', (err) => {
 if (err.code === 'EADDRINUSE') {
   console.error(`❌ Error: El puerto ${PORT} ya está siendo utilizado por otro proceso.`);
 } else {
   console.error('❌ Error al iniciar el servidor:', err.message);
 }
});