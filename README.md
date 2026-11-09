# BER Ingeniería S.A.S. · Registro de Actividades

Aplicación PWA para que cada ingeniero registre actividades, consulte su historial y adjunte evidencias. El administrador puede consultar los registros del equipo y exportarlos a CSV. Se conserva el logo original y la identidad azul/dorada de BER.

## Archivos principales
- `index.html`, `styles.css`: interfaz y diseño adaptable.
- `app.js`: acceso Firebase, perfiles, actividades, consulta, exportación y carga/lectura de evidencias.
- `firebase-config.js`: configuración web del proyecto Firebase BER.
- `supabase-config.js`: URL, clave publishable y bucket privado de Supabase.
- `firestore.rules`: reglas de Firestore para `usuarios` y `actividades`.
- `supabase-storage-policies.sql`: políticas base del bucket privado.
- `manifest.json`, `service-worker.js`, `icons/`: instalación PWA e iconos regenerados desde el logo original.
- `img/logo-ber-original.png`: logo original de BER, sin rediseño.

## Firebase
1. En Firebase Authentication, habilita Email/Password.
2. En Authentication → Settings → Authorized domains, agrega `kevinalexandermb55-cpu.github.io`.
3. En Firestore, conserva una copia de las reglas actuales y revisa/publica `firestore.rules`.
4. Crea las cuentas de los ingenieros desde la app. El perfil se crea en `usuarios/{UID}` con rol `empleado`.
5. Para autorizar al administrador, edita el documento `usuarios/{UID_ADMIN}` y establece `rol: "admin"`, `activo: true`, `uid`, `email` y `nombre`. Nunca permitas que un usuario se asigne a sí mismo el rol admin.

## Supabase Storage
1. Comprueba que exista el proyecto configurado en `supabase-config.js`.
2. Crea o conserva el bucket `comprobantes-ber` y configúralo como **privado**.
3. Configura Firebase Authentication como proveedor Third-Party Auth en Supabase para aceptar el ID token de Firebase.
4. Revisa `supabase-storage-policies.sql` antes de ejecutarlo. Si ya existen políticas con esos nombres, no las dupliques: edítalas o elimínalas antes de volver a crearlas.
5. Los empleados pueden gestionar archivos dentro de su carpeta UID. Para que un administrador lea, suba o elimine evidencias de otros ingenieros, el token debe incluir la custom claim `app_role=admin`, emitida por un servidor confiable mediante Firebase Admin SDK. El rol `admin` guardado en Firestore no añade automáticamente esa claim.
6. No coloques claves `service_role`, claves privadas ni credenciales de Firebase Admin en el navegador o en GitHub.

## Publicar y probar
1. Descomprime el ZIP y copia el contenido de `BER-APP/` a la raíz del repositorio GitHub Pages, conservando las carpetas `icons/` e `img/`.
2. Publica los cambios y abre la app en Chrome con conexión a internet.
3. Después de publicar, cierra la app instalada anteriormente y vuelve a abrir la página para que el service worker `ber-actividades-v4` descargue los nuevos archivos. Si sigue mostrando la versión vieja, borra los datos del sitio en Chrome y vuelve a cargar.
4. Prueba con una cuenta de ingeniero y otra de administrador: crear actividad, adjuntar foto/PDF, abrir evidencia, consultar registros y exportar CSV.
5. La PWA requiere HTTPS. GitHub Pages ya sirve el sitio mediante HTTPS; la opción de instalación depende de que Chrome valide el manifiesto y el service worker.

## Importante
- La app usa la colección Firestore `actividades` y el bucket Supabase `comprobantes-ber`.
- Las reglas de Firestore no borran la colección antigua `movimientos`; solo dejan sus escrituras deshabilitadas.
- La integración no realiza transferencias bancarias ni pagos; solo registra actividades y archivos.
- Los valores de configuración web y la clave publishable son identificadores de cliente; la seguridad real depende de Firestore Rules, Supabase RLS/Storage Policies y la protección de los roles.
