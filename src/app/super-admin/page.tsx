'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, SUPER_ADMIN_EMAIL } from '@/lib/supabase';
import type { Institution, Room, Judge, Event, Score } from '@/types';
import Footer from '@/components/Footer';

interface Toast { id: number; msg: string; type: 'success' | 'error' | 'info'; }
interface EventWithScores extends Event { scores: Score[]; }
interface RoomWithDetails extends Room { judges: Judge[]; events: EventWithScores[]; }
let _tid = 0;

export default function SuperAdminPage() {
    const router = useRouter();
    const [authReady, setAuthReady] = useState(false);
    const [userEmail, setUserEmail] = useState('');
    const [institutions, setInstitutions] = useState<Institution[]>([]);
    const [loading, setLoading] = useState(true);
    const [toasts, setToasts] = useState<Toast[]>([]);
    
    // Form state for new institution
    const [newName, setNewName] = useState('');
    const [newEmail, setNewEmail] = useState('');
    const [creating, setCreating] = useState(false);

    // Expand institution to see full details (rooms, judges, events, scores)
    const [expandedInstId, setExpandedInstId] = useState<string | null>(null);
    const [instDetails, setInstDetails] = useState<Record<string, RoomWithDetails[]>>({});
    const [loadingDetailsId, setLoadingDetailsId] = useState<string | null>(null);

    const showToast = useCallback((msg: string, type: Toast['type'] = 'info') => {
        const id = ++_tid;
        setToasts((p) => [...p, { id, msg, type }]);
        setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500);
    }, []);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user?.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
                setUserEmail(session.user.email);
                setAuthReady(true);
                return;
            }
            router.replace('/');
        });
    }, [router]);

    const loadInstitutions = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('institutions')
                .select('*')
                .order('created_at', { ascending: false });
            if (error) throw error;
            setInstitutions(data || []);
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed to load institutions', 'error');
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        if (authReady) loadInstitutions();
    }, [authReady, loadInstitutions]);

    const loadInstDetails = useCallback(async (instId: string) => {
        if (instDetails[instId]) {
            setExpandedInstId((id) => (id === instId ? null : instId));
            return;
        }
        setLoadingDetailsId(instId);
        try {
            const { data: rawRooms, error: rErr } = await supabase
                .from('rooms')
                .select('*')
                .eq('institution_id', instId)
                .order('created_at', { ascending: false });
            if (rErr) throw rErr;
            if (!rawRooms?.length) {
                setInstDetails((d) => ({ ...d, [instId]: [] }));
                setExpandedInstId(instId);
                setLoadingDetailsId(null);
                return;
            }
            const roomIds = (rawRooms as Room[]).map((r) => r.id);
            const [judgesRes, eventsRes] = await Promise.all([
                supabase.from('judges').select('*').in('room_id', roomIds),
                supabase.from('events')
                    .select('*')
                    .in('room_id', roomIds)
                    .eq('institution_id', instId)
                    .order('created_at', { ascending: false }),
            ]);
            const allJudges = (judgesRes.data as Judge[]) || [];
            const allEvents = (eventsRes.data as Event[]) || [];
            let allScores: Score[] = [];
            if (allEvents.length > 0) {
                const eventIds = allEvents.map((e) => e.id);
                const { data: sd } = await supabase
                    .from('scores')
                    .select('*')
                    .in('event_id', eventIds)
                    .eq('institution_id', instId)
                    .order('created_at', { ascending: true });
                allScores = (sd as Score[]) || [];
            }
            const roomsWithDetails: RoomWithDetails[] = (rawRooms as Room[]).map((room) => ({
                ...room,
                judges: allJudges.filter((j) => j.room_id === room.id),
                events: allEvents.filter((e) => e.room_id === room.id).map((ev) => ({
                    ...ev,
                    scores: allScores.filter((s) => s.event_id === ev.id),
                })),
            }));
            setInstDetails((d) => ({ ...d, [instId]: roomsWithDetails }));
            setExpandedInstId(instId);
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed to load institution details', 'error');
        } finally {
            setLoadingDetailsId(null);
        }
    }, [instDetails, showToast]);

    const handleCreateInstitution = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newName.trim() || !newEmail.trim()) return;
        setCreating(true);
        try {
            const { error } = await supabase
                .from('institutions')
                .insert({ name: newName.trim(), admin_email: newEmail.trim().toLowerCase() });
            if (error) throw error;
            showToast('Institution created successfully!', 'success');
            setNewName('');
            setNewEmail('');
            loadInstitutions();
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed to create institution', 'error');
        } finally {
            setCreating(false);
        }
    };

    const toggleStatus = async (id: string, currentStatus: boolean) => {
        try {
            const { error } = await supabase
                .from('institutions')
                .update({ is_active: !currentStatus })
                .eq('id', id);
            if (error) throw error;
            showToast(`Institution ${currentStatus ? 'deactivated' : 'activated'}`, 'success');
            loadInstitutions();
        } catch (err) {
            showToast('Failed to update status', 'error');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this institution? All its data will be lost.')) return;
        try {
            const { error } = await supabase
                .from('institutions')
                .delete()
                .eq('id', id);
            if (error) throw error;
            showToast('Institution deleted', 'success');
            loadInstitutions();
        } catch (err) {
            showToast('Failed to delete institution', 'error');
        }
    };

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        router.replace('/');
    };

    if (!authReady || loading) {
        return (
            <div className="loading-screen">
                <div className="spinner" />
                <p>Loading Super Admin Dashboard…</p>
            </div>
        );
    }

    return (
        <div className="page-layout no-sidebar">
            <main className="main-content" style={{ marginLeft: 0 }}>
                <header className="main-header">
                    <div className="flex items-c gap-3">
                        <div className="sidebar-logo-icon" style={{ background: 'white', padding: 4 }}>
                            <img src="/logo/logo.png" alt="MiladOne Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        </div>
                        <div>
                            <h3 style={{ fontSize: '1rem', fontWeight: 800 }}>Super Admin</h3>
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{userEmail}</p>
                        </div>
                    </div>
                    <div className="flex items-c gap-3">
                        <span className="badge badge-purple">SUPER ADMIN</span>
                        <button onClick={handleSignOut} className="btn btn-secondary btn-sm">Sign Out</button>
                    </div>
                </header>

                <div className="main-body">
                    <div className="grid-2" style={{ marginBottom: 32 }}>
                        {/* Create Institution Card */}
                        <div className="card">
                            <div className="card-header">
                                <h3>Add New Institution</h3>
                            </div>
                            <div className="card-body">
                                <form onSubmit={handleCreateInstitution} className="flex flex-col gap-4">
                                    <div className="form-group">
                                        <label className="form-label">Institution Name</label>
                                        <input 
                                            type="text" 
                                            className="input" 
                                            placeholder="e.g. Harvard University"
                                            value={newName}
                                            onChange={(e) => setNewName(e.target.value)}
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Admin Email</label>
                                        <input 
                                            type="email" 
                                            className="input" 
                                            placeholder="admin@institution.com"
                                            value={newEmail}
                                            onChange={(e) => setNewEmail(e.target.value)}
                                            required
                                        />
                                    </div>
                                    <button 
                                        type="submit" 
                                        className="btn btn-primary btn-full"
                                        disabled={creating}
                                    >
                                        {creating ? 'Creating...' : '+ Create Institution Admin'}
                                    </button>
                                </form>
                            </div>
                        </div>

                        {/* Stats Card */}
                        <div className="card">
                            <div className="card-header">
                                <h3>System Overview</h3>
                            </div>
                            <div className="card-body">
                                <div className="grid-2 gap-4">
                                    <div className="stat-card" style={{ boxShadow: 'none', border: '1px solid var(--border)' }}>
                                        <div className="stat-value">{institutions.length}</div>
                                        <div className="stat-label">Institutions</div>
                                    </div>
                                    <div className="stat-card" style={{ boxShadow: 'none', border: '1px solid var(--border)' }}>
                                        <div className="stat-value">{institutions.filter(i => i.is_active).length}</div>
                                        <div className="stat-label">Active</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Institutions Table */}
                    <div className="card">
                        <div className="card-header">
                            <h3>Manage Institutions</h3>
                        </div>
                        <div className="table-wrap">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Admin Email</th>
                                        <th>Status</th>
                                        <th>Created At</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {institutions.map((inst) => (
                                        <React.Fragment key={inst.id}>
                                            <tr>
                                                <td style={{ fontWeight: 600 }}>{inst.name}</td>
                                                <td>{inst.admin_email}</td>
                                                <td>
                                                    <span className={`badge ${inst.is_active ? 'badge-green' : 'badge-red'}`}>
                                                        {inst.is_active ? 'Active' : 'Inactive'}
                                                    </span>
                                                </td>
                                                <td className="col-muted">{new Date(inst.created_at).toLocaleDateString()}</td>
                                                <td>
                                                    <div className="flex gap-2 flex-wrap">
                                                        <button
                                                            type="button"
                                                            className="btn btn-ghost btn-sm"
                                                            onClick={() => loadInstDetails(inst.id)}
                                                            disabled={loadingDetailsId === inst.id}
                                                        >
                                                            {loadingDetailsId === inst.id ? '…' : expandedInstId === inst.id ? '▼ Hide details' : '▶ View details'}
                                                        </button>
                                                        <button 
                                                            className={`btn btn-sm ${inst.is_active ? 'btn-secondary' : 'btn-primary'}`}
                                                            onClick={() => toggleStatus(inst.id, inst.is_active)}
                                                        >
                                                            {inst.is_active ? 'Deactivate' : 'Activate'}
                                                        </button>
                                                        <button 
                                                            className="btn btn-ghost btn-sm text-danger"
                                                            onClick={() => handleDelete(inst.id)}
                                                        >
                                                            Delete
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                            <AnimatePresence>
                                                {expandedInstId === inst.id && (
                                                    <motion.tr
                                                        key={`${inst.id}-detail`}
                                                        initial={{ opacity: 0, height: 0 }}
                                                        animate={{ opacity: 1, height: 'auto' }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        transition={{ duration: 0.25 }}
                                                    >
                                                        <td colSpan={5} style={{ padding: 0, borderBottom: '1px solid var(--border)', verticalAlign: 'top' }}>
                                                            <InstDetailPanel inst={inst} rooms={instDetails[inst.id] ?? []} />
                                                        </td>
                                                    </motion.tr>
                                                )}
                                            </AnimatePresence>
                                        </React.Fragment>
                                    ))}
                                    {institutions.length === 0 && (
                                        <tr>
                                            <td colSpan={5} style={{ textAlign: 'center', padding: 40 }}>
                                                <p className="col-muted">No institutions found.</p>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <Footer />
            </main>

            {/* Toasts */}
            <div className="toast-container">
                <AnimatePresence>
                    {toasts.map((t) => (
                        <motion.div
                            key={t.id}
                            className={`toast toast-${t.type}`}
                            initial={{ opacity: 0, y: 20, scale: 0.9 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                        >
                            {t.msg}
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
}

function InstDetailPanel({ inst, rooms }: { inst: Institution; rooms: RoomWithDetails[] }) {
    const totalJudges = rooms.reduce((s, r) => s + r.judges.length, 0);
    const totalEvents = rooms.reduce((s, r) => s + r.events.length, 0);
    const totalScores = rooms.reduce((s, r) => s + r.events.reduce((es, ev) => es + ev.scores.length, 0), 0);

    return (
        <div style={{ padding: 20, background: 'var(--bg-muted)', borderTop: '1px solid var(--border)' }}>
            <div style={{ marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span><strong>{rooms.length}</strong> room(s)</span>
                <span><strong>{totalJudges}</strong> judge(s)</span>
                <span><strong>{totalEvents}</strong> event(s)</span>
                <span><strong>{totalScores}</strong> score(s)</span>
            </div>
            {rooms.length === 0 ? (
                <p className="col-muted" style={{ fontSize: '0.875rem' }}>No rooms yet for this institution.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {rooms.map((room) => (
                        <div
                            key={room.id}
                            style={{
                                background: 'white',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--r-md)',
                                padding: 16,
                                boxShadow: 'var(--shadow-xs)',
                            }}
                        >
                            <div style={{ fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontFamily: 'monospace', fontSize: '1rem' }}>Room: {room.secret_code}</span>
                                <span className="badge badge-gray">
                                    {room.judges.length}/{room.judge_count_required} judges
                                </span>
                            </div>
                            {room.judges.length > 0 && (
                                <div style={{ marginBottom: 10 }}>
                                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>Judges</div>
                                    <div style={{ fontSize: '0.8rem' }}>{room.judges.map((j) => j.email).join(', ')}</div>
                                </div>
                            )}
                            {room.events.length > 0 && (
                                <div>
                                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>Events</div>
                                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.85rem' }}>
                                        {room.events.map((ev) => (
                                            <li key={ev.id}>
                                                <strong>{ev.event_name}</strong>
                                                {ev.category && ` · ${ev.category}`}
                                                {' '}— {ev.participant_count} participants, {ev.scores.length} score entries
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {room.judges.length === 0 && room.events.length === 0 && (
                                <p className="col-muted" style={{ fontSize: '0.8rem', margin: 0 }}>No judges or events yet.</p>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
