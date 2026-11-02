# Rainfall tracker

A website that tracks estimated rainfall for South African towns using Yr weather data.

- **Yr** (MET Norway) supplies the data.
- **Supabase** collects it every 15 minutes and stores the history.
- **Netlify** hosts the website and rebuilds it from GitHub.
- **GitHub** holds the code and sends backend changes to Supabase.

## What the numbers mean

Yr publishes forecasts, not rain gauge readings. As each hour passes, the site keeps Yr's
latest estimate for that hour, and those saved hours become the rainfall history.

- Totals are model estimates and can differ from what actually fell in a town, especially
  with isolated thunderstorms.
- History starts the day the site goes live. Yr does not supply past rainfall.
- A town added later starts from the day it is added.
- A `*` beside a total means it covers only part of that period.

## Set it up

This takes about 30 minutes. All three services have free plans.

### 1. Put the code on GitHub

Create an empty repository called `rainfall-tracker`, then run this in the unzipped folder:

```bash
git init -b main
git add .
git commit -m "First version"
git remote add origin https://github.com/YOUR-NAME/rainfall-tracker.git
git push -u origin main
```

Use git or GitHub Desktop. The website's drag-and-drop upload can miss the hidden `.github`
folder, and the backend deploy lives there.

### 2. Create the Supabase project

Create a project at [supabase.com](https://supabase.com) and save the database password.
Then collect these values:

| Value | Where to find it |
| --- | --- |
| Project ID | Project Settings > General |
| Publishable key | Project Settings > API Keys |
| Access token | Your account menu > Access Tokens > Generate new token |

### 3. Add the GitHub secrets

In your repository, open Settings > Secrets and variables > Actions, and add these six:

| Secret | Value |
| --- | --- |
| `SUPABASE_PROJECT_ID` | Project ID from step 2 |
| `SUPABASE_ACCESS_TOKEN` | Access token from step 2 |
| `SUPABASE_DB_PASSWORD` | Database password from step 2 |
| `YR_USER_AGENT` | Your app and a way to reach you, such as `rainfall-tracker github.com/YOUR-NAME/rainfall-tracker` |
| `CRON_SECRET` | A long random password you make up |
| `ADMIN_KEY` | A different long random password. You'll use this on the Manage towns page |

Yr requires a real `YR_USER_AGENT` and can block made-up ones. Make sure the link leads to
contact details, or use a work email address instead.

### 4. Deploy the backend

In your repository, open Actions > Deploy Supabase > Run workflow. When it shows a green
tick, the database, the 19 towns and the functions are in place. It runs again by itself
whenever files in `supabase/` change.

### 5. Start the 15-minute schedule

Open `supabase/setup_schedule.sql`, replace the two values marked in it, paste the whole
file into the Supabase SQL Editor and press Run. Use the same `CRON_SECRET` as step 3.

### 6. Publish on Netlify

In Netlify, choose Add new site > Import an existing project, then pick the repository.
`netlify.toml` already holds the build settings. Before deploying, add these environment
variables:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://YOUR-PROJECT-ID.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key from step 2 |

Never put the database password, access token or a Supabase secret key here. Anything
starting with `VITE_` becomes visible in the browser.

### 7. Check that it works

Wait 15 minutes, then run this in the Supabase SQL Editor:

```sql
select * from collector_runs order by id desc limit 5;
```

You should see `updated` at 19. If no row appears, see Troubleshooting.

## Add more towns

The collector picks up new towns by itself, so no code changes are needed.

| Option | Best for | How |
| --- | --- | --- |
| Search on the website | Most towns | Manage towns > enter the admin key > search > Add |
| Coordinates on the website | Farms, reserves and places search can't find | Manage towns > Add a place by coordinates |
| Supabase Table Editor | Adding many at once | Open `towns` > Insert > Import data from CSV, with columns `name`, `province`, `lat`, `lon` |
| New migration file | Keeping the town list in GitHub | Add a new file in `supabase/migrations/` with an `insert` like the one in the seed file, then push |

Use up to 4 decimals for coordinates. Rainfall appears within 15 minutes.

**Pausing a town** hides it and stops collection, but keeps its history. To delete a town and
its history for good, delete its row in the Table Editor.

**Capacity:** each run handles up to 60 towns, which should comfortably cover over 100 towns.
Past that, raise `batchSize` in `collect.ts`.

## Things to watch

- **Free Supabase projects can be paused after about a week of low activity.** Yr's data
  can't be recovered for a paused period, so gaps stay blank. The site shows a warning when
  data goes stale. If the history matters to you, check your project regularly or use a paid plan.
- **Town search on Manage towns** uses Open-Meteo's free geocoding service, which is for
  non-commercial use. A commercial site needs an Open-Meteo API key, or can add towns by
  coordinates instead.
- **Yr's terms** require crediting MET Norway. The footer already does this, so keep it in place.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| "Sample data" banner on the live site | Add both `VITE_` variables in Netlify, then redeploy |
| No rows in `collector_runs` | Run `select * from cron.job_run_details order by start_time desc limit 5;` and `select * from net._http_response order by created desc limit 5;` |
| 401 from the collector | The `CRON_SECRET` in GitHub and the Vault value don't match |
| "Set the YR_USER_AGENT secret" | Add the secret, then rerun the workflow |
| A town shows "Last update failed" | The collector retries in 30 minutes. A failure that keeps repeating is worth checking on Yr's status |
| The `collector_runs` note mentions 429 | Yr is limiting requests. Check that `YR_USER_AGENT` is real |
| The `collector_runs` note mentions 203 | Yr has deprecated this API version. Update `YR_URL` in `yr.ts` |

To reset a value in step 5, run `select cron.unschedule('collect-rainfall');` and delete the
two `rainfall_` rows in Vault before running the file again.

## Local development

```bash
npm install
npm run dev    # shows labelled sample data until you add a .env file
npm test       # runs the collector tests and the database tests
```

## Project layout

```
src/                     Website
supabase/migrations/     Database tables, views and the first 19 towns
supabase/functions/      Collector and town management
supabase/setup_schedule.sql   The 15-minute schedule
tests/                   Automated tests
.github/workflows/       Backend deployment
```
