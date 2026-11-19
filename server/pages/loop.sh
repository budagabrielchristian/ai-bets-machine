#!/usr/bin/env bash
# Runs inside GitHub Actions: one engine pass every 15 minutes for about 5h20m,
# then starts the next run of this workflow, so the AIs never stop.
# Needs: DASHBOARD_PASSWORD, GH_TOKEN, GITHUB_REPOSITORY (set by Actions).
set -u

ROUND=${ROUND_SECONDS:-900}                       # 15 minutes between passes
LIMIT=${LOOP_SECONDS:-$((5 * 3600 + 20 * 60))}    # jobs may run 6 h at most
REMOTE=${REMOTE_URL:-"https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"}  # REMOTE_URL: tests only

BOT=(-c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com")

while :; do
  started=$SECONDS
  echo "=== Pass at $(date -u +%H:%MZ)"
  # Pick up new code pushed to main since the last pass (this script runs from a
  # temporary copy, so updating the checkout is safe).
  if [ -z "${REMOTE_URL:-}" ] && git fetch -q origin main; then
    lock=$(git rev-parse HEAD:package-lock.json 2>/dev/null)
    git reset -q --hard FETCH_HEAD && echo "Code: $(git log -1 --format='%h %s')"
    [ "$lock" != "$(git rev-parse HEAD:package-lock.json 2>/dev/null)" ] && npm ci --silent
  fi
  rm -rf vault && mkdir -p vault
  # Load the last saved (encrypted) state, if any.
  if git fetch -q --depth=1 "$REMOTE" data 2>/dev/null; then git archive FETCH_HEAD | tar -x -C vault; fi

  if node server/pages/run-once.js --vault vault --out vault/data.enc.json; then
    # Save state + dashboard data as a single commit that replaces the last one.
    ( cd vault && git init -q -b data && git add -A &&
      git "${BOT[@]}" commit -q -m "Engine state $(date -u +%Y-%m-%dT%H:%MZ)" &&
      git push -q -f "$REMOTE" data ) || echo "::warning::Saving the state failed; it will be retried next pass."
  else
    echo "::warning::Engine pass failed; retrying next pass."
  fi

  (( SECONDS >= LIMIT )) && break
  wait=$(( ROUND - (SECONDS - started) )); (( wait < 60 )) && wait=60
  sleep "$wait"
done

# Hand over to a fresh run (allowed for workflow_dispatch with the job token).
echo "=== Handing over to the next run"
curl -fsS -X POST -H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/engine.yml/dispatches" \
  -d '{"ref":"main"}' || echo "::warning::Hand-over failed; the hourly schedule will restart the loop."
