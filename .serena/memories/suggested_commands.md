# Suggested commands
- `npm run dev` - Vite dev server on 5173
- `npm run build` - `tsc -b` for app/node/functions plus Vite build
- `npm run preview` - preview built bundle
- `npm run lint` or `npx eslint .` - lint
- `npm test` - Vitest unit tests
- `npm run test:e2e` - Playwright E2E locally
- `BASE_URL=https://tn-land-atlas.pages.dev npm run test:e2e` - production E2E
- `npm run build && npx wrangler pages dev dist --port 5180` - local full stack Pages Functions
- `npx wrangler pages deploy dist --project-name tn-land-atlas --branch main` - deploy after build