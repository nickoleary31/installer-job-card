-- Keep repository bucket private and allow authenticated app access.

insert into storage.buckets (id, name, public)
values ('customer-site-files', 'customer-site-files', false)
on conflict (id) do update set public = false;

drop policy if exists "Authenticated users can upload customer site files" on storage.objects;
create policy "Authenticated users can upload customer site files"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'customer-site-files');

drop policy if exists "Authenticated users can read customer site files" on storage.objects;
create policy "Authenticated users can read customer site files"
on storage.objects
for select
to authenticated
using (bucket_id = 'customer-site-files');

drop policy if exists "Authenticated users can update customer site files" on storage.objects;
create policy "Authenticated users can update customer site files"
on storage.objects
for update
to authenticated
using (bucket_id = 'customer-site-files')
with check (bucket_id = 'customer-site-files');

drop policy if exists "Authenticated users can delete customer site files" on storage.objects;
create policy "Authenticated users can delete customer site files"
on storage.objects
for delete
to authenticated
using (bucket_id = 'customer-site-files');
