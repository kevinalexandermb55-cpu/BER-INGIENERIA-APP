-- BER Ingeniería · bucket privado: comprobantes-ber
-- Requiere configurar Firebase como proveedor Third-Party Auth en Supabase.
-- El JWT debe ser el ID token de Firebase entregado por app.js.
-- La claim app_role=admin solo debe emitirse desde un entorno confiable (Admin SDK).

create policy "BER empleados suben sus evidencias"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'comprobantes-ber'
  and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub')
);

create policy "BER empleados consultan sus evidencias"
on storage.objects for select to authenticated
using (
  bucket_id = 'comprobantes-ber'
  and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub')
);

create policy "BER empleados eliminan sus evidencias"
on storage.objects for delete to authenticated
using (
  bucket_id = 'comprobantes-ber'
  and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub')
);

create policy "BER admin consulta evidencias de la empresa"
on storage.objects for select to authenticated
using (
  bucket_id = 'comprobantes-ber'
  and (auth.jwt() ->> 'app_role') = 'admin'
);

create policy "BER admin sube evidencias para empleados"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'comprobantes-ber'
  and (auth.jwt() ->> 'app_role') = 'admin'
);

create policy "BER admin elimina evidencias de la empresa"
on storage.objects for delete to authenticated
using (
  bucket_id = 'comprobantes-ber'
  and (auth.jwt() ->> 'app_role') = 'admin'
);
