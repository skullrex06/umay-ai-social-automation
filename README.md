# UMAY AI SOCIAL AUTOMATION — RM0 starter

Mobile-first Facebook content queue for a Facebook Page and a Professional Mode profile.

## What this starter does
- Stores content drafts and scheduled jobs in Cloudflare D1.
- Provides a simple mobile dashboard.
- Publishes **text and single-image posts to a Facebook Page** through the official Meta Graph API.
- Uses a public HTTPS `media_url` for image posts.
- Keeps Professional Mode profile posts in a **manual-publish workflow**.
- Includes a scheduled Worker trigger to publish due Page posts.

## Important limits
1. Meta's Page publishing API requires a Page access token and approved permissions. See:
   https://developers.facebook.com/docs/graph-api/reference/page/feed/
2. This starter does not automate publishing to a personal/Professional Mode profile. Use the Facebook app's native composer for that profile. Do not use password bots, browser scraping, or unofficial automation.
3. Reels publishing is not implemented in this MVP. Reels require a separate video upload/publishing flow and the relevant Meta permissions. Use Meta Business Suite for Page Reels until that module is added.
4. AI generation is not unlimited or guaranteed free. This starter is the publishing/queue foundation. A free AI API, if available to your account, may have quotas and may require a key. Do not put AI keys or Meta tokens in browser code.
5. This is a starter project, not a deployed or connected app. No Facebook account has been connected and no posts have been published.

## Deploy from Android using GitHub + Cloudflare Dashboard

### A. Create the D1 database
1. Open https://dash.cloudflare.com/
2. Workers & Pages → D1 SQL Database → Create database.
3. Name it `umay-social-db`.
4. Open the database console and run `schema.sql` from this project.

### B. Create the Worker
1. Cloudflare Dashboard → Workers & Pages → Create → Worker.
2. Name it `umay-social-automation`.
3. Open Edit Code and paste `src/worker.js`.
4. Add the D1 binding:
   - Variable name: `DB`
   - Select database: `umay-social-db`
5. Add a static asset binding only if you later move the dashboard into Workers Assets. For this starter, the dashboard is a separate static file you can host on Cloudflare Pages.

### C. Configure Worker variables and secrets
In Worker Settings → Variables and Secrets:
- `META_GRAPH_VERSION` = `v27.0` (check the current version in Meta docs before deployment)
- Secret `ADMIN_TOKEN` = create a long random secret
- Secret `META_PAGE_ACCESS_TOKEN` = Page access token (never share it)
- Variable `META_PAGE_ID` = numeric Page ID

Required Page permissions normally include:
- `pages_manage_posts`
- `pages_read_engagement`
- `pages_show_list`

The Facebook user authorizing the app must have the appropriate Page task, such as CREATE_CONTENT. Meta may require app review/advanced access for production use.

### D. Deploy and test
1. Deploy Worker.
2. Visit `https://YOUR-WORKER.workers.dev/api/health`.
3. Dashboard requests use `Authorization: Bearer YOUR_ADMIN_TOKEN`.
4. Test with a text draft first. Approve it for a time a few minutes in the future.
5. Only after text publishing works, test an image post with a public HTTPS image URL.

### E. Dashboard hosting
You can host `public/index.html` using Cloudflare Pages (Direct Upload) or any free static hosting that supports HTTPS.
Edit the `API_BASE` and `ADMIN_TOKEN` fields in the dashboard. For better security, do not hardcode the admin token in a public website. This simple starter is for private testing only. A production version should use Cloudflare Access or an authenticated login/session.

## API
- `GET /api/health`
- `GET /api/posts` — requires bearer admin token
- `POST /api/posts` — create draft; JSON:
  `{ "destination":"page", "format":"photo", "caption":"...", "media_url":"https://..." }`
- `POST /api/posts/:id/approve` — approve and schedule; JSON:
  `{ "scheduled_at":"2026-11-25T12:30:00+08:00" }`

`destination` may be `page` or `profile`. `profile` items are stored as manual tasks and are never auto-published by this Worker.

## Free-tier note
Cloudflare free quotas and Meta API requirements can change. Stay within current free limits. No paid add-ons are required by this source code, but exceeding free quotas may incur charges depending on account settings.
