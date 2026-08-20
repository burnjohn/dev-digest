/* SkillsRail — the persistent left column of the Skills Lab: search, Add Skill,
   and the workspace's skills. Selecting one routes to /skills/:id, keeping the
   current editor tab. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, Icon, Skeleton } from "@devdigest/ui";
import { useSkills, useUpdateSkill } from "../../../../lib/hooks/skills";
import { filterSkills } from "../../helpers";
import { s } from "../../styles";
import { SkillRailCard } from "./_components/SkillRailCard";
import { ImportSkillDrawer } from "./_components/ImportSkillDrawer";
import { NewSkillModal } from "./_components/NewSkillModal";

export function SkillsRail({ activeId, tab = "config" }: { activeId?: string; tab?: string }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading } = useSkills();
  const update = useUpdateSkill();
  const [search, setSearch] = React.useState("");
  const [modal, setModal] = React.useState<"none" | "create" | "import">("none");

  const list = filterSkills(skills ?? [], search);

  return (
    <div style={s.rail}>
      {modal === "create" && <NewSkillModal onClose={() => setModal("none")} />}
      {modal === "import" && <ImportSkillDrawer onClose={() => setModal("none")} />}

      <div style={s.railHeader}>
        <div style={s.railTitleRow}>
          <h1 style={s.railTitle}>{t("page.heading")}</h1>
          <Dropdown
            width={230}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("page.addSkill")}
              </Button>
            }
            items={[
              { label: t("page.menu.create"), icon: "Edit", onClick: () => setModal("create") },
              { label: t("page.menu.fromFile"), icon: "Upload", onClick: () => setModal("import") },
            ]}
          />
        </div>
        <div style={s.search}>
          <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("page.searchPlaceholder")}
            aria-label={t("page.searchPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>

      <div style={s.railList}>
        {isLoading && (
          <>
            <Skeleton height={104} />
            <Skeleton height={104} />
          </>
        )}
        {list.map((skill) => (
          <SkillRailCard
            key={skill.id}
            skill={skill}
            active={skill.id === activeId}
            onClick={() => router.push(`/skills/${skill.id}?tab=${tab}`)}
            onToggle={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
          />
        ))}
      </div>
    </div>
  );
}
