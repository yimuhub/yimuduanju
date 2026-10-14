-- 0005_rename_provider.sql · 统一供应商显示名称（幂等）
UPDATE model_providers SET name = '火山方舟' WHERE name = '火山方舟（豆包）';
