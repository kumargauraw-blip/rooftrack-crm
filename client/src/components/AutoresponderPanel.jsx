import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    useAutoresponders,
    useActiveAutoresponder,
    useCreateCampaign,
    useUpdateCampaign,
    useActivateAutoresponder,
    useDeactivateAutoresponder,
    useTestSendCampaign,
} from '../hooks/useCampaigns';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Zap, Mail, CheckCircle2, CircleOff, Send, Plus, Pencil } from 'lucide-react';

// ─── localStorage-backed state ─────────────────────────────────────────────
// Keeps in-progress autoresponder edits alive across tab switches, route
// navigations, and even full page reloads. Pass `null` to clear.
// Keys are namespaced so we can find and clean up our own entries.
const EDITING_STATE_KEY = 'hr_crm_autoresponder_editing';
const draftKey = (id) => `hr_crm_autoresponder_draft_${id || 'new'}`;

/** Returns true iff there's a stored draft for the given campaign id (or 'new'). */
function hasStoredDraft(id) {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(draftKey(id)) !== null;
    } catch {
        return false;
    }
}

function useLocalStorageState(key, initialValue) {
    const [value, setValue] = useState(() => {
        if (typeof window === 'undefined') return initialValue;
        try {
            const raw = window.localStorage.getItem(key);
            if (raw !== null) return JSON.parse(raw);
        } catch { /* corrupted entry — ignore and fall back to initial */ }
        return initialValue;
    });

    useEffect(() => {
        try {
            if (value === null || value === undefined) {
                window.localStorage.removeItem(key);
            } else {
                window.localStorage.setItem(key, JSON.stringify(value));
            }
        } catch { /* quota exceeded / private mode — safe to ignore */ }
    }, [key, value]);

    return [value, setValue];
}

const NEW_LEAD_DEFAULT = {
    subject: 'Thanks for reaching out — HonestRoof will call you shortly',
    html_content: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
<h2 style="color: #1e3a5f;">Thanks {{first_name}},</h2>
<p>We received your inspection request and a member of our team will reach out to you shortly at <strong>{{phone}}</strong>.</p>
<p>While you wait, here's what you can expect from HonestRoof:</p>
<ul>
  <li>Same-day response, 7 days a week</li>
  <li>Honest, no-pressure assessment — we only recommend work you actually need</li>
  <li>20-year written leak-free guarantee on every full roof we install</li>
  <li>Three generations of DFW craftsmanship since 1954</li>
</ul>
<p>Need us sooner? Call <a href="tel:+18179662863"><strong>(817) 966-2863</strong></a> and mention your inspection request.</p>
<p>Talk soon,<br/><strong>Dennis Harrison</strong><br/>HonestRoof.com</p>
</div>`,
    text_content: `Thanks {{first_name}},

We received your inspection request and a member of our team will reach out to you at {{phone}} shortly.

What to expect:
- Same-day response, 7 days a week
- Honest, no-pressure assessment
- 20-year written leak-free guarantee
- Three generations of DFW craftsmanship since 1954

Need us sooner? Call (817) 966-2863 and mention your request.

Talk soon,
Dennis Harrison
HonestRoof.com`,
};

export default function AutoresponderPanel() {
    const { data: autoresponders = [], isLoading } = useAutoresponders();
    const { data: active } = useActiveAutoresponder('new_lead');

    // Persisted to localStorage so tab switches don't drop the editor.
    // Shape: null | { mode: 'new' } | { mode: 'edit', id: string }
    const [editingState, setEditingState] = useLocalStorageState(EDITING_STATE_KEY, null);

    // `?editAutoresponder=<id>` in the URL → auto-open the editor for that
    // campaign and strip the param. Used by the CampaignDetail redirect when
    // someone lands on /campaigns/:id for an autoresponder.
    const [searchParams, setSearchParams] = useSearchParams();
    useEffect(() => {
        const editId = searchParams.get('editAutoresponder');
        if (editId) {
            setEditingState({ mode: 'edit', id: editId });
            const next = new URLSearchParams(searchParams);
            next.delete('editAutoresponder');
            setSearchParams(next, { replace: true });
        }
    }, [searchParams, setSearchParams, setEditingState]);

    const newLeadAutoresponders = autoresponders.filter((a) => a.trigger_event === 'new_lead');

    // Resolve whichever campaign we're editing (if any). Uses the fresh list
    // from the server so we always pass the editor up-to-date DB values as its
    // baseline — the user's unsaved typing is kept in the draft-key store.
    const editingCampaign =
        editingState?.mode === 'edit' && editingState.id
            ? autoresponders.find((a) => a.id === editingState.id) || null
            : null;

    // If another admin (or another tab) deleted the campaign we were editing,
    // drop the stale editing reference. Done in an effect so we don't set
    // state during render.
    useEffect(() => {
        if (
            editingState?.mode === 'edit' &&
            editingState.id &&
            !isLoading &&
            !editingCampaign
        ) {
            setEditingState(null);
        }
    }, [editingState, isLoading, editingCampaign, setEditingState]);

    const isEditorOpen = editingState?.mode === 'new' || !!editingCampaign;

    const startNew = () => setEditingState({ mode: 'new' });
    const startEdit = (campaign) => setEditingState({ mode: 'edit', id: campaign.id });
    const closeEditor = () => setEditingState(null);

    if (isLoading) {
        return (
            <Card>
                <CardContent className="py-8 text-center text-muted-foreground text-sm">
                    Loading autoresponders...
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-primary/30">
            <CardHeader className="pb-4">
                <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                        <Zap className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                        <CardTitle className="text-lg">New Lead Autoresponder</CardTitle>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Automatically emailed to every new lead that submits the website form with a valid email address.
                            Dennis is BCC&apos;d on every send.
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {isEditorOpen ? (
                    <AutoresponderEditor
                        campaign={editingCampaign}
                        onClose={closeEditor}
                    />
                ) : (
                    <>
                        {active ? (
                            <ActiveAutoresponderCard
                                campaign={active}
                                onEdit={() => startEdit(active)}
                                hasDraft={hasStoredDraft(active.id)}
                            />
                        ) : (
                            <div className="rounded-lg border border-dashed p-5 text-center space-y-3">
                                <p className="text-sm text-muted-foreground">
                                    No active autoresponder. Create one and new leads will get an immediate acknowledgement email.
                                </p>
                                <Button size="sm" onClick={startNew}>
                                    <Plus className="h-4 w-4 mr-1" />
                                    {hasStoredDraft(null)
                                        ? 'Resume Draft'
                                        : 'Create New Lead Autoresponder'}
                                </Button>
                                {hasStoredDraft(null) && (
                                    <p className="text-[11px] text-muted-foreground">
                                        You have an unsaved draft — your progress will be restored.
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Any other (inactive) autoresponders sitting around */}
                        {newLeadAutoresponders.filter((a) => a.id !== active?.id).length > 0 && (
                            <div className="pt-3 border-t">
                                <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Inactive drafts</p>
                                <div className="space-y-2">
                                    {newLeadAutoresponders
                                        .filter((a) => a.id !== active?.id)
                                        .map((c) => (
                                            <InactiveAutoresponderRow
                                                key={c.id}
                                                campaign={c}
                                                onEdit={() => startEdit(c)}
                                                hasDraft={hasStoredDraft(c.id)}
                                            />
                                        ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function ActiveAutoresponderCard({ campaign, onEdit, hasDraft }) {
    const { mutate: deactivate, isPending: deactivating } = useDeactivateAutoresponder();

    return (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge className="bg-emerald-500 text-white">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Active
                        </Badge>
                        <span className="font-medium truncate">{campaign.name}</span>
                        {hasDraft && (
                            <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-[10px]">
                                Unsaved draft
                            </Badge>
                        )}
                    </div>
                    <p className="text-xs text-emerald-700 mb-1.5 flex items-center gap-1">
                        <Zap className="h-3 w-3" />
                        <strong>Fires automatically</strong> on every new website lead with an email address
                    </p>
                    <p className="text-sm text-muted-foreground truncate">
                        <Mail className="h-3 w-3 inline mr-1" />
                        Subject: <span className="text-foreground">{campaign.subject || '(no subject)'}</span>
                    </p>
                </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" onClick={onEdit}>
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    {hasDraft ? 'Resume Draft' : 'Edit Email'}
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => {
                        if (confirm('Deactivate the autoresponder? New leads will stop getting the automatic email.')) {
                            deactivate(campaign.id);
                        }
                    }}
                    disabled={deactivating}
                >
                    <CircleOff className="h-3.5 w-3.5 mr-1" />
                    {deactivating ? 'Deactivating...' : 'Deactivate'}
                </Button>
            </div>
        </div>
    );
}

function InactiveAutoresponderRow({ campaign, onEdit, hasDraft }) {
    const { mutate: activate, isPending: activating } = useActivateAutoresponder();
    return (
        <div
            className="rounded border p-3 text-sm hover:border-primary/40 hover:bg-accent/30 transition-colors cursor-pointer"
            onClick={onEdit}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onEdit(); }}
        >
            <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">Draft</Badge>
                        <p className="font-medium truncate">{campaign.name}</p>
                        {hasDraft && (
                            <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-[10px]">
                                Unsaved changes
                            </Badge>
                        )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Zap className="h-3 w-3" />
                        Would fire on every new website lead with an email — not yet active
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1">
                        Subject: {campaign.subject || '(no subject)'}
                    </p>
                </div>
                <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="outline" onClick={onEdit}>
                        <Pencil className="h-3.5 w-3.5 mr-1" />
                        {hasDraft ? 'Resume' : 'Edit'}
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => activate(campaign.id)}
                        disabled={activating}
                    >
                        {activating ? 'Activating...' : 'Activate'}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function AutoresponderEditor({ campaign, onClose }) {
    const isNew = !campaign;

    // Baseline = whatever the DB currently has (or sensible defaults for a new autoresponder).
    // This is what the user sees if they've never typed anything. If they HAVE typed, the
    // draft stored in localStorage takes over.
    const baseline = {
        name: campaign?.name || 'New Lead Acknowledgement',
        subject: campaign?.subject || NEW_LEAD_DEFAULT.subject,
        htmlContent: campaign?.html_content || NEW_LEAD_DEFAULT.html_content,
        textContent: campaign?.text_content || NEW_LEAD_DEFAULT.text_content,
        fromName: campaign?.from_name || '',
        fromEmail: campaign?.from_email || '',
    };

    // The form body is persisted to localStorage keyed per-campaign (or 'new'),
    // so tab switches / reloads don't lose work. useLocalStorageState seeds
    // from the DB values the first time this draft key is ever written.
    const storageKey = draftKey(campaign?.id);
    const [draft, setDraft] = useLocalStorageState(storageKey, baseline);

    // Merge baseline under the draft so newly-added fields (future additions)
    // don't crash the UI when an old draft is loaded.
    const form = { ...baseline, ...(draft || {}) };
    const update = (field, val) => setDraft({ ...form, [field]: val });
    const clearDraft = () => setDraft(null);

    const [testEmail, setTestEmail] = useState('');
    const [showPreview, setShowPreview] = useState(false);

    const { mutate: createCampaign, isPending: creating } = useCreateCampaign();
    const { mutate: updateCampaign, isPending: updating } = useUpdateCampaign();
    const { mutate: activate, isPending: activating } = useActivateAutoresponder();
    const { mutate: testSend, isPending: testing, data: testResult, error: testError, reset: resetTest } = useTestSendCampaign();

    // Unsaved changes = anything in the form differs from the campaign baseline.
    const hasUnsavedChanges = JSON.stringify(form) !== JSON.stringify(baseline);

    const buildPayload = () => ({
        name: form.name,
        type: 'autoresponder',
        trigger_event: 'new_lead',
        subject: form.subject,
        html_content: form.htmlContent,
        text_content: form.textContent,
        from_name: form.fromName || null,
        from_email: form.fromEmail || null,
    });

    const handleSaveDraft = () => {
        const payload = buildPayload();
        const onSuccess = (saved) => {
            clearDraft();
            // A brand-new autoresponder just got an id — its draft key was 'new',
            // but from here on it would be keyed by the new id. That's fine —
            // the new-draft entry is already cleared and the DB is authoritative.
            if (isNew && saved?.id) {
                // also wipe any draft that might exist at the new id key (shouldn't, but be safe)
                try { window.localStorage.removeItem(draftKey(saved.id)); } catch {}
            }
            onClose();
        };
        if (isNew) {
            createCampaign(payload, { onSuccess });
        } else {
            updateCampaign({ id: campaign.id, ...payload }, { onSuccess });
        }
    };

    const handleSaveAndActivate = () => {
        const payload = buildPayload();
        const onSaved = (saved) => activate(saved.id, {
            onSuccess: () => {
                clearDraft();
                if (isNew && saved?.id) {
                    try { window.localStorage.removeItem(draftKey(saved.id)); } catch {}
                }
                onClose();
            },
        });
        if (isNew) {
            createCampaign(payload, { onSuccess: onSaved });
        } else {
            updateCampaign({ id: campaign.id, ...payload }, { onSuccess: onSaved });
        }
    };

    // Cancel with confirmation if there's unsaved work, otherwise close silently.
    const handleCancel = () => {
        if (hasUnsavedChanges) {
            const ok = window.confirm('Discard your unsaved changes?');
            if (!ok) return;
        }
        clearDraft();
        onClose();
    };

    const handleTest = () => {
        resetTest();
        if (!campaign?.id) {
            alert('Save as draft first, then send a test.');
            return;
        }
        if (!testEmail) return;
        testSend({ campaignId: campaign.id, to_email: testEmail, to_name: 'Test User' });
    };

    const previewHtml = form.htmlContent.replace(/\{\{\s*first_name\s*\}\}/g, 'John')
        .replace(/\{\{\s*name\s*\}\}/g, 'John Smith')
        .replace(/\{\{\s*phone\s*\}\}/g, '(817) 555-1234')
        .replace(/\{\{\s*email\s*\}\}/g, 'john@example.com');

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">
                        {isNew ? 'New autoresponder' : `Editing: ${campaign.name}`}
                    </h3>
                    {hasUnsavedChanges && (
                        <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-[10px]">
                            Unsaved changes — safe to switch tabs
                        </Badge>
                    )}
                </div>
                <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
            </div>

            {/* Trigger explainer — answers "when will this run?" up front */}
            <div className="rounded-md bg-primary/5 border border-primary/20 p-3 text-sm flex items-start gap-2">
                <Zap className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div>
                    <p className="font-medium">Trigger: every new lead</p>
                    <p className="text-muted-foreground text-[13px]">
                        Sends automatically to any lead that submits a honestroof.com form with an email address.
                        Dennis is BCC&apos;d on every send. Only fires when this autoresponder is <strong>Active</strong>.
                    </p>
                </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
                <div>
                    <label className="block text-xs font-medium mb-1">Internal name</label>
                    <Input value={form.name} onChange={(e) => update('name', e.target.value)} />
                </div>
                <div>
                    <label className="block text-xs font-medium mb-1">Subject line</label>
                    <Input value={form.subject} onChange={(e) => update('subject', e.target.value)} />
                </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
                <div>
                    <label className="block text-xs font-medium mb-1">
                        From name <span className="text-muted-foreground">(optional)</span>
                    </label>
                    <Input
                        value={form.fromName}
                        onChange={(e) => update('fromName', e.target.value)}
                        placeholder="Uses default: HonestRoof.com"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium mb-1">
                        From email <span className="text-muted-foreground">(optional)</span>
                    </label>
                    <Input
                        type="email"
                        value={form.fromEmail}
                        onChange={(e) => update('fromEmail', e.target.value)}
                        placeholder="Uses default: SENDLAYER_FROM_EMAIL"
                    />
                </div>
            </div>

            <div>
                <label className="block text-xs font-medium mb-1">HTML body</label>
                <p className="text-[11px] text-muted-foreground mb-1">
                    Available placeholders: <code>{'{{first_name}}'}</code>, <code>{'{{name}}'}</code>, <code>{'{{phone}}'}</code>, <code>{'{{email}}'}</code>, <code>{'{{address}}'}</code>
                </p>
                <textarea
                    value={form.htmlContent}
                    onChange={(e) => update('htmlContent', e.target.value)}
                    rows={14}
                    className="w-full border rounded-md px-3 py-2 text-sm font-mono"
                />
            </div>

            <div>
                <label className="block text-xs font-medium mb-1">Plain text body (fallback)</label>
                <textarea
                    value={form.textContent}
                    onChange={(e) => update('textContent', e.target.value)}
                    rows={5}
                    className="w-full border rounded-md px-3 py-2 text-sm"
                />
            </div>

            <div>
                <button
                    type="button"
                    onClick={() => setShowPreview((s) => !s)}
                    className="text-sm text-primary hover:underline"
                >
                    {showPreview ? 'Hide preview' : 'Show preview with sample data'}
                </button>
                {showPreview && (
                    <div className="mt-2 border rounded-md p-3 bg-white">
                        <p className="text-xs text-muted-foreground mb-2">
                            Subject: <strong className="text-foreground">{form.subject.replace(/\{\{\s*first_name\s*\}\}/g, 'John')}</strong>
                        </p>
                        <div className="border-t pt-3" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                    </div>
                )}
            </div>

            {/* Test send */}
            {!isNew && (
                <div className="rounded-lg border bg-neutral-50 p-3 space-y-2">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Send a test</p>
                    <div className="flex flex-wrap gap-2 items-center">
                        <Input
                            type="email"
                            placeholder="your@email.com"
                            value={testEmail}
                            onChange={(e) => setTestEmail(e.target.value)}
                            className="max-w-xs"
                        />
                        <Button size="sm" variant="outline" onClick={handleTest} disabled={testing || !testEmail}>
                            <Send className="h-3.5 w-3.5 mr-1" />
                            {testing ? 'Sending...' : 'Send test'}
                        </Button>
                        {testResult && <span className="text-xs text-emerald-600">Sent. Check your inbox.</span>}
                        {testError && (
                            <span className="text-xs text-red-600">
                                {testError.response?.data?.error || testError.message}
                            </span>
                        )}
                    </div>
                </div>
            )}

            <div className="flex flex-wrap gap-2 justify-end pt-2 border-t">
                <Button variant="ghost" onClick={handleCancel}>Cancel</Button>
                <Button variant="outline" onClick={handleSaveDraft} disabled={creating || updating}>
                    {creating || updating ? 'Saving...' : 'Save as draft'}
                </Button>
                <Button onClick={handleSaveAndActivate} disabled={creating || updating || activating}>
                    {activating ? 'Activating...' : 'Save & Activate'}
                </Button>
            </div>
        </div>
    );
}
