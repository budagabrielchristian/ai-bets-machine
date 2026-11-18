// Create or update a dashboard account.
//   npm run create-user -- <username> [--totp] [--password-stdin]
// Without --password-stdin the password is typed at a hidden prompt.
import { destroyAllSessions, hashPassword, loadUsers, newTotpSecret, saveUsers } from '../auth.js';

const args = process.argv.slice(2);
const username = (args.find(a => !a.startsWith('--')) || '').trim().toLowerCase();
const wantTotp = args.includes('--totp');
const fromStdin = args.includes('--password-stdin');

if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
  console.error('Usage: npm run create-user -- <username> [--totp]\nUsername: 3-64 characters, letters, digits, dot, dash or underscore.');
  process.exit(1);
}

function hiddenPrompt(question) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY) { reject(new Error('No terminal available. Use --password-stdin.')); return; }
    process.stdout.write(question);
    let value = '';
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { done(); return; }
        if (ch === '\u0003') { input.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    const done = () => { input.setRawMode(false); input.pause(); input.off('data', onData); process.stdout.write('\n'); resolve(value); };
    input.on('data', onData);
  });
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data.replace(/\r?\n$/, '');
}

let password;
if (fromStdin) password = await readStdin();
else {
  password = await hiddenPrompt('Password (min 12 characters): ');
  const again = await hiddenPrompt('Repeat password: ');
  if (password !== again) { console.error('Passwords do not match.'); process.exit(1); }
}
if (password.length < 12) { console.error('Password must be at least 12 characters.'); process.exit(1); }
if (password.toLowerCase().includes(username)) { console.error('Password must not contain the username.'); process.exit(1); }

const data = loadUsers();
const existing = data.users.find(u => u.username === username);
const user = existing || { username, created: new Date().toISOString() };
user.hash = hashPassword(password);
if (wantTotp) { user.totpSecret = newTotpSecret(); user.lastTotpStep = 0; }
if (!existing) data.users.push(user);
saveUsers(data);
// Changing a password signs out every existing session for that user.
destroyAllSessions(username);

console.log((existing ? 'Updated' : 'Created') + ' account "' + username + '". Existing sessions were signed out.');
if (wantTotp) {
  console.log('\nTwo-factor authentication is ON. Add this key to an authenticator app');
  console.log('(Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden…) using "enter a setup key":\n');
  console.log('  Account: AI Bets Machine (' + username + ')');
  console.log('  Key:     ' + user.totpSecret.match(/.{1,4}/g).join(' '));
  console.log('  Type:    Time-based, 6 digits, 30 seconds\n');
  console.log('Or paste this link into an app that accepts otpauth:// links:');
  console.log('  otpauth://totp/AI%20Bets%20Machine:' + encodeURIComponent(username) + '?secret=' + user.totpSecret + '&issuer=AI%20Bets%20Machine\n');
}
process.exit(0);
