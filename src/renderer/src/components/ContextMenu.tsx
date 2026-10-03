import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type MenuItem =
  | { type: 'sep' }
  | {
      type: 'item'
      label: string
      checked?: boolean
      disabled?: boolean
      submenu?: MenuItem[]
      onSelect?: () => void
    }

type Props = {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  return createPortal(
    <div className="menu-root" onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()}>
      <MenuPanel x={x} y={y} items={items} onClose={onClose} />
    </div>,
    document.body
  )
}

function MenuPanel({
  x,
  y,
  items,
  onClose,
  nested = false
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
  nested?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [open, setOpen] = useState<number | null>(null)
  const [subPos, setSubPos] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let left = x
    let top = y
    if (left + rect.width > window.innerWidth - 8) left = Math.max(8, x - rect.width)
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - rect.height - 8)
    setPos({ left, top })
  }, [x, y, items])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="menu"
      style={{ left: pos.left, top: pos.top, zIndex: nested ? 70 : 60 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => {
        if (item.type === 'sep') return <div key={`s${i}`} className="sep" />
        const hasSub = Boolean(item.submenu?.length)
        return (
          <div
            key={`${item.label}-${i}`}
            onMouseEnter={(e) => {
              if (!hasSub) {
                setOpen(null)
                return
              }
              const r = e.currentTarget.getBoundingClientRect()
              setSubPos({ x: r.right - 4, y: r.top - 4 })
              setOpen(i)
            }}
          >
            <button
              className={`menu-item ${open === i ? 'open' : ''}`}
              disabled={item.disabled}
              onClick={(e) => {
                if (item.disabled) return
                if (hasSub) {
                  const r = e.currentTarget.getBoundingClientRect()
                  setSubPos({ x: Math.min(r.right - 4, window.innerWidth - 220), y: r.top - 4 })
                  setOpen(open === i ? null : i)
                  return
                }
                if (item.onSelect) {
                  item.onSelect()
                  onClose()
                }
              }}
            >
              <span className="check">{item.checked ? '✓' : ''}</span>
              <span className="grow">{item.label}</span>
              {hasSub ? <span className="arrow">›</span> : <span className="arrow" />}
            </button>
            {hasSub && open === i && item.submenu ? (
              <MenuPanel x={subPos.x} y={subPos.y} items={item.submenu} onClose={onClose} nested />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
