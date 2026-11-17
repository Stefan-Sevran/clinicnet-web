import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const previousMarker = 'Eden receptionist review flow v1';
const marker = 'Eden receptionist review flow v2';

function replace(source, pattern, replacement) {
  const matches = typeof pattern === 'string'
    ? source.split(pattern).length - 1 : [...source.matchAll(new RegExp(pattern, 'g'))].length;
  if (matches !== 1) throw Error('Unexpected receptionist version near ' + String(pattern).slice(0, 100));
  return source.replace(pattern, (...args) => typeof replacement === 'function' ? replacement(...args) : replacement);
}

const reviewStyles = `/* ${marker} */
#requestReviewStep{box-sizing:border-box;width:fit-content;max-width:calc(100% - 2rem);margin:1rem auto 1.25rem;padding:1rem 1.25rem;text-align:center;background:#ffffff70;border:1px solid #0002;border-radius:1rem}
#requestReviewStep[hidden]{display:none}
#requestReviewStep #reviewRequest:not([hidden]){margin:.75rem auto 0}
#requestReviewStep #reviewRequestNote{margin:0;color:inherit}
#requestReviewStep #reviewRequestNote[hidden]{display:none}
`;

const formHelpers = String.raw`  const visitorContacts = new Set();
  let selectedContact = '';

  function contactChoices(text) {
    const addresses = text.match(/[\w.!#$%&'*+/=?^\x60|{}~-]+@[\w-]+(?:\.[\w-]+)+/g) || [];
    const numbers = text.match(/\+[1-9](?:[ ()-]?\d){7,14}(?!\d)/g) || [];
    return [...addresses, ...numbers].sort((a, b) => text.indexOf(a) - text.indexOf(b)).map(contactValue).filter(Boolean);
  }

  function rememberTypedContact(text) {
    const choices = contactChoices(text);
    for (const choice of choices) visitorContacts.add(choice);
    if (/^(?:actually[, ]+)?(?:(?:please\s+)?(?:use|prefer)\s+|(?:the|my)\s+)/i.test(text)) {
      const byPhone = /\b(?:phone|mobile|number)\b/i.test(text);
      const byEmail = /\be-?mail\b/i.test(text);
      if (choices.length === 1) selectedContact = choices[0];
      else if (byPhone !== byEmail) {
        const matching = [...visitorContacts].filter(value => value.startsWith('+') === byPhone);
        selectedContact = matching.at(-1) || selectedContact;
      }
    }
  }

  function oneContact(text) {
    if (selectedContact) return selectedContact;
    const single = contactValue(text);
    if (single) return visitorContacts.has(single) ? visitorContacts.values().next().value : single;
    const choices = contactChoices(text);
    return [...visitorContacts].find(value => choices.some(choice =>
      choice.replace(/[ ()-]/g, '') === value.replace(/[ ()-]/g, ''))) || choices[0] || '';
  }

  function calendarPreference(text, today = new Date()) {
    // Only normalize a written calendar date and an exact clock time.
    // Relative dates and flexible preferences remain as the visitor described them.
    const match = /^(?:(?:sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?),?\s+)?(?:(\d{1,2})\s+([a-z]+)|([a-z]+)\s+(\d{1,2}))(?:,?\s+(\d{4}))?\s+(?:at\s+)?(\d{1,2}(?::\d{2})?(?:\s*[ap]\.?m\.?)?|noon)$/i.exec(text);
    if (!match) return text;
    const [, firstDay, secondMonth, firstMonth, secondDay, typedYear, typedTime] = match;
    const clock = /^(0?[1-9]|1[0-2])(?::([0-5]\d))?\s*([ap])\.?m\.?$/i.exec(typedTime);
    const military = /^(\d|[01]\d|2[0-3]):([0-5]\d)$/.exec(typedTime);
    if (!clock && !military && !/^noon$/i.test(typedTime)) return text;
    const month = 'january february march april may june july august september october november december'
      .split(' ').findIndex(name => name === (firstMonth || secondMonth).toLowerCase() ||
        name.slice(0,3) === (firstMonth || secondMonth).toLowerCase());
    if (month === -1) return text;
    const day = Number(firstDay || secondDay);
    const year = Number(typedYear || today.getFullYear());
    const date = new Date(Date.UTC(year, month, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return text;
    const todayUtc = Date.UTC(today.getFullYear(),today.getMonth(),today.getDate());
    const distance = date.getTime() - todayUtc;
    const label = new Intl.DateTimeFormat('en-US',{
      timeZone:'UTC', weekday:'long', month:'long', day:'numeric', year:'numeric'
    });
    if (!typedYear && (distance < 0 || distance > 90 * 86400000)) {
      return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'long',day:'numeric'}).format(date) + ' at ' + typedTime;
    }
    const hour = clock ? Number(clock[1]) % 12 + (clock[3].toLowerCase() === 'p' ? 12 : 0) :
      military ? Number(military[1]) : 12;
    const minute = clock ? Number(clock[2] || 0) : military ? Number(military[2]) : 0;
    return label.format(date) + ' at ' + (hour % 12 || 12) + ':' + String(minute).padStart(2,'0') + (hour < 12 ? ' AM' : ' PM');
  }

`;

function updateClient(source) {
  const patch = (from, to) => { source = replace(source, from, to); };
  patch("const form = get('request'), reviewButton", "const form = get('request'), reviewStep = get('requestReviewStep'), reviewButton");
  patch("  function showReview() {\n    if (!takesRequests) return;\n    reviewButton.hidden = false;\n    reviewNote.hidden = !draft;\n  }",
    formHelpers + `  function showReview() {
    const visible = takesRequests && Boolean(draft || reviewOffered);
    reviewStep.hidden = reviewButton.hidden = reviewNote.hidden = !visible;
    const instruction = draft
      ? 'Select Review request, then select Send request on the form.'
      : 'Open the request form, complete your details, then select Send request.';
    if (reviewNote.textContent !== instruction) reviewNote.textContent = instruction;
    reviewButton.textContent = draft ? 'Review request' : 'Open request form';
  }`);
  patch("preferredTime:timeParts.join(', ').replace(/[.!?]$/, ''), contact:contactValue(contactPart[1])",
    "preferredTime:calendarPreference(timeParts.join(', ').replace(/[.!?]$/, '')), contact:oneContact(contactPart[1])");
  patch("    draft = details;\n    reviewNote.hidden = !draft;\n    reviewButton.hidden = !(draft || reviewOffered);",
    "    draft = details;\n    showReview();");
  patch("    if (speaker === 'assistant') offerReview(text);", "    if (speaker === 'visitor (text)') rememberTypedContact(text);\n    if (speaker === 'assistant') offerReview(text);");
  patch(/      'On this page, send_booking_request only prepares a form draft\.[^\n]+;/,
    `      'The page uses send_booking_request to prepare an editable draft. As soon as an appointment request has a name, one valid email OR international phone, a service and a time preference, prepare the draft immediately. One valid contact is enough. Keep the first valid contact unless the visitor chooses another. Put one contact only in the tool. A visitor who supplies their details and asks to book, says “all good”, or says “yes” wants to proceed. Pass their latest relevant words as consentQuote for draft preparation. The form obtains consent to send. Once reviewReady or draft_ready is returned, say once: “Select Review request below, then select Send request on the form.” Avoid another permission question or a second recap. The tool prepares a draft locally. Treat clinic receipt as confirmed only when the form reports submission. ' +
      'Calendar reference (visitor browser date, for the current year): ' + new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}) + '. For a date the visitor gives without a weekday, keep the date and time and omit the weekday in chat. When the visitor gives a conflicting weekday and date, ask which they mean.';`);
  patch("    if (!takesRequests || active !== run || !run.receivedInput || typeof details?.consentQuote !== 'string' || details.consentQuote.trim().length < 2) {\n      return {ok:false, error:'Recap the details and ask if the visitor wants to review them on the page.'};\n    }",
    "    if (!takesRequests || active !== run || !run.receivedInput) {\n      return {status:'unavailable', message:'Use the visible request form if the visitor needs to contact the clinic.'};\n    }");
  patch("const value = key === 'contact' ? contactValue(raw) : raw;", "const value = key === 'contact' ? oneContact(raw) : key === 'preferredTime' ? calendarPreference(raw) : raw;");
  patch("    return {ok:false, reviewReady:true, message:'The draft is ready. Ask the visitor to select Review request, check their details, give consent, and press Send request.'};",
    "    if (run.mode === 'text' && !run.reviewReply) run.reviewReply = 'pending';\n    return {status:'draft_ready', reviewReady:true, message:'The draft is ready. Tell the visitor once: Select Review request below, then select Send request on the form.'};");
  patch("          addTurn('assistant', entry.message);",
    `          if (run.reviewReply === 'shown') return;
          if (run.reviewReply === 'pending') {
            run.reviewReply = 'shown';
            addTurn('assistant', 'Your request is ready to review. Select Review request below, then select Send request on the form.');
          } else {
            addTurn('assistant', entry.message);
          }`);
  patch("      run.receivedInput = true;\n      addTurn('visitor (text)', text);",
    "      run.receivedInput = true;\n      run.reviewReply = false;\n      addTurn('visitor (text)', text);");
  patch("      recap = recapDraft = null;\n      reviewedDraft = null;",
    "      recap = recapDraft = null;\n      reviewedDraft = null;\n      visitorContacts.clear();\n      selectedContact = '';");
  return source;
}

function preventRepeatedReview(source) {
  const patch = (from, to) => { source = replace(source, from, to); };
  patch("  let selectedContact = '';",
    "  let selectedContact = '', awaitingReview = false;");
  patch("    if (run.mode === 'text' && !run.reviewReply) run.reviewReply = 'pending';",
    "    if (run.mode === 'text') {\n      awaitingReview = true;\n      if (!run.reviewReply) run.reviewReply = 'pending';\n    }");
  patch("'Select Review request, then select Send request on the form.'",
    "'After reviewing, select Send request on the form.'");
  patch("'Your request is ready to review. Select Review request below, then select Send request on the form.'",
    "'Your details are ready. Select Review request below.'");
  patch("  async function sendText() {\n    const text = chatText.value.trim();\n    if (!text || switching || requestPending) return;",
    `  async function sendText() {
    const text = chatText.value.trim();
    if (!text || switching || requestPending) return;
    const acknowledgement = text.toLowerCase().replace(/[,!.]+/g, ' ').replace(/\\s+/g, ' ').trim();
    if (draft && awaitingReview &&
        /^(?:yes|yep|ok(?:ay)?|all good|looks good|sounds good|please do|go ahead|sure)(?: (?:please|thanks|thank you))?$/.test(acknowledgement)) {
      addTurn('visitor (text)', text);
      chatText.value = '';
      reviewButton.focus();
      return;
    }
    awaitingReview = false;`);
  return source;
}

function updateWorker(source) {
  if (source.includes(marker)) return source;
  const alreadyInstalled = source.includes(previousMarker);
  if (alreadyInstalled) {
    source = replace(source, previousMarker, marker);
  } else {
    source = replace(source, '#reviewRequest:not([hidden]){margin:.65rem auto 0;display:block}',
      '#reviewRequest:not([hidden]){display:block}\n' + reviewStyles);
    source = replace(source, /(<button id="reviewRequest"[^>]*>)[^<]*(<\/button>)(<p id="reviewRequestNote"[^>]*>)[^<]*(<\/p>)/,
      (_, button, closeButton, note, closeNote) => '<div id="requestReviewStep" hidden>' +
        note + 'Review your details, then select Send request.' + closeNote +
        button.replace('aria-controls="request"', 'aria-controls="request" aria-describedby="reviewRequestNote"') +
        'Review request' + closeButton + '</div>');
  }
  return replace(source, /const receptionistClient\s*=\s*("(?:\\.|[^"\\])*");/, (_, encoded) => {
    const original = JSON.parse(encoded);
    const client = preventRepeatedReview(alreadyInstalled ? original : updateClient(original));
    checkModule(client);
    return 'const receptionistClient = ' + JSON.stringify(client) + ';';
  });
}

function checkModule(source) {
  execFileSync(process.execPath, ['--input-type=module', '--check'], {
    input: source, stdio: ['pipe', 'inherit', 'inherit']
  });
}

const { values: { check }, positionals: [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview'), ...rest] } =
  parseArgs({ allowPositionals:true, options:{check:{type:'boolean'}} });
if (rest.length) throw Error('Pass one voice preview folder and optionally --check.');

const file = join(root,'assistant-core.js');
const before = readFileSync(file,'utf8');
const after = updateWorker(before);
checkModule(after);
if (check || before === after) {
  console.log('Receptionist review flow check passed. ' + (before === after ? 'Already installed.' : 'One file would change.'));
} else {
  if (readFileSync(file,'utf8') !== before) throw Error('Setup changed while preparing the update. Run the installer again.');
  const backup = mkdtempSync(join(tmpdir(),'eden-receptionist-review-'));
  writeFileSync(join(backup,'assistant-core.js'),before);
  const temporary = file + '.eden-' + process.pid;
  try {
    writeFileSync(temporary,after,{flag:'wx'});
    renameSync(temporary,file);
  } finally {
    rmSync(temporary,{force:true});
  }
  console.log('Receptionist review flow installed. Backup: ' + backup);
}
