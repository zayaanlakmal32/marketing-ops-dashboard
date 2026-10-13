# Accelerate Marketing Ops

Dashboard for Oshara. Reads Notion live through a small Vercel proxy, so the Notion token never reaches the browser.

## Files

- `index.html`: the dashboard (Today, Funnels, Upsell, Ads, Briefs)
- `api/data.js`: reads Project Tracker, PM Engine Projects + Tasks and the Strategy Board
- `api/ads.js`: saves and deletes ad entries (needs `AD_LOG_DS_ID`)
- `api/upsell.js`: saves upsell checkpoints (needs `UPSELL_DS_ID`)
- `api/adclients.js`: saves per-client ad settings (needs `AD_CLIENTS_DS_ID`)
- `api/pitch.js`: saves the Pitch Update text on a PM Engine project
- `api/login.js`: sign in / sign out (Editoz email + team password)
- `lib/notion.js`: shared Notion helpers and login checks

## Setup

1. Share these Notion databases with your integration (••• → Connections):
   Project Tracker, PM Engine v2 → Projects, PM Engine v2 → Tasks, Strategy Hub → Strategy Board, Phase Performance Archive.
2. Import this repo into Vercel (no build settings needed).
3. Add environment variables in Vercel → Settings → Environment Variables, then redeploy:

| Name | Required | What |
|---|---|---|
| `NOTION_TOKEN` | Yes | Your Notion integration secret |
| `ACCESS_KEY` | Yes | The team password. People sign in with an @editozclub.com email + this password. Changing it signs everyone out. |
| `ALLOWED_DOMAIN` | No | Email domain allowed to sign in. Defaults to `editozclub.com`. |
| `SESSION_SECRET` | No | Extra secret for signing logins. Optional; one is derived automatically. |
| `AD_LOG_DS_ID` | No | Turns on the Ads tab saving. Data source ID of the Ad Log database. |
| `UPSELL_DS_ID` | No | Turns on upsell checkpoint saving. Data source ID of the Upsell Checkpoints database. |
| `AD_CLIENTS_DS_ID` | No | Turns on ad settings (who runs ads, result type, currency, target). Data source ID of the Ad Clients database. |
| `BOOKING_URL` | No | Booking link (GHL calendar or Calendly) the Upsell tab's **Book call** button opens. |

## How clients show up

- **Every tab uses one list:** clients with a PM Engine project where **Client** is set. Projects that are Paused, Done, Canceled or Archived are hidden.
- **Funnels:** each task needs a **Funnel Stage**. Clients with no tagged tasks show "No tasks tagged".
- **Upsell:** route (Win / Client ask / Gap) and offer are suggested from the blocker (6.x) and phase results, and can be edited. Saved to Upsell Checkpoints (Route, Suggested Offer, Next Date = call date, Proposal Link).
- **Briefs:** Phase 1/2/3 decks and the 90-day goal come from the Phase Performance Archive, plus the current deck from the Project Tracker.
