-- 001_routing.sql — هيكل سجل الأداء والملخصات (مرحلة 3b)
-- يعمل مع Postgres الموجود في البنية الحالية

CREATE TABLE IF NOT EXISTS routing_summaries (
  id SERIAL PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS routing_feedback (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('code','creative','analysis','retrieval','general')),
  model TEXT NOT NULL,
  quality_score DOUBLE PRECISION NOT NULL CHECK (quality_score >=0 AND quality_score <=1),
  latency_ms INTEGER,
  regenerated BOOLEAN DEFAULT FALSE,
  manual_correction BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_cat_model ON routing_feedback(category, model);
CREATE INDEX IF NOT EXISTS idx_summaries_created ON routing_summaries(created_at DESC);

-- إعدادات المستخدم — تثبيت نموذج لفئة (تجاوز كامل للتوجيه)
CREATE TABLE IF NOT EXISTS user_routing_prefs (
  user_id TEXT PRIMARY KEY,
  prefs JSONB NOT NULL DEFAULT '{}'::jsonb, -- { "code":"strong-code", "creative":"claude" }
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- عرض مجمع لمراقبة regenRate ومتوسط الجودة
CREATE OR REPLACE VIEW routing_stats AS
SELECT
  category, model,
  COUNT(*) AS samples,
  AVG(quality_score)::numeric(4,3) AS avg_quality,
  AVG(latency_ms)::numeric(8,1) AS avg_latency,
  SUM(CASE WHEN regenerated THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*),0) AS regen_rate
FROM routing_feedback
GROUP BY category, model;
