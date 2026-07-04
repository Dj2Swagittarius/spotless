'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  title: string;
  placeholder?: string;
  initial?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void | Promise<void>;
  onClose: () => void;
}

export default function PromptModal({ title, placeholder, initial = '', submitLabel = 'Save', onSubmit, onClose }: Props) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true);
    await onSubmit(v);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg bg-elevated p-5 shadow-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-bold">{title}</h2>
        <input
          ref={inputRef}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={placeholder}
          maxLength={80}
          className="mb-4 w-full rounded bg-highlight px-3 py-2 text-sm text-white placeholder:text-subdued focus:outline-none focus:shadow-insetBorder"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full px-4 py-1.5 text-sm font-medium text-subdued hover:text-white">
            Cancel
          </button>
          <button onClick={submit} disabled={busy || !value.trim()} className="btn-primary">
            {busy ? '…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
