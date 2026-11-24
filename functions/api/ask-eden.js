import { answerAskEden } from '../../site/support/ask-eden-model.mjs';

export function onRequestPost({ request, env }) {
  return answerAskEden(request, env);
}
