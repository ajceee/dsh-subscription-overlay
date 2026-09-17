import type { UserConfig } from 'tsdown'

const PLUGIN_ID = '@dsh-external/dsh-subscription-overlay'
const clientExternals = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-store',
]

const hostBundle = {
  entry: { index: 'src/index.ts' }, outDir: 'lib', format: 'esm', platform: 'node',
  dts: false, sourcemap: true, clean: false,
  deps: { neverBundle: ['@deepseek-ai/schemastery', '@deepseek-ai/dsh-credentials'], alwaysBundle: (id) => !id.startsWith('node:') && !id.startsWith('@deepseek-ai/') },
  outputOptions: { entryFileNames: 'index.js' },
}

const clientBundle = {
  entry: { client: 'src/client/index.ts' }, outDir: 'lib', format: 'cjs', platform: 'browser',
  dts: false, sourcemap: true, clean: false,
  deps: {
    neverBundle: clientExternals,
    alwaysBundle: (id) => !clientExternals.includes(id),
  },
  outputOptions: {
    entryFileNames: 'client.js', codeSplitting: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [hostBundle, clientBundle]
