# LinkedIn Post — FINAL (Ready to Publish)

**Status:** ✅ READY — Copy the post text below, attach screenshots, publish.
**Date prepared:** 2026-04-03

---

## 📋 COPY THIS POST TEXT ↓

I built a personal AI command centre. Here's what I learned.

For the past few weeks I've been building something I never expected to build: a dashboard for my AI agents.

Not a SaaS. Not a product. A genuinely personal tool — the kind of thing you build because nothing else does what you need.

Let me show you what's behind the curtain.

—

𝗧𝗵𝗲 𝗽𝗿𝗼𝗯𝗹𝗲𝗺

I use AI agents heavily in my day-to-day. Claude Code for development, automated agents for email triage, calendar management, research. The problem? They're all invisible. I had no idea what was running, what had finished, or what was stuck.

It's like having a team of people working for you — but with no Slack, no standup, no way to check in.

So I built one.

—

𝗪𝗵𝗮𝘁 𝗶𝘁 𝗮𝗰𝘁𝘂𝗮𝗹𝗹𝘆 𝗶𝘀

Jarvis Dashboard is a single-page web app running on a home server. Built with vanilla JavaScript, Express, and SQLite. No React. No build step. No framework. Just ~8,000 lines of JS and a 9,000-line CSS file that I'm only slightly ashamed of.

It does a few things:

🐶 𝗔𝗴𝗲𝗻𝘁 𝗼𝗿𝗰𝗵𝗲𝘀𝘁𝗿𝗮𝘁𝗶𝗼𝗻. I run three AI agents — Jarvis (general assistant), Klaus (coding specialist), and Emily (email/calendar). The dashboard shows each agent's live status: what they're working on, which model they're using, how much context they've consumed. Green dot = active. Amber = idle. Grey = offline.

🎯 𝗗𝗮𝗶𝗹𝘆 𝗴𝗼𝗮𝗹𝘀 & 𝘀𝘁𝗲𝗽𝘀. Each morning I set 2-3 goals. Each goal breaks into steps with time estimates. The dashboard tracks completion and rolls unfinished goals forward.

🗓️ 𝗦𝗰𝗵𝗲𝗱𝘂𝗹𝗲 𝗶𝗻𝘁𝗲𝗴𝗿𝗮𝘁𝗶𝗼𝗻. Google Calendar events from two accounts are pulled in via a CLI tool and rendered alongside manually scheduled time blocks.

📋 𝗞𝗮𝗻𝗯𝗮𝗻 𝗯𝗼𝗮𝗿𝗱𝘀. Trello boards pulled in via the API — with card detail modals, label management, and drag-to-move between lists.

📥 𝗧𝗮𝘀𝗸 𝗶𝗻𝗯𝗼𝘅. A priority-based inbox where agents (or I) can drop tasks. They flow through triage → to do → in progress → done.

🚀 𝗣𝗿𝗼𝗷𝗲𝗰𝘁 𝗽𝗶𝗽𝗲𝗹𝗶𝗻𝗲. An ideas-to-launch pipeline with evaluation scorecards (market potential, effort, excitement, synergy — scored out of 20).

📝 𝗗𝗼𝗰𝘂𝗺𝗲𝗻𝘁𝘀. A built-in document editor with Mermaid diagram support and fullscreen rendering.

💰 𝗙𝗶𝗻𝗮𝗻𝗰𝗲 𝘁𝗿𝗮𝗰𝗸𝗶𝗻𝗴. API usage monitoring so I know what my AI habit is actually costing me.

🐶 𝗕𝘂𝗶𝗹𝘁-𝗶𝗻 𝗰𝗵𝗮𝘁. A chat panel with voice input (via local Whisper STT), image attachments, and text-to-speech responses.

—

𝗧𝗵𝗲 𝗮𝗿𝗰𝗵𝗶𝘁𝗲𝗰𝘁𝘂𝗿𝗲

The whole thing is surprisingly simple:

Claude Code has a hooks system — it fires events on session start/end, task completion, tool use, and subagent spawn/stop. I configured these hooks to POST JSON to my dashboard server. Every event gets stored in SQLite and rendered in real-time.

Agents push their own status via a simple REST endpoint. That's it. No complex orchestration framework. No message queue. No Kubernetes. Just HTTP, JSON, and a database.

—

𝗪𝗵𝗮𝘁 𝗜 𝗮𝗰𝘁𝘂𝗮𝗹𝗹𝘆 𝗹𝗲𝗮𝗿𝗻𝗲𝗱

𝟭. 𝗩𝗮𝗻𝗶𝗹𝗹𝗮 𝗝𝗦 𝗶𝘀 𝘂𝗻𝗱𝗲𝗿𝗿𝗮𝘁𝗲𝗱. I built this without React, Vue, or any framework. It's fast, it's simple, and I understand every line. I'd rather read 100 lines of explicit DOM manipulation than debug a hook dependency array.

𝟮. 𝗔𝗴𝗲𝗻𝘁𝘀 𝗻𝗲𝗲𝗱 𝗼𝗯𝘀𝗲𝗿𝘃𝗮𝗯𝗶𝗹𝗶𝘁𝘆. The single most useful feature isn't the kanban board or the calendar. It's the agent status cards. Knowing that Klaus is "implementing auth middleware on claude-opus-4-6 at 47% context" changes how I work. I can make decisions about when to interrupt, when to wait, when to spawn another agent.

𝟯. 𝗧𝗵𝗲 𝗱𝗮𝘀𝗵𝗯𝗼𝗮𝗿𝗱 𝗰𝗵𝗮𝗻𝗴𝗲𝗱 𝗵𝗼𝘄 𝗜 𝘂𝘀𝗲 𝗔𝗜. Before, I'd fire off a task and forget about it. Now I see everything in one place — what's running, what's queued, what finished while I was making coffee. It made the whole system feel... manageable. Like an actual team.

𝟰. 𝗣𝗲𝗿𝘀𝗼𝗻𝗮𝗹 𝘁𝗼𝗼𝗹𝘀 𝗱𝗼𝗻'𝘁 𝗻𝗲𝗲𝗱 𝘁𝗼 𝗯𝗲 𝗽𝗿𝗲𝘁𝘁𝘆. (But making them pretty is fun.) I spent way too long on the dark theme, the JetBrains Mono font, the animated status dots. None of it was necessary. All of it made me want to use the tool more.

𝟱. 𝗦𝗤𝗟𝗶𝘁𝗲 𝗶𝘀 𝘁𝗵𝗲 𝗿𝗶𝗴𝗵𝘁 𝗱𝗮𝘁𝗮𝗯𝗮𝘀𝗲. For a single-user personal dashboard? SQLite is perfect. No server to manage, no connection strings, instant backups (it's just a file).

—

𝗪𝗵𝗮𝘁'𝘀 𝗻𝗲𝘅𝘁

I'm still iterating. The chat panel just got voice input. The finance tracking needs work. I want to add a "focus mode" that locks the schedule view and mutes notifications.

But the core insight is this: if you're using AI agents seriously, you need a way to see what they're doing. Not just logs. A proper interface. Something you can glance at and immediately know the state of your system.

It doesn't have to be fancy. It just has to exist.

—

If you're building something similar — or thinking about it — I'd love to hear about it. DM me or drop a comment.

Stack: Node.js, Express, SQLite, vanilla JS. Running on a home server via systemd. ~17,000 lines of frontend code. Zero dependencies beyond Express and better-sqlite3.

#AI #DeveloperTools #ClaudeCode #BuildInPublic #IndieHacker #SoftwareEngineering #PersonalTools

## ⬆️ END OF POST TEXT

---

## 📸 Screenshots Needed (NOT YET CAPTURED)

You need to manually screenshot these from the live dashboard at **http://100.87.235.73:3147**

### Required (attach all 3 to the post):

**Screenshot 1 — Home Overview** (LEAD IMAGE)
- Navigate to the main dashboard home view
- Make sure at least one agent shows green/active status
- Ensure goals and schedule sections are populated with real data
- Full browser window, dark theme
- Save as: `~/jarvis-dashboard/docs/screenshots/home-overview.png`

**Screenshot 2 — Agent Status Cards**
- Show the sidebar or agent section with Jarvis 🐶, Klaus ⚡, Emily 📧
- Ideally one green (active), one amber (idle), one grey (offline) for contrast
- Save as: `~/jarvis-dashboard/docs/screenshots/agent-status.png`

**Screenshot 3 — Chat Panel**
- Open the Jarvis chat panel
- Show a conversation with a few back-and-forth messages
- Voice input button and image attachment should be visible
- Save as: `~/jarvis-dashboard/docs/screenshots/chat-panel.png`

### Optional (nice to have):

**Screenshot 4 — Kanban Board**
- Open a Trello-integrated board with cards across multiple lists
- Save as: `~/jarvis-dashboard/docs/screenshots/kanban.png`

### Screenshot Tips:
- Use browser DevTools to set viewport to 1920x1080 for consistent sizing
- Or use a full-screen capture tool
- LinkedIn image ratio: 1200x627px is ideal for the feed, but any landscape works
- Crop out browser chrome (URL bar, bookmarks) — just the app content
- Consider light redaction of any sensitive task names/data

### Quick capture command (if you have Chrome):
```bash
mkdir -p ~/jarvis-dashboard/docs/screenshots
# Manual screenshots are recommended for best framing
# But for a quick capture:
# google-chrome --headless --screenshot=~/jarvis-dashboard/docs/screenshots/home-overview.png --window-size=1920,1080 http://100.87.235.73:3147
```

---

## 📝 Formatting Notes

- LinkedIn doesn't support markdown. The post above uses Unicode bold (𝗯𝗼𝗹𝗱) for headers which renders natively.
- Em dashes (—) used as section dividers instead of horizontal rules.
- Code blocks removed — architecture described in prose instead.
- Emoji used for visual scanning (LinkedIn-friendly).
- Post is ~1,100 words — within LinkedIn's sweet spot for long-form engagement.
- First line is the hook that appears before "...see more" — kept punchy.

## ✅ Publish Checklist

- [ ] Capture 3 screenshots (see above)
- [ ] Copy post text from between "COPY THIS POST TEXT" and "END OF POST TEXT"
- [ ] Paste into LinkedIn "Start a post" → click "Write article" or just paste as a regular post
- [ ] Attach screenshots (home overview as first/lead image)
- [ ] Review once more for any sensitive info in screenshots
- [ ] Publish!
- [ ] Optional: Cross-post shorter version to Twitter/X
- [ ] Optional: Share in Claude Discord, indie hackers communities
