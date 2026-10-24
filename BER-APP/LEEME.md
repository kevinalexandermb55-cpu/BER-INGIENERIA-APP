# BER Ingeniería SAS — Control de viáticos y gastos

## Archivos
Sube los seis archivos de esta carpeta a la **raíz** del repositorio de GitHub Pages:
`index.html`, `styles.css`, `app.js`, `manifest.json`, `sw.js`, `LEEME.md`.

## Publicación
En GitHub: **Settings → Pages → Deploy from a branch → main → /(root)**. Guarda los cambios. Espera a que termine el despliegue y recarga la URL.

## Funciones de esta versión
- Interfaz adaptable a celular y escritorio.
- Animación de bienvenida BER en azul oscuro y dorado.
- Perfiles de empleado guardados localmente.
- Registro de anticipos de viáticos.
- Registro de gastos, categorías y soportes pequeños de imagen/PDF.
- Cálculo de anticipos, gastos y saldo.
- Historial y exportación CSV.

## Importante: prototipo local
Esta versión guarda datos en `localStorage` del navegador de cada dispositivo. No sincroniza datos entre empleados ni con administración. Los perfiles no son cuentas autenticadas y no deben considerarse control de acceso seguro. No usar con información financiera real hasta implementar base de datos central, autenticación, permisos por rol y almacenamiento privado de soportes.
