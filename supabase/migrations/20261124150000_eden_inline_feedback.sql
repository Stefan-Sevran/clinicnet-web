begin;

alter table clinic_operations_private.reply_feedback
  alter column rating drop not null,
  add constraint reply_feedback_has_value check (rating is not null or char_length(btrim(comment)) > 0);

create or replace function public.eden_save_reply_feedback(p_id uuid, p_reply text, p_rating integer, p_comment text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in to leave feedback' using errcode = '42501';
  end if;

  insert into clinic_operations_private.reply_feedback as feedback(user_id,id,reply,rating,comment)
    values(v_user,p_id,btrim(p_reply),p_rating,coalesce(btrim(p_comment),''))
    on conflict (user_id,id) do update
      set rating = excluded.rating, comment = excluded.comment
      where feedback.reply = excluded.reply;
end;
$$;

commit;
