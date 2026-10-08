# Accelerate Marketing Ops

Dashboard for Oshara. Reads Notion live through a small Vercel proxy, so the Notion token never reaches the browser.

## Files

- `index.html`: the dashboard (Today, Funnels, Upsell, Ads, Briefs)
- `api/data.js`: reads Project Tracker, PM Engine Projects + Tasks and the Strategy Board
- `api/ads.js`: saves and deletes ad entries (needs `AD_LOG_DS_ID`)
- `api/upsell.js`: saves upsell checkpoints (needs `UPSELL_DS_ID`)
- `api/_notion.js`: shared Notion helpers

## Setup

1. Share these Notion databases with your integration (••• → Connections):
   Project Tracker, PM Engine v2 → Projects, PM Engine v2 → Tasks, Strategy Hub → Strategy Board.
2. Import this repo into Vercel (no build settings needed).
3. Add environment variables in Vercel → Settings → Environment Variables, then redeploy:

| Name | Required | What |
|---|---|---|
| `NOTION_TOKEN` | Yes | Your Notion integration secret |
| `ACCESS_KEY` | No | A shared password for the dashboard. If set, the page asks for it once. |
| `AD_LOG_DS_ID` | No | Turns on the Ads tab saving. Data source ID of the Ad Log database. |
| `UPSELL_DS_ID` | No | Turns on upsell checkpoint saving. Data source ID of the Upsell Checkpoints database. |

## How clients show up

- **Active clients** come from the Project Tracker (everyone except Stage = Offboarded).
- **Funnels** show PM Engine projects that have the **Client** column set. Each task needs a **Funnel Stage**.
- **Briefs** match Strategy Board items to clients by first name.
