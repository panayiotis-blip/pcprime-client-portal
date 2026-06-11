-- Migration 113: per-user email signature
-- ========================================
-- Adds signature columns to user_smtp_settings. The send-via-outlook
-- Edge Function appends these to outbound mail so the recipient sees
-- a consistent firm signature (logo / contact / disclaimer).

alter table public.user_smtp_settings
  add column if not exists signature_html text,
  add column if not exists signature_text text;
