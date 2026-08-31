-- =====================================================================
-- 213: four policies still asked is_admin() directly  [REWRITTEN BY 214]
--
-- templates, report_lines, mapping_master and audit_log carried their own
-- is_admin() term, so a non-admin staff account would have signed in and
-- found no report lines, no template and no audit log -- empty reports.
-- 214 rewrites all four to defer to is_reporting_staff().
-- =====================================================================

set search_path to reporting, public;
-- Superseded in full by 214; no statements retained here.
