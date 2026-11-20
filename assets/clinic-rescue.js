/* Clinic Workspace visit recording and private owner reports. */
const ClinicRescue = (() => {
  const el = (tag, text) => Object.assign(document.createElement(tag), {textContent: text ?? ''});
  const currencies = ['PHP','THB','USD'];
  const channels = {website_chat:'Website chat',facebook_messenger:'Facebook Messenger',ai_phone:'Missed call / AI phone'};
  const money = (minor, currency) => new Intl.NumberFormat(undefined,{style:'currency',currency}).format(minor / 100);
  const maxMinor = 99999999999;
  function paymentAmounts(raw, currency) {
    const value = raw.trim();
    if (!value) return [null];
    const marker = {PHP:'PHP|₱',THB:'THB|฿',USD:'USD|\\$'}[currency];
    if (!marker) return [];
    const prefix = new RegExp('^(?:' + marker + ')\\s*','i');
    const suffix = new RegExp('\\s*(?:' + marker + ')$','i');
    const numeric = (prefix.test(value) ? value.replace(prefix,'') : value.replace(suffix,'')).replace(/[\u00a0\u202f]/g,' ');
    const amounts = new Set();
    function add(whole, fraction = '') {
      const minor = Number(whole) * 100 + Number(fraction.padEnd(2,'0'));
      if (Number.isSafeInteger(minor) && minor <= maxMinor) amounts.add(minor);
    }
    if (/^\d+$/.test(numeric)) add(numeric);
    for (const separator of [',','.']) {
      const index = numeric.lastIndexOf(separator);
      if (index < 0) continue;
      const whole = numeric.slice(0,index);
      const fraction = numeric.slice(index+1);
      if (!/^\d{1,3}$/.test(fraction) || (fraction.length === 3 && !fraction.endsWith('0'))) continue;
      const grouping = separator === '.' ? ',' : '\\.';
      if (/^\d+$/.test(whole) || new RegExp('^\\d{1,3}(?:' + grouping + '\\d{3})+$').test(whole) ||
          /^\d{1,3}(?: \d{3})+$/.test(whole)) add(whole.replace(/[ ,.]/g,''),fraction.slice(0,2));
    }
    if (/^\d{1,3}(?:(?:,\d{3})+|(?:\.\d{3})+|(?: \d{3})+)$/.test(numeric)) {
      add(numeric.replace(/[ ,.]/g,''));
    }
    return [...amounts].sort((a,b)=>b-a);
  }
  const visitTime = (value, timeZone) => new Date(value).toLocaleString(undefined,{
    timeZone,year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'
  });
  function field(form, title, control) {
    const label = el('label',title);
    label.append(control);
    form.append(label);
    return control;
  }
  function select(options, value) {
    const control = el('select');
    for (const [key,label] of options) control.add(new Option(label,key));
    control.value = value;
    return control;
  }
  function button(text, handler) {
    const node = el('button',text);
    node.type = 'button';
    node.addEventListener('click',handler);
    return node;
  }
  function messageBox() {
    const message = el('p');
    message.setAttribute('role','status');
    return message;
  }
  function visitControls(row,{event,latest,visit,events,client,currency,timezone,refresh}) {
    if (visit) row.append(el('small',visit.amount_minor == null ? 'Payment amount not recorded' : 'Amount paid by patient · ' + money(visit.amount_minor,visit.currency)));
    const opener = button(visit ? (visit.amount_minor == null ? 'Add amount collected' : 'Review visit') : 'Complete visit', () => {
      opener.hidden = true;
      const form = el('form');
      form.className = 'clinic-appointment-editor';
      const amount = field(form,visit?.amount_minor != null ? 'Total paid by the patient so far' : 'Total paid by the patient so far (optional)',el('input'));
      Object.assign(amount,{type:'text',inputMode:'decimal',maxLength:40,placeholder:'e.g. 2500'});
      if (visit?.amount_minor != null) { amount.value = (visit.amount_minor/100).toFixed(2); amount.required = true; }
      form.append(el('small',visit?.amount_minor != null ? 'Update the total received for this visit, including any later payments or refunds.' : 'Leave blank if the amount is unknown. Enter 0 for a free visit.'));
      const currencyOptions = currencies.map(x=>[x,x]);
      if (!visit?.currency && !currency) currencyOptions.unshift(['','Select the clinic currency']);
      const unit = field(form,'Currency',select(currencyOptions,visit?.currency || currency || ''));
      unit.disabled = visit?.amount_minor != null;
      const receipt=field(form,'Receipt reference (optional)',el('input'));
      receipt.maxLength=80;receipt.value=visit?.receipt_ref || '';
      let source;
      if (event.channel === 'staff_booking') {
        const options = events.filter(e => channels[e.channel] && !e.details?.demo && !e.details?.relatedRequestKey &&
          !e.details?.messengerSetupTestId && !e.details?.messengerRequestAction &&
          ['booking.requested','inquiry.followup_needed','call.followup_needed'].includes(e.kind) &&
          Date.parse(e.occurred_at) <= Date.parse(latest.appointment_at))
          .map(e=>[e.event_key,[channels[e.channel],e.details?.patientName || e.summary,
            visitTime(e.occurred_at,timezone)].filter(Boolean).join(' · ')]);
        if (visit?.eden_event_key && !options.some(([key])=>key===visit.eden_event_key)) options.push([visit.eden_event_key,'Previously linked request']);
        source = field(form,'Original Eden request',select([['','Walk-in or other staff booking'],...options],visit?.eden_event_key || ''));
        source.disabled = Boolean(visit?.eden_event_key);
        if (!source.disabled) form.append(el('small','Only inquiries received by the appointment time can be linked.'));
      } else if (Date.parse(event.occurred_at) > Date.parse(latest.appointment_at)) {
        form.append(el('p','This visit is before the inquiry. You can record the payment, and the attribution needs review.'));
      }
      const save = el('button',visit ? 'Save visit' : 'Record completed visit');
      const cancel = button('Close',()=>{form.remove();opener.hidden=false;opener.focus();});
      cancel.className = 'clinic-secondary';
      const preview = messageBox();
      const choices = el('div');
      const feedback = messageBox();
      function updatePreview() {
        const amounts = paymentAmounts(amount.value,unit.value);
        choices.replaceChildren();
        choices.hidden = amounts.length < 2;
        save.disabled = !unit.value || amounts.length !== 1 || (amounts[0] === null && amount.required);
        if (!unit.value) preview.textContent = 'Select the clinic currency to preview the amount.';
        else if (!amounts.length) preview.textContent = 'Enter an amount with up to two decimal places in the selected currency.';
        else if (amounts.length > 1) {
          preview.textContent = 'Confirm the intended amount.';
          for (const minor of amounts) {
            choices.append(button('Use '+money(minor,unit.value),()=>{
              amount.value = (minor/100).toFixed(2);
              updatePreview();
              save.focus();
            }));
          }
        } else preview.textContent = amounts[0] === null ?
          (amount.required ? 'Enter the total paid, or 0 for a full refund.' : 'Will record the visit with the amount unknown.') :
          'Will record '+money(amounts[0],unit.value);
        return amounts[0];
      }
      amount.addEventListener('input',updatePreview);
      unit.addEventListener('change',updatePreview);
      form.append(preview,choices,save,cancel,feedback);
      updatePreview();
      let saving = false;
      form.addEventListener('submit',async e=>{
        e.preventDefault();
        if (saving) return;
        const minor = updatePreview();
        if (save.disabled) return;
        saving = save.disabled = cancel.disabled = amount.disabled = true;
        if (source) source.disabled = true;
        unit.disabled = receipt.disabled = true;
        feedback.textContent = '';
        let recorded = false;
        try {
          const {error} = await client.rpc('record_clinic_visit',{p_location:event.location_id,p_event:event.event_key,
            p_appointment:latest.appointment_at,p_revision:visit?.revision || 0,
            p_amount_minor:minor,p_currency:unit.value,p_source:source?.value || null,p_receipt:receipt.value.trim() || null});
          if (error) throw error;
          recorded = true;
          if (row.isConnected) await refresh();
        } catch (err) {
          feedback.textContent = recorded ? 'Visit saved. Refresh the workspace to see the updated payment.' :
            (err.message || 'Could not save the visit. Please retry.');
        } finally {
          cancel.disabled = false;
          if (!recorded) {
            saving = amount.disabled = receipt.disabled = false;
            unit.disabled = visit?.amount_minor != null;
            if (source) source.disabled = Boolean(visit?.eden_event_key);
            updatePreview();
          }
        }
      });
      row.append(form); amount.focus();
    });
    row.append(opener);
  }
  function settingsForm(host,ctx,settings,reload) {
    const form=el('form'); form.className='clinic-rescue-form';
    const start=field(form,'First day of the free pilot',el('input'));
    start.type='date'; start.required=true;
    start.value=settings?.pilot_start || new Intl.DateTimeFormat('en-CA',{timeZone:ctx.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const cadence=field(form,'Results report frequency',select([['weekly','Weekly'],['fortnightly','Every two weeks'],['monthly','Monthly']],settings?.cadence || 'weekly'));
    const currency=field(form,'Clinic currency',select([['','Select currency'],...currencies.map(x=>[x,x])],settings?.currency || ''));
    currency.required=true;
    const rate=field(form,'Agreed Eden share (%)',el('input'));
    Object.assign(rate,{type:'number',step:'0.01',min:'0',max:'100',required:true,value:settings ? settings.rate_bps/100 : ''});
    for (const input of [start,cadence,currency,rate]) input.disabled=Boolean(settings);
    form.append(el('p','The first seven days are free. Monthly settlement uses recorded collections for linked requests and appointments after the free week. Refunds reduce the total.'));
    const opt=field(form,'Email approved reports to '+ctx.email,el('input')); opt.type='checkbox';
    opt.checked=settings?.recipient===ctx.email;
    if (settings?.recipient && !opt.checked) form.append(el('small','Current report recipient · '+settings.recipient));
    if (!settings) {
      const agree=field(form,'I confirm the pilot dates, currency and performance share agreed with Eden.',el('input'));
      agree.type='checkbox';agree.required=true;
    }
    const save=el('button',settings?'Save email preference':'Start reporting pilot');
    const feedback=messageBox();
    form.append(save,feedback);host.append(form);
    form.onsubmit=async e=>{
      e.preventDefault();save.disabled=true;
      try {
        const {error}=await ctx.client.rpc('configure_rescue_reports',{p_location:ctx.locationId,p_start:start.value,p_cadence:cadence.value,
          p_currency:currency.value,p_rate_bps:Math.round(rate.valueAsNumber*100),p_email_me:opt.checked});
        if(error) throw error;
        await reload();
      } catch(err){feedback.textContent=err.message;} finally{save.disabled=false;}
    };
  }
  async function payment(section,url) {
    const link=el('a','Pay Eden’s share');
    const parsed=new URL(url);
    if(parsed.protocol!=='https:' || parsed.username || parsed.password) return;
    link.href=parsed.href;link.target='_blank';link.rel='noopener noreferrer';link.className='clinic-messenger-primary-link';
    section.append(link);
    try {
      const {qrcode}=await import('/assets/clinic-qr.mjs');
      const qr=qrcode(0,'M');qr.addData(parsed.href);qr.make();
      const image=el('img');image.src=qr.createDataURL(5,20);
      image.alt='Scan to open the same payment link';image.width=150;image.height=150;
      section.append(image);
    } catch { /* The payment link remains usable if the QR cannot be rendered. */ }
  }
  function priorDay(date) { return new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10); }
  function countedVisits(host, lines, currency, timezone, label = '') {
    if (!Array.isArray(lines)) return;
    const details = el('details');
    details.className = 'clinic-rescue-evidence';
    details.append(el('summary','View counted visits'+(label ? ' · '+label : '')+' ('+lines.length+')'));
    if (!lines.length) details.append(el('p','No qualifying visit payments were recorded for this total.'));
    else {
      const list = el('ul');
      list.className = 'clinic-rescue-visit-list';
      for (const line of lines) {
        const item = el('li');
        item.append(el('strong',[channels[line.channel] || line.channel,'Inquiry '+line.ref].join(' · ')),
          el('p','Inquiry '+visitTime(line.inquiry_at,timezone)+' · Visit '+visitTime(line.visit_at,timezone)),
          metricList([
            ['Amount collected this period',line.amount_minor],
            ['Estimated Eden fee',line.estimated_fee_minor]
          ],currency),
          el('p',line.free ? 'The inquiry or visit was during the free pilot. No Eden fee applies.' :
            'Visit linked to an inquiry received by the appointment time. Both fall in the paid period.'));
        list.append(item);
      }
      details.append(el('p','Amounts reflect payments and refunds recorded during this report period.'),list);
    }
    host.append(details);
  }
  function reportCard(host,ctx,r,reload) {
    const s=r.snapshot;
    const card=el('details');card.className='clinic-rescue-card';
    const settlement=r.kind==='settlement';
    const heading=el('summary');
    const label=el('span');
    label.append(el('strong',settlement?'Monthly settlement':'Results report'),
      el('small',r.period_start+' – '+priorDay(r.period_end)));
    const badge=el('span',r.approved_at?'Approved':'Draft');
    badge.className='clinic-event-status';
    if (r.approved_at) badge.dataset.status='confirmed';
    heading.append(label,badge);
    card.append(heading);
    const counts=Object.entries(s.channels);
    card.append(el('h3','Revenue Rescue Report'),el('p',ctx.clinicName+' · '+r.period_start+' – '+priorDay(r.period_end)),
      el('p',counts.length?counts.map(([c,n])=>(channels[c] || c)+' · '+n).join('   |   '):'No Eden requests captured this period.'),
      el('p',s.confirmed+' requests from this period confirmed · '+s.outstanding+' open follow-ups at period end'),
      el('p',s.completed+' visits recorded as completed · '+s.attributed+' linked to Eden · '+s.amount_pending+' awaiting an amount'));
    if(s.other_currency) card.append(el('p',s.other_currency+' visits recorded in another currency. Review separately.'));
    const totals=el('div');totals.className='clinic-rescue-totals';
    totals.append(el('strong','Collections recorded from Eden visits · '+money(s.collected_minor,s.currency)));
    if(settlement) totals.append(el('p','Eligible collections this period · '+money(s.eligible_minor,s.currency)),
      el('p','Eden’s share at '+(s.rate_bps/100)+'% after credits and rounding · '+money(s.share_minor,s.currency)),
      el('strong','Collections after Eden’s share · '+money(s.collected_minor-s.share_minor,s.currency)));
    if(settlement && s.credit_minor>0) totals.append(el('p','Credit toward future Eden shares · '+money(s.credit_minor,s.currency)));
    if (!settlement && s.estimated_share_minor != null) totals.append(el('p','Estimated Eden share at '+s.rate_bps/100+'% · '+money(s.estimated_share_minor,s.currency)));
    if (!settlement) totals.append(el('p','Payment is reviewed in the monthly settlement.'));
    if (settlement && s.estimated_share_minor != null) {
      const adjustment = s.share_minor - s.credit_minor - s.estimated_share_minor;
      if (adjustment) totals.append(
        el('p','Estimated fees for this period · '+money(s.estimated_share_minor,s.currency)),
        el('p','Adjustment for earlier periods and settlement rounding · '+money(adjustment,s.currency)));
    }
    countedVisits(totals,s.counted_visits,s.currency,ctx.timezone);
    card.append(totals,el('small','Free pilot through '+s.free_through+'. Amounts come from clinic staff entries.'));
    if (!Array.isArray(s.counted_visits) && r.approved_at) {
      card.append(el('small','This report shows the totals and evidence saved at approval.'));
    }
    if (!Array.isArray(s.counted_visits) && s.entries?.length) {
      const evidence=el('details');evidence.append(el('summary','Review supporting entries ('+s.entries.length+')'));
      const list=el('ul');
      for(const line of s.entries) list.append(el('li',[new Date(line.posted).toLocaleDateString(undefined,{timeZone:ctx.timezone}),
        channels[line.channel],line.ref,money(line.delta_minor,s.currency),line.free?'Free pilot':'Eligible'].filter(Boolean).join(' · ')));
      evidence.append(list);card.append(evidence);
    }
    const feedback=messageBox();
    if(!r.approved_at) {
      const approve=button('Approve report',async()=>{
        approve.disabled=true;
        try {
          const {error}=await ctx.client.rpc('approve_rescue_report',{p_report:r.id,p_expected:s});
          if(error) throw error;
          await reload(r.id,true);
        } catch(err){feedback.textContent=err.message;approve.disabled=false;}
      });
      card.append(approve);
    }
    if(r.checkout_url && settlement && r.approved_at && s.share_minor>0) void payment(card,r.checkout_url);
    else if(r.approved_at && settlement && s.share_minor>0) card.append(el('p','Payment link pending from Eden.'));
    card.append(feedback);host.append(card);return card;
  }
  function periodLabel(period) {
    const dateLabel=date=>new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})
      .format(new Date(date+'T00:00:00Z'));
    return period.period_start===period.through ? 'Today · '+dateLabel(period.through) :
      dateLabel(period.period_start)+' – '+dateLabel(period.through);
  }
  function metricList(values,currency) {
    const metrics = el('dl');
    metrics.className = 'clinic-overview-metrics';
    for (const [label,minor] of values) {
      const metric = el('div');
      metric.append(el('dt',label),el('dd',money(minor,currency)));
      metrics.append(metric);
    }
    return metrics;
  }
  async function overview({client,locationId,valid}) {
    const host = document.getElementById('clinic-overview-revenue');
    host.replaceChildren(el('p','Loading current figures…'));
    try {
      const {data,error} = await client.rpc('current_rescue_period',{p_location:locationId});
      if (!valid()) return;
      if (error) throw error;
      if (!data) {
        host.replaceChildren(el('p','Current figures will appear once reporting is configured and the pilot begins.'));
        return;
      }
      const values = [
        ['Paid-period collections',data.eligible_minor],
        ['Estimated Eden fee',data.estimated_share_minor]
      ];
      const free = data.collected_minor-data.eligible_minor;
      if (free) values.push(['Free-pilot collections',free]);
      host.replaceChildren(el('p',periodLabel(data)),metricList(values,data.currency));
    } catch {
      if (valid()) host.replaceChildren(el('p','Current figures could not be loaded.'),
        button('Retry',()=>overview({client,locationId,valid})));
    }
  }
  function currentCard(host, period, timezone) {
    const card=el('section');card.className='clinic-panel clinic-rescue-current';
    card.append(el('h2','Current period so far'),el('p',periodLabel(period)));
    const free=period.collected_minor-period.eligible_minor;
    const freeVisits=period.counted_visits?.filter(line=>line.free);
    const values = [
      ['Paid-period collections',period.eligible_minor],
      ['Estimated Eden fee at '+period.rate_bps/100+'%',period.estimated_share_minor]
    ];
    if (free || freeVisits?.length) values.push(['Free-pilot collections',free]);
    card.append(metricList(values,period.currency));
    countedVisits(card,period.counted_visits?.filter(line=>!line.free),period.currency,timezone);
    if (free || freeVisits?.length) countedVisits(card,freeVisits,period.currency,timezone,'Free pilot');
    card.append(el('small','The monthly settlement accounts for credits and rounding.'));
    host.append(card);
  }
  let panelSequence=0;
  function reports(ctx) {
    const seq=++panelSequence;
    const panel=document.getElementById('clinic-rescue'),host=document.getElementById('clinic-rescue-body');
    if(!panel) return;
    panel.hidden=!ctx.manager;host.replaceChildren();
    if(!ctx.manager){panel.open=false;panel.ontoggle=null;return;}
    let request=0;
    async function load(wanted=ctx.reportId,afterApproval=false) {
      const current=++request;
      const valid=()=>seq===panelSequence && request===current;
      const box=el('div');host.replaceChildren(el('p','Loading reports…'));
      try {
        const refreshed=await ctx.client.rpc('refresh_rescue_reports',{p_location:ctx.locationId});if(refreshed.error) throw refreshed.error;
        const [prefs,rows]=await Promise.all([ctx.client.from('clinic_rescue_settings').select('*').eq('location_id',ctx.locationId).maybeSingle(),
          ctx.client.from('clinic_rescue_reports').select('*').eq('location_id',ctx.locationId).order('period_end',{ascending:false}).order('kind')]);
        if(!valid()) return;
        if(prefs.error || rows.error) throw prefs.error || rows.error;
        if(prefs.data) {
          const currentPeriod=await ctx.client.rpc('current_rescue_period',{p_location:ctx.locationId});
          if(!valid()) return;
          if(currentPeriod.error) box.append(el('p','Current figures could not be loaded.'),button('Retry current figures',()=>load()));
          else if(currentPeriod.data) currentCard(box,currentPeriod.data,ctx.timezone);
        }
        if(prefs.data && !rows.data.length) box.append(el('p','Your first results report will appear after the seven-day pilot.'));
        let selected;
        if (rows.data.length) {
          const history=el('section'); history.className='clinic-panel clinic-rescue-history';
          history.append(el('h2','Report history'));
          box.append(history);
          for(const r of rows.data) {
            const card=reportCard(history,ctx,r,load);
            if(r.id===wanted){selected=card;card.open=true;if(afterApproval && !r.approved_at)card.append(el('p','The figures changed. Review the updated draft before approving.'));}
          }
        }
        const settings=el('details');settings.className='clinic-panel clinic-rescue-settings';settings.open=!prefs.data;
        settings.append(el('summary',prefs.data?'Reporting settings':'Set up reporting'));
        settingsForm(settings,ctx,prefs.data,()=>load());box.append(settings);host.replaceChildren(box);
        if(selected) selected.scrollIntoView({block:'nearest'});
      } catch(err){if(valid())host.replaceChildren(el('p',err.message || 'Reports unavailable.'),button('Retry',()=>load()));}
    }
    panel.ontoggle=()=>{if(panel.open) void load();};
    if(ctx.reportId && !panel.open) panel.open=true;
    else if(panel.open) void load();
  }
  let pendingVersion=0;
  function pending({client,locationId,timezone,candidates,refresh}) {
    const version=++pendingVersion;
    const panel=document.getElementById('clinic-pending-visits');
    const host=panel.querySelector('div');
    let page=0;
    async function load() {
      host.replaceChildren(el('p','Loading visits…'));
      try {
        const {data,error}=await client.from('clinic_visit_completions')
          .select('*,event:clinic_outcomes!clinic_visit_completions_event_key_fkey(event_key,account_id,location_id,channel,summary,details,occurred_at)')
          .eq('location_id',locationId).is('amount_minor',null).order('completed_at').order('event_key').range(page*20,page*20+20);
        if(version!==pendingVersion) return;
        if(error) throw error;
        host.replaceChildren();
        for(const v of data.slice(0,20)) {
          if(!v.event) continue;
          const row=el('article');row.className='clinic-event';
          row.append(el('strong',v.event.details?.patientName || v.event.summary),
            el('small',visitTime(v.appointment_at,timezone)+' · '+(v.event.details?.service || 'Visit')));
          visitControls(row,{visit:v,event:v.event,latest:v,events:candidates(),client,currency:v.currency,timezone,refresh});
          host.append(row);
        }
        if(!data.length) host.append(el('p','All completed visits have an amount recorded.'));
        if(page>0) host.append(button('Previous visits',()=>{page--;void load();}));
        if(data.length>20) host.append(button('More visits',()=>{page++;void load();}));
      } catch(err) {if(version===pendingVersion)host.replaceChildren(el('p',err.message),button('Retry',load));}
    }
    host.replaceChildren();
    panel.ontoggle=()=>{if(panel.open)void load();};
    if(panel.open)void load();
  }
  let reviewVersion = 0;
  function attributionReviews({client,locationId,timezone}) {
    const version = ++reviewVersion;
    const panel = document.getElementById('clinic-attribution-reviews');
    const host = panel.querySelector('div');
    let page = 0;
    async function load() {
      host.replaceChildren(el('p','Loading visits…'));
      try {
        const {data,error} = await client.rpc('clinic_visit_attribution_reviews',{p_location:locationId,p_offset:page*20});
        if (version !== reviewVersion) return;
        if (error) throw error;
        host.replaceChildren();
        if (!data.length) host.append(el('p','No visits need a date review.'));
        else {
          host.append(el('p','These visits took place before the linked inquiry. Payments are still recorded. These visits are excluded when Eden totals are calculated.'));
          const list = el('ul');
          for (const visit of data.slice(0,20)) {
            list.append(el('li',[visit.reference,channels[visit.channel] || visit.channel,
              'Visit '+visitTime(visit.visit_at,timezone),'Inquiry '+visitTime(visit.inquiry_at,timezone)].join(' · ')));
          }
          host.append(list);
        }
        if (page>0) host.append(button('Previous visits',()=>{page--;void load();}));
        if (data.length>20) host.append(button('More visits',()=>{page++;void load();}));
      } catch {
        if (version === reviewVersion) host.replaceChildren(el('p','Could not load visits for review.'),button('Retry',load));
      }
    }
    host.replaceChildren();
    panel.ontoggle = ()=>{if (panel.open) void load();};
    if (panel.open) void load();
  }
  return {visitControls,reports,pending,attributionReviews,overview};
})();
