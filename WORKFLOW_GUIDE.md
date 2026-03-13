# Workflow Builder - User Guide

## What Are Workflows?

Workflows let you chain multiple AI projects together into automated pipelines. Each workflow is a visual graph of connected nodes — you define which projects run, in what order, and how data flows between them. The output of one project becomes the input for the next.

**Example use case:** You have a "Research" project that gathers information on a topic and a "Writer" project that turns research into blog posts. A workflow connects them: the research output feeds directly into the writer, producing a finished article in one click.

---

## Getting Started

### Navigating to Workflows

1. From the sidebar, click **Workflows** to see your workflow list.
2. Click **New Workflow** to create a blank workflow, or click an existing one to open the builder.

### The Workflow Builder Interface

The builder has four main areas:

- **Header bar (top):** Workflow name, Save button, Run button, History button, and a back arrow to return to the workflow list.
- **Canvas (center):** The drag-and-drop area where you build your node graph.
- **Sidebar (right):** Shows details and settings for whatever node is currently selected.
- **Run Panel (bottom drawer):** Opens when you run a workflow or view history, showing live results or past execution details.

---

## Building a Workflow

### Nodes

There are two types of nodes:

1. **Trigger Node** — Every workflow starts with one. It defines how the workflow begins (manually or on a schedule). The trigger node appears with a purple/violet border.
2. **Project Node** — Represents one of your AI projects. Drag a project from the sidebar's project list onto the canvas to add it.

### Adding Nodes

- In the sidebar, you'll see a list of your available projects under **Available Projects**.
- **Drag** a project from the list onto the canvas to create a new Project node.
- Each project node shows the project name, a brief description, and connection handles.

### Connecting Nodes

- Hover over the bottom handle (small circle) of a node.
- Click and drag from that handle to the top handle of the next node.
- An edge (arrow) will appear connecting them. This means the output of the first node flows as input to the second.
- You can create branching flows — one node can feed into multiple downstream nodes.

### Deleting Nodes

- Select a node by clicking it on the canvas.
- In the sidebar, click the **Delete Node** button (trash icon).
- You can also press **Delete** or **Backspace** on your keyboard while a node is selected.
- Note: The Trigger node cannot be deleted.

### Saving

Click the **Save** button in the header (or look for the disk/save icon). This persists your node layout, connections, and any schedule settings to the database.

---

## Running a Workflow

### Manual Execution

1. Click the **Run** button (play icon) in the header.
2. A dialog appears asking for **trigger input** — this is the text prompt that kicks off the workflow.
3. Type your input and click **Run Workflow**.
4. The Run Panel opens at the bottom showing real-time progress.

### Understanding the Run Panel

When a workflow runs, you'll see:

- **Input tab:** Shows what you typed as the trigger input.
- **Results tab:** Shows each node executing in sequence:
  - A spinning indicator while a node is running.
  - A green checkmark when a node completes successfully.
  - A red X if a node fails.
  - Click on any completed node to expand and see its full output.
- **History tab:** Lists all previous runs with timestamps.

### Live Streaming

Results stream in real-time as each node executes. You don't need to wait for the entire workflow to finish — you can watch each step complete one by one.

---

## Viewing Run History

### Accessing History

1. Click the **History** button (clock icon) in the header bar. This opens the Run Panel directly to the History tab.
2. Alternatively, after running a workflow, switch to the **History** tab in the Run Panel.

### History List

Each entry shows:
- **Status** — success (green) or failed (red).
- **Timestamp** — when the run started (e.g., "2 hours ago").
- **Duration** — how long the run took (e.g., "45s").
- **Node count** — how many nodes were executed.
- **Trigger type** — "manual" or "schedule".

### Viewing Full Run Details

Click on any history entry to load its complete details:

- The panel header changes to show the run's timestamp with a **back arrow** to return to the history list.
- The **Results tab** displays every node that ran, with its full output — identical to what you'd see during a live run.
- You can expand/collapse individual node outputs to inspect results.

This is useful for debugging, comparing runs, or reviewing what a scheduled run produced while you were away.

---

## Scheduled (Automatic) Triggers

### What Are Scheduled Triggers?

Instead of manually clicking Run every time, you can configure a workflow to execute automatically on a recurring schedule — daily, weekly, on weekdays, etc.

### Setting Up a Schedule

1. **Select the Trigger node** on the canvas by clicking it.
2. In the sidebar, you'll see **Schedule Settings** appear.
3. Toggle **Enable Schedule** on.
4. Choose a **frequency preset**:
   - **Daily** — runs once per day
   - **Weekdays** — runs Monday through Friday
   - **Weekly** — runs once per week
   - **Monthly** — runs once per month
   - **Every 6 hours** / **Every 12 hours** — runs multiple times per day
   - **Custom** — enter your own cron expression
5. Set the **time** using the time picker.
6. Choose your **timezone** from the dropdown.
7. Enter **default input** — the text that will be used as the trigger input for scheduled runs.
8. Click **Save** to persist the schedule.

### How It Works

When a schedule is active:
- The Trigger node on the canvas changes its icon from a lightning bolt (manual) to a timer (scheduled).
- A purple badge appears below the node showing the schedule in human-readable form (e.g., "Weekdays at 09:00").
- At the scheduled time, the workflow runs automatically using your default input text.
- Results are recorded in the History tab with a "schedule" trigger label.

### Cron Expressions

For advanced users, the **Custom** preset lets you enter a standard 5-field cron expression:

```
┌───── minute (0-59)
│ ┌───── hour (0-23)
│ │ ┌───── day of month (1-31)
│ │ │ ┌───── month (1-12)
│ │ │ │ ┌───── day of week (0-6, Sun=0)
│ │ │ │ │
* * * * *
```

**Examples:**
- `0 9 * * *` — Every day at 9:00 AM
- `0 9 * * 1-5` — Weekdays at 9:00 AM
- `30 14 * * 1` — Every Monday at 2:30 PM
- `0 */6 * * *` — Every 6 hours
- `0 0 1 * *` — First day of every month at midnight

---

## Project Chaining

### How Chaining Works

The core power of workflows is **project chaining** — connecting multiple AI projects so they work together as a pipeline.

When you connect Project A to Project B with an edge:
1. Project A runs first with the trigger input.
2. Project A's output is automatically passed as the input to Project B.
3. Project B runs using that output, producing its own result.
4. If Project B connects to Project C, the chain continues.

### Execution Order

Nodes execute in **topological order** — meaning every node waits for all its upstream dependencies to complete before it starts. If Node C depends on both Node A and Node B, both A and B must finish before C begins.

### Branching and Parallel Execution

You can create branching workflows:
- One trigger feeding into multiple projects (fan-out).
- Multiple projects feeding into one project (fan-in — the combined outputs are concatenated).

---

## Troubleshooting

### Common Issues

**Workflow won't run:**
- Make sure you have at least one Project node connected to the Trigger node.
- Check that the projects referenced by your nodes still exist (haven't been deleted).
- Ensure your trigger input is not empty.

**A node shows "failed" status:**
- Click the failed node in the Results tab to see the error message.
- Common causes: the underlying project's AI prompt encountered an error, or the input was too long/malformed.
- Try running the project individually from the Projects page to isolate the issue.

**Scheduled workflow didn't run:**
- Verify the schedule is enabled (toggle is on) in the Trigger node settings.
- Check that you clicked **Save** after configuring the schedule.
- Confirm the timezone is correct — the schedule runs based on the timezone you selected.
- Check the History tab for any failed scheduled runs.

**Nodes appear but aren't connected:**
- You need edges (connections) between nodes. Drag from a source handle to a target handle.
- A workflow with unconnected nodes will only execute the nodes reachable from the Trigger.

**"No workspace found" error:**
- You must be a member of a workspace to create or run workflows.
- Contact your admin if you're not part of a workspace.

### Checking Execution Logs

1. Open the workflow and click **History** in the header.
2. Click on the specific run you want to inspect.
3. Expand each node to see its output or error message.
4. For scheduled runs, the trigger type will show "schedule" so you can distinguish them from manual runs.

---

## Quick Reference

| Action | How |
|---|---|
| Create a workflow | Workflows page > New Workflow |
| Add a project node | Drag from sidebar project list onto canvas |
| Connect nodes | Drag from bottom handle to top handle |
| Delete a node | Select it > Delete button in sidebar (or press Delete key) |
| Run manually | Click Run (play icon) > enter input > Run Workflow |
| View live results | Run Panel opens automatically during execution |
| View past runs | Click History (clock icon) in header |
| View run details | Click any entry in the History list |
| Set up a schedule | Select Trigger node > enable schedule in sidebar > Save |
| Save changes | Click Save button in header |
| Go back to list | Click the back arrow in the header |
