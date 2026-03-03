import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
    LayoutDashboard,
    Users,
    Calendar,
    BarChart3,
    Settings,
    LogOut,
    Menu,
    X,
    Hammer,
    Heart,
    Gift,
    PieChart
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function Layout() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    const navItems = [
        { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
        { to: '/leads', icon: Users, label: 'Leads' },
        { to: '/customers', icon: Heart, label: 'Customers' },
        { to: '/referrals', icon: Gift, label: 'Referrals' },
        { to: '/attribution', icon: PieChart, label: 'Attribution' },
        { to: '/calendar', icon: Calendar, label: 'Calendar' },
        { to: '/reports', icon: BarChart3, label: 'Reports' },
    ];

    return (
        <div className="min-h-screen bg-gray-50 flex">
            {/* Mobile Sidebar Overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={cn(
                "fixed lg:static inset-y-0 left-0 z-50 w-64 bg-[#1e3a5f] text-white transition-transform duration-200 ease-in-out lg:translate-x-0 flex flex-col",
                sidebarOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                <div className="h-16 flex items-center px-6 border-b border-white/10">
                    <Hammer className="w-6 h-6 text-orange-500 mr-2" />
                    <span className="text-xl font-bold tracking-tight">RoofTrack</span>
                </div>

                <nav className="flex-1 px-3 py-6 space-y-1">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            onClick={() => setSidebarOpen(false)}
                            className={({ isActive }) => cn(
                                "flex items-center px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                                isActive
                                    ? "bg-white/10 text-white"
                                    : "text-gray-300 hover:bg-white/5 hover:text-white"
                            )}
                        >
                            <item.icon className="w-5 h-5 mr-3" />
                            {item.label}
                        </NavLink>
                    ))}
                </nav>

                <div className="p-4 border-t border-white/10">
                    <div className="flex items-center mb-4 px-2">
                        <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center text-sm font-bold mr-3">
                            {user?.name?.[0] || 'U'}
                        </div>
                        <div className="flex-1 truncate">
                            <p className="text-sm font-medium text-white">{user?.name}</p>
                            <p className="text-xs text-gray-400 capitalize">{user?.role}</p>
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        className="w-full justify-start text-gray-300 hover:text-white hover:bg-white/5 pl-2"
                        onClick={handleLogout}
                    >
                        <LogOut className="w-5 h-5 mr-3" />
                        Logout
                    </Button>
                </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Topbar (Mobile Only mostly) */}
                <header className="bg-white border-b h-16 flex items-center justify-between px-4 lg:hidden">
                    <div className="flex items-center">
                        <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
                            <Menu className="w-6 h-6" />
                        </Button>
                        <span className="ml-3 font-semibold text-gray-900">RoofTrack</span>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center text-white text-sm font-bold">
                        {user?.name?.[0] || 'U'}
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto p-4 lg:p-8">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
