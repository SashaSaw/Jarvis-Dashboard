const { execSync } = require('child_process');

const CALENDAR_ACCOUNTS = [
  { account: 'sawsasha26@gmail.com', label: 'Personal' },
  { account: 'sasha.saw@incept5.com', label: 'Work' }
];

function fetchCalendarEvents(from, to) {
  const allEvents = [];

  for (const { account, label } of CALENDAR_ACCOUNTS) {
    try {
      const result = execSync(
        `gog calendar events primary --account ${account} --from ${from} --to ${to} --json 2>/dev/null`,
        { encoding: 'utf8', timeout: 15000 }
      );

      const parsed = JSON.parse(result);
      const events = Array.isArray(parsed) ? parsed : (parsed.items || parsed.events || []);

      for (const e of events) {
        allEvents.push({
          summary: e.summary || e.title || 'No title',
          start: e.start || e.startTime,
          end: e.end || e.endTime,
          location: e.location || null,
          allDay: e.allDay || false,
          calendar: label
        });
      }
    } catch (err) {
      // Account might not be available — skip silently
    }
  }

  return allEvents;
}

function getTodayEvents() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0];
  return fetchCalendarEvents(`${today}T00:00:00Z`, `${tomorrow}T23:59:59Z`);
}

function getUpcomingEvents(days = 7) {
  const now = new Date();
  const from = now.toISOString().split('T')[0];
  const to = new Date(now.getTime() + days * 86400000).toISOString().split('T')[0];
  return fetchCalendarEvents(`${from}T00:00:00Z`, `${to}T23:59:59Z`);
}

module.exports = { getTodayEvents, getUpcomingEvents };
