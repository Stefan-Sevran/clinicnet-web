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
  const scopeName = scope => scope==='read'?'Read only':'Propose Messenger changes';
  const factLabels = {services:'Services',hours:'Opening hours',address:'Address',bookingRules:'Booking instructions'};
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
    if (!grants?.length && !finance?.length) return false;
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
          const expected=await rpc(client,'eden_support_messenger_facts',{p_grant:grant.grant_id});
          if (picker.value!==grant.grant_id || !note.isConnected) return;
          note.textContent=scopeName(grant.scope)+' · Ends '+time(grant.expires_at);
          if (grant.scope==='read') {
            const facts=el('dl');
            facts.className='clinic-ops-values';
            for (const [key,label] of Object.entries(factLabels)) {
              facts.append(el('dt',label),el('dd',expected[key] ?? 'Not set'));
            }
            content.append(el('h3','Messenger facts'),facts);
          } else {
            const editor=form(), inputs={};
            editor.classList.add('clinic-approved-facts-form');
            editor.append(el('h3','Messenger facts'),el('p','The clinic owner reviews your proposal before it goes live. Use clinic information meant for patients.'));
            for (const [key,label] of Object.entries(factLabels)) {
              inputs[key]=field(editor,label,Object.assign(el('textarea'),{value:expected[key] ?? '',maxLength:900}));
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
                result.textContent='Change at least one Messenger fact before sending.';
                return;
              }
              void action(save,result,async()=>{
                await rpc(client,'eden_propose_support_change',{p_grant:grant.grant_id,p_changes,p_expected:expected});
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

  function owner(client,p_location,onFactsChanged=()=>{}) {
    const panel=el('details');
    panel.className='clinic-panel';
    panel.append(el('summary','Eden support access'));
    const editor=form();
    const email=field(editor,'Eden specialist’s work email',Object.assign(el('input'),{type:'email',required:true}));
    const scope=field(editor,'Access',select([['read','Read only'],['messenger_facts','Propose Messenger changes']]));
    const hours=field(editor,'Expires in',select([['1','1 hour'],['4','4 hours'],['24','24 hours']]));
    const grant=button('Approve support access','submit');
    const note=status(), list=el('ul');
    const reviews=el('div');
    editor.append(grant);
    panel.append(el('p','Give Eden temporary access to this location’s connection status and Messenger facts. Review proposed changes or revoke access here.'),note,reviews,editor,list);
    async function loadReviews() {
      let changes;
      try { changes=await rpc(client,'eden_support_changes',{p_location}); }
      catch { reviews.replaceChildren(el('p','Support changes could not be loaded.')); return; }
      const cards=changes.map(change=>{
        const decisionLabels={pending:'Needs review',approved:'Approved',dismissed:'Dismissed',undone:'Undone'};
        const card=el('details');
        card.className='clinic-ops-review';
        card.open=change.decision==='pending';
        card.append(el('summary',decisionLabels[change.decision]+' · '+change.operator_email+' · '+time(change.proposed_at)));
        const values=el('dl');
        values.className='clinic-ops-values';
        for (const [key,proposed] of Object.entries(change.proposed_values)) {
          const before=el('dd');
          before.append(el('strong','Before '),el('span',change.before_values[key] ?? 'Not set'));
          const after=el('dd');
          after.append(el('strong','Proposed '),el('span',proposed));
          values.append(el('dt',factLabels[key]),before,after);
        }
        card.append(values);
        const controls=el('div');
        controls.className='clinic-ops-review-actions';
        for (const [decision,label,done] of change.decision==='pending'
          ? [['approve','Approve changes','Messenger facts updated.'],['dismiss','Dismiss','Proposal dismissed.']]
          : change.decision==='approved' ? [['undo','Undo changes','Previous Messenger facts restored.']] : []) {
          const control=button(label);
          if (decision!=='approve') control.className='clinic-secondary';
          control.onclick=()=>void action(control,note,async()=>{
            const facts=await rpc(client,'eden_review_support_change',{p_location,p_change:change.id,p_action:decision});
            if (facts) onFactsChanged(facts);
            note.textContent=done;
            await reload();
          });
          controls.append(control);
        }
        if (controls.childElementCount) card.append(controls);
        return card;
      });
      reviews.replaceChildren(...(cards.length ? [el('h3','Support changes'),...cards] : []));
    }
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
    panel.ontoggle=()=>{if (panel.open) void reload().catch(error=>{note.textContent=error.message;});};
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
  return {operators,owner,reportTerms};
})();
