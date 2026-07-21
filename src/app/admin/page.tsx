'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import type { Room, Judge, Event, Score, Team, Participant, EventParticipantMapping } from '@/types';
import Footer from '@/components/Footer';

interface RoomWithDetails extends Room {
    judges: Judge[];
    events: EventWithScores[];
}
interface EventWithScores extends Event {
    scores: Score[];
}
interface Toast { id: number; msg: string; type: 'success' | 'error' | 'info'; }
let _tid = 0;

const fadeUp = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const } },
};
const stagger = {
    hidden: {}, show: { transition: { staggerChildren: 0.07 } },
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

export default function AdminPage() {
    const router = useRouter();
    const [authReady, setAuthReady] = useState(false);
    const [userEmail, setUserEmail] = useState('');
    const [institutionName, setInstitutionName] = useState('');
    const [institutionId, setInstitutionId] = useState<string | null>(null);
    const [rooms, setRooms] = useState<RoomWithDetails[]>([]);
    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [newRoomJudgeCount, setNewRoomJudgeCount] = useState<2 | 3>(3);
    const [newRoomCodeType, setNewRoomCodeType] = useState<'number' | 'letter'>('number');
    const [creating, setCreating] = useState(false);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [roomTab, setRoomTab] = useState<'overview' | 'scores'>('overview');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [confirmDeleteRoom, setConfirmDeleteRoom] = useState<string | null>(null);
    const [confirmRemoveJudge, setConfirmRemoveJudge] = useState<{ roomId: string; judgeId: string; email: string } | null>(null);
    const roomsRef = useRef<RoomWithDetails[]>([]);
    roomsRef.current = rooms;

    const [selectedView, setSelectedView] = useState<'overview' | 'teams' | 'participants' | 'championship' | 'individual'>('overview');
    const [championshipCategory, setChampionshipCategory] = useState<string>('overall');
    const [individualCategory, setIndividualCategory] = useState<string>('overall');
    const [teams, setTeams] = useState<Team[]>([]);
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [mappings, setMappings] = useState<EventParticipantMapping[]>([]);

    // Teams Management
    const [newTeamName, setNewTeamName] = useState('');
    const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
    const [editingTeamName, setEditingTeamName] = useState('');

    // Participants Management
    const [newPartName, setNewPartName] = useState('');
    const [newPartChest, setNewPartChest] = useState('');
    const [newPartTeamId, setNewPartTeamId] = useState('');
    const [partSearch, setPartSearch] = useState('');
    const [editingPartId, setEditingPartId] = useState<string | null>(null);
    const [editingPartName, setEditingPartName] = useState('');
    const [editingPartChest, setEditingPartChest] = useState('');
    const [editingPartTeamId, setEditingPartTeamId] = useState('');
    const [bulkImportText, setBulkImportText] = useState('');
    const [importing, setImporting] = useState(false);

    // Event Mappings
    const [mappingEventId, setMappingEventId] = useState<string | null>(null);
    const [localMappingInputs, setLocalMappingInputs] = useState<Record<number, string>>({});
    
    // First load reference to prevent loading flashes
    const firstLoadRef = useRef(true);

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
                const emailLower = email.toLowerCase();
                const { data: inst, error } = await supabase
                    .from('institutions')
                    .select('id, is_active, name')
                    .eq('admin_email', emailLower)
                    .maybeSingle();
                if (cancelled) return;
                if (error) {
                    console.error('Admin auth check failed:', error);
                    router.replace('/');
                    return;
                }
                if (inst?.is_active) {
                    setUserEmail(email);
                    setInstitutionName(inst.name ?? '');
                    setInstitutionId(inst.id);
                    setAuthReady(true);
                } else {
                    router.replace('/');
                }
            })
            .catch(() => { if (!cancelled) router.replace('/'); });
        return () => { cancelled = true; };
    }, [router]);


    const loadAll = useCallback(async () => {
        if (!institutionId) return;
        if (firstLoadRef.current) {
            setLoading(true);
        }
        try {
            const { data: rawRooms, error: rErr } = await supabase
                .from('rooms').select('*')
                .eq('institution_id', institutionId)
                .order('created_at', { ascending: false });
            if (rErr) throw rErr;

            // Fetch teams and participants always even if no rooms exist yet
            const [teamsRes, participantsRes] = await Promise.all([
                supabase.from('teams').select('*')
                    .eq('institution_id', institutionId)
                    .order('name', { ascending: true }),
                supabase.from('participants').select('*')
                    .eq('institution_id', institutionId)
                    .order('name', { ascending: true }),
            ]);
            const loadedTeams = (teamsRes.data as Team[]) || [];
            const loadedParticipants = (participantsRes.data as Participant[]) || [];
            setTeams(loadedTeams);
            setParticipants(loadedParticipants);

            if (!rawRooms || rawRooms.length === 0) { 
                setRooms([]); 
                setMappings([]);
                return; 
            }

            const roomIds = (rawRooms as Room[]).map((r) => r.id);
            const [judgesRes, eventsRes] = await Promise.all([
                supabase.from('judges').select('*').in('room_id', roomIds),
                supabase.from('events').select('*')
                    .in('room_id', roomIds)
                    .eq('institution_id', institutionId)
                    .order('created_at', { ascending: false }),
            ]);
            const allJudges = (judgesRes.data as Judge[]) || [];
            const allEvents = (eventsRes.data as Event[]) || [];

            let allScores: Score[] = [];
            let loadedMappings: EventParticipantMapping[] = [];
            if (allEvents.length > 0) {
                const eventIds = allEvents.map((e) => e.id);
                const [scoresRes, mappingsRes] = await Promise.all([
                    supabase.from('scores').select('*')
                        .in('event_id', eventIds)
                        .eq('institution_id', institutionId)
                        .order('created_at', { ascending: true }),
                    supabase.from('event_participant_mappings').select('*')
                        .in('event_id', eventIds)
                ]);
                allScores = (scoresRes.data as Score[]) || [];
                loadedMappings = (mappingsRes.data as EventParticipantMapping[]) || [];
            }
            setMappings(loadedMappings);

            const withDetails: RoomWithDetails[] = (rawRooms as Room[]).map((r) => {
                const js = allJudges.filter((j) => j.room_id === r.id);
                const evs = allEvents.filter((e) => e.room_id === r.id).map((ev) => {
                    const scs = allScores.filter((s) => s.event_id === ev.id);
                    return { ...ev, scores: scs };
                });
                return { ...r, judges: js, events: evs };
            });
            setRooms(withDetails);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load data.';
            if (message.includes('401') || message.includes('JWT')) {
                showToast('Session expired or missing keys. Please re-login.', 'error');
                router.replace('/');
            } else {
                showToast(message, 'error');
            }
            console.error(err);
        } finally {
            setLoading(false);
            firstLoadRef.current = false;
        }
    }, [showToast, institutionId, router]);

    useEffect(() => {
        if (!authReady || !institutionId) return;
        loadAll();
    }, [authReady, loadAll, institutionId]);

    useEffect(() => {
        if (!authReady || !institutionId) return;
        const ch = supabase.channel(`admin-rt-${institutionId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'judges' }, loadAll)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, loadAll)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, loadAll)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, loadAll)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, loadAll)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, loadAll)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'event_participant_mappings' }, loadAll)
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [authReady, loadAll, institutionId]);

    const generateCode = () => {
        const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        return Array.from({ length: 6 }, () => c[Math.floor(Math.random() * c.length)]).join('');
    };

    const handleCreateRoom = async () => {
        if (!institutionId) return;
        setCreating(true);
        try {
            let code = '', attempts = 0;
            while (attempts < 10) {
                const c = generateCode();
                const { data } = await supabase.from('rooms').select('id').eq('secret_code', c).maybeSingle();
                if (!data) { code = c; break; }
                attempts++;
            }
            if (!code) throw new Error('Could not generate a unique code.');
            const { error } = await supabase.from('rooms').insert({
                secret_code: code, 
                judge_count_required: newRoomJudgeCount, 
                code_type: newRoomCodeType,
                created_by: userEmail,
                institution_id: institutionId
            });
            if (error) throw new Error(`DB error [${error.code}]: ${error.message}`);
            showToast(`✓ Room created! Code: ${code}`, 'success');
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : JSON.stringify(err), 'error');
        } finally {
            setCreating(false);
        }

    };

    const handleDeleteRoom = async (id: string) => {
        try {
            const { error } = await supabase.from('rooms').delete().eq('id', id);
            if (error) throw error;
            if (selectedRoomId === id) setSelectedRoomId(null);
            showToast('Room deleted successfully.', 'success');
        } catch (err) {
            console.error(err);
            showToast('Failed to delete room.', 'error');
        } finally {
            setConfirmDeleteRoom(null);
        }
    };

    const handleRemoveJudge = async (roomId: string, judgeId: string) => {
        try {
            const { error } = await supabase.from('judges').delete().eq('id', judgeId);
            if (error) throw error;
            showToast('Judge removed from room.', 'success');
        } catch (err) {
            console.error(err);
            showToast('Failed to remove judge.', 'error');
        } finally {
            setConfirmRemoveJudge(null);
        }
    };

    const copyCode = (code: string) => {
        navigator.clipboard.writeText(code);
        showToast(`"${code}" copied!`, 'info');
    };

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        router.replace('/');
    };

    const selectRoom = (id: string | null) => {
        setSelectedRoomId(id);
        setRoomTab('overview');
        setSidebarOpen(false);
        setMappingEventId(null);
    };

    const selectView = (view: 'overview' | 'teams' | 'participants' | 'championship' | 'individual') => {
        setSelectedRoomId(null);
        setSelectedView(view);
        setSidebarOpen(false);
    };

    const getParticipantCount = (teamId: string) => {
        return participants.filter(p => p.team_id === teamId).length;
    };

    const handleCreateTeam = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTeamName.trim() || !institutionId) return;
        try {
            const { error } = await supabase
                .from('teams')
                .insert({
                    name: newTeamName.trim(),
                    institution_id: institutionId
                });
            if (error) throw error;
            showToast(`Team "${newTeamName.trim()}" created!`, 'success');
            setNewTeamName('');
        } catch (err: any) {
            showToast(err.message || 'Failed to create team', 'error');
        }
    };

    const handleDeleteTeam = async (id: string) => {
        if (!confirm('Are you sure you want to delete this team? Participants will be unassigned.')) return;
        try {
            const { error } = await supabase
                .from('teams')
                .delete()
                .eq('id', id);
            if (error) throw error;
            showToast('Team deleted', 'success');
        } catch (err: any) {
            showToast(err.message || 'Failed to delete team', 'error');
        }
    };

    const handleSaveTeamRename = async (id: string) => {
        if (!editingTeamName.trim()) return;
        try {
            const { error } = await supabase
                .from('teams')
                .update({ name: editingTeamName.trim() })
                .eq('id', id);
            if (error) throw error;
            showToast('Team renamed successfully', 'success');
            setEditingTeamId(null);
        } catch (err: any) {
            showToast(err.message || 'Failed to rename team', 'error');
        }
    };

    const handleCreateParticipant = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newPartName.trim() || !newPartChest.trim() || !institutionId) return;
        try {
            const { error } = await supabase
                .from('participants')
                .insert({
                    name: newPartName.trim(),
                    chest_number: newPartChest.trim().toUpperCase(),
                    team_id: newPartTeamId || null,
                    institution_id: institutionId
                });
            if (error) throw error;
            showToast(`Participant "${newPartName.trim()}" added!`, 'success');
            setNewPartName('');
            setNewPartChest('');
            setNewPartTeamId('');
        } catch (err: any) {
            showToast(err.message || 'Failed to add participant', 'error');
        }
    };

    const handleDeleteParticipant = async (id: string) => {
        if (!confirm('Are you sure you want to delete this participant? All their event mappings will be removed.')) return;
        try {
            const { error } = await supabase
                .from('participants')
                .delete()
                .eq('id', id);
            if (error) throw error;
            showToast('Participant deleted', 'success');
        } catch (err: any) {
            showToast(err.message || 'Failed to delete participant', 'error');
        }
    };

    const handleSavePartEdit = async (id: string) => {
        if (!editingPartName.trim() || !editingPartChest.trim()) return;
        try {
            const { error } = await supabase
                .from('participants')
                .update({
                    name: editingPartName.trim(),
                    chest_number: editingPartChest.trim().toUpperCase(),
                    team_id: editingPartTeamId || null
                })
                .eq('id', id);
            if (error) throw error;
            showToast('Participant updated', 'success');
            setEditingPartId(null);
        } catch (err: any) {
            showToast(err.message || 'Failed to update participant', 'error');
        }
    };

    const handleBulkImport = async () => {
        if (!bulkImportText.trim() || !institutionId) return;
        setImporting(true);
        try {
            const lines = bulkImportText.split('\n');
            const parsedRows: { name: string; chest: string; teamName: string }[] = [];
            
            for (const line of lines) {
                if (!line.trim()) continue;
                const parts = line.includes('\t') ? line.split('\t') : line.split(',');
                if (parts.length >= 2) {
                    const name = parts[0]?.trim();
                    const chest = parts[1]?.trim().toUpperCase();
                    const teamName = parts[2]?.trim() || '';
                    if (name && chest) {
                        parsedRows.push({ name, chest, teamName });
                    }
                }
            }
            
            if (parsedRows.length === 0) {
                showToast('No valid rows found. Format: Name, ChestNumber, TeamName', 'error');
                setImporting(false);
                return;
            }
            
            const uniqueTeamNames = [...new Set(parsedRows.map(r => r.teamName).filter(Boolean))];
            const teamMap = new Map<string, string>();
            teams.forEach(t => teamMap.set(t.name.toLowerCase(), t.id));
            
            for (const tName of uniqueTeamNames) {
                const lower = tName.toLowerCase();
                if (!teamMap.has(lower)) {
                    const { data: newTeam, error: tErr } = await supabase
                        .from('teams')
                        .insert({ name: tName, institution_id: institutionId })
                        .select('id, name')
                        .single();
                    if (tErr) throw new Error(`Failed to create team "${tName}": ${tErr.message}`);
                    if (newTeam) {
                        teamMap.set(lower, newTeam.id);
                    }
                }
            }
            
            const { data: updatedTeams } = await supabase.from('teams').select('*').eq('institution_id', institutionId);
            if (updatedTeams) setTeams(updatedTeams);
            
            let successCount = 0;
            let errorCount = 0;
            
            for (const row of parsedRows) {
                const teamId = row.teamName ? teamMap.get(row.teamName.toLowerCase()) || null : null;
                const { error } = await supabase
                    .from('participants')
                    .upsert({
                        name: row.name,
                        chest_number: row.chest,
                        team_id: teamId,
                        institution_id: institutionId
                    }, { onConflict: 'institution_id,chest_number' });
                if (error) {
                    console.error(error);
                    errorCount++;
                } else {
                    successCount++;
                }
            }
            
            showToast(`Import completed! Successfully imported ${successCount} participants. Errors: ${errorCount}`, successCount > 0 ? 'success' : 'error');
            setBulkImportText('');
        } catch (err: any) {
            showToast(err.message || 'Import failed', 'error');
        } finally {
            setImporting(false);
        }
    };

    const startMapping = (ev: Event) => {
        setMappingEventId(ev.id);
        const initInputs: Record<number, string> = {};
        const eventM = mappings.filter(m => m.event_id === ev.id);
        eventM.forEach(m => {
            const part = participants.find(p => p.id === m.participant_id);
            if (part) {
                initInputs[m.participant_number] = part.chest_number;
            }
        });
        setLocalMappingInputs(initInputs);
    };

    const saveSingleMapping = async (num: number, chestNum: string) => {
        if (!mappingEventId) return;
        const cleanChest = chestNum.trim();
        if (!cleanChest) {
            const { error } = await supabase
                .from('event_participant_mappings')
                .delete()
                .eq('event_id', mappingEventId)
                .eq('participant_number', num);
            if (error) {
                showToast('Failed to clear mapping', 'error');
            } else {
                showToast(`Cleared mapping for Code ${getCodeName(num, selectedRoom?.code_type)}`, 'success');
            }
            return;
        }
        
        const part = participants.find(p => p.chest_number.toLowerCase() === cleanChest.toLowerCase());
        if (!part) {
            showToast(`No participant found with Chest Number: ${cleanChest}`, 'error');
            return;
        }
        
        const isDuplicate = Object.entries(localMappingInputs).some(([k, v]) => Number(k) !== num && v.trim().toLowerCase() === cleanChest.toLowerCase());
        if (isDuplicate) {
            showToast(`Chest number ${cleanChest} is already mapped to another code in this event!`, 'error');
            return;
        }

        const { error } = await supabase
            .from('event_participant_mappings')
            .upsert({
                event_id: mappingEventId,
                participant_number: num,
                participant_id: part.id
            }, { onConflict: 'event_id,participant_number' });
            
        if (error) {
            showToast(error.message, 'error');
        } else {
            showToast(`Mapped Code ${getCodeName(num, selectedRoom?.code_type)} to ${part.name}`, 'success');
        }
    };

    const normalizeCategoryName = (cat: string) => {
        if (!cat) return '';
        const clean = cat.trim();
        if (!clean) return '';
        return clean.split(/\s+/).map(word => {
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        }).join(' ');
    };

    const getAvailableCategories = () => {
        const categoriesSet = new Set<string>();
        rooms.forEach(room => {
            room.events.forEach(event => {
                if (event.category) {
                    const norm = normalizeCategoryName(event.category);
                    if (norm) {
                        categoriesSet.add(norm);
                    }
                }
            });
        });
        return Array.from(categoriesSet).sort();
    };

    const calculateTeamStandings = (selectedCat: string = 'overall') => {
        const stand = new Map<string, { categoryPoints: Record<string, number>; overallPoints: number }>();
        teams.forEach(t => stand.set(t.id, { categoryPoints: {}, overallPoints: 0 }));
        
        rooms.forEach(room => {
            room.events.forEach(event => {
                const normCat = event.category ? normalizeCategoryName(event.category) : '';
                const nums = Array.from({ length: event.participant_count }, (_, i) => i + 1);
                
                // Calculate totals and sort by total score to determine ranks
                const ranked = nums.map((num) => {
                    const ps = event.scores.filter((s) => s.participant_number === num);
                    const total = ps.reduce((sum, s) => sum + s.score, 0);
                    const avg = ps.length > 0 ? total / ps.length : 0;
                    return { num, total, avg, hasScores: ps.length > 0 };
                }).filter(r => r.hasScores).sort((a, b) => b.total - a.total);
                
                // Assign rank points (handling ties)
                let currentRank = 1;
                let prevTotal = -1;
                ranked.forEach((res, index) => {
                    if (index > 0 && res.total < prevTotal) {
                        currentRank = index + 1;
                    }
                    prevTotal = res.total;
                    
                    // Rank points: 1st=5, 2nd=3, 3rd=1
                    let rankPoints = 0;
                    if (currentRank === 1) rankPoints = 5;
                    else if (currentRank === 2) rankPoints = 3;
                    else if (currentRank === 3) rankPoints = 1;
                    
                    // Grade points: A(≥80)=5, B(≥60)=3, C(<60)=1
                    let gradePoints = 0;
                    if (res.avg >= 80) gradePoints = 5;
                    else if (res.avg >= 60) gradePoints = 3;
                    else gradePoints = 1;
                    
                    const totalPoints = rankPoints + gradePoints;
                    
                    const mapping = mappings.find(m => m.event_id === event.id && m.participant_number === res.num);
                    if (mapping) {
                        const part = participants.find(p => p.id === mapping.participant_id);
                        if (part && part.team_id) {
                            const cur = stand.get(part.team_id);
                            if (cur) {
                                if (normCat) {
                                    cur.categoryPoints[normCat] = (cur.categoryPoints[normCat] || 0) + totalPoints;
                                }
                                cur.overallPoints += totalPoints;
                            }
                        }
                    }
                });
            });
        });
        
        return Array.from(stand.entries()).map(([teamId, data]) => {
            const team = teams.find(t => t.id === teamId);
            let points = data.overallPoints;
            if (selectedCat !== 'overall') {
                points = data.categoryPoints[selectedCat] || 0;
            }
            return {
                id: teamId,
                name: team ? team.name : 'Unknown Team',
                points,
                categoryPoints: data.categoryPoints,
                overallPoints: data.overallPoints
            };
        }).sort((a, b) => b.points - a.points);
    };

    const calculateIndividualStandings = (selectedCat: string = 'overall') => {
        const stand = new Map<string, { categoryPoints: Record<string, number>; overallPoints: number }>();
        participants.forEach(p => stand.set(p.id, { categoryPoints: {}, overallPoints: 0 }));
        
        rooms.forEach(room => {
            room.events.forEach(event => {
                const normCat = event.category ? normalizeCategoryName(event.category) : '';
                const nums = Array.from({ length: event.participant_count }, (_, i) => i + 1);
                
                // Calculate totals and sort by total score to determine ranks
                const ranked = nums.map((num) => {
                    const ps = event.scores.filter((s) => s.participant_number === num);
                    const total = ps.reduce((sum, s) => sum + s.score, 0);
                    const avg = ps.length > 0 ? total / ps.length : 0;
                    return { num, total, avg, hasScores: ps.length > 0 };
                }).filter(r => r.hasScores).sort((a, b) => b.total - a.total);
                
                // Assign rank points (handling ties)
                let currentRank = 1;
                let prevTotal = -1;
                ranked.forEach((res, index) => {
                    if (index > 0 && res.total < prevTotal) {
                        currentRank = index + 1;
                    }
                    prevTotal = res.total;
                    
                    // Rank points: 1st=5, 2nd=3, 3rd=1
                    let rankPoints = 0;
                    if (currentRank === 1) rankPoints = 5;
                    else if (currentRank === 2) rankPoints = 3;
                    else if (currentRank === 3) rankPoints = 1;
                    
                    // Grade points: A(≥80)=5, B(≥60)=3, C(<60)=1
                    let gradePoints = 0;
                    if (res.avg >= 80) gradePoints = 5;
                    else if (res.avg >= 60) gradePoints = 3;
                    else gradePoints = 1;
                    
                    const totalPoints = rankPoints + gradePoints;
                    
                    const mapping = mappings.find(m => m.event_id === event.id && m.participant_number === res.num);
                    if (mapping) {
                        const cur = stand.get(mapping.participant_id);
                        if (cur) {
                            if (normCat) {
                                cur.categoryPoints[normCat] = (cur.categoryPoints[normCat] || 0) + totalPoints;
                            }
                            cur.overallPoints += totalPoints;
                        }
                    }
                });
            });
        });
        
        return Array.from(stand.entries()).map(([partId, data]) => {
            const part = participants.find(p => p.id === partId);
            let points = data.overallPoints;
            if (selectedCat !== 'overall') {
                points = data.categoryPoints[selectedCat] || 0;
            }
            return {
                id: partId,
                name: part ? part.name : 'Unknown Participant',
                chestNumber: part ? part.chest_number : '',
                teamName: part && part.team_id ? teams.find(t => t.id === part.team_id)?.name || '' : '',
                points,
                categoryPoints: data.categoryPoints,
                overallPoints: data.overallPoints
            };
        }).sort((a, b) => b.points - a.points);
    };

    const totalJudges = rooms.reduce((s, r) => s + r.judges.length, 0);
    const totalEvents = rooms.reduce((s, r) => s + r.events.length, 0);
    const totalScores = rooms.reduce((s, r) => s + r.events.reduce((es, ev) => es + ev.scores.length, 0), 0);
    const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null;
    const initials = userEmail.charAt(0).toUpperCase();

    if (!authReady || loading) {
        return (
            <div className="loading-screen">
                <div className="spinner" />
                <p>{!authReady ? 'Verifying access…' : 'Loading dashboard…'}</p>
            </div>
        );
    }

    return (
        <div className="page-layout">
            {/* Mobile overlay */}
            <AnimatePresence>
                {sidebarOpen && (
                    <motion.div
                        className="sidebar-overlay"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={() => setSidebarOpen(false)}
                    />
                )}
            </AnimatePresence>

            {/* ──── SIDEBAR ──── */}
            <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
                {/* Gradient header */}
                <div className="sidebar-header">
                    <div className="sidebar-logo-icon" style={{ background: 'white', padding: 4 }}>
                        <img src="/logo/logo.png" alt="MiladOne Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </div>
                    <div>
                        <div className="sidebar-logo-text">Milad<span>One</span></div>
                        {institutionName && (
                            <div style={{ fontSize: '0.7rem', opacity: 0.85, marginTop: 2, fontWeight: 600, color: '#FFFFFF' }}>
                                {institutionName}
                            </div>
                        )}
                    </div>
                </div>

                <nav className="sidebar-nav">
                    <div className="sidebar-section-title">Navigation</div>

                    <button id="sidebar-overview" className={`sidebar-item ${!selectedRoomId && selectedView === 'overview' ? 'active' : ''}`}
                        onClick={() => selectView('overview')}>
                        <span style={{ fontSize: '1rem' }}>🏠</span>
                        <span className="flex-1">Overview</span>
                    </button>

                    <button id="sidebar-teams" className={`sidebar-item ${!selectedRoomId && selectedView === 'teams' ? 'active' : ''}`}
                        onClick={() => selectView('teams')}>
                        <span style={{ fontSize: '1rem' }}>🛡️</span>
                        <span className="flex-1">Manage Teams</span>
                    </button>

                    <button id="sidebar-participants" className={`sidebar-item ${!selectedRoomId && selectedView === 'participants' ? 'active' : ''}`}
                        onClick={() => selectView('participants')}>
                        <span style={{ fontSize: '1rem' }}>👤</span>
                        <span className="flex-1">Manage Participants</span>
                    </button>

                    <button id="sidebar-championship" className={`sidebar-item ${!selectedRoomId && selectedView === 'championship' ? 'active' : ''}`}
                        onClick={() => selectView('championship')}>
                        <span style={{ fontSize: '1rem' }}>🛡️</span>
                        <span className="flex-1">Team Standing</span>
                    </button>

                    <button id="sidebar-individual" className={`sidebar-item ${!selectedRoomId && selectedView === 'individual' ? 'active' : ''}`}
                        onClick={() => selectView('individual')}>
                        <span style={{ fontSize: '1rem' }}>🥇</span>
                        <span className="flex-1">Individual Standing</span>
                    </button>

                    {rooms.length > 0 && (
                        <>
                            <div className="sidebar-section-title" style={{ marginTop: 16 }}>Rooms</div>
                            {rooms.map((room) => {
                                const full = room.judges.length >= room.judge_count_required;
                                return (
                                    <motion.button
                                        key={room.id}
                                        id={`sidebar-room-${room.id}`}
                                        className={`sidebar-item ${selectedRoomId === room.id ? 'active' : ''}`}
                                        onClick={() => selectRoom(room.id)}
                                        whileHover={{ x: 2 }}
                                        transition={{ duration: 0.15 }}
                                    >
                                        <span
                                            className="sidebar-item-dot"
                                            style={{ background: full ? 'var(--success)' : 'var(--warning)' }}
                                        />
                                        <span className="flex-1 truncate"
                                            style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.85rem' }}>
                                            {room.secret_code}
                                        </span>
                                        <span className="sidebar-count">
                                            {room.judges.length}/{room.judge_count_required}
                                        </span>
                                    </motion.button>
                                );
                            })}
                        </>
                    )}
                </nav>

                {/* Footer */}
                <div className="sidebar-footer">
                    <div className="sidebar-user">
                        <div className="sidebar-avatar">{initials}</div>
                        <div className="sidebar-email">{userEmail}</div>
                    </div>
                    <motion.button id="btn-signout" onClick={handleSignOut}
                        className="btn btn-secondary btn-sm btn-full" whileTap={{ scale: 0.97 }}>
                        Sign Out
                    </motion.button>
                </div>
            </aside>

            {/* ──── MAIN ──── */}
            <main className="main-content" style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Header */}
                <header className="main-header">
                    <div className="flex items-c gap-3">
                        <button className="hamburger" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
                            <span /><span /><span />
                        </button>
                        <div>
                            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                                {selectedRoom ? selectedRoom.secret_code : (institutionName || 'Admin Dashboard')}
                            </h3>
                            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                {selectedRoom ? `${selectedRoom.judges.length} judge(s) joined` : 'Manage rooms and monitor scoring'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-c gap-3">
                        <span className="live-badge">LIVE</span>
                        <span className="badge badge-yellow hide-sm">Admin</span>
                    </div>
                </header>

                {/* Body */}
                <div className="main-body">
                    <AnimatePresence mode="wait">
                        {/* ── OVERVIEW ── */}
                        {!selectedRoom && selectedView === 'overview' && (
                            <motion.div key="overview" variants={stagger} initial="hidden" animate="show">
                                {/* Stats */}
                                <motion.div
                                    className="grid-4"
                                    variants={stagger}
                                    style={{ marginBottom: 28 }}
                                >
                                    {[
                                        { icon: '🏠', label: 'Total Rooms', value: rooms.length, color: '#EEF2FF', ico: '#6366F1' },
                                        { icon: '⚖️', label: 'Total Judges', value: totalJudges, color: '#ECFDF5', ico: '#059669' },
                                        { icon: '📋', label: 'Total Events', value: totalEvents, color: '#FFF7ED', ico: '#F97316' },
                                        { icon: '✅', label: 'Score Entries', value: totalScores, color: '#F0FDF4', ico: '#10B981' },
                                    ].map((s) => (
                                        <motion.div key={s.label} className="stat-card" variants={fadeUp}>
                                            <div className="stat-icon" style={{ background: s.color }}>
                                                <span>{s.icon}</span>
                                            </div>
                                            <div className="stat-value">{s.value}</div>
                                            <div className="stat-label">{s.label}</div>
                                        </motion.div>
                                    ))}
                                </motion.div>

                                {/* Create room */}
                                <motion.div className="card" variants={fadeUp} style={{ marginBottom: 24 }}>
                                    <div className="card-header">
                                        <div>
                                            <h3>Create New Room</h3>
                                            <p className="text-xs col-muted mt-1">A unique 6-character code is auto-generated for judges to join.</p>
                                        </div>
                                    </div>
                                    <div className="card-body">
                                        <div className="flex items-c gap-4" style={{ flexWrap: 'wrap' }}>
                                            <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
                                                <label className="form-label">Judges Required</label>
                                                <select id="select-judge-count" className="select"
                                                    value={newRoomJudgeCount}
                                                    onChange={(e) => setNewRoomJudgeCount(Number(e.target.value) as 2 | 3)}>
                                                    <option value={2}>2 Judges</option>
                                                    <option value={3}>3 Judges</option>
                                                </select>
                                            </div>
                                            <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
                                                <label className="form-label">Participant Code Style</label>
                                                <select className="select"
                                                    value={newRoomCodeType}
                                                    onChange={(e) => setNewRoomCodeType(e.target.value as 'number' | 'letter')}>
                                                    <option value="number">Numbers (1, 2, 3...)</option>
                                                    <option value="letter">Letters (A, B, C...)</option>
                                                </select>
                                            </div>
                                            <motion.button
                                                id="btn-create-room"
                                                onClick={handleCreateRoom}
                                                disabled={creating}
                                                className="btn btn-primary"
                                                style={{ alignSelf: 'flex-end', height: 40 }}
                                                whileHover={{ scale: 1.02 }}
                                                whileTap={{ scale: 0.97 }}
                                            >
                                                {creating
                                                    ? <><div className="spinner spinner-sm spinner-white" /> Creating…</>
                                                    : '+ Create Room'}
                                            </motion.button>
                                        </div>
                                    </div>
                                </motion.div>

                                {/* Rooms table */}
                                <motion.div className="card" variants={fadeUp}>
                                    <div className="card-header">
                                        <h3>All Rooms</h3>
                                        <span className="badge badge-gray">{rooms.length}</span>
                                    </div>
                                    <div className="table-wrap">
                                        <table className="table">
                                            <thead>
                                                <tr>
                                                    <th>Code</th>
                                                    <th>Judges</th>
                                                    <th>Events</th>
                                                    <th>Scores</th>
                                                    <th>Created</th>
                                                    <th></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rooms.length === 0 ? (
                                                    <tr><td colSpan={6}>
                                                        <div className="empty-state">
                                                            <div className="empty-state-icon">🏠</div>
                                                            <h4>No rooms yet</h4>
                                                            <p>Create your first room above to get started.</p>
                                                        </div>
                                                    </td></tr>
                                                ) : rooms.map((room) => (
                                                    <tr key={room.id}>
                                                        <td>
                                                            <button className="room-code" onClick={() => copyCode(room.secret_code)} title="Click to copy">
                                                                {room.secret_code} <span style={{ fontSize: 10 }}>⎘</span>
                                                            </button>
                                                        </td>
                                                        <td>
                                                            <strong>{room.judges.length}</strong>
                                                            <span className="col-muted"> / {room.judge_count_required}</span>
                                                            {room.judges.length >= room.judge_count_required &&
                                                                <span className="badge badge-green" style={{ marginLeft: 6 }}>Full</span>}
                                                        </td>
                                                        <td><strong>{room.events.length}</strong></td>
                                                        <td><strong>{room.events.reduce((s, e) => s + e.scores.length, 0)}</strong></td>
                                                        <td className="col-muted">{new Date(room.created_at).toLocaleDateString()}</td>
                                                        <td>
                                                            <div className="flex gap-2">
                                                                <button className="btn btn-ghost btn-sm"
                                                                    onClick={() => selectRoom(room.id)}>View →</button>
                                                                <button className="btn btn-ghost btn-sm text-danger"
                                                                    onClick={() => setConfirmDeleteRoom(room.id)}
                                                                    title="Delete Room">
                                                                    🗑️
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </motion.div>
                            </motion.div>
                        )}

                        {/* ── TEAMS MANAGEMENT ── */}
                        {!selectedRoom && selectedView === 'teams' && (
                            <motion.div key="teams" variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, alignItems: 'start' }}>
                                    {/* Create Team Card */}
                                    <motion.div className="card" variants={fadeUp}>
                                        <div className="card-header">
                                            <h3>🛡️ Create New Team</h3>
                                            <p className="text-xs col-muted mt-1">Teams group participants for the overall championship.</p>
                                        </div>
                                        <div className="card-body">
                                            <form onSubmit={handleCreateTeam}>
                                                <div className="form-group mb-4">
                                                    <label className="form-label">Team Name</label>
                                                    <input
                                                        type="text"
                                                        className="input"
                                                        placeholder="e.g. Red House, Blue Panthers"
                                                        value={newTeamName}
                                                        onChange={(e) => setNewTeamName(e.target.value)}
                                                        required
                                                    />
                                                </div>
                                                <button type="submit" className="btn btn-primary btn-full">
                                                    + Add Team
                                                </button>
                                            </form>
                                        </div>
                                    </motion.div>

                                    {/* Teams Directory Card */}
                                    <motion.div className="card" variants={fadeUp}>
                                        <div className="card-header">
                                            <h3>🛡️ Registered Teams</h3>
                                            <span className="badge badge-gray">{teams.length}</span>
                                        </div>
                                        <div className="table-wrap">
                                            <table className="table">
                                                <thead>
                                                    <tr>
                                                        <th>Team Name</th>
                                                        <th>Members</th>
                                                        <th style={{ width: 120 }}>Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {teams.length === 0 ? (
                                                        <tr>
                                                            <td colSpan={3}>
                                                                <div className="empty-state">
                                                                    <p>No teams created yet.</p>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        teams.map((team) => (
                                                            <tr key={team.id}>
                                                                <td>
                                                                    {editingTeamId === team.id ? (
                                                                        <input
                                                                            type="text"
                                                                            className="input input-sm"
                                                                            value={editingTeamName}
                                                                            onChange={(e) => setEditingTeamName(e.target.value)}
                                                                            onKeyDown={(e) => {
                                                                                if (e.key === 'Enter') handleSaveTeamRename(team.id);
                                                                                else if (e.key === 'Escape') setEditingTeamId(null);
                                                                            }}
                                                                            autoFocus
                                                                        />
                                                                    ) : (
                                                                        <strong>{team.name}</strong>
                                                                    )}
                                                                </td>
                                                                <td>
                                                                    <span className="badge badge-gray">
                                                                        {getParticipantCount(team.id)} members
                                                                    </span>
                                                                </td>
                                                                <td>
                                                                    <div className="flex gap-2">
                                                                        {editingTeamId === team.id ? (
                                                                            <>
                                                                                <button className="btn btn-ghost btn-sm text-success" onClick={() => handleSaveTeamRename(team.id)}>✓</button>
                                                                                <button className="btn btn-ghost btn-sm col-muted" onClick={() => setEditingTeamId(null)}>✗</button>
                                                                            </>
                                                                        ) : (
                                                                            <>
                                                                                <button className="btn btn-ghost btn-sm" onClick={() => {
                                                                                    setEditingTeamId(team.id);
                                                                                    setEditingTeamName(team.name);
                                                                                }}>✏️</button>
                                                                                <button className="btn btn-ghost btn-sm text-danger" onClick={() => handleDeleteTeam(team.id)}>🗑️</button>
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </motion.div>
                                </div>
                            </motion.div>
                        )}

                        {/* ── PARTICIPANTS MANAGEMENT ── */}
                        {!selectedRoom && selectedView === 'participants' && (
                            <motion.div key="participants" variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, alignItems: 'start' }}>
                                    {/* Create Participant Card */}
                                    <motion.div className="card" variants={fadeUp}>
                                        <div className="card-header">
                                            <h3>👤 Add New Participant</h3>
                                            <p className="text-xs col-muted mt-1">Register a competitor with a permanent chest number.</p>
                                        </div>
                                        <div className="card-body">
                                            <form onSubmit={handleCreateParticipant}>
                                                <div className="form-group mb-3">
                                                    <label className="form-label">Full Name</label>
                                                    <input
                                                        type="text"
                                                        className="input"
                                                        placeholder="e.g. John Doe"
                                                        value={newPartName}
                                                        onChange={(e) => setNewPartName(e.target.value)}
                                                        required
                                                    />
                                                </div>
                                                <div className="form-group mb-3">
                                                    <label className="form-label">Chest Number</label>
                                                    <input
                                                        type="text"
                                                        className="input"
                                                        placeholder="e.g. C101"
                                                        style={{ textTransform: 'uppercase' }}
                                                        value={newPartChest}
                                                        onChange={(e) => setNewPartChest(e.target.value)}
                                                        required
                                                    />
                                                </div>
                                                <div className="form-group mb-4">
                                                    <label className="form-label">Assign Team</label>
                                                    <select
                                                        className="select"
                                                        value={newPartTeamId}
                                                        onChange={(e) => setNewPartTeamId(e.target.value)}
                                                    >
                                                        <option value="">No Team</option>
                                                        {teams.map((t) => (
                                                            <option key={t.id} value={t.id}>{t.name}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <button type="submit" className="btn btn-primary btn-full">
                                                    + Add Participant
                                                </button>
                                            </form>
                                        </div>
                                    </motion.div>

                                    {/* Bulk Import Card */}
                                    <motion.div className="card" variants={fadeUp}>
                                        <div className="card-header">
                                            <h3>📋 Bulk Import Participants</h3>
                                            <p className="text-xs col-muted mt-1">Paste CSV/TSV data below. Format: <code>Name, ChestNumber, TeamName</code> (one per line).</p>
                                        </div>
                                        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                            <textarea
                                                className="input"
                                                style={{ fontFamily: 'monospace', fontSize: '0.8rem', minHeight: 140, resize: 'vertical' }}
                                                placeholder="John Doe, C101, Red House&#10;Jane Smith, C102, Blue House&#10;Alice Johnson, C103, Red House"
                                                value={bulkImportText}
                                                onChange={(e) => setBulkImportText(e.target.value)}
                                            />
                                            <button
                                                className="btn btn-secondary btn-full"
                                                onClick={handleBulkImport}
                                                disabled={importing || !bulkImportText.trim()}
                                            >
                                                {importing ? <div className="spinner spinner-sm spinner-white" /> : 'Process Import'}
                                            </button>
                                        </div>
                                    </motion.div>
                                </div>

                                {/* Participants Directory Card */}
                                <motion.div className="card" variants={fadeUp}>
                                    <div className="card-header flex just-b items-c" style={{ flexWrap: 'wrap', gap: 12 }}>
                                        <div>
                                            <h3>👤 Participant Registry</h3>
                                            <span className="badge badge-gray">{participants.length}</span>
                                        </div>
                                        <div className="form-group" style={{ margin: 0, minWidth: 200 }}>
                                            <input
                                                type="text"
                                                className="input input-sm"
                                                placeholder="🔍 Search name or chest number..."
                                                value={partSearch}
                                                onChange={(e) => setPartSearch(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <div className="table-wrap">
                                        <table className="table">
                                            <thead>
                                                <tr>
                                                    <th style={{ width: 150 }}>Chest Number</th>
                                                    <th>Full Name</th>
                                                    <th>Team</th>
                                                    <th style={{ width: 120 }}>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(() => {
                                                    const filtered = participants.filter((p) => {
                                                        const q = partSearch.toLowerCase();
                                                        return (
                                                            p.name.toLowerCase().includes(q) ||
                                                            p.chest_number.toLowerCase().includes(q)
                                                        );
                                                    });
                                                    if (filtered.length === 0) {
                                                        return (
                                                            <tr>
                                                                <td colSpan={4}>
                                                                    <div className="empty-state">
                                                                        <p>No matching participants found.</p>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    }
                                                    return filtered.map((part) => {
                                                        const isEditing = editingPartId === part.id;
                                                        const pTeam = teams.find((t) => t.id === (isEditing ? editingPartTeamId : part.team_id));
                                                        return (
                                                            <tr key={part.id}>
                                                                <td>
                                                                    {isEditing ? (
                                                                        <input
                                                                            type="text"
                                                                            className="input input-sm"
                                                                            style={{ textTransform: 'uppercase' }}
                                                                            value={editingPartChest}
                                                                            onChange={(e) => setEditingPartChest(e.target.value)}
                                                                        />
                                                                    ) : (
                                                                        <span className="room-code" style={{ padding: '4px 8px', fontSize: '0.8rem' }}>
                                                                            {part.chest_number}
                                                                        </span>
                                                                    )}
                                                                </td>
                                                                <td>
                                                                    {isEditing ? (
                                                                        <input
                                                                            type="text"
                                                                            className="input input-sm"
                                                                            value={editingPartName}
                                                                            onChange={(e) => setEditingPartName(e.target.value)}
                                                                        />
                                                                    ) : (
                                                                        <strong>{part.name}</strong>
                                                                    )}
                                                                </td>
                                                                <td>
                                                                    {isEditing ? (
                                                                        <select
                                                                            className="select select-sm"
                                                                            value={editingPartTeamId}
                                                                            onChange={(e) => setEditingPartTeamId(e.target.value)}
                                                                        >
                                                                            <option value="">No Team</option>
                                                                            {teams.map((t) => (
                                                                                <option key={t.id} value={t.id}>{t.name}</option>
                                                                            ))}
                                                                        </select>
                                                                    ) : (
                                                                        <span className={part.team_id ? 'badge badge-yellow' : 'badge badge-gray'}>
                                                                            {pTeam ? pTeam.name : 'No Team'}
                                                                        </span>
                                                                    )}
                                                                </td>
                                                                <td>
                                                                    <div className="flex gap-2">
                                                                        {isEditing ? (
                                                                            <>
                                                                                <button className="btn btn-ghost btn-sm text-success" onClick={() => handleSavePartEdit(part.id)}>✓</button>
                                                                                <button className="btn btn-ghost btn-sm col-muted" onClick={() => setEditingPartId(null)}>✗</button>
                                                                            </>
                                                                        ) : (
                                                                            <>
                                                                                <button className="btn btn-ghost btn-sm" onClick={() => {
                                                                                    setEditingPartId(part.id);
                                                                                    setEditingPartName(part.name);
                                                                                    setEditingPartChest(part.chest_number);
                                                                                    setEditingPartTeamId(part.team_id || '');
                                                                                }}>✏️</button>
                                                                                <button className="btn btn-ghost btn-sm text-danger" onClick={() => handleDeleteParticipant(part.id)}>🗑️</button>
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    });
                                                })()}
                                            </tbody>
                                        </table>
                                    </div>
                                </motion.div>
                            </motion.div>
                        )}

                        {/* ── TEAM STANDINGS ── */}
                        {!selectedRoom && selectedView === 'championship' && (() => {
                            const categories = getAvailableCategories();
                            const standings = calculateTeamStandings(championshipCategory);
                            const championTeam = standings.length > 0 && standings[0].points > 0 ? standings[0] : null;
                            
                            return (
                                <motion.div key="championship" variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                    {/* Category Select Buttons */}
                                    <div style={{
                                        display: 'flex',
                                        gap: 8,
                                        overflowX: 'auto',
                                        paddingBottom: 8,
                                        scrollbarWidth: 'none',
                                        msOverflowStyle: 'none',
                                    }} className="category-scrollbar">
                                        <button
                                            className={`btn btn-sm ${championshipCategory === 'overall' ? 'btn-primary' : 'btn-secondary'}`}
                                            style={{ whiteSpace: 'nowrap' }}
                                            onClick={() => setChampionshipCategory('overall')}
                                        >
                                            Overall Standing
                                        </button>
                                        {categories.map((cat) => (
                                            <button
                                                key={cat}
                                                className={`btn btn-sm ${championshipCategory === cat ? 'btn-primary' : 'btn-secondary'}`}
                                                style={{ whiteSpace: 'nowrap' }}
                                                onClick={() => setChampionshipCategory(cat)}
                                            >
                                                {cat} Standing
                                            </button>
                                        ))}
                                    </div>
 
                                    {/* Champion Spotlight Banner */}
                                    {championTeam && (
                                        <motion.div 
                                            initial={{ opacity: 0, y: -10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            style={{
                                                background: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)',
                                                border: '1px solid #FCD34D',
                                                borderRadius: 'var(--r-md)',
                                                padding: '16px 20px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 16,
                                                boxShadow: '0 4px 6px -1px rgba(251, 191, 36, 0.1), 0 2px 4px -1px rgba(251, 191, 36, 0.06)'
                                            }}
                                        >
                                            <div>
                                                <h4 style={{ color: '#92400E', fontWeight: 800, margin: 0, fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                    {championshipCategory === 'overall' ? 'Overall Championship Leader' : `${championshipCategory} Category Champion`}
                                                </h4>
                                                <p style={{ color: '#B45309', fontWeight: 600, fontSize: '1.25rem', margin: '4px 0 0 0' }}>
                                                    {championTeam.name} <span style={{ fontSize: '0.95rem', fontWeight: 500, opacity: 0.9 }}>with {championTeam.points} Points</span>
                                                </p>
                                            </div>
                                        </motion.div>
                                    )}
 
                                    {/* Standings Table Card */}
                                    <motion.div className="card" variants={fadeUp}>
                                        <div className="card-header flex just-b items-c">
                                            <h3>
                                                {championshipCategory === 'overall' ? 'Team Championship Leaderboard' : `${championshipCategory} Category Leaderboard`}
                                            </h3>
                                            <span className="live-badge">LIVE</span>
                                        </div>
                                        <div className="table-wrap">
                                            <table className="table">
                                                <thead>
                                                    <tr>
                                                        <th style={{ width: 80 }}>Rank</th>
                                                        <th>Team Name</th>
                                                        <th style={{ textAlign: 'right', width: 160 }}>
                                                            {championshipCategory === 'overall' ? 'Total Points' : 'Category Points'}
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {standings.map((t, idx) => {
                                                        const medal = idx + 1;
                                                        return (
                                                            <tr key={t.id}>
                                                                <td><strong>{medal}</strong></td>
                                                                <td>
                                                                    <div>
                                                                        <strong style={{ fontSize: '1.05rem', color: 'var(--text-primary)' }}>{t.name}</strong>
                                                                        {/* Category Breakdown (only visible on Overall view) */}
                                                                        {championshipCategory === 'overall' && (
                                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                                                                                {categories.map(cat => {
                                                                                    const pts = t.categoryPoints[cat] || 0;
                                                                                    if (pts === 0) return null;
                                                                                    return (
                                                                                        <span key={cat} style={{
                                                                                            fontSize: '0.7rem',
                                                                                            background: 'var(--bg-muted)',
                                                                                            color: 'var(--text-secondary)',
                                                                                            padding: '2px 6px',
                                                                                            borderRadius: '4px',
                                                                                            border: '1px solid var(--border)',
                                                                                            fontWeight: 600
                                                                                        }}>
                                                                                            {cat}: {pts} pts
                                                                                        </span>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                                <td style={{ textAlign: 'right' }}>
                                                                    <strong style={{ color: 'var(--primary)', fontSize: '1.2rem' }}>
                                                                        {t.points} Points
                                                                    </strong>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                    {teams.length === 0 && (
                                                        <tr>
                                                            <td colSpan={3}>
                                                                <div className="empty-state">
                                                                    <div className="empty-state-icon">🏆</div>
                                                                    <h4>No teams registered</h4>
                                                                    <p>Go to "Manage Teams" to add teams first.</p>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </motion.div>
                                </motion.div>
                            );
                        })()}

                        {/* ── INDIVIDUAL STANDINGS ── */}
                        {!selectedRoom && selectedView === 'individual' && (() => {
                            const categories = getAvailableCategories();
                            const standings = calculateIndividualStandings(individualCategory);
                            const champion = standings.length > 0 && standings[0].points > 0 ? standings[0] : null;
                            
                            return (
                                <motion.div key="individual" variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                    {/* Category Select Buttons */}
                                    <div style={{
                                        display: 'flex',
                                        gap: 8,
                                        overflowX: 'auto',
                                        paddingBottom: 8,
                                        scrollbarWidth: 'none',
                                        msOverflowStyle: 'none',
                                    }} className="category-scrollbar">
                                        <button
                                            className={`btn btn-sm ${individualCategory === 'overall' ? 'btn-primary' : 'btn-secondary'}`}
                                            style={{ whiteSpace: 'nowrap' }}
                                            onClick={() => setIndividualCategory('overall')}
                                        >
                                            Overall Individual
                                        </button>
                                        {categories.map((cat) => (
                                            <button
                                                key={cat}
                                                className={`btn btn-sm ${individualCategory === cat ? 'btn-primary' : 'btn-secondary'}`}
                                                style={{ whiteSpace: 'nowrap' }}
                                                onClick={() => setIndividualCategory(cat)}
                                            >
                                                {cat}
                                            </button>
                                        ))}
                                    </div>
 
                                    {/* Champion Spotlight Banner */}
                                    {champion && (
                                        <motion.div 
                                            initial={{ opacity: 0, y: -10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            style={{
                                                background: 'linear-gradient(135deg, #DBEAFE 0%, #BFDBFE 100%)',
                                                border: '1px solid #93C5FD',
                                                borderRadius: 'var(--r-md)',
                                                padding: '16px 20px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 16,
                                                boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.1), 0 2px 4px -1px rgba(59, 130, 246, 0.06)'
                                            }}
                                        >
                                            <div>
                                                <h4 style={{ color: '#1E40AF', fontWeight: 800, margin: 0, fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                    {individualCategory === 'overall' ? 'Overall Individual Champion' : `${individualCategory} Category Individual Champion`}
                                                </h4>
                                                <p style={{ color: '#1D4ED8', fontWeight: 600, fontSize: '1.25rem', margin: '4px 0 0 0' }}>
                                                    {champion.name}
                                                    {champion.chestNumber && <span style={{ fontSize: '0.85rem', fontWeight: 500, opacity: 0.8 }}> (#{champion.chestNumber})</span>}
                                                    {champion.teamName && <span style={{ fontSize: '0.85rem', fontWeight: 500, opacity: 0.7 }}> — {champion.teamName}</span>}
                                                    <span style={{ fontSize: '0.95rem', fontWeight: 500, opacity: 0.9 }}> with {champion.points} Points</span>
                                                </p>
                                            </div>
                                        </motion.div>
                                    )}
 
                                    {/* Individual Standings Table */}
                                    <motion.div className="card" variants={fadeUp}>
                                        <div className="card-header flex just-b items-c">
                                            <h3>
                                                {individualCategory === 'overall' ? 'Individual Championship Leaderboard' : `${individualCategory} Individual Leaderboard`}
                                            </h3>
                                            <span className="live-badge">LIVE</span>
                                        </div>
                                        <div className="table-wrap">
                                            <table className="table">
                                                <thead>
                                                    <tr>
                                                        <th style={{ width: 70 }}>Rank</th>
                                                        <th>Participant</th>
                                                        <th>Chest No.</th>
                                                        <th>Team</th>
                                                        <th style={{ textAlign: 'right', width: 140 }}>
                                                            {individualCategory === 'overall' ? 'Total Points' : 'Category Points'}
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {standings.filter(s => s.points > 0).map((s, idx) => {
                                                        const medal = idx + 1;
                                                        return (
                                                            <tr key={s.id}>
                                                                <td><strong>{medal}</strong></td>
                                                                <td>
                                                                    <div>
                                                                        <strong style={{ fontSize: '1.02rem', color: 'var(--text-primary)' }}>{s.name}</strong>
                                                                        {/* Category Breakdown (only visible on Overall view) */}
                                                                        {individualCategory === 'overall' && (
                                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 5 }}>
                                                                                {categories.map(cat => {
                                                                                    const pts = s.categoryPoints[cat] || 0;
                                                                                    if (pts === 0) return null;
                                                                                    return (
                                                                                        <span key={cat} style={{
                                                                                            fontSize: '0.68rem',
                                                                                            background: 'var(--bg-muted)',
                                                                                            color: 'var(--text-secondary)',
                                                                                            padding: '2px 6px',
                                                                                            borderRadius: '4px',
                                                                                            border: '1px solid var(--border)',
                                                                                            fontWeight: 600
                                                                                        }}>
                                                                                            {cat}: {pts} pts
                                                                                        </span>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                                <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{s.chestNumber || '—'}</td>
                                                                <td>{s.teamName || <span style={{ opacity: 0.4 }}>No Team</span>}</td>
                                                                <td style={{ textAlign: 'right' }}>
                                                                    <strong style={{ color: 'var(--primary)', fontSize: '1.15rem' }}>
                                                                        {s.points}
                                                                    </strong>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                    {standings.filter(s => s.points > 0).length === 0 && (
                                                        <tr>
                                                            <td colSpan={5}>
                                                                <div className="empty-state">
                                                                    <div className="empty-state-icon">🥇</div>
                                                                    <h4>No individual scores yet</h4>
                                                                    <p>Points will appear here once participants are mapped and scored in events.</p>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </motion.div>
                                </motion.div>
                            );
                        })()}

                        {/* ── ROOM DETAIL ── */}
                        {selectedRoom && (
                            <motion.div key={selectedRoom.id}
                                initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -16 }}
                                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                            >
                                {/* Room header card */}
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                                    gap: 12, marginBottom: 20,
                                }}>
                                    {[
                                        { label: 'Room Code', value: <button className="room-code" onClick={() => copyCode(selectedRoom.secret_code)}>{selectedRoom.secret_code} ⎘</button> },
                                        { label: 'Judges Joined', value: <strong style={{ fontSize: '1.3rem' }}>{selectedRoom.judges.length} / {selectedRoom.judge_count_required}</strong> },
                                        { label: 'Events', value: <strong style={{ fontSize: '1.3rem' }}>{selectedRoom.events.length}</strong> },
                                        { label: 'Score Entries', value: <strong style={{ fontSize: '1.3rem' }}>{selectedRoom.events.reduce((s, e) => s + e.scores.length, 0)}</strong> },
                                    ].map((item) => (
                                        <div key={item.label} style={{
                                            background: 'white', border: '1px solid var(--border)',
                                            borderRadius: 'var(--r-md)', padding: '14px 16px',
                                            boxShadow: 'var(--shadow-xs)',
                                        }}>
                                            <div className="text-xs col-muted font-600" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                                                {item.label}
                                            </div>
                                            <div>{item.value}</div>
                                        </div>
                                    ))}
                                </div>

                                {/* Tab bar */}
                                <div style={{
                                    display: 'flex', gap: 4, background: 'var(--bg-muted)',
                                    borderRadius: 'var(--r-sm)', padding: 4, marginBottom: 20,
                                    width: 'fit-content',
                                }}>
                                    {(['overview', 'scores'] as const).map((t) => (
                                        <button key={t}
                                            className={`btn btn-sm ${roomTab === t ? 'btn-primary' : 'btn-ghost'}`}
                                            onClick={() => setRoomTab(t)}>
                                            {t === 'overview' ? '📋 Overview' : '📊 Live Scores'}
                                        </button>
                                    ))}
                                </div>

                                <AnimatePresence mode="wait">
                                    {/* Overview tab */}
                                    {roomTab === 'overview' && (
                                        <motion.div key="overview-tab"
                                            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -10 }}
                                            transition={{ duration: 0.25 }}
                                            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
                                        >
                                            {/* Judges */}
                                            <div className="card">
                                                <div className="card-header">
                                                    <h3>Judges in Room</h3>
                                                    <span className="badge badge-gray">{selectedRoom.judges.length}</span>
                                                </div>
                                                {selectedRoom.judges.length === 0 ? (
                                                    <div className="card-body">
                                                        <div className="empty-state" style={{ padding: '28px 0' }}>
                                                            <p>No judges have joined yet. Share the room code.</p>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="table-wrap">
                                                        <table className="table">
                                                            <thead><tr><th>#</th><th>Email</th><th>Joined</th><th>Actions</th></tr></thead>
                                                            <tbody>
                                                                {selectedRoom.judges.map((j, i) => (
                                                                    <tr key={j.id}>
                                                                        <td><strong>{i + 1}</strong></td>
                                                                        <td><strong>{j.email}</strong></td>
                                                                        <td className="col-muted">{new Date(j.joined_at).toLocaleString()}</td>
                                                                        <td>
                                                                            <button
                                                                                className="btn btn-ghost btn-sm text-danger"
                                                                                onClick={() => setConfirmRemoveJudge({ roomId: selectedRoom.id, judgeId: j.id, email: j.email })}
                                                                            >
                                                                                Remove
                                                                            </button>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Events */}
                                            <div className="card">
                                                <div className="card-header">
                                                    <h3>Events</h3>
                                                    <span className="badge badge-gray">{selectedRoom.events.length}</span>
                                                </div>
                                                {selectedRoom.events.length === 0 ? (
                                                    <div className="card-body">
                                                        <div className="empty-state" style={{ padding: '28px 0' }}>
                                                            <p>No events yet. Judges create events after joining.</p>
                                                        </div>
                                                    </div>
                                                ) : (
                                                <div className="table-wrap">
                                                        <table className="table">
                                                            <thead><tr><th>Event</th><th>Participants</th><th>Score Entries</th><th>Created By</th><th>Date</th><th>Actions</th></tr></thead>
                                                            <tbody>
                                                                {selectedRoom.events.map((ev) => (
                                                                    <tr key={ev.id}>
                                                                        <td>
                                                                            <strong style={{ display: 'block' }}>{ev.event_name}</strong>
                                                                            {ev.category && <span className="badge badge-gray" style={{ marginTop: 4, display: 'inline-block', padding: '2px 6px', fontSize: '0.7rem' }}>{ev.category}</span>}
                                                                        </td>
                                                                        <td>{ev.participant_count}</td>
                                                                        <td>
                                                                            {ev.scores.length}
                                                                            {ev.scores.length > 0 && <span className="badge badge-green" style={{ marginLeft: 6 }}>Live</span>}
                                                                        </td>
                                                                        <td className="col-muted text-xs">{ev.created_by}</td>
                                                                        <td className="col-muted">{new Date(ev.created_at).toLocaleDateString()}</td>
                                                                        <td>
                                                                            <button 
                                                                                className={`btn btn-sm ${mappingEventId === ev.id ? 'btn-primary' : 'btn-ghost'}`}
                                                                                onClick={() => startMapping(ev)}
                                                                            >
                                                                                Mapping ⚙️
                                                                            </button>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Participant Mapping Section */}
                                            {mappingEventId && (() => {
                                                const ev = selectedRoom.events.find(e => e.id === mappingEventId);
                                                if (!ev) return null;
                                                return (
                                                    <div className="card" style={{ marginTop: 16 }}>
                                                        <div className="card-header flex just-b items-c" style={{ flexWrap: 'wrap', gap: 12 }}>
                                                            <div>
                                                                <h3>Code Mapping: {ev.event_name}</h3>
                                                                <p className="text-xs col-muted mt-1">Assign judges' anonymous Codes to actual chest numbers.</p>
                                                            </div>
                                                            <button className="btn btn-secondary btn-sm" onClick={() => setMappingEventId(null)}>Close Mapping</button>
                                                        </div>
                                                        <div className="card-body">
                                                            <div className="table-wrap">
                                                                <table className="table">
                                                                    <thead>
                                                                        <tr>
                                                                            <th style={{ width: 100 }}>Code</th>
                                                                            <th style={{ width: 180 }}>Chest Number</th>
                                                                            <th>Verification Status</th>
                                                                            <th style={{ width: 120 }}>Actions</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {Array.from({ length: ev.participant_count }, (_, i) => i + 1).map((num) => {
                                                                            const val = localMappingInputs[num] || '';
                                                                            const part = val ? participants.find(p => p.chest_number.toLowerCase() === val.trim().toLowerCase()) : null;
                                                                            const isDuplicate = val ? Object.entries(localMappingInputs).some(([k, v]) => Number(k) !== num && v.trim().toLowerCase() === val.trim().toLowerCase()) : false;
                                                                            
                                                                            return (
                                                                                <tr key={num}>
                                                                                    <td><strong>Code {getCodeName(num, selectedRoom.code_type)}</strong></td>
                                                                                    <td>
                                                                                        <input
                                                                                            type="text"
                                                                                            className="input input-sm"
                                                                                            placeholder="e.g. C101"
                                                                                            style={{ textTransform: 'uppercase' }}
                                                                                            value={val}
                                                                                            onChange={(e) => {
                                                                                                const newVal = e.target.value;
                                                                                                setLocalMappingInputs(prev => ({ ...prev, [num]: newVal }));
                                                                                            }}
                                                                                        />
                                                                                    </td>
                                                                                    <td>
                                                                                        {val === '' ? (
                                                                                            <span className="text-xs col-muted">Not mapped</span>
                                                                                        ) : part ? (
                                                                                            isDuplicate ? (
                                                                                                <span className="text-xs text-warning" style={{ fontWeight: 600 }}>
                                                                                                    ⚠️ Duplicate: {part.name} ({teams.find(t => t.id === part.team_id)?.name || 'No Team'})
                                                                                                </span>
                                                                                            ) : (
                                                                                                <span className="text-xs text-success" style={{ fontWeight: 600 }}>
                                                                                                    ✅ {part.name} ({teams.find(t => t.id === part.team_id)?.name || 'No Team'})
                                                                                                </span>
                                                                                            )
                                                                                        ) : (
                                                                                            <span className="text-xs text-danger" style={{ fontWeight: 600 }}>
                                                                                                ❌ Invalid Chest Number
                                                                                            </span>
                                                                                        )}
                                                                                    </td>
                                                                                    <td>
                                                                                        <button
                                                                                            className="btn btn-primary btn-sm"
                                                                                            onClick={() => saveSingleMapping(num, val)}
                                                                                            disabled={val !== '' && (!part || isDuplicate)}
                                                                                        >
                                                                                            Save
                                                                                        </button>
                                                                                    </td>
                                                                                </tr>
                                                                            );
                                                                        })}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </motion.div>
                                    )}

                                    {/* Live Scores tab */}
                                    {roomTab === 'scores' && (
                                        <motion.div key="scores-tab"
                                            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -10 }}
                                            transition={{ duration: 0.25 }}
                                        >
                                            {selectedRoom.events.length === 0 ? (
                                                <div className="card">
                                                    <div className="card-body">
                                                        <div className="empty-state">
                                                            <div className="empty-state-icon">📊</div>
                                                            <h4>No events yet</h4>
                                                            <p>Judges must create events before scores appear here.</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                                    {selectedRoom.events.map((ev) => (
                                                         <EventScoreCard 
                                                             key={ev.id} 
                                                             event={ev} 
                                                             room={selectedRoom} 
                                                             participants={participants}
                                                             teams={teams}
                                                             mappings={mappings}
                                                         />
                                                     ))}
                                                </div>
                                            )}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <Footer />
            </main>

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
                {confirmDeleteRoom && (
                    <div className="sidebar-overlay" style={{ zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                        <motion.div 
                            className="card" 
                            style={{ maxWidth: 400, width: '100%' }}
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                        >
                            <div className="card-header">
                                <h3>Delete Room?</h3>
                            </div>
                            <div className="card-body">
                                <p style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>
                                    Are you sure you want to delete this room? This action cannot be undone and will remove all related judges, events, and scores.
                                </p>
                                <div className="flex gap-3 mt-4">
                                    <button className="btn btn-secondary flex-1" onClick={() => setConfirmDeleteRoom(null)}>Cancel</button>
                                    <button className="btn btn-primary flex-1 bg-danger" onClick={() => handleDeleteRoom(confirmDeleteRoom)}>Delete</button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}

                {confirmRemoveJudge && (
                    <div className="sidebar-overlay" style={{ zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                        <motion.div 
                            className="card" 
                            style={{ maxWidth: 400, width: '100%' }}
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                        >
                            <div className="card-header">
                                <h3>Remove Judge?</h3>
                            </div>
                            <div className="card-body">
                                <p style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>
                                    Are you sure you want to remove <strong>{confirmRemoveJudge.email}</strong> from this room? This will not delete their account.
                                </p>
                                <div className="flex gap-3 mt-4">
                                    <button className="btn btn-secondary flex-1" onClick={() => setConfirmRemoveJudge(null)}>Cancel</button>
                                    <button className="btn btn-primary flex-1 bg-danger" onClick={() => handleRemoveJudge(confirmRemoveJudge.roomId, confirmRemoveJudge.judgeId)}>Remove</button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}

/* ── Event Score Card ── */
function EventScoreCard({ 
    event, 
    room,
    participants,
    teams,
    mappings
}: { 
    event: EventWithScores; 
    room: RoomWithDetails;
    participants: Participant[];
    teams: Team[];
    mappings: EventParticipantMapping[];
}) {
    const nums = Array.from({ length: event.participant_count }, (_, i) => i + 1);
    const judgeEmails = [...new Set(event.scores.map((s) => s.judge_email))];

    const results = nums.map((num) => {
        const ps = event.scores.filter((s) => s.participant_number === num);
        const total = ps.reduce((sum, s) => sum + s.score, 0);
        return { num, ps, total, avg: ps.length > 0 ? (total / ps.length).toFixed(1) : '—' };
    }).sort((a, b) => b.total - a.total);

    const maxScore = room.judge_count_required * 100;

    return (
        <motion.div className="card"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}>
            <div className="card-header">
                <div>
                    <h3 style={{ marginBottom: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
                        {event.event_name}
                        {event.category && <span className="badge badge-gray" style={{ fontSize: '0.7rem', padding: '2px 6px' }}>{event.category}</span>}
                    </h3>
                    <p className="text-xs col-muted">
                        {event.participant_count} participants · {event.scores.length} score entries · by {event.created_by}
                    </p>
                </div>
                <span className="live-badge">LIVE</span>
            </div>

            {event.scores.length === 0 ? (
                <div className="card-body">
                    <div className="empty-state" style={{ padding: '20px 0' }}>
                        <p>No scores submitted yet.</p>
                    </div>
                </div>
            ) : (
                <div className="table-wrap">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Rank</th>
                                <th>Code</th>
                                <th>Name</th>
                                <th>Chest No</th>
                                <th>Team</th>
                                {judgeEmails.map((e) => (
                                    <th key={e} title={e}>⚖️ {e.split('@')[0]}</th>
                                ))}
                                <th>Avg</th>
                                <th>Grade</th>
                                <th>Total</th>
                                <th>Score %</th>
                            </tr>
                        </thead>
                        <tbody>
                            {results.map((row, idx) => {
                                const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1;
                                const pct = Math.round((row.total / maxScore) * 100);
                                
                                const mapping = mappings.find(m => m.event_id === event.id && m.participant_number === row.num);
                                const participant = mapping ? participants.find(p => p.id === mapping.participant_id) : null;
                                const team = participant ? teams.find(t => t.id === participant.team_id) : null;

                                const avgVal = row.ps.length > 0 ? row.total / row.ps.length : null;
                                let gradeBadge = <span className="col-muted">—</span>;
                                if (avgVal !== null) {
                                    if (avgVal >= 80) {
                                        gradeBadge = (
                                            <span style={{
                                                background: '#ECFDF5', color: '#047857', border: '1px solid #A7F3D0',
                                                padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700
                                            }}>A</span>
                                        );
                                    } else if (avgVal >= 60) {
                                        gradeBadge = (
                                            <span style={{
                                                background: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A',
                                                padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700
                                            }}>B</span>
                                        );
                                    } else {
                                        gradeBadge = (
                                            <span style={{
                                                background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FCA5A5',
                                                padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700
                                            }}>C</span>
                                        );
                                    }
                                }

                                return (
                                    <tr key={row.num}>
                                        <td><strong>{medal}</strong></td>
                                        <td><strong>Code {getCodeName(row.num, room.code_type)}</strong></td>
                                        <td>{participant ? participant.name : <span className="col-muted">—</span>}</td>
                                        <td>{participant ? <span className="room-code" style={{ fontSize: '0.75rem', padding: '2px 6px' }}>{participant.chest_number}</span> : <span className="col-muted">—</span>}</td>
                                        <td>{team ? <span className="badge badge-yellow">{team.name}</span> : <span className="col-muted">—</span>}</td>
                                        {judgeEmails.map((em) => {
                                            const sc = row.ps.find((s) => s.judge_email === em);
                                            return (
                                                <td key={em}>
                                                    {sc !== undefined ? (
                                                        <span style={{
                                                            fontWeight: 700,
                                                            color: sc.score >= 80 ? 'var(--success)' : sc.score >= 50 ? 'var(--text-primary)' : 'var(--danger)',
                                                        }}>{sc.score}</span>
                                                    ) : <span className="col-muted">—</span>}
                                                </td>
                                            );
                                        })}
                                        <td><strong>{row.avg}</strong></td>
                                        <td>{gradeBadge}</td>
                                        <td>
                                            <strong style={{ color: 'var(--primary)', fontSize: '1rem' }}>
                                                {row.ps.length > 0 ? row.total : '—'}
                                            </strong>
                                        </td>
                                        <td>
                                            {row.ps.length > 0 ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 80 }}>
                                                    <div className="progress-track" style={{ flex: 1 }}>
                                                        <div className={`progress-fill ${idx === 0 ? 'progress-gold' : 'progress-primary'}`}
                                                            style={{ width: `${pct}%` }} />
                                                    </div>
                                                    <span className="text-xs font-700 col-sec">{pct}%</span>
                                                </div>
                                            ) : <span className="col-muted">—</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {event.scores.length > 0 && (
                <div className="card-footer">
                    Last updated: {new Date(event.scores[event.scores.length - 1]?.created_at).toLocaleString()}
                </div>
            )}
        </motion.div>
    );
}
