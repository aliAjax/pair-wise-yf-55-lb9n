import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type FieldType = 'text' | 'number' | 'select' | 'date';

/** 字段口径：平台统一维护的对账单字段定义 */
export interface CaliberField {
  id: string;
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  min?: number;
}

export interface Caliber {
  id: string;
  version: number;
  label: string;
  status: 'active' | 'draft' | 'archived';
  /** 草稿所基于的基线口径 id，用于并发提交时检测基线是否已推进 */
  baselineId: string;
  fields: CaliberField[];
  createdAt: string;
  /** 并发提交时基线已推进的说明 */
  baselineNote?: string;
}

export type BatchStatus = 'in-transit' | 'finalized' | 'failed' | 'recalculating';

/** 对账批：外部系统推送，解释口径在推送时冻结 */
export interface ReconciliationBatch {
  id: string;
  code: string;
  supplier: string;
  pushTime: string;
  /** 推送时的生效口径（冻结），已收数据始终按此口径解释 */
  caliberIdAtPush: string;
  data: Record<string, string>;
  status: BatchStatus;
  result?: Record<string, unknown>;
  invalidReason?: string;
}

export type TaskStatus = 'pending' | 'running' | 'paused' | 'failed' | 'done';

/** 重算任务：按容量分批、断点续跑 */
export interface RecalcTask {
  id: string;
  caliberId: string;
  caliberLabel: string;
  status: TaskStatus;
  affectedBatchIds: string[];
  /** 每批容量 */
  chunkSize: number;
  /** 断点：下一个待处理批次的下标 */
  checkpoint: number;
  /** 按新口径校验失败的批次 */
  failedBatchIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ReconState {
  calibers: Caliber[];
  batches: ReconciliationBatch[];
  tasks: RecalcTask[];
  activeCaliberId: string;
  draftCaliberId: string | null;
}

const v1Fields: CaliberField[] = [
  { id: 'f1', name: 'supplierCode', label: '供应商编码', type: 'text', required: true },
  { id: 'f2', name: 'statementNo', label: '对账单号', type: 'text', required: true },
  { id: 'f3', name: 'amount', label: '对账金额', type: 'number', required: true, min: 0 },
  { id: 'f4', name: 'invoiceDate', label: '开票日期', type: 'date', required: true },
  { id: 'f5', name: 'taxRate', label: '税率', type: 'select', required: false, options: ['13%', '6%', '3%'] },
  { id: 'f6', name: 'currency', label: '币种', type: 'select', required: false, options: ['CNY', 'USD'] }
];

const v2DraftFields: CaliberField[] = [
  ...v1Fields,
  { id: 'f7', name: 'taxCode', label: '税收编码', type: 'text', required: true }
];

const initial: ReconState = {
  activeCaliberId: 'cal-v1',
  draftCaliberId: null,
  calibers: [
    { id: 'cal-v1', version: 1, label: '供应商对账口径 v1', status: 'active', baselineId: 'cal-v1', fields: v1Fields, createdAt: '2026-09-01' },
    { id: 'cal-d1', version: 2, label: '供应商对账口径 v2（草稿）', status: 'draft', baselineId: 'cal-v1', fields: v2DraftFields, createdAt: '2026-10-01' }
  ],
  batches: [
    { id: 'b1', code: 'B20261001-001', supplier: '华东供应链', pushTime: '2026-10-01T09:00:00Z', caliberIdAtPush: 'cal-v1', data: { supplierCode: 'HD001', statementNo: 'ST-001', amount: '12000', invoiceDate: '2026-10-15', taxRate: '13%', currency: 'CNY' }, status: 'in-transit' },
    { id: 'b2', code: 'B20261001-002', supplier: '南方贸易', pushTime: '2026-10-01T10:30:00Z', caliberIdAtPush: 'cal-v1', data: { supplierCode: 'NF002', statementNo: 'ST-002', amount: '58000', invoiceDate: '2026-10-20', taxRate: '6%', currency: 'CNY' }, status: 'in-transit' },
    { id: 'b3', code: 'B20260930-001', supplier: '华东供应链', pushTime: '2026-09-30T08:00:00Z', caliberIdAtPush: 'cal-v1', data: { supplierCode: 'HD001', statementNo: 'ST-000', amount: '32000', invoiceDate: '2026-09-30', taxRate: '13%', currency: 'CNY' }, status: 'finalized', result: { supplierCode: 'HD001', statementNo: 'ST-000', amount: '32000', finalizedAt: '2026-09-30T12:00:00Z' } },
    { id: 'b4', code: 'B20260929-001', supplier: '北方物流', pushTime: '2026-09-29T08:00:00Z', caliberIdAtPush: 'cal-v1', data: { supplierCode: 'BF003', statementNo: 'ST-099', amount: '9500', invoiceDate: '2026-09-29', taxRate: '3%', currency: 'CNY' }, status: 'finalized', result: { supplierCode: 'BF003', statementNo: 'ST-099', amount: '9500', finalizedAt: '2026-09-29T12:00:00Z' } }
  ],
  tasks: []
};

let seq = 0;
const rid = (prefix: string) => `${prefix}-${Date.now()}-${seq++}`;

/** 按口径校验数据，返回错误信息列表 */
export function validateData(data: Record<string, string>, caliber: Caliber): string[] {
  const errors: string[] = [];
  for (const f of caliber.fields) {
    const v = data[f.name];
    if (f.required && (v === undefined || v === '')) {
      errors.push(`${f.label} 必填`);
    } else if (v !== undefined && v !== '') {
      if (f.type === 'number' && (Number.isNaN(Number(v)) || (f.min !== undefined && Number(v) < f.min))) {
        errors.push(`${f.label} 必须为不小于 ${f.min ?? 0} 的数字`);
      } else if (f.type === 'select' && f.options && !f.options.includes(v)) {
        errors.push(`${f.label} 取值非法`);
      } else if (f.type === 'date' && Number.isNaN(Date.parse(v))) {
        errors.push(`${f.label} 日期格式错误`);
      }
    }
  }
  return errors;
}

/** 未定稿的批次（在途 / 失败 / 重算中）都受口径变动影响 */
function openBatches(state: ReconState): ReconciliationBatch[] {
  return state.batches.filter((b) => b.status !== 'finalized');
}

/** 计算某口径相对其冻结基线的受影响在途批次（纯函数，供发布前影响面与并发重算复用） */
function computeAffected(state: ReconState, caliber: Caliber): string[] {
  return openBatches(state)
    .filter((b) => {
      const frozen = state.calibers.find((c) => c.id === b.caliberIdAtPush);
      if (!frozen) return false;
      // 新口径删除了批次数据仍在使用的字段
      const newNames = new Set(caliber.fields.map((f) => f.name));
      if (Object.keys(b.data).some((name) => !newNames.has(name))) return true;
      // 新口径校验比冻结口径更严
      return validateData(b.data, caliber).length > validateData(b.data, frozen).length;
    })
    .map((b) => b.id);
}

/** 供组件使用的影响面选择器 */
export function affectedBatchIds(state: ReconState, caliberId: string): string[] {
  const caliber = state.calibers.find((c) => c.id === caliberId);
  if (!caliber) return [];
  return computeAffected(state, caliber);
}

/** 按容量处理一批：失败则在该批次处留下断点，成功则推进检查点 */
function runChunk(state: ReconState, task: RecalcTask) {
  task.status = 'running';
  const caliber = state.calibers.find((c) => c.id === task.caliberId)!;
  const end = Math.min(task.checkpoint + task.chunkSize, task.affectedBatchIds.length);
  for (let i = task.checkpoint; i < end; i++) {
    const batchId = task.affectedBatchIds[i];
    const batch = state.batches.find((b) => b.id === batchId);
    if (!batch) continue;
    const errors = validateData(batch.data, caliber);
    if (errors.length) {
      batch.status = 'failed';
      batch.invalidReason = errors.join('；');
      if (!task.failedBatchIds.includes(batchId)) task.failedBatchIds.push(batchId);
      task.checkpoint = i;
      task.status = 'failed';
      task.updatedAt = new Date().toISOString();
      return;
    }
    batch.status = 'in-transit';
    batch.invalidReason = undefined;
    task.failedBatchIds = task.failedBatchIds.filter((id) => id !== batchId);
  }
  task.checkpoint = end;
  task.updatedAt = new Date().toISOString();
  task.status = task.failedBatchIds.length > 0 || task.checkpoint < task.affectedBatchIds.length ? 'paused' : 'done';
  if (task.failedBatchIds.length > 0) task.status = 'failed';
}

const slice = createSlice({
  name: 'recon',
  initialState: initial,
  reducers: {
    replaceReconState(_state, action: PayloadAction<ReconState>) {
      return action.payload;
    },
    /** 外部系统推送对账批：按当前生效口径校验，解释口径随推送动作冻结 */
    pushBatch(state, action: PayloadAction<{ supplier: string; data: Record<string, string> }>) {
      const active = state.calibers.find((c) => c.id === state.activeCaliberId)!;
      const n = state.batches.length + 1;
      state.batches.push({
        id: rid('b'),
        code: `B${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(n).padStart(3, '0')}`,
        supplier: action.payload.supplier,
        pushTime: new Date().toISOString(),
        caliberIdAtPush: active.id,
        data: action.payload.data,
        status: 'in-transit'
      });
    },
    /** 在途批次定稿：结果按推送时冻结口径保持原样 */
    finalizeBatch(state, action: PayloadAction<string>) {
      const b = state.batches.find((x) => x.id === action.payload);
      if (!b || b.status === 'finalized') return;
      b.status = 'finalized';
      b.result = { ...b.data, finalizedAt: new Date().toISOString() };
    },
    /** 基于当前生效口径起草新版本 */
    createDraft(state) {
      const active = state.calibers.find((c) => c.id === state.activeCaliberId)!;
      const draft: Caliber = {
        id: rid('cal'),
        version: active.version + 1,
        label: `供应商对账口径 v${active.version + 1}（草稿）`,
        status: 'draft',
        baselineId: active.id,
        fields: structuredClone(active.fields),
        createdAt: new Date().toISOString()
      };
      state.calibers.push(draft);
      state.draftCaliberId = draft.id;
    },
    /** 模拟两名运营基于同一基线同时起草 */
    createConcurrentDrafts(state) {
      const active = state.calibers.find((c) => c.id === state.activeCaliberId)!;
      for (let i = 0; i < 2; i++) {
        state.calibers.push({
          id: rid('cal'),
          version: active.version + 1,
          label: `供应商对账口径 v${active.version + 1}（运营${i === 0 ? '甲' : '乙'}草稿）`,
          status: 'draft',
          baselineId: active.id,
          fields: structuredClone(active.fields),
          createdAt: new Date().toISOString()
        });
      }
    },
    selectDraft(state, action: PayloadAction<string | null>) {
      state.draftCaliberId = action.payload;
    },
    updateDraftField(state, action: PayloadAction<{ fieldId: string; patch: Partial<CaliberField> }>) {
      const draft = state.calibers.find((c) => c.id === state.draftCaliberId && c.status === 'draft');
      if (!draft) return;
      const f = draft.fields.find((x) => x.id === action.payload.fieldId);
      if (f) Object.assign(f, action.payload.patch);
    },
    addDraftField(state) {
      const draft = state.calibers.find((c) => c.id === state.draftCaliberId && c.status === 'draft');
      if (!draft) return;
      draft.fields.push({ id: rid('f'), name: `field${draft.fields.length + 1}`, label: '新字段', type: 'text', required: false });
    },
    removeDraftField(state, action: PayloadAction<string>) {
      const draft = state.calibers.find((c) => c.id === state.draftCaliberId && c.status === 'draft');
      if (!draft) return;
      draft.fields = draft.fields.filter((f) => f.id !== action.payload);
    },
    /**
     * 发布口径。
     * - 基线未推进：正常发布，受影响在途批次立即失效，创建分批重算任务。
     * - 基线已推进（并发提交）：按最新基线重算影响面并保留草稿，不覆盖已发布口径。
     */
    publishCaliber(state, action: PayloadAction<string>) {
      const draft = state.calibers.find((c) => c.id === action.payload && c.status === 'draft');
      if (!draft) return;
      const active = state.calibers.find((c) => c.id === state.activeCaliberId)!;

      if (draft.baselineId !== active.id) {
        const affected = computeAffected(state, draft);
        draft.baselineId = active.id;
        draft.baselineNote = `基线已推进至 ${active.label}，影响面已按最新基线重算（${affected.length} 个在途批次受影响），保留草稿待确认后再发布。`;
        return;
      }

      const affected = computeAffected(state, draft);
      draft.status = 'active';
      draft.label = `供应商对账口径 v${draft.version}`;
      state.calibers.forEach((c) => {
        if (c.status === 'active' && c.id !== draft.id) c.status = 'archived';
      });
      state.activeCaliberId = draft.id;
      state.draftCaliberId = null;

      const task: RecalcTask = {
        id: rid('task'),
        caliberId: draft.id,
        caliberLabel: draft.label,
        status: 'pending',
        affectedBatchIds: affected,
        chunkSize: 3,
        checkpoint: 0,
        failedBatchIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.tasks.push(task);
      affected.forEach((id) => {
        const b = state.batches.find((x) => x.id === id);
        if (b && b.status !== 'finalized') {
          b.status = 'recalculating';
          b.invalidReason = undefined;
        }
      });
    },
    /** 处理下一批：按新口径重新校验，失败则在该批次处留下断点 */
    processChunk(state, action: PayloadAction<string>) {
      const task = state.tasks.find((t) => t.id === action.payload);
      if (!task || task.status === 'done') return;
      runChunk(state, task);
    },
    /** 失败后从断点恢复重试（同样按容量分批推进） */
    resumeTask(state, action: PayloadAction<string>) {
      const task = state.tasks.find((t) => t.id === action.payload);
      if (!task || (task.status !== 'failed' && task.status !== 'paused')) return;
      runChunk(state, task);
    },
    /** 模拟按新口径补全失败批次数据，使其可通过重算 */
    fixBatchData(state, action: PayloadAction<{ batchId: string; caliberId: string }>) {
      const batch = state.batches.find((b) => b.id === action.payload.batchId);
      const caliber = state.calibers.find((c) => c.id === action.payload.caliberId);
      if (!batch || !caliber) return;
      for (const f of caliber.fields) {
        if (f.required && (batch.data[f.name] === undefined || batch.data[f.name] === '')) {
          batch.data[f.name] = f.type === 'number' ? '0' : f.type === 'select' ? f.options?.[0] ?? '' : f.type === 'date' ? new Date().toISOString().slice(0, 10) : '已补全';
        }
      }
      batch.invalidReason = undefined;
    }
  }
});

export const {
  replaceReconState,
  pushBatch,
  finalizeBatch,
  createDraft,
  createConcurrentDrafts,
  selectDraft,
  updateDraftField,
  addDraftField,
  removeDraftField,
  publishCaliber,
  processChunk,
  resumeTask,
  fixBatchData
} = slice.actions;

export const reconReducer = slice.reducer;
export type ReconRoot = { recon: ReconState };
