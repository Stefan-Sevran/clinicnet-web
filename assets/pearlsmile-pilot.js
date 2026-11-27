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
  if (calendarPilot) document.body.setAttribute('data-pearlsmile-calendar-preview', '');
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
    check.className = 'pearlsmile-pilot-action';
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
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const cebuTime = timestamp => new Date(timestamp + 8 * 60 * 60_000);
    const dayKey = date => date.toISOString().slice(0, 10);
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
      choices.className = 'pearlsmile-pilot-options';
      message('', 'bot').append(status, choices);
    }

    function requestedDay(text) {
      const today = cebuTime(Date.now());
      const iso = /\b\d{4}-\d{2}-\d{2}\b/.exec(text)?.[0];
      const named = new RegExp(`\\b(${months.join('|')}) (\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(
        text.replace(/\b(first|second|third)\b/g, word => ({ first: '1st', second: '2nd', third: '3rd' }[word])));
      let specified;
      if (named) {
        const month = months.indexOf(named[1]);
        const year = today.getUTCFullYear() + (month < today.getUTCMonth() ? 1 : 0);
        specified = new Date(Date.UTC(year, month, Number(named[2])));
        if (specified.getUTCMonth() !== month) return { conflict: true };
      } else if (iso) {
        specified = new Date(iso + 'T00:00:00Z');
        if (!Number.isFinite(specified.getTime()) || dayKey(specified) !== iso) return { conflict: true };
      }
      const days = Array.from(text.matchAll(/\b(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g), match => match[0]);
      const candidates = new Set(specified ? [dayKey(specified)] : []);
      for (const day of days) {
        const weekday = weekdays.indexOf(day);
        if (specified && weekday >= 0) {
          if (specified.getUTCDay() !== weekday) return { conflict: true };
          continue;
        }
        const offset = day === 'today' ? 0 : day === 'tomorrow' ? 1 : (weekday - today.getUTCDay() + 7) % 7;
        const date = new Date(today);
        date.setUTCDate(today.getUTCDate() + offset);
        candidates.add(dayKey(date));
      }
      const date = candidates.values().next().value;
      const ordinal = /\b(\d{1,2})(?:st|nd|rd|th)\b/.exec(text);
      const conflict = candidates.size > 1 || Boolean(date && ordinal && Number(date.slice(-2)) !== Number(ordinal[1]));
      return { date, conflict };
    }

    function requestedTime(text) {
      const match = /\bat\s+(\d{1,2})(?::([0-5]\d))?\s*([ap]\.?m\.?)?\b|\b(\d{1,2})(?::([0-5]\d))?\s*([ap]\.?m\.?)\b/.exec(text);
      if (!match) return undefined;
      let hour = Number(match[1] || match[4]);
      const suffix = match[3] || match[6];
      if (suffix) hour = hour % 12 + (suffix.startsWith('p') ? 12 : 0);
      return hour * 60 + Number(match[2] || match[5] || 0);
    }

    async function calendarRequest(data, date) {
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
        const result = await calendarRequest({ start, requestId });
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

    function renderSlots(slots, date) {
      status.textContent = slots.length ? 'Which consultation time works for you? All times are in Cebu time.' :
        date ? 'I don’t have open consultation times that day. Would another day work?' :
          'There are no open consultation times in the next seven days.';
      for (const start of slots) {
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.className = 'pearlsmile-pilot-action';
        choice.dataset.start = start;
        choice.textContent = clock.format(new Date(start));
        choice.addEventListener('click', () => choose(start));
        choices.append(choice);
      }
      messages.scrollTop = messages.scrollHeight;
    }

    async function showTimes(date) {
      if (working) return;
      working = true;
      setAvailabilityControls(true);
      openReply();
      status.textContent = 'Checking the test calendar…';
      try {
        const { slots } = await calendarRequest(undefined, date);
        if (date && slots.some(start => cebuTime(Date.parse(start)).toISOString().slice(0, 10) !== date)) {
          throw Error('I could not check that day. Try again or show all consultation times.');
        }
        renderSlots(slots, date);
      } catch (error) {
        status.textContent = error.message;
        if (error.invalidLink) return;
      } finally {
        working = false;
        messages.scrollTop = messages.scrollHeight;
      }
      setAvailabilityControls(false);
    }

    function sendRequest(raw = input.value) {
      const text = raw.trim().slice(0, 240);
      if (!text || working || selectedTime) return;
      voice?.clearOptions();
      input.value = '';
      message(text, 'user');
      choices?.querySelectorAll('button').forEach(button => { button.disabled = true; });
      const request = text.toLowerCase();
      const { date, conflict } = requestedDay(request);
      const time = requestedTime(request);
      if (conflict) {
        const reply = 'I heard different dates. Which date should I check?';
        message(reply, 'bot');
      } else if (/\b(afternoon|evening|tonight|p\.?m\.?)\b/.test(request) ||
          (time !== undefined && (time < 600 || time >= 720))) {
        const reply = 'The test offers morning consultations from 10:00 a.m. to noon Cebu time. Would a morning work?';
        message(reply, 'bot');
      } else if (date || /\b(book|schedule|reserve|available|availability|appointment|consultation|morning|slots?|times?|days)\b/.test(request)) {
        void showTimes(date);
      } else {
        const reply = 'I can help book a fictional initial consultation. What day works for you?';
        message(reply, 'bot');
      }
      messages.scrollTop = messages.scrollHeight;
    }

    function setupBookingVoice() {
      if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) return null;
      const row = chat.querySelector('.pearlsmile-voice-row-2026');
      const button = row.querySelector('button');
      const hint = document.createElement('small');
      hint.className = 'pearlsmile-pilot-voice-status';
      hint.setAttribute('role', 'status');
      hint.textContent = 'Use fictional details. Microphone audio is processed by OpenAI.';
      row.append(hint);
      row.style.display = '';

      let call;
      let busy = false;
      let speaking = false;
      let offered = [];
      let pending;
      let turn = 0;
      let offerTurn = -1;
      let lastTranscript = '';

      function updateMic() {
        for (const track of call?.stream?.getAudioTracks() || []) {
          track.enabled = call.channel?.readyState === 'open' && !busy && !speaking;
        }
      }

      function clearOptions() {
        offered = [];
        pending = undefined;
      }

      function endCall(text = 'Voice ended. You can continue by chat.') {
        const current = call;
        call = undefined;
        if (!current) return;
        clearTimeout(current.lifetime);
        clearTimeout(current.replyTimeout);
        current.stream?.getTracks().forEach(track => track.stop());
        current.peer?.close();
        current.audio?.remove();
        speaking = false;
        clearOptions();
        button.disabled = false;
        button.textContent = '🎙️ Talk to Maria';
        button.setAttribute('aria-label', 'Talk to Maria');
        hint.textContent = text;
      }

      function sendEvent(event) {
        call.channel.send(JSON.stringify(event));
      }

      function respond(instructions, exact = false, afterReadback = false, allowTools = !instructions) {
        if (call?.channel?.readyState !== 'open') return;
        if (!exact) hint.textContent = 'Maria is responding…';
        speaking = true;
        updateMic();
        clearTimeout(call.replyTimeout);
        call.replyTimeout = setTimeout(() => endCall('Voice stopped responding. You can continue by chat.'), 25_000);
        call.response = { exact, afterReadback, tools: [] };
        const response = exact
          ? { conversation: 'none', input: [], tool_choice: 'none', instructions: 'Speak this exact text with no additions: ' + JSON.stringify(instructions) }
          : { ...(instructions ? { instructions } : {}), ...(allowTools ? {} : { tool_choice: 'none' }) };
        sendEvent({ type: 'response.create', response });
      }

      function reply(text, afterReadback = false) {
        hint.textContent = text;
        respond(text, true, afterReadback);
      }

      function sayRequest(transcript) {
        const command = transcript.toLowerCase().trim().replace(/[.!?]+$/, '');
        if (!command) return;
        turn++;
        lastTranscript = command;
        message(transcript.trim().slice(0, 240), 'user');
        messages.scrollTop = messages.scrollHeight;
        if (selectedTime) {
          if (command === 'retry' || command === 'please retry') void choose(selectedTime, true);
          else reply('Say retry to check the same reservation.');
          return;
        }
        if (pending?.read && /^(?:yes[ ,]+)?(?:(?:i )?confirm(?: it| booking)?|book it|go ahead|yes|yes please|please do|that works)$/.test(command)) {
          const { start } = pending;
          clearOptions();
          void choose(start, true);
          return;
        }
        pending = undefined;
        if (requestedDay(command).conflict) {
          const text = 'I heard different dates. Which date should I check?';
          message(text, 'bot');
          messages.scrollTop = messages.scrollHeight;
          reply(text);
          return;
        }
        respond();
      }

      async function runTool(item, current) {
        if (working || selectedTime) return { error: 'A booking is being processed.' };
        const args = JSON.parse(item.arguments || '{}');
        const { date: saidDate } = requestedDay(lastTranscript);
        if (item.name === 'list_consultation_times') {
          const date = saidDate || args.date || undefined;
          const { slots } = await calendarRequest(undefined, date);
          if (call !== current || working || selectedTime) return { error: 'The calendar request was interrupted.' };
          const nextDay = !date && slots.length > 1
            ? slots.find(start => dayKey(cebuTime(Date.parse(start))) !== dayKey(cebuTime(Date.parse(slots[0]))))
            : undefined;
          offered = nextDay ? [slots[0], nextDay] : slots.slice(0, 2);
          offerTurn = turn;
          openReply();
          renderSlots(offered, date);
          return { slots: offered.map(start => ({ start, cebu: clock.format(new Date(start)) })), timeZone: 'Asia/Manila' };
        }
        if (item.name === 'select_consultation_time' && offerTurn < turn && offered.includes(args.start)) {
          const local = cebuTime(Date.parse(args.start));
          const saidTime = requestedTime(lastTranscript);
          const first = /\b(first|option (?:one|1))\b/.test(lastTranscript);
          const second = /\b(second|option (?:two|2))\b/.test(lastTranscript);
          if ((saidDate && dayKey(local) !== saidDate) ||
              (saidTime !== undefined && local.getUTCHours() * 60 + local.getUTCMinutes() !== saidTime) ||
              (!saidDate && saidTime === undefined && ((first && args.start !== offered[0]) ||
                (second && args.start !== offered[1]))) ||
              /\b(no|not|don.t|cancel)\b/.test(lastTranscript)) {
            return { error: 'Ask which exact offered appointment the patient wants.' };
          }
          pending = { start: args.start, read: false };
          return { selected: true, reserved: false };
        }
        return { error: 'Ask the patient to choose an available time from the most recent calendar result.' };
      }

      async function finishResponse(current, response) {
        if (call !== current || current.response !== response) return;
        if (!response.tools.length) {
          clearTimeout(current.replyTimeout);
          if (response.afterReadback && pending) pending.read = true;
          speaking = false;
          if (!response.exact) hint.textContent = 'Listening…';
          updateMic();
          return;
        }
        if (response.handling) return;
        response.handling = true;
        let result;
        try {
          result = await runTool(response.tools[0], current);
        } catch {
          result = { error: 'The calendar could not be checked. Say so and offer to try again.' };
        }
        if (call !== current) return;
        for (const [index, item] of response.tools.entries()) {
          sendEvent({ type: 'conversation.item.create', item: {
            type: 'function_call_output', call_id: item.call_id,
            output: JSON.stringify(index === 0 ? result : { error: 'One calendar action per turn. Wait for the next user reply.' })
          } });
        }
        if (pending) {
          const text = 'I have ' + clock.format(new Date(pending.start)) + ', Cebu time. Shall I book it for you?';
          message(text, 'bot');
          messages.scrollTop = messages.scrollHeight;
          reply(text, true);
        } else {
          respond(undefined, false, false, false);
        }
      }

      async function startCall() {
        const current = {};
        call = current;
        hint.textContent = 'Connecting voice…';
        button.disabled = true;
        try {
          current.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          current.peer = new window.RTCPeerConnection();
          const audio = document.createElement('audio');
          audio.autoplay = true;
          row.append(audio);
          current.audio = audio;
          current.peer.ontrack = event => { audio.srcObject = event.streams[0]; };
          for (const track of current.stream.getAudioTracks()) {
            track.enabled = false;
            current.peer.addTrack(track, current.stream);
          }
          const channel = current.peer.createDataChannel('oai-events');
          current.channel = channel;
          channel.onopen = () => {
            if (call !== current) return;
            button.disabled = false;
            button.textContent = 'End voice';
            button.setAttribute('aria-label', 'End voice');
            respond('Greet the patient warmly as Maria at PearlSmile Dental. Briefly explain this is a test appointment, then ask one question about their preferred day.');
          };
          channel.onclose = () => { if (call === current) endCall(); };
          channel.onmessage = event => {
            if (call !== current) return;
            let data;
            try { data = JSON.parse(event.data); } catch { return; }
            const response = current.response;
            if (data.type === 'response.created' && response) {
              response.id = data.response.id;
            } else if (data.type === 'response.done' && response?.id === data.response?.id) {
              if (data.response.status === 'failed') {
                endCall('Voice is unavailable right now. You can continue by chat.');
                return;
              }
              const output = data.response.output || [];
              response.tools = response.exact ? [] : output.filter(item => item.type === 'function_call');
              if (!output.some(item => item.content?.some(part => ['output_audio', 'audio'].includes(part.type)))) {
                if (response.afterReadback) pending = undefined;
                void finishResponse(current, response);
              }
            } else if (data.type === 'output_audio_buffer.stopped' && response?.id === data.response_id) {
              void finishResponse(current, response);
            } else if (data.type === 'response.output_audio_transcript.done' && response?.id === data.response_id &&
                !response.exact && data.transcript) {
              message(data.transcript, 'bot');
              messages.scrollTop = messages.scrollHeight;
            } else if (data.type === 'error') {
              endCall('Voice is unavailable right now. You can continue by chat.');
            } else if (!busy && !speaking) {
              if (data.type === 'conversation.item.input_audio_transcription.completed' && typeof data.transcript === 'string') {
                sayRequest(data.transcript);
              } else if (data.type === 'conversation.item.input_audio_transcription.failed') {
                reply('I missed that. Could you say it again?');
              }
            }
          };
          const offer = await current.peer.createOffer();
          await current.peer.setLocalDescription(offer);
          const response = await fetch(api + '/pilots/pearlsmile/patient-voice?flow=conversation', {
            method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(25_000),
            headers: { Authorization: 'Bearer ' + patientToken, 'Content-Type': 'application/sdp' },
            body: offer.sdp
          });
          if (!response.ok) throw Error('Voice session unavailable');
          await current.peer.setRemoteDescription({ type: 'answer', sdp: await response.text() });
          current.lifetime = setTimeout(() => endCall('The voice test ended. You can continue by chat.'), 5 * 60_000);
          if (channel.readyState !== 'open') {
            current.replyTimeout = setTimeout(() => endCall('Voice could not connect. You can continue by chat.'), 15_000);
          }
        } catch {
          if (current === call) endCall('Voice could not connect. Check microphone access or continue by chat.');
        }
      }

      button.addEventListener('click', () => {
        if (call) endCall();
        else void startCall();
      });
      window.addEventListener('pagehide', () => endCall());
      return {
        reply,
        clearOptions,
        setBusy(value) {
          busy = value;
          if (value) clearOptions();
          updateMic();
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
