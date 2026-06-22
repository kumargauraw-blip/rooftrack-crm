import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, KeyRound, UserPlus, Users as UsersIcon, RefreshCw } from 'lucide-react';

function Field({ label, ...props }) {
    return (
        <div className="space-y-2">
            <label className="text-sm font-medium leading-none">{label}</label>
            <Input {...props} />
        </div>
    );
}

function Notice({ kind, children }) {
    if (!children) return null;
    const isErr = kind === 'error';
    return (
        <div className={`flex items-center text-sm ${isErr ? 'text-red-600' : 'text-green-600'}`}>
            {isErr ? <AlertCircle className="w-4 h-4 mr-2 shrink-0" /> : <CheckCircle2 className="w-4 h-4 mr-2 shrink-0" />}
            {children}
        </div>
    );
}

function ChangePasswordCard() {
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setError(''); setSuccess('');

        if (!current || !next) return setError('Please fill in all fields');
        if (next.length < 8) return setError('New password must be at least 8 characters');
        if (next !== confirm) return setError('New password and confirmation do not match');

        setBusy(true);
        try {
            await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
            setSuccess('Password changed successfully.');
            setCurrent(''); setNext(''); setConfirm('');
        } catch (err) {
            setError(err.response?.data?.error || 'Could not change password');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                    <KeyRound className="w-5 h-5 text-primary" /> Change Your Password
                </CardTitle>
                <CardDescription>Update the password for your own account.</CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={submit} noValidate className="space-y-4 max-w-md">
                    <Field label="Current password" type="password" autoComplete="current-password"
                        value={current} onChange={(e) => setCurrent(e.target.value)} />
                    <Field label="New password" type="password" autoComplete="new-password"
                        value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 8 characters" />
                    <Field label="Confirm new password" type="password" autoComplete="new-password"
                        value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                    <Notice kind="error">{error}</Notice>
                    <Notice kind="success">{success}</Notice>
                    <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Update Password'}</Button>
                </form>
            </CardContent>
        </Card>
    );
}

function AddUserForm({ onCreated }) {
    const [form, setForm] = useState({ name: '', username: '', password: '', role: 'user' });
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [busy, setBusy] = useState(false);
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const submit = async (e) => {
        e.preventDefault();
        setError(''); setSuccess('');
        if (!form.name || !form.username || !form.password) return setError('Name, username, and password are required');
        if (form.password.length < 8) return setError('Password must be at least 8 characters');

        setBusy(true);
        try {
            const { data } = await api.post('/users', form);
            setSuccess(`User "${data.data.username}" created.`);
            setForm({ name: '', username: '', password: '', role: 'user' });
            onCreated?.();
        } catch (err) {
            setError(err.response?.data?.error || 'Could not create user');
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} noValidate className="space-y-4 max-w-md">
            <Field label="Full name" value={form.name} onChange={set('name')} placeholder="Jane Doe" />
            <Field label="Username" value={form.username} onChange={set('username')} placeholder="jane" autoComplete="off" />
            <Field label="Temporary password" type="text" value={form.password} onChange={set('password')} placeholder="At least 8 characters" autoComplete="off" />
            <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Role</label>
                <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={form.role}
                    onChange={set('role')}
                >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                </select>
            </div>
            <Notice kind="error">{error}</Notice>
            <Notice kind="success">{success}</Notice>
            <Button type="submit" disabled={busy}>
                <UserPlus className="w-4 h-4 mr-2" />{busy ? 'Creating…' : 'Create User'}
            </Button>
        </form>
    );
}

function ResetPasswordRow({ user, currentUserId }) {
    const [value, setValue] = useState('');
    const [open, setOpen] = useState(false);
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        setMsg('');
        if (value.length < 8) { setMsg('Min 8 characters'); return; }
        setBusy(true);
        try {
            await api.post(`/users/${user.id}/reset-password`, { newPassword: value });
            setMsg('Password reset ✓');
            setValue(''); setOpen(false);
        } catch (err) {
            setMsg(err.response?.data?.error || 'Failed');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex flex-col gap-2 py-3 border-b last:border-b-0">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <span className="font-medium text-gray-900">{user.name}</span>
                    <span className="text-gray-500 text-sm ml-2">@{user.username}</span>
                    {user.id === currentUserId && <span className="text-xs text-gray-400 ml-2">(you)</span>}
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant={user.role === 'admin' ? 'default' : 'secondary'} className="capitalize">{user.role}</Badge>
                    <Button variant="outline" size="sm" onClick={() => { setOpen((o) => !o); setMsg(''); }}>
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Reset password
                    </Button>
                </div>
            </div>
            {open && (
                <div className="flex items-center gap-2 flex-wrap">
                    <Input
                        type="text"
                        className="max-w-xs"
                        placeholder="New password (min 8 chars)"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        autoComplete="off"
                    />
                    <Button size="sm" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setValue(''); setMsg(''); }}>Cancel</Button>
                </div>
            )}
            {msg && <span className="text-xs text-gray-600">{msg}</span>}
        </div>
    );
}

function UsersCard({ currentUserId }) {
    const [users, setUsers] = useState([]);
    const [loadError, setLoadError] = useState('');
    const [loading, setLoading] = useState(true);

    const load = async () => {
        setLoading(true); setLoadError('');
        try {
            const { data } = await api.get('/users');
            setUsers(data.data || []);
        } catch (err) {
            setLoadError(err.response?.data?.error || 'Could not load users');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                    <UsersIcon className="w-5 h-5 text-primary" /> Team Members
                </CardTitle>
                <CardDescription>Create accounts and reset passwords. Admin only.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
                <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Existing users</h3>
                    {loading && <p className="text-sm text-gray-500">Loading…</p>}
                    <Notice kind="error">{loadError}</Notice>
                    {!loading && !loadError && (
                        <div className="rounded-md border px-4">
                            {users.map((u) => (
                                <ResetPasswordRow key={u.id} user={u} currentUserId={currentUserId} />
                            ))}
                        </div>
                    )}
                </div>
                <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Add a new user</h3>
                    <AddUserForm onCreated={load} />
                </div>
            </CardContent>
        </Card>
    );
}

export default function Settings() {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';

    return (
        <div className="space-y-6 max-w-3xl">
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
                <p className="text-gray-500">Manage your account{isAdmin ? ' and team members' : ''}.</p>
            </div>
            <ChangePasswordCard />
            {isAdmin && <UsersCard currentUserId={user?.id} />}
        </div>
    );
}
