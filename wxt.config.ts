import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Prism',
    short_name: 'Prism',
    version: '0.1.0',
    description: 'Prism Chrome DevTools API mapping extension',
    permissions: ['cookies', 'activeTab', 'storage'],
    host_permissions: ['<all_urls>'],
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
      },
    },
  },
});
