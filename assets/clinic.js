(() => {
  'use strict';
  const API = window.edenClinicApi || 'https://eden-webhook-ixdd.onrender.com';
  const setupOrigin = 'https://voice-demo.clinicnet-web.pages.dev';
  const byId = id => document.getElementById(id);
  const state = { client: null, session: null, accounts: [], locations: [], connections: [], followups: new Map(), generation: 0 };
  const messengerStorageKey = 'eden-messenger-oauth';
  const ownerSetupKey = 'eden-messenger-details';
  const ownerSetupLifetime = 30 * 60 * 1000;
  const workspaceId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  const query = new URLSearchParams(location.search);
  const channels = new Set(['website_chat', 'facebook_messenger', 'ai_phone']);
  const invitationKey = 'eden-workspace-invite';
  const invitationMatch = /^#clinic-invite=([a-f0-9]{64})$/.exec(location.hash);
  let pendingInvite = invitationMatch?.[1] || sessionStorage.getItem(invitationKey);
  if (invitationMatch) {
    sessionStorage.setItem(invitationKey, pendingInvite);
    history.replaceState(null, '', location.pathname + location.search);
  }
  const hashChannel = location.hash === '#clinic-messenger-guide' ? 'facebook_messenger' :
    /^#clinic-channel-([a-z_]+)$/.exec(location.hash)?.[1];
  let initialSelection = {
    accountId: query.get('account'), locationId: query.get('location'), channel: query.get('setup') || hashChannel
  };
  const requestedView = query.get('view');
  let openRequestedReport = requestedView === 'revenue' || query.has('report') || location.hash === '#clinic-rescue';
  let workspaceView = ['daily','profile','settings'].includes(requestedView) ? requestedView : openRequestedReport ? 'daily' : 'setup';
  let overviewLocation;
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
  const workspaceHero = document.querySelector('.clinic-hero');
  const heroAction = byId('clinic-hero-action');
  const alertEmailForm = byId('clinic-alert-email-form') || document.createElement('form');
  if (!alertEmailForm.id) {
    alertEmailForm.id = 'clinic-alert-email-form';
    alertEmailForm.className = 'clinic-form';
    alertEmailForm.hidden = true;
    alertEmailForm.innerHTML = '<label>Staff alert email<input id="clinic-alert-email" type="email" placeholder="frontdesk@example.com"></label><button type="submit">Save email</button><p id="clinic-alert-email-status" role="status"></p>';
    byId('clinic-dashboard').append(alertEmailForm);
  }
  const alertEmailInput = byId('clinic-alert-email');
  const alertEmailStatus = byId('clinic-alert-email-status');
  const pearlPilotLink = document.createElement('a');
  pearlPilotLink.href = '/pearlsmile-cebu/?workspace-pilot=1#pearlsmile-reception-chat-2026';
  pearlPilotLink.textContent = 'Open PearlSmile chat pilot';
  pearlPilotLink.hidden = true;
  byId('clinic-inbox').before(pearlPilotLink);
  const commentPilotPanel = document.createElement('section');
  commentPilotPanel.className = 'clinic-events';
  commentPilotPanel.hidden = true;
  byId('clinic-inbox').before(commentPilotPanel);
  const daily = byId('clinic-daily');
  const addBookingButton = byId('clinic-add-booking');
  const addBookingForm = byId('clinic-add-booking-form');
  const addBookingClose = byId('clinic-add-booking-close');
  const addBookingFeedback = byId('clinic-add-booking-feedback');
  const addBookingResult = byId('clinic-add-booking-result');
  let manualBooking;
  const inboxFilters = [...daily.querySelectorAll('[data-filter]')];
  let dailyEvents = [];
  let inboxFilter = 'all';
  const inboxPageSize = 5;
  let inboxPage = 0;
  let inboxLocation;
  for (const button of inboxFilters) {
    button.addEventListener('click', () => {
      inboxFilter = button.dataset.filter;
      inboxPage = 0;
      renderDailyInbox();
    });
  }
  let canManageClinic = false;
  let clinicTeam = new Map();
  let clinicTeamAvailable = true;
  let isClinicOwner = false;
  let acceptingInvite;
  let staffEmailAvailable = false;
  let backgroundRefresh = false;
  let lastInboxPoll = 0;
  let alertScope;
  let observedAlerts = new Set();
  let workspaceAttentionCount = 0;
  let supportAlertCount = 0;
  let askEden;
  let supportAlertRequest = 0;
  let alertAudio;
  let clinicFactsRequest;
  let loadedGeneration = -1;
  let workspaceLoadFailed = false;
  let reconnecting;
  let initializing;
  let rejectedAccessToken;
  let hiddenAt = document.hidden ? Date.now() : null;
  let inboxSignature;
  let publishedWebsite = false;
  let clinicVisits = new Map();
  let visitRecordsAvailable = false;

  const setupChannelLabels = { website_chat: 'Website Chat', facebook_messenger: 'Facebook Messenger', ai_phone: 'AI Phone' };
  const bookingSourceLabels = { ...setupChannelLabels, staff_booking: 'Booked by staff' };
  const channelNav = byId('clinic-channel-setup');
  workspaceHero.after(channelNav);
  const channelSteps = createChannelSteps();
  const workspaceViews = createWorkspaceViews();
  let operationsAvailable = false;
  switchWorkspaceView(workspaceView);
  const followupKinds = ['call.followup_needed', 'booking.requested', 'inquiry.followup_needed'];
  const show = (id, visible) => { byId(id).hidden = !visible; };
  const status = (message, kind = 'info', workspaceReady = false) => {
    const feedback = byId('clinic-status');
    feedback.textContent = message;
    feedback.dataset.kind = kind;
    feedback.dataset.workspaceReady = String(workspaceReady);
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

  function timedRead(work) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('The workspace request timed out.')), 15000);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }

  function showWorkspaceLoadError(error, retry = () => recoverWorkspace(true)) {
    workspaceLoadFailed = true;
    const message = error.status === 401
      ? 'Your session could not be verified. Try reconnecting to the workspace.'
      : 'Could not load the clinic. Check your connection and retry.';
    status(message, 'error');
    if (!overviewLocation) byId('clinic-overview-revenue').textContent = 'Clinic details are unavailable.';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'clinic-invite-switch';
    button.textContent = 'Retry workspace';
    button.onclick = retry;
    byId('clinic-status').append(button);
  }

  async function workspaceLoad(generation, work) {
    try {
      await work();
      if (generation === state.generation) workspaceLoadFailed = false;
    } catch (error) {
      if (generation !== state.generation) return;
      showWorkspaceLoadError(error);
      throw error;
    }
  }

  async function request(path, options = {}) {
    if (!state.session?.access_token) throw Error('Please sign in again.');
    const accessToken = state.session.access_token;
    const read = !options.method || options.method === 'GET';
    const response = await fetch(API + path, {
      ...(read && typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(15000) } : {}),
      ...options,
      headers: { Authorization: 'Bearer ' + accessToken,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
    });
    if (!response.ok) {
      if (response.status === 401) {
        if (read && state.session?.access_token === accessToken) rejectedAccessToken = accessToken;
        const error = Error('Your session could not be verified. Refresh the workspace and try again.');
        error.status = 401;
        throw error;
      }
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

  function refreshAccounts(preferred, preferredLocation) {
    const generation = ++state.generation;
    return workspaceLoad(generation, () => loadAccounts(preferred, preferredLocation, generation));
  }

  async function loadAccounts(preferred, preferredLocation, generation) {
    const accounts = await timedRead(request('/clinic/accounts'));
    if (generation !== state.generation) return;
    const operatorPanel = workspaceViews.operatorPanel;
    operatorPanel.replaceChildren();
    operatorPanel.hidden = true;
    operationsAvailable = false;
    let hasOperations = false;
    if (typeof ClinicOperations !== 'undefined') {
      const content = document.createElement('div');
      try {
        hasOperations = await timedRead(ClinicOperations.operators(state.client,content));
        if (generation !== state.generation) return;
        operationsAvailable = true;
        operatorPanel.replaceChildren(...content.childNodes);
        operatorPanel.hidden = !hasOperations;
      } catch { if (generation !== state.generation) return; }
    }
    state.accounts = accounts;
    show('clinic-create', accounts.length === 0 && !hasOperations);
    show('clinic-dashboard', accounts.length > 0);
    document.querySelector('.clinic-view-switch').hidden = !accounts.length;
    byId('clinic-open-settings').hidden = !accounts.length;
    updateHeroAction();
    if (!accounts.length) return status(hasOperations ? 'Choose an approved Eden workspace below.' : 'You are signed in. Create your first workspace.');
    selectOptions(byId('clinic-account'), accounts, preferred || byId('clinic-account').value, 'name');
    await loadLocations(preferredLocation, generation);
  }

  function refreshLocations(preferredLocation) {
    const generation = ++state.generation;
    return workspaceLoad(generation, () => loadLocations(preferredLocation, generation));
  }

  async function loadLocations(preferredLocation, generation) {
    const accountId = byId('clinic-account').value;
    if (!accountId) return;
    guide.hidden = true;
    hideChannelSetup();
    if (alertEmailForm) alertEmailForm.hidden = true;
    const [locations, membership, setups] = await timedRead(Promise.all([
      request('/clinic/locations?accountId=' + encodeURIComponent(accountId)),
      state.client.from('clinic_memberships').select('role')
        .eq('account_id', accountId).eq('user_id', state.session.user.id).maybeSingle(),
      messengerSetupAvailable ? request('/clinic/messenger/setups?accountId=' + encodeURIComponent(accountId))
        .catch(() => []) : []
    ]));
    if (generation !== state.generation) return;
    if (membership.error) throw membership.error;
    state.locations = locations;
    canManageClinic = ['owner', 'admin'].includes(membership?.data?.role);
    isClinicOwner = membership?.data?.role === 'owner';
    show('clinic-team-invite', isClinicOwner && locations.length > 0);
    show('clinic-invite-link', false);
    byId('clinic-invite-url').value = '';
    messengerSetups = setups.map(setup => ({ ...setup, accountId }));
    if (!messengerSetupAvailable && canManageClinic && legacyMessengerConnect?.accountId === accountId) {
      messengerSetups = [legacyMessengerConnect];
    }
    selectOptions(byId('clinic-location'), locations, preferredLocation || byId('clinic-location').value, 'name');
    loadAlertEmail();
    await loadActivity(false, generation);
  }

  function selectedMessengerGuide() {
    return state.session && messengerSetups.find(setup => Object.hasOwn(setup, 'facts') &&
      setup.accountId === byId('clinic-account').value && setup.locationId === byId('clinic-location').value);
  }

  function receiveOwnerSetup() {
    const fromOwnerPage = location.hash.startsWith('#' + ownerSetupKey + '=');
    const parameter = fromOwnerPage && new URLSearchParams(location.hash.slice(1)).get(ownerSetupKey);
    if (fromOwnerPage) history.replaceState(null, '', location.pathname + location.search + '#clinic-channel-facebook_messenger');
    try {
      const raw = fromOwnerPage ? parameter : sessionStorage.getItem(ownerSetupKey);
      if (!raw || raw.length > 8000) return null;
      const { accountId, locationId, clinic, at, facts } = JSON.parse(raw);
      if (typeof accountId !== 'string' || !workspaceId.test(accountId) ||
          typeof locationId !== 'string' || !workspaceId.test(locationId)) return null;
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
      const details = { accountId, locationId, clinic, at, facts: allowed };
      if (fromOwnerPage) sessionStorage.setItem(ownerSetupKey, JSON.stringify(details));
      return details;
    } catch { return null; }
  }

  function clearOwnerSetup() {
    ownerSetup = null;
    importedLocation = null;
    try { sessionStorage.removeItem(ownerSetupKey); } catch { /* Continue without storage. */ }
  }

  function ownerSetupFor(setup) {
    if (ownerSetup && Date.now() - ownerSetup.at > ownerSetupLifetime) clearOwnerSetup();
    return ownerSetup && setup && ownerSetup.accountId === setup.accountId &&
      ownerSetup.locationId === setup.locationId ? ownerSetup : null;
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

  function isMessengerSetupSample(event) {
    return event.channel === 'facebook_messenger' && event.details?.demo === true &&
      Boolean(event.details.messengerSetupTestId);
  }

  function receivedSetupTest() {
    return guideInbox.find(event => isMessengerSetupSample(event) &&
      (!setupTest || event.details.messengerSetupTestId === setupTest.testId));
  }

  function messengerTestComplete() {
    return state.connections.some(row => row.channel === 'facebook_messenger' && row.status === 'connected') &&
      Boolean(receivedSetupTest());
  }

  function hasMessengerFacts(facts) {
    return ['services','hours','address','bookingRules'].every(name=>
      typeof facts?.[name] === 'string' && facts[name].trim());
  }

  function messengerTestChat(setup) {
    if (/^\d{5,30}$/.test(String(setup.pageId || ''))) return 'https://m.me/' + setup.pageId;
    let page;
    try { page = new URL(setup.pageUrl); }
    catch { return ''; }
    if (page.origin !== 'https://www.facebook.com') return '';
    const pageId = page.pathname === '/profile.php' ? page.searchParams.get('id') :
      /^\/(\d{5,30})\/?$/.exec(page.pathname)?.[1];
    return /^\d{5,30}$/.test(pageId) ? 'https://m.me/' + pageId : '';
  }

  function renderMessengerGuide({ resetFacts = false } = {}) {
    const setup = selectedMessengerGuide();
    guide.hidden = !setup;
    show('clinic-messenger-steps', setup);
    if (!setup) {
      show('clinic-messenger-import', false);
      return;
    }
    const factsReady = hasMessengerFacts(setup.facts);
    const newLocation = guideLocation !== setup.locationId;
    const draft = ownerSetupFor(setup);
    if (newLocation || resetFacts) {
      if (newLocation) {
        setupTest = testReturn?.accountId === setup.accountId && testReturn.locationId === setup.locationId
          ? { testId: testReturn.testId, opened: true } : null;
        importedLocation = null;
      }
      guideLocation = setup.locationId;
      const prefill = newLocation && !setup.facts && draft;
      if (prefill) importedLocation = setup.locationId;
      fillMessengerFacts(prefill ? draft.facts : setup.facts);
      factsForm.hidden = factsReady;
      messengerGuideStatus();
    }
    const connection = state.connections.find(row => row.channel === 'facebook_messenger');
    const connected = connection?.status === 'connected';
    const authorized = connected || connection?.status === 'verifying';
    byId('clinic-messenger-title').textContent = connected ? 'Manage Messenger' : 'Set up Messenger';
    const ready = factsReady && authorized;
    const steps = byId('clinic-messenger-steps').children;
    for (const [step, label, done] of [
      [steps[0], factsReady ? 'Saved' : 'Required', factsReady],
      [steps[1], authorized ? 'Authorized' : factsReady ? 'Ready to authorize' : 'After clinic facts', authorized],
      [steps[2], connected ? 'Connected' : ready ? 'Ready to test' : 'After authorization', connected]
    ]) {
      let badge = step.querySelector('.clinic-connect-stage');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'clinic-connect-stage';
        step.querySelector('h3').after(badge);
      }
      badge.textContent = label;
      badge.dataset.connected = String(done);
    }
    const test = ready ? receivedSetupTest() : null;
    const complete = connected && Boolean(test);
    const expired = setupTest?.expiresAt && setupTest.expiresAt <= Date.now();
    const waiting = ready && setupTest && !complete && (Boolean(test) || !expired);
    const canSend = waiting && !test && setupTest.message;
    const opened = waiting && setupTest.opened;
    byId('clinic-messenger-page').textContent = 'Facebook Page · ' + setup.clinicName;
    show('clinic-messenger-import', draft && !importedLocation);
    if (draft) {
      byId('clinic-messenger-import-help').textContent = 'Review the details from ' + draft.clinic +
        ' before saving them for Messenger.';
    }
    show('clinic-messenger-profile-facts', factsReady && factsForm.hidden);
    show('clinic-messenger-edit-facts', factsReady && factsForm.hidden);
    byId('clinic-messenger-facts-help').textContent = importedLocation ?
      'These details come from your website receptionist setup. Review or edit them before saving for Messenger.' :
      factsReady ? 'Manage replies in Clinic Profile. Set the preferred language and how Messenger handles appointment requests here.' :
      'Use the information you already give to patients. Eden uses these details when it replies on Messenger.';
    byId('clinic-messenger-edit-facts').setAttribute('aria-expanded', String(!factsForm.hidden && !importedLocation));
    byId('clinic-messenger-use-import').setAttribute('aria-expanded', String(!factsForm.hidden && Boolean(importedLocation)));
    show('clinic-messenger-cancel-facts', factsReady || importedLocation);
    byId('clinic-messenger-connect-help').textContent = authorized ?
      (connected ? (complete ? 'Your Facebook Page is connected.' :
        'Your Facebook Page is connected. You can go straight to the reply test.') :
        'Facebook approved access. Verify delivery in step 3.') :
      (factsReady ? 'Connect ' + setup.clinicName + ' so Eden can receive and reply to its Messenger messages.' :
        'Confirm your clinic facts first.');
    const connectOptions = byId('clinic-messenger-connect-options');
    const connectState = factsReady ? (authorized ? 'authorized' : 'ready') : 'waiting';
    if (connectOptions.dataset.state !== connectState ||
        connectOptions.dataset.location !== setup.locationId) {
      connectOptions.open = connectState === 'ready';
      connectOptions.dataset.state = connectState;
      connectOptions.dataset.location = setup.locationId;
    }
    connectOptions.hidden = !factsReady;
    byId('clinic-messenger-connect-summary').textContent = authorized ? 'Connection options' : 'What to click in Facebook';
    const connect = byId('clinic-messenger-connect');
    connect.textContent = authorized ? 'Reconnect in Facebook' : 'Continue to Facebook';
    connect.classList.toggle('clinic-secondary', authorized);
    const chatUrl = canSend ? messengerTestChat(setup) : '';
    const help = byId('clinic-messenger-test-help');
    let instruction = authorized
      ? 'Confirm your clinic facts to start the private reply test.'
      : 'Confirm your clinic facts and connect Facebook to start the test.';
    if (complete) {
      const booking = setup.facts.bookingMode === 'information'
        ? 'direct patients to your clinic team for bookings.'
        : 'collect booking requests. Your team confirms appointment times.';
      instruction = 'Congratulations! Your AI receptionist is connected to Facebook Messenger. It can answer patient inquiries 24/7 and ' + booking;
    } else if (test) instruction = 'Eden sent the test reply. Waiting for the Facebook Page connection to finish verifying.';
    else if (canSend) instruction = 'If Facebook asks you to sign in, use your personal profile. Paste the test message into the private chat with ' +
      setup.clinicName + ' and press Send. Then return here. Posts and comments on Facebook are public.';
    else if (opened) instruction = 'We’ll look for Eden’s reply after you send the test message in the clinic’s private Messenger chat.';
    else if (ready) instruction = expired ? 'This test message expired. Create a new one to continue.' :
      'Send a private message to check that Eden replies and brings the inquiry here.';
    if (help.textContent !== instruction) help.textContent = instruction;
    byId('clinic-messenger-test-instructions').hidden = !canSend;
    byId('clinic-messenger-test-recovery').hidden = !opened;
    show('clinic-messenger-test-retry-send', canSend && chatUrl && setup.pageUrl);
    const start = byId('clinic-messenger-start-test');
    show(start.id, ready && (complete || (!test && !waiting)));
    start.textContent = complete ? 'Run another test' : 'Prepare a test message';
    start.classList.toggle('clinic-secondary', complete);
    show('clinic-messenger-test-page', chatUrl);
    show('clinic-messenger-test-page-fallback', canSend && !chatUrl && setup.pageUrl);
    show('clinic-messenger-check-test', opened || (test && !complete));
    show('clinic-messenger-open-daily', complete);
    if (canSend) {
      byId('clinic-messenger-test-message').value = setupTest.message;
      if (chatUrl) byId('clinic-messenger-test-page').href = chatUrl;
      if (setup.pageUrl) {
        byId('clinic-messenger-find-page').href = setup.pageUrl;
        byId('clinic-messenger-reopen-page').href = setup.pageUrl;
      }
    }
  }

  factsForm.addEventListener('submit', async event => {
    event.preventDefault();
    const setup = selectedMessengerGuide();
    if (!setup) return;
    const facts = Object.fromEntries(new FormData(factsForm));
    const imported = importedLocation === setup.locationId ? ownerSetupFor(setup) : null;
    const userId = state.session?.user?.id;
    const isCurrentLocation = () => state.session?.user?.id === userId &&
      selectedMessengerGuide()?.accountId === setup.accountId &&
      selectedMessengerGuide()?.locationId === setup.locationId;
    const fields = [...factsForm.elements];
    fields.forEach(field => { field.disabled = true; });
    try {
      const { accountId, locationId } = setup;
      const saved = await request('/clinic/messenger/facts', {
        method: 'POST', body: JSON.stringify({ accountId, locationId, facts })
      });
      if (!isCurrentLocation()) return;
      if (imported && ownerSetup === imported) clearOwnerSetup();
      selectedMessengerGuide().facts = saved.facts;
      clinicFactsRequest = undefined;
      renderChannels();
      renderMessengerGuide({ resetFacts: true });
      messengerGuideStatus('Clinic facts saved for Messenger.', 'success');
      const connection = state.connections.find(row => row.channel === 'facebook_messenger');
      byId(['verifying', 'connected'].includes(connection?.status) ? 'clinic-messenger-test-help' : 'clinic-messenger-connect').focus();
    } catch (error) {
      if (isCurrentLocation()) messengerGuideStatus(error.message, 'error');
    } finally { fields.forEach(field => { field.disabled = false; }); }
  });

  byId('clinic-messenger-use-import').addEventListener('click', () => {
    const setup = selectedMessengerGuide();
    const draft = ownerSetupFor(setup);
    if (!draft) {
      renderMessengerGuide();
      messengerGuideStatus('Open Messenger from the website setup to review saved clinic details.');
      return;
    }
    importedLocation = setup.locationId;
    const facts = { ...draft.facts };
    // Hours and services can be refreshed from the website. Keep channel-specific choices.
    for (const name of ['address', 'bookingRules', 'language', 'bookingMode']) {
      if (setup.facts?.[name]) facts[name] = setup.facts[name];
    }
    facts.hours ||= setup.facts?.hours || '';
    fillMessengerFacts(facts);
    factsForm.hidden = false;
    renderMessengerGuide();
    factsForm.querySelector('textarea').focus();
  });
  byId('clinic-messenger-dismiss-import').addEventListener('click', () => {
    clearOwnerSetup();
    renderMessengerGuide();
  });

  byId('clinic-messenger-profile-facts').addEventListener('click', () => {
    switchWorkspaceView('profile',true);
    focusProfileControl(byId('clinic-approved-facts').querySelector('textarea') || byId('clinic-profile-title'));
  });

  byId('clinic-messenger-edit-facts').addEventListener('click', () => {
    factsForm.hidden = false;
    renderMessengerGuide();
    factsForm.elements.language.focus();
  });
  byId('clinic-messenger-cancel-facts').addEventListener('click', () => {
    importedLocation = null;
    renderMessengerGuide({ resetFacts: true });
    const edit = byId('clinic-messenger-edit-facts');
    const importButton = byId('clinic-messenger-use-import');
    (edit.hidden ? (importButton.closest('[hidden]') ? factsForm.querySelector('textarea') : importButton) : edit).focus();
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
      byId('clinic-messenger-test-instructions').open = false;
      renderMessengerGuide();
      const chat = byId('clinic-messenger-test-page');
      if (chat.hidden) {
        const instructions = byId('clinic-messenger-test-instructions');
        instructions.open = true;
        byId('clinic-messenger-copy-test').focus();
      } else chat.focus();
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
        byId('clinic-messenger-test-instructions').open = true;
        field.focus();
        field.select();
        messengerGuideStatus('Copy the selected test message and paste it into the clinic’s Messenger chat.');
      }
      return false;
    }
  }
  byId('clinic-messenger-copy-test').addEventListener('click', async () => {
    if (await copySetupMessage()) messengerGuideStatus('Test message copied.', 'success');
  });
  byId('clinic-messenger-find-page').addEventListener('click', () => {
    if (!setupTest?.message) return;
    setupTest.opened = true;
    renderMessengerGuide();
    byId('clinic-messenger-check-test').focus();
  });
  byId('clinic-messenger-test-page').addEventListener('click', event => {
    if (!setupTest?.message || setupTest.expiresAt <= Date.now()) {
      event.preventDefault();
      renderMessengerGuide();
      return;
    }
    setupTest.opened = true;
    messengerGuideStatus();
    renderMessengerGuide();
    byId('clinic-messenger-check-test').focus();
    void copySetupMessage().then(copied => {
      if (copied) messengerGuideStatus('Copied. Paste the test message into the clinic’s Messenger chat and press Send.', 'success');
    });
  });
  async function checkSetupReply() {
    const attempt = setupTest;
    if ((!attempt?.opened && !receivedSetupTest()) || guide.hidden || checkingTest || messengerTestComplete()) return;
    const button = byId('clinic-messenger-check-test');
    checkingTest = true;
    button.disabled = true;
    button.textContent = 'Checking…';
    try {
      await refreshActivity(true);
      if (attempt !== setupTest || guide.hidden) return;
      if (messengerTestComplete()) {
        messengerGuideStatus();
        if (document.activeElement === document.body || document.activeElement === button) {
          byId('clinic-messenger-test-help').focus();
        }
      } else {
        messengerGuideStatus(receivedSetupTest() || (attempt?.expiresAt && attempt.expiresAt <= Date.now()) ? '' :
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
  function openDailyWork() {
    switchWorkspaceView('daily', true);
    byId('clinic-inbox-title').focus();
  }
  byId('clinic-messenger-open-daily').addEventListener('click', openDailyWork);
  heroAction.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const destination = heroAction.getAttribute('href');
    if (destination === '#clinic-create') {
      byId('clinic-create-form').querySelector('input').focus();
    } else if (destination === '/clinic/?view=daily') {
      openDailyWork();
    } else {
      switchWorkspaceView('setup', true);
      channelSteps.find(step => step.link.dataset.connected !== 'true')?.link.click();
    }
  });

  function createChannelSteps() {
    const list = byId('clinic-channels');
    const steps = Object.entries(setupChannelLabels).map(([channel, name]) => {
      const panel = document.createElement('details');
      panel.id = 'clinic-channel-' + channel;
      panel.className = 'clinic-panel clinic-channel-detail';
      panel.hidden = true;
      const heading = document.createElement('summary');
      heading.textContent = name;
      const body = document.createElement('div');
      const feedback = document.createElement('p');
      feedback.className = 'clinic-channel-feedback';
      feedback.setAttribute('role', 'status');
      panel.append(heading, body, feedback);
      if (channel === 'facebook_messenger') panel.append(guide);

      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = '#' + panel.id;
      const marker = document.createElement('span');
      marker.className = 'clinic-channel-marker';
      marker.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = name;
      const badge = document.createElement('small');
      badge.className = 'clinic-connect-stage';
      const action = document.createElement('span');
      action.className = 'clinic-connect-link-action';
      const updated = document.createElement('small');
      updated.className = 'clinic-connection-updated';
      updated.hidden = true;
      copy.append(title, badge, updated);
      link.append(marker, copy, action);
      item.append(link);
      list.append(item);
      link.addEventListener('click', event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        panel.open = true;
        heading.focus({ preventScroll: true });
        panel.scrollIntoView({block:'start', behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
      });
      panel.addEventListener('toggle', () => {
        if (panel.open) link.setAttribute('aria-current','true');
        else link.removeAttribute('aria-current');
      });
      return { channel, panel, heading, body, link, marker, badge, action, feedback, updated };
    });
    return steps;
  }

  function workspaceIcon(name) {
    const paths = {
      overview:'<path d="M3 11l9-7 9 7M6 10v10h12V10M10 20v-6h4v6"/>',
      daily:'<rect x="5" y="4" width="14" height="16" rx="2"/><path d="m8 9 1 1 2-2m2 2h3m-8 5 1 1 2-2m2 2h3"/>',
      setup:'<path d="m10 14 4-4m-6 6-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m2-1 4-4a3 3 0 0 1 4 4l-4 4a3 3 0 0 1-4 0"/>',
      revenue:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 16v-3m4 3V8m4 8v-5"/>',
      profile:'<path d="M5 20V6h14v14M3 20h18M9 10h6m-6 4h6"/>',
      settings:'<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
      bell:'<path d="M5 17h14l-2-3v-4a5 5 0 0 0-10 0v4l-2 3Zm5 3a2 2 0 0 0 4 0"/>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>';
  }

  function createWorkspaceControls() {
    const controls = document.createElement('div');
    controls.className = 'clinic-workspace-controls';
    controls.innerHTML = `<details id="clinic-alerts-menu">
      <summary>${workspaceIcon('bell')}<span>Alerts</span><span id="clinic-alert-count" hidden></span></summary>
      <section class="clinic-workspace-popover" aria-label="Recent clinic activity">
        <h2>Recent clinic activity</h2>
        <button type="button" id="clinic-alert-sound" aria-pressed="false">Enable alert sound</button>
        <ul id="clinic-support-alerts" aria-label="Eden support" hidden></ul>
        <ul id="clinic-workspace-alerts" aria-label="Recent activity"></ul>
      </section>
    </details>
    <details id="clinic-account-menu">
      <summary>${workspaceIcon('settings')}<span>Account</span></summary>
      <div class="clinic-workspace-popover">
        <div id="clinic-workspace-identity"></div>
        <button type="button" id="clinic-open-settings">Settings</button>
        <button type="button" id="clinic-open-support">Ask Eden</button>
        <a href="/">Eden services</a>
      </div>
    </details>`;
    const menu = controls.querySelector('#clinic-account-menu');
    const alerts = controls.querySelector('#clinic-alerts-menu');
    alerts.addEventListener('toggle', () => {
      if (alerts.open) void refreshSupportAlerts();
    });
    const sound = controls.querySelector('#clinic-alert-sound');
    sound.hidden = !window.AudioContext;
    sound.onclick = async () => {
      const enabled = sound.getAttribute('aria-pressed') !== 'true';
      try {
        if (!alertAudio) alertAudio = new AudioContext();
        if (enabled) await alertAudio.resume();
        else await alertAudio.suspend();
        sound.setAttribute('aria-pressed',String(enabled));
        sound.textContent = enabled ? 'Mute alert sound' : 'Enable alert sound';
      } catch { sound.textContent = 'Sound unavailable'; }
    };
    const toolbar = byId('clinic-identity').closest('.clinic-toolbar');
    menu.querySelector('#clinic-workspace-identity').append(toolbar);
    menu.querySelector('#clinic-open-settings').onclick = () => {
      menu.open = false;
      switchWorkspaceView('settings',true);
      byId('clinic-settings-view').querySelector('h1').focus();
    };
    for (const [details, other] of [[menu,alerts],[alerts,menu]]) {
      details.addEventListener('toggle',()=>{ if (details.open) other.open = false; });
      details.addEventListener('keydown',event=>{
        if (event.key==='Escape' && details.open) {
          details.open = false;
          details.querySelector('summary').focus();
        }
      });
    }
    document.addEventListener('click',event=>{
      for (const details of [menu,alerts]) if (!details.contains(event.target)) details.open = false;
    });
    if (window.ClinicNetAskEden) {
      const {mount, previewReply, publicReply, saveGuestFeedback} = window.ClinicNetAskEden;
      const channelByGuide = {messenger:'facebook_messenger', 'website-chat':'website_chat', phone:'ai_phone'};
      askEden = mount({
        answerQuestion(question, history) {
          if (!state.session) return (previewReply || publicReply)(question, history);
          const reply = publicReply(question);
          const channel = channelByGuide[reply.guide];
          if (channel) return answerChannelStatus(channel);
          const followUp = /^(?:what (?:now|next|should i do)|(?:i )?(?:already |just )?(?:sent|ran|tried|made) (?:it|a test|the test|a test call)|nothing (?:showed up|came through)|it still (?:doesn.t work|isn.t working))\b/i;
          if (!reply.guide && followUp.test(question)) {
            const previousChannel = channelByGuide[publicReply(history.at(-2)?.content || '').guide];
            if (previousChannel) return answerChannelStatus(previousChannel);
          }
          if (loadedGeneration !== state.generation ||
              !state.locations.some(item => item.id === byId('clinic-location').value)) return reply;
          if (reply.view === 'alerts') {
            if (!isClinicOwner) return {answer:'Ask the clinic owner to open Alerts for the requested location.'};
            return {...reply, onAction:() => {
              alerts.open = true;
              alerts.querySelector('summary').focus();
            }};
          }
          if (['profile','revenue'].includes(reply.view) && !canManageClinic) {
            return {answer:'Ask a clinic owner or admin to open this section.'};
          }
          return {...reply, onAction:reply.view ? () => switchWorkspaceView(reply.view,true) : undefined};
        },
        async saveFeedback(entry) {
          if (!state.session) return saveGuestFeedback(entry);
          const {error} = await state.client.rpc('eden_save_reply_feedback', {
            p_id:entry.id, p_reply:entry.answer, p_rating:entry.rating, p_comment:entry.comment
          });
          if (error) throw error;
        }
      });
      const entry = menu.querySelector('#clinic-open-support');
      entry.onclick = () => {
        menu.open = false;
        askEden.open(menu.querySelector('summary'));
      };
    }
    return controls;
  }

  function clearWorkspaceAlerts() {
    byId('clinic-alerts-menu').open = false;
    byId('clinic-account-menu').open = false;
    askEden?.reset();
    const list = byId('clinic-workspace-alerts');
    const message = document.createElement('li');
    message.textContent = 'Choose a clinic to see its recent activity.';
    list.replaceChildren(message);
    ++supportAlertRequest;
    workspaceAttentionCount = 0;
    supportAlertCount = 0;
    const supportList = byId('clinic-support-alerts');
    supportList.replaceChildren();
    supportList.hidden = true;
    updateWorkspaceAlertCount();
    observedAlerts.clear();
    alertScope = undefined;
  }

  function updateWorkspaceAlertCount() {
    const count = byId('clinic-alert-count');
    const total = workspaceAttentionCount + supportAlertCount;
    count.hidden = total === 0;
    count.textContent = String(total);
  }

  async function refreshSupportAlerts(locationId = byId('clinic-location').value, generation = state.generation) {
    if (!operationsAvailable || !isClinicOwner || !locationId) return;
    const requestId = ++supportAlertRequest;
    try {
      const {data, error} = await state.client.rpc('eden_support_notifications', {p_location: locationId});
      if (error || !Array.isArray(data) || requestId !== supportAlertRequest || generation !== state.generation ||
          locationId !== byId('clinic-location').value) return;
      const list = byId('clinic-support-alerts');
      const rows = data.map(item => {
        const row = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.reviewId = item.id;
        const title = document.createElement('strong');
        title.textContent = ClinicOperations.notificationTitle(item);
        const detail = document.createElement('span');
        detail.textContent = ClinicOperations.targetLabel(item.target);
        button.append(title, detail);
        button.onclick = () => {
          byId('clinic-alerts-menu').open = false;
          switchWorkspaceView('settings', true);
          void workspaceViews.ownerSupport.firstElementChild?.openReview(item.id);
        };
        row.append(button);
        return row;
      });
      const focusedReview = list.contains(document.activeElement) ? document.activeElement.dataset.reviewId : null;
      list.replaceChildren(...rows);
      list.hidden = !rows.length;
      if (focusedReview) {
        const replacement = rows.find(row => row.firstElementChild.dataset.reviewId === focusedReview);
        (replacement?.firstElementChild || byId('clinic-alerts-menu').querySelector('summary')).focus();
      }
      supportAlertCount = rows.length;
      updateWorkspaceAlertCount();
    } catch {
      // Leave the current alerts visible if a refresh fails.
    }
  }

  function renderWorkspaceAlerts(activity, attention, booked) {
    const list = byId('clinic-workspace-alerts');
    const needsAction = new Set(attention);
    const confirmed = new Set(booked);
    const recent = activity.filter(event=>event.event_key && !event.details?.demo &&
      (followupKinds.includes(event.kind) || confirmed.has(event))).slice(0,12);
    workspaceAttentionCount = attention.filter(event=>!event.details?.demo).length;
    updateWorkspaceAlertCount();
    const scope = byId('clinic-account').value + '/' + byId('clinic-location').value;
    if (scope !== alertScope) observedAlerts.clear();
    const keys = recent.map(event=>event.event_key + (confirmed.has(event) ? ':booked' : ':received'));
    if (scope===alertScope && keys.some(key=>!observedAlerts.has(key)) && alertAudio?.state==='running') {
      const note = alertAudio.createOscillator();
      const volume = alertAudio.createGain();
      const now = alertAudio.currentTime;
      note.frequency.value = 660;
      volume.gain.setValueAtTime(.07,now);
      volume.gain.exponentialRampToValueAtTime(.001,now+.16);
      note.connect(volume).connect(alertAudio.destination);
      note.start(now);
      note.stop(now+.17);
    }
    alertScope = scope;
    keys.forEach(key=>observedAlerts.add(key));
    const rows = recent.map(event => {
      const item = document.createElement('li');
      const action = document.createElement('button');
      action.type = 'button';
      const label = document.createElement('strong');
      label.textContent = event.kind==='call.followup_needed' ? 'Missed call' : confirmed.has(event) ? 'Confirmed booking' :
        event.kind==='booking.requested' ? 'Booking request' : 'Clinic inquiry';
      const detail = document.createElement('span');
      detail.textContent = (bookingSourceLabels[event.channel] || 'Clinic activity') + (needsAction.has(event) ? ' · Needs attention' : '');
      action.append(label,detail);
      action.onclick = () => {
        byId('clinic-alerts-menu').open = false;
        switchWorkspaceView('daily',true);
        if (!openBookedActivity(event.event_key,false,'all')) byId('clinic-daily-attention').focus();
      };
      item.append(action);
      return item;
    });
    for (const step of channelSteps.filter(step=>step.link.dataset.connectionStatus==='action_required')) {
      const item = document.createElement('li');
      const action = document.createElement('button');
      action.type = 'button';
      action.textContent = setupChannelLabels[step.channel] + ' needs attention';
      action.onclick = () => {
        byId('clinic-alerts-menu').open = false;
        switchWorkspaceView('setup',true);
        step.link.click();
      };
      item.append(action);
      rows.push(item);
    }
    if (list.contains(document.activeElement)) byId('clinic-alerts-menu').querySelector('summary').focus();
    list.replaceChildren(...rows);
    if (!rows.length) {
      const message = document.createElement('li');
      message.textContent = 'No recent booking or inquiry activity.';
      list.append(message);
    }
  }

  function createWorkspaceViews() {
    const dashboard = byId('clinic-dashboard');
    const selectors = dashboard.querySelector('.clinic-selectors');
    const switcher = document.createElement('details');
    switcher.className = 'clinic-location-switcher';
    switcher.innerHTML = '<summary><span id="clinic-switcher-name">Clinic location</span><span>Switch location</span></summary>';
    selectors.before(switcher);
    switcher.append(selectors);
    const setup = document.createElement('div');
    setup.id = 'clinic-setup-view';
    const work = document.createElement('div');
    work.id = 'clinic-daily-view';
    const overview = byId('clinic-owner-overview');
    const revenue = byId('clinic-revenue-view');
    const profile = document.createElement('section');
    profile.id = 'clinic-profile-view';
    profile.className = 'clinic-panel clinic-workspace-admin';
    profile.innerHTML = '<h1 id="clinic-profile-title" tabindex="-1">Clinic profile</h1><p id="clinic-profile-location"></p><div id="clinic-approved-facts"></div><div id="clinic-profile-channels"></div><p id="clinic-profile-editor-status" class="clinic-channel-feedback" role="status"></p>';
    const settings = document.createElement('section');
    settings.id = 'clinic-settings-view';
    settings.className = 'clinic-workspace-admin';
    settings.innerHTML = '<h1 tabindex="-1">Settings</h1><section class="clinic-panel"><h2>Account</h2><p id="clinic-settings-identity"></p><p>Workspace sign-in uses a code sent to your email.</p><button type="button" id="clinic-settings-signout" class="clinic-secondary">Sign out</button></section><section class="clinic-panel" id="clinic-settings-alerts"><h2>Staff alerts</h2><p id="clinic-settings-alert-note">Staff alert email is unavailable for this clinic.</p></section>';
    settings.querySelector('#clinic-settings-alerts').append(alertEmailForm);
    const ownerSupport = document.createElement('div');
    const operatorPanel = document.createElement('section');
    operatorPanel.className = 'clinic-panel clinic-ops-operator';
    operatorPanel.hidden = true;
    dashboard.before(operatorPanel);
    settings.append(byId('clinic-team-invite'),ownerSupport);
    settings.querySelector('#clinic-settings-signout').onclick = () => byId('clinic-signout').click();
    dashboard.append(overview,work,revenue,setup,profile,settings);
    setup.append(channelNav,...channelSteps.map(step=>step.panel));
    work.append(daily);

    const views = document.createElement('nav');
    views.className = 'clinic-view-switch';
    views.setAttribute('aria-label','Clinic Workspace');
    const links = {};
    for (const [key,label] of [['overview','Home'],['daily','Daily Action'],['setup','Connect'],['revenue','Revenue'],['profile','Clinic profile']]) {
      const link = document.createElement('a');
      link.href = '/clinic/?view=' + key;
      link.innerHTML = workspaceIcon(key) + '<span>' + label + '</span>';
      link.addEventListener('click',event=>{
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        switchWorkspaceView(key,true);
      });
      links[key] = link;
      views.append(link);
    }
    const rail = document.createElement('aside');
    rail.className = 'clinic-workspace-rail';
    rail.innerHTML = '<a class="clinic-workspace-brand" href="/clinic/?view=overview" aria-label="Eden Clinic Workspace home"><img src="/assets/clinicnet-favicon.png?v=brand-3" alt="" width="36" height="36"></a>';
    rail.append(views);
    const controls = createWorkspaceControls();
    rail.append(controls);
    byId('clinic-authenticated').prepend(rail);
    const today = document.createElement('div');
    today.className = 'clinic-overview-today';
    today.innerHTML = '<h2>Today at your clinic</h2><div class="clinic-overview-today-actions"><button type="button" id="clinic-home-attention"></button><button type="button" id="clinic-home-appointments"></button></div>';
    today.querySelector('#clinic-home-attention').onclick = () => {
      switchWorkspaceView('daily',true);
      byId('clinic-daily-attention').click();
    };
    today.querySelector('#clinic-home-appointments').onclick = () => {
      switchWorkspaceView('daily',true);
      const target = byId('clinic-today-title');
      target.focus();
      target.scrollIntoView({block:'nearest'});
    };
    overview.querySelector('.clinic-overview-header').after(today);
    return {overview,setup,work,revenue,profile,settings,links,ownerSupport,operatorPanel};
  }

  function switchWorkspaceView(view, updateUrl = false) {
    document.querySelector('.clinic-location-switcher').open = view==='settings';
    const clinicLabel = byId('clinic-location').selectedOptions[0]?.textContent;
    byId('clinic-switcher-name').textContent = clinicLabel || 'Clinic workspace';
    workspaceView = ['setup','settings'].includes(view) || (canManageClinic && ['overview','revenue','profile'].includes(view)) ? view : 'daily';
    const setup = workspaceView === 'setup';
    workspaceViews.setup.hidden = !setup;
    workspaceViews.work.hidden = workspaceView !== 'daily';
    workspaceViews.overview.hidden = workspaceView !== 'overview';
    workspaceViews.links.overview.hidden = !canManageClinic;
    workspaceViews.links.revenue.hidden = !canManageClinic;
    workspaceViews.links.profile.hidden = !canManageClinic;
    workspaceViews.profile.hidden = workspaceView !== 'profile';
    workspaceViews.settings.hidden = workspaceView !== 'settings';
    workspaceViews.revenue.hidden = workspaceView !== 'revenue';
    byId('clinic-rescue').open = workspaceView === 'revenue';
    if (workspaceView === 'overview') loadOwnerRevenue();
    if (workspaceView === 'profile') loadApprovedClinicFacts();
    channelNav.hidden = !setup || channelSteps.every(({ panel }) => panel.hidden);
    updateHeroAction();
    for (const [key, link] of Object.entries(workspaceViews.links)) {
      const parameters = new URLSearchParams({view:key});
      for (const field of ['account','location']) {
        const value = byId('clinic-'+field).value;
        if (value) parameters.set(field,value);
      }
      link.href = '/clinic/?' + parameters;
      if (key===workspaceView) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    }
    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.set('view',workspaceView);
      for (const key of ['account','location']) {
        const value = byId('clinic-'+key).value;
        if (value) url.searchParams.set(key,value);
      }
      url.searchParams.delete('setup');
      url.searchParams.delete('report');
      if (url.hash.startsWith('#clinic-')) url.hash='';
      history.replaceState(null,'',url);
    }
  }

  function updateHeroAction() {
    const needsWorkspace = !byId('clinic-create').hidden;
    const channelsReady = !daily.hidden;
    workspaceHero.hidden = Boolean(state.session) && (['overview','revenue','profile','settings'].includes(workspaceView) ||
      (workspaceView === 'daily' && channelsReady) || (workspaceView === 'setup' && !channelNav.hidden));
    const opensDaily = channelsReady && (!canManageClinic || channelSteps.every(step => step.link.dataset.connected === 'true'));
    heroAction.hidden = workspaceView === 'overview' || !state.session || (!needsWorkspace && (!channelsReady || (opensDaily && workspaceView === 'daily')));
    if (heroAction.hidden) return;
    heroAction.setAttribute('href', needsWorkspace ? '#clinic-create' : '/clinic/?view=' + (opensDaily ? 'daily' : 'setup'));
    heroAction.textContent = needsWorkspace ? 'Create your workspace' : opensDaily ? 'Open Daily Action' : 'Channel setup';
  }

  function clearRevenueView() {
    byId('clinic-revenue-location').textContent = '';
    ClinicRescue.reports({manager:false});
  }

  function clearOwnerOverview() {
    overviewLocation = undefined;
    workspaceViews.links.overview.href = '/clinic/?view=overview';
    workspaceViews.links.revenue.href = '/clinic/?view=revenue';
    byId('clinic-overview-location').textContent = '';
    byId('clinic-profile-location').textContent = '';
    byId('clinic-profile-channels').replaceChildren();
    byId('clinic-profile-editor-status').textContent = '';
    byId('clinic-approved-facts').replaceChildren();
    clinicFactsRequest = undefined;
    byId('clinic-home-attention').textContent = 'Review Daily Action';
    byId('clinic-home-appointments').textContent = 'Open today’s appointments';
    byId('clinic-overview-connections').replaceChildren();
    byId('clinic-overview-revenue').textContent = 'Loading clinic…';
    byId('clinic-overview-open-report').hidden = true;
  }

  async function loadApprovedClinicFacts() {
    const locationId = byId('clinic-location').value;
    if (!locationId || !canManageClinic || !state.session) return;
    const host = byId('clinic-approved-facts');
    const userId = state.session.user.id;
    const request = {locationId,userId};
    if (clinicFactsRequest?.locationId===locationId && clinicFactsRequest?.userId===userId) return;
    clinicFactsRequest = request;
    const current = () => clinicFactsRequest===request && state.session?.user?.id===userId &&
      byId('clinic-location').value===locationId && canManageClinic;
    empty(host,'Loading approved facts…');
    try {
      const {data,error} = await timedRead(state.client.rpc('workspace_clinic_facts',{p_location:locationId}));
      if (!current()) return;
      if (error) throw error;
      const form = document.createElement('form');
      form.className = 'clinic-form clinic-approved-facts-form';
      form.innerHTML = `<h2>Approved clinic facts</h2>
        <p>Update your Messenger replies here. To change Website Chat, open the <a href="#clinic-profile-website_chat">AI receptionist editor</a> below. <a href="#clinic-profile-ai_phone">AI Phone</a> has its own setup.</p>
        <label>Services<textarea name="services" required maxlength="900"></textarea></label>
        <label>Opening hours<textarea name="hours" required maxlength="900"></textarea></label>
        <label>Address<textarea name="address" required maxlength="900"></textarea></label>
        <label>Booking instructions<textarea name="bookingRules" required maxlength="900"></textarea></label>
        <p>Use information your clinic has approved for patients. Leave out patient details.</p>
        <label class="clinic-facts-confirm"><input name="approved" type="checkbox" required> I approve these facts for patient-facing use on Messenger.</label>
        <button type="submit">Approve and save facts</button>
        <p role="status"></p>`;
      for (const link of form.querySelectorAll('a[href^="#clinic-profile-"]')) {
        link.onclick = event => {
          const action = byId(link.hash.slice(1));
          if (!action) return;
          event.preventDefault();
          focusProfileControl(action);
        };
      }
      let approved = data;
      for (const area of form.querySelectorAll('textarea')) area.value = data?.[area.name] || '';
      const note = form.querySelector('[role="status"]');
      if (data?.profileApprovedAt) note.textContent = 'Approved '+new Date(data.profileApprovedAt).toLocaleDateString()+'.';
      form.onsubmit = async event => {
        event.preventDefault();
        if (!current() || !form.reportValidity()) return;
        const button = form.querySelector('button');
        if (button.disabled) return;
        const facts = Object.fromEntries([...form.querySelectorAll('textarea')].map(area=>[area.name,area.value.trim()]));
        if (Object.values(facts).some(value=>!value)) {
          note.textContent = 'Enter all four clinic facts.';
          return;
        }
        button.disabled = true;
        const approval = form.elements.approved;
        approval.disabled = true;
        note.textContent = 'Saving approved clinic facts…';
        try {
          const {data,error} = await state.client.rpc('workspace_clinic_facts',{
            p_location:locationId,p_facts:facts,p_expected:approved
          });
          if (!current()) return;
          if (error) {
            if (error.code==='40001') {
              note.textContent = 'Someone changed these facts. Copy any edits you want to keep, then reload.';
              if (!form.querySelector('[data-reload-facts]')) {
                const reload = document.createElement('button');
                reload.type = 'button';
                reload.dataset.reloadFacts = '';
                reload.className = 'clinic-secondary';
                reload.textContent = 'Reload saved facts';
                reload.onclick = () => { clinicFactsRequest = undefined; void loadApprovedClinicFacts(); };
                note.after(reload);
              }
              return;
            }
            throw error;
          }
          approved = data;
          const messenger = selectedMessengerGuide();
          if (messenger) {
            messenger.facts = data;
            renderChannels();
            renderMessengerGuide({resetFacts:true});
          }
          approval.checked = false;
          note.textContent = 'Approved facts saved for this location.';
        } catch { if (current()) note.textContent = 'Could not save clinic facts. Try again.'; }
        finally { button.disabled = false; approval.disabled = false; }
      };
      host.replaceChildren(form);
    } catch {
      if (!current()) return;
      clinicFactsRequest = undefined;
      empty(host,'Approved clinic facts are unavailable right now.');
    }
  }

  function focusProfileControl(control) {
    control.focus({preventScroll:true});
    control.scrollIntoView({
      block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'
    });
  }

  function renderClinicProfile() {
    const locationId = byId('clinic-location').value;
    const location = state.locations.find(row=>row.id===locationId);
    if (!location || !canManageClinic) return;
    byId('clinic-profile-location').textContent = location.name;
    const rows = channelSteps.map(({channel, link, badge}) => {
      const row = document.createElement('section');
      row.className = 'clinic-profile-row';
      const title = document.createElement('h2');
      title.textContent = setupChannelLabels[channel];
      const stateLabel = document.createElement('p');
      stateLabel.textContent = [badge.textContent,badge.title].filter(Boolean).join(' · ');
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'clinic-secondary';
      action.id = 'clinic-profile-' + channel;
      action.textContent = {
        website_chat:'Edit AI receptionist', facebook_messenger:'Edit Messenger facts', ai_phone:'Open AI Phone setup'
      }[channel];
      action.onclick = () => {
        if (channel==='website_chat') {
          void openWebsiteSetup(action, (message, kind = 'info') => {
            const status = byId('clinic-profile-editor-status');
            status.textContent = message;
            status.dataset.kind = kind;
          });
        } else if (channel==='facebook_messenger') {
          const field = byId('clinic-approved-facts').querySelector('textarea');
          if (field) focusProfileControl(field);
          else {
            byId('clinic-approved-facts').scrollIntoView({block:'start'});
            void loadApprovedClinicFacts();
          }
        } else {
          switchWorkspaceView('setup',true);
          link.click();
        }
      };
      row.append(title,stateLabel,action);
      return row;
    });
    byId('clinic-profile-channels').replaceChildren(...rows);
  }

  function renderOverviewConnections() {
    if (!overviewLocation) return;
    const list = byId('clinic-overview-connections');
    const focusedChannel = list.contains(document.activeElement) ? document.activeElement.dataset.channel : null;
    const entries = channelSteps.map(({channel,badge,link}) => {
      const row = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = setupChannelLabels[channel];
      const stateLabel = document.createElement('span');
      stateLabel.className = 'clinic-overview-service-status';
      stateLabel.dataset.connected = link.dataset.connected;
      stateLabel.textContent = badge.textContent;
      const action = document.createElement('a');
      action.className = 'clinic-overview-link';
      action.href = '/clinic/?' + new URLSearchParams({view:'setup',account:overviewLocation.accountId,
        location:overviewLocation.locationId,setup:channel});
      action.textContent = 'Manage';
      action.dataset.channel = channel;
      action.setAttribute('aria-label','Manage ' + title.textContent);
      action.addEventListener('click', event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        switchWorkspaceView('setup',true);
        link.click();
      });
      row.append(title,stateLabel,action);
      return row;
    });
    list.replaceChildren(...entries);
    if (focusedChannel) [...list.querySelectorAll('a')].find(link=>link.dataset.channel===focusedChannel)?.focus({preventScroll:true});
  }

  function loadOwnerRevenue() {
    const clinic = overviewLocation;
    if (!clinic) return;
    const request = Symbol();
    clinic.revenueRequest = request;
    ClinicRescue.overview({
      client:state.client,
      locationId:clinic.locationId,
      read:timedRead,
      valid:()=>overviewLocation===clinic && clinic.revenueRequest===request && canManageClinic && Boolean(state.session)
    });
  }

  byId('clinic-overview-open-report').addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    switchWorkspaceView('revenue',true);
    byId('clinic-revenue-title').focus();
  });

  function renderWorkspaceHero(signedIn) {
    byId('clinic-guest-hero').hidden = signedIn;
    byId('clinic-member-hero').hidden = !signedIn;
    workspaceHero.classList.toggle('clinic-hero-signed-in', signedIn);
    workspaceHero.setAttribute('aria-labelledby', signedIn ? 'clinic-workspace-member-title' : 'clinic-workspace-title');
    const photo = byId('clinic-member-hero-image');
    if (signedIn && !photo.hasAttribute('src')) photo.src = photo.dataset.src;
    updateHeroAction();
  }

  function hideChannelSetup() {
    channelNav.hidden = true;
    byId('clinic-connect-next').hidden = true;
    for (const { panel, feedback } of channelSteps) {
      panel.hidden = true;
      panel.open = false;
      feedback.textContent = '';
    }
  }

  function channelFeedback(channel, message, kind = 'info') {
    const step = channelSteps.find(item=>item.channel===channel);
    step.feedback.textContent = message;
    step.feedback.dataset.kind = kind;
  }

  function channelButton(label, action, secondary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (secondary) button.className = 'clinic-secondary';
    button.addEventListener('click',()=>action(button));
    return button;
  }

  function channelStatus(channel, connection, pageLive) {
    if (pageLive) return 'Page live · inbox unverified';
    if (!connection) return 'Not set up';
    if (connection.status==='requested') return {
      website_chat:'Inbox unverified',facebook_messenger:'Access pending',ai_phone:'Number pending'
    }[channel];
    return {
      verifying:'Ready to test',connected:'Connected',action_required:'Action needed',disconnected:'Disconnected'
    }[connection.status] || 'Check setup';
  }

  function phoneSetup(row, detail, connection) {
    const number = /^\+[1-9]\d{7,14}$/.test(connection?.forwarding_number||'')?connection.forwarding_number:null;
    if (number && ['verifying','connected'].includes(connection.status)) {
      detail.textContent = connection.status==='connected'?'Your missed-call forwarding is connected.':'Your forwarding number is ready. Complete the steps below.';
      const guide = document.createElement('div');
      guide.className = 'clinic-phone-steps';
      const destination = document.createElement('p');
      destination.textContent = 'Forwarding number ';
      const display = document.createElement('strong');
      display.textContent = number;
      destination.append(display);
      guide.append(destination, channelButton('Copy number', async () => {
        try {
          await navigator.clipboard.writeText(number);
          channelFeedback('ai_phone','Forwarding number copied.');
        } catch {
          const range = document.createRange();
          range.selectNodeContents(display);
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(range);
          channelFeedback('ai_phone','Select and copy the forwarding number shown.');
        }
      },true));
      if (connection.status==='verifying') {
        const steps = document.createElement('ol');
        for (const text of [
          'Use your phone provider’s settings to forward unanswered calls to the number above. If your provider supports forwarding on busy, you can enable that too.',
          'From another phone, call your usual clinic number and let it ring without answering. Speak to Eve, then hang up.',
          'Select Check test call. The completed call should appear in Daily Action once it is verified.'
        ]) {
          const step = document.createElement('li');
          step.textContent = text;
          steps.append(step);
        }
        guide.append(steps,channelButton('Check test call',checkPhoneSetup,true));
      }
      row.append(guide);
      return;
    }
    if (connection) {
      detail.textContent = connection.status==='requested' || connection.status==='verifying'
        ? 'Eden is preparing this location’s forwarding number. Check here for the number and test steps when it is ready.'
        : 'This line needs attention. Check its setup status before changing your clinic’s forwarding settings.';
      row.append(channelButton('Check phone setup',checkPhoneSetup,true));
    } else {
      detail.textContent = 'Request a forwarding number for this clinic. Once it is assigned, you can forward unanswered calls and test the line here.';
      if (canManageClinic) row.append(channelButton('Start phone setup',button=>requestConnection('ai_phone',button)));
    }
  }

  function connectClinicAction(channel, status) {
    if (!canManageClinic) return ['View status','A clinic owner or admin manages service connections.'];
    if (status === 'connected') return ['Manage','Review this connection and its settings.'];
    if (status === 'facts') return ['Review clinic details','Confirm the information Eden uses when replying to patients.'];
    if (status === 'action_required') return ['Review setup','Review the connection and the steps to restore service.'];
    if (status === 'disconnected') return ['Review reconnection','Open the setup steps to get this service working again.'];
    if (status === 'requested') return ['View request','Your setup request is still in progress.'];
    if (status === 'verifying') {
      return channel==='website_chat' ? ['Check website setup','Send a test inquiry from the clinic website to verify inbox delivery.'] :
        ['Review test steps',channel==='facebook_messenger' ? 'Send a private Messenger test to verify Eden’s reply.' :
          'Place a forwarded test call and check that it reaches Daily Action.'];
    }
    return ['Set up',channel==='website_chat' ? 'Set up your clinic’s website receptionist.' :
      channel==='facebook_messenger' ? 'Start connecting your clinic’s Facebook Page.' :
        'Request a forwarding number for missed calls.'];
  }

  function renderConnectClinic() {
    const clinic = state.locations.find(row=>row.id===byId('clinic-location').value);
    byId('clinic-connect-location').textContent = clinic?.name || '';
    const connected = channelSteps.filter(step=>step.link.dataset.connected==='true').length;
    byId('clinic-connect-progress').textContent = connected + ' of ' + channelSteps.length + ' connected';

    const priority = ['action_required','disconnected','facts','verifying','unconfigured'];
    const next = canManageClinic && priority.map(status=>
      channelSteps.find(step=>step.link.dataset.connectionStatus===status)).find(Boolean);
    byId('clinic-connect-next').hidden = !next;
    if (!next) return;
    const [label, detail] = connectClinicAction(next.channel,next.link.dataset.connectionStatus);
    byId('clinic-connect-next-title').textContent = setupChannelLabels[next.channel];
    byId('clinic-connect-next-detail').textContent = detail;
    const action = byId('clinic-connect-next-action');
    action.textContent = label;
    action.href = next.link.href;
    action.onclick = event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      next.link.click();
    };
  }

  function channelPresentation(channel, connection, includeWorkspaceDetails = true) {
    const messengerSetup = includeWorkspaceDetails && channel === 'facebook_messenger' && messengerSetups.find(setup =>
      setup.accountId === byId('clinic-account').value && setup.locationId === byId('clinic-location').value);
    const guided = messengerSetup && Object.hasOwn(messengerSetup,'facts');
    const needsFacts = guided && ['connected','verifying'].includes(connection?.status) &&
      !hasMessengerFacts(messengerSetup.facts);
    const pageLive = includeWorkspaceDetails && publishedWebsite && channel === 'website_chat' &&
      (!connection || ['requested','verifying'].includes(connection.status));
    return {
      messengerSetup, guided,
      label: needsFacts ? 'Facts needed' : channelStatus(channel,connection,pageLive),
      stage: needsFacts ? 'facts' : pageLive ? 'verifying' : connection?.status || 'unconfigured'
    };
  }

  async function answerChannelStatus(channel) {
    const accountId = byId('clinic-account').value;
    const locationId = byId('clinic-location').value;
    const userId = state.session?.user?.id;
    const clinic = state.locations.find(item => item.id === locationId);
    if (!accountId || !clinic || !userId) return {answer:'Choose a clinic location and ask me to check again.'};
    const current = () => state.session?.user?.id === userId &&
      byId('clinic-account').value === accountId && byId('clinic-location').value === locationId;

    const generation = state.generation;
    const displayedConnections = state.connections;
    try {
      const query = new URLSearchParams({accountId,locationId});
      const connections = await timedRead(request('/clinic/connections?' + query,{cache:'no-store'}));
      if (!current()) return {answer:'The clinic location changed. Ask me again to check this location.'};
      if (connections.some(item => item.account_id !== accountId || item.location_id !== locationId)) {
        throw Error('Connection response did not match the selected clinic.');
      }
      const connection = connections.find(item => item.channel === channel);
      const {label,stage} = channelPresentation(channel,connection,loadedGeneration === state.generation);
      const name = setupChannelLabels[channel];
      const message = stage === 'connected'
        ? 'If a test is missing, check Daily Action for an entry from ' + name + ' at this location. If it’s still missing, review the connection settings.'
        : connectClinicAction(channel,stage)[1];
      return {
        answer:clinic.name + ' · ' + name + ': ' + label + '. ' + message,
        action:'Open ' + name + ' in Connect',
        onAction:() => {
          if (!current()) return;
          switchWorkspaceView('setup',true);
          if (generation === state.generation && loadedGeneration === generation &&
              displayedConnections === state.connections) {
            state.connections = connections;
            renderChannels();
            renderMessengerGuide();
          }
          channelSteps.find(step => step.channel === channel)?.link.click();
        }
      };
    } catch (error) {
      if (!current()) return {answer:'The clinic location changed. Ask me again to check this location.'};
      return {answer:error.status === 401 ? error.message :
        'I couldn’t check ' + setupChannelLabels[channel] + ' for ' + clinic.name + '. Try asking again in a moment.'};
    }
  }

  function renderChannels(steps = channelSteps) {
    for (const { channel, panel, heading, body, link, marker, badge, action, updated } of steps) {
      const connection = state.connections.find(item=>item.channel===channel);
      const {messengerSetup, guided, label, stage} = channelPresentation(channel,connection);
      const connected = stage === 'connected';
      badge.textContent = label;
      const updatedAt = new Date(connection?.updated_at || '');
      updated.hidden = !Number.isFinite(updatedAt.getTime());
      updated.textContent = updated.hidden ? '' : 'Updated '+updatedAt.toLocaleDateString(undefined,{timeZone:clinicTimeZone(byId('clinic-location').value)});
      badge.title = updated.textContent;

      link.dataset.connected = String(connected);
      badge.dataset.connected = link.dataset.connected;
      marker.textContent = connected ? '✓' : '○';
      link.dataset.connectionStatus = stage;
      action.textContent = connectClinicAction(channel,link.dataset.connectionStatus)[0];
      panel.hidden = false;
      if (guided) {
        body.replaceChildren();
        continue;
      }
      const row = document.createElement('div');
      row.className = 'clinic-channel';
      const detail = document.createElement('p');
      row.append(detail);
      if (channel==='website_chat') {
        detail.textContent = canManageClinic?'Start here to set up or resume your AI receptionist.':'A clinic owner or admin can open receptionist setup.';
        if (canManageClinic) row.append(channelButton('Set up AI receptionist',openWebsiteSetup));
        if (connection?.status==='requested' || (publishedWebsite && (!connection || connection.status==='verifying'))) {
          const note = document.createElement('small');
          note.className = 'clinic-connection-pending';
          note.textContent = publishedWebsite
            ? 'Your receptionist page is live. The first website request received in Daily Action verifies the inbox connection.'
            : 'The website inbox connection has yet to be verified.';
          detail.append(note);
        } else if (!connection && canManageClinic) {
          const extra = document.createElement('details');
          extra.className = 'clinic-website-connection';
          const title = document.createElement('summary');
          title.textContent = 'Already published? Connect it to your website';
          const description = document.createElement('p');
          description.textContent = 'Use this option when your receptionist is already published and you want to add it to your existing website.';
          extra.append(title,description,channelButton('Request website connection',button=>requestConnection(channel,button),true));
          row.append(extra);
        }
      } else if (channel==='ai_phone') {
        phoneSetup(row,detail,connection);
      } else if (messengerSetup) {
        const page = messengerSetup.clinicName || 'your Facebook Page';
        const verifying = connection?.status==='verifying';
        detail.textContent = verifying?'Facebook approved. Send '+page+' a private test booking request, then check the connection.':
          connected?'Connected to '+page+'.':'Choose '+page+' in Facebook and approve access.';
        row.append(channelButton(verifying?'Check connection':connected?'Reconnect Messenger':'Connect Messenger',
          button=>verifying?checkMessenger(button):startMessenger(button,messengerSetup),true));
        if (verifying && messengerSetup.pageUrl) {
          const testLink = document.createElement('a');
          testLink.href = messengerSetup.pageUrl;
          testLink.target = '_blank';
          testLink.rel = 'noopener noreferrer';
          testLink.textContent = 'Open Facebook Page';
          row.append(testLink);
        }
      } else {
        detail.textContent = connected?'This location’s Facebook Page is connected.':
          connection?'Eden is preparing Facebook Page access for this location.':'Request Facebook Page setup for this location.';
        if (!connection && canManageClinic) row.append(channelButton('Request Messenger setup',button=>requestConnection(channel,button)));
      }
      const hadFocus = body.contains(document.activeElement);
      body.replaceChildren(row);
      if (hadFocus) heading.focus({preventScroll:true});
    }
    channelNav.hidden = workspaceView !== 'setup';
    if (workspaceView === 'setup') workspaceHero.hidden = true;
    renderConnectClinic();
    renderOverviewConnections();
    renderClinicProfile();
  }

  function bookingStatus(event) {
    if (event.kind === 'booking.cancelled') return 'Cancelled';
    if (event.kind === 'booking.updated') return {
      CONFIRMED: 'Confirmed', RESCHEDULE_REQUESTED: 'Reschedule requested', AWAITING_CLINIC: 'Needs confirmation'
    }[event.status];
    return '';
  }

  function messengerInboxLink(details) {
    if (!/^\d{5,30}$/.test(details?.pageId || '')) return null;
    const url = new URL('https://business.facebook.com/latest/inbox/all/');
    url.searchParams.set('asset_id', details.pageId);
    const hasConversation = /^\d{5,30}$/.test(details.senderId || '');
    if (hasConversation) {
      url.searchParams.set('selected_item_id', details.senderId);
      url.searchParams.set('thread_type', 'FB_MESSAGE');
    }
    const link = document.createElement('a');
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = hasConversation ? 'Open Messenger conversation' : 'Open Page inbox';
    return link;
  }

  function messengerConfirmation(event, latest, messengerLink, previousPanel) {
    if (event.channel !== 'facebook_messenger' || event.details?.demo === true ||
        latest?.action !== 'booked' || latest.recorded_action === 'cancelled' ||
        !Number.isFinite(Date.parse(latest.appointment_at))) return null;

    const href = messengerLink?.href || '';
    if (previousPanel?.dataset.appointmentAt === latest.appointment_at && previousPanel.dataset.messengerHref === href) {
      return previousPanel;
    }

    const time = new Intl.DateTimeFormat('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: clinicTimeZone(event.location_id),
      timeZoneName: 'shortOffset'
    }).format(new Date(latest.appointment_at));

    const panel = document.createElement('div');
    panel.className = 'clinic-messenger-confirmation';
    panel.dataset.appointmentAt = latest.appointment_at;
    panel.dataset.messengerHref = href;
    const message = 'Hi! Your appointment is confirmed for ' + time +
      '. Please reply here if you need to change your appointment. We look forward to seeing you!';
    const draft = document.createElement('textarea');
    draft.setAttribute('aria-label', 'Messenger confirmation reply');
    draft.readOnly = true;
    draft.rows = 3;
    draft.value = message;
    draft.hidden = true;

    const actions = document.createElement('div');
    actions.className = 'clinic-appointment-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'clinic-secondary';
    const copyLabel = href ? 'Copy reply & open Messenger' : 'Copy reply';
    copy.textContent = copyLabel;
    const feedback = document.createElement('small');
    feedback.setAttribute('role', 'status');
    if (messengerLink) messengerLink.hidden = true;
    copy.addEventListener('click', async () => {
      if (copy.disabled) return;
      copy.disabled = true;
      copy.textContent = 'Copying…';
      feedback.textContent = '';
      let messengerTab;
      try {
        const copying = navigator.clipboard.writeText(message);
        if (href) {
          messengerTab = window.open('about:blank', '_blank');
          if (messengerTab) messengerTab.opener = null;
        }
        await copying;
      } catch {
        messengerTab?.close();
        copy.textContent = copyLabel;
        draft.hidden = false;
        if (messengerLink) messengerLink.hidden = false;
        draft.focus();
        draft.select();
        feedback.textContent = 'Text selected. Press ⌘C or Ctrl+C to copy it.';
        return;
      } finally {
        copy.disabled = false;
      }
      draft.hidden = true;
      if (messengerTab?.closed) messengerTab = null;
      if (messengerLink) messengerLink.hidden = Boolean(messengerTab);
      copy.textContent = 'Copied';
      feedback.textContent = messengerTab ? 'Paste and send in Messenger.' :
        href ? 'Open Messenger, then paste and send.' : 'Reply copied to the clipboard.';
      messengerTab?.location.replace(href);
    });
    actions.append(copy);
    if (messengerLink) actions.append(messengerLink);
    panel.append(actions, feedback, draft);
    return panel;
  }

  function patientName(details) {
    return typeof details?.patientName === 'string' ? details.patientName.trim() : '';
  }

  function appendPatientDetails(row, details) {
    const name = patientName(details);
    if (name) {
      const line = document.createElement('small');
      line.textContent = 'Name · ' + name;
      row.append(line);
    }
    const contact = typeof details?.contact === 'string' ? details.contact.trim() : '';
    if (!contact) return;

    const email = /^([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(contact);
    const phone = contact.replace(/[(). -]/g, '');
    const isPhone = /^\+?\d{7,15}$/.test(phone);
    const line = document.createElement('small');
    if (email || isPhone) {
      line.textContent = email ? 'Email · ' : 'Phone · ';
      const link = document.createElement('a');
      link.href = email ? 'mailto:' + encodeURIComponent(email[1]) + '@' + email[2] : 'tel:' + phone;
      link.textContent = contact;
      line.append(link);
    } else {
      line.textContent = 'Contact · ' + contact;
    }
    row.append(line);
  }

  function renderInboxEvents(events, fallback) {
    const container = byId('clinic-inbox');
    if (!events.length) return empty(container, fallback);
    const previousRows = new Map([...container.children].map(row => [row.dataset.eventKey,row]));
    container.replaceChildren();
    for (const event of events) {
      const row = document.createElement('article'); row.className = 'clinic-event clinic-inbox-card';
      const previous = previousRows.get(event.event_key);
      if (event.event_key) {
        row.dataset.eventKey = event.event_key;
        row.tabIndex = -1;
      }
      const title = document.createElement('strong'); title.textContent = event.summary || event.kind || 'Activity';
      const needsFollowup = followupKinds.includes(event.kind) && event.event_key;
      const messengerTask = event.channel === 'facebook_messenger' && Boolean(event.details?.messengerRequestAction);
      const setupSample = isMessengerSetupSample(event);
      if (setupSample) title.textContent = 'Latest Messenger setup test';
      const latest = state.followups.get(event.event_key);
      const cancelled = latest?.recorded_action === 'cancelled';
      const ownClaim = latest?.action === 'claimed' && latest.actor_user_id === state.session?.user?.id;
      const assigneeName = clinicTeam.get(latest?.actor_user_id);
      const visit = clinicVisits.get(event.event_key);
      const statusLabel = visit ? 'Visit completed' : setupSample ? 'Setup test' : cancelled ? 'Cancelled' : needsFollowup ? ({
        booked: 'Booked',
        claimed: ownClaim ? 'Assigned to you' : 'Assigned to ' + (assigneeName || 'teammate'),
        handled: 'Handled'
      }[latest?.action] || {
        'call.followup_needed': 'Needs callback',
        'booking.requested': 'Needs confirmation',
        'inquiry.followup_needed': 'Needs staff reply'
      }[event.kind]) : bookingStatus(event);
      const heading = document.createElement('div');
      heading.className = 'clinic-event-heading';
      heading.append(title);
      if (statusLabel) {
        const badge = document.createElement('span');
        badge.className = 'clinic-event-status';
        if (['Booked', 'Confirmed', 'Visit completed'].includes(statusLabel)) badge.dataset.status = 'confirmed';
        if (statusLabel.startsWith('Needs ')) badge.dataset.status = 'attention';
        if (statusLabel === 'Cancelled') badge.dataset.status = 'cancelled';
        badge.textContent = statusLabel;
        heading.append(badge);
      }
      const meta = document.createElement('small');
      meta.className = 'clinic-inbox-meta';
      meta.textContent = [bookingSourceLabels[event.channel] || event.channel,
        statusLabel ? null : event.status,
        event.occurred_at && new Date(event.occurred_at).toLocaleString(undefined, {
          dateStyle: 'medium', timeStyle: 'short', timeZone: clinicTimeZone(event.location_id)
        })].filter(Boolean).join(' · ');
      row.append(heading, meta);
      if (setupSample) {
        const note = document.createElement('small');
        note.textContent = 'Fictional setup test · No appointment created';
        row.append(note);
      } else if (needsFollowup) {
        const details = document.createElement('details');
        details.className = 'clinic-inbox-detail';
        details.open = previous?.querySelector('.clinic-inbox-detail')?.open || false;
        const summary = document.createElement('summary');
        summary.textContent = 'Inquiry details';
        details.append(summary);
        const topics = Array.isArray(event.details?.topics)
          ? event.details.topics.filter(topic => typeof topic === 'string' && topic.trim()).slice(0, 3) : [];
        if (event.details?.service && (event.kind !== 'inquiry.followup_needed' || !topics.length)) {
          const service = document.createElement('p');
          service.className = 'clinic-inbox-subject';
          service.textContent = event.details.service;
          row.append(service);
        }
        const serviceLabel = typeof event.details?.service === 'string' ? event.details.service.toLowerCase() : '';
        const additionalTopics = event.kind === 'inquiry.followup_needed' ? topics :
          topics.filter(topic => topic.toLowerCase() !== serviceLabel);
        if (additionalTopics.length) {
          const line = document.createElement('small');
          line.textContent = 'Topics · ' + additionalTopics.join(', ');
          details.append(line);
        }
        if (event.details?.requestedTime) {
          const timing = document.createElement('small');
          timing.textContent = 'Requested time · ' + event.details.requestedTime;
          row.append(timing);
        }
        if (event.details?.demo !== true) appendPatientDetails(details, event.details);
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
        if (event.channel !== 'staff_booking') details.append(alert);
        const messengerLink = event.channel === 'facebook_messenger' && messengerInboxLink(event.details);
        const confirmation = messengerConfirmation(event, latest, messengerLink, previous?.querySelector('.clinic-messenger-confirmation'));
        if (messengerLink && !confirmation) {
          const line = document.createElement('small');
          line.append(messengerLink);
          details.append(line);
        }
        const originalKey = event.details?.relatedRequestKey;
        if (messengerTask && originalKey && dailyEvents.some(item => item.event_key === originalKey)) {
          const original = document.createElement('button');
          original.type = 'button';
          original.className = 'clinic-secondary';
          original.textContent = 'Open original request';
          original.addEventListener('click', () => openBookedActivity(originalKey, false, 'all'));
          const line = document.createElement('small');
          line.append(original);
          details.append(line);
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
        const hasVisitControls = visitRecordsAvailable && latest?.action === 'booked' && event.details?.demo !== true &&
          latest.appointment_at && Date.parse(latest.appointment_at) <= Date.now();
        if (hasVisitControls) {
          ClinicRescue.visitControls(row, {event, latest, visit, events:dailyEvents, client:state.client,
            currency:state.visitCurrency,timezone:clinicTimeZone(event.location_id),
            refresh:() => refreshActivity()});
        }
        const actions = visit ? [] : cancelled ? [['restored', 'Restore booking']] :
          latest?.action === 'booked' ? [['rescheduled', 'Change time'], ['cancelled', 'Cancel booking']] :
          latest?.action === 'claimed' ? (ownClaim ? [
            ...(messengerTask ? [] : [['booked', 'Confirm booking']]),
            ['reopened', 'Release assignment'], ['handled', 'Mark handled']
          ] : []) :
          latest?.action === 'handled' ? [['reopened', 'Reopen']] :
          [['claimed', 'Assign to me'], ['handled', 'Mark handled']];
        if (!messengerTask && (!latest || latest.action === 'reopened') && event.kind === 'booking.requested') {
          actions.unshift(['booked', 'Confirm booking']);
        }
        const canAssign = !latest || ['claimed', 'reopened'].includes(latest.action);
        if (canManageClinic && canAssign) {
          if (assignmentOptions(latest).length) {
            actions.push(['assign', latest?.action === 'claimed' ? 'Reassign' : 'Assign to teammate']);
          } else if (clinicTeamAvailable && isClinicOwner && clinicTeam.size === 1) {
            actions.push(['invite', 'Invite a teammate']);
          } else if (!clinicTeamAvailable) {
            const note = document.createElement('small');
            note.textContent = 'Team list unavailable. Refresh to try again.';
            details.append(note);
          }
        }
        if (actions.length) {
          const controls = document.createElement('div');
          controls.className = 'clinic-inbox-controls';
          const more = document.createElement('details');
          more.className = 'clinic-inbox-more';
          more.open = previous?.querySelector('.clinic-inbox-more')?.open || false;
          const moreLabel = document.createElement('summary');
          moreLabel.textContent = 'More actions';
          const secondary = document.createElement('div');
          more.append(moreLabel,secondary);
          for (const [index,[action,label]] of actions.entries()) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'clinic-followup-button';
            const primary = index === 0 && !hasVisitControls;
            if (!primary) button.classList.add('clinic-secondary');
            button.textContent = label;
            button.addEventListener('click', () => {
              if (['booked', 'rescheduled', 'cancelled', 'restored'].includes(action)) {
                showAppointmentEditor(event, controls, button, action, latest);
              } else if (action === 'assign') showAssignmentEditor(event, latest, controls, button);
              else if (action === 'invite') openTeammateInvite();
              else updateFollowup(event, action, controls);
            });
            (primary ? controls : secondary).append(button);
          }
          if (secondary.childElementCount) controls.append(more);
          row.append(controls);
        }
        if (details.childElementCount > 1) row.append(details);
        if (confirmation) row.append(confirmation);
      } else if (event.details?.demo !== true && ['booking.updated', 'booking.cancelled'].includes(event.kind)) {
        appendPatientDetails(row, event.details);
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

  byId('clinic-daily-attention').addEventListener('click', () => {
    const filter = inboxFilters.find(button=>button.dataset.filter==='attention');
    filter.click();
    filter.focus();
  });

  function renderDailyInbox(targetKey) {
    const activity = dailyEvents.filter(event => !isMessengerSetupSample(event));
    const attention = activity.filter(event => {
      if (!event.event_key || !followupKinds.includes(event.kind)) return false;
      const action = state.followups.get(event.event_key)?.action;
      return !action || action === 'reopened';
    });
    const assigned = activity.filter(event => {
      const latest = state.followups.get(event.event_key);
      return latest?.action === 'claimed' && latest.actor_user_id === state.session?.user?.id;
    });
    const booked = activity.filter(event => {
      const followup = state.followups.get(event.event_key);
      return followup?.recorded_action !== 'cancelled' &&
        (followup?.action === 'booked' || bookingStatus(event) === 'Confirmed');
    });
    const latestTest = dailyEvents.find(isMessengerSetupSample);
    const urgent = new Set(attention);
    byId('clinic-attention-count').textContent = String(attention.length);
    const missedCalls = attention.filter(event=>event.kind==='call.followup_needed').length;
    byId('clinic-home-attention').textContent = missedCalls===attention.length && missedCalls
      ? missedCalls + (missedCalls===1 ? ' missed call needs a callback' : ' missed calls need a callback')
      : attention.length ? attention.length + (attention.length===1 ? ' inquiry needs attention' : ' inquiries need attention')
      : 'No inquiries need attention';
    renderWorkspaceAlerts(activity, attention, booked);
    const views = {
      all: [[...attention,...activity.filter(event=>!urgent.has(event))], 'No activity yet for this location.'],
      attention: [attention, 'No unclaimed inquiries need follow-up.'],
      assigned: [assigned, 'No inquiries are assigned to you.'],
      booked: [booked, 'No confirmed bookings in recent activity.'],
      tests: [latestTest ? [latestTest] : [], 'No setup tests yet.']
    };
    for (const button of inboxFilters) {
      button.setAttribute('aria-pressed', String(button.dataset.filter === inboxFilter));
      if (button.dataset.filter === 'attention') button.textContent = 'Needs attention (' + attention.length + ')';
    }
    const [events, fallback] = views[inboxFilter];
    if (targetKey) {
      const index = events.findIndex(event => event.event_key === targetKey);
      if (index >= 0) inboxPage = Math.floor(index / inboxPageSize);
    }
    const pageCount = Math.ceil(events.length / inboxPageSize);
    inboxPage = Math.min(inboxPage, Math.max(0, pageCount - 1));
    const start = inboxPage * inboxPageSize;
    renderInboxEvents(events.slice(start, start + inboxPageSize), fallback);
    if (pageCount <= 1) return;

    const container = byId('clinic-inbox');
    const pager = document.createElement('nav');
    pager.className = 'clinic-appointment-actions clinic-inbox-pages';
    pager.setAttribute('aria-label', 'Activity inbox pages');
    const range = document.createElement('span');
    range.textContent = (start + 1) + '–' + Math.min(start + inboxPageSize, events.length) + ' of ' + events.length;
    for (const [label, offset] of [['Previous', -1], ['Next', 1]]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'clinic-secondary';
      button.textContent = label;
      const nextPage = inboxPage + offset;
      button.disabled = nextPage < 0 || nextPage >= pageCount;
      button.addEventListener('click', () => {
        inboxPage = nextPage;
        renderDailyInbox();
        const first = container.querySelector('article');
        first.tabIndex = -1;
        first.focus();
      });
      if (offset === 1) pager.append(range);
      pager.append(button);
    }
    container.append(pager);
  }

  function openBookedActivity(eventKey, showConfirmation = false, filter = 'booked') {
    const locate = () => [...byId('clinic-inbox').children].find(row => row.dataset.eventKey === eventKey);
    let card = locate();
    if (!card) {
      inboxFilter = filter;
      renderDailyInbox(eventKey);
      card = locate();
    }
    if (!card) return false;
    const confirmation = showConfirmation && card.querySelector('.clinic-messenger-confirmation');
    const target = confirmation ? confirmation.querySelector('button') : card;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest' });
    return true;
  }

  function renderDailyWork(inbox, bookings, locationId) {
    if (inboxLocation !== locationId) {
      inboxPage = 0;
      inboxLocation = locationId;
    }
    if (manualBooking && (manualBooking.locationId !== locationId ||
        manualBooking.accountId !== byId('clinic-account').value)) closeManualBooking();
    const byKey = new Map(inbox.filter(event => event.event_key).map(event => [event.event_key, event]));
    for (const booking of bookings) {
      if (!byKey.has(booking.event_key) && booking.event_key && booking.details?.demo !== true) {
        byKey.set(booking.event_key, booking);
      }
    }
    dailyEvents = [...byKey.values(), ...inbox.filter(event => !event.event_key)]
      .filter(event => !['comment.draft', 'comment.messenger_started'].includes(event.kind))
      .sort((a, b) => (Date.parse(b.occurred_at) || 0) - (Date.parse(a.occurred_at) || 0));
    renderDailyInbox();
    renderTodayAppointments(locationId);
    byId('clinic-daily-location').textContent = state.locations.find(row=>row.id===locationId)?.name || '';
    daily.hidden = false;
    updateHeroAction();
  }

  function renderTodayAppointments(locationId) {
    const timeZone = clinicTimeZone(locationId);
    const dateLabel = new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'full' });
    const timeLabel = new Intl.DateTimeFormat(undefined, { timeZone, timeStyle: 'short' });
    const today = dateLabel.format(new Date());
    const appointments = [];
    for (const event of dailyEvents) {
      if (event.details?.demo === true) continue;
      const latest = state.followups.get(event.event_key);
      const date = Date.parse(latest?.appointment_at);
      if (latest?.action === 'booked' && Number.isFinite(date) && dateLabel.format(date) === today) {
        appointments.push({ event, date });
      }
    }
    appointments.sort((a, b) => a.date - b.date);
    byId('clinic-today-count').textContent = String(appointments.length);
    byId('clinic-home-appointments').textContent = appointments.length + (appointments.length===1 ? ' appointment today' : ' appointments today');
    byId('clinic-today-date').textContent = today;
    const list = byId('clinic-today');
    if (appointments.length) {
      list.replaceChildren();
      for (const { event, date } of appointments) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'clinic-event clinic-secondary clinic-today-booking';
        const title = document.createElement('strong');
        const name = patientName(event.details);
        const service = event.details?.service;
        title.textContent = name || service || event.summary || 'Appointment';
        const time = document.createElement('small');
        time.textContent = [timeLabel.format(date), name && service, bookingSourceLabels[event.channel] || event.channel]
          .filter(Boolean).join(' · ');
        row.append(title, time);
        row.addEventListener('click', () => openBookedActivity(event.event_key));
        list.append(row);
      }
    } else {
      empty(list, 'No confirmed appointments today in recent activity.');
    }
  }

  function clinicDateTimeValue(instant, timeZone) {
    if (!instant || !Number.isFinite(Date.parse(instant))) return '';
    const parts = new Intl.DateTimeFormat('en-GB-u-ca-iso8601-nu-latn', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(instant));
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return values.year + '-' + values.month + '-' + values.day + 'T' + values.hour + ':' + values.minute;
  }

  function requestedAppointmentValue(requestedTime) {
    if (typeof requestedTime !== 'string') return '';
    const text = requestedTime.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?: at |T| )(.+)$/i.exec(text);
    let year, month, day, weekday, time;
    if (iso) {
      [year, month, day] = iso.slice(1, 4).map(Number);
      time = iso[4];
    } else {
      const written = /^(?:(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),? )?(?:([A-Za-z]+) (\d{1,2})|(\d{1,2}) ([A-Za-z]+)),? (\d{4}) at (.+)$/i.exec(text);
      if (!written) return '';
      const [, dayName, firstMonth, firstDay, secondDay, secondMonth, yearNumber, clock] = written;
      const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
      const monthName = (firstMonth || secondMonth).toLowerCase();
      month = months.findIndex(name => name === monthName || name.slice(0, 3) === monthName) + 1;
      if (!month) return '';
      year = Number(yearNumber);
      day = Number(firstDay || secondDay);
      weekday = dayName;
      time = clock;
    }

    const meridiem = /^(0?[1-9]|1[0-2])(?::([0-5]\d))?\s*([AP])\.?M\.?$/i.exec(time);
    const military = /^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/.exec(time);
    let hours, minutes;
    if (meridiem) {
      hours = Number(meridiem[1]) % 12 + (meridiem[3].toUpperCase() === 'P' ? 12 : 0);
      minutes = Number(meridiem[2] || 0);
    } else if (military) {
      [hours, minutes] = military.slice(1).map(Number);
    } else if (time.toLowerCase() === 'noon') {
      hours = 12;
      minutes = 0;
    } else {
      return '';
    }
    const value = new Date(Date.UTC(year, month - 1, day, hours, minutes));
    if (value.getUTCFullYear() !== year || value.getUTCMonth() + 1 !== month ||
        value.getUTCDate() !== day || value.getUTCHours() !== hours || value.getUTCMinutes() !== minutes) return '';
    if (weekday && weekday.toLowerCase() !== value.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toLowerCase()) return '';
    return value.toISOString().slice(0, 16);
  }

  function closeManualBooking() {
    manualBooking = undefined;
    addBookingForm.hidden = true;
    addBookingForm.reset();
    for (const field of addBookingForm.elements) field.disabled = false;
    addBookingForm.querySelector('button[type="submit"]').textContent = 'Book appointment';
    addBookingFeedback.hidden = true;
    addBookingButton.setAttribute('aria-expanded', 'false');
  }

  addBookingButton.addEventListener('click', () => {
    if (manualBooking) {
      if (!manualBooking.saving) addBookingForm.elements.patientName.focus();
      return;
    }
    const accountId = byId('clinic-account').value;
    const locationId = byId('clinic-location').value;
    if (!accountId || !locationId) return;
    const timeZone = clinicTimeZone(locationId);
    manualBooking = { accountId, locationId, timeZone, id: crypto.randomUUID() };
    addBookingResult.hidden = true;
    setManualVisitTime();
    byId('clinic-add-booking-zone').textContent = 'Appointment time is in ' + timeZone + '.';
    addBookingForm.hidden = false;
    addBookingButton.setAttribute('aria-expanded', 'true');
    addBookingForm.elements.patientName.focus();
  });

  function setManualVisitTime() {
    const walkin = addBookingForm.elements.entryType.value === 'walkin';
    const time = addBookingForm.elements.appointment;
    const localNow = clinicDateTimeValue(new Date().toISOString(), manualBooking.timeZone);
    time.min = walkin ? '' : clinicDateTimeValue(new Date(Date.now()+60000).toISOString(),manualBooking.timeZone);
    time.max = walkin ? localNow : '';
    time.value = walkin ? localNow : '';
    addBookingForm.querySelector('button[type="submit"]').textContent = walkin ? 'Record walk-in' : 'Book appointment';
  }
  addBookingForm.elements.entryType.addEventListener('change',setManualVisitTime);

  addBookingClose.addEventListener('click', () => {
    closeManualBooking();
    addBookingButton.focus();
  });

  addBookingForm.addEventListener('submit', async event => {
    event.preventDefault();
    const booking = manualBooking;
    if (!booking || booking.saving) return;
    if (booking.accountId !== byId('clinic-account').value || booking.locationId !== byId('clinic-location').value) {
      closeManualBooking();
      return;
    }
    const { patientName, service, appointment } = addBookingForm.elements;
    const payload = {
      p_account_id: booking.accountId, p_location_id: booking.locationId, p_submission_id: booking.id,
      p_patient_name: patientName.value.trim(), p_service: service.value.trim(), p_local_time: appointment.value
    };
    const fields = [...addBookingForm.elements];
    const save = addBookingForm.querySelector('button[type="submit"]');
    booking.saving = true;
    fields.forEach(field => { field.disabled = true; });
    save.textContent = 'Booking…';
    addBookingFeedback.hidden = true;
    let saved = false;
    try {
      const walkin = addBookingForm.elements.entryType.value === 'walkin';
      const {data:eventKey,error} = walkin ? await state.client.rpc('record_clinic_walkin',{
        p_location:booking.locationId,p_submission:booking.id,p_name:patientName.value.trim(),p_service:service.value.trim(),
        p_local_time:appointment.value,p_currency:booking.timeZone==='Asia/Bangkok' ? 'THB' : 'PHP'
      }) : await state.client.rpc('create_manual_clinic_booking',payload);
      if (manualBooking !== booking) return;
      if (error) {
        addBookingFeedback.textContent = ['22023', '23514'].includes(error.code) ? error.message :
          'Could not save the booking. Try again.';
        addBookingFeedback.hidden = false;
        return;
      }
      saved = true;
      closeManualBooking();
      addBookingResult.textContent = walkin ? 'Walk-in recorded. You can add the amount collected or link an Eden request.' : 'Appointment booked.';
      addBookingResult.hidden = false;
      inboxFilter = 'booked';
      await refreshActivity();
      if (workspaceView === 'daily' && !openBookedActivity(eventKey)) addBookingButton.focus();
    } catch {
      if (saved) {
        addBookingResult.textContent = 'Appointment booked. Refresh Daily Action to see it.';
      } else if (manualBooking === booking) {
        addBookingFeedback.textContent = 'Could not verify the booking. Retry this form to check.';
        addBookingFeedback.hidden = false;
      }
    } finally {
      if (manualBooking === booking) {
        fields.forEach(field => { field.disabled = false; });
        save.textContent = 'Book appointment';
        booking.saving = false;
      }
    }
  });

  function showAppointmentEditor(event, controls, opener, action, latest) {
    const form = document.createElement('form');
    form.className = 'clinic-appointment-editor';
    const help = document.createElement('p');
    const cancelling = action === 'cancelled';
    let input, timeZone;
    if (cancelling) {
      help.textContent = 'Cancel this appointment? It will remain in All activity as Cancelled.';
    } else {
      timeZone = clinicTimeZone(event.location_id);
      const locationName = state.locations.find(location => location.id === event.location_id)?.name;
      const label = document.createElement('label');
      label.textContent = 'Appointment date and time';
      input = document.createElement('input');
      input.type = 'datetime-local';
      input.required = true;
      const previousTime = action === 'restored' ? latest?.previous_appointment_at : latest?.appointment_at;
      const requested = action === 'booked' && requestedAppointmentValue(event.details?.requestedTime);
      const future = requested && requested >= clinicDateTimeValue(new Date(Date.now() + 60000).toISOString(), timeZone);
      input.value = future ? requested : clinicDateTimeValue(previousTime, timeZone);
      label.append(input);
      form.append(label);
      help.textContent = 'Enter the agreed time in ' + (locationName ? locationName + ' time' : 'the clinic’s time zone') +
        ' (' + timeZone + ').';
      if (future) help.textContent = 'Prefilled from the request. ' + help.textContent;
      if (action === 'restored') {
        help.textContent = 'Check that the appointment time is still available. ' + help.textContent;
      }
    }
    const errorLine = document.createElement('p');
    errorLine.className = 'clinic-appointment-error';
    errorLine.setAttribute('role', 'alert');
    errorLine.hidden = true;
    const checkAppointmentTime = () => {
      if (!input) return true;
      input.min = clinicDateTimeValue(new Date(Date.now() + 60000).toISOString(), timeZone);
      const pastTime = input.value && input.value < input.min;
      if (pastTime) errorLine.textContent = 'Choose an appointment time in the future.';
      errorLine.hidden = !pastTime;
      return !pastTime;
    };
    if (input) {
      input.addEventListener('input', checkAppointmentTime);
      checkAppointmentTime();
    }
    const group = document.createElement('div');
    group.className = 'clinic-appointment-actions';
    const save = document.createElement('button');
    save.type = 'submit';
    const saveLabel = {
      booked: 'Book appointment', rescheduled: 'Save new time',
      cancelled: 'Yes, cancel booking', restored: 'Confirm restoration'
    }[action];
    save.textContent = saveLabel;
    const progress = document.createElement('p');
    progress.className = 'clinic-appointment-progress';
    progress.setAttribute('role', 'status');
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'clinic-secondary';
    back.textContent = cancelling ? 'Keep booking' : 'Close';
    group.append(save, back);
    form.append(help, errorLine, group, progress);

    const rowButtons = [...controls.querySelectorAll('button')];
    rowButtons.forEach(button => { button.disabled = true; });
    back.addEventListener('click', () => {
      form.remove();
      rowButtons.forEach(button => { button.disabled = false; });
      opener.focus();
    });
    form.addEventListener('submit', async submission => {
      submission.preventDefault();
      if (save.disabled || !checkAppointmentTime()) return;
      save.disabled = back.disabled = true;
      if (input) input.disabled = true;
      errorLine.hidden = true;
      save.textContent = action === 'booked' ? 'Booking…' : cancelling ? 'Cancelling…' : 'Saving…';
      progress.textContent = cancelling ? 'Cancelling the appointment…' : 'Saving the appointment…';
      const generation = state.generation;
      let saved = false;
      try {
        const { error } = await state.client.rpc('save_clinic_appointment', {
          p_account_id: event.account_id, p_location_id: event.location_id, p_event_key: event.event_key,
          p_action: action, p_prior_action_at: action === 'booked' ? null : latest.created_at,
          p_local_time: input?.value || null
        });
        if (generation !== state.generation) return;
        if (error?.code === '23505') {
          await refreshActivity();
          status('This booking changed. Review its current status before trying again.', 'error');
          inboxFilters.find(button => button.dataset.filter === inboxFilter)?.focus();
          return;
        }
        if (error) {
          errorLine.textContent = ['22023','23514'].includes(error.code) ? error.message : 'Could not save the booking. Try again.';
          errorLine.hidden = false;
          return;
        }
        saved = true;
        progress.textContent = 'Saved. Updating Daily Action…';
        const followups = await getFollowups(event.account_id, event.location_id);
        if (generation !== state.generation) return;
        loadedGeneration = ++state.generation;
        state.followups = new Map(followups.map(row => [row.event_key, row]));
        if (action === 'booked') inboxFilter = 'booked';
        renderDailyInbox();
        renderTodayAppointments(event.location_id);
        status({
          booked: 'Appointment booked.', rescheduled: 'Appointment time updated.',
          cancelled: 'Booking cancelled.', restored: 'Booking restored.'
        }[action], 'success');
        if (workspaceView !== 'daily' ||
            (!cancelling && openBookedActivity(event.event_key, event.channel === 'facebook_messenger'))) return;
        inboxFilters.find(button => button.dataset.filter === inboxFilter)?.focus();
      } catch {
        errorLine.textContent = saved ? 'The change was saved. Refresh Daily Action to see it.' :
          'Could not verify the change. Refresh Daily Action to check the appointment.';
        errorLine.hidden = false;
      } finally {
        progress.textContent = '';
        save.textContent = saved ? 'Saved' : saveLabel;
        save.disabled = saved;
        back.disabled = false;
        if (input) input.disabled = saved;
      }
    });
    controls.append(form);
    (input || back).focus();
  }

  function openTeammateInvite() {
    switchWorkspaceView('settings', true);
    const invite = byId('clinic-team-invite');
    const details = invite.querySelector('details');
    details.open = true;
    details.querySelector('input').focus({ preventScroll: true });
    invite.scrollIntoView({ block: 'nearest' });
  }

  function assignmentOptions(latest) {
    const userId = state.session?.user?.id;
    const assigned = latest?.action === 'claimed';
    const currentAssignee = assigned ? latest.actor_user_id : userId;
    const options = [...clinicTeam].filter(([id]) => id !== currentAssignee && id !== userId);
    if (assigned && userId && userId !== currentAssignee) options.unshift([userId, 'Me']);
    if (assigned) options.push(['unassigned', 'Unassigned']);
    return options;
  }

  function showAssignmentEditor(event, latest, controls, opener) {
    const form = document.createElement('form');
    form.className = 'clinic-appointment-editor clinic-assignment-editor';
    const label = document.createElement('label');
    label.textContent = 'Assign this inquiry to';
    const select = document.createElement('select');
    select.required = true;
    select.add(new Option('Choose an assignee', ''));
    const options = assignmentOptions(latest);
    for (const [id, name] of options) {
      const duplicate = options.some(([other, label]) => other !== id && label === name);
      select.add(new Option(duplicate ? name + ' · ' + id.slice(-6) : name, id));
    }
    label.append(select);
    const errorLine = document.createElement('p');
    errorLine.className = 'clinic-appointment-error';
    errorLine.setAttribute('role', 'alert');
    errorLine.hidden = true;
    const group = document.createElement('div');
    group.className = 'clinic-appointment-actions';
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Save assignment';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'clinic-secondary';
    back.textContent = 'Close';
    group.append(save, back);
    form.append(label, errorLine, group);

    const rowButtons = [...controls.querySelectorAll('button')];
    rowButtons.forEach(button => { button.disabled = true; });
    back.addEventListener('click', () => {
      form.remove();
      rowButtons.forEach(button => { button.disabled = false; });
      opener.focus();
    });
    form.addEventListener('submit', async submission => {
      submission.preventDefault();
      const assignee = select.value;
      const unassign = assignee === 'unassigned';
      if (save.disabled || !options.some(([id]) => id === assignee)) return;
      select.disabled = save.disabled = back.disabled = true;
      errorLine.hidden = true;
      const generation = state.generation;
      try {
        const { error } = await state.client.from('clinic_followup_actions').insert({
          account_id: event.account_id, location_id: event.location_id, event_key: event.event_key,
          actor_user_id: state.session.user.id, action: unassign ? 'reopened' : 'claimed',
          assigned_user_id: unassign ? null : assignee, prior_action_at: latest?.created_at || null
        });
        if (generation !== state.generation) return;
        if (error?.code === '23505') {
          await refreshActivity();
          status('This inquiry changed. Review the current assignment before trying again.', 'error');
        } else if (error) {
          errorLine.textContent = error.code === '42501' ?
            'Assignment requires an owner or admin and an active teammate.' : 'Could not save the assignment. Try again.';
          errorLine.hidden = false;
          return;
        } else {
          await refreshActivity();
          status(unassign ? 'Inquiry returned to Needs attention.' : 'Inquiry assigned.', 'success');
        }
        inboxFilters.find(button => button.dataset.filter === inboxFilter)?.focus();
      } catch {
        errorLine.textContent = 'Could not refresh assignments. Refresh the workspace before trying again.';
        errorLine.hidden = false;
      } finally {
        select.disabled = save.disabled = back.disabled = false;
      }
    });
    controls.append(form);
    select.focus();
  }

  async function updateFollowup(event, action, controls) {
    const buttons = [...controls.querySelectorAll('button')];
    const generation = state.generation;
    buttons.forEach(button => { button.disabled = true; });
    try {
      await request('/clinic/followups', { method: 'POST', body: JSON.stringify({
        accountId: event.account_id,
        locationId: event.location_id,
        eventKey: event.event_key, action
      }) });
      if (state.generation !== generation) return;
      await refreshActivity();
      status({
        claimed: 'Inquiry moved to Assigned to me. Confirm the booking after agreeing a time with the patient.',
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

  async function getFollowups(accountId, locationId) {
    const { data, error } = await state.client.from('clinic_followup_states')
      .select('event_key,action,recorded_action,actor_user_id,created_at,appointment_at,previous_appointment_at')
      .eq('account_id', accountId).eq('location_id', locationId);
    if (error) throw Error('Could not load booking activity. Please refresh.');
    return data;
  }

  function refreshActivity(quiet = false) {
    if (quiet) return loadActivity(true, state.generation);
    const generation = ++state.generation;
    return workspaceLoad(generation, () => loadActivity(false, generation));
  }

  async function loadActivity(quiet, generation) {
    if (!quiet) {
      commentPilotPanel.hidden = true;
      clearOwnerOverview();
    }
    const accountId = byId('clinic-account').value;
    const locationId = byId('clinic-location').value;
    if (!accountId || !locationId) {
      byId('clinic-overview-revenue').textContent = 'No clinic location is available.';
      return;
    }
    if (quiet) void refreshSupportAlerts(locationId, generation);
    const activityQuery = '?accountId=' + encodeURIComponent(accountId) + '&locationId=' + encodeURIComponent(locationId);
    const [bookings, inbox, followups, connections, team, currency] = await timedRead(Promise.all([
      request('/clinic/bookings' + activityQuery), request('/clinic/inbox' + activityQuery + '&limit=100'),
      getFollowups(accountId, locationId),
      quiet ? null : request('/clinic/connections' + activityQuery),
      quiet ? null : state.client.rpc('list_clinic_team', { p_account_id: accountId })
        .then(({ data, error }) => error ? null : data || [], () => null),
      quiet ? null : state.client.rpc('clinic_visit_currency', {p_location: locationId})
        .then(({data,error}) => error ? '' : data, () => '')
    ]));
    if (generation !== state.generation) return;
    const keys = [...new Set([...inbox, ...bookings].map(item => item.event_key).filter(key => key && followups.some(f => f.event_key === key && f.action === 'booked')))];
    const visitPages = await timedRead(Promise.all(Array.from({length:Math.ceil(keys.length / 25)}, (_, i) =>
      state.client.from('clinic_visit_completions').select('event_key,eden_event_key,amount_minor,currency,revision,receipt_ref')
        .eq('location_id',locationId).in('event_key',keys.slice(i*25,i*25+25)))));
    if (generation !== state.generation || (quiet && !canRefreshInbox())) return;
    visitRecordsAvailable = visitPages.every(page => !page.error);
    const visits = visitPages.flatMap(page => page.data || []);
    const date = new Date().toLocaleDateString('en-CA', { timeZone: clinicTimeZone(locationId) });
    const signature = JSON.stringify([accountId, locationId, date, inbox, bookings, followups, visits, visitRecordsAvailable, followups.filter(f => f.appointment_at && Date.parse(f.appointment_at)<=Date.now()).length]);
    if (quiet && inboxSignature === signature) return;
    state.followups = new Map(followups.map(row => [row.event_key, row]));
    clinicVisits = new Map(visits.map(visit => [visit.event_key, visit]));
    if (!quiet) {
      const timezone = clinicTimeZone(locationId);
      state.visitCurrency = currency;
      if (operationsAvailable && isClinicOwner && workspaceViews.ownerSupport.dataset.location !== locationId) {
        workspaceViews.ownerSupport.dataset.location = locationId;
        const panel = ClinicOperations.owner(state.client,locationId,facts=>{
          if (byId('clinic-location').value!==locationId) return;
          clinicFactsRequest=undefined;
          const messenger=selectedMessengerGuide();
          if (messenger) {
            messenger.facts=facts;
            renderChannels();
            renderMessengerGuide({resetFacts:true});
          }
        }, target => {
          if (target === 'staff_alert') {
            switchWorkspaceView('settings',true);
            focusProfileControl(alertEmailInput);
          } else {
            switchWorkspaceView('profile',true);
            byId('clinic-profile-'+target)?.click();
          }
        });
        panel.addEventListener('eden-support-reviewed', () => void refreshSupportAlerts());
        workspaceViews.ownerSupport.replaceChildren(panel);
      } else if (!operationsAvailable || !isClinicOwner) {
        delete workspaceViews.ownerSupport.dataset.location;
        workspaceViews.ownerSupport.replaceChildren();
      }
      void refreshSupportAlerts(locationId, generation);
      ClinicRescue.pending({client:state.client,locationId,timezone,candidates:()=>dailyEvents,refresh:()=>refreshActivity()});
      ClinicRescue.attributionReviews({client:state.client,locationId,timezone});
      const clinicName = state.locations.find(l=>l.id===locationId)?.name || '';
      const openReportHere = openRequestedReport && canManageClinic &&
        (!query.has('location') || query.get('location')===locationId);
      openRequestedReport = false;
      byId('clinic-revenue-location').textContent = canManageClinic ? clinicName : '';
      ClinicRescue.reports({client:state.client,locationId,clinicName,manager:canManageClinic,owner:isClinicOwner,operationsAvailable,email:state.session?.user.email,
        timezone,reportId:openReportHere && query.get('location')===locationId ? query.get('report') : null});
      publishedWebsite = false;
      state.connections = connections;
      if (canManageClinic) {
        overviewLocation = {accountId,locationId};
        byId('clinic-overview-location').textContent = state.locations.find(row=>row.id===locationId)?.name || '';
        const reportLink = byId('clinic-overview-open-report');
        workspaceViews.links.overview.href = '/clinic/?' + new URLSearchParams({view:'overview',account:accountId,location:locationId});
        workspaceViews.links.revenue.href = '/clinic/?' + new URLSearchParams({view:'revenue',account:accountId,location:locationId});
        reportLink.href = workspaceViews.links.revenue.href;
        reportLink.hidden = false;
      }
      switchWorkspaceView(openReportHere ? 'revenue' : workspaceView);
      clinicTeamAvailable = team !== null;
      clinicTeam = new Map((team || []).map(row => [row.user_id, row.display_name]));
      pearlPilotLink.hidden = locationId !== 'b865c71a-e9f1-4b09-acb5-0b5043ab4307';
      renderChannels();
      renderCommentPilot(inbox);
      const website = connections.find(row => row.channel === 'website_chat');
      if (!window.edenClinicPreview && (!website || ['requested', 'verifying'].includes(website.status))) {
        void checkWebsitePublication(accountId, locationId, generation);
      }
    }
    renderDailyWork(inbox, bookings, locationId);
    guideInbox = inbox;
    if (!quiet) renderMessengerGuide();
    inboxSignature = signature;
    loadedGeneration = generation;
    if (!quiet) status('Workspace loaded for ' + state.locations.find(row => row.id === locationId)?.name + '.', 'success', true);
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
    const note = byId('clinic-settings-alert-note');
    note.hidden = !canManageClinic || !alertEmailForm.hidden;
    byId('clinic-settings-alerts').hidden = !canManageClinic;
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

  function canRefreshInbox() {
    return state.session && !document.hidden && !daily.hidden &&
      loadedGeneration === state.generation && !document.querySelector('.clinic-appointment-editor:not([hidden])');
  }

  async function pollInbox() {
    if (backgroundRefresh || !canRefreshInbox()) return;
    if (workspaceView!=='daily' && Date.now()-lastInboxPoll<30000) return;
    lastInboxPoll = Date.now();
    backgroundRefresh = true;
    try {
      await refreshActivity(true);
    } catch { /* The next refresh will retry without interrupting staff. */ }
    finally { backgroundRefresh = false; }
  }

  window.setInterval(pollInbox, 12000);
  window.addEventListener('focus', pollInbox);
  document.addEventListener('visibilitychange', pollInbox);

  async function checkWebsitePublication(accountId, locationId, generation) {
    try {
      const {data} = await state.client.auth.getSession();
      if (!data?.session || generation !== state.generation) return;
      const response = await fetch(setupOrigin + '/api/assistants/workspace-status', {
        method:'POST', cache:'no-store', redirect:'error', signal:AbortSignal.timeout(12000),
        headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},
        body:JSON.stringify({accountId,locationId})
      });
      if (!response.ok || (await response.json()).published !== true) return;
      if (generation !== state.generation || accountId !== byId('clinic-account').value ||
          locationId !== byId('clinic-location').value) return;
      publishedWebsite = true;
      renderChannels(channelSteps.filter(step => step.channel === 'website_chat'));
    } catch { /* Keep the saved inbox status when publication cannot be verified. */ }
  }

  async function openWebsiteSetup(button, feedback = (message, kind) => channelFeedback('website_chat',message,kind)) {
    if (window.edenClinicPreview) {
      feedback('Open Website Chat setup from your live Clinic Workspace.', 'info');
      return;
    }
    const userId = state.session?.user?.id;
    const accountId = byId('clinic-account').value;
    const locationId = byId('clinic-location').value;
    const current = () => state.session?.user?.id === userId &&
      byId('clinic-account').value === accountId && byId('clinic-location').value === locationId;
    if (!userId || !canManageClinic || !accountId || !locationId) {
      feedback('Sign in as an owner or admin and choose a clinic location.','error');
      return;
    }
    button.disabled = true;
    feedback('Opening the AI receptionist editor…');
    try {
      const {data:auth, error} = await state.client.auth.getSession();
      if (error || !auth?.session?.access_token || auth.session.user?.id !== userId) {
        throw Error('Your session has expired. Sign in to Workspace again.');
      }
      if (!current()) return;
      const response = await fetch(setupOrigin + '/api/assistants/workspace-link', {
        method:'POST', cache:'no-store', redirect:'error', signal:AbortSignal.timeout(20000),
        headers:{Authorization:'Bearer '+auth.session.access_token,'Content-Type':'application/json'},
        body:JSON.stringify({accountId,locationId})
      });
      const data = await response.json().catch(()=>null);
      if (response.status===503) throw Error('The AI receptionist editor is temporarily unavailable. Try again in a moment. If it keeps happening, contact Eden Support.');
      if (!response.ok) throw Error(data?.error || 'The setup service did not respond. Try again.');
      const destination = new URL(data?.url || '',setupOrigin);
      if (destination.origin!==setupOrigin || destination.pathname!=='/assistant-setup/' ||
          destination.username || destination.password || destination.search!=='?workspace=1' ||
          !/^#workspace=[a-f0-9]{48}$/.test(destination.hash)) {
        throw Error('The private setup link could not be verified. Try again.');
      }
      if (current()) {
        feedback('Taking you to the AI receptionist editor…');
        window.location.assign(destination.href);
      }
    } catch (error) {
      if (current()) feedback(
        error.name==='TimeoutError'?'Setup took too long to open. Try again.':
          error instanceof TypeError?'Could not reach private setup. Try again.':error.message,'error');
    } finally { button.disabled = false; }
  }

  async function requestConnection(channel, button) {
    const accountId = byId('clinic-account').value;
    const locationId = byId('clinic-location').value;
    const isCurrentLocation = () => state.session && accountId===byId('clinic-account').value &&
      locationId===byId('clinic-location').value;
    button.disabled = true;
    channelFeedback(channel,'Saving your setup request…');
    try {
      await request('/clinic/connections',{method:'POST',body:JSON.stringify({accountId,locationId,channel})});
      if (!isCurrentLocation()) return;
      await refreshActivity();
      if (isCurrentLocation()) channelFeedback(channel,channel==='ai_phone'
        ?'Phone setup started. Check here for your forwarding number.'
        :'Request saved for this location.','success');
    } catch (error) {
      if (isCurrentLocation()) channelFeedback(channel,error.message,'error');
    } finally { button.disabled = false; }
  }

  async function checkPhoneSetup(button) {
    const accountId = byId('clinic-account').value;
    const locationId = byId('clinic-location').value;
    const current = () => state.session && accountId===byId('clinic-account').value &&
      locationId===byId('clinic-location').value;
    const checkingTest = button.textContent === 'Check test call';
    button.disabled = true;
    channelFeedback('ai_phone','Checking phone setup…');
    try {
      await refreshActivity();
      if (!current()) return;
      const phone = state.connections.find(row=>row.channel==='ai_phone');
      if (phone?.status==='connected') channelFeedback('ai_phone','Call received. The line is connected.','success');
      else if (phone?.status==='verifying' && phone.forwarding_number)
        channelFeedback('ai_phone',checkingTest?'No completed test call yet. Give it a moment after hanging up, then check again.':'Your forwarding number is ready. Follow the test steps above.');
      else if (phone?.status==='action_required' || phone?.status==='disconnected')
        channelFeedback('ai_phone','This phone connection needs attention.','error');
      else channelFeedback('ai_phone','Your forwarding number is still pending.');
    } catch (error) {
      if (current()) channelFeedback('ai_phone',error.message,'error');
    } finally { button.disabled = false; }
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
      throw Error('Messenger sign-in expired. Return to the Facebook connection step to try again.');
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
    if (!guide.hidden) {
      switchWorkspaceView('setup');
      channelSteps.find(step=>step.channel==='facebook_messenger').panel.open = true;
      byId('clinic-messenger-test-help').focus();
    }
  }

  function focusSetupChannel(selection) {
    if (!channels.has(selection?.channel) ||
        (selection.accountId && byId('clinic-account').value !== selection.accountId) ||
        (selection.locationId && byId('clinic-location').value !== selection.locationId)) return;
    if (byId('clinic-location').value) {
      switchWorkspaceView('setup');
      channelSteps.find(step=>step.channel===selection.channel)?.link.click();
    }
  }

  async function acceptWorkspaceInvite() {
    if (!/^[a-f0-9]{64}$/.test(pendingInvite || '')) return null;
    if (!acceptingInvite) {
      const token = pendingInvite;
      const userId = state.session.user.id;
      acceptingInvite = (async () => {
        const {data, error} = await state.client.rpc('accept_clinic_workspace_invite', {p_token:token});
        if (state.session?.user?.id !== userId) return null;
        if (error) {
          throw Object.assign(Error(error.message || 'Could not open the clinic invitation.'), {
            inviteRejected: error.code === '22023'
          });
        }
        pendingInvite = null;
        sessionStorage.removeItem(invitationKey);
        return data;
      })().finally(() => { acceptingInvite = null; });
    }
    return acceptingInvite;
  }

  byId('clinic-invite-form').onsubmit = async event => {
    event.preventDefault();
    if (!isClinicOwner) return;
    const form = event.target, button = form.querySelector('button'), note = byId('clinic-invite-status');
    if (button.disabled) return;
    const accountId = byId('clinic-account').value, locationId = byId('clinic-location').value;
    const userId = state.session?.user?.id;
    const current = () => state.session?.user?.id === userId &&
      byId('clinic-account').value === accountId && byId('clinic-location').value === locationId;
    const fields = new FormData(form);
    button.disabled = true;
    show('clinic-invite-link', false);
    byId('clinic-invite-url').value = '';
    note.textContent = 'Creating invitation…';
    try {
      const {data, error} = await state.client.rpc('create_clinic_workspace_invite', {
        p_account_id: accountId, p_location_id: locationId, p_email: fields.get('email'),
        // The invitation RPC still requires a legacy setup channel. Accepted invites open Daily Action.
        p_role: fields.get('role'), p_channel: 'website_chat'
      });
      if (error) throw Error(error.message || 'Could not create the invitation.');
      if (!/^[a-f0-9]{64}$/.test(data || '')) throw Error('The invitation could not be verified.');
      if (current()) {
        byId('clinic-invite-url').value = location.origin + '/clinic/#clinic-invite=' + data;
        show('clinic-invite-link', true);
        note.textContent = 'Send the link to the address entered above. Your teammate should use that address to sign in to Workspace.';
      }
    } catch (error) {
      if (current()) note.textContent = error.message;
    } finally { button.disabled = false; }
  };

  byId('clinic-invite-copy').onclick = async () => {
    const input = byId('clinic-invite-url');
    if (!input.value) return;
    try {
      await navigator.clipboard.writeText(input.value);
      byId('clinic-invite-status').textContent = 'Invitation link copied.';
    } catch {
      input.focus();
      input.select();
    }
  };

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
    operationsAvailable = false;
    workspaceViews.operatorPanel.hidden = true;
    workspaceViews.operatorPanel.replaceChildren();
    workspaceViews.ownerSupport.replaceChildren();
    delete workspaceViews.ownerSupport.dataset.location;
    clearOwnerOverview();
    clearRevenueView();
    daily.hidden = true;
    show('clinic-create', false);
    renderWorkspaceHero(Boolean(session));
    if (session) codeForm.reset();
    show('clinic-signin', !session);
    show('clinic-authenticated', Boolean(session));
    document.body.classList.toggle('clinic-workspace-signed-in', Boolean(session));
    if (!session && alertAudio?.state==='running') void alertAudio.suspend().catch(()=>{});
    if (!session) {
      const sound = byId('clinic-alert-sound');
      sound.setAttribute('aria-pressed','false');
      sound.textContent = 'Enable alert sound';
    }
    byId('clinic-settings-identity').textContent = session ? 'Signed in as ' + (session.user?.email || 'clinic member') : '';
    clearWorkspaceAlerts();
    if (!session) {
      ++state.generation;
      workspaceLoadFailed = false;
      rejectedAccessToken = undefined;
      state.accounts = [];
      state.locations = [];
      show('clinic-dashboard', false);
      inboxSignature = undefined;
      publishedWebsite = false;
      guide.hidden = true;
      hideChannelSetup();
      guideLocation = null;
      setupTest = null;
      show('clinic-team-invite', false);
      status(pendingInvite ? 'Sign in with the work email that received the invitation.' : 'Sign in to create or open your workspace.');
      return;
    }
    status('Opening your clinic…');
    byId('clinic-identity').textContent = 'Signed in as ' + (session.user?.email || 'clinic member');
    try {
      if (messengerReturn) await finishMessenger();
      else {
        const invitation = await acceptWorkspaceInvite();
        if (state.session?.user?.id !== session.user?.id) return;
        const selection = invitation || initialSelection;
        await refreshAccounts(invitation?.accountId || testReturn?.accountId || selection?.accountId,
          invitation?.locationId || testReturn?.locationId || selection?.locationId);
        if (state.session?.user?.id !== session.user?.id) return;
        const staffDefault = state.locations.length > 0 && !canManageClinic && !query.has('view') &&
          !selection?.channel && !testReturn;
        if (invitation || staffDefault) openDailyWork();
        else if (['overview','profile','settings'].includes(requestedView) && !selection?.channel && !testReturn) {
          switchWorkspaceView(requestedView,!canManageClinic);
        } else focusSetupChannel(selection);
        if (state.locations.length) initialSelection = null;
        if (!invitation && testReturn && setupTest?.testId === testReturn.testId && !guide.hidden) {
          switchWorkspaceView('setup');
          channelSteps.find(step=>step.channel==='facebook_messenger').panel.open = true;
          byId('clinic-messenger-test-help').focus();
          await checkSetupReply();
        }
      }
    } catch (error) {
      if (state.session?.user?.id !== session.user?.id) return;
      if (error.inviteRejected) {
        if (!state.accounts.length) await refreshAccounts().catch(() => {});
        showInviteAccountError(session.user?.email);
      } else if (!workspaceLoadFailed) status(error.message, 'error');
    }
  }

  function showInviteAccountError(email) {
    const account = email || 'your current Workspace account';
    status('This invitation couldn’t be accepted while you’re signed in as ' + account +
      '. Switch accounts and sign in with the address the clinic owner entered. If that address still gets this message, request a fresh invitation.', 'error');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'clinic-invite-switch';
    button.textContent = 'Switch account';
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        const { error } = await state.client.auth.signOut({ scope: 'local' });
        if (error) throw error;
        clearOwnerSetup();
        emailInput.value = '';
        codeForm.reset();
        await authenticated(null);
        emailInput.focus();
      } catch (error) {
        status(error.message || 'Could not switch accounts. Please try signing out.', 'error');
      } finally {
        button.disabled = false;
      }
    });
    byId('clinic-status').append(button);
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
    } catch (error) {
      status(error.code === 'over_email_send_rate_limit' || /email rate limit/i.test(error.message)
        ? 'The sign-in email limit has been reached. Use an unused sign-in link or try again later.'
        : error.message, 'error');
    }
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
      focusSetupChannel(initialSelection);
      initialSelection = null;
      status('Your workspace was created. Channel requests need verification before going live.', 'success');
    } catch (error) { status(error.message, 'error'); }
    finally { button.disabled = false; }
  });
  byId('clinic-signout').addEventListener('click', async () => {
    closeManualBooking();
    addBookingResult.hidden = true;
    try { await state.client.auth.signOut(); clearOwnerSetup(); await authenticated(null); }
    catch (error) { status(error.message, 'error'); }
  });
  byId('clinic-account').addEventListener('change', () => {
    workspaceViews.ownerSupport.replaceChildren();
    delete workspaceViews.ownerSupport.dataset.location;
    clearWorkspaceAlerts();
    clearOwnerOverview();
    clearRevenueView();
    closeManualBooking();
    addBookingResult.hidden = true;
    daily.hidden = true;
    updateHeroAction();
    commentPilotPanel.hidden = true;
    refreshLocations().catch(() => {});
  });
  byId('clinic-location').addEventListener('change', () => {
    workspaceViews.ownerSupport.replaceChildren();
    delete workspaceViews.ownerSupport.dataset.location;
    clearWorkspaceAlerts();
    clearRevenueView();
    closeManualBooking();
    addBookingResult.hidden = true;
    daily.hidden = true;
    updateHeroAction();
    guide.hidden = true;
    hideChannelSetup();
    show('clinic-invite-link', false);
    byId('clinic-invite-url').value = '';
    byId('clinic-invite-status').textContent = '';
    loadAlertEmail();
    refreshActivity().catch(() => {});
  });
  function recoverWorkspace(force = false) {
    if (reconnecting || initializing) return reconnecting || initializing;
    if (!state.session) return workspaceLoadFailed ? initializeWorkspace() : undefined;
    const user = state.session.user?.id;
    const generation = state.generation;
    const current = () => state.session?.user?.id === user && state.generation === generation;
    const refreshButton = byId('clinic-refresh');
    refreshButton.disabled = true;
    reconnecting = (async () => {
      try {
        const auth = state.client.auth;
        let {data, error} = await timedRead(auth.getSession());
        if (!current()) return;
        if (error) throw error;
        if (data.session?.user?.id === user && data.session.access_token === rejectedAccessToken) {
          ({data, error} = await timedRead(auth.refreshSession()));
          if (!current()) return;
          if (error) throw error;
        }
        const session = data.session;
        if (!session || session.user?.id !== user) {
          await authenticated(session);
          return;
        }
        state.session = session;
        rejectedAccessToken = undefined;
        if (initialSelection && workspaceLoadFailed) await authenticated(session);
        else if (force || workspaceLoadFailed) await refreshAccounts().catch(() => {});
        else if (workspaceView === 'overview') loadOwnerRevenue();
        else void pollInbox();
      } catch (error) {
        if (current()) showWorkspaceLoadError(error);
      } finally {
        refreshButton.disabled = false;
        reconnecting = undefined;
      }
    })();
    return reconnecting;
  }

  byId('clinic-refresh').addEventListener('click', () => recoverWorkspace(true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    const wasIdle = hiddenAt !== null && Date.now() - hiddenAt >= 60000;
    hiddenAt = null;
    if (wasIdle || workspaceLoadFailed) void recoverWorkspace();
  });
  window.addEventListener('online', () => {
    if (!document.hidden && workspaceLoadFailed) void recoverWorkspace();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) void recoverWorkspace();
  });

  function initializeWorkspace() {
    if (!initializing) initializing = loadInitialSession().finally(() => { initializing = undefined; });
    return initializing;
  }

  async function loadInitialSession() {
    try {
      const earlyConfig = window.edenClinicConfigRequest;
      delete window.edenClinicConfigRequest;
      const response = await timedRead(earlyConfig ?? fetch(API + '/clinic/public-config', {
        cache: 'no-store'
      }));
      if (!response?.ok) throw Error('Workspace configuration is unavailable.');
      const config = await response.json();
      if (!config.supabaseUrl || !config.publishableKey) throw Error('Clinic sign-in is not activated yet. Please check back soon.');
      if (!window.supabase?.createClient) throw Error('Sign-in could not load. Please refresh the page.');
      staffEmailAvailable = config.staffEmailAvailable === true;
      messengerSetupAvailable = config.messengerSetupAvailable === true;
      commentPilotPublishAvailable = config.commentPilotPublishAvailable === true;
      legacyMessengerConnect = config.messengerConnect;
      state.client ||= window.supabase.createClient(config.supabaseUrl, config.publishableKey);
      status('Checking your sign-in…');
      const { data, error } = await timedRead(state.client.auth.getSession());
      if (error) throw error;
      state.client.auth.onAuthStateChange((_event, session) => {
        setTimeout(() => {
          if (session?.access_token === state.session?.access_token) return;
          if (session && state.session && session.user?.id === state.session.user?.id) {
            state.session = session;
            if (workspaceLoadFailed && !document.hidden) void recoverWorkspace();
          } else void authenticated(session);
        }, 0);
      });
      await authenticated(data.session);
    } catch (error) { showWorkspaceLoadError(error, () => initializeWorkspace()); }
  }

  void initializeWorkspace();
})();
