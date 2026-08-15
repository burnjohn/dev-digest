/* Showcase.tsx — renders every design-system component for visual verification.
   Used by the /showcase route (both themes) and by the smoke tests.
   Dev-only page: labels are intentionally not internationalized. */
"use client";

import React from "react";
import {
  Button,
  IconBtn,
  Badge,
  SeverityBadge,
  CategoryTag,
  Chip,
  Avatar,
  ConfidenceNum,
  MonoLink,
  ProgressBar,
  PercentProgress,
  CircularScore,
  Toggle,
  Kbd,
  SectionLabel,
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  Markdown,
  Drawer,
  Modal,
  Tabs,
  Dropdown,
  FormField,
  TextInput,
  SelectInput,
  Textarea,
  Checkbox,
  Sparkline,
  LineChart,
  Donut,
  BarRow,
  MetricCard,
  LiveLogStream,
  ExportWizardSteps,
  AutoTriggerStatus,
} from "@devdigest/ui";
import { s } from "./styles";
import { SEVERITIES, CATEGORIES, MODEL_OPTIONS } from "./constants";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={s.group}>
      <SectionLabel>{title}</SectionLabel>
      <div style={s.groupRow}>{children}</div>
    </section>
  );
}

export function Gallery() {
  const [toggle, setToggle] = React.useState(true);
  const [check, setCheck] = React.useState(true);
  const [tab, setTab] = React.useState("a");
  const [text, setText] = React.useState("");
  const [sel, setSel] = React.useState("gpt-4.1");
  const [drawer, setDrawer] = React.useState(false);
  const [modal, setModal] = React.useState(false);

  return (
    <div style={s.gallery}>
      <Group title="Buttons">
        <Button kind="primary" icon="Sparkles">
          Primary
        </Button>
        <Button kind="secondary">Secondary</Button>
        <Button kind="tertiary" active>
          Tertiary
        </Button>
        <Button kind="ghost" icon="Filter">
          Ghost
        </Button>
        <Button kind="danger" icon="Trash">
          Danger
        </Button>
        <Button kind="primary" size="sm" iconRight="ChevronDown">
          Small
        </Button>
        <IconBtn icon="RefreshCw" label="Refresh" />
        <IconBtn icon="Bell" label="Notifications" active />
      </Group>

      <Group title="Badges & Severity (icon + label, WCAG AA)">
        {SEVERITIES.map((sev) => (
          <SeverityBadge key={sev} severity={sev} count={3} />
        ))}
        <Badge icon="GitBranch">branch</Badge>
        <Badge dot color="var(--ok)" bg="transparent">
          synced
        </Badge>
        {CATEGORIES.map((c) => (
          <CategoryTag key={c} category={c} />
        ))}
      </Group>

      <Group title="Chips, Avatars, Confidence, MonoLink, Kbd">
        <Chip active icon="Check">
          Active
        </Chip>
        <Chip icon="Plus" count={4}>
          Add
        </Chip>
        <Avatar name="Ada Lovelace" />
        <Avatar name="you" size={28} />
        <ConfidenceNum value={0.91} />
        <ConfidenceNum value={0.6} />
        <MonoLink>src/config.ts:12</MonoLink>
        <Kbd>⌘K</Kbd>
        <Toggle on={toggle} onChange={setToggle} />
      </Group>

      <Group title="Progress & Score">
        <div style={s.w200}>
          <ProgressBar value={64} />
        </div>
        <div style={s.w220}>
          <PercentProgress value={42} label="Embedding chunks" />
        </div>
        <CircularScore score={82} />
        <CircularScore score={48} size={36} stroke={3.5} />
      </Group>

      <Group title="Cards & States">
        <Card style={s.w240}>
          <div style={s.cardTitle}>Card title</div>
          <div style={s.cardBody}>Elevated surface.</div>
        </Card>
        <div style={s.w280}>
          <EmptyState icon="GitPullRequest" title="No pull requests" body="Refresh to sync from GitHub." cta="Add repo" />
        </div>
        <div style={s.w300}>
          <ErrorState title="Engine unreachable" body="Is the API running on :3001?" onRetry={() => {}} />
        </div>
        <div style={s.skeletonStack}>
          <Skeleton height={16} />
          <Skeleton height={16} width="70%" />
          <Skeleton height={40} />
        </div>
      </Group>

      <Group title="Markdown">
        <div style={s.w420}>
          <Markdown>{"A finding with **bold**, `inline code`, and a [link](https://example.com).\n\n- one\n- two"}</Markdown>
        </div>
      </Group>

      <Group title="Form controls (real, controlled)">
        <div style={s.w280}>
          <FormField label="API key" hint="Stored locally." required>
            <TextInput value={text} onChange={setText} mono placeholder="sk-…" />
          </FormField>
        </div>
        <div style={s.w220}>
          <FormField label="Model">
            <SelectInput value={sel} onChange={setSel} options={[...MODEL_OPTIONS]} />
          </FormField>
        </div>
        <div style={s.w280}>
          <FormField label="Notes">
            <Textarea value={text} onChange={setText} placeholder="Free text…" rows={3} />
          </FormField>
        </div>
        <Checkbox checked={check} onChange={setCheck} label="On new PR" />
      </Group>

      <Group title="Tabs / Dropdown / Overlays">
        <div style={s.w360}>
          <Tabs
            value={tab}
            onChange={setTab}
            pad="0"
            tabs={[
              { key: "a", label: "Config", icon: "Settings" },
              { key: "b", label: "Skills", icon: "Sparkles", count: 3 },
              { key: "c", label: "Evals", icon: "FlaskConical" },
            ]}
          />
        </div>
        <Dropdown
          trigger={<Button kind="secondary" iconRight="ChevronDown">Menu</Button>}
          items={[
            { label: "Run all", icon: "Play" },
            { divider: true },
            { label: "Configure…", icon: "Settings", muted: true },
          ]}
        />
        <Button kind="ghost" onClick={() => setDrawer(true)}>
          Open Drawer
        </Button>
        <Button kind="ghost" onClick={() => setModal(true)}>
          Open Modal
        </Button>
      </Group>

      <Group title="Charts (Recharts)">
        <Sparkline data={[3, 5, 2, 8, 6, 9, 7]} />
        <div style={s.w360}>
          <LineChart
            series={[
              { name: "recall", color: "var(--accent)", data: [0.7, 0.74, 0.8, 0.78, 0.85, 0.9] },
              { name: "precision", color: "var(--ok)", data: [0.65, 0.7, 0.72, 0.8, 0.82, 0.88] },
            ]}
            h={160}
          />
        </div>
        <Donut
          segments={[
            { label: "openai", value: 4.2, color: "var(--accent)" },
            { label: "anthropic", value: 2.1, color: "var(--ok)" },
          ]}
        />
        <div style={s.w320}>
          <BarRow label="security-agent" value={42} max={60} suffix="42" />
          <BarRow label="perf-agent" value={28} max={60} color="var(--ok)" suffix="28" />
        </div>
        <div style={s.w200}>
          <MetricCard label="ACCEPT RATE" value="68" suffix="%" delta={0.04} trend={[0.6, 0.62, 0.65, 0.68]} />
        </div>
      </Group>

      <Group title="Shared (LiveLog / Wizard steps / Auto-trigger)">
        <div style={s.w460}>
          <LiveLogStream
            height={120}
            log={[
              { t: "0.1", k: "info", m: "assembling prompt" },
              { t: "0.4", k: "tool", m: "grep_repo(rate.limit)" },
              { t: "1.2", k: "result", m: "3 findings" },
              { t: "1.3", k: "error", m: "citation rejected: src/x.ts:9" },
            ]}
          />
        </div>
        <div style={s.w460}>
          <ExportWizardSteps step={1} labels={["Target", "Preview", "Configure", "Install"]} />
        </div>
        <AutoTriggerStatus on />
        <AutoTriggerStatus on={false} />
      </Group>

      {drawer && (
        <Drawer title="Example Drawer" subtitle="720px wide" onClose={() => setDrawer(false)}>
          <p style={s.drawerBody}>Drawer body content.</p>
        </Drawer>
      )}
      {modal && (
        <Modal title="Example Modal" subtitle="centered" onClose={() => setModal(false)} width={480}>
          <div style={s.modalBody}>Modal body content.</div>
        </Modal>
      )}
    </div>
  );
}
