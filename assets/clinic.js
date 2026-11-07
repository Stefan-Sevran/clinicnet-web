(() => {
  'use strict';
  const API = 'https://eden-webhook-ixdd.onrender.com';
  const byId = id => document.getElementById(id);
  const state = { client: null, session: null, accounts: [], locations: [], connections: [], followups: new Map(), generation: 0 };
  const messengerStorageKey = 'eden-messenger-oauth';
  const query = new URLSearchParams(location.search);
  let messengerReturn = query.get('state')?.startsWith('eden-messenger.') ? {
    state: query.get('state'), code: query.get('code')
  } : null;
  if (messengerReturn) history.replaceState(null, '', location.pathname);
  let messengerSetupAvailable = false;
  let legacyMessengerConnect = null;
  let messengerSetups = [];
  const alertEmailForm = byId('clinic-alert-email-form');
  const alertEmailInput = byId('clinic-alert-email');
  const alertEmailStatus = byId('clinic-alert-email-status');
  const soundButton = byId('clinic-inbox-sound');
  const soundHelp = byId('clinic-inbox-sound-help');
  const pearlPilotLink = document.createElement('a');
  pearlPilotLink.href = '/pearlsmile-cebu/?workspace-pilot=1#pearlsmile-reception-chat-2026';
  pearlPilotLink.textContent = 'Open PearlSmile chat pilot';
  pearlPilotLink.hidden = true;
  byId('clinic-inbox').before(pearlPilotLink);
  const commentPilotPanel = document.createElement('section');
  commentPilotPanel.className = 'clinic-events';
  commentPilotPanel.hidden = true;
  byId('clinic-inbox').before(commentPilotPanel);
  const daily = document.createElement('div');
  daily.className = 'clinic-daily';
  daily.hidden = true;
  daily.innerHTML = `
    <section class="clinic-panel clinic-daily-primary" aria-labelledby="clinic-attention-title">
      <h2 id="clinic-attention-title">Needs attention <span id="clinic-attention-count" class="clinic-daily-count"></span></h2>
      <p>Unclaimed inquiries from the recent inbox, oldest first.</p>
      <div id="clinic-attention" class="clinic-events"></div>
    </section>
    <div class="clinic-daily-columns">
      <section class="clinic-panel" aria-labelledby="clinic-assigned-title">
        <h2 id="clinic-assigned-title">Assigned to me <span id="clinic-assigned-count" class="clinic-daily-count"></span></h2>
        <p>Inquiries you claimed and can follow up on.</p>
        <div id="clinic-assigned" class="clinic-events"></div>
      </section>
      <section class="clinic-panel" aria-labelledby="clinic-today-title">
        <h2 id="clinic-today-title">Today's appointments <span id="clinic-today-count" class="clinic-daily-count"></span></h2>
        <p id="clinic-today-date"></p>
        <div id="clinic-today" class="clinic-events"></div>
      </section>
    </div>`;
  document.querySelector('.clinic-selectors').after(daily);
  const channelPanel = byId('clinic-channels').closest('.clinic-panel');
  const channelColumns = channelPanel.parentElement;
  document.querySelector('.clinic-next').before(channelPanel);
  channelColumns.classList.remove('clinic-columns');
  let canEditAlertEmail = false;
  let staffEmailAvailable = false;
  let soundContext;
  let soundTimer;
  let backgroundRefresh = false;
  let loadedGeneration = -1;
  let inboxSnapshot;

  const labels = { website_chat: 'Website chat', facebook_messenger: 'Facebook Messenger', ai_phone: 'AI phone' };
  const followupKinds = ['call.followup_needed', 'booking.requested', 'inquiry.followup_needed'];
  const show = (id, visible) => { byId(id).hidden = !visible; };
  const status = (message, kind = 'info') => {
    byId('clinic-status').textContent = message;
    byId('clinic-status').dataset.kind = kind;
  };
  const empty = (container, message) => {
    container.replaceChildren();
    const p = document.createElement('p');
    p.className = 'clinic-empty';
    p.textContent = message;
    container.append(p);
  };
  const selectOptions = (select, rows, selected, label) => {
    select.replaceChildren();
    for (const row of rows) select.add(new Option(row[label], row.id));
    if (rows.some(row => row.id === selected)) select.value = selected;
  };

  async function request(path, options = {}) {
    if (!state.session?.access_token) throw Error('Please sign in again.');
    const response = await fetch(API + path, {
      ...options,
      headers: { Authorization: 'Bearer ' + state.session.access_token,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
    });
    if (!response.ok) {
      if (response.status === 401) throw Error('Your session has expired. Please sign in again.');
      if (response.status === 403) throw Error('This account does not permit that action.');
      if (path === '/clinic/messenger/finish' && response.status === 422) {
        throw Error('Facebook did not grant access to the Page for this location. Sign in with a profile that manages the Page, then select it under Edit settings.');
      }
      if (path === '/clinic/messenger/finish' && response.status === 409) {
        throw Error('That Facebook Page or clinic location already has a Messenger connection. Open the workspace that manages it.');
      }
      if (response.status === 409) {
        const error = Error(path === '/clinic/followups' ?
          'This inquiry changed. Review its current state before trying again.' :
          'That channel has already been requested.');
        error.status = 409;
        throw error;
      }
      throw Error('Workspace request failed (' + response.status + '). Please retry.');
    }
    return response.json();
  }

  async function refreshAccounts(preferred) {
    const generation = ++state.generation;
    const accounts = await request('/clinic/accounts');
    if (generation !== state.generation) return;
    state.accounts = accounts;
    show('clinic-create', accounts.length === 0);
    show('clinic-dashboard', accounts.length > 0);
    if (!accounts.length) return status('You are signed in. Create your first workspace.');
    selectOptions(byId('clinic-account'), accounts, preferred || byId('clinic-account').value, 'name');
    await refreshLocations();
  }

  async function refreshLocations() {
    const generation = ++state.generation;
    const accountId = byId('clinic-account').value;
    if (!accountId) return;
    if (alertEmailForm) alertEmailForm.hidden = true;
    const [locations, membership, setups] = await Promise.all([
      request('/clinic/locations?accountId=' + encodeURIComponent(accountId)),
      (alertEmailForm || (!messengerSetupAvailable && legacyMessengerConnect?.accountId === accountId)) &&
        state.client.from('clinic_memberships').select('role')
        .eq('account_id', accountId).eq('user_id', state.session.user.id).maybeSingle(),
      messengerSetupAvailable ? request('/clinic/messenger/setups?accountId=' + encodeURIComponent(accountId))
        .catch(() => []) : []
    ]);
    if (generation !== state.generation) return;
    state.locations = locations;
    canEditAlertEmail = ['owner', 'admin'].includes(membership?.data?.role);
    messengerSetups = setups.map(setup => ({ ...setup, accountId }));
    if (!messengerSetupAvailable && canEditAlertEmail && legacyMessengerConnect?.accountId === accountId) {
      messengerSetups = [legacyMessengerConnect];
    }
    selectOptions(byId('clinic-location'), locations, byId('clinic-location').value, 'name');
    loadAlertEmail();
    await refreshActivity();
  }

  function renderChannels() {
    const container = byId('clinic-channels');
    container.replaceChildren();
    for (const [channel, name] of Object.entries(labels)) {
      const connection = state.connections.find(item => item.channel === channel);
      const row = document.createElement('div');
      row.className = 'clinic-channel';
      const info = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = name;
      const detail = document.createElement('small');
      detail.textContent = connection ? 'Status: ' + connection.status.replace(/_/g, ' ') +
        (channel === 'ai_phone' && connection.forwarding_number ? ' · Destination: ' + connection.forwarding_number : '') : 'Not requested';
      info.append(title, detail);
      row.append(info);
      const messengerSetup = channel === 'facebook_messenger' && messengerSetups.find(setup =>
        setup.accountId === byId('clinic-account').value && setup.locationId === byId('clinic-location').value);
      if (messengerSetup) {
        const page = messengerSetup.clinicName || 'your Facebook Page';
        const verifying = connection?.status === 'verifying';
        const connected = connection?.status === 'connected';
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'clinic-secondary';
        button.textContent = verifying ? 'Check connection' : connected ? 'Reconnect Messenger' : 'Connect Messenger';
        button.addEventListener('click', () => verifying ? checkMessenger(button) : startMessenger(button, messengerSetup));
        row.append(button);
        detail.textContent = verifying ? 'Facebook approved. Send ' + page +
          ' a private test booking request, then check the connection.' :
          connected ? 'Connected · ' + page :
            'Choose ' + page + ' in Facebook and approve access.';
        if (verifying && messengerSetup.pageUrl) {
          const testLink = document.createElement('a');
          testLink.href = messengerSetup.pageUrl;
          testLink.target = '_blank';
          testLink.rel = 'noopener noreferrer';
          testLink.textContent = 'Open Facebook Page';
          const linkRow = document.createElement('small');
          linkRow.append(testLink);
          info.append(linkRow);
        }
      } else if (!connection) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = 'Request'; button.className = 'clinic-secondary';
        button.addEventListener('click', () => requestConnection(channel, button));
        row.append(button);
      }
      container.append(row);
    }
  }

  function renderEvents(id, events, fallback, dailyAction) {
    const container = byId(id);
    if (!events.length) return empty(container, fallback);
    container.replaceChildren();
    for (const event of events) {
      const row = document.createElement('article'); row.className = 'clinic-event';
      const title = document.createElement('strong'); title.textContent = event.summary || event.kind || 'Activity';
      const needsFollowup = followupKinds.includes(event.kind) && event.event_key;
      const meta = document.createElement('small');
      meta.textContent = [labels[event.channel] || event.channel,
        needsFollowup ? null : event.status,
        dailyAction && dailyAction !== 'today' ? waitingTime(event.occurred_at) :
          event.occurred_at && !dailyAction ? new Date(event.occurred_at).toLocaleString() : ''].filter(Boolean).join(' · ');
      row.append(title, meta);
      if (needsFollowup) {
        if (event.channel === 'facebook_messenger' && event.details?.service) {
          const service = document.createElement('small');
          service.textContent = 'Service · ' + event.details.service;
          row.append(service);
        }
        if (event.details?.requestedTime) {
          const timing = document.createElement('small');
          timing.textContent = event.details.requestedTime;
          row.append(timing);
        }
        const alert = document.createElement('small');
        const alertLabels = {
          sent: 'Email alert: sent to provider',
          pending: 'Email alert: pending',
          sending: 'Email alert: sending',
          retry: 'Email alert: retry pending',
          failed: 'Email alert: delivery failed',
          not_configured: 'Email alert: no destination configured'
        };
        alert.textContent = event.details?.demo === true ? 'Fictional sample · No patient or email notification' :
          alertLabels[event.notification_state] || 'Email alert: status unavailable';
        if (!dailyAction || event.details?.demo === true) row.append(alert);
        const latest = state.followups.get(event.event_key);
        const ownClaim = latest?.actor_user_id === state.session?.user?.id;
        const followup = document.createElement('small');
        followup.textContent = {
          booked: 'Booked',
          claimed: ownClaim ? (event.channel === 'facebook_messenger' ?
            'Claimed by you · Reply in Messenger to confirm a time' : 'Claimed by you · Follow up with the patient') :
            'Claimed by another staff member',
          handled: 'Staff follow-up: handled'
        }[latest?.action] || {
          'call.followup_needed': 'Needs callback',
          'booking.requested': 'Needs confirmation',
          'inquiry.followup_needed': 'Needs staff reply'
        }[event.kind];
        row.append(followup);
        if (event.channel === 'facebook_messenger' && /^\d{5,30}$/.test(event.details?.pageId || '') &&
            !['booked', 'handled'].includes(latest?.action)) {
          const inboxLink = document.createElement('a');
          inboxLink.href = 'https://business.facebook.com/latest/inbox/all/?asset_id=' + event.details.pageId;
          inboxLink.target = '_blank';
          inboxLink.rel = 'noopener noreferrer';
          inboxLink.textContent = ownClaim ? 'Reply in Messenger' : 'Open Page inbox';
          const inboxLinkRow = document.createElement('small');
          inboxLinkRow.append(inboxLink);
          row.append(inboxLinkRow);
        }
        if (latest?.appointment_at) {
          const appointment = document.createElement('small');
          const timeZone = clinicTimeZone(event.location_id);
          appointment.textContent = 'Appointment · ' + new Date(latest.appointment_at).toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            timeZone, timeZoneName: 'short'
          });
          row.append(appointment);
        }
        const actions = dailyAction === 'claim' ? [['claimed', 'Claim inquiry']] :
          dailyAction === 'book' ? [['booked', 'Mark booked']] :
          latest?.action === 'booked' ? [] :
          latest?.action === 'claimed' ? (ownClaim ? [
            ['booked', 'Mark booked'], ['reopened', 'Release claim'], ['handled', 'Mark handled']
          ] : []) :
          latest?.action === 'handled' ? [['reopened', 'Reopen']] :
          [['claimed', 'Claim inquiry'], ['handled', 'Mark handled']];
        if (actions.length) {
          const controls = document.createElement('div');
          for (const [action, label] of actions) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = dailyAction ? 'clinic-followup-button' : 'clinic-secondary clinic-followup-button';
            button.textContent = label;
            button.addEventListener('click', () => {
              if (action === 'booked') showAppointmentEditor(event, controls, button);
              else updateFollowup(event, action, controls);
            });
            controls.append(button);
          }
          row.append(controls);
        }
      }
      container.append(row);
    }
  }

  function clinicTimeZone(locationId) {
    const timezone = state.locations.find(location => location.id === locationId)?.timezone;
    try {
      return new Intl.DateTimeFormat(undefined, { timeZone: timezone }).resolvedOptions().timeZone;
    } catch {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  }

  function waitingTime(value) {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return '';
    const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
    if (minutes < 1) return 'Just arrived';
    if (minutes < 60) return 'Waiting ' + minutes + 'm';
    if (minutes < 1440) return 'Waiting ' + Math.floor(minutes / 60) + 'h';
    return 'Waiting ' + Math.floor(minutes / 1440) + 'd';
  }

  function renderDailyWork(inbox, locationId) {
    const timezone = clinicTimeZone(locationId);
    const dateLabel = new Intl.DateTimeFormat(undefined, { timeZone: timezone, dateStyle: 'full' });
    const today = dateLabel.format(new Date());
    const attention = [], assigned = [], appointments = [];
    for (const event of inbox) {
      if (!event.event_key || !followupKinds.includes(event.kind)) continue;
      const latest = state.followups.get(event.event_key);
      if (!latest || latest.action === 'reopened') attention.push(event);
      if (latest?.action === 'claimed' && latest.actor_user_id === state.session?.user?.id) assigned.push(event);
      const appointment = Date.parse(latest?.appointment_at);
      if (latest?.action === 'booked' && Number.isFinite(appointment) &&
          dateLabel.format(appointment) === today) appointments.push(event);
    }
    const oldestFirst = (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
    appointments.sort((a, b) =>
      Date.parse(state.followups.get(a.event_key).appointment_at) -
      Date.parse(state.followups.get(b.event_key).appointment_at));
    for (const [id, events, message, action] of [
      ['clinic-attention', attention.sort(oldestFirst), 'No unclaimed inquiries in the recent inbox.', 'claim'],
      ['clinic-assigned', assigned.sort(oldestFirst), 'No recent inquiries assigned to you.', 'book'],
      ['clinic-today', appointments, 'No confirmed appointments for today in the recent inbox.', 'today']
    ]) {
      const samples = events.filter(event => event.details?.demo === true).length;
      byId(id + '-count').textContent = samples ? (events.length - samples) + ' · ' + samples +
        (samples === 1 ? ' sample' : ' samples') : String(events.length);
      renderEvents(id, events, message, action);
    }
    byId('clinic-today-date').textContent = today + ' · ' + timezone + ' · Recent inbox';
    daily.hidden = false;
  }

  function showAppointmentEditor(event, controls, opener) {
    const form = document.createElement('form');
    form.className = 'clinic-appointment-editor';
    form.innerHTML = '<label>Confirmed appointment <input type="datetime-local" required></label>' +
      '<small></small><button type="submit" class="clinic-secondary">Save booking</button>' +
      '<button type="button" class="clinic-secondary">Cancel</button>';
    form.querySelector('small').textContent = 'Enter the time in your device time zone (' +
      Intl.DateTimeFormat().resolvedOptions().timeZone + ').';
    const input = form.querySelector('input');
    form.querySelector('[type="button"]').addEventListener('click', () => {
      form.remove(); opener.disabled = false; opener.focus();
    });
    form.addEventListener('submit', async submission => {
      submission.preventDefault();
      const appointment = new Date(input.value);
      if (!Number.isFinite(appointment.getTime())) return;
      const localTime = new Date(appointment.getTime() - appointment.getTimezoneOffset() * 60000);
      if (localTime.toISOString().slice(0, 16) !== input.value) {
        input.setCustomValidity('Choose an available local time.');
        input.reportValidity();
        return;
      }
      input.disabled = true;
      await updateFollowup(event, 'booked', controls, appointment.toISOString());
      input.disabled = false;
      opener.disabled = true;
    });
    opener.disabled = true;
    input.addEventListener('input', () => input.setCustomValidity(''));
    controls.append(form);
    input.focus();
  }

  async function updateFollowup(event, action, controls, appointmentAt) {
    const buttons = [...controls.querySelectorAll('button')];
    const generation = state.generation;
    buttons.forEach(button => { button.disabled = true; });
    try {
      await request('/clinic/followups', { method: 'POST', body: JSON.stringify({
        accountId: event.account_id,
        locationId: event.location_id,
        eventKey: event.event_key, action, appointmentAt
      }) });
      if (state.generation !== generation) return;
      await refreshActivity();
      status({
        claimed: 'Inquiry moved to Assigned to me. Mark it booked after the patient confirms.',
        booked: 'Booking outcome recorded.',
        handled: 'Follow-up marked handled.',
        reopened: 'Inquiry available for follow-up.'
      }[action], 'success');
    } catch (error) {
      if (state.generation !== generation) return;
      if (error.status === 409) await refreshActivity().catch(() => {});
      status(error.message, 'error');
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function renderBookingOutcomes(inbox) {
    const outcomes = inbox.filter(event => state.followups.get(event.event_key)?.action === 'booked');
    const demos = outcomes.filter(event => event.details?.demo === true);
    byId('clinic-booked-count').textContent = (outcomes.length - demos.length) + ' clinic · ' + demos.length + ' sample';
    renderEvents('clinic-booked-outcomes', outcomes, 'No confirmed booking outcomes in the recent inbox.');
  }

  function renderCommentPilot(inbox) {
    const postId = inbox.find(event => /^\d{5,30}_\d{5,30}$/.test(event.details?.commentPilotPostId || ''))
      ?.details.commentPilotPostId;
    commentPilotPanel.hidden = !postId;
    commentPilotPanel.replaceChildren();
    if (!postId) return;

    const [pageId, storyId] = postId.split('_');
    const events = inbox.filter(event => event.details?.commentPilotPostId === postId);
    const drafts = events.filter(event => event.kind === 'comment.draft');
    const messages = events.filter(event => event.kind === 'comment.messenger_started');
    const bookings = events.filter(event => event.kind === 'booking.requested');
    const confirmed = bookings.filter(event => state.followups.get(event.event_key)?.action === 'booked');
    const title = document.createElement('h3');
    title.textContent = 'Facebook comment pilot';
    const totals = document.createElement('p');
    totals.textContent = `Drafts ${drafts.length} · Tagged Messenger conversations ${messages.length} · Booking requests ${bookings.length} · Confirmed ${confirmed.length}`;
    const help = document.createElement('p');
    help.textContent = 'Counts cover the latest 100 inbox items for this location. Review the original comment, then copy and post any reply you approve in Facebook.';
    commentPilotPanel.append(title, totals, help);

    for (const event of drafts) {
      const { commentId, publicDraft } = event.details;
      if (!/^\d{5,30}(?:_\d{5,30})?$/.test(commentId || '') || typeof publicDraft !== 'string') continue;
      const url = new URL('https://www.facebook.com/permalink.php');
      url.search = new URLSearchParams({ id: pageId, story_fbid: storyId, comment_id: commentId.split('_').at(-1) });
      const card = document.createElement('article');
      card.className = 'clinic-event';
      const draft = document.createElement('p');
      draft.textContent = publicDraft;
      const link = document.createElement('a');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open comment in Facebook';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'clinic-secondary';
      copy.textContent = 'Copy draft';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(publicDraft);
          copy.textContent = 'Draft copied';
        } catch {
          copy.textContent = 'Select and copy the draft text';
        }
      });
      const actions = document.createElement('div');
      actions.className = 'clinic-toolbar';
      actions.append(link, copy);
      card.append(draft, actions);
      commentPilotPanel.append(card);
    }
  }

  async function refreshActivity(quiet = false) {
    if (!quiet) commentPilotPanel.hidden = true;
    const generation = quiet ? state.generation : ++state.generation;
    const accountId = byId('clinic-account').value;
    const locationId = byId('clinic-location').value;
    if (!accountId || !locationId) return;
    const query = '?accountId=' + encodeURIComponent(accountId) + '&locationId=' + encodeURIComponent(locationId);
    const [connections, bookings, inbox, followups] = await Promise.all([
      request('/clinic/connections' + query), request('/clinic/bookings' + query),
      request('/clinic/inbox' + query + '&limit=100'), request('/clinic/followups' + query)
    ]);
    if (generation !== state.generation || (quiet && document.querySelector('.clinic-appointment-editor'))) return;
    state.connections = connections;
    state.followups = new Map(followups.map(row => [row.event_key, row]));
    pearlPilotLink.hidden = locationId !== 'b865c71a-e9f1-4b09-acb5-0b5043ab4307';
    renderChannels();
    renderEvents('clinic-bookings', bookings.filter(event => event.details?.demo !== true),
      'No booking requests yet. Requests will appear when a verified channel delivers them.');
    renderEvents('clinic-inbox', inbox.filter(event => !['comment.draft', 'comment.messenger_started'].includes(event.kind)),
      'No activity yet for this location.');
    renderCommentPilot(inbox);
    renderBookingOutcomes(inbox);
    renderDailyWork(inbox, locationId);
    const keys = inboxAlertKeys(inbox);
    if (soundContext?.state === 'running' && !document.hidden && inboxSnapshot?.locationId === locationId &&
        [...keys].some(key => !inboxSnapshot.keys.has(key))) playInboxSound();
    inboxSnapshot = { locationId, keys };
    loadedGeneration = generation;
    if (!quiet) status('Workspace loaded for ' + state.locations.find(row => row.id === locationId)?.name + '.', 'success');
  }

  function showAlertEmailStatus(message = '', kind = 'info') {
    if (!alertEmailStatus) {
      if (message) status(message, kind);
      return;
    }
    alertEmailStatus.className = message ? 'clinic-status' : '';
    alertEmailStatus.dataset.kind = kind;
    alertEmailStatus.textContent = message;
  }

  function loadAlertEmail() {
    if (!alertEmailForm) return;
    const location = state.locations.find(row => row.id === byId('clinic-location').value);
    alertEmailForm.hidden = !staffEmailAvailable || !canEditAlertEmail || !location;
    alertEmailInput.value = location?.alert_email || '';
    showAlertEmailStatus();
  }

  alertEmailInput?.addEventListener('input', () => showAlertEmailStatus());
  alertEmailForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const accountId = byId('clinic-account').value;
    const locationId = byId('clinic-location').value;
    const alertEmail = alertEmailInput.value.trim() || null;
    const button = alertEmailForm.querySelector('button');
    if (button.disabled) return;
    const isCurrentLocation = () => byId('clinic-account').value === accountId &&
      byId('clinic-location').value === locationId;
    button.disabled = true;
    alertEmailInput.disabled = true;
    button.textContent = 'Saving…';
    showAlertEmailStatus('Saving staff alert email…');
    try {
      const { data, error } = await state.client.from('clinic_locations')
        .update({ alert_email: alertEmail }).eq('account_id', accountId).eq('id', locationId)
        .select('id,alert_email').maybeSingle();
      if (error || !data) throw Error('Could not save the staff alert email. Check the address and your workspace access.');
      const location = state.locations.find(row => row.id === data.id);
      if (location) location.alert_email = data.alert_email;
      if (isCurrentLocation()) {
        showAlertEmailStatus(alertEmail ? 'Staff alert email saved.' : 'Staff email alerts turned off for this location.', 'success');
      }
    } catch (error) {
      if (isCurrentLocation()) showAlertEmailStatus(error.message, 'error');
    } finally {
      button.textContent = 'Save email';
      button.disabled = false;
      alertEmailInput.disabled = false;
    }
  });

  function inboxAlertKeys(inbox) {
    return new Set(inbox.filter(event => followupKinds.includes(event.kind))
      .map(event => event.event_key).filter(Boolean));
  }

  function playInboxSound() {
    const tone = soundContext.createOscillator();
    const volume = soundContext.createGain();
    const now = soundContext.currentTime;
    tone.frequency.value = 780;
    volume.gain.setValueAtTime(0.001, now);
    volume.gain.exponentialRampToValueAtTime(0.16, now + 0.025);
    volume.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
    tone.connect(volume);
    volume.connect(soundContext.destination);
    tone.start(now);
    tone.stop(now + 0.36);
  }

  function stopInboxSound() {
    clearInterval(soundTimer);
    soundTimer = undefined;
    soundContext?.close().catch(() => {});
    soundContext = undefined;
    soundButton?.setAttribute('aria-pressed', 'false');
    if (soundHelp) soundHelp.textContent = 'Sound off. Turn it on to hear a preview.';
  }

  soundButton?.addEventListener('click', async () => {
    if (soundContext) {
      stopInboxSound();
      return;
    }
    soundButton.disabled = true;
    if (soundHelp) soundHelp.textContent = 'Enabling inbox sound…';
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw Error('Inbox sound is unavailable in this browser.');
      const context = new Audio();
      soundContext = context;
      await context.resume();
      if (soundContext !== context) return;
      if (context.state !== 'running') throw Error('The browser could not enable inbox sound.');
      playInboxSound();
      soundButton.setAttribute('aria-pressed', 'true');
      if (soundHelp) soundHelp.textContent = 'Sound on. Keep this tab visible to hear new requests.';
      soundTimer = setInterval(async () => {
        if (document.hidden || !state.session || backgroundRefresh || loadedGeneration !== state.generation) return;
        backgroundRefresh = true;
        try {
          const generation = state.generation;
          const accountId = byId('clinic-account').value;
          const locationId = byId('clinic-location').value;
          const query = new URLSearchParams({ accountId, locationId, limit: '100' });
          const inbox = await request('/clinic/inbox?' + query);
          if (soundContext !== context || document.hidden || generation !== state.generation) return;
          if ([...inboxAlertKeys(inbox)].some(key => !inboxSnapshot.keys.has(key))) await refreshActivity(true);
        } catch { /* The next refresh will retry without interrupting staff. */ }
        finally { backgroundRefresh = false; }
      }, 20000);
    } catch (error) {
      stopInboxSound();
      if (soundHelp) soundHelp.textContent = error.message;
    } finally { soundButton.disabled = false; }
  });

  async function requestConnection(channel, button) {
    button.disabled = true;
    try {
      await request('/clinic/connections', { method: 'POST', body: JSON.stringify({
        accountId: byId('clinic-account').value, locationId: byId('clinic-location').value, channel
      }) });
      await refreshActivity();
      status(labels[channel] + ' requested. The channel is not connected yet.', 'success');
    } catch (error) { status(error.message, 'error'); button.disabled = false; }
  }

  async function checkMessenger(button) {
    button.disabled = true;
    try {
      await refreshActivity();
      const connected = state.connections.some(row => row.channel === 'facebook_messenger' && row.status === 'connected');
      status(connected ? 'Messenger connected. Check Needs attention for the test inquiry.' :
        'Waiting for a test inquiry and a reply. Try sending “I’d like to book a consultation next Tuesday afternoon.”',
        connected ? 'success' : 'info');
    } catch (error) { status(error.message, 'error'); }
    finally { button.disabled = false; }
  }

  async function startMessenger(button, { accountId, locationId }) {
    button.disabled = true;
    try {
      const result = await request('/clinic/messenger/start', {
        method: 'POST', body: JSON.stringify({ accountId, locationId })
      });
      const url = new URL(result.url);
      if (url.origin !== 'https://www.facebook.com') throw Error('Facebook sign-in link is unavailable.');
      sessionStorage.setItem(messengerStorageKey, JSON.stringify({ state: result.state, accountId, locationId }));
      location.assign(url.href);
    } catch (error) {
      status(error.message, 'error');
      button.disabled = false;
    }
  }

  async function finishMessenger() {
    if (!messengerReturn) return;
    const { state: returnedState, code } = messengerReturn;
    messengerReturn = null;
    const saved = sessionStorage.getItem(messengerStorageKey);
    sessionStorage.removeItem(messengerStorageKey);
    const expected = saved?.startsWith('{') ? JSON.parse(saved) : { ...legacyMessengerConnect, state: saved };
    if (!expected.accountId || !expected.locationId || expected.state !== returnedState) {
      throw Error('Messenger sign-in expired. Click Connect Messenger to try again.');
    }
    if (!code) throw Error('Messenger authorization was cancelled. You can connect again when ready.');
    const { accountId, locationId } = expected;
    const result = await request('/clinic/messenger/finish', {
      method: 'POST', body: JSON.stringify({ accountId, locationId, code, state: returnedState })
    });
    await refreshAccounts(accountId);
    byId('clinic-location').value = locationId;
    loadAlertEmail();
    await refreshActivity();
    status(result.status === 'connected' ? 'Messenger reconnected.' :
      'Facebook approved. Send a private test message to confirm delivery.', 'success');
  }

  const signInForm = byId('clinic-signin-form');
  const codeForm = byId('clinic-code-form');
  const codeInput = byId('clinic-code');
  const sendButton = signInForm.querySelector('button');
  const verifyButton = codeForm?.querySelector('button');
  let codeEmail = '';

  const setSignInBusy = busy => {
    sendButton.disabled = busy;
    if (verifyButton) verifyButton.disabled = busy;
  };

  async function authenticated(session) {
    state.session = session;
    if (session && codeForm) {
      codeEmail = '';
      codeInput.value = '';
      show('clinic-code-form', false);
    }
    show('clinic-signin', !session);
    show('clinic-authenticated', Boolean(session));
    if (!session) {
      ++state.generation;
      inboxSnapshot = undefined;
      stopInboxSound();
      status('Sign in to create or open your workspace.');
      return;
    }
    byId('clinic-identity').textContent = 'Signed in as ' + (session.user?.email || 'clinic member');
    try {
      if (messengerReturn) await finishMessenger();
      else await refreshAccounts();
    } catch (error) {
      if (!state.accounts.length) await refreshAccounts().catch(() => {});
      status(error.message, 'error');
    }
  }

  signInForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (sendButton.disabled) return;
    const email = byId('clinic-email').value.trim();
    setSignInBusy(true);
    try {
      const { error } = await state.client.auth.signInWithOtp({ email,
        options: { emailRedirectTo: location.origin + '/clinic/' } });
      if (error) throw error;
      if (!codeForm) {
        status('Check your email for the sign-in link.', 'success');
        return;
      }
      codeEmail = email;
      codeInput.value = '';
      byId('clinic-code-help').textContent = 'Enter the code from the email to ' + email + ', or follow its sign-in link if it has one.';
      show('clinic-code-form', true);
      status('Check your email for sign-in instructions.', 'success');
    } catch (error) { status(error.message, 'error'); }
    finally { setSignInBusy(false); }
  });

  codeForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (verifyButton.disabled || !codeEmail) return;
    setSignInBusy(true);
    try {
      const { data, error } = await state.client.auth.verifyOtp({
        email: codeEmail, token: codeInput.value, type: 'email'
      });
      if (error) throw error;
      if (!data.session) throw Error('Sign-in could not be completed. Request a new email and try again.');
      if (data.session.access_token !== state.session?.access_token) await authenticated(data.session);
    } catch (error) {
      status(error.code === 'otp_expired' ? 'This code is invalid or expired. Try again or request a new email.' : error.message, 'error');
    } finally { setSignInBusy(false); }
  });
  byId('clinic-create-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.target.querySelector('button'); button.disabled = true;
    const data = new FormData(event.target);
    try {
      const accountId = await request('/clinic/onboard', { method: 'POST', body: JSON.stringify({
        accountName: data.get('accountName'), locationName: data.get('locationName')
      }) });
      await refreshAccounts(accountId);
      status('Your workspace was created. Channel requests need verification before going live.', 'success');
    } catch (error) { status(error.message, 'error'); }
    finally { button.disabled = false; }
  });
  byId('clinic-signout').addEventListener('click', async () => {
    try { await state.client.auth.signOut(); await authenticated(null); }
    catch (error) { status(error.message, 'error'); }
  });
  byId('clinic-account').addEventListener('change', () => {
    daily.hidden = true;
    commentPilotPanel.hidden = true;
    refreshLocations().catch(error => status(error.message, 'error'));
  });
  byId('clinic-location').addEventListener('change', () => {
    daily.hidden = true;
    loadAlertEmail();
    refreshActivity().catch(error => status(error.message, 'error'));
  });
  byId('clinic-refresh').addEventListener('click', () => refreshAccounts().catch(error => status(error.message, 'error')));

  (async () => {
    try {
      const response = await fetch(API + '/clinic/public-config', { cache: 'no-store' });
      if (!response.ok) throw Error('Workspace configuration is unavailable.');
      const config = await response.json();
      if (!config.supabaseUrl || !config.publishableKey) throw Error('Clinic sign-in is not activated yet. Please check back soon.');
      if (!window.supabase?.createClient) throw Error('Sign-in could not load. Please refresh the page.');
      staffEmailAvailable = config.staffEmailAvailable === true;
      messengerSetupAvailable = config.messengerSetupAvailable === true;
      legacyMessengerConnect = config.messengerConnect;
      state.client = window.supabase.createClient(config.supabaseUrl, config.publishableKey);
      const { data, error } = await state.client.auth.getSession();
      if (error) throw error;
      await authenticated(data.session);
      state.client.auth.onAuthStateChange((_event, session) => {
        setTimeout(() => {
          if (session?.access_token !== state.session?.access_token) authenticated(session);
        }, 0);
      });
    } catch (error) { status(error.message, 'error'); }
  })();
})();
