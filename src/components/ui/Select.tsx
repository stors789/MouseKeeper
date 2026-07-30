import * as SelectPrimitive from '@radix-ui/react-select'
import { clsx } from 'clsx'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps {
  id?: string
  name?: string
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  options: readonly SelectOption[]
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  ariaLabel?: string
  className?: string
}

export function Select({
  ariaLabel,
  className,
  defaultValue,
  disabled,
  id,
  invalid,
  name,
  onValueChange,
  options,
  placeholder = '请选择',
  value
}: SelectProps) {
  return (
    <SelectPrimitive.Root
      defaultValue={defaultValue}
      disabled={disabled}
      name={name}
      onValueChange={onValueChange}
      value={value}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={clsx('ui-select__trigger', className)}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown aria-hidden="true" size={16} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="ui-select__content"
          position="popper"
          sideOffset={6}
        >
          <SelectPrimitive.ScrollUpButton className="ui-select__scroll">
            <ChevronUp aria-hidden="true" size={16} />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="ui-select__viewport">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                className="ui-select__item"
                disabled={option.disabled}
                value={option.value}
              >
                <SelectPrimitive.ItemText>
                  {option.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="ui-select__indicator">
                  <Check aria-hidden="true" size={15} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="ui-select__scroll">
            <ChevronDown aria-hidden="true" size={16} />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
