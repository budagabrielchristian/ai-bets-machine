export function newSlipNotifications(previous, next) {
  const known = new Set(previous.map(ticket => ticket.id));
  return next.filter(ticket => ticket.autoRun && ticket.strategy === 'slips' && !known.has(ticket.id))
    .map(ticket => ({
      title: '60/10 placed a practice slip',
      options: {
        body: ticket.stake + ' RON · Combined odds ' + Number(ticket.totalOdds).toFixed(2) + '\n' +
          ticket.selections.map(leg => leg.matchTitle + ' — ' + leg.selection).join('\n'),
        tag: 'practice-slip-' + ticket.id
      }
    }));
}

export function showSlipNotification(title, options) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  try {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      window.location.assign('/auto-pilot?strategy=slips');
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}
