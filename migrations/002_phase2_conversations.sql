-- 002_phase2_conversations.sql — إدارة المحادثات والتخزين (المرحلة 2)
-- تُبنى فوق 000_phase1_core.sql وتحتضن سجل الأداء في 001_routing.sql

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'محادثة جديدة',
  model TEXT REFERENCES gateway_models(id),
  pinned_model TEXT, -- تثبيت نموذج لفئة (تجاوز التوجيه الذكي — من إعدادات Flutter)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  model TEXT REFERENCES gateway_models(id),
  category TEXT CHECK (category IN ('code','creative','analysis','retrieval','general')),
  confidence DOUBLE PRECISION,
  latency_ms INTEGER,
  tokens_prompt INTEGER,
  tokens_completion INTEGER,
  -- quality proxies للمرحلة 3b
  regenerated BOOLEAN DEFAULT FALSE,
  edited_length INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_category ON messages(category);

-- استخدام يومي للحصص (quota)
CREATE TABLE IF NOT EXISTS usage_daily (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  requests INTEGER DEFAULT 0,
  tokens_total INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- جلسات JWT (اختياري — لو استُخدم redis فهذا fallback)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- دالة تحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_conversations_updated ON conversations;
CREATE TRIGGER trg_conversations_updated BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
