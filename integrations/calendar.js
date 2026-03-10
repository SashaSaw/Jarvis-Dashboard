const { execSync } = require('child_process');

function getTodayEvents() {
  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0];

    const result = execSync(
      `gog calendar events primary --from ${today}T00:00:00Z --to ${tomorrow}T23:59:59Z --json 2>/dev/null`,
      { encoding: 'utf8', timeout: 10000 }
    );

    const parsed = JSON.parse(result);
    // gog returns array of events or object with items
    const events = Array.isArray(parsed) ? parsed : (parsed.items || parsed.events || []);

    return events.map(e => ({
      summary: e.summary || e.title || 'No title',
      start: e.start || e.startTime,
      end: e.end || e.endTime,
      location: e.location || null,
      allDay: e.allDay || false
    }));
  } catch (err) {
    // gog might not be available or calendar not authed
    return [];
  }
}

function getUpcomingEvents(days = 7) {
  try {
    const now = new Date();
    const from = now.toISOString().split('T')[0];
    const to = new Date(now.getTime() + days * 86400000).toISOString().split('T')[0];

    const result = execSync(
      `gog calendar events primary --from ${from}T00:00:00Z --to ${to}T23:59:59Z --json 2>/dev/null`,
      { encoding: 'utf8', timeout: 10000 }
    );

    const parsed = JSON.parse(result);
    const events = Array.isArray(parsed) ? parsed : (parsed.items || parsed.events || []);

    return events.map(e => ({
      summary: e.summary || e.title || 'No title',
      start: e.start || e.startTime,
      end: e.end || e.endTime,
      location: e.location || null,
      allDay: e.allDay || false
    }));
  } catch (err) {
    return [];
  }
}

module.exports = { getTodayEvents, getUpcomingEvents };
