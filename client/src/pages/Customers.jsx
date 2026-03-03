import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCustomers, useUpdateSatisfaction } from '../hooks/useCustomers';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Star, Users, Phone, Mail, ExternalLink } from 'lucide-react';

function StarRating({ value, onChange, readonly }) {
    return (
        <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((star) => (
                <button
                    key={star}
                    type="button"
                    disabled={readonly}
                    onClick={() => onChange?.(star)}
                    className={`${readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110'} transition-transform`}
                >
                    <Star
                        className={`h-4 w-4 ${star <= (value || 0) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`}
                    />
                </button>
            ))}
        </div>
    );
}

export default function Customers() {
    const [filters, setFilters] = useState({});
    const { data: customers, isLoading } = useCustomers(filters);
    const { mutate: updateSatisfaction } = useUpdateSatisfaction();

    const [minSat, setMinSat] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [referralFilter, setReferralFilter] = useState('all');

    const applyFilters = () => {
        const f = {};
        if (minSat) f.minSatisfaction = minSat;
        if (dateFrom) f.completedAfter = dateFrom;
        if (dateTo) f.completedBefore = dateTo;
        if (referralFilter !== 'all') f.hasReferrals = referralFilter;
        setFilters(f);
    };

    const clearFilters = () => {
        setMinSat('');
        setDateFrom('');
        setDateTo('');
        setReferralFilter('all');
        setFilters({});
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Happy Customers</h1>
                    <p className="text-sm text-muted-foreground">Completed jobs — ready for reviews and referrals</p>
                </div>
                <Badge variant="secondary" className="text-sm">
                    <Users className="h-3.5 w-3.5 mr-1" />
                    {customers?.length || 0} customers
                </Badge>
            </div>

            {/* Filters */}
            <Card>
                <CardContent className="pt-4">
                    <div className="flex flex-wrap gap-3 items-end">
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Min Satisfaction</label>
                            <select
                                className="h-9 rounded-md border border-input bg-background px-3 text-sm w-28"
                                value={minSat}
                                onChange={(e) => setMinSat(e.target.value)}
                            >
                                <option value="">Any</option>
                                <option value="3">3+ Stars</option>
                                <option value="4">4+ Stars</option>
                                <option value="5">5 Stars</option>
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Completed After</label>
                            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Completed Before</label>
                            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Referrals</label>
                            <select
                                className="h-9 rounded-md border border-input bg-background px-3 text-sm w-36"
                                value={referralFilter}
                                onChange={(e) => setReferralFilter(e.target.value)}
                            >
                                <option value="all">All</option>
                                <option value="true">Has Referrals</option>
                                <option value="false">No Referrals</option>
                            </select>
                        </div>
                        <Button size="sm" onClick={applyFilters}>Filter</Button>
                        <Button size="sm" variant="ghost" onClick={clearFilters}>Clear</Button>
                    </div>
                </CardContent>
            </Card>

            {/* Customer List */}
            {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading customers...</div>
            ) : !customers?.length ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        No customers found. Complete some jobs first!
                    </CardContent>
                </Card>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b bg-muted/50">
                                <th className="text-left py-3 px-4 font-medium">Customer</th>
                                <th className="text-left py-3 px-4 font-medium hidden md:table-cell">Contact</th>
                                <th className="text-left py-3 px-4 font-medium">Status</th>
                                <th className="text-left py-3 px-4 font-medium hidden sm:table-cell">Status Date</th>
                                <th className="text-left py-3 px-4 font-medium hidden sm:table-cell">Job Value</th>
                                <th className="text-left py-3 px-4 font-medium">Satisfaction</th>
                                <th className="text-center py-3 px-4 font-medium hidden sm:table-cell">Referrals</th>
                                <th className="text-right py-3 px-4 font-medium"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {customers.map((customer) => (
                                <tr key={customer.id} className="border-b hover:bg-muted/30 transition-colors">
                                    <td className="py-3 px-4">
                                        <p className="font-medium">{customer.name}</p>
                                        <p className="text-xs text-muted-foreground">{customer.address}</p>
                                    </td>
                                    <td className="py-3 px-4 hidden md:table-cell">
                                        <div className="space-y-1">
                                            {customer.phone && (
                                                <div className="flex items-center gap-1 text-xs">
                                                    <Phone className="h-3 w-3" /> {customer.phone}
                                                </div>
                                            )}
                                            {customer.email && (
                                                <div className="flex items-center gap-1 text-xs">
                                                    <Mail className="h-3 w-3" /> {customer.email}
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="py-3 px-4">
                                        <Badge variant={customer.status === 'review_received' ? 'success' : customer.status === 'paid' ? 'info' : 'secondary'}>
                                            {customer.status.replace('_', ' ')}
                                        </Badge>
                                    </td>
                                    <td className="py-3 px-4 hidden sm:table-cell text-muted-foreground">
                                        {customer.completed_at ? new Date(customer.completed_at).toLocaleDateString() : '—'}
                                    </td>
                                    <td className="py-3 px-4 hidden sm:table-cell">
                                        ${(customer.actual_value || customer.estimated_value || 0).toLocaleString()}
                                    </td>
                                    <td className="py-3 px-4">
                                        <StarRating
                                            value={customer.satisfaction_score}
                                            onChange={(score) => updateSatisfaction({ id: customer.id, satisfaction_score: score })}
                                        />
                                    </td>
                                    <td className="py-3 px-4 text-center hidden sm:table-cell">
                                        <Badge variant="outline">{customer.referral_count || 0}</Badge>
                                    </td>
                                    <td className="py-3 px-4 text-right">
                                        <Link to={`/leads/${customer.id}`}>
                                            <Button variant="ghost" size="sm">
                                                <ExternalLink className="h-3.5 w-3.5" />
                                            </Button>
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
