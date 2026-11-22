import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import App from './App.tsx';
import '@/assets/tailwind.css';
import { LocaleRoot } from '@/components/common/LocaleRoot';
import { initI18n } from '@/lib/i18n';
import { browser } from 'wxt/browser';

// Register all interactive tool UI components (side-effect)
import '@/components/chat/ui-registrations';

const requestedSession = new URLSearchParams(location.search).get('session');
const initialChatPath = requestedSession && /^[a-zA-Z0-9_-]{1,128}$/.test(requestedSession)
  ? `/chat/${requestedSession}`
  : '/chat/new';

// 先装好界面语言字典再渲染，免得首帧按浏览器语言画完再跳变（initI18n 永不 reject）。
// LocaleRoot 在 MemoryRouter 内层：切换语言 remount App 时路由位置保留（仍停在设置页）。
void Promise.all([initI18n(), browser.tabs.getCurrent().catch(() => undefined)]).then(([, standaloneTab]) => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <MemoryRouter initialEntries={[initialChatPath]}>
        <LocaleRoot>
          <App standaloneTab={standaloneTab} />
        </LocaleRoot>
      </MemoryRouter>
    </React.StrictMode>,
  );
});
