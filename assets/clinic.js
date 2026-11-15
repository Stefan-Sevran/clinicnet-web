(() => {
  'use strict';
  const API = 'https://eden-webhook-ixdd.onrender.com';
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
  let workspaceView = query.get('view') === 'daily' ? 'daily' : 'setup';
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
  const daily = byId('clinic-daily');
  const inboxFilters = [...daily.querySelectorAll('[data-filter]')];
  let dailyEvents = [];
  let inboxFilter = 'all';
  for (const button of inboxFilters) {
    button.addEventListener('click', () => {
      inboxFilter = button.dataset.filter;
      renderDailyInbox();
    });
  }
  let canManageClinic = false;
  let clinicTeam = new Map();
  let clinicTeamAvailable = true;
  let isClinicOwner = false;
  let acceptingInvite;
  let staffEmailAvailable = false;
  let soundContext;
  let soundTimer;
  let backgroundRefresh = false;
  let loadedGeneration = -1;
  let inboxSnapshot;

  const labels = { website_chat: 'Website chat', facebook_messenger: 'Facebook Messenger', ai_phone: 'AI phone' };
  const channelNav = byId('clinic-channel-setup');
  workspaceHero.after(channelNav);
  const channelSteps = createChannelSteps();
  const workspaceViews = createWorkspaceViews();
  switchWorkspaceView(workspaceView);
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
    updateHeroAction();
    if (!accounts.length) return status('You are signed in. Create your first workspace.');
    selectOptions(byId('clinic-account'), accounts, preferred || byId('clinic-account').value, 'name');
    await refreshLocations(preferredLocation);
  }

  async function refreshLocations(preferredLocation) {
    const generation = ++state.generation;
    const accountId = byId('clinic-account').value;
    if (!accountId) return;
    guide.hidden = true;
    hideChannelSetup();
    if (alertEmailForm) alertEmailForm.hidden = true;
    const [locations, membership, setups] = await Promise.all([
      request('/clinic/locations?accountId=' + encodeURIComponent(accountId)),
      state.client.from('clinic_memberships').select('role')
        .eq('account_id', accountId).eq('user_id', state.session.user.id).maybeSingle(),
      messengerSetupAvailable ? request('/clinic/messenger/setups?accountId=' + encodeURIComponent(accountId))
        .catch(() => []) : []
    ]);
    if (generation !== state.generation) return;
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
    await refreshActivity();
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
    show('clinic-messenger-edit-facts', factsReady && factsForm.hidden);
    byId('clinic-messenger-facts-help').textContent = importedLocation ?
      'These details come from your website receptionist setup. Review or edit them before saving for Messenger.' :
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

  byId('clinic-messenger-edit-facts').addEventListener('click', () => {
    factsForm.hidden = false;
    renderMessengerGuide();
    factsForm.querySelector('textarea').focus();
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
    const steps = Object.entries(labels).map(([channel, name], index) => {
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
      copy.append(title, badge);
      link.append(marker, copy);
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
      return { channel, index, panel, heading, body, link, marker, badge, feedback };
    });
    return steps;
  }

  function createWorkspaceViews() {
    const dashboard = byId('clinic-dashboard');
    const setup = document.createElement('div');
    setup.id = 'clinic-setup-view';
    const work = document.createElement('div');
    work.id = 'clinic-daily-view';
    dashboard.append(setup,work);
    setup.append(...channelSteps.map(step=>step.panel),byId('clinic-team-invite'));
    work.append(daily);

    const views = document.createElement('nav');
    views.className = 'clinic-view-switch';
    views.setAttribute('aria-label','Clinic Workspace');
    const links = {};
    for (const [key,label] of [['setup','Channel setup'],['daily','Daily work']]) {
      const link = document.createElement('a');
      link.href = '/clinic/?view=' + key;
      link.textContent = label;
      link.addEventListener('click',event=>{
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        switchWorkspaceView(key,true);
      });
      links[key] = link;
      views.append(link);
    }
    dashboard.querySelector('.clinic-selectors').after(views);
    return {setup,work,links};
  }

  function switchWorkspaceView(view, updateUrl = false) {
    const setup = view === 'setup';
    workspaceView = setup?'setup':'daily';
    workspaceViews.setup.hidden = !setup;
    workspaceViews.work.hidden = setup;
    channelNav.hidden = !setup || channelSteps.every(({ panel }) => panel.hidden);
    updateHeroAction();
    for (const [key, link] of Object.entries(workspaceViews.links)) {
      if (key===workspaceView) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    }
    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.set('view',workspaceView);
      url.searchParams.delete('setup');
      if (url.hash.startsWith('#clinic-')) url.hash='';
      history.replaceState(null,'',url);
    }
  }

  function updateHeroAction() {
    const needsWorkspace = !byId('clinic-create').hidden;
    const channelsReady = !daily.hidden;
    const allConnected = channelsReady && channelSteps.every(step => step.link.dataset.connected === 'true');
    heroAction.hidden = !state.session || (!needsWorkspace && (!channelsReady || (allConnected && workspaceView === 'daily')));
    if (heroAction.hidden) return;
    heroAction.setAttribute('href', needsWorkspace ? '#clinic-create' : '/clinic/?view=' + (allConnected ? 'daily' : 'setup'));
    heroAction.textContent = needsWorkspace ? 'Create your workspace' : allConnected ? 'Open Daily work' : 'Channel setup';
  }

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

  function channelStatus(channel, connection) {
    if (!connection) return 'Not set up';
    if (connection.status==='requested') return {
      website_chat:'Connection pending',facebook_messenger:'Access pending',ai_phone:'Number pending'
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
          'Select Check test call. The completed call should appear in Daily work once it is verified.'
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

  function renderChannels() {
    for (const { channel, index, panel, heading, body, link, marker, badge } of channelSteps) {
      const connection = state.connections.find(item=>item.channel===channel);
      const messengerSetup = channel==='facebook_messenger' && messengerSetups.find(setup=>
        setup.accountId===byId('clinic-account').value && setup.locationId===byId('clinic-location').value);
      const guided = messengerSetup && Object.hasOwn(messengerSetup,'facts');
      const connected = connection?.status==='connected';
      const needsFacts = guided && ['connected','verifying'].includes(connection?.status) &&
        !hasMessengerFacts(messengerSetup.facts);
      badge.textContent = needsFacts ? 'Facts needed' : channelStatus(channel,connection);
      link.dataset.connected = String(connected && !needsFacts);
      marker.textContent = connected && !needsFacts?'✓':String(index+1);
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
        if (connection?.status==='requested') {
          const note = document.createElement('small');
          note.className = 'clinic-connection-pending';
          note.textContent = 'Pending.';
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
    const line = document.createElement('small');
    line.append(link);
    return line;
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
    container.replaceChildren();
    for (const event of events) {
      const row = document.createElement('article'); row.className = 'clinic-event';
      if (event.event_key) {
        row.dataset.eventKey = event.event_key;
        row.tabIndex = -1;
      }
      const title = document.createElement('strong'); title.textContent = event.summary || event.kind || 'Activity';
      const needsFollowup = followupKinds.includes(event.kind) && event.event_key;
      const setupSample = isMessengerSetupSample(event);
      if (setupSample) title.textContent = 'Latest Messenger setup test';
      const latest = state.followups.get(event.event_key);
      const cancelled = latest?.recorded_action === 'cancelled';
      const ownClaim = latest?.action === 'claimed' && latest.actor_user_id === state.session?.user?.id;
      const assigneeName = clinicTeam.get(latest?.actor_user_id);
      const statusLabel = setupSample ? 'Setup test' : cancelled ? 'Cancelled' : needsFollowup ? ({
        booked: 'Confirmed',
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
        if (statusLabel === 'Confirmed') badge.dataset.status = 'confirmed';
        if (statusLabel === 'Cancelled') badge.dataset.status = 'cancelled';
        badge.textContent = statusLabel;
        heading.append(badge);
      }
      const meta = document.createElement('small');
      meta.textContent = [labels[event.channel] || event.channel,
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
        const topics = Array.isArray(event.details?.topics)
          ? event.details.topics.filter(topic => typeof topic === 'string' && topic.trim()).slice(0, 3) : [];
        if (event.details?.service && (event.kind !== 'inquiry.followup_needed' || !topics.length)) {
          const service = document.createElement('small');
          service.textContent = 'Service · ' + event.details.service;
          row.append(service);
        }
        const serviceLabel = typeof event.details?.service === 'string' ? event.details.service.toLowerCase() : '';
        const additionalTopics = event.kind === 'inquiry.followup_needed' ? topics :
          topics.filter(topic => topic.toLowerCase() !== serviceLabel);
        if (additionalTopics.length) {
          const line = document.createElement('small');
          line.textContent = 'Topics · ' + additionalTopics.join(', ');
          row.append(line);
        }
        if (event.details?.requestedTime) {
          const timing = document.createElement('small');
          timing.textContent = 'Requested time · ' + event.details.requestedTime;
          row.append(timing);
        }
        if (event.details?.demo !== true) appendPatientDetails(row, event.details);
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
        row.append(alert);
        const messengerLink = event.channel === 'facebook_messenger' && messengerInboxLink(event.details);
        if (messengerLink) row.append(messengerLink);
        if (latest?.appointment_at) {
          const appointment = document.createElement('small');
          const timeZone = clinicTimeZone(event.location_id);
          appointment.textContent = 'Appointment · ' + new Date(latest.appointment_at).toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            timeZone, timeZoneName: 'short'
          });
          row.append(appointment);
        }
        const actions = cancelled ? [['restored', 'Restore booking']] :
          latest?.action === 'booked' ? [['rescheduled', 'Change time'], ['cancelled', 'Cancel booking']] :
          latest?.action === 'claimed' ? (ownClaim ? [
            ['booked', 'Confirm booking'], ['reopened', 'Release assignment'], ['handled', 'Mark handled']
          ] : []) :
          latest?.action === 'handled' ? [['reopened', 'Reopen']] :
          [['claimed', 'Assign to me'], ['handled', 'Mark handled']];
        if ((!latest || latest.action === 'reopened') && event.kind === 'booking.requested') {
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
            row.append(note);
          }
        }
        if (actions.length) {
          const controls = document.createElement('div');
          for (const [action, label] of actions) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'clinic-followup-button';
            if (action !== 'booked') button.classList.add('clinic-secondary');
            button.textContent = label;
            button.addEventListener('click', () => {
              if (['booked', 'rescheduled', 'cancelled', 'restored'].includes(action)) {
                showAppointmentEditor(event, controls, button, action, latest);
              } else if (action === 'assign') showAssignmentEditor(event, latest, controls, button);
              else if (action === 'invite') openTeammateInvite();
              else updateFollowup(event, action, controls);
            });
            controls.append(button);
          }
          row.append(controls);
        }
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

  function renderDailyInbox() {
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
    const views = {
      all: [activity, 'No activity yet for this location.'],
      attention: [attention, 'No unclaimed inquiries need follow-up.'],
      assigned: [assigned, 'No inquiries are assigned to you.'],
      booked: [booked, 'No confirmed bookings in recent activity.'],
      tests: [latestTest ? [latestTest] : [], 'No setup tests yet.']
    };
    for (const button of inboxFilters) {
      button.setAttribute('aria-pressed', String(button.dataset.filter === inboxFilter));
      if (button.dataset.filter === 'attention') button.textContent = 'Needs attention (' + attention.length + ')';
    }
    renderInboxEvents(...views[inboxFilter]);
  }

  function openBookedActivity(eventKey) {
    const locate = () => [...byId('clinic-inbox').children].find(row => row.dataset.eventKey === eventKey);
    let card = locate();
    if (!card) {
      inboxFilter = 'booked';
      renderDailyInbox();
      card = locate();
    }
    if (card) {
      card.focus({ preventScroll: true });
      card.scrollIntoView({ block: 'nearest' });
    }
  }

  function renderDailyWork(inbox, bookings, locationId) {
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
        time.textContent = [timeLabel.format(date), name && service, labels[event.channel] || event.channel]
          .filter(Boolean).join(' · ');
        row.append(title, time);
        row.addEventListener('click', () => openBookedActivity(event.event_key));
        list.append(row);
      }
    } else {
      empty(list, 'No confirmed appointments today in recent activity.');
    }
    daily.hidden = false;
    updateHeroAction();
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
      input.value = clinicDateTimeValue(previousTime, timeZone);
      label.append(input);
      form.append(label);
      help.textContent = 'Enter the agreed time in ' + (locationName ? locationName + ' time' : 'the clinic’s time zone') +
        ' (' + timeZone + ').';
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
    save.textContent = {
      booked: 'Save confirmation', rescheduled: 'Save new time',
      cancelled: 'Yes, cancel booking', restored: 'Confirm restoration'
    }[action];
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'clinic-secondary';
    back.textContent = cancelling ? 'Keep booking' : 'Close';
    group.append(save, back);
    form.append(help, errorLine, group);

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
      const generation = state.generation;
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
          errorLine.textContent = error.code === '22023' ? error.message : 'Could not save the booking. Try again.';
          errorLine.hidden = false;
          return;
        }
        await refreshActivity();
        status({
          booked: 'Booking confirmed.', rescheduled: 'Appointment time updated.',
          cancelled: 'Booking cancelled.', restored: 'Booking restored.'
        }[action], 'success');
        inboxFilters.find(button => button.dataset.filter === inboxFilter)?.focus();
      } catch {
        errorLine.textContent = 'Could not refresh booking activity. Refresh the workspace before trying again.';
        errorLine.hidden = false;
      } finally {
        save.disabled = back.disabled = false;
        if (input) input.disabled = false;
      }
    });
    controls.append(form);
    (input || back).focus();
  }

  function openTeammateInvite() {
    switchWorkspaceView('setup', true);
    const invite = byId('clinic-team-invite');
    const details = invite.querySelector('details');
    details.open = true;
    details.querySelector('input').focus({ preventScroll: true });
    invite.scrollIntoView({ block: 'nearest' });
  }

  function assignmentOptions(latest) {
    const currentAssignee = latest?.action === 'claimed' ? latest.actor_user_id : state.session?.user?.id;
    return [...clinicTeam].filter(([id]) => id !== currentAssignee);
  }

  function showAssignmentEditor(event, latest, controls, opener) {
    const form = document.createElement('form');
    form.className = 'clinic-appointment-editor clinic-assignment-editor';
    const label = document.createElement('label');
    label.textContent = 'Assign this inquiry to';
    const select = document.createElement('select');
    select.required = true;
    select.add(new Option('Choose a teammate', ''));
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
      if (save.disabled || !options.some(([id]) => id === assignee)) return;
      select.disabled = save.disabled = back.disabled = true;
      errorLine.hidden = true;
      const generation = state.generation;
      try {
        const { error } = await state.client.from('clinic_followup_actions').insert({
          account_id: event.account_id, location_id: event.location_id, event_key: event.event_key,
          actor_user_id: state.session.user.id, action: 'claimed',
          assigned_user_id: assignee, prior_action_at: latest?.created_at || null
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
          status('Inquiry assigned.', 'success');
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

  async function refreshActivity(quiet = false) {
    if (!quiet) commentPilotPanel.hidden = true;
    const generation = quiet ? state.generation : ++state.generation;
    const accountId = byId('clinic-account').value;
    const locationId = byId('clinic-location').value;
    if (!accountId || !locationId) return;
    const query = '?accountId=' + encodeURIComponent(accountId) + '&locationId=' + encodeURIComponent(locationId);
    const [connections, bookings, inbox, followups, team] = await Promise.all([
      request('/clinic/connections' + query), request('/clinic/bookings' + query),
      request('/clinic/inbox' + query + '&limit=100'), getFollowups(accountId, locationId),
      state.client.rpc('list_clinic_team', { p_account_id: accountId }).then(({ data, error }) => error ? null : data || [], () => null)
    ]);
    if (generation !== state.generation || (quiet && document.querySelector('.clinic-appointment-editor'))) return;
    state.connections = connections;
    state.followups = new Map(followups.map(row => [row.event_key, row]));
    clinicTeamAvailable = team !== null;
    clinicTeam = new Map((team || []).map(row => [row.user_id, row.display_name]));
    pearlPilotLink.hidden = locationId !== 'b865c71a-e9f1-4b09-acb5-0b5043ab4307';
    renderChannels();
    renderCommentPilot(inbox);
    renderDailyWork(inbox, bookings, locationId);
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
    return new Set(inbox.filter(event => followupKinds.includes(event.kind) && !isMessengerSetupSample(event))
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

  async function openWebsiteSetup(button) {
    const userId = state.session?.user?.id;
    const accountId = byId('clinic-account').value;
    const locationId = byId('clinic-location').value;
    const current = () => state.session?.user?.id === userId &&
      byId('clinic-account').value === accountId && byId('clinic-location').value === locationId;
    if (!userId || !canManageClinic || !accountId || !locationId) {
      channelFeedback('website_chat','Sign in as an owner or admin and choose a clinic location.','error');
      return;
    }
    button.disabled = true;
    channelFeedback('website_chat','Opening the private setup for this location…');
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
      if (!response.ok) throw Error(data?.error || 'The setup service did not respond. Try again.');
      const destination = new URL(data?.url || '',setupOrigin);
      if (destination.origin!==setupOrigin || destination.pathname!=='/assistant-setup/' ||
          destination.username || destination.password || destination.search!=='?workspace=1' ||
          !/^#workspace=[a-f0-9]{48}$/.test(destination.hash)) {
        throw Error('The private setup link could not be verified. Try again.');
      }
      if (current()) {
        channelFeedback('website_chat','Taking you to your receptionist setup…');
        window.location.assign(destination.href);
      }
    } catch (error) {
      if (current()) channelFeedback('website_chat',
        error.name==='TimeoutError'?'Setup took too long to open. Select Set up AI receptionist to retry.':
          error instanceof TypeError?'Could not reach private setup. Select Set up AI receptionist to retry.':error.message,'error');
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
        if (error) throw Error(error.message || 'Could not open the clinic invitation.');
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
        p_role: fields.get('role'), p_channel: fields.get('channel')
      });
      if (error) throw Error(error.message || 'Could not create the invitation.');
      if (!/^[a-f0-9]{64}$/.test(data || '')) throw Error('The invitation could not be verified.');
      if (current()) {
        byId('clinic-invite-url').value = location.origin + '/clinic/#clinic-invite=' + data;
        show('clinic-invite-link', true);
        note.textContent = 'Copy the link and send it to this teammate.';
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
    daily.hidden = true;
    show('clinic-create', false);
    renderWorkspaceHero(Boolean(session));
    if (session) codeForm.reset();
    show('clinic-signin', !session);
    show('clinic-authenticated', Boolean(session));
    if (!session) {
      ++state.generation;
      inboxSnapshot = undefined;
      guide.hidden = true;
      hideChannelSetup();
      guideLocation = null;
      setupTest = null;
      stopInboxSound();
      show('clinic-team-invite', false);
      status(pendingInvite ? 'Sign in with the work email that received the invitation.' : 'Sign in to create or open your workspace.');
      return;
    }
    byId('clinic-identity').textContent = 'Signed in as ' + (session.user?.email || 'clinic member');
    try {
      if (messengerReturn) await finishMessenger();
      else {
        const invitation = await acceptWorkspaceInvite();
        if (state.session?.user?.id !== session.user?.id) return;
        const selection = invitation || initialSelection;
        await refreshAccounts(testReturn?.accountId || selection?.accountId, testReturn?.locationId || selection?.locationId);
        focusSetupChannel(selection);
        if (state.locations.length) initialSelection = null;
        if (testReturn && setupTest?.testId === testReturn.testId && !guide.hidden) {
          switchWorkspaceView('setup');
          channelSteps.find(step=>step.channel==='facebook_messenger').panel.open = true;
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
      focusSetupChannel(initialSelection);
      initialSelection = null;
      status('Your workspace was created. Channel requests need verification before going live.', 'success');
    } catch (error) { status(error.message, 'error'); }
    finally { button.disabled = false; }
  });
  byId('clinic-signout').addEventListener('click', async () => {
    try { await state.client.auth.signOut(); clearOwnerSetup(); await authenticated(null); }
    catch (error) { status(error.message, 'error'); }
  });
  byId('clinic-account').addEventListener('change', () => {
    daily.hidden = true;
    updateHeroAction();
    commentPilotPanel.hidden = true;
    refreshLocations().catch(error => status(error.message, 'error'));
  });
  byId('clinic-location').addEventListener('change', () => {
    daily.hidden = true;
    updateHeroAction();
    guide.hidden = true;
    hideChannelSetup();
    show('clinic-invite-link', false);
    byId('clinic-invite-url').value = '';
    byId('clinic-invite-status').textContent = '';
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
