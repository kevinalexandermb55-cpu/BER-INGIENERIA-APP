# Gestión de actividades, en un solo lugar.

Aplicación web progresiva (PWA) para registrar actividades y evidencias con dos accesos: **Ingeniero** y **Administrador**. Se conserva el logotipo incluido en el ZIP y la paleta corporativa azul marino/dorado.

## Archivos

- `index.html`, `styles.css`, `app.js`: aplicación y experiencia adaptable.
- `firebase-config.js`: configuración web existente de BER; conserva el proyecto Firebase original.
- `firestore.rules`, `storage.rules`: autorización por usuario y rol aplicada en el servidor. Admiten la colección histórica `Usuarios` y perfiles antiguos en `usuarios`.
- `manifest.json`, `service-worker.js`, `icons/`, `assets/`: instalación PWA, caché y marca.
- `cors.json`: CORS del bucket para descargar archivos con autorización de Firebase.
- `firebase.json`: rutas de reglas para publicarlas con Firebase CLI.

## Contabilidad dentro de la app

Solo los dos administradores autorizados pueden abrir el control contable. Desde cada actividad pueden guardar comprobantes en Firestore, conservar borradores y registrar comprobantes completos con tercero, soporte, concepto y líneas PUC de partida doble. La app exige una cuenta y nombre de cuenta por línea, un solo valor (débito o crédito) en cada línea y que ambos totales cuadren. El resumen muestra comprobantes registrados, borradores, totales del periodo filtrado y movimientos débito/crédito/netos por cuenta PUC.

Los datos contables permanecen en Firestore y pueden consultarse y editarse desde el panel. La app no asigna cuentas ni clasifica automáticamente gastos o ingresos. El contador debe revisar los soportes, terceros, cuentas PUC e impuestos y confirmar el tratamiento contable. Este módulo es un control operativo interno; no sustituye la revisión del contador ni garantiza por sí solo el cumplimiento de la contabilidad oficial, declaraciones o libros exigidos.

El Excel compartido no está integrado ni se incluye en este proyecto. La app no escribe en él.

## Qué se corrigió

El ZIP recibido no podía funcionar como estaba: `index.html` enlazaba a un `styles.css` que faltaba, `app.js` importaba un `supabase-config.js` ausente y además dependía de Supabase para evidencias. La hoja de estilos, las rutas de Supabase y la configuración mezclada con viáticos se sustituyeron por una app coherente basada en el proyecto Firebase que ya estaba en el ZIP. El perfil de ingeniero ahora se crea con el UID, correo y rol inicial que exigen las reglas; el cliente nunca puede asignarse el rol de administrador. La animación de entrada dura 2.000 ms.

Las contraseñas y las cuentas de Firebase existentes no se leen, se cambian ni se recrean. El inicio de sesión sigue usando correo y contraseña de Firebase. El rol del panel se comprueba en el perfil y las reglas del servidor bloquean datos que no corresponden al usuario.

## Configuración necesaria en Firebase Console

Estas acciones requieren acceso al proyecto `b-e-r-ingenieria` y no se realizan desde este paquete:

1. En **Authentication → Sign-in method**, confirma que esté habilitado **Email/Password**. No cambies ni restablezcas las contraseñas de las cuentas existentes.
2. En **Authentication → Settings → Authorized domains**, confirma o agrega `kevinalexandermb55-cpu.github.io`.
3. En **Firestore Database → Rules**, publica `firestore.rules`; en **Storage → Rules**, publica `storage.rules`.
4. Confirma que el bucket indicado en `firebase-config.js` exista. Si no está creado, activa Cloud Storage en el proyecto. Esto puede requerir plan de facturación/configuración de Google Cloud.
5. **Autoriza exactamente a Kevin y a su tío como administradores:** en Firestore Console crea el documento `config/bersecurity` con `adminUid1` y `adminUid2` (ambos strings distintos y solo esos dos UID). Sus perfiles deben tener `uid`, `email`, `nombre`, `activo: true` y `rol: "admin"` o `rol: "administrador"`. La app prioriza `Usuarios` y lee `usuarios` como compatibilidad; si hay perfiles duplicados, usa el registro de `Usuarios`. El resto de cuentas no tendrá acceso admin aunque su perfil use uno de esos roles, porque las reglas exigen estar en la lista de dos UID. La app no puede conceder ni cambiar roles; solo el propietario del proyecto puede editar esta lista desde Firebase Console.
6. Para previsualizar evidencias desde el navegador, aplica `cors.json` al bucket usando Google Cloud Shell, con sesión iniciada en el proyecto correcto: `gcloud config set project b-e-r-ingenieria` y `gsutil cors set cors.json gs://b-e-r-ingenieria.firebasestorage.app`. CORS limita la lectura web al dominio publicado; las reglas de Storage siguen controlando cada archivo. Firebase puede pedir habilitar la conexión de reglas de Storage con Firestore.

No compartas contraseñas, claves privadas ni archivos de cuenta de servicio. La configuración web Firebase que está en `firebase-config.js` es la que venía en el ZIP; no se incluye ninguna clave privada nueva. La clave web de Firebase no sustituye las reglas de seguridad.

## Publicación de reglas

Desde una terminal con Firebase CLI instalado y el acceso del propietario al proyecto:

```bash
firebase login
firebase deploy --project b-e-r-ingenieria --only firestore:rules,storage
```

El último comando publica solo las reglas declaradas en `firebase.json`; no despliega la app ni altera datos existentes.

## Publicar en GitHub Pages

1. Conserva una copia del repositorio actual y de sus reglas vigentes.
2. Copia el contenido de esta carpeta en la raíz del repositorio `BER-INGIENERIA-APP`, respetando las carpetas `assets/` e `icons/`.
3. Publica los archivos en la rama y carpeta que ya usa GitHub Pages. Espera a que termine el flujo de Pages.
4. La primera carga debe mostrar el logo durante dos segundos y después el acceso con selector de Ingeniero/Administrador.
5. Haz una recarga completa o borra la caché de la PWA si un dispositivo sigue mostrando recursos antiguos. Al modificar la caché, actualiza `CACHE_NAME` en `service-worker.js`.

## Prueba de aceptación

- Acceso con una cuenta Firebase existente: panel Ingeniero para rol ingeniero/empleado y panel Administrador solo para `rol: "admin"` o `rol: "administrador"`, con autorización adicional por UID en `config/berSecurity`.
- Ingeniero: crear actividad, abrir su propio historial y evidencias.
- Administrador: consultar todas las actividades, filtrar/exportar actividad, pausar/reactivar accesos, registrar comprobantes y consultar el resumen contable PUC.
- Probar en móvil y escritorio, con y sin conexión. El modo sin conexión conserva la interfaz; no envía registros nuevos hasta volver a tener internet.
- Revisar en Firebase Authentication, Firestore y Storage que las reglas están activas antes de usar datos reales.

La publicación de la web y la revisión de autenticación real quedan pendientes del acceso autorizado del propietario. No se ha modificado GitHub Pages ni se ha iniciado sesión con credenciales del usuario.
