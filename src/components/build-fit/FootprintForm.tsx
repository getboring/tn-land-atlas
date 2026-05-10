// FootprintForm, typed-dimension rectangle creator + editor.
//
// Phase 1 only supports rectangles from typed dimensions (width x length).
// Drawn polygons + drag/rotate handles come in Phase 2. Numeric rotation
// is trivial (an input field that re-runs rectangleFromDimensions) so it
// ships now.

import { useEffect, useState } from 'react'
import { Save, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FootprintProject } from '@/lib/build-fit/schemas'

export interface FootprintFormValues {
  name: string
  widthFt: number
  lengthFt: number
  rotationDeg: number
  stories: number | null
  notes: string | null
}

interface FootprintFormProps {
  /** Existing project being edited, or null when creating fresh. */
  initial: FootprintProject | null
  /** Live preview, fires on every valid input change so the map can re-render. */
  onChange: (next: FootprintFormValues) => void
  /** Persist, fires on Save click. Workspace upserts to localStorage. */
  onSave: (next: FootprintFormValues) => void
  /** Phase-1 simple-delete. Workspace removes from store + clears the map. */
  onDelete?: () => void
}

const DEFAULT_VALUES: FootprintFormValues = {
  name: '',
  widthFt: 40,
  lengthFt: 60,
  rotationDeg: 0,
  stories: 1,
  notes: null,
}

function projectToForm(p: FootprintProject): FootprintFormValues {
  return {
    name: p.name,
    widthFt: p.widthFt ?? 40,
    lengthFt: p.lengthFt ?? 60,
    rotationDeg: p.rotationDeg,
    stories: p.stories,
    notes: p.notes,
  }
}

export function FootprintForm({ initial, onChange, onSave, onDelete }: FootprintFormProps) {
  // The form is uncontrolled-from-props after mount: the parent remounts it
  // (via key={initial?.id ?? 'new'}) when the user picks a different
  // footprint. That avoids the prop-sync effect lint warns about.
  const [values, setValues] = useState<FootprintFormValues>(
    initial ? projectToForm(initial) : DEFAULT_VALUES,
  )

  // Emit the initial values to the parent ONCE on mount so the workspace
  // can render the default-rectangle preview without requiring the user to
  // edit a field first. Empty deps array makes this strictly mount-time;
  // the eslint-disable below is intentional, the function identity changing
  // shouldn't re-fire this effect.
  useEffect(() => {
    if (values.widthFt >= 1 && values.lengthFt >= 1) {
      onChange(values)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isValid =
    values.name.trim().length > 0 && values.widthFt >= 1 && values.lengthFt >= 1

  const setField = <K extends keyof FootprintFormValues>(key: K, value: FootprintFormValues[K]) => {
    setValues((v) => {
      const next = { ...v, [key]: value }
      // Live preview, emit every valid change directly from the event
      // handler instead of via a watcher effect. Numbers below 1 ft are
      // treated as in-progress.
      if (next.widthFt >= 1 && next.lengthFt >= 1) onChange(next)
      return next
    })
  }

  return (
    <div className="space-y-3 text-xs">
      <Field label="Name">
        <input
          type="text"
          value={values.name}
          onChange={(e) => setField('name', e.target.value)}
          placeholder='e.g. "40 x 60 shop"'
          className={inputCls}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Width (ft)">
          <NumberInput value={values.widthFt} min={1} step={1} onChange={(n) => setField('widthFt', n)} />
        </Field>
        <Field label="Length (ft)">
          <NumberInput value={values.lengthFt} min={1} step={1} onChange={(n) => setField('lengthFt', n)} />
        </Field>
      </div>

      <Field label="Rotation (° from north, clockwise)">
        <div className="flex items-center gap-2">
          <NumberInput value={values.rotationDeg} step={5} onChange={(n) => setField('rotationDeg', n)} />
          <button
            type="button"
            onClick={() => setField('rotationDeg', 0)}
            className="text-[11px] text-text-tertiary hover:text-white px-2 h-9 rounded-lg hover:bg-white/5"
            title="Reset rotation"
          >
            Reset
          </button>
        </div>
      </Field>

      <Field label="Stories (optional)">
        <NumberInput
          value={values.stories ?? 0}
          min={0}
          step={1}
          onChange={(n) => setField('stories', n === 0 ? null : n)}
        />
      </Field>

      <Field label="Notes (optional)">
        <textarea
          value={values.notes ?? ''}
          onChange={(e) => setField('notes', e.target.value || null)}
          rows={2}
          placeholder="e.g. Shop with lean-to later"
          className={cn(inputCls, 'resize-none')}
        />
      </Field>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={!isValid}
          onClick={() => isValid && onSave(values)}
          className={cn(
            'inline-flex items-center gap-1.5 h-10 px-3 rounded-lg text-xs font-medium transition-colors',
            isValid
              ? 'bg-brand text-white hover:bg-brand-strong hover:text-text-inverse'
              : 'bg-white/5 text-text-tertiary cursor-not-allowed',
          )}
        >
          <Save className="w-3.5 h-3.5" />
          Save footprint
        </button>
        {onDelete && initial && (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg text-[11px] text-text-tertiary hover:text-danger hover:bg-danger/10"
            title="Delete footprint"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        )}
      </div>
    </div>
  )
}

const inputCls =
  'w-full bg-white/5 border border-border-default text-text-primary text-base sm:text-sm px-3 h-9 rounded-lg outline-none focus:border-brand placeholder:text-text-tertiary'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="data-label mb-1">{label}</div>
      {children}
    </label>
  )
}

function NumberInput({
  value,
  min,
  step,
  onChange,
}: {
  value: number
  min?: number
  step?: number
  onChange: (n: number) => void
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      step={step}
      onChange={(e) => {
        const n = Number(e.target.value)
        if (Number.isFinite(n)) onChange(n)
      }}
      className={inputCls}
    />
  )
}
