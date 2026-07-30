import { APP_CONFIG } from './config/app'

export function App() {
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <section className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-16">
        <div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-accent">
            Local colony records
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">
            {APP_CONFIG.name}
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-ink-muted">
            正在建立本地优先的小鼠档案、笼位、繁育、实验与任务工作区。
          </p>
        </div>
      </section>
    </main>
  )
}
