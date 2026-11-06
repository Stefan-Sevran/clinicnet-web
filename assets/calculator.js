(() => {
  const app = document.getElementById('calcApp');
  if (!app) return;

  const state = { inquiries:null, replyRisk:null, calls:null, callRisk:null, bookingRisk:null, value:2500, currency:'PHP', recovery:.25 };
  const symbols = { PHP:'₱', THB:'฿', USD:'$' };
  let resultModel = null;

  const track = (name, props={}) => {
    try { if (window.zaraz && typeof window.zaraz.track === 'function') window.zaraz.track(name, props); } catch (_) {}
  };
  const show = n => {
    app.querySelectorAll('.calc-stage').forEach(x => x.classList.toggle('active', Number(x.dataset.stage) === n));
    const top = app.getBoundingClientRect().top + window.scrollY - 110;
    window.scrollTo({top:Math.max(0,top), behavior:'smooth'});
  };
  const money = n => `${symbols[state.currency]}${Math.max(0,Math.round(n)).toLocaleString()}`;
  const roundNice = n => {
    const step = state.currency === 'USD' ? 50 : state.currency === 'THB' ? 1000 : 1000;
    return Math.max(step, Math.round(n / step) * step);
  };

  document.getElementById('calcStart')?.addEventListener('click', () => { track('calculator_started'); show(1); });

  app.querySelectorAll('.options').forEach(group => {
    group.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
      group.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state[group.dataset.key] = Number(btn.dataset.value);
    }));
  });

  app.querySelectorAll('.calc-next[data-next]').forEach(btn => btn.addEventListener('click', () => {
    const stage = Number(btn.closest('.calc-stage').dataset.stage);
    const required = stage === 1 ? ['inquiries','replyRisk'] : stage === 2 ? ['calls','callRisk'] : [];
    if (required.some(k => state[k] == null)) { alert('Choose an option first.'); return; }
    if (stage === 3) {
      const raw = Number(document.getElementById('patientValue')?.value || 0);
      if (!raw || raw <= 0) { alert('Enter an average patient value.'); return; }
      state.value = raw;
      state.currency = document.getElementById('currencySelect')?.value || 'PHP';
    }
    show(Number(btn.dataset.next));
  }));

  document.getElementById('currencySelect')?.addEventListener('change', e => { state.currency = e.target.value; });
  document.querySelectorAll('[data-value-preset]').forEach(btn => btn.addEventListener('click', () => {
    const input = document.getElementById('patientValue');
    if (input) input.value = btn.dataset.valuePreset;
  }));

  function calculate() {
    const days = 30;
    const inquiryOpps = state.inquiries * state.replyRisk * days;
    const callOpps = state.calls * state.callRisk * days;
    const bookingOpps = state.inquiries * state.bookingRisk * days;

    // Avoid pretending every friction event equals a lost booking. Convert to an intentionally conservative opportunity-risk estimate.
    const replyWeighted = inquiryOpps * 0.34;
    const callWeighted = callOpps * 0.52;
    const bookingWeighted = bookingOpps * 0.28;
    const total = Math.max(1, replyWeighted + callWeighted + bookingWeighted);

    const patientLow = Math.max(1, Math.round(total * 0.72));
    const patientHigh = Math.max(patientLow + 1, Math.round(total * 1.18));
    const low = roundNice(patientLow * state.value * 0.72);
    const high = roundNice(patientHigh * state.value * 1.08);

    const parts = [
      {key:'reply', label:'Reply delay', value:replyWeighted},
      {key:'call', label:'Missed-call recovery', value:callWeighted},
      {key:'booking', label:'Booking friction', value:bookingWeighted}
    ];
    const sum = parts.reduce((a,b)=>a+b.value,0) || 1;
    parts.forEach(p => p.pct = Math.round((p.value / sum) * 100));
    // force displayed percentages to total 100
    const diff = 100 - parts.reduce((a,b)=>a+b.pct,0);
    parts[0].pct += diff;
    const top = [...parts].sort((a,b)=>b.value-a.value)[0];
    return {low,high,patientLow,patientHigh,parts,top};
  }

  function renderRecovery() {
    if (!resultModel) return;
    const low = roundNice(resultModel.low * state.recovery);
    const high = roundNice(resultModel.high * state.recovery);
    document.getElementById('recoveredRevenue').textContent = `${money(low)} – ${money(high)}`;
    document.getElementById('annualRecovery').textContent = `Annualized: ${money(low*12)} – ${money(high*12)}`;
  }

  document.getElementById('showResult')?.addEventListener('click', () => {
    if (state.bookingRisk == null) { alert('Choose a booking-path option first.'); return; }
    state.value = Number(document.getElementById('patientValue')?.value || state.value);
    state.currency = document.getElementById('currencySelect')?.value || state.currency;
    resultModel = calculate();

    document.getElementById('lossRange').textContent = `${money(resultModel.low)} – ${money(resultModel.high)}`;
    document.getElementById('patientRange').textContent = `${resultModel.patientLow}–${resultModel.patientHigh}`;
    document.getElementById('topSource').textContent = resultModel.top.label;
    document.getElementById('topSourceNote').textContent = 'Worth checking first';
    const score = (state.replyRisk + state.callRisk + state.bookingRisk) / 3;
    document.getElementById('riskLabel').textContent = score < .14 ? 'some' : score < .28 ? 'meaningful' : 'significant';

    const map = Object.fromEntries(resultModel.parts.map(p=>[p.key,p]));
    ['reply','call','booking'].forEach(k => {
      document.getElementById(`${k}Pct`).textContent = `${map[k].pct}%`;
      document.getElementById(`${k}Bar`).style.width = `${map[k].pct}%`;
    });
    renderRecovery();
    try { localStorage.setItem('edenCalculatorV2', JSON.stringify({...state,...resultModel,ts:Date.now()})); } catch (_) {}
    track('calculator_completed', {currency:state.currency, top_source:resultModel.top.key});
    show(5);
  });

  document.querySelectorAll('[data-recovery]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-recovery]').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    state.recovery = Number(btn.dataset.recovery);
    renderRecovery();
    track('calculator_recovery_scenario', {recovery_percent:Math.round(state.recovery*100)});
  }));

  document.getElementById('copySummary')?.addEventListener('click', async () => {
    if (!resultModel) return;
    const text = `Eden Clinic Revenue Recovery Calculator\nPotential monthly revenue at risk: ${money(resultModel.low)} – ${money(resultModel.high)}\nPatient opportunities at risk: ${resultModel.patientLow}–${resultModel.patientHigh}/month\nLargest modeled source: ${resultModel.top.label}\nIllustrative estimate only — not a guarantee.`;
    try {
      await navigator.clipboard.writeText(text);
      const btn = document.getElementById('copySummary');
      const old = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(()=>btn.textContent=old,1500);
      track('calculator_summary_copied');
    } catch (_) { alert(text); }
  });

  document.getElementById('calcReset')?.addEventListener('click', () => {
    Object.assign(state,{inquiries:null,replyRisk:null,calls:null,callRisk:null,bookingRisk:null,value:2500,currency:'PHP',recovery:.25});
    resultModel = null;
    app.querySelectorAll('.selected').forEach(x=>x.classList.remove('selected'));
    document.querySelector('[data-recovery="0.25"]')?.classList.add('selected');
    const input = document.getElementById('patientValue'); if(input) input.value='2500';
    const cur = document.getElementById('currencySelect'); if(cur) cur.value='PHP';
    show(0);
  });
})();
