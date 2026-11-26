create table ask_eden_feedback (
  id text primary key,
  surface text not null check (surface in ('public', 'workspace')),
  topic text not null,
  source text not null check (source in ('guidance', 'provider', 'workspace', 'permissions', 'model')),
  rating integer check (rating between 1 and 10),
  comment text not null default '' check (length(comment) <= 1200),
  outcome text check (outcome in ('resolved', 'unresolved', 'reopened')),
  handoff_needed integer not null check (handoff_needed in (0, 1)),
  reopened_at text,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp
);

create view ask_eden_feedback_summary as
select surface, topic, source, count(*) as submissions, avg(rating) as average_rating,
       count(rating) as ratings, count(outcome) as reported_outcomes,
       sum(case when outcome = 'resolved' and reopened_at is null then 1 else 0 end) as resolved_without_reported_reopen,
       count(reopened_at) as reported_reopens, sum(handoff_needed) as reported_handoff_needed
from ask_eden_feedback
group by surface, topic, source;
