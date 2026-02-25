-- Standardized template formats (e.g. Bill of Lading) with fixed allowed key-value variables.
CREATE TABLE IF NOT EXISTS standardized_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE,
  description TEXT,
  key_value_pairs JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE standardized_templates IS 'Predefined formats; key_value_pairs = array of { key, label }';
COMMENT ON COLUMN standardized_templates.key_value_pairs IS 'Only these keys allowed when creating a template from this standard';
