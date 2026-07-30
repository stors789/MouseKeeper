import { render, screen } from '@testing-library/react'

import { Field } from './Field'
import { Select } from './Select'

describe('Field', () => {
  it('connects required, description, and error semantics to a custom select', () => {
    render(
      <Field
        id="status"
        label="状态"
        description="选择当前状态"
        error="必须选择状态"
        required
      >
        <Select
          options={[
            { value: 'alive', label: '存活' },
            { value: 'dead', label: '死亡' }
          ]}
        />
      </Field>
    )

    const control = screen.getByRole('combobox', { name: '状态' })
    expect(control).toHaveAttribute(
      'aria-describedby',
      'status-description status-error'
    )
    expect(control).toHaveAttribute('aria-invalid', 'true')
    expect(control).toHaveAttribute('aria-required', 'true')
  })
})
