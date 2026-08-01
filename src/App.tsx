import { lazy, Suspense } from 'react'
import { Route, Switch } from 'wouter'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Skeleton, SkeletonGroup } from './components/ui/Skeleton'
import { ToastProvider } from './components/ui/Toast'
import { ThemeProvider } from './hooks/ThemeProvider'
import { AppShell } from './layout/AppShell'
import { NotFoundPage } from './layout/ModuleGuidePage'

const DashboardContainer = lazy(async () => ({
  default: (await import('./features/dashboard/DashboardContainer'))
    .DashboardContainer
}))
const MicePage = lazy(async () => ({
  default: (await import('./features/mice/MicePage')).MicePage
}))
const MouseFormPage = lazy(async () => ({
  default: (await import('./features/mice/MouseFormPage')).MouseFormPage
}))
const MouseBulkCreatePage = lazy(async () => ({
  default: (await import('./features/mice/MouseBulkCreatePage'))
    .MouseBulkCreatePage
}))
const MouseDetailPage = lazy(async () => ({
  default: (await import('./features/mice/MouseDetailPage')).MouseDetailPage
}))
const CagesPage = lazy(async () => ({
  default: (await import('./features/cages/CagesPage')).CagesPage
}))
const CageFormPage = lazy(async () => ({
  default: (await import('./features/cages/CageFormPage')).CageFormPage
}))
const CageDetailPage = lazy(async () => ({
  default: (await import('./features/cages/CageDetailPage')).CageDetailPage
}))
const BreedingPage = lazy(async () => ({
  default: (await import('./features/breeding/BreedingPage')).BreedingPage
}))
const BreedingFormPage = lazy(async () => ({
  default: (await import('./features/breeding/BreedingFormPage'))
    .BreedingFormPage
}))
const BreedingDetailPage = lazy(async () => ({
  default: (await import('./features/breeding/BreedingDetailPage'))
    .BreedingDetailPage
}))
const ExperimentsPage = lazy(async () => ({
  default: (await import('./features/experiments/ExperimentsPage'))
    .ExperimentsPage
}))
const ExperimentFormPage = lazy(async () => ({
  default: (await import('./features/experiments/ExperimentFormPage'))
    .ExperimentFormPage
}))
const ExperimentDetailPage = lazy(async () => ({
  default: (await import('./features/experiments/ExperimentDetailPage'))
    .ExperimentDetailPage
}))
const RecordsPage = lazy(async () => ({
  default: (await import('./features/records/RecordsPage')).RecordsPage
}))
const QuickWeightPage = lazy(async () => ({
  default: (await import('./features/records/QuickWeightPage')).QuickWeightPage
}))
const TasksPage = lazy(async () => ({
  default: (await import('./features/tasks/TasksPage')).TasksPage
}))
const TaskFormPage = lazy(async () => ({
  default: (await import('./features/tasks/TaskFormPage')).TaskFormPage
}))
const DataPage = lazy(async () => ({
  default: (await import('./features/data/DataPage')).DataPage
}))
const SettingsPage = lazy(async () => ({
  default: (await import('./features/settings/SettingsPage')).SettingsPage
}))

function RouteLoading() {
  return (
    <SkeletonGroup className="feature-page" label="正在加载工作区">
      <div className="feature-page__header">
        <div>
          <Skeleton height={13} width={150} />
          <Skeleton height={36} width={260} />
        </div>
      </div>
      <div className="record-table-skeleton">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton height={48} key={index} />
        ))}
      </div>
    </SkeletonGroup>
  )
}

function RoutedContent() {
  return (
    <Switch>
      <Route path="/">
        <DashboardContainer />
      </Route>
      <Route path="/dashboard">
        <DashboardContainer />
      </Route>

      <Route path="/mice/new">
        <MouseFormPage />
      </Route>
      <Route path="/mice/bulk-create">
        <MouseBulkCreatePage />
      </Route>
      <Route path="/mice/:mouseId/copy">
        {(params) => <MouseFormPage copyFromId={params.mouseId} />}
      </Route>
      <Route path="/mice/:mouseId/edit">
        {(params) => <MouseFormPage mouseId={params.mouseId} />}
      </Route>
      <Route path="/mice/:mouseId">
        {(params) => <MouseDetailPage mouseId={params.mouseId} />}
      </Route>
      <Route path="/mice">
        <MicePage />
      </Route>

      <Route path="/cages/new">
        <CageFormPage />
      </Route>
      <Route path="/cages/:cageId/edit">
        {(params) => <CageFormPage cageId={params.cageId} />}
      </Route>
      <Route path="/cages/:cageId">
        {(params) => <CageDetailPage cageId={params.cageId} />}
      </Route>
      <Route path="/cages">
        <CagesPage />
      </Route>

      <Route path="/breeding/new">
        <BreedingFormPage />
      </Route>
      <Route path="/breeding/:breedingPairId">
        {(params) => (
          <BreedingDetailPage breedingPairId={params.breedingPairId} />
        )}
      </Route>
      <Route path="/breeding">
        <BreedingPage />
      </Route>

      <Route path="/experiments/new">
        <ExperimentFormPage />
      </Route>
      <Route path="/experiments/:experimentId/edit">
        {(params) => (
          <ExperimentFormPage experimentId={params.experimentId} />
        )}
      </Route>
      <Route path="/experiments/:experimentId">
        {(params) => (
          <ExperimentDetailPage experimentId={params.experimentId} />
        )}
      </Route>
      <Route path="/experiments">
        <ExperimentsPage />
      </Route>

      <Route path="/records/weights/quick">
        <QuickWeightPage />
      </Route>
      <Route path="/records">
        <RecordsPage />
      </Route>

      <Route path="/tasks/new">
        <TaskFormPage />
      </Route>
      <Route path="/tasks/:taskId/edit">
        {(params) => <TaskFormPage taskId={params.taskId} />}
      </Route>
      <Route path="/tasks">
        <TasksPage />
      </Route>

      <Route path="/data">
        <DataPage />
      </Route>
      <Route path="/settings">
        <SettingsPage />
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
          <ErrorBoundary>
            <Suspense fallback={<RouteLoading />}>
              <RoutedContent />
            </Suspense>
          </ErrorBoundary>
        </AppShell>
      </ToastProvider>
    </ThemeProvider>
  )
}
