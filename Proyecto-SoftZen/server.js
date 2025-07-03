import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { therapyTypes } from './predefinedTherapy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;
const JWT_SECRET = 'therapeutic-yoga-secret-key';

// Cache en memoria para optimización
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

// Middleware optimizado
app.use(cors({
  origin: ['http://localhost:3001', 'http://127.0.0.1:3001'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public', {
  maxAge: '1d',
  etag: true,
  lastModified: true
}));

// Middleware de cache
const cacheMiddleware = (duration = CACHE_DURATION) => {
  return (req, res, next) => {
    const key = `${req.method}-${req.originalUrl}-${req.user?.id || 'anonymous'}`;
    const cached = cache.get(key);

    if (cached && Date.now() - cached.timestamp < duration) {
      return res.json(cached.data);
    }

    const originalSend = res.json;
    res.json = function(data) {
      cache.set(key, { data, timestamp: Date.now() });
      originalSend.call(this, data);
    };
    next();
  };
};

// Función para limpiar cache específico
const clearCache = (pattern) => {
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      cache.delete(key);
    }
  }
};

// Database initialization con optimizaciones
let db;

async function initDatabase() {
  db = await open({
    filename: path.join(__dirname, 'therapy.db'),
    driver: sqlite3.Database
  });

  // Configuraciones de rendimiento para SQLite
  await db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA cache_size = 1000;
        PRAGMA temp_store = MEMORY;
        PRAGMA mmap_size = 268435456;
    `);

  // Crear tablas con índices optimizados
  await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT,
            role TEXT DEFAULT 'instructor',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME,
            is_active BOOLEAN DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS patients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            email TEXT NOT NULL,
            age INTEGER,
            condition TEXT,
            instructor_id INTEGER NOT NULL,
            assigned_series TEXT,
            current_session INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT 1,
            FOREIGN KEY (instructor_id) REFERENCES users (id)
        );

        CREATE TABLE IF NOT EXISTS therapy_series (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            therapy_type TEXT NOT NULL,
            postures TEXT NOT NULL,
            total_sessions INTEGER NOT NULL,
            instructor_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT 1,
            FOREIGN KEY (instructor_id) REFERENCES users (id)
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            series_id INTEGER NOT NULL,
            session_number INTEGER NOT NULL,
            pain_before INTEGER,
            pain_after INTEGER,
            comments TEXT,
            duration_minutes INTEGER,
            completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients (id),
            FOREIGN KEY (series_id) REFERENCES therapy_series (id)
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            is_read BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        );

        CREATE TABLE IF NOT EXISTS analytics_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            event_type TEXT NOT NULL,
            event_data TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        );

        -- Índices para mejor rendimiento
        CREATE INDEX IF NOT EXISTS idx_patients_instructor ON patients(instructor_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_patient ON sessions(patient_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(completed_at);
        CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
        CREATE INDEX IF NOT EXISTS idx_analytics_user_date ON analytics_events(user_id, created_at);
    `);

  console.log('🚀 Database initialized with performance optimizations');
}

// Función para registrar eventos de analytics
const logAnalyticsEvent = async (userId, eventType, eventData = {}) => {
  try {
    if (!db) return; // Skip if DB not initialized
    await db.run(
        'INSERT INTO analytics_events (user_id, event_type, event_data) VALUES (?, ?, ?)',
        [userId, eventType, JSON.stringify(eventData)]
    );
  } catch (error) {
    console.error('Analytics logging error:', error);
  }
};

// Authentication middleware mejorado
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, async (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;

    // Log analytics
    // Log analytics (skip if error)
    try {
      await logAnalyticsEvent(user.id, 'api_request', {
        endpoint: req.originalUrl,
        method: req.method
      });
    } catch (error) {
      // Continue without analytics
    }

    next();
  });
};

// Auth routes mejoradas
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;

    // Validaciones mejoradas
    if (!email || !password || !name) {
      return res.status(400).json({
        error: 'Todos los campos son obligatorios',
        details: { email: !email, password: !password, name: !name }
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'La contraseña debe tener al menos 6 caracteres'
      });
    }

    const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await db.run(
        'INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)',
        [email, hashedPassword, name, role || 'instructor']
    );

    const user = await db.get('SELECT id, email, name, role FROM users WHERE id = ?', [result.lastID]);

    // Log analytics
    await logAnalyticsEvent(user.id, 'user_registered', { role: user.role });

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ token, user, message: 'Usuario registrado exitosamente' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
    }

    const user = await db.get('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);

    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(400).json({ error: 'Credenciales inválidas' });
    }

    // Actualizar último login
    await db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

    // Log analytics
    try {
      await logAnalyticsEvent(user.id, 'user_login', { timestamp: new Date().toISOString() });
    } catch (error) {
      // Continue without analytics
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      message: 'Inicio de sesión exitoso'
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Patient routes optimizadas con cache
app.get('/api/patients', authenticateToken, cacheMiddleware(), async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const patients = await db.all(`
            SELECT p.*, 
                   COUNT(s.id) as total_sessions_completed,
                   AVG(s.pain_before - s.pain_after) as avg_pain_improvement
            FROM patients p
            LEFT JOIN sessions s ON p.id = s.patient_id
            WHERE p.instructor_id = ? AND p.is_active = 1
            GROUP BY p.id
            ORDER BY p.created_at DESC
        `, [req.user.id]);

    const patientsWithSeries = patients.map(patient => ({
      ...patient,
      assignedSeries: patient.assigned_series ? JSON.parse(patient.assigned_series) : null
    }));

    res.json(patientsWithSeries);
  } catch (error) {
    console.error('Get patients error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/patients', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const { name, email, age, condition } = req.body;

    // Validaciones
    if (!name || !email || !age) {
      return res.status(400).json({ error: 'Nombre, email y edad son obligatorios' });
    }

    if (age < 1 || age > 120) {
      return res.status(400).json({ error: 'Edad debe estar entre 1 y 120 años' });
    }

    const result = await db.run(
        'INSERT INTO patients (name, email, age, condition, instructor_id) VALUES (?, ?, ?, ?, ?)',
        [name, email, age, condition, req.user.id]
    );

    const patient = await db.get('SELECT * FROM patients WHERE id = ?', [result.lastID]);

    // Limpiar cache y log analytics
    clearCache('patients');
    await logAnalyticsEvent(req.user.id, 'patient_created', { patientId: patient.id });

    res.json({ ...patient, message: 'Paciente creado exitosamente' });
  } catch (error) {
    console.error('Create patient error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.put('/api/patients/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const patientId = parseInt(req.params.id);
    const { name, email, age, condition } = req.body;

    const result = await db.run(`
            UPDATE patients 
            SET name = ?, email = ?, age = ?, condition = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ? AND instructor_id = ?
        `, [name, email, age, condition, patientId, req.user.id]);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }

    const patient = await db.get('SELECT * FROM patients WHERE id = ?', [patientId]);

    clearCache('patients');
    await logAnalyticsEvent(req.user.id, 'patient_updated', { patientId });

    res.json({ ...patient, message: 'Paciente actualizado exitosamente' });
  } catch (error) {
    console.error('Update patient error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.delete('/api/patients/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const patientId = parseInt(req.params.id);

    // Soft delete
    const result = await db.run(
        'UPDATE patients SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND instructor_id = ?',
        [patientId, req.user.id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }

    clearCache('patients');
    await logAnalyticsEvent(req.user.id, 'patient_deleted', { patientId });

    res.json({ message: 'Paciente eliminado exitosamente' });
  } catch (error) {
    console.error('Delete patient error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Therapy types optimizado
app.get('/api/therapy-types', authenticateToken, cacheMiddleware(30 * 60 * 1000), (req, res) => {
  const types = Object.keys(therapyTypes).map(key => ({
    id: key,
    name: key.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
    postures: therapyTypes[key]
  }));
  res.json(types);
});

// Therapy series routes optimizadas
app.get('/api/therapy-series', authenticateToken, cacheMiddleware(), async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const series = await db.all(`
            SELECT ts.*, 
                   COUNT(DISTINCT p.id) as assigned_patients_count,
                   COUNT(DISTINCT s.id) as total_sessions_count
            FROM therapy_series ts
            LEFT JOIN patients p ON JSON_EXTRACT(p.assigned_series, '$.id') = ts.id
            LEFT JOIN sessions s ON s.series_id = ts.id
            WHERE ts.instructor_id = ? AND ts.is_active = 1
            GROUP BY ts.id
            ORDER BY ts.created_at DESC
        `, [req.user.id]);

    const seriesWithPostures = series.map(s => ({
      ...s,
      postures: JSON.parse(s.postures)
    }));

    res.json(seriesWithPostures);
  } catch (error) {
    console.error('Get therapy series error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.delete('/api/therapy-series/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const seriesId = parseInt(req.params.id);

    // Verificar que la serie pertenece al instructor
    const series = await db.get(
        'SELECT * FROM therapy_series WHERE id = ? AND instructor_id = ?',
        [seriesId, req.user.id]
    );

    if (!series) {
      return res.status(404).json({ error: 'Serie no encontrada' });
    }

    // Verificar que no hay pacientes asignados a esta serie
    const assignedPatients = await db.all(`
            SELECT id FROM patients 
            WHERE instructor_id = ? AND assigned_series IS NOT NULL 
            AND JSON_EXTRACT(assigned_series, '$.id') = ?
        `, [req.user.id, seriesId]);

    if (assignedPatients.length > 0) {
      return res.status(400).json({
        error: 'No se puede eliminar una serie que tiene pacientes asignados'
      });
    }

    // Soft delete
    await db.run(
        'UPDATE therapy_series SET is_active = 0 WHERE id = ? AND instructor_id = ?',
        [seriesId, req.user.id]
    );

    clearCache('therapy-series');
    await logAnalyticsEvent(req.user.id, 'series_deleted', { seriesId });

    res.json({ message: 'Serie eliminada exitosamente' });
  } catch (error) {
    console.error('Delete therapy series error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/therapy-series', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const { name, therapyType, postures, totalSessions } = req.body;

    if (!name || !therapyType || !postures || !totalSessions) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    if (postures.length === 0) {
      return res.status(400).json({ error: 'Debe seleccionar al menos una postura' });
    }

    const result = await db.run(
        'INSERT INTO therapy_series (name, therapy_type, postures, total_sessions, instructor_id) VALUES (?, ?, ?, ?, ?)',
        [name, therapyType, JSON.stringify(postures), totalSessions, req.user.id]
    );

    const series = await db.get('SELECT * FROM therapy_series WHERE id = ?', [result.lastID]);

    clearCache('therapy-series');
    await logAnalyticsEvent(req.user.id, 'series_created', {
      seriesId: series.id,
      therapyType,
      posturesCount: postures.length
    });

    res.json({
      ...series,
      postures: JSON.parse(series.postures),
      message: 'Serie creada exitosamente'
    });
  } catch (error) {
    console.error('Create therapy series error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Analytics y Dashboard endpoints
app.get('/api/dashboard/analytics', authenticateToken, cacheMiddleware(2 * 60 * 1000), async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const [stats, recentActivity, painTrends, sessionStats] = await Promise.all([
      // Estadísticas generales
      db.get(`
                SELECT 
                    COUNT(DISTINCT p.id) as total_patients,
                    COUNT(DISTINCT CASE WHEN p.assigned_series IS NOT NULL THEN p.id END) as active_patients,
                    COUNT(DISTINCT ts.id) as total_series,
                    COUNT(s.id) as total_sessions,
                    AVG(s.pain_before - s.pain_after) as avg_pain_improvement,
                    AVG(s.duration_minutes) as avg_session_duration
                FROM patients p
                LEFT JOIN therapy_series ts ON ts.instructor_id = ?
                LEFT JOIN sessions s ON s.patient_id = p.id
                WHERE p.instructor_id = ? AND p.is_active = 1
            `, [req.user.id, req.user.id]),

      // Actividad reciente
      db.all(`
                SELECT 'session' as type, p.name as patient_name, s.completed_at as date, 
                       s.pain_before, s.pain_after, s.session_number
                FROM sessions s
                JOIN patients p ON s.patient_id = p.id
                WHERE p.instructor_id = ?
                ORDER BY s.completed_at DESC
                LIMIT 10
            `, [req.user.id]),

      // Tendencias de dolor por mes
      db.all(`
                SELECT 
                    strftime('%Y-%m', s.completed_at) as month,
                    AVG(s.pain_before) as avg_pain_before,
                    AVG(s.pain_after) as avg_pain_after,
                    COUNT(s.id) as session_count
                FROM sessions s
                JOIN patients p ON s.patient_id = p.id
                WHERE p.instructor_id = ? AND s.completed_at >= date('now', '-6 months')
                GROUP BY strftime('%Y-%m', s.completed_at)
                ORDER BY month
            `, [req.user.id]),

      // Estadísticas de sesiones por tipo de terapia
      db.all(`
                SELECT 
                    ts.therapy_type,
                    COUNT(s.id) as session_count,
                    AVG(s.pain_before - s.pain_after) as avg_improvement,
                    AVG(s.duration_minutes) as avg_duration
                FROM sessions s
                JOIN therapy_series ts ON s.series_id = ts.id
                JOIN patients p ON s.patient_id = p.id
                WHERE p.instructor_id = ?
                GROUP BY ts.therapy_type
            `, [req.user.id])
    ]);

    res.json({
      stats: {
        ...stats,
        avg_pain_improvement: Math.round((stats.avg_pain_improvement || 0) * 100) / 100,
        avg_session_duration: Math.round(stats.avg_session_duration || 0)
      },
      recentActivity,
      painTrends,
      sessionStats,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Notifications system
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const notifications = await db.all(`
            SELECT * FROM notifications 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT 20
        `, [req.user.id]);

    res.json(notifications);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    await db.run(
        'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
        [req.params.id, req.user.id]
    );
    res.json({ message: 'Notificación marcada como leída' });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Export reports endpoint
app.get('/api/reports/export', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const { format = 'json', dateFrom, dateTo } = req.query;

    let dateFilter = '';
    let params = [req.user.id];

    if (dateFrom && dateTo) {
      dateFilter = 'AND s.completed_at BETWEEN ? AND ?';
      params.push(dateFrom, dateTo);
    }

    const reportData = await db.all(`
            SELECT 
                p.name as patient_name,
                p.email as patient_email,
                p.age as patient_age,
                p.condition as patient_condition,
                ts.name as series_name,
                ts.therapy_type,
                s.session_number,
                s.pain_before,
                s.pain_after,
                s.pain_before - s.pain_after as pain_improvement,
                s.duration_minutes,
                s.comments,
                s.completed_at
            FROM sessions s
            JOIN patients p ON s.patient_id = p.id
            JOIN therapy_series ts ON s.series_id = ts.id
            WHERE p.instructor_id = ? ${dateFilter}
            ORDER BY s.completed_at DESC
        `, params);

    await logAnalyticsEvent(req.user.id, 'report_exported', {
      format,
      recordCount: reportData.length,
      dateFilter: { dateFrom, dateTo }
    });

    if (format === 'csv') {
      const csv = [
        'Paciente,Email,Edad,Condición,Serie,Tipo Terapia,Sesión,Dolor Antes,Dolor Después,Mejora,Duración (min),Comentarios,Fecha',
        ...reportData.map(row => [
          row.patient_name,
          row.patient_email,
          row.patient_age,
          row.patient_condition,
          row.series_name,
          row.therapy_type,
          row.session_number,
          row.pain_before,
          row.pain_after,
          row.pain_improvement,
          row.duration_minutes,
          `"${row.comments}"`,
          row.completed_at
        ].join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="reporte-yoga-${new Date().toISOString().split('T')[0]}.csv"`);
      return res.send(csv);
    }

    res.json({
      report_data: reportData,
      generated_at: new Date().toISOString(),
      instructor: req.user.name,
      summary: {
        total_sessions: reportData.length,
        avg_pain_improvement: reportData.reduce((sum, row) => sum + row.pain_improvement, 0) / reportData.length || 0,
        date_range: { dateFrom, dateTo }
      }
    });
  } catch (error) {
    console.error('Export reports error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Assign series optimizado
app.post('/api/patients/:id/assign-series', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const patientId = parseInt(req.params.id);
    const { seriesId } = req.body;

    const [patient, series] = await Promise.all([
      db.get('SELECT * FROM patients WHERE id = ? AND instructor_id = ?', [patientId, req.user.id]),
      db.get('SELECT * FROM therapy_series WHERE id = ? AND instructor_id = ?', [seriesId, req.user.id])
    ]);

    if (!patient || !series) {
      return res.status(404).json({ error: 'Paciente o serie no encontrados' });
    }

    const seriesData = {
      ...series,
      postures: JSON.parse(series.postures)
    };

    await db.run(
        'UPDATE patients SET assigned_series = ?, current_session = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [JSON.stringify(seriesData), patientId]
    );

    // Crear notificación para el paciente si está registrado
    const patientUser = await db.get('SELECT id FROM users WHERE email = ?', [patient.email]);
    if (patientUser) {
      await db.run(`
                INSERT INTO notifications (user_id, type, title, message) 
                VALUES (?, 'series_assigned', 'Nueva Serie Asignada', ?)
            `, [patientUser.id, `Tu instructor te ha asignado la serie "${series.name}". ¡Puedes comenzar cuando estés listo!`]);
    }

    const updatedPatient = await db.get('SELECT * FROM patients WHERE id = ?', [patientId]);

    clearCache('patients');
    await logAnalyticsEvent(req.user.id, 'series_assigned', {
      patientId,
      seriesId,
      seriesName: series.name
    });

    res.json({
      ...updatedPatient,
      assignedSeries: JSON.parse(updatedPatient.assigned_series),
      message: 'Serie asignada exitosamente'
    });
  } catch (error) {
    console.error('Assign series error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Patient session routes mejoradas
app.get('/api/my-series', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'patient') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const patient = await db.get('SELECT * FROM patients WHERE email = ? AND is_active = 1', [req.user.email]);

    if (!patient || !patient.assigned_series) {
      return res.status(404).json({ error: 'No se encontró serie asignada' });
    }

    res.json({
      series: JSON.parse(patient.assigned_series),
      currentSession: patient.current_session || 0,
      patient_info: {
        name: patient.name,
        condition: patient.condition
      }
    });
  } catch (error) {
    console.error('Get my series error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/sessions', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'patient') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const { painBefore, painAfter, comments, durationMinutes = 30 } = req.body;

    if (!comments || comments.trim().length < 10) {
      return res.status(400).json({ error: 'Los comentarios deben tener al menos 10 caracteres' });
    }

    const patient = await db.get('SELECT * FROM patients WHERE email = ? AND is_active = 1', [req.user.email]);

    if (!patient) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }

    const assignedSeries = JSON.parse(patient.assigned_series);
    const sessionNumber = (patient.current_session || 0) + 1;

    // Insertar sesión
    const result = await db.run(`
            INSERT INTO sessions (patient_id, series_id, session_number, pain_before, pain_after, comments, duration_minutes) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [patient.id, assignedSeries.id, sessionNumber, painBefore, painAfter, comments, durationMinutes]);

    // Actualizar sesión actual del paciente
    await db.run(
        'UPDATE patients SET current_session = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [sessionNumber, patient.id]
    );

    // Crear notificación para el instructor
    await db.run(`
            INSERT INTO notifications (user_id, type, title, message) 
            VALUES (?, 'session_completed', 'Sesión Completada', ?)
        `, [patient.instructor_id, `${patient.name} completó la sesión ${sessionNumber} con una mejora de dolor de ${painBefore - painAfter} puntos.`]);

    const session = await db.get('SELECT * FROM sessions WHERE id = ?', [result.lastID]);

    clearCache('patients');
    await logAnalyticsEvent(req.user.id, 'session_completed', {
      sessionId: session.id,
      painImprovement: painBefore - painAfter,
      sessionNumber
    });

    res.json({ ...session, message: 'Sesión completada exitosamente' });
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Get patient sessions mejorado
app.get('/api/patients/:id/sessions', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const patientId = parseInt(req.params.id);

    const patient = await db.get(
        'SELECT * FROM patients WHERE id = ? AND instructor_id = ?',
        [patientId, req.user.id]
    );

    if (!patient) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }

    const sessions = await db.all(`
            SELECT s.*, ts.name as series_name, ts.therapy_type
            FROM sessions s
            LEFT JOIN therapy_series ts ON s.series_id = ts.id
            WHERE s.patient_id = ? 
            ORDER BY s.completed_at DESC
        `, [patientId]);

    res.json(sessions);
  } catch (error) {
    console.error('Get patient sessions error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    cache_size: cache.size,
    uptime: process.uptime()
  });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Limpiar cache periódicamente
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      cache.delete(key);
    }
  }
}, 5 * 60 * 1000); // Cada 5 minutos

// Initialize database and start server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Performance optimizations enabled`);
    console.log(`💾 Cache system active`);
    console.log(`📈 Analytics tracking enabled`);
  });
}).catch(error => {
  console.error('Failed to initialize database:', error);
  process.exit(1);
});