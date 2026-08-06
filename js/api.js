// Firebase Firestore にデータを保存する実装。
// スマホで記録した内容が自動的にクラウド経由でPCにも同期される。
// (firebase-init.js が読み込む firebase.firestore() のインスタンス `db` を使用)

const DEFAULT_PRE_ITEMS = [
  'プロペラの損傷・変形・取付状態を確認した',
  '機体フレーム・アームの損傷やゆるみがないか確認した',
  'バッテリー残量・膨張・液漏れがないか確認した',
  'バッテリーが正しく取り付けられているか確認した',
  'モーターに異音・異常な発熱がないか確認した',
  'ジンバル・カメラの取付状態と動作を確認した',
  '送信機(プロポ)のバッテリー残量を確認した',
  '各種ケーブル・コネクタの接続を確認した',
  'GPSの受信状態を確認した',
  '送信機と機体の通信状態(電波強度)を確認した',
  '気象情報(風速・風向・降水確率)を確認した',
  '飛行空域・飛行許可(DIPS等)を確認した',
  '飛行経路・緊急着陸場所を確認した',
  '周辺の障害物・人・第三者の有無を確認した',
  'コンパスキャリブレーションを実施した',
  'ホームポイントを設定した',
  '異常時の自動帰還(RTH)設定を確認した',
  '保険加入状況を確認した',
];

const DEFAULT_POST_ITEMS = [
  'プロペラに損傷がないか確認した',
  '機体外観に損傷がないか確認した',
  'バッテリーの温度・膨張を確認した',
  'モーター・ジンバルに異常がないか確認した',
  '記録データ(写真・動画)を確認・バックアップした',
  '飛行時間・バッテリー消費量を記録した',
  '異常事象の有無を記録した',
  '機体・バッテリーを清掃し適切に保管した',
];

const FLIGHTS_COL = 'flights';
const CHECKLIST_COL = 'checklistItems';
const DRONES_COL = 'drones';

// ユーザーごとにデータを完全に分離する (/users/{uid}/{コレクション名})
function userCol(name) {
  return db.collection('users').doc(auth.currentUser.uid).collection(name);
}

function nowLocalString() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function normalizeChecks(checks) {
  if (!Array.isArray(checks)) return [];
  return checks.map((c, idx) => ({
    item_label: c.item_label,
    checked: c.checked ? 1 : 0,
    note: c.note || null,
    sort_order: idx,
  }));
}

async function seedChecklistIfEmpty() {
  const snapshot = await userCol(CHECKLIST_COL).limit(1).get();
  if (!snapshot.empty) return;
  const batch = db.batch();
  DEFAULT_PRE_ITEMS.forEach((label, idx) => {
    const ref = userCol(CHECKLIST_COL).doc();
    batch.set(ref, { phase: 'pre', label, sort_order: idx, active: 1 });
  });
  DEFAULT_POST_ITEMS.forEach((label, idx) => {
    const ref = userCol(CHECKLIST_COL).doc();
    batch.set(ref, { phase: 'post', label, sort_order: idx, active: 1 });
  });
  await batch.commit();
}

const api = {
  // ログイン成功後に一度だけ呼び出す初期化処理
  async init() {
    await seedChecklistIfEmpty();
  },

  flights: {
    async _fetchAllSorted() {
      const snap = await userCol(FLIGHTS_COL).get();
      const flights = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      return flights.sort(
        (a, b) =>
          (b.flight_date || '').localeCompare(a.flight_date || '') ||
          (b.created_at_ms || 0) - (a.created_at_ms || 0)
      );
    },
    async list() {
      const flights = await this._fetchAllSorted();
      return flights.map((f) => ({
        id: f.id,
        flight_date: f.flight_date,
        pilot_name: f.pilot_name,
        drone_name_snapshot: f.drone_name_snapshot,
        purpose: f.purpose,
        departure_place: f.departure_place,
        arrival_place: f.arrival_place,
        start_time: f.start_time,
        end_time: f.end_time,
        flight_duration_min: f.flight_duration_min,
        status: f.status,
        created_at: f.created_at,
      }));
    },
    // CSVエクスポート用: 全フィールドを含む完全な記録一覧
    async listFull() {
      return this._fetchAllSorted();
    },
    async get(id) {
      const doc = await userCol(FLIGHTS_COL).doc(id).get();
      if (!doc.exists) throw new Error('飛行記録が見つかりません');
      return { id: doc.id, ...doc.data() };
    },
    async create(data) {
      const now = nowLocalString();
      const flight = {
        flight_date: data.flight_date || '',
        pilot_name: data.pilot_name || '',
        drone_id: data.drone_id || null,
        drone_name_snapshot: data.drone_name_snapshot || '',
        purpose: data.purpose || '',
        departure_place: data.departure_place || '',
        arrival_place: data.arrival_place || '',
        start_time: data.start_time || '',
        end_time: data.end_time || '',
        flight_duration_min: data.flight_duration_min || '',
        weather: data.weather || '',
        wind_speed: data.wind_speed || '',
        temperature: data.temperature || '',
        flight_area: data.flight_area || '',
        specific_flight_types: Array.isArray(data.specific_flight_types) ? data.specific_flight_types : [],
        incident_notes: data.incident_notes || '',
        remarks: data.remarks || '',
        status: data.status || 'completed',
        pre_checks: normalizeChecks(data.pre_checks),
        post_checks: normalizeChecks(data.post_checks),
        created_at: now,
        updated_at: now,
        created_at_ms: Date.now(),
      };
      const ref = await userCol(FLIGHTS_COL).add(flight);
      return { id: ref.id, ...flight };
    },
    async update(id, data) {
      const ref = userCol(FLIGHTS_COL).doc(id);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('飛行記録が見つかりません');

      const patch = { ...data, updated_at: nowLocalString() };
      delete patch.id;
      if (data.pre_checks !== undefined) patch.pre_checks = normalizeChecks(data.pre_checks);
      if (data.post_checks !== undefined) patch.post_checks = normalizeChecks(data.post_checks);
      if (data.specific_flight_types !== undefined) {
        patch.specific_flight_types = Array.isArray(data.specific_flight_types) ? data.specific_flight_types : [];
      }

      await ref.update(patch);
      const updatedDoc = await ref.get();
      return { id: updatedDoc.id, ...updatedDoc.data() };
    },
    async remove(id) {
      await userCol(FLIGHTS_COL).doc(id).delete();
      return null;
    },
  },

  checklist: {
    async list(phase, all) {
      const snap = await userCol(CHECKLIST_COL).get();
      const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      return items
        .filter((i) => (!phase || i.phase === phase) && (all || i.active))
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.id).localeCompare(String(b.id)));
    },
    async create(data) {
      const snap = await userCol(CHECKLIST_COL).where('phase', '==', data.phase).get();
      const maxOrder = snap.docs.reduce((m, d) => Math.max(m, d.data().sort_order || 0), -1);
      const item = {
        phase: data.phase,
        label: (data.label || '').trim(),
        sort_order: maxOrder + 1,
        active: 1,
      };
      const ref = await userCol(CHECKLIST_COL).add(item);
      return { id: ref.id, ...item };
    },
    async update(id, data) {
      const ref = userCol(CHECKLIST_COL).doc(id);
      const patch = {};
      if (data.label !== undefined) patch.label = data.label;
      if (data.active !== undefined) patch.active = data.active ? 1 : 0;
      if (data.sort_order !== undefined) patch.sort_order = data.sort_order;
      await ref.update(patch);
      const doc = await ref.get();
      return { id: doc.id, ...doc.data() };
    },
    async remove(id) {
      await userCol(CHECKLIST_COL).doc(id).delete();
      return null;
    },
  },

  drones: {
    async list() {
      const snap = await userCol(DRONES_COL).get();
      return snap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => (b.created_at_ms || 0) - (a.created_at_ms || 0));
    },
    async create(data) {
      const drone = {
        name: (data.name || '').trim(),
        pilot_name: data.pilot_name || null,
        registration_number: data.registration_number || null,
        created_at: nowLocalString(),
        created_at_ms: Date.now(),
      };
      const ref = await userCol(DRONES_COL).add(drone);
      return { id: ref.id, ...drone };
    },
    async remove(id) {
      await userCol(DRONES_COL).doc(id).delete();
      return null;
    },
  },
};
