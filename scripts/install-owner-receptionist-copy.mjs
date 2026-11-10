import { copyFileSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const check = args.includes('--check');
const root = args.find(arg => arg !== '--check') || join(homedir(), 'Desktop', 'clinicnet-voice-preview');
const file = join(root, 'assistant-setup', 'index.html');
const marker = 'Eden owner receptionist copy v1';
const before = readFileSync(file, 'utf8');

function update(source) {
  if (source.includes(marker)) return source;
  if (!source.includes('Eden owner Eve modes v1')) {
    throw Error('Install the owner Eve modes update before applying these changes.');
  }

  function replace(from, to, expected = 1) {
    if (source.split(from).length - 1 !== expected) {
      throw Error('The owner setup page has changed near: ' + from.split('\n')[0]);
    }
    source = source.replaceAll(from, () => to);
  }

  replace('<h3>Talk to your assistant</h3>', '<h3>Talk to your AI receptionist</h3><!-- ' + marker + ' -->');
  replace('Practice a patient booking or give Eve', 'Test a patient booking or give Eve');
  replace('>Practice a booking</button>', '>Test a booking</button>');
  replace('Try a private practice booking. No request is sent.', 'Try a private test booking. No request is sent.', 2);
  replace('Start voice test', 'Start voice test booking', 2);
  replace('End voice test', 'End voice test booking');
  replace('Start voice interview', 'Start clinic setup');
  replace('Type during your practice call…', '(Optional) Type during your test booking...', 2);
  replace('Type clinic details or a correction…', '(Optional) Type your clinic details or make corrections...');
  replace(
    'Hi, I’m Eve. Try asking me about opening hours or an appointment.',
    'Hi, I’m Eve. Do a test booking by asking me about opening hours or available services.',
    2
  );
  replace('Run a fresh voice test before approval.', 'Test the updated booking voice before approval.');

  replace('<span>Featured service (optional)</span><select id="editFeatured"></select>',
    '<span>Featured service on your page (optional)</span><select id="editFeatured"></select>' +
    '<small>Shown on the Welcome sign unless you enter custom Welcome text.</small>');
  replace('<dt>Featured service</dt>', '<dt>Featured service on your page</dt>');

  replace(
    '<h3 id="finalOwnerReview">Final owner review</h3>',
    '<h3 id="finalOwnerReview">Final owner review</h3>' +
      '<p id="retakeClinicInterview" hidden><a href="#talk">Retake the voice interview</a></p>'
  );
  replace('function renderApproval(){\n  const a=assistant;', `$('retakeClinicInterview').querySelector('a').onclick=async event=>{
  event.preventDefault();
  await chooseEveMode('interview');
  $('talk').scrollIntoView({block:'center',behavior:'smooth'});
  $('talk').focus({preventScroll:true});
};
function renderApproval(){
  const a=assistant;
  $('retakeClinicInterview').hidden=!canInterview();`);
  replace("a.agentReady?'Retake the voice test':'Run the voice test'",
    "a.agentReady?'Test the updated booking voice':'Start a voice test booking'");

  replace('>Publish clinic page</button>', '>Create My AI Receptionist</button>');
  replace('Your page is published.', 'Your AI receptionist page is published.');
  replace(
    "link.href=a.publicUrl;link.textContent=location.origin+a.publicUrl;",
    "link.href=a.publicUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent=link.href;"
  );
  replace('· clinicnet.live/clinic/${a.slug}/', '· ${location.host}/clinic/${a.slug}/');

  replace(
    "const practice='This was a practice booking. No request was sent. On a live booking, the clinic team would receive the request by email and confirm availability.';",
    "const practice='That completes the test booking. No request was sent. With a live request, the clinic team would receive an email and confirm availability.';"
  );
  replace(
    "        displayEveTurn({role:'agent',message:practice},false);\n        return {ok:true,simulated:true,message:practice};",
    "        status('voiceStatus','Test booking complete.');\n" +
    "        return {ok:true,simulated:true,message:practice};"
  );
  replace(
    "session.sendContextualUpdate?.('This is a private practice booking. The booking tool simulates receipt only. When it returns a simulation, explain that no real request was sent. On a live request the clinic team is notified by email and confirms availability.');",
    "session.sendContextualUpdate?.('This is a private test booking. Use your regular booking voice throughout. Speak naturally without bracketed delivery cues or voice changes. ' +\n" +
    "      'The booking tool simulates receipt only. After a successful simulation, say the tool’s message once in your regular voice. ' +\n" +
    "      'The test booking is then finished. If the caller says to go ahead again, acknowledge briefly without repeating the closing message or resubmitting the test.');"
  );

  return source;
}

const after = update(before);
if (check || before === after) {
  console.log('Owner receptionist copy check passed. ' + Number(before !== after) + ' file(s) would change.');
} else {
  const backup = mkdtempSync(join(tmpdir(), 'eden-owner-receptionist-copy-'));
  copyFileSync(file, join(backup, 'index.html'));
  const temporary = file + '.eden-' + process.pid;
  writeFileSync(temporary, after, { flag: 'wx' });
  try {
    if (readFileSync(file, 'utf8') !== before) throw Error('The setup page changed during the update. Run the installer again.');
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
  console.log('Owner receptionist copy installed. Backup: ' + backup);
}
