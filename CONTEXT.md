# Project Context: Zycus Deal Intelligence

## Overview
This is a **Next.js** application built with **TypeScript** and **Tailwind CSS**. It serves as a deal analytics and project management platform ("Deal Intelligence").

## Tech Stack
- **Framework**: Next.js 15+ (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4, `shadcn/ui` components, `lucide-react` icons.
- **Theming**: `next-themes` (Dark/Light mode support).
- **Backend/Auth**: Supabase (inferred from `lib/supabase` and auth components).

## Directory Structure

### `app/` (Routes)
- **`page.tsx`**: Public landing page. Contains:
    - `HomeContent`: Main hero section.
    - `LoginButton`: Auth trigger.
    - Redirect logic for Supabase auth callbacks.
- **`layout.tsx`**: Root layout. Wraps app in `ThemeProvider`.
- **`(platform)/`**: Protected application area (Dashboard).
    - **`layout.tsx`**: Wraps content in `DashboardClientLayout`.
    - **Sub-routes**: `dashboard`, `projects`, `analytics`, `admin`.

### `components/`
- **`layout/`**: Core layout components.
    - **`Sidebar.tsx`**:
        - Collapsible sidebar navigation.
        - Links: Dashboard, Projects, Deal Analytics, Users, Admin Panel, Settings.
        - Mobile responsive overlay.
    - **`Header.tsx`**:
        - Top navigation bar.
        - Displays current context title (e.g., Project Name).
        - User profile dropdown (Supabase auth integration).
        - Notifications bell.
    - **`DashboardClientLayout.tsx`**:
        - Manages sidebar collision state (`isCollapsed`) and mobile menu state.
- **`ui/`**: Reusable UI components (Button, DropdownMenu, etc.).
- **`auth/`**: Authentication related components (e.g., `LoginButton.tsx`).

### `lib/`
- **`supabase/`**: Supabase client/server connection utilities.
- **`utils.ts`**: Utility functions (likely `cn` for class merging).

## Key Features & Logic
1.  **Authentication**:
    - Uses Supabase Auth.
    - Landing page handles auth callbacks via `useEffect`.
    - Header displays user profile and "Sign Out" option.

2.  **Navigation**:
    - **Sidebar**: Responsive. Collapses on desktop, slides in on mobile.
    - **Header**: Dynamic title based on route/project context (fetches project name from Supabase).

3.  **Theming**:
    - Global CSS variables in `app/globals.css`.
    - Supports `dark` and `light` modes via `next-themes`.
    - Custom aesthetics: "Glassmorphism" utilities, custom gradients.

## Current state
- The project is set up with standard Next.js directory structure.
- Dependencies include `framer-motion`, `recharts`, `radix-ui` primitives.
- `eslint` and `typescript` are configured.
