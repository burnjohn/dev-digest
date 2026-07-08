"use client";

import React, { useState, useEffect, useRef } from "react";
import { Button, FormField, TextInput, SelectInput, Badge, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "../../../../lib/hooks/skills";

const TYPE_OPTIONS: { value: SkillType; label: string }[] = [
  { value: "rubric", label: "Rubric" },
  { value: "convention", label: "Convention" },
  { value: "security", label: "Security" },
  { value: "custom", label: "Custom" },
];

function estimateTokens(text: string) {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
}

const LH = 20; // line-height px — must match between gutter, backdrop, and textarea

function lineColor(line: string): string {
  if (/^#{1,6}(\s|$)/.test(line)) return "var(--accent)"; // markdown headings → blue
  if (/^[-*+]\s/.test(line)) return "var(--text-secondary)";
  return "var(--text-secondary)";
}

function CodeEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const lines = value.split("\n");

  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, scrollLeft } = e.currentTarget;
    if (gutterRef.current) gutterRef.current.scrollTop = scrollTop;
    if (backdropRef.current) {
      backdropRef.current.scrollTop = scrollTop;
      backdropRef.current.scrollLeft = scrollLeft;
    }
  };

  return (
    <div
      style={{
        display: "flex",
        border: "1px solid var(--border-strong)",
        borderRadius: 7,
        background: "var(--bg-elevated)",
        overflow: "hidden",
        height: 380,
      }}
    >
      {/* line-number gutter */}
      <div
        ref={gutterRef}
        style={{
          width: 44,
          flexShrink: 0,
          overflow: "hidden",
          paddingTop: 10,
          background: "rgba(0,0,0,0.18)",
          borderRight: "1px solid var(--border)",
          userSelect: "none",
        }}
      >
        {Array.from({ length: Math.max(1, lines.length) }, (_, i) => (
          <div
            key={i}
            style={{
              height: LH,
              lineHeight: `${LH}px`,
              fontSize: 11,
              paddingRight: 8,
              color: "var(--text-muted)",
              fontFamily: "monospace",
              textAlign: "right",
              opacity: 0.6,
            }}
          >
            {i + 1}
          </div>
        ))}
      </div>

      {/* editor pane: highlighted backdrop + transparent textarea on top */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* syntax-highlighted backdrop (aria-hidden, pointer-events none) */}
        <div
          ref={backdropRef}
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            padding: "10px 12px",
            fontFamily: "monospace",
            fontSize: 13,
            lineHeight: `${LH}px`,
            whiteSpace: "pre",
            overflow: "hidden",
            pointerEvents: "none",
          }}
        >
          {lines.map((line, i) => (
            <React.Fragment key={i}>
              <span style={{ color: lineColor(line) }}>
                {/* zero-width space keeps empty lines from collapsing in the flex layout */}
                {line || "​"}
              </span>
              {"\n"}
            </React.Fragment>
          ))}
        </div>

        {/* transparent textarea — user types here, caret is visible, text is hidden */}
        <textarea
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            resize: "none",
            padding: "10px 12px",
            background: "transparent",
            color: "transparent",
            caretColor: "var(--text-primary)",
            fontSize: 13,
            lineHeight: `${LH}px`,
            outline: "none",
            border: "none",
            fontFamily: "monospace",
            overflow: "auto",
            whiteSpace: "pre",
          }}
        />
      </div>
    </div>
  );
}

interface ConfigTabProps {
  skill: Skill;
}

export function ConfigTab({ skill }: ConfigTabProps) {
  const update = useUpdateSkill();

  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [type, setType] = useState<SkillType>(skill.type);
  const [body, setBody] = useState(skill.body);
  const [enabled, setEnabled] = useState(skill.enabled);

  useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setEnabled(skill.enabled);
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync enabled from list-card toggle without resetting unsaved edits in other fields
  useEffect(() => {
    setEnabled(skill.enabled);
  }, [skill.enabled]);

  const hasChanges =
    name !== skill.name ||
    description !== skill.description ||
    type !== skill.type ||
    body !== skill.body;

  const handleSave = () => {
    update.mutate({ id: skill.id, patch: { name, description, type, body } });
  };

  const handleToggleEnabled = (v: boolean) => {
    setEnabled(v);
    update.mutate({ id: skill.id, patch: { enabled: v } });
  };

  const tokenCount = estimateTokens(body);
  const bodyChanged = body !== skill.body;

  return (
    <div style={{ padding: "24px 28px", maxWidth: 800 }}>
      {/* heading row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>Configuration</h2>
        <Badge color="var(--text-muted)" mono>
          v{skill.version}
        </Badge>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Enabled</span>
          <Toggle on={enabled} onChange={handleToggleEnabled} size={18} />
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <FormField label="Name" required>
          <TextInput value={name} onChange={setName} placeholder="pr-quality-rubric" />
        </FormField>
      </div>

      {/* Description — hint rendered manually so we can color it */}
      <div style={{ marginBottom: 18 }}>
        <FormField label="Description">
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder="Enforces X - flags Y when Z is detected."
          />
        </FormField>
        <div style={{ fontSize: 11, color: "var(--accent)", opacity: 0.75, marginTop: 4 }}>
          Write as a directive &mdash; this is the skill&apos;s interface seen by both agents and reviewers.
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <FormField label="Type">
          <SelectInput
            value={type}
            onChange={(v) => setType(v as SkillType)}
            options={TYPE_OPTIONS}
          />
        </FormField>
      </div>

      {/* Skill body */}
      <div style={{ marginBottom: 8 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <span>Skill body</span>
          <span style={{ color: "var(--crit)" }}>*</span>
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "var(--text-muted)",
              fontWeight: 400,
            }}
          >
            <span style={{ fontFamily: "monospace" }}>{skill.name}.md</span>
            {bodyChanged && <Badge color="var(--warn)">unsaved</Badge>}
            <span>{tokenCount} tokens</span>
          </div>
        </div>
        {/* hint in accent blue — "синій для опису" */}
        <div style={{ fontSize: 11, color: "var(--accent)", opacity: 0.75, marginBottom: 8 }}>
          {bodyChanged
            ? "Saving a changed body creates a new immutable version."
            : "Markdown - injected verbatim into the agent's prompt as '## Skills / rules'."}
        </div>
        <CodeEditor value={body} onChange={setBody} />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <Button kind="primary" onClick={handleSave} disabled={!hasChanges || update.isPending}>
          {update.isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
