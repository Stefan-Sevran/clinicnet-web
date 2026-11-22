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
  function settingsForm(host,ctx,settings,reload,initial) {
    if (!settings && initial && !initial.accepted_at) {
      host.append(el('p','Confirm the terms from Eden above before starting reporting.'));
      return;
    }
    const form=el('form'); form.className='clinic-rescue-form';
    const start=field(form,'First day of the free pilot',el('input'));
    start.type='date'; start.required=true;
    start.value=settings?.pilot_start || initial?.effective_on || new Intl.DateTimeFormat('en-CA',{timeZone:ctx.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const cadence=field(form,'Results report frequency',select([['weekly','Weekly'],['fortnightly','Every two weeks'],['monthly','Monthly']],settings?.cadence || 'weekly'));
    const currency=field(form,'Clinic currency',select([['','Select currency'],...currencies.map(x=>[x,x])],settings?.currency || ''));
    currency.required=true;
    const rate=field(form,'Agreed Eden share (%)',el('input'));
    Object.assign(rate,{type:'number',step:'0.01',min:'0',max:'100',required:true,value:settings ? settings.rate_bps/100 : initial ? initial.rate_bps/100 : ''});
    start.disabled=rate.disabled=Boolean(settings || initial);
    cadence.disabled=currency.disabled=Boolean(settings);
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
  function countedVisits(host, lines, currency, timezone) {
    if (!Array.isArray(lines)) return;
    const details = el('details');
    details.className = 'clinic-rescue-evidence';
    details.append(el('summary','View counted visits ('+lines.length+')'));
    const list = el('ul');
    list.className = 'clinic-rescue-visit-list';
    for (const line of lines) {
      const item = el('li');
      const dates = el('p');
      dates.className = 'clinic-visit-dates';
      dates.append(el('strong','First contact'),el('span',visitTime(line.inquiry_at,timezone)),
        el('strong','Visit'),el('span',visitTime(line.visit_at,timezone)));
      const fee = line.estimated_fee_minor;
      item.append(el('strong',channels[line.channel] || line.channel),dates,
        metricList(revenueValues(line.amount_minor,fee,Number.isInteger(line.rate_bps)?'Eden fee ('+line.rate_bps/100+'%)':line.free?'Eden fee (0%)':'Eden fee (est.)'),currency));
      if (line.ref) item.append(el('small','Reference '+line.ref));
      list.append(item);
    }
    details.append(lines.length?list:el('p','No visit payments counted yet.'));
    host.append(details);
  }
  function revenueValues(gross, fee, feeLabel='Eden fee', netLabel='Net revenue') {
    return [['Booking revenue',gross],[feeLabel,fee],[netLabel,gross-fee]];
  }
  function csvDownload(name, rows) {
    const csv = rows.map(row => row.map(value => '"' + String(value ?? '').replaceAll('"','""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}));
    const link = el('a');
    link.href=url;
    link.download=name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const csvAmount = minor => Number.isSafeInteger(minor) ? (minor/100).toFixed(2) : '';
  function exportReport(r) {
    const s=r.snapshot;
    const settlement=r.kind==='settlement';
    csvDownload('eden-revenue-'+r.period_start+'-'+r.kind+'.csv',[
      ['Period start','Period end (inclusive)','Report','Status','Currency','Collections from Eden visits',
        'Eligible collections','Estimated Eden fee','Settled Eden fee','Credit toward future fees'],
      [r.period_start,priorDay(r.period_end),settlement?'Monthly settlement':'Results report',
        r.approved_at?'Approved':'Draft',s.currency,csvAmount(s.collected_minor),csvAmount(s.eligible_minor),
        csvAmount(s.estimated_share_minor),settlement?csvAmount(s.share_minor):'',settlement?csvAmount(s.credit_minor):'']
    ]);
  }
  function printSummary(card) {
    const clear = () => card.removeAttribute('data-print-summary');
    document.querySelector('[data-print-summary]')?.removeAttribute('data-print-summary');
    card.setAttribute('data-print-summary','');
    window.addEventListener('afterprint',clear,{once:true});
    window.print();
  }
  function revenueTimeline(host, entries) {
    const section=el('section');
    section.className='clinic-panel clinic-rescue-timeline';
    const header=el('div');
    header.className='clinic-rescue-timeline-header';
    const title=el('div');
    title.append(el('h2','Revenue over time'));
    header.append(title);
    section.append(header);
    if (!entries.length) {
      section.append(el('p','Monthly revenue will appear here after your first revenue period closes.'));
      host.append(section);
      return;
    }
    const toolbar=el('div');
    toolbar.className='clinic-rescue-export-actions';
    const available=[...new Set(entries.map(({r})=>r.snapshot.currency))];
    const unit=select(available.map(currency=>[currency,currency]),available[0]);
    if (available.length>1) field(toolbar,'Currency',unit);
    const range=select([['6','Latest 6 periods'],['12','Latest 12 periods'],['all','All periods']],'6');
    field(toolbar,'Date range',range);
    const chart=el('ol');
    chart.className='clinic-rescue-chart';
    chart.setAttribute('aria-label','Monthly collections by settlement period');
    const visible=()=>entries.filter(({r})=>r.snapshot.currency===unit.value).slice(0,range.value==='all'?undefined:Number(range.value)).reverse();
    const download=button('Download timeline CSV',()=>csvDownload('eden-collections-timeline-'+unit.value+'.csv',[
      ['Period start','Period end (inclusive)','Status','Currency','Booking revenue','Eden fee','Net revenue'],
      ...visible().map(({r})=>[r.period_start,priorDay(r.period_end),r.approved_at?'Approved':'Draft',r.snapshot.currency,csvAmount(r.snapshot.collected_minor),csvAmount(r.snapshot.share_minor),csvAmount(r.snapshot.collected_minor-r.snapshot.share_minor)])
    ]));
    download.className='clinic-secondary';
    toolbar.append(download);
    header.append(toolbar);
    const legend = el('p');
    legend.className = 'clinic-revenue-legend';
    legend.append(el('span','Booking revenue'),el('span','Net revenue'));
    const table = el('table');
    table.className = 'clinic-revenue-table';
    const thead = table.createTHead().insertRow();
    for (const label of ['Month','Status','Booking revenue','Eden fee','Net revenue']) {
      const th = el('th',label); th.scope = 'col'; thead.append(th);
    }
    const tbody = table.createTBody();
    function draw() {
      const periods=visible();
      const amounts=periods.flatMap(({r:{snapshot:s}})=>[s.collected_minor,s.collected_minor-s.share_minor]);
      const min=Math.min(0,...amounts);
      const max=Math.max(0,...amounts);
      const span=max-min || 1;
      chart.replaceChildren();
      chart.style.gridTemplateColumns='repeat('+periods.length+', minmax(5rem, 1fr))';
      chart.style.setProperty('--chart-zero',(-min/span)*100+'%');
      tbody.replaceChildren();
      for (const {r,card} of periods) {
        const s=r.snapshot;
        const item=el('li');
        const end=priorDay(r.period_end);
        const month=new Intl.DateTimeFormat(undefined,{month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(end+'T00:00:00Z'));
        const link=button(month,()=>{
          card.open=true;
          card.querySelector('summary').focus();
        });
        link.className='clinic-secondary clinic-rescue-chart-link';
        link.setAttribute('aria-label','View '+month+' settlement');
        link.title = 'Booking revenue '+money(s.collected_minor,s.currency)+' · Net revenue '+money(s.collected_minor-s.share_minor,s.currency);
        const track=el('span');
        track.className='clinic-rescue-chart-track';
        track.setAttribute('aria-hidden','true');
        for (const amount of [s.collected_minor,s.collected_minor-s.share_minor]) {
          const bar=el('span');
          bar.style.insetBlockEnd=(Math.min(0,amount)-min)/span*100+'%';
          bar.style.height=Math.abs(amount)/span*100+'%';
          track.append(bar);
        }
        item.append(track,link);
        chart.append(item);
        const row=tbody.insertRow();
        for (const value of [month,r.approved_at?'Approved':'Draft',...revenueValues(s.collected_minor,s.share_minor).map(([,minor])=>money(minor,s.currency))]) {
          row.insertCell().textContent=value;
        }
      }
    }
    range.addEventListener('change',draw);
    unit.addEventListener('change',draw);
    draw();
    const scroll=el('div');
    scroll.className='clinic-revenue-scroll';
    scroll.tabIndex=0;
    scroll.setAttribute('role','region');
    scroll.setAttribute('aria-label','Revenue chart');
    scroll.append(chart);
    const breakdown=el('details');
    breakdown.className='clinic-rescue-evidence';
    const tableScroll=el('div');
    tableScroll.className='clinic-revenue-scroll';
    tableScroll.tabIndex=0;
    tableScroll.setAttribute('role','region');
    tableScroll.setAttribute('aria-label','Monthly revenue table');
    tableScroll.append(table);
    breakdown.append(el('summary','View monthly figures'),tableScroll);
    section.append(scroll,legend,breakdown);
    host.append(section);
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
    const counts=Object.entries(s.channels || {});
    const brand=el('div');
    brand.className='clinic-report-brand';
    const logo=el('img'); logo.src='/assets/clinicnet-favicon.svg?v=brand-2'; logo.alt=''; logo.width=32; logo.height=32;
    brand.append(logo,el('strong','Eden Clinic Network'));
    const activity=el('dl');
    activity.className='clinic-report-activity';
    for (const [name,count] of [...counts.map(([channel,n])=>[channels[channel] || channel,n]),
      ['Confirmed requests',s.confirmed],['Open follow-ups',s.outstanding],['Completed visits',s.completed],
      ['Visits linked to Eden',s.attributed],['Visits awaiting payment amount',s.amount_pending]]) {
      if (count==null) continue;
      const row=el('div');row.append(el('dt',name),el('dd',count));activity.append(row);
    }
    card.append(brand,el('h3','Revenue Rescue Report'),
      el('p',ctx.clinicName+' · '+periodLabel({period_start:r.period_start,through:priorDay(r.period_end)})),activity);
    if(s.other_currency) card.append(el('p',s.other_currency+' visits recorded in another currency. Review separately.'));
    const totals=el('div');totals.className='clinic-rescue-totals';
    if (settlement || s.estimated_share_minor != null) {
      const fee = settlement ? s.share_minor : s.estimated_share_minor;
      totals.append(metricList(revenueValues(s.collected_minor,fee,settlement?'Eden fee':'Eden fee (est.)',
        settlement?'Net revenue':'Net revenue (est.)'),s.currency));
    } else totals.append(el('strong','Booking revenue · '+money(s.collected_minor,s.currency)));
    if(settlement && s.credit_minor>0) totals.append(el('p','Credit for future Eden fees · '+money(s.credit_minor,s.currency)));
    if (settlement && s.estimated_share_minor != null) {
      const adjustment = s.share_minor - s.credit_minor - s.estimated_share_minor;
      if (adjustment) totals.append(
        el('p','Estimated fees for this period · '+money(s.estimated_share_minor,s.currency)),
        el('p','Adjustment for earlier periods and settlement rounding · '+money(adjustment,s.currency)));
    }
    countedVisits(totals,s.counted_visits,s.currency,ctx.timezone);
    card.append(totals);
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
    const exports=el('div');
    exports.className='clinic-rescue-export-actions clinic-report-actions';
    if(!r.approved_at) {
      const approve=button('Approve report',async()=>{
        approve.disabled=true;
        try {
          const {error}=await ctx.client.rpc('approve_rescue_report',{p_report:r.id,p_expected:s});
          if(error) throw error;
          await reload(r.id,true);
        } catch(err){feedback.textContent=err.message;approve.disabled=false;}
      });
      approve.className='clinic-report-approve';
      exports.append(approve);
    }
    if(r.checkout_url && settlement && r.approved_at && s.share_minor>0) void payment(card,r.checkout_url);
    else if(r.approved_at && settlement && s.share_minor>0) card.append(el('p','Payment link pending from Eden.'));
    for (const action of [button('Download report CSV',()=>exportReport(r)),button('Print summary / Save as PDF',()=>printSummary(card))]) {
      action.className='clinic-secondary';
      exports.append(action);
    }
    card.append(exports,feedback);host.append(card);return card;
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
  async function overview({client,locationId,valid,read = work => work}) {
    const host = document.getElementById('clinic-overview-revenue');
    host.replaceChildren(el('p','Loading current figures…'));
    try {
      const {data,error} = await read(client.rpc('current_rescue_period',{p_location:locationId}));
      if (!valid()) return;
      if (error) throw error;
      if (!data) {
        host.replaceChildren(el('p','Current figures will appear once reporting is configured and the pilot begins.'));
        return;
      }
      const values = revenueValues(data.collected_minor,data.estimated_share_minor,'Eden fee (est.)','Net revenue (est.)');
      host.replaceChildren(el('p',periodLabel(data)),metricList(values,data.currency));
    } catch {
      if (valid()) host.replaceChildren(el('p','Current figures could not be loaded.'),
        button('Retry',()=>overview({client,locationId,valid,read})));
    }
  }
  function currentCard(host, period, timezone) {
    const card=el('section');card.className='clinic-panel clinic-rescue-current';
    card.append(el('h2','Current period so far'),el('p',periodLabel(period)));
    card.append(metricList(revenueValues(period.collected_minor,period.estimated_share_minor,'Eden fee (est.)','Net revenue (est.)'),period.currency));
    countedVisits(card,period.counted_visits,period.currency,timezone);
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
        let through;
        if(prefs.data) {
          const currentPeriod=await ctx.client.rpc('current_rescue_period',{p_location:ctx.locationId});
          if(!valid()) return;
          if(currentPeriod.error) box.append(el('p','Current figures could not be loaded.'),button('Retry current figures',()=>load()));
          else if(currentPeriod.data) {
            through=currentPeriod.data.through;
            currentCard(box,currentPeriod.data,ctx.timezone);
          }
        }
        if(prefs.data && !rows.data.length) box.append(el('p','Your first results report will appear after the seven-day pilot.'));
        let selected;
        const timeline=[];
        const today=through || new Intl.DateTimeFormat('sv-SE',{timeZone:ctx.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
        const history=el('section');history.className='clinic-panel clinic-rescue-history';
        if (rows.data.length) {
          history.append(el('h2','Report history'));
          for(const r of rows.data) {
            const card=reportCard(history,ctx,r,load);
            if (r.kind==='settlement' && r.period_end<=today && Number.isSafeInteger(r.snapshot.collected_minor) && Number.isSafeInteger(r.snapshot.share_minor) &&
                currencies.includes(r.snapshot.currency)) timeline.push({r,card});
            if(r.id===wanted){selected=card;card.open=true;if(afterApproval && !r.approved_at)card.append(el('p','The figures changed. Review the updated draft before approving.'));}
          }
        }
        if (prefs.data) revenueTimeline(box,timeline);
        if (rows.data.length) box.append(history);
        const settings=el('details');settings.className='clinic-panel clinic-rescue-settings';settings.open=!prefs.data;
        settings.append(el('summary',prefs.data?'Reporting settings':'Set up reporting'));
        try {
          const terms=ctx.operationsAvailable ? await ClinicOperations.reportTerms(settings,ctx,()=>load()) : [];
          if(!valid()) return;
          if (terms.some(term=>!term.accepted_at && term.effective_on>today)) settings.open=true;
          settingsForm(settings,ctx,prefs.data,()=>load(),terms.find(term=>term.kind==='initial'));
        } catch {
          if(!valid()) return;
          settings.append(el('p','Reporting terms could not be loaded.'),button('Retry reporting settings',()=>load()));
        }
        box.append(settings);host.replaceChildren(box);
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
