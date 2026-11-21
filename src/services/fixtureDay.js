const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' });
export function fixtureDay(date = new Date(), offset = 0) {
  const day = formatter.format(new Date(date));
  const shifted = new Date(day + 'T12:00:00Z');
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return shifted.toISOString().slice(0, 10);
}

/** Day number of a test period in calendar days, Bucharest time (the start day is day 1). */
export function testDay(start, now = Date.now(), days = Infinity) {
  const elapsed = Math.round((Date.parse(fixtureDay(now)) - Date.parse(fixtureDay(start))) / 86400000);
  return Math.min(days, Math.max(1, elapsed + 1));
}
