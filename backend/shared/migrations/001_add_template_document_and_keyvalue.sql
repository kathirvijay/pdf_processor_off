-- Add document_name and template_key_value to templates table.
-- Run this if your templates table was created before these columns were added.
-- PostgreSQL:
ALTER TABLE templates ADD COLUMN IF NOT EXISTS document_name VARCHAR(255);
ALTER TABLE templates ADD COLUMN IF NOT EXISTS template_key_value JSONB;

COMMENT ON COLUMN templates.document_name IS 'Name of the source document';
COMMENT ON COLUMN templates.template_key_value IS 'Extracted parameters as key-value JSON';
