/* Location-scoped Eden support and reporting terms. */
const ClinicOperations = (() => {
  const el = (tag,text = '') => Object.assign(document.createElement(tag),{textContent:text});
  const status = () => Object.assign(el('p'),{role:'status'});
  const field = (form,name,input) => {
    const label = el('label',name);
    input.setAttribute('aria-label',name);
    label.append(input);
    form.append(label);
    return input;
  };
  const select = options => {
    const input = el('select');
    for (const [value,label] of options) input.add(new Option(label,value));
    return input;
  };
  const button = (label,type='button') => Object.assign(el('button',label),{type});
  const form = () => Object.assign(el('form'),{className:'clinic-form clinic-ops-form'});
  const time = value => new Date(value).toLocaleString();
  const scopes={read:'Read only',messenger_facts:'Propose Messenger changes',website_chat:'Propose Website Chat changes',
    ai_phone:'Propose AI Phone changes',staff_alert:'Propose staff alert email'};
  const scopeName = scope => scopes[scope] || 'Support access';
  const targets={read:'Connection status and Messenger facts',messenger_facts:'Messenger',website_chat:'Website Chat',
    ai_phone:'AI Phone',staff_alert:'Staff alerts'};
  const factLabels = {services:'Services',hours:'Opening hours',address:'Address and directions',bookingRules:'Booking instructions',
    common_answers:'Common answers',handoff:'Staff handoff and after-hours instructions',alert_email:'Staff alert email'};
  const messengerFields=['services','hours','address','bookingRules'];
  const draftFields=['services','hours','address','common_answers','bookingRules','handoff'];
  const isDraft=target=>['website_chat','ai_phone','staff_alert'].includes(target);
  const notificationTitle=item=>item.kind==='access'?'Eden requested support access':'Eden changes ready for review';
  const targetLabel=target=>targets[target] || 'Eden support';
  const channelLabels = {website_chat:'Website Chat',facebook_messenger:'Messenger',ai_phone:'AI Phone'};
  const connectionLabels = {connected:'Connected',verifying:'Verification pending',requested:'Setup requested',
    disconnected:'Disconnected',action_required:'Needs attention'};
  const describeTerm = term => term.kind==='free_week' ? '7 days at 0% from '+term.effective_on :
    (term.kind==='initial'?'Pilot starts ':'New rate from ')+term.effective_on+' · Eden share '+term.rate_bps/100+'%';

  async function rpc(client,name,args) {
    const {data,error} = await client.rpc(name,args);
    if (error) throw Error(error.message || 'Request could not be completed.');
    return data;
  }

  function action(control,note,run) {
    control.disabled = true;
    return Promise.resolve().then(run).catch(error=>{ note.textContent=error.message; })
      .finally(()=>{ control.disabled=false; });
  }

  async function operators(client,host) {
    const [grants,finance] = await Promise.all([
      rpc(client,'eden_support_locations'),rpc(client,'eden_finance_locations')
    ]);
    const requestable=await rpc(client,'eden_support_request_locations').catch(()=>[]);
    if (!grants?.length && !finance?.length && !requestable?.length) return false;
    if (requestable?.length) {
      const panel=el('details');
      panel.append(el('summary','Request clinic access'));
      const editor=form(),note=status();
      const location=field(editor,'Business account and location',select(requestable.map(row=>
        [row.location_id,row.account_name+' · '+row.location_name])));
      const scope=field(editor,'Support area',select(Object.entries(scopes)));
      const send=button('Request 1 hour of access','submit');
      editor.append(send,note);
      editor.onsubmit=event=>{
        event.preventDefault();
        void action(send,note,async()=>{
          await rpc(client,'eden_request_support',{p_location:location.value,p_scope:scope.value});
          note.textContent='Sent to the clinic owner’s alerts.';
        });
      };
      panel.append(editor);
      host.append(panel);
    }
    if (grants?.length) {
      const panel=el('details');
      panel.append(el('summary','Switch location · Eden support'));
      const picker=field(panel,'Business account and location',select([['','Select an approved location'],
        ...grants.map(g=>[g.grant_id,g.account_name+' · '+g.location_name+' · '+scopeName(g.scope)])]));
      const content=el('div');
      panel.append(content);
      picker.onchange=async () => {
        const grant=grants.find(g=>g.grant_id===picker.value);
        content.replaceChildren();
        if (!grant) return;
        const note=status();
        note.textContent='Opening approved access…';
        const diagnostics=el('section');
        content.append(note,diagnostics);
        void rpc(client,'eden_support_diagnostics',{p_grant:grant.grant_id}).then(rows=>{
          const list=el('ul');
          for (const [channel,label] of Object.entries(channelLabels)) {
            const row=rows.find(connection=>connection.channel===channel);
            const state=row ? connectionLabels[row.status] || 'Status unavailable' : 'Not set up';
            list.append(el('li',label+' · '+state+(row?.updated_at?' · Updated '+time(row.updated_at):'')));
          }
          diagnostics.append(el('h3','Connection status'),list);
        }).catch(()=>{ diagnostics.append(el('p','Connection status is unavailable.')); });
        try {
          const draft=isDraft(grant.scope);
          const expected=await rpc(client,draft?'eden_support_draft_context':'eden_support_messenger_facts',{p_grant:grant.grant_id});
          if (picker.value!==grant.grant_id || !note.isConnected) return;
          note.textContent=scopeName(grant.scope)+' · Ends '+time(grant.expires_at);
          if (grant.scope==='read') {
            const facts=el('dl');
            facts.className='clinic-ops-values';
            for (const key of messengerFields) {
              facts.append(el('dt',factLabels[key]),el('dd',expected[key] ?? 'Not set'));
            }
            content.append(el('h3','Messenger facts'),facts);
          } else {
            const editor=form(), inputs={};
            editor.classList.add('clinic-approved-facts-form');
            editor.append(el('h3',draft?targetLabel(grant.scope)+' draft':'Messenger facts'),
              el('p',draft?'Fill only the fields you want to propose. The owner reviews and applies the draft in the relevant settings.':
                'The clinic owner reviews your proposal before it goes live. Use clinic information meant for patients.'));
            const fields=grant.scope==='staff_alert'?['alert_email']:draft?draftFields:messengerFields;
            for (const key of fields) {
              const input=key==='alert_email'?Object.assign(el('input'),{type:'email',required:true,maxLength:254}):
                Object.assign(el('textarea'),{maxLength:900});
              input.value=expected[key] ?? '';
              inputs[key]=field(editor,factLabels[key],input);
            }
            const save=button('Send for owner approval','submit');
            const result=status();
            editor.append(save,result);
            editor.onsubmit=event=>{
              event.preventDefault();
              if (save.disabled) return;
              const p_changes=Object.fromEntries(Object.entries(inputs).flatMap(([key,input])=>
                input.value.trim()!==(expected[key] ?? '').trim() ? [[key,input.value.trim()]] : []));
              if (!Object.keys(p_changes).length) {
                result.textContent='Change at least one field before sending.';
                return;
              }
              void action(save,result,async()=>{
                if (draft) await rpc(client,'eden_propose_support_draft',{p_grant:grant.grant_id,p_draft:p_changes,p_expected:expected});
                else await rpc(client,'eden_propose_support_change',{p_grant:grant.grant_id,p_changes,p_expected:expected});
                result.textContent='Sent for owner approval.';
              });
            };
            content.append(editor);
          }
        } catch (error) { note.textContent=error.message; }
      };
      host.append(panel);
    }
    if (finance?.length) {
      const panel=el('details');
      panel.append(el('summary','Eden finance'));
      const editor=form();
      const location=field(editor,'Business account and location',select(finance.map(row=>[row.location_id,row.account_name+' · '+row.location_name])));
      const kind=field(editor,'Terms',select([['initial','Start a pilot'],['rate','Change the Eden share'],['free_week','Add a free week']]));
      const date=field(editor,'Effective date',Object.assign(el('input'),{type:'date',required:true}));
      const rate=field(editor,'Eden share (%)',Object.assign(el('input'),{type:'number',required:true,min:0,max:100,step:.01}));
      kind.onchange=()=>{rate.disabled=kind.value==='free_week';rate.parentElement.hidden=rate.disabled;};
      const send=button('Send terms for clinic approval','submit');
      const note=status();
      const history=el('ul');
      async function load() {
        const p_location=location.value;
        history.replaceChildren();
        const terms=await rpc(client,'eden_review_rescue_terms',{p_location});
        if (location.value!==p_location) return;
        history.replaceChildren(...terms.map(term=>el('li',describeTerm(term)+(term.accepted_at?' · Confirmed':' · Awaiting clinic approval'))));
      }
      location.onchange=()=>void load().catch(error=>{note.textContent=error.message;});
      panel.addEventListener('toggle',()=>{if (panel.open) location.onchange();});
      editor.onsubmit=event=>{
        event.preventDefault();
        void action(send,note,async()=>{
          await rpc(client,'eden_propose_rescue_terms',{p_location:location.value,p_kind:kind.value,p_effective_on:date.value,
            p_rate_bps:rate.disabled?null:Math.round(rate.valueAsNumber*100)});
          note.textContent='Sent for clinic approval.';
          await load();
        });
      };
      editor.append(send,note);
      panel.append(editor,history);
      host.append(panel);
    }
    return true;
  }

  function comparison(before,after) {
    const oldText=before ?? '';
    const newText=after ?? '';
    let start=0, end=0;
    while (start<oldText.length && start<newText.length && oldText[start]===newText[start]) start++;
    while (end<oldText.length-start && end<newText.length-start &&
      oldText[oldText.length-1-end]===newText[newText.length-1-end]) end++;
    const full=el('details');
    full.className='clinic-ops-full-comparison';
    full.append(el('summary','Show full comparison'));
    const compact=el('div');
    compact.className='clinic-ops-comparison';
    const complete=el('div');
    complete.className='clinic-ops-comparison';
    for (const [text,label] of [[oldText,'Before'],[newText,'Proposed']]) {
      const finish=text.length-end;
      const changed=text.slice(start,finish);
      const snippet=el('p');
      const prefix=text.slice(Math.max(0,start-42),start);
      const suffix=text.slice(finish,finish+42);
      const excerpt=changed.length>160?changed.slice(0,90)+' … '+changed.slice(-55):changed;
      snippet.append((start>42?'…':'')+prefix,el('mark',excerpt || (text?'∅':'Not set')),suffix+(end>42?'…':''));
      const cell=el('div'), original=el('div');
      cell.append(el('strong',label),snippet);
      original.append(el('strong',label),el('p',text || 'Not set'));
      compact.append(cell);
      complete.append(original);
    }
    full.append(complete);
    return {compact,full};
  }

  function owner(client,p_location,onFactsChanged=()=>{},openDestination=()=>{}) {
    const panel=el('details');
    panel.className='clinic-panel';
    panel.append(el('summary','Eden support access'));
    const editor=form();
    const email=field(editor,'Eden specialist’s work email',Object.assign(el('input'),{type:'email',required:true}));
    const scope=field(editor,'Access',select(Object.entries(scopes).slice(0,2)));
    const hours=field(editor,'Expires in',select([['1','1 hour'],['4','4 hours'],['24','24 hours']]));
    const grant=button('Approve support access','submit');
    const note=status(), list=el('ul');
    const reviews=el('div');
    let focusedId, loadVersion=0, skipOpenToggle=false;
    editor.append(grant);
    panel.append(el('p','Review Eden’s access requests and proposed changes for this location.'),note,reviews,editor,list);

    async function loadReviews() {
      const version=++loadVersion;
      let changes;
      try {
        changes=await rpc(client,'eden_support_inbox',{p_location});
        if (!Array.isArray(changes)) throw Error('Support inbox unavailable');
        if (scope.options.length===2) for (const [value,label] of Object.entries(scopes).slice(2)) scope.add(new Option(label,value));
      } catch {
        try { changes=await rpc(client,'eden_support_changes',{p_location}); }
        catch { if (version===loadVersion) reviews.replaceChildren(el('p','Support changes could not be loaded.')); return; }
      }
      if (version!==loadVersion) return;
      const cards=changes.map(change=>{
        const target=change.target || 'messenger_facts';
        const access=change.kind==='access';
        const draft=!access && isDraft(target);
        const decisionLabels={pending:'Needs review',approved:draft?'Approved draft':'Approved',dismissed:'Dismissed',undone:'Undone'};
        const card=el('details'), summary=el('summary');
        card.id='eden-review-'+change.id;
        card.className='clinic-ops-review';
        card.open=change.decision==='pending'||change.id===focusedId;
        summary.append(el('strong',access?'Access request':targetLabel(target)+' changes'),
          el('span',decisionLabels[change.decision]));
        card.append(summary,el('p',change.operator_email+' · '+time(change.created_at || change.proposed_at)));
        const controls=el('div');
        controls.className='clinic-ops-review-actions';
        const actions=change.decision==='pending' ? [
          ['approve',access?'Approve for 1 hour':draft?'Approve draft':'Approve changes',
            access?'Support access approved.':draft?'Draft approved. Apply it from the relevant settings.':'Messenger facts updated.'],
          ['dismiss','Dismiss',access?'Access request dismissed.':'Proposal dismissed.']
        ] : change.decision==='approved' && !access && !draft ? [['undo','Undo changes','Previous Messenger facts restored.']] : [];
        for (const [decision,label,done] of actions) {
          const control=button(label);
          if (decision!=='approve') control.className='clinic-secondary';
          control.onclick=()=>void action(control,note,async()=>{
            if (access) await rpc(client,'eden_review_support_request',{p_location,p_request:change.id,p_approve:decision==='approve'});
            else if (draft) await rpc(client,'eden_review_support_draft',{p_location,p_change:change.id,p_approve:decision==='approve'});
            else {
              const facts=await rpc(client,'eden_review_support_change',{p_location,p_change:change.id,p_action:decision});
              if (facts) onFactsChanged(facts);
            }
            note.textContent=done;
            focusedId=change.id;
            await reload();
            panel.dispatchEvent(new Event('eden-support-reviewed',{bubbles:true}));
            [...reviews.querySelectorAll('.clinic-ops-review')].find(card=>card.id==='eden-review-'+change.id)?.querySelector('summary')?.focus();
          });
          controls.append(control);
        }
        const comparisons=el('div');
        const fields=el('div');
        fields.className='clinic-ops-review-fields';
        if (access) {
          card.append(el('p',scopeName(target)));
        } else {
          if (draft) card.append(el('p',target==='staff_alert'?
            'Confirm the new address with your team before saving it under Staff alerts.':
            'Apply the approved wording in the channel’s own setup. This draft does not publish it.'));
          for (const [key,proposed] of Object.entries(change.proposed_values)) {
            fields.append(el('h4',factLabels[key] || key));
            if (Object.hasOwn(change.before_values,key)) {
              const parts=comparison(change.before_values[key],proposed);
              fields.append(parts.compact);
              comparisons.append(parts.full);
            } else {
              const copy=el('p',proposed);
              copy.className='clinic-ops-draft-text';
              fields.append(copy);
            }
          }
        }
        if (draft && change.decision==='approved') {
          const copy=button('Copy approved draft');
          copy.onclick=()=>void action(copy,note,async()=>{
            const draftText=target==='staff_alert'?change.proposed_values.alert_email:
              Object.entries(change.proposed_values).map(([key,value])=>(factLabels[key] || key)+'\n'+value).join('\n\n');
            await navigator.clipboard.writeText(draftText);
            note.textContent='Draft copied.';
          });
          const open=button(target==='website_chat'?'Open Website Chat editor':target==='ai_phone'?'Open AI Phone setup':'Go to Staff alerts');
          open.className='clinic-secondary';
          open.onclick=()=>openDestination(target);
          controls.append(copy,open);
        }
        if (controls.childElementCount) card.append(controls);
        card.append(fields,comparisons);
        return card;
      });
      reviews.replaceChildren(...(cards.length ? [el('h3','Support requests and changes'),...cards] : []));
    }

    panel.openReview=async id=>{
      focusedId=id;
      if (!panel.open) {
        skipOpenToggle=true;
        panel.open=true;
      }
      try {
        await reload();
        const heading=document.getElementById('eden-review-'+id)?.querySelector('summary');
        (heading || panel.querySelector('summary')).focus();
      } catch (error) { note.textContent=error.message; }
    };
    async function reload() {
      await Promise.all([loadActivity(),loadReviews()]);
    }
    async function loadActivity() {
      const rows=await rpc(client,'eden_support_activity',{p_location});
      const rendered=new Set();
      list.replaceChildren(...rows.map(row=>{
        const labels={granted:'Access approved',opened:'Messenger facts viewed',messenger_facts_changed:'Messenger facts changed',revoked:'Access revoked'};
        const item=el('li',labels[row.action]+' · '+row.operator_email+' · '+time(row.occurred_at));
        if (row.changed_fields?.length) item.append(el('small',' Changed: '+row.changed_fields.join(', ')));
        if (!rendered.has(row.grant_id) && !row.revoked_at && new Date(row.expires_at)>new Date()) {
          const revoke=button('Revoke access');
          revoke.onclick=()=>void action(revoke,note,async()=>{
            await rpc(client,'eden_revoke_support',{p_grant:row.grant_id});
            await reload();
            note.textContent='Access revoked.';
          });
          item.append(' · '+scopeName(row.scope)+' until '+time(row.expires_at)+' ',revoke);
        }
        rendered.add(row.grant_id);
        return item;
      }));
    }
    panel.ontoggle=()=>{
      if (panel.open && !skipOpenToggle) void reload().catch(error=>{note.textContent=error.message;});
      skipOpenToggle=false;
    };
    editor.onsubmit=event=>{
      event.preventDefault();
      void action(grant,note,async()=>{
        await rpc(client,'eden_grant_support',{p_location,p_operator_email:email.value,p_scope:scope.value,p_hours:Number(hours.value)});
        note.textContent='Support access approved.';
        await reload();
      });
    };
    return panel;
  }

  async function reportTerms(parent,ctx,reload) {
    const data=await rpc(ctx.client,'eden_review_rescue_terms',{p_location:ctx.locationId});
    if (!data?.length) return [];
    const list=el('ul'), note=status();
    for (const term of data) {
      const row=el('li',describeTerm(term));
      if (term.accepted_at) row.append(' · Confirmed');
      else if (ctx.owner) {
        const confirm=button('Confirm terms');
        confirm.onclick=()=>void action(confirm,note,async()=>{
          await rpc(ctx.client,'eden_accept_rescue_terms',{p_location:ctx.locationId,p_terms:term.id});
          await reload();
        });
        row.append(' ',confirm);
      } else row.append(' · Awaiting clinic owner approval');
      list.append(row);
    }
    parent.append(el('h3','Terms from Eden'),list,note);
    return data;
  }
  return {operators,owner,reportTerms,notificationTitle,targetLabel};
})();
