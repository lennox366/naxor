import { build } from 'esbuild';
import path from 'path';
const root = path.resolve(import.meta.dirname, '..');
await build({
  entryPoints: [path.join(root, 'test/agent-entry.ts')],
  bundle: true, format: 'esm', platform: 'node',
  outfile: path.join(root, 'test/agent.bundle.mjs'),
  plugins: [{
    name: 'db-stub',
    setup(b) {
      b.onResolve({ filter: /(^|[\/])db(\.ts)?$/ }, () => ({ path: path.join(root, 'test/db-stub.ts') }));
    },
  }],
});
console.log('bundled');
