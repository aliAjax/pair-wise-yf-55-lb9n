import {
  Alert, Box, Button, Card, CardContent, Chip, Divider, LinearProgress,
  MenuItem, Stack, Tab, Tabs, TextField, Typography
} from '@mui/material';
import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  addDraftField, affectedBatchIds, createConcurrentDrafts, createDraft, finalizeBatch,
  fixBatchData, processChunk, publishCaliber, pushBatch, removeDraftField, resumeTask,
  selectDraft, updateDraftField, validateData,
  type Caliber, type CaliberField, type FieldType, type ReconState, type RecalcTask, type ReconciliationBatch
} from './reconSlice';

const fieldTypeLabel: Record<FieldType, string> = { text: '文本', number: '数字', select: '枚举', date: '日期' };
const batchStatusMeta: Record<ReconciliationBatch['status'], { label: string; color: 'default' | 'primary' | 'success' | 'error' | 'warning' }> = {
  'in-transit': { label: '在途', color: 'primary' },
  finalized: { label: '定稿', color: 'success' },
  failed: { label: '失效', color: 'error' },
  recalculating: { label: '重算中', color: 'warning' }
};
const taskStatusMeta: Record<RecalcTask['status'], { label: string; color: 'default' | 'primary' | 'success' | 'error' | 'warning' }> = {
  pending: { label: '待处理', color: 'default' },
  running: { label: '处理中', color: 'primary' },
  paused: { label: '分批暂停', color: 'warning' },
  failed: { label: '失败待恢复', color: 'error' },
  done: { label: '全部完成', color: 'success' }
};

function CaliberTab({ state }: { state: ReconState }) {
  const dispatch = useDispatch();
  const active = state.calibers.find((c) => c.id === state.activeCaliberId)!;
  const drafts = state.calibers.filter((c) => c.status === 'draft');
  const editing = state.calibers.find((c) => c.id === state.draftCaliberId && c.status === 'draft') ?? null;
  const impactOf = (caliber: Caliber) => affectedBatchIds(state, caliber.id);

  return (
    <Stack spacing={2}>
      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
            <Typography variant="h6">当前生效口径</Typography>
            <Chip label={active.label} color="primary" />
          </Stack>
          <Typography variant="body2" color="text.secondary" mb={1}>外部系统照此推送；新推送按此校验，解释口径随推送动作冻结。</Typography>
          <Stack direction="row" gap={1} flexWrap="wrap">
            {active.fields.map((f) => <Chip key={f.id} size="small" variant="outlined" label={`${f.label}${f.required ? ' *' : ''} · ${fieldTypeLabel[f.type]}`} />)}
          </Stack>
        </CardContent>
      </Card>

      <Stack direction="row" gap={1}>
        <Button variant="contained" onClick={() => dispatch(createDraft())}>起草新版本</Button>
        <Button variant="outlined" onClick={() => dispatch(createConcurrentDrafts())}>模拟两名运营同时起草</Button>
      </Stack>

      {drafts.length === 0 && <Alert severity="info">暂无草稿。起草新版本后可编辑字段、查看发布前影响面。</Alert>}

      {drafts.map((draft) => {
        const affected = impactOf(draft);
        const isEditing = editing?.id === draft.id;
        return (
          <Card key={draft.id} variant="outlined" sx={isEditing ? { borderColor: 'primary.main' } : undefined}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" gap={1}>
                <Stack direction="row" gap={1} alignItems="center">
                  <Typography fontWeight={700}>{draft.label}</Typography>
                  <Chip size="small" label={`基线 ${state.calibers.find((c) => c.id === draft.baselineId)?.label ?? draft.baselineId}`} variant="outlined" />
                </Stack>
                <Stack direction="row" gap={1}>
                  <Button size="small" variant={isEditing ? 'contained' : 'outlined'} onClick={() => dispatch(selectDraft(isEditing ? null : draft.id))}>{isEditing ? '收起编辑' : '编辑'}</Button>
                  <Button size="small" variant="contained" color="secondary" onClick={() => dispatch(publishCaliber(draft.id))}>发布</Button>
                </Stack>
              </Stack>

              {draft.baselineNote && <Alert severity="warning" sx={{ mb: 1 }}>{draft.baselineNote}</Alert>}

              <Alert severity={affected.length ? 'warning' : 'success'} sx={{ mb: 1 }}>
                发布前影响面：{affected.length} 个在途批次受影响（定稿批次不动）。
                {affected.length > 0 && <Typography variant="caption" display="block">受影响批次：{affected.map((id) => state.batches.find((b) => b.id === id)?.code).join('、')}</Typography>}
              </Alert>

              {isEditing && (
                <Box>
                  <Divider sx={{ my: 1 }} />
                  <Stack spacing={1}>
                    {draft.fields.map((f) => (
                      <FieldEditor key={f.id} field={f} onChange={(patch) => dispatch(updateDraftField({ fieldId: f.id, patch }))} onRemove={() => dispatch(removeDraftField(f.id))} />
                    ))}
                  </Stack>
                  <Button size="small" sx={{ mt: 1 }} onClick={() => dispatch(addDraftField())}>添加字段</Button>
                </Box>
              )}
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
}

function FieldEditor({ field, onChange, onRemove }: { field: CaliberField; onChange: (patch: Partial<CaliberField>) => void; onRemove: () => void }) {
  return (
    <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
      <TextField size="small" label="字段名" value={field.name} onChange={(e) => onChange({ name: e.target.value })} sx={{ width: 140 }} />
      <TextField size="small" label="显示名" value={field.label} onChange={(e) => onChange({ label: e.target.value })} sx={{ width: 140 }} />
      <TextField size="small" label="类型" select value={field.type} onChange={(e) => onChange({ type: e.target.value as FieldType })} sx={{ width: 110 }}>
        {(Object.keys(fieldTypeLabel) as FieldType[]).map((t) => <MenuItem key={t} value={t}>{fieldTypeLabel[t]}</MenuItem>)}
      </TextField>
      <TextField size="small" label="必填" select value={field.required ? '是' : '否'} onChange={(e) => onChange({ required: e.target.value === '是' })} sx={{ width: 80 }}>
        <MenuItem value="是">是</MenuItem>
        <MenuItem value="否">否</MenuItem>
      </TextField>
      <Button size="small" color="error" onClick={onRemove}>删除</Button>
    </Stack>
  );
}

function BatchTab({ state }: { state: ReconState }) {
  const dispatch = useDispatch();
  const active = state.calibers.find((c) => c.id === state.activeCaliberId)!;
  const [supplier, setSupplier] = useState('华东供应链');
  const [values, setValues] = useState<Record<string, string>>({});

  const push = () => {
    const data: Record<string, string> = {};
    active.fields.forEach((f) => { data[f.name] = values[f.name] ?? ''; });
    dispatch(pushBatch({ supplier, data }));
    setValues({});
  };

  return (
    <Stack spacing={2}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" mb={1}>外部系统推送对账批</Typography>
          <Typography variant="body2" color="text.secondary" mb={2}>按当前生效口径「{active.label}」校验，解释口径随推送冻结。</Typography>
          <Stack direction="row" gap={1} flexWrap="wrap">
            <TextField size="small" label="供应商" value={supplier} onChange={(e) => setSupplier(e.target.value)} sx={{ width: 180 }} />
            {active.fields.map((f) => (
              <TextField key={f.id} size="small" label={`${f.label}${f.required ? ' *' : ''}`} value={values[f.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} sx={{ width: 150 }}
                error={f.required && (values[f.name] ?? '') === ''} />
            ))}
            <Button variant="contained" onClick={push}>推送</Button>
          </Stack>
        </CardContent>
      </Card>

      {state.batches.map((b) => {
        const frozen = state.calibers.find((c) => c.id === b.caliberIdAtPush);
        const meta = batchStatusMeta[b.status];
        const errors = frozen ? validateData(b.data, frozen) : [];
        return (
          <Card key={b.id} variant="outlined">
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
                <Stack direction="row" gap={1} alignItems="center">
                  <Typography fontWeight={700}>{b.code}</Typography>
                  <Chip size="small" label={meta.label} color={meta.color} />
                  <Typography variant="body2" color="text.secondary">{b.supplier}</Typography>
                </Stack>
                <Stack direction="row" gap={1}>
                  {b.status === 'in-transit' && <Button size="small" variant="outlined" onClick={() => dispatch(finalizeBatch(b.id))}>定稿</Button>}
                  {b.status === 'failed' && <Button size="small" variant="outlined" onClick={() => dispatch(fixBatchData({ batchId: b.id, caliberId: state.activeCaliberId }))}>按新口径补全</Button>}
                </Stack>
              </Stack>
              <Typography variant="body2" color="text.secondary" mt={0.5}>
                解释口径：{frozen?.label ?? b.caliberIdAtPush}（推送时冻结）· 推送时间：{new Date(b.pushTime).toLocaleString('zh-CN')}
              </Typography>
              <Typography variant="body2" mt={0.5}>数据：{JSON.stringify(b.data)}</Typography>
              {b.status === 'finalized' && <Alert severity="success" sx={{ mt: 1 }}>已定稿，结果按推送时口径保持原样：{JSON.stringify(b.result)}</Alert>}
              {b.status === 'failed' && <Alert severity="error" sx={{ mt: 1 }}>按新口径校验失效：{b.invalidReason}。数据仍按推送时口径解释，补全后可在重算任务中恢复。</Alert>}
              {b.status === 'recalculating' && <Alert severity="warning" sx={{ mt: 1 }}>口径已更新，批次失效重算中；已收数据仍按推送时口径解释。</Alert>}
              {b.status === 'in-transit' && errors.length > 0 && <Alert severity="warning" sx={{ mt: 1 }}>推送时校验未通过：{errors.join('；')}</Alert>}
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
}

function TaskTab({ state }: { state: ReconState }) {
  const dispatch = useDispatch();
  if (state.tasks.length === 0) return <Alert severity="info">暂无重算任务。发布新口径后，受影响在途批次会在此分批重算。</Alert>;
  return (
    <Stack spacing={2}>
      {state.tasks.map((task) => {
        const meta = taskStatusMeta[task.status];
        const pct = task.affectedBatchIds.length ? Math.round((task.checkpoint / task.affectedBatchIds.length) * 100) : 100;
        return (
          <Card key={task.id} variant="outlined">
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
                <Stack direction="row" gap={1} alignItems="center">
                  <Typography fontWeight={700}>{task.caliberLabel}</Typography>
                  <Chip size="small" label={meta.label} color={meta.color} />
                  <Chip size="small" variant="outlined" label={`每批容量 ${task.chunkSize}`} />
                </Stack>
                <Stack direction="row" gap={1}>
                  {(task.status === 'paused' || task.status === 'pending' || task.status === 'running') && (
                    <Button size="small" variant="contained" onClick={() => dispatch(processChunk(task.id))}>处理下一批</Button>
                  )}
                  {(task.status === 'failed' || task.status === 'paused') && (
                    <Button size="small" variant="outlined" color="secondary" onClick={() => dispatch(resumeTask(task.id))}>从断点恢复重试</Button>
                  )}
                </Stack>
              </Stack>
              <Box mt={1}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2">进度 {task.checkpoint}/{task.affectedBatchIds.length}（断点 {task.checkpoint}）</Typography>
                  <Typography variant="body2">{pct}%</Typography>
                </Stack>
                <LinearProgress variant="determinate" value={pct} sx={{ mt: 0.5 }} />
              </Box>
              <Stack direction="row" gap={1} flexWrap="wrap" mt={1}>
                {task.affectedBatchIds.map((id) => {
                  const b = state.batches.find((x) => x.id === id);
                  if (!b) return null;
                  const done = state.tasks.every((t) => t.id !== task.id) || task.checkpoint > task.affectedBatchIds.indexOf(id);
                  const failed = task.failedBatchIds.includes(id);
                  return <Chip key={id} size="small" variant="outlined" color={failed ? 'error' : done ? 'success' : 'default'} label={`${b.code}${failed ? ' · 失效' : done ? ' · 已重算' : ' · 待处理'}`} />;
                })}
              </Stack>
              {task.status === 'failed' && <Alert severity="error" sx={{ mt: 1 }}>重算在断点 {task.checkpoint} 处失败，已处理批次不受影响；补全数据后可从断点恢复重试，刷新页面后任务仍保留。</Alert>}
              {task.status === 'done' && <Alert severity="success" sx={{ mt: 1 }}>全部在途批次已按新口径重算完成；定稿批次结果保持原样。</Alert>}
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
}

export default function ReconPanel() {
  const state = useSelector((root: { recon: ReconState }) => root.recon);
  const [tab, setTab] = useState(0);
  return (
    <Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="口径与影响" />
        <Tab label="对账批次" />
        <Tab label="重算任务" />
      </Tabs>
      {tab === 0 && <CaliberTab state={state} />}
      {tab === 1 && <BatchTab state={state} />}
      {tab === 2 && <TaskTab state={state} />}
    </Box>
  );
}
