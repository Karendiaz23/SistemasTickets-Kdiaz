const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

// Capturar errores no controlados para que el servidor NO muera en silencio
process.on('uncaughtException', (err) => {
 console.error('💥 Error No Controlado:', err);
});

process.on('unhandledRejection', (reason, promise) => {
 console.error('💥 Promesa rechazada no controlada:', reason);
});

// Middlewares
app.use(cors());
app.use(express.json());

// Servir archivos estáticos del frontend desde la carpeta "public"
app.use(express.static(path.join(__dirname, 'public')));

// Conectar/crear la base de datos SQLite
const db = new sqlite3.Database('./tickets.db', (err) => {
 if (err) {
   console.error('❌ Error crítico al conectar con SQLite:', err.message);
 } else {
   console.log('✅ Base de Datos SQLite conectada correctamente.');
   crearTablas();
 }
});

// Función para inicializar tablas
function crearTablas() {
 db.run(`
   CREATE TABLE IF NOT EXISTS tickets (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     cae TEXT UNIQUE NOT NULL,
     fecha DATETIME
   )
 `, (err) => {
   if (err) console.error('❌ Error al crear la tabla:', err.message);
   else console.log('✅ Tabla "tickets" verificada/creada.');
 });
}

// Función corregida para obtener la hora local exacta de Argentina (UTC-3)
function obtenerHoraLocalArgentina() {
  const ahora = new Date();
  
  const opciones = {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };

  const formateador = new Intl.DateTimeFormat('es-AR', opciones);
  const partes = formateador.formatToParts(ahora);
  
  let anio, mes, dia, horas, minutos, segundos;
  for (const parte of partes) {
    if (parte.type === 'year') anio = parte.value;
    if (parte.type === 'month') mes = parte.value;
    if (parte.type === 'day') dia = parte.value;
    if (parte.type === 'hour') horas = parte.value;
    if (parte.type === 'minute') minutos = parte.value;
    if (parte.type === 'second') segundos = parte.value;
  }

  const hora = `horas:{minutos}:${segundos}`;
  const fechaHora = `dia/{mes}/${anio} ${hora}`;
  const fechaIsoSql = `anio-{mes}-${dia} ${hora}`; // Formato exacto para SQLite

  return { hora, fechaHora, fechaIsoSql };
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

// Ruta de validación para la ESP32 / QR
app.get('/validar', (req, res) => {
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

 db.get('SELECT * FROM tickets WHERE cae = ?', [cae], (err, fila) => {
   if (err) {
     console.error("Error BD:", err.message);
     return res.status(500).json({ valido: false, error: "Error de base de datos" });
   }

   if (fila) {
     console.log(`⚠️ RECHAZADO: Ticket CAE ${cae} ya utilizado el ${fila.fecha}`);
     return res.status(409).json({
       valido: false,
       estado: "YA_UTILIZADO",
       mensaje: "El ticket ya fue entregado previamente.",
       cae: cae,
       fecha_registro: fila.fecha
     });
   }

   // Obtener la hora exacta local en Argentina de manera segura
   const { hora, fechaHora, fechaIsoSql } = obtenerHoraLocalArgentina();

   if (esConfirmacion) {
     db.run('INSERT INTO tickets (cae, fecha) VALUES (?, ?)', [cae, fechaIsoSql], function(err) {
       if (err) {
         console.error("Error al guardar:", err.message);
         return res.status(500).json({ valido: false, error: "No se pudo guardar la entrega" });
       }
       console.log(`✅ ÉXITO: Ticket CAE ${cae} guardado en BD con ID ${this.lastID} a las ${hora}`);
       return res.status(200).json({
         valido: true,
         estado: "ENTREGADO",
         mensaje: "Pedido entregado y registrado con éxito.",
         cae: cae,
         hora: hora,             
         fecha_hora: fechaHora   
       });
     });
   } else {
     console.log(`🟢 VÁLIDO: Ticket CAE ${cae} disponible para entregar.`);
     return res.status(200).json({
       valido: true,
       estado: "DISPONIBLE",
       mensaje: "Ticket válido. Presione el botón para entregar.",
       cae: cae,
       hora: hora,
       fecha_hora: fechaHora
     });
   }
 });
});

// Ruta para historial (usada por el panel frontend)
app.get('/historial', (req, res) => {
 db.all('SELECT * FROM tickets ORDER BY fecha DESC', [], (err, filas) => {
   if (err) return res.status(500).json({ error: err.message });
   res.json({ total: filas.length, tickets: filas });
 });
});

// Iniciar servidor con manejo de errores de puerto
const server = app.listen(PORT, '0.0.0.0', () => {
 console.log(`==============================================`);
 console.log(` Servidor API activo en http://localhost:${PORT}`);
 console.log(`==============================================`);
});

server.on('error', (err) => {
 if (err.code === 'EADDRINUSE') {
   console.error(`❌ Error: El puerto ${PORT} ya está siendo utilizado por otro proceso.`);
 } else {
   console.error('❌ Error al iniciar el servidor:', err.message);
 }
});


