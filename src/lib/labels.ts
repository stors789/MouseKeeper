import type {
  BreedingPairStatus,
  CageStatus,
  ExperimentGroupType,
  ExperimentStatus,
  MouseEventType,
  MouseSex,
  MouseStatus,
  TaskPriority,
  TaskStatus
} from '../domain/types'

export const MOUSE_SEX_LABELS: Record<MouseSex, string> = {
  male: '雄性',
  female: '雌性',
  unknown: '未知',
  intersex: '间性',
  other: '其他'
}

export const MOUSE_STATUS_LABELS: Record<MouseStatus, string> = {
  alive: '存活',
  experimental: '实验中',
  breeding: '繁育中',
  reserved: '预留',
  transferred: '已转出',
  dead: '已死亡',
  euthanized: '已安乐死',
  other: '其他'
}

export const CAGE_STATUS_LABELS: Record<CageStatus, string> = {
  active: '使用中',
  inactive: '停用',
  cleaning: '清洁中',
  retired: '已退役',
  other: '其他'
}

export const BREEDING_STATUS_LABELS: Record<BreedingPairStatus, string> = {
  planned: '计划中',
  active: '合笼中',
  separated: '已分笼',
  completed: '已完成',
  cancelled: '已取消'
}

export const EXPERIMENT_STATUS_LABELS: Record<ExperimentStatus, string> = {
  planned: '计划中',
  active: '进行中',
  completed: '已结束',
  cancelled: '已取消',
  archived: '已归档'
}

export const EXPERIMENT_GROUP_TYPE_LABELS: Record<ExperimentGroupType, string> = {
  control: '对照组',
  treatment: '实验组',
  custom: '自定义组'
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '待处理',
  completed: '已完成',
  cancelled: '已取消'
}

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: '低',
  normal: '普通',
  high: '高',
  urgent: '紧急'
}

export const EVENT_TYPE_LABELS: Record<MouseEventType, string> = {
  weight: '称重',
  medication: '给药',
  injection: '注射',
  surgery: '手术',
  behavior: '行为学实验',
  sampling: '采样',
  'cage-transfer': '转笼',
  'status-change': '状态变化',
  observation: '一般观察',
  abnormality: '异常情况',
  death: '死亡',
  euthanasia: '安乐死',
  'tag-change': '标签变化',
  'experiment-join': '加入实验',
  'experiment-exit': '退出实验',
  custom: '自定义事件'
}

export function isTerminalMouseStatus(status: MouseStatus): boolean {
  return (
    status === 'transferred' ||
    status === 'dead' ||
    status === 'euthanized'
  )
}
