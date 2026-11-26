import { saveAskEdenFeedback } from '../../site/support/ask-eden-feedback.mjs';

export function onRequestPost({ request, env }) {
  return saveAskEdenFeedback(request, env);
}
