/* ComposeReviewDrawer — A4 Compose Review drawer. Editable markdown body
   (seeded from selected findings via /compose-review/preview), inline-comments
   toggle, verdict selector, and Post → POST /pulls/:id/compose-review (GitHub
   via PAT). Default-export; mounts in the PR detail page (?compose trigger). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Drawer, Icon, Toggle } from "@devdigest/ui";
import type { Verdict } from "@devdigest/shared";
import { useComposePreview, usePostComposeReview } from "../../../../../../../lib/hooks/compose";
import { FALLBACK_BODY, VERDICTS } from "./constants";
import { s } from "./styles";

export function ComposeReviewDrawer({
  prId,
  findingIds = [],
  onClose,
  onPosted,
}: {
  prId: string;
  findingIds?: string[];
  onClose: () => void;
  onPosted?: (githubReviewId: string | null) => void;
}) {
  const t = useTranslations("compose");
  const preview = useComposePreview();
  const post = usePostComposeReview();
  const [verdict, setVerdict] = React.useState<Verdict>("comment");
  const [inline, setInline] = React.useState(false);
  const [body, setBody] = React.useState("");
  const [posted, setPosted] = React.useState<string | null>(null);
  const seeded = React.useRef(false);

  // Seed the draft once from the server's composed body.
  React.useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    preview
      .mutateAsync({ prId, input: { finding_ids: findingIds, verdict, inline_comments: inline } })
      .then((p) => setBody(p.body))
      .catch(() => setBody(FALLBACK_BODY));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reseed = (v: Verdict) => {
    setVerdict(v);
    preview
      .mutateAsync({ prId, input: { finding_ids: findingIds, verdict: v, inline_comments: inline } })
      .then((p) => setBody(p.body))
      .catch(() => undefined);
  };

  const submit = async () => {
    const res = await post.mutateAsync({
      prId,
      input: { finding_ids: findingIds, body, verdict, inline_comments: inline },
    });
    setPosted(res.github_review_id);
    onPosted?.(res.github_review_id);
  };

  const footer = (
    <div style={s.footer}>
      <label style={s.inlineLabel}>
        <Toggle on={inline} onChange={setInline} size={15} />
        {t("reviewDrawer.inlineComments")}
      </label>
      <Button kind="ghost" onClick={onClose}>
        {t("reviewDrawer.cancel")}
      </Button>
      <Button kind="primary" icon="GitPullRequest" onClick={submit}>
        {post.isPending ? t("reviewDrawer.posting") : t("reviewDrawer.post")}
      </Button>
    </div>
  );

  return (
    <Drawer
      width={620}
      title={t("reviewDrawer.title")}
      subtitle={t("reviewDrawer.subtitle")}
      onClose={onClose}
      footer={footer}
    >
      <div style={s.body}>
        {posted !== null && (
          <div style={s.postedBanner}>
            <Icon.CheckCircle size={16} style={s.postedIcon} />
            <span style={s.postedText}>
              {posted ? t("reviewDrawer.postedWithId", { id: posted }) : t("reviewDrawer.posted")}
            </span>
          </div>
        )}

        <div>
          <div style={s.sectionLabel}>{t("reviewDrawer.verdictLabel")}</div>
          <div style={s.verdictRow}>
            {VERDICTS.map((v) => (
              <button key={v.key} onClick={() => reseed(v.key)} style={s.verdictBtn(verdict === v.key, v.color)}>
                {t(v.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div style={s.bodyHead}>
            <span style={s.bodyLabel}>{t("reviewDrawer.reviewBody")}</span>
            <Badge color="var(--text-muted)" icon="Edit">
              {t("reviewDrawer.markdownEditable")}
            </Badge>
            {findingIds.length > 0 && (
              <Badge color="var(--text-muted)">{t("reviewDrawer.findingsCount", { count: findingIds.length })}</Badge>
            )}
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
            style={s.textarea}
          />
        </div>
      </div>
    </Drawer>
  );
}

export default ComposeReviewDrawer;
