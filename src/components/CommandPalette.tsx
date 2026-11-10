// CommandPalette.tsx — Fincept-style Ctrl+K modal launcher for workspaces, symbols, and emergency actions. Dependencies: React.
'use client';

import React, { useState } from 'react';

export type PaletteCommand = {
  id: string;
  label: string;
  shortcut: string;
  run: () => void;
};

export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  if (!open) return null;

  const q = query.trim().toLowerCase();
  const filtered = q ? commands.filter((c) => c.label.toLowerCase().includes(q) || c.shortcut.toLowerCase().includes(q)) : commands;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
          <label htmlFor="cmd-search">Command Palette (type workspace, symbol, or action; Esc to close)</label>
          <input
            id="cmd-search"
            autoFocus
            style={{ width: '100%' }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && filtered[0]) {
                filtered[0].run();
                setQuery('');
                onClose();
              }
            }}
          />
        </div>
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {filtered.map((cmd) => (
            <button
              key={cmd.id}
              type="button"
              className="modal-item"
              onClick={() => {
                cmd.run();
                setQuery('');
                onClose();
              }}
            >
              <span>{cmd.label}</span>
              <span className="muted">{cmd.shortcut}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
