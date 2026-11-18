# AI Bets Machine

Five betting AIs run 24/7 on a server, each with its own 200 RON practice wallet. A private,
login-protected dashboard shows who is up and who is down. **Practice money only:** nothing is ever
placed at a real bookmaker.

## The AIs

| AI | Method | Staking |
|---|---|---|
| **Favorites** | Market favourites ≥ 60% (margin removed with the power method), odds 1.20–1.75, skipped if the models disagree | Flat 2%, max 10% at risk |
| **Value hunter** | Line shopping: best price vs no-vig price elsewhere (Pinnacle when available), ≥ 3% expected return | Quarter Kelly, 4% cap |
| **60 / 10 slips** | Your two-leg slips (60 RON at 1.90–2.00, 10 RON at 2.01–5.00); legs now chosen by model value | Fixed 60 / 10 |
| **Elo ratings** | Elo from a year of results (K=20, home +60, margin-of-victory scaling) → win/draw/loss curve fitted on past games | Quarter Kelly, 3% cap |
| **Poisson model** | Dixon-Coles goal model per league (time-weighted, 180-day half-life) → results, totals, handicaps | Quarter Kelly, 3% cap |

Guard rails shared by all of them:

- one bet per fixture
- capped money at risk
- kickoff within 24 hours (48 for slips)
- the model AIs blend their probability 50/50 with the market's and skip any bet where model and market disagree by more than 10 points. That size of gap usually means the model is missing news.

Every ticket stores its **closing price**, so the dashboard shows **CLV** (closing line value). Over 50+ bets,
a positive CLV is the most reliable early sign that an AI has a real edge.

## Run it on this PC

Double-click **Start AI Bets Machine.bat**. The first time, it installs packages and asks for a username and password. Then it opens http://localhost:8787 in your browser.

Keep the window open: the AIs only scan, bet and settle while it runs. If the PC sleeps or the window is closed, nothing is lost. On the next start the server settles every finished match and carries on. Matches that kicked off while it was off are simply not bet on.

The server only listens on this PC (127.0.0.1), so nothing is reachable from the network or the internet.

Manual equivalent:

```bash
npm install
npm run create-user -- yourname     # hidden password prompt; add --totp for 2FA
npm run local                       # builds the dashboard and starts the server
```

For UI development, run `npm run server` and `npm run dev` together. Vite forwards `/api` and `/login` to the server.

Other commands: `npm test` runs the unit tests. `npm run dry-run` shows what each AI would bet right now and saves nothing.

## Security

- **Login required:** everything sits behind sign-in, including the JavaScript bundle. Only the login page is public.
- **Passwords:** hashed with scrypt, minimum 12 characters. Optional 2FA codes from any authenticator app (`--totp`).
- **Brute-force protection:** after 5 failures, locks escalate per IP (up to 24 h) and per username (capped at 15 min).
- **Sessions:** random 256-bit tokens, stored server-side only as hashes. The cookie is HttpOnly, SameSite=Strict, and Secure in production. Sessions expire after 7 idle days or 30 days total, and changing a password signs out every session.
- **CSRF protection:** a same-origin check plus a per-session token on every change.
- **Strict headers:** Content-Security-Policy (no third-party scripts), HSTS, frame blocking, nosniff.
- **No client trust:** the server re-prices every manual bet from its own feed, so client-sent odds are ignored.
- **Secrets:** the Odds API key lives only on the server (it used to be shipped to the browser).
- **Data:** stored in `data/` (git-ignored, files mode 600) with daily backups kept for 14 days.

To change a password, run `create-user` again with the same name.

## Later: put it online 24/7

Not needed for local use. These files are only for hosting: `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.env.example`.

### Option A: rented server with Docker (recommended)

A small VPS costs about €4–6 a month (Hetzner, DigitalOcean, etc.). You also need a domain or subdomain.

1. Point a DNS **A record** (e.g. `bets.yourdomain.com`) at the server's IP.
2. On the server, install Docker, copy this folder, then:
   ```bash
   cp .env.example .env        # set DOMAIN=bets.yourdomain.com (and ODDS_API_KEY if you have one)
   docker compose up -d --build
   docker compose exec app node server/scripts/create-user.js yourname --totp
   ```
3. Open `https://bets.yourdomain.com`. Caddy obtains and renews the HTTPS certificate automatically.

Hardening for the VPS:

- Allow only ports 22, 80 and 443 (`ufw allow OpenSSH; ufw allow 80,443/tcp; ufw enable`).
- Use SSH keys and disable password login.
- Enable unattended security upgrades.

To update, copy the new code and run `docker compose up -d --build`. Data lives in the `app_data` volume.

### Option B: this PC + Cloudflare Tunnel (free, no port forwarding)

Your PC must stay on. You need a free Cloudflare account with your domain on it.

1. In `.env`, set `TRUST_PROXY=cloudflare` and `HOST=127.0.0.1`. Then run `npm run build` and `npm start`.
2. Install `cloudflared`, then run `cloudflared tunnel login` and `cloudflared tunnel create bets`.
3. Route it with `cloudflared tunnel route dns bets bets.yourdomain.com`.
4. Start it with `cloudflared tunnel run --url http://127.0.0.1:8787 bets`.
5. Start both commands automatically at boot, using Task Scheduler or `cloudflared service install`.
6. Optional: add **Cloudflare Access** in front for a second login wall.
