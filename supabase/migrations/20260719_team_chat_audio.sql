-- 🎙️ Sprachnachrichten im internen Team-Chat (Inhaber-Wunsch 19.07.):
-- attachment_type um 'audio' erweitern + Audio-MIME-Typen im Storage-Bucket
-- freischalten (gleiche Stelle, die schon PDF/Video blockiert hatte).

alter table public.team_messages
  drop constraint if exists team_messages_attachment_type_check;
alter table public.team_messages
  add constraint team_messages_attachment_type_check
  check (attachment_type in ('image', 'video', 'pdf', 'audio'));

update storage.buckets
set allowed_mime_types = (
  select array(
    select distinct m
    from unnest(allowed_mime_types || array[
      'audio/mp4', 'audio/webm', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a', 'audio/aac'
    ]) as m
  )
)
where id = 'listing-images'
  and allowed_mime_types is not null;
