import {
  Boxes,
  DatabaseBackup,
  Dna,
  FlaskConical,
  LayoutDashboard,
  ListTodo,
  NotebookPen,
  Rat,
  Scale,
  Settings2,
  type LucideIcon
} from 'lucide-react'

export interface NavigationItem {
  href: string
  label: string
  shortLabel?: string
  description: string
  icon: LucideIcon
  keywords: readonly string[]
}

export interface NavigationGroup {
  label: string
  items: readonly NavigationItem[]
}

export interface CreateAction {
  href: string
  label: string
  description: string
  icon: LucideIcon
}

export const DASHBOARD_ITEM: NavigationItem = {
  href: '/dashboard',
  label: '总览',
  description: '查看群体读数、需要关注的事项和最近活动',
  icon: LayoutDashboard,
  keywords: ['首页', '仪表盘', 'dashboard', 'overview']
}

export const MICE_ITEM: NavigationItem = {
  href: '/mice',
  label: '小鼠',
  description: '查找、筛选和维护小鼠档案',
  icon: Rat,
  keywords: ['小鼠', '耳标', '档案', 'mouse', 'mice']
}

export const CAGES_ITEM: NavigationItem = {
  href: '/cages',
  label: '笼位',
  description: '查看笼位容量、组成和转笼历史',
  icon: Boxes,
  keywords: ['笼位', '笼盒', '容量', 'cage']
}

export const BREEDING_ITEM: NavigationItem = {
  href: '/breeding',
  label: '繁育',
  description: '管理繁育组合、窝记录和后代',
  icon: Dna,
  keywords: ['繁育', '谱系', '窝', '后代', 'breeding', 'litter']
}

export const EXPERIMENTS_ITEM: NavigationItem = {
  href: '/experiments',
  label: '实验',
  description: '管理实验、组别和小鼠分配',
  icon: FlaskConical,
  keywords: ['实验', '组别', '干预', 'experiment']
}

export const RECORDS_ITEM: NavigationItem = {
  href: '/records',
  label: '记录',
  description: '查看事件、体重和操作时间线',
  icon: NotebookPen,
  keywords: ['事件', '体重', '记录', '时间线', 'event', 'weight']
}

export const TASKS_ITEM: NavigationItem = {
  href: '/tasks',
  label: '任务',
  description: '处理今日、即将到期和逾期任务',
  icon: ListTodo,
  keywords: ['任务', '提醒', '逾期', 'task']
}

export const DATA_ITEM: NavigationItem = {
  href: '/data',
  label: '数据与安全',
  shortLabel: '数据',
  description: '备份、恢复、导入、导出和管理回收站',
  icon: DatabaseBackup,
  keywords: ['数据', '备份', '恢复', '导入', '导出', '回收站', 'backup']
}

export const SETTINGS_ITEM: NavigationItem = {
  href: '/settings',
  label: '设置',
  description: '调整主题和非业务应用偏好',
  icon: Settings2,
  keywords: ['设置', '主题', '通知', 'settings']
}

export const NAVIGATION_GROUPS: readonly NavigationGroup[] = [
  {
    label: '工作台',
    items: [DASHBOARD_ITEM, MICE_ITEM, CAGES_ITEM]
  },
  {
    label: '研究',
    items: [
      BREEDING_ITEM,
      EXPERIMENTS_ITEM,
      RECORDS_ITEM,
      TASKS_ITEM
    ]
  },
  {
    label: '系统',
    items: [DATA_ITEM, SETTINGS_ITEM]
  }
]

export const ALL_NAVIGATION_ITEMS = NAVIGATION_GROUPS.flatMap(
  (group) => group.items
)

export const MOBILE_PRIMARY_ITEMS: readonly NavigationItem[] = [
  DASHBOARD_ITEM,
  MICE_ITEM,
  CAGES_ITEM,
  TASKS_ITEM
]

export const MOBILE_MORE_ITEMS: readonly NavigationItem[] = [
  BREEDING_ITEM,
  EXPERIMENTS_ITEM,
  RECORDS_ITEM,
  DATA_ITEM,
  SETTINGS_ITEM
]

export const CREATE_ACTIONS: readonly CreateAction[] = [
  {
    href: '/mice/new',
    label: '新建小鼠',
    description: '进入单只小鼠建档流程',
    icon: Rat
  },
  {
    href: '/cages/new',
    label: '新建笼位',
    description: '进入笼位信息录入流程',
    icon: Boxes
  },
  {
    href: '/breeding/new',
    label: '新建繁育组合',
    description: '选择父本、母本并记录合笼日期',
    icon: Dna
  },
  {
    href: '/experiments/new',
    label: '新建实验',
    description: '建立实验信息与初始组别',
    icon: FlaskConical
  },
  {
    href: '/records/weights/quick',
    label: '快速称重',
    description: '进入连续体重录入工作区',
    icon: Scale
  },
  {
    href: '/tasks/new',
    label: '新建任务',
    description: '记录一项本地待办',
    icon: ListTodo
  }
]

const PAGE_TITLES: Readonly<Record<string, string>> = {
  '/': '群体总览',
  '/dashboard': '群体总览',
  '/mice': '小鼠',
  '/mice/new': '新建小鼠',
  '/mice/bulk-create': '批量创建小鼠',
  '/cages': '笼位',
  '/cages/new': '新建笼位',
  '/breeding': '繁育',
  '/breeding/new': '新建繁育组合',
  '/experiments': '实验',
  '/experiments/new': '新建实验',
  '/records': '记录',
  '/records/weights/quick': '快速称重',
  '/tasks': '任务',
  '/tasks/new': '新建任务',
  '/data': '数据与安全',
  '/settings': '设置'
}

export function isNavigationItemActive(
  item: NavigationItem,
  location: string
) {
  if (item.href === '/dashboard') {
    return location === '/' || location === '/dashboard'
  }

  return location === item.href || location.startsWith(`${item.href}/`)
}

export function getPageTitle(location: string) {
  const exactTitle = PAGE_TITLES[location]

  if (exactTitle) {
    return exactTitle
  }

  const matchingItem = ALL_NAVIGATION_ITEMS.find((item) =>
    isNavigationItemActive(item, location)
  )

  return matchingItem?.label ?? '未找到页面'
}
