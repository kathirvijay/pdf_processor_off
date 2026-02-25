-- Saved layout/design (boxes, positions) for reuse; user maps standardized keys to boxes.
CREATE TABLE IF NOT EXISTS template_designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  standardized_template_id UUID REFERENCES standardized_templates(id),
  design JSONB NOT NULL DEFAULT '{"pages":[{"boxes":[]}]}',
  settings JSONB DEFAULT '{"pageSize":"A4","orientation":"portrait"}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE template_designs IS 'Saved canvas layout; load design then map keys from standardized template';
