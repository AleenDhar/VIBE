-- =============================================================================
-- deal-intelligence · Supabase Schema Migration
-- Project : deal-intelligence  (wfwgatyfzqzrcauatufb)
-- Region   : ap-south-1
-- Generated: 2026-02-21
--
-- Run this script on the TARGET Supabase / PostgreSQL database.
-- NOTE: Tables that reference auth.users require the Supabase Auth schema
--       to already exist on the target (it does on every Supabase project).
-- =============================================================================

-- Enable pgcrypto if not already enabled (needed for gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- -----------------------------------------------------------------------------
-- 1. profiles
--    References: auth.users (id)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id          uuid        NOT NULL,
  updated_at  timestamptz,
  username    text        UNIQUE CONSTRAINT username_min_length CHECK (char_length(username) >= 3),
  full_name   text,
  avatar_url  text,
  role        text        DEFAULT 'user'::text
                          CHECK (role = ANY (ARRAY['admin'::text, 'user'::text, 'super_admin'::text])),

  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- 2. projects
--    References: public.profiles (owner_id)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projects (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  description   text,
  owner_id      uuid        NOT NULL,
  system_prompt text,
  created_at    timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  status        text        DEFAULT 'active'::text,
  visibility    text        DEFAULT 'private'::text
                            CHECK (visibility = ANY (ARRAY['private'::text, 'public'::text, 'shared'::text])),

  CONSTRAINT projects_pkey       PRIMARY KEY (id),
  CONSTRAINT projects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles (id) ON DELETE CASCADE
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- 3. documents
--    References: public.projects (project_id)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.documents (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  project_id  uuid        NOT NULL,
  name        text        NOT NULL,
  file_path   text        NOT NULL,
  content     text,
  created_at  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT documents_pkey           PRIMARY KEY (id),
  CONSTRAINT documents_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects (id) ON DELETE CASCADE
);

-- RLS is disabled on this table in the source project
-- ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- 4. chats
--    References: public.projects (project_id), auth.users (user_id)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chats (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  project_id  uuid,
  user_id     uuid,
  title       text        DEFAULT 'New Chat'::text,
  is_starred  boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT chats_pkey            PRIMARY KEY (id),
  CONSTRAINT chats_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects (id) ON DELETE CASCADE,
  CONSTRAINT chats_user_id_fkey    FOREIGN KEY (user_id)    REFERENCES auth.users (id)       ON DELETE SET NULL
);

ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- 5. chat_messages
--    References: public.chats (chat_id)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  chat_id     uuid        NOT NULL,
  role        text        NOT NULL CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text])),
  content     text        NOT NULL,
  type        text        DEFAULT 'message'::text,
  sequence    integer     DEFAULT 0,
  metadata    jsonb       DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT chat_messages_pkey        PRIMARY KEY (id),
  CONSTRAINT chat_messages_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats (id) ON DELETE CASCADE
);

-- RLS is disabled on this table in the source project
-- ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- 6. project_memories
--    References: public.projects (project_id), public.chats (source_chat_id)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_memories (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  project_id     uuid        NOT NULL,
  memory_type    text        NOT NULL
                             CHECK (memory_type = ANY (ARRAY['insight'::text, 'preference'::text, 'issue'::text, 'solution'::text, 'feedback'::text])),
  content        text        NOT NULL,
  sentiment      text        CHECK (sentiment = ANY (ARRAY['positive'::text, 'negative'::text, 'neutral'::text])),
  importance     integer     CHECK (importance >= 1 AND importance <= 10),
  source_chat_id uuid,
  metadata       jsonb       DEFAULT '{}'::jsonb,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),

  CONSTRAINT project_memories_pkey              PRIMARY KEY (id),
  CONSTRAINT project_memories_project_id_fkey   FOREIGN KEY (project_id)     REFERENCES public.projects (id) ON DELETE CASCADE,
  CONSTRAINT project_memories_source_chat_id_fkey FOREIGN KEY (source_chat_id) REFERENCES public.chats (id)    ON DELETE SET NULL
);

ALTER TABLE public.project_memories ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- 7. system_settings
--    References: public.profiles (updated_by)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_settings (
  key        text        NOT NULL,
  value      jsonb       NOT NULL,
  updated_by uuid,
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT system_settings_pkey           PRIMARY KEY (key),
  CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles (id) ON DELETE SET NULL
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- 8. app_config
--    References: auth.users (updated_by)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_config (
  key        text        NOT NULL,
  value      text        NOT NULL,
  updated_by uuid,
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT app_config_pkey           PRIMARY KEY (key),
  CONSTRAINT app_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users (id) ON DELETE SET NULL
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- 9. builder_sessions
--    References: auth.users (user_id)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.builder_sessions (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL,
  title       text        DEFAULT 'Untitled App'::text,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT builder_sessions_pkey         PRIMARY KEY (id),
  CONSTRAINT builder_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

ALTER TABLE public.builder_sessions ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- 10. builder_messages
--     References: public.builder_sessions (session_id)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.builder_messages (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid        NOT NULL,
  role       text        NOT NULL CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text])),
  content    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT builder_messages_pkey            PRIMARY KEY (id),
  CONSTRAINT builder_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.builder_sessions (id) ON DELETE CASCADE
);

ALTER TABLE public.builder_messages ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- 11. builder_artifacts
--     References: public.builder_sessions (session_id),
--                 public.builder_messages  (message_id)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.builder_artifacts (
  id         uuid    NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid    NOT NULL,
  message_id uuid,
  code       text    NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT builder_artifacts_pkey            PRIMARY KEY (id),
  CONSTRAINT builder_artifacts_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.builder_sessions (id) ON DELETE CASCADE,
  CONSTRAINT builder_artifacts_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.builder_messages  (id) ON DELETE SET NULL
);

ALTER TABLE public.builder_artifacts ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- 12. published_apps
--     References: auth.users (user_id)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.published_apps (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id      uuid,
  slug         text        NOT NULL UNIQUE,
  html_content text        NOT NULL,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),

  CONSTRAINT published_apps_pkey         PRIMARY KEY (id),
  CONSTRAINT published_apps_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL
);

ALTER TABLE public.published_apps ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
