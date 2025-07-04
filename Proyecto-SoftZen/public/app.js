// Sweet Alert Helper Functions
const SweetAlerts = {
    // Success alerts
    success: (title, text, options = {}) => {
        return Swal.fire({
            icon: 'success',
            title: title,
            text: text,
            confirmButtonText: 'Entendido',
            timer: options.timer || null,
            showConfirmButton: !options.timer,
            ...options
        });
    },

    // Error alerts
    error: (title, text, options = {}) => {
        return Swal.fire({
            icon: 'error',
            title: title,
            text: text,
            confirmButtonText: 'Entendido',
            ...options
        });
    },

    // Warning alerts
    warning: (title, text, options = {}) => {
        return Swal.fire({
            icon: 'warning',
            title: title,
            text: text,
            confirmButtonText: 'Entendido',
            ...options
        });
    },

    // Info alerts
    info: (title, text, options = {}) => {
        return Swal.fire({
            icon: 'info',
            title: title,
            text: text,
            confirmButtonText: 'Entendido',
            ...options
        });
    },

    // Confirmation dialogs
    confirm: (title, text, options = {}) => {
        return Swal.fire({
            icon: 'question',
            title: title,
            text: text,
            showCancelButton: true,
            confirmButtonText: options.confirmText || 'Sí, continuar',
            cancelButtonText: options.cancelText || 'Cancelar',
            reverseButtons: true,
            ...options
        });
    },

    // Toast notifications
    toast: (icon, title, position = 'top-end') => {
        return Swal.fire({
            toast: true,
            position: position,
            icon: icon,
            title: title,
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true,
            didOpen: (toast) => {
                toast.addEventListener('mouseenter', Swal.stopTimer)
                toast.addEventListener('mouseleave', Swal.resumeTimer)
            }
        });
    },

    // Loading alert
    loading: (title = 'Procesando...') => {
        return Swal.fire({
            title: title,
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });
    },

    // Auto-closing success with custom HTML
    successWithDetails: (title, details, options = {}) => {
        return Swal.fire({
            icon: 'success',
            title: title,
            html: details,
            confirmButtonText: 'Excelente',
            timer: options.timer || null,
            ...options
        });
    }
};

class TherapeuticYogaApp {
    constructor() {
        this.currentUser = null;
        this.token = localStorage.getItem('token');
        this.therapyTypes = [];
        this.patients = [];
        this.series = [];
        this.currentPatient = null;
        this.currentSeries = null;
        this.currentSessionData = {};
        this.sessionTimer = null;
        this.timerPaused = false;
        this.remainingTime = 0;
        this.currentPostureIndex = 0;
        this.dashboardData = {};

        this.init();
    }

    async init() {
        await this.checkAuth();
        this.setupEventListeners();
        this.hideLoading();
    }

    hideLoading() {
        document.getElementById('loading').classList.add('hidden');
    }

    async checkAuth() {
        if (this.token) {
            try {
                const response = await this.fetchWithAuth('/api/therapy-types');
                if (response.ok) {
                    const userStr = localStorage.getItem('user');
                    if (userStr) {
                        this.currentUser = JSON.parse(userStr);
                        this.showDashboard();
                        return;
                    }
                }
            } catch (error) {
                console.error('Auth check failed:', error);
            }
        }
        this.showAuth();
    }

    showAuth() {
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('instructor-dashboard').classList.add('hidden');
        document.getElementById('patient-dashboard').classList.add('hidden');
    }

    showDashboard() {
        document.getElementById('auth-screen').classList.add('hidden');

        if (this.currentUser.role === 'instructor') {
            document.getElementById('instructor-dashboard').classList.remove('hidden');
            document.getElementById('user-name').textContent = this.currentUser.name;
            this.loadInstructorData();
        } else {
            document.getElementById('patient-dashboard').classList.remove('hidden');
            document.getElementById('patient-navbar-name').textContent = this.currentUser.name;
            this.loadPatientData();
        }
    }

    setupEventListeners() {
        // Auth tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');

                const tab = e.target.dataset.tab;
                document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
                document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
            });
        });

        // Auth forms
        document.getElementById('login-form').addEventListener('submit', this.handleLogin.bind(this));
        document.getElementById('register-form').addEventListener('submit', this.handleRegister.bind(this));

        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');

                const view = e.target.dataset.view;
                this.showView(view);
            });
        });

        // Logout
        document.getElementById('logout-btn')?.addEventListener('click', this.logout.bind(this));
        document.getElementById('patient-logout-btn')?.addEventListener('click', this.logout.bind(this));

        // Patient management
        document.getElementById('add-patient-btn')?.addEventListener('click', () => {
            this.showPatientModal();
        });

        document.getElementById('patient-form').addEventListener('submit', this.handlePatientForm.bind(this));

        // Series creation
        document.getElementById('create-series-form').addEventListener('submit', this.handleCreateSeries.bind(this));
        document.getElementById('therapy-type').addEventListener('change', this.loadPostures.bind(this));

        // Session management
        document.getElementById('start-session-btn')?.addEventListener('click', this.startSession.bind(this));
        document.getElementById('start-postures-btn')?.addEventListener('click', this.startPostures.bind(this));
        document.getElementById('next-posture-btn')?.addEventListener('click', this.nextPosture.bind(this));
        document.getElementById('pause-timer-btn')?.addEventListener('click', this.toggleTimer.bind(this));
        document.getElementById('complete-session-btn')?.addEventListener('click', this.completeSession.bind(this));

        // Pain scale updates
        document.getElementById('pain-before')?.addEventListener('input', (e) => {
            document.getElementById('pain-before-value').textContent = e.target.value;
        });
        document.getElementById('pain-after')?.addEventListener('input', (e) => {
            document.getElementById('pain-after-value').textContent = e.target.value;
        });

        // Modal controls
        document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
            btn.addEventListener('click', this.closeModals.bind(this));
        });

        document.getElementById('confirm-assign-btn')?.addEventListener('click', this.confirmAssignSeries.bind(this));

        // Dashboard controls
        document.getElementById('export-reports-btn')?.addEventListener('click', this.exportReports.bind(this));
        document.getElementById('refresh-dashboard-btn')?.addEventListener('click', this.refreshDashboard.bind(this));
    }

    async handleLogin(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const email = formData.get('email') || document.getElementById('login-email').value;
        const password = formData.get('password') || document.getElementById('login-password').value;

        // Show loading
        SweetAlerts.loading('Iniciando sesión...');

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();
            
            if (response.ok) {
                this.token = data.token;
                this.currentUser = data.user;
                localStorage.setItem('token', this.token);
                localStorage.setItem('user', JSON.stringify(this.currentUser));
                
                await SweetAlerts.success(
                    '¡Bienvenido!', 
                    `Inicio de sesión exitoso. Hola ${this.currentUser.name}`,
                    { timer: 2000 }
                );
                
                this.showDashboard();
            } else {
                await SweetAlerts.error(
                    'Error de autenticación',
                    data.error || 'Credenciales incorrectas. Por favor, verifica tu email y contraseña.'
                );
            }
        } catch (error) {
            await SweetAlerts.error(
                'Error de conexión',
                'No se pudo conectar con el servidor. Verifica tu conexión a internet.'
            );
        }
    }

    async handleRegister(e) {
        e.preventDefault();
        const name = document.getElementById('register-name').value;
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        const role = document.getElementById('register-role').value;

        // Show loading
        SweetAlerts.loading('Creando cuenta...');

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password, role })
            });

            const data = await response.json();
            
            if (response.ok) {
                await SweetAlerts.successWithDetails(
                    '¡Registro exitoso!',
                    `
                    <div style="text-align: left; margin: 1rem 0;">
                        <p><strong>🎉 Cuenta creada correctamente</strong></p>
                        <p>• Usuario: ${name}</p>
                        <p>• Email: ${email}</p>
                        <p>• Rol: ${role === 'instructor' ? 'Instructor' : 'Paciente'}</p>
                        <br>
                        <p style="color: #667eea;">Ahora puedes iniciar sesión con tus credenciales.</p>
                    </div>
                    `
                );
                
                document.getElementById('register-form').reset();
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelector('.tab-btn[data-tab="login"]').classList.add('active');
                document.getElementById('login-form').classList.remove('hidden');
                document.getElementById('register-form').classList.add('hidden');
                document.getElementById('login-email').value = email;
            } else {
                await SweetAlerts.error(
                    'Error en el registro',
                    data.error || 'No se pudo crear la cuenta. Intenta nuevamente.'
                );
            }
        } catch (error) {
            await SweetAlerts.error(
                'Error de conexión',
                'No se pudo conectar con el servidor. Verifica tu conexión a internet.'
            );
        }
    }

    async logout() {
        const result = await SweetAlerts.confirm(
            '¿Cerrar sesión?',
            '¿Estás seguro de que quieres cerrar sesión?',
            {
                confirmText: 'Sí, cerrar sesión',
                cancelText: 'Cancelar'
            }
        );

        if (result.isConfirmed) {
            this.token = null;
            this.currentUser = null;
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            
            if (this.sessionTimer) {
                clearInterval(this.sessionTimer);
            }
            
            this.showAuth();
            
            SweetAlerts.toast('success', 'Sesión cerrada correctamente');
        }
    }

    async fetchWithAuth(url, options = {}) {
        return fetch(url, {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            }
        });
    }

    showView(view) {
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        document.getElementById(`${view}-view`).classList.remove('hidden');

        if (view === 'patients') {
            this.loadPatients();
        } else if (view === 'series') {
            this.loadSeries();
        } else if (view === 'create-series') {
            this.loadTherapyTypes();
        } else if (view === 'dashboard') {
            this.loadDashboard();
        }
    }

    async loadInstructorData() {
        await this.loadTherapyTypes();
        await this.loadPatients();
        await this.loadSeries();
        await this.loadDashboard();
    }

    async loadTherapyTypes() {
        try {
            const response = await this.fetchWithAuth('/api/therapy-types');
            if (response.ok) {
                this.therapyTypes = await response.json();
            }
        } catch (error) {
            console.error('Error loading therapy types:', error);
        }
    }

    async loadPatients() {
        try {
            const response = await this.fetchWithAuth('/api/patients');
            if (response.ok) {
                this.patients = await response.json();
                this.renderPatients();
            }
        } catch (error) {
            console.error('Error loading patients:', error);
            SweetAlerts.error(
                'Error al cargar pacientes',
                'No se pudieron cargar los datos de los pacientes.'
            );
        }
    }

    async loadSeries() {
        try {
            const response = await this.fetchWithAuth('/api/therapy-series');
            if (response.ok) {
                this.series = await response.json();
                this.renderSeries();
            }
        } catch (error) {
            console.error('Error loading series:', error);
            SweetAlerts.error(
                'Error al cargar series',
                'No se pudieron cargar las series terapéuticas.'
            );
        }
    }

    async loadDashboard() {
        try {
            // Cargar estadísticas generales
            const [patientsResponse, seriesResponse] = await Promise.all([
                this.fetchWithAuth('/api/patients'),
                this.fetchWithAuth('/api/therapy-series')
            ]);

            if (patientsResponse.ok && seriesResponse.ok) {
                const patients = await patientsResponse.json();
                const series = await seriesResponse.json();

                // Calcular métricas
                this.dashboardData = this.calculateDashboardMetrics(patients, series);
                this.renderDashboard();
            }
        } catch (error) {
            console.error('Error loading dashboard:', error);
            SweetAlerts.error(
                'Error al cargar dashboard',
                'No se pudieron cargar las estadísticas del dashboard.'
            );
        }
    }

    calculateDashboardMetrics(patients, series) {
        const totalPatients = patients.length;
        const activePatients = patients.filter(p => p.assigned_series).length;
        const completedSessions = patients.reduce((sum, p) => sum + (p.current_session || 0), 0);
        const totalSeries = series.length;

        // Calcular progreso promedio
        const patientsWithSeries = patients.filter(p => p.assigned_series);
        const averageProgress = patientsWithSeries.length > 0
            ? patientsWithSeries.reduce((sum, p) => {
                const seriesData = JSON.parse(p.assigned_series);
                return sum + ((p.current_session || 0) / seriesData.total_sessions * 100);
            }, 0) / patientsWithSeries.length
            : 0;

        // Calcular distribución por tipo de terapia
        const therapyDistribution = {};
        series.forEach(s => {
            therapyDistribution[s.therapy_type] = (therapyDistribution[s.therapy_type] || 0) + 1;
        });

        return {
            totalPatients,
            activePatients,
            completedSessions,
            totalSeries,
            averageProgress: Math.round(averageProgress),
            therapyDistribution,
            patientsWithProgress: patientsWithSeries.map(p => {
                const seriesData = JSON.parse(p.assigned_series);
                return {
                    name: p.name,
                    progress: Math.round((p.current_session || 0) / seriesData.total_sessions * 100),
                    currentSession: p.current_session || 0,
                    totalSessions: seriesData.total_sessions,
                    therapyType: seriesData.therapy_type
                };
            })
        };
    }

    renderDashboard() {
        const container = document.getElementById('dashboard-content');
        if (!container) return;

        const { totalPatients, activePatients, completedSessions, totalSeries, averageProgress, therapyDistribution, patientsWithProgress } = this.dashboardData;

        container.innerHTML = `
            <div class="dashboard-grid">
                <div class="metric-card">
                    <div class="metric-icon">👥</div>
                    <div class="metric-content">
                        <h3>Total Pacientes</h3>
                        <div class="metric-value">${totalPatients}</div>
                        <div class="metric-subtitle">${activePatients} activos</div>
                    </div>
                </div>
                
                <div class="metric-card">
                    <div class="metric-icon">🧘‍♀️</div>
                    <div class="metric-content">
                        <h3>Series Creadas</h3>
                        <div class="metric-value">${totalSeries}</div>
                        <div class="metric-subtitle">Terapias disponibles</div>
                    </div>
                </div>
                
                <div class="metric-card">
                    <div class="metric-icon">📊</div>
                    <div class="metric-content">
                        <h3>Sesiones Completadas</h3>
                        <div class="metric-value">${completedSessions}</div>
                        <div class="metric-subtitle">Total acumulado</div>
                    </div>
                </div>
                
                <div class="metric-card">
                    <div class="metric-icon">📈</div>
                    <div class="metric-content">
                        <h3>Progreso Promedio</h3>
                        <div class="metric-value">${averageProgress}%</div>
                        <div class="metric-subtitle">Pacientes activos</div>
                    </div>
                </div>
            </div>

            <div class="dashboard-charts">
                <div class="chart-container">
                    <h3>Distribución por Tipo de Terapia</h3>
                    <div class="therapy-distribution">
                        ${Object.entries(therapyDistribution).map(([type, count]) => {
            const typeName = {
                'anxiety': 'Ansiedad',
                'arthritis': 'Artritis',
                'back_pain': 'Dolor de Espalda'
            }[type] || type;
            const percentage = Math.round((count / totalSeries) * 100);
            return `
                                <div class="therapy-item">
                                    <span class="therapy-label">${typeName}</span>
                                    <div class="therapy-bar">
                                        <div class="therapy-fill" style="width: ${percentage}%"></div>
                                    </div>
                                    <span class="therapy-count">${count}</span>
                                </div>
                            `;
        }).join('')}
                    </div>
                </div>

                <div class="chart-container">
                    <h3>Progreso de Pacientes Activos</h3>
                    <div class="patients-progress">
                        ${patientsWithProgress.map(patient => `
                            <div class="patient-progress-item">
                                <div class="patient-info">
                                    <span class="patient-name">${patient.name}</span>
                                    <span class="patient-sessions">${patient.currentSession}/${patient.totalSessions} sesiones</span>
                                </div>
                                <div class="progress-bar">
                                    <div class="progress-fill" style="width: ${patient.progress}%"></div>
                                </div>
                                <span class="progress-percentage">${patient.progress}%</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>

            <div class="dashboard-actions">
                <button id="refresh-dashboard-btn" class="btn-secondary">🔄 Actualizar</button>
                <button id="export-reports-btn" class="btn-primary">📊 Exportar Reportes</button>
            </div>
        `;

        // Re-bind event listeners for dashboard buttons
        document.getElementById('refresh-dashboard-btn')?.addEventListener('click', this.refreshDashboard.bind(this));
        document.getElementById('export-reports-btn')?.addEventListener('click', this.exportReports.bind(this));
    }

    async refreshDashboard() {
        SweetAlerts.loading('Actualizando dashboard...');
        await this.loadDashboard();
        SweetAlerts.toast('success', '📊 Dashboard actualizado correctamente');
    }

    async exportReports() {
        try {
            const reportData = {
                generatedAt: new Date().toISOString(),
                instructor: this.currentUser.name,
                metrics: this.dashboardData
            };

            const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `reporte-yoga-terapeutico-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            SweetAlerts.toast('success', '📋 Reporte exportado exitosamente');
        } catch (error) {
            SweetAlerts.error(
                'Error al exportar',
                'No se pudo generar el reporte. Intenta nuevamente.'
            );
        }
    }

    renderPatients() {
        const container = document.getElementById('patients-list');
        container.innerHTML = '';

        if (this.patients.length === 0) {
            container.innerHTML = '<p style="color: white; text-align: center;">No hay pacientes registrados aún.</p>';
            return;
        }

        this.patients.forEach(patient => {
            const hasSeries = patient.assigned_series && typeof patient.assigned_series === 'string';
            const seriesData = hasSeries ? JSON.parse(patient.assigned_series) : null;
            const progressPercentage = seriesData
                ? Math.round(((patient.current_session || 0) / seriesData.total_sessions) * 100)
                : 0;

            const card = document.createElement('div');
            card.className = 'card patient-card';
            card.innerHTML = `
                <div class="card-header">
                    <div>
                        <div class="card-title">👤 ${patient.name}</div>
                        <p>📧 ${patient.email}</p>
                        <p>🎂 Edad: ${patient.age} años</p>
                        ${patient.condition ? `<p><strong>🏥 Condición:</strong> ${patient.condition}</p>` : ''}
                    </div>
                </div>
                ${seriesData ? `
                    <div class="series-status assigned">
                        <div class="series-info">
                            <strong>✅ Serie asignada:</strong> ${seriesData.name}
                            <div class="series-details">
                                <span>Tipo: ${this.getTherapyTypeName(seriesData.therapy_type)}</span>
                                <span>Progreso: ${patient.current_session || 0}/${seriesData.total_sessions} sesiones</span>
                            </div>
                        </div>
                        <div class="progress-container">
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${progressPercentage}%"></div>
                            </div>
                            <span class="progress-text">${progressPercentage}%</span>
                        </div>
                    </div>
                ` : `
                    <div class="series-status unassigned">
                        <strong>⚠️ Sin serie asignada</strong>
                        <p>Este paciente necesita una serie terapéutica</p>
                    </div>
                `}
                <div class="card-actions">
                    <button class="btn-primary btn-small" onclick="app.editPatient(${patient.id})">✏️ Editar</button>
                    <button class="btn-secondary btn-small" onclick="app.assignSeries(${patient.id})">📋 Asignar Serie</button>
                    <button class="btn-secondary btn-small" onclick="app.viewPatientSessions(${patient.id})">📊 Ver Sesiones</button>
                    <button class="btn-secondary btn-small" onclick="app.viewPatientDetails(${patient.id})">👁️ Detalles</button>
                    <button class="btn-secondary btn-small" onclick="app.deletePatient(${patient.id})" style="background: #dc3545;">🗑️ Eliminar</button>
                </div>
            `;
            container.appendChild(card);
        });
    }

    getTherapyTypeName(type) {
        return {
            'anxiety': 'Ansiedad',
            'arthritis': 'Artritis',
            'back_pain': 'Dolor de Espalda'
        }[type] || type;
    }

    async viewPatientDetails(patientId) {
        const patient = this.patients.find(p => p.id === patientId);
        if (!patient) return;

        try {
            const sessionsResponse = await this.fetchWithAuth(`/api/patients/${patientId}/sessions`);
            const sessions = sessionsResponse.ok ? await sessionsResponse.json() : [];

            this.renderPatientDetailsModal(patient, sessions);
            document.getElementById('patient-details-modal').classList.remove('hidden');
        } catch (error) {
            console.error('Error loading patient details:', error);
            SweetAlerts.error(
                'Error al cargar detalles',
                'No se pudieron cargar los detalles del paciente.'
            );
        }
    }

    renderPatientDetailsModal(patient, sessions) {
        const hasSeries = patient.assigned_series && typeof patient.assigned_series === 'string';
        const seriesData = hasSeries ? JSON.parse(patient.assigned_series) : null;

        // Calcular estadísticas de dolor
        const painStats = this.calculatePainStats(sessions);

        const modalContent = document.getElementById('patient-details-content');
        modalContent.innerHTML = `
            <div class="patient-details-header">
                <h3>👤 ${patient.name}</h3>
                <div class="patient-basic-info">
                    <p><strong>📧 Email:</strong> ${patient.email}</p>
                    <p><strong>🎂 Edad:</strong> ${patient.age} años</p>
                    <p><strong>📅 Registrado:</strong> ${new Date(patient.created_at).toLocaleDateString()}</p>
                    ${patient.condition ? `<p><strong>🏥 Condición:</strong> ${patient.condition}</p>` : ''}
                </div>
            </div>

            <div class="patient-series-details">
                ${seriesData ? `
                    <h4>🧘‍♀️ Serie Actual</h4>
                    <div class="current-series">
                        <div class="series-summary">
                            <p><strong>Nombre:</strong> ${seriesData.name}</p>
                            <p><strong>Tipo:</strong> ${this.getTherapyTypeName(seriesData.therapy_type)}</p>
                            <p><strong>Posturas:</strong> ${seriesData.postures.length}</p>
                            <p><strong>Progreso:</strong> ${patient.current_session || 0}/${seriesData.total_sessions} sesiones</p>
                        </div>
                        <div class="series-progress-visual">
                            <div class="progress-circle">
                                <span>${Math.round(((patient.current_session || 0) / seriesData.total_sessions) * 100)}%</span>
                            </div>
                        </div>
                    </div>
                ` : `
                    <div class="no-series">
                        <p>⚠️ Este paciente no tiene una serie asignada</p>
                        <button class="btn-primary" onclick="app.assignSeries(${patient.id})">Asignar Serie</button>
                    </div>
                `}
            </div>

            <div class="patient-stats">
                <h4>📊 Estadísticas de Sesiones</h4>
                ${sessions.length > 0 ? `
                    <div class="stats-grid">
                        <div class="stat-item">
                            <span class="stat-label">Total Sesiones</span>
                            <span class="stat-value">${sessions.length}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Dolor Inicial Promedio</span>
                            <span class="stat-value">${painStats.avgBefore}/10</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Dolor Final Promedio</span>
                            <span class="stat-value">${painStats.avgAfter}/10</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Mejora Promedio</span>
                            <span class="stat-value ${painStats.avgImprovement >= 0 ? 'positive' : 'negative'}">
                                ${painStats.avgImprovement >= 0 ? '-' : '+'}${Math.abs(painStats.avgImprovement)}
                            </span>
                        </div>
                    </div>
                ` : `
                    <p style="text-align: center; color: #666;">No hay sesiones registradas aún</p>
                `}
            </div>
        `;
    }

    calculatePainStats(sessions) {
        if (sessions.length === 0) {
            return { avgBefore: 0, avgAfter: 0, avgImprovement: 0 };
        }

        const avgBefore = sessions.reduce((sum, s) => sum + s.pain_before, 0) / sessions.length;
        const avgAfter = sessions.reduce((sum, s) => sum + s.pain_after, 0) / sessions.length;
        const avgImprovement = avgBefore - avgAfter;

        return {
            avgBefore: Math.round(avgBefore * 10) / 10,
            avgAfter: Math.round(avgAfter * 10) / 10,
            avgImprovement: Math.round(avgImprovement * 10) / 10
        };
    }

    renderSeries() {
        const container = document.getElementById('series-list');
        container.innerHTML = '';

        if (this.series.length === 0) {
            container.innerHTML = '<p style="color: white; text-align: center;">No hay series creadas aún.</p>';
            return;
        }

        this.series.forEach(series => {
            const therapyTypeName = this.getTherapyTypeName(series.therapy_type);
            const assignedCount = this.patients.filter(p => {
                if (!p.assigned_series) return false;
                const patientSeries = JSON.parse(p.assigned_series);
                return patientSeries.id === series.id;
            }).length;

            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <div class="card-header">
                    <div>
                        <div class="card-title">🧘‍♀️ ${series.name}</div>
                        <p><strong>🎯 Tipo:</strong> ${therapyTypeName}</p>
                        <p><strong>🤸‍♀️ Posturas:</strong> ${series.postures.length}</p>
                        <p><strong>📅 Sesiones totales:</strong> ${series.total_sessions}</p>
                        <p><strong>👥 Pacientes asignados:</strong> ${assignedCount}</p>
                        <p><small>📅 Creada: ${new Date(series.created_at).toLocaleDateString()}</small></p>
                    </div>
                </div>
                <div style="margin-top: 1rem;">
                    <h4>Posturas incluidas:</h4>
                    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem;">
                        ${series.postures.map(posture =>
                `<span style="background: #f0f0f0; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.875rem;">
                                ${posture.name} (${posture.duration}min)
                            </span>`
            ).join('')}
                    </div>
                </div>
                <div class="card-actions" style="margin-top: 1rem;">
                    <button class="btn-secondary btn-small" onclick="app.viewSeriesDetails(${series.id})">👁️ Ver Detalles</button>
                    <button class="btn-secondary btn-small" onclick="app.duplicateSeries(${series.id})">📋 Duplicar</button>
                </div>
            `;
            container.appendChild(card);
        });
    }

    showPatientModal(patient = null) {
        this.currentPatient = patient;
        const modal = document.getElementById('patient-modal');
        const form = document.getElementById('patient-form');
        const title = document.getElementById('patient-modal-title');

        if (patient) {
            title.textContent = 'Editar Paciente';
            document.getElementById('patient-name').value = patient.name;
            document.getElementById('patient-email').value = patient.email;
            document.getElementById('patient-age').value = patient.age;
            document.getElementById('patient-condition').value = patient.condition || '';
        } else {
            title.textContent = 'Agregar Paciente';
            form.reset();
        }

        modal.classList.remove('hidden');
    }

    async handlePatientForm(e) {
        e.preventDefault();

        const nameField = document.getElementById('patient-name');
        const emailField = document.getElementById('patient-email');
        const ageField = document.getElementById('patient-age');
        const conditionField = document.getElementById('patient-condition');

        if (!nameField || !emailField || !ageField || !conditionField) {
            SweetAlerts.error(
                'Error interno',
                'No se pudieron encontrar todos los campos del formulario.'
            );
            return;
        }

        const name = nameField.value.trim();
        const email = emailField.value.trim();
        const age = parseInt(ageField.value);
        const condition = conditionField.value.trim();

        // Validaciones
        if (!name || !email || !age) {
            SweetAlerts.warning(
                'Campos obligatorios',
                'Por favor, completa todos los campos obligatorios: nombre, email y edad.'
            );
            return;
        }

        if (age < 1 || age > 120) {
            SweetAlerts.warning(
                'Edad inválida',
                'La edad debe estar entre 1 y 120 años.'
            );
            return;
        }

        SweetAlerts.loading(this.currentPatient ? 'Actualizando paciente...' : 'Creando paciente...');

        try {
            let response;
            if (this.currentPatient) {
                response = await this.fetchWithAuth(`/api/patients/${this.currentPatient.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ name, email, age, condition })
                });
            } else {
                response = await this.fetchWithAuth('/api/patients', {
                    method: 'POST',
                    body: JSON.stringify({ name, email, age, condition })
                });
            }

            if (response.ok) {
                this.closeModals();
                await this.loadPatients();
                await this.loadDashboard();
                
                const action = this.currentPatient ? 'actualizado' : 'creado';
                SweetAlerts.successWithDetails(
                    `¡Paciente ${action}!`,
                    `
                    <div style="text-align: left; margin: 1rem 0;">
                        <p><strong>👤 ${name}</strong></p>
                        <p>• Email: ${email}</p>
                        <p>• Edad: ${age} años</p>
                        ${condition ? `<p>• Condición: ${condition}</p>` : ''}
                    </div>
                    `,
                    { timer: 3000 }
                );
            } else {
                const data = await response.json();
                SweetAlerts.error(
                    'Error al guardar',
                    data.error || 'No se pudo guardar el paciente. Intenta nuevamente.'
                );
            }
        } catch (error) {
            SweetAlerts.error(
                'Error de conexión',
                'No se pudo conectar con el servidor. Verifica tu conexión a internet.'
            );
        }
    }

    editPatient(patientId) {
        const patient = this.patients.find(p => p.id === patientId);
        if (patient) {
            this.showPatientModal(patient);
        }
    }

    async deletePatient(patientId) {
        const patient = this.patients.find(p => p.id === patientId);
        if (!patient) return;

        const result = await SweetAlerts.confirm(
            '¿Eliminar paciente?',
            `¿Estás seguro de que quieres eliminar a ${patient.name}? Esta acción no se puede deshacer.`,
            {
                confirmText: 'Sí, eliminar',
                cancelText: 'Cancelar',
                icon: 'warning'
            }
        );

        if (result.isConfirmed) {
            SweetAlerts.loading('Eliminando paciente...');
            
            try {
                const response = await this.fetchWithAuth(`/api/patients/${patientId}`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    await this.loadPatients();
                    await this.loadDashboard();
                    
                    SweetAlerts.toast('success', `🗑️ Paciente ${patient.name} eliminado exitosamente`);
                } else {
                    const data = await response.json();
                    SweetAlerts.error(
                        'Error al eliminar',
                        data.error || 'No se pudo eliminar el paciente. Intenta nuevamente.'
                    );
                }
            } catch (error) {
                SweetAlerts.error(
                    'Error de conexión',
                    'No se pudo conectar con el servidor. Verifica tu conexión a internet.'
                );
            }
        }
    }

    async assignSeries(patientId) {
        this.currentPatient = this.patients.find(p => p.id === patientId);

        // Asegurar que las series estén cargadas
        if (this.series.length === 0) {
            await this.loadSeries();
        }

        const modal = document.getElementById('assign-series-modal');
        const select = document.getElementById('series-select');

        select.innerHTML = '<option value="">Seleccionar serie</option>';

        if (this.series.length === 0) {
            select.innerHTML = '<option value="">No hay series disponibles</option>';
            select.disabled = true;
            
            SweetAlerts.warning(
                'No hay series disponibles',
                'Primero debes crear al menos una serie terapéutica antes de asignarla a un paciente.'
            );
            return;
        } else {
            select.disabled = false;
            this.series.forEach(series => {
                const therapyTypeName = this.getTherapyTypeName(series.therapy_type);
                const option = document.createElement('option');
                option.value = series.id;
                option.textContent = `${series.name} (${therapyTypeName}) - ${series.postures.length} posturas`;
                select.appendChild(option);
            });
        }

        const hasSeries = this.currentPatient.assigned_series && typeof this.currentPatient.assigned_series === 'string';
        if (hasSeries) {
            const seriesData = JSON.parse(this.currentPatient.assigned_series);
            const result = await SweetAlerts.confirm(
                'Reemplazar serie existente',
                `${this.currentPatient.name} ya tiene asignada la serie "${seriesData.name}". ¿Deseas reemplazarla con una nueva serie?`,
                {
                    confirmText: 'Sí, reemplazar',
                    cancelText: 'Cancelar',
                    icon: 'question'
                }
            );
            if (!result.isConfirmed) return;
        }

        modal.classList.remove('hidden');
    }

    async confirmAssignSeries() {
        const seriesId = parseInt(document.getElementById('series-select').value);
        if (!seriesId) {
            SweetAlerts.warning(
                'Serie requerida',
                'Por favor, selecciona una serie antes de continuar.'
            );
            return;
        }

        if (!this.currentPatient) return;

        const selectedSeries = this.series.find(s => s.id === seriesId);
        
        SweetAlerts.loading('Asignando serie...');

        try {
            const response = await this.fetchWithAuth(`/api/patients/${this.currentPatient.id}/assign-series`, {
                method: 'POST',
                body: JSON.stringify({ seriesId })
            });

            if (response.ok) {
                this.closeModals();
                await this.loadPatients();
                await this.loadDashboard();
                
                SweetAlerts.successWithDetails(
                    '¡Serie asignada!',
                    `
                    <div style="text-align: left; margin: 1rem 0;">
                        <p><strong>👤 Paciente:</strong> ${this.currentPatient.name}</p>
                        <p><strong>🧘‍♀️ Serie:</strong> ${selectedSeries.name}</p>
                        <p><strong>🎯 Tipo:</strong> ${this.getTherapyTypeName(selectedSeries.therapy_type)}</p>
                        <p><strong>🤸‍♀️ Posturas:</strong> ${selectedSeries.postures.length}</p>
                        <p><strong>📅 Sesiones:</strong> ${selectedSeries.total_sessions}</p>
                    </div>
                    `,
                    { timer: 4000 }
                );
            } else {
                const data = await response.json();
                SweetAlerts.error(
                    'Error al asignar serie',
                    data.error || 'No se pudo asignar la serie. Intenta nuevamente.'
                );
            }
        } catch (error) {
            SweetAlerts.error(
                'Error de conexión',
                'No se pudo conectar con el servidor. Verifica tu conexión a internet.'
            );
        }
    }

    async viewPatientSessions(patientId) {
        try {
            const response = await this.fetchWithAuth(`/api/patients/${patientId}/sessions`);
            if (response.ok) {
                const sessions = await response.json();
                this.renderPatientSessions(sessions);
                document.getElementById('patient-sessions-modal').classList.remove('hidden');
            }
        } catch (error) {
            console.error('Error loading patient sessions:', error);
            SweetAlerts.error(
                'Error al cargar sesiones',
                'No se pudieron cargar las sesiones del paciente.'
            );
        }
    }

    renderPatientSessions(sessions) {
        const container = document.getElementById('sessions-list');
        container.innerHTML = '';

        if (sessions.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #666;">📋 No hay sesiones registradas para este paciente.</p>';
            return;
        }

        sessions.forEach(session => {
            const painImprovement = session.pain_before - session.pain_after;
            const improvementIcon = painImprovement > 0 ? '📈' : painImprovement < 0 ? '📉' : '➖';

            const sessionDiv = document.createElement('div');
            sessionDiv.className = 'session-item';
            sessionDiv.innerHTML = `
                <div class="session-header-info">
                    <strong>🧘‍♀️ Sesión ${session.session_number}</strong>
                    <span>📅 ${new Date(session.completed_at).toLocaleDateString()}</span>
                </div>
                <div class="pain-indicators">
                    <span class="pain-indicator pain-before">😣 Dolor antes: ${session.pain_before}/10</span>
                    <span class="pain-indicator pain-after">😌 Dolor después: ${session.pain_after}/10</span>
                    <span style="padding: 0.25rem 0.75rem; background: #e3f2fd; color: #1976d2; border-radius: 15px; font-size: 0.875rem;">
                        ${improvementIcon} Cambio: ${painImprovement > 0 ? '-' : '+'}${Math.abs(painImprovement)}
                    </span>
                </div>
                <div style="margin-top: 0.5rem;">
                    <strong>💭 Comentarios:</strong> 
                    <p style="margin-top: 0.25rem; font-style: italic;">"${session.comments}"</p>
                </div>
            `;
            container.appendChild(sessionDiv);
        });
    }

    loadPostures() {
        const therapyType = document.getElementById('therapy-type').value;
        const posturesSection = document.getElementById('postures-section');

        if (!therapyType) {
            posturesSection.classList.add('hidden');
            return;
        }

        const type = this.therapyTypes.find(t => t.id === therapyType);
        if (!type) return;

        posturesSection.classList.remove('hidden');
        const container = document.getElementById('available-postures');
        container.innerHTML = '';

        type.postures.forEach(posture => {
            const card = document.createElement('div');
            card.className = 'posture-card';
            card.dataset.postureId = posture.id;
            card.innerHTML = `
                <div class="card-content">
                    <h4>${posture.name}</h4>
                    <div class="contenedor-img">
                        <img src="${posture.image}" alt="${posture.name}" loading="lazy">
                    </div>
                    <p class="sanskrit">${posture.sanskrit}</p>
                    <button type="button" class="btn-secondary btn-small" onclick="app.showPostureDetail(${posture.id}, '${therapyType}')" style="margin-top: 0.5rem;">
                        🎥 Ver Video
                    </button>
                </div>
            `;
            card.addEventListener('click', (e) => {
                if (e.target.tagName !== 'BUTTON') {
                    this.togglePostureSelection(card, posture);
                }
            });
            container.appendChild(card);
        });
    }

    showPostureDetail(postureId, therapyType) {
        const type = this.therapyTypes.find(t => t.id === therapyType);
        const posture = type.postures.find(p => p.id === postureId);

        if (!posture) return;

        document.getElementById('modal-posture-name').textContent = posture.name;
        document.getElementById('modal-posture-sanskrit').textContent = posture.sanskrit;
        document.getElementById('modal-posture-instructions').textContent = posture.instructions;
        document.getElementById('modal-posture-benefits').textContent = posture.benefits;
        document.getElementById('modal-posture-modifications').textContent = posture.modifications;

        const videoFrame = document.getElementById('modal-posture-video');
        if (posture.videoUrl) {
            const videoId = this.extractYouTubeVideoId(posture.videoUrl);
            if (videoId) {
                videoFrame.src = `https://www.youtube.com/embed/${videoId}`;
            }
        }

        document.getElementById('posture-detail-modal').classList.remove('hidden');
    }

    extractYouTubeVideoId(url) {
        const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }

    togglePostureSelection(card, posture) {
        card.classList.toggle('selected');
        this.updateSelectedPostures();
    }

    updateSelectedPostures() {
        const selectedCards = document.querySelectorAll('.posture-card.selected');
        const container = document.getElementById('selected-postures');
        container.innerHTML = '';

        if (selectedCards.length === 0) {
            container.innerHTML = '<p>Selecciona posturas de la lista anterior</p>';
            return;
        }

        selectedCards.forEach((card, index) => {
            const postureId = parseInt(card.dataset.postureId);
            const therapyType = document.getElementById('therapy-type').value;
            const type = this.therapyTypes.find(t => t.id === therapyType);
            const posture = type.postures.find(p => p.id === postureId);

            const div = document.createElement('div');
            div.className = 'selected-posture';
            div.innerHTML = `
                <span>${index + 1}. ${posture.name}</span>
                <div class="posture-duration">
                    <label>Duración:</label>
                    <input type="number" min="1" max="60" value="5" data-posture-id="${postureId}"> min
                </div>
            `;
            container.appendChild(div);
        });
    }

    async handleCreateSeries(e) {
        e.preventDefault();
        const name = document.getElementById('series-name').value;
        const therapyType = document.getElementById('therapy-type').value;
        const totalSessions = parseInt(document.getElementById('total-sessions').value);

        const selectedCards = document.querySelectorAll('.posture-card.selected');
        const postures = [];

        // Validaciones
        if (!name.trim()) {
            SweetAlerts.warning(
                'Nombre requerido',
                'Por favor, ingresa un nombre para la serie.'
            );
            return;
        }

        if (!therapyType) {
            SweetAlerts.warning(
                'Tipo de terapia requerido',
                'Por favor, selecciona un tipo de terapia.'
            );
            return;
        }

        if (selectedCards.length === 0) {
            SweetAlerts.warning(
                'Posturas requeridas',
                'Debes seleccionar al menos una postura para la serie.'
            );
            return;
        }

        selectedCards.forEach(card => {
            const postureId = parseInt(card.dataset.postureId);
            const durationInput = document.querySelector(`input[data-posture-id="${postureId}"]`);
            const duration = parseInt(durationInput.value);

            const type = this.therapyTypes.find(t => t.id === therapyType);
            const posture = type.postures.find(p => p.id === postureId);

            postures.push({
                ...posture,
                duration
            });
        });

        SweetAlerts.loading('Creando serie...');

        try {
            const response = await this.fetchWithAuth('/api/therapy-series', {
                method: 'POST',
                body: JSON.stringify({ name, therapyType, postures, totalSessions })
            });

            if (response.ok) {
                document.getElementById('create-series-form').reset();
                document.getElementById('postures-section').classList.add('hidden');
                await this.loadSeries();
                await this.loadDashboard();
                
                SweetAlerts.successWithDetails(
                    '¡Serie creada exitosamente!',
                    `
                    <div style="text-align: left; margin: 1rem 0;">
                        <p><strong>🧘‍♀️ ${name}</strong></p>
                        <p>• Tipo: ${this.getTherapyTypeName(therapyType)}</p>
                        <p>• Posturas: ${postures.length}</p>
                        <p>• Sesiones totales: ${totalSessions}</p>
                        <br>
                        <p style="color: #667eea;">Ya puedes asignar esta serie a tus pacientes.</p>
                    </div>
                    `,
                    { timer: 4000 }
                );
            } else {
                const data = await response.json();
                SweetAlerts.error(
                    'Error al crear serie',
                    data.error || 'No se pudo crear la serie. Intenta nuevamente.'
                );
            }
        } catch (error) {
            SweetAlerts.error(
                'Error de conexión',
                'No se pudo conectar con el servidor. Verifica tu conexión a internet.'
            );
        }
    }

    // Patient methods
    async loadPatientData() {
        try {
            const response = await this.fetchWithAuth('/api/my-series');
            if (response.ok) {
                const data = await response.json();
                this.renderPatientSeries(data);
            } else {
                document.getElementById('series-details').innerHTML = '<p>🔍 No tienes una serie asignada aún. Consulta con tu instructor.</p>';
                document.getElementById('start-session-btn').style.display = 'none';
            }
        } catch (error) {
            console.error('Error loading patient data:', error);
            SweetAlerts.error(
                'Error al cargar datos',
                'No se pudieron cargar los datos de tu serie asignada.'
            );
        }
    }

    renderPatientSeries(data) {
        const container = document.getElementById('series-details');
        const { series, currentSession } = data;

        const progressPercentage = Math.round((currentSession / series.total_sessions) * 100);
        const therapyTypeName = this.getTherapyTypeName(series.therapy_type);
        const isCompleted = currentSession >= series.total_sessions;

        container.innerHTML = `
            <div class="series-card">
                <h3>🧘‍♀️ ${series.name}</h3>
                <p><strong>🎯 Tipo de terapia:</strong> ${therapyTypeName}</p>
                <p><strong>🤸‍♀️ Posturas:</strong> ${series.postures.length}</p>
                <div style="margin: 1rem 0;">
                    <p><strong>📊 Progreso:</strong> ${currentSession}/${series.total_sessions} sesiones (${progressPercentage}%)</p>
                    <div style="background: #f0f0f0; border-radius: 10px; overflow: hidden; height: 20px;">
                        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); height: 100%; width: ${progressPercentage}%; transition: width 0.3s ease;"></div>
                    </div>
                </div>
                ${!isCompleted ? `
                    <p>🎯 Próxima sesión: ${currentSession + 1}</p>
                    <div style="margin-top: 1rem;">
                        <h4>📝 Posturas de tu próxima sesión:</h4>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-top: 1rem;">
                            ${series.postures.map(posture => `
                                <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px; text-align: center;">
                                    <img src="${posture.image}" alt="${posture.name}" style="width: 100%; height: 120px; object-fit: cover; border-radius: 6px; margin-bottom: 0.5rem;">
                                    <h5>${posture.name}</h5>
                                    <p style="font-size: 0.875rem; color: #666;">${posture.duration} minutos</p>
                                    ${posture.videoUrl ? `<a href="${posture.videoUrl}" target="_blank" style="color: #667eea; text-decoration: none; font-size: 0.875rem;">🎥 Ver video</a>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : `
                    <div style="background: #e8f5e8; padding: 1rem; border-radius: 8px; text-align: center; margin-top: 1rem;">
                        <h4 style="color: #2e7d32;">🎉 ¡Serie Completada!</h4>
                        <p>¡Felicitaciones! Has completado toda tu serie de yoga terapéutico.</p>
                        <p>Contacta a tu instructor para obtener una nueva serie.</p>
                    </div>
                `}
            </div>
        `;

        this.currentSeries = series;
        document.getElementById('start-session-btn').style.display = isCompleted ? 'none' : 'block';
    }

    async startSession() {
        const result = await SweetAlerts.confirm(
            '¿Iniciar sesión de yoga?',
            '¿Estás listo para comenzar tu sesión de yoga terapéutico? Asegúrate de estar en un lugar tranquilo.',
            {
                confirmText: 'Sí, comenzar',
                cancelText: 'Ahora no',
                icon: 'question'
            }
        );

        if (result.isConfirmed) {
            document.getElementById('patient-home').classList.add('hidden');
            document.getElementById('session-view').classList.remove('hidden');
            document.getElementById('pre-session').classList.remove('hidden');
            document.getElementById('posture-display').classList.add('hidden');
            document.getElementById('post-session').classList.add('hidden');
            
            SweetAlerts.toast('info', '🧘‍♀️ ¡Sesión iniciada! Prepárate para comenzar');
        }
    }

    async startPostures() {
        this.currentSessionData.painBefore = parseInt(document.getElementById('pain-before').value);
        this.currentPostureIndex = 0;
        this.timerPaused = false;

        document.getElementById('pre-session').classList.add('hidden');
        document.getElementById('posture-display').classList.remove('hidden');

        document.getElementById('total-postures').textContent = this.currentSeries.postures.length;
        this.showCurrentPosture();
        
        SweetAlerts.toast('success', '🚀 ¡Comenzando con las posturas!');
    }

    showCurrentPosture() {
        const posture = this.currentSeries.postures[this.currentPostureIndex];

        document.getElementById('current-posture').textContent = this.currentPostureIndex + 1;
        document.getElementById('posture-name').textContent = posture.name;
        document.getElementById('posture-sanskrit').textContent = posture.sanskrit ? `(${posture.sanskrit})` : '';
        document.getElementById('posture-instructions').textContent = posture.instructions;
        document.getElementById('posture-benefits').textContent = posture.benefits;
        document.getElementById('posture-modifications').textContent = posture.modifications;

        const videoFrame = document.getElementById('posture-video');
        if (posture.videoUrl) {
            const videoId = this.extractYouTubeVideoId(posture.videoUrl);
            if (videoId) {
                videoFrame.src = `https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0`;
            }
        }

        const pauseBtn = document.getElementById('pause-timer-btn');
        const nextBtn = document.getElementById('next-posture-btn');

        pauseBtn.style.display = 'inline-block';
        pauseBtn.textContent = '⏸️ Pausar';
        nextBtn.textContent = this.currentPostureIndex === this.currentSeries.postures.length - 1 ?
            'Finalizar Posturas ➡️' : 'Siguiente Postura ➡️';
        nextBtn.disabled = true;

        this.startPostureTimer(posture.duration);
    }

    startPostureTimer(durationMinutes) {
        this.remainingTime = durationMinutes * 60;
        this.timerPaused = false;

        const pauseBtn = document.getElementById('pause-timer-btn');
        const nextBtn = document.getElementById('next-posture-btn');

        pauseBtn.textContent = '⏸️ Pausar';
        nextBtn.disabled = false;

        const updateTimer = () => {
            if (!this.timerPaused && this.remainingTime > 0) {
                this.remainingTime--;
            }

            const minutes = Math.floor(this.remainingTime / 60);
            const seconds = this.remainingTime % 60;

            document.getElementById('timer-minutes').textContent = minutes.toString().padStart(2, '0');
            document.getElementById('timer-seconds').textContent = seconds.toString().padStart(2, '0');

            if (this.remainingTime <= 0) {
                clearInterval(this.sessionTimer);
                const isLastPosture = this.currentPostureIndex === this.currentSeries.postures.length - 1;
                nextBtn.textContent = isLastPosture ?
                    '✅ Completar Sesión' : '✅ Tiempo completado - Siguiente';
                nextBtn.style.background = '#28a745';
                pauseBtn.style.display = 'none';

                this.playCompletionSound();
                SweetAlerts.toast('success', '⏰ ¡Tiempo completado para esta postura!');
            }
        };

        updateTimer();
        this.sessionTimer = setInterval(updateTimer, 1000);
    }

    toggleTimer() {
        this.timerPaused = !this.timerPaused;
        const pauseBtn = document.getElementById('pause-timer-btn');

        if (this.timerPaused) {
            pauseBtn.textContent = '▶️ Reanudar';
            SweetAlerts.toast('info', '⏸️ Temporizador pausado');
        } else {
            pauseBtn.textContent = '⏸️ Pausar';
            SweetAlerts.toast('info', '▶️ Temporizador reanudado');
        }
    }

    playCompletionSound() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(1000, audioContext.currentTime + 0.1);

            gainNode.gain.setValueAtTime(0, audioContext.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.1);
            gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.3);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
        } catch (error) {
            console.log('No se pudo reproducir el sonido de completado');
        }
    }

    nextPosture() {
        if (this.sessionTimer) {
            clearInterval(this.sessionTimer);
        }

        this.currentPostureIndex++;

        if (this.currentPostureIndex >= this.currentSeries.postures.length) {
            document.getElementById('posture-display').classList.add('hidden');
            document.getElementById('post-session').classList.remove('hidden');
            SweetAlerts.toast('success', '🎉 ¡Todas las posturas completadas!');
        } else {
            this.showCurrentPosture();
            SweetAlerts.toast('info', `➡️ Postura ${this.currentPostureIndex + 1} de ${this.currentSeries.postures.length}`);
        }
    }

    async completeSession() {
        const painAfter = parseInt(document.getElementById('pain-after').value);
        const comments = document.getElementById('session-comments').value;

        if (!comments.trim()) {
            SweetAlerts.warning(
                'Comentario requerido',
                'Por favor, escribe un comentario sobre tu experiencia en la sesión.'
            );
            return;
        }

        if (comments.trim().length < 10) {
            SweetAlerts.warning(
                'Comentario muy corto',
                'Por favor, describe tu experiencia con al menos 10 caracteres.'
            );
            return;
        }

        SweetAlerts.loading('Completando sesión...');

        try {
            const response = await this.fetchWithAuth('/api/sessions', {
                method: 'POST',
                body: JSON.stringify({
                    painBefore: this.currentSessionData.painBefore,
                    painAfter,
                    comments
                })
            });

            if (response.ok) {
                const painImprovement = this.currentSessionData.painBefore - painAfter;
                let improvementMessage = '';
                let improvementIcon = '';

                if (painImprovement > 0) {
                    improvementMessage = `¡Excelente! Tu nivel de dolor se redujo en ${painImprovement} puntos.`;
                    improvementIcon = '📉✨';
                } else if (painImprovement < 0) {
                    improvementMessage = `Aunque el dolor aumentó ligeramente, seguir practicando traerá beneficios.`;
                    improvementIcon = '💪🔄';
                } else {
                    improvementMessage = `Mantuviste tu nivel de dolor estable. ¡Sigue así!`;
                    improvementIcon = '🎯⚖️';
                }

                await SweetAlerts.successWithDetails(
                    '🎉 ¡Sesión completada!',
                    `
                    <div style="text-align: left; margin: 1rem 0;">
                        <p><strong>${improvementIcon} Resultado:</strong></p>
                        <p>${improvementMessage}</p>
                        <br>
                        <p><strong>📊 Resumen:</strong></p>
                        <p>• Dolor antes: ${this.currentSessionData.painBefore}/10</p>
                        <p>• Dolor después: ${painAfter}/10</p>
                        <p>• Posturas completadas: ${this.currentSeries.postures.length}</p>
                        <br>
                        <p style="color: #667eea;">¡Continúa con tu progreso en la próxima sesión!</p>
                    </div>
                    `,
                    { timer: 5000 }
                );

                document.getElementById('session-view').classList.add('hidden');
                document.getElementById('patient-home').classList.remove('hidden');
                await this.loadPatientData();

                // Reset form
                document.getElementById('session-comments').value = '';
                document.getElementById('pain-after').value = 0;
                document.getElementById('pain-after-value').textContent = '0';
            } else {
                const data = await response.json();
                SweetAlerts.error(
                    'Error al completar sesión',
                    data.error || 'No se pudo completar la sesión. Intenta nuevamente.'
                );
            }
        } catch (error) {
            SweetAlerts.error(
                'Error de conexión',
                'No se pudo conectar con el servidor. Verifica tu conexión a internet.'
            );
        }
    }

    closeModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.add('hidden');
        });

        document.getElementById('modal-posture-video').src = '';
        document.getElementById('posture-video').src = '';
    }
}

// Initialize app
const app = new TherapeuticYogaApp();

// Make app globally available for onclick handlers
window.app = app;