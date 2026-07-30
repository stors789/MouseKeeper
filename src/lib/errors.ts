import { ServiceError, WarningRequiredError } from '../services'

const SERVICE_ERROR_MESSAGES: Partial<Record<ServiceError['code'], string>> = {
  'not-found': '关联记录不存在或已被移除。',
  'record-deleted': '这条记录已在回收站中，不能继续当前操作。',
  'duplicate-id': '内部 ID 已存在，请重试。',
  'duplicate-ear-tag': '该耳标已被另一条活动记录使用。',
  'duplicate-cage-number': '该笼位编号已被使用。',
  'duplicate-tag-name': '该标签名称已存在。',
  'duplicate-experiment-code': '该实验编号已存在。',
  'duplicate-breeding-pair': '相同的活动繁育组合已存在。',
  'duplicate-litter': '该窝号已存在。',
  'duplicate-experiment-group': '该实验中已存在同名组别。',
  'already-in-cage': '小鼠已经在这个笼位中。',
  'already-assigned': '小鼠已加入该组或存在活动分配。',
  'exclusive-group-conflict': '小鼠已在这个实验的另一个互斥组中。',
  'revision-conflict': '记录已在其他页面更新，请刷新后重试。',
  'invalid-reference': '关联记录缺失或不符合当前操作要求。',
  'invalid-state': '记录当前状态不允许执行这个操作。',
  'pedigree-cycle': '父母关系会产生循环谱系。',
  'warning-required': '需要确认业务警告后才能继续。',
  'mixed-sample-references': '示例与真实记录存在混合引用，不能自动删除。',
  'integrity-error': '检测到数据一致性问题，操作已停止。'
}

export function readableError(error: unknown): string {
  if (error instanceof WarningRequiredError) {
    return '请确认警告后再次保存。'
  }
  if (error instanceof ServiceError) {
    return SERVICE_ERROR_MESSAGES[error.code] ?? error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return '发生未知错误，当前数据没有被标记为保存成功。'
}
