import React, { useState } from 'react';
import { useBetContext } from '../context/BetContext';
import { showSlipNotification } from '../services/slipNotifications';

export default function SlipNotificationSettings() {
  const {account,setSlipNotifications}=useBetContext();
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const supported = typeof Notification !== 'undefined' && window.isSecureContext;
  async function toggle() {
    if (account.slipNotifications) {
      await setSlipNotifications(false);
      setMessage('60/10 notifications turned off.');
      return;
    }
    if (!supported) { setMessage('Desktop notifications are unavailable in this browser. Open the site in Chrome or Edge.'); return; }
    setBusy(true);
    try {
      const permission=await Notification.requestPermission();
      if (permission !== 'granted') {
        setMessage(permission==='denied' ? 'Notifications are blocked. Allow them in this site’s browser settings, then enable them here.' : 'Permission was dismissed. You can enable notifications whenever you are ready.');
        return;
      }
      await setSlipNotifications(true);
      setMessage('Enabled for new 60/10 practice slips.');
    } catch {
      setMessage('This browser could not enable notifications. Try Chrome or Edge.');
    } finally { setBusy(false); }
  }
  return <div className="notification-settings">
    <div><h3>60/10 notifications</h3><p>Receive a desktop alert when the 60/10 AI saves a new slip. The server places tickets around the clock; alerts appear while this dashboard is open in a browser tab.</p></div>
    <div className="flex flex-wrap gap-3">
      <button disabled={busy} onClick={toggle}>{busy ? 'Waiting for permission…' : account.slipNotifications ? 'Turn notifications off' : 'Notify me about 60/10 slips'}</button>
      {account.slipNotifications && <button onClick={()=>{
        const sent=showSlipNotification('60/10 notification test',{body:'Notifications are working. No ticket was created.',tag:'practice-notification-test'});
        setMessage(sent ? 'Test alert requested. Check your desktop notifications.' : 'Unable to display an alert. Check browser permission and notification settings.');
      }}>Test notification</button>}
    </div>
    <p role="status">{message || (account.slipNotifications ? 'Enabled for this account in this browser.' : '')}</p>
  </div>;
}
