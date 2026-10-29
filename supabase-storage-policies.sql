-- Antes de ejecutar: habilita Firebase como proveedor de Third-Party Auth en Supabase.
-- El bucket comprobantes-ber debe existir y estar configurado como PRIVATE.
-- No pegues claves secretas/service_role en el navegador.

-- Usuarios normales pueden subir y consultar archivos solamente dentro de su carpeta UID.
create policy "BER empleados suben su propio comprobante"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'comprobantes-ber'
  and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub')
);

create policy "BER empleados leen su propio comprobante"
on storage.objects for select to authenticated
using (
  bucket_id = 'comprobantes-ber'
  and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub')
);

-- Acceso de administrador a carpetas ajenas SOLO si se configuró la custom claim
-- app_role=admin en el token Firebase a través de un entorno confiable/Admin SDK.
-- Si no configuraste esa claim, los administradores no podrán abrir comprobantes de otros.
create policy "BER admin lee comprobantes cuando tiene claim confiable"
on storage.objects for select to authenticated
using (
  bucket_id = 'comprobantes-ber'
  and (auth.jwt() ->> 'app_role') = 'admin'
);

-- Política para subir documentos a nombre de empleados desde la cuenta administradora.
create policy "BER admin sube comprobantes para empleados cuando tiene claim confiable"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'comprobantes-ber'
  and (auth.jwt() ->> 'app_role') = 'admin'
);
