(() => {
  'use strict';
  const API = 'https://eden-webhook-ixdd.onrender.com';
  const byId = id => document.getElementById(id);
  const state = { client: null, session: null, accounts: [], locations: [], connections: [], followups: new Map(), generation: 0 };
  const alertEmailForm = byId('clinic-alert-email-form');
  const alertEmailInput = byId('clinic-alert-email');
  const alertEmailStatus = byId('clinic-alert-email-status');
  const soundButton = byId('clinic-inbox-sound');
  const soundHelp = byId('clinic-inbox-sound-help');
  let canEditAlertEmail = false;
  let staffEmailAvailable = false;
  let soundContext;
  let soundTimer;
  let backgroundRefresh = false;
  let loadedGeneration = -1;
  let inboxSnapshot;

  const labels = { website_chat: 'Website chat', facebook_messenger: 'Facebook Messenger', ai_phone: 'AI phone' };
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
      if (response.status === 409) throw Error('That channel has already been requested.');
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
    const [locations, membership] = await Promise.all([
      request('/clinic/locations?accountId=' + encodeURIComponent(accountId)),
      alertEmailForm && state.client.from('clinic_memberships').select('role')
        .eq('account_id', accountId).eq('user_id', state.session.user.id).maybeSingle()
    ]);
    if (generation !== state.generation) return;
    state.locations = locations;
    canEditAlertEmail = ['owner', 'admin'].includes(membership?.data?.role);
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
      if (!connection) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = 'Request'; button.className = 'clinic-secondary';
        button.addEventListener('click', () => requestConnection(channel, button));
        row.append(button);
      }
      container.append(row);
    }
  }

  function renderEvents(id, events, fallback) {
    const container = byId(id);
    if (!events.length) return empty(container, fallback);
    container.replaceChildren();
    for (const event of events) {
      const row = document.createElement('article'); row.className = 'clinic-event';
      const title = document.createElement('strong'); title.textContent = event.summary || event.kind || 'Activity';
      const meta = document.createElement('small');
      meta.textContent = [event.channel, event.status, event.occurred_at ? new Date(event.occurred_at).toLocaleString() : ''].filter(Boolean).join(' · ');
      row.append(title, meta);
      if (['call.followup_needed', 'booking.requested'].includes(event.kind) && event.event_key) {
        const alert = document.createElement('small');
        const alertLabels = {
          sent: 'Email alert: sent to provider',
          pending: 'Email alert: pending',
          sending: 'Email alert: sending',
          retry: 'Email alert: retry pending',
          failed: 'Email alert: delivery failed',
          not_configured: 'Email alert: no destination configured'
        };
        alert.textContent = alertLabels[event.notification_state] || 'Email alert: status unavailable';
        row.append(alert);
        const handled = state.followups.get(event.event_key)?.action === 'handled';
        const followup = document.createElement('small');
        followup.textContent = handled ? 'Staff follow-up: handled' : 'Staff follow-up: open';
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'clinic-secondary clinic-followup-button';
        button.textContent = handled ? 'Reopen' : 'Mark handled';
        button.addEventListener('click', () => updateFollowup(event.event_key,
          handled ? 'reopened' : 'handled', button));
        row.append(followup, button);
      }
      container.append(row);
    }
  }

  async function updateFollowup(eventKey, action, button) {
    button.disabled = true;
    try {
      await request('/clinic/followups', { method: 'POST', body: JSON.stringify({
        accountId: byId('clinic-account').value,
        locationId: byId('clinic-location').value,
        eventKey, action
      }) });
      await refreshActivity();
      status(action === 'handled' ? 'Follow-up marked handled.' : 'Follow-up reopened.', 'success');
    } catch (error) { status(error.message, 'error'); button.disabled = false; }
  }

  async function refreshActivity(quiet = false) {
    const generation = quiet ? state.generation : ++state.generation;
    const accountId = byId('clinic-account').value;
    const locationId = byId('clinic-location').value;
    if (!accountId || !locationId) return;
    const query = '?accountId=' + encodeURIComponent(accountId) + '&locationId=' + encodeURIComponent(locationId);
    const [connections, bookings, inbox, followups] = await Promise.all([
      request('/clinic/connections' + query), request('/clinic/bookings' + query),
      request('/clinic/inbox' + query), request('/clinic/followups' + query)
    ]);
    if (generation !== state.generation) return;
    state.connections = connections;
    state.followups = new Map(followups.map(row => [row.event_key, row]));
    renderChannels();
    renderEvents('clinic-bookings', bookings, 'No booking requests yet. Requests will appear when a verified channel delivers them.');
    renderEvents('clinic-inbox', inbox, 'No activity yet for this location.');
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
    return new Set(inbox.filter(event => ['call.followup_needed', 'booking.requested'].includes(event.kind))
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
          const query = new URLSearchParams({ accountId, locationId });
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
    try { await refreshAccounts(); } catch (error) { status(error.message, 'error'); }
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
  byId('clinic-account').addEventListener('change', () => refreshLocations().catch(error => status(error.message, 'error')));
  byId('clinic-location').addEventListener('change', () => {
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
