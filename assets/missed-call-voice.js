// The public demo agent must be separate from the clinic's booking agent.
// Its ElevenLabs Security settings enforce a daily call cap and its Advanced
// settings enforce a 120-second maximum. This page adds a courtesy browser cap.
(() => {
  const panel = document.getElementById('eden-voice-panel');
  if (!panel) return;
  const button = panel.querySelector('button');
  const label = panel.querySelector('.eden-voice-panel__label');
  const status = panel.querySelector('[role="status"]');
  const agentId = panel.dataset.agentId;
  const key = 'eden-voice-demo-' + new Date().toLocaleDateString('en-CA');
  const maxStarts = 3;
  let conversation = null;
  let connecting = false;
  let timer = null;

  function setStatus(message) { status.textContent = message; }
  function count() {
    try { return Math.max(0, Number(localStorage.getItem(key)) || 0); }
    catch { return 0; }
  }
  function recordStart() {
    try { localStorage.setItem(key, String(count() + 1)); }
    catch { /* ElevenLabs still enforces the agent's daily call cap. */ }
  }
  function reset(message) {
    clearTimeout(timer);
    conversation = null;
    connecting = false;
    button.disabled = false;
    button.dataset.live = 'false';
    label.textContent = 'Talk';
    if (message) setStatus(message);
  }
  async function end(message = 'Conversation ended. Thanks for trying it.') {
    const active = conversation;
    reset(message);
    if (active) {
      try { await active.endSession(); }
      catch { /* The remote session may already have ended. */ }
    }
  }

  button.addEventListener('click', async () => {
    if (conversation) { await end(); return; }
    if (connecting) return;
    if (!agentId || agentId === 'REPLACE_WITH_DEMO_AGENT_ID') {
      setStatus('The voice preview is being prepared. Please check back soon.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setStatus('The live demo needs a secure browser with microphone access.');
      return;
    }
    if (count() >= maxStarts) {
      setStatus('Thanks for exploring. You can try another conversation tomorrow.');
      return;
    }
    connecting = true;
    button.disabled = true;
    setStatus('Allow microphone access to start talking.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setStatus('Connecting your voice preview…');
      const { Conversation } = await import('https://esm.sh/@elevenlabs/client?bundle');
      let active;
      active = await Conversation.startSession({
        agentId,
        connectionType: 'webrtc',
        onDisconnect: () => {
          if (conversation === active) reset('Conversation ended. Thanks for trying it.');
        },
        onError: () => setStatus('The connection had a problem. Please try again.'),
        onModeChange: mode => {
          if (conversation !== active) return;
          setStatus(mode.mode === 'speaking' ? 'Receptionist speaking…' : 'Listening…');
        },
      });
      conversation = active;
      recordStart();
      connecting = false;
      button.disabled = false;
      button.dataset.live = 'true';
      label.textContent = 'End talk';
      setStatus('Connected. Go ahead and speak.');
      timer = setTimeout(() => end('That was your two-minute preview. Thanks for talking with us.'), 120000);
    } catch (error) {
      reset(error?.name === 'NotAllowedError'
        ? 'Microphone access was declined. Allow it in your browser to try the demo.'
        : 'The voice preview could not connect. Please try again shortly.');
    }
  });
  window.addEventListener('pagehide', () => { if (conversation) conversation.endSession().catch(() => {}); });
})();
