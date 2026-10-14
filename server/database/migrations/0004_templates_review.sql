-- 0004_templates_review.sql · 模板审核字段（幂等）
ALTER TABLE templates ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved';
-- pending: 待审核, approved: 官方精选/已通过, rejected: 已拒绝
CREATE INDEX IF NOT EXISTS idx_templates_review_status ON templates (review_status);
