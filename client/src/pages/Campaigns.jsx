import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
    useCampaigns,
    useCampaign,
    useCreateCampaign,
    useUpdateCampaign,
    useDeleteCampaign,
    useSendCampaign,
    useAddCampaignRecipients,
    useRecipientPreview,
    useCloneCampaign
} from '../hooks/useCampaigns';
import AutoresponderPanel from '../components/AutoresponderPanel';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Plus, Trash2, ArrowLeft, Send, Mail, Eye, Users, AlertTriangle, Copy
} from 'lucide-react';

const TEMPLATES = {
    referral: {
        subject: 'Know someone who needs a new roof? You get $100.',
        html_content: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
<h2 style="color: #1e3a5f;">Hey {{name}},</h2>
<p>Thank you for trusting HonestRoof with your roofing project! We hope you're loving your new roof.</p>
<p><strong>Know someone who needs roofing work?</strong> Refer them to us and you'll receive <strong>$100 cash</strong> when they complete their project.</p>
<p>Here's why your friends and family will love working with us:</p>
<ul>
<li>20-year warranty on all installations</li>
<li>Licensed & insured in Dallas/Fort Worth</li>
<li>Free inspections and honest assessments</li>
</ul>
<p>Just have them mention your name when they call, or reply to this email with their contact info.</p>
<p>Call us anytime: <strong>(817) 966-2863</strong></p>
<p>Thanks again,<br/><strong>Dennis Harrison</strong><br/>HonestRoof.com</p>
</div>`,
        text_content: `Hey {{name}},\n\nThank you for trusting HonestRoof! Know someone who needs roofing work? Refer them to us and get $100 cash when they complete their project.\n\nWhy they'll love us:\n- 20-year warranty\n- Licensed & insured in DFW\n- Free inspections\n\nHave them call (817) 966-2863 and mention your name.\n\nThanks,\nDennis Harrison\nHonestRoof.com`
    },
    review_request: {
        subject: 'How was your experience with HonestRoof?',
        html_content: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
<h2 style="color: #1e3a5f;">Hi {{name}},</h2>
<p>We recently completed your roofing project and we'd love to hear how it went!</p>
<p>Your feedback helps other homeowners in the DFW area find a roofing contractor they can trust.</p>
<p style="text-align: center; margin: 30px 0;">
<a href="https://g.page/r/honestroof/review" style="background-color: #1e3a5f; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold;">Leave a Google Review</a>
</p>
<p>It only takes a minute and means the world to us. Thank you!</p>
<p>Best,<br/><strong>Dennis Harrison</strong><br/>HonestRoof.com<br/>(817) 966-2863</p>
</div>`,
        text_content: `Hi {{name}},\n\nWe recently completed your roofing project and we'd love to hear how it went!\n\nPlease leave us a Google review: https://g.page/r/honestroof/review\n\nIt only takes a minute. Thank you!\n\nDennis Harrison\nHonestRoof.com\n(817) 966-2863`
    },
    promo: {
        subject: 'Special Offer from HonestRoof - 30% Off',
        html_content: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
<h2 style="color: #1e3a5f;">Hi {{name}},</h2>
<p>For a limited time, HonestRoof is offering <strong>30% off</strong> all roofing services for our valued customers and neighbors in the DFW area.</p>
<div style="background: #fff3cd; border: 1px solid #ffc107; padding: 16px; border-radius: 8px; margin: 20px 0; text-align: center;">
<h3 style="margin: 0 0 8px 0; color: #856404;">30% OFF All Roofing Services</h3>
<p style="margin: 0; color: #856404;">Repairs • Replacements • New Installations</p>
</div>
<p>Whether you need a repair, replacement, or new installation, now is the time to act. All work includes our <strong>20-year warranty</strong>.</p>
<p>Schedule your free inspection today:<br/><strong>(817) 966-2863</strong></p>
<p>Best,<br/><strong>Dennis Harrison</strong><br/>HonestRoof.com</p>
</div>`,
        text_content: `Hi {{name}},\n\nFor a limited time, HonestRoof is offering 30% off all roofing services!\n\nRepairs, replacements, new installations - all with our 20-year warranty.\n\nCall (817) 966-2863 for a free inspection.\n\nDennis Harrison\nHonestRoof.com`
    },
    custom: { subject: '', html_content: '', text_content: '' }
};

const STATUS_COLORS = {
    draft: 'bg-gray-100 text-gray-700',
    sending: 'bg-blue-100 text-blue-700',
    sent: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
};

const PIPELINE_STATUSES = ['new', 'contacted', 'quoted', 'accepted', 'scheduled', 'completed', 'paid', 'review_received'];

// --- Create Campaign Form ---
function CreateCampaignForm({ onClose, onCreated, prefill }) {
    const [name, setName] = useState(prefill?.name || '');
    const [type, setType] = useState(prefill?.type || 'custom');
    const [subject, setSubject] = useState(prefill?.subject || '');
    const [htmlContent, setHtmlContent] = useState('');
    const [textContent, setTextContent] = useState('');
    const { mutate: create, isPending } = useCreateCampaign();

    const handleTypeChange = (newType) => {
        setType(newType);
        const tpl = TEMPLATES[newType];
        if (tpl) {
            setSubject(tpl.subject);
            setHtmlContent(tpl.html_content);
            setTextContent(tpl.text_content);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        create({ name, type, subject, html_content: htmlContent, text_content: textContent }, {
            onSuccess: (data) => {
                onCreated?.(data);
                onClose();
            }
        });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Create Campaign</CardTitle>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Campaign Name</label>
                        <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Spring Referral Push" required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Type</label>
                        <select
                            value={type}
                            onChange={e => handleTypeChange(e.target.value)}
                            className="w-full border rounded-md px-3 py-2 text-sm"
                        >
                            <option value="referral">Referral Request</option>
                            <option value="review_request">Review Request</option>
                            <option value="promo">Promotional</option>
                            <option value="storm_response">Storm Response</option>
                            <option value="custom">Custom</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Subject Line</label>
                        <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">HTML Content</label>
                        <textarea
                            value={htmlContent}
                            onChange={e => setHtmlContent(e.target.value)}
                            rows={8}
                            className="w-full border rounded-md px-3 py-2 text-sm font-mono"
                            placeholder="HTML email body (supports {{name}} placeholder)"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Plain Text Content</label>
                        <textarea
                            value={textContent}
                            onChange={e => setTextContent(e.target.value)}
                            rows={4}
                            className="w-full border rounded-md px-3 py-2 text-sm"
                            placeholder="Plain text fallback"
                        />
                    </div>
                    <div className="flex gap-2 justify-end">
                        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
                        <Button type="submit" disabled={isPending}>
                            {isPending ? 'Creating...' : 'Create Campaign'}
                        </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}

// --- Add Recipients Modal ---
function AddRecipientsModal({ campaignId, onClose }) {
    const [filter, setFilter] = useState('all');
    const [statusValue, setStatusValue] = useState('completed');
    const [cityValue, setCityValue] = useState('');
    const [addedResult, setAddedResult] = useState(null);
    const { mutate: addRecipients, isPending } = useAddCampaignRecipients();
    const { data: preview, isLoading: previewLoading } = useRecipientPreview(campaignId, filter, statusValue, cityValue);

    const handleAdd = () => {
        addRecipients(
            { campaignId, filter, statusValue, cityValue },
            { onSuccess: (data) => setAddedResult(data) }
        );
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <Card className="w-full max-w-md max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <CardHeader className="pb-4">
                    <CardTitle className="text-lg">Add Recipients</CardTitle>
                    <p className="text-sm text-muted-foreground">Choose which leads to add to this campaign</p>
                </CardHeader>
                <CardContent className="overflow-y-auto space-y-5 pb-6">
                    {addedResult ? (
                        <div className="text-center py-4 space-y-3">
                            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100">
                                <Users className="h-6 w-6 text-green-600" />
                            </div>
                            <div>
                                <p className="font-medium text-lg">{addedResult.added} recipient{addedResult.added !== 1 ? 's' : ''} added</p>
                                <p className="text-sm text-muted-foreground">{addedResult.total} total recipients in campaign</p>
                            </div>
                            <Button onClick={onClose} className="mt-2">Done</Button>
                        </div>
                    ) : (
                        <>
                            <div>
                                <label className="block text-sm font-medium mb-2">Filter by</label>
                                <div className="space-y-2">
                                    <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent transition-colors">
                                        <input type="radio" name="filter" value="all" checked={filter === 'all'} onChange={e => setFilter(e.target.value)} className="accent-primary" />
                                        <div>
                                            <p className="text-sm font-medium">All customers</p>
                                            <p className="text-xs text-muted-foreground">Every lead with an email address</p>
                                        </div>
                                    </label>
                                    <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent transition-colors">
                                        <input type="radio" name="filter" value="status" checked={filter === 'status'} onChange={e => setFilter(e.target.value)} className="accent-primary" />
                                        <div>
                                            <p className="text-sm font-medium">By status</p>
                                            <p className="text-xs text-muted-foreground">Filter by pipeline stage</p>
                                        </div>
                                    </label>
                                    <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent transition-colors">
                                        <input type="radio" name="filter" value="city" checked={filter === 'city'} onChange={e => setFilter(e.target.value)} className="accent-primary" />
                                        <div>
                                            <p className="text-sm font-medium">By city</p>
                                            <p className="text-xs text-muted-foreground">Target a specific area</p>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            {filter === 'status' && (
                                <div>
                                    <label className="block text-sm font-medium mb-1">Status</label>
                                    <select
                                        value={statusValue}
                                        onChange={e => setStatusValue(e.target.value)}
                                        className="w-full border rounded-md px-3 py-2 text-sm"
                                    >
                                        {PIPELINE_STATUSES.map(s => (
                                            <option key={s} value={s}>{s.replace('_', ' ')}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {filter === 'city' && (
                                <div>
                                    <label className="block text-sm font-medium mb-1">City</label>
                                    <Input value={cityValue} onChange={e => setCityValue(e.target.value)} placeholder="e.g. Irving" />
                                </div>
                            )}

                            {preview && !previewLoading && (
                                <div className="rounded-lg bg-muted/50 border p-3 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Matching leads</span>
                                        <span className="font-medium">{preview.matching}</span>
                                    </div>
                                    {preview.alreadyAdded > 0 && (
                                        <div className="flex justify-between mt-1">
                                            <span className="text-muted-foreground">Already in campaign</span>
                                            <span className="font-medium">{preview.alreadyAdded}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between mt-1 pt-1 border-t">
                                        <span className="font-medium">New recipients to add</span>
                                        <span className="font-bold">{preview.newRecipients}</span>
                                    </div>
                                </div>
                            )}
                            {previewLoading && (
                                <p className="text-sm text-muted-foreground text-center py-2">Counting matches...</p>
                            )}

                            <div className="flex gap-2 justify-end pt-2">
                                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                                <Button onClick={handleAdd} disabled={isPending || (preview && preview.newRecipients === 0)}>
                                    {isPending ? 'Adding...' : 'Add Recipients'}
                                </Button>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

// --- Email Preview Modal ---
function PreviewModal({ campaign, onClose }) {
    const previewHtml = (campaign.html_content || '').replace(/\{\{name\}\}/g, 'John Smith');

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <Card className="w-full max-w-2xl max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
                <CardHeader>
                    <CardTitle className="text-lg">Email Preview</CardTitle>
                    <p className="text-sm text-muted-foreground">Subject: {(campaign.subject || '').replace(/\{\{name\}\}/g, 'John Smith')}</p>
                </CardHeader>
                <CardContent>
                    <div className="border rounded-md p-4" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                    <div className="mt-4 flex justify-end">
                        <Button variant="ghost" onClick={onClose}>Close</Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

// --- Send Confirmation Dialog ---
function SendConfirmDialog({ recipientCount, onConfirm, onCancel, isPending }) {
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
            <Card className="w-full max-w-sm" onClick={e => e.stopPropagation()}>
                <CardContent className="pt-6 space-y-4">
                    <div className="flex items-center gap-3">
                        <AlertTriangle className="h-6 w-6 text-red-500 shrink-0" />
                        <div>
                            <p className="font-medium">Send this campaign?</p>
                            <p className="text-sm text-muted-foreground">
                                This will send emails to <strong>{recipientCount}</strong> recipient{recipientCount !== 1 ? 's' : ''}. This action cannot be undone.
                            </p>
                        </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
                        <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
                            {isPending ? 'Sending...' : 'Send Campaign'}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

// --- Campaign Detail View ---
function CampaignDetail({ id }) {
    const navigate = useNavigate();
    const { data: campaign, isLoading } = useCampaign(id);
    const { mutate: sendCampaign, isPending: isSending } = useSendCampaign();
    const { mutate: cloneCampaign, isPending: isCloning } = useCloneCampaign();
    const [showRecipientModal, setShowRecipientModal] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [showSendConfirm, setShowSendConfirm] = useState(false);

    if (isLoading) return <div className="text-center py-8">Loading...</div>;
    if (!campaign) return <div className="text-center py-8 text-muted-foreground">Campaign not found</div>;

    const isDraft = campaign.status === 'draft';
    const recipientCount = campaign.recipients?.length || 0;

    const handleSend = () => {
        sendCampaign(id, {
            onSuccess: () => setShowSendConfirm(false)
        });
    };

    const handleClone = () => {
        cloneCampaign(id, {
            onSuccess: (cloned) => navigate(`/campaigns/${cloned.id}`)
        });
    };

    const recipientStatusIcon = (status) => {
        switch (status) {
            case 'sent': return <span className="text-green-500">&#10003;</span>;
            case 'failed': return <span className="text-red-500">&#10007;</span>;
            case 'opened': return <span className="text-blue-500">&#9679;</span>;
            default: return <span className="text-gray-400">&#8226;</span>;
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate('/campaigns')}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
                    <p className="text-sm text-muted-foreground capitalize">{campaign.type?.replace('_', ' ')} campaign</p>
                </div>
                <Badge className={STATUS_COLORS[campaign.status]}>{campaign.status}</Badge>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardContent className="pt-6">
                        <p className="text-sm text-muted-foreground">Recipients</p>
                        <p className="text-2xl font-bold">{campaign.total_recipients}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <p className="text-sm text-muted-foreground">Sent</p>
                        <p className="text-2xl font-bold text-green-600">{campaign.sent_count}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <p className="text-sm text-muted-foreground">Failed</p>
                        <p className="text-2xl font-bold text-red-600">{campaign.failed_count}</p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Email Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    <p><span className="font-medium">Subject:</span> {campaign.subject}</p>
                    {campaign.sent_at && (
                        <p><span className="font-medium">Sent at:</span> {new Date(campaign.sent_at).toLocaleString()}</p>
                    )}
                </CardContent>
            </Card>

            <div className="flex gap-2 flex-wrap">
                {isDraft && (
                    <Button variant="outline" onClick={() => setShowRecipientModal(true)}>
                        <Users className="h-4 w-4 mr-2" /> Add Recipients
                    </Button>
                )}
                <Button variant="outline" onClick={() => setShowPreview(true)}>
                    <Eye className="h-4 w-4 mr-2" /> Preview Email
                </Button>
                {isDraft && recipientCount > 0 && (
                    <Button variant="destructive" onClick={() => setShowSendConfirm(true)}>
                        <Send className="h-4 w-4 mr-2" /> Send Campaign
                    </Button>
                )}
                <Button variant="outline" onClick={handleClone} disabled={isCloning}>
                    <Copy className="h-4 w-4 mr-2" /> {isCloning ? 'Cloning...' : 'Clone'}
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Recipients ({recipientCount})</CardTitle>
                </CardHeader>
                <CardContent>
                    {recipientCount === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">No recipients added yet.</p>
                    ) : (
                        <div className="divide-y max-h-96 overflow-auto">
                            {campaign.recipients.map(r => (
                                <div key={r.id} className="py-2 flex items-center justify-between text-sm">
                                    <div className="flex items-center gap-2">
                                        {recipientStatusIcon(r.status)}
                                        <span className="font-medium">{r.name || 'Unknown'}</span>
                                        <span className="text-muted-foreground">{r.email}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-xs capitalize">{r.status}</Badge>
                                        {r.error_message && (
                                            <span className="text-xs text-red-500 max-w-48 truncate" title={r.error_message}>
                                                {r.error_message}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {showRecipientModal && (
                <AddRecipientsModal campaignId={id} onClose={() => setShowRecipientModal(false)} />
            )}
            {showPreview && (
                <PreviewModal campaign={campaign} onClose={() => setShowPreview(false)} />
            )}
            {showSendConfirm && (
                <SendConfirmDialog
                    recipientCount={recipientCount}
                    onConfirm={handleSend}
                    onCancel={() => setShowSendConfirm(false)}
                    isPending={isSending}
                />
            )}
        </div>
    );
}

// --- Campaign List View ---
function CampaignList() {
    const { data: campaigns, isLoading } = useCampaigns();
    const { mutate: deleteCampaign } = useDeleteCampaign();
    const location = useLocation();
    const prefill = location.state?.prefill || null;
    const [showCreate, setShowCreate] = useState(!!prefill);
    const navigate = useNavigate();

    // Clear location state after consuming prefill
    useEffect(() => {
        if (prefill) {
            window.history.replaceState({}, document.title);
        }
    }, [prefill]);

    if (isLoading) return <div className="text-center py-8">Loading...</div>;

    // Autoresponder campaigns render in their own dedicated panel; hide them
    // from the one-shot manual-campaign list below to avoid duplication.
    const manualCampaigns = (campaigns || []).filter((c) => !c.trigger_event);

    return (
        <div className="space-y-6">
            <AutoresponderPanel />

            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
                    <p className="text-sm text-muted-foreground">Create and send email campaigns to customers</p>
                </div>
                <Button onClick={() => setShowCreate(true)}>
                    <Plus className="h-4 w-4 mr-2" /> New Campaign
                </Button>
            </div>

            {showCreate && (
                <CreateCampaignForm
                    onClose={() => setShowCreate(false)}
                    onCreated={(campaign) => campaign?.id && navigate(`/campaigns/${campaign.id}`)}
                    prefill={prefill}
                />
            )}

            {!manualCampaigns?.length ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        <Mail className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <p>No campaigns yet. Create one to get started.</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {manualCampaigns.map(campaign => (
                        <Card
                            key={campaign.id}
                            className="cursor-pointer hover:shadow-md transition-shadow"
                            onClick={() => navigate(`/campaigns/${campaign.id}`)}
                        >
                            <CardContent className="py-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <p className="font-medium truncate">{campaign.name}</p>
                                            <Badge className={STATUS_COLORS[campaign.status]}>{campaign.status}</Badge>
                                            <Badge variant="outline" className="capitalize text-xs">
                                                {campaign.type?.replace('_', ' ')}
                                            </Badge>
                                        </div>
                                        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                                            <span>{campaign.recipient_count || campaign.total_recipients || 0} recipients</span>
                                            {campaign.sent_count > 0 && <span>{campaign.sent_count} sent</span>}
                                            <span>{new Date(campaign.created_at).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                    {campaign.status === 'draft' && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (confirm('Delete this campaign?')) {
                                                    deleteCampaign(campaign.id);
                                                }
                                            }}
                                        >
                                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}

// --- Main Component ---
export default function Campaigns() {
    const { id } = useParams();

    if (id) return <CampaignDetail id={id} />;
    return <CampaignList />;
}
