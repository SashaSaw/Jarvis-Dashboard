# 🐶 Jarvis Dashboard

Personal life hub and agent orchestration dashboard.

## Quick Start

```bash
npm install
npm start
```

Dashboard runs at `http://localhost:3147`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3147) |
| `TRELLO_API_KEY` | Yes | Trello API key |
| `TRELLO_TOKEN` | Yes | Trello token |

Google Calendar integration requires `gog` CLI to be installed and authenticated.

## Claude Code Hooks Setup

To have Claude Code on your Mac report activity to this dashboard:

1. Copy `hooks-config/hooks.json` 
2. Replace `YOUR_SERVER_IP` with your server's IP/hostname
3. Add the hooks to your Claude Code settings:
   - Copy to `~/.claude/settings.json` on your Mac, or
   - Place as `.claude/hooks.json` in your project directory

### Available Hook Events

| Event | Description |
|-------|-------------|
| `SessionStart` | New Claude Code session opened |
| `SessionEnd` | Session closed |
| `TaskCompleted` | A task finished |
| `PostToolUse` | After Edit/Write/Bash tool runs |
| `SubagentStart` | Sub-agent spawned |
| `SubagentStop` | Sub-agent finished |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/hooks` | Receive webhook events |
| `GET` | `/api/events` | List events (?type=, &since=, &limit=) |
| `GET` | `/api/events/stats` | Today's stats summary |
| `GET` | `/api/sessions/active` | Currently active sessions |
| `GET` | `/api/trello` | Project board summaries |
| `GET` | `/api/calendar` | Upcoming calendar events (?days=7) |

## Architecture

```
Mac (Claude Code) --hooks--> Server:3147/api/hooks --> SQLite --> Dashboard UI
                                                   --> Trello API
                                                   --> gog CLI (Calendar)
```
