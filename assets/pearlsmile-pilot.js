(() => {
  'use strict';
  const query = new URLSearchParams(location.search);
  const calendarPilot = query.get('calendar-pilot') === '1';
  if (calendarPilot && location.hostname !== 'codex-ask-eden-preview.clinicnet-web.pages.dev') return;
  if (!calendarPilot && query.get('workspace-pilot') !== '1') return;

  const chat = document.getElementById('pearlsmile-reception-chat-2026');
  const messages = chat?.querySelector('#pearlsmile-chat-messages-2026');
  if (!messages) return;
  const api = calendarPilot
    ? 'https://eden-webhook-staging.onrender.com' : 'https://eden-webhook-ixdd.onrender.com';

  function message(text, sender) {
    const line = document.createElement('div');
    line.className = 'pearlsmile-chat-message-2026 pearlsmile-chat-' + sender + '-2026';
    line.textContent = text;
    messages.append(line);
    return line;
  }

  chat.querySelectorAll('.pearlsmile-voice-row-2026, .pearlsmile-chat-input-row-2026')
    .forEach(row => { row.style.display = 'none'; });
  let client;
  async function getSession() {
    if (!client) {
      const response = await fetch(api + '/clinic/public-config', { cache: 'no-store' });
      if (!response.ok) throw Error('Workspace sign-in is temporarily unavailable.');
      const config = await response.json();
      if (!window.supabase?.createClient) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
          script.onload = resolve;
          script.onerror = () => { script.remove(); reject(Error('Workspace sign-in could not load.')); };
          document.head.append(script);
        });
      }
      client = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
        auth: { detectSessionInUrl: false }
      });
    }
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) throw Error(calendarPilot
      ? 'Sign in to the preview Clinic Workspace with access to Test Location, then try again.'
      : 'Sign in at clinicnet.live/clinic/ with your Test Location account, then try again.');
    return data.session;
  }

  if (calendarPilot) {
    startCalendarPilot();
    return;
  }

  const intro = message('Workspace pilot · Use the fictional request below to try the staff inbox.', 'bot');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Send sample braces inquiry';
  intro.append(document.createElement('br'), button);
  const reply = message('', 'bot');
  reply.hidden = true;
  reply.setAttribute('role', 'status');

  let sampleShown = false;
  button.addEventListener('click', async () => {
    button.disabled = true;
    reply.hidden = false;
    reply.textContent = 'Sending the fictional inquiry to Test Location…';
    if (!sampleShown) {
      const request = message('Hi Maria! Can I request a braces consultation on Saturday morning?', 'user');
      messages.insertBefore(request, reply);
      sampleShown = true;
    }
    messages.scrollTop = messages.scrollHeight;

    try {
      const session = await getSession();
      const response = await fetch(api + '/clinic/pilots/pearlsmile', {
        method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token }
      });
      if (response.status === 401 || response.status === 403) {
        throw Error('This pilot requires your signed-in Test Location account.');
      }
      if (!response.ok) throw Error('The inquiry could not be sent. Please try again.');
      const { stored } = await response.json();
      reply.textContent = stored
        ? 'Thanks po! The sample is in Test Location’s Activity inbox.'
        : 'This sample is already in Test Location’s workspace.';
      const link = document.createElement('a');
      link.href = '/clinic/';
      link.textContent = 'Open Clinic Workspace';
      reply.append(document.createElement('br'), link);
    } catch (error) {
      reply.textContent = error.message;
      button.disabled = false;
    }
    messages.scrollTop = messages.scrollHeight;
  });

  function startCalendarPilot() {
    const intro = message('PearlSmile Cebu booking test · Fictional patient, initial consultation only.', 'bot');
    const check = document.createElement('button');
    check.type = 'button';
    check.textContent = 'Show consultation times';
    intro.append(document.createElement('br'), check);
    const reply = message('', 'bot');
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    const choices = document.createElement('div');
    reply.append(status, choices);
    const clock = new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
    let working = false;
    let selectedTime;
    let requestId;

    async function call(data) {
      const session = await getSession();
      const response = await fetch(api + '/clinic/pilots/pearlsmile/calendar', {
        method: data ? 'POST' : 'GET', cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
        headers: { Authorization: 'Bearer ' + session.access_token,
          ...(data ? { 'Content-Type': 'application/json' } : {}) },
        body: data ? JSON.stringify(data) : undefined
      });
      if (response.status === 409) return { taken: true };
      if (response.status === 401 || response.status === 403) {
        throw Error('Sign in with the account that can open Test Location in Clinic Workspace.');
      }
      if (!response.ok) throw Error('The test calendar is unavailable. Please try again.');
      return response.json();
    }

    async function choose(start) {
      if (working || (selectedTime && selectedTime !== start)) return;
      selectedTime = start;
      requestId ||= crypto.randomUUID();
      working = true;
      check.disabled = true;
      for (const choice of choices.children) choice.disabled = true;
      status.textContent = 'Checking that slot and saving your reservation…';
      try {
        const result = await call({ start, requestId });
        if (result.taken) {
          selectedTime = null;
          requestId = null;
          choices.replaceChildren();
          check.disabled = false;
          status.textContent = 'That time is unavailable. Show consultation times to choose another.';
          return;
        }
        if (result.status !== 'CONFIRMED' || result.start !== start) {
          throw Error('The booking has not been confirmed yet.');
        }
        choices.replaceChildren();
        status.textContent = 'Confirmed · ' + result.service + ' · ' + clock.format(new Date(start)) + ' (Cebu time).';
        const link = document.createElement('a');
        const workspace = new URLSearchParams({ view: 'daily', inbox: 'booked' });
        if (result.accountId && result.locationId) {
          workspace.set('account', result.accountId);
          workspace.set('location', result.locationId);
        }
        link.href = '/clinic/?' + workspace;
        link.textContent = 'See the test booking in Daily Action';
        choices.append(link);
      } catch {
        status.textContent = 'The booking has not been confirmed yet. Retry the same time to check it.';
        const retry = Array.from(choices.children).find(choice => choice.dataset.start === start);
        retry.textContent = 'Retry ' + clock.format(new Date(start));
        retry.disabled = false;
      } finally {
        working = false;
        messages.scrollTop = messages.scrollHeight;
      }
    }

    check.addEventListener('click', async () => {
      if (working) return;
      working = true;
      check.disabled = true;
      choices.replaceChildren();
      status.textContent = 'Checking the test calendar…';
      try {
        const { slots } = await call();
        status.textContent = slots.length ? 'Which consultation time works for you? All times are in Cebu time.' :
          'There are no open consultation times this week.';
        for (const start of slots) {
          const choice = document.createElement('button');
          choice.type = 'button';
          choice.dataset.start = start;
          choice.textContent = clock.format(new Date(start));
          choice.addEventListener('click', () => choose(start));
          choices.append(choice, document.createTextNode(' '));
        }
      } catch (error) {
        status.textContent = error.message;
      } finally {
        working = false;
        check.disabled = false;
        messages.scrollTop = messages.scrollHeight;
      }
    });
  }
})();
