import {
  Boxes,
  DatabaseBackup,
  Dna,
  FlaskConical,
  ListTodo,
  NotebookPen,
  Rat,
  Scale,
  Settings2
} from 'lucide-react'
import { Route, Switch } from 'wouter'
import { ToastProvider } from './components/ui/Toast'
import {
  DashboardPage
} from './features/dashboard/DashboardPage'
import { EMPTY_DASHBOARD_DATA } from './features/dashboard/dashboardData'
import { ThemeProvider } from './hooks/ThemeProvider'
import { AppShell } from './layout/AppShell'
import {
  ModuleGuidePage,
  NotFoundPage,
  type ModuleGuidePageProps
} from './layout/ModuleGuidePage'

const MICE_GUIDE: ModuleGuidePageProps = {
  eyebrow: 'COLONY / MICE',
  title: '小鼠档案',
  description: '查找、筛选并维护每只小鼠的身份、状态、笼位和关联记录。',
  icon: Rat,
  responsibilities: [
    '列表、紧凑表格、搜索与组合筛选',
    '单只建档、复制建档与批量创建',
    '详情、时间线、批量状态和转笼操作'
  ]
}

const NEW_MOUSE_GUIDE: ModuleGuidePageProps = {
  eyebrow: 'COLONY / MICE / NEW',
  title: '新建小鼠',
  description: '录入身份、生物学信息、状态、位置和谱系。',
  icon: Rat,
  responsibilities: [
    '校验耳标、实验编号和出生日期',
    '选择父母与目标笼位并显示业务警告',
    '保存成功后进入真实档案详情'
  ],
  returnHref: '/mice',
  returnLabel: '返回小鼠工作区'
}

const CAGES_GUIDE: ModuleGuidePageProps = {
  eyebrow: 'COLONY / CAGES',
  title: '笼位管理',
  description: '查看笼位容量、当前小鼠、组成和完整转笼历史。',
  icon: Boxes,
  responsibilities: [
    '按编号、区域、用途和容量状态查找笼位',
    '显示当前占用、接近上限和超容警告',
    '执行移入、移出和批量转笼闭环'
  ]
}

const NEW_CAGE_GUIDE: ModuleGuidePageProps = {
  eyebrow: 'COLONY / CAGES / NEW',
  title: '新建笼位',
  description: '录入笼位编号、位置、容量、用途和状态。',
  icon: Boxes,
  responsibilities: [
    '检查活动笼位编号冲突',
    '设置最大容量与房间架位',
    '保存后进入笼位详情'
  ],
  returnHref: '/cages',
  returnLabel: '返回笼位工作区'
}

const BREEDING_GUIDE: ModuleGuidePageProps = {
  eyebrow: 'RESEARCH / BREEDING',
  title: '繁育与窝记录',
  description: '维护繁育组合、关键日期、窝记录和直接后代。',
  icon: Dna,
  responsibilities: [
    '建立父本与母本组合并提示明显异常',
    '跟踪合笼、预计生产、出生和断奶日期',
    '从窝记录批量创建并关联后代'
  ]
}

const NEW_BREEDING_GUIDE: ModuleGuidePageProps = {
  eyebrow: 'RESEARCH / BREEDING / NEW',
  title: '新建繁育组合',
  description: '选择父本、母本并记录合笼日期与计划。',
  icon: Dna,
  responsibilities: [
    '搜索并核对父母身份与当前状态',
    '检查性别、日期、重复组合与谱系循环',
    '明确确认可接受的非阻断警告'
  ],
  returnHref: '/breeding',
  returnLabel: '返回繁育工作区'
}

const EXPERIMENTS_GUIDE: ModuleGuidePageProps = {
  eyebrow: 'RESEARCH / EXPERIMENTS',
  title: '实验管理',
  description: '维护实验、组别、参与小鼠和退出历史。',
  icon: FlaskConical,
  responsibilities: [
    '建立实验、对照组和自定义组别',
    '批量加入或移除小鼠并检查冲突',
    '保留结束实验和退出原因的历史'
  ]
}

const NEW_EXPERIMENT_GUIDE: ModuleGuidePageProps = {
  eyebrow: 'RESEARCH / EXPERIMENTS / NEW',
  title: '新建实验',
  description: '建立实验基本信息与至少一个可用组别。',
  icon: FlaskConical,
  responsibilities: [
    '录入名称、日期、负责人和干预说明',
    '创建实验组、对照组或自定义组别',
    '保存后进入实验详情'
  ],
  returnHref: '/experiments',
  returnLabel: '返回实验工作区'
}

const RECORDS_GUIDE: ModuleGuidePageProps = {
  eyebrow: 'RESEARCH / RECORDS',
  title: '记录中心',
  description: '按对象和日期查阅事件、体重和操作活动。',
  icon: NotebookPen,
  responsibilities: [
    '统一查看观察、操作、状态和转笼事件',
    '记录体重并展示相邻变化与趋势',
    '按小鼠、笼位、实验和日期组合筛选'
  ]
}

const QUICK_WEIGHT_GUIDE: ModuleGuidePageProps = {
  eyebrow: 'RESEARCH / RECORDS / WEIGHT',
  title: '快速称重',
  description: '为一组小鼠连续录入体重并逐行核对异常。',
  icon: Scale,
  responsibilities: [
    '按笼位或选择队列加载待称重小鼠',
    '使用键盘连续录入并保留未保存值',
    '异常值只提示，批量写入结果逐行可追溯'
  ],
  returnHref: '/records',
  returnLabel: '返回记录中心',
  compactNote: '移动端真实流程应改为一次一只，不缩小桌面录入表。'
}

const TASKS_GUIDE: ModuleGuidePageProps = {
  eyebrow: 'WORK / TASKS',
  title: '任务',
  description: '处理今日、即将到期、逾期、完成和取消的本地任务。',
  icon: ListTodo,
  responsibilities: [
    '快速创建并关联小鼠、笼位或实验',
    '完成、恢复和取消任务',
    '从总览直接进入需要处理的事项'
  ]
}

const NEW_TASK_GUIDE: ModuleGuidePageProps = {
  eyebrow: 'WORK / TASKS / NEW',
  title: '新建任务',
  description: '记录日期、时间、优先级和关联对象。',
  icon: ListTodo,
  responsibilities: [
    '填写明确标题和截止时间',
    '关联小鼠、笼位或实验',
    '保存为设备本地任务'
  ],
  returnHref: '/tasks',
  returnLabel: '返回任务工作区'
}

const DATA_GUIDE: ModuleGuidePageProps = {
  eyebrow: 'SYSTEM / DATA SAFETY',
  title: '数据与安全',
  description: '备份、恢复、导入、导出并管理软删除记录。',
  icon: DatabaseBackup,
  responsibilities: [
    '导出包含版本与全部业务表的 JSON 备份',
    '验证并预览备份后执行替换恢复',
    '映射 CSV 字段、隔离错误行并报告结果'
  ],
  compactNote: '恢复与清空数据必须显示影响数量，不能只用 Toast 确认。'
}

const SETTINGS_GUIDE: ModuleGuidePageProps = {
  eyebrow: 'SYSTEM / SETTINGS',
  title: '设置',
  description: '调整主题和不涉及业务事实的本地界面偏好。',
  icon: Settings2,
  responsibilities: [
    '选择浅色、深色或跟随系统主题',
    '查看应用与数据库版本信息',
    '管理通知等可优雅降级的设备能力'
  ]
}

function RoutedContent() {
  return (
    <Switch>
      <Route path="/">
        <DashboardPage data={EMPTY_DASHBOARD_DATA} status="empty" />
      </Route>
      <Route path="/dashboard">
        <DashboardPage data={EMPTY_DASHBOARD_DATA} status="empty" />
      </Route>
      <Route path="/mice/new">
        <ModuleGuidePage {...NEW_MOUSE_GUIDE} />
      </Route>
      <Route path="/mice/bulk-create">
        <ModuleGuidePage
          {...NEW_MOUSE_GUIDE}
          eyebrow="COLONY / MICE / BULK"
          title="批量创建小鼠"
        />
      </Route>
      <Route path="/mice">
        <ModuleGuidePage {...MICE_GUIDE} />
      </Route>
      <Route path="/cages/new">
        <ModuleGuidePage {...NEW_CAGE_GUIDE} />
      </Route>
      <Route path="/cages">
        <ModuleGuidePage {...CAGES_GUIDE} />
      </Route>
      <Route path="/breeding/new">
        <ModuleGuidePage {...NEW_BREEDING_GUIDE} />
      </Route>
      <Route path="/breeding">
        <ModuleGuidePage {...BREEDING_GUIDE} />
      </Route>
      <Route path="/experiments/new">
        <ModuleGuidePage {...NEW_EXPERIMENT_GUIDE} />
      </Route>
      <Route path="/experiments">
        <ModuleGuidePage {...EXPERIMENTS_GUIDE} />
      </Route>
      <Route path="/records/weights/quick">
        <ModuleGuidePage {...QUICK_WEIGHT_GUIDE} />
      </Route>
      <Route path="/records">
        <ModuleGuidePage {...RECORDS_GUIDE} />
      </Route>
      <Route path="/tasks/new">
        <ModuleGuidePage {...NEW_TASK_GUIDE} />
      </Route>
      <Route path="/tasks">
        <ModuleGuidePage {...TASKS_GUIDE} />
      </Route>
      <Route path="/data">
        <ModuleGuidePage {...DATA_GUIDE} />
      </Route>
      <Route path="/settings">
        <ModuleGuidePage {...SETTINGS_GUIDE} />
      </Route>
      <Route>
        <NotFoundPage />
      </Route>
    </Switch>
  )
}

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AppShell>
          <RoutedContent />
        </AppShell>
      </ToastProvider>
    </ThemeProvider>
  )
}
