-- 010: optional service.availability_note in FSS 0.1.
--
-- A plain-language detail about whether a service is taking people
-- ("Waitlist until March"). Optional, so every existing record stays valid.

update fc_private.standard_schemas
 set schema_document = jsonb_set(schema_document, '{properties,service,properties,availability_note}',
  '{"type": ["string", "null"], "description": "Optional plain-language detail about availability, e.g. \"Waitlist until March\" or \"Paused while they rebuild\"."}'::jsonb)
 where standard = 'FSS';
