import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MSS — دردشة ذكية متعددة النماذج',
  description: 'Unified multi-model AI chat gateway with streaming',
};

const themeScript = `(function(){try{var t=localStorage.getItem('mss-theme');if(t==='dark'||(!t&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}var l=localStorage.getItem('mss-lang')||'ar';document.documentElement.lang=l;document.documentElement.dir=(l==='ar'?'rtl':'ltr');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-screen overflow-hidden bg-ink-50 text-ink-900 antialiased dark:bg-ink-950 dark:text-ink-100">
        {children}
      </body>
    </html>
  );
}
