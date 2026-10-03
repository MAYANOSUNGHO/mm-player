import { useEffect, useRef } from 'react'

export function PromptModal({
  title,
  description,
  label,
  initial,
  confirmLabel,
  onClose,
  onSubmit
}: {
  title: string
  description?: string
  label: string
  initial: string
  confirmLabel: string
  onClose: () => void
  onSubmit: (value: string) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          const value = ref.current?.value.trim() ?? ''
          if (!value) return
          onSubmit(value)
        }}
      >
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
        <label>{label}</label>
        <input ref={ref} defaultValue={initial} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="btn solid">
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

export function ConfirmModal({
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm
}: {
  title: string
  description: string
  confirmLabel: string
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{description}</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn solid" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function DeleteChoiceModal({
  count,
  onClose,
  onLibrary,
  onDisk
}: {
  count: number
  onClose: () => void
  onLibrary: () => void
  onDisk: () => void
}) {
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>영상 삭제</h3>
        <p>
          {count}개를 삭제합니다. 목록에서만 지우면 원본 파일은 그대로 두고, 이 창에 영상을 다시 끌어다 놓기 전에는 다시
          스캔해도 나타나지 않습니다. 원본 삭제는 휴지통으로 보냅니다.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn" onClick={onLibrary}>
            목록에서만 제거
          </button>
          <button type="button" className="btn solid" onClick={onDisk}>
            원본 파일 삭제
          </button>
        </div>
      </div>
    </div>
  )
}
