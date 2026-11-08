(() => {
  'use strict';
  const API = 'https://eden-webhook-ixdd.onrender.com';
  const byId = id => document.getElementById(id);
  const state = { client: null, session: null, accounts: [], locations: [], connections: [], followups: new Map(), generation: 0 };
  const messengerStorageKey = 'eden-messenger-oauth';
  const ownerSetupKey = 'eden-messenger-details';
  const ownerSetupLifetime = 30 * 60 * 1000;
  const query = new URLSearchParams(location.search);
  const testReturnId = query.get('messengerTest');
  const testReturn = /^[a-zA-Z0-9_-]{16}$/.test(testReturnId || '') ? {
    testId: testReturnId, accountId: query.get('account'), locationId: query.get('location')
  } : null;
  let messengerReturn = query.get('state')?.startsWith('eden-messenger.') ? {
    state: query.get('state'), code: query.get('code')
  } : null;
  if (messengerReturn) history.replaceState(null, '', location.pathname);
  let ownerSetup = receiveOwnerSetup();
  let importedLocation;
  let messengerSetupAvailable = false;
  let commentPilotPublishAvailable = false;
  let legacyMessengerConnect = null;
  let messengerSetups = [];
  let guideLocation;
  let guideInbox = [];
  let setupTest;
  let checkingTest = false;
  const guide = byId('clinic-messenger-guide');
  const factsForm = byId('clinic-messenger-facts');
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
  guide.after(daily);
  const channelPanel = byId('clinic-channels').closest('.clinic-panel');
  const channelColumns = channelPanel.parentElement;
  document.querySelector('.clinic-next').before(channelPanel);
  channelColumns.classList.remove('clinic-columns');
  let canManageClinic = false;
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
      if (path.startsWith('/clinic/comment-replies')) {
        if (response.status === 409) throw Error('The comment or draft changed. Refresh and review it again.');
        if (response.status === 404) throw Error('This comment draft is no longer available.');
        throw Error('The request could not be confirmed. Check the draft status and Facebook before posting again.');
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

  async function refreshAccounts(preferred, preferredLocation) {
    const generation = ++state.generation;
    const accounts = await request('/clinic/accounts');
    if (generation !== state.generation) return;
    state.accounts = accounts;
    show('clinic-create', accounts.length === 0);
    show('clinic-dashboard', accounts.length > 0);
    if (!accounts.length) return status('You are signed in. Create your first workspace.');
    selectOptions(byId('clinic-account'), accounts, preferred || byId('clinic-account').value, 'name');
    await refreshLocations(preferredLocation);
  }

  async function refreshLocations(preferredLocation) {
    const generation = ++state.generation;
    const accountId = byId('clinic-account').value;
    if (!accountId) return;
    guide.hidden = true;
    if (alertEmailForm) alertEmailForm.hidden = true;
    const [locations, membership, setups] = await Promise.all([
      request('/clinic/locations?accountId=' + encodeURIComponent(accountId)),
      (alertEmailForm || commentPilotPublishAvailable || (!messengerSetupAvailable && legacyMessengerConnect?.accountId === accountId)) &&
        state.client.from('clinic_memberships').select('role')
        .eq('account_id', accountId).eq('user_id', state.session.user.id).maybeSingle(),
      messengerSetupAvailable ? request('/clinic/messenger/setups?accountId=' + encodeURIComponent(accountId))
        .catch(() => []) : []
    ]);
    if (generation !== state.generation) return;
    state.locations = locations;
    canManageClinic = ['owner', 'admin'].includes(membership?.data?.role);
    messengerSetups = setups.map(setup => ({ ...setup, accountId }));
    if (!messengerSetupAvailable && canManageClinic && legacyMessengerConnect?.accountId === accountId) {
      messengerSetups = [legacyMessengerConnect];
    }
    selectOptions(byId('clinic-location'), locations, preferredLocation || byId('clinic-location').value, 'name');
    loadAlertEmail();
    await refreshActivity();
  }

  function selectedMessengerGuide() {
    return state.session && messengerSetups.find(setup => Object.hasOwn(setup, 'facts') &&
      setup.accountId === byId('clinic-account').value && setup.locationId === byId('clinic-location').value);
  }

  function receiveOwnerSetup() {
    const fromOwnerPage = location.hash.startsWith('#' + ownerSetupKey + '=');
    const parameter = fromOwnerPage && new URLSearchParams(location.hash.slice(1)).get(ownerSetupKey);
    if (fromOwnerPage) history.replaceState(null, '', location.pathname + location.search);
    try {
      const raw = fromOwnerPage ? parameter : sessionStorage.getItem(ownerSetupKey);
      if (!raw || raw.length > 8000) return null;
      const { clinic, at, facts } = JSON.parse(raw);
      if (typeof clinic !== 'string' || !clinic.trim() || clinic.length > 120 || !Number.isFinite(at) ||
          Date.now() - at > ownerSetupLifetime || at - Date.now() > 60000 || !facts) return null;
      const allowed = {};
      for (const name of ['services', 'hours', 'address', 'bookingRules', 'language']) {
        const value = facts[name];
        if (typeof value !== 'string' || value.length > (name === 'language' ? 120 : 900)) return null;
        allowed[name] = value;
      }
      if (!['request', 'information'].includes(facts.bookingMode)) return null;
      allowed.bookingMode = facts.bookingMode;
      const details = { clinic, at, facts: allowed };
      if (fromOwnerPage) sessionStorage.setItem(ownerSetupKey, JSON.stringify(details));
      return details;
    } catch { return null; }
  }

  function clearOwnerSetup() {
    ownerSetup = null;
    importedLocation = null;
    try { sessionStorage.removeItem(ownerSetupKey); } catch { /* Continue without storage. */ }
  }

  function fillMessengerFacts(facts) {
    for (const field of factsForm.querySelectorAll('[name]')) {
      field.value = facts?.[field.name] || (field.name === 'bookingMode' ? 'request' : '');
    }
  }

  function messengerGuideStatus(message = '', kind = 'info') {
    const note = byId('clinic-messenger-guide-status');
    note.textContent = message;
    note.dataset.kind = kind;
    note.hidden = !message;
  }

  function receivedSetupTest() {
    return guideInbox.find(event => event.details?.demo === true && event.details?.messengerSetupTestId &&
      (!setupTest || event.details.messengerSetupTestId === setupTest.testId));
  }

  function renderMessengerGuide({ resetFacts = false } = {}) {
    const setup = selectedMessengerGuide();
    guide.hidden = !setup && !ownerSetup;
    show('clinic-messenger-steps', setup);
    if (!setup) {
      show('clinic-messenger-import', false);
      if (ownerSetup) byId('clinic-messenger-page').textContent =
        'Choose a location with Messenger setup available and sign in as its owner or admin.';
      return;
    }
    if (guideLocation !== setup.locationId || resetFacts) {
      if (guideLocation !== setup.locationId) {
        setupTest = testReturn?.accountId === setup.accountId && testReturn.locationId === setup.locationId
          ? { testId: testReturn.testId, opened: true } : null;
        importedLocation = null;
      }
      guideLocation = setup.locationId;
      fillMessengerFacts(setup.facts);
      factsForm.hidden = Boolean(setup.facts);
      messengerGuideStatus();
    }
    const connection = state.connections.find(row => row.channel === 'facebook_messenger');
    const authorized = ['verifying', 'connected'].includes(connection?.status);
    const test = receivedSetupTest();
    const claimed = test && ['claimed', 'handled', 'booked'].includes(state.followups.get(test.event_key)?.action);
    const ready = setup.facts && authorized;
    const expired = setupTest?.expiresAt && setupTest.expiresAt <= Date.now();
    const waiting = ready && setupTest && !test && !expired;
    const canSend = waiting && setupTest.message;
    const opened = waiting && setupTest.opened;
    byId('clinic-messenger-page').textContent = 'Facebook Page · ' + setup.clinicName;
    if (ownerSetup && Date.now() - ownerSetup.at > ownerSetupLifetime) clearOwnerSetup();
    show('clinic-messenger-import', ownerSetup && !importedLocation);
    if (ownerSetup) {
      const locationName = state.locations.find(row => row.id === setup.locationId)?.name || setup.clinicName;
      byId('clinic-messenger-import-help').textContent = 'Saved details from ' + ownerSetup.clinic +
        ' are ready to review. Confirm that they belong to ' + locationName + ' before saving for Messenger.';
    }
    show('clinic-messenger-edit-facts', setup.facts && factsForm.hidden);
    show('clinic-messenger-cancel-facts', setup.facts || importedLocation);
    byId('clinic-messenger-connect-help').textContent = authorized ?
      (connection.status === 'connected' ? 'Messenger is connected.' : 'Facebook approved access. Verify delivery in step 3.') :
      (setup.facts ? 'Sign in with the Facebook profile that manages this Page and select it when asked.' : 'Confirm your clinic facts first.');
    const connect = byId('clinic-messenger-connect');
    connect.textContent = authorized ? 'Reconnect Messenger' : 'Connect Messenger';
    connect.classList.toggle('clinic-secondary', authorized);
    connect.hidden = !setup.facts;
    const help = byId('clinic-messenger-test-help');
    let instruction = 'Confirm your facts and connect Facebook to start the test.';
    if (claimed) instruction = 'Setup complete. Eden replied and the test inquiry was assigned. No real appointment was created.';
    else if (test) instruction = 'Eden replied. Claim the test inquiry to assign it to yourself and finish setup.';
    else if (opened) instruction = 'Sent the test message? We’ll look for Eden’s reply here.';
    else if (canSend) instruction = 'On Facebook, click Message. Paste and send the test message from your personal profile, then return here.';
    else if (ready) instruction = expired ? 'This test message expired. Create a new one to continue.' :
      'Send a private message to check that Eden replies and brings the inquiry here.';
    if (help.textContent !== instruction) help.textContent = instruction;
    const instructions = byId('clinic-messenger-test-instructions');
    const recovery = byId('clinic-messenger-test-recovery');
    const retrySend = byId('clinic-messenger-test-retry-send');
    const instructionsParent = opened ? retrySend : byId('clinic-messenger-test-send');
    if (instructions.parentElement !== instructionsParent) instructionsParent.append(instructions);
    instructions.hidden = !canSend;
    recovery.hidden = !opened;
    retrySend.hidden = !canSend;
    const start = byId('clinic-messenger-start-test');
    show(start.id, ready && (!test ? !waiting : claimed));
    start.textContent = claimed ? 'Run another test' : 'Create test message';
    start.classList.toggle('clinic-secondary', Boolean(claimed));
    show('clinic-messenger-test-page', canSend && !opened);
    show('clinic-messenger-check-test', opened);
    show('clinic-messenger-claim-test', test && !claimed);
    if (canSend) {
      byId('clinic-messenger-test-message').value = setupTest.message;
      byId('clinic-messenger-test-page').href = setup.pageUrl;
      byId('clinic-messenger-reopen-page').href = setup.pageUrl;
    }
  }

  factsForm.addEventListener('submit', async event => {
    event.preventDefault();
    const setup = selectedMessengerGuide();
    if (!setup) return;
    const facts = Object.fromEntries(new FormData(factsForm));
    const imported = importedLocation === setup.locationId;
    const fields = [...factsForm.elements];
    fields.forEach(field => { field.disabled = true; });
    try {
      const { accountId, locationId } = setup;
      const saved = await request('/clinic/messenger/facts', {
        method: 'POST', body: JSON.stringify({ accountId, locationId, facts })
      });
      if (imported) clearOwnerSetup();
      const current = selectedMessengerGuide();
      if (current?.locationId !== locationId) return;
      current.facts = saved.facts;
      renderMessengerGuide({ resetFacts: true });
      messengerGuideStatus('Clinic facts saved for Messenger.', 'success');
      byId('clinic-messenger-connect').focus();
    } catch (error) {
      if (selectedMessengerGuide()?.locationId === setup.locationId) messengerGuideStatus(error.message, 'error');
    } finally { fields.forEach(field => { field.disabled = false; }); }
  });

  byId('clinic-messenger-use-import').addEventListener('click', () => {
    const setup = selectedMessengerGuide();
    if (!setup || !ownerSetup) return;
    if (Date.now() - ownerSetup.at > ownerSetupLifetime) {
      clearOwnerSetup();
      renderMessengerGuide();
      messengerGuideStatus('The saved details link expired. Reopen Messenger from your assistant setup page.');
      return;
    }
    importedLocation = setup.locationId;
    fillMessengerFacts(ownerSetup.facts);
    factsForm.hidden = false;
    renderMessengerGuide();
    factsForm.querySelector('textarea').focus();
  });
  byId('clinic-messenger-dismiss-import').addEventListener('click', () => {
    clearOwnerSetup();
    renderMessengerGuide();
  });

  byId('clinic-messenger-edit-facts').addEventListener('click', () => {
    factsForm.hidden = false;
    renderMessengerGuide();
    factsForm.querySelector('textarea').focus();
  });
  byId('clinic-messenger-cancel-facts').addEventListener('click', () => {
    importedLocation = null;
    renderMessengerGuide({ resetFacts: true });
    const edit = byId('clinic-messenger-edit-facts');
    (edit.hidden ? byId('clinic-messenger-use-import') : edit).focus();
  });
  byId('clinic-messenger-connect').addEventListener('click', event => {
    const setup = selectedMessengerGuide();
    if (setup?.facts) startMessenger(event.currentTarget, setup);
  });
  async function startSetupTest(event) {
    const setup = selectedMessengerGuide();
    if (!setup) return;
    const button = event.currentTarget;
    button.disabled = true;
    messengerGuideStatus();
    try {
      const { accountId, locationId } = setup;
      const test = await request('/clinic/messenger/test', {
        method: 'POST', body: JSON.stringify({ accountId, locationId })
      });
      if (selectedMessengerGuide()?.locationId !== locationId) return;
      setupTest = test;
      byId('clinic-messenger-test-recovery').open = false;
      renderMessengerGuide();
      byId('clinic-messenger-test-page').focus();
    } catch (error) {
      if (selectedMessengerGuide()?.locationId === setup.locationId) messengerGuideStatus(error.message, 'error');
    } finally { button.disabled = false; }
  }
  byId('clinic-messenger-start-test').addEventListener('click', startSetupTest);
  byId('clinic-messenger-restart-test').addEventListener('click', startSetupTest);
  async function copySetupMessage() {
    const attempt = setupTest;
    if (!attempt?.message || attempt.expiresAt <= Date.now()) {
      renderMessengerGuide();
      return false;
    }
    const field = byId('clinic-messenger-test-message');
    try {
      await navigator.clipboard.writeText(attempt.message);
      if (attempt !== setupTest || guide.hidden) return false;
      return true;
    } catch {
      if (attempt === setupTest && !guide.hidden) {
        if (attempt.opened) byId('clinic-messenger-test-recovery').open = true;
        field.focus();
        field.select();
        messengerGuideStatus('Copy the selected test message, then open Facebook.');
      }
      return false;
    }
  }
  byId('clinic-messenger-copy-test').addEventListener('click', async () => {
    if (await copySetupMessage()) messengerGuideStatus('Test message copied.', 'success');
  });
  byId('clinic-messenger-test-page').addEventListener('click', event => {
    if (setupTest?.expiresAt <= Date.now()) {
      event.preventDefault();
      renderMessengerGuide();
      return;
    }
    setupTest.opened = true;
    messengerGuideStatus();
    renderMessengerGuide();
    byId('clinic-messenger-check-test').focus();
    void copySetupMessage();
  });
  async function checkSetupReply() {
    const attempt = setupTest;
    if (!attempt?.opened || guide.hidden || checkingTest || receivedSetupTest()) return;
    const button = byId('clinic-messenger-check-test');
    checkingTest = true;
    button.disabled = true;
    button.textContent = 'Checking…';
    try {
      await refreshActivity(true);
      if (attempt !== setupTest || guide.hidden) return;
      if (receivedSetupTest()) {
        messengerGuideStatus();
        const claim = byId('clinic-messenger-claim-test');
        if (document.activeElement === document.body || document.activeElement === button) {
          (claim.hidden ? byId('clinic-messenger-test-help') : claim).focus();
        }
      } else {
        messengerGuideStatus(attempt.expiresAt && attempt.expiresAt <= Date.now() ? '' :
          'Still waiting for the test reply. If you’ve sent the message, give it a few seconds and check again.');
      }
    } catch (error) {
      if (attempt === setupTest && !guide.hidden) messengerGuideStatus(error.message, 'error');
    } finally {
      checkingTest = false;
      button.disabled = false;
      button.textContent = 'Check for reply';
    }
  }
  byId('clinic-messenger-check-test').addEventListener('click', checkSetupReply);
  window.addEventListener('focus', checkSetupReply);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkSetupReply();
  });
  byId('clinic-messenger-claim-test').addEventListener('click', async () => {
    const test = receivedSetupTest();
    if (!test) return;
    await updateFollowup(test, 'claimed', byId('clinic-messenger-test-actions'));
    if (!guide.hidden && byId('clinic-messenger-claim-test').hidden) byId('clinic-messenger-test-help').focus();
  });

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
        const guided = Object.hasOwn(messengerSetup, 'facts');
        button.textContent = guided ? 'Messenger setup' : verifying ? 'Check connection' : connected ? 'Reconnect Messenger' : 'Connect Messenger';
        button.addEventListener('click', () => {
          if (guided) byId('clinic-messenger-title').focus();
          else if (verifying) checkMessenger(button);
          else startMessenger(button, messengerSetup);
        });
        row.append(button);
        detail.textContent = verifying ? 'Facebook approved. Send ' + page +
          ' a private test booking request, then check the connection.' :
          connected ? 'Connected · ' + page :
            'Choose ' + page + ' in Facebook and approve access.';
        if (verifying && messengerSetup.pageUrl && !guided) {
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
      const setupSample = Boolean(event.details?.demo && event.details?.messengerSetupTestId);
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
          claimed: ownClaim ? (setupSample ? 'Claimed by you · Finish the sample when ready' : event.channel === 'facebook_messenger' ?
            'Claimed by you · Reply in Messenger to confirm a time' : 'Claimed by you · Follow up with the patient') :
            'Claimed by another staff member',
          handled: 'Staff follow-up: handled'
        }[latest?.action] || {
          'call.followup_needed': 'Needs callback',
          'booking.requested': 'Needs confirmation',
          'inquiry.followup_needed': 'Needs staff reply'
        }[event.kind];
        row.append(followup);
        if (!setupSample && event.channel === 'facebook_messenger' && /^\d{5,30}$/.test(event.details?.pageId || '') &&
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
        const actions = setupSample ? (latest?.action === 'claimed' && ownClaim ? [['handled', 'Finish test']] :
          !latest || latest.action === 'reopened' ? [['claimed', 'Claim inquiry']] : []) :
          dailyAction === 'claim' ? [['claimed', 'Claim inquiry']] :
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
        claimed: event.details?.messengerSetupTestId ? 'Messenger setup complete. You claimed the test inquiry.' :
          'Inquiry moved to Assigned to me. Mark it booked after the patient confirms.',
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

  async function reviewCommentReply(event, opener) {
    const generation = state.generation;
    const path = '/clinic/comment-replies';
    const target = { accountId: event.account_id, locationId: event.location_id, eventKey: event.event_key };
    opener.disabled = true;
    try {
      const review = await request(path + '?' + new URLSearchParams(target));
      if (generation !== state.generation || byId('clinic-comment-review')) return;
      const dialog = document.createElement('dialog');
      dialog.id = 'clinic-comment-review';
      dialog.className = 'clinic-panel';
      dialog.setAttribute('aria-labelledby', 'clinic-comment-review-title');
      dialog.style.width = 'min(36rem, 90vw)';
      dialog.style.overflowWrap = 'anywhere';
      const title = document.createElement('h2');
      title.id = 'clinic-comment-review-title';
      title.textContent = 'Review public Facebook reply';
      const original = document.createElement('blockquote');
      original.textContent = review.message;
      const form = document.createElement('form');
      form.className = 'clinic-form';
      const label = document.createElement('label');
      label.textContent = 'Public reply';
      const reply = document.createElement('textarea');
      reply.value = event.details.publicDraft;
      reply.rows = 4;
      reply.maxLength = 500;
      reply.required = true;
      label.append(reply);
      const help = document.createElement('p');
      help.textContent = 'This will post as the clinic’s Facebook Page. Keep personal details private and leave the tracking code in the reply to track bookings.';
      const actions = document.createElement('div');
      actions.className = 'clinic-toolbar';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'clinic-secondary';
      cancel.textContent = 'Cancel';
      const publish = document.createElement('button');
      publish.type = 'submit';
      publish.textContent = 'Publish on Facebook';
      cancel.addEventListener('click', () => dialog.close());
      dialog.addEventListener('cancel', e => { if (publish.disabled) e.preventDefault(); });
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (publish.disabled || !reply.value.trim()) return;
        publish.disabled = cancel.disabled = reply.disabled = true;
        let message, kind;
        try {
          const result = await request(path, { method: 'POST', body: JSON.stringify({
            ...target, version: review.version, message: reply.value.trim()
          }) });
          kind = result.status === 'published' ? 'success' : 'error';
          message = kind === 'success' ? 'Reply published on Facebook.' :
            'Facebook did not confirm publication. Open the comment to check before replying again.';
        } catch (error) {
          message = error.message;
          kind = 'error';
        }
        dialog.close();
        if (generation === state.generation) {
          await refreshActivity().catch(() => {});
          status(message, kind);
        }
      });
      actions.append(cancel, publish);
      form.append(label, help, actions);
      dialog.append(title, original, form);
      document.body.append(dialog);
      dialog.showModal();
      reply.focus();
    } catch (error) {
      if (generation === state.generation) status(error.message, 'error');
    } finally {
      opener.disabled = false;
    }
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
    const published = drafts.filter(event => event.status === 'published');
    const canPublish = commentPilotPublishAvailable && canManageClinic;
    const messages = events.filter(event => event.kind === 'comment.messenger_started');
    const bookings = events.filter(event => event.kind === 'booking.requested');
    const confirmed = bookings.filter(event => state.followups.get(event.event_key)?.action === 'booked');
    const title = document.createElement('h3');
    title.textContent = 'Facebook comment pilot';
    const totals = document.createElement('p');
    totals.textContent = `Drafts ${drafts.length} · Published ${published.length} · Tagged Messenger conversations ${messages.length} · Booking requests ${bookings.length} · Confirmed ${confirmed.length}`;
    const help = document.createElement('p');
    help.textContent = 'Counts cover the latest 100 inbox items for this location. ' + (canPublish ?
      'Review and edit each draft before publishing as the clinic’s Page.' :
      'Review the original comment, then copy and post any reply you approve in Facebook.');
    commentPilotPanel.append(title, totals, help);

    for (const event of drafts) {
      const { commentId, publicDraft } = event.details;
      if (!/^\d{5,30}(?:_\d{5,30})?$/.test(commentId || '') || typeof publicDraft !== 'string') continue;
      const url = new URL('https://www.facebook.com/permalink.php');
      url.search = new URLSearchParams({ id: pageId, story_fbid: storyId, comment_id: commentId.split('_').at(-1) });
      const card = document.createElement('article');
      card.className = 'clinic-event';
      const draft = document.createElement('p');
      draft.textContent = event.details.approvedReply || publicDraft;
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
      actions.append(link);
      if (event.status === 'staff_review' && canPublish) {
        const review = document.createElement('button');
        review.type = 'button';
        review.className = 'clinic-secondary';
        review.textContent = 'Review and publish';
        review.addEventListener('click', () => reviewCommentReply(event, review));
        actions.append(review);
      } else if (event.status === 'staff_review') {
        actions.append(copy);
      } else {
        const result = document.createElement('small');
        result.textContent = event.status === 'published' ? 'Published on Facebook' :
          'Publication unconfirmed. Check the comment on Facebook before replying again.';
        actions.append(result);
      }
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
    guideInbox = inbox;
    renderMessengerGuide();
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
    alertEmailForm.hidden = !staffEmailAvailable || !canManageClinic || !location;
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
      if (!state.session || byId('clinic-account').value !== accountId || byId('clinic-location').value !== locationId) {
        button.disabled = false;
        return;
      }
      const url = new URL(result.url);
      if (url.origin !== 'https://www.facebook.com') throw Error('Facebook sign-in link is unavailable.');
      sessionStorage.setItem(messengerStorageKey, JSON.stringify({ state: result.state, accountId, locationId }));
      location.assign(url.href);
    } catch (error) {
      if (selectedMessengerGuide()?.locationId === locationId) messengerGuideStatus(error.message, 'error');
      else status(error.message, 'error');
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
    if (!guide.hidden) byId('clinic-messenger-title').focus();
  }

  const signInForm = byId('clinic-signin-form');
  const codeForm = byId('clinic-code-form');
  const emailInput = byId('clinic-email');
  const codeInput = byId('clinic-code');
  const sendButton = signInForm.querySelector('button');
  const verifyButton = codeForm.querySelector('button');

  const setSignInBusy = busy => {
    sendButton.disabled = busy;
    verifyButton.disabled = busy;
  };

  async function authenticated(session) {
    state.session = session;
    if (session) codeForm.reset();
    show('clinic-signin', !session);
    show('clinic-authenticated', Boolean(session));
    if (!session) {
      ++state.generation;
      inboxSnapshot = undefined;
      guide.hidden = true;
      guideLocation = null;
      setupTest = null;
      stopInboxSound();
      status('Sign in to create or open your workspace.');
      return;
    }
    byId('clinic-identity').textContent = 'Signed in as ' + (session.user?.email || 'clinic member');
    try {
      if (messengerReturn) await finishMessenger();
      else {
        await refreshAccounts(testReturn?.accountId, testReturn?.locationId);
        if (testReturn && setupTest?.testId === testReturn.testId && !guide.hidden) {
          byId('clinic-messenger-test-help').focus();
          await checkSetupReply();
        }
      }
    } catch (error) {
      if (!state.accounts.length) await refreshAccounts().catch(() => {});
      status(error.message, 'error');
    }
  }

  signInForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (sendButton.disabled) return;
    const email = emailInput.value.trim();
    setSignInBusy(true);
    try {
      const { error } = await state.client.auth.signInWithOtp({ email,
        options: { emailRedirectTo: location.origin + '/clinic/' + (testReturn ? location.search : '') } });
      if (error) throw error;
      codeForm.reset();
      status('Sign-in email sent to ' + email + '. Enter the code below.', 'success');
      codeInput.focus();
    } catch (error) { status(error.message, 'error'); }
    finally { setSignInBusy(false); }
  });

  codeForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (verifyButton.disabled || !emailInput.reportValidity()) return;
    setSignInBusy(true);
    try {
      const { data, error } = await state.client.auth.verifyOtp({
        email: emailInput.value.trim(), token: codeInput.value, type: 'email'
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
    guide.hidden = true;
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
      commentPilotPublishAvailable = config.commentPilotPublishAvailable === true;
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
