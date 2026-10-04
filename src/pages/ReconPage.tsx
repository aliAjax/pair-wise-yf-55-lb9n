import { zodResolver } from '@hookform/resolvers/zod';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { Alert, Box, Button, Card, CardContent, Checkbox, Chip, Container, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, FormControlLabel, Grid, IconButton, InputLabel, LinearProgress, MenuItem, Select, Stack, Switch, TextField, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useDispatch, useSelector } from 'react-redux';
import { z } from 'zod';
import { addDraftField, finalizeBatch, pushBatch, removeDraftField, runRecalcChunk, submitDraft, updateDraftField, useLazyImpactPreviewQuery, type CaliberDraft, type CaliberVersion, type ReconBatch, type RecalcTask, type ReconFieldType } from '../recon/store';
import type { RootState } from '../store';

const batchStatusMeta: Record<ReconBatch['status'], { label: string; color: 'info' | 'warning' | 'success' }> = {
  in_flight: { label: '在途', color: 'info' },
  invalidated: { label: '已失效待重算', color: 'warning' },
  finalized: { label: '已定稿', color: 'success' }
};

const taskStatusMeta: Record<RecalcTask['status'], { label: string; color: 'warning' | 'error' | 'success' }> = {
  pending: { label: '待重算', color: 'warning' },
  failed: { label: '失败待重试', color: 'error' },
  done: { label: '已完成', color: 'success' }
};

function buildPushSchema(version: CaliberVersion) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of version.fields) {
    let schema = field.required ? z.string().min(1, `「${field.label}」为必填`) : z.string();
    if (field.type === 'number') schema = schema.refine((value) => value.trim() === '' || !Number.isNaN(Number(value)), `「${field.label}」应为数字`);
    if (field.type === 'date') schema = schema.refine((value) => value.trim() === '' || /^\d{4}-\d{2}-\d{2}$/.test(value), `「${field.label}」格式应为 YYYY-MM-DD`);
    shape[field.id] = schema;
  }
  return z.object(shape);
}

function PushBatchDialog({ open, onClose, version }: { open: boolean; onClose: () => void; version: CaliberVersion }) {
  const dispatch = useDispatch();
  const schema = useMemo(() => buildPushSchema(version), [version]);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: {} });
  useEffect(() => { if (open) form.reset({}); }, [open, version.id, form]);
  const errors = form.formState.errors;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>模拟外部系统推送 · 按「{version.label}」校验</DialogTitle>
      <DialogContent>
        <Stack component="form" id="recon-push-form" spacing={2} mt={1} onSubmit={form.handleSubmit((values) => { dispatch(pushBatch({ payload: values as Record<string, string> })); onClose(); })}>
          {version.fields.map((field) => (
            <TextField key={field.id} size="small" label={`${field.label}（${field.type}）`} required={field.required}
              {...form.register(field.id)}
              error={Boolean(errors[field.id])}
              helperText={errors[field.id]?.message as string | undefined} />
          ))}
        </Stack>
        <Alert severity="info" sx={{ mt: 2 }}>推送的数据将标记为按「{version.label}」接收，之后口径变更不会改变其解释。</Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button type="submit" form="recon-push-form" variant="contained">推送</Button>
      </DialogActions>
    </Dialog>
  );
}

function ImpactDialog({ draftId, onClose }: { draftId: string | null; onClose: () => void }) {
  const dispatch = useDispatch();
  const recon = useSelector((root: RootState) => root.recon);
  const [trigger, { data, isFetching }] = useLazyImpactPreviewQuery();
  useEffect(() => { if (draftId) void trigger(draftId); }, [draftId, trigger]);
  const draft = recon.drafts.find((item) => item.id === draftId);
  const affected = recon.batches.filter((item) => item.status !== 'finalized');
  const finalizedCount = recon.batches.length - affected.length;
  const chunks = affected.length ? Math.ceil(affected.length / recon.capacity) : 0;
  const stale = draft ? draft.baseVersionId !== recon.activeVersionId : false;
  return (
    <Dialog open={Boolean(draftId)} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>发布前影响面预检</DialogTitle>
      <DialogContent>
        {isFetching && <Typography variant="body2" color="text.secondary">正在计算口径差异与影响面…</Typography>}
        {data && (
          <Stack spacing={2} mt={1}>
            <div>
              <Typography fontWeight={700} mb={0.5}>相对「{data.activeLabel}」的口径差异</Typography>
              <Stack direction="row" gap={1} flexWrap="wrap">
                {data.added.map((label) => <Chip key={label} size="small" color="success" variant="outlined" label={`新增 ${label}`} />)}
                {data.removed.map((label) => <Chip key={label} size="small" color="error" variant="outlined" label={`删除 ${label}`} />)}
                {data.tightened.map((label) => <Chip key={label} size="small" color="warning" variant="outlined" label={`收紧必填 ${label}`} />)}
                {!data.added.length && !data.removed.length && !data.tightened.length && <Typography variant="body2" color="text.secondary">与最新基线无结构差异</Typography>}
              </Stack>
            </div>
            <div>
              <Typography fontWeight={700} mb={0.5}>受影响在途批次（{affected.length}）</Typography>
              {affected.map((batch) => <Typography key={batch.id} variant="body2">· {batch.id} {batch.supplier}（{batch.records.length} 条，推送口径 {batch.caliberVersionId}）</Typography>)}
              {!affected.length && <Typography variant="body2" color="text.secondary">无受影响批次</Typography>}
              <Typography variant="body2" color="text.secondary" mt={0.5}>已定稿 {finalizedCount} 个批次保持原样，不参与重算。</Typography>
            </div>
            <Alert severity="info">重算容量 {data.capacity} 批/次：{affected.length} 个批次{chunks > 1 ? `将分 ${chunks} 批执行` : '可一次执行完毕'}；失败可从断点重试，进度持久化，重开页面可继续。</Alert>
            {stale && <Alert severity="warning">基线已被其他运营更新，本次提交将按最新基线重算影响面并保留为草稿。</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={!draft} onClick={() => { if (draftId) dispatch(submitDraft({ draftId })); onClose(); }}>确认发布</Button>
      </DialogActions>
    </Dialog>
  );
}

function DraftCard({ draft }: { draft: CaliberDraft }) {
  const dispatch = useDispatch();
  const recon = useSelector((root: RootState) => root.recon);
  const [impactOpen, setImpactOpen] = useState(false);
  const stale = draft.baseVersionId !== recon.activeVersionId;
  const baseLabel = recon.versions.find((item) => item.id === draft.baseVersionId)?.label ?? draft.baseVersionId;
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6">口径草稿 · {draft.createdBy}</Typography>
        <Typography variant="body2" color="text.secondary" mb={1}>
          基于 {baseLabel} · 更新于 {draft.updatedAt}
          {stale && <Chip size="small" color="warning" label="基线已过期" sx={{ ml: 1 }} />}
        </Typography>
        {draft.conflict && <Alert severity="warning" sx={{ mb: 2 }}>{draft.conflict}</Alert>}
        <Stack spacing={1}>
          {draft.fields.map((field) => (
            <Stack key={field.id} direction="row" spacing={1} alignItems="center">
              <TextField size="small" label="字段名" value={field.label} sx={{ flex: 1 }}
                onChange={(event) => dispatch(updateDraftField({ draftId: draft.id, fieldId: field.id, patch: { label: event.target.value } }))} />
              <FormControl size="small" sx={{ width: 110 }}>
                <InputLabel>类型</InputLabel>
                <Select label="类型" value={field.type}
                  onChange={(event) => dispatch(updateDraftField({ draftId: draft.id, fieldId: field.id, patch: { type: event.target.value as ReconFieldType } }))}>
                  <MenuItem value="text">文本</MenuItem>
                  <MenuItem value="number">数字</MenuItem>
                  <MenuItem value="date">日期</MenuItem>
                </Select>
              </FormControl>
              <FormControlLabel label="必填" control={<Switch size="small" checked={field.required}
                onChange={(event) => dispatch(updateDraftField({ draftId: draft.id, fieldId: field.id, patch: { required: event.target.checked } }))} />} />
              <IconButton size="small" onClick={() => dispatch(removeDraftField({ draftId: draft.id, fieldId: field.id }))}><DeleteOutlineIcon fontSize="small" /></IconButton>
            </Stack>
          ))}
        </Stack>
        <Stack direction="row" spacing={1} mt={2} alignItems="center">
          <Button size="small" onClick={() => dispatch(addDraftField(draft.id))}>添加字段</Button>
          <Box flexGrow={1} />
          <Button size="small" variant="outlined" onClick={() => setImpactOpen(true)}>影响面预检</Button>
          <Button size="small" variant="contained" onClick={() => setImpactOpen(true)}>提交发布</Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" mt={1}>提交前会先进行影响面预检；若基线已被其他运营更新，将按最新基线重算并保留为草稿。</Typography>
      </CardContent>
      <ImpactDialog draftId={impactOpen ? draft.id : null} onClose={() => setImpactOpen(false)} />
    </Card>
  );
}

function BatchDataDialog({ batchId, onClose }: { batchId: string | null; onClose: () => void }) {
  const recon = useSelector((root: RootState) => root.recon);
  const batch = recon.batches.find((item) => item.id === batchId);
  return (
    <Dialog open={Boolean(batch)} onClose={onClose} maxWidth="sm" fullWidth>
      {batch && (
        <>
          <DialogTitle>{batch.id} · {batch.supplier}</DialogTitle>
          <DialogContent>
            <Alert severity="info" sx={{ mb: 2 }}>数据按推送时口径 {batch.caliberVersionId} 解释，不随后续口径变更改变。</Alert>
            <Stack spacing={2}>
              {batch.records.map((record) => {
                const version = recon.versions.find((item) => item.id === record.caliberVersionId);
                return (
                  <Card key={record.id} variant="outlined" sx={{ p: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">{record.id} · 推送于 {record.pushedAt} · 口径 {record.caliberVersionId}</Typography>
                    {Object.entries(record.payload).map(([key, value]) => (
                      <Stack key={key} direction="row" justifyContent="space-between">
                        <Typography variant="body2" color="text.secondary">{version?.fields.find((field) => field.id === key)?.label ?? `${key}（现行口径已删除）`}</Typography>
                        <Typography variant="body2">{value === '' ? '（空）' : value}</Typography>
                      </Stack>
                    ))}
                  </Card>
                );
              })}
            </Stack>
            {batch.validation && (
              <Alert severity={batch.validation.errors.length ? 'error' : 'success'} sx={{ mt: 2 }}>
                校验口径 {batch.validation.checkedVersionId} · {batch.validation.checkedAt}{batch.validation.frozen ? ' · 定稿结果冻结' : ''}
                {batch.validation.errors.length ? `：${batch.validation.errors.join('；')}` : '：通过'}
              </Alert>
            )}
            {!batch.validation && <Alert severity="warning" sx={{ mt: 2 }}>批次已失效，等待按新口径重算。</Alert>}
          </DialogContent>
          <DialogActions><Button onClick={onClose}>关闭</Button></DialogActions>
        </>
      )}
    </Dialog>
  );
}

export default function ReconPage() {
  const dispatch = useDispatch();
  const recon = useSelector((root: RootState) => root.recon);
  const active = recon.versions.find((item) => item.id === recon.activeVersionId) ?? recon.versions[0];
  const [pushOpen, setPushOpen] = useState(false);
  const [viewBatchId, setViewBatchId] = useState<string | null>(null);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const task = recon.task;
  const progress = task && task.batchIds.length ? Math.round((task.cursor / task.batchIds.length) * 100) : 0;

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Typography variant="h5" mb={0.5}>供应商对账单字段口径管理</Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>平台统一维护口径，外部系统照口径推送；口径发布后，在途批次立即失效并按新口径分批重算，定稿结果保持原样。</Typography>
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" mb={1}>口径版本</Typography>
              {recon.versions.map((version) => (
                <Stack key={version.id} direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 0.5 }}>
                  <Typography variant="body2">{version.label}{version.id === recon.activeVersionId && <Chip size="small" color="primary" label="生效中" sx={{ ml: 1 }} />}</Typography>
                  <Typography variant="caption" color="text.secondary">{version.createdAt} · {version.fields.length} 个字段</Typography>
                </Stack>
              ))}
              <Divider sx={{ my: 1.5 }} />
              <Typography variant="body2" color="text.secondary">当前生效字段（* 为必填）：</Typography>
              <Stack direction="row" gap={1} flexWrap="wrap" mt={1}>
                {active.fields.map((field) => <Chip key={field.id} size="small" variant="outlined" label={`${field.label}${field.required ? ' *' : ''}`} />)}
              </Stack>
              <Alert severity="info" sx={{ mt: 2 }}>外部系统按生效口径推送数据；历史推送数据仍按推送时口径解释。</Alert>
            </CardContent>
          </Card>
          {recon.drafts.map((draft) => <DraftCard key={draft.id} draft={draft} />)}
          {!recon.drafts.length && <Alert severity="info" sx={{ mb: 3 }}>当前没有口径草稿。</Alert>}
        </Grid>

        <Grid size={{ xs: 12, lg: 7 }}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6">重算任务</Typography>
              {!task && <Alert severity="info" sx={{ mt: 1 }}>当前没有重算任务。发布新口径后，失效的在途批次会在这里按容量分批重算。</Alert>}
              {task && (
                <Stack spacing={1.5} mt={1}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip size="small" label={taskStatusMeta[task.status].label} color={taskStatusMeta[task.status].color} />
                    <Typography variant="body2">目标口径 {task.targetVersionId} · 容量 {task.chunkSize} 批/次</Typography>
                  </Stack>
                  <LinearProgress variant="determinate" value={progress} />
                  <Typography variant="body2" color="text.secondary">进度 {task.cursor}/{task.batchIds.length}（断点已持久化，重开页面可继续）</Typography>
                  {task.status === 'failed' && <Alert severity="error">执行中断：进度已保存在断点，可直接重试续算。</Alert>}
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Button variant="contained" disabled={task.status === 'done'} onClick={() => dispatch(runRecalcChunk({ simulateFailure }))}>
                      {task.status === 'failed' ? '断点重试' : '执行下一批'}
                    </Button>
                    <FormControlLabel label="模拟中途故障" control={<Checkbox checked={simulateFailure} onChange={(event) => setSimulateFailure(event.target.checked)} />} />
                  </Stack>
                  <Divider />
                  <Typography variant="body2" fontWeight={700}>执行日志</Typography>
                  {task.log.map((line, index) => <Typography key={index} variant="caption" display="block" color="text.secondary">{line}</Typography>)}
                </Stack>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                <div>
                  <Typography variant="h6">对账批次</Typography>
                  <Typography variant="body2" color="text.secondary">在途 {recon.batches.filter((item) => item.status === 'in_flight').length} · 待重算 {recon.batches.filter((item) => item.status === 'invalidated').length} · 定稿 {recon.batches.filter((item) => item.status === 'finalized').length}</Typography>
                </div>
                <Button variant="contained" onClick={() => setPushOpen(true)}>模拟外部推送</Button>
              </Stack>
              {recon.batches.map((batch) => {
                const meta = batchStatusMeta[batch.status];
                return (
                  <Card key={batch.id} variant="outlined" sx={{ p: 2, mb: 1 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <div>
                        <Typography fontWeight={700}>{batch.id} · {batch.supplier}<Chip size="small" label={meta.label} color={meta.color} sx={{ ml: 1 }} /></Typography>
                        <Typography variant="body2" color="text.secondary">
                          推送口径 {batch.caliberVersionId} · {batch.records.length} 条记录
                          {batch.validation ? ` · 校验口径 ${batch.validation.checkedVersionId}${batch.validation.frozen ? '（定稿冻结）' : ''}${batch.validation.errors.length ? ` · ${batch.validation.errors.length} 个问题` : ' · 通过'}` : ' · 待重算'}
                        </Typography>
                        {batch.validation && batch.validation.errors.length > 0 && <Alert severity="error" sx={{ mt: 1 }}>{batch.validation.errors.join('；')}</Alert>}
                      </div>
                      <Stack spacing={1} alignItems="flex-end">
                        <Button size="small" onClick={() => setViewBatchId(batch.id)}>查看数据</Button>
                        <Button size="small" variant="outlined" disabled={batch.status !== 'in_flight' || !batch.validation || batch.validation.errors.length > 0} onClick={() => dispatch(finalizeBatch(batch.id))}>定稿</Button>
                      </Stack>
                    </Stack>
                  </Card>
                );
              })}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <PushBatchDialog open={pushOpen} onClose={() => setPushOpen(false)} version={active} />
      <BatchDataDialog batchId={viewBatchId} onClose={() => setViewBatchId(null)} />
    </Container>
  );
}
