const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const POCKETBASE_URL = 'http://127.0.0.1:8090';
const EVENTOS_FILE = path.join(__dirname, 'eventos_tickets.json');
const USUARIOS_FILE = path.join(__dirname, 'usuarios_tickets.json');
const BACKUPS_DIR = path.join(__dirname, 'backups');

const ROLES_VALIDOS = ['ADMIN', 'GERENTE', 'CT_ASISTENTE'];

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

function leerUsuariosLocales() {
  const iniciales = [
    { id: 'USR-ADMIN', nombre: 'Administrador', usuario: 'admin', rol: 'ADMIN', pin: '9999', activo: true },
    { id: 'USR-GERENTE', nombre: 'Gerente de Local', usuario: 'gerente', rol: 'GERENTE', pin: '1234', activo: true },
    { id: 'USR-CT1', nombre: 'Asistente Turno', usuario: 'asistente', rol: 'CT_ASISTENTE', pin: '1111', activo: true }
  ];

  try {
    if (!fs.existsSync(USUARIOS_FILE)) {
      fs.writeFileSync(USUARIOS_FILE, JSON.stringify(iniciales, null, 2), 'utf-8');
      return iniciales;
    }
    const raw = fs.readFileSync(USUARIOS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) && data.length > 0 ? data : iniciales;
  } catch (e) {
    console.error('Error leyendo usuarios_tickets.json:', e.message);
    return iniciales;
  }
}

function guardarUsuariosLocales(lista) {
  fs.writeFileSync(USUARIOS_FILE, JSON.stringify(lista, null, 2), 'utf-8');
}

function sanitizarUsuario(u) {
  return {
    id: u.id,
    nombre: u.nombre,
    usuario: u.usuario,
    rol: u.rol,
    activo: u.activo !== false
  };
}

// US-19: Copia de seguridad local automática de todos los datos
async function generarBackupLocal(motivo = 'automatico') {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }

    let ticketsPB = [];
    try {
      const resp = await fetch(`${POCKETBASE_URL}/api/collections/tickets/records?sort=-created&perPage=500`);
      if (resp.ok) {
        const data = await resp.json();
        ticketsPB = Array.isArray(data.items) ? data.items : [];
      }
    } catch (_) {
      // Si PocketBase aún está iniciando, respaldamos igual los archivos locales
    }

    const eventos = leerEventosLocales();
    const usuarios = leerUsuariosLocales();

    const ahora = new Date();
    const marcaTiempo = ahora.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const nombreArchivo = `backup_${marcaTiempo}.json`;
    const rutaDestino = path.join(BACKUPS_DIR, nombreArchivo);

    const snapshot = {
      generado_en: ahora.toISOString(),
      motivo,
      totales: {
        tickets_pocketbase: ticketsPB.length,
        eventos_locales: eventos.length,
        usuarios: usuarios.length
      },
      tickets_pocketbase: ticketsPB,
      eventos_locales: eventos,
      usuarios
    };

    fs.writeFileSync(rutaDestino, JSON.stringify(snapshot, null, 2), 'utf-8');

    // Conservar solo los últimos 20 backups para mantener ordenado el disco
    const archivos = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
      .sort()
      .reverse();

    if (archivos.length > 20) {
      archivos.slice(20).forEach(viejo => {
        try { fs.unlinkSync(path.join(BACKUPS_DIR, viejo)); } catch (_) {}
      });
    }

    console.log(`💾 Backup local guardado (${motivo}): ${nombreArchivo}`);
    return {
      ok: true,
      archivo: nombreArchivo,
      generado_en: snapshot.generado_en,
      totales: snapshot.totales
    };
  } catch (err) {
    console.error('Error generando backup local:', err.message);
    return { ok: false, error: err.message };
  }
}

function listarBackupsLocales() {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) return [];
    return fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
      .sort()
      .reverse()
      .map(archivo => {
        const stats = fs.statSync(path.join(BACKUPS_DIR, archivo));
        return {
          archivo,
          fecha: stats.mtime.toISOString(),
          tamano_kb: Math.max(1, Math.round(stats.size / 1024))
        };
      });
  } catch (_) {
    return [];
  }
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

// US-19: Endpoints para consultar y generar backups locales
app.get('/backups', (req, res) => {
  res.json({
    ok: true,
    carpeta: BACKUPS_DIR,
    backups: listarBackupsLocales()
  });
});

app.post('/backups/ahora', async (req, res) => {
  const resultado = await generarBackupLocal('manual');
  if (!resultado.ok) {
    return res.status(500).json(resultado);
  }
  return res.json({
    ...resultado,
    backups: listarBackupsLocales()
  });
});

// US-34: Iniciar sesión con usuario y PIN
app.post('/auth/login', (req, res) => {
  const { usuario, pin } = req.body || {};
  const userInput = String(usuario || '').trim().toLowerCase();
  const pinInput = String(pin || '').trim();

  if (!userInput || !pinInput) {
    return res.status(400).json({ ok: false, error: 'Ingresá tu usuario y PIN.' });
  }

  const usuarios = leerUsuariosLocales();
  const encontrado = usuarios.find(u => String(u.usuario).toLowerCase() === userInput);

  if (!encontrado || String(encontrado.pin) !== pinInput) {
    return res.status(401).json({ ok: false, error: 'Usuario o PIN incorrecto.' });
  }

  if (encontrado.activo === false) {
    return res.status(403).json({ ok: false, error: 'Este usuario fue dado de baja y no puede ingresar.' });
  }

  return res.status(200).json({
    ok: true,
    usuario: sanitizarUsuario(encontrado)
  });
});

app.get('/usuarios', (req, res) => {
  const rolSolicitante = String(req.query.rol || '').toUpperCase();
  if (rolSolicitante !== 'ADMIN' && rolSolicitante !== 'GERENTE') {
    return res.status(403).json({ ok: false, error: 'No tenés permiso para ver el listado de usuarios.' });
  }
  const usuarios = leerUsuariosLocales().map(sanitizarUsuario);
  return res.status(200).json({ ok: true, usuarios });
});

app.post('/usuarios', (req, res) => {
  const { solicitanteId, nombre, usuario, rol, pin } = req.body || {};
  const usuarios = leerUsuariosLocales();
  const actor = usuarios.find(u => u.id === solicitanteId && u.activo !== false);

  if (!actor) {
    return res.status(401).json({ ok: false, error: 'Sesión no válida o usuario inactivo.' });
  }

  const rolNuevo = String(rol || '').toUpperCase();
  const nombreLimpio = String(nombre || '').trim();
  const userLimpio = String(usuario || '').trim().toLowerCase();
  const pinLimpio = String(pin || '').trim();

  if (!nombreLimpio || !userLimpio || !pinLimpio) {
    return res.status(400).json({ ok: false, error: 'Completá nombre, usuario y PIN.' });
  }

  if (!ROLES_VALIDOS.includes(rolNuevo)) {
    return res.status(400).json({ ok: false, error: 'Rol inválido.' });
  }

  if (actor.rol === 'ADMIN') {
    if (rolNuevo !== 'GERENTE' && rolNuevo !== 'CT_ASISTENTE') {
      return res.status(403).json({ ok: false, error: 'El Admin solo puede crear usuarios de Gerente o CT/Asistente.' });
    }
  } else if (actor.rol === 'GERENTE') {
    if (rolNuevo !== 'CT_ASISTENTE') {
      return res.status(403).json({ ok: false, error: 'El Gerente de local solo puede crear usuarios de CT o Asistente.' });
    }
  } else {
    return res.status(403).json({ ok: false, error: 'Tu rol (CT / Asistente) no tiene permiso para crear usuarios.' });
  }

  if (usuarios.some(u => String(u.usuario).toLowerCase() === userLimpio)) {
    return res.status(409).json({ ok: false, error: `El nombre de usuario "${userLimpio}" ya existe.` });
  }

  const nuevo = {
    id: `USR-${Date.now().toString().slice(-6)}`,
    nombre: nombreLimpio,
    usuario: userLimpio,
    rol: rolNuevo,
    pin: pinLimpio,
    activo: true
  };

  usuarios.push(nuevo);
  guardarUsuariosLocales(usuarios);
  generarBackupLocal('alta_usuario');

  return res.status(201).json({
    ok: true,
    mensaje: `Usuario ${nuevo.usuario} (${nuevo.rol}) creado correctamente.`,
    usuario: sanitizarUsuario(nuevo)
  });
});

app.patch('/usuarios/:id/estado', (req, res) => {
  const { id } = req.params;
  const { solicitanteId, activo } = req.body || {};

  const usuarios = leerUsuariosLocales();
  const actor = usuarios.find(u => u.id === solicitanteId && u.activo !== false);

  if (!actor || (actor.rol !== 'ADMIN' && actor.rol !== 'GERENTE')) {
    return res.status(403).json({ ok: false, error: 'Solo Admin o Gerente de local pueden dar de baja o reactivar usuarios.' });
  }

  const objetivo = usuarios.find(u => u.id === id);
  if (!objetivo) {
    return res.status(404).json({ ok: false, error: 'Usuario no encontrado.' });
  }

  if (objetivo.id === actor.id) {
    return res.status(400).json({ ok: false, error: 'No podés darte de baja a vos mismo.' });
  }

  if (actor.rol === 'GERENTE' && objetivo.rol !== 'CT_ASISTENTE') {
    return res.status(403).json({ ok: false, error: 'El Gerente de local solo puede gestionar usuarios de CT / Asistente.' });
  }

  objetivo.activo = Boolean(activo);
  guardarUsuariosLocales(usuarios);
  generarBackupLocal('cambio_estado_usuario');

  return res.status(200).json({
    ok: true,
    mensaje: objetivo.activo
      ? `Usuario ${objetivo.usuario} reactivado.`
      : `Usuario ${objetivo.usuario} dado de baja (su historial se conserva).`,
    usuario: sanitizarUsuario(objetivo)
  });
});

app.put('/usuarios/pin', (req, res) => {
  const { usuarioId, pinActual, pinNuevo } = req.body || {};
  const pinActualLimpio = String(pinActual || '').trim();
  const pinNuevoLimpio = String(pinNuevo || '').trim();

  if (!pinActualLimpio || !pinNuevoLimpio) {
    return res.status(400).json({ ok: false, error: 'Completá tu PIN actual y el nuevo PIN.' });
  }

  if (pinNuevoLimpio.length < 4) {
    return res.status(400).json({ ok: false, error: 'El nuevo PIN debe tener al menos 4 caracteres.' });
  }

  const usuarios = leerUsuariosLocales();
  const userObj = usuarios.find(u => u.id === usuarioId && u.activo !== false);

  if (!userObj) {
    return res.status(404).json({ ok: false, error: 'Usuario no encontrado o inactivo.' });
  }

  if (String(userObj.pin) !== pinActualLimpio) {
    return res.status(401).json({ ok: false, error: 'El PIN actual no coincide.' });
  }

  userObj.pin = pinNuevoLimpio;
  guardarUsuariosLocales(usuarios);
  generarBackupLocal('cambio_pin');

  return res.status(200).json({
    ok: true,
    mensaje: 'PIN actualizado correctamente.'
  });
});

app.post('/anular', async (req, res) => {
  const { cae, motivo, pin, encargado } = req.body || {};

  const caeLimpio = String(cae || '').trim();
  const motivoLimpio = String(motivo || '').trim();
  const pinLimpio = String(pin || '').trim();

  const usuarios = leerUsuariosLocales();
  const autorizador = usuarios.find(u => u.activo !== false && String(u.pin) === pinLimpio);

  if (!pinLimpio || !autorizador) {
    return res.status(401).json({
      ok: false,
      error: 'PIN inválido o usuario inactivo. No se autorizó la anulación.'
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
  const nombreEncargado = String(encargado || '').trim() || `${autorizador.nombre} (${autorizador.usuario})`;

  const registroAnulacion = guardarEventoLocal({
    id: `ANU-${Date.now().toString().slice(-6)}`,
    cae: caeLimpio,
    fecha: horaActual,
    created: ahoraISO,
    estado: 'ANULADO',
    motivo: motivoLimpio,
    encargado: nombreEncargado,
    detalle: `Anulado por ${nombreEncargado} • Motivo: ${motivoLimpio}`
  });

  generarBackupLocal('anulacion_ticket');

  console.log(`🚫 ANULADO: CAE ${caeLimpio} a las ${horaActual} por ${nombreEncargado} (${motivoLimpio})`);

  return res.status(200).json({
    ok: true,
    mensaje: `Ticket CAE ${caeLimpio} marcado como ANULADO por ${nombreEncargado}.`,
    anulacion: registroAnulacion
  });
});

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
      generarBackupLocal('ticket_entregado');
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
  setTimeout(() => generarBackupLocal('inicio_servidor'), 2000);
  setInterval(() => generarBackupLocal('programado_30min'), 30 * 60 * 1000);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Error: El puerto ${PORT} ya está siendo utilizado por otro proceso.`);
  } else {
    console.error('❌ Error al iniciar el servidor:', err.message);
  }
});