import {
  ArrowLeft,
  CircleCheck,
  Map,
  type LucideIcon
} from 'lucide-react'
import { Link } from 'wouter'
import { Alert } from '../components/ui/Alert'
import { buttonClassName } from '../components/ui/buttonStyles'

export interface ModuleGuidePageProps {
  eyebrow: string
  title: string
  description: string
  icon: LucideIcon
  responsibilities: readonly string[]
  returnHref?: string
  returnLabel?: string
  compactNote?: string
}

export function ModuleGuidePage({
  compactNote,
  description,
  eyebrow,
  icon: Icon,
  responsibilities,
  returnHref = '/dashboard',
  returnLabel = '返回群体总览',
  title
}: ModuleGuidePageProps) {
  return (
    <div className="page module-guide">
      <header className="page-header module-guide__header">
        <div>
          <p className="page-header__eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="module-guide__icon" aria-hidden="true">
          <Icon size={24} strokeWidth={1.75} />
        </span>
      </header>
      <div className="module-guide__body">
        <section className="module-guide__scope" aria-labelledby="scope-title">
          <span className="module-guide__rail" aria-hidden="true" />
          <div>
            <p className="module-guide__index">WORKSPACE SCOPE</p>
            <h3 id="scope-title">这个工作区负责什么</h3>
            <ul>
              {responsibilities.map((responsibility) => (
                <li key={responsibility}>
                  <CircleCheck aria-hidden="true" size={17} />
                  <span>{responsibility}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <Alert title="当前只接入了应用框架" tone="informative">
          <p>
            业务模块尚未向此路由提供可持久化页面。本页只说明真实页面职责，不会创建假记录、写入
            IndexedDB 或显示无效操作。
          </p>
          {compactNote ? <p>{compactNote}</p> : null}
        </Alert>
        <div className="module-guide__actions">
          <Link
            className={buttonClassName({ variant: 'secondary' })}
            href={returnHref}
          >
            <ArrowLeft aria-hidden="true" size={17} />
            {returnLabel}
          </Link>
        </div>
      </div>
    </div>
  )
}

export function NotFoundPage() {
  return (
    <div className="page module-guide">
      <header className="page-header module-guide__header">
        <div>
          <p className="page-header__eyebrow">ROUTE / NOT FOUND</p>
          <h2>找不到这个页面</h2>
          <p>地址可能已更改，当前本地数据没有受到影响。</p>
        </div>
        <span className="module-guide__icon" aria-hidden="true">
          <Map size={24} strokeWidth={1.75} />
        </span>
      </header>
      <div className="module-guide__actions">
        <Link
          className={buttonClassName({ variant: 'primary' })}
          href="/dashboard"
        >
          返回群体总览
        </Link>
      </div>
    </div>
  )
}
