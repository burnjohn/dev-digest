"use client";

import React from "react";
import { Modal, Button } from "@devdigest/ui";

interface ConfirmModalProps {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal
      width={440}
      title={title}
      onClose={onCancel}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button kind="ghost" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button kind={danger ? "danger" : "primary"} size="sm" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div
        style={{
          padding: "16px 24px",
          fontSize: 14,
          color: "var(--text-secondary)",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
        }}
      >
        {body}
      </div>
    </Modal>
  );
}
