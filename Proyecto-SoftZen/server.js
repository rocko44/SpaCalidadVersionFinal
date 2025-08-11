import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { Pool } from 'pg';
import { therapyTypes } from './predefinedTherapy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'therapeutic-yoga-secret-key';

// Configuración de PostgreSQL para Railway
const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  // ✅ NUEVO: Configuración robusta de conexión
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  query_timeout: 30000,
  keepAlive: true
});

// Cache en memoria para optimización
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

// ✅ NUEVO: Sistema de manejo de errores de red y reintentos
class NetworkError extends Error {
  constructor(message, isRetryable = true, statusCode = 500) {
    super(message);
    this.name = 'NetworkError';
    this.isRetryable = isRetryable;
    this.statusCode = statusCode;
  }
}

// ✅ NUEVO: Configuración de reintentos
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1 segundo
  maxDelay: 5000,  // 5 segundos
  backoffMultiplier: 2
};

// ✅ NUEVO: Función de reintento con backoff exponencial
const retryWithBackoff = async (fn, retries = RETRY_CONFIG.maxRetries) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // Determinar si el error es reintentable
      const isRetryable = 
        error.code === 'ECONNRESET' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT' ||
        error.message?.includes('timeout') ||
        error.message?.includes('connection') ||
        (error.statusCode >= 500 && error.statusCode < 600);

      if (!isRetryable || attempt === retries) {
        throw new NetworkError(
          `${error.message} (Intento ${attempt + 1}/${retries + 1})`,
          isRetryable,
          error.statusCode || 500
        );
      }

      // Calcular delay con backoff exponencial
      const delay = Math.min(
        RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
        RETRY_CONFIG.maxDelay
      );

      console.warn(`Reintentando en ${delay}ms (Intento ${attempt + 1}/${retries + 1}):`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// ✅ NUEVO: Pool de conexiones con manejo de errores mejorado
pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

pool.on('connect', () => {
  console.log('Nueva conexión PostgreSQL establecida');
});

// =============================================
// SISTEMA DE VALIDACIONES ROBUSTO
// =============================================

class ValidationError extends Error {
  constructor(message, field = null, code = null) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.code = code;
    this.statusCode = 400;
  }
}

// Expresiones regulares para validaciones
const REGEX_PATTERNS = {
  email: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  name: /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]{2,50}$/,
  alphanumeric: /^[a-zA-Z0-9\sáéíóúÁÉÍÓÚñÑ.,;:()\-]{2,200}$/,
  seriesName: /^[a-zA-Z0-9\sáéíóúÁÉÍÓÚñÑ.,;:()\-]{3,100}$/,
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])[A-Za-z\d!@#$%^&*(),.?":{}|<>]{8,}$/,
  phoneNumber: /^[\+]?[1-9][\d]{0,15}$/,
  postalCode: /^[0-9]{5}(-[0-9]{4})?$/
};

// Lista de condiciones médicas válidas
const VALID_MEDICAL_CONDITIONS = [
  'artritis', 'artrosis', 'fibromialgia', 'dolor_cronico', 'lesion_deportiva',
  'hernia_discal', 'escoliosis', 'contractura_muscular', 'tendinitis', 'bursitis',
  'sindrome_tunel_carpiano', 'cervicalgia', 'lumbalgia', 'ciatalgia', 'esguince',
  'fractura_recuperacion', 'postoperatorio', 'ansiedad', 'estres', 'depresion',
  'insomnio', 'hipertension', 'diabetes', 'obesidad', 'embarazo', 'menopausia',
  'sindrome_fatiga_cronica', 'multiple_esclerosis', 'parkinson', 'otro'
];

// Tipos de terapia válidos
const VALID_THERAPY_TYPES = Object.keys(therapyTypes);

// Validadores específicos
const validators = {
  // Validación de email
  validateEmail(email, fieldName = 'email') {
    if (!email || typeof email !== 'string') {
      throw new ValidationError(`${fieldName} es obligatorio`, fieldName, 'REQUIRED');
    }
    
    const cleanEmail = email.trim().toLowerCase();
    
    if (cleanEmail.length < 5 || cleanEmail.length > 254) {
      throw new ValidationError(`${fieldName} debe tener entre 5 y 254 caracteres`, fieldName, 'LENGTH');
    }
    
    if (!REGEX_PATTERNS.email.test(cleanEmail)) {
      throw new ValidationError(`${fieldName} debe tener un formato válido (ejemplo: usuario@dominio.com)`, fieldName, 'FORMAT');
    }
    
    // Verificar dominios comunes pero con errores tipográficos
    const suspiciousDomains = ['gmial.com', 'yahooo.com', 'hotmial.com', 'outlok.com'];
    const domain = cleanEmail.split('@')[1];
    if (suspiciousDomains.includes(domain)) {
      throw new ValidationError(`Revisa la ortografía del dominio de email: ${domain}`, fieldName, 'SUSPICIOUS_DOMAIN');
    }
    
    return cleanEmail;
  },

  // Validación de nombres
  validateName(name, fieldName = 'nombre') {
    if (!name || typeof name !== 'string') {
      throw new ValidationError(`${fieldName} es obligatorio`, fieldName, 'REQUIRED');
    }
    
    const cleanName = name.trim();
    
    if (cleanName.length < 2 || cleanName.length > 50) {
      throw new ValidationError(`${fieldName} debe tener entre 2 y 50 caracteres`, fieldName, 'LENGTH');
    }
    
    if (!REGEX_PATTERNS.name.test(cleanName)) {
      throw new ValidationError(`${fieldName} solo puede contener letras y espacios`, fieldName, 'FORMAT');
    }
    
    // Verificar que no sea solo espacios
    if (cleanName.replace(/\s/g, '').length === 0) {
      throw new ValidationError(`${fieldName} no puede estar vacío`, fieldName, 'EMPTY');
    }
    
    // Verificar que no tenga espacios múltiples consecutivos
    if (/\s{2,}/.test(cleanName)) {
      throw new ValidationError(`${fieldName} no puede tener espacios múltiples consecutivos`, fieldName, 'MULTIPLE_SPACES');
    }
    
    return cleanName;
  },

  // Validación de edad
  validateAge(age, fieldName = 'edad') {
    if (age === null || age === undefined || age === '') {
      throw new ValidationError(`${fieldName} es obligatoria`, fieldName, 'REQUIRED');
    }
    
    const numAge = parseInt(age, 10);
    
    if (isNaN(numAge)) {
      throw new ValidationError(`${fieldName} debe ser un número válido`, fieldName, 'NOT_A_NUMBER');
    }
    
    if (numAge < 1 || numAge > 120) {
      throw new ValidationError(`${fieldName} debe estar entre 1 y 120 años`, fieldName, 'OUT_OF_RANGE');
    }
    
    return numAge;
  },

  // Validación de condición médica
  validateMedicalCondition(condition, fieldName = 'condición médica') {
    if (!condition || typeof condition !== 'string') {
      throw new ValidationError(`${fieldName} es obligatoria`, fieldName, 'REQUIRED');
    }
    
    const cleanCondition = condition.trim().toLowerCase().replace(/\s+/g, '_');
    
    if (cleanCondition.length < 3 || cleanCondition.length > 200) {
      throw new ValidationError(`${fieldName} debe tener entre 3 y 200 caracteres`, fieldName, 'LENGTH');
    }
    
    // Si no está en la lista de condiciones válidas, permitir "otro" pero validar formato
    if (!VALID_MEDICAL_CONDITIONS.includes(cleanCondition)) {
      if (!REGEX_PATTERNS.alphanumeric.test(condition.trim())) {
        throw new ValidationError(`${fieldName} contiene caracteres no válidos`, fieldName, 'INVALID_CHARACTERS');
      }
    }
    
    return condition.trim();
  },

  // Validación de contraseña
  validatePassword(password, fieldName = 'contraseña') {
    if (!password || typeof password !== 'string') {
      throw new ValidationError(`${fieldName} es obligatoria`, fieldName, 'REQUIRED');
    }
    
    if (password.length < 8 || password.length > 128) {
      throw new ValidationError(`${fieldName} debe tener entre 8 y 128 caracteres`, fieldName, 'LENGTH');
    }
    
    if (!/[a-z]/.test(password)) {
      throw new ValidationError(`${fieldName} debe contener al menos una letra minúscula`, fieldName, 'MISSING_LOWERCASE');
    }
    
    if (!/[A-Z]/.test(password)) {
      throw new ValidationError(`${fieldName} debe contener al menos una letra mayúscula`, fieldName, 'MISSING_UPPERCASE');
    }
    
    if (!/[0-9]/.test(password)) {
      throw new ValidationError(`${fieldName} debe contener al menos un número`, fieldName, 'MISSING_NUMBER');
    }
    
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      throw new ValidationError(`${fieldName} debe contener al menos un carácter especial (!@#$%^&*(),.?":{}|<>)`, fieldName, 'MISSING_SPECIAL');
    }
    
    // Verificar patrones comunes débiles
    const weakPatterns = [
      /^(.)\1+$/, // Todos los caracteres iguales
      /123456|abcdef|qwerty|password|admin|letmein/i, // Patrones comunes
      /^[0-9]+$/, // Solo números
      /^[a-zA-Z]+$/ // Solo letras
    ];
    
    if (weakPatterns.some(pattern => pattern.test(password))) {
      throw new ValidationError(`${fieldName} es demasiado débil. Evita patrones comunes`, fieldName, 'WEAK_PASSWORD');
    }
    
    return password;
  },

  // Validación de nombre de serie terapéutica
  validateSeriesName(name, fieldName = 'nombre de serie') {
    if (!name || typeof name !== 'string') {
      throw new ValidationError(`${fieldName} es obligatorio`, fieldName, 'REQUIRED');
    }
    
    const cleanName = name.trim();
    
    if (cleanName.length < 3 || cleanName.length > 100) {
      throw new ValidationError(`${fieldName} debe tener entre 3 y 100 caracteres`, fieldName, 'LENGTH');
    }
    
    if (!REGEX_PATTERNS.seriesName.test(cleanName)) {
      throw new ValidationError(`${fieldName} contiene caracteres no válidos`, fieldName, 'INVALID_CHARACTERS');
    }
    
    return cleanName;
  },

  // Validación de tipo de terapia
  validateTherapyType(therapyType, fieldName = 'tipo de terapia') {
    if (!therapyType || typeof therapyType !== 'string') {
      throw new ValidationError(`${fieldName} es obligatorio`, fieldName, 'REQUIRED');
    }
    
    if (!VALID_THERAPY_TYPES.includes(therapyType)) {
      throw new ValidationError(
        `${fieldName} debe ser uno de los tipos válidos: ${VALID_THERAPY_TYPES.join(', ')}`, 
        fieldName, 
        'INVALID_TYPE'
      );
    }
    
    return therapyType;
  },

  // Validación de posturas
  validatePostures(postures, fieldName = 'posturas') {
    if (!Array.isArray(postures)) {
      throw new ValidationError(`${fieldName} debe ser una lista`, fieldName, 'NOT_ARRAY');
    }
    
    if (postures.length === 0) {
      throw new ValidationError(`Debe seleccionar al menos una postura`, fieldName, 'EMPTY_ARRAY');
    }
    
    if (postures.length > 50) {
      throw new ValidationError(`No puedes seleccionar más de 50 posturas`, fieldName, 'TOO_MANY_ITEMS');
    }
    
    // Validar cada postura
    postures.forEach((posture, index) => {
      if (!posture || typeof posture !== 'object') {
        throw new ValidationError(`La postura en la posición ${index + 1} no es válida`, fieldName, 'INVALID_ITEM');
      }
      
      if (!posture.id || !posture.name) {
        throw new ValidationError(`La postura en la posición ${index + 1} debe tener id y nombre`, fieldName, 'MISSING_REQUIRED_FIELDS');
      }
    });
    
    return postures;
  },

  // Validación de número de sesiones
  validateTotalSessions(totalSessions, fieldName = 'total de sesiones') {
    if (totalSessions === null || totalSessions === undefined || totalSessions === '') {
      throw new ValidationError(`${fieldName} es obligatorio`, fieldName, 'REQUIRED');
    }
    
    const numSessions = parseInt(totalSessions, 10);
    
    if (isNaN(numSessions)) {
      throw new ValidationError(`${fieldName} debe ser un número válido`, fieldName, 'NOT_A_NUMBER');
    }
    
    if (numSessions < 1 || numSessions > 100) {
      throw new ValidationError(`${fieldName} debe estar entre 1 y 100`, fieldName, 'OUT_OF_RANGE');
    }
    
    return numSessions;
  },

  // Validación de nivel de dolor
  validatePainLevel(painLevel, fieldName = 'nivel de dolor') {
    if (painLevel === null || painLevel === undefined || painLevel === '') {
      throw new ValidationError(`${fieldName} es obligatorio`, fieldName, 'REQUIRED');
    }
    
    const numPain = parseInt(painLevel, 10);
    
    if (isNaN(numPain)) {
      throw new ValidationError(`${fieldName} debe ser un número válido`, fieldName, 'NOT_A_NUMBER');
    }
    
    if (numPain < 0 || numPain > 10) {
      throw new ValidationError(`${fieldName} debe estar entre 0 y 10`, fieldName, 'OUT_OF_RANGE');
    }
    
    return numPain;
  },

  // Validación de comentarios
  validateComments(comments, fieldName = 'comentarios', minLength = 10) {
    if (!comments || typeof comments !== 'string') {
      throw new ValidationError(`${fieldName} son obligatorios`, fieldName, 'REQUIRED');
    }
    
    const cleanComments = comments.trim();
    
    if (cleanComments.length < minLength) {
      throw new ValidationError(`${fieldName} debe tener al menos ${minLength} caracteres`, fieldName, 'TOO_SHORT');
    }
    
    if (cleanComments.length > 1000) {
      throw new ValidationError(`${fieldName} no puede exceder 1000 caracteres`, fieldName, 'TOO_LONG');
    }
    
    // Verificar que no sea solo caracteres especiales o números
    if (!/[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(cleanComments)) {
      throw new ValidationError(`${fieldName} debe contener texto descriptivo`, fieldName, 'INVALID_CONTENT');
    }
    
    return cleanComments;
  },

  // Validación de duración
  validateDuration(duration, fieldName = 'duración') {
    if (duration === null || duration === undefined || duration === '') {
      return 30; // Valor por defecto
    }
    
    const numDuration = parseInt(duration, 10);
    
    if (isNaN(numDuration)) {
      throw new ValidationError(`${fieldName} debe ser un número válido`, fieldName, 'NOT_A_NUMBER');
    }
    
    if (numDuration < 5 || numDuration > 180) {
      throw new ValidationError(`${fieldName} debe estar entre 5 y 180 minutos`, fieldName, 'OUT_OF_RANGE');
    }
    
    return numDuration;
  },

  // Validación de rol de usuario
  validateUserRole(role, fieldName = 'rol') {
    if (!role) {
      return 'instructor'; // Valor por defecto
    }
    
    const validRoles = ['instructor', 'patient', 'admin'];
    
    if (!validRoles.includes(role)) {
      throw new ValidationError(`${fieldName} debe ser uno de: ${validRoles.join(', ')}`, fieldName, 'INVALID_ROLE');
    }
    
    return role;
  }
};

// ✅ NUEVO: Middleware de timeout para requests
const timeoutMiddleware = (timeout = 30000) => {
  return (req, res, next) => {
    req.setTimeout(timeout, () => {
      if (!res.headersSent) {
        res.status(408).json({ 
          error: 'Request timeout', 
          message: 'La operación tardó demasiado tiempo. Inténtalo de nuevo.',
          retryable: true 
        });
      }
    });
    next();
  };
};

// ✅ NUEVO: Middleware de manejo de errores de red mejorado
const handleNetworkError = (error, req, res, next) => {
  if (error instanceof NetworkError) {
    return res.status(error.statusCode).json({
      error: error.message,
      type: 'network_error',
      retryable: error.isRetryable,
      retry_after: error.isRetryable ? Math.ceil(RETRY_CONFIG.baseDelay / 1000) : null
    });
  }
  next(error);
};

// Middleware de manejo de errores de validación
const handleValidationError = (error, req, res, next) => {
  if (error instanceof ValidationError) {
    return res.status(error.statusCode).json({
      error: error.message,
      field: error.field,
      code: error.code,
      type: 'validation_error'
    });
  }
  next(error);
};

// =============================================
// RESTO DEL CÓDIGO ORIGINAL CON VALIDACIONES APLICADAS
// =============================================

// ✅ NUEVO: Middleware optimizado con timeout
app.use(timeoutMiddleware()); // Aplicar timeout global
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
    res.json = function (data) {
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

// Database initialization para PostgreSQL
async function initDatabase() {
  try {
    // Crear tablas con índices optimizados
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          name TEXT,
          role TEXT DEFAULT 'instructor',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_login TIMESTAMP,
          is_active BOOLEAN DEFAULT TRUE
      );

      CREATE TABLE IF NOT EXISTS patients (
          id SERIAL PRIMARY KEY,
          name TEXT,
          email TEXT NOT NULL,
          age INTEGER,
          condition TEXT,
          instructor_id INTEGER NOT NULL,
          assigned_series TEXT,
          current_session INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_active BOOLEAN DEFAULT TRUE,
          FOREIGN KEY (instructor_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS therapy_series (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          therapy_type TEXT NOT NULL,
          postures TEXT NOT NULL,
          total_sessions INTEGER NOT NULL,
          instructor_id INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_active BOOLEAN DEFAULT TRUE,
          FOREIGN KEY (instructor_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sessions (
          id SERIAL PRIMARY KEY,
          patient_id INTEGER NOT NULL,
          series_id INTEGER NOT NULL,
          session_number INTEGER NOT NULL,
          pain_before INTEGER,
          pain_after INTEGER,
          comments TEXT,
          duration_minutes INTEGER,
          completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE,
          FOREIGN KEY (series_id) REFERENCES therapy_series (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS notifications (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          is_read BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS analytics_events (
          id SERIAL PRIMARY KEY,
          user_id INTEGER,
          event_type TEXT NOT NULL,
          event_data TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      -- Índices para mejor rendimiento
      CREATE INDEX IF NOT EXISTS idx_patients_instructor ON patients(instructor_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_patient ON sessions(patient_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(completed_at);
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
      CREATE INDEX IF NOT EXISTS idx_analytics_user_date ON analytics_events(user_id, created_at);
    `);

    console.log('🚀 PostgreSQL Database initialized with performance optimizations');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
}

// ✅ NUEVO: Función para ejecutar consultas con reintentos y timeouts
const query = async (sql, params = []) => {
  return await retryWithBackoff(async () => {
    const client = await pool.connect();
    try {
      // ✅ NUEVO: Timeout personalizado para consultas
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Query timeout')), 15000);
      });
      
      const queryPromise = client.query(sql, params);
      const result = await Promise.race([queryPromise, timeoutPromise]);
      return result;
    } finally {
      client.release();
    }
  });
};

// Función para registrar eventos de analytics CON REINTENTOS
const logAnalyticsEvent = async (userId, eventType, eventData = {}) => {
  try {
    // ✅ NUEVO: Analytics con reintento pero sin bloquear el flujo principal
    setTimeout(async () => {
      try {
        await retryWithBackoff(
          () => query(
            'INSERT INTO analytics_events (user_id, event_type, event_data) VALUES ($1, $2, $3)',
            [userId, eventType, JSON.stringify(eventData)]
          ),
          1 // Solo 1 reintento para analytics
        );
      } catch (error) {
        console.warn('Analytics event failed after retries:', error.message);
      }
    }, 0);
  } catch (error) {
    // No bloquear el flujo principal por errores de analytics
    console.warn('Analytics logging error:', error);
  }
};

// ✅ NUEVO: Authentication middleware con manejo de errores mejorado
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      error: 'Access token required',
      type: 'auth_error',
      retryable: false 
    });
  }

  jwt.verify(token, JWT_SECRET, async (err, user) => {
    if (err) {
      const isExpired = err.name === 'TokenExpiredError';
      return res.status(403).json({ 
        error: isExpired ? 'Token expired' : 'Invalid token',
        type: 'auth_error',
        expired: isExpired,
        retryable: false 
      });
    }
    req.user = user;

    // Analytics no bloqueante
    logAnalyticsEvent(user.id, 'api_request', {
      endpoint: req.originalUrl,
      method: req.method
    });

    next();
  });
};

// Auth routes CON VALIDACIONES ROBUSTAS Y MANEJO DE ERRORES DE RED
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;

    // Validaciones robustas
    const validatedEmail = validators.validateEmail(email);
    const validatedPassword = validators.validatePassword(password);
    const validatedName = validators.validateName(name);
    const validatedRole = validators.validateUserRole(role);

    // ✅ NUEVO: Verificar usuario existente con reintentos
    const existingUser = await retryWithBackoff(
      () => query('SELECT id FROM users WHERE email = $1', [validatedEmail])
    );
    
    if (existingUser.rows.length > 0) {
      throw new ValidationError('Ya existe un usuario con este email', 'email', 'DUPLICATE_EMAIL');
    }

    const hashedPassword = await bcrypt.hash(validatedPassword, 12);

    // ✅ NUEVO: Inserción con reintentos
    const result = await retryWithBackoff(
      () => query(
        'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
        [validatedEmail, hashedPassword, validatedName, validatedRole]
      )
    );

    const user = result.rows[0];
    await logAnalyticsEvent(user.id, 'user_registered', { role: user.role });

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ 
      token, 
      user, 
      message: 'Usuario registrado exitosamente',
      validation_passed: true 
    });

  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({
        error: error.message,
        field: error.field,
        code: error.code,
        type: 'validation_error'
      });
    }
    
    if (error instanceof NetworkError) {
      return res.status(error.statusCode).json({
        error: error.message,
        type: 'network_error',
        retryable: error.isRetryable
      });
    }
    
    console.error('Registration error:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      type: 'server_error',
      retryable: true 
    });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validaciones robustas
    const validatedEmail = validators.validateEmail(email);
    
    if (!password || typeof password !== 'string') {
      throw new ValidationError('La contraseña es obligatoria', 'password', 'REQUIRED');
    }

    // ✅ NUEVO: Login con reintentos
    const userResult = await retryWithBackoff(
      () => query('SELECT * FROM users WHERE email = $1 AND is_active = TRUE', [validatedEmail])
    );
    const user = userResult.rows[0];

    if (!user || !await bcrypt.compare(password, user.password)) {
      throw new ValidationError('Credenciales inválidas', 'credentials', 'INVALID_CREDENTIALS');
    }

    // ✅ NUEVO: Actualizar last_login con reintentos
    await retryWithBackoff(
      () => query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id])
    );

    await logAnalyticsEvent(user.id, 'user_login', { timestamp: new Date().toISOString() });

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      message: 'Inicio de sesión exitoso'
    });

  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({
        error: error.message,
        field: error.field,
        code: error.code,
        type: 'validation_error'
      });
    }
    
    if (error instanceof NetworkError) {
      return res.status(error.statusCode).json({
        error: error.message,
        type: 'network_error',
        retryable: error.isRetryable
      });
    }
    
    console.error('Login error:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      type: 'server_error',
      retryable: true 
    });
  }
});

// Patient routes CON VALIDACIONES ROBUSTAS Y MANEJO DE RED
app.get('/api/patients', authenticateToken, cacheMiddleware(), async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    // ✅ NUEVO: Query con reintentos
    const patientsResult = await retryWithBackoff(() => query(`
      SELECT p.*, 
             COUNT(s.id) as total_sessions_completed,
             AVG(s.pain_before - s.pain_after) as avg_pain_improvement
      FROM patients p
      LEFT JOIN sessions s ON p.id = s.patient_id
      WHERE p.instructor_id = $1 AND p.is_active = TRUE
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `, [req.user.id]));

    const patientsWithSeries = patientsResult.rows.map(patient => ({
      ...patient,
      assignedSeries: patient.assigned_series ? JSON.parse(patient.assigned_series) : null
    }));

    res.json(patientsWithSeries);
  } catch (error) {
    if (error instanceof NetworkError) {
      return res.status(error.statusCode).json({
        error: error.message,
        type: 'network_error',
        retryable: error.isRetryable
      });
    }
    
    console.error('Get patients error:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      type: 'server_error',
      retryable: true 
    });
  }
});

app.post('/api/patients', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const { name, email, age, condition } = req.body;

    // Validaciones robustas
    const validatedName = validators.validateName(name, 'nombre del paciente');
    const validatedEmail = validators.validateEmail(email, 'email del paciente');
    const validatedAge = validators.validateAge(age, 'edad del paciente');
    const validatedCondition = validators.validateMedicalCondition(condition, 'condición médica');

    // ✅ NUEVO: Verificación con reintentos
    const existingPatient = await retryWithBackoff(() => query(
      'SELECT id FROM patients WHERE email = $1 AND instructor_id = $2 AND is_active = TRUE', 
      [validatedEmail, req.user.id]
    ));
    
    if (existingPatient.rows.length > 0) {
      throw new ValidationError('Ya tienes un paciente registrado con este email', 'email', 'DUPLICATE_PATIENT_EMAIL');
    }

    // ✅ NUEVO: Inserción con reintentos
    const result = await retryWithBackoff(() => query(
      'INSERT INTO patients (name, email, age, condition, instructor_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [validatedName, validatedEmail, validatedAge, validatedCondition, req.user.id]
    ));

    const patient = result.rows[0];

    clearCache('patients');
    await logAnalyticsEvent(req.user.id, 'patient_created', { 
      patientId: patient.id, 
      age: validatedAge, 
      condition: validatedCondition 
    });

    res.json({ 
      ...patient, 
      message: 'Paciente creado exitosamente',
      validation_passed: true 
    });

  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({
        error: error.message,
        field: error.field,
        code: error.code,
        type: 'validation_error'
      });
    }
    
    if (error instanceof NetworkError) {
      return res.status(error.statusCode).json({
        error: error.message,
        type: 'network_error',
        retryable: error.isRetryable
      });
    }
    
    console.error('Create patient error:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      type: 'server_error',
      retryable: true 
    });
  }
});

app.put('/api/patients/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const patientId = parseInt(req.params.id);
    const { name, email, age, condition } = req.body;

    // Validar ID del paciente
    if (isNaN(patientId) || patientId <= 0) {
      throw new ValidationError('ID de paciente inválido', 'id', 'INVALID_ID');
    }

    // Validaciones robustas
    const validatedName = validators.validateName(name, 'nombre del paciente');
    const validatedEmail = validators.validateEmail(email, 'email del paciente');
    const validatedAge = validators.validateAge(age, 'edad del paciente');
    const validatedCondition = validators.validateMedicalCondition(condition, 'condición médica');

    // ✅ NUEVO: Verificación con reintentos
    const existingPatient = await retryWithBackoff(() => query(
      'SELECT id FROM patients WHERE email = $1 AND instructor_id = $2 AND id != $3 AND is_active = TRUE', 
      [validatedEmail, req.user.id, patientId]
    ));
    
    if (existingPatient.rows.length > 0) {
      throw new ValidationError('Ya tienes otro paciente registrado con este email', 'email', 'DUPLICATE_PATIENT_EMAIL');
    }

    // ✅ NUEVO: Actualización con reintentos
    const result = await retryWithBackoff(() => query(`
      UPDATE patients 
      SET name = $1, email = $2, age = $3, condition = $4, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $5 AND instructor_id = $6
      RETURNING *
    `, [validatedName, validatedEmail, validatedAge, validatedCondition, patientId, req.user.id]));

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }

    const patient = result.rows[0];

    clearCache('patients');
    await logAnalyticsEvent(req.user.id, 'patient_updated', { 
      patientId,
      changes: { name: validatedName, email: validatedEmail, age: validatedAge, condition: validatedCondition }
    });

    res.json({ 
      ...patient, 
      message: 'Paciente actualizado exitosamente',
      validation_passed: true 
    });

  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({
        error: error.message,
        field: error.field,
        code: error.code,
        type: 'validation_error'
      });
    }
    
    if (error instanceof NetworkError) {
      return res.status(error.statusCode).json({
        error: error.message,
        type: 'network_error',
        retryable: error.isRetryable
      });
    }
    
    console.error('Update patient error:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      type: 'server_error',
      retryable: true 
    });
  }
});

app.delete('/api/patients/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const patientId = parseInt(req.params.id);

    // Validar ID del paciente
    if (isNaN(patientId) || patientId <= 0) {
      throw new ValidationError('ID de paciente inválido', 'id', 'INVALID_ID');
    }

    // ✅ NUEVO: Soft delete con reintentos
    const result = await retryWithBackoff(() => query(
      'UPDATE patients SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND instructor_id = $2 RETURNING *',
      [patientId, req.user.id]
    ));

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }

    clearCache('patients');
    await logAnalyticsEvent(req.user.id, 'patient_deleted', { patientId });

    res.json({ message: 'Paciente eliminado exitosamente' });

  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({
        error: error.message,
        field: error.field,
        code: error.code,
        type: 'validation_error'
      });
    }
    
    if (error instanceof NetworkError) {
      return res.status(error.statusCode).json({
        error: error.message,
        type: 'network_error',
        retryable: error.isRetryable
      });
    }
    
    console.error('Delete patient error:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      type: 'server_error',
      retryable: true 
    });
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

// Therapy series routes CON VALIDACIONES ROBUSTAS Y MANEJO DE RED
app.get('/api/therapy-series', authenticateToken, cacheMiddleware(), async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    // ✅ NUEVO: Query con reintentos
    const seriesResult = await retryWithBackoff(() => query(`
      SELECT ts.*, 
             COUNT(DISTINCT p.id) as assigned_patients_count,
             COUNT(DISTINCT s.id) as total_sessions_count
      FROM therapy_series ts
      LEFT JOIN patients p ON (p.assigned_series::json->>'id')::int = ts.id
      LEFT JOIN sessions s ON s.series_id = ts.id
      WHERE ts.instructor_id = $1 AND ts.is_active = TRUE
      GROUP BY ts.id
      ORDER BY ts.created_at DESC
    `, [req.user.id]));

    const seriesWithPostures = seriesResult.rows.map(s => ({
      ...s,
      postures: JSON.parse(s.postures)
    }));

    res.json(seriesWithPostures);
  } catch (error) {
    if (error instanceof NetworkError) {
      return res.status(error.statusCode).json({
        error: error.message,
        type: 'network_error',
        retryable: error.isRetryable
      });
    }
    
    console.error('Get therapy series error:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      type: 'server_error',
      retryable: true 
    });
  }
});

app.post('/api/therapy-series', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const { name, therapyType, postures, totalSessions } = req.body;

    // Validaciones robustas
    const validatedName = validators.validateSeriesName(name, 'nombre de la serie');
    const validatedTherapyType = validators.validateTherapyType(therapyType);
    const validatedPostures = validators.validatePostures(postures);
    const validatedTotalSessions = validators.validateTotalSessions(totalSessions);

    // ✅ NUEVO: Verificación con reintentos
    const existingSeries = await retryWithBackoff(() => query(
      'SELECT id FROM therapy_series WHERE name = $1 AND instructor_id = $2 AND is_active = TRUE',
      [validatedName, req.user.id]
    ));

    if (existingSeries.rows.length > 0) {
      throw new ValidationError('Ya tienes una serie con este nombre', 'name', 'DUPLICATE_SERIES_NAME');
    }

    // Validar que las posturas pertenezcan al tipo de terapia seleccionado
    const availablePostures = therapyTypes[validatedTherapyType];
    if (!availablePostures) {
      throw new ValidationError('Tipo de terapia no válido', 'therapyType', 'INVALID_THERAPY_TYPE');
    }

    const availablePostureIds = availablePostures.map(p => p.id);
    const invalidPostures = validatedPostures.filter(p => !availablePostureIds.includes(p.id));
    
    if (invalidPostures.length > 0) {
      throw new ValidationError(
        `Las siguientes posturas no pertenecen al tipo de terapia "${validatedTherapyType}": ${invalidPostures.map(p => p.name).join(', ')}`,
        'postures',
        'INVALID_POSTURES_FOR_THERAPY_TYPE'
      );
    }

    // ✅ NUEVO: Inserción con reintentos
    const result = await retryWithBackoff(() => query(
      'INSERT INTO therapy_series (name, therapy_type, postures, total_sessions, instructor_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [validatedName, validatedTherapyType, JSON.stringify(validatedPostures), validatedTotalSessions, req.user.id]
    ));

    const series = result.rows[0];

    clearCache('therapy-series');
    await logAnalyticsEvent(req.user.id, 'series_created', {
      seriesId: series.id,
      therapyType: validatedTherapyType,
      posturesCount: validatedPostures.length,
      totalSessions: validatedTotalSessions
    });

    res.json({
      ...series,
      postures: JSON.parse(series.postures),
      message: 'Serie creada exitosamente',
      validation_passed: true
    });

  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({
        error: error.message,
        field: error.field,
        code: error.code,
        type: 'validation_error'
      });
    }
    
    if (error instanceof NetworkError) {
      return res.status(error.statusCode).json({
        error: error.message,
        type: 'network_error',
        retryable: error.isRetryable
      });
    }
    
    console.error('Create therapy series error:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      type: 'server_error',
      retryable: true 
    });
  }
});

app.delete('/api/therapy-series/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const seriesId = parseInt(req.params.id);

    // Validar ID de la serie
    if (isNaN(seriesId) || seriesId <= 0) {
      throw new ValidationError('ID de serie inválido', 'id', 'INVALID_ID');
    }

    // ✅ NUEVO: Verificaciones con reintentos
    const [seriesResult, assignedPatients] = await Promise.all([
      retryWithBackoff(() => query(
        'SELECT * FROM therapy_series WHERE id = $1 AND instructor_id = $2',
        [seriesId, req.user.id]
      )),
      retryWithBackoff(() => query(`
        SELECT id FROM patients 
        WHERE instructor_id = $1 AND assigned_series IS NOT NULL 
        AND (assigned_series::json->>'id')::int = $2
      `, [req.user.id, seriesId]))
    ]);

    const series = seriesResult.rows[0];

    if (!series) {
      return res.status(404).json({ error: 'Serie no encontrada' });
    }

    if (assignedPatients.rows.length > 0) {
      throw new ValidationError(
        'No se puede eliminar una serie que tiene pacientes asignados', 
        'series', 
        'SERIES_HAS_ASSIGNED_PATIENTS'
      );
    }

    // ✅ NUEVO: Soft delete con reintentos
    await retryWithBackoff(() => query(
      'UPDATE therapy_series SET is_active = FALSE WHERE id = $1 AND instructor_id = $2',
      [seriesId, req.user.id]
    ));

    clearCache('therapy-series');
    await logAnalyticsEvent(req.user.id, 'series_deleted', { seriesId });

    res.json({ message: 'Serie eliminada exitosamente' });

  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({
        error: error.message,
        field: error.field,
        code: error.code,
        type: 'validation_error'
      });
    }
    
    if (error instanceof NetworkError) {
      return res.status(error.statusCode).json({
        error: error.message,
        type: 'network_error',
        retryable: error.isRetryable
      });
    }
    
    console.error('Delete therapy series error:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      type: 'server_error',
      retryable: true 
    });
  }
});

// Analytics y Dashboard endpoints CON MANEJO DE RED
app.get('/api/dashboard/analytics', authenticateToken, cacheMiddleware(2 * 60 * 1000), async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    // ✅ NUEVO: Queries paralelas con reintentos
    const [stats, recentActivity, painTrends, sessionStats] = await Promise.all([
      retryWithBackoff(() => query(`
        SELECT 
            COUNT(DISTINCT p.id) as total_patients,
            COUNT(DISTINCT CASE WHEN p.assigned_series IS NOT NULL THEN p.id END) as active_patients,
            COUNT(DISTINCT ts.id) as total_series,
            COUNT(s.id) as total_sessions,
            AVG(s.pain_before - s.pain_after) as avg_pain_improvement,
            AVG(s.duration_minutes) as avg_session_duration
        FROM patients p
        LEFT JOIN therapy_series ts ON ts.instructor_id = $1
        LEFT JOIN sessions s ON s.patient_id = p.id
        WHERE p.instructor_id = $1 AND p.is_active = TRUE
      `, [req.user.id])),

      retryWithBackoff(() => query(`
        SELECT 'session' as type, p.name as patient_name, s.completed_at as date, 
               s.pain_before, s.pain_after, s.session_number
        FROM sessions s
        JOIN patients p ON s.patient_id = p.id
        WHERE p.instructor_id = $1
        ORDER BY s.completed_at DESC
        LIMIT 10
      `, [req.user.id])),

      retryWithBackoff(() => query(`
        SELECT 
            to_char(s.completed_at, 'YYYY-MM') as month,
            AVG(s.pain_before) as avg_pain_before,
            AVG(s.pain_after) as avg_pain_after,
            COUNT(s.id) as session_count
        FROM sessions s
        JOIN patients p ON s.patient_id = p.id
        WHERE p.instructor_id = $1 AND s.completed_at >= (CURRENT_DATE - INTERVAL '6 months')
        GROUP BY to_char(s.completed_at, 'YYYY-MM')
        ORDER BY month
      `, [req.user.id])),

      retryWithBackoff(() => query(`
        SELECT 
            ts.therapy_type,
            COUNT(s.id) as session_count,
            AVG(s.pain_before - s.pain_after) as avg_improvement,
            AVG(s.duration_minutes) as avg_duration
        FROM sessions s
        JOIN therapy_series ts ON s.series_id = ts.id
        JOIN patients p ON s.patient_id = p.id
        WHERE p.instructor_id = $1
        GROUP BY ts.therapy_type
      `, [req.user.id]))
    ]);

    res.json({
      stats: {
        ...stats.rows[0],
        avg_pain_improvement: Math.round((stats.rows[0].avg_pain_improvement || 0) * 100) / 100,
        avg_session_duration: Math.round(stats.rows[0].avg_session_duration || 0)
      },
      recentActivity: recentActivity.rows,
      painTrends: painTrends.rows,
      sessionStats: sessionStats.rows,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof NetworkError) {
      return res.status(error.statusCode).json({
        error: error.message,
        type: 'network_error',
        retryable: error.isRetryable
      });
    }
    
    console.error('Analytics error:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      type: 'server_error',
      retryable: true 
    });
  }
});

// Notifications system CON MANEJO DE RED
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    // ✅ NUEVO: Query con reintentos
    const notifications = await retryWithBackoff(() => query(`
      SELECT * FROM notifications 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT 20
    `, [req.user.id]));

    res.json(notifications.rows);
  } catch (error) {
    if (error instanceof NetworkError) {
      return res.status(error.statusCode).json({
        error: error.message,
        type: 'network_error',
        retryable: error.isRetryable
      });
    }
    
    console.error('Get notifications error:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      type: 'server_error',
      retryable: true 
    });
  }
});

app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const notificationId = parseInt(req.params.id);

    // Validar ID de notificación
    if (isNaN(notificationId) || notificationId <= 0) {
      throw new ValidationError('ID de notificación inválido', 'id', 'INVALID_ID');
    }

    // ✅ NUEVO: Update con reintentos
    await retryWithBackoff(() => query(
      'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2',
      [notificationId, req.user.id]
    ));
    
    res.json({ message: 'Notificación marcada como leída' });

  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({
        error: error.message,
        field: error.field,
        code: error.code,
        type: 'validation_error'
      });
    }
    
    if (error instanceof NetworkError) {
      return res.status(error.statusCode).json({
        error: error.message,
        type: 'network_error',
        retryable: error.isRetryable
      });
    }
    
    console.error('Mark notification read error:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      type: 'server_error',
      retryable: true 
    });
  }
});

// Export reports endpoint CON VALIDACIONES Y MANEJO DE RED
app.get('/api/reports/export', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const { format = 'json', dateFrom, dateTo } = req.query;

    // Validar formato de reporte
    const validFormats = ['json', 'csv'];
    if (!validFormats.includes(format)) {
      throw new ValidationError(`Formato debe ser uno de: ${validFormats.join(', ')}`, 'format', 'INVALID_FORMAT');
    }

    // Validar fechas si se proporcionan
    let validatedDateFrom, validatedDateTo;
    if (dateFrom) {
      validatedDateFrom = new Date(dateFrom);
      if (isNaN(validatedDateFrom.getTime())) {
        throw new ValidationError('Fecha de inicio inválida', 'dateFrom', 'INVALID_DATE');
      }
    }

    if (dateTo) {
      validatedDateTo = new Date(dateTo);
      if (isNaN(validatedDateTo.getTime())) {
        throw new ValidationError('Fecha de fin inválida', 'dateTo', 'INVALID_DATE');
      }
    }

    // Validar que dateFrom no sea posterior a dateTo
    if (validatedDateFrom && validatedDateTo && validatedDateFrom > validatedDateTo) {
      throw new ValidationError('La fecha de inicio no puede ser posterior a la fecha de fin', 'dateFrom', 'INVALID_DATE_RANGE');
    }

    let dateFilter = '';
    let params = [req.user.id];

    if (validatedDateFrom && validatedDateTo) {
      dateFilter = 'AND s.completed_at BETWEEN $2 AND $3';
      params.push(validatedDateFrom.toISOString(), validatedDateTo.toISOString());
    }

    // ✅ NUEVO: Query de reporte con reintentos
    const reportResult = await retryWithBackoff(() => query(`
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
      WHERE p.instructor_id = $1 ${dateFilter}
      ORDER BY s.completed_at DESC
    `, params));

    const reportData = reportResult.rows;

    await logAnalyticsEvent(req.user.id, 'report_exported', {
      format,
      recordCount: reportData.length,
      dateFilter: { dateFrom: validatedDateFrom, dateTo: validatedDateTo }
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
          `"${(row.comments || '').replace(/"/g, '""')}"`, // Escapar comillas dobles
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
        date_range: { dateFrom: validatedDateFrom, dateTo: validatedDateTo }
      }
    });

  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({
        error: error.message,
        field: error.field,
        code: error.code,
        type: 'validation_error'
      });
    }
    
    if (error instanceof NetworkError) {
      return res.status(error.statusCode).json({
        error: error.message,
        type: 'network_error',
        retryable: error.isRetryable
      });
    }
    
    console.error('Export reports error:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      type: 'server_error',
      retryable: true 
    });
  }
});

// Assign series CON VALIDACIONES ROBUSTAS Y MANEJO DE RED
app.post('/api/patients/:id/assign-series', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const patientId = parseInt(req.params.id);
    const { seriesId } = req.body;

    // Validaciones robustas
    if (isNaN(patientId) || patientId <= 0) {
      throw new ValidationError('ID de paciente inválido', 'patientId', 'INVALID_ID');
    }

    if (!seriesId || isNaN(parseInt(seriesId)) || parseInt(seriesId) <= 0) {
      throw new ValidationError('ID de serie inválido', 'seriesId', 'INVALID_ID');
    }

    const validatedSeriesId = parseInt(seriesId);

    // ✅ NUEVO: Verificaciones paralelas con reintentos
    const [patientResult, seriesResult] = await Promise.all([
      retryWithBackoff(() => query('SELECT * FROM patients WHERE id = $1 AND instructor_id = $2 AND is_active = TRUE', [patientId, req.user.id])),
      retryWithBackoff(() => query('SELECT * FROM therapy_series WHERE id = $1 AND instructor_id = $2 AND is_active = TRUE', [validatedSeriesId, req.user.id]))
    ]);

    const patient = patientResult.rows[0];
    const series = seriesResult.rows[0];

    if (!patient) {
      return res.status(404).json({ error: 'Paciente no encontrado o inactivo' });
    }

    if (!series) {
      return res.status(404).json({ error: 'Serie no encontrada o inactiva' });
    }

    const seriesData = {
      ...series,
      postures: JSON.parse(series.postures)
    };

    // ✅ NUEVO: Updates con reintentos
    await retryWithBackoff(() => query(
      'UPDATE patients SET assigned_series = $1, current_session = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [JSON.stringify(seriesData), patientId]
    ));

    // ✅ NUEVO: Notificación con manejo de errores
    try {
      const patientUserResult = await retryWithBackoff(() => query('SELECT id FROM users WHERE email = $1', [patient.email]));
      const patientUser = patientUserResult.rows[0];

      if (patientUser) {
        await retryWithBackoff(() => query(`
          INSERT INTO notifications (user_id, type, title, message) 
          VALUES ($1, 'series_assigned', 'Nueva Serie Asignada', $2)
        `, [patientUser.id, `Tu instructor te ha asignado la serie "${series.name}". ¡Puedes comenzar cuando estés listo!`]));
      }
    } catch (notificationError) {
      console.warn('Notification creation failed:', notificationError.message);
      // Continuar sin bloquear el flujo principal
    }

    const updatedPatientResult = await retryWithBackoff(() => query('SELECT * FROM patients WHERE id = $1', [patientId]));
    const updatedPatient = updatedPatientResult.rows[0];

    clearCache('patients');
    await logAnalyticsEvent(req.user.id, 'series_assigned', {
      patientId,
      seriesId: validatedSeriesId,
      seriesName: series.name
    });

    res.json({
      ...updatedPatient,
      assignedSeries: JSON.parse(updatedPatient.assigned_series),
      message: 'Serie asignada exitosamente',
      validation_passed: true
    });

  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({
        error: error.message,
        field: error.field,
        code: error.code,
        type: 'validation_error'
      });
    }
    
    if (error instanceof NetworkError) {
      return res.status(error.statusCode).json({
        error: error.message,
        type: 'network_error',
        retryable: error.isRetryable
      });
    }
    
    console.error('Assign series error:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      type: 'server_error',
      retryable: true 
    });
  }
});

// Patient session routes CON VALIDACIONES ROBUSTAS Y MANEJO DE RED
app.get('/api/my-series', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'patient') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    // ✅ NUEVO: Query con reintentos
    const patientResult = await retryWithBackoff(() => query('SELECT * FROM patients WHERE email = $1 AND is_active = TRUE', [req.user.email]));
    const patient = patientResult.rows[0];

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
    if (error instanceof NetworkError) {
      return res.status(error.statusCode).json({
        error: error.message,
        type: 'network_error',
        retryable: error.isRetryable
      });
    }
    
    console.error('Get my series error:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      type: 'server_error',
      retryable: true 
    });
  }
});

app.post('/api/sessions', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'patient') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const { painBefore, painAfter, comments, durationMinutes } = req.body;

    // Validaciones robustas
    const validatedPainBefore = validators.validatePainLevel(painBefore, 'dolor antes');
    const validatedPainAfter = validators.validatePainLevel(painAfter, 'dolor después');
    const validatedComments = validators.validateComments(comments, 'comentarios', 10);
    const validatedDuration = validators.validateDuration(durationMinutes, 'duración');

    // Validación lógica: el dolor después no debería ser mayor al dolor antes (aunque es posible)
    if (validatedPainAfter > validatedPainBefore + 2) {
      console.warn(`Pain increased significantly for user ${req.user.id}: ${validatedPainBefore} -> ${validatedPainAfter}`);
    }

    // ✅ NUEVO: Query de paciente con reintentos
    const patientResult = await retryWithBackoff(() => query('SELECT * FROM patients WHERE email = $1 AND is_active = TRUE', [req.user.email]));
    const patient = patientResult.rows[0];

    if (!patient) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }

    if (!patient.assigned_series) {
      throw new ValidationError('No tienes una serie asignada para completar sesiones', 'assigned_series', 'NO_ASSIGNED_SERIES');
    }

    const assignedSeries = JSON.parse(patient.assigned_series);
    const sessionNumber = (patient.current_session || 0) + 1;

    // Validar que no se exceda el número total de sesiones
    if (sessionNumber > assignedSeries.total_sessions) {
      throw new ValidationError(
        `Ya has completado todas las sesiones de esta serie (${assignedSeries.total_sessions})`, 
        'session_number', 
        'SERIES_COMPLETED'
      );
    }

    // ✅ NUEVO: Transacción con reintentos para insertar sesión y actualizar paciente
    const result = await retryWithBackoff(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        // Insertar sesión
        const sessionResult = await client.query(`
          INSERT INTO sessions (patient_id, series_id, session_number, pain_before, pain_after, comments, duration_minutes) 
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `, [patient.id, assignedSeries.id, sessionNumber, validatedPainBefore, validatedPainAfter, validatedComments, validatedDuration]);

        // Actualizar sesión actual del paciente
        await client.query(
          'UPDATE patients SET current_session = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [sessionNumber, patient.id]
        );

        await client.query('COMMIT');
        return sessionResult;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });

    // ✅ NUEVO: Notificación con manejo de errores
    try {
      const painImprovement = validatedPainBefore - validatedPainAfter;
      const improvementText = painImprovement > 0 ? `una mejora de ${painImprovement} puntos` : 
                             painImprovement < 0 ? `un aumento de ${Math.abs(painImprovement)} puntos` : 
                             'sin cambios en el dolor';

      await retryWithBackoff(() => query(`
        INSERT INTO notifications (user_id, type, title, message) 
        VALUES ($1, 'session_completed', 'Sesión Completada', $2)
      `, [patient.instructor_id, `${patient.name} completó la sesión ${sessionNumber} con ${improvementText}.`]));
    } catch (notificationError) {
      console.warn('Notification creation failed:', notificationError.message);
      // Continuar sin bloquear el flujo principal
    }

    const session = result.rows[0];

    clearCache('patients');
    await logAnalyticsEvent(req.user.id, 'session_completed', {
      sessionId: session.id,
      painImprovement: validatedPainBefore - validatedPainAfter,
      sessionNumber,
      duration: validatedDuration
    });

    res.json({ 
      ...session, 
      message: 'Sesión completada exitosamente',
      validation_passed: true 
    });

  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({
        error: error.message,
        field: error.field,
        code: error.code,
        type: 'validation_error'
      });
    }
    
    if (error instanceof NetworkError) {
      return res.status(error.statusCode).json({
        error: error.message,
        type: 'network_error',
        retryable: error.isRetryable
      });
    }
    
    console.error('Create session error:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      type: 'server_error',
      retryable: true 
    });
  }
});

// Get patient sessions CON VALIDACIONES Y MANEJO DE RED
app.get('/api/patients/:id/sessions', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const patientId = parseInt(req.params.id);

    // Validar ID del paciente
    if (isNaN(patientId) || patientId <= 0) {
      throw new ValidationError('ID de paciente inválido', 'id', 'INVALID_ID');
    }

    // ✅ NUEVO: Verificaciones con reintentos
    const [patientResult, sessionsResult] = await Promise.all([
      retryWithBackoff(() => query(
        'SELECT * FROM patients WHERE id = $1 AND instructor_id = $2',
        [patientId, req.user.id]
      )),
      retryWithBackoff(() => query(`
        SELECT s.*, ts.name as series_name, ts.therapy_type
        FROM sessions s
        LEFT JOIN therapy_series ts ON s.series_id = ts.id
        WHERE s.patient_id = $1 
        ORDER BY s.completed_at DESC
      `, [patientId]))
    ]);

    const patient = patientResult.rows[0];

    if (!patient) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }

    res.json(sessionsResult.rows);

  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({
        error: error.message,
        field: error.field,
        code: error.code,
        type: 'validation_error'
      });
    }
    
    if (error instanceof NetworkError) {
      return res.status(error.statusCode).json({
        error: error.message,
        type: 'network_error',
        retryable: error.isRetryable
      });
    }
    
    console.error('Get patient sessions error:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      type: 'server_error',
      retryable: true 
    });
  }
});

// ✅ NUEVO: Health check endpoint mejorado con verificación de red
app.get('/api/health', async (req, res) => {
  try {
    // ✅ NUEVO: Verificar conexión a la base de datos con timeout
    const dbCheck = await retryWithBackoff(
      () => query('SELECT 1'),
      1 // Solo 1 reintento para health check
    );
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      cache_size: cache.size,
      uptime: process.uptime(),
      database: 'connected',
      validation_system: 'active',
      retry_system: 'active',
      pool_status: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: 'Database connection failed',
      details: error.message,
      retryable: error instanceof NetworkError ? error.isRetryable : true
    });
  }
});

// =============================================
// NUEVOS ENDPOINTS PARA GESTIÓN DE VALIDACIONES
// =============================================

// Endpoint para obtener las condiciones médicas válidas
app.get('/api/medical-conditions', authenticateToken, (req, res) => {
  const conditions = VALID_MEDICAL_CONDITIONS.map(condition => ({
    value: condition,
    label: condition.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  }));
  
  res.json(conditions);
});

// Endpoint para validar datos antes del envío (validación previa)
app.post('/api/validate', authenticateToken, async (req, res) => {
  try {
    const { type, data } = req.body;
    
    if (!type || !data) {
      throw new ValidationError('Tipo y datos son obligatorios para validación', 'validation', 'MISSING_PARAMS');
    }

    let validationResults = { valid: true, errors: [] };

    switch (type) {
      case 'patient':
        try {
          validators.validateName(data.name, 'nombre');
          validators.validateEmail(data.email, 'email');
          validators.validateAge(data.age, 'edad');
          validators.validateMedicalCondition(data.condition, 'condición');
        } catch (error) {
          validationResults.valid = false;
          validationResults.errors.push({
            field: error.field,
            message: error.message,
            code: error.code
          });
        }
        break;

      case 'series':
        try {
          validators.validateSeriesName(data.name, 'nombre');
          validators.validateTherapyType(data.therapyType, 'tipo de terapia');
          validators.validatePostures(data.postures, 'posturas');
          validators.validateTotalSessions(data.totalSessions, 'total de sesiones');
        } catch (error) {
          validationResults.valid = false;
          validationResults.errors.push({
            field: error.field,
            message: error.message,
            code: error.code
          });
        }
        break;

      case 'session':
        try {
          validators.validatePainLevel(data.painBefore, 'dolor antes');
          validators.validatePainLevel(data.painAfter, 'dolor después');
          validators.validateComments(data.comments, 'comentarios');
          validators.validateDuration(data.durationMinutes, 'duración');
        } catch (error) {
          validationResults.valid = false;
          validationResults.errors.push({
            field: error.field,
            message: error.message,
            code: error.code
          });
        }
        break;

      default:
        throw new ValidationError('Tipo de validación no soportado', 'type', 'UNSUPPORTED_TYPE');
    }

    res.json(validationResults);

  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({
        error: error.message,
        field: error.field,
        code: error.code,
        type: 'validation_error'
      });
    }
    
    console.error('Validation error:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      type: 'server_error',
      retryable: true 
    });
  }
});

// ✅ NUEVO: Endpoint para verificar conectividad
app.get('/api/connectivity', authenticateToken, async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Test de conectividad básico
    await retryWithBackoff(() => query('SELECT CURRENT_TIMESTAMP'), 0); // Sin reintentos para test rápido
    
    const responseTime = Date.now() - startTime;
    
    res.json({
      status: 'connected',
      response_time_ms: responseTime,
      timestamp: new Date().toISOString(),
      network_quality: responseTime < 1000 ? 'good' : responseTime < 3000 ? 'fair' : 'poor'
    });
    
  } catch (error) {
    res.status(500).json({
      status: 'disconnected',
      error: error.message,
      type: 'connectivity_error',
      retryable: true,
      timestamp: new Date().toISOString()
    });
  }
});


// Middleware para rutas no encontradas (404)
app.use((req, res, next) => {
  // Si la petición es para un archivo estático que no existe, Express ya devuelve 404
  // Si es una ruta de frontend, devolver index.html solo para rutas válidas
  if (req.method === 'GET' && req.accepts('html')) {
    // Aquí podrías tener una lista blanca de rutas válidas si lo deseas
    // Por ahora, solo devolver index.html para rutas que no sean API ni archivos
    if (!req.path.startsWith('/api') && !req.path.includes('.')) {
      return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
  }
  res.status(404).send('404 Not Found');
});

// ✅ NUEVO: Error handling middleware MEJORADO con manejo de red
app.use(handleNetworkError);
app.use(handleValidationError);

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  // ✅ NUEVO: Determinar si el error es reintentable
  const isNetworkRelated = 
    err.code === 'ECONNRESET' ||
    err.code === 'ENOTFOUND' ||
    err.code === 'ECONNREFUSED' ||
    err.code === 'ETIMEDOUT' ||
    err.message?.includes('timeout') ||
    err.message?.includes('connection');

  // Log del error para debugging
  const errorDetails = {
    message: err.message,
    code: err.code,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
    isNetworkRelated
  };
  
  console.error('Error details:', errorDetails);
  
  res.status(500).json({ 
    error: 'Error interno del servidor',
    type: isNetworkRelated ? 'network_error' : 'server_error',
    retryable: isNetworkRelated || err.statusCode >= 500,
    timestamp: errorDetails.timestamp
  });
});

// ✅ NUEVO: Limpiar cache periódicamente y monitorear pool de conexiones
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      cache.delete(key);
    }
  }
  
  // Log de estado del pool para debugging
  console.log(`Pool status - Total: ${pool.totalCount}, Idle: ${pool.idleCount}, Waiting: ${pool.waitingCount}`);
}, 5 * 60 * 1000); // Cada 5 minutos

// ✅ NUEVO: Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

// Initialize database and start server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 PostgreSQL database connected`);
    console.log(`💾 Cache system active`);
    console.log(`📈 Analytics tracking enabled`);
    console.log(`✅ Robust validation system activated`);
    console.log(`🛡️  Security validations implemented`);
    console.log(`🔄 Network error recovery system enabled`);
    console.log(`⚡ Request timeout protection active`);
    console.log(`🔗 Connection pool monitoring active`);
  });
}).catch(error => {
  console.error('Failed to initialize database:', error);
  process.exit(1);
});