export const RH_INSTANCE_OPTIONS = [
  { value: 'default', label: 'Standard · 24GB' },
  { value: 'plus', label: 'Plus · 48GB' },
  { value: 'ultra', label: 'Ultra · 84GB' },
]

export function rhInstanceType(value?: string): 'default' | 'plus' | 'ultra' {
  if (value === 'plus' || value === '2') return 'plus'
  if (value === 'ultra' || value === '3') return 'ultra'
  return 'default'
}
