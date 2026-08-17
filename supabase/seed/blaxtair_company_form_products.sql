-- Blaxtair pilot seed for company_form_products.
-- Run ONLY after 20260730120000_company_form_products.sql is applied and reviewed.
-- Does not remove registry Blaxtair entries; DB rows override registry when present.
-- Company id is the existing production Blaxtair UUID (do not re-create the company).

-- Primary: four Blaxtair devices → PPD base, or SSC Speed (standalone add-to-existing-system) → Speed SSC base
-- Additional: SSC Speed pairs with a device; a device pairs with SSC Speed (never two devices)

insert into public.company_form_products (
  company_id,
  product_key,
  display_label,
  base_form_id,
  section_key,
  submission_type,
  draft_key,
  allow_primary,
  allow_additional,
  active,
  display_order,
  configuration
)
values
  (
    'b3d9abe4-e457-4bb4-935b-4bb01920df89',
    'blaxtair_ahd',
    'Blaxtair AHD',
    'ppd',
    'blaxtair_ahd',
    'blaxtair_ahd',
    'blaxtair_ahd',
    true,
    false,
    true,
    200,
    '{"allowedAdditionalProductKeys":["blaxtair_ssc_speed"],"maxAdditionalCount":1}'::jsonb
  ),
  (
    'b3d9abe4-e457-4bb4-935b-4bb01920df89',
    'blaxtair_mr130_mr260',
    'Blaxtair MR130-MR260',
    'ppd',
    'blaxtair_mr130_mr260',
    'blaxtair_mr130_mr260',
    'blaxtair_mr130_mr260',
    true,
    false,
    true,
    210,
    '{"allowedAdditionalProductKeys":["blaxtair_ssc_speed"],"maxAdditionalCount":1}'::jsonb
  ),
  (
    'b3d9abe4-e457-4bb4-935b-4bb01920df89',
    'blaxtair_origin',
    'Blaxtair Origin',
    'ppd',
    'blaxtair_origin',
    'blaxtair_origin',
    'blaxtair_origin',
    true,
    false,
    true,
    220,
    '{"allowedAdditionalProductKeys":["blaxtair_ssc_speed"],"maxAdditionalCount":1}'::jsonb
  ),
  (
    'b3d9abe4-e457-4bb4-935b-4bb01920df89',
    'blaxtair_3',
    'Blaxtair 3',
    'ppd',
    'blaxtair_3',
    'blaxtair_3',
    'blaxtair_3',
    true,
    false,
    true,
    230,
    '{"allowedAdditionalProductKeys":["blaxtair_ssc_speed"],"maxAdditionalCount":1}'::jsonb
  ),
  (
    'b3d9abe4-e457-4bb4-935b-4bb01920df89',
    'blaxtair_ssc_speed',
    'SSC Speed',
    'speed_ssc',
    'blaxtair_ssc_speed',
    'blaxtair_ssc_speed',
    'blaxtair_ssc_speed',
    true,
    true,
    true,
    240,
    '{}'::jsonb
  ),
  (
    'b3d9abe4-e457-4bb4-935b-4bb01920df89',
    'blaxtair_5',
    'Blaxtair 5',
    'ppd',
    'blaxtair_5',
    'blaxtair_5',
    'blaxtair_5',
    true,
    false,
    true,
    250,
    '{"allowedAdditionalProductKeys":["blaxtair_ssc_speed"],"maxAdditionalCount":1}'::jsonb
  )
on conflict (company_id, product_key) do update set
  display_label = excluded.display_label,
  base_form_id = excluded.base_form_id,
  section_key = excluded.section_key,
  submission_type = excluded.submission_type,
  draft_key = excluded.draft_key,
  allow_primary = excluded.allow_primary,
  allow_additional = excluded.allow_additional,
  active = excluded.active,
  display_order = excluded.display_order,
  configuration = excluded.configuration,
  updated_at = now();
