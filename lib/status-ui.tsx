'use client';
import { useState } from 'react';
import { sb } from '@/lib/sb-browser';

export type QA = { result: 'passed' | 'failed'; at: string; note?: string | null; by?: string | null } | null;
// One "Tested" verdict: a manual QA result wins over the automated suite
export function testedLabel(auto: string, qa: QA): { text: string; cls: string; key: 'Passed' | 'Failed' | 'Not tested' } {
  if (qa?.result === 'failed') return { text: 'Failed (QA)', cls: 'bad', key: 'Failed' };
  if (qa?.result === 'passed') return { text: auto === 'Passed' ? 'Passed (auto + QA)' : 'Passed (QA)', cls: 'ok', key: 'Passed' };
  if (auto === 'Passed') return { text: 'Passed (auto)', cls: 'ok', key: 'Passed' };
  return { text: 'Not tested', cls: '', key: 'Not tested' };
}
export async function markRequirement(id: string, result: 'passed' | 'failed' | 'cleared', note?: string) {
  const { error } = await sb().rpc('mark_requirement', { p_req: id, p_result: result, p_note: note ?? null });
  if (error) throw new Error(/NOTE_REQUIRED/.test(error.message) ? 'Add a note saying what failed.' : /FORBIDDEN|permission/.test(error.message) ? 'Only admins can mark requirements.' : 'Could not save. Try again.');
}
export function QuickMark({ id, qa, onDone }: { id: string; qa: QA; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async (r: 'passed' | 'cleared') => { setBusy(true); try { await markRequirement(id, r); onDone(); } catch (e: any) { alert(e.message); } finally { setBusy(false); } };
  return qa ? <button className="btn ghost sm" disabled={busy} onClick={(e) => { e.stopPropagation(); run('cleared'); }}>Undo</button>
            : <button className="btn sm" disabled={busy} onClick={(e) => { e.stopPropagation(); run('passed'); }}>Mark tested</button>;
}
