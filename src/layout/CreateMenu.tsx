import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { APPLICATION_EVENT_NAMES } from '../application'
import { Button } from '../components/ui/Button'
import { CREATE_ACTIONS } from './navigation'

interface CreateMenuProps {
  compact?: boolean
  mobileContext?: boolean
}

export function CreateMenu({
  compact = false,
  mobileContext = false
}: CreateMenuProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handleOpen = () => {
      const mobile = globalThis.matchMedia?.('(max-width: 900px)').matches ?? false
      if (mobile === mobileContext) setOpen(true)
    }
    globalThis.addEventListener(APPLICATION_EVENT_NAMES.openCreateMenu, handleOpen)
    return () => globalThis.removeEventListener(APPLICATION_EVENT_NAMES.openCreateMenu, handleOpen)
  }, [mobileContext])

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <Button
          className={mobileContext ? 'app-create app-create--mobile' : 'app-create'}
          size={compact ? 'icon' : mobileContext ? 'large' : 'medium'}
          leadingIcon={<Plus aria-hidden="true" size={17} />}
          trailingIcon={
            compact || mobileContext ? null : (
              <ChevronDown aria-hidden="true" size={15} />
            )
          }
          aria-label={compact ? '打开新建菜单' : undefined}
          aria-haspopup="menu"
        >
          {mobileContext ? '新建记录' : '新建'}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className="create-menu"
          sideOffset={8}
        >
          <DropdownMenu.Label className="create-menu__label">
            新建或快速记录
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="create-menu__separator" />
          {CREATE_ACTIONS.map((action) => {
            const Icon = action.icon

            return (
              <DropdownMenu.Item
                asChild
                className="create-menu__item"
                key={action.href}
              >
                <Link href={action.href}>
                  <Icon aria-hidden="true" size={18} />
                  <span>
                    <strong>{action.label}</strong>
                    <small>{action.description}</small>
                  </span>
                </Link>
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
