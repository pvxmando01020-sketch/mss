export type Lang = 'ar' | 'en';

const STR = {
  ar: {
    appName: 'MSS — دردشة ذكية',
    tagline: 'بوابة موحدة متعددة النماذج',
    newChat: 'محادثة جديدة',
    history: 'المحادثات',
    emptyHistory: 'لا توجد محادثات بعد',
    send: 'إرسال',
    stop: 'إيقاف',
    regenerate: 'إعادة التوليد',
    attach: 'إرفاق صورة',
    removeAttach: 'إزالة الصورة',
    placeholder: 'اكتب رسالتك… (Enter للإرسال، Shift+Enter لسطر جديد)',
    auto: 'تلقائي',
    welcomeTitle: 'كيف أساعدك اليوم؟',
    welcomeText:
      'اترك الوضع التلقائي واكتب أي طلب — البوابة تختار النموذج الأنسب: كود، صورة، أو محادثة عامة. استخدم شريط النموذج في الأعلى للتبديل اليدوي.',
    s1: 'اكتب لي دالة debounce في TypeScript',
    s2: 'اشرح لي نمط Adapter بلغة بسيطة',
    s3: 'ما الفرق بين SSE و WebSocket؟',
    stopped: 'تم إيقاف التوليد',
    partialMsg: 'انقطع التوليد — هذه جزئية من الرد',
    retry: 'إعادة المحاولة',
    fallbackNotice: 'النموذج الأساسي تعذّر — تم التحويل تلقائياً إلى',
    moderationNotice: 'تنبيه: رُصدت أنماط قد تكون محاولة حقن (Prompt Injection) في النص',
    demoNotice:
      'وضع العرض: اضبط OPENAI_API_KEY / ANTHROPIC_API_KEY في الخادم لتفعيل النماذج الحقيقية',
    langLabel: 'EN',
    themeToggle: 'تبديل المظهر',
  },
  en: {
    appName: 'MSS — Smart Chat',
    tagline: 'Unified multi-model gateway',
    newChat: 'New chat',
    history: 'Chats',
    emptyHistory: 'No conversations yet',
    send: 'Send',
    stop: 'Stop',
    regenerate: 'Regenerate',
    attach: 'Attach image',
    removeAttach: 'Remove image',
    placeholder: 'Type a message… (Enter to send, Shift+Enter for a new line)',
    auto: 'Auto',
    welcomeTitle: 'How can I help today?',
    welcomeText:
      'Keep Auto mode and type anything — the gateway picks the best model: code, image or general chat. Use the top bar to switch manually.',
    s1: 'Write me a debounce function in TypeScript',
    s2: 'Explain the Adapter pattern simply',
    s3: 'What is the difference between SSE and WebSocket?',
    stopped: 'Generation stopped',
    partialMsg: 'Generation interrupted — partial response',
    retry: 'Retry',
    fallbackNotice: 'Primary model unavailable — automatically switched to',
    moderationNotice: 'Warning: possible prompt-injection patterns detected in the text',
    demoNotice:
      'Demo mode: set OPENAI_API_KEY / ANTHROPIC_API_KEY on the server to enable real models',
    langLabel: 'عربي',
    themeToggle: 'Toggle theme',
  },
} as const;

export type Strings = (typeof STR)['ar'];

export function translate(lang: Lang): Record<string, string> {
  return STR[lang] as unknown as Record<string, string>;
}
