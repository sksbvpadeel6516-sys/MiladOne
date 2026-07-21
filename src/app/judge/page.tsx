'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, SUPER_ADMIN_EMAIL } from '@/lib/supabase';
import type { Room, Event, Score } from '@/types';
import Footer from '@/components/Footer';

type Step = 'join' | 'events' | 'create-event' | 'scoring' | 'submitted';
interface Toast { id: number; msg: string; type: 'success' | 'error' | 'info'; }
let _tid = 0;

const pageVariants = {
    initial: { opacity: 0, y: 18 },
    in: { opacity: 1, y: 0, transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] as const } },
    out: { opacity: 0, y: -12, transition: { duration: 0.2 } },
};

const stagger = {
    hidden: {},
    show: { transition: { staggerChildren: 0.06 } },
};
const itemV = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const } },
};

const getCodeName = (num: number, type: 'number' | 'letter' = 'number') => {
    if (type === 'letter') {
        let temp = num - 1;
        let letter = '';
        while (temp >= 0) {
            letter = String.fromCharCode((temp % 26) + 65) + letter;
            temp = Math.floor(temp / 26) - 1;
        }
        return letter;
    }
    return String(num);
};

export default function JudgePage() {
    const router = useRouter();
    const [authReady, setAuthReady] = useState(false);
    const [userEmail, setUserEmail] = useState('');
    const [step, setStep] = useState<Step>('join');
    const [codeInput, setCodeInput] = useState('');
    const [joining, setJoining] = useState(false);
    const [joinedRoom, setJoinedRoom] = useState<Room | null>(null);
    const [events, setEvents] = useState<Event[]>([]);
    const [loadingEvents, setLoadingEvents] = useState(false);
    const [eventName, setEventName] = useState('');
    const [category, setCategory] = useState('');
    const [customCategory, setCustomCategory] = useState('');
    const [participantCount, setParticipantCount] = useState(3);
    const [creatingEvent, setCreatingEvent] = useState(false);
    const [scoringEvent, setScoringEvent] = useState<Event | null>(null);
    const [scores, setScores] = useState<Record<number, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [existingScores, setExistingScores] = useState<Score[]>([]);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [confirmLeaveRoom, setConfirmLeaveRoom] = useState(false);

    const showToast = useCallback((msg: string, type: Toast['type'] = 'info') => {
        const id = ++_tid;
        setToasts((p) => [...p, { id, msg, type }]);
        setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500);
    }, []);

    useEffect(() => {
        let cancelled = false;
        supabase.auth.getSession()
            .then(async ({ data: { session } }) => {
                if (cancelled) return;
                if (!session?.user?.email) {
                    router.replace('/');
                    return;
                }
                const email = session.user.email;
                if (email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
                    router.replace('/super-admin');
                    return;
                }
                const { data: inst, error } = await supabase
                    .from('institutions')
                    .select('id')
                    .eq('admin_email', email.toLowerCase())
                    .maybeSingle();
                if (cancelled) return;
                if (error) {
                    console.error('Judge auth check:', error);
                }
                if (inst) {
                    router.replace('/admin');
                    return;
                }
                setUserEmail(email);
                setAuthReady(true);
            })
            .catch(() => { if (!cancelled) router.replace('/'); });
        return () => { cancelled = true; };
    }, [router]);

    useEffect(() => {
        if (!authReady || !userEmail) return;
        (async () => {
            try {
                const { data, error } = await supabase.from('judges')
                    .select('room_id').eq('email', userEmail).limit(1).single();
                
                if (error && (error.code === 'PGRST301' || error.message.includes('JWT') || error.message.includes('401'))) {
                    showToast('Session expired. Please re-login.', 'error');
                    router.replace('/');
                    return;
                }

                if (data?.room_id) {
                    const { data: room } = await supabase.from('rooms').select('*').eq('id', data.room_id).single();
                    if (room) {
                        setJoinedRoom(room as Room);
                        setStep('events');
                        loadEvents(room.id);
                    }
                }
            } catch (err) {
                console.error('Judge check error:', err);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authReady, userEmail]);

    const loadEvents = useCallback(async (roomId: string) => {
        setLoadingEvents(true);
        const { data } = await supabase.from('events').select('*')
            .eq('room_id', roomId).order('created_at', { ascending: false });
        setEvents((data as Event[]) || []);
        setLoadingEvents(false);
    }, []);

    useEffect(() => {
        if (!joinedRoom) return;
        const ch = supabase.channel(`j-events-${joinedRoom.id}`)
            .on('postgres_changes', {
                event: 'INSERT', schema: 'public', table: 'events',
                filter: `room_id=eq.${joinedRoom.id}`,
            }, (payload) => {
                setEvents((prev) => [payload.new as Event, ...prev.filter((e) => e.id !== (payload.new as Event).id)]);
            })
            .on('postgres_changes', {
                event: 'UPDATE', schema: 'public', table: 'rooms',
                filter: `id=eq.${joinedRoom.id}`,
            }, (payload) => {
                setJoinedRoom(payload.new as Room);
            })
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [joinedRoom]);

    const loadExisting = useCallback(async (eventId: string) => {
        const { data } = await supabase.from('scores').select('*')
            .eq('event_id', eventId).eq('judge_email', userEmail);
        const ex = (data as Score[]) || [];
        setExistingScores(ex);
        const pre: Record<number, string> = {};
        ex.forEach((s) => { pre[s.participant_number] = String(s.score); });
        setScores(pre);
    }, [userEmail]);

    const handleJoin = async (e: React.FormEvent) => {
        e.preventDefault();
        const code = codeInput.trim().toUpperCase();
        if (code.length !== 6) { showToast('Enter a 6-character room code.', 'error'); return; }
        setJoining(true);
        try {
            const { data: room, error: rErr } = await supabase.from('rooms').select('*')
                .eq('secret_code', code).single();
            if (rErr || !room) throw new Error('Room not found. Check the code.');

            // Check if already in this room
            const { data: alreadyIn } = await supabase.from('judges').select('id')
                .eq('room_id', room.id).eq('email', userEmail).single();

            if (!alreadyIn) {
                // To join a new room, first leave any current room (clean slate)
                await supabase.from('judges').delete().eq('email', userEmail);
                
                const { data: current } = await supabase.from('judges').select('id').eq('room_id', room.id);
                if ((current?.length || 0) >= room.judge_count_required)
                    throw new Error(`Room is full (max ${room.judge_count_required} judges).`);
                
                const { error: jErr } = await supabase.from('judges').insert({ email: userEmail, room_id: room.id });
                if (jErr) throw jErr;
            }

            setJoinedRoom(room as Room);
            setStep('events');
            loadEvents(room.id);
            showToast('Joined room successfully!', 'success');
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Failed to join.', 'error');
        } finally {
            setJoining(false);
        }
    };

    const updateRoomCodeType = async (type: 'number' | 'letter') => {
        if (!joinedRoom) return;
        try {
            const { error } = await supabase
                .from('rooms')
                .update({ code_type: type })
                .eq('id', joinedRoom.id);
            if (error) throw error;
            setJoinedRoom(prev => prev ? { ...prev, code_type: type } : null);
            showToast(`Room code style changed to ${type === 'letter' ? 'Letters' : 'Numbers'}.`, 'success');
        } catch (err) {
            console.error(err);
            showToast('Failed to update code style.', 'error');
        }
    };

    const CATEGORY_OPTIONS = ['Kiddies', 'Sub Junior', 'Junior', 'Senior', 'Super Senior', 'Other'] as const;

    const handleCreateEvent = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!joinedRoom || !eventName.trim()) { showToast('Event name is required.', 'error'); return; }
        if (!category) { showToast('Please select a category.', 'error'); return; }
        const resolvedCategory = category === 'Other' ? customCategory.trim() : category;
        if (!resolvedCategory) { showToast('Please enter a custom category name.', 'error'); return; }
        setCreatingEvent(true);
        try {
            const { data: newEvent, error } = await supabase.from('events').insert({
                room_id: joinedRoom.id, 
                institution_id: joinedRoom.institution_id,
                event_name: eventName.trim(),
                category: resolvedCategory,
                participant_count: participantCount, 
                created_by: userEmail,
            }).select().single();
            if (error) throw error;

            showToast('Event created!', 'success');
            setEventName('');
            setCategory('');
            setCustomCategory('');
            setParticipantCount(3);
            setScoringEvent(newEvent as Event);
            const init: Record<number, string> = {};
            for (let i = 1; i <= (newEvent as Event).participant_count; i++) init[i] = '';
            setScores(init);
            setExistingScores([]);
            setStep('scoring');
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Failed.', 'error');
        } finally {
            setCreatingEvent(false);
        }
    };

    const openScoring = async (ev: Event) => {
        setScoringEvent(ev);
        const init: Record<number, string> = {};
        for (let i = 1; i <= ev.participant_count; i++) init[i] = '';
        setScores(init);
        await loadExisting(ev.id);
        setStep('scoring');
    };

    const handleSubmit = async () => {
        if (!scoringEvent || !joinedRoom) return;
        const nums = Array.from({ length: scoringEvent.participant_count }, (_, i) => i + 1);
        for (const num of nums) {
            const v = scores[num];
            const labelStyle = joinedRoom.code_type === 'letter' ? 'Letter' : 'Number';
            const name = getCodeName(num, joinedRoom.code_type);
            if (!v && v !== '0') { showToast(`Fill in score for Code ${labelStyle} ${name}.`, 'error'); return; }
            const n = Number(v);
            if (isNaN(n) || n < 0 || n > 100) { showToast(`Code ${labelStyle} ${name}: score must be 0–100.`, 'error'); return; }
        }
        setSubmitting(true);
        try {
            const { error } = await supabase.from('scores').upsert(
                nums.map((num) => ({
                    event_id: scoringEvent.id, 
                    institution_id: joinedRoom.institution_id,
                    judge_email: userEmail,
                    participant_number: num, 
                    score: Number(scores[num]),
                })),
                { onConflict: 'event_id,judge_email,participant_number' }
            );
            if (error) throw error;
            showToast('Scores submitted! Admin can see them now.', 'success');
            setStep('submitted');
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Submit failed.', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        router.replace('/');
    };

    const handleLeaveRoom = async () => {
        if (!userEmail) return;
        try {
            const { error } = await supabase.from('judges').delete().eq('email', userEmail);
            if (error) throw error;
            setJoinedRoom(null);
            setStep('join');
            setCodeInput('');
            showToast('You have left the room.', 'success');
        } catch (err) {
            console.error(err);
            showToast('Failed to leave the room.', 'error');
        } finally {
            setConfirmLeaveRoom(false);
        }
    };

    const goEvents = () => {
        setStep('events');
        if (joinedRoom) loadEvents(joinedRoom.id);
    };

    if (!authReady) {
        return (
            <div className="loading-screen">
                <div className="spinner" /><p>Verifying access…</p>
            </div>
        );
    }

    /* Step index for indicator */
    const stepIdx = ['join', 'events', 'scoring', 'submitted'].indexOf(
        step === 'create-event' ? 'events' : step
    );
    const stepLabels = [
        { label: 'Join Room' },
        { label: 'Events' },
        { label: 'Scoring' },
        { label: 'Done' },
    ];

    const filledCount = Object.values(scores).filter((v) => v !== '').length;
    const totalScore = Object.values(scores).reduce((s, v) => s + (v !== '' && !isNaN(Number(v)) ? Number(v) : 0), 0);

    return (
        <div className="judge-page">
            {/* Header */}
            <header className="judge-header">
                <div className="flex items-c gap-3">
                    <div style={{
                        width: 32, height: 32, background: 'white', border: '1px solid var(--border)',
                        borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, padding: 4,
                        boxShadow: 'var(--shadow-xs)',
                    }}>
                        <img src="/logo/logo.png" alt="MiladOne Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </div>
                    <div>
                        <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>
                            Milad<span style={{ color: 'var(--primary)' }}>One</span>
                        </span>
                        {joinedRoom && (
                            <span className="text-xs col-muted" style={{ marginLeft: 8 }}>
                                · Room <strong style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                                    {joinedRoom.secret_code}
                                </strong>
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex items-c gap-3">
                    <span className="badge badge-blue hide-sm">Judge</span>
                    <span className="text-xs col-muted hide-sm truncate" style={{ maxWidth: 160 }}>{userEmail}</span>
                    {joinedRoom && step !== 'join' && (
                        <motion.button
                            id="btn-leave-room"
                            onClick={() => setConfirmLeaveRoom(true)}
                            className="btn btn-ghost btn-sm text-danger"
                            whileTap={{ scale: 0.96 }}
                        >
                            Leave Room
                        </motion.button>
                    )}
                    <motion.button
                        id="btn-signout-judge" onClick={handleSignOut}
                        className="btn btn-secondary btn-sm" whileTap={{ scale: 0.96 }}>
                        Sign Out
                    </motion.button>
                </div>
            </header>

            <div className="judge-body">
                {/* Step indicator */}
                <div className="steps">
                    {stepLabels.map((s, idx) => (
                        <div key={s.label} className="flex items-c" style={{ flex: idx < stepLabels.length - 1 ? 1 : undefined }}>
                            <div className="step">
                                <motion.div
                                    className={`step-num ${idx < stepIdx ? 'done' : idx === stepIdx ? 'active' : ''}`}
                                    animate={{ scale: idx === stepIdx ? 1.1 : 1 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    {idx < stepIdx ? '✓' : idx + 1}
                                </motion.div>
                                <span className={`step-label ${idx < stepIdx ? 'done' : idx === stepIdx ? 'active' : ''}`}>
                                    {s.label}
                                </span>
                            </div>
                            {idx < stepLabels.length - 1 && (
                                <div className={`step-connector ${idx < stepIdx ? 'done' : ''}`} />
                            )}
                        </div>
                    ))}
                </div>

                <AnimatePresence mode="wait">
                    {/* ── JOIN ── */}
                    {step === 'join' && (
                        <motion.div key="join" variants={pageVariants} initial="initial" animate="in" exit="out">
                            <div style={{ maxWidth: 420, margin: '0 auto' }}>
                                <div style={{ textAlign: 'center', marginBottom: 28 }}>
                                    <motion.div
                                        style={{ fontSize: '3rem', marginBottom: 12 }}
                                        animate={{ y: [0, -6, 0] }}
                                        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                                    >🚪</motion.div>
                                    <h2>Join a Room</h2>
                                    <p className="col-muted text-sm" style={{ marginTop: 6 }}>
                                        Enter the 6-character code given by your administrator.
                                    </p>
                                </div>
                                <div className="card">
                                    <div className="card-body">
                                        <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                            <div className="form-group">
                                                <label className="form-label">Room Code</label>
                                                <input
                                                    id="input-room-code"
                                                    type="text"
                                                    className="input input-lg input-code"
                                                    placeholder="_ _ _ _ _ _"
                                                    value={codeInput}
                                                    onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                                                    maxLength={6} required autoFocus
                                                />
                                            </div>
                                            <motion.button
                                                id="btn-join-room" type="submit"
                                                className="btn btn-primary btn-full" style={{ padding: 13 }}
                                                disabled={joining}
                                                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                                            >
                                                {joining
                                                    ? <><div className="spinner spinner-sm spinner-white" /> Joining…</>
                                                    : 'Join Room'}
                                            </motion.button>
                                        </form>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* ── EVENTS ── */}
                    {step === 'events' && joinedRoom && (
                        <motion.div key="events" variants={pageVariants} initial="initial" animate="in" exit="out">
                            <div className="section-header" style={{ marginBottom: 20 }}>
                                <div>
                                    <h2>Events</h2>
                                    <p className="text-xs col-muted mt-1">
                                        Room <strong style={{ fontFamily: 'monospace' }}>{joinedRoom.secret_code}</strong>
                                        {' '}· requires {joinedRoom.judge_count_required} judges
                                    </p>
                                </div>
                                <motion.button
                                    id="btn-create-event"
                                    onClick={() => setStep('create-event')}
                                    className="btn btn-primary"
                                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                                >
                                    + Create Event
                                </motion.button>
                            </div>

                            {/* Code Style Selector */}
                            <div className="card" style={{ marginBottom: 20, border: '1px solid var(--border)', background: '#F8FAFC' }}>
                                <div className="card-body" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                                    <div>
                                        <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>Room Participant Code Style</h4>
                                        <p className="text-xs col-muted" style={{ margin: 0 }}>Select if participants are identified by Numbers (1, 2...) or Letters (A, B...)</p>
                                    </div>
                                    <div className="flex gap-2" style={{ background: '#F1F5F9', padding: 4, borderRadius: 8 }}>
                                        <button
                                            type="button"
                                            className="btn btn-sm"
                                            style={{
                                                padding: '6px 12px',
                                                fontSize: '0.8rem',
                                                borderRadius: 6,
                                                fontWeight: 600,
                                                background: joinedRoom.code_type === 'number' ? '#FFFFFF' : 'transparent',
                                                color: joinedRoom.code_type === 'number' ? 'var(--primary)' : 'var(--text-secondary)',
                                                boxShadow: joinedRoom.code_type === 'number' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                                border: 'none',
                                            }}
                                            onClick={() => updateRoomCodeType('number')}
                                        >
                                            Numbers (1, 2, 3...)
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-sm"
                                            style={{
                                                padding: '6px 12px',
                                                fontSize: '0.8rem',
                                                borderRadius: 6,
                                                fontWeight: 600,
                                                background: joinedRoom.code_type === 'letter' ? '#FFFFFF' : 'transparent',
                                                color: joinedRoom.code_type === 'letter' ? 'var(--primary)' : 'var(--text-secondary)',
                                                boxShadow: joinedRoom.code_type === 'letter' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                                border: 'none',
                                            }}
                                            onClick={() => updateRoomCodeType('letter')}
                                        >
                                            Letters (A, B, C...)
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {loadingEvents ? (
                                <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
                                    <div className="spinner" />
                                </div>
                            ) : events.length === 0 ? (
                                <motion.div className="card" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                                    <div className="card-body">
                                        <div className="empty-state">
                                            <div className="empty-state-icon">📋</div>
                                            <h4>No events yet</h4>
                                            <p>Create your first event using the button above.</p>
                                        </div>
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div
                                    variants={stagger} initial="hidden" animate="show"
                                    style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                                >
                                    {events.map((ev) => (
                                        <motion.div
                                            key={ev.id}
                                            variants={itemV}
                                            className="event-card"
                                            onClick={() => openScoring(ev)}
                                            whileHover={{ y: -2, boxShadow: '0 6px 20px rgba(79,70,229,0.12)' }}
                                        >
                                            <div>
                                                <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 5 }}>
                                                    {ev.event_name}
                                                </div>
                                                <div className="flex gap-3 text-xs col-muted" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                                                    {ev.category && (
                                                        <span className="badge badge-gray" style={{ fontSize: '0.68rem', padding: '2px 7px' }}>
                                                            {ev.category}
                                                        </span>
                                                    )}
                                                    <span>👤 {ev.participant_count} participants</span>
                                                    <span>🕐 {new Date(ev.created_at).toLocaleDateString()}</span>
                                                </div>
                                            </div>
                                            <motion.button
                                                id={`btn-score-${ev.id}`}
                                                className="btn btn-primary btn-sm shrink-0"
                                                onClick={(e) => { e.stopPropagation(); openScoring(ev); }}
                                                whileTap={{ scale: 0.95 }}
                                            >
                                                Score →
                                            </motion.button>
                                        </motion.div>
                                    ))}
                                </motion.div>
                            )}
                        </motion.div>
                    )}

                    {/* ── CREATE EVENT ── */}
                    {step === 'create-event' && (
                        <motion.div key="create-event" variants={pageVariants} initial="initial" animate="in" exit="out">
                            <div style={{ maxWidth: 680, margin: '0 auto' }}>
                                <div className="flex items-c gap-3" style={{ marginBottom: 20 }}>
                                    <motion.button className="btn btn-secondary btn-sm" onClick={() => setStep('events')}
                                        whileTap={{ scale: 0.96 }}>← Back</motion.button>
                                    <h2>Create Event</h2>
                                </div>
                                <div className="card">
                                    <div className="card-body">
                                        <form onSubmit={handleCreateEvent} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                                            <div className="form-group">
                                                <label className="form-label">Event Name *</label>
                                                <input id="input-event-name" type="text" className="input"
                                                    placeholder="e.g. Solo Dance, Best Project, Group Performance"
                                                    value={eventName} onChange={(e) => setEventName(e.target.value)}
                                                    required autoFocus />
                                            </div>

                                            <div className="form-group">
                                                <label className="form-label">Category *</label>
                                                <select
                                                    id="select-category"
                                                    className="select"
                                                    value={category}
                                                    onChange={(e) => {
                                                        setCategory(e.target.value);
                                                        if (e.target.value !== 'Other') setCustomCategory('');
                                                    }}
                                                    required
                                                >
                                                    <option value="" disabled>Select a category…</option>
                                                    {CATEGORY_OPTIONS.map((opt) => (
                                                        <option key={opt} value={opt}>{opt}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <AnimatePresence>
                                                {category === 'Other' && (
                                                    <motion.div
                                                        key="custom-category"
                                                        className="form-group"
                                                        initial={{ opacity: 0, height: 0, marginTop: -10 }}
                                                        animate={{ opacity: 1, height: 'auto', marginTop: 0 }}
                                                        exit={{ opacity: 0, height: 0, marginTop: -10 }}
                                                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] as const }}
                                                        style={{ overflow: 'hidden' }}
                                                    >
                                                        <label className="form-label">Custom Category Name *</label>
                                                        <input
                                                            id="input-custom-category"
                                                            type="text"
                                                            className="input"
                                                            placeholder="Enter Category Name"
                                                            value={customCategory}
                                                            onChange={(e) => setCustomCategory(e.target.value)}
                                                            required
                                                            autoFocus
                                                        />
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>

                                            <div className="form-group">
                                                <label className="form-label">Number of Participants</label>
                                                <select id="select-participant-count" className="select"
                                                    value={participantCount}
                                                    onChange={(e) => setParticipantCount(Number(e.target.value))}>
                                                    {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
                                                        <option key={n} value={n}>{n} Participant{n !== 1 ? 's' : ''}</option>
                                                    ))}
                                                </select>
                                                <p className="text-xs col-muted mt-1">
                                                    Score inputs will be auto-labeled Code {joinedRoom?.code_type === 'letter' ? 'Letter' : 'Number'} {getCodeName(1, joinedRoom?.code_type)} – {getCodeName(participantCount, joinedRoom?.code_type)}.
                                                </p>
                                            </div>
 
                                            {/* Preview */}
                                            <div style={{
                                                background: 'var(--bg-hover)', border: '1px solid var(--border)',
                                                borderRadius: 'var(--r-md)', padding: 16,
                                            }}>
                                                <p className="text-xs font-700 col-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Preview</p>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                    {Array.from({ length: Math.min(participantCount, 3) }, (_, i) => (
                                                        <div key={i} className="participant-row" style={{ pointerEvents: 'none' }}>
                                                            <div className="p-num">{getCodeName(i + 1, joinedRoom?.code_type)}</div>
                                                            <div className="p-label">Code {joinedRoom?.code_type === 'letter' ? 'Letter' : 'Number'} {getCodeName(i + 1, joinedRoom?.code_type)}</div>
                                                            <div style={{
                                                                width: 100, height: 38, background: 'white',
                                                                border: '1.5px solid var(--border)',
                                                                borderRadius: 'var(--r-sm)',
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            }}>
                                                                <span className="text-xs col-muted">0 – 100</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {participantCount > 3 && (
                                                        <p className="text-xs col-muted text-c" style={{ padding: '4px 0' }}>
                                                            … and {participantCount - 3} more
                                                        </p>
                                                    )}
                                                </div>
                                            </div>

                                            <motion.button id="btn-create-event-submit" type="submit"
                                                className="btn btn-primary btn-full btn-lg"
                                                disabled={creatingEvent}
                                                whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                                                {creatingEvent
                                                    ? <><div className="spinner spinner-sm spinner-white" /> Creating…</>
                                                    : 'Create Event & Start Scoring →'}
                                            </motion.button>
                                        </form>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* ── SCORING ── */}
                    {step === 'scoring' && scoringEvent && (
                        <motion.div key="scoring" variants={pageVariants} initial="initial" animate="in" exit="out">
                            <div style={{ maxWidth: 840, margin: '0 auto' }}>
                                {/* Breadcrumb */}
                                <div className="flex items-c gap-3" style={{ marginBottom: 20 }}>
                                    <motion.button className="btn btn-secondary btn-sm" onClick={goEvents}
                                        whileTap={{ scale: 0.96 }}>← Events</motion.button>
                                    <span className="col-muted">›</span>
                                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{scoringEvent.event_name}</span>
                                </div>

                                <div className="card">
                                    <div className="card-header">
                                        <div>
                                            <h2>{scoringEvent.event_name}</h2>
                                            <p className="text-xs col-muted mt-1">
                                                {scoringEvent.participant_count} participant{scoringEvent.participant_count !== 1 ? 's' : ''}
                                                {' '}· Enter scores between 0 and 100
                                                {existingScores.length > 0 && (
                                                    <span className="badge badge-green" style={{ marginLeft: 8 }}>Updating</span>
                                                )}
                                            </p>
                                        </div>
                                        {/* Progress */}
                                        <div style={{ textAlign: 'right', minWidth: 60 }}>
                                            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--primary)' }}>
                                                {filledCount}/{scoringEvent.participant_count}
                                            </div>
                                            <div className="text-xs col-muted">filled</div>
                                        </div>
                                    </div>

                                    <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        <motion.div variants={stagger} initial="hidden" animate="show"
                                            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            {Array.from({ length: scoringEvent.participant_count }, (_, i) => i + 1).map((num) => {
                                                const val = scores[num] ?? '';
                                                const n = Number(val);
                                                const isEmpty = val === '';
                                                const isValid = isEmpty || (!isNaN(n) && n >= 0 && n <= 100);
                                                const color = isEmpty ? 'var(--text-muted)'
                                                    : !isValid ? 'var(--danger)'
                                                        : n >= 80 ? 'var(--success)'
                                                            : n >= 50 ? 'var(--primary)'
                                                                : 'var(--danger)';

                                                return (
                                                    <motion.div key={num} variants={itemV} className="participant-row">
                                                        <div className="p-num">{getCodeName(num, joinedRoom?.code_type)}</div>
                                                        <div className="p-label">Code {joinedRoom?.code_type === 'letter' ? 'Letter' : 'Number'} {getCodeName(num, joinedRoom?.code_type)}</div>
                                                        <div className="p-score-wrap">
                                                            <input
                                                                id={`score-p${num}`}
                                                                type="number"
                                                                className={`score-input ${!isEmpty && !isValid ? 'invalid' : !isEmpty ? 'valid' : ''}`}
                                                                placeholder="0–100"
                                                                min={0} max={100}
                                                                value={val}
                                                                onChange={(e) => setScores((p) => ({ ...p, [num]: e.target.value }))}
                                                            />
                                                        </div>
                                                        <div className="p-score-val" style={{ color }}>
                                                            {!isEmpty ? (isValid ? n : '!') : ''}
                                                        </div>
                                                    </motion.div>
                                                );
                                            })}
                                        </motion.div>

                                        {/* Total bar */}
                                        <AnimatePresence>
                                            {filledCount > 0 && (
                                                <motion.div
                                                    initial={{ opacity: 0, height: 0 }}
                                                    animate={{ opacity: 1, height: 'auto' }}
                                                    exit={{ opacity: 0, height: 0 }}
                                                    style={{
                                                        padding: '12px 16px', marginTop: 4,
                                                        background: 'var(--primary-light)',
                                                        border: '1px solid #C7D2FE',
                                                        borderRadius: 'var(--r-sm)',
                                                    }}
                                                >
                                                    <div className="flex just-b items-c">
                                                        <span className="text-sm font-700 col-pri">
                                                            Total: {totalScore} / {scoringEvent.participant_count * 100}
                                                        </span>
                                                        <span className="text-xs col-sec">
                                                            {filledCount}/{scoringEvent.participant_count} filled
                                                        </span>
                                                    </div>
                                                    <div className="progress-track" style={{ marginTop: 8 }}>
                                                        <div className="progress-fill progress-primary"
                                                            style={{ width: `${(totalScore / (scoringEvent.participant_count * 100)) * 100}%` }} />
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>

                                        <motion.button
                                            id="btn-submit-scores"
                                            onClick={handleSubmit}
                                            disabled={submitting}
                                            className="btn btn-success btn-full btn-lg"
                                            style={{ marginTop: 8 }}
                                            whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                                        >
                                            {submitting
                                                ? <><div className="spinner spinner-sm spinner-white" /> Submitting…</>
                                                : existingScores.length > 0 ? '✓ Update Scores' : '✓ Submit Scores'}
                                        </motion.button>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* ── SUBMITTED ── */}
                    {step === 'submitted' && (
                        <motion.div key="submitted" variants={pageVariants} initial="initial" animate="in" exit="out">
                            <div style={{ maxWidth: 460, margin: '40px auto' }}>
                                <div className="card" style={{ textAlign: 'center' }}>
                                    <div className="card-body" style={{ padding: 40 }}>
                                        <motion.div
                                            style={{ fontSize: '4rem', marginBottom: 16 }}
                                            initial={{ scale: 0 }}
                                            animate={{ scale: 1 }}
                                            transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                                        >🎉</motion.div>
                                        <h2 style={{ marginBottom: 8 }}>Scores Submitted!</h2>
                                        <p className="col-muted text-sm" style={{ marginBottom: 28, lineHeight: 1.7 }}>
                                            Your scores for <strong>{scoringEvent?.event_name}</strong> have been recorded.
                                            The admin can see them live right now.
                                        </p>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                            <motion.button id="btn-score-another" onClick={goEvents}
                                                className="btn btn-primary btn-full btn-lg"
                                                whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                                                Score Another Event
                                            </motion.button>
                                            <motion.button id="btn-create-another"
                                                onClick={() => setStep('create-event')}
                                                className="btn btn-secondary btn-full btn-lg"
                                                whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                                                + Create New Event
                                            </motion.button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <Footer />

            {/* Toasts */}
            <div className="toast-container">
                <AnimatePresence>
                    {toasts.map((t) => (
                        <motion.div key={t.id} className={`toast toast-${t.type}`}
                            initial={{ opacity: 0, x: 32, scale: 0.9 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, x: 32, scale: 0.9 }}
                            transition={{ duration: 0.3 }}>
                            <span className="toast-icon">
                                {t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : 'ℹ️'}
                            </span>
                            {t.msg}
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            {/* Confirmation Modals */}
            <AnimatePresence>
                {confirmLeaveRoom && (
                    <div className="sidebar-overlay" style={{ zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                        <motion.div 
                            className="card" 
                            style={{ maxWidth: 400, width: '100%' }}
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                        >
                            <div className="card-header">
                                <h3>Leave Room?</h3>
                            </div>
                            <div className="card-body">
                                <p style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>
                                    Are you sure you want to leave this room? You will be able to join another room using a different code, but your past scores for this room will remain recorded.
                                </p>
                                <div className="flex gap-3 mt-4">
                                    <button className="btn btn-secondary flex-1" onClick={() => setConfirmLeaveRoom(false)}>Cancel</button>
                                    <button className="btn btn-primary flex-1 bg-danger" onClick={handleLeaveRoom}>Leave</button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
