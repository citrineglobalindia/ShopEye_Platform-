-- SHOPEYE 0017 — Private storage for return evidence photos (CUST-FR-175: private storage, content validation)
-- Supabase-only (storage schema). Files live under <customer-uuid>/..., readable and writable by that customer only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('return-evidence', 'return-evidence', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy return_evidence_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'return-evidence' and (storage.foldername(name))[1] = auth.uid()::text);
create policy return_evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'return-evidence' and ((storage.foldername(name))[1] = auth.uid()::text or app.has_permission('qc.inspect')));
