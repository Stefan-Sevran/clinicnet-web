(() => {
  'use strict';
  const query = new URLSearchParams(location.search);
  const calendarPilot = query.get('calendar-pilot') === '1';
  const patient = calendarPilot && query.get('patient') === '1';
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

  chat.querySelector('.pearlsmile-voice-row-2026').style.display = 'none';
  if (!calendarPilot) chat.querySelector('.pearlsmile-chat-input-row-2026').style.display = 'none';
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
    const input = chat.querySelector('#pearlsmile-chat-input-2026');
    const send = chat.querySelector('#pearlsmile-chat-send-2026');
    let patientToken;
    if (patient) {
      const storageKey = 'pearlsmile-patient-pilot';
      const incoming = new URLSearchParams(location.hash.slice(1)).get('patient-link');
      if (incoming) {
        history.replaceState(null, '', location.pathname + location.search + '#' + chat.id);
        sessionStorage.setItem(storageKey, incoming);
        chat.scrollIntoView({ block: 'center' });
      }
      patientToken = sessionStorage.getItem(storageKey);
      if (!patientToken) {
        input.disabled = send.disabled = true;
        message('Open a patient test link from the clinic team to book a fictional consultation.', 'bot');
        return;
      }
    }
    const intro = message('PearlSmile Cebu booking test · Fictional patient, initial consultation only.', 'bot');
    input.placeholder = 'e.g. Can I book a consultation Friday morning?';
    input.maxLength = 240;
    const check = document.createElement('button');
    check.type = 'button';
    check.textContent = 'Show consultation times';
    intro.append(document.createElement('br'), check);
    let status;
    let choices;
    const clock = new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
    let working = false;
    let selectedTime;
    let requestId;
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const cebuTime = timestamp => new Date(timestamp + 8 * 60 * 60_000);
    const voice = patient ? setupBookingVoice() : null;

    function setAvailabilityControls(disabled) {
      check.disabled = disabled;
      input.disabled = disabled;
      send.disabled = disabled;
      voice?.setBusy(disabled);
    }

    function openReply() {
      choices?.querySelectorAll('button').forEach(button => { button.disabled = true; });
      status = document.createElement('span');
      status.setAttribute('role', 'status');
      choices = document.createElement('div');
      message('', 'bot').append(status, choices);
    }

    function requestedDate(text) {
      const isoDate = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
      if (isoDate) return isoDate;
      const day = text.match(/\b(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)?.[0];
      if (!day) return undefined;
      const cebu = cebuTime(Date.now());
      const offset = day === 'today' ? 0 : day === 'tomorrow' ? 1 :
        (weekdays.indexOf(day) - cebu.getUTCDay() + 7) % 7;
      cebu.setUTCDate(cebu.getUTCDate() + offset);
      return cebu.toISOString().slice(0, 10);
    }

    async function call(data, date) {
      const accessToken = patient ? patientToken : (await getSession()).access_token;
      const route = patient ? '/pilots/pearlsmile/patient-calendar' : '/clinic/pilots/pearlsmile/calendar';
      const search = date ? '?' + new URLSearchParams({ date }) : '';
      const response = await fetch(api + route + search, {
        method: data ? 'POST' : 'GET', cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
        headers: { Authorization: 'Bearer ' + accessToken,
          ...(data ? { 'Content-Type': 'application/json' } : {}) },
        body: data ? JSON.stringify(patient ? { start: data.start } : data) : undefined
      });
      if (response.status === 409) return { taken: true };
      if (response.status === 401 || response.status === 403) {
        if (patient) throw Object.assign(Error('This patient test link is invalid or expired. Ask the clinic team for a new link.'), { invalidLink: true });
        throw Error('Sign in with the account that can open Test Location in Clinic Workspace.');
      }
      if (!response.ok) throw Error('The test calendar is unavailable. Please try again.');
      return response.json();
    }

    async function choose(start, spoken = false) {
      if (working || (selectedTime && selectedTime !== start)) return;
      selectedTime = start;
      if (!patient) requestId ||= crypto.randomUUID();
      working = true;
      setAvailabilityControls(true);
      choices.querySelectorAll('button').forEach(choice => { choice.disabled = true; });
      status.textContent = 'Checking that slot and saving your reservation…';
      try {
        const result = await call({ start, requestId });
        if (result.taken) {
          selectedTime = null;
          requestId = null;
          choices.replaceChildren();
          setAvailabilityControls(false);
          status.textContent = 'That time is unavailable. Ask for another day or show all consultation times.';
          if (spoken) voice.reply(status.textContent);
          return;
        }
        if (result.status !== 'CONFIRMED' || result.start !== start) {
          throw Error('The booking has not been confirmed yet.');
        }
        choices.replaceChildren();
        status.textContent = 'Confirmed · ' + result.service + ' · ' + clock.format(new Date(start)) + ' (Cebu time).';
        if (spoken) voice.reply('Your initial consultation is confirmed for ' + clock.format(new Date(start)) + ', Cebu time.');
        if (patient) return;
        const link = document.createElement('a');
        const workspace = new URLSearchParams({ view: 'daily', inbox: 'booked' });
        if (result.accountId && result.locationId) {
          workspace.set('account', result.accountId);
          workspace.set('location', result.locationId);
        }
        link.href = '/clinic/?' + workspace;
        link.textContent = 'See the test booking in Daily Action';
        choices.append(link);
      } catch (error) {
        if (error.invalidLink) {
          status.textContent = error.message;
          if (spoken) voice.reply(error.message);
          return;
        }
        status.textContent = 'The booking has not been confirmed yet. Retry the same time to check it.';
        const retry = Array.from(choices.children).find(choice => choice.dataset.start === start);
        if (retry) {
          retry.textContent = 'Retry ' + clock.format(new Date(start));
          retry.disabled = false;
        }
        if (spoken) {
          voice.setBusy(false);
          voice.reply('The booking is not confirmed yet. Say retry to check the same time.');
        }
      } finally {
        working = false;
        messages.scrollTop = messages.scrollHeight;
      }
    }

    async function showTimes(date, spoken = false) {
      if (working) return;
      working = true;
      setAvailabilityControls(true);
      openReply();
      status.textContent = 'Checking the test calendar…';
      try {
        const { slots } = await call(undefined, date);
        if (date && slots.some(start => cebuTime(Date.parse(start)).toISOString().slice(0, 10) !== date)) {
          throw Error('I could not check that day. Try again or show all consultation times.');
        }
        status.textContent = slots.length ? 'Which consultation time works for you? All times are in Cebu time.' :
          date ? 'I don’t have open consultation times that day. Would another day work?' :
            'There are no open consultation times in the next seven days.';
        for (const start of slots) {
          const choice = document.createElement('button');
          choice.type = 'button';
          choice.dataset.start = start;
          choice.textContent = clock.format(new Date(start));
          choice.addEventListener('click', () => choose(start));
          choices.append(choice, document.createTextNode(' '));
        }
        if (spoken) voice.offer(slots.slice(0, 2), status.textContent);
      } catch (error) {
        status.textContent = error.message;
        if (spoken) voice.reply(error.message);
        if (error.invalidLink) return;
      } finally {
        working = false;
        messages.scrollTop = messages.scrollHeight;
      }
      setAvailabilityControls(false);
    }

    function sendRequest(raw = input.value, spoken = false) {
      const text = raw.trim().slice(0, 240);
      if (!text || working || selectedTime) return;
      voice?.clearOptions();
      input.value = '';
      message(text, 'user');
      choices?.querySelectorAll('button').forEach(button => { button.disabled = true; });
      const request = text.toLowerCase();
      const date = requestedDate(request);
      if (/\b(afternoon|evening|tonight|p\.?m\.?)\b/.test(request)) {
        const reply = 'The test offers morning consultations from 10:00 a.m. to noon Cebu time. Would a morning work?';
        if (spoken) voice.reply(reply);
        else message(reply, 'bot');
      } else if (date || /\b(book|schedule|reserve|available|availability|appointment|consultation|morning|slots?|times?)\b/.test(request)) {
        void showTimes(date, spoken);
      } else {
        const reply = 'I can help book a fictional initial consultation. What day works for you?';
        if (spoken) voice.reply(reply);
        else message(reply, 'bot');
      }
      messages.scrollTop = messages.scrollHeight;
    }

    function setupBookingVoice() {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return null;
      const row = chat.querySelector('.pearlsmile-voice-row-2026');
      const button = row.querySelector('button');
      const hint = document.createElement('small');
      hint.setAttribute('role', 'status');
      const instruction = 'Use fictional details. Your browser may send audio to its speech recognition service.';
      hint.textContent = instruction;
      row.append(hint);
      row.style.display = '';
      button.textContent = 'Speak to book';
      button.setAttribute('aria-label', 'Speak to book');
      let listening = false;
      let speaking = false;
      let busy = false;
      let offered = [];
      let pending;

      function updateButton() {
        button.disabled = listening || speaking || busy;
      }

      function reply(text) {
        hint.textContent = text;
        const utterance = new window.SpeechSynthesisUtterance(text);
        utterance.lang = 'en-PH';
        speaking = true;
        updateButton();
        utterance.onend = utterance.onerror = () => {
          speaking = false;
          updateButton();
        };
        window.speechSynthesis.speak(utterance);
      }

      function sayRequest(transcript) {
        const command = transcript.toLowerCase().trim().replace(/[.!?]+$/, '');
        if (selectedTime) {
          if (command === 'retry') void choose(selectedTime, true);
          else reply('Say retry to check the same reservation.');
          return;
        }
        if (pending && /^(confirm|yes|yes please|yes confirm|confirm booking)$/.test(command)) {
          const start = pending;
          pending = undefined;
          offered = [];
          void choose(start, true);
          return;
        }
        if (pending && /^(no|cancel|start over)$/.test(command)) {
          pending = undefined;
          reply('Which option would you prefer?');
          return;
        }
        const choice = /^(?:option )?(first|one|1|second|two|2)(?: option)?$/.exec(command)?.[1];
        if (choice) {
          pending = offered[/^(second|two|2)$/.test(choice) ? 1 : 0];
          if (pending) reply('You selected ' + clock.format(new Date(pending)) + ', Cebu time. Say confirm to book it or no to choose again.');
          else reply('Ask for consultation times first.');
          return;
        }
        pending = undefined;
        offered = [];
        sendRequest(transcript, true);
      }

      button.addEventListener('click', () => {
        if (button.disabled) return;
        const recognition = new Recognition();
        recognition.lang = 'en-PH';
        let transcript;
        let failed = false;
        recognition.onresult = event => { transcript = event.results[0]?.[0]?.transcript; };
        recognition.onerror = () => { failed = true; };
        recognition.onend = () => {
          listening = false;
          updateButton();
          if (busy || speaking) return;
          if (failed || !transcript) hint.textContent = 'Speech was unavailable. Try the microphone again or type your request.';
          else sayRequest(transcript);
        };
        try {
          recognition.start();
          listening = true;
          hint.textContent = 'Listening…';
          updateButton();
        } catch {
          hint.textContent = 'Could not start the microphone. You can type your request instead.';
        }
      });
      function clearOptions() {
        offered = [];
        pending = undefined;
      }

      return {
        reply,
        clearOptions,
        offer(slots, fallback) {
          offered = slots;
          pending = undefined;
          const options = slots.map((start, i) => `Option ${i + 1}, ${clock.format(new Date(start))}.`);
          reply(slots.length ? `${options.join(' ')} Cebu time. Say first${slots.length > 1 ? ' or second' : ''} to choose.` : fallback);
        },
        setBusy(value) {
          busy = value;
          if (value) clearOptions();
          updateButton();
        }
      };
    }

    check.addEventListener('click', () => showTimes());
    send.addEventListener('click', () => sendRequest());
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      sendRequest();
    });
  }
})();
