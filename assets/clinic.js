(() => {
  'use strict';
  const API = 'https://eden-webhook-ixdd.onrender.com';
  const byId = id => document.getElementById(id);
  const state = { client: null, session: null, accounts: [], locations: [], connections: [], followups: new Map(), generation: 0 };
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
    const locations = await request('/clinic/locations?accountId=' + encodeURIComponent(accountId));
    if (generation !== state.generation) return;
    state.locations = locations;
    selectOptions(byId('clinic-location'), locations, byId('clinic-location').value, 'name');
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

  async function refreshActivity() {
    const generation = ++state.generation;
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
    status('Workspace loaded for ' + state.locations.find(row => row.id === locationId)?.name + '.', 'success');
  }

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
    if (!session) { ++state.generation; status('Sign in to create or open your workspace.'); return; }
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
  byId('clinic-location').addEventListener('change', () => refreshActivity().catch(error => status(error.message, 'error')));
  byId('clinic-refresh').addEventListener('click', () => refreshAccounts().catch(error => status(error.message, 'error')));

  (async () => {
    try {
      const response = await fetch(API + '/clinic/public-config', { cache: 'no-store' });
      if (!response.ok) throw Error('Workspace configuration is unavailable.');
      const config = await response.json();
      if (!config.supabaseUrl || !config.publishableKey) throw Error('Clinic sign-in is not activated yet. Please check back soon.');
      if (!window.supabase?.createClient) throw Error('Sign-in could not load. Please refresh the page.');
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
