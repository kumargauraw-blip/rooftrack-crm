import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
    useReferralCampaigns, useReferralCampaign, useCreateCampaign,
    useSendCampaign, useAddRecipients, useRemoveRecipient,
    useReferralIncentives, useUpdateIncentive
} from '../hooks/useReferrals';
import { useCustomers } from '../hooks/useCustomers';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Gift, Send, Plus, Trash2, ArrowLeft, CheckCircle, Clock, DollarSign } from 'lucide-react';

function CampaignList() {
    const { data: campaigns, isLoading } = useReferralCampaigns();
    const { data: incentives } = useReferralIncentives();
    const { mutate: updateIncentive } = useUpdateIncentive();
    const [showCreate, setShowCreate] = useState(false);
    const navigate = useNavigate();

    if (isLoading) return <div className="text-center py-8 text-muted-foreground">Loading...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Referral Campaigns</h1>
                    <p className="text-sm text-muted-foreground">Ask happy customers to refer friends and family</p>
                </div>
                <Button onClick={() => setShowCreate(true)}>
                    <Plus className="h-4 w-4 mr-2" /> Create Campaign
                </Button>
            </div>

            {showCreate && <CreateCampaignForm onClose={() => setShowCreate(false)} />}

            {/* Campaigns List */}
            <div className="space-y-3">
                {!campaigns?.length ? (
                    <Card>
                        <CardContent className="py-12 text-center text-muted-foreground">
                            No campaigns yet. Create your first referral campaign!
                        </CardContent>
                    </Card>
                ) : campaigns.map((campaign) => (
                    <Card key={campaign.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/referrals/${campaign.id}`)}>
                        <CardContent className="py-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <Gift className="h-5 w-5 text-orange-500" />
                                    <div>
                                        <p className="font-medium">{campaign.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {campaign.recipient_count} recipients
                                            {campaign.responded_count > 0 && ` · ${campaign.responded_count} responded`}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {campaign.incentive_value && (
                                        <Badge variant="outline">${campaign.incentive_value} {campaign.incentive_type}</Badge>
                                    )}
                                    <Badge variant={campaign.status === 'sent' ? 'success' : campaign.status === 'completed' ? 'info' : 'secondary'}>
                                        {campaign.status}
                                    </Badge>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Incentives Section */}
            {incentives?.length > 0 && (
                <div className="space-y-3">
                    <h2 className="text-lg font-semibold">Referral Incentives</h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/50">
                                    <th className="text-left py-3 px-4 font-medium">Referrer</th>
                                    <th className="text-left py-3 px-4 font-medium">Referred Lead</th>
                                    <th className="text-left py-3 px-4 font-medium hidden sm:table-cell">Type</th>
                                    <th className="text-left py-3 px-4 font-medium">Value</th>
                                    <th className="text-left py-3 px-4 font-medium">Status</th>
                                    <th className="text-right py-3 px-4 font-medium">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {incentives.map((inc) => (
                                    <tr key={inc.id} className="border-b">
                                        <td className="py-3 px-4 font-medium">{inc.referrer_name}</td>
                                        <td className="py-3 px-4">{inc.referred_name}</td>
                                        <td className="py-3 px-4 hidden sm:table-cell">{inc.incentive_type || '-'}</td>
                                        <td className="py-3 px-4">${inc.incentive_value || 0}</td>
                                        <td className="py-3 px-4">
                                            <Badge variant={inc.status === 'paid' ? 'success' : inc.status === 'approved' ? 'info' : 'secondary'}>
                                                {inc.status}
                                            </Badge>
                                        </td>
                                        <td className="py-3 px-4 text-right">
                                            {inc.status === 'pending' && (
                                                <Button size="sm" variant="outline" onClick={() => updateIncentive({ id: inc.id, status: 'approved' })}>
                                                    <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                                                </Button>
                                            )}
                                            {inc.status === 'approved' && (
                                                <Button size="sm" variant="outline" onClick={() => updateIncentive({ id: inc.id, status: 'paid' })}>
                                                    <DollarSign className="h-3.5 w-3.5 mr-1" /> Mark Paid
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

function CreateCampaignForm({ onClose }) {
    const { mutate: createCampaign, isPending } = useCreateCampaign();
    const [name, setName] = useState('');
    const [messageTemplate, setMessageTemplate] = useState('Hi {name}! Thanks for choosing HonestRoof. If you know anyone who needs roofing help, we\'d love a referral!');
    const [incentiveType, setIncentiveType] = useState('gift_card');
    const [incentiveValue, setIncentiveValue] = useState('50');

    const handleSubmit = (e) => {
        e.preventDefault();
        createCampaign({
            name,
            message_template: messageTemplate,
            incentive_type: incentiveType,
            incentive_value: Number(incentiveValue),
        }, {
            onSuccess: () => onClose(),
        });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Create Campaign</CardTitle>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-1">
                        <label className="text-sm font-medium">Campaign Name</label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Spring 2026 Referral Drive" required />
                    </div>
                    <div className="space-y-1">
                        <label className="text-sm font-medium">Message Template</label>
                        <textarea
                            className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            value={messageTemplate}
                            onChange={(e) => setMessageTemplate(e.target.value)}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Incentive Type</label>
                            <select
                                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                                value={incentiveType}
                                onChange={(e) => setIncentiveType(e.target.value)}
                            >
                                <option value="gift_card">Gift Card</option>
                                <option value="discount">Discount</option>
                                <option value="cash">Cash</option>
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Incentive Value ($)</label>
                            <Input type="number" value={incentiveValue} onChange={(e) => setIncentiveValue(e.target.value)} min="0" step="5" />
                        </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
                        <Button type="submit" disabled={isPending || !name}>
                            {isPending ? 'Creating...' : 'Create Campaign'}
                        </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}

function CampaignDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { data: campaign, isLoading } = useReferralCampaign(id);
    const { data: customers } = useCustomers({ minSatisfaction: '3' });
    const { mutate: sendCampaign, isPending: isSending } = useSendCampaign();
    const { mutate: addRecipients, isPending: isAdding } = useAddRecipients();
    const { mutate: removeRecipient } = useRemoveRecipient();
    const [selectedCustomers, setSelectedCustomers] = useState([]);
    const [showSelector, setShowSelector] = useState(false);

    if (isLoading) return <div className="text-center py-8 text-muted-foreground">Loading...</div>;
    if (!campaign) return <div className="p-8">Campaign not found</div>;

    const recipientIds = new Set(campaign.recipients?.map(r => r.customer_lead_id));
    const availableCustomers = customers?.filter(c => !recipientIds.has(c.id)) || [];

    const handleAddRecipients = () => {
        if (selectedCustomers.length === 0) return;
        addRecipients({ campaignId: id, leadIds: selectedCustomers }, {
            onSuccess: () => {
                setSelectedCustomers([]);
                setShowSelector(false);
            }
        });
    };

    const toggleCustomer = (customerId) => {
        setSelectedCustomers(prev =>
            prev.includes(customerId) ? prev.filter(id => id !== customerId) : [...prev, customerId]
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate('/referrals')}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
                    <div className="flex gap-2 items-center text-sm text-muted-foreground">
                        <Badge variant={campaign.status === 'sent' ? 'success' : 'secondary'}>{campaign.status}</Badge>
                        {campaign.incentive_value && (
                            <span>${campaign.incentive_value} {campaign.incentive_type}</span>
                        )}
                    </div>
                </div>
                {campaign.status === 'draft' && campaign.recipients?.length > 0 && (
                    <Button onClick={() => sendCampaign(id)} disabled={isSending}>
                        <Send className="h-4 w-4 mr-2" />
                        {isSending ? 'Sending...' : 'Send Campaign'}
                    </Button>
                )}
            </div>

            {/* Message Template */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Message Template</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm whitespace-pre-wrap bg-muted/30 p-3 rounded">{campaign.message_template || 'No message template set.'}</p>
                </CardContent>
            </Card>

            {/* Recipients */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-lg">Recipients ({campaign.recipients?.length || 0})</CardTitle>
                    {campaign.status === 'draft' && (
                        <Button size="sm" variant="outline" onClick={() => setShowSelector(!showSelector)}>
                            <Plus className="h-3.5 w-3.5 mr-1" /> Add Customers
                        </Button>
                    )}
                </CardHeader>
                <CardContent>
                    {/* Customer Selector */}
                    {showSelector && (
                        <div className="mb-4 border rounded-lg p-3 bg-muted/20 space-y-3">
                            <p className="text-sm font-medium">Select customers (3+ star satisfaction)</p>
                            <div className="max-h-48 overflow-y-auto space-y-1">
                                {availableCustomers.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">No eligible customers available.</p>
                                ) : availableCustomers.map((c) => (
                                    <label key={c.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/30 cursor-pointer text-sm">
                                        <input
                                            type="checkbox"
                                            checked={selectedCustomers.includes(c.id)}
                                            onChange={() => toggleCustomer(c.id)}
                                            className="rounded"
                                        />
                                        <span className="font-medium">{c.name}</span>
                                        <span className="text-xs text-muted-foreground">— {c.phone}</span>
                                    </label>
                                ))}
                            </div>
                            <div className="flex gap-2 justify-end">
                                <Button size="sm" variant="ghost" onClick={() => { setShowSelector(false); setSelectedCustomers([]); }}>Cancel</Button>
                                <Button size="sm" onClick={handleAddRecipients} disabled={isAdding || selectedCustomers.length === 0}>
                                    {isAdding ? 'Adding...' : `Add ${selectedCustomers.length} Customer${selectedCustomers.length !== 1 ? 's' : ''}`}
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Recipients Table */}
                    {!campaign.recipients?.length ? (
                        <p className="text-sm text-muted-foreground">No recipients added yet.</p>
                    ) : (
                        <div className="space-y-2">
                            {campaign.recipients.map((r) => (
                                <div key={r.id} className="flex items-center justify-between py-2 px-3 rounded border">
                                    <div>
                                        <p className="font-medium text-sm">{r.customer_name}</p>
                                        <p className="text-xs text-muted-foreground">{r.customer_phone} · {r.customer_email}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {r.sent_at && <Badge variant="success" className="text-xs"><Clock className="h-3 w-3 mr-1" />Sent</Badge>}
                                        {r.responded ? <Badge variant="info" className="text-xs"><CheckCircle className="h-3 w-3 mr-1" />Responded</Badge> : null}
                                        {campaign.status === 'draft' && (
                                            <Button size="sm" variant="ghost" onClick={() => removeRecipient({ campaignId: id, recipientId: r.id })}>
                                                <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

export default function ReferralCampaigns() {
    const { id } = useParams();
    return id ? <CampaignDetail /> : <CampaignList />;
}
