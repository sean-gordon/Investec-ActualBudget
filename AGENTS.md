# Repository Guidelines

## Project Structure & Module Organization

This repository contains a Vite React dashboard and an Express backend for syncing Investec transactions into Actual Budget. Frontend entry points live at `index.html`, `index.tsx`, and `App.tsx`; reusable UI components are in `components/`. Shared TypeScript shapes are in `types.ts`. The backend and sync engine live in `server.js`. Docker deployment files are `Dockerfile`, `docker-compose.yml`, and `nginx.conf`. Generated or local-only directories include `dist/`, `node_modules/`, and `data/`.

## Build, Test, and Development Commands

- `npm install`: install frontend and backend dependencies from `package-lock.json`.
- `npm run dev`: start the Vite dev server on port `5173`; API calls proxy to `http://127.0.0.1:46490`.
- `npm start`: run the Express backend on `PORT` or `46490`.
- `npm run build`: run TypeScript checks and build the Vite production bundle into `dist/`.
- `npm run test:static`: verify feature spreadsheet integrity and critical update/build invariants without starting services.
- `npm run preview`: serve the built frontend locally through Vite preview.
- `docker compose up --build`: build and run the containerized app with `./data` mounted for persistent settings.

## Coding Style & Naming Conventions

Use TypeScript and React function components for UI code. Keep component filenames in PascalCase, such as `SettingsForm.tsx`, and align exported component names with filenames. Use camelCase for variables, state setters, and functions. Existing code uses two-space indentation in TSX and semicolons. Prefer shared interfaces in `types.ts` when data crosses component or API boundaries. Keep backend constants near the top of `server.js`.

## Testing Guidelines

No test framework is currently configured. Treat `npm run build` as the minimum verification gate before submitting changes. For backend changes, run `npm start` and exercise the affected `/api` route from the UI or a local HTTP client. When adding tests, use names like `SettingsForm.test.tsx` or `server.test.js`.

## Commit & Pull Request Guidelines

Recent commits use short, prefixed subjects such as `Fix: ...`, `Chore: ...`, `Build: ...`, and `Security hardening: ...`. Keep commits focused and imperative. Pull requests should describe the user-visible change, list verification performed, note Docker or environment changes, and include screenshots for UI updates.

## Security & Configuration Tips

Never commit secrets, `data/settings.json`, logs, or local budget files. For deployment, set `APP_PASSWORD` instead of relying on the development default. Be careful with changes to Docker socket access, update logic, and credential handling paths.
