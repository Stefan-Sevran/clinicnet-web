/* Clinic Workspace visit recording and private owner reports. */
const ClinicRescue = (() => {
  const el = (tag, text) => Object.assign(document.createElement(tag), {textContent: text ?? ''});
  const currencies = ['PHP','THB','USD'];
  const channels = {website_chat:'Website chat',facebook_messenger:'Facebook Messenger',ai_phone:'AI phone'};
  const money = (minor, currency) => new Intl.NumberFormat(undefined,{style:'currency',currency}).format(minor / 100);
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
  function visitControls(row,{event,latest,visit,events,client,currency,refresh}) {
    if (visit) row.append(el('small',visit.amount_minor == null ? 'Amount pending' : 'Amount collected · ' + money(visit.amount_minor,visit.currency)));
    const opener = button(visit ? (visit.amount_minor == null ? 'Add amount collected' : 'Review visit') : 'Complete visit', () => {
      opener.hidden = true;
      const form = el('form');
      form.className = 'clinic-appointment-editor';
      const amount = field(form,'Amount collected (optional)',el('input'));
      Object.assign(amount,{type:'number',min:'0',max:'999999999.99',step:'0.01',placeholder:'Amount pending'});
      if (visit?.amount_minor != null) { amount.value = (visit.amount_minor/100).toFixed(2); amount.required = true; }
      const unit = field(form,'Currency',select(currencies.map(x=>[x,x]),visit?.currency || currency));
      unit.disabled = visit?.amount_minor != null;
      const receipt=field(form,'Receipt reference (optional)',el('input'));
      receipt.maxLength=80;receipt.value=visit?.receipt_ref || '';
      let source;
      if (event.channel === 'staff_booking') {
        const options = events.filter(e => channels[e.channel] && !e.details?.demo && !e.details?.relatedRequestKey &&
          ['booking.requested','inquiry.followup_needed','call.followup_needed'].includes(e.kind))
          .map(e=>[e.event_key,[channels[e.channel],e.details?.patientName || e.summary,
            new Date(e.occurred_at).toLocaleDateString()].filter(Boolean).join(' · ')]);
        if (visit?.eden_event_key && !options.some(([key])=>key===visit.eden_event_key)) options.push([visit.eden_event_key,'Previously linked request']);
        source = field(form,'Original Eden request',select([['','Walk-in or other staff booking'],...options],visit?.eden_event_key || ''));
        source.disabled = Boolean(visit?.eden_event_key);
      }
      const save = el('button',visit ? 'Save visit' : 'Record completed visit');
      const cancel = button('Close',()=>{form.remove();opener.hidden=false;opener.focus();});
      cancel.className = 'clinic-secondary';
      const feedback = messageBox();
      form.append(save,cancel,feedback);
      form.addEventListener('submit',async e=>{
        e.preventDefault();
        if (save.disabled) return;
        save.disabled = cancel.disabled = true;
        try {
          const {error} = await client.rpc('record_clinic_visit',{p_location:event.location_id,p_event:event.event_key,
            p_appointment:latest.appointment_at,p_revision:visit?.revision || 0,
            p_amount_minor:amount.value === '' ? null : Math.round(amount.valueAsNumber*100),p_currency:unit.value,p_source:source?.value || null,p_receipt:receipt.value.trim() || null});
          if (error) throw error;
          if (row.isConnected) await refresh();
        } catch (err) { feedback.textContent = err.message || 'Could not save the visit. Please retry.'; }
        finally { save.disabled = cancel.disabled = false; }
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
    const currency=field(form,'Clinic currency',select(currencies.map(x=>[x,x]),settings?.currency || (ctx.timezone==='Asia/Bangkok'?'THB':'PHP')));
    const rate=field(form,'Agreed Eden share (%)',el('input'));
    Object.assign(rate,{type:'number',step:'0.01',min:'0',max:'100',required:true,value:(settings?.rate_bps ?? 1500)/100});
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
  function reportCard(host,ctx,r,reload) {
    const s=r.snapshot;
    const card=el('details');card.className='clinic-rescue-card';
    const settlement=r.kind==='settlement';
    const heading=el('summary',(settlement?'Monthly settlement':'Results report')+' · '+r.period_start+' – '+priorDay(r.period_end)+' · '+(r.approved_at?'Approved':'Draft'));
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
    if(!settlement) totals.append(el('p','Payment is reviewed in the monthly settlement.'));
    card.append(totals,el('small','Free pilot through '+s.free_through+'. Amounts come from clinic staff entries.'));
    if(s.entries.length) {
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
        if(prefs.data && !rows.data.length) box.append(el('p','Your first results report will appear after the seven-day pilot.'));
        let selected;
        for(const r of rows.data) {
          const card=reportCard(box,ctx,r,load);
          if(r.id===wanted){selected=card;card.open=true;if(afterApproval && !r.approved_at)card.append(el('p','The figures changed. Review the updated draft before approving.'));}
        }
        const settings=el('details');settings.open=!prefs.data;
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
  function pending({client,locationId,candidates,refresh}) {
    const version=++pendingVersion;
    const panel=document.getElementById('clinic-pending-visits');
    const host=panel.querySelector('div');
    let page=0;
    async function load() {
      host.replaceChildren(el('p','Loading visits…'));
      try {
        const {data,error}=await client.from('clinic_visit_completions')
          .select('*,event:clinic_outcomes!clinic_visit_completions_event_key_fkey(event_key,account_id,location_id,channel,summary,details)')
          .eq('location_id',locationId).is('amount_minor',null).order('completed_at').order('event_key').range(page*20,page*20+20);
        if(version!==pendingVersion) return;
        if(error) throw error;
        host.replaceChildren();
        for(const v of data.slice(0,20)) {
          if(!v.event) continue;
          const row=el('article');row.className='clinic-event';
          row.append(el('strong',v.event.details?.patientName || v.event.summary),
            el('small',new Date(v.appointment_at).toLocaleDateString()+' · '+(v.event.details?.service || 'Visit')));
          visitControls(row,{visit:v,event:v.event,latest:v,events:candidates(),client,currency:v.currency,refresh});
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
  return {visitControls,reports,pending};
})();
