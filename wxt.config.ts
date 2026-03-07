import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Gladium AI Network Snapshot',
    version: '0.1.0',
    description: 'Chrome DevTools Network Snapshot Extension',
    permissions: ['cookies', 'activeTab'],
    host_permissions: ['<all_urls>'],
  },
});
