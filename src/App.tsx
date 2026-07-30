import { Route, Switch } from 'wouter'
import { ToastProvider } from './components/ui/Toast'
import { BreedingDetailPage } from './features/breeding/BreedingDetailPage'
import { BreedingFormPage } from './features/breeding/BreedingFormPage'
import { BreedingPage } from './features/breeding/BreedingPage'
import { CageDetailPage } from './features/cages/CageDetailPage'
import { CageFormPage } from './features/cages/CageFormPage'
import { CagesPage } from './features/cages/CagesPage'
import { DashboardContainer } from './features/dashboard/DashboardContainer'
import { DataPage } from './features/data/DataPage'
import { ExperimentDetailPage } from './features/experiments/ExperimentDetailPage'
import { ExperimentFormPage } from './features/experiments/ExperimentFormPage'
import { ExperimentsPage } from './features/experiments/ExperimentsPage'
import { MouseBulkCreatePage } from './features/mice/MouseBulkCreatePage'
import { MouseDetailPage } from './features/mice/MouseDetailPage'
import { MouseFormPage } from './features/mice/MouseFormPage'
import { MicePage } from './features/mice/MicePage'
import { QuickWeightPage } from './features/records/QuickWeightPage'
import { RecordsPage } from './features/records/RecordsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { TaskFormPage } from './features/tasks/TaskFormPage'
import { TasksPage } from './features/tasks/TasksPage'
import { ThemeProvider } from './hooks/ThemeProvider'
import { AppShell } from './layout/AppShell'
import { NotFoundPage } from './layout/ModuleGuidePage'

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
          <RoutedContent />
        </AppShell>
      </ToastProvider>
    </ThemeProvider>
  )
}
