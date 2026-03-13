# Workflow Final Output — Smart Results Panel

## Overview
Replace the current raw text/JSON output in the WorkflowRunPanel with a rich, three-section results view that appears after workflow completion. Combines Smart Output Card (#1), Pipeline Summary (#2), and Action-Ready Output (#7).

## Architecture

### New Component: `WorkflowResultsPanel.tsx`
A new component that replaces the "Live" tab content in WorkflowRunPanel after workflow completion. It receives `nodeRunDataMap` and `nodeLogs` as props.

### Three Sections

**1. Pipeline Funnel Summary (top)**
- Horizontal funnel bar showing data flow across nodes
- Each stage: icon + node label + count (e.g., "12 contacts → 8 validated → 5 selected")
- Counts are auto-extracted from structured JSON (`contacts.length`, `top_contacts.length`, etc.)
- Colored segments narrowing left-to-right
- Clicking a stage scrolls to that node's detail section below

**2. Smart Output Table (middle — the star)**
- Renders the FINAL node's structured output as a formatted table
- Auto-detects contact arrays in the structured JSON (looks for arrays of objects with name/title/company fields)
- Table columns: Name, Title, Company, LinkedIn, Email, Score/Priority
- LinkedIn URLs → clickable link icons
- Email → shows with verification badge if available
- Score → colored badge (High/Medium/Low)
- If no contact array detected, falls back to the collapsible JSON tree (from NodeInspectorPanel)

**3. Action Bar (bottom — sticky)**
- "Copy as CSV" — copies the contact table as CSV to clipboard
- "Copy JSON" — copies raw structured JSON
- "Export" dropdown → future Lemlist push button (disabled/greyed with "Coming soon" tooltip)
- "Re-run" button to trigger a new workflow execution

## Changes to Existing Files

### `WorkflowRunPanel.tsx`
- Accept new props: `nodeRunDataMap`, `nodes` (to get labels/ordering)
- After workflow completes (`!isRunning && nodeLogs.length > 0 && all completed`), show a "Results" tab alongside "Live" and "History"
- "Results" tab renders `<WorkflowResultsPanel />`
- "Live" tab keeps the existing streaming logs view

### `WorkflowBuilder.tsx`
- Pass `nodeRunDataMap` and `nodes` to `WorkflowRunPanel`
- Add `workflow_finished` SSE event handling (or detect from all nodes completing)

### `app/api/workflows/run/route.ts`
- Add a `workflow_finished` SSE event at the end with:
  - `pipelineSummary`: array of `{ nodeId, label, contactCount }` for funnel
  - `finalOutput`: the last node's structured output (full JSON)
  - This avoids client-side guessing of data structure

## Data Extraction Strategy
The structured JSON from nodes varies but follows patterns:
- Node 1 (Org Chart): `{ contacts: [...], validation_summary: { confirmed_active: N } }`
- Node 2 (LinkedIn): `{ contacts: [...], enrichment_summary: { verified: N } }`
- Node 3 (ABM): `{ top_contacts: [...], outreach_sequences: [...] }`

The component will:
1. Look for arrays named `contacts`, `top_contacts`, `outreach_sequences`
2. Extract count from array length or from summary fields
3. For the table: use the final node's contact/top_contacts array
4. Each contact object maps: `name/full_name` → Name, `title` → Title, `company` → Company, `linkedin_url` → LinkedIn, `email` → Email, `priority/score` → Score

## File List
1. **NEW**: `components/workflows/WorkflowResultsPanel.tsx` — Smart results with funnel + table + actions
2. **EDIT**: `components/workflows/WorkflowRunPanel.tsx` — Add "Results" tab, pass through data
3. **EDIT**: `components/workflows/WorkflowBuilder.tsx` — Pass nodeRunDataMap/nodes to RunPanel
4. **EDIT**: `app/api/workflows/run/route.ts` — Add `workflow_finished` SSE event with summary
