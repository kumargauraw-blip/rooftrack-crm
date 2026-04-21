import { useState, useEffect } from 'react';
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
import { Zap, Mail, CheckCircle2, CircleOff, Send, Plus } from 'lucide-react';

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

    const [editing, setEditing] = useState(null); // holds the campaign being edited, or 'new'
    const newLeadAutoresponders = autoresponders.filter((a) => a.trigger_event === 'new_lead');

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
                {editing ? (
                    <AutoresponderEditor
                        campaign={editing === 'new' ? null : editing}
                        onClose={() => setEditing(null)}
                    />
                ) : (
                    <>
                        {active ? (
                            <ActiveAutoresponderCard
                                campaign={active}
                                onEdit={() => setEditing(active)}
                            />
                        ) : (
                            <div className="rounded-lg border border-dashed p-5 text-center space-y-3">
                                <p className="text-sm text-muted-foreground">
                                    No active autoresponder. Create one and new leads will get an immediate acknowledgement email.
                                </p>
                                <Button size="sm" onClick={() => setEditing('new')}>
                                    <Plus className="h-4 w-4 mr-1" />
                                    Create New Lead Autoresponder
                                </Button>
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
                                                onEdit={() => setEditing(c)}
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

function ActiveAutoresponderCard({ campaign, onEdit }) {
    const { mutate: deactivate, isPending: deactivating } = useDeactivateAutoresponder();

    return (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <Badge className="bg-emerald-500 text-white">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Active
                        </Badge>
                        <span className="font-medium truncate">{campaign.name}</span>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                        <Mail className="h-3 w-3 inline mr-1" />
                        Subject: <span className="text-foreground">{campaign.subject || '(no subject)'}</span>
                    </p>
                </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={onEdit}>Edit Email</Button>
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

function InactiveAutoresponderRow({ campaign, onEdit }) {
    const { mutate: activate, isPending: activating } = useActivateAutoresponder();
    return (
        <div className="flex items-center justify-between gap-2 rounded border p-3 text-sm">
            <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{campaign.name}</p>
                <p className="text-xs text-muted-foreground truncate">{campaign.subject || '(no subject)'}</p>
            </div>
            <div className="flex gap-1 shrink-0">
                <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
                <Button
                    size="sm"
                    onClick={() => activate(campaign.id)}
                    disabled={activating}
                >
                    {activating ? 'Activating...' : 'Activate'}
                </Button>
            </div>
        </div>
    );
}

function AutoresponderEditor({ campaign, onClose }) {
    const isNew = !campaign;
    const [name, setName] = useState(campaign?.name || 'New Lead Acknowledgement');
    const [subject, setSubject] = useState(campaign?.subject || NEW_LEAD_DEFAULT.subject);
    const [htmlContent, setHtmlContent] = useState(campaign?.html_content || NEW_LEAD_DEFAULT.html_content);
    const [textContent, setTextContent] = useState(campaign?.text_content || NEW_LEAD_DEFAULT.text_content);
    const [fromName, setFromName] = useState(campaign?.from_name || '');
    const [fromEmail, setFromEmail] = useState(campaign?.from_email || '');
    const [testEmail, setTestEmail] = useState('');
    const [showPreview, setShowPreview] = useState(false);

    const { mutate: createCampaign, isPending: creating } = useCreateCampaign();
    const { mutate: updateCampaign, isPending: updating } = useUpdateCampaign();
    const { mutate: activate, isPending: activating } = useActivateAutoresponder();
    const { mutate: testSend, isPending: testing, data: testResult, error: testError, reset: resetTest } = useTestSendCampaign();

    const handleSaveDraft = () => {
        const payload = {
            name,
            type: 'autoresponder',
            trigger_event: 'new_lead',
            subject,
            html_content: htmlContent,
            text_content: textContent,
            from_name: fromName || null,
            from_email: fromEmail || null,
        };
        if (isNew) {
            createCampaign(payload, { onSuccess: () => onClose() });
        } else {
            updateCampaign({ id: campaign.id, ...payload }, { onSuccess: () => onClose() });
        }
    };

    const handleSaveAndActivate = () => {
        const payload = {
            name,
            type: 'autoresponder',
            trigger_event: 'new_lead',
            subject,
            html_content: htmlContent,
            text_content: textContent,
            from_name: fromName || null,
            from_email: fromEmail || null,
        };
        const onSave = (saved) => activate(saved.id, { onSuccess: () => onClose() });
        if (isNew) {
            createCampaign(payload, { onSuccess: onSave });
        } else {
            updateCampaign({ id: campaign.id, ...payload }, { onSuccess: onSave });
        }
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

    const previewHtml = htmlContent.replace(/\{\{\s*first_name\s*\}\}/g, 'John')
        .replace(/\{\{\s*name\s*\}\}/g, 'John Smith')
        .replace(/\{\{\s*phone\s*\}\}/g, '(817) 555-1234')
        .replace(/\{\{\s*email\s*\}\}/g, 'john@example.com');

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">
                    {isNew ? 'New autoresponder' : `Editing: ${campaign.name}`}
                </h3>
                <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
                <div>
                    <label className="block text-xs font-medium mb-1">Internal name</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                    <label className="block text-xs font-medium mb-1">Subject line</label>
                    <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
                <div>
                    <label className="block text-xs font-medium mb-1">
                        From name <span className="text-muted-foreground">(optional)</span>
                    </label>
                    <Input
                        value={fromName}
                        onChange={(e) => setFromName(e.target.value)}
                        placeholder="Uses default: HonestRoof.com"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium mb-1">
                        From email <span className="text-muted-foreground">(optional)</span>
                    </label>
                    <Input
                        type="email"
                        value={fromEmail}
                        onChange={(e) => setFromEmail(e.target.value)}
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
                    value={htmlContent}
                    onChange={(e) => setHtmlContent(e.target.value)}
                    rows={14}
                    className="w-full border rounded-md px-3 py-2 text-sm font-mono"
                />
            </div>

            <div>
                <label className="block text-xs font-medium mb-1">Plain text body (fallback)</label>
                <textarea
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
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
                            Subject: <strong className="text-foreground">{subject.replace(/\{\{\s*first_name\s*\}\}/g, 'John')}</strong>
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
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
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
