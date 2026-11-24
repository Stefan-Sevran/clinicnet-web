begin;

create table clinic_operations_private.reply_feedback (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  reply text not null check (char_length(reply) between 1 and 800),
  rating smallint not null check (rating between 1 and 10),
  comment text not null default '' check (char_length(comment) <= 1200),
  created_at timestamptz not null default now(),
  primary key (user_id,id)
);
alter table clinic_operations_private.reply_feedback enable row level security;
revoke all on table clinic_operations_private.reply_feedback from public, anon, authenticated;

create function public.eden_save_reply_feedback(p_id uuid, p_reply text, p_rating integer, p_comment text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to leave feedback' using errcode = '42501';
  end if;
  insert into clinic_operations_private.reply_feedback(user_id,id,reply,rating,comment)
    values(auth.uid(),p_id,btrim(p_reply),p_rating,coalesce(btrim(p_comment),''))
    on conflict (user_id,id) do nothing;
end;
$$;
revoke all on function public.eden_save_reply_feedback(uuid,text,integer,text) from public, anon, authenticated;
grant execute on function public.eden_save_reply_feedback(uuid,text,integer,text) to authenticated;

commit;
