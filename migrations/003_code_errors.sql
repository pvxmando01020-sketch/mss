-- 003_code_errors.sql — التعلم من أخطاء الكود والـ Vibe Code (التحديث الجديد)
-- يخزن كل خطأ مع سياقه ليُستخدم في تحديث أوزان التوجيه
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS code_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('code','vibe','creative','analysis','retrieval','general')),
  model TEXT NOT NULL,
  error_type TEXT NOT NULL CHECK (error_type IN ('syntax','runtime','logic','security','style','vibe_mismatch','test_fail','other')),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  code_snippet TEXT,
  error_message TEXT,
  vibe_context TEXT, -- وصف الـ vibe المطلوب (لـ vibe code)
  auto_detected BOOLEAN DEFAULT FALSE, -- هل اكتُشف تلقائياً عبر analyzer
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_code_errors_model ON code_errors(model, category);
CREATE INDEX IF NOT EXISTS idx_code_errors_type ON code_errors(error_type);
CREATE INDEX IF NOT EXISTS idx_code_errors_created ON code_errors(created_at DESC);

-- ملخص أخطاء لكل نموذج/فئة — يُستخدم لتعديل الأوزان بسرعة
CREATE TABLE IF NOT EXISTS code_error_stats (
  model TEXT NOT NULL,
  category TEXT NOT NULL,
  total_errors INTEGER DEFAULT 0,
  syntax_errors INTEGER DEFAULT 0,
  runtime_errors INTEGER DEFAULT 0,
  vibe_errors INTEGER DEFAULT 0,
  last_error_at TIMESTAMPTZ,
  error_rate DOUBLE PRECISION DEFAULT 0, -- errors / total requests
  PRIMARY KEY (model, category)
);

-- عرض لمراقبة معدل الخطأ لكل نموذج
CREATE OR REPLACE VIEW code_error_rates AS
SELECT
  model, category,
  COUNT(*) AS errors,
  COUNT(*) FILTER (WHERE severity IN ('high','critical')) AS critical_errors,
  AVG(CASE WHEN auto_detected THEN 1 ELSE 0 END)::numeric(3,2) AS auto_rate
FROM code_errors
GROUP BY model, category;
