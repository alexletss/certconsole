-- Migration 002: departments table
-- Replaces hardcoded DEPARTMENTS array in web/index.html with DB-managed list.
-- Run once: psql -U postgres -d certtracker -f 002_departments.sql

CREATE TABLE IF NOT EXISTS public.departments (
id          text PRIMARY KEY,
label       text NOT NULL,
icon        text NOT NULL DEFAULT '🏢',
color       text NOT NULL DEFAULT '#6366f1',
sort_order  integer NOT NULL DEFAULT 0,
created_at  timestamptz NOT NULL DEFAULT now()
);

-- Allow PostgREST-style access
GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticator;

-- Seed with the original four hardcoded departments (light-theme hex values)
INSERT INTO public.departments (id, label, icon, color, sort_order) VALUES
('admin',     'Администрация', '🏛️', '#6366f1', 10),
('doctors',   'Врачи',         '🩺', '#10b981', 20),
('reception', 'Приёмка',       '📥', '#f59e0b', 30),
('kdl',       'КДЛ',           '🧪', '#06b6d4', 40)
ON CONFLICT (id) DO NOTHING;
