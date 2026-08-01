import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Alert } from './ui/Alert'
import { buttonClassName } from './ui/Button'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error?: Error
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {}

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('MouseKeeper workspace render failed', error, info)
  }

  private retry = () => {
    this.setState({ error: undefined })
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="feature-page">
        <Alert title="当前工作区无法显示" tone="critical">
          {this.state.error.message || '发生未知渲染错误。'}
        </Alert>
        <div className="header-actions">
          <button
            className={buttonClassName({ variant: 'primary' })}
            type="button"
            onClick={this.retry}
          >
            重试
          </button>
          <a
            className={buttonClassName({ variant: 'secondary' })}
            href="/data"
          >
            前往数据与安全
          </a>
          <button
            className={buttonClassName({ variant: 'tertiary' })}
            type="button"
            onClick={() => window.location.reload()}
          >
            重新加载应用
          </button>
        </div>
      </div>
    )
  }
}
