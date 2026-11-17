import {configDefaults, defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},
  // Playwright-спеки живут в e2e/ и запускаются через npm run test:e2e, не vitest.
  test:{exclude:[...configDefaults.exclude,'e2e/**']},
});
