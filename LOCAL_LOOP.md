# Local loop for this cloud container (not in the repo)

## Backend
Postgres 16 + pgvector runs on localhost:5432. Role and password: popping_test (superuser).

    . /root/popping-env/venv/bin/activate
    cd <checkout>/backend
    PYTHONPATH=<checkout>/backend POSTGRES_HOST=localhost POSTGRES_PORT=5432 \
      POSTGRES_USER=popping_test POSTGRES_PASSWORD=popping_test POSTGRES_DB=<db> \
      pytest -q -p no:cacheprovider -ra

- `<db>`: `popping_test` for backend-track work, `popping_test_f` for frontend-track work, so two agents never share a database.
- The venv has the main checkout's backend installed in editable mode. In a git worktree, set `PYTHONPATH=<worktree>/backend` so `app` is imported from the worktree.
- Baseline on main 4be8766: 719 passed, 13 failed. The 13 fail only because this container has no DNS (example.com lookups and two network hook tests); they pass in CI. The list is in `/root/popping-env/baseline.txt`. Any other failure is real.
- torch is not installed (its index is blocked here); CI installs it. A test that needs torch fails here only; note it, don't change it.

## Frontend

    cd <checkout>/frontend
    # In a worktree without node_modules:
    ln -s /home/user/popping/frontend/node_modules node_modules
    npm run lint && npm run build && node --experimental-strip-types --test 'scripts/unit/*.test.ts'
    nohup ./node_modules/.bin/vite preview --host 127.0.0.1 --port <port> --strictPort > /tmp/preview-<port>.log 2>&1 &
    node scripts/iphone-audit/smoke.cjs http://127.0.0.1:<port> --csp --strict

- Playwright 1.56.1 is installed, unsaved, in `/home/user/popping/frontend/node_modules`. Chromium is in `/opt/pw-browsers`.
- The strict smoke takes about 3 minutes on main and reports 0 failures.
- `<port>`: 4173 for frontend-track work, 4174 for a second preview.
- Stop the preview by PID (`kill <pid>`), not with `pkill -f`: a `pkill -f` pattern also matches the shell running it.
- `git diff --exit-code package.json package-lock.json` must stay clean.
