-- Link template to a standardized format for validation (only allowed keys).
ALTER TABLE templates ADD COLUMN IF NOT EXISTS standardized_template_id UUID REFERENCES standardized_templates(id);
