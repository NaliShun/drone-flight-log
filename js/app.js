const appEl = document.getElementById('app');

const PURPOSE_OPTIONS = ['空撮', '点検・保守', '測量', '農薬散布', '物流・配送', '警備・監視', '訓練・練習'];
const AREA_OPTIONS = ['屋外(DID地区外)', '屋外(DID地区内)', '河川敷', '海上・水上', '山間部・森林', '農地', '屋内'];
const WEATHER_OPTIONS = ['晴れ', '曇り', '雨'];
const SPECIFIC_FLIGHT_OPTIONS = [
  '空港等周辺の空域',
  '高度150m以上',
  '人口集中地区(DID)上空',
  '緊急用務空域',
  '夜間飛行',
  '目視外飛行',
  '第三者との距離30m未満',
  '催し場所上空',
  '危険物輸送',
  '物件投下',
];

function pad2(n) {
  return String(n).padStart(2, '0');
}
function nowHHMM() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatJaAddress(addr) {
  if (!addr) return '';
  const parts = [
    addr.province || addr.state,
    addr.city || addr.town || addr.village || addr.municipality,
    addr.suburb || addr.city_district || addr.borough,
    addr.neighbourhood || addr.quarter,
    addr.road,
  ].filter(Boolean);
  return parts.join('');
}

// OpenStreetMap Nominatim で座標→住所への逆ジオコーディング（失敗時は空文字を返す）
async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`,
      { headers: { Accept: 'application/json', 'Accept-Language': 'ja' } }
    );
    if (!res.ok) return '';
    const data = await res.json();
    return formatJaAddress(data.address);
  } catch (e) {
    return '';
  }
}

// 選択肢 + 「その他」手入力に対応したフィールドを生成
function renderSelectOtherField({ label, name, options, value }) {
  const isPreset = value && options.includes(value);
  const isManual = value && !isPreset;
  return `
    <div class="field">
      <label>${escapeHtml(label)}</label>
      <select name="${name}_select" data-other-group="${name}">
        <option value="">選択してください</option>
        ${options
          .map((opt) => `<option value="${escapeHtml(opt)}" ${isPreset && value === opt ? 'selected' : ''}>${escapeHtml(opt)}</option>`)
          .join('')}
        <option value="__manual__" ${isManual ? 'selected' : ''}>その他（手入力）</option>
      </select>
    </div>
    <div class="field" data-manual-for="${name}" style="${isManual ? '' : 'display:none'}">
      <label>${escapeHtml(label)}（手入力）</label>
      <input type="text" name="${name}_manual" value="${escapeHtml(isManual ? value : '')}" />
    </div>
  `;
}

function wireSelectOtherField(form, name) {
  const select = form.querySelector(`select[data-other-group="${name}"]`);
  const manualField = form.querySelector(`[data-manual-for="${name}"]`);
  select.addEventListener('change', () => {
    manualField.style.display = select.value === '__manual__' ? '' : 'none';
  });
}

function collectSelectOtherValue(fd, name) {
  const selectVal = fd.get(`${name}_select`);
  if (selectVal === '__manual__') return fd.get(`${name}_manual`) || '';
  return selectVal || '';
}

// ---- 新規/編集フライト用のドラフト状態 (SPA内で保持) ----
let draft = null;

function resetDraft() {
  draft = {
    editingId: null,
    flight_date: new Date().toISOString().slice(0, 10),
    pilot_name: '',
    drone_id: null,
    drone_name_snapshot: '',
    purpose: '',
    departure_place: '',
    arrival_place: '',
    start_time: '',
    end_time: '',
    flight_duration_min: '',
    weather: '',
    wind_speed: '',
    temperature: '',
    flight_area: '',
    specific_flight_types: [],
    incident_notes: '',
    remarks: '',
    pre_checks: null,
    post_checks: null,
  };
}
resetDraft();

// ---- ルーター ----
function navigate(path) {
  location.hash = path;
}

function parseHash() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const parts = hash.split('/').filter(Boolean);
  return parts;
}

async function router() {
  const parts = parseHash();
  try {
    if (parts.length === 0) return renderDashboard();
    if (parts[0] === 'new' && parts[1] === 'pre') return renderChecklistStep('pre');
    if (parts[0] === 'new' && parts[1] === 'log') return renderLogStep();
    if (parts[0] === 'new' && parts[1] === 'post') return renderChecklistStep('post');
    if (parts[0] === 'flight' && parts[1]) return renderFlightDetail(parts[1]);
    if (parts[0] === 'settings') return renderSettings();
    if (parts[0] === 'drones') return renderDrones();
    return renderDashboard();
  } catch (err) {
    appEl.innerHTML = `<div class="card"><p class="error-text">エラー: ${escapeHtml(err.message)}</p></div>`;
  }
}

window.addEventListener('hashchange', () => {
  if (auth.currentUser) router();
});

// ---- ログイン ----
function loginErrorMessage(err) {
  if (err.code === 'auth/invalid-email') return 'メールアドレスの形式が正しくありません';
  if (['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential'].includes(err.code)) {
    return 'メールアドレスまたはパスワードが違います';
  }
  if (err.code === 'auth/too-many-requests') return '試行回数が多すぎます。しばらくしてから再試行してください';
  return 'ログインに失敗しました: ' + err.message;
}

function renderLogin(errorMessage) {
  document.getElementById('app-header').style.display = 'none';
  appEl.innerHTML = `
    <div class="login-wrap">
      <div class="card login-card">
        <h1>🛸 ドローン飛行記録</h1>
        <p class="subtitle">ログインしてください</p>
        <form id="login-form">
          <div class="field">
            <label class="required">メールアドレス</label>
            <input type="email" name="email" required autocomplete="username" />
          </div>
          <div class="field">
            <label class="required">パスワード</label>
            <input type="password" name="password" required autocomplete="current-password" />
          </div>
          ${errorMessage ? `<p class="error-text">${escapeHtml(errorMessage)}</p>` : ''}
          <button type="submit" class="btn btn-primary" style="width:100%; margin-top:14px;">ログイン</button>
        </form>
      </div>
    </div>
  `;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'ログイン中...';
    try {
      await auth.signInWithEmailAndPassword(fd.get('email'), fd.get('password'));
      // 成功後は onAuthStateChanged が画面遷移を処理する
    } catch (err) {
      renderLogin(loginErrorMessage(err));
    }
  });
}

let appInitialized = false;

auth.onAuthStateChanged(async (user) => {
  if (user) {
    document.getElementById('app-header').style.display = '';
    if (!appInitialized) {
      await api.init();
      appInitialized = true;
    }
    router();
  } else {
    appInitialized = false;
    renderLogin();
  }
});

document.getElementById('btn-logout').addEventListener('click', (e) => {
  e.preventDefault();
  auth.signOut();
});

// ---- ユーティリティ ----
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 2400);
}

function fmtDuration(min) {
  if (min === null || min === undefined || min === '') return '-';
  return `${min}分`;
}

// ---- CSVエクスポート ----
function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/["\r\n,]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function summarizeChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return { count: '-', issues: '' };
  const total = checks.length;
  const done = checks.filter((c) => c.checked).length;
  const issues = checks
    .filter((c) => !c.checked || c.note)
    .map((c) => `${c.checked ? '✓' : '✗'}${c.item_label}${c.note ? `(備考:${c.note})` : ''}`)
    .join('\n');
  return { count: `${done}/${total}`, issues };
}

function buildFlightsCSV(flights) {
  const headers = [
    '飛行年月日',
    '操縦者',
    '使用機体',
    '飛行目的',
    '飛行エリア',
    '特定飛行',
    '出発地',
    '到着地',
    '離陸時刻',
    '着陸時刻',
    '飛行時間(分)',
    '天候',
    '風速(m/s)',
    '気温(℃)',
    '飛行前チェック完了数',
    '飛行前チェック特記事項',
    '飛行後チェック完了数',
    '飛行後チェック特記事項',
    '特記事項・異常事象',
    '備考',
    '状態',
    '作成日時',
  ];
  const rows = flights.map((f) => {
    const pre = summarizeChecks(f.pre_checks);
    const post = summarizeChecks(f.post_checks);
    return [
      f.flight_date,
      f.pilot_name,
      f.drone_name_snapshot,
      f.purpose,
      f.flight_area,
      Array.isArray(f.specific_flight_types) ? f.specific_flight_types.join('、') : '',
      f.departure_place,
      f.arrival_place,
      f.start_time,
      f.end_time,
      f.flight_duration_min,
      f.weather,
      f.wind_speed,
      f.temperature,
      pre.count,
      pre.issues,
      post.count,
      post.issues,
      f.incident_notes,
      f.remarks,
      f.status === 'draft' ? '下書き' : '完了',
      f.created_at,
    ];
  });
  const lines = [headers, ...rows].map((row) => row.map(csvEscape).join(','));
  // Excelで文字化けしないようUTF-8 BOMを付与
  return '\uFEFF' + lines.join('\r\n');
}

function flightMonthKey(dateStr) {
  return (dateStr || '').slice(0, 7); // "YYYY-MM"
}

function formatMonthKey(key) {
  const [y, m] = key.split('-');
  return `${y}年${Number(m)}月`;
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ==========================================================
// ダッシュボード
// ==========================================================
let dashboardMonthFilter = '';

function renderFlightRows(list) {
  return list
    .map((f) => {
      const badge =
        f.status === 'draft'
          ? '<span class="badge badge-draft">下書き</span>'
          : '<span class="badge badge-ok">完了</span>';
      return `
        <tr class="flight-row" data-id="${f.id}">
          <td>${escapeHtml(f.flight_date)}</td>
          <td>${escapeHtml(f.pilot_name)}</td>
          <td>${escapeHtml(f.drone_name_snapshot || '-')}</td>
          <td>${escapeHtml(f.purpose || '-')}</td>
          <td>${escapeHtml(f.departure_place || '-')} → ${escapeHtml(f.arrival_place || '-')}</td>
          <td>${fmtDuration(f.flight_duration_min)}</td>
          <td>${badge}</td>
        </tr>`;
    })
    .join('');
}

function renderFlightsTableSection(list, hasAnyFlights) {
  if (list.length === 0) {
    return hasAnyFlights
      ? `<div class="empty-state">この年月の飛行記録はありません。</div>`
      : `<div class="empty-state">まだ飛行記録がありません。「新規飛行を記録」から始めましょう。</div>`;
  }
  return `<div class="table-scroll"><table>
      <thead>
        <tr><th>日付</th><th>操縦者</th><th>機体</th><th>目的</th><th>経路</th><th>飛行時間</th><th>状態</th></tr>
      </thead>
      <tbody>${renderFlightRows(list)}</tbody>
    </table></div>`;
}

async function renderDashboard() {
  appEl.innerHTML = `<p class="subtitle">読み込み中...</p>`;
  const flights = await api.flights.list();

  const monthKeys = [...new Set(flights.map((f) => flightMonthKey(f.flight_date)).filter(Boolean))]
    .sort()
    .reverse();
  if (dashboardMonthFilter && !monthKeys.includes(dashboardMonthFilter)) {
    dashboardMonthFilter = '';
  }

  function filteredFlights() {
    if (!dashboardMonthFilter) return flights;
    return flights.filter((f) => flightMonthKey(f.flight_date) === dashboardMonthFilter);
  }

  appEl.innerHTML = `
    <div class="page-head">
      <div>
        <h1>飛行記録一覧</h1>
        <p class="subtitle">飛行前チェック → 飛行日誌 → 飛行後チェックをまとめて記録します</p>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn" id="btn-export-csv">⬇ CSVダウンロード</button>
        <button class="btn btn-primary" id="btn-new-flight">＋ 新規飛行を記録</button>
      </div>
    </div>
    <div class="card">
      ${
        monthKeys.length > 0
          ? `<div class="field" style="max-width:240px; margin-bottom:16px;">
              <label>表示する年月</label>
              <select id="month-filter">
                <option value="">すべて表示</option>
                ${monthKeys
                  .map(
                    (k) =>
                      `<option value="${k}" ${dashboardMonthFilter === k ? 'selected' : ''}>${formatMonthKey(k)}</option>`
                  )
                  .join('')}
              </select>
            </div>`
          : ''
      }
      <div id="flights-table-wrap">${renderFlightsTableSection(filteredFlights(), flights.length > 0)}</div>
    </div>
  `;

  function wireRowClicks() {
    appEl.querySelectorAll('.flight-row').forEach((row) => {
      row.addEventListener('click', () => navigate(`/flight/${row.dataset.id}`));
    });
  }
  wireRowClicks();

  const monthFilterEl = document.getElementById('month-filter');
  if (monthFilterEl) {
    monthFilterEl.addEventListener('change', (e) => {
      dashboardMonthFilter = e.target.value;
      document.getElementById('flights-table-wrap').innerHTML = renderFlightsTableSection(
        filteredFlights(),
        flights.length > 0
      );
      wireRowClicks();
    });
  }

  document.getElementById('btn-new-flight').addEventListener('click', () => {
    resetDraft();
    navigate('/new/pre');
  });
  document.getElementById('btn-export-csv').addEventListener('click', async () => {
    const btn = document.getElementById('btn-export-csv');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = '準備中...';
    try {
      const fullFlights = await api.flights.listFull();
      const target = dashboardMonthFilter
        ? fullFlights.filter((f) => flightMonthKey(f.flight_date) === dashboardMonthFilter)
        : fullFlights;
      if (target.length === 0) {
        showToast('対象の飛行記録がありません');
        return;
      }
      const csv = buildFlightsCSV(target);
      const suffix = dashboardMonthFilter || new Date().toISOString().slice(0, 10);
      downloadTextFile(`飛行記録_${suffix}.csv`, csv, 'text/csv;charset=utf-8;');
    } catch (err) {
      showToast('CSV出力に失敗しました: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });
}

// ==========================================================
// 飛行前 / 飛行後チェックステップ
// ==========================================================
async function renderChecklistStep(phase) {
  const items = await api.checklist.list(phase);
  const draftKey = phase === 'pre' ? 'pre_checks' : 'post_checks';
  const existing = draft[draftKey];

  const checksState = items.map((item, idx) => {
    const prev = existing && existing.find((c) => c.item_label === item.label);
    return {
      item_label: item.label,
      checked: prev ? !!prev.checked : false,
      note: prev ? prev.note || '' : '',
      sort_order: idx,
    };
  });

  const title = phase === 'pre' ? '飛行前チェック' : '飛行後チェック';
  const stepIndex = phase === 'pre' ? 0 : 2;
  const backPath = phase === 'pre' ? '/' : '/new/log';
  const nextLabel = phase === 'pre' ? '次へ：飛行日誌入力' : (draft.editingId ? '更新して保存' : '保存する');

  appEl.innerHTML = `
    ${renderSteps(stepIndex)}
    <div class="card">
      <h2>${title}</h2>
      <p class="check-summary">実施した項目にチェックを入れてください。問題があれば備考欄に記入できます。 (<strong id="check-count">0</strong> / ${checksState.length} 完了)</p>
      ${
        checksState.length === 0
          ? `<div class="empty-state">チェック項目が登録されていません。<a href="#/settings">設定画面</a>で項目を追加してください。</div>`
          : `<div class="check-list">
              ${checksState
                .map(
                  (c, i) => `
                <div class="check-item ${c.checked ? 'checked' : ''}" data-idx="${i}">
                  <input type="checkbox" id="chk-${i}" ${c.checked ? 'checked' : ''} />
                  <div style="flex:1">
                    <label for="chk-${i}">${escapeHtml(c.item_label)}</label>
                    <input type="text" class="note-input" placeholder="備考（任意）" value="${escapeHtml(c.note)}" />
                  </div>
                </div>`
                )
                .join('')}
            </div>`
      }
      <div class="btn-row">
        <button class="btn" id="btn-back">← 戻る</button>
        <span class="spacer"></span>
        <button class="btn btn-primary" id="btn-next">${nextLabel}</button>
      </div>
    </div>
  `;

  const itemEls = Array.from(appEl.querySelectorAll('.check-item'));
  function updateCount() {
    const done = checksState.filter((c) => c.checked).length;
    const countEl = document.getElementById('check-count');
    if (countEl) countEl.textContent = done;
  }
  updateCount();

  itemEls.forEach((el, i) => {
    const checkbox = el.querySelector('input[type="checkbox"]');
    const noteInput = el.querySelector('.note-input');
    checkbox.addEventListener('change', () => {
      checksState[i].checked = checkbox.checked;
      el.classList.toggle('checked', checkbox.checked);
      updateCount();
    });
    noteInput.addEventListener('input', () => {
      checksState[i].note = noteInput.value;
    });
  });

  document.getElementById('btn-back').addEventListener('click', () => {
    draft[draftKey] = checksState;
    navigate(backPath);
  });

  document.getElementById('btn-next').addEventListener('click', async () => {
    draft[draftKey] = checksState;
    if (phase === 'pre') {
      navigate('/new/log');
      return;
    }
    // post phase -> 保存
    const payload = { ...draft };
    delete payload.editingId;
    const btn = document.getElementById('btn-next');
    btn.disabled = true;
    btn.textContent = '保存中...';
    try {
      let saved;
      if (draft.editingId) {
        saved = await api.flights.update(draft.editingId, payload);
      } else {
        saved = await api.flights.create(payload);
      }
      showToast('飛行記録を保存しました');
      resetDraft();
      navigate(`/flight/${saved.id}`);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = nextLabel;
      appEl.querySelector('.card').insertAdjacentHTML(
        'beforeend',
        `<p class="error-text">保存に失敗しました: ${escapeHtml(err.message)}</p>`
      );
    }
  });
}

function renderSteps(activeIndex) {
  const labels = ['① 飛行前チェック', '② 飛行日誌', '③ 飛行後チェック'];
  return `
    <div class="progress-steps">
      ${labels
        .map((label, i) => {
          let cls = '';
          if (i === activeIndex) cls = 'active';
          else if (i < activeIndex) cls = 'done';
          return `<div class="step ${cls}">${label}</div>`;
        })
        .join('')}
    </div>
  `;
}

// ==========================================================
// 飛行日誌ステップ
// ==========================================================
async function renderLogStep() {
  const drones = await api.drones.list();

  appEl.innerHTML = `
    ${renderSteps(1)}
    <div class="card">
      <h2>飛行日誌の入力</h2>
      <form id="log-form">
        <div class="form-grid">
          <div class="field">
            <label class="required">飛行年月日</label>
            <input type="date" name="flight_date" required value="${escapeHtml(draft.flight_date)}" />
          </div>
          <div class="field">
            <label class="required">操縦者氏名</label>
            <input type="text" name="pilot_name" required value="${escapeHtml(draft.pilot_name)}" placeholder="例: 山田 太郎" />
          </div>
          <div class="field">
            <label>使用機体</label>
            <select name="drone_id">
              <option value="">選択してください</option>
              ${drones
                .map(
                  (d) =>
                    `<option value="${d.id}" ${String(draft.drone_id) === String(d.id) ? 'selected' : ''}>${escapeHtml(
                      d.name
                    )}${d.registration_number ? ' (' + escapeHtml(d.registration_number) + ')' : ''}</option>`
                )
                .join('')}
            </select>
            ${drones.length === 0 ? `<p class="subtitle" style="margin-top:6px">登録された機体がありません。<a href="#/drones">機体管理</a>から追加してください。</p>` : ''}
          </div>
          ${renderSelectOtherField({ label: '飛行目的', name: 'purpose', options: PURPOSE_OPTIONS, value: draft.purpose })}
          ${renderSelectOtherField({ label: '飛行エリア', name: 'flight_area', options: AREA_OPTIONS, value: draft.flight_area })}
          <div class="field full">
            <label>特定飛行（該当するものをすべて選択・複数選択可）</label>
            <div class="chip-group">
              ${SPECIFIC_FLIGHT_OPTIONS.map(
                (opt) => `
                <label class="chip ${draft.specific_flight_types.includes(opt) ? 'active' : ''}">
                  <input type="checkbox" name="specific_flight_types" value="${escapeHtml(opt)}" ${
                  draft.specific_flight_types.includes(opt) ? 'checked' : ''
                } />
                  <span>${escapeHtml(opt)}</span>
                </label>`
              ).join('')}
            </div>
          </div>
          <div class="field">
            <label>出発地</label>
            <div class="input-with-suffix">
              <input type="text" name="departure_place" id="departure-place-input" value="${escapeHtml(draft.departure_place)}" placeholder="現在地を取得、または手入力" />
              <button type="button" class="btn btn-sm btn-geo" data-target="departure_place">📍 現在地を取得</button>
            </div>
          </div>
          <div class="field">
            <label>到着地</label>
            <div class="input-with-suffix">
              <input type="text" name="arrival_place" id="arrival-place-input" value="${escapeHtml(draft.arrival_place)}" placeholder="現在地を取得、または手入力" />
              <button type="button" class="btn btn-sm btn-geo" data-target="arrival_place">📍 現在地を取得</button>
            </div>
          </div>
          <div class="field">
            <label>離陸時刻</label>
            <div class="input-with-suffix">
              <input type="time" name="start_time" value="${escapeHtml(draft.start_time || nowHHMM())}" />
              <button type="button" class="btn btn-sm btn-now" data-target="start_time">🕐 現在時刻</button>
            </div>
          </div>
          <div class="field">
            <label>着陸時刻</label>
            <div class="input-with-suffix">
              <input type="time" name="end_time" value="${escapeHtml(draft.end_time || nowHHMM())}" />
              <button type="button" class="btn btn-sm btn-now" data-target="end_time">🕐 現在時刻</button>
            </div>
          </div>
          <div class="field">
            <label>飛行時間（分）</label>
            <input type="number" min="0" name="flight_duration_min" value="${escapeHtml(draft.flight_duration_min)}" placeholder="離着陸時刻から自動計算されます" />
          </div>
          ${renderSelectOtherField({ label: '天候', name: 'weather', options: WEATHER_OPTIONS, value: draft.weather })}
          <div class="field">
            <label>風速</label>
            <div class="input-with-suffix">
              <input type="number" step="0.1" min="0" name="wind_speed" value="${escapeHtml(draft.wind_speed)}" placeholder="例: 2" />
              <span class="suffix">m/s</span>
            </div>
          </div>
          <div class="field">
            <label>気温</label>
            <div class="input-with-suffix">
              <input type="number" step="0.1" name="temperature" value="${escapeHtml(draft.temperature)}" placeholder="例: 25" />
              <span class="suffix">℃</span>
            </div>
          </div>
          <div class="field full">
            <label>特記事項・異常事象</label>
            <textarea name="incident_notes" placeholder="事故・トラブル・ヒヤリハット等があれば記入">${escapeHtml(draft.incident_notes)}</textarea>
          </div>
          <div class="field full">
            <label>備考</label>
            <textarea name="remarks">${escapeHtml(draft.remarks)}</textarea>
          </div>
        </div>
        <div id="log-error"></div>
        <div class="btn-row">
          <button type="button" class="btn" id="btn-back">← 戻る</button>
          <span class="spacer"></span>
          <button type="submit" class="btn btn-primary">次へ：飛行後チェック</button>
        </div>
      </form>
    </div>
  `;

  const form = document.getElementById('log-form');

  form.drone_id.addEventListener('change', () => {
    const selected = drones.find((d) => String(d.id) === form.drone_id.value);
    if (selected && selected.pilot_name) {
      form.pilot_name.value = selected.pilot_name;
    }
  });

  wireSelectOtherField(form, 'purpose');
  wireSelectOtherField(form, 'flight_area');
  wireSelectOtherField(form, 'weather');

  form.querySelectorAll('input[name="specific_flight_types"]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      checkbox.closest('.chip').classList.toggle('active', checkbox.checked);
    });
  });

  form.querySelectorAll('.btn-geo').forEach((geoBtn) => {
    geoBtn.addEventListener('click', () => {
      const targetInput = form[geoBtn.dataset.target];
      if (!navigator.geolocation) {
        showToast('この端末では現在地を取得できません');
        return;
      }
      const originalLabel = geoBtn.textContent;
      geoBtn.disabled = true;
      geoBtn.textContent = '取得中...';
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude.toFixed(6);
          const lng = pos.coords.longitude.toFixed(6);
          const coordsText = `緯度 ${lat}, 経度 ${lng}`;
          targetInput.value = coordsText;
          geoBtn.textContent = '住所を検索中...';
          const address = await reverseGeocode(lat, lng);
          // 検索中にユーザーが手入力していたら上書きしない
          if (targetInput.value === coordsText) {
            targetInput.value = address ? `${address} (${coordsText})` : coordsText;
          }
          geoBtn.disabled = false;
          geoBtn.textContent = originalLabel;
        },
        () => {
          showToast('現在地の取得に失敗しました');
          geoBtn.disabled = false;
          geoBtn.textContent = originalLabel;
        }
      );
    });
  });

  const startInput = form.start_time;
  const endInput = form.end_time;
  const durationInput = form.flight_duration_min;
  // ユーザーが飛行時間を直接編集したら、以降は自動計算で上書きしない
  let durationManuallyEdited = Boolean(durationInput.value);
  durationInput.addEventListener('input', () => {
    durationManuallyEdited = true;
  });
  function autoCalcDuration() {
    if (durationManuallyEdited) return;
    if (startInput.value && endInput.value) {
      const [sh, sm] = startInput.value.split(':').map(Number);
      const [eh, em] = endInput.value.split(':').map(Number);
      let diff = eh * 60 + em - (sh * 60 + sm);
      if (diff < 0) diff += 24 * 60;
      durationInput.value = diff;
    }
  }
  startInput.addEventListener('change', autoCalcDuration);
  endInput.addEventListener('change', autoCalcDuration);

  form.querySelectorAll('.btn-now').forEach((btn) => {
    btn.addEventListener('click', () => {
      form[btn.dataset.target].value = nowHHMM();
      autoCalcDuration();
    });
  });

  function collectDraftFromForm() {
    const fd = new FormData(form);
    draft.flight_date = fd.get('flight_date') || '';
    draft.pilot_name = fd.get('pilot_name') || '';
    const droneVal = fd.get('drone_id');
    if (droneVal) {
      draft.drone_id = droneVal;
      const opt = drones.find((d) => String(d.id) === droneVal);
      draft.drone_name_snapshot = opt ? opt.name : '';
    } else {
      draft.drone_id = null;
      draft.drone_name_snapshot = '';
    }
    draft.purpose = collectSelectOtherValue(fd, 'purpose');
    draft.flight_area = collectSelectOtherValue(fd, 'flight_area');
    draft.specific_flight_types = fd.getAll('specific_flight_types');
    draft.departure_place = fd.get('departure_place') || '';
    draft.arrival_place = fd.get('arrival_place') || '';
    draft.start_time = fd.get('start_time') || '';
    draft.end_time = fd.get('end_time') || '';
    draft.flight_duration_min = fd.get('flight_duration_min') || '';
    draft.weather = collectSelectOtherValue(fd, 'weather');
    draft.wind_speed = fd.get('wind_speed') || '';
    draft.temperature = fd.get('temperature') || '';
    draft.incident_notes = fd.get('incident_notes') || '';
    draft.remarks = fd.get('remarks') || '';
  }

  document.getElementById('btn-back').addEventListener('click', () => {
    collectDraftFromForm();
    navigate('/new/pre');
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    collectDraftFromForm();
    if (!draft.flight_date || !draft.pilot_name.trim()) {
      document.getElementById('log-error').innerHTML =
        '<p class="error-text">飛行年月日と操縦者氏名は必須です。</p>';
      return;
    }
    navigate('/new/post');
  });
}

// ==========================================================
// 飛行記録詳細
// ==========================================================
async function renderFlightDetail(id) {
  appEl.innerHTML = `<p class="subtitle">読み込み中...</p>`;
  const f = await api.flights.get(id);

  function checkResultRows(checks) {
    if (!checks || checks.length === 0) return '<p class="subtitle">記録がありません</p>';
    return checks
      .map(
        (c) => `
        <div class="check-result-item">
          <span class="check-icon ${c.checked ? 'yes' : 'no'}">${c.checked ? '✓' : '✗'}</span>
          <div>
            <div>${escapeHtml(c.item_label)}</div>
            ${c.note ? `<div class="note">備考: ${escapeHtml(c.note)}</div>` : ''}
          </div>
        </div>`
      )
      .join('');
  }

  appEl.innerHTML = `
    <div class="page-head">
      <div>
        <h1>飛行記録詳細</h1>
        <p class="subtitle">${escapeHtml(f.flight_date)} / ${escapeHtml(f.pilot_name)}</p>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn" id="btn-edit">編集</button>
        <button class="btn btn-danger" id="btn-delete">削除</button>
      </div>
    </div>

    <div class="card detail-section">
      <h3>飛行日誌</h3>
      <div class="kv-grid">
        <div class="kv"><div class="k">飛行年月日</div><div class="v">${escapeHtml(f.flight_date)}</div></div>
        <div class="kv"><div class="k">操縦者</div><div class="v">${escapeHtml(f.pilot_name)}</div></div>
        <div class="kv"><div class="k">使用機体</div><div class="v">${escapeHtml(f.drone_name_snapshot || '-')}</div></div>
        <div class="kv"><div class="k">飛行目的</div><div class="v">${escapeHtml(f.purpose || '-')}</div></div>
        <div class="kv"><div class="k">飛行エリア</div><div class="v">${escapeHtml(f.flight_area || '-')}</div></div>
        <div class="kv" style="grid-column: 1 / -1;">
          <div class="k">特定飛行</div>
          <div class="v">
            ${
              f.specific_flight_types && f.specific_flight_types.length
                ? f.specific_flight_types.map((t) => `<span class="badge badge-warn" style="margin: 2px 6px 2px 0;">${escapeHtml(t)}</span>`).join('')
                : '該当なし'
            }
          </div>
        </div>
        <div class="kv"><div class="k">経路</div><div class="v">${escapeHtml(f.departure_place || '-')} → ${escapeHtml(f.arrival_place || '-')}</div></div>
        <div class="kv"><div class="k">離陸 / 着陸時刻</div><div class="v">${escapeHtml(f.start_time || '-')} 〜 ${escapeHtml(f.end_time || '-')}</div></div>
        <div class="kv"><div class="k">飛行時間</div><div class="v">${fmtDuration(f.flight_duration_min)}</div></div>
        <div class="kv"><div class="k">天候 / 風速 / 気温</div><div class="v">${escapeHtml(f.weather || '-')} / ${f.wind_speed !== null && f.wind_speed !== '' ? escapeHtml(f.wind_speed) + ' m/s' : '-'} / ${f.temperature !== null && f.temperature !== '' ? escapeHtml(f.temperature) + ' ℃' : '-'}</div></div>
      </div>
      ${f.incident_notes ? `<p style="margin-top:14px"><strong>特記事項・異常事象:</strong><br>${escapeHtml(f.incident_notes)}</p>` : ''}
      ${f.remarks ? `<p style="margin-top:10px"><strong>備考:</strong><br>${escapeHtml(f.remarks)}</p>` : ''}
    </div>

    <div class="card detail-section">
      <h3>飛行前チェック結果</h3>
      ${checkResultRows(f.pre_checks)}
    </div>

    <div class="card detail-section">
      <h3>飛行後チェック結果</h3>
      ${checkResultRows(f.post_checks)}
    </div>

    <p><a href="#/">← 一覧に戻る</a></p>
  `;

  document.getElementById('btn-edit').addEventListener('click', () => {
    draft = {
      editingId: f.id,
      flight_date: f.flight_date,
      pilot_name: f.pilot_name,
      drone_id: f.drone_id,
      drone_name_snapshot: f.drone_name_snapshot || '',
      purpose: f.purpose || '',
      flight_area: f.flight_area || '',
      specific_flight_types: f.specific_flight_types || [],
      departure_place: f.departure_place || '',
      arrival_place: f.arrival_place || '',
      start_time: f.start_time || '',
      end_time: f.end_time || '',
      flight_duration_min: f.flight_duration_min ?? '',
      weather: f.weather || '',
      wind_speed: f.wind_speed || '',
      temperature: f.temperature || '',
      incident_notes: f.incident_notes || '',
      remarks: f.remarks || '',
      pre_checks: f.pre_checks,
      post_checks: f.post_checks,
    };
    navigate('/new/pre');
  });

  document.getElementById('btn-delete').addEventListener('click', async () => {
    if (!confirm('この飛行記録を削除します。よろしいですか？')) return;
    await api.flights.remove(f.id);
    showToast('削除しました');
    navigate('/');
  });
}

// ==========================================================
// 設定: チェック項目管理
// ==========================================================
let settingsPhase = 'pre';

async function renderSettings() {
  const items = await api.checklist.list(settingsPhase, true);

  appEl.innerHTML = `
    <div class="page-head">
      <div>
        <h1>チェック項目設定</h1>
        <p class="subtitle">飛行前・飛行後チェックリストの項目を追加/編集/並び替えできます</p>
      </div>
    </div>
    <div class="settings-tabs">
      <button data-phase="pre" class="${settingsPhase === 'pre' ? 'active' : ''}">飛行前チェック</button>
      <button data-phase="post" class="${settingsPhase === 'post' ? 'active' : ''}">飛行後チェック</button>
    </div>
    <div class="card">
      ${
        items.length === 0
          ? '<p class="subtitle">項目がありません。下のフォームから追加してください。</p>'
          : items
              .map(
                (item, idx) => `
              <div class="item-row ${item.active ? '' : 'inactive'}" data-id="${item.id}">
                <input type="checkbox" class="toggle-active" ${item.active ? 'checked' : ''} title="有効/無効" />
                <div class="item-label"><input type="text" value="${escapeHtml(item.label)}" /></div>
                <button class="btn btn-sm move-up" ${idx === 0 ? 'disabled' : ''}>▲</button>
                <button class="btn btn-sm move-down" ${idx === items.length - 1 ? 'disabled' : ''}>▼</button>
                <button class="btn btn-sm btn-danger delete-item">削除</button>
              </div>`
              )
              .join('')
      }
      <form class="add-item-form" id="add-item-form">
        <input type="text" id="new-item-label" placeholder="新しいチェック項目を入力" />
        <button type="submit" class="btn btn-primary">追加</button>
      </form>
    </div>
  `;

  appEl.querySelectorAll('.settings-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      settingsPhase = btn.dataset.phase;
      renderSettings();
    });
  });

  appEl.querySelectorAll('.item-row').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('.toggle-active').addEventListener('change', async (e) => {
      await api.checklist.update(id, { active: e.target.checked });
    });
    const labelInput = row.querySelector('.item-label input');
    labelInput.addEventListener('change', async () => {
      await api.checklist.update(id, { label: labelInput.value });
      showToast('項目を更新しました');
    });
    row.querySelector('.delete-item').addEventListener('click', async () => {
      if (!confirm('この項目を削除しますか？')) return;
      await api.checklist.remove(id);
      renderSettings();
    });
    row.querySelector('.move-up').addEventListener('click', () => moveItem(items, id, -1));
    row.querySelector('.move-down').addEventListener('click', () => moveItem(items, id, 1));
  });

  document.getElementById('add-item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('new-item-label');
    if (!input.value.trim()) return;
    await api.checklist.create({ phase: settingsPhase, label: input.value.trim() });
    renderSettings();
  });
}

async function moveItem(items, id, direction) {
  const idx = items.findIndex((i) => String(i.id) === String(id));
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= items.length) return;
  const a = items[idx];
  const b = items[swapIdx];
  await Promise.all([
    api.checklist.update(a.id, { sort_order: b.sort_order }),
    api.checklist.update(b.id, { sort_order: a.sort_order }),
  ]);
  renderSettings();
}

// ==========================================================
// 機体管理
// ==========================================================
async function renderDrones() {
  const drones = await api.drones.list();

  appEl.innerHTML = `
    <div class="page-head">
      <div>
        <h1>機体管理</h1>
        <p class="subtitle">飛行日誌で選択できる機体を登録します</p>
      </div>
    </div>
    <div class="card">
      ${
        drones.length === 0
          ? '<p class="subtitle">登録された機体はありません。</p>'
          : `<div class="table-scroll"><table>
              <thead><tr><th>機体名</th><th>操縦者</th><th>機体登録番号</th><th></th></tr></thead>
              <tbody>
                ${drones
                  .map(
                    (d) => `
                  <tr data-id="${d.id}">
                    <td>${escapeHtml(d.name)}</td>
                    <td>${escapeHtml(d.pilot_name || '-')}</td>
                    <td>${escapeHtml(d.registration_number || '-')}</td>
                    <td><button class="btn btn-sm btn-danger delete-drone">削除</button></td>
                  </tr>`
                  )
                  .join('')}
              </tbody>
            </table></div>`
      }
      <form id="add-drone-form" class="form-grid" style="margin-top:18px">
        <div class="field">
          <label class="required">機体名</label>
          <input type="text" name="name" required placeholder="例: Mavic 3号機" />
        </div>
        <div class="field">
          <label>操縦者</label>
          <input type="text" name="pilot_name" placeholder="例: 山田 太郎" />
        </div>
        <div class="field">
          <label>機体登録番号</label>
          <input type="text" name="registration_number" placeholder="例: JU12345678" />
        </div>
        <div class="field full">
          <button type="submit" class="btn btn-primary">機体を追加</button>
        </div>
      </form>
    </div>
  `;

  appEl.querySelectorAll('.delete-drone').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      if (!confirm('この機体を削除しますか？')) return;
      await api.drones.remove(tr.dataset.id);
      renderDrones();
    });
  });

  document.getElementById('add-drone-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = fd.get('name');
    if (!name || !name.trim()) return;
    await api.drones.create({
      name: name.trim(),
      pilot_name: fd.get('pilot_name'),
      registration_number: fd.get('registration_number'),
    });
    renderDrones();
  });
}
