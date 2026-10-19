# Redesign acceptance audit — screen-by-screen parity with mockups

Source of truth: `.pi/artifacts/hermes-mobile-redesign-mockups.html` (frames M1–M14 mobile, W1–W5 desktop).

**Grading rule:** a screen passes only when its local capture matches the mockup frame with no discrepancies, at BOTH 390×844 and 1280×800, in BOTH light and dark theme (`CAPTURE_DARK=1`). Capture harness: `node scripts/capture-screens.mjs` (env: `CAPTURE_WIDTH`, `CAPTURE_HEIGHT`, `CAPTURE_PREFIX`, `CAPTURE_DARK`). Dev server: `npm run dev` → `http://127.0.0.1:3010/?preview`.

**Deferred by explicit decision (not graded):** slide-to-approve for high risk (M3/M4 gesture), sticky approval dock, desktop Inbox master-detail (W2 detail pane), plan-after-approval ordering in preview data (real flow is correct).

## Tab screens

### 1. Chats home (M1, W1 sidebar)
- [ ] No hero/tile grid; thread list is the screen.
- [ ] Approval banner on top when approvals pending (amber, count + chevron).
- [ ] Composer at top: `+` icon, "Message Hermes…" input, **mic icon**, send button (G2).
- [ ] Search chats field.
- [ ] Date groups: LIVE / TODAY / EARLIER with live dot on active thread.
- [ ] Thread rows: title, **message preview line** (G1 — needs last-message data), relative time right.
- [ ] Desktop: this exact list renders in the 296px chat sidebar (done in S9 — verify still true).

### 2. Chat (M2, W1)
- [ ] Header: back chevron (mobile only), thread title, no "System OK" pill when healthy.
- [ ] Context chips row: profile / model·effort / source (CLI).
- [ ] Collapsed tool group: one header line ("Tool actions", N steps · status); only running tool + approval visible inside.
- [ ] Approval card: tool name, "waiting for you", LOW/HIGH RISK chip, mono command, 4 actions (Run/Reject/Session/Always desktop right-aligned).
- [ ] Composer: +, input, mic, send/stop.
- [ ] Desktop: 3-pane (rail + 296px sidebar + chat capped ~760px centered).

### 3. Inbox (M4)
- [ ] Header title "Inbox", no back chevron.
- [ ] Approval cards = same component as chat (4 actions, risk chip, mono command).
- [ ] Session context line per approval where data exists (G7).
- [ ] Notices section below approvals; empty state when clear.

### 4. Work — Tasks (M5, W3)
- [ ] Header "Work"; stage filter pills (only non-empty stages + All).
- [ ] Quiet tinted "+ New" button (not solid blue).
- [ ] Task rows/cards: title, priority chip, @assignee, blocked reason.
- [ ] Desktop: horizontal column board (done in S9 — verify still true).

### 5. Schedules (M6) — currently a More item; mockup shows it as a segment of Work
- [ ] **Decision needed:** keep Schedules as separate More row (current) vs merge into Work tab segment (M5/M6). Default: keep separate, note deviation.
- [ ] Rows: icon, name, SCHEDULED/PAUSED chip, human schedule ("Daily at 03:00"), next run, toggle right.
- [ ] Quiet "+ New" button (G3); profile filter restyled (G3).
- [ ] Tap row → action sheet (Run now / Edit / Delete).

### 6. More sheet (M7)
- [ ] Exactly 5 rows: Profiles, Agents, Schedules, System, Settings (+ Artifacts per current app — keep, note deviation from M7).
- [ ] No Sessions row (done).
- [ ] Version footer.

## Secondary screens

### 7. Profiles (M10)
- [ ] 2-line rows: avatar, name + ACTIVE badge, model · description subline, chevron.
- [ ] Tap → action sheet: Activate / Rename / Delete (Change model settings).
- [ ] "Model defaults live in Profiles" hint where Settings references models.

### 8. Agents (M11)
- [ ] Segment control: Active | Recent; no "No active agents" dead-end.

### 9. Artifacts (M12)
- [ ] Rows: thumbnail (images), name, source session, file size.

### 10. System (M13, W4)
- [ ] **Remove blue "Gateway running" hero** (G4): neutral white summary row (dot + "Gateway running · up Xh").
- [ ] Restart/Stop behind confirmation sheet (done); neutral buttons.
- [ ] CPU/RAM/Disk cards: sans number + progress bar (done).
- [ ] Doctor / Security audit rows with Run buttons; Backups row; "New backup" not solid-blue loud (G4).
- [ ] Version chips footer. Desktop: capped 840px.

### 11. Settings (M14, W5)
- [ ] Sections: Connection (Gateway URL, Model row deep-linking to Profiles), Notifications (toggles grouped), Appearance (Theme), About (version), Log out bottom in red.
- [ ] Desktop: capped 720px.

### 12. Voice (M8)
- [ ] Full-screen overlay mode launched from composer mic (done S6 — verify visual: orb, transcript, mute/end bar, close ×).

### 13. Offline (M9)
- [ ] Navigation stays accessible; card shows gateway URL, Retry (primary), Change gateway URL (secondary); no double Retry banner.

## Desktop global (W1–W5)
- [ ] 64px icon rail with aria-labels (done).
- [ ] Chat: rail + sidebar + capped pane (done S9).
- [ ] Kanban: horizontal board ≥900px (done S9).
- [ ] System/Settings/Activity/Cron/Artifacts capped widths (done S8).

## Known remaining gaps going in
- G1 thread-row message previews (needs store data)
- G2 Chats composer mic
- G3 Schedules "+ New" + profile filter restyle
- G4 System blue hero + loud New backup
- G7 Inbox approval session context line (where data missing)
