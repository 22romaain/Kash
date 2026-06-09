
    const COLOR_PALETTE = [
      '#6b1a2e','#8c2d42','#a84558','#b86878','#c08d98','#bfaab0',
      '#9ca3af','#64748b','#374151','#0ea5e9','#10b981','#f59e0b',
      '#8b5cf6','#ef4444','#1a1d26',
    ];

    function nextCategoryColor() {
      const used = new Set((state.categories || []).map(c => c.color));
      return COLOR_PALETTE.find(c => !used.has(c))
        || COLOR_PALETTE[(state.categories || []).length % COLOR_PALETTE.length];
    }

    const CAT_MIGRATION = {
      necessaire: 'alimentation-necessaires',
      alimentation: 'alimentation-necessaires',
      sante: 'alimentation-necessaires',
      shopping: 'alimentation-necessaires',
      autre: 'autres',
    };

    function generateId() {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    }

    const STORAGE_KEY = 'kash_data';
    const LEGACY_STORAGE_KEY = 'floww_data';

    let state = loadState();
    let currentDate = new Date();
    let hoverTimer = null;
    let activeDetail = null;
    let annualSelectedMonth = null;
    let annualClickOutsideHandler = null;
    let insightsState = { loading: false, analysis: null, error: null, forMonth: null };

    function migrateCategoryId(id) {
      return CAT_MIGRATION[id] || id;
    }

    function migrateState(data) {
      data.expenses = (data.expenses || []).map(e => ({
        ...e,
        category: migrateCategoryId(e.category),
      }));
      if (data.budgets) {
        const newBudgets = {};
        for (const [month, budget] of Object.entries(data.budgets)) {
          newBudgets[month] = {};
          for (const [catId, amount] of Object.entries(budget)) {
            const newId = migrateCategoryId(catId);
            newBudgets[month][newId] = (newBudgets[month][newId] || 0) + amount;
          }
        }
        data.budgets = newBudgets;
      }
      delete data.customCategories;
      return data;
    }

    function loadState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return migrateState(JSON.parse(raw));
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy) {
          const data = migrateState(JSON.parse(legacy));
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
          return data;
        }
      } catch {}
      return { expenses: [], budgets: {}, monthBudgets: {}, categories: [] };
    }

    function saveState() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    function monthKey(date) {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    function prevMonthDate(date) {
      const d = new Date(date);
      d.setMonth(d.getMonth() - 1);
      return d;
    }

    function formatMonth(date) {
      const s = date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function formatMonthShort(date) {
      const s = date.toLocaleDateString('fr-FR', { month: 'short' });
      return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function formatCurrency(n) {
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
    }

    function formatDate(d) {
      return new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    }

    function getCat(id) {
      const migrated = migrateCategoryId(id);
      const found = (state.categories || []).find(c => c.id === migrated);
      if (found) return found;
      return {
        id: migrated,
        label: migrated.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        color: '#9ca3af',
        orphan: true,
      };
    }

    function getExpensesFor(date) {
      const key = monthKey(date);
      return state.expenses.filter(e => e.date.startsWith(key));
    }

    function getBudgetFor(date) {
      return state.budgets[monthKey(date)] || {};
    }

    function spentByCategory(date) {
      const map = {};
      (state.categories || []).forEach(c => map[c.id] = 0);
      getExpensesFor(date).forEach(e => {
        const id = migrateCategoryId(e.category);
        map[id] = (map[id] || 0) + e.amount;
      });
      return map;
    }

    function renderCategorySelect() {
      const select = document.getElementById('category');
      if (!select) return;
      const cats = state.categories || [];
      const current = select.value;
      select.innerHTML =
        `<option value="" disabled${!current ? ' selected' : ''}>Sélectionner une catégorie</option>` +
        cats.map(c =>
          `<option value="${c.id}">${escapeHtml(c.label)}</option>`
        ).join('');
      if (current && cats.some(c => c.id === current)) select.value = current;
    }

    function totalBudget(date = currentDate) {
      return state.monthBudgets[monthKey(date)] || 0;
    }

    function totalSpent(date = currentDate) {
      return getExpensesFor(date).reduce((s, e) => s + e.amount, 0);
    }

    function deltaLabel(current, previous) {
      if (previous === 0 && current === 0) return { text: 'Stable', cls: 'flat' };
      if (previous === 0) return { text: 'Nouveau', cls: 'up' };
      const pct = Math.round(((current - previous) / previous) * 100);
      if (pct === 0) return { text: 'Stable', cls: 'flat' };
      const sign = pct > 0 ? '+' : '';
      return { text: `${sign}${pct} %`, cls: pct > 0 ? 'up' : 'down' };
    }

    function pctOf(value, total) {
      if (!total) return null;
      return Math.round((value / total) * 100);
    }

    function pctDelta(current, previous) {
      if (current === null || previous === null) return { text: '—', cls: 'flat' };
      const diff = current - previous;
      if (diff === 0) return { text: 'Stable', cls: 'flat' };
      const sign = diff > 0 ? '+' : '';
      return { text: `${sign}${diff} pts`, cls: diff > 0 ? 'up' : 'down' };
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2500);
    }

    function escapeHtml(str) {
      const d = document.createElement('div');
      d.textContent = str;
      return d.innerHTML;
    }

    function progressClass(spent, budget) {
      if (!budget) return 'warn';
      const ratio = spent / budget;
      if (ratio > 1) return 'over';
      if (ratio > 0.8) return 'warn';
      return 'ok';
    }

    // --- Detail panel ---

    function hideDetail() {
      document.getElementById('detailPanel').classList.remove('visible');
      document.getElementById('detailBackdrop').classList.remove('visible');
      activeDetail = null;
    }

    function showBudgetDetail(catId) {
      const cat = getCat(catId);
      const budget = getBudgetFor(currentDate);
      const spent = spentByCategory(currentDate);
      const b = budget[catId] || 0;
      const s = spent[catId] || 0;
      const pct = b > 0 ? Math.min((s / b) * 100, 100) : 0;
      const cls = progressClass(s, b);

      activeDetail = { type: 'budget', catId };
      document.getElementById('detailPanel').innerHTML = `
        <div class="detail-header">
          <span class="cat-dot" style="background:${cat.color}"></span>
          <h3>${escapeHtml(cat.label)}</h3>
        </div>
        <div class="detail-stats">
          <div>
            <div class="detail-stat-label">Prévu</div>
            <div class="detail-stat-value">${b > 0 ? formatCurrency(b) : '—'}</div>
          </div>
          <div>
            <div class="detail-stat-label">Dépensé</div>
            <div class="detail-stat-value">${formatCurrency(s)}</div>
          </div>
        </div>
        ${b > 0 ? `<div class="progress-track"><div class="progress-fill ${cls}" style="width:${pct}%"></div></div>` : ''}
        <div class="detail-edit-label">Budget mensuel</div>
        <div class="detail-input-row">
          <input class="detail-input" type="number" id="detailBudgetInput" step="0.01" min="0"
            value="${b || ''}" placeholder="0">
          <span class="detail-input-currency">€</span>
        </div>
        <button class="detail-save-btn" id="detailSaveBudget">Enregistrer</button>
      `;
      document.getElementById('detailPanel').classList.add('visible');
      document.getElementById('detailBackdrop').classList.add('visible');

      document.getElementById('detailSaveBudget').onclick = () => {
        const raw = document.getElementById('detailBudgetInput').value.trim();
        const val = parseFloat(raw);
        const key = monthKey(currentDate);
        if (!state.budgets[key]) state.budgets[key] = {};
        if (raw !== '' && !isNaN(val)) state.budgets[key][catId] = val;
        else delete state.budgets[key][catId];
        saveState();
        render();
        hideDetail();
        showToast('Budget mis à jour');
      };
    }

    function bindCatHover(rows) {
      rows.forEach(row => {
        const catId = row.dataset.cat;
        row.addEventListener('mouseenter', () => {
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => showBudgetDetail(catId), 280);
        });
        row.addEventListener('mouseleave', () => clearTimeout(hoverTimer));
      });
    }

    function showExpenseEdit(expenseId) {
      const expense = state.expenses.find(e => e.id === expenseId);
      if (!expense) return;
      const cat = getCat(expense.category);

      activeDetail = { type: 'expense', expenseId };
      document.getElementById('detailPanel').innerHTML = `
        <div class="detail-header">
          <span class="cat-dot" style="background:${cat.color}"></span>
          <h3>Modifier la dépense</h3>
        </div>
        <div class="detail-edit-label" style="margin-bottom:6px;">Montant (€)</div>
        <div class="detail-input-row" style="margin-bottom:20px;">
          <input class="detail-input" type="number" id="editAmount" step="0.01" min="0.01"
            value="${expense.amount}" placeholder="0">
          <span class="detail-input-currency">€</span>
        </div>
        <div class="detail-edit-label" style="margin-bottom:6px;">Date</div>
        <input type="date" id="editDate" value="${expense.date}" style="margin-bottom:20px;">
        <div class="detail-edit-label" style="margin-bottom:6px;">Catégorie</div>
        <select id="editCategory" style="margin-bottom:20px;">
          ${(state.categories || []).map(c => `<option value="${c.id}"${c.id === migrateCategoryId(expense.category) ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
        </select>
        <div class="detail-edit-label" style="margin-bottom:6px;">Description</div>
        <textarea id="editDescription" style="margin-bottom:20px;">${escapeHtml(expense.description || '')}</textarea>
        <button class="detail-save-btn" id="editSaveBtn">Enregistrer</button>
      `;
      document.getElementById('detailPanel').classList.add('visible');
      document.getElementById('detailBackdrop').classList.add('visible');

      document.getElementById('editSaveBtn').onclick = () => {
        const amount = parseFloat(document.getElementById('editAmount').value);
        const date = document.getElementById('editDate').value;
        const category = document.getElementById('editCategory').value;
        const description = document.getElementById('editDescription').value.trim();
        if (!amount || !date || !category) return;
        const idx = state.expenses.findIndex(e => e.id === expenseId);
        if (idx !== -1) {
          state.expenses[idx] = { ...state.expenses[idx], amount, date, category, description };
          saveState();
          render();
          hideDetail();
          showToast('Dépense modifiée');
        }
      };
    }

    function bindExpenseDelete() {
      document.querySelectorAll('[data-del-expense]').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          state.expenses = state.expenses.filter(ex => ex.id !== btn.dataset.delExpense);
          saveState();
          render();
          showToast('Dépense supprimée');
        };
      });
      document.querySelectorAll('[data-edit-expense]').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          showExpenseEdit(btn.dataset.editExpense);
        };
      });
    }

    function renderExpenseItems(catId) {
      const expenses = getExpensesFor(currentDate)
        .filter(e => migrateCategoryId(e.category) === catId)
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

      if (expenses.length === 0) {
        return '<div class="expense-cat-empty">Aucune dépense</div>';
      }

      return expenses.map(e => `
        <div class="expense-cat-item">
          <div style="min-width:0;">
            ${e.description
              ? `<div class="expense-cat-item-desc">${escapeHtml(e.description)}</div>
                 <div class="expense-cat-item-meta">${formatDate(e.date)}</div>`
              : `<div class="expense-cat-item-desc">${formatDate(e.date)}</div>`}
          </div>
          <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
            <span class="expense-cat-item-amt">${formatCurrency(e.amount)}</span>
            <button type="button" class="btn btn-ghost btn-edit-expense" data-edit-expense="${e.id}">✎</button>
            <button type="button" class="btn btn-ghost" data-del-expense="${e.id}">✕</button>
          </div>
        </div>
      `).join('');
    }

    // --- Pie chart ---

    function renderPieChart(svgId = 'pieChart', tooltipId = 'pieTooltip') {
      const spent = spentByCategory(currentDate);
      const totalSpentAmt = Object.values(spent).reduce((s, v) => s + v, 0);
      const budget = totalBudget();
      const svg = document.getElementById(svgId);
      const tooltip = document.getElementById(tooltipId);
      if (!svg) return;

      const cx = 280, cy = 220, r = 130;

      if (budget === 0 && totalSpentAmt === 0) {
        // Cercle plein + annotation "Solde restant 100%" comme une tranche normale
        const lx1 = cx + (r + 4), ly1 = cy;
        const lx2 = cx + (r + 22), lY = cy;
        const lx3 = lx2 + 24, textX = lx3 + 5;
        svg.innerHTML = `
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="white" stroke="#d1d5db" stroke-width="1"/>
          <polyline points="${lx1},${ly1} ${lx2},${lY} ${lx3},${lY}"
            fill="none" stroke="#d1d5db" stroke-width="1.5" pointer-events="none"/>
          <text x="${textX}" y="${lY - 4}" text-anchor="start" pointer-events="none"
            font-family="Josefin Sans, sans-serif" font-size="18" font-weight="700" fill="#9ca3af">100%</text>
          <text x="${textX}" y="${lY + 13}" text-anchor="start" pointer-events="none"
            font-family="Josefin Sans, sans-serif" font-size="11" font-weight="600" fill="#9ca3af" letter-spacing="0.5">Solde restant</text>`;
        return;
      }

      // Base = budget si défini, sinon total dépensé
      const base = budget > 0 ? budget : totalSpentAmt;
      const remaining = base - totalSpentAmt;

      const slices = (state.categories || [])
        .filter(c => (spent[c.id] || 0) > 0)
        .map(c => ({ ...c, value: spent[c.id], pct: spent[c.id] / base }));

      // Part blanche = solde restant
      if (remaining > 0) {
        slices.push({
          id: 'solde',
          label: 'Solde restant',
          color: '#ffffff',
          strokeColor: '#d1d5db',
          value: remaining,
          pct: remaining / base,
          isRemaining: true,
        });
      }

      const GAP_DEG = slices.length > 1 ? 0.8 : 0;
      let angle = -90;
      let paths = '';
      const annotData = [];

      slices.forEach(slice => {
        const sliceDeg = slice.pct * 360 - GAP_DEG;
        const midRad = (angle + sliceDeg / 2) * Math.PI / 180;
        const startRad = angle * Math.PI / 180;
        const endRad   = (angle + sliceDeg) * Math.PI / 180;

        const x1 = (cx + r * Math.cos(startRad)).toFixed(2);
        const y1 = (cy + r * Math.sin(startRad)).toFixed(2);
        const x2 = (cx + r * Math.cos(endRad)).toFixed(2);
        const y2 = (cy + r * Math.sin(endRad)).toFixed(2);
        const largeArc = sliceDeg > 180 ? 1 : 0;
        const stroke = slice.strokeColor || '#f8f9fb';

        paths += `<path class="pie-slice"
          d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z"
          fill="${slice.color}" stroke="${stroke}" stroke-width="2"
          data-cat="${slice.id}"
          data-label="${escapeHtml(slice.label)}"
          data-value="${formatCurrency(slice.value)}"
          data-remaining="${slice.isRemaining ? '1' : '0'}"/>`;

        const elbowR = r + 22;
        const lx1    = cx + (r + 4) * Math.cos(midRad);
        const ly1    = cy + (r + 4) * Math.sin(midRad);
        const lx2    = cx + elbowR   * Math.cos(midRad);
        const ly2    = cy + elbowR   * Math.sin(midRad);
        const isRight = Math.cos(midRad) >= 0;
        const shortLabel = slice.label.length > 13 ? slice.label.slice(0, 12) + '…' : slice.label;

        annotData.push({
          lx1, ly1, lx2, lY: ly2, isRight,
          pct: Math.round(slice.pct * 100), shortLabel,
          labelColor: slice.isRemaining ? '#9ca3af' : '#1a1d26',
          subColor:   slice.isRemaining ? '#9ca3af' : '#374151',
          lineColor:  slice.isRemaining ? '#d1d5db' : '#94a3b8',
        });

        angle += slice.pct * 360;
      });

      // Deconflict labels per side (push overlapping ones down)
      const MIN_SPACING = 36;
      function deconflictPie(arr) {
        const sorted = [...arr].sort((a, b) => a.lY - b.lY);
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i].lY - sorted[i - 1].lY < MIN_SPACING)
            sorted[i].lY = sorted[i - 1].lY + MIN_SPACING;
        }
        return sorted;
      }

      const rightAnnots = deconflictPie(annotData.filter(a =>  a.isRight));
      const leftAnnots  = deconflictPie(annotData.filter(a => !a.isRight));

      let annotations = '';
      [...rightAnnots, ...leftAnnots].forEach(({ lx1, ly1, lx2, lY, isRight, pct, shortLabel, labelColor, subColor, lineColor }) => {
        const lx3   = lx2 + (isRight ? 24 : -24);
        const textX = lx3 + (isRight ?  5 :  -5);
        const anchor = isRight ? 'start' : 'end';

        annotations += `
          <polyline points="${lx1.toFixed(1)},${ly1.toFixed(1)} ${lx2.toFixed(1)},${lY.toFixed(1)} ${lx3.toFixed(1)},${lY.toFixed(1)}"
            fill="none" stroke="${lineColor}" stroke-width="1.5" pointer-events="none"/>
          <text x="${textX.toFixed(1)}" y="${(lY - 4).toFixed(1)}" text-anchor="${anchor}" pointer-events="none"
            font-family="Josefin Sans, sans-serif" font-size="18" font-weight="700" fill="${labelColor}">${pct}%</text>
          <text x="${textX.toFixed(1)}" y="${(lY + 13).toFixed(1)}" text-anchor="${anchor}" pointer-events="none"
            font-family="Josefin Sans, sans-serif" font-size="11" font-weight="600" fill="${subColor}" letter-spacing="0.5">${escapeHtml(shortLabel)}</text>`;
      });

      svg.innerHTML = paths + annotations;

      svg.querySelectorAll('.pie-slice').forEach(path => {
        path.addEventListener('mouseenter', () => {
          const isRemaining = path.dataset.remaining === '1';
          const catId = path.dataset.cat;

          if (tooltip) {
            if (isRemaining) {
              tooltip.innerHTML = `
                <div class="pie-tooltip-title">${path.dataset.label}</div>
                <div class="pie-tooltip-list">
                  <div class="pie-tooltip-item" style="font-weight:500;">${path.dataset.value}</div>
                </div>`;
            } else {
              const catExpenses = getExpensesFor(currentDate)
                .filter(e => migrateCategoryId(e.category) === catId);
              const descriptions = catExpenses
                .map(e => e.description || formatDate(e.date))
                .filter(Boolean);
              tooltip.innerHTML = `
                <div class="pie-tooltip-title">${path.dataset.label}</div>
                <div class="pie-tooltip-list">
                  ${descriptions.length
                    ? descriptions.map(d => `<div class="pie-tooltip-item">— ${escapeHtml(d)}</div>`).join('')
                    : '<div class="pie-tooltip-empty">Aucune description</div>'}
                </div>`;
            }
            tooltip.classList.add('visible');
          }
        });
        path.addEventListener('mousemove', (e) => {
          if (tooltip) {
            tooltip.style.left = (e.clientX + 18) + 'px';
            tooltip.style.top = (e.clientY - 12) + 'px';
          }
        });
        path.addEventListener('mouseleave', () => {
          if (tooltip) tooltip.classList.remove('visible');
        });
      });
    }

    // --- Render ---

    function renderDashboard() {
      const spent = totalSpent();
      const budget = totalBudget();
      const prev = prevMonthDate(currentDate);
      const prevSpent = totalSpent(prev);
      const prevBudget = totalBudget(prev);
      const budgetDelta = deltaLabel(budget, prevBudget);
      const remaining = budget - spent;
      const prevRemaining = prevBudget - prevSpent;

      document.getElementById('currentMonth').textContent = formatMonth(currentDate);
      document.getElementById('dashTitle').textContent = formatMonth(currentDate);

      const spentPct = pctOf(spent, budget);
      const prevSpentPct = pctOf(prevSpent, prevBudget);
      const remainPct = budget > 0 ? pctOf(remaining, budget) : null;
      const prevRemainPct = prevBudget > 0 ? pctOf(prevRemaining, prevBudget) : null;
      const spentPctDelta = pctDelta(spentPct, prevSpentPct);
      const remainPctDelta = pctDelta(remainPct, prevRemainPct);

      document.getElementById('dashHero').innerHTML = `
        <div class="dash-block dash-block--budget">
          <div class="dash-block-label">Budget du mois</div>
          <div class="dash-block-value accent">${budget > 0 ? formatCurrency(budget) : '—'}</div>
          <div class="dash-block-compare-label">Évolution du budget</div>
          <div class="dash-block-compare-value ${budgetDelta.cls}">${budgetDelta.text} par rapport à ${formatMonthShort(prev)}</div>
        </div>
        <div class="dash-block dash-block--spent">
          <div class="dash-block-label">Dépenses du mois</div>
          <div class="dash-block-value spent">${formatCurrency(spent)}</div>
          <div class="dash-block-compare-label">Taux de dépense</div>
          <div class="dash-block-compare-value ${spentPctDelta.cls}">${spentPct !== null ? spentPct + '\u00a0%' : '—'} · ${spentPctDelta.text} par rapport à ${formatMonthShort(prev)}</div>
        </div>
      `;

      document.getElementById('dashCompare').innerHTML = '';
    }

    function renderBudgetPage() {
      const current = totalBudget(currentDate);
      const prev = prevMonthDate(currentDate);
      const previous = totalBudget(prev);

      const input = document.getElementById('budgetAmount');
      const saveBtn = document.getElementById('saveBudgetBtn');
      const row = document.getElementById('budgetFieldRow');

      if (input && document.activeElement !== input) {
        input.value = current != null && state.monthBudgets[monthKey(currentDate)] !== undefined ? current : '';
      }

      if (row && saveBtn && input) {
        if (state.monthBudgets[monthKey(currentDate)] !== undefined) {
          row.classList.add('has-budget');
          saveBtn.classList.remove('visible');
          input.readOnly = true;
        } else {
          row.classList.remove('has-budget');
          input.readOnly = false;
          saveBtn.classList.toggle('visible', input.value.trim() !== '');
        }
      }

    }

    function renderExpensePage() {
      const cats = state.categories || [];
      const spent = spentByCategory(currentDate);
      const listEl = document.getElementById('expenseCatList');
      if (!listEl) return;

      if (cats.length === 0) {
        listEl.innerHTML = `<div class="expense-cats-empty">Créez des catégories dans l'onglet <strong>Budget</strong> pour commencer le suivi.</div>`;
        return;
      }

      listEl.innerHTML = cats.map(c => `
        <div class="expense-cat-row" data-cat="${c.id}">
          <div class="expense-cat-header">
            <div class="cat-row-left">
              <span class="cat-indicator"></span>
              <span class="cat-name">${escapeHtml(c.label)}</span>
            </div>
            <span class="cat-amount" data-amt="${c.id}">${formatCurrency(spent[c.id] || 0)}</span>
          </div>
          <div class="expense-cat-detail"><div class="expense-cat-detail-wrap"><div class="expense-cat-scroll" data-items="${c.id}"></div></div></div>
        </div>
      `).join('');

      cats.forEach(c => {
        const itemsEl = listEl.querySelector(`[data-items="${c.id}"]`);
        if (itemsEl) itemsEl.innerHTML = renderExpenseItems(c.id);
      });

      bindExpenseDelete();
      initExpenseCatRows();
    }

    function initExpenseCatRows() {
      document.querySelectorAll('.expense-cat-row').forEach(row => {
        if (row._catRowBound) return;
        row._catRowBound = true;
        const detail = row.querySelector('.expense-cat-detail');
        if (!detail) return;
        row.addEventListener('mouseenter', () => {
          detail.style.height = detail.scrollHeight + 'px';
        });
        row.addEventListener('mouseleave', () => {
          detail.style.height = '0';
        });
      });
    }

    // --- Expense search ---

    function applyExpenseSearch() {
      const q = (document.getElementById('expenseSearch')?.value || '').toLowerCase().trim();
      document.querySelectorAll('.expense-cat-row').forEach(row => {
        if (!q) { row.style.display = ''; return; }
        const catId = row.dataset.cat;
        const cat = getCat(catId);
        const catMatch = cat.label.toLowerCase().includes(q);
        const expenses = getExpensesFor(currentDate).filter(e => migrateCategoryId(e.category) === catId);
        const descMatch = expenses.some(e => (e.description || '').toLowerCase().includes(q));
        row.style.display = (catMatch || descMatch) ? '' : 'none';
      });
    }

    // --- Budget categories ---

    function renderBudgetCategories() {
      const catsEl = document.getElementById('budgetCats');
      if (!catsEl) return;

      const cats = state.categories || [];
      const spent = spentByCategory(currentDate);
      const budget = getBudgetFor(currentDate);

      const addFormHtml = `
        <div class="budget-add-cat" id="budgetAddCat">
          <button class="budget-add-cat-btn" id="budgetAddCatBtn" type="button">
            <span class="budget-add-cat-btn-icon">+</span>
            Nouvelle catégorie
          </button>
          <div class="budget-add-cat-form" id="budgetAddCatForm">
            <div class="budget-add-cat-inner">
              <input type="text" id="newCatName" class="budget-add-cat-input"
                placeholder="Nom de la catégorie" maxlength="40" autocomplete="off">
              <button type="button" id="newCatSave" class="budget-cat-save-btn visible">Créer</button>
            </div>
          </div>
        </div>`;

      if (cats.length === 0) {
        catsEl.innerHTML = `
          <div class="budget-cats">
            <div class="page-tag">Par catégorie</div>
            ${addFormHtml}
            <p class="budget-cats-empty">Aucune catégorie. Créez-en une pour planifier votre budget.</p>
          </div>`;
        bindBudgetCatAdd(catsEl);
        return;
      }

      const rows = cats.map(c => {
        const s = spent[c.id] || 0;
        const b = budget[c.id] || 0;
        const hasB = b > 0;
        const pct = hasB ? Math.min((s / b) * 100, 100) : 0;
        const cls = hasB ? progressClass(s, b) : '';
        const fillW = hasB ? pct.toFixed(1) + '%' : '0%';

        const amountHtml = hasB
          ? `${formatCurrency(s)}&nbsp;<span class="cat-amount-planned">/ ${formatCurrency(b)}</span>`
          : formatCurrency(s);

        return `
          <div class="budget-cat-entry" data-cat="${c.id}">
            <div class="budget-cat-entry-header">
              <div class="cat-row-left">
                <span class="cat-indicator"></span>
                <span class="cat-dot" style="background:${c.color}"></span>
                <span class="cat-name">${escapeHtml(c.label)}</span>
              </div>
              <div class="budget-cat-entry-right">
                <span class="cat-amount">${amountHtml}</span>
                <button class="budget-cat-edit-btn" type="button">Modifier</button>
              </div>
            </div>
            ${hasB ? `
            <div class="budget-cat-bar-track"><div class="budget-cat-bar-fill ${cls}" style="width:${fillW}"></div></div>
            <div style="margin-top:6px;font-family:var(--font-body);font-size:11px;font-weight:500;letter-spacing:0.01em;color:${s > b ? 'var(--danger)' : 'var(--success)'};">
              ${s > b ? `Dépassement de ${formatCurrency(s - b)}` : `${formatCurrency(b - s)} restants`}
            </div>` : ''}
            <div class="budget-cat-edit-detail">
              <div class="budget-cat-edit-wrap">
                <div class="budget-cat-name-row">
                  <input class="budget-cat-name-input" type="text"
                    value="${escapeHtml(c.label)}" maxlength="40" placeholder="Nom">
                </div>
                <div class="budget-cat-input-row">
                  <input class="budget-cat-amount-input" type="number" step="0.01" min="0"
                    value="${b || ''}" placeholder="0">
                  <span class="budget-cat-currency">€</span>
                </div>
                <div class="budget-cat-actions">
                  <button class="budget-cat-save-btn" type="button">Enregistrer</button>
                  <button class="budget-cat-delete-btn" type="button">Supprimer</button>
                </div>
              </div>
            </div>
          </div>`;
      }).join('');

      catsEl.innerHTML = `
        <div class="budget-cats">
          <div class="page-tag">Par catégorie</div>
          ${addFormHtml}
          <div class="budget-cat-list">${rows}</div>
        </div>`;

      bindBudgetCatAdd(catsEl);

      catsEl.querySelectorAll('.budget-cat-entry').forEach(entry => {
        const catId = entry.dataset.cat;
        const editBtn = entry.querySelector('.budget-cat-edit-btn');
        const detail = entry.querySelector('.budget-cat-edit-detail');
        const saveBtn = entry.querySelector('.budget-cat-save-btn');
        const amountInput = entry.querySelector('.budget-cat-amount-input');
        const nameInput = entry.querySelector('.budget-cat-name-input');
        const deleteBtn = entry.querySelector('.budget-cat-delete-btn');

        amountInput.addEventListener('input', () => {
          saveBtn.classList.toggle('visible', true);
        });

        nameInput.addEventListener('input', () => {
          saveBtn.classList.toggle('visible', true);
        });

        editBtn.addEventListener('click', () => {
          const isOpen = entry.classList.contains('editing');
          catsEl.querySelectorAll('.budget-cat-entry.editing').forEach(e => {
            if (e !== entry) {
              e.classList.remove('editing');
              e.querySelector('.budget-cat-edit-detail').style.height = '0';
            }
          });
          if (isOpen) {
            entry.classList.remove('editing');
            detail.style.height = '0';
          } else {
            entry.classList.add('editing');
            detail.style.height = detail.scrollHeight + 'px';
            setTimeout(() => nameInput.focus(), 200);
          }
        });

        saveBtn.addEventListener('click', () => {
          const newName = nameInput.value.trim();
          if (newName) {
            const idx = state.categories.findIndex(c => c.id === catId);
            if (idx !== -1) state.categories[idx].label = newName;
          }
          const raw = amountInput.value.trim();
          const val = parseFloat(raw);
          const key = monthKey(currentDate);
          if (!state.budgets[key]) state.budgets[key] = {};
          if (raw !== '' && !isNaN(val)) state.budgets[key][catId] = val;
          else delete state.budgets[key][catId];
          saveState();
          render();
          showToast('Mis à jour');
        });

        deleteBtn.addEventListener('click', () => {
          state.categories = state.categories.filter(c => c.id !== catId);
          Object.keys(state.budgets).forEach(k => { delete state.budgets[k][catId]; });
          saveState();
          render();
          showToast('Catégorie supprimée');
        });
      });
    }

    function bindBudgetCatAdd() {
      const btn      = document.getElementById('budgetAddCatBtn');
      const form     = document.getElementById('budgetAddCatForm');
      const addCat   = document.getElementById('budgetAddCat');
      const nameInput = document.getElementById('newCatName');
      const saveBtn  = document.getElementById('newCatSave');
      if (!btn || !form) return;

      btn.addEventListener('click', () => {
        const isOpen = addCat.classList.contains('open');
        if (isOpen) {
          addCat.classList.remove('open');
          form.style.height = '0';
        } else {
          addCat.classList.add('open');
          form.style.height = form.scrollHeight + 'px';
          setTimeout(() => nameInput && nameInput.focus(), 180);
        }
      });

      const doCreate = () => {
        const name = (nameInput.value || '').trim();
        if (!name) return;
        if (!state.categories) state.categories = [];
        state.categories.push({ id: generateId(), label: name, color: nextCategoryColor() });
        saveState();
        render();
        showToast('Catégorie créée');
      };

      saveBtn.addEventListener('click', doCreate);
      nameInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); doCreate(); }
      });
    }

    // --- Annual budget ---

    function getAnnualMonthData(year) {
      const LABELS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
      return LABELS.map((label, i) => {
        const key = `${year}-${String(i+1).padStart(2,'0')}`;
        const b = (state.monthBudgets || {})[key] || 0;
        const exps = state.expenses.filter(e => e.date.startsWith(key));
        const s = exps.reduce((sum, e) => sum + e.amount, 0);
        const catMap = {};
        (state.categories || []).forEach(c => { catMap[c.id] = 0; });
        exps.forEach(e => {
          const id = migrateCategoryId(e.category);
          catMap[id] = (catMap[id] || 0) + e.amount;
        });
        return { month: i, key, label, budget: b, spent: s, categories: catMap };
      });
    }

    function animateViewBox(svgEl, from, to, duration, onComplete) {
      const start = performance.now();
      function step(now) {
        const t = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 4);
        svgEl.setAttribute('viewBox', from.map((v, j) => (v + (to[j]-v)*ease).toFixed(2)).join(' '));
        if (t < 1) requestAnimationFrame(step);
        else if (onComplete) onComplete();
      }
      requestAnimationFrame(step);
    }

    function buildAnnualSVG(data, selectedMonth, viewBox, showAnnotations = true) {
      const W = 700, H = 280, mT = 20, mB = 36;
      const chartH = H - mT - mB;
      const groupW = W / 12;
      const barW = Math.floor(groupW * 0.33);
      const maxVal = Math.max(...data.map(d => Math.max(d.budget, d.spent)), 100);
      const now = new Date();
      const year = parseInt(data[0].key.slice(0, 4));
      let content = '';

      // Gridlines
      [0.25, 0.5, 0.75, 1].forEach(f => {
        const y = (mT + chartH - chartH * f).toFixed(1);
        content += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#e8eaef" stroke-width="0.5" pointer-events="none"/>`;
      });

      data.forEach((d, i) => {
        const gx = i * groupW;
        const cx = gx + groupW / 2;
        const bx = (cx - barW - 2).toFixed(1);
        const sx = (cx + 2).toFixed(1);
        const isCurrent = d.month === now.getMonth() && year === now.getFullYear();
        const isSelected = selectedMonth === i;
        const faded = selectedMonth !== null && !isSelected;
        const groupOpacity = faded ? '0.12' : '1';
        const budgetBarOpacity = faded ? '1' : isSelected ? '0.3' : '0.5';

        const bh = d.budget > 0 ? Math.max((d.budget / maxVal) * chartH, 2) : 0;
        const sh = d.spent > 0 ? Math.max((d.spent / maxVal) * chartH, 2) : 0;
        const by = (mT + chartH - bh).toFixed(1);

        content += `<g class="annual-bar-group" data-month="${i}" style="cursor:pointer;opacity:${groupOpacity};transition:opacity .25s;">`;

        // Budget bar (left)
        if (d.budget > 0) {
          content += `<rect x="${bx}" y="${by}" width="${barW}" height="${bh.toFixed(1)}" fill="#64748b" rx="2" opacity="${budgetBarOpacity}"/>`;
        }

        // Expense bar (right): plain or stacked
        if (d.spent > 0) {
          if (isSelected) {
            // Pre-compute segment positions
            const segs = (state.categories || []).filter(c => d.categories[c.id] > 0).map(c => {
              const ch = (d.categories[c.id] / maxVal) * chartH;
              const pct = Math.round((d.categories[c.id] / d.spent) * 100);
              return { ...c, value: d.categories[c.id], pct, ch };
            });
            let stackBottom = mT + chartH;
            const segPos = segs.map(seg => {
              stackBottom -= seg.ch;
              return { ...seg, y: stackBottom, midY: stackBottom + seg.ch / 2 };
            });

            // Draw rects
            segPos.forEach(seg => {
              content += `<rect class="annual-cat-seg" x="${sx}" y="${seg.y.toFixed(1)}" width="${barW}" height="${seg.ch.toFixed(1)}"
                fill="${seg.color}" rx="1"
                data-label="${escapeHtml(seg.label)}" data-value="${escapeHtml(formatCurrency(seg.value))}" data-pct="${seg.pct}"/>`;
            });

            // Annotations (pie-chart style), both sides, deconflicted — only when zoomed + showAnnotations
            if (viewBox && showAnnotations) {
              const s       = viewBox[2] / W;
              const barLX   = parseFloat(sx);           // left edge of expense bar (line passes over budget bar)
              const barRX   = parseFloat(sx) + barW;    // right edge of expense bar
              const fsPct   = (18 * s).toFixed(2);
              const fsLbl   = (11 * s).toFixed(2);
              const sw      = (1.5 * s).toFixed(2);
              const minGap  = 15 * s;                  // min vertical spacing between labels

              // Alternate sides: even index → right, odd index → left
              const withSide = segPos.map((seg, idx) => ({ ...seg, side: idx % 2 === 0 ? 'r' : 'l' }));

              // Deconflict: push overlapping labels apart (top-to-bottom pass)
              function deconflict(segs) {
                const arr = segs.map(seg => ({ ...seg, lY: seg.midY }));
                for (let i = 1; i < arr.length; i++) {
                  if (arr[i].lY - arr[i - 1].lY < minGap)
                    arr[i].lY = arr[i - 1].lY + minGap;
                }
                return arr;
              }

              const right = deconflict(withSide.filter(s => s.side === 'r').sort((a, b) => a.midY - b.midY));
              const left  = deconflict(withSide.filter(s => s.side === 'l').sort((a, b) => a.midY - b.midY));

              [...right, ...left].forEach((seg, idx) => {
                const isRight    = seg.side === 'r';
                const edgeX      = isRight ? barRX : barLX;
                const sign       = isRight ? 1 : -1;
                const anchor     = isRight ? 'start' : 'end';
                const reach      = isRight ? 68 : 82; // gauche plus long pour dégager la barre budget
                const p1x        = (edgeX + sign *  3 * s).toFixed(2);
                const p2x        = (edgeX + sign * 18 * s).toFixed(2);
                const p3x        = (edgeX + sign * (reach - 4) * s).toFixed(2);
                const tx         = (edgeX + sign *  reach      * s).toFixed(2);
                const shortLabel = seg.label.length > 13 ? seg.label.slice(0, 12) + '…' : seg.label;
                const delay      = `animation-delay:${(idx * 0.11).toFixed(2)}s`;

                content += `
                  <polyline class="annual-annot" style="${delay}" points="${p1x},${seg.midY.toFixed(2)} ${p2x},${seg.lY.toFixed(2)} ${p3x},${seg.lY.toFixed(2)}"
                    fill="none" stroke="${seg.color}" stroke-width="${sw}" pointer-events="none"/>
                  <text class="annual-annot" style="${delay}" x="${tx}" y="${(seg.lY - 3 * s).toFixed(2)}" text-anchor="${anchor}" pointer-events="none"
                    font-family="Josefin Sans, sans-serif" font-size="${fsPct}" font-weight="700" fill="#1a1d26">${seg.pct}%</text>
                  <text class="annual-annot" style="${delay}" x="${tx}" y="${(seg.lY + 10 * s).toFixed(2)}" text-anchor="${anchor}" pointer-events="none"
                    font-family="Josefin Sans, sans-serif" font-size="${fsLbl}" font-weight="600" fill="#374151">${escapeHtml(shortLabel)}</text>`;
              });
            }
          } else {
            const sy2 = (mT + chartH - sh).toFixed(1);
            content += `<rect x="${sx}" y="${sy2}" width="${barW}" height="${sh.toFixed(1)}" fill="#8c2d42" rx="2" opacity="0.7"/>`;
          }
        }

        // Invisible hit area
        content += `<rect x="${gx.toFixed(1)}" y="${mT}" width="${groupW.toFixed(1)}" height="${chartH + 12}" fill="transparent"/>`;
        content += `</g>`;

        // Month label
        const lc = faded ? '#d1d5db' : (isCurrent ? '#1a1d26' : '#9ca3af');
        content += `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" pointer-events="none"
          font-family="Josefin Sans, sans-serif" font-size="9" font-weight="${isCurrent ? '700' : '600'}"
          letter-spacing="0.5" fill="${lc}">${d.label}</text>`;
      });

      // Budget curve (connects top-center of each budget bar)
      if (selectedMonth === null) {
        let curvePath = '';
        let inSeg = false;
        data.forEach((d, i) => {
          if (d.budget <= 0) { inSeg = false; return; }
          const gx = i * groupW;
          const cx = gx + groupW / 2;
          const bh = Math.max((d.budget / maxVal) * chartH, 2);
          const px = (cx - barW / 2 - 2).toFixed(1);
          const py = (mT + chartH - bh).toFixed(1);
          curvePath += inSeg ? `L ${px} ${py} ` : `M ${px} ${py} `;
          inSeg = true;
        });
        if (curvePath) {
          content += `<path d="${curvePath}" fill="none" stroke="#64748b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" pointer-events="none" opacity="0.5"/>`;
          // Dots at each budget point
          data.forEach((d, i) => {
            if (d.budget <= 0) return;
            const gx = i * groupW;
            const cx = gx + groupW / 2;
            const bh = Math.max((d.budget / maxVal) * chartH, 2);
            const px = (cx - barW / 2 - 2).toFixed(1);
            const py = (mT + chartH - bh).toFixed(1);
            content += `<circle cx="${px}" cy="${py}" r="2.5" fill="#64748b" opacity="0.5" pointer-events="none"/>`;
          });
        }
      }

      // Baseline
      content += `<line x1="0" y1="${mT + chartH}" x2="${W}" y2="${mT + chartH}" stroke="#e8eaef" stroke-width="1" pointer-events="none"/>`;

      const vb = viewBox ? viewBox.join(' ') : `0 0 ${W} ${H}`;
      return `<svg id="annualChartSvg" viewBox="${vb}" width="100%" style="display:block;">${content}</svg>`;
    }

    function renderAnnualChart() {
      const container = document.getElementById('annualChartContainer');
      if (!container) return;

      const year = currentDate.getFullYear();
      const data = getAnnualMonthData(year);
      const W = 700, groupW = W / 12;

      let targetVB = null;
      if (annualSelectedMonth !== null) {
        const i = annualSelectedMonth;
        const vbW = groupW * 4;
        const vbX = Math.max(0, Math.min((i - 1.5) * groupW, W - vbW));
        targetVB = [vbX, 0, vbW, 280];
      }

      const legend = `<div class="annual-chart-legend">
        <span class="annual-legend-item"><span class="annual-legend-dot" style="background:#64748b;opacity:.7;"></span>Budget</span>
        <span class="annual-legend-item"><span class="annual-legend-dot" style="background:#8c2d42;opacity:.8;"></span>Dépenses</span>
      </div>`;
      const hint = annualSelectedMonth !== null
        ? 'Cliquez à nouveau sur le mois pour revenir'
        : 'Cliquez sur un mois pour voir le détail';

      const sy = window.scrollY;
      container.innerHTML =
        buildAnnualSVG(data, annualSelectedMonth, targetVB) +
        legend +
        `<div class="annual-chart-hint">${hint}</div>`;
      window.scrollTo(0, sy);

      // Bind category hover tooltips
      const tooltip = document.getElementById('pieTooltip');
      container.querySelectorAll('.annual-cat-seg').forEach(rect => {
        rect.addEventListener('mouseenter', () => {
          if (!tooltip) return;
          tooltip.innerHTML = `
            <div class="pie-tooltip-title">${rect.dataset.label}</div>
            <div class="pie-tooltip-list">
              <div class="pie-tooltip-item">${rect.dataset.value} · ${rect.dataset.pct}%</div>
            </div>`;
          tooltip.classList.add('visible');
        });
        rect.addEventListener('mousemove', e => {
          if (tooltip) {
            tooltip.style.left = (e.clientX + 18) + 'px';
            tooltip.style.top = (e.clientY - 12) + 'px';
          }
        });
        rect.addEventListener('mouseleave', () => {
          if (tooltip) tooltip.classList.remove('visible');
        });
      });

      // Clic n'importe où sur la page (sauf barres) → zoom arrière
      const vbW = groupW * 4;
      if (annualClickOutsideHandler) document.removeEventListener('click', annualClickOutsideHandler);
      annualClickOutsideHandler = (e) => {
        if (annualSelectedMonth !== null && !e.target.closest('.annual-bar-group')) {
          const svgEl2 = container.querySelector('#annualChartSvg');
          if (!svgEl2) return;
          const curVbX = Math.max(0, Math.min((annualSelectedMonth - 1.5) * groupW, W - vbW));
          animateViewBox(svgEl2, [curVbX, 0, vbW, 280], [0, 0, W, 280], 600, () => {
            annualSelectedMonth = null;
            renderAnnualChart();
          });
        }
      };
      document.addEventListener('click', annualClickOutsideHandler);

      // Bind clicks
      container.querySelectorAll('.annual-bar-group').forEach(g => {
        g.addEventListener('click', (e) => {
          e.stopPropagation();
          const mi = parseInt(g.dataset.month);
          const svgEl = container.querySelector('#annualChartSvg');

          if (annualSelectedMonth === mi) {
            // Zoom out
            const curVbX = Math.max(0, Math.min((mi - 1.5) * groupW, W - vbW));
            animateViewBox(svgEl, [curVbX, 0, vbW, 280], [0, 0, W, 280], 600, () => {
              annualSelectedMonth = null;
              renderAnnualChart();
            });
          } else {
            const prevSel = annualSelectedMonth;
            annualSelectedMonth = mi;
            const toVbX = Math.max(0, Math.min((mi - 1.5) * groupW, W - vbW));

            let fromVB = [0, 0, W, 280];
            if (prevSel !== null) {
              const prevVbX = Math.max(0, Math.min((prevSel - 1.5) * groupW, W - vbW));
              fromVB = [prevVbX, 0, vbW, 280];
            }

            const sy2 = window.scrollY;
            container.innerHTML = buildAnnualSVG(data, mi, fromVB, false) +
              legend +
              `<div class="annual-chart-hint">Cliquez à nouveau sur le mois pour revenir</div>`;
            window.scrollTo(0, sy2);

            const newSvg = container.querySelector('#annualChartSvg');
            animateViewBox(newSvg, fromVB, [toVbX, 0, vbW, 280], 600, () => {
              renderAnnualChart();
              requestAnimationFrame(() => {
                const rect = container.getBoundingClientRect();
                const axisBottom = rect.top + window.scrollY + rect.height;
                const target = axisBottom - window.innerHeight + 32;
                if (target > window.scrollY) {
                  window.scrollTo({ top: target, behavior: 'smooth' });
                }
              });
            });
          }
        });
      });
    }

    function renderAnnualPage() {
      const year = currentDate.getFullYear();
      const titleEl = document.getElementById('annualTitle');
      const contentEl = document.getElementById('annualContent');
      if (!titleEl || !contentEl) return;

      titleEl.textContent = String(year);
      renderAnnualChart();
    }

    function render() {
      renderDashboard();
      renderPieChart();
      renderBudgetPage();
      renderBudgetCategories();
      renderExpensePage();
      applyExpenseSearch();
      renderCategorySelect();
      renderAnnualPage();
    }

    // --- Insights ---

    function formatAnalysis(text) {
      const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const lines = escaped.split('\n');
      let html = '';
      let inList = false;

      for (const raw of lines) {
        const line = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        const isNumbered = /^(\d+)\.\s+/.test(line);
        const isBullet  = /^[-•]\s+/.test(line);

        if (isNumbered) {
          if (inList) { html += '</ul>'; inList = false; }
          html += `<div class="insights-section-title">${line.replace(/^\d+\.\s+/, '')}</div>`;
        } else if (isBullet) {
          if (!inList) { html += '<ul class="insights-list">'; inList = true; }
          html += `<li>${line.replace(/^[-•]\s+/, '')}</li>`;
        } else if (line.trim() === '') {
          if (inList) { html += '</ul>'; inList = false; }
        } else {
          if (inList) { html += '</ul>'; inList = false; }
          html += `<p class="insights-para">${line}</p>`;
        }
      }
      if (inList) html += '</ul>';
      return html;
    }

    async function runAnalysis() {
      const key = monthKey(currentDate);
      const expenses = (state.expenses || []).filter(e => e.date && e.date.startsWith(key));
      if (!expenses.length) return;

      insightsState = { loading: true, analysis: null, error: null, forMonth: key };
      renderInsightsPage();

      try {
        const res = await fetch('https://kash-backend-production-8350.up.railway.app/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expenses: expenses.map(e => ({
              description: e.description || '',
              amount: e.amount,
              category: getCat(e.category).label,
              date: e.date,
            })),
          }),
        });
        if (!res.ok) throw new Error('Erreur serveur ' + res.status);
        const data = await res.json();
        insightsState = { loading: false, analysis: data.analysis, error: null, forMonth: key };
      } catch (err) {
        insightsState = { loading: false, analysis: null, error: 'Impossible de contacter le serveur. Vérifiez votre connexion.', forMonth: key };
      }

      renderInsightsPage();
    }

    function renderInsightsPage() {
      const titleEl  = document.getElementById('insightsTitle');
      const contentEl = document.getElementById('insightsContent');
      if (!titleEl || !contentEl) return;

      const key      = monthKey(currentDate);
      const expenses = (state.expenses || []).filter(e => e.date && e.date.startsWith(key));
      const total    = expenses.reduce((s, e) => s + e.amount, 0);

      // Reset cached analysis when month changes
      if (insightsState.forMonth && insightsState.forMonth !== key) {
        insightsState = { loading: false, analysis: null, error: null, forMonth: null };
      }

      titleEl.textContent = formatMonth(currentDate);

      const summaryHtml = expenses.length
        ? `<div class="insights-summary">
             <span class="insights-summary-count">${expenses.length} dépense${expenses.length > 1 ? 's' : ''}</span>
             <span class="insights-sep">·</span>
             <span class="insights-summary-total">${formatCurrency(total)}</span>
           </div>`
        : `<div class="insights-empty">Aucune dépense enregistrée pour ce mois.</div>`;

      let resultHtml = '';
      if (insightsState.loading) {
        resultHtml = `<div class="insights-loading">
          <span></span><span></span><span></span>
        </div>`;
      } else if (insightsState.error) {
        resultHtml = `<div class="insights-error">${insightsState.error}</div>`;
      } else if (insightsState.analysis) {
        resultHtml = `<div class="insights-result">${formatAnalysis(insightsState.analysis)}</div>`;
      }

      contentEl.innerHTML = `
        ${summaryHtml}
        <button class="btn insights-analyze-btn" id="insightsAnalyzeBtn"
          ${expenses.length === 0 || insightsState.loading ? 'disabled' : ''}>
          ${insightsState.loading ? 'Analyse en cours…' : 'Analyser mes dépenses'}
        </button>
        ${resultHtml}
      `;

      const btn = document.getElementById('insightsAnalyzeBtn');
      if (btn) btn.addEventListener('click', runAnalysis);
    }

    // --- Tab switching ---

    const TAB_TITLES = { overview: 'Overview', annual: 'Budget annualisé', insights: 'Insights' };

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        document.title = TAB_TITLES[btn.dataset.tab] + ' — Kash';
        if (btn.dataset.tab === 'annual') renderAnnualPage();
        if (btn.dataset.tab === 'insights') renderInsightsPage();
      });
    });

    // --- Budget field interaction ---

    function updateBudgetButtons() {
      const input = document.getElementById('budgetAmount');
      const saveBtn = document.getElementById('saveBudgetBtn');
      const row = document.getElementById('budgetFieldRow');
      if (!input || !saveBtn || !row) return;
      saveBtn.classList.toggle('visible', input.value.trim() !== '');
    }

    document.getElementById('budgetAmount').addEventListener('input', updateBudgetButtons);

    document.getElementById('editBudgetBtn').addEventListener('click', () => {
      const input = document.getElementById('budgetAmount');
      const row = document.getElementById('budgetFieldRow');
      input.readOnly = false;
      row.classList.remove('has-budget');
      input.focus();
      updateBudgetButtons();
    });

    // --- Events ---

    document.getElementById('saveBudgetBtn').addEventListener('click', () => {
      const raw = document.getElementById('budgetAmount').value.trim();
      const val = parseFloat(raw);
      if (!state.monthBudgets) state.monthBudgets = {};
      if (raw !== '' && !isNaN(val)) state.monthBudgets[monthKey(currentDate)] = val;
      else delete state.monthBudgets[monthKey(currentDate)];
      saveState();
      render();
      showToast('Budget enregistré');
    });

    document.getElementById('detailBackdrop').addEventListener('click', hideDetail);

    document.getElementById('detailPanel').addEventListener('mouseleave', () => {
      setTimeout(() => {
        if (!document.getElementById('detailPanel').matches(':hover') &&
            !document.querySelector('.cat-row:hover')) {
          hideDetail();
        }
      }, 120);
    });

    document.getElementById('expenseForm').addEventListener('submit', e => {
      e.preventDefault();
      const amount = parseFloat(document.getElementById('amount').value);
      const date = document.getElementById('date').value;
      const category = document.getElementById('category').value;
      const description = document.getElementById('description').value.trim();
      if (!amount || !category) {
        if (!category) showToast('Sélectionnez une catégorie');
        return;
      }
      state.expenses.push({ id: generateId(), amount, date, category, description });
      saveState();
      e.target.reset();
      document.getElementById('date').value = new Date().toISOString().slice(0, 10);
      renderCategorySelect();
      render();
      showToast('Dépense ajoutée');
    });

    document.getElementById('expenseSearch').addEventListener('input', applyExpenseSearch);

    document.getElementById('prevMonth').addEventListener('click', () => {
      currentDate.setMonth(currentDate.getMonth() - 1);
      annualSelectedMonth = null;
      const s = document.getElementById('expenseSearch'); if (s) s.value = '';
      hideDetail();
      render();
    });

    document.getElementById('nextMonth').addEventListener('click', () => {
      currentDate.setMonth(currentDate.getMonth() + 1);
      annualSelectedMonth = null;
      const s = document.getElementById('expenseSearch'); if (s) s.value = '';
      hideDetail();
      render();
    });

    window.addEventListener('scroll', () => {
      document.getElementById('chrome').classList.toggle('scrolled', window.scrollY > 20);
    });

    // --- Insights ---

    function renderInsightsResult(data) {
      const container = document.getElementById('insightsResult');
      if (!container) return;

      // Cas : réponse vide
      if (!data) {
        container.innerHTML = `<div class="insights-error">La réponse de l'API est vide.</div>`;
        return;
      }

      // Si l'API renvoie un objet structuré avec des champs connus
      if (typeof data === 'object' && !Array.isArray(data)) {
        const knownSections = [
          { key: 'summary',         label: 'Résumé' },
          { key: 'highlights',      label: 'Points clés' },
          { key: 'recommendations', label: 'Recommandations' },
          { key: 'analysis',        label: 'Analyse' },
          { key: 'insights',        label: 'Insights' },
          { key: 'message',         label: 'Message' },
          { key: 'text',            label: 'Analyse' },
        ];
        const blocks = knownSections
          .filter(s => data[s.key] != null && String(data[s.key]).trim() !== '')
          .map((s, i) => {
            const content = Array.isArray(data[s.key])
              ? data[s.key].map(item => `• ${typeof item === 'object' ? JSON.stringify(item) : item}`).join('\n')
              : String(data[s.key]);
            return `<div class="insights-block" style="animation-delay:${i * 0.08}s">
              <div class="insights-block-label">${s.label}</div>
              <div class="insights-block-text">${escapeHtml(content)}</div>
            </div>`;
          });

        if (blocks.length > 0) {
          container.innerHTML = blocks.join('');
          return;
        }

        // Objet non reconnu → dump propre
        container.innerHTML = `<div class="insights-block">
          <div class="insights-block-label">Réponse</div>
          <div class="insights-raw">${escapeHtml(JSON.stringify(data, null, 2))}</div>
        </div>`;
        return;
      }

      // Chaîne ou autre → affichage direct
      const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      container.innerHTML = `<div class="insights-block">
        <div class="insights-block-label">Analyse</div>
        <div class="insights-block-text">${escapeHtml(text)}</div>
      </div>`;
    }

    async function runInsightsAnalysis() {
      const btn    = document.getElementById('analyzeBtn');
      const loader = document.getElementById('insightsLoader');
      const result = document.getElementById('insightsResult');
      if (!btn || !loader || !result) return;

      // Collecter les dépenses du mois courant
      const now = new Date();
      const key = monthKey(now);
      const expenses = state.expenses.filter(e => e.date.startsWith(key)).map(e => ({
        amount:      e.amount,
        date:        e.date,
        category:    getCat(e.category).label,
        description: e.description || '',
      }));

      if (expenses.length === 0) {
        result.innerHTML = `<div class="insights-empty">
          <div class="insights-empty-icon">✦</div>
          Aucune dépense enregistrée pour ${formatMonth(now)}.<br>Ajoutez des dépenses pour obtenir une analyse.
        </div>`;
        return;
      }

      // État de chargement
      btn.disabled = true;
      loader.classList.add('visible');
      result.innerHTML = '';

      try {
        const res = await fetch('https://kash-backend-production-8350.up.railway.app/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            month:    key,
            budget:   totalBudget(now),
            expenses,
          }),
        });

        if (!res.ok) {
          throw new Error(`Erreur serveur : ${res.status} ${res.statusText}`);
        }

        const data = await res.json();
        renderInsightsResult(data);
      } catch (err) {
        result.innerHTML = `<div class="insights-error">
          Impossible de récupérer l'analyse.<br><span style="font-weight:400;opacity:.75;">${escapeHtml(err.message)}</span>
        </div>`;
      } finally {
        loader.classList.remove('visible');
        btn.disabled = false;
      }
    }

    document.getElementById('analyzeBtn').addEventListener('click', runInsightsAnalysis);

    // Init
    document.getElementById('date').value = new Date().toISOString().slice(0, 10);
    render();
  