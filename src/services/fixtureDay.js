const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' });
export function fixtureDay(date = new Date(), offset = 0) {
  const day = formatter.format(new Date(date));
  const shifted = new Date(day + 'T12:00:00Z');
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return shifted.toISOString().slice(0, 10);
}
