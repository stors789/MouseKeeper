import { render, screen } from '@testing-library/react'
import { App } from './App'

describe('App', () => {
  it('renders the configured product name', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: 'MouseKeeper' })
    ).toBeInTheDocument()
  })
})
