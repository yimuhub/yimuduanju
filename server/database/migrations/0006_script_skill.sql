-- 0006_script_skill.sql · 剧本技能任务计费种子（幂等，可重复执行）
INSERT INTO model_pricing (model_key, job_type, tier, display_name, unit_price_cny, market_price_cny) VALUES
  ('official:script:standard', 'script', 'balanced', '官方·剧本技能', '0.10', '0.20'),
  ('official:script:pro',      'script', 'flagship', '官方·剧本技能旗舰', '0.25', '0.50')
ON CONFLICT (model_key) DO NOTHING;
