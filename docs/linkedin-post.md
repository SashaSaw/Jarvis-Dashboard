# LinkedIn Post — Building My AI Command Centre

## Metadata
- **Author:** Alexander Saw
- **Draft date:** 2026-04-03
- **Status:** DRAFT — needs Sasha's review before posting
- **Target length:** ~1,200 words (LinkedIn sweet spot for long-form)

---

## Tone Decision

**Professional but personal. Technical but accessible.**

Why: The audience is a mix of software engineers, indie hackers, and AI-curious professionals. The post should feel like a behind-the-scenes tour — not a product launch or a humblebrag. Show the thinking, the architecture, the rough edges. People connect with the process, not the polish.

---

## Suggested Screenshots

Capture these from the live dashboard at `http://localhost:3147`:

1. **Home overview** — the main dashboard showing agent status cards, today's schedule, goals, and project summaries all in one view
2. **Agent sidebar** — the sidebar showing Jarvis 🐶, Klaus ⚡, and Emily 📧 with their live status dots (green/amber/grey)
3. **Schedule view (day)** — the calendar with time blocks, Google Calendar overlay, and the "now" line
4. **Kanban board** — the Trello-integrated kanban with cards, labels, and drag-to-move
5. **Jarvis chat panel** — the built-in chat with voice input, image attachments, and conversation history
6. **Activity log** — the scrolling log of agent actions with timestamps

Pick 3-4 max for the post. Recommended: #1, #2, #5 (home, agents, chat).

---

## The Post

---

**I built a personal AI command centre. Here's what I learned.**

For the past few weeks I've been building something I never expected to build: a dashboard for my AI agents.

Not a SaaS. Not a product. A genuinely personal tool — the kind of thing you build because nothing else does what you need.

Let me show you what's behind the curtain.

---

**The problem**

I use AI agents heavily in my day-to-day. Claude Code for development, automated agents for email triage, calendar management, research. The problem? They're all invisible. I had no idea what was running, what had finished, or what was stuck.

It's like having a team of people working for you — but with no Slack, no standup, no way to check in.

So I built one.

---

**What it actually is**

Jarvis Dashboard is a single-page web app running on a home server (a Linux box on my local network). It's built with vanilla JavaScript, Express, and SQLite. No React. No build step. No framework. Just ~8,000 lines of JS and a 9,000-line CSS file that I'm only slightly ashamed of.

It does a few things:

**🐶 Agent orchestration.** I run three AI agents — Jarvis (general assistant), Klaus (coding specialist), and Emily (email/calendar). The dashboard shows each agent's live status: what they're working on, which model they're using, how much context they've consumed. Green dot = active. Amber = idle. Grey = offline.

**🎯 Daily goals & steps.** Each morning I set 2-3 goals. Each goal breaks into steps with time estimates. The dashboard tracks completion and rolls unfinished goals forward.

**🗓️ Schedule integration.** Google Calendar events from two accounts (personal + work) are pulled in via a CLI tool and rendered alongside manually scheduled time blocks. Day view, week view, month view.

**📋 Kanban boards.** Trello boards are pulled in via the API and rendered as interactive kanban boards — with card detail modals, label management, description editing, and drag-to-move between lists.

**📥 Task inbox.** A priority-based inbox where agents (or I) can drop tasks. They flow through triage → to do → in progress → done.

**🚀 Project pipeline.** An ideas-to-launch pipeline with evaluation scorecards (market potential, effort, excitement, synergy — scored out of 20). Projects move through stages: concept → validated → building → launched.

**📝 Documents.** A built-in document editor for notes, specs, and project docs — with Mermaid diagram support and fullscreen rendering.

**💰 Finance tracking.** API usage monitoring so I know what my AI habit is actually costing me.

**🐶 Built-in chat.** A chat panel with voice input (via local Whisper STT), image attachments, and text-to-speech responses. I can talk to Jarvis from the dashboard.

---

**The architecture**

The whole thing is surprisingly simple:

```
Mac (Claude Code) → webhook hooks → Server:3147 → SQLite → Dashboard UI
                                                 → Trello API
                                                 → Google Calendar (via gog CLI)
```

Claude Code has a hooks system — it fires events on session start/end, task completion, tool use, and subagent spawn/stop. I configured these hooks to POST JSON to my dashboard server. Every event gets stored in SQLite and rendered in real-time.

Agents push their own status via a simple REST endpoint:

```
POST /api/agent/{name}/status
{ "status": "busy", "status_text": "Writing LinkedIn post", "model": "claude-opus-4-6" }
```

That's it. No complex orchestration framework. No message queue. No Kubernetes. Just HTTP, JSON, and a database.

---

**What I actually learned**

**1. Vanilla JS is underrated.** I built this without React, Vue, or any framework. It's fast, it's simple, and I understand every line. The tradeoff is that the code is verbose — but for a personal tool, that's fine. I'd rather read 100 lines of explicit DOM manipulation than debug a hook dependency array.

**2. Agents need observability.** The single most useful feature isn't the kanban board or the calendar. It's the agent status cards. Knowing that Klaus is "implementing auth middleware on claude-opus-4-6 at 47% context" changes how I work. I can make decisions about when to interrupt, when to wait, when to spawn another agent.

**3. The dashboard changed how I use AI.** Before, I'd fire off a task and forget about it. Now I see everything in one place — what's running, what's queued, what finished while I was making coffee. It made the whole system feel... manageable. Like an actual team.

**4. Personal tools don't need to be pretty.** (But making them pretty is fun.) I spent way too long on the dark theme, the JetBrains Mono font, the animated status dots. None of it was necessary. All of it made me want to use the tool more.

**5. SQLite is the right database.** For a single-user personal dashboard? SQLite is perfect. No server to manage, no connection strings, instant backups (it's just a file). I'd use it again without hesitation.

---

**What's next**

I'm still iterating. The chat panel just got voice input. The finance tracking needs work. I want to add a "focus mode" that locks the schedule view and mutes notifications.

But the core insight is this: **if you're using AI agents seriously, you need a way to see what they're doing.** Not just logs. A proper interface. Something you can glance at and immediately know the state of your system.

It doesn't have to be fancy. It just has to exist.

---

*If you're building something similar — or thinking about it — I'd love to hear about it. DM me or drop a comment.*

*Stack: Node.js, Express, SQLite, vanilla JS. Running on a home server via systemd. ~17,000 lines of frontend code. Zero dependencies beyond Express and better-sqlite3.*

---

## Post-Publish Checklist

- [ ] Attach 3-4 screenshots (see suggestions above)
- [ ] Add relevant hashtags: #AI #DeveloperTools #ClaudeCode #BuildInPublic #IndieHacker
- [ ] Consider cross-posting to Twitter/X with a shorter version
- [ ] Share in relevant Discord communities (Claude, indie hackers)
