/* Location-scoped Eden support and reporting terms. */
const ClinicOperations = (() => {
  const el = (tag,text = '') => Object.assign(document.createElement(tag),{textContent:text});
  const status = () => Object.assign(el('p'),{role:'status'});
  const field = (form,name,input) => {
    const label = el('label',name);
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
  const scopeName = scope => scope==='read'?'Read only':'Edit Messenger facts';
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
        content.append(note);
        try {
          let expected=await rpc(client,'eden_support_messenger_facts',{p_grant:grant.grant_id});
          if (picker.value!==grant.grant_id || !note.isConnected) return;
          note.textContent=scopeName(grant.scope)+' · Ends '+time(grant.expires_at);
          const editor=form(), inputs={};
          for (const [key,label] of Object.entries({services:'Services',hours:'Opening hours',address:'Address',bookingRules:'Booking instructions'})) {
            inputs[key]=field(editor,label,Object.assign(el('textarea'),{
              value:expected[key] ?? '',maxLength:900,required:true,readOnly:grant.scope==='read'
            }));
          }
          if (grant.scope==='messenger_facts') {
            const save=button('Save Messenger facts','submit');
            const result=status();
            editor.append(save,result);
            editor.onsubmit=event=>{
              event.preventDefault();
              void action(save,result,async()=>{
                const p_facts=Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value.trim()]));
                expected=await rpc(client,'eden_support_messenger_facts',{p_grant:grant.grant_id,p_facts,p_expected:expected});
                result.textContent='Messenger facts saved and recorded in the support log.';
              });
            };
          }
          content.append(editor);
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

  function owner(client,p_location) {
    const panel=el('details');
    panel.className='clinic-panel';
    panel.append(el('summary','Eden support access'));
    const editor=form();
    const email=field(editor,'Eden specialist’s work email',Object.assign(el('input'),{type:'email',required:true}));
    const scope=field(editor,'Access',select([['read','Read only'],['messenger_facts','Edit Messenger facts']]));
    const hours=field(editor,'Expires in',select([['1','1 hour'],['4','4 hours'],['24','24 hours']]));
    const grant=button('Approve support access','submit');
    const note=status(), list=el('ul');
    editor.append(grant,note);
    panel.append(el('p','Approve temporary access to the selected location’s Messenger facts.'),editor,list);
    async function reload() {
      const rows=await rpc(client,'eden_support_activity',{p_location});
      const rendered=new Set();
      list.replaceChildren(...rows.map(row=>{
        const labels={granted:'Access approved',opened:'Messenger facts viewed',messenger_facts_changed:'Messenger facts updated',revoked:'Access revoked'};
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
