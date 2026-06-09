# CLAUDE.md — Kash

## Mandatory Rules

1. **Plan first, code second**
   Always create a plan before making changes.
   No implementation starts before the task is understood, scoped, and broken down into explicit steps.

2. **Use sub-agents for complex work**
   For complex tasks, act as an orchestrator.
   Break work into sub-tasks, delegate them to sub-agents when available, then consolidate outputs into a final coherent result.

3. **Log every error**
   Every error must be recorded with:
   - exact error message
   - context
   - probable cause
   - remediation attempt
   No error should be ignored or hidden.

4. **Run automatic tests after every task**
   After each completed task or sub-task, automatically run the relevant tests and verify the outcome before moving on.

5. **Fix errors before continuing**
   When an error or failing test is found, fix it immediately before starting new work.
   Never continue on top of a broken state.

---

## Project Overview

**Kash** is a personal budget tracking web app — pure HTML/CSS/JS, zero dependencies, zero build step.

Live: https://22romaain.github.io/Kash

### Stack
- `index.html` — single-page app, all tabs and sections declared here
- `css/style.css` — all styles, CSS variables, responsive rules
- `js/app.js` — all logic: state, rendering, events, charts

No framework. No npm. No bundler. Everything runs directly in the browser.

---

## Architecture

### State

All data lives in `localStorage` under the key `kash_data` (legacy: `floww_data`).

```js
state = {
  expenses: [{ id, amount, date, category, description }],
  budgets: { "YYYY-MM": { categoryId: amount } },     // per-category budgets
  monthBudgets: { "YYYY-MM": amount }                  // global monthly budget
}
```

`loadState()` reads and migrates on boot. `saveState()` persists after every mutation.

### Categories

Defined once in `CATEGORIES` (top of `app.js`). Fixed list — no custom categories:

| id | label |
|----|-------|
| `alimentation-necessaires` | Alimentation et nécessaires |
| `logement` | Logement |
| `transport` | Transport |
| `loisirs` | Loisirs |
| `abonnements` | Abonnements |
| `remboursement` | Remboursement |
| `autres` | Autres |

`CAT_MIGRATION` maps old category ids to new ones. Always call `migrateCategoryId(id)` before using a category id from stored data.

### Render Loop

`render()` is the single re-render entry point. It calls:
- `renderDashboard()` — hero blocks + month navigation
- `renderPieChart()` — SVG pie with annotations
- `renderBudgetPage()` — global budget input/save
- `renderBudgetCategories()` — per-category budget rows (inline expand)
- `renderExpensePage()` — expense rows by category (expand on hover)
- `applyExpenseSearch()` — filter visibility
- `renderCategorySelect()` — repopulate the `<select>` in the form
- `renderAnnualPage()` → `renderAnnualChart()` — annual SVG bar chart

Always call `render()` after any state mutation.

### Tabs

Three tabs, toggled via `.tab-btn[data-tab]` / `.tab-view#tab-{name}`:
- `overview` — dashboard + budget + expenses
- `annual` — year bar chart (lazy-rendered on tab activation)
- `insights` — AI analysis via external backend

### Detail Panel

`showBudgetDetail(catId)` and `showExpenseEdit(expenseId)` open a fixed overlay panel.
`hideDetail()` closes it. The backdrop (`#detailBackdrop`) click also closes it.

### Annual Chart

`buildAnnualSVG(data, selectedMonth, viewBox, showAnnotations)` returns raw SVG markup.
Click on a month bar → zoom in (animated `viewBox` transition) → stacked category bars + annotations.
Click again or anywhere outside → zoom out.

### Insights

`runAnalysis()` POSTs to `https://kash-backend-production-8350.up.railway.app/analyze`.
Result stored in `insightsState` (module-level object). Rendered by `renderInsightsPage()`.

---

## Key Conventions

- **Date format:** `YYYY-MM-DD` strings (ISO), never Date objects in storage
- **Month key:** `YYYY-MM` via `monthKey(date)`
- **Currency:** always `formatCurrency(n)` → `Intl.NumberFormat fr-FR EUR`
- **HTML escaping:** always `escapeHtml(str)` before injecting user content into innerHTML
- **IDs:** `generateId()` → `crypto.randomUUID()` with fallback
- **No frameworks:** do not introduce React, Vue, or any npm dependency
- **No build step:** all files must run as-is in the browser via `file://` or a static server

---

## File Map

```
kash/
├── CLAUDE.md
├── index.html          ← structure, all tabs, form, static category rows
├── css/
│   └── style.css       ← all styles + CSS variables
└── js/
    └── app.js          ← all logic, state, rendering, events
```

---

## Common Tasks

### Add an expense category
1. Add entry to `CATEGORIES` array in `app.js`
2. Add static `.expense-cat-row` block in `index.html` (copy existing pattern)
3. Check `CAT_MIGRATION` if renaming an existing id

### Change a color
Edit the `color` field in `CATEGORIES` — it propagates to pie chart, stacked bars, and budget indicators automatically.

### Add a new tab
1. Add `.tab-btn[data-tab="name"]` in `index.html`
2. Add `.tab-view#tab-name` wrapper in `index.html`
3. Add `case 'name':` in the tab-click handler in `app.js`

### Modify the insights prompt
Edit the POST body in `runAnalysis()` in `app.js`. The backend endpoint is external.
