Yoga Terapéutico Online - Sistema de Gestión


El Yoga Terapéutico Online es una aplicación web completa que permite a instructores gestionar pacientes, crear series terapéuticas personalizadas y realizar seguimiento de sesiones, mientras que los pacientes pueden acceder a sus rutinas asignadas y registrar sus progresos.
Características principales

    Gestión de usuarios: Registro e inicio de sesión para instructores y pacientes

    Gestión de pacientes: Creación, edición y eliminación de pacientes

    Terapias personalizadas: Creación de series terapéuticas con posturas específicas

    Seguimiento de sesiones: Registro de dolor antes/después y comentarios

    Dashboard analítico: Estadísticas de progreso y efectividad terapéutica

    Sistema de notificaciones: Alertas para pacientes e instructores

    Exportación de reportes: Generación de informes en formato JSON y CSV

Tecnologías utilizadas
Backend

    Node.js (v18+)

    Express.js

    Postgresql (Para conectarla a la nube y permitir realizar transacciones)

    bcryptjs (para hashing de contraseñas)

    jsonwebtoken (para autenticación)

    CORS (para gestión de orígenes cruzados)

Frontend

    JavaScript vanilla (ES6+)

    HTML5 semántico

    CSS3 moderno (Flexbox, Grid, animaciones)

    LocalStorage (para persistencia de sesión)

Requisitos del sistema

    Node.js v18 o superior

    NPM v8 o superior

    Navegador moderno (Chrome, Firefox, Edge)

Instalación y ejecución

    Clonar el repositorio:

bash

git clone https://github.com/tu-usuario/therapeutic-yoga.git
cd therapeutic-yoga

    Instalar dependencias:

bash

npm install

    Iniciar la aplicación:

bash

node server.js

    Acceder a la aplicación:
    Abrir en el navegador: http://localhost:3001

Estructura de archivos
text

therapy-app/
├── server.js               # Punto de entrada del servidor
├── predefinedTherapy.js    # Definiciones de terapias y posturas
├── public/                 # Archivos frontend
│   ├── app.js              # Lógica principal de la aplicación
│   ├── index.html          # Página principal
│   └── styles.css          # Estilos CSS
└── therapy.db              # Base de datos SQLite (se crea automáticamente)

Dependencias necesarias

Asegúrate de tener instaladas las siguientes dependencias:
bash

npm install express bcryptjs jsonwebtoken cors sqlite3 sqlite

Funcionalidades clave
Para instructores:

    Gestión completa de pacientes

    Creación de series terapéuticas personalizadas

    Asignación de terapias a pacientes

    Dashboard analítico con métricas de progreso

    Exportación de reportes en CSV/JSON

    Visualización detallada del historial de sesiones

Para pacientes:

    Acceso a rutas terapéuticas asignadas

    Sistema de sesiones guiadas con temporizador

    Registro de niveles de dolor y comentarios

    Visualización de videos demostrativos

    Seguimiento de progreso

Contribución

Las contribuciones son bienvenidas. Por favor, crea un fork del repositorio y envía tus pull requests.
