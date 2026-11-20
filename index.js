const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const POCKETBASE_URL = 'http://127.0.0.1:8090';
const EVENTOS_FILE = path.join(__dirname, 'eventos_tickets.json');

// PIN inicial de encargado (se puede ampliar con usuarios en el siguiente bloque)
const PIN_ENCARGADO_DEFAULT = '1234';

process.on('uncaughtException', (err) => {
  console.error('💥 Error No Controlado:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Promesa rechazada no controlada:', reason);
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function leerEventosLocales() {
  try {
    if (!fs.existsSync(EVENTOS_FILE)) {
      fs.writeFileSync(EVENTOS_FILE, JSON.stringify([], null, 2), 'utf-8');
      return [];
    }
    const raw = fs.readFileSync(EVENTOS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('Error leyendo eventos_tickets.json:', e.message);
    return [];
  }
}

function guardarEventoLocal(evento) {
  const eventos = leerEventosLocales();
  eventos.unshift(evento);
  fs.writeFileSync(EVENTOS_FILE, JSON.stringify(eventos, null, 2), 'utf-8');
  return evento;
}

function obtenerHoraLocalArgentina() {
  const ahora = new Date();
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(ahora);
}

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

// US-17, US-18, US-21, US-27, US-32: Anular ticket por CAE con PIN y motivo
app.post('/anular', async (req, res) => {
  const { cae, motivo, pin, encargado } = req.body || {};

  const caeLimpio = String(cae || '').trim();
  const motivoLimpio = String(motivo || '').trim();
  const pinLimpio = String(pin || '').trim();
  const usuarioEncargado = String(encargado || 'Encargado').trim() || 'Encargado';

  if (!pinLimpio || pinLimpio !== PIN_ENCARGADO_DEFAULT) {
    return res.status(401).json({
      ok: false,
      error: 'PIN de encargado inválido. Verificá tu clave para anular.'
    });
  }

  if (!caeLimpio || caeLimpio.length < 4) {
    return res.status(400).json({
      ok: false,
      error: 'Ingresá un número de CAE válido para anular.'
    });
  }

  if (!motivoLimpio) {
    return res.status(400).json({
      ok: false,
      error: 'Indicá o escribí un motivo breve para justificar la anulación.'
    });
  }

  const eventos = leerEventosLocales();
  const yaAnulado = eventos.find(e => String(e.cae) === caeLimpio && e.estado === 'ANULADO');
  if (yaAnulado) {
    return res.status(409).json({
      ok: false,
      error: `El ticket CAE ${caeLimpio} ya figura como ANULADO (${yaAnulado.fecha || ''}).`
    });
  }

  const horaActual = obtenerHoraLocalArgentina();
  const ahoraISO = new Date().toISOString();

  const registroAnulacion = guardarEventoLocal({
    id: `ANU-${Date.now().toString().slice(-6)}`,
    cae: caeLimpio,
    fecha: horaActual,
    created: ahoraISO,
    estado: 'ANULADO',
    motivo: motivoLimpio,
    encargado: usuarioEncargado,
    detalle: `Anulado por ${usuarioEncargado} • Motivo: ${motivoLimpio}`
  });

  console.log(`🚫 ANULADO: CAE ${caeLimpio} a las ${horaActual} por ${usuarioEncargado} (${motivoLimpio})`);

  return res.status(200).json({
    ok: true,
    mensaje: `Ticket CAE ${caeLimpio} marcado como ANULADO.`,
    anulacion: registroAnulacion
  });
});

// Ruta de validación para la ESP32 / QR
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
    const horaActual = obtenerHoraLocalArgentina();
    const ahoraISO = new Date().toISOString();

    // 0. Verificar si el CAE fue marcado como ANULADO
    const eventos = leerEventosLocales();
    const anulado = eventos.find(e => String(e.cae) === String(cae) && e.estado === 'ANULADO');
    if (anulado) {
      console.log(`🚫 BLOQUEADO: Ticket CAE ${cae} está ANULADO.`);
      return res.status(403).json({
        valido: false,
        estado: "ANULADO",
        mensaje: "Ticket anulado. No válido para entrega.",
        cae: cae,
        fecha_registro: anulado.fecha || horaActual
      });
    }

    // 1. Consultar en PocketBase si el ticket ya fue entregado previamente
    const responseCheck = await fetch(`${POCKETBASE_URL}/api/collections/tickets/records?filter=(cae='${cae}')`);
    const dataCheck = await responseCheck.json();

    if (dataCheck.items && dataCheck.items.length > 0) {
      const fila = dataCheck.items[0];
      const fechaGuardada = fila.fecha || (fila.created ? fila.created.replace('T', ' ').substring(11, 19) : horaActual);

      guardarEventoLocal({
        id: `REP-${Date.now().toString().slice(-6)}`,
        cae: String(cae),
        fecha: horaActual,
        created: ahoraISO,
        estado: 'INTENTO_REPETIDO',
        detalle: 'Intento de revalidación bloqueado (ticket ya entregado)'
      });

      console.log(`⚠️ RECHAZADO (US-15): Ticket CAE ${cae} ya utilizado el ${fechaGuardada}`);
      return res.status(409).json({
        valido: false,
        estado: "YA_UTILIZADO",
        mensaje: "El ticket ya fue entregado previamente.",
        cae: cae,
        fecha_registro: fechaGuardada
      });
    }

    if (esConfirmacion) {
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

// Ruta para historial unificado
app.get('/historial', async (req, res) => {
  try {
    const response = await fetch(`${POCKETBASE_URL}/api/collections/tickets/records?sort=-created&perPage=500`);
    const data = await response.json();
    const itemsPB = Array.isArray(data.items) ? data.items : [];
    const eventosLocales = leerEventosLocales();

    const mapAnulados = new Map();
    eventosLocales.forEach(ev => {
      if (ev.estado === 'ANULADO') {
        mapAnulados.set(String(ev.cae), ev);
      }
    });

    const entregados = itemsPB.map(t => {
      const anulacion = mapAnulados.get(String(t.cae));
      if (anulacion) {
        return {
          ...t,
          estado: 'ANULADO',
          motivo: anulacion.motivo || '',
          encargado: anulacion.encargado || 'Encargado',
          detalle: `Anulado por ${anulacion.encargado || 'Encargado'}${anulacion.motivo ? ` • ${anulacion.motivo}` : ''}`
        };
      }
      return {
        ...t,
        estado: 'ENTREGADO',
        detalle: 'Ticket Registrado'
      };
    });

    const caesEnPB = new Set(itemsPB.map(t => String(t.cae)));
    const extras = eventosLocales.filter(ev => {
      if (ev.estado === 'INTENTO_REPETIDO') return true;
      if (ev.estado === 'ANULADO' && !caesEnPB.has(String(ev.cae))) return true;
      return false;
    });

    const todos = [...entregados, ...extras].sort((a, b) => {
      const da = new Date(a.created || 0).getTime();
      const db = new Date(b.created || 0).getTime();
      return db - da;
    });

    const totalEntregados = todos.filter(t => t.estado === 'ENTREGADO').length;
    const totalRepetidos = todos.filter(t => t.estado === 'INTENTO_REPETIDO').length;
    const totalAnulados = todos.filter(t => t.estado === 'ANULADO').length;

    res.json({
      total: todos.length,
      resumen: {
        entregados: totalEntregados,
        intentos_repetidos: totalRepetidos,
        anulados: totalAnulados
      },
      tickets: todos
    });
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