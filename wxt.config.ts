import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Prism',
    short_name: 'Prism',
    version: '0.1.0',
    description: 'Prism Chrome DevTools API mapping extension',
    permissions: ['cookies', 'activeTab'],
    host_permissions: ['<all_urls>'],
  },
});
