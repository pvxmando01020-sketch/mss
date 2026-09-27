-- 000_phase1_core.sql — البنية التحتية الأساسية للـ AI Chat Gateway (المرحلة 1)
-- Fastify + Postgres/Redis/S3 — الأساس الذي تبنى عليه المرحلتان 3 و 4

-- المستخدمون (للمرحلة 2 ستُضاف JWT، هنا الأساس)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  quota_daily INTEGER NOT NULL DEFAULT 1000,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- مفاتيح API (تبقى في backend فقط — لا تُرسل للعميل أبداً)
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('anthropic','google','moonshot','openai','custom')),
  key_hash TEXT NOT NULL, -- hash فقط، القيمة الأصلية في env أو Vault
  label TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- سجل النماذج المتاحة وإعداداتها (مرحلة 1 — قبل التوجيه الذكي)
CREATE TABLE IF NOT EXISTS gateway_models (
  id TEXT PRIMARY KEY, -- مثل 'claude', 'gemini', 'kimi', 'strong-code'
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  endpoint TEXT, -- URL إن وجد
  is_active BOOLEAN DEFAULT TRUE,
  cost_per_1k NUMERIC(6,4) DEFAULT 0,
  max_tokens INTEGER DEFAULT 4096,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO gateway_models (id, provider, label, is_active, cost_per_1k) VALUES
  ('claude','anthropic','Claude 3.5 Sonnet', true, 0.0150),
  ('strong-code','anthropic','Strong-Code (Claude Code)', true, 0.0180),
  ('accurate-math','openai','Accurate-Math (GPT-4o)', true, 0.0120),
  ('fast-cheap','google','Fast-Cheap (Gemini Flash)', true, 0.0010),
  ('gemini','google','Gemini 1.5 Pro', true, 0.0070),
  ('kimi','moonshot','Kimi (Moonshot)', true, 0.0060)
ON CONFLICT (id) DO NOTHING;

-- سجل الطلبات الخام (للمراقبة والـ retry/fallback)
CREATE TABLE IF NOT EXISTS gateway_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  model TEXT REFERENCES gateway_models(id),
  prompt TEXT NOT NULL,
  response TEXT,
  latency_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error','fallback','blocked')),
  error TEXT,
  tokens_prompt INTEGER,
  tokens_completion INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gateway_requests_model ON gateway_requests(model);
CREATE INDEX IF NOT EXISTS idx_gateway_requests_created ON gateway_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gateway_requests_user ON gateway_requests(user_id);

-- تخزين الملفات المرفوعة (S3 metadata)
CREATE TABLE IF NOT EXISTS gateway_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  s3_key TEXT NOT NULL,
  bucket TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- إعدادات عامة
CREATE TABLE IF NOT EXISTS gateway_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO gateway_settings (key, value) VALUES ('version', '"1.0.0"') ON CONFLICT (key) DO NOTHING;
