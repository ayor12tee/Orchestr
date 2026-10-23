import { redirect } from "next/navigation";
import { getAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDay } from "@/lib/format";
import { SettingForm } from "@/components/setting-form";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Settings · ConTech Command Centre" };

interface SettingRow {
  key: string;
  value: Record<string, unknown>;
  approval_state: "suggested" | "approved";
  updated_by: string | null;
  updated_at: string;
}

export default async function SettingsPage() {
  const access = await getAccess();
  if (!access.can("conference.manage") && !access.can("system.configure")) redirect("/");
  const canEdit = access.can("conference.manage");
  const supabase = await createClient();
  const { data } = await supabase
    .from("conference_settings")
    .select("key, value, approval_state, updated_by, updated_at")
    .eq("conference_id", access.conference.id)
    .returns<SettingRow[]>();
  const byKey = new Map((data ?? []).map((s) => [s.key, s]));
  const indicators = byKey.get("indicators");
  const progress = byKey.get("progress");
  const dateConvention = byKey.get("date_convention");
  const notifications = byKey.get("notifications");
  const conf = access.conference;

  return (
    <>
      <PageHeader
        title="Settings"
        description={canEdit ? "Conference rules that the dashboards use. Suggested values are defaults until leadership approves them." : "Read-only: only conference leadership can change these."}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Conference">
          <dl className="space-y-2 text-sm">
            <Row label="Name" value={conf.name} />
            <Row label="Conference day" value={`${formatDay(conf.event_date)} ${conf.event_date.slice(0, 4)}`} />
            <Row label="Venue" value={conf.venue ?? "Not set"} />
            {conf.theme && <Row label="Theme" value={conf.theme} />}
          </dl>
        </Card>

        <Card title="Dates and notifications" action={<State row={dateConvention} />}>
          <dl className="space-y-2 text-sm">
            <Row label="Scheduling" value={dateConvention?.value.days === "calendar" ? "Calendar days (weekends count)" : "Not set"} />
            <Row label="Due dates" value={dateConvention?.value.due_dates_inclusive ? "Inclusive: due by the end of the day" : "Not set"} />
            <Row label="“Today”" value="Lagos time (WAT)" />
            <Row label="Email" value={notifications?.value.email === "supabase_smtp" ? "Supabase email" : "Not set"} />
          </dl>
          <p className="mt-3 text-xs text-ink-muted">Confirmed by leadership. Changing these would change the meaning of every stored date, so they aren&apos;t editable here.</p>
        </Card>

        <Card title="“Due soon” window" action={<State row={indicators} />}>
          {canEdit ? (
            <SettingForm
              settingKey="indicators"
              field="due_soon_days"
              label="Flag tasks as due soon"
              unit="days before the due date"
              hint="Used by the Control Room and the task badges."
              value={Number(indicators?.value.due_soon_days ?? 7)}
              min={1}
              max={60}
              approved={indicators?.approval_state === "approved"}
            />
          ) : (
            <p className="text-sm">{Number(indicators?.value.due_soon_days ?? 7)} days before the due date</p>
          )}
        </Card>

        <Card title="Progress credit for unverified work" action={<State row={progress} />}>
          {canEdit ? (
            <SettingForm
              settingKey="progress"
              field="unverified_complete_credit"
              label="Credit for work marked complete without the required evidence"
              unit="%"
              hint="0% means it counts for nothing until evidence is attached. Used by the Pace Tracker (Phase 3)."
              value={Math.round(Number(progress?.value.unverified_complete_credit ?? 0) * 100)}
              min={0}
              max={100}
              approved={progress?.approval_state === "approved"}
            />
          ) : (
            <p className="text-sm">{Math.round(Number(progress?.value.unverified_complete_credit ?? 0) * 100)}%</p>
          )}
        </Card>
      </div>
    </>
  );
}

function State({ row }: { row?: SettingRow }) {
  if (!row) return <Badge>Default</Badge>;
  return row.approval_state === "approved" ? <Badge tone="green">Approved</Badge> : <Badge tone="amber">Suggested</Badge>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
