import { createSlice, current, type PayloadAction } from '@reduxjs/toolkit';
import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';

export type ReconFieldType = 'text' | 'number' | 'date';
export interface CaliberField { id: string; label: string; type: ReconFieldType; required: boolean; }
export interface CaliberVersion { id: string; label: string; createdAt: string; fields: CaliberField[]; }
export interface CaliberDraft { id: string; createdBy: string; baseVersionId: string; updatedAt: string; fields: CaliberField[]; conflict: string | null; }
export interface ReconRecord { id: string; caliberVersionId: string; pushedAt: string; payload: Record<string, string>; }
export type BatchStatus = 'in_flight' | 'invalidated' | 'finalized';
export interface BatchValidation { checkedVersionId: string; checkedAt: string; errors: string[]; frozen: boolean; }
export interface ReconBatch { id: string; supplier: string; caliberVersionId: string; status: BatchStatus; records: ReconRecord[]; validation: BatchValidation | null; }
export type RecalcTaskStatus = 'pending' | 'failed' | 'done';
export interface RecalcTask { id: string; targetVersionId: string; batchIds: string[]; cursor: number; chunkSize: number; status: RecalcTaskStatus; log: string[]; }
export interface ReconState { versions: CaliberVersion[]; activeVersionId: string; drafts: CaliberDraft[]; batches: ReconBatch[]; task: RecalcTask | null; capacity: number; }

const today = () => new Date().toISOString().slice(0, 10);

export function validateBatch(batch: ReconBatch, version: CaliberVersion, checkedAt: string): BatchValidation {
  const errors: string[] = [];
  for (const record of batch.records) {
    for (const field of version.fields) {
      const raw = record.payload[field.id];
      const empty = raw === undefined || String(raw).trim() === '';
      if (field.required && empty) { errors.push(`${record.id}：缺少必填字段「${field.label}」`); continue; }
      if (!empty && field.type === 'number' && Number.isNaN(Number(raw))) errors.push(`${record.id}：「${field.label}」应为数字，当前为 ${raw}`);
      if (!empty && field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) errors.push(`${record.id}：「${field.label}」应为 YYYY-MM-DD 格式`);
    }
  }
  return { checkedVersionId: version.id, checkedAt, errors, frozen: false };
}

const v1: CaliberVersion = {
  id: 'v1', label: '对账口径 v1', createdAt: '2026-09-20',
  fields: [
    { id: 'supplier', label: '供应商', type: 'text', required: true },
    { id: 'orderNo', label: '订单号', type: 'text', required: true },
    { id: 'amount', label: '金额', type: 'number', required: true },
    { id: 'currency', label: '币种', type: 'text', required: false },
    { id: 'settleDate', label: '结算日期', type: 'date', required: false }
  ]
};

function record(id: string, payload: Record<string, string>): ReconRecord {
  return { id, caliberVersionId: 'v1', pushedAt: '2026-09-30', payload };
}

function seedBatches(): ReconBatch[] {
  const batches: ReconBatch[] = [
    {
      id: 'RB-1001', supplier: '华东供应链', caliberVersionId: 'v1', status: 'in_flight', validation: null, records: [
        record('RB-1001-1', { supplier: '华东供应链', orderNo: 'PO-8801', amount: '12000', currency: 'CNY', settleDate: '2026-10-05' }),
        record('RB-1001-2', { supplier: '华东供应链', orderNo: 'PO-8802', amount: '8600', currency: 'CNY', settleDate: '2026-10-06' })
      ]
    },
    {
      id: 'RB-1002', supplier: '北方物流', caliberVersionId: 'v1', status: 'in_flight', validation: null, records: [
        record('RB-1002-1', { supplier: '北方物流', orderNo: 'PO-9102', amount: '4300', currency: '', settleDate: '2026-10-08' })
      ]
    },
    {
      id: 'RB-1003', supplier: '西部制造', caliberVersionId: 'v1', status: 'finalized',
      validation: { checkedVersionId: 'v1', checkedAt: '2026-09-28', errors: [], frozen: true },
      records: [record('RB-1003-1', { supplier: '西部制造', orderNo: 'PO-7601', amount: '25900', currency: 'CNY', settleDate: '2026-09-30' })]
    },
    {
      id: 'RB-1004', supplier: '华南贸易', caliberVersionId: 'v1', status: 'in_flight', validation: null, records: [
        record('RB-1004-1', { supplier: '华南贸易', orderNo: 'PO-9301', amount: '15200', currency: 'USD', settleDate: '' })
      ]
    },
    {
      id: 'RB-1005', supplier: '中原商贸', caliberVersionId: 'v1', status: 'in_flight', validation: null, records: [
        record('RB-1005-1', { supplier: '中原商贸', orderNo: 'PO-9550', amount: '6800', currency: '', settleDate: '2026-10-02' }),
        record('RB-1005-2', { supplier: '中原商贸', orderNo: 'PO-9551', amount: '9100', currency: 'CNY', settleDate: '2026-10-03' })
      ]
    }
  ];
  for (const batch of batches) if (batch.status !== 'finalized') batch.validation = validateBatch(batch, v1, '2026-09-30');
  return batches;
}

// 两名运营同时基于 v1 编辑的同一份口径草稿，用于演示并发提交
function sharedDraftFields(): CaliberField[] {
  return [
    { id: 'supplier', label: '供应商', type: 'text', required: true },
    { id: 'orderNo', label: '订单号', type: 'text', required: true },
    { id: 'amount', label: '金额', type: 'number', required: true },
    { id: 'currency', label: '币种', type: 'text', required: true },
    { id: 'settleDate', label: '结算日期', type: 'date', required: false },
    { id: 'taxRate', label: '税率(%)', type: 'number', required: false }
  ];
}

function buildInitial(): ReconState {
  return {
    versions: [v1],
    activeVersionId: 'v1',
    drafts: [
      { id: 'd1', createdBy: '运营甲', baseVersionId: 'v1', updatedAt: '2026-10-03', fields: sharedDraftFields(), conflict: null },
      { id: 'd2', createdBy: '运营乙', baseVersionId: 'v1', updatedAt: '2026-10-03', fields: sharedDraftFields(), conflict: null }
    ],
    batches: seedBatches(),
    task: null,
    capacity: 2
  };
}

const initial = buildInitial();

export const RECON_STORAGE_KEY = 'yf55-recon-state';

export function loadReconState(): ReconState {
  if (typeof localStorage === 'undefined') return initial;
  const raw = localStorage.getItem(RECON_STORAGE_KEY);
  if (!raw) return initial;
  try { return { ...buildInitial(), ...(JSON.parse(raw) as ReconState) }; } catch { return initial; }
}

const slice = createSlice({
  name: 'recon',
  initialState: initial,
  reducers: {
    addDraftField(state, action: PayloadAction<string>) {
      const draft = state.drafts.find((item) => item.id === action.payload);
      if (!draft) return;
      draft.fields.push({ id: `f${Date.now()}`, label: '新字段', type: 'text', required: false });
      draft.updatedAt = today();
    },
    updateDraftField(state, action: PayloadAction<{ draftId: string; fieldId: string; patch: Partial<CaliberField> }>) {
      const draft = state.drafts.find((item) => item.id === action.payload.draftId);
      const field = draft?.fields.find((item) => item.id === action.payload.fieldId);
      if (!draft || !field) return;
      Object.assign(field, action.payload.patch);
      draft.updatedAt = today();
    },
    removeDraftField(state, action: PayloadAction<{ draftId: string; fieldId: string }>) {
      const draft = state.drafts.find((item) => item.id === action.payload.draftId);
      if (!draft) return;
      draft.fields = draft.fields.filter((item) => item.id !== action.payload.fieldId);
      draft.updatedAt = today();
    },
    submitDraft(state, action: PayloadAction<{ draftId: string }>) {
      const draft = state.drafts.find((item) => item.id === action.payload.draftId);
      if (!draft) return;
      if (draft.baseVersionId !== state.activeVersionId) {
        // 并发冲突：另一运营已抢先发布，后到的草稿改挂最新基线、重算影响面并保留
        const active = state.versions.find((item) => item.id === state.activeVersionId);
        draft.baseVersionId = state.activeVersionId;
        draft.conflict = `提交时生效口径已是「${active?.label ?? state.activeVersionId}」（另一运营抢先发布），影响面已按最新基线重算，本口径保留为草稿，请预检确认后再次提交。`;
        draft.updatedAt = today();
        return;
      }
      const id = `v${state.versions.length + 1}`;
      const version: CaliberVersion = { id, label: `对账口径 ${id}`, createdAt: today(), fields: current(draft).fields };
      state.versions.push(version);
      state.activeVersionId = id;
      // 在途批次立即失效，定稿批次保持原样
      const affected = state.batches.filter((item) => item.status !== 'finalized');
      for (const batch of affected) { batch.status = 'invalidated'; batch.validation = null; }
      state.task = affected.length
        ? { id: `task-${id}`, targetVersionId: id, batchIds: affected.map((item) => item.id), cursor: 0, chunkSize: state.capacity, status: 'pending', log: [`${version.label} 已发布：${affected.length} 个在途批次失效，按新口径分批重算（容量 ${state.capacity} 批/次）`] }
        : null;
      state.drafts = state.drafts.filter((item) => item.id !== draft.id);
    },
    runRecalcChunk(state, action: PayloadAction<{ simulateFailure: boolean }>) {
      const task = state.task;
      if (!task || task.status === 'done') return;
      const version = state.versions.find((item) => item.id === task.targetVersionId);
      if (!version) return;
      const chunk = task.batchIds.slice(task.cursor, task.cursor + task.chunkSize);
      if (!chunk.length) { task.status = 'done'; return; }
      const stopAt = action.payload.simulateFailure ? Math.max(1, Math.floor(chunk.length / 2)) : chunk.length;
      for (const batchId of chunk.slice(0, stopAt)) {
        const batch = state.batches.find((item) => item.id === batchId);
        if (batch && batch.status !== 'finalized') {
          batch.validation = validateBatch(batch, version, today());
          batch.status = 'in_flight';
        }
        task.cursor += 1;
      }
      if (stopAt < chunk.length) {
        task.status = 'failed';
        task.log.push(`执行中断（模拟故障）：已处理 ${task.cursor}/${task.batchIds.length}，断点已保存，可重试续算`);
        return;
      }
      task.log.push(`本批 ${stopAt} 个批次重算完成，进度 ${task.cursor}/${task.batchIds.length}`);
      if (task.cursor >= task.batchIds.length) { task.status = 'done'; task.log.push('全部在途批次已按新口径重算完毕'); }
      else task.status = 'pending';
    },
    finalizeBatch(state, action: PayloadAction<string>) {
      const batch = state.batches.find((item) => item.id === action.payload);
      if (!batch || batch.status !== 'in_flight' || !batch.validation || batch.validation.errors.length) return;
      batch.status = 'finalized';
      batch.validation.frozen = true;
    },
    pushBatch(state, action: PayloadAction<{ payload: Record<string, string> }>) {
      const version = state.versions.find((item) => item.id === state.activeVersionId);
      if (!version) return;
      const max = state.batches.reduce((acc, item) => Math.max(acc, Number(item.id.replace('RB-', '')) || 0), 1000);
      const id = `RB-${max + 1}`;
      const batch: ReconBatch = {
        id,
        supplier: action.payload.payload['supplier']?.trim() || '外部系统',
        caliberVersionId: version.id,
        status: 'in_flight',
        records: [{ id: `${id}-1`, caliberVersionId: version.id, pushedAt: today(), payload: action.payload.payload }],
        validation: null
      };
      batch.validation = validateBatch(batch, version, today());
      state.batches.unshift(batch);
    },
    replaceReconState(_state, action: PayloadAction<ReconState>) { return action.payload; }
  }
});

export interface ImpactPreview { added: string[]; removed: string[]; tightened: string[]; affectedBatchIds: string[]; capacity: number; activeLabel: string; }

export const reconApi = createApi({
  reducerPath: 'reconApi', baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    impactPreview: builder.query<ImpactPreview, string>({
      queryFn: (draftId) => {
        const state = loadReconState();
        const draft = state.drafts.find((item) => item.id === draftId);
        const active = state.versions.find((item) => item.id === state.activeVersionId) ?? state.versions.at(-1);
        if (!draft || !active) return { data: { added: [], removed: [], tightened: [], affectedBatchIds: [], capacity: state.capacity, activeLabel: active?.label ?? '' } };
        const base = new Map(active.fields.map((field) => [field.id, field]));
        const next = new Map(draft.fields.map((field) => [field.id, field]));
        return {
          data: {
            added: draft.fields.filter((field) => !base.has(field.id)).map((field) => field.label),
            removed: active.fields.filter((field) => !next.has(field.id)).map((field) => field.label),
            tightened: draft.fields.filter((field) => { const old = base.get(field.id); return Boolean(old && !old.required && field.required); }).map((field) => field.label),
            affectedBatchIds: state.batches.filter((item) => item.status !== 'finalized').map((item) => item.id),
            capacity: state.capacity,
            activeLabel: active.label
          }
        };
      }
    })
  })
});

export const { useLazyImpactPreviewQuery } = reconApi;
export const { addDraftField, finalizeBatch, pushBatch, removeDraftField, replaceReconState, runRecalcChunk, submitDraft, updateDraftField } = slice.actions;
export const reconReducer = slice.reducer;
