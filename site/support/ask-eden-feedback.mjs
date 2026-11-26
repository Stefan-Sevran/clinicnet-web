import knowledge from '../../assets/eden-support-knowledge.js';

const topics = new Set([
  ...knowledge.supportArticles().map(({id}) => id), 'messenger-test', 'other', 'public-offer', 'public-receptionist-future'
]);
const sources = new Set(['guidance', 'provider', 'workspace', 'permissions', 'model']);
const previewHost = 'codex-ask-eden-preview.clinicnet-web.pages.dev';

function response(status, body) {
  return Response.json(body, {status, headers:{'Cache-Control':'no-store'}});
}

export async function saveAskEdenFeedback(request, env) {
  const url = new URL(request.url);
  if (url.hostname !== previewHost) return response(404, {error:'Unavailable'});
  if (request.headers.get('origin') !== url.origin) return response(403, {error:'Invalid origin'});
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    return response(415, {error:'Expected JSON'});
  }
  if (!env.EDEN_FEEDBACK) return response(503, {error:'Feedback storage unavailable'});

  let entry;
  try {
    const reader = request.body?.getReader();
    if (!reader) return response(400, {error:'Invalid feedback'});
    const decoder = new TextDecoder();
    let json = '';
    let bytes = 0;
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) {
        await reader.cancel();
        return response(413, {error:'Feedback too large'});
      }
      json += decoder.decode(value, {stream:true});
    }
    entry = JSON.parse(json + decoder.decode());
  } catch {
    return response(400, {error:'Invalid feedback'});
  }
  const {id, rating, outcome, handoff, surface, topic, source} = entry || {};
  const comment = typeof entry?.comment === 'string' ? entry.comment.trim() : null;
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id) ||
      (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 10)) ||
      ![null, 'resolved', 'unresolved', 'reopened'].includes(outcome) || typeof handoff !== 'boolean' ||
      !['public', 'workspace'].includes(surface) || !topics.has(topic) || !sources.has(source) ||
      comment === null || comment.length > 1200 || (comment && !knowledge.mayUseModel(comment)) ||
      (rating === null && !outcome && !handoff && !comment)) {
    return response(400, {error:'Invalid feedback'});
  }
  try {
    await env.EDEN_FEEDBACK.prepare(`
      insert into ask_eden_feedback
        (id, surface, topic, source, rating, comment, outcome, handoff_needed, reopened_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, case when ? = 'reopened' then current_timestamp end)
      on conflict (id) do update set
        rating = excluded.rating,
        comment = excluded.comment,
        outcome = excluded.outcome,
        handoff_needed = excluded.handoff_needed,
        reopened_at = coalesce(ask_eden_feedback.reopened_at, excluded.reopened_at),
        updated_at = current_timestamp
      where ask_eden_feedback.surface = excluded.surface
        and ask_eden_feedback.topic = excluded.topic
        and ask_eden_feedback.source = excluded.source
    `).bind(id, surface, topic, source, rating, comment, outcome, Number(handoff), outcome).run();
  } catch {
    return response(503, {error:'Feedback storage unavailable'});
  }
  return response(200, {saved:true});
}
