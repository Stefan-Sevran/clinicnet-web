(function () {
  const suggestions = [
    'My sign-in link opens the wrong page',
    'Where do I review an access request?',
    'How do I set up Website Chat?'
  ];
  const footer = 'Leave out patient details and sign-in codes.';
  const paths = {setup:'Open Connect', daily:'Open Daily Action', profile:'Open Clinic profile', revenue:'Open Revenue', alerts:'Open Alerts'};

  function saveGuestFeedback({id, answer, rating, comment}) {
    const key = 'eden-ask-demo-feedback';
    const saved = JSON.parse(localStorage.getItem(key) || '[]').filter(item => item.id !== id);
    localStorage.setItem(key, JSON.stringify([...saved.slice(-49), {id, reply:answer, rating, comment}]));
  }

  function publicReply(question) {
    if (/^(?:what (?:is|does) (?:eden|clinicnet)(?: do)?|how does (?:eden|clinicnet) work)\??$/i.test(question)) {
      return {answer:'ClinicNet helps clinics capture booking inquiries from Website Chat, Messenger, and AI Phone. Use Clinic Workspace to manage connections and review inquiries.', href:'/clinic/', action:'Open Clinic Workspace'};
    }
    const result = window.EdenSupportKnowledge?.supportKnowledge(question);
    if (!result || result.decision === 'human') {
      return {answer:'What were you trying to do when you got stuck? If it’s about a connection, tell me whether it’s Website Chat, Messenger, or AI Phone.'};
    }
    return {answer:result.answer, guide:result.articles[0]?.id, view:result.view};
  }

  async function previewReply(question, history = []) {
    const fallback = publicReply(question);
    if (location.hostname !== 'codex-ask-eden-preview.clinicnet-web.pages.dev') return fallback;
    const mayUseModel = window.EdenSupportKnowledge?.mayUseModel;
    if (!mayUseModel?.(question) || history.some(turn =>
      turn.role === 'user' && !mayUseModel(turn.content))) return fallback;

    try {
      const response = await fetch('/api/ask-eden', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({question, history}),
        signal:AbortSignal.timeout(10000)
      });
      if (response.ok) {
        const {answer, mode} = await response.json();
        if (mode === 'model' && typeof answer === 'string' && answer.trim()) return {answer};
      }
    } catch {
      // The local guidance is also available if the preview model times out.
    }
    return fallback;
  }

  function mount({answerQuestion = previewReply, saveFeedback = saveGuestFeedback, workspaceContext} = {}) {
    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'eden-help-launcher';
    launcher.textContent = 'Ask Eden';
    launcher.setAttribute('aria-controls','eden-help');
    launcher.setAttribute('aria-expanded','false');

    const panel = document.createElement('dialog');
    panel.id = 'eden-help';
    panel.className = 'eden-help';
    panel.setAttribute('aria-labelledby','eden-help-title');
    panel.innerHTML = `
      <header class="eden-help-header">
        <div><h2 id="eden-help-title">Ask Eden</h2><p>ClinicNet support</p></div>
        <button type="button" class="eden-help-close" aria-label="Minimize Ask Eden">Minimize</button>
      </header>
      <div class="eden-help-thread">
        <div class="eden-help-intro"><p>What can I help you with?</p>
          <div class="eden-help-suggestions"></div>
        </div>
        <div class="eden-help-messages" role="log" aria-label="Conversation" aria-live="polite"></div>
      </div>
      <form class="eden-help-composer">
        <label for="eden-help-question">Your question</label>
        <div class="eden-help-entry">
          <textarea rows="2" maxlength="400" id="eden-help-question" required placeholder="Ask Eden a question" aria-describedby="eden-help-privacy"></textarea>
          <button type="submit" aria-label="Send question"><span aria-hidden="true">↑</span></button>
        </div>
        <div class="eden-help-footer"><small id="eden-help-privacy">${footer}</small>
          <small class="eden-help-address">team@clinicnet.live</small></div>
      </form>`;
    document.body.append(launcher,panel);
    const question = panel.querySelector('#eden-help-question');
    const messages = panel.querySelector('.eden-help-messages');
    const thread = panel.querySelector('.eden-help-thread');
    const intro = panel.querySelector('.eden-help-intro');
    const composer = panel.querySelector('.eden-help-composer');
    const starters = panel.querySelector('.eden-help-suggestions');
    let openedBy = launcher;
    let conversationVersion = 0;
    let history = [];
    let topic;
    const subtitle = panel.querySelector('.eden-help-header p');

    function showSuggestions() {
      const workspace = workspaceContext?.();
      subtitle.textContent = workspace ? 'Selected location: ' + workspace : 'ClinicNet support';
      const prompts = workspace ? [
        'I sent a Messenger test and nothing showed up.',
        'Is Website Chat connected?',
        'Can you check AI Phone?'
      ] : suggestions;
      starters.replaceChildren(...prompts.map(text => {
        const starter = document.createElement('button');
        starter.type = 'button';
        starter.textContent = text;
        starter.onclick = () => { void send(text); question.focus(); };
        return starter;
      }));
    }

    function open(trigger = launcher) {
      openedBy = trigger;
      if (!panel.open) {
        showSuggestions();
        panel.show();
      }
      launcher.setAttribute('aria-expanded','true');
      question.focus();
    }

    function close() {
      if (!panel.open) return;
      panel.close();
      launcher.setAttribute('aria-expanded','false');
      openedBy?.focus();
    }

    function reset() {
      ++conversationVersion;
      history = [];
      topic = undefined;
      close();
      composer.reset();
      composer.querySelector('button').disabled = false;
      messages.replaceChildren();
      subtitle.textContent = 'ClinicNet support';
      intro.hidden = false;
    }

    function addFeedback(card, reply) {
      const feedbackVersion = conversationVersion;
      const id = crypto.randomUUID();
      const feedback = document.createElement('details');
      feedback.className = 'eden-help-feedback';
      feedback.innerHTML = `
        <summary>How helpful was this answer?</summary>
        <div class="eden-help-ratings" role="group" aria-label="Rate this answer from 1 to 10"></div>
        <label>Optional feedback<textarea rows="2" maxlength="1200"></textarea></label>
        <button type="button" class="eden-help-done">Done</button>
        <span class="eden-help-feedback-status" role="status"></span>`;
      const ratings = feedback.querySelector('.eden-help-ratings');
      const commentField = feedback.querySelector('textarea');
      const done = feedback.querySelector('.eden-help-done');
      const status = feedback.querySelector('[role="status"]');
      let rating = null;
      let submittedComment = '';
      let saved = null;
      let pending = Promise.resolve();
      let latest = 0;

      function save(closeOnSave = false) {
        if (closeOnSave) submittedComment = commentField.value.trim();
        const comment = submittedComment;
        const selection = {id, answer:reply, rating, comment};
        if (rating === null && !comment && !saved) {
          feedback.open = false;
          feedback.querySelector('summary').focus();
          return;
        }
        const attempt = ++latest;
        status.textContent = 'Saving…';
        pending = pending.then(async () => {
          if (conversationVersion !== feedbackVersion) return;
          try {
            if (!saved || selection.rating !== saved.rating || selection.comment !== saved.comment) {
              await saveFeedback(selection);
              saved = selection;
            }
            if (attempt !== latest) return;
            status.textContent = 'Saved. Thank you.';
            if (closeOnSave) {
              feedback.open = false;
              feedback.querySelector('summary').focus();
            }
          } catch {
            if (attempt === latest) status.textContent = 'Couldn’t save. Try again.';
          }
        });
      }

      for (let value = 1; value <= 10; value++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = String(value);
        button.setAttribute('aria-label',value + ' out of 10');
        button.setAttribute('aria-pressed','false');
        button.onclick = () => {
          rating = value;
          for (const item of ratings.children) item.setAttribute('aria-pressed',String(item === button));
          save();
        };
        ratings.append(button);
      }
      done.onclick = () => save(true);
      card.append(feedback);
    }

    async function send(text) {
      const input = text.trim();
      if (!input || composer.querySelector('button').disabled) return;
      const version = conversationVersion;
      intro.hidden = true;
      for (const previous of messages.querySelectorAll('details[open]')) previous.open = false;
      const user = document.createElement('p');
      user.className = 'eden-help-question';
      user.textContent = input;
      const card = document.createElement('article');
      card.className = 'eden-help-answer';
      const replyBody = document.createElement('div');
      replyBody.className = 'eden-help-reply';
      const label = document.createElement('strong');
      label.textContent = 'Eden';
      const answer = document.createElement('p');
      answer.textContent = 'Finding guidance…';
      replyBody.append(label, answer);
      card.append(replyBody);
      messages.append(user,card);
      question.value = '';
      composer.querySelector('button').disabled = true;
      thread.scrollTop = thread.scrollHeight;
      try {
        const result = await answerQuestion(input, history, topic);
        if (version !== conversationVersion) return;
        answer.textContent = result.answer;
        topic = result.topic;
        history = [...history, {role:'user', content:input},
          {role:'assistant', content:result.answer.slice(0, 1000)}].slice(-4);
        if (result.onAction || result.href) {
          const action = document.createElement(result.href ? 'a' : 'button');
          action.className = 'eden-help-action';
          action.textContent = result.action || paths[result.view];
          if (result.href) action.href = result.href;
          else {
            action.type = 'button';
            action.onclick = event => {
              event.stopPropagation();
              close();
              result.onAction();
            };
          }
          replyBody.append(action);
        }
        addFeedback(card,result.answer);
      } catch {
        if (version === conversationVersion) answer.textContent = 'Eden couldn’t load an answer. Please try again.';
      } finally {
        if (version === conversationVersion) {
          composer.querySelector('button').disabled = false;
          thread.scrollTop = thread.scrollHeight;
        }
      }
    }

    launcher.onclick = () => panel.open ? close() : open();
    panel.querySelector('.eden-help-close').onclick = close;
    question.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        composer.requestSubmit();
      }
    });
    panel.addEventListener('keydown',event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    });
    composer.onsubmit = event => { event.preventDefault(); void send(question.value); question.focus(); };
    return {open, close, reset};
  }

  window.ClinicNetAskEden = {mount, previewReply, publicReply, saveGuestFeedback};
  if (document.body.dataset.page !== 'clinic') mount();
})();
