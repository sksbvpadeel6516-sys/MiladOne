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

const generateTeamChestNumber = (
    teamId: string | null | undefined,
    teamsList: Team[],
    existingParticipants: Participant[],
    offset = 0,
    excludePartId?: string
): string => {
    const activeParts = excludePartId 
        ? existingParticipants.filter(p => p.id !== excludePartId) 
        : existingParticipants;

    if (!teamId) {
        let maxNum = 0;
        for (const p of activeParts) {
            if (!p.team_id) {
                const num = parseInt(p.chest_number.replace(/\D/g, ''), 10);
                if (!isNaN(num) && num < 100 && num > maxNum) {
                    maxNum = num;
                }
            }
        }
        const next = maxNum + 1 + offset;
        return next.toString().padStart(3, '0');
    }

    const teamIdx = teamsList.findIndex(t => t.id === teamId);
    const seriesBase = (teamIdx >= 0 ? teamIdx + 1 : 1) * 100;
    const seriesMin = seriesBase + 1;
    const seriesMax = seriesBase + 99;

    let maxInSeries = seriesBase;

    for (const p of activeParts) {
        if (p.team_id === teamId) {
            const num = parseInt(p.chest_number.replace(/\D/g, ''), 10);
            if (!isNaN(num) && num >= seriesMin && num <= seriesMax) {
                if (num > maxInSeries) {
                    maxInSeries = num;
                }
            }
        }
    }

    const nextNum = maxInSeries + 1 + offset;
    return nextNum.toString();
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

    const [selectedView, setSelectedView] = useState<'overview' | 'teams' | 'participants' | 'achievements' | 'championship' | 'individual'>('overview');
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
    const [newPartTeamId, setNewPartTeamId] = useState('');
    const [newPartCategory, setNewPartCategory] = useState('Kiddies');
    const [autoGenerateChest, setAutoGenerateChest] = useState(true);
    const [manualChestInput, setManualChestInput] = useState('');
    const [partSearch, setPartSearch] = useState('');
    const [editingPartId, setEditingPartId] = useState<string | null>(null);
    const [editingPartName, setEditingPartName] = useState('');
    const [editingPartChest, setEditingPartChest] = useState('');
    const [editingPartTeamId, setEditingPartTeamId] = useState('');
    const [editingPartCategory, setEditingPartCategory] = useState('Senior');
    const [bulkImportText, setBulkImportText] = useState('');
    const [importing, setImporting] = useState(false);

    // Event Creation by Admin
    const [showCreateEventModal, setShowCreateEventModal] = useState(false);
    const [newEventName, setNewEventName] = useState('');
    const [newEventCategory, setNewEventCategory] = useState('Kiddies');
    const [newEventCustomCategory, setNewEventCustomCategory] = useState('');
    const [newEventType, setNewEventType] = useState<'solo' | 'group'>('solo');
    const [selectedParticipantIdsForEvent, setSelectedParticipantIdsForEvent] = useState<string[]>([]);
    const [createGroupTeams, setCreateGroupTeams] = useState<{ id: string; name: string; participantIds: string[] }[]>([
        { id: 'gt-1', name: 'Team 1', participantIds: [] },
        { id: 'gt-2', name: 'Team 2', participantIds: [] }
    ]);
    const [eventParticipantSearch, setEventParticipantSearch] = useState('');
    const [eventCategoryFilter, setEventCategoryFilter] = useState<string>('Kiddies');
    const [creatingEvent, setCreatingEvent] = useState(false);

    // Edit Event Modal
    const [editingEvent, setEditingEvent] = useState<Event | null>(null);
    const [editEventName, setEditEventName] = useState('');
    const [editEventCategory, setEditEventCategory] = useState('Kiddies');
    const [editEventCustomCategory, setEditEventCustomCategory] = useState('');
    const [editEventType, setEditEventType] = useState<'solo' | 'group'>('solo');
    const [editEventParticipantIds, setEditEventParticipantIds] = useState<string[]>([]);
    const [editGroupTeams, setEditGroupTeams] = useState<{ id: string; name: string; participantIds: string[] }[]>([]);
    const [editEventParticipantSearch, setEditEventParticipantSearch] = useState('');
    const [editEventCategoryFilter, setEditEventCategoryFilter] = useState<string>('all');
    const [savingEdit, setSavingEdit] = useState(false);

    // Event Mappings & Live Code Assignment
    const [mappingEventId, setMappingEventId] = useState<string | null>(null);
    const [localCodeInputs, setLocalCodeInputs] = useState<Record<string, string>>({});
    const [deletingEvent, setDeletingEvent] = useState<{ id: string; name: string } | null>(null);

    // Participant Achievement History Modal
    const [viewingHistoryParticipant, setViewingHistoryParticipant] = useState<Participant | null>(null);
    const [achievementSearch, setAchievementSearch] = useState('');

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
                const { data: inst } = await supabase
                    .from('institutions')
                    .select('id, name')
                    .eq('admin_email', email.toLowerCase())
                    .maybeSingle();

                if (cancelled) return;
                if (!inst) {
                    router.replace('/judge');
                    return;
                }

                setUserEmail(email);
                setInstitutionName(inst.name);
                setInstitutionId(inst.id);
                setAuthReady(true);
            })
            .catch(() => { if (!cancelled) router.replace('/'); });
        return () => { cancelled = true; };
    }, [router]);

    const loadRooms = useCallback(async (instId: string) => {
        if (firstLoadRef.current) {
            setLoading(true);
        }
        try {
            const { data: rData } = await supabase.from('rooms').select('*')
                .eq('institution_id', instId).order('created_at', { ascending: false });
            if (!rData) return;

            const roomIds = rData.map((r) => r.id);
            if (roomIds.length === 0) {
                setRooms([]);
                setLoading(false);
                firstLoadRef.current = false;
                return;
            }

            const [{ data: jData }, { data: eData }] = await Promise.all([
                supabase.from('judges').select('*').in('room_id', roomIds),
                supabase.from('events').select('*').in('room_id', roomIds).order('created_at', { ascending: false }),
            ]);

            const eventIds = (eData || []).map((e) => e.id);
            const { data: sData } = eventIds.length > 0
                ? await supabase.from('scores').select('*').in('event_id', eventIds)
                : { data: [] };

            const structured: RoomWithDetails[] = rData.map((r) => {
                const roomEvents = (eData || [])
                    .filter((e) => e.room_id === r.id)
                    .map((e) => ({
                        ...e,
                        scores: (sData || []).filter((s) => s.event_id === e.id),
                    }));
                return {
                    ...r,
                    judges: (jData || []).filter((j) => j.room_id === r.id),
                    events: roomEvents,
                };
            });

            setRooms(structured);
        } finally {
            setLoading(false);
            firstLoadRef.current = false;
        }
    }, []);

    const loadTeamsAndParticipants = useCallback(async (instId: string) => {
        const [{ data: tData }, { data: pData }, { data: mData }] = await Promise.all([
            supabase.from('teams').select('*').eq('institution_id', instId).order('name', { ascending: true }),
            supabase.from('participants').select('*').eq('institution_id', instId).order('created_at', { ascending: true }),
            supabase.from('event_participant_mappings').select('*'),
        ]);

        if (tData) setTeams(tData);
        if (pData) setParticipants(pData);
        if (mData) setMappings(mData);
    }, []);

    useEffect(() => {
        if (!authReady || !institutionId) return;
        loadRooms(institutionId);
        loadTeamsAndParticipants(institutionId);

        const ch = supabase.channel(`inst-realtime-${institutionId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `institution_id=eq.${institutionId}` }, () => loadRooms(institutionId))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'judges' }, () => loadRooms(institutionId))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `institution_id=eq.${institutionId}` }, () => loadRooms(institutionId))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'scores', filter: `institution_id=eq.${institutionId}` }, () => loadRooms(institutionId))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `institution_id=eq.${institutionId}` }, () => loadTeamsAndParticipants(institutionId))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `institution_id=eq.${institutionId}` }, () => loadTeamsAndParticipants(institutionId))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'event_participant_mappings' }, () => loadTeamsAndParticipants(institutionId))
            .subscribe();

        return () => { supabase.removeChannel(ch); };
    }, [authReady, institutionId, loadRooms, loadTeamsAndParticipants]);

    const generateRoomCode = () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let result = '';
        for (let i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    };

    const handleCreateRoom = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!institutionId || !userEmail) return;
        setCreating(true);
        try {
            const secretCode = generateRoomCode();
            const { error } = await supabase.from('rooms').insert({
                institution_id: institutionId,
                secret_code: secretCode,
                judge_count_required: newRoomJudgeCount,
                code_type: newRoomCodeType,
                created_by: userEmail,
            });
            if (error) throw error;
            showToast(`Room ${secretCode} created successfully!`, 'success');
            loadRooms(institutionId);
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Failed to create room.', 'error');
        } finally {
            setCreating(false);
        }
    };

    const handleUpdateRoomJudgeCount = async (roomId: string, newJudgeCount: number) => {
        if (!institutionId) return;
        try {
            const { error } = await supabase
                .from('rooms')
                .update({ judge_count_required: newJudgeCount })
                .eq('id', roomId);
            if (error) throw error;
            showToast(`Room judge requirement updated to ${newJudgeCount} judges!`, 'success');
            loadRooms(institutionId);
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Failed to update judge count.', 'error');
        }
    };

    const handleDeleteRoom = async (roomId: string) => {
        if (!institutionId) return;
        try {
            const { error } = await supabase.from('rooms').delete().eq('id', roomId);
            if (error) throw error;
            showToast('Room deleted.', 'success');
            if (selectedRoomId === roomId) setSelectedRoomId(null);
            loadRooms(institutionId);
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Delete failed.', 'error');
        } finally {
            setConfirmDeleteRoom(null);
        }
    };

    const handleRemoveJudge = async (roomId: string, judgeId: string) => {
        if (!institutionId) return;
        try {
            const { error } = await supabase.from('judges').delete().eq('id', judgeId);
            if (error) throw error;
            showToast('Judge removed.', 'success');
            loadRooms(institutionId);
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Remove failed.', 'error');
        } finally {
            setConfirmRemoveJudge(null);
        }
    };

    const handleCreateTeam = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTeamName.trim() || !institutionId) return;
        try {
            const { error } = await supabase
                .from('teams')
                .insert({ name: newTeamName.trim(), institution_id: institutionId });
            if (error) throw error;
            showToast(`Team "${newTeamName.trim()}" created!`, 'success');
            setNewTeamName('');
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Failed to create team', 'error');
        }
    };

    const handleDeleteTeam = async (id: string) => {
        if (!confirm('Are you sure you want to delete this team? Participants will remain but lose their team association.')) return;
        try {
            const { error } = await supabase.from('teams').delete().eq('id', id);
            if (error) throw error;
            showToast('Team deleted', 'success');
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Failed to delete team', 'error');
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
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Failed to rename team', 'error');
        }
    };

    // Auto-generate or Manual Chest Numbers for new participants
    const handleCreateParticipant = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newPartName.trim() || !institutionId) return;

        let chestNum = '';
        if (autoGenerateChest) {
            chestNum = generateTeamChestNumber(newPartTeamId, teams, participants);
        } else {
            chestNum = manualChestInput.trim().toUpperCase();
            if (!chestNum) {
                showToast('Please enter a chest number.', 'error');
                return;
            }
        }

        // Uniqueness validation
        const exists = participants.some(p => p.chest_number.toLowerCase() === chestNum.toLowerCase());
        if (exists) {
            showToast(`Chest number "${chestNum}" is already assigned to another participant.`, 'error');
            return;
        }

        try {
            const insertPayload: Record<string, any> = {
                name: newPartName.trim(),
                chest_number: chestNum,
                team_id: newPartTeamId || null,
                category: newPartCategory || 'Kiddies',
                institution_id: institutionId
            };

            let { error } = await supabase
                .from('participants')
                .insert(insertPayload);

            if (error) throw error;
            showToast(`Participant "${newPartName.trim()}" added with Chest No. ${chestNum}!`, 'success');
            setNewPartName('');
            setManualChestInput('');
        } catch (err: any) {
            const errMsg = err?.message || err?.details || (err instanceof Error ? err.message : 'Failed to add participant');
            showToast(errMsg, 'error');
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
            const errMsg = err?.message || err?.details || (err instanceof Error ? err.message : 'Failed to delete participant');
            showToast(errMsg, 'error');
        }
    };

    const handleSavePartEdit = async (id: string) => {
        if (!editingPartName.trim() || !editingPartChest.trim()) return;

        const chestNum = editingPartChest.trim().toUpperCase();

        // Uniqueness validation against other participants
        const exists = participants.some(p => p.id !== id && p.chest_number.toLowerCase() === chestNum.toLowerCase());
        if (exists) {
            showToast(`Chest number "${chestNum}" is already assigned to another participant.`, 'error');
            return;
        }

        try {
            const updatePayload: Record<string, any> = {
                name: editingPartName.trim(),
                chest_number: chestNum,
                team_id: editingPartTeamId || null,
                category: editingPartCategory || 'Kiddies'
            };

            let { error } = await supabase
                .from('participants')
                .update(updatePayload)
                .eq('id', id);

            if (error) throw error;

            // Optimistically update local participant state
            setParticipants(prev => prev.map(p => p.id === id ? { ...p, ...updatePayload, category: editingPartCategory || 'Senior' } : p));

            showToast('Participant updated successfully!', 'success');
            setEditingPartId(null);
        } catch (err: any) {
            const errMsg = err?.message || err?.details || (err instanceof Error ? err.message : 'Failed to update participant');
            showToast(errMsg, 'error');
        }
    };

    // Bulk Import with Team-Based Series Chest Numbers & Category
    const handleBulkImport = async () => {
        if (!bulkImportText.trim() || !institutionId) return;
        setImporting(true);
        try {
            const lines = bulkImportText.split('\n');
            const parsedRows: { name: string; teamName: string; category: string }[] = [];

            for (const line of lines) {
                if (!line.trim()) continue;
                const parts = line.includes('\t') ? line.split('\t') : line.split(',');
                const name = parts[0]?.trim();
                const teamName = parts[1]?.trim() || '';
                const category = parts[2]?.trim() || 'Senior';
                if (name) {
                    parsedRows.push({ name, teamName, category });
                }
            }

            if (parsedRows.length === 0) {
                showToast('No valid rows found. Format: Participant Name, TeamName, Category', 'error');
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
            const teamsListForImport = updatedTeams || teams;
            if (updatedTeams) setTeams(updatedTeams);

            let successCount = 0;
            let errorCount = 0;
            const teamOffsets = new Map<string, number>();

            for (const row of parsedRows) {
                const teamId = row.teamName ? teamMap.get(row.teamName.toLowerCase()) || null : null;
                const teamKey = teamId || 'none';
                const offset = teamOffsets.get(teamKey) || 0;

                const autoChest = generateTeamChestNumber(teamId, teamsListForImport, participants, offset);
                teamOffsets.set(teamKey, offset + 1);

                const insertPayload: Record<string, any> = {
                    name: row.name,
                    chest_number: autoChest,
                    team_id: teamId,
                    category: row.category || 'Kiddies',
                    institution_id: institutionId
                };

                let { error } = await supabase
                    .from('participants')
                    .insert(insertPayload);

                if (error) {
                    errorCount++;
                } else {
                    successCount++;
                }
            }

            showToast(`Bulk Import Complete: ${successCount} added, ${errorCount} failed.`, successCount > 0 ? 'success' : 'error');
            setBulkImportText('');
            loadTeamsAndParticipants(institutionId);
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Bulk import failed.', 'error');
        } finally {
            setImporting(false);
        }
    };

    // Admin Event Creation Handler
    const handleAdminCreateEvent = async (e: React.FormEvent) => {
        e.preventDefault();
        const selectedRoom = rooms.find(r => r.id === selectedRoomId);
        if (!selectedRoom || !institutionId || !newEventName.trim()) return;

        const category = newEventCategory === 'Other' ? newEventCustomCategory.trim() : newEventCategory;
        if (!category) {
            showToast('Please specify a category.', 'error');
            return;
        }

        if (newEventType === 'solo') {
            if (selectedParticipantIdsForEvent.length === 0) {
                showToast('Please select at least 1 participant for this event.', 'error');
                return;
            }
        } else {
            const teamsWithMembers = createGroupTeams.filter(t => t.participantIds.length > 0);
            if (teamsWithMembers.length < 2) {
                showToast('Please add members to at least 2 competing teams for a Group Event.', 'error');
                return;
            }
        }

        setCreatingEvent(true);
        try {
            const isGroup = newEventType === 'group';
            const participantCount = isGroup
                ? createGroupTeams.filter(t => t.participantIds.length > 0).length
                : selectedParticipantIdsForEvent.length;

            const { data: event, error: evErr } = await supabase
                .from('events')
                .insert({
                    room_id: selectedRoom.id,
                    institution_id: institutionId,
                    event_name: newEventName.trim(),
                    category,
                    event_type: newEventType,
                    participant_count: participantCount,
                    created_by: userEmail,
                })
                .select('*')
                .single();

            if (evErr || !event) throw evErr || new Error('Failed to create event');

            let mappingPayload: { event_id: string; participant_number: number | null; participant_id: string }[] = [];

            if (isGroup) {
                const activeTeams = createGroupTeams.filter(t => t.participantIds.length > 0);
                activeTeams.forEach((gt, index) => {
                    const codeNum = index + 1;
                    gt.participantIds.forEach(partId => {
                        mappingPayload.push({
                            event_id: event.id,
                            participant_number: codeNum,
                            participant_id: partId
                        });
                    });
                });
            } else {
                mappingPayload = selectedParticipantIdsForEvent.map((partId) => ({
                    event_id: event.id,
                    participant_number: null,
                    participant_id: partId
                }));
            }

            if (mappingPayload.length > 0) {
                const { error: mapErr } = await supabase.from('event_participant_mappings').insert(mappingPayload);
                if (mapErr) {
                    console.error('Mapping creation error:', mapErr.message || mapErr);
                    throw new Error(`Failed to save participant mappings: ${mapErr.message || 'Database error'}`);
                }
            }

            showToast(`${newEventType === 'group' ? 'Group' : 'Solo'} event "${event.event_name}" created successfully!`, 'success');
            setShowCreateEventModal(false);
            setNewEventName('');
            setNewEventCustomCategory('');
            setNewEventType('solo');
            setSelectedParticipantIdsForEvent([]);
            setCreateGroupTeams([
                { id: 'gt-1', name: 'Team 1', participantIds: [] },
                { id: 'gt-2', name: 'Team 2', participantIds: [] }
            ]);
            loadRooms(institutionId);
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Failed to create event', 'error');
        } finally {
            setCreatingEvent(false);
        }
    };

    // Open Edit Event Modal
    const openEditEventModal = (ev: Event) => {
        setEditingEvent(ev);
        setEditEventName(ev.event_name);
        const stdCategories = ['Kiddies', 'Sub Junior', 'Junior', 'Senior', 'Super Senior', 'General'];
        if (stdCategories.includes(ev.category)) {
            setEditEventCategory(ev.category);
            setEditEventCustomCategory('');
        } else {
            setEditEventCategory('Other');
            setEditEventCustomCategory(ev.category || '');
        }
        const evType = (ev.event_type as 'solo' | 'group') || 'solo';
        setEditEventType(evType);

        const eventMaps = mappings.filter(m => m.event_id === ev.id);
        setEditEventParticipantIds(eventMaps.map(m => m.participant_id));

        if (evType === 'group') {
            const teamMap = new Map<number, string[]>();
            eventMaps.forEach(m => {
                const num = m.participant_number || 1;
                if (!teamMap.has(num)) teamMap.set(num, []);
                teamMap.get(num)!.push(m.participant_id);
            });

            const parsedTeams: { id: string; name: string; participantIds: string[] }[] = [];
            const sortedNums = Array.from(teamMap.keys()).sort((a, b) => a - b);
            if (sortedNums.length === 0) {
                parsedTeams.push(
                    { id: 'gt-1', name: 'Team 1', participantIds: [] },
                    { id: 'gt-2', name: 'Team 2', participantIds: [] }
                );
            } else {
                sortedNums.forEach((num, idx) => {
                    parsedTeams.push({
                        id: `gt-${num}`,
                        name: `Team ${idx + 1}`,
                        participantIds: teamMap.get(num) || []
                    });
                });
            }
            setEditGroupTeams(parsedTeams);
        } else {
            setEditGroupTeams([
                { id: 'gt-1', name: 'Team 1', participantIds: [] },
                { id: 'gt-2', name: 'Team 2', participantIds: [] }
            ]);
        }

        setEditEventParticipantSearch('');
        setEditEventCategoryFilter('all');
    };

    // Save Edited Event
    const handleSaveEditEvent = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingEvent || !institutionId || !editEventName.trim()) return;

        const category = editEventCategory === 'Other' ? editEventCustomCategory.trim() : editEventCategory;
        if (!category) {
            showToast('Please specify a category.', 'error');
            return;
        }

        const isGroup = editEventType === 'group';

        if (!isGroup && editEventParticipantIds.length === 0) {
            showToast('Please select at least 1 participant for this solo event.', 'error');
            return;
        }

        if (isGroup) {
            const teamsWithMembers = editGroupTeams.filter(t => t.participantIds.length > 0);
            if (teamsWithMembers.length < 2) {
                showToast('Please assign members to at least 2 competing teams for a Group Event.', 'error');
                return;
            }
        }

        setSavingEdit(true);
        try {
            const activeTeams = editGroupTeams.filter(t => t.participantIds.length > 0);
            const participantCount = isGroup ? activeTeams.length : editEventParticipantIds.length;

            // Update event record
            const { error: evErr } = await supabase
                .from('events')
                .update({
                    event_name: editEventName.trim(),
                    category,
                    event_type: editEventType,
                    participant_count: participantCount,
                })
                .eq('id', editingEvent.id);

            if (evErr) throw evErr;

            // Clear old mappings for this event
            await supabase
                .from('event_participant_mappings')
                .delete()
                .eq('event_id', editingEvent.id);

            let newMappings: { event_id: string; participant_number: number | null; participant_id: string }[] = [];

            if (isGroup) {
                activeTeams.forEach((gt, index) => {
                    const codeNum = index + 1;
                    gt.participantIds.forEach(partId => {
                        newMappings.push({
                            event_id: editingEvent.id,
                            participant_number: codeNum,
                            participant_id: partId
                        });
                    });
                });
            } else {
                newMappings = editEventParticipantIds.map(partId => ({
                    event_id: editingEvent.id,
                    participant_number: null,
                    participant_id: partId,
                }));
            }

            if (newMappings.length > 0) {
                const { error: mapErr } = await supabase.from('event_participant_mappings').insert(newMappings);
                if (mapErr) {
                    console.error('Mapping update error:', mapErr.message || mapErr);
                    throw new Error(`Failed to update participant mappings: ${mapErr.message || 'Database error'}`);
                }
            }

            showToast(`Event "${editEventName.trim()}" updated successfully!`, 'success');
            setEditingEvent(null);
            loadRooms(institutionId);
            loadTeamsAndParticipants(institutionId);
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Failed to update event', 'error');
        } finally {
            setSavingEdit(false);
        }
    };

    const parseCodeInputToNum = (inputStr: string): number | null => {
        const clean = inputStr.trim().toUpperCase();
        if (!clean) return null;
        if (/^\d+$/.test(clean)) return parseInt(clean, 10);
        if (/^[A-Z]$/.test(clean)) return clean.charCodeAt(0) - 64;
        const match = clean.match(/\d+/);
        if (match) return parseInt(match[0], 10);
        return null;
    };

    const startMapping = (ev: Event) => {
        setMappingEventId(ev.id);
        const eventM = mappings.filter(m => m.event_id === ev.id);
        const initInputs: Record<string, string> = {};
        eventM.forEach(m => {
            initInputs[m.participant_id] = m.participant_number ? getCodeName(m.participant_number, selectedRoom?.code_type) : '';
        });
        setLocalCodeInputs(initInputs);
    };

    const handleSaveTypedCode = async (eventId: string, participantId: string, rawInput: string) => {
        const codeNum = parseCodeInputToNum(rawInput);
        try {
            if (codeNum !== null) {
                // Remove existing mapping for this code number in this event (prevents duplicate code numbers)
                await supabase
                    .from('event_participant_mappings')
                    .delete()
                    .eq('event_id', eventId)
                    .eq('participant_number', codeNum);

                // Upsert mapping for this participant
                const { error } = await supabase
                    .from('event_participant_mappings')
                    .upsert({
                        event_id: eventId,
                        participant_id: participantId,
                        participant_number: codeNum
                    }, { onConflict: 'event_id,participant_id' });

                if (error) throw error;
                showToast(`Assigned Code ${getCodeName(codeNum, selectedRoom?.code_type)}`, 'success');
            } else {
                // Clear participant_number if input is blank
                const { error } = await supabase
                    .from('event_participant_mappings')
                    .update({ participant_number: null })
                    .eq('event_id', eventId)
                    .eq('participant_id', participantId);

                if (error) {
                    // Fallback to updating or keeping row with null
                    await supabase
                        .from('event_participant_mappings')
                        .upsert({
                            event_id: eventId,
                            participant_id: participantId,
                            participant_number: null
                        }, { onConflict: 'event_id,participant_id' });
                }

                if (rawInput.trim()) {
                    showToast('Invalid code format. Enter a number or letter.', 'error');
                } else {
                    showToast('Code cleared', 'info');
                }
            }

            if (institutionId) loadRooms(institutionId);
        } catch (err: any) {
            showToast(err?.message || 'Failed to save code', 'error');
        }
    };

    const handleSaveGroupTeamCode = async (eventId: string, participantIds: string[], rawInput: string) => {
        const codeNum = parseCodeInputToNum(rawInput);
        try {
            if (codeNum !== null) {
                await supabase
                    .from('event_participant_mappings')
                    .delete()
                    .eq('event_id', eventId)
                    .eq('participant_number', codeNum);

                const { error } = await supabase
                    .from('event_participant_mappings')
                    .update({ participant_number: codeNum })
                    .eq('event_id', eventId)
                    .in('participant_id', participantIds);

                if (error) throw error;
                showToast(`Assigned Code ${getCodeName(codeNum, selectedRoom?.code_type)} to Team`, 'success');
            } else {
                const { error } = await supabase
                    .from('event_participant_mappings')
                    .update({ participant_number: null })
                    .eq('event_id', eventId)
                    .in('participant_id', participantIds);

                if (error) throw error;
                if (rawInput.trim()) {
                    showToast('Invalid code format. Enter a number or letter.', 'error');
                } else {
                    showToast('Team code cleared', 'info');
                }
            }

            if (institutionId) loadRooms(institutionId);
        } catch (err: any) {
            showToast(err?.message || 'Failed to save team code', 'error');
        }
    };

    const handleClearAllCodes = async (eventId: string) => {
        try {
            const { error } = await supabase
                .from('event_participant_mappings')
                .update({ participant_number: null })
                .eq('event_id', eventId);

            if (error) throw error;

            setLocalCodeInputs({});
            showToast('Cleared all code numbers for this event!', 'info');
            if (institutionId) loadRooms(institutionId);
        } catch (err: any) {
            showToast(err?.message || 'Failed to clear codes', 'error');
        }
    };

    const confirmDeleteEvent = async (eventId: string, eventName: string) => {
        try {
            const { error } = await supabase
                .from('events')
                .delete()
                .eq('id', eventId);

            if (error) throw error;

            if (mappingEventId === eventId) {
                setMappingEventId(null);
            }

            showToast(`Event "${eventName}" deleted successfully!`, 'success');
            if (institutionId) loadRooms(institutionId);
        } catch (err: any) {
            showToast(err?.message || 'Failed to delete event', 'error');
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
                const isGroup = (event.event_type || 'solo') === 'group';
                const nums = Array.from({ length: event.participant_count }, (_, i) => i + 1);

                const ranked = nums.map((num) => {
                    const ps = event.scores.filter((s) => s.participant_number === num);
                    const total = ps.reduce((sum, s) => sum + s.score, 0);
                    const avg = ps.length > 0 ? total / ps.length : 0;
                    return { num, total, avg, hasScores: ps.length > 0 };
                }).filter(r => r.hasScores).sort((a, b) => b.total - a.total);

                if (isGroup) {
                    // Group event: calculate rank/grade for the whole group (treated as one entry)
                    // The team receives the earned points (e.g. 10+5 = 15 pts) ONCE for the group entry, NOT multiplied by member count
                    if (ranked.length > 0) {
                        let currentRank = 1;
                        let prevTotal = -1;
                        ranked.forEach((res, index) => {
                            if (index > 0 && res.total < prevTotal) {
                                currentRank = index + 1;
                            }
                            prevTotal = res.total;

                            let rPoints = 0;
                            if (currentRank === 1) rPoints = 10;
                            else if (currentRank === 2) rPoints = 3;
                            else if (currentRank === 3) rPoints = 1;

                            let gradePoints = 0;
                            if (res.avg >= 80) gradePoints = 5;
                            else if (res.avg >= 60) gradePoints = 3;
                            else gradePoints = 1;

                            const totalPoints = rPoints + gradePoints;

                            // Collect all unique team IDs of participants belonging to this group (res.num)
                            const groupMappings = mappings.filter(m => m.event_id === event.id && (m.participant_number === res.num || (m.participant_number === null && event.participant_count === 1)));
                            const uniqueTeamIds = new Set<string>();
                            
                            groupMappings.forEach(m => {
                                const part = participants.find(p => p.id === m.participant_id);
                                if (part && part.team_id) {
                                    uniqueTeamIds.add(part.team_id);
                                }
                            });

                            // Award totalPoints ONCE per team represented in this group entry
                            uniqueTeamIds.forEach(teamId => {
                                const cur = stand.get(teamId);
                                if (cur) {
                                    if (normCat) {
                                        cur.categoryPoints[normCat] = (cur.categoryPoints[normCat] || 0) + totalPoints;
                                    }
                                    cur.overallPoints += totalPoints;
                                }
                            });
                        });
                    }
                } else {
                    // Solo event: existing behavior (5+5 point system)
                    let currentRank = 1;
                    let prevTotal = -1;
                    ranked.forEach((res, index) => {
                        if (index > 0 && res.total < prevTotal) {
                            currentRank = index + 1;
                        }
                        prevTotal = res.total;

                        let rankPoints = 0;
                        if (currentRank === 1) rankPoints = 5;
                        else if (currentRank === 2) rankPoints = 3;
                        else if (currentRank === 3) rankPoints = 1;

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
                }
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
                // IMPORTANT: Group event points do NOT count toward Individual Championship
                const isGroup = (event.event_type || 'solo') === 'group';
                if (isGroup) return; // Skip group events entirely for individual standings

                const normCat = event.category ? normalizeCategoryName(event.category) : '';
                const nums = Array.from({ length: event.participant_count }, (_, i) => i + 1);

                const ranked = nums.map((num) => {
                    const ps = event.scores.filter((s) => s.participant_number === num);
                    const total = ps.reduce((sum, s) => sum + s.score, 0);
                    const avg = ps.length > 0 ? total / ps.length : 0;
                    return { num, total, avg, hasScores: ps.length > 0 };
                }).filter(r => r.hasScores).sort((a, b) => b.total - a.total);

                let currentRank = 1;
                let prevTotal = -1;
                ranked.forEach((res, index) => {
                    if (index > 0 && res.total < prevTotal) {
                        currentRank = index + 1;
                    }
                    prevTotal = res.total;

                    let rankPoints = 0;
                    if (currentRank === 1) rankPoints = 5;
                    else if (currentRank === 2) rankPoints = 3;
                    else if (currentRank === 3) rankPoints = 1;

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
            const team = part && part.team_id ? teams.find(t => t.id === part.team_id) : null;
            let points = data.overallPoints;
            if (selectedCat !== 'overall') {
                points = data.categoryPoints[selectedCat] || 0;
            }
            return {
                id: partId,
                name: part ? part.name : 'Unknown Participant',
                chestNumber: part ? part.chest_number : '',
                teamName: team ? team.name : '',
                points,
                categoryPoints: data.categoryPoints,
                overallPoints: data.overallPoints
            };
        }).sort((a, b) => b.points - a.points);
    };

    // Calculate Achievement History for a Participant
    const getParticipantAchievements = (partId: string) => {
        const partMappings = mappings.filter(m => m.participant_id === partId);
        const eventsList: Array<{
            eventId: string;
            eventName: string;
            eventType: 'solo' | 'group';
            category: string;
            roomCode: string;
            avgScore: number;
            grade: string;
            rank: number;
            prize: string;
            points: number;
        }> = [];

        let firstPrizes = 0;
        let secondPrizes = 0;
        let thirdPrizes = 0;
        let gradeA = 0;
        let gradeB = 0;
        let gradeC = 0;
        let totalPoints = 0;

        rooms.forEach(room => {
            room.events.forEach(event => {
                const map = partMappings.find(m => m.event_id === event.id);
                if (!map) return;

                const isGroup = (event.event_type || 'solo') === 'group';
                const num = map.participant_number;
                const ps = event.scores.filter(s => s.participant_number === num);
                if (ps.length === 0) return;

                const totalScore = ps.reduce((sum, s) => sum + s.score, 0);
                const avgScore = totalScore / ps.length;

                // Rank in this event
                const nums = Array.from({ length: event.participant_count }, (_, i) => i + 1);
                const ranked = nums.map((n) => {
                    const scores = event.scores.filter((s) => s.participant_number === n);
                    const tot = scores.reduce((sum, s) => sum + s.score, 0);
                    return { n, tot, hasScores: scores.length > 0 };
                }).filter(r => r.hasScores).sort((a, b) => b.tot - a.tot);

                let rank = 1;
                let prevTot = -1;
                ranked.forEach((r, idx) => {
                    if (idx > 0 && r.tot < prevTot) rank = idx + 1;
                    prevTot = r.tot;
                    if (r.n === num) return;
                });

                const myRankObj = ranked.find(r => r.n === num);
                if (!myRankObj) return;

                // Calculate rank and points for participant
                let rankPos = 1;
                for (let i = 0; i < ranked.length; i++) {
                    if (ranked[i].tot > myRankObj.tot) rankPos++;
                }

                let rankPoints = 0;
                let prize = 'Participation';
                if (isGroup) {
                    // Group events use 10+5 point system
                    if (rankPos === 1) { rankPoints = 10; prize = '🥇 1st Prize (Group)'; firstPrizes++; }
                    else if (rankPos === 2) { rankPoints = 3; prize = '🥈 2nd Prize (Group)'; secondPrizes++; }
                    else if (rankPos === 3) { rankPoints = 1; prize = '🥉 3rd Prize (Group)'; thirdPrizes++; }
                } else {
                    // Solo events use 5+5 point system
                    if (rankPos === 1) { rankPoints = 5; prize = '🥇 1st Prize'; firstPrizes++; }
                    else if (rankPos === 2) { rankPoints = 3; prize = '🥈 2nd Prize'; secondPrizes++; }
                    else if (rankPos === 3) { rankPoints = 1; prize = '🥉 3rd Prize'; thirdPrizes++; }
                }

                let grade = 'C';
                let gradePoints = 1;
                if (avgScore >= 80) { grade = 'A'; gradePoints = 5; gradeA++; }
                else if (avgScore >= 60) { grade = 'B'; gradePoints = 3; gradeB++; }
                else { gradeC++; }

                const points = rankPoints + gradePoints;
                totalPoints += points;

                eventsList.push({
                    eventId: event.id,
                    eventName: event.event_name,
                    eventType: (event.event_type as 'solo' | 'group') || 'solo',
                    category: event.category || 'General',
                    roomCode: room.secret_code,
                    avgScore: Number(avgScore.toFixed(1)),
                    grade,
                    rank: rankPos,
                    prize,
                    points,
                });
            });
        });

        return {
            totalEvents: eventsList.length,
            totalPrizes: firstPrizes + secondPrizes + thirdPrizes,
            firstPrizes,
            secondPrizes,
            thirdPrizes,
            gradeA,
            gradeB,
            gradeC,
            totalPoints,
            eventsList,
        };
    };

    const selectRoom = (roomId: string) => {
        setSelectedRoomId(roomId);
        setMappingEventId(null);
        setRoomTab('overview');
    };

    const copyCode = (code: string) => {
        navigator.clipboard.writeText(code);
        showToast(`Copied ${code} to clipboard!`, 'success');
    };

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        router.replace('/');
    };

    const getParticipantCount = (teamId: string) => {
        return participants.filter((p) => p.team_id === teamId).length;
    };

    if (!authReady || (loading && firstLoadRef.current)) {
        return (
            <div className="loading-screen">
                <div className="spinner" /><p>Loading admin workspace…</p>
            </div>
        );
    }

    const selectedRoom = rooms.find((r) => r.id === selectedRoomId);

    const filteredParticipants = participants.filter((p) => {
        const query = partSearch.toLowerCase();
        const pTeam = teams.find(t => t.id === p.team_id);
        return (
            p.name.toLowerCase().includes(query) ||
            p.chest_number.toLowerCase().includes(query) ||
            (pTeam && pTeam.name.toLowerCase().includes(query))
        );
    });

    return (
        <div className="admin-page">
            {/* Top Bar */}
            <header className="admin-topbar">
                <div className="flex items-c gap-3">
                    <button
                        className="btn btn-secondary btn-icon-only hide-lg"
                        onClick={() => setSidebarOpen((v) => !v)}
                        aria-label="Toggle Navigation"
                    >
                        ☰
                    </button>
                    <div style={{
                        width: 34, height: 34, background: 'white', border: '1px solid var(--border)',
                        borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, padding: 4,
                        boxShadow: 'var(--shadow-xs)',
                    }}>
                        <img src="/logo/logo.png" alt="MiladOne Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </div>
                    <div>
                        <span style={{ fontWeight: 800, fontSize: '1rem' }}>
                            Milad<span style={{ color: 'var(--primary)' }}>One</span>
                        </span>
                        <span className="badge badge-gray text-xs hide-sm" style={{ marginLeft: 8 }}>
                            {institutionName || 'Admin'}
                        </span>
                    </div>
                </div>

                <div className="flex items-c gap-3">
                    <div className="text-xs col-muted hide-md truncate" style={{ maxWidth: 200 }}>
                        {userEmail}
                    </div>
                    <motion.button
                        id="btn-signout-admin"
                        onClick={handleSignOut}
                        className="btn btn-secondary btn-sm"
                        whileTap={{ scale: 0.96 }}
                    >
                        Sign Out
                    </motion.button>
                </div>
            </header>

            {/* Layout Body */}
            <div className="admin-layout">
                {/* Mobile overlay */}
                {sidebarOpen && (
                    <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
                )}

                {/* Sidebar */}
                <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
                    <div className="sidebar-section">
                        <div className="sidebar-section-title">Navigation</div>
                        <button
                            className={`sidebar-item ${!selectedRoomId && selectedView === 'overview' ? 'active' : ''}`}
                            onClick={() => { setSelectedRoomId(null); setSelectedView('overview'); setSidebarOpen(false); }}
                        >
                            <span>🏢 Room Dashboard</span>
                        </button>
                        <button
                            className={`sidebar-item ${!selectedRoomId && selectedView === 'teams' ? 'active' : ''}`}
                            onClick={() => { setSelectedRoomId(null); setSelectedView('teams'); setSidebarOpen(false); }}
                        >
                            <span>🛡️ Manage Teams</span>
                        </button>
                        <button
                            className={`sidebar-item ${!selectedRoomId && selectedView === 'participants' ? 'active' : ''}`}
                            onClick={() => { setSelectedRoomId(null); setSelectedView('participants'); setSidebarOpen(false); }}
                        >
                            <span>👥 Participants Registry</span>
                        </button>
                        <button
                            className={`sidebar-item ${!selectedRoomId && selectedView === 'achievements' ? 'active' : ''}`}
                            onClick={() => { setSelectedRoomId(null); setSelectedView('achievements'); setSidebarOpen(false); }}
                        >
                            <span>🏅 Achievement History</span>
                        </button>
                        <button
                            className={`sidebar-item ${!selectedRoomId && selectedView === 'championship' ? 'active' : ''}`}
                            onClick={() => { setSelectedRoomId(null); setSelectedView('championship'); setSidebarOpen(false); }}
                        >
                            <span>🏆 Team Championship</span>
                        </button>
                        <button
                            className={`sidebar-item ${!selectedRoomId && selectedView === 'individual' ? 'active' : ''}`}
                            onClick={() => { setSelectedRoomId(null); setSelectedView('individual'); setSidebarOpen(false); }}
                        >
                            <span>🥇 Individual Leaderboard</span>
                        </button>
                    </div>

                    <div className="sidebar-section" style={{ flex: 1 }}>
                        <div className="sidebar-section-title flex just-b items-c">
                            <span>Competition Rooms</span>
                            <span className="badge badge-gray" style={{ fontSize: '0.65rem' }}>{rooms.length}</span>
                        </div>
                        {rooms.length === 0 ? (
                            <p className="text-xs col-muted p-2">No rooms created yet.</p>
                        ) : (
                            rooms.map((r) => {
                                const isSel = r.id === selectedRoomId;
                                return (
                                    <button
                                        key={r.id}
                                        className={`sidebar-item ${isSel ? 'active' : ''}`}
                                        onClick={() => { selectRoom(r.id); setSidebarOpen(false); }}
                                    >
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                <strong style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>{r.secret_code}</strong>
                                                <span className="text-xs col-muted">{r.judges.length}/{r.judge_count_required} judges</span>
                                            </div>
                                            <div className="text-xs col-muted truncate">
                                                {r.events.length} event{r.events.length !== 1 ? 's' : ''}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </aside>

                {/* Main Content */}
                <main className="admin-main">
                    <div className="admin-content">
                        {/* Breadcrumbs / Back button if inside a room */}
                        {selectedRoomId && (
                            <div className="flex items-c gap-3 mb-4">
                                <button className="btn btn-secondary btn-sm" onClick={() => setSelectedRoomId(null)}>
                                    ← Back to Dashboard
                                </button>
                                <span className="col-muted">/</span>
                                <span style={{ fontWeight: 700 }}>
                                    Room <strong style={{ fontFamily: 'monospace' }}>{selectedRoom?.secret_code}</strong>
                                </span>
                            </div>
                        )}

                        {/* ── ROOM DASHBOARD (MAIN OVERVIEW) ── */}
                        {!selectedRoom && selectedView === 'overview' && (
                            <motion.div key="overview" variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                                {/* Room Creation Card */}
                                <motion.div className="card" variants={fadeUp}>
                                    <div className="card-header">
                                        <h3>➕ Create Competition Room</h3>
                                        <p className="text-xs col-muted mt-1">Generate a 6-character room code for your judges.</p>
                                    </div>
                                    <div className="card-body">
                                        <form onSubmit={handleCreateRoom} className="flex gap-4 items-e flex-wrap">
                                            <div className="form-group" style={{ minWidth: 160 }}>
                                                <label className="form-label">Required Judges</label>
                                                <select
                                                    className="select"
                                                    value={newRoomJudgeCount}
                                                    onChange={(e) => setNewRoomJudgeCount(Number(e.target.value) as 2 | 3)}
                                                >
                                                    <option value={2}>2 Judges</option>
                                                    <option value={3}>3 Judges</option>
                                                </select>
                                            </div>
                                            <div className="form-group" style={{ minWidth: 180 }}>
                                                <label className="form-label">Participant Code Style</label>
                                                <select
                                                    className="select"
                                                    value={newRoomCodeType}
                                                    onChange={(e) => setNewRoomCodeType(e.target.value as 'number' | 'letter')}
                                                >
                                                    <option value="number">Numbers (1, 2, 3...)</option>
                                                    <option value="letter">Letters (A, B, C...)</option>
                                                </select>
                                            </div>
                                            <button
                                                type="submit"
                                                className="btn btn-primary"
                                                disabled={creating}
                                                style={{ height: 42 }}
                                            >
                                                {creating ? 'Creating…' : 'Generate Room Code'}
                                            </button>
                                        </form>
                                    </div>
                                </motion.div>

                                {/* Active Rooms Table Card */}
                                <motion.div className="card" variants={fadeUp}>
                                    <div className="card-header flex just-b items-c">
                                        <div>
                                            <h3>Active Competition Rooms</h3>
                                            <p className="text-xs col-muted mt-1">Rooms active for judges to join and score.</p>
                                        </div>
                                        <span className="badge badge-gray">{rooms.length} Rooms</span>
                                    </div>
                                    <div className="table-wrap">
                                        <table className="table">
                                            <thead>
                                                <tr>
                                                    <th>Room Code</th>
                                                    <th>Judges Joined</th>
                                                    <th>Events</th>
                                                    <th>Total Scores</th>
                                                    <th>Created Date</th>
                                                    <th style={{ width: 120 }}>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rooms.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={6}>
                                                            <div className="empty-state">
                                                                <p>No active rooms. Create your first competition room above.</p>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    rooms.map((room) => (
                                                        <tr key={room.id}>
                                                            <td>
                                                                <button className="room-code" onClick={() => copyCode(room.secret_code)} title="Click to copy">
                                                                    {room.secret_code} <span style={{ fontSize: 10 }}>⎘</span>
                                                                </button>
                                                            </td>
                                                            <td>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                    <strong>{room.judges.length}</strong>
                                                                    <span className="col-muted">/</span>
                                                                    <select
                                                                        className="select"
                                                                        style={{
                                                                            width: 'auto',
                                                                            padding: '2px 8px',
                                                                            height: 28,
                                                                            fontSize: '0.78rem',
                                                                            fontWeight: 600,
                                                                            cursor: 'pointer'
                                                                        }}
                                                                        value={room.judge_count_required}
                                                                        onChange={(e) => handleUpdateRoomJudgeCount(room.id, Number(e.target.value))}
                                                                        title="Edit required judges count for this room"
                                                                    >
                                                                        <option value={2}>2 Judges</option>
                                                                        <option value={3}>3 Judges</option>
                                                                    </select>
                                                                    {room.judges.length >= room.judge_count_required &&
                                                                        <span className="badge badge-green" style={{ marginLeft: 4 }}>Full</span>}
                                                                </div>
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
                                                    ))
                                                )}
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
                                                                <div className="empty-state"><p>No teams created yet.</p></div>
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

                        {/* ── PARTICIPANTS REGISTRY ── */}
                        {!selectedRoom && selectedView === 'participants' && (
                            <motion.div key="participants" variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, alignItems: 'start' }}>
                                    {/* Single Participant Creation Form */}
                                    <motion.div className="card" variants={fadeUp}>
                                        <div className="card-header">
                                            <h3>👤 Register Participant</h3>
                                            <p className="text-xs col-muted mt-1">Chest numbers are automatically assigned uniquely.</p>
                                        </div>
                                        <div className="card-body">
                                            <form onSubmit={handleCreateParticipant}>
                                                <div className="form-group mb-3">
                                                    <label className="form-label">Full Name</label>
                                                    <input
                                                        type="text"
                                                        className="input"
                                                        placeholder="e.g. Muhammed Ali"
                                                        value={newPartName}
                                                        onChange={(e) => setNewPartName(e.target.value)}
                                                        required
                                                    />
                                                </div>

                                                <div className="form-group mb-3">
                                                    <label className="form-label">Category</label>
                                                    <select
                                                        className="select"
                                                        value={newPartCategory}
                                                        onChange={(e) => setNewPartCategory(e.target.value)}
                                                    >
                                                        <option value="Kiddies">Kiddies</option>
                                                        <option value="Sub Junior">Sub Junior</option>
                                                        <option value="Junior">Junior</option>
                                                        <option value="Senior">Senior</option>
                                                        <option value="Super Senior">Super Senior</option>
                                                        <option value="General">General</option>
                                                    </select>
                                                </div>

                                                <div className="form-group mb-3">
                                                    <label className="form-label">Assign Team</label>
                                                    <select
                                                        className="select"
                                                        value={newPartTeamId}
                                                        onChange={(e) => setNewPartTeamId(e.target.value)}
                                                    >
                                                        <option value="">No Team (Independent)</option>
                                                        {teams.map((t, idx) => (
                                                            <option key={t.id} value={t.id}>
                                                                {t.name} (Series {(idx + 1) * 100}s)
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>

                                                <div className="mb-4" style={{
                                                    background: 'var(--bg-muted)',
                                                    padding: '16px 16px',
                                                    borderRadius: 'var(--r-md)',
                                                    border: '1px solid var(--border)',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: 8
                                                }}>
                                                    <div className="flex just-b items-c">
                                                        <label htmlFor="auto-chest-toggle" className="form-label mb-0" style={{ cursor: 'pointer', margin: 0, fontWeight: 700, fontSize: '0.92rem', color: 'var(--fg-main)' }}>
                                                            ⚡ Auto Generate Chest Number
                                                        </label>
                                                        <input
                                                            id="auto-chest-toggle"
                                                            type="checkbox"
                                                            checked={autoGenerateChest}
                                                            onChange={(e) => setAutoGenerateChest(e.target.checked)}
                                                            style={{ width: 20, height: 20, cursor: 'pointer', accentColor: 'var(--primary)' }}
                                                        />
                                                    </div>
                                                    <p className="text-xs col-muted" style={{ margin: 0, lineHeight: 1.45 }}>
                                                        {autoGenerateChest 
                                                            ? 'Chest number is automatically calculated based on selected team series.'
                                                            : 'Manually specify a custom chest number below.'}
                                                    </p>
                                                </div>

                                                {autoGenerateChest ? (
                                                    <div className="form-group mb-4">
                                                        <label className="form-label mb-1.5">Assigned Chest Number</label>
                                                        <div style={{
                                                            background: '#EEF2FF',
                                                            padding: '12px 16px',
                                                            borderRadius: 'var(--r-md)',
                                                            border: '1.5px solid #C7D2FE',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'space-between'
                                                        }}>
                                                            <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#3730A3' }}>
                                                                Series Next Value:
                                                            </span>
                                                            <span className="room-code" style={{ fontSize: '1rem', padding: '4px 12px', background: 'white', borderRadius: 'var(--r-sm)', border: '1px solid #A5B4FC' }}>
                                                                {generateTeamChestNumber(newPartTeamId, teams, participants)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="form-group mb-4">
                                                        <label className="form-label">Chest Number (Manual)</label>
                                                        <input
                                                            type="text"
                                                            className="input"
                                                            placeholder="e.g. 105 or 203"
                                                            value={manualChestInput}
                                                            onChange={(e) => setManualChestInput(e.target.value)}
                                                            style={{ textTransform: 'uppercase' }}
                                                            required={!autoGenerateChest}
                                                        />
                                                    </div>
                                                )}

                                                <button type="submit" className="btn btn-primary btn-full">
                                                    + Add Participant
                                                </button>
                                            </form>
                                        </div>
                                    </motion.div>

                                    {/* Bulk Import Form */}
                                    <motion.div className="card" variants={fadeUp}>
                                        <div className="card-header">
                                            <h3>⚡ Bulk Import Participants</h3>
                                            <p className="text-xs col-muted mt-1">Format: <code>Participant Name, Team Name</code> (one per line). Chest numbers will be automatically generated.</p>
                                        </div>
                                        <div className="card-body">
                                            <textarea
                                                className="input mb-3"
                                                style={{ height: 130, fontFamily: 'monospace', fontSize: '0.85rem' }}
                                                placeholder={`Ahmed Ali, Red House\nFathima Noor, Blue Panthers\nZayd Omar`}
                                                value={bulkImportText}
                                                onChange={(e) => setBulkImportText(e.target.value)}
                                            />
                                            <button
                                                className="btn btn-secondary btn-full"
                                                onClick={handleBulkImport}
                                                disabled={importing || !bulkImportText.trim()}
                                            >
                                                {importing ? 'Importing…' : 'Import Participants'}
                                            </button>
                                        </div>
                                    </motion.div>
                                </div>

                                {/* Participant Directory Table */}
                                <motion.div className="card" variants={fadeUp}>
                                    <div className="card-header flex just-b items-c" style={{ flexWrap: 'wrap', gap: 12 }}>
                                        <div>
                                            <h3>Participant Registry</h3>
                                            <p className="text-xs col-muted mt-1">Manage participants and click history to view achievements.</p>
                                        </div>
                                        <div className="flex gap-3 items-c" style={{ flex: 1, maxWidth: 300 }}>
                                            <input
                                                type="text"
                                                className="input input-sm"
                                                placeholder="Search name, chest #, team…"
                                                value={partSearch}
                                                onChange={(e) => setPartSearch(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <div className="table-wrap">
                                        <table className="table">
                                            <thead>
                                                <tr>
                                                    <th style={{ width: 110 }}>Chest No.</th>
                                                    <th>Name</th>
                                                    <th>Category</th>
                                                    <th>Team</th>
                                                    <th>Total Prizes Won</th>
                                                    <th style={{ width: 140 }}>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredParticipants.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={6}>
                                                            <div className="empty-state"><p>No participants registered yet.</p></div>
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    filteredParticipants.map((part) => {
                                                        const isEditing = editingPartId === part.id;
                                                        const pTeam = teams.find((t) => t.id === (isEditing ? editingPartTeamId : part.team_id));
                                                        const ach = getParticipantAchievements(part.id);

                                                        return (
                                                            <tr key={part.id}>
                                                                <td>
                                                                    {isEditing ? (
                                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                                            <input
                                                                                type="text"
                                                                                className="input input-sm"
                                                                                style={{ textTransform: 'uppercase', width: 90 }}
                                                                                value={editingPartChest}
                                                                                onChange={(e) => setEditingPartChest(e.target.value)}
                                                                            />
                                                                            <button
                                                                                type="button"
                                                                                className="btn btn-ghost btn-sm"
                                                                                style={{ padding: '2px 4px', fontSize: '0.68rem', color: 'var(--primary)' }}
                                                                                onClick={() => {
                                                                                    const autoVal = generateTeamChestNumber(editingPartTeamId, teams, participants, 0, part.id);
                                                                                    setEditingPartChest(autoVal);
                                                                                }}
                                                                                title="Auto-calculate next available chest number for selected team"
                                                                            >
                                                                                ⚡ Auto Team #
                                                                            </button>
                                                                        </div>
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
                                                                        <strong
                                                                            style={{ cursor: 'pointer', color: 'var(--primary)' }}
                                                                            onClick={() => setViewingHistoryParticipant(part)}
                                                                            title="Click to view achievement history"
                                                                        >
                                                                            {part.name}
                                                                        </strong>
                                                                    )}
                                                                </td>
                                                                <td>
                                                                    {isEditing ? (
                                                                        <select
                                                                            className="select select-sm"
                                                                            value={editingPartCategory}
                                                                            onChange={(e) => setEditingPartCategory(e.target.value)}
                                                                        >
                                                                            <option value="Kiddies">Kiddies</option>
                                                                            <option value="Sub Junior">Sub Junior</option>
                                                                            <option value="Junior">Junior</option>
                                                                            <option value="Senior">Senior</option>
                                                                            <option value="Super Senior">Super Senior</option>
                                                                            <option value="General">General</option>
                                                                        </select>
                                                                    ) : (
                                                                        <span className="badge badge-blue">
                                                                            {part.category || 'Senior'}
                                                                        </span>
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
                                                                    <div className="flex gap-2 items-c text-xs">
                                                                        {ach.firstPrizes > 0 && <span className="badge badge-yellow">🥇 {ach.firstPrizes}</span>}
                                                                        {ach.secondPrizes > 0 && <span className="badge badge-gray">🥈 {ach.secondPrizes}</span>}
                                                                        {ach.thirdPrizes > 0 && <span className="badge badge-blue">🥉 {ach.thirdPrizes}</span>}
                                                                        {ach.totalPrizes === 0 && <span className="col-muted">—</span>}
                                                                    </div>
                                                                </td>
                                                                <td>
                                                                    <div className="flex gap-2">
                                                                        <button
                                                                            className="btn btn-ghost btn-sm"
                                                                            onClick={() => setViewingHistoryParticipant(part)}
                                                                            title="View History"
                                                                        >
                                                                            🏆 History
                                                                        </button>
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
                                                                                    setEditingPartCategory(part.category || 'Senior');
                                                                                }}>✏️</button>
                                                                                <button className="btn btn-ghost btn-sm text-danger" onClick={() => handleDeleteParticipant(part.id)}>🗑️</button>
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </motion.div>
                            </motion.div>
                        )}

                        {/* ── ACHIEVEMENT HISTORY VIEW ── */}
                        {!selectedRoom && selectedView === 'achievements' && (
                            <motion.div key="achievements" variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                                <div className="card">
                                    <div className="card-header flex just-b items-c" style={{ flexWrap: 'wrap', gap: 12 }}>
                                        <div>
                                            <h3>🏅 Participant Achievement Directory</h3>
                                            <p className="text-xs col-muted mt-1">Select a participant to view their full competition history, grades, and medals won.</p>
                                        </div>
                                        <input
                                            type="text"
                                            className="input input-sm"
                                            style={{ maxWidth: 260 }}
                                            placeholder="Filter participant name..."
                                            value={achievementSearch}
                                            onChange={(e) => setAchievementSearch(e.target.value)}
                                        />
                                    </div>
                                    <div className="table-wrap">
                                        <table className="table">
                                            <thead>
                                                <tr>
                                                    <th>Participant</th>
                                                    <th>Chest #</th>
                                                    <th>Team</th>
                                                    <th>Total Events</th>
                                                    <th>Medals (1st / 2nd / 3rd)</th>
                                                    <th>Total Points</th>
                                                    <th style={{ width: 120 }}>Action</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {participants
                                                    .filter(p => p.name.toLowerCase().includes(achievementSearch.toLowerCase()) || p.chest_number.toLowerCase().includes(achievementSearch.toLowerCase()))
                                                    .map(p => {
                                                        const ach = getParticipantAchievements(p.id);
                                                        const team = teams.find(t => t.id === p.team_id);
                                                        return (
                                                            <tr key={p.id}>
                                                                <td><strong>{p.name}</strong></td>
                                                                <td><span className="room-code">{p.chest_number}</span></td>
                                                                <td>{team ? <span className="badge badge-yellow">{team.name}</span> : <span className="col-muted">No Team</span>}</td>
                                                                <td><strong>{ach.totalEvents}</strong></td>
                                                                <td>
                                                                    <div className="flex gap-2 items-c text-xs">
                                                                        <span className="badge badge-yellow">🥇 {ach.firstPrizes}</span>
                                                                        <span className="badge badge-gray">🥈 {ach.secondPrizes}</span>
                                                                        <span className="badge badge-blue">🥉 {ach.thirdPrizes}</span>
                                                                    </div>
                                                                </td>
                                                                <td><strong style={{ color: 'var(--primary)', fontSize: '1.05rem' }}>{ach.totalPoints} pts</strong></td>
                                                                <td>
                                                                    <button
                                                                        className="btn btn-primary btn-sm"
                                                                        onClick={() => setViewingHistoryParticipant(p)}
                                                                    >
                                                                        View History 🏆
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {/* ── TEAM STANDINGS ── */}
                        {!selectedRoom && selectedView === 'championship' && (() => {
                            const categories = getAvailableCategories();
                            const standings = calculateTeamStandings(championshipCategory);
                            const championTeam = standings.length > 0 && standings[0].points > 0 ? standings[0] : null;

                            return (
                                <motion.div key="championship" variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                                        <button
                                            className={`btn btn-sm ${championshipCategory === 'overall' ? 'btn-primary' : 'btn-secondary'}`}
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
                                    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                                        <button
                                            className={`btn btn-sm ${individualCategory === 'overall' ? 'btn-primary' : 'btn-secondary'}`}
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
                                                </tbody>
                                            </table>
                                        </div>
                                    </motion.div>
                                </motion.div>
                            );
                        })()}

                        {/* ── ROOM DETAIL VIEW ── */}
                        {selectedRoom && (
                            <motion.div key={selectedRoom.id}
                                initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -16 }}
                                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                            >
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                                    gap: 12, marginBottom: 20,
                                }}>
                                    {[
                                        { label: 'Room Code', value: <button className="room-code" onClick={() => copyCode(selectedRoom.secret_code)}>{selectedRoom.secret_code} ⎘</button> },
                                        {
                                            label: 'Judges Required',
                                            value: (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <strong style={{ fontSize: '1.3rem' }}>{selectedRoom.judges.length}</strong>
                                                    <span className="col-muted" style={{ fontSize: '1.1rem' }}>/</span>
                                                    <select
                                                        className="select"
                                                        style={{
                                                            width: 'auto',
                                                            padding: '2px 10px',
                                                            height: 32,
                                                            fontSize: '0.88rem',
                                                            fontWeight: 700,
                                                            borderColor: 'var(--primary)',
                                                            background: 'rgba(79, 70, 229, 0.05)',
                                                            color: 'var(--primary)',
                                                            cursor: 'pointer'
                                                        }}
                                                        value={selectedRoom.judge_count_required}
                                                        onChange={(e) => handleUpdateRoomJudgeCount(selectedRoom.id, Number(e.target.value))}
                                                        title="Edit required judges for this room"
                                                    >
                                                        <option value={2}>2 Judges</option>
                                                        <option value={3}>3 Judges</option>
                                                    </select>
                                                </div>
                                            )
                                        },
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
                                    {roomTab === 'overview' && (
                                        <motion.div key="overview-tab"
                                            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -10 }}
                                            transition={{ duration: 0.25 }}
                                            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
                                        >
                                            {/* Judges List */}
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

                                            {/* Events Management & Creation */}
                                            <div className="card">
                                                <div className="card-header flex just-b items-c">
                                                    <div>
                                                        <h3>Events Management</h3>
                                                        <p className="text-xs col-muted mt-1">Create events and select participating students for this room.</p>
                                                    </div>
                                                    <button
                                                        className="btn btn-primary btn-sm"
                                                        onClick={() => {
                                                            setShowCreateEventModal(true);
                                                            setEventCategoryFilter(newEventCategory);
                                                        }}
                                                    >
                                                        + Create Event
                                                    </button>
                                                </div>
                                                {selectedRoom.events.length === 0 ? (
                                                    <div className="card-body">
                                                        <div className="empty-state" style={{ padding: '28px 0' }}>
                                                            <p>No events created yet. Click "+ Create Event" above to create an event.</p>
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
                                                                            <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                                                                                {ev.category && <span className="badge badge-gray" style={{ padding: '2px 6px', fontSize: '0.7rem' }}>{ev.category}</span>}
                                                                                <span className={`badge ${ev.event_type === 'group' ? 'badge-purple' : 'badge-blue'}`} style={{ padding: '2px 6px', fontSize: '0.7rem', fontWeight: 600 }}>
                                                                                    {ev.event_type === 'group' ? '👥 Group Event' : '👤 Solo Event'}
                                                                                </span>
                                                                            </div>
                                                                        </td>
                                                                        <td><strong>{ev.participant_count}</strong></td>
                                                                        <td>
                                                                            {ev.scores.length}
                                                                            {ev.scores.length > 0 && <span className="badge badge-green" style={{ marginLeft: 6 }}>Live</span>}
                                                                        </td>
                                                                        <td className="col-muted text-xs">{ev.created_by}</td>
                                                                        <td className="col-muted">{new Date(ev.created_at).toLocaleDateString()}</td>
                                                                        <td>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                                <button
                                                                                    className={`btn btn-sm ${mappingEventId === ev.id ? 'btn-primary' : 'btn-ghost'}`}
                                                                                    onClick={() => startMapping(ev)}
                                                                                >
                                                                                    Code Mapping ⚙️
                                                                                </button>
                                                                                <button
                                                                                    className="btn btn-ghost btn-sm"
                                                                                    style={{ color: 'var(--primary)', fontWeight: 600 }}
                                                                                    onClick={() => openEditEventModal(ev)}
                                                                                    title="Edit Event Details & Participants"
                                                                                >
                                                                                    ✏️ Edit
                                                                                </button>
                                                                                <button
                                                                                    className="btn btn-ghost btn-sm text-danger"
                                                                                    style={{ color: '#ef4444' }}
                                                                                    onClick={() => setDeletingEvent({ id: ev.id, name: ev.event_name })}
                                                                                    title="Delete Event"
                                                                                >
                                                                                    🗑️ Delete
                                                                                </button>
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>

                                                                                         {/* Code Assignment Section */}
                                             {mappingEventId && (() => {
                                                 const ev = selectedRoom.events.find(e => e.id === mappingEventId);
                                                 if (!ev) return null;

                                                 const eventM = mappings.filter(m => m.event_id === ev.id);
                                                 const isGroup = ev.event_type === 'group';

                                                 type GroupTeamRow = {
                                                     key: string;
                                                     teamLabel: string;
                                                     participantIds: string[];
                                                     memberParts: Participant[];
                                                     codeNum: number | null;
                                                     institutionTeamName: string | null;
                                                 };

                                                 let groupRows: GroupTeamRow[] = [];
                                                 let soloParts: Participant[] = [];

                                                 if (isGroup) {
                                                     const numberGroups = new Map<number, string[]>();
                                                     const nullParts: string[] = [];

                                                     eventM.forEach(m => {
                                                         if (m.participant_number !== null && m.participant_number !== undefined) {
                                                             if (!numberGroups.has(m.participant_number)) {
                                                                 numberGroups.set(m.participant_number, []);
                                                             }
                                                             numberGroups.get(m.participant_number)!.push(m.participant_id);
                                                         } else {
                                                             nullParts.push(m.participant_id);
                                                         }
                                                     });

                                                     let teamCounter = 1;
                                                     const sortedNums = Array.from(numberGroups.keys()).sort((a, b) => a - b);
                                                     sortedNums.forEach((num) => {
                                                         const pIds = numberGroups.get(num) || [];
                                                         const members = participants.filter(p => pIds.includes(p.id));
                                                         const firstTeam = members.length > 0 ? teams.find(t => t.id === members[0].team_id) : null;
                                                         groupRows.push({
                                                             key: `num-${num}`,
                                                             teamLabel: `Team ${teamCounter++}`,
                                                             participantIds: pIds,
                                                             memberParts: members,
                                                             codeNum: num,
                                                             institutionTeamName: firstTeam ? firstTeam.name : null
                                                         });
                                                     });

                                                     if (nullParts.length > 0) {
                                                         const byTeamId = new Map<string, string[]>();
                                                         nullParts.forEach(pId => {
                                                             const part = participants.find(p => p.id === pId);
                                                             const tId = part?.team_id || 'no-team';
                                                             if (!byTeamId.has(tId)) byTeamId.set(tId, []);
                                                             byTeamId.get(tId)!.push(pId);
                                                         });

                                                         byTeamId.forEach((pIds, tId) => {
                                                             const members = participants.filter(p => pIds.includes(p.id));
                                                             const pTeam = teams.find(t => t.id === tId);
                                                             groupRows.push({
                                                                 key: `team-${tId}`,
                                                                 teamLabel: `Team ${teamCounter++}`,
                                                                 participantIds: pIds,
                                                                 memberParts: members,
                                                                 codeNum: null,
                                                                 institutionTeamName: pTeam ? pTeam.name : null
                                                             });
                                                         });
                                                     }
                                                 } else {
                                                     soloParts = participants.filter(p => eventM.some(m => m.participant_id === p.id));
                                                 }

                                                 return (
                                                     <div className="card" style={{ marginTop: 16 }}>
                                                         <div className="card-header flex just-b items-c" style={{ flexWrap: 'wrap', gap: 12 }}>
                                                             <div>
                                                                 <h3>Live Code Assignment: {ev.event_name} {isGroup ? '(Group Event)' : '(Solo Event)'}</h3>
                                                                 <p className="text-xs col-muted mt-1">
                                                                     {isGroup
                                                                         ? 'Assign code numbers team-wise. All participating members in a team will share the assigned code.'
                                                                         : 'Selected participants for this event are listed below. Enter code numbers manually.'}
                                                                 </p>
                                                             </div>
                                                             <div className="flex gap-2 items-c">
                                                                 <button
                                                                     className="btn btn-ghost btn-sm text-danger text-xs"
                                                                     onClick={() => handleClearAllCodes(ev.id)}
                                                                     title="Clear all code numbers for this event"
                                                                 >
                                                                     🧹 Clear All Codes
                                                                 </button>
                                                                 <button className="btn btn-secondary btn-sm" onClick={() => setMappingEventId(null)}>Close Assignment</button>
                                                             </div>
                                                         </div>
                                                         <div className="card-body">
                                                             <div className="table-wrap">
                                                                 <table className="table">
                                                                     <thead>
                                                                         {isGroup ? (
                                                                             <tr>
                                                                                 <th>Competing Team</th>
                                                                                 <th>Participating Members</th>
                                                                                 <th>Categories</th>
                                                                                 <th>Academy / Team</th>
                                                                                 <th style={{ width: 240 }}>Code Number (Manual Entry)</th>
                                                                             </tr>
                                                                         ) : (
                                                                             <tr>
                                                                                 <th>Participant Name</th>
                                                                                 <th>Chest No.</th>
                                                                                 <th>Category</th>
                                                                                 <th>Team</th>
                                                                                 <th style={{ width: 240 }}>Code Number (Manual Entry)</th>
                                                                             </tr>
                                                                         )}
                                                                     </thead>
                                                                     <tbody>
                                                                         {isGroup ? (
                                                                             groupRows.length === 0 ? (
                                                                                 <tr>
                                                                                     <td colSpan={5}>
                                                                                         <div className="empty-state"><p>No registered teams found for this group event.</p></div>
                                                                                     </td>
                                                                                 </tr>
                                                                             ) : (
                                                                                 groupRows.map((row) => {
                                                                                     const inputKey = row.key;
                                                                                     const codeNum = row.codeNum;
                                                                                     const savedCodeStr = codeNum ? getCodeName(codeNum, selectedRoom.code_type) : '';
                                                                                     const rawVal = localCodeInputs[inputKey] !== undefined
                                                                                         ? localCodeInputs[inputKey]
                                                                                         : savedCodeStr;
                                                                                     const isModified = rawVal.trim() !== savedCodeStr.trim();
                                                                                     const categories = [...new Set(row.memberParts.map(p => p.category || 'Senior'))].join(', ');

                                                                                     return (
                                                                                         <tr key={row.key}>
                                                                                             <td>
                                                                                                 <strong style={{ fontSize: '0.95rem', color: 'var(--primary)' }}>
                                                                                                     🚩 {row.teamLabel}
                                                                                                 </strong>
                                                                                             </td>
                                                                                             <td>
                                                                                                 <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                                                                                     {row.memberParts.map(part => (
                                                                                                         <span key={part.id} className="badge badge-purple" style={{ padding: '4px 8px', fontSize: '0.78rem' }}>
                                                                                                             <strong>{part.name}</strong> <span style={{ opacity: 0.8 }}>({part.chest_number})</span>
                                                                                                         </span>
                                                                                                     ))}
                                                                                                 </div>
                                                                                             </td>
                                                                                             <td>
                                                                                                 <span className="badge badge-blue" style={{ fontSize: '0.75rem' }}>
                                                                                                     {categories}
                                                                                                 </span>
                                                                                             </td>
                                                                                             <td>
                                                                                                 <span className={row.institutionTeamName ? 'badge badge-yellow' : 'badge badge-gray'}>
                                                                                                     {row.institutionTeamName || 'No Team'}
                                                                                                 </span>
                                                                                             </td>
                                                                                             <td>
                                                                                                 <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                                                                     <input
                                                                                                         type="text"
                                                                                                         className="input input-sm"
                                                                                                         style={{
                                                                                                             width: 100,
                                                                                                             fontWeight: 700,
                                                                                                             textAlign: 'center',
                                                                                                             textTransform: 'uppercase',
                                                                                                             borderColor: rawVal.trim() ? 'var(--primary)' : 'var(--border)',
                                                                                                             background: rawVal.trim() ? 'rgba(79, 70, 229, 0.04)' : 'white'
                                                                                                         }}
                                                                                                         placeholder="Enter code"
                                                                                                         value={rawVal}
                                                                                                         onChange={(e) => {
                                                                                                             const val = e.target.value;
                                                                                                             setLocalCodeInputs(prev => ({ ...prev, [inputKey]: val }));
                                                                                                         }}
                                                                                                         onKeyDown={(e) => {
                                                                                                             if (e.key === 'Enter') {
                                                                                                                 handleSaveGroupTeamCode(ev.id, row.participantIds, rawVal);
                                                                                                             }
                                                                                                         }}
                                                                                                     />
                                                                                                     <button
                                                                                                         type="button"
                                                                                                         className={`btn btn-sm ${isModified ? 'btn-primary' : 'btn-ghost'}`}
                                                                                                         style={{ padding: '4px 12px', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                                                                                                         onClick={() => handleSaveGroupTeamCode(ev.id, row.participantIds, rawVal)}
                                                                                                     >
                                                                                                         Save
                                                                                                     </button>
                                                                                                 </div>
                                                                                             </td>
                                                                                         </tr>
                                                                                     );
                                                                                 })
                                                                             )
                                                                         ) : (
                                                                             soloParts.length === 0 ? (
                                                                                 <tr>
                                                                                     <td colSpan={5}>
                                                                                         <div className="empty-state"><p>No registered participants found for this event.</p></div>
                                                                                     </td>
                                                                                 </tr>
                                                                             ) : (
                                                                                 soloParts.map((part) => {
                                                                                     const partMap = eventM.find(m => m.participant_id === part.id);
                                                                                     const codeNum = partMap ? partMap.participant_number : null;
                                                                                     const pTeam = teams.find(t => t.id === part.team_id);
                                                                                     const rawVal = localCodeInputs[part.id] !== undefined ? localCodeInputs[part.id] : (codeNum ? getCodeName(codeNum, selectedRoom.code_type) : '');
                                                                                     
                                                                                     const savedCodeStr = codeNum ? getCodeName(codeNum, selectedRoom.code_type) : '';
                                                                                     const isModified = rawVal.trim() !== savedCodeStr.trim();

                                                                                     return (
                                                                                         <tr key={part.id}>
                                                                                             <td><strong style={{ fontSize: '0.95rem' }}>{part.name}</strong></td>
                                                                                             <td>
                                                                                                 <span className="room-code" style={{ padding: '4px 8px', fontSize: '0.82rem' }}>
                                                                                                     {part.chest_number}
                                                                                                 </span>
                                                                                             </td>
                                                                                             <td>
                                                                                                 <span className="badge badge-blue" style={{ fontSize: '0.75rem' }}>
                                                                                                     {part.category || 'Senior'}
                                                                                                 </span>
                                                                                             </td>
                                                                                             <td>
                                                                                                 <span className={part.team_id ? 'badge badge-yellow' : 'badge badge-gray'}>
                                                                                                     {pTeam ? pTeam.name : 'No Team'}
                                                                                                 </span>
                                                                                             </td>
                                                                                             <td>
                                                                                                 <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                                                                     <input
                                                                                                         type="text"
                                                                                                         className="input input-sm"
                                                                                                         style={{
                                                                                                             width: 100,
                                                                                                             fontWeight: 700,
                                                                                                             textAlign: 'center',
                                                                                                             textTransform: 'uppercase',
                                                                                                             borderColor: rawVal.trim() ? 'var(--primary)' : 'var(--border)',
                                                                                                             background: rawVal.trim() ? 'rgba(79, 70, 229, 0.04)' : 'white'
                                                                                                         }}
                                                                                                         placeholder="Enter code"
                                                                                                         value={rawVal}
                                                                                                         onChange={(e) => {
                                                                                                             const val = e.target.value;
                                                                                                             setLocalCodeInputs(prev => ({ ...prev, [part.id]: val }));
                                                                                                         }}
                                                                                                         onKeyDown={(e) => {
                                                                                                             if (e.key === 'Enter') {
                                                                                                                 handleSaveTypedCode(ev.id, part.id, rawVal);
                                                                                                             }
                                                                                                         }}
                                                                                                     />
                                                                                                     <button
                                                                                                         type="button"
                                                                                                         className={`btn btn-sm ${isModified ? 'btn-primary' : 'btn-ghost'}`}
                                                                                                         style={{ padding: '4px 12px', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                                                                                                         onClick={() => handleSaveTypedCode(ev.id, part.id, rawVal)}
                                                                                                     >
                                                                                                         Save
                                                                                                     </button>
                                                                                                 </div>
                                                                                             </td>
                                                                                         </tr>
                                                                                     );
                                                                                 })
                                                                             )
                                                                         )}
                                                                     </tbody>
                                                                 </table>
                                                             </div>
                                                         </div>
                                                     </div>
                                                 );
                                             })()}
                                        </motion.div>
                                    )}

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
                                                            <p>Create an event above to see live scores.</p>
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
                    </div>

                    <Footer />
                </main>
            </div>

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

            {/* Admin Event Creation Modal */}
            <AnimatePresence>
                {showCreateEventModal && selectedRoom && (
                    <div className="sidebar-overlay" style={{ zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                        <motion.div
                            className="card"
                            style={{ maxWidth: 540, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                        >
                            <div className="card-header flex just-b items-c">
                                <h3>➕ Create Event for Room {selectedRoom.secret_code}</h3>
                                <button className="btn btn-ghost btn-sm" onClick={() => setShowCreateEventModal(false)}>✕</button>
                            </div>
                            <div className="card-body" style={{ overflowY: 'auto' }}>
                                <form onSubmit={handleAdminCreateEvent} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                    <div className="form-group">
                                        <label className="form-label">Event Type</label>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                            <button
                                                type="button"
                                                className={`btn ${newEventType === 'solo' ? 'btn-primary' : 'btn-ghost'}`}
                                                style={{
                                                    border: newEventType === 'solo' ? '2px solid var(--primary)' : '1px solid var(--border)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: 8,
                                                    padding: '10px 14px',
                                                    fontWeight: 600
                                                }}
                                                onClick={() => setNewEventType('solo')}
                                            >
                                                👤 Solo Event
                                            </button>
                                            <button
                                                type="button"
                                                className={`btn ${newEventType === 'group' ? 'btn-primary' : 'btn-ghost'}`}
                                                style={{
                                                    border: newEventType === 'group' ? '2px solid var(--primary)' : '1px solid var(--border)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: 8,
                                                    padding: '10px 14px',
                                                    fontWeight: 600
                                                }}
                                                onClick={() => setNewEventType('group')}
                                            >
                                                👥 Group Event
                                            </button>
                                        </div>
                                        <p className="text-xs col-muted mt-1">
                                            {newEventType === 'solo'
                                                ? '👤 Solo: Points count for both Solo & Team Championship.'
                                                : '👥 Group: Points count EXCLUSIVELY for Team Championship (10+5 pts).'}
                                        </p>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Event Name</label>
                                        <input
                                            type="text"
                                            className="input"
                                            placeholder="e.g. Qur'an Recitation Senior"
                                            value={newEventName}
                                            onChange={(e) => setNewEventName(e.target.value)}
                                            required
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Category</label>
                                        <select
                                            className="select"
                                            value={newEventCategory}
                                            onChange={(e) => {
                                                const cat = e.target.value;
                                                setNewEventCategory(cat);
                                                if (cat !== 'Other') {
                                                    setEventCategoryFilter(cat);
                                                }
                                            }}
                                        >
                                            <option value="Kiddies">Kiddies</option>
                                            <option value="Sub Junior">Sub Junior</option>
                                            <option value="Junior">Junior</option>
                                            <option value="Senior">Senior</option>
                                            <option value="Super Senior">Super Senior</option>
                                            <option value="General">General</option>
                                            <option value="Other">Other Category...</option>
                                        </select>
                                    </div>

                                    {newEventCategory === 'Other' && (
                                        <div className="form-group">
                                            <label className="form-label">Custom Category Name</label>
                                            <input
                                                type="text"
                                                className="input"
                                                placeholder="e.g. Calligraphy"
                                                value={newEventCustomCategory}
                                                onChange={(e) => {
                                                    const custom = e.target.value;
                                                    setNewEventCustomCategory(custom);
                                                    if (custom.trim()) {
                                                        setEventCategoryFilter(custom.trim());
                                                    }
                                                }}
                                                required
                                            />
                                        </div>
                                    )}

                                     {newEventType === 'group' ? (
                                        <div className="form-group" style={{ background: '#F8FAFC', padding: 14, borderRadius: 8, border: '1px solid var(--border)' }}>
                                            <div className="flex just-b items-c mb-3">
                                                <div>
                                                    <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                                                        👥 Competing Teams ({createGroupTeams.length} Teams)
                                                    </h4>
                                                    <p className="text-xs col-muted style-normal" style={{ margin: '2px 0 0 0' }}>
                                                        Assign participants team-wise. Each team competes as a single group unit.
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => {
                                                        setCreateGroupTeams(prev => [
                                                            ...prev,
                                                            { id: `gt-${Date.now()}`, name: `Team ${prev.length + 1}`, participantIds: [] }
                                                        ]);
                                                    }}
                                                >
                                                    ➕ Add Team
                                                </button>
                                            </div>

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                                {createGroupTeams.map((gt, tIdx) => {
                                                    const assignedElsewhere = createGroupTeams
                                                        .filter((_, idx) => idx !== tIdx)
                                                        .flatMap(t => t.participantIds);

                                                    const availableForTeam = participants.filter(p => !assignedElsewhere.includes(p.id));

                                                    return (
                                                        <div key={gt.id} style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                                                            <div className="flex just-b items-c mb-2">
                                                                <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--primary)' }}>
                                                                    🚩 {gt.name || `Team ${tIdx + 1}`} (Code {tIdx + 1})
                                                                </span>
                                                                {createGroupTeams.length > 2 && (
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-ghost btn-sm text-danger text-xs"
                                                                        onClick={() => {
                                                                            setCreateGroupTeams(prev => prev.filter((_, idx) => idx !== tIdx));
                                                                        }}
                                                                    >
                                                                        🗑️ Remove Team
                                                                    </button>
                                                                )}
                                                            </div>

                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, minHeight: 28, alignItems: 'center' }}>
                                                                {gt.participantIds.length === 0 ? (
                                                                    <span className="text-xs col-muted italic">No students assigned to this team yet.</span>
                                                                ) : (
                                                                    gt.participantIds.map(pId => {
                                                                        const part = participants.find(p => p.id === pId);
                                                                        if (!part) return null;
                                                                        const teamObj = teams.find(t => t.id === part.team_id);
                                                                        return (
                                                                            <span key={pId} className="badge badge-purple" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', fontSize: '0.78rem' }}>
                                                                                <span><strong>{part.name}</strong> ({part.chest_number})</span>
                                                                                {teamObj && <span style={{ opacity: 0.8, fontSize: '0.7rem' }}>[{teamObj.name}]</span>}
                                                                                <button
                                                                                    type="button"
                                                                                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', fontWeight: 'bold', marginLeft: 2 }}
                                                                                    onClick={() => {
                                                                                        setCreateGroupTeams(prev => prev.map((t, idx) => idx === tIdx ? { ...t, participantIds: t.participantIds.filter(id => id !== pId) } : t));
                                                                                    }}
                                                                                >
                                                                                    ✕
                                                                                </button>
                                                                            </span>
                                                                        );
                                                                    })
                                                                )}
                                                            </div>

                                                            <div className="flex gap-2 items-c">
                                                                <select
                                                                    className="select select-sm flex-1"
                                                                    defaultValue=""
                                                                    onChange={(e) => {
                                                                        const selectedId = e.target.value;
                                                                        if (!selectedId) return;
                                                                        if (!gt.participantIds.includes(selectedId)) {
                                                                            setCreateGroupTeams(prev => prev.map((t, idx) => idx === tIdx ? { ...t, participantIds: [...t.participantIds, selectedId] } : t));
                                                                        }
                                                                        e.target.value = "";
                                                                    }}
                                                                >
                                                                    <option value="">➕ Add Student to {gt.name || `Team ${tIdx + 1}`}...</option>
                                                                    {availableForTeam
                                                                        .filter(p => !gt.participantIds.includes(p.id))
                                                                        .map(p => {
                                                                            const pTeam = teams.find(t => t.id === p.team_id);
                                                                            return (
                                                                                <option key={p.id} value={p.id}>
                                                                                    {p.name} (Chest: {p.chest_number}) - {p.category || 'Senior'} {pTeam ? `[${pTeam.name}]` : ''}
                                                                                </option>
                                                                            );
                                                                        })}
                                                                </select>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="form-group">
                                            <div className="flex just-b items-c mb-2">
                                                <label className="form-label" style={{ margin: 0 }}>
                                                    Select Participating Students ({selectedParticipantIdsForEvent.length} selected)
                                                </label>
                                                <div className="flex gap-2">
                                                    <button
                                                        type="button"
                                                        className="btn btn-ghost btn-sm text-xs"
                                                        style={{ color: 'var(--primary)', fontWeight: 600 }}
                                                        onClick={() => {
                                                            const activeCat = eventCategoryFilter === 'all' ? newEventCategory : eventCategoryFilter;
                                                            const catPartIds = participants
                                                                .filter(p => (p.category || 'Senior') === activeCat)
                                                                .map(p => p.id);
                                                            
                                                            const allSelected = catPartIds.length > 0 && catPartIds.every(id => selectedParticipantIdsForEvent.includes(id));
                                                            if (allSelected) {
                                                                setSelectedParticipantIdsForEvent(prev => prev.filter(id => !catPartIds.includes(id)));
                                                            } else {
                                                                setSelectedParticipantIdsForEvent(prev => [...new Set([...prev, ...catPartIds])]);
                                                            }
                                                        }}
                                                    >
                                                        ⚡ Select All {eventCategoryFilter === 'all' ? newEventCategory : eventCategoryFilter}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn btn-ghost btn-sm text-xs"
                                                        onClick={() => {
                                                            if (selectedParticipantIdsForEvent.length === participants.length) {
                                                                setSelectedParticipantIdsForEvent([]);
                                                            } else {
                                                                setSelectedParticipantIdsForEvent(participants.map(p => p.id));
                                                            }
                                                        }}
                                                    >
                                                        {selectedParticipantIdsForEvent.length === participants.length ? 'Deselect All' : 'Select All'}
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Category Filter Pills */}
                                            <div className="flex gap-1 mb-2" style={{ flexWrap: 'wrap' }}>
                                                {['all', newEventCategory, 'Kiddies', 'Sub Junior', 'Junior', 'Senior', 'Super Senior', 'General']
                                                    .filter((val, index, self) => self.indexOf(val) === index)
                                                    .map((cat) => (
                                                        <button
                                                            key={cat}
                                                            type="button"
                                                            className={`btn btn-sm ${eventCategoryFilter === cat ? 'btn-primary' : 'btn-ghost'}`}
                                                            style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                                                            onClick={() => setEventCategoryFilter(cat)}
                                                        >
                                                            {cat === 'all' ? 'All' : cat === newEventCategory ? `⭐ ${cat}` : cat}
                                                        </button>
                                                    ))}
                                            </div>

                                            <input
                                                type="text"
                                                className="input input-sm mb-2"
                                                placeholder="Search student name, chest #..."
                                                value={eventParticipantSearch}
                                                onChange={(e) => setEventParticipantSearch(e.target.value)}
                                            />

                                            <div style={{
                                                border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                                                maxHeight: 200, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6
                                            }}>
                                                {participants.length === 0 ? (
                                                    <p className="text-xs col-muted p-2">No registered participants. Register participants first.</p>
                                                ) : (() => {
                                                    const filteredParts = participants.filter(p => {
                                                        const matchesSearch = p.name.toLowerCase().includes(eventParticipantSearch.toLowerCase()) || p.chest_number.toLowerCase().includes(eventParticipantSearch.toLowerCase());
                                                        const partCat = p.category || 'Senior';
                                                        const matchesCat = eventCategoryFilter === 'all' ? true : partCat === eventCategoryFilter;
                                                        return matchesSearch && matchesCat;
                                                    });

                                                    if (filteredParts.length === 0) {
                                                        return (
                                                            <div className="p-3 text-center">
                                                                <p className="text-xs col-muted" style={{ margin: 0 }}>
                                                                    No participants registered in category <strong>"{eventCategoryFilter}"</strong>.
                                                                </p>
                                                                {eventCategoryFilter !== 'all' && (
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-ghost btn-sm text-xs mt-1"
                                                                        style={{ color: 'var(--primary)', fontWeight: 600 }}
                                                                        onClick={() => setEventCategoryFilter('all')}
                                                                    >
                                                                        Show All Participants
                                                                    </button>
                                                                )}
                                                            </div>
                                                        );
                                                    }

                                                    return filteredParts.map((part) => {
                                                        const isChecked = selectedParticipantIdsForEvent.includes(part.id);
                                                        const team = teams.find(t => t.id === part.team_id);
                                                        return (
                                                            <label key={part.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', cursor: 'pointer', borderRadius: 4, background: isChecked ? 'var(--primary-light)' : 'transparent' }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isChecked}
                                                                    onChange={(e) => {
                                                                        if (e.target.checked) {
                                                                            setSelectedParticipantIdsForEvent(prev => [...prev, part.id]);
                                                                        } else {
                                                                            setSelectedParticipantIdsForEvent(prev => prev.filter(id => id !== part.id));
                                                                        }
                                                                    }}
                                                                />
                                                                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{part.name}</span>
                                                                <span className="room-code text-xs">{part.chest_number}</span>
                                                                <span className="badge badge-purple text-xs" style={{ padding: '1px 6px', fontSize: '0.7rem' }}>{part.category || 'Senior'}</span>
                                                                {team && <span className="badge badge-gray text-xs">{team.name}</span>}
                                                            </label>
                                                        );
                                                    });
                                                })()}
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex gap-3 mt-3">
                                        <button type="button" className="btn btn-secondary flex-1" onClick={() => setShowCreateEventModal(false)}>Cancel</button>
                                        <button type="submit" className="btn btn-primary flex-1" disabled={creatingEvent}>
                                            {creatingEvent ? 'Creating Event...' : 'Create Event'}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Admin Edit Event Modal */}
            <AnimatePresence>
                {editingEvent && (
                    <div className="sidebar-overlay" style={{ zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                        <motion.div
                            className="card"
                            style={{ maxWidth: 540, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                        >
                            <div className="card-header flex just-b items-c">
                                <h3>✏️ Edit Event: {editingEvent.event_name}</h3>
                                <button className="btn btn-ghost btn-sm" onClick={() => setEditingEvent(null)}>✕</button>
                            </div>
                            <div className="card-body" style={{ overflowY: 'auto' }}>
                                <form onSubmit={handleSaveEditEvent} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                    <div className="form-group">
                                        <label className="form-label">Event Type</label>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                            <button
                                                type="button"
                                                className={`btn ${editEventType === 'solo' ? 'btn-primary' : 'btn-ghost'}`}
                                                style={{
                                                    border: editEventType === 'solo' ? '2px solid var(--primary)' : '1px solid var(--border)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: 8,
                                                    padding: '10px 14px',
                                                    fontWeight: 600
                                                }}
                                                onClick={() => setEditEventType('solo')}
                                            >
                                                👤 Solo Event
                                            </button>
                                            <button
                                                type="button"
                                                className={`btn ${editEventType === 'group' ? 'btn-primary' : 'btn-ghost'}`}
                                                style={{
                                                    border: editEventType === 'group' ? '2px solid var(--primary)' : '1px solid var(--border)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: 8,
                                                    padding: '10px 14px',
                                                    fontWeight: 600
                                                }}
                                                onClick={() => setEditEventType('group')}
                                            >
                                                👥 Group Event
                                            </button>
                                        </div>
                                        <p className="text-xs col-muted mt-1">
                                            {editEventType === 'solo'
                                                ? '👤 Solo: Points count for both Solo & Team Championship.'
                                                : '👥 Group: Points count EXCLUSIVELY for Team Championship (10+5 pts).'}
                                        </p>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Event Name</label>
                                        <input
                                            type="text"
                                            className="input"
                                            placeholder="e.g. Qur'an Recitation Senior"
                                            value={editEventName}
                                            onChange={(e) => setEditEventName(e.target.value)}
                                            required
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Category</label>
                                        <select
                                            className="select"
                                            value={editEventCategory}
                                            onChange={(e) => {
                                                const cat = e.target.value;
                                                setEditEventCategory(cat);
                                                if (cat !== 'Other') {
                                                    setEditEventCategoryFilter(cat);
                                                }
                                            }}
                                        >
                                            <option value="Kiddies">Kiddies</option>
                                            <option value="Sub Junior">Sub Junior</option>
                                            <option value="Junior">Junior</option>
                                            <option value="Senior">Senior</option>
                                            <option value="Super Senior">Super Senior</option>
                                            <option value="General">General</option>
                                            <option value="Other">Other Category...</option>
                                        </select>
                                    </div>

                                    {editEventCategory === 'Other' && (
                                        <div className="form-group">
                                            <label className="form-label">Custom Category Name</label>
                                            <input
                                                type="text"
                                                className="input"
                                                placeholder="e.g. Calligraphy"
                                                value={editEventCustomCategory}
                                                onChange={(e) => setEditEventCustomCategory(e.target.value)}
                                                required
                                            />
                                        </div>
                                    )}

                                     {editEventType === 'group' ? (
                                        <div className="form-group" style={{ background: '#F8FAFC', padding: 14, borderRadius: 8, border: '1px solid var(--border)' }}>
                                            <div className="flex just-b items-c mb-3">
                                                <div>
                                                    <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                                                        👥 Competing Teams ({editGroupTeams.length} Teams)
                                                    </h4>
                                                    <p className="text-xs col-muted style-normal" style={{ margin: '2px 0 0 0' }}>
                                                        Assign participants team-wise. Each team competes as a single group unit.
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => {
                                                        setEditGroupTeams(prev => [
                                                            ...prev,
                                                            { id: `gt-${Date.now()}`, name: `Team ${prev.length + 1}`, participantIds: [] }
                                                        ]);
                                                    }}
                                                >
                                                    ➕ Add Team
                                                </button>
                                            </div>

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                                {editGroupTeams.map((gt, tIdx) => {
                                                    const assignedElsewhere = editGroupTeams
                                                        .filter((_, idx) => idx !== tIdx)
                                                        .flatMap(t => t.participantIds);

                                                    const availableForTeam = participants.filter(p => !assignedElsewhere.includes(p.id));

                                                    return (
                                                        <div key={gt.id} style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                                                            <div className="flex just-b items-c mb-2">
                                                                <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--primary)' }}>
                                                                    🚩 {gt.name || `Team ${tIdx + 1}`} (Code {tIdx + 1})
                                                                </span>
                                                                {editGroupTeams.length > 2 && (
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-ghost btn-sm text-danger text-xs"
                                                                        onClick={() => {
                                                                            setEditGroupTeams(prev => prev.filter((_, idx) => idx !== tIdx));
                                                                        }}
                                                                    >
                                                                        🗑️ Remove Team
                                                                    </button>
                                                                )}
                                                            </div>

                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, minHeight: 28, alignItems: 'center' }}>
                                                                {gt.participantIds.length === 0 ? (
                                                                    <span className="text-xs col-muted italic">No students assigned to this team yet.</span>
                                                                ) : (
                                                                    gt.participantIds.map(pId => {
                                                                        const part = participants.find(p => p.id === pId);
                                                                        if (!part) return null;
                                                                        const teamObj = teams.find(t => t.id === part.team_id);
                                                                        return (
                                                                            <span key={pId} className="badge badge-purple" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', fontSize: '0.78rem' }}>
                                                                                <span><strong>{part.name}</strong> ({part.chest_number})</span>
                                                                                {teamObj && <span style={{ opacity: 0.8, fontSize: '0.7rem' }}>[{teamObj.name}]</span>}
                                                                                <button
                                                                                    type="button"
                                                                                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', fontWeight: 'bold', marginLeft: 2 }}
                                                                                    onClick={() => {
                                                                                        setEditGroupTeams(prev => prev.map((t, idx) => idx === tIdx ? { ...t, participantIds: t.participantIds.filter(id => id !== pId) } : t));
                                                                                    }}
                                                                                >
                                                                                    ✕
                                                                                </button>
                                                                            </span>
                                                                        );
                                                                    })
                                                                )}
                                                            </div>

                                                            <div className="flex gap-2 items-c">
                                                                <select
                                                                    className="select select-sm flex-1"
                                                                    defaultValue=""
                                                                    onChange={(e) => {
                                                                        const selectedId = e.target.value;
                                                                        if (!selectedId) return;
                                                                        if (!gt.participantIds.includes(selectedId)) {
                                                                            setEditGroupTeams(prev => prev.map((t, idx) => idx === tIdx ? { ...t, participantIds: [...t.participantIds, selectedId] } : t));
                                                                        }
                                                                        e.target.value = "";
                                                                    }}
                                                                >
                                                                    <option value="">➕ Add Student to {gt.name || `Team ${tIdx + 1}`}...</option>
                                                                    {availableForTeam
                                                                        .filter(p => !gt.participantIds.includes(p.id))
                                                                        .map(p => {
                                                                            const pTeam = teams.find(t => t.id === p.team_id);
                                                                            return (
                                                                                <option key={p.id} value={p.id}>
                                                                                    {p.name} (Chest: {p.chest_number}) - {p.category || 'Senior'} {pTeam ? `[${pTeam.name}]` : ''}
                                                                                </option>
                                                                            );
                                                                        })}
                                                                </select>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="form-group">
                                            <div className="flex just-b items-c mb-2">
                                                <label className="form-label" style={{ margin: 0 }}>
                                                    Select Participating Students ({editEventParticipantIds.length} selected)
                                                </label>
                                                <div className="flex gap-2">
                                                    <button
                                                        type="button"
                                                        className="btn btn-ghost btn-sm text-xs"
                                                        style={{ color: 'var(--primary)', fontWeight: 600 }}
                                                        onClick={() => {
                                                            const activeCat = editEventCategoryFilter === 'all' ? editEventCategory : editEventCategoryFilter;
                                                            const catPartIds = participants
                                                                .filter(p => (p.category || 'Senior') === activeCat)
                                                                .map(p => p.id);

                                                            const allSelected = catPartIds.length > 0 && catPartIds.every(id => editEventParticipantIds.includes(id));
                                                            if (allSelected) {
                                                                setEditEventParticipantIds(prev => prev.filter(id => !catPartIds.includes(id)));
                                                            } else {
                                                                setEditEventParticipantIds(prev => [...new Set([...prev, ...catPartIds])]);
                                                            }
                                                        }}
                                                    >
                                                        ⚡ Select All {editEventCategoryFilter === 'all' ? editEventCategory : editEventCategoryFilter}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn btn-ghost btn-sm text-xs"
                                                        onClick={() => {
                                                            if (editEventParticipantIds.length === participants.length) {
                                                                setEditEventParticipantIds([]);
                                                            } else {
                                                                setEditEventParticipantIds(participants.map(p => p.id));
                                                            }
                                                        }}
                                                    >
                                                        {editEventParticipantIds.length === participants.length ? 'Deselect All' : 'Select All'}
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Category Filter Pills */}
                                            <div className="flex gap-1 mb-2" style={{ flexWrap: 'wrap' }}>
                                                {['all', editEventCategory, 'Kiddies', 'Sub Junior', 'Junior', 'Senior', 'Super Senior', 'General']
                                                    .filter((val, index, self) => self.indexOf(val) === index)
                                                    .map((cat) => (
                                                        <button
                                                            key={cat}
                                                            type="button"
                                                            className={`btn btn-sm ${editEventCategoryFilter === cat ? 'btn-primary' : 'btn-ghost'}`}
                                                            style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                                                            onClick={() => setEditEventCategoryFilter(cat)}
                                                        >
                                                            {cat === 'all' ? 'All' : cat === editEventCategory ? `⭐ ${cat}` : cat}
                                                        </button>
                                                    ))}
                                            </div>

                                            <input
                                                type="text"
                                                className="input input-sm mb-2"
                                                placeholder="Search student name, chest #..."
                                                value={editEventParticipantSearch}
                                                onChange={(e) => setEditEventParticipantSearch(e.target.value)}
                                            />

                                            <div style={{
                                                border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                                                maxHeight: 200, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6
                                            }}>
                                                {participants.length === 0 ? (
                                                    <p className="text-xs col-muted p-2">No registered participants.</p>
                                                ) : (() => {
                                                    const filteredParts = participants.filter(p => {
                                                        const matchesSearch = p.name.toLowerCase().includes(editEventParticipantSearch.toLowerCase()) || p.chest_number.toLowerCase().includes(editEventParticipantSearch.toLowerCase());
                                                        const partCat = p.category || 'Senior';
                                                        const matchesCat = editEventCategoryFilter === 'all' ? true : partCat === editEventCategoryFilter;
                                                        return matchesSearch && matchesCat;
                                                    });

                                                    if (filteredParts.length === 0) {
                                                        return (
                                                            <div className="p-3 text-center">
                                                                <p className="text-xs col-muted" style={{ margin: 0 }}>
                                                                    No participants registered in category <strong>"{editEventCategoryFilter}"</strong>.
                                                                </p>
                                                            </div>
                                                        );
                                                    }

                                                    return filteredParts.map((part) => {
                                                        const isChecked = editEventParticipantIds.includes(part.id);
                                                        const team = teams.find(t => t.id === part.team_id);
                                                        return (
                                                            <label key={part.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', cursor: 'pointer', borderRadius: 4, background: isChecked ? 'var(--primary-light)' : 'transparent' }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isChecked}
                                                                    onChange={(e) => {
                                                                        if (e.target.checked) {
                                                                            setEditEventParticipantIds(prev => [...prev, part.id]);
                                                                        } else {
                                                                            setEditEventParticipantIds(prev => prev.filter(id => id !== part.id));
                                                                        }
                                                                    }}
                                                                />
                                                                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{part.name}</span>
                                                                <span className="room-code text-xs">{part.chest_number}</span>
                                                                <span className="badge badge-purple text-xs" style={{ padding: '1px 6px', fontSize: '0.7rem' }}>{part.category || 'Senior'}</span>
                                                                {team && <span className="badge badge-gray text-xs">{team.name}</span>}
                                                            </label>
                                                        );
                                                    });
                                                })()}
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex gap-3 mt-3">
                                        <button type="button" className="btn btn-secondary flex-1" onClick={() => setEditingEvent(null)}>Cancel</button>
                                        <button type="submit" className="btn btn-primary flex-1" disabled={savingEdit}>
                                            {savingEdit ? 'Saving Changes...' : 'Save Changes'}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Participant Achievement History Detail Modal */}
            <AnimatePresence>
                {viewingHistoryParticipant && (() => {
                    const ach = getParticipantAchievements(viewingHistoryParticipant.id);
                    const team = teams.find(t => t.id === viewingHistoryParticipant.team_id);

                    return (
                        <div className="sidebar-overlay" style={{ zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                            <motion.div
                                className="card"
                                style={{ maxWidth: 700, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                            >
                                <div className="card-header flex just-b items-c">
                                    <div>
                                        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            🏆 {viewingHistoryParticipant.name}
                                            <span className="room-code">{viewingHistoryParticipant.chest_number}</span>
                                            {team && <span className="badge badge-yellow">{team.name}</span>}
                                        </h3>
                                        <p className="text-xs col-muted mt-1">Comprehensive Competition Achievement History</p>
                                    </div>
                                    <button className="btn btn-ghost btn-sm" onClick={() => setViewingHistoryParticipant(null)}>✕</button>
                                </div>
                                <div className="card-body" style={{ overflowY: 'auto' }}>
                                    {/* Stats Grid */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 20 }}>
                                        <div style={{ background: 'var(--bg-muted)', padding: 12, borderRadius: 'var(--r-sm)', textAlign: 'center' }}>
                                            <div className="text-xs col-muted font-600">Events Participated</div>
                                            <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{ach.totalEvents}</div>
                                        </div>
                                        <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', padding: 12, borderRadius: 'var(--r-sm)', textAlign: 'center' }}>
                                            <div className="text-xs font-600" style={{ color: '#92400E' }}>Prizes Won</div>
                                            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#B45309' }}>
                                                🥇{ach.firstPrizes} 🥈{ach.secondPrizes} 🥉{ach.thirdPrizes}
                                            </div>
                                        </div>
                                        <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', padding: 12, borderRadius: 'var(--r-sm)', textAlign: 'center' }}>
                                            <div className="text-xs font-600" style={{ color: '#065F46' }}>Grade A Count</div>
                                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#047857' }}>{ach.gradeA}</div>
                                        </div>
                                        <div style={{ background: '#EEF2FF', border: '1px solid #C7D2FE', padding: 12, borderRadius: 'var(--r-sm)', textAlign: 'center' }}>
                                            <div className="text-xs font-600" style={{ color: '#3730A3' }}>Total Points</div>
                                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#4338CA' }}>{ach.totalPoints} pts</div>
                                        </div>
                                    </div>

                                    {/* History Table */}
                                    <h4>Event Breakdown</h4>
                                    <div className="table-wrap" style={{ marginTop: 10 }}>
                                        <table className="table">
                                            <thead>
                                                <tr>
                                                    <th>Event Name</th>
                                                    <th>Type</th>
                                                    <th>Category</th>
                                                    <th>Room</th>
                                                    <th>Avg Score</th>
                                                    <th>Grade</th>
                                                    <th>Rank Position</th>
                                                    <th>Prize / Status</th>
                                                    <th>Points</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {ach.eventsList.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={9}>
                                                            <div className="empty-state"><p>No score records found for this participant yet.</p></div>
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    ach.eventsList.map((ev) => (
                                                        <tr key={ev.eventId}>
                                                            <td><strong>{ev.eventName}</strong></td>
                                                            <td>
                                                                <span className={`badge ${ev.eventType === 'group' ? 'badge-purple' : 'badge-blue'}`} style={{ fontSize: '0.7rem' }}>
                                                                    {ev.eventType === 'group' ? '👥 Group' : '👤 Solo'}
                                                                </span>
                                                            </td>
                                                            <td><span className="badge badge-gray">{ev.category}</span></td>
                                                            <td><span className="room-code" style={{ fontSize: '0.75rem' }}>{ev.roomCode}</span></td>
                                                            <td><strong>{ev.avgScore}</strong></td>
                                                            <td>
                                                                <span className={`badge ${ev.grade === 'A' ? 'badge-green' : ev.grade === 'B' ? 'badge-yellow' : 'badge-gray'}`}>
                                                                    Grade {ev.grade}
                                                                </span>
                                                            </td>
                                                            <td>#{ev.rank}</td>
                                                            <td><strong>{ev.prize}</strong></td>
                                                            <td>
                                                                <strong style={{ color: 'var(--primary)' }}>+{ev.points} pts</strong>
                                                                {ev.eventType === 'group' && <span className="text-xs col-muted" style={{ display: 'block', fontSize: '0.68rem' }}>(Team Only)</span>}
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </motion.div>
                        </div>
                    );
                })()}
            </AnimatePresence>

            {/* Confirmation Modals */}
            <AnimatePresence>
                {deletingEvent && (
                    <div className="sidebar-overlay" style={{ zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                        <motion.div
                            className="card"
                            style={{ maxWidth: 440, width: '100%', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)' }}
                            initial={{ scale: 0.9, opacity: 0, y: 15 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 15 }}
                            transition={{ duration: 0.2 }}
                        >
                            <div style={{ padding: '24px 24px 16px', textAlign: 'center' }}>
                                <div style={{
                                    width: 56,
                                    height: 56,
                                    borderRadius: '50%',
                                    background: '#FEF2F2',
                                    color: '#EF4444',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    margin: '0 auto 16px',
                                    fontSize: '1.6rem',
                                    border: '1px solid #FCA5A5'
                                }}>
                                    🗑️
                                </div>
                                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 8 }}>
                                    Delete Event?
                                </h3>
                                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
                                    Are you sure you want to delete <strong style={{ color: 'var(--text-main)', fontWeight: 700 }}>"{deletingEvent.name}"</strong>?
                                </p>
                                <p style={{ fontSize: '0.82rem', color: '#EF4444', marginTop: 12, background: '#FEF2F2', padding: '8px 12px', borderRadius: 8, border: '1px solid #FCA5A5', lineHeight: 1.4 }}>
                                    ⚠️ Warning: This will permanently delete all recorded scores and code mappings for this event.
                                </p>
                            </div>

                            <div className="flex just-e gap-2" style={{ padding: '16px 24px 24px', background: '#F9FAFB', borderTop: '1px solid var(--border)' }}>
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    style={{ padding: '8px 18px', fontSize: '0.85rem' }}
                                    onClick={() => setDeletingEvent(null)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-sm"
                                    style={{ background: '#EF4444', color: 'white', border: 'none', padding: '8px 20px', fontSize: '0.85rem', fontWeight: 600, borderRadius: 'var(--r-sm)' }}
                                    onClick={() => {
                                        const target = deletingEvent;
                                        setDeletingEvent(null);
                                        confirmDeleteEvent(target.id, target.name);
                                    }}
                                >
                                    🗑️ Delete Event
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
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
                    <h3 style={{ marginBottom: 3, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {event.event_name}
                        {event.category && <span className="badge badge-gray" style={{ fontSize: '0.7rem', padding: '2px 6px' }}>{event.category}</span>}
                        <span className={`badge ${event.event_type === 'group' ? 'badge-purple' : 'badge-blue'}`} style={{ fontSize: '0.7rem', padding: '2px 6px', fontWeight: 600 }}>
                            {event.event_type === 'group' ? '👥 Group Event' : '👤 Solo Event'}
                        </span>
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
