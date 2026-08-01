import { render, screen, waitFor } from '@testing-library/react'
import { APPLICATION_EVENT_NAMES } from '../application'
import { CreateMenu } from './CreateMenu'

describe('CreateMenu application command', () => {
  it('opens the desktop Radix menu from the stable application event', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    })
    render(<CreateMenu />)
    globalThis.dispatchEvent(new CustomEvent(APPLICATION_EVENT_NAMES.openCreateMenu))
    await waitFor(() => expect(screen.getByText('新建或快速记录')).toBeVisible())
  })
})
