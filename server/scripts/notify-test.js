// Send a test notification to NTFY_TOPIC:  npm run notify-test
import { config } from '../config.js';
import { sendTest } from '../notify.js';
if (!config.ntfyTopic) { console.error('Set NTFY_TOPIC first (in .env or the environment).'); process.exit(1); }
await sendTest();
console.log('Test notification sent. Check the ntfy app on your phone.');
