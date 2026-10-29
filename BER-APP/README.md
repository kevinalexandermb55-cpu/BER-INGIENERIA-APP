# BER Ingeniería — Control de viáticos

Proyecto web adaptable a celular y computadora, pensado para publicarse en GitHub Pages. Incluye splash animado de marca B‑E‑R, inicio de sesión, registro de gastos, asignación de viáticos por administrador, resumen, historial y exportación CSV.

## Archivos
- `index.html`: pantalla inicial, acceso y estructura de la app.
- `styles.css`: diseño corporativo azul oscuro/dorado y animación de letras.
- `app.js`: autenticación, perfiles, movimientos, historial y comprobantes.
- `firebase-config.js`: configuración web de Firebase del proyecto BER.
- `supabase-config.js`: URL y clave publishable de Supabase.
- `firestore.rules`: reglas iniciales para proteger perfiles y movimientos.
- `supabase-storage-policies.sql`: políticas base para el bucket de comprobantes.
- `manifest.json`, `sw.js`, `assets/icon.svg`: instalación PWA, caché e icono.

## Publicar en GitHub Pages
1. Descarga y descomprime el ZIP.
2. Guarda una copia del repositorio actual antes de sobrescribir archivos.
3. Copia el contenido de esta carpeta en la raíz del repositorio de la app, manteniendo `assets/`.
4. Sube y confirma los cambios en GitHub. En Settings → Pages, deja activa la fuente que ya utilizas.
5. Abre la URL de Pages en Chrome del celular. Usa una ventana de incógnito si ves una versión anterior; se puede instalar desde el menú de Chrome cuando el sitio esté servido por HTTPS.

## Configurar Firebase
1. En Authentication → Sign-in method, habilita Email/Password.
2. En Authentication → Settings → Authorized domains, agrega el dominio de GitHub Pages que utiliza la app.
3. En Firestore → Rules, revisa y publica `firestore.rules`. Hazlo primero en una copia de pruebas si ya tienes reglas en uso.
4. Crea una cuenta desde la app. Se crea como `empleado`.
5. Para dar rol de administrador: abre Firebase Authentication, copia el UID de esa cuenta; en Firestore abre `usuarios` y crea/edita el documento cuyo ID sea exactamente ese UID, con campos `uid` (string igual al UID), `email` (string), `nombre` (string), `rol` (string `admin`) y `activo` (boolean `true`). El rol debe establecerlo solo una persona autorizada. No crees el perfil admin con ID automático.
6. Prueba con dos cuentas distintas antes de usar información real. Un empleado debe consultar solamente movimientos con su UID; un administrador puede consultar todos.

## Configurar Supabase para comprobantes
1. En Storage, crea o revisa el bucket `comprobantes-ber` y déjalo **privado**.
2. Configura Firebase Authentication como proveedor de Third-Party Auth en el proyecto Supabase para que acepte tokens Firebase. La app le proporciona el ID token Firebase a Supabase.
3. Revisa `supabase-storage-policies.sql` antes de ejecutarlo en SQL Editor. Si ya existen políticas con esos nombres, revisa antes de volver a crearlas.
4. Por defecto, los empleados pueden leer y subir comprobantes dentro de su carpeta UID. Para que el administrador lea o suba a carpetas ajenas, el token Firebase debe llevar una custom claim `app_role=admin`, configurada de manera confiable con Firebase Admin SDK en un entorno de servidor. El perfil `rol=admin` guardado en Firestore no añade por sí solo esa claim al token. No intentes configurarla desde JavaScript público ni publiques credenciales de servicio.
5. Si la integración de Third-Party Auth o las políticas no están listas, la app puede iniciar sesión y manejar movimientos en Firestore, pero las cargas o vistas de comprobantes pueden fallar hasta terminar esa configuración.

## Qué incluye y qué validar
- El splash se oculta por un script independiente tras aproximadamente 1,35 segundos y su transición dura 0,52 segundos; no espera a que Firebase cargue.
- Login y datos dependen de Firebase y de internet.
- El comprobante es opcional; máximo 10 MB, imágenes y PDF.
- El administrador puede asignar un viático a un empleado existente escribiendo el correo del destinatario. El empleado debe crear su cuenta primero.
- No hay integración bancaria, pagos ni lectura automática de transferencias: la app registra movimientos reportados.
- Antes de usarla en producción, verifica las reglas, políticas, roles, carga de fotos/PDF y funcionamiento con más de un dispositivo. No subas claves secretas o `service_role` al repositorio.
