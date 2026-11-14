import { copyFileSync, mkdtempSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const paths = args.filter(arg => !arg.startsWith('--'));
if (paths.length > 1 || args.some(arg => arg.startsWith('--') && arg !== '--check')) {
  throw Error('Usage: node install-assistant-messenger.mjs [assistant-setup/index.html] [--check]');
}
const file = paths[0] || join(homedir(), 'Desktop/clinicnet-voice-preview/assistant-setup/index.html');
const source = readFileSync(file, 'utf8');
const marker = '// Eden Messenger owner setup handoff v1';
if (source.includes(marker)) {
  console.log('Messenger is already in the assistant setup page.');
  process.exit(0);
}

const handoff = String.raw`
// Eden Messenger owner setup handoff v1
{
  const manage = document.getElementById('screen-manage');
  const details = [...manage.querySelectorAll('h3')]
    .find(heading => heading.textContent.trim() === 'Clinic details and style')?.closest('.card');
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h3>Facebook Messenger <small>(optional)</small></h3>' +
    '<p>Use your saved clinic details for replies on Facebook. In Clinic Workspace you’ll confirm the location, connect your Page, and send a private test.</p>' +
    '<button type="button" class="btn light">Set up Messenger</button>' +
    '<p class="status" role="status"></p>';
  if (details) details.after(card);
  else document.getElementById('voiceCreate').closest('.card').before(card);

  card.querySelector('button').addEventListener('click', () => {
    const a = assistant;
    const note = card.querySelector('[role="status"]');
    if (!a?.clinic || !a?.services) {
      note.textContent = 'Save your clinic details first, then try again.';
      return;
    }
    const bookingMode = a.bookingMode === 'request' ? 'request' : 'information';
    const facts = {
      services: a.services,
      hours: a.hours || '',
      address: [a.city, a.mapsUrl].filter(Boolean).join('\n').slice(0, 900),
      bookingRules: bookingMode === 'request' ? 'Take booking requests. Clinic staff confirm the appointment time.' :
        'Answer questions. The clinic team handles appointment requests directly.',
      bookingMode,
      language: a.language || ''
    };
    const destination = new URL('https://clinicnet.live/clinic/');
    destination.hash = new URLSearchParams({
      'eden-messenger-details': JSON.stringify({ clinic: a.clinic, at: Date.now(), facts })
    }).toString();
    window.open(destination.href, '_blank', 'noopener,noreferrer');
  });
}
`;

let matches = 0;
const updated = source.replace(/<script\b[^>]*\btype=["']module["'][^>]*>[\s\S]*?<\/script>/gi, script => {
  if (!/\bfunction\s+renderManage\s*\(/.test(script) || !/\b(?:let|const)\b[^;\n]*\bassistant\b/.test(script)) return script;
  matches++;
  return script.replace(/<\/script>$/i, handoff + '</script>');
});
if (matches !== 1 || !source.includes('id="screen-manage"') || !source.includes('id="voiceCreate"')) {
  throw Error('Could not identify the assistant setup page. The source file needs review.');
}
if (args.includes('--check')) {
  console.log('Assistant setup is compatible with the Messenger step.');
} else {
  const backup = join(mkdtempSync(join(tmpdir(), 'eden-assistant-setup-')), 'index.html');
  copyFileSync(file, backup);
  const temporary = file + '.messenger-' + process.pid;
  writeFileSync(temporary, updated, { mode: statSync(file).mode });
  renameSync(temporary, file);
  console.log('Added the Messenger step. Backup: ' + backup);
}
